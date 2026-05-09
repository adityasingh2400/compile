import type {
  CallSiteDescriptor,
  ScanReport,
  ResultSummary,
  SyntheticCell,
} from "@compile/schemas";

void ({} as SyntheticCell);

export interface VaultCard {
  kind: "positive" | "negative";
  function_id: string;
  function_name: string;
  tier?: "tier_1" | "tier_2" | "tier_3";
  reason?: string;
  annual_savings_usd?: number;
  holdout_match_rate?: number;
}

/**
 * Pre-baked demo data — calibrated to the Acme repo (10 call sites, 2 green,
 * 3 yellow, 5 red). Shapes match @compile/schemas where they cross the wire;
 * display-only structures (vault cards) live here as locals.
 */

export const DEMO_RUN_ID = "demo_2026_05_09";
export const HERO_CALL_SITE_ID = "ops:classify_ticket_priority";

export const DEMO_FILES: { path: string; hits: number }[] = [
  { path: "src/icp.ts", hits: 5 },
  { path: "src/ops.ts", hits: 5 },
  { path: "src/utils/parse.ts", hits: 0 },
  { path: "src/utils/format.ts", hits: 0 },
  { path: "src/index.ts", hits: 0 },
  { path: "src/router.ts", hits: 0 },
  { path: "package.json", hits: 0 },
  { path: "tsconfig.json", hits: 0 },
  { path: "docs/icp.md", hits: 0 },
  { path: "docs/pricing.md", hits: 0 },
];

const greenPriors = (vol: number) =>
  ({
    schema_stability_prior: 0.92,
    determinism_prior: 0.95,
    economic_value_prior: vol,
    pill: "green" as const,
    signals: {
      has_response_format: true,
      has_zod_schema: true,
      has_temperature_zero: true,
      prompt_template_static: true,
      bounded_tool_array: true,
      tool_count: 0,
      has_few_shot_examples: true,
      followed_by_structured_parse: true,
      has_telemetry: true,
    },
  }) as const;

const yellowPriors = (vol: number) =>
  ({
    schema_stability_prior: 0.71,
    determinism_prior: 0.62,
    economic_value_prior: vol,
    pill: "yellow" as const,
    signals: {
      has_response_format: false,
      has_zod_schema: true,
      has_temperature_zero: true,
      prompt_template_static: true,
      bounded_tool_array: false,
      tool_count: 0,
      has_few_shot_examples: false,
      followed_by_structured_parse: true,
      has_telemetry: false,
    },
  }) as const;

const redPriors = (vol: number) =>
  ({
    schema_stability_prior: 0.34,
    determinism_prior: 0.18,
    economic_value_prior: vol,
    pill: "red" as const,
    signals: {
      has_response_format: false,
      has_zod_schema: false,
      has_temperature_zero: false,
      prompt_template_static: false,
      bounded_tool_array: false,
      tool_count: 0,
      has_few_shot_examples: false,
      followed_by_structured_parse: false,
      has_telemetry: false,
    },
  }) as const;

