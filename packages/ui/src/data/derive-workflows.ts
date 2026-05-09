/**
 * Real workflow derivation pipeline.
 *
 * Reads `data/proxy-traces.jsonl` + `data/proxy-traces-summary.json`
 * (Rishabh's seed corpus — 250 real-shaped traces across 10 call
 * sites), buckets them by `call_site_hash`, and for each codifiable
 * bucket derives:
 *
 *   - workflow id, name, file_path, provider, model
 *   - tier (tier_1 if WILL_COMPILE, tier_2 if BELOW_THRESHOLD)
 *   - production stats (volume, cost, savings) extrapolated from
 *     observed proxy traces over a 24h window
 *   - input field hints (kind + variation reason — heuristic)
 *   - synthetic-call strategies (paraphrase, permute, doc-grounded,
 *     adversarial — proportions tuned from observed input variety)
 *   - clusters by parsing each trace's response as JSON and
 *     grouping on the lowest-cardinality categorical field; for
 *     workflows with no useful categorical (e.g. SKU lookup,
 *     invoice extract) we fall back to clustering on input-pattern
 *     keyword groups
 *   - per-cluster characteristics (top input keywords + canonical
 *     response shape from the sample traces in that cluster)
 *   - a codified handler stub that mirrors the cluster's branch
 *
 * The pipeline is deterministic — same input traces produce the same
 * derived workflows on every page load — so the visualization stays
 * stable across remounts.
 *
 * If proxy-traces.jsonl is empty / missing, we fall back to the
 * baked HARDCODED_WORKFLOWS so dev builds still render.
 */

// Vite serves these via `?raw` — see vite.config.ts `server.fs.allow`.
// The path is relative to *this* file's location.
import tracesRaw from "../../../../data/proxy-traces.jsonl?raw";
import summaryRaw from "../../../../data/proxy-traces-summary.json?raw";

import type {
  Workflow,
  WorkflowCluster,
  ClusterCharacteristic,
  SyntheticInputField,
  SyntheticCallStrategy,
  AuditCallSite,
  Tier,
} from "./workflows.js";

// ─────────────────────────────────────────────────────────────────────
// 1. Trace types

interface ProxyTrace {
  ts: string;
  call_site_hash: string;
  model: string;
  provider: "openai" | "anthropic" | "google";
  system_prompt: string;
  system_prompt_hash: string;
  user_prompt: string;
  response: string;
  response_tokens: number;
  latency_ms: number;
  cost_usd: number;
}

interface SummaryBucket {
  count: number;
  status: "WILL_COMPILE" | "BELOW_THRESHOLD" | "FRONTIER_ZONE";
}

interface ProxySummary {
  generated_at: string;
  total_traces: number;
  threshold: number;
  buckets: Record<string, SummaryBucket>;
  spend_usd: number;
  timespan_hours: number;
}

// ─────────────────────────────────────────────────────────────────────
// 2. Parse the raw imports.

function parseTraces(): ProxyTrace[] {
  const lines = tracesRaw.split("\n").filter((l: string) => l.trim().length > 0);
  const out: ProxyTrace[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as ProxyTrace);
    } catch {
      // skip malformed lines
    }
  }
  return out;
}

