import * as fs from "node:fs";
import * as path from "node:path";
import type { CallSiteDescriptor } from "@compile/schemas";
import type { RealNiaClient } from "./real-client.js";

export interface CorpusDoc {
  /** Filesystem-relative or Nia source id, depending on mode. */
  id: string;
  title: string;
  body: string;
}

export interface SeedInput {
  call_site_id: string;
  index: number;
  /** The arguments the call site would receive at runtime. */
  args: Record<string, unknown>;
  /** Doc ids the seed was grounded against. */
  grounded_in: string[];
}

export interface GenerateOptions {
  /** Number of seed inputs to produce. Default 100. */
  count?: number;
  /** Deterministic seed for reproducibility. */
  prng_seed?: number;
}

/**
 * Load the local Acme corpus (data/acme/corpus). Used by the template-mode
 * generator so we never spend Nia query budget on the demo's 100-seed step.
 * The same shape comes back from `loadCorpusFromNia` once we wire that.
 */
export function loadLocalCorpus(corpusRoot: string): CorpusDoc[] {
  const docs: CorpusDoc[] = [];
  const stack: string[] = [corpusRoot];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.endsWith(".md") && e.name !== "README.md") {
        const body = fs.readFileSync(p, "utf8");
        const titleMatch = body.match(/^#\s+(.+)$/m);
        docs.push({
          id: path.relative(corpusRoot, p),
          title: titleMatch?.[1]?.trim() ?? path.basename(p, ".md"),
          body,
        });
      }
    }
  }
  return docs;
}

/**
 * Template seed generator — deterministic, no LLM. Picks the right template
 * for each call site by file name. Lane B's 100K fan-out then expands these
 * 100 seeds via programmatic variation.
 *
 * For unfamiliar call sites we fall back to a generic shape that just feeds
 * the docs back as a context string.
 */
export function generateSeeds(
  site: CallSiteDescriptor,
  corpus: CorpusDoc[],
  opts: GenerateOptions = {},
): SeedInput[] {
  const count = opts.count ?? 100;
  const rng = mulberry32(opts.prng_seed ?? hashString(site.call_site_id));
  // function_hint is the most stable key (the enclosing function name), with
  // a fallback to file basename when the scanner couldn't infer one.
  const rawKey =
    site.function_hint ??
    path.basename(site.file_path).replace(/\.(ts|tsx|mts|cts|py)$/, "");
  // Templates are keyed in snake_case for readability; main's scanner emits
  // camelCase for TS function names. Try both forms before falling back.
  const key = rawKey;
  const altKey = camelToSnake(rawKey);
  const generator =
    TEMPLATE_BY_CALL_SITE[key] ??
    TEMPLATE_BY_CALL_SITE[altKey] ??
    genericTemplate;
  const seeds: SeedInput[] = [];
  for (let i = 0; i < count; i++) {
    seeds.push({
      call_site_id: site.call_site_id,
      index: i,
      args: generator(rng, corpus, i),
      grounded_in: groundingFor(altKey, corpus).map((d) => d.id),
    });
  }
  return seeds;
}

/* ───── per-call-site templates ────────────────────────────────────────── */

type Template = (rng: () => number, corpus: CorpusDoc[], i: number) => Record<string, unknown>;

const TEMPLATE_BY_CALL_SITE: Record<string, Template> = {
  classify_lead_tier: (rng) => {
    const company = pick(rng, FAKE_COMPANIES);
    const sizeBucket = pick(rng, ["small", "mid", "large"] as const);
    const size = sizeBucket === "small"
      ? Math.floor(rng() * 200)
      : sizeBucket === "mid"
      ? 200 + Math.floor(rng() * 2300)
      : 2500 + Math.floor(rng() * 100000);
    const revenuePerEmployee = 200_000 + Math.floor(rng() * 800_000);
    return { company: company.name, size, revenue: size * revenuePerEmployee };
  },
  extract_invoice_fields: (rng) => {
    const vendor = pick(rng, INVOICE_VENDORS);
    const total = (rng() * 25_000 + 50).toFixed(2);
    const invoiceNumber = `${vendor.prefix}-${2024 + Math.floor(rng() * 3)}-${String(Math.floor(rng() * 10000)).padStart(5, "0")}`;
    const dueOffsetDays = pick(rng, [15, 30, 45, 60]);
    const issuedAt = new Date(Date.now() - Math.floor(rng() * 90) * 86400000);
    const dueAt = new Date(issuedAt.getTime() + dueOffsetDays * 86400000);
    return {
      raw_text: [
        `Vendor: ${vendor.name}`,
        `Invoice ${invoiceNumber}`,
        `Issued: ${issuedAt.toISOString().slice(0, 10)}`,
        `Net ${dueOffsetDays} (due ${dueAt.toISOString().slice(0, 10)})`,
        `Total: ${vendor.currency === "EUR" ? "€" : "$"}${total} ${vendor.currency}`,
      ].join("\n"),
    };
  },
  resolve_company_domain: (rng) => {
    const company = pick(rng, FAKE_COMPANIES);
    return { companyName: company.name };
  },
  summarize_support_thread: (rng, corpus, i) => {
    const ticket = `T-${String(40000 + i).padStart(6, "0")}`;
    const turns = 2 + Math.floor(rng() * 5);
    const messages: { author: string; body: string }[] = [];
    for (let t = 0; t < turns; t++) {
      messages.push({
        author: t % 2 === 0 ? pick(rng, CUSTOMER_NAMES) : pick(rng, AGENT_NAMES),
        body: pick(rng, SUPPORT_TURNS),
      });
    }
    return { threadId: ticket, messages };
  },
  research_competitor: (rng) => {
    const competitor = pick(rng, FAKE_COMPANIES).name;
    const factCount = 1 + Math.floor(rng() * 4);
    const fetchedFacts = Array.from({ length: factCount }, () => pick(rng, COMPETITOR_FACTS));
    return { name: competitor, fetchedFacts };
  },
};