export const DEMO_CALL_SITES: CallSiteDescriptor[] = [
  // GREEN
  {
    call_site_id: "ops:classify_ticket_priority",
    file_path: "src/ops.ts",
    line: 22,
    column: 4,
    provider: "openai",
    function_hint: "classify_ticket_priority",
    prompt_excerpt: "Classify support ticket priority...",
    priors: greenPriors(0.87),
  },
  {
    call_site_id: "ops:match_product_sku",
    file_path: "src/ops.ts",
    line: 78,
    column: 4,
    provider: "openai",
    function_hint: "match_product_sku",
    prompt_excerpt: "Match SKU from product description...",
    priors: greenPriors(0.74),
  },
  // YELLOW
  {
    call_site_id: "icp:classify_lead_tier",
    file_path: "src/icp.ts",
    line: 22,
    column: 4,
    provider: "anthropic",
    function_hint: "classify_lead_tier",
    prompt_excerpt: "Classify lead tier A/B/C...",
    priors: yellowPriors(0.81),
  },
  {
    call_site_id: "icp:extract_invoice_fields",
    file_path: "src/icp.ts",
    line: 48,
    column: 4,
    provider: "anthropic",
    function_hint: "extract_invoice_fields",
    prompt_excerpt: "Extract invoice_number, total_usd, date...",
    priors: yellowPriors(0.58),
  },
  {
    call_site_id: "ops:classify_sentiment",
    file_path: "src/ops.ts",
    line: 50,
    column: 4,
    provider: "anthropic",
    function_hint: "classify_sentiment",
    prompt_excerpt: "Classify customer sentiment...",
    priors: yellowPriors(0.62),
  },
  // RED
  {
    call_site_id: "icp:resolve_company_domain",
    file_path: "src/icp.ts",
    line: 62,
    column: 4,
    provider: "anthropic",
    function_hint: "resolve_company_domain",
    prompt_excerpt: "Resolve company domain...",
    priors: redPriors(0.41),
  },
  {
    call_site_id: "icp:summarize_support_thread",
    file_path: "src/icp.ts",
    line: 76,
    column: 4,
    provider: "anthropic",
    function_hint: "summarize_support_thread",
    prompt_excerpt: "Summarize support thread...",
    priors: redPriors(0.29),
  },
  {
    call_site_id: "icp:draft_outreach_subject",
    file_path: "src/icp.ts",
    line: 90,
    column: 4,
    provider: "anthropic",
    function_hint: "draft_outreach_subject",
    prompt_excerpt: "Write a punchy outreach subject...",
    priors: redPriors(0.34),
  },
  {
    call_site_id: "ops:generate_marketing_copy",
    file_path: "src/ops.ts",
    line: 70,
    column: 4,
    provider: "anthropic",
    function_hint: "generate_marketing_copy",
    prompt_excerpt: "Write marketing copy for...",
    priors: redPriors(0.24),
  },
  {
    call_site_id: "ops:freeform_chat_handler",
    file_path: "src/ops.ts",
    line: 88,
    column: 4,
    provider: "anthropic",
    function_hint: "freeform_chat_handler",
    prompt_excerpt: "Open-ended chat reply...",
    priors: redPriors(0.18),
  },
];

export const DEMO_SCAN_REPORT: ScanReport = {
  scanned_at: new Date().toISOString(),
  repo_path: "data/folk-agent",
  files_scanned: DEMO_FILES.length,
  call_sites: DEMO_CALL_SITES,
  tree_signature: "a3f2d1bdemo",
};

/** Realistic seed-token candidates for Page 4 — pulled from Acme docs. */
export const DEMO_DOC_TOKENS: string[] = [
  "industry: fintech",
  "employees: 500",
  "region: NA",
  "ARR: $20M",
  "industry: healthcare",
  "employees: 85",
  "tier: enterprise",
  "vertical: SaaS",
  "billing: usage-based",
  "ICP: mid-market",
  "growth: 3x YoY",
  "stage: Series B",
  "industry: edu",
  "employees: 1200",
  "region: EMEA",
  "model: PLG",
  "industry: legal",
  "MRR: $400k",
  "compliance: SOC2",
  "ICP: PMF+",
  "vertical: vertical-AI",
  "TAM: $4B",
  "stage: seed",
  "channel: outbound",
];

/** Hero synthesis output (Page 8). Pre-baked so demo timing is deterministic. */
export const DEMO_AGENT_CODE = `import { z } from "zod";
import { llmFallback } from "@compile/runtime";

/**
 * Generated by Compile from cluster: classify_ticket_priority
 * 7 sub-patterns discovered → 6 Tier-1 branches + 1 Tier-2 fallback
 * Holdout match: 98.7%  ·  Schema-stable: 98.4%  ·  Oracle-agree: 94.6%
 */

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
  // Branch 1 — outage signal on enterprise → always P0
  if (input.has_outage_keywords && input.customer_tier === "enterprise") {
    return { priority: "P0", reason: "outage:enterprise", confidence: 1.0 };
  }

  // Branch 2 — billing keywords + paying tier → P2
  if (/billing|invoice|charge/i.test(input.subject)) {
    return { priority: "P2", reason: "billing:routed", confidence: 0.97 };
  }

  // Branch 3 — auth/login on enterprise → P1
  if (/auth|login|sso/i.test(input.subject)
      && input.customer_tier === "enterprise") {
    return { priority: "P1", reason: "auth:enterprise", confidence: 0.96 };
  }

  // Branch 4 — feature request → P3
  if (/feature request|enhancement|wish/i.test(input.subject)) {
    return { priority: "P3", reason: "feature_request", confidence: 0.94 };
  }

  // Branch 5 — generic question on free tier → P3
  if (input.customer_tier === "free" && !input.has_outage_keywords) {
    return { priority: "P3", reason: "free:generic", confidence: 0.91 };
  }

  // Branch 6 — pro outage → P1
  if (input.has_outage_keywords) {
    return { priority: "P1", reason: "outage:other", confidence: 0.93 };
  }

  // Tier-2 paraphrase fallback for ambiguous mid-market language
  return llmFallback(TicketPrioritySchema, {
    model: "phi-3-mini",
    prompt: \`classify priority for: \${input.subject} :: \${input.body}\`,
  });
}
`;