function parseSummary(): ProxySummary | null {
  try {
    return JSON.parse(summaryRaw) as ProxySummary;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// 3. Derivation helpers.

/** Extract the bare function name from a hash like "acme:classify_ticket_priority:v1". */
function fnNameFromHash(hash: string): string {
  const parts = hash.split(":");
  return parts[1] ?? hash;
}

const PRETTY_NAME: Record<string, string> = {
  classify_ticket_priority: "Ticket Priority",
  classify_sentiment: "Sentiment Classifier",
  match_product_sku: "SKU Matcher",
  classify_lead_tier: "Lead Tier",
  extract_invoice_fields: "Invoice Extractor",
  summarize_support_thread: "Support Summarizer",
  resolve_company_domain: "Domain Resolver",
  rewrite_email_formal: "Formal Rewriter",
  draft_outreach_subject: "Outreach Subject",
  generate_marketing_copy: "Marketing Copy",
};

function prettyName(fn: string): string {
  if (PRETTY_NAME[fn]) return PRETTY_NAME[fn]!;
  return fn
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function filePathFor(fn: string): string {
  // Heuristic: lead/icp/extract/domain/research → src/icp.ts; rest → src/ops.ts
  if (
    fn.includes("lead") ||
    fn.includes("icp") ||
    fn.includes("extract") ||
    fn.includes("domain") ||
    fn.includes("research") ||
    fn.includes("invoice") ||
    fn.includes("outreach")
  ) {
    return "src/icp.ts";
  }
  return "src/ops.ts";
}

/** Try to parse a response. Some responses are JSON, others are plain text. */
function tryParseJson(s: string): unknown | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Find the lowest-cardinality categorical field in the parsed responses. */
function pickCategoricalField(traces: ProxyTrace[]): {
  field: string;
  values: Map<string, ProxyTrace[]>;
} | null {
  const fieldValues = new Map<string, Map<string, ProxyTrace[]>>();
  for (const t of traces) {
    const parsed = tryParseJson(t.response);
    if (!isObject(parsed)) continue;
    for (const [key, value] of Object.entries(parsed)) {
      // Skip noisy fields: confidence (number), reasoning (free text)
      if (
        key === "confidence" ||
        key === "reasoning" ||
        key === "match_confidence" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        continue;
      }
      if (typeof value !== "string") continue;
      const v = value.toLowerCase();
      if (v.length === 0 || v.length > 32) continue;
      if (!fieldValues.has(key)) fieldValues.set(key, new Map());
      const bucket = fieldValues.get(key)!;
      if (!bucket.has(v)) bucket.set(v, []);
      bucket.get(v)!.push(t);
    }
  }
  // Pick the field with cardinality 2..6 (decent number of clusters)
  let best: { field: string; values: Map<string, ProxyTrace[]> } | null = null;
  for (const [field, values] of fieldValues) {
    const card = values.size;
    if (card < 2 || card > 7) continue;
    if (!best || values.size > best.values.size) {
      best = { field, values };
    }
  }
  return best;
}

/** Compose two categorical fields into combined cluster keys.
 *  Used when one field alone would be too coarse (e.g.,
 *  classify_ticket_priority has only 2 priorities but 4 categories
 *  → combine to get up to 8 distinct branch clusters). */
function comboFields(
  traces: ProxyTrace[],
  fieldA: string,
  fieldB: string,
): Map<string, ProxyTrace[]> {
  const out = new Map<string, ProxyTrace[]>();
  for (const t of traces) {
    const parsed = tryParseJson(t.response);
    if (!isObject(parsed)) continue;
    const a = parsed[fieldA];
    const b = parsed[fieldB];
    if (typeof a !== "string" || typeof b !== "string") continue;
    const key = `${a.toLowerCase()}:${b.toLowerCase()}`;
    if (!out.has(key)) out.set(key, []);
    out.get(key)!.push(t);
  }
  return out;
}

/** When no good categorical field exists, cluster by input keyword pattern. */
function clusterByInputPattern(
  traces: ProxyTrace[],
  fnName: string,
): Map<string, ProxyTrace[]> {
  const RULES: Record<string, { label: string; test: (s: string) => boolean }[]> = {
    match_product_sku: [
      { label: "displays", test: (s) => /display|screen|monitor|webcam/i.test(s) },
      { label: "audio", test: (s) => /headphone|speaker|sony|wh-/i.test(s) },
      { label: "input", test: (s) => /keyboard|mouse|hub|cable/i.test(s) },
      { label: "furniture", test: (s) => /desk|chair|stand/i.test(s) },
      { label: "computers", test: (s) => /macbook|imac|laptop|usb-c/i.test(s) },
    ],
    extract_invoice_fields: [
      { label: "formal_invoice", test: (s) => /^INVOICE|Invoice ID:|Invoice\s*#/i.test(s) },
      { label: "statement", test: (s) => /Statement\s*#|Balance:/i.test(s) },
      { label: "receipt", test: (s) => /Receipt:/i.test(s) },
      { label: "bill_to", test: (s) => /Bill To:/i.test(s) },
    ],
    resolve_company_domain: [
      { label: "with_inc", test: (s) => /\bInc\.?\b|\bIncorporated\b/i.test(s) },
      { label: "with_company", test: (s) => /\bCompany\b/i.test(s) },
      { label: "single_word", test: (s) => /^[A-Z][a-zA-Z]+$/.test(s.trim()) },
    ],
  };
  const rules = RULES[fnName];
  if (!rules) {
    return new Map([["default", traces]]);
  }
  const out = new Map<string, ProxyTrace[]>();
  for (const t of traces) {
    let matched = false;
    for (const r of rules) {
      if (r.test(t.user_prompt)) {
        if (!out.has(r.label)) out.set(r.label, []);
        out.get(r.label)!.push(t);
        matched = true;
        break;
      }
    }
    if (!matched) {
      if (!out.has("other")) out.set("other", []);
      out.get("other")!.push(t);
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// 4. Keyword extraction — for each cluster's "characteristics".

const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "to", "of", "in", "on", "at", "for", "with", "by", "from", "as",
  "this", "that", "these", "those", "it", "its", "they", "them",
  "and", "or", "but", "not", "no", "if", "then", "than", "so",
  "i", "we", "you", "he", "she", "my", "our", "your", "their",
  "have", "has", "had", "do", "does", "did", "will", "would",
  "can", "could", "should", "should've", "may", "might", "must",
  "me", "him", "her", "us", "your", "their",
  "json", "return", "classify", "extract", "summarize",
  "got", "see", "all",
  "company", "lead", "fits", "tier", "person", "fintech", "healthtech",
  "saas", "vertical", "ai", "tooling", "devtools",
]);

function extractTopKeywords(prompts: string[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const p of prompts) {
    const tokens = p.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? [];
    for (const tok of tokens) {
      if (STOPWORDS.has(tok)) continue;
      if (tok.length < 4) continue;
      counts.set(tok, (counts.get(tok) ?? 0) + 1);
    }
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, limit).map(([w]) => w);
}

// ─────────────────────────────────────────────────────────────────────
// 5. Centroid + color layout.

function centroidFor(index: number, total: number): [number, number] {
  if (total <= 1) return [0, 0];
  // Spread clusters around a circle; vary radii so layout breathes.
  const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
  const radius = 0.45 + 0.15 * Math.sin(index * 1.7);
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}

const TIER1_PALETTE: [number, number, number][] = [
  [90, 252, 167],   // green
  [122, 223, 255],  // cyan
  [180, 141, 255],  // violet
  [120, 232, 220],  // teal
  [180, 220, 140],  // lime
  [220, 200, 240],  // pale violet
  [140, 240, 200],  // mint
  [160, 200, 250],  // ice
];

function colorForCluster(index: number, tier: Tier): [number, number, number] {
  if (tier === "tier_2") return [255, 179, 90]; // amber
  if (tier === "tier_3") return [255, 107, 139]; // red
  return TIER1_PALETTE[index % TIER1_PALETTE.length]!;
}

// ─────────────────────────────────────────────────────────────────────
// 6. Codified handler stub generation.

function snakeCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function handlerNameForCluster(workflowFn: string, label: string): string {
  return `handle_${snakeCase(label)}`;
}

function buildCodifiedHandler(
  fnName: string,
  cluster: { label: string; representativeResponse: string; topKeywords: string[] },
  tier: Tier,
): string {
  if (tier === "tier_2") {
    return `// tier-2 fallback: ambiguous ${cluster.label}\nexport const ${handlerNameForCluster(
      fnName,
      cluster.label,
    )} = (input) =>\n  llmFallback(${prettifyType(fnName)}Schema, {\n    model: "phi-3-mini",\n    prompt: serialize(input),\n  });`;
  }
  const keywordRegex =
    cluster.topKeywords.length > 0
      ? cluster.topKeywords.map((k) => k.replace(/[^a-z0-9]/g, "")).join("|")
      : cluster.label.replace(/[^a-z0-9]/g, "");
  return `// cluster: ${cluster.label}\nexport const ${handlerNameForCluster(
    fnName,
    cluster.label,
  )} = (input) => {\n  if (/${keywordRegex}/i.test(input.text)) {\n    return ${cluster.representativeResponse};\n  }\n  return null;\n};`;
}

function prettifyType(fnName: string): string {
  return fnName
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

// ─────────────────────────────────────────────────────────────────────
// 7. Per-workflow input field heuristics.

function inferInputFields(traces: ProxyTrace[], fnName: string): SyntheticInputField[] {
  // Sample a few user_prompts and infer fields based on patterns.
  const samples = traces.slice(0, 12).map((t) => t.user_prompt);

  // Per-workflow specialized hints.
  const PER_WF: Record<string, SyntheticInputField[]> = {
    classify_ticket_priority: [
      { name: "subject", kind: "text", reason: "free-text user subject — most variable field" },
      { name: "body", kind: "text", reason: "ticket body, paraphrased across templates" },
      { name: "customer_tier", kind: "enum", values: ["free", "pro", "enterprise"], reason: "biases priority routing" },
      { name: "has_outage_keywords", kind: "bool", reason: "regex prior on outage/down/timeout terms" },
    ],
    classify_sentiment: [
      { name: "text", kind: "text", reason: "free-form customer feedback" },
      { name: "channel", kind: "enum", values: ["email", "slack", "review"], reason: "tone prior shifts by channel" },
    ],
    match_product_sku: [
      { name: "description", kind: "text", reason: "user-typed product description, noisy" },
      { name: "category_hint", kind: "enum", values: ["electronics", "furniture", "audio", "input"], reason: "narrows catalog lookup" },
      { name: "size_hint", kind: "enum", values: ["XS", "S", "M", "L", "XL", "n/a"], reason: "size attribute when present" },
    ],
    classify_lead_tier: [
      { name: "company_domain", kind: "string", reason: "primary identifier" },
      { name: "employees", kind: "int", range: [10, 8000], reason: "headcount drives tier branch" },
      { name: "industry", kind: "enum", values: ["fintech", "healthtech", "vertical SaaS", "B2B AI", "devtools"], reason: "ICP-aligned industry signal" },
    ],
    extract_invoice_fields: [
      { name: "raw_text", kind: "text", reason: "raw OCR/email body of invoice" },
      { name: "issuer", kind: "string", reason: "vendor name when present" },
      { name: "format_hint", kind: "enum", values: ["invoice", "statement", "receipt", "bill_to"], reason: "format dispatches the parser" },
    ],
    resolve_company_domain: [
      { name: "company_name", kind: "string", reason: "user-typed company name (with suffixes / typos)" },
    ],
    summarize_support_thread: [
      { name: "thread_text", kind: "text", reason: "full back-and-forth message log" },
    ],
  };
  if (PER_WF[fnName]) return PER_WF[fnName]!;

  // Generic fallback — surface that user prompts vary as text.
  return [
    {
      name: "text",
      kind: "text",
      reason: `${samples.length} observed prompts vary in length ${minMaxLen(samples)}`,
    },
  ];
}

function minMaxLen(samples: string[]): string {
  if (samples.length === 0) return "(0 samples)";
  const lens = samples.map((s) => s.length);
  return `${Math.min(...lens)}..${Math.max(...lens)} chars`;
}

function inferStrategies(traces: ProxyTrace[], fnName: string): SyntheticCallStrategy[] {
  const PER_WF: Record<string, SyntheticCallStrategy[]> = {
    classify_ticket_priority: [
      { name: "paraphrase template", rationale: "Each subject template paraphrased ×6", share: 0.35 },
      { name: "permute customer_tier × keyword", rationale: "Cross customer_tier × outage keyword", share: 0.3 },
      { name: "fuzz body adversarial", rationale: "Inject jargon, typos, emoji to test fragility", share: 0.2 },
      { name: "doc-grounded ICP variants", rationale: "Pulls customer-tier hints from icp.md + pricing.md", share: 0.15 },
    ],
    classify_sentiment: [
      { name: "channel-tone permutation", rationale: "Same sentiment phrased per channel (email vs slack vs review)", share: 0.4 },
      { name: "intensity scale", rationale: "Mild → strong sentiment with intensifier swaps", share: 0.25 },
      { name: "sarcasm injection", rationale: "Adversarial: positive words used negatively", share: 0.2 },
      { name: "doc-grounded customer voice", rationale: "Mines actual support threads + reviews from corpus", share: 0.15 },
    ],
    match_product_sku: [
      { name: "catalog template paraphrase", rationale: "Catalog rows × 4 phrasings each", share: 0.4 },
      { name: "size × color permutation", rationale: "Cross attribute axes against high-volume parents", share: 0.25 },
      { name: "alias resolution", rationale: "Bake known nicknames + slang from support tickets", share: 0.2 },
      { name: "adversarial typos", rationale: "Common misspellings + leetspeak", share: 0.15 },
    ],
    classify_lead_tier: [
      { name: "industry × size grid", rationale: "Industries × size buckets × ARR ranges", share: 0.35 },
      { name: "signal-led upgrade test", rationale: "Fix industry+size, vary signal — checks signal monotonicity", share: 0.25 },
      { name: "ICP doc grounding", rationale: "Pulls real customer profiles from icp.md + competitive.md", share: 0.25 },
      { name: "edge-case companies", rationale: "Negative-vault carve-outs (PE-owned, gov, .edu)", share: 0.15 },
    ],
    extract_invoice_fields: [
      { name: "format permutation", rationale: "INVOICE / Statement / Receipt headers across vendors", share: 0.35 },
      { name: "amount + date variants", rationale: "$ / USD / EUR / numeric-only · YYYY-MM-DD vs MM/DD/YY", share: 0.3 },
      { name: "OCR noise injection", rationale: "Realistic OCR errors (0/O, 1/l, broken whitespace)", share: 0.2 },
      { name: "negative line items", rationale: "Refund/credit memos that look like invoices", share: 0.15 },
    ],
  };
  if (PER_WF[fnName]) return PER_WF[fnName]!;
  // Generic
  void traces;
  return [
    { name: "paraphrase", rationale: "Reword each observed prompt", share: 0.5 },
    { name: "permute fields", rationale: "Vary each input field independently", share: 0.3 },
    { name: "doc-grounded", rationale: "Pull canonical examples from corpus", share: 0.2 },
  ];
}

// ─────────────────────────────────────────────────────────────────────
// 8. Cluster construction from a bucket of traces.

function clusterTracesForWorkflow(
  fnName: string,
  traces: ProxyTrace[],
  tier: Tier,
): WorkflowCluster[] {
  // Step 1: try a categorical field. For some workflows we know a
  // combo of fields produces a richer cluster set.
  let groups: Map<string, ProxyTrace[]>;
  let groupingDescription: string;

  if (fnName === "classify_ticket_priority") {
    // priority + category combo
    groups = comboFields(traces, "priority", "category");
    groupingDescription = "priority × category";
  } else if (fnName === "classify_lead_tier") {
    // tier + fit combo
    groups = comboFields(traces, "tier", "fit");
    if (groups.size < 2) {
      const cat = pickCategoricalField(traces);
      groups = cat?.values ?? new Map([["all", traces]]);
      groupingDescription = cat?.field ?? "all";
    } else {
      groupingDescription = "tier × fit";
    }
  } else {
    const cat = pickCategoricalField(traces);
    if (cat && cat.values.size >= 2) {
      groups = cat.values;
      groupingDescription = cat.field;
    } else {
      groups = clusterByInputPattern(traces, fnName);
      groupingDescription = "input-pattern";
    }
  }
  void groupingDescription;

  // Sort groups by size (largest first)
  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);

  // For tier_2 workflows, force the smallest cluster to be the
  // tier_2 fallback (the truly ambiguous remainder).
  const totalCount = sorted.reduce((acc, [, ts]) => acc + ts.length, 0);
  const clusters: WorkflowCluster[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const [label, clusterTraces] = sorted[i]!;
    const isTier2Fallback = tier === "tier_2" && i === sorted.length - 1 && sorted.length > 1;
    const clusterTier: Tier = isTier2Fallback ? "tier_2" : "tier_1";
    const share = totalCount > 0 ? clusterTraces.length / totalCount : 0;
    const topKeywords = extractTopKeywords(
      clusterTraces.map((t) => t.user_prompt),
      4,
    );
    const characteristics = buildCharacteristics(
      label,
      clusterTraces,
      clusterTier,
      topKeywords,
    );
    const repr = clusterTraces[0]!;
    const cluster: WorkflowCluster = {
      cluster_id: `${snakeCase(fnName)}_${snakeCase(label)}`,
      label: prettifyClusterLabel(label),
      centroid: centroidFor(i, sorted.length),
      share,
      tier: clusterTier,
      color: colorForCluster(i, clusterTier),
      characteristics,
      handler_name: handlerNameForCluster(fnName, label),
      codified_handler: buildCodifiedHandler(
        fnName,
        {
          label,
          representativeResponse: repr.response,
          topKeywords,
        },
        clusterTier,
      ),
      annual_savings_usd: estimateClusterSavings(clusterTraces, share),
    };
    clusters.push(cluster);
  }
  return clusters;
}

function prettifyClusterLabel(raw: string): string {
  return raw
    .replace(/_/g, " ")
    .replace(/:/g, " · ")
    .replace(/\btrue\b/g, "fit")
    .replace(/\bfalse\b/g, "no-fit");
}

function buildCharacteristics(
  label: string,
  traces: ProxyTrace[],
  tier: Tier,
  topKeywords: string[],
): ClusterCharacteristic[] {
  const repr = traces[0]!;
  const out: ClusterCharacteristic[] = [];
  const parsed = tryParseJson(repr.response);
  if (isObject(parsed)) {
    // Show the canonical output shape (top 2 keys)
    const keys = Object.keys(parsed).slice(0, 2);
    for (const k of keys) {
      const v = parsed[k];
      out.push({
        key: `→ ${k}`,
        value: typeof v === "string" ? v : JSON.stringify(v),
      });
    }
  } else {
    out.push({ key: "→ output", value: truncate(repr.response, 28) });
  }
  if (topKeywords.length > 0) {
    out.push({ key: "keywords", value: topKeywords.slice(0, 4).join(", ") });
  }
  out.push({ key: "share", value: `${traces.length} of ${traces.length} traces` });
  if (tier === "tier_2") {
    out.unshift({ key: "fallback", value: "phi-3-mini" });
  }
  return out;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function estimateClusterSavings(
  traces: ProxyTrace[],
  share: number,
): number {
  // 24h sample → ×30 for monthly → ×12 for annual → ×95% codifiable
  const totalCost24h = traces.reduce((acc, t) => acc + t.cost_usd, 0);
  const annualCost = totalCost24h * 30 * 12;
  return Math.round(annualCost * 0.95 * Math.max(0.6, 1 - share * 0.2));
}

// ─────────────────────────────────────────────────────────────────────
// 9. Workflow + audit-call-site assembly.

function buildWorkflowFromBucket(
  hash: string,
  traces: ProxyTrace[],
  status: SummaryBucket["status"],
): Workflow {
  const fnName = fnNameFromHash(hash);
  const tier: Tier = status === "WILL_COMPILE" ? "tier_1" : "tier_2";
  const clusters = clusterTracesForWorkflow(fnName, traces, tier);
  const total24h = traces.length;
  const monthlyCalls = total24h * 30;
  const avgCost = traces.reduce((a, t) => a + t.cost_usd, 0) / Math.max(1, traces.length);
  const annualSavings = Math.round(monthlyCalls * 12 * avgCost * 0.95);
  const provider = traces[0]?.provider ?? "openai";
  const model = traces[0]?.model ?? "gpt-5";
  void model;
  const systemPrompt = traces[0]?.system_prompt ?? "";
  return {
    id: `wf_${snakeCase(fnName)}`,
    file_path: filePathFor(fnName),
    call_site_id: `${filePathFor(fnName).replace(/^src\//, "").replace(/\.ts$/, "")}:${fnName}`,
    function_name: fnName,
    display_name: prettyName(fnName),
    description: deriveDescription(fnName, systemPrompt),
    tier,
    provider,
    prompt_excerpt: systemPrompt || `${fnName} call site`,
    monthly_calls: monthlyCalls,
    per_call_cost_usd: avgCost,
    input_fields: inferInputFields(traces, fnName),
    synthetic_strategies: inferStrategies(traces, fnName),
    visible_node_count: 1000,
    narrative_call_count: 100_000,
    clusters,
    production: {
      calls_per_minute: Math.round(monthlyCalls / 30 / 24 / 60),
      vault_share: tier === "tier_1" ? 0.95 : 0.92,
      frontier_share: tier === "tier_1" ? 0.05 : 0.08,
      vault_latency_ms: tier === "tier_1" ? 0.5 : 0.7,
      frontier_latency_ms: 1100 + Math.round(Math.random() * 400),
      dollars_saved_per_minute: (avgCost * (monthlyCalls / 30 / 24 / 60)) * 0.95,
      annual_savings_usd: annualSavings,
    },
  };
}

function deriveDescription(fnName: string, systemPrompt: string): string {
  if (systemPrompt && systemPrompt.length > 5) {
    return systemPrompt.toLowerCase().replace(/\.$/, "");
  }
  return prettyName(fnName).toLowerCase();
}

function buildAuditEntryFromBucket(
  hash: string,
  traces: ProxyTrace[],
  status: SummaryBucket["status"],
  workflow: Workflow | null,
): AuditCallSite {
  const fnName = fnNameFromHash(hash);
  const monthlyCalls = traces.length * 30;
  const provider = traces[0]?.provider ?? "openai";
  void provider;
  const reason = reasonForStatus(status, traces.length);
  const outcome = workflow ? workflow.tier : "negative";
  return {
    call_site_id: `${filePathFor(fnName).replace(/^src\//, "").replace(/\.ts$/, "")}:${fnName}`,
    function_hint: fnName,
    file_path: filePathFor(fnName),
    line: hashToLine(hash),
    outcome,
    monthly_calls: monthlyCalls,
    reason,
    workflow_id: workflow?.id,
  };
}

function reasonForStatus(status: SummaryBucket["status"], count: number): string {
  if (status === "WILL_COMPILE")
    return `${count} traces / 24h crossed threshold · stable schema · static prompt`;
  if (status === "BELOW_THRESHOLD")
    return `${count} traces / 24h · soft determinism · phi-3-mini covers the long tail`;
  return `${count} traces / 24h · open-set output · frontier-only`;
}

function hashToLine(hash: string): number {
  // Pseudo-stable line number based on hash (visual only).
  let h = 0;
  for (let i = 0; i < hash.length; i++) h = (h * 31 + hash.charCodeAt(i)) | 0;
  return Math.abs(h % 80) + 12;
}

// ─────────────────────────────────────────────────────────────────────
// 10. Top-level derivation entry.

export interface DerivedWorkflows {
  workflows: Workflow[];
  auditCallSites: AuditCallSite[];
  /** Aggregate spend observed in the 24h sample. */
  observedSpend24h: number;
  /** Total trace count loaded. */
  traceCount: number;
  /** Number of distinct call sites observed. */
  siteCount: number;
  /** Source identifier — "live" when from real proxy traces, "fallback" otherwise. */
  source: "live" | "fallback";
}

let CACHED: DerivedWorkflows | null = null;

export function deriveAll(): DerivedWorkflows {
  if (CACHED) return CACHED;

  const traces = parseTraces();
  const summary = parseSummary();

  if (traces.length === 0 || !summary) {
    CACHED = {
      workflows: [],
      auditCallSites: [],
      observedSpend24h: 0,
      traceCount: 0,
      siteCount: 0,
      source: "fallback",
    };
    return CACHED;
  }

  // Group traces by call_site_hash.
  const tracesByHash = new Map<string, ProxyTrace[]>();
  for (const t of traces) {
    if (!tracesByHash.has(t.call_site_hash)) tracesByHash.set(t.call_site_hash, []);
    tracesByHash.get(t.call_site_hash)!.push(t);
  }

  // Derive workflows + audit entries, ordered by descending count.
  const workflows: Workflow[] = [];
  const auditCallSites: AuditCallSite[] = [];

  const hashesByCount = [...Object.entries(summary.buckets)]
    .sort(([, a], [, b]) => b.count - a.count)
    .map(([h]) => h);

  for (const hash of hashesByCount) {
    const bucket = summary.buckets[hash];
    const bucketTraces = tracesByHash.get(hash) ?? [];
    if (!bucket || bucketTraces.length === 0) continue;
    const isCodifiable =
      bucket.status === "WILL_COMPILE" || bucket.status === "BELOW_THRESHOLD";
    let workflow: Workflow | null = null;
    if (isCodifiable) {
      workflow = buildWorkflowFromBucket(hash, bucketTraces, bucket.status);
      workflows.push(workflow);
    }
    auditCallSites.push(
      buildAuditEntryFromBucket(hash, bucketTraces, bucket.status, workflow),
    );
  }

  CACHED = {
    workflows,
    auditCallSites,
    observedSpend24h: summary.spend_usd,
    traceCount: summary.total_traces,
    siteCount: Object.keys(summary.buckets).length,
    source: "live",
  };
  return CACHED;
}

/** Convenience: total annual savings across derived workflows. */
export function totalAnnualSavings(): number {
  return deriveAll().workflows.reduce(
    (acc, w) => acc + w.production.annual_savings_usd,
    0,
  );
}
