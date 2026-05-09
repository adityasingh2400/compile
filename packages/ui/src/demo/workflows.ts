/**
 * Three production workflows for the unified-dashboard demo.
 *
 * Each workflow tells the same end-to-end story (audit → cluster →
 * codify → route) but with different shape, cluster layout, and
 * routing distribution so flipping tabs feels meaningfully different.
 *
 * The visual hero of every workflow is the cluster stage: ~1000
 * synthetic API calls cluster semantically into 5–7 sub-patterns,
 * each with explicit defining characteristics. Those clusters then
 * drive parallel codegen (Stage 3) and end up routing 90–95% of
 * production traffic via deterministic functions (Stage 4).
 */

export type Tier = "tier_1" | "tier_2" | "tier_3";

export interface WorkflowCluster {
  id: string;
  label: string;
  /** 2D embedding centroid in [-1, 1] × [-1, 1]. */
  centroid: [number, number];
  /** Fraction of total nodes assigned to this cluster (sums to 1.0). */
  share: number;
  tier: Tier;
  /** RGB tuple — used for node coloring + cluster hull tinting. */
  color: [number, number, number];
  /** Defining input characteristics (rendered around the cluster). */
  characteristics: string[];
  /** The deterministic branch this cluster compiles into. */
  branch_summary: string;
}

export interface Workflow {
  id: string;
  /** Source-code identifier — what shows up in the audit terminal. */
  source_name: string;
  /** Human-friendly tab label. */
  display: string;
  file_path: string;
  prompt_excerpt: string;
  /** Stage 1 audit decision. */
  tier_decision: Tier;
  codifiable: boolean;
  /** Stage 2 sub-patterns — these become deterministic branches. */
  clusters: WorkflowCluster[];
  /** Stage 3 — full generated function source. */
  generated_code: string;
  /** Stage 4 — production routing distribution. */
  vault_pct: number;
  frontier_pct: number;
  /** Theme accent color for tabs/context — distinguishes workflows. */
  accent: string;
  monthly_call_volume: number;
  annual_savings_usd: number;
}

// ── workflow 1 — classify_ticket_priority ─────────────────────────

const TICKET_CLUSTERS: WorkflowCluster[] = [
  {
    id: "tk_outage_ent",
    label: "outage · enterprise",
    centroid: [-0.55, 0.4],
    share: 0.28,
    tier: "tier_1",
    color: [90, 252, 167],
    characteristics: [
      "customer_tier = enterprise",
      "has_outage_keywords = true",
      "subject contains: down|outage|503|timeout",
    ],
    branch_summary: "→ P0  (confidence 1.00)",
  },
  {
    id: "tk_billing",
    label: "billing · routed",
    centroid: [-0.2, -0.45],
    share: 0.18,
    tier: "tier_1",
    color: [90, 252, 167],
    characteristics: [
      "subject ~ /billing|invoice|charge|refund/i",
      "tier ∈ {pro, enterprise}",
    ],
    branch_summary: "→ P2  (confidence 0.97)",
  },
  {
    id: "tk_auth_ent",
    label: "auth · enterprise",
    centroid: [0.35, 0.3],
    share: 0.16,
    tier: "tier_1",
    color: [90, 252, 167],
    characteristics: [
      "subject ~ /auth|login|sso|saml/i",
      "customer_tier = enterprise",
    ],
    branch_summary: "→ P1  (confidence 0.96)",
  },
  {
    id: "tk_feature",
    label: "feature request",
    centroid: [0.6, -0.15],
    share: 0.13,
    tier: "tier_1",
    color: [90, 252, 167],
    characteristics: [
      "subject ~ /feature request|enhancement|wish/i",
    ],
    branch_summary: "→ P3  (confidence 0.94)",
  },
  {
    id: "tk_free_generic",
    label: "free · generic",
    centroid: [0.05, 0.55],
    share: 0.11,
    tier: "tier_1",
    color: [90, 252, 167],
    characteristics: [
      "customer_tier = free",
      "has_outage_keywords = false",
    ],
    branch_summary: "→ P3  (confidence 0.91)",
  },
  {
    id: "tk_outage_other",
    label: "outage · pro/free",
    centroid: [-0.45, -0.55],
    share: 0.09,
    tier: "tier_1",
    color: [90, 252, 167],
    characteristics: [
      "has_outage_keywords = true",
      "customer_tier ∈ {free, pro}",
    ],
    branch_summary: "→ P1  (confidence 0.93)",
  },
  {
    id: "tk_ambiguous",
    label: "ambiguous · mid-market",
    centroid: [0.0, -0.05],
    share: 0.05,
    tier: "tier_2",
    color: [255, 179, 90],
    characteristics: [
      "tone polarity ∈ [-0.3, 0.3]",
      "no strong keyword match",
    ],
    branch_summary: "→ phi-3-mini fallback (paraphrase classifier)",
  },
];