export const DEMO_RESULT: ResultSummary = {
  run_id: DEMO_RUN_ID,
  files_scanned: 10,
  call_sites_total: 10,
  stage1_green: 2,
  stage1_yellow: 3,
  stage1_red: 5,
  stage2_runs: 5,
  stage2_passes: 4,
  codified_count: 4,
  negative_vault_count: 6,
  projected_annual_savings_usd: 66800,
  sandbox_compute_cost_usd: 52,
  total_synthetic_calls: 500_000,
  wall_time_ms: 91_000,
  emitted_at: new Date().toISOString(),
};

export const DEMO_VAULT_NEW: VaultCard = {
  kind: "positive",
  function_id: "fn_classify_ticket_priority_v1",
  function_name: "classify_ticket_priority",
  tier: "tier_1",
  annual_savings_usd: 31_200,
  holdout_match_rate: 0.987,
};

export const DEMO_VAULT_EXISTING: VaultCard[] = [
  {
    kind: "positive",
    function_id: "fn_match_product_sku_v1",
    function_name: "match_product_sku",
    tier: "tier_1",
    annual_savings_usd: 14_800,
    holdout_match_rate: 0.972,
  },
  {
    kind: "positive",
    function_id: "fn_extract_invoice_fields_v1",
    function_name: "extract_invoice_fields",
    tier: "tier_1",
    annual_savings_usd: 11_400,
    holdout_match_rate: 0.961,
  },
  {
    kind: "positive",
    function_id: "fn_classify_lead_tier_v1",
    function_name: "classify_lead_tier",
    tier: "tier_2",
    annual_savings_usd: 9_400,
    holdout_match_rate: 0.913,
  },
  {
    kind: "negative",
    function_id: "neg_draft_outreach_subject",
    function_name: "draft_outreach_subject",
    reason: "creative_task",
  },
  {
    kind: "negative",
    function_id: "neg_generate_marketing_copy",
    function_name: "generate_marketing_copy",
    reason: "creative_task",
  },
  {
    kind: "negative",
    function_id: "neg_freeform_chat_handler",
    function_name: "freeform_chat_handler",
    reason: "novel_reasoning_required",
  },
];

/** 7 sub-pattern clusters with pre-computed centroids for the hero. */
export interface HeroCluster {
  cluster_id: string;
  centroid: [number, number];
  share: number;
  tier: "tier_1" | "tier_2" | "tier_3";
  label: string;
  color: [number, number, number];
}

export const HERO_CLUSTERS: HeroCluster[] = [
  {
    cluster_id: "c0",
    centroid: [-0.55, 0.4],
    share: 0.28,
    tier: "tier_1",
    label: "outage:enterprise",
    color: [90, 252, 167],
  },
  {
    cluster_id: "c1",
    centroid: [-0.2, -0.45],
    share: 0.18,
    tier: "tier_1",
    label: "billing:routed",
    color: [90, 252, 167],
  },
  {
    cluster_id: "c2",
    centroid: [0.35, 0.3],
    share: 0.16,
    tier: "tier_1",
    label: "auth:enterprise",
    color: [90, 252, 167],
  },
  {
    cluster_id: "c3",
    centroid: [0.6, -0.15],
    share: 0.13,
    tier: "tier_1",
    label: "feature_request",
    color: [90, 252, 167],
  },
  {
    cluster_id: "c4",
    centroid: [0.05, 0.55],
    share: 0.11,
    tier: "tier_1",
    label: "free:generic",
    color: [90, 252, 167],
  },
  {
    cluster_id: "c5",
    centroid: [-0.45, -0.55],
    share: 0.09,
    tier: "tier_1",
    label: "outage:other",
    color: [90, 252, 167],
  },
  {
    cluster_id: "c6",
    centroid: [0.0, -0.05],
    share: 0.05,
    tier: "tier_2",
    label: "ambiguous",
    color: [255, 179, 90],
  },
];