const genericTemplate: Template = (_rng, corpus, i) => ({
  context: corpus[i % Math.max(1, corpus.length)]?.body.slice(0, 500) ?? "",
});

function camelToSnake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}

function groundingFor(key: string, corpus: CorpusDoc[]): CorpusDoc[] {
  const map: Record<string, RegExp> = {
    classify_lead_tier: /lead-tier|sales-tier/,
    classifyLeadTier: /lead-tier|sales-tier/,
    extract_invoice_fields: /invoice/,
    resolve_company_domain: /domain/,
    resolveCompanyDomain: /domain/,
    summarize_support_thread: /support/,
    summarizeSupportThread: /support/,
  };
  const re = map[key];
  return re ? corpus.filter((d) => re.test(d.id)) : corpus;
}

/* ───── document-agent grounded path (live Nia, gated) ─────────────────── */

/**
 * Stage-2 production path: ask the Nia Document Agent to invent seed inputs
 * grounded in the customer's indexed corpus. Costs Nia query budget — the
 * caller decides whether to use it.
 *
 * Schema: each seed is `{ args: <object> }`. The agent fills in args
 * matching the call site's input schema.
 */
export async function generateSeedsViaDocumentAgent(
  client: RealNiaClient,
  site: CallSiteDescriptor,
  source_ids: string[],
  count: number,
): Promise<SeedInput[]> {
  if (source_ids.length === 0) {
    throw new Error("generateSeedsViaDocumentAgent: at least one source_id required");
  }
  const result = await client.documentAgentQuery({
    source_ids,
    query: [
      `Produce ${count} realistic, distinct seed inputs for the LLM call site`,
      `${site.provider} (${site.function_hint ?? "anonymous"}) at ${site.file_path}:${site.line}.`,
      `Ground each seed in concrete entities or scenarios from the indexed`,
      `documents. Match the input distribution implied by the documents — do`,
      `not invent unusual inputs.`,
    ].join(" "),
    json_schema: {
      type: "object",
      required: ["seeds"],
      properties: {
        seeds: {
          type: "array",
          minItems: count,
          maxItems: count,
          items: { type: "object", required: ["args"], properties: { args: { type: "object" } } },
        },
      },
    },
  });
  const out = (result.structured_output as { seeds?: Array<{ args: Record<string, unknown> }> })?.seeds ?? [];
  return out.map((s, i) => ({
    call_site_id: site.call_site_id,
    index: i,
    args: s.args,
    grounded_in: source_ids,
  }));
}

/* ───── small fixtures ─────────────────────────────────────────────────── */

const FAKE_COMPANIES = [
  { name: "Anthem", vertical: "healthcare" },
  { name: "Stripe", vertical: "fintech" },
  { name: "Notion Labs", vertical: "saas" },
  { name: "Coursera", vertical: "edu" },
  { name: "Shopify", vertical: "retail" },
  { name: "Caterpillar", vertical: "manufacturing" },
  { name: "Deloitte", vertical: "professional_services" },
  { name: "USPS", vertical: "public_sector" },
  { name: "Plaid", vertical: "fintech" },
  { name: "Oscar Health", vertical: "healthcare" },
  { name: "Khan Academy", vertical: "edu" },
  { name: "Wayfair", vertical: "retail" },
];

const INVOICE_VENDORS = [
  { name: "Amazon Web Services", prefix: "AWS", currency: "USD" },
  { name: "Snowflake", prefix: "SNFL", currency: "USD" },
  { name: "Notion", prefix: "NTN", currency: "USD" },
  { name: "Sentry", prefix: "STR", currency: "EUR" },
  { name: "Linear", prefix: "LNR", currency: "EUR" },
  { name: "Datadog", prefix: "DD", currency: "USD" },
];

const CUSTOMER_NAMES = ["alex.r", "samira.k", "j.thompson", "noah.b", "linh.t"];
const AGENT_NAMES = ["aanya.k", "marcus.eze", "diego.ortiz", "priya.shah"];
const SUPPORT_TURNS = [
  "The invoice export is failing for the AWS account again.",
  "Sorry to hear that — can you confirm the period you're exporting?",
  "Q1 2026, all of January and February.",
  "Got it — I see the OCR landed on the line-item total, not the grand total. Patching now.",
  "Patched and re-run. The total is correct on the export now.",
  "Thanks, that worked.",
  "Marking this resolved — let me know if it shows up again.",
];
const COMPETITOR_FACTS = [
  "Series C raised in 2024, $80M",
  "Headquartered in Boston with a remote-first policy",
  "Recent product launch: real-time collaboration mode",
  "Pricing dropped 20% in Q4 2025",
  "Switched cloud providers from AWS to GCP last quarter",
];

/* ───── prng + utilities ───────────────────────────────────────────────── */

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function pick<T>(rng: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)]!;
}