const TICKET_CODE = `import { z } from "zod";
import { llmFallback } from "@compile/runtime";

const TicketPrioritySchema = z.object({
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
});

export async function classify_ticket_priority(input: {
  subject: string;
  body: string;
  customer_tier: "free" | "pro" | "enterprise";
  has_outage_keywords: boolean;
}) {
  if (input.has_outage_keywords && input.customer_tier === "enterprise")
    return { priority: "P0", reason: "outage:enterprise", confidence: 1.0 };
  if (/billing|invoice|charge/i.test(input.subject))
    return { priority: "P2", reason: "billing:routed", confidence: 0.97 };
  if (/auth|login|sso/i.test(input.subject) && input.customer_tier === "enterprise")
    return { priority: "P1", reason: "auth:enterprise", confidence: 0.96 };
  if (/feature request|enhancement|wish/i.test(input.subject))
    return { priority: "P3", reason: "feature_request", confidence: 0.94 };
  if (input.customer_tier === "free" && !input.has_outage_keywords)
    return { priority: "P3", reason: "free:generic", confidence: 0.91 };
  if (input.has_outage_keywords)
    return { priority: "P1", reason: "outage:other", confidence: 0.93 };

  return llmFallback(TicketPrioritySchema, {
    model: "phi-3-mini",
    prompt: \`classify priority for: \${input.subject} :: \${input.body}\`,
  });
}`;

// ── workflow 2 — match_product_sku ────────────────────────────────

const SKU_CLUSTERS: WorkflowCluster[] = [
  {
    id: "sku_exact",
    label: "exact match",
    centroid: [-0.6, 0.0],
    share: 0.42,
    tier: "tier_1",
    color: [122, 223, 255],
    characteristics: [
      "input ∈ canonical_sku_set",
      "edit distance = 0",
    ],
    branch_summary: "→ direct lookup (O(1) hash)",
  },
  {
    id: "sku_fuzzy_brand",
    label: "fuzzy brand",
    centroid: [-0.15, 0.5],
    share: 0.23,
    tier: "tier_1",
    color: [122, 223, 255],
    characteristics: [
      "leading token ∈ known_brands",
      "trailing tokens normalize to size/variant",
    ],
    branch_summary: "→ brand-prefix lookup + variant resolver",
  },
  {
    id: "sku_substring",
    label: "substring",
    centroid: [0.25, -0.25],
    share: 0.16,
    tier: "tier_1",
    color: [122, 223, 255],
    characteristics: [
      "input.length < 12",
      "matches uniqueSubstring(canonical_sku)",
    ],
    branch_summary: "→ trigram index lookup",
  },
  {
    id: "sku_multi_token",
    label: "multi-word phrase",
    centroid: [0.55, 0.35],
    share: 0.11,
    tier: "tier_1",
    color: [122, 223, 255],
    characteristics: [
      "input.split.length ≥ 3",
      "BM25 top-1 score ≥ 0.85",
    ],
    branch_summary: "→ BM25 ranker, top-1",
  },
  {
    id: "sku_ambiguous",
    label: "ambiguous brand",
    centroid: [0.05, -0.55],
    share: 0.08,
    tier: "tier_2",
    color: [255, 179, 90],
    characteristics: [
      "BM25 top-1 score < 0.85",
      "multiple brand candidates",
    ],
    branch_summary: "→ phi-3-mini disambiguator",
  },
];

const SKU_CODE = `import { llmFallback } from "@compile/runtime";
import { canonicalSkus, brandPrefixIndex, trigramIndex, bm25 } from "./sku-index";

export async function match_product_sku(name: string) {
  const norm = name.trim().toLowerCase();

  // 1. exact lookup
  const exact = canonicalSkus.get(norm);
  if (exact) return exact;

  // 2. brand-prefix + variant resolver
  const brand = brandPrefixIndex.firstMatch(norm);
  if (brand && brand.confidence > 0.92)
    return brand.resolve(norm);

  // 3. substring trigram
  if (norm.length < 12) {
    const sub = trigramIndex.lookup(norm);
    if (sub && sub.unique) return sub.sku;
  }

  // 4. BM25 multi-token
  const tokens = norm.split(/\\s+/);
  if (tokens.length >= 3) {
    const top = bm25.top(tokens);
    if (top.score >= 0.85) return top.sku;
  }

  // 5. tier-2 disambiguator for ambiguous brand cases
  return llmFallback(z.string(), {
    model: "phi-3-mini",
    prompt: \`pick the best SKU for: \${name}\`,
  });
}`;

// ── workflow 3 — classify_lead_tier ────────────────────────────────

const LEAD_CLUSTERS: WorkflowCluster[] = [
  {
    id: "lead_ent_signal",
    label: "enterprise · strong signal",
    centroid: [-0.5, 0.5],
    share: 0.22,
    tier: "tier_1",
    color: [180, 141, 255],
    characteristics: [
      "employees ≥ 500",
      "ARR ≥ $20M",
      "industry ∈ regulated_set",
    ],
    branch_summary: "→ enterprise (confidence 0.98)",
  },
  {
    id: "lead_mid",
    label: "mid-market · scaling",
    centroid: [-0.05, 0.2],
    share: 0.27,
    tier: "tier_1",
    color: [180, 141, 255],
    characteristics: [
      "50 ≤ employees < 500",
      "$1M ≤ ARR < $20M",
    ],
    branch_summary: "→ mid-market (confidence 0.94)",
  },
  {
    id: "lead_smb_growth",
    label: "smb · growth",
    centroid: [0.45, -0.1],
    share: 0.21,
    tier: "tier_1",
    color: [180, 141, 255],
    characteristics: [
      "employees < 50",
      "growth_yoy ≥ 2x",
      "stage = seed/series-a",
    ],
    branch_summary: "→ smb (confidence 0.93)",
  },
  {
    id: "lead_regulated",
    label: "regulated industry",
    centroid: [-0.45, -0.4],
    share: 0.13,
    tier: "tier_1",
    color: [180, 141, 255],
    characteristics: [
      "industry ∈ {fintech, healthcare, legal}",
      "compliance flag = true",
    ],
    branch_summary: "→ enterprise (confidence 0.96)",
  },
  {
    id: "lead_no_fit",
    label: "no-fit",
    centroid: [0.6, 0.4],
    share: 0.09,
    tier: "tier_1",
    color: [180, 141, 255],
    characteristics: [
      "industry ∉ icp_industries",
      "size mismatch",
    ],
    branch_summary: "→ no_fit (confidence 0.97)",
  },
  {
    id: "lead_vague",
    label: "vague · ambiguous",
    centroid: [0.1, -0.5],
    share: 0.08,
    tier: "tier_2",
    color: [255, 179, 90],
    characteristics: [
      "missing employee count",
      "ARR not disclosed",
    ],
    branch_summary: "→ phi-3-mini contextual classifier",
  },
];

const LEAD_CODE = `import { z } from "zod";
import { llmFallback } from "@compile/runtime";

const LeadTierSchema = z.object({
  tier: z.enum(["enterprise", "mid_market", "smb", "no_fit"]),
  confidence: z.number().min(0).max(1),
});

const REGULATED = new Set(["fintech", "healthcare", "legal", "insurance"]);
const ICP = new Set([
  "saas", "fintech", "healthcare", "legal", "logistics",
  "ecommerce", "edtech",
]);

export async function classify_lead_tier(input: {
  industry: string;
  employees?: number;
  arr_usd?: number;
  growth_yoy?: number;
  stage?: string;
  compliance?: boolean;
}) {
  if (!ICP.has(input.industry))
    return { tier: "no_fit", confidence: 0.97 };

  if (REGULATED.has(input.industry) && input.compliance)
    return { tier: "enterprise", confidence: 0.96 };

  const emp = input.employees ?? 0;
  const arr = input.arr_usd ?? 0;

  if (emp >= 500 && arr >= 20_000_000)
    return { tier: "enterprise", confidence: 0.98 };

  if (emp >= 50 && arr >= 1_000_000)
    return { tier: "mid_market", confidence: 0.94 };

  if (emp < 50 && (input.growth_yoy ?? 0) >= 2 &&
      ["seed", "series-a"].includes(input.stage ?? ""))
    return { tier: "smb", confidence: 0.93 };

  return llmFallback(LeadTierSchema, {
    model: "phi-3-mini",
    prompt: \`classify lead tier from: \${JSON.stringify(input)}\`,
  });
}`;

// ── exports ────────────────────────────────────────────────────────

export const WORKFLOWS: Workflow[] = [
  {
    id: "classify_ticket",
    source_name: "classify_ticket_priority",
    display: "Ticket Priority",
    file_path: "src/ops.ts:22",
    prompt_excerpt: "Classify support ticket priority. Return JSON.",
    tier_decision: "tier_1",
    codifiable: true,
    clusters: TICKET_CLUSTERS,
    generated_code: TICKET_CODE,
    vault_pct: 0.952,
    frontier_pct: 0.048,
    accent: "#5afca7",
    monthly_call_volume: 252_000,
    annual_savings_usd: 31_200,
  },
  {
    id: "match_sku",
    source_name: "match_product_sku",
    display: "Product SKU Match",
    file_path: "src/ops.ts:78",
    prompt_excerpt: "Match SKU from product description.",
    tier_decision: "tier_1",
    codifiable: true,
    clusters: SKU_CLUSTERS,
    generated_code: SKU_CODE,
    vault_pct: 0.918,
    frontier_pct: 0.082,
    accent: "#7adfff",
    monthly_call_volume: 184_000,
    annual_savings_usd: 22_900,
  },
  {
    id: "classify_lead",
    source_name: "classify_lead_tier",
    display: "Lead Tier",
    file_path: "src/icp.ts:22",
    prompt_excerpt: "Classify lead tier A/B/C.",
    tier_decision: "tier_2",
    codifiable: true,
    clusters: LEAD_CLUSTERS,
    generated_code: LEAD_CODE,
    vault_pct: 0.882,
    frontier_pct: 0.118,
    accent: "#b48dff",
    monthly_call_volume: 96_000,
    annual_savings_usd: 12_700,
  },
];

/** Non-codifiable sites surfaced during audit — for the "negative vault"
 *  read-out. They never get tabs because there's no clustering work. */
export const NON_CODIFIABLE: Array<{
  source_name: string;
  file_path: string;
  reason: string;
  tier: Tier;
}> = [
  { source_name: "draft_outreach_subject", file_path: "src/icp.ts:90", reason: "creative_task", tier: "tier_3" },
  { source_name: "generate_marketing_copy", file_path: "src/ops.ts:70", reason: "creative_task", tier: "tier_3" },
  { source_name: "freeform_chat_handler", file_path: "src/ops.ts:88", reason: "novel_reasoning", tier: "tier_3" },
  { source_name: "summarize_support_thread", file_path: "src/icp.ts:76", reason: "high_variance", tier: "tier_3" },
  { source_name: "resolve_company_domain", file_path: "src/icp.ts:62", reason: "external_io", tier: "tier_3" },
  { source_name: "extract_invoice_fields", file_path: "src/icp.ts:48", reason: "high_variance", tier: "tier_3" },
  { source_name: "classify_sentiment", file_path: "src/ops.ts:50", reason: "low_static_prior", tier: "tier_3" },
];

/** Total annual savings across all 3 codifiable workflows. */
export const TOTAL_ANNUAL_SAVINGS_USD = WORKFLOWS.reduce(
  (n, w) => n + w.annual_savings_usd,
  0,
);

export const TOTAL_MONTHLY_CALLS = WORKFLOWS.reduce(
  (n, w) => n + w.monthly_call_volume,
  0,
);

/** Pick a cluster from a workflow weighted by share — used to assign
 *  synthetic node membership during cluster-stage animation. */
export function pickCluster(workflow: Workflow): WorkflowCluster {
  const r = Math.random();
  let acc = 0;
  for (const c of workflow.clusters) {
    acc += c.share;
    if (r < acc) return c;
  }
  return workflow.clusters[workflow.clusters.length - 1]!;
}
