/**
 * Workflow data model — the unit the new UI is organized around.
 *
 * One Workflow is one production LLM call site that the audit stage
 * judged "codifiable" (tier_1 or tier_2). Each workflow drives one tab
 * in the workspace, and the tab walks through three pipeline stages:
 *   1. Synthesis & Clustering — generate ~1k synthetic inputs, cluster.
 *   2. Codification — N parallel codegen agents (one per cluster).
 *   3. Production — traffic flow visualization.
 *
 * The data here is hand-tuned for the demo; the shapes are chosen so
 * the same UI would render the same way on real scanner output, since
 * the only fields the visualization depends on are:
 *   - workflow.clusters[i].centroid + share + characteristics
 *   - workflow.synthetic_calls[*] sampling
 *   - workflow.codified_handlers[cluster_id]
 */

export type Tier = "tier_1" | "tier_2" | "tier_3";

export interface SyntheticInputField {
  /** Field name as it appears in the input shape. */
  name: string;
  /** Display type (string / enum / int / bool / text). */
  kind: "enum" | "int" | "bool" | "text" | "string";
  /** For enums and strings, the variation set we sample from. */
  values?: string[];
  /** For ints, the [min, max] range. */
  range?: [number, number];
  /** Short description of why this field is varied. */
  reason: string;
}

export interface SyntheticCallStrategy {
  /** Short headline ("paraphrase", "inject keyword", "permute fields"). */
  name: string;
  /** Reasoning the audit agent emitted for choosing this strategy. */
  rationale: string;
  /** Approximate share of the 1000 inputs this strategy contributes. */
  share: number;
}

export interface ClusterCharacteristic {
  key: string;
  /** Plain-text value or short list summary. */
  value: string;
}

export interface WorkflowCluster {
  cluster_id: string;
  /** Human-readable label ("outage:enterprise", "exact_match"). */
  label: string;
  /** Normalized centroid in [-1, 1]² space (canvas-relative). */
  centroid: [number, number];
  /** Fraction of the 1000 visible nodes this cluster gets. */
  share: number;
  tier: Tier;
  /** Color [r, g, b] 0..255 — drives node + halo. */
  color: [number, number, number];
  /** What makes a node belong to this cluster — shown as the halo info card. */
  characteristics: ClusterCharacteristic[];
  /** Generated TS code (or fallback declaration). Used in the codification page. */
  codified_handler: string;
  /** Display name of the codified handler function. */
  handler_name: string;
  /** Annual savings attributed to this cluster's branch. */
  annual_savings_usd: number;
}

export interface WorkflowProductionStats {
  /** Calls per minute in production at steady state. */
  calls_per_minute: number;
  /** Fraction of calls served by the codified vault path (0..1). */
  vault_share: number;
  /** Fraction of calls served by the frontier LLM fallback path (0..1). */
  frontier_share: number;
  /** Median ms latency for the vault path. */
  vault_latency_ms: number;
  /** Median ms latency for the frontier path. */
  frontier_latency_ms: number;
  /** $ saved per minute compared to all-frontier baseline. */
  dollars_saved_per_minute: number;
  /** Annualized savings projection. */
  annual_savings_usd: number;
}

export interface Workflow {
  id: string;
  /** Filename the call site was discovered in. */
  file_path: string;
  /** AST locator from the scanner ("ops:classify_ticket_priority"). */
  call_site_id: string;
  /** Snake-case function name as it appears in code. */
  function_name: string;
  /** Display name (shown on tab pill). */
  display_name: string;
  /** One-line description of what this workflow does. */
  description: string;
  tier: Tier;
  /** Provider this workflow was talking to in production. */
  provider: "openai" | "anthropic" | "google";
  /** Excerpt of the prompt the call site was using — shown in audit + synthesis. */
  prompt_excerpt: string;
  /** Monthly call volume estimate from the scanner. */
  monthly_calls: number;
  /** Per-call cost on the original frontier model (USD). */
  per_call_cost_usd: number;
  /** Synthetic input shape — fields the codifier varies. */
  input_fields: SyntheticInputField[];
  /** Synthetic call strategies the audit chose. */
  synthetic_strategies: SyntheticCallStrategy[];
  /** Total visible nodes we render on the clustering canvas (≤2000 for fps). */
  visible_node_count: number;
  /** Narrative call count (e.g. 100,000) — what the agent actually ran. */
  narrative_call_count: number;
  /** Sub-pattern clusters discovered after clustering. */
  clusters: WorkflowCluster[];
  /** Per-workflow production stats once codified. */
  production: WorkflowProductionStats;
}

// ─────────────────────────────────────────────────────────────────────
// LEGACY hand-tuned fixtures — retained as a fallback only.
// `WORKFLOWS` / `CODIFIABLE_WORKFLOWS` / `AUDIT_CALL_SITES` below are
// derived from real proxy traces via `derive-workflows.ts`. These
// constants are kept so tests + the demo can still render with no
// trace input.

const FALLBACK_TICKET_PRIORITY: Workflow = {
  id: "wf_ticket_priority",
  file_path: "src/ops.ts",
  call_site_id: "ops:classify_ticket_priority",
  function_name: "classify_ticket_priority",
  display_name: "Ticket Priority",
  description: "support ticket → P0/P1/P2/P3 priority + reason",
  tier: "tier_1",
  provider: "openai",
  prompt_excerpt:
    "Classify the priority of this support ticket. Return JSON {priority, reason, confidence}.",
  monthly_calls: 252_000,
  per_call_cost_usd: 0.012,
  input_fields: [
    {
      name: "subject",
      kind: "text",
      reason: "free-text user subject line — the most variable field",
    },
    {
      name: "body",
      kind: "text",
      reason: "ticket body, paraphrased across 18 templates",
    },
    {
      name: "customer_tier",
      kind: "enum",
      values: ["free", "pro", "enterprise"],
      reason: "drives priority bias: enterprise outages always P0",
    },
    {
      name: "has_outage_keywords",
      kind: "bool",
      reason: "regex prior on outage/down/timeout keyword set",
    },
  ],
  synthetic_strategies: [
    {
      name: "paraphrase template",
      rationale:
        "18 hand-curated subject templates × 6 paraphrases each = 108 variants",
      share: 0.35,
    },
    {
      name: "permute customer_tier × keyword",
      rationale: "12-way crossing of customer_tier × outage keyword presence",
      share: 0.3,
    },
    {
      name: "fuzz body adversarial",
      rationale:
        "Inject domain-specific jargon, typos, and emoji to test fragility",
      share: 0.2,
    },
    {
      name: "doc-grounded ICP variants",
      rationale: "Pulls real customer-tier hints from icp.md + pricing.md",
      share: 0.15,
    },
  ],
  visible_node_count: 1000,
  narrative_call_count: 100_000,
  clusters: [
    {
      cluster_id: "tp_c0",
      label: "outage:enterprise",
      centroid: [-0.55, 0.4],
      share: 0.28,
      tier: "tier_1",
      color: [90, 252, 167],
      characteristics: [
        { key: "keywords", value: "outage, downtime, 502, timeout" },
        { key: "tier", value: "enterprise" },
        { key: "→ output", value: "P0 · outage:enterprise" },
      ],
      handler_name: "handle_outage_enterprise",
      codified_handler: `// cluster: outage:enterprise → P0
export const handle_outage_enterprise = (input: TicketInput) => {
  if (input.has_outage_keywords && input.customer_tier === "enterprise") {
    return { priority: "P0", reason: "outage:enterprise", confidence: 1.0 };
  }
  return null;
};`,
      annual_savings_usd: 9_400,
    },
    {
      cluster_id: "tp_c1",
      label: "billing:routed",
      centroid: [-0.2, -0.45],
      share: 0.18,
      tier: "tier_1",
      color: [90, 252, 167],
      characteristics: [
        { key: "keywords", value: "billing, invoice, charge, refund" },
        { key: "tier", value: "any" },
        { key: "→ output", value: "P2 · billing:routed" },
      ],
      handler_name: "handle_billing",
      codified_handler: `// cluster: billing → P2
export const handle_billing = (input: TicketInput) => {
  if (/billing|invoice|charge|refund/i.test(input.subject)) {
    return { priority: "P2", reason: "billing:routed", confidence: 0.97 };
  }
  return null;
};`,
      annual_savings_usd: 6_100,
    },
    {
      cluster_id: "tp_c2",
      label: "auth:enterprise",
      centroid: [0.35, 0.3],
      share: 0.16,
      tier: "tier_1",
      color: [90, 252, 167],
      characteristics: [
        { key: "keywords", value: "auth, login, sso, 2fa" },
        { key: "tier", value: "enterprise" },
        { key: "→ output", value: "P1 · auth:enterprise" },
      ],
      handler_name: "handle_auth_enterprise",
      codified_handler: `// cluster: auth on enterprise → P1
export const handle_auth_enterprise = (input: TicketInput) => {
  if (/auth|login|sso|2fa/i.test(input.subject) &&
      input.customer_tier === "enterprise") {
    return { priority: "P1", reason: "auth:enterprise", confidence: 0.96 };
  }
  return null;
};`,
      annual_savings_usd: 5_300,
    },
    {
      cluster_id: "tp_c3",
      label: "feature_request",
      centroid: [0.6, -0.15],
      share: 0.13,
      tier: "tier_1",
      color: [90, 252, 167],
      characteristics: [
        { key: "keywords", value: "feature request, enhancement, wish" },
        { key: "tier", value: "any" },
        { key: "→ output", value: "P3 · feature_request" },
      ],
      handler_name: "handle_feature_request",
      codified_handler: `// cluster: feature request → P3
export const handle_feature_request = (input: TicketInput) => {
  if (/feature request|enhancement|wish/i.test(input.subject)) {
    return { priority: "P3", reason: "feature_request", confidence: 0.94 };
  }
  return null;
};`,
      annual_savings_usd: 4_400,
    },
    {
      cluster_id: "tp_c4",
      label: "free:generic",
      centroid: [0.05, 0.55],
      share: 0.11,
      tier: "tier_1",
      color: [90, 252, 167],
      characteristics: [
        { key: "tier", value: "free" },
        { key: "outage_keywords", value: "false" },
        { key: "→ output", value: "P3 · free:generic" },
      ],
      handler_name: "handle_free_generic",
      codified_handler: `// cluster: free tier generic question → P3
export const handle_free_generic = (input: TicketInput) => {
  if (input.customer_tier === "free" && !input.has_outage_keywords) {
    return { priority: "P3", reason: "free:generic", confidence: 0.91 };
  }
  return null;
};`,
      annual_savings_usd: 3_200,
    },
    {
      cluster_id: "tp_c5",
      label: "outage:other",
      centroid: [-0.45, -0.55],
      share: 0.09,
      tier: "tier_1",
      color: [90, 252, 167],
      characteristics: [
        { key: "outage_keywords", value: "true" },
        { key: "tier", value: "free | pro" },
        { key: "→ output", value: "P1 · outage:other" },
      ],
      handler_name: "handle_outage_other",
      codified_handler: `// cluster: outage on non-enterprise → P1
export const handle_outage_other = (input: TicketInput) => {
  if (input.has_outage_keywords) {
    return { priority: "P1", reason: "outage:other", confidence: 0.93 };
  }
  return null;
};`,
      annual_savings_usd: 2_400,
    },
    {
      cluster_id: "tp_c6",
      label: "ambiguous",
      centroid: [0.0, -0.05],
      share: 0.05,
      tier: "tier_2",
      color: [255, 179, 90],
      characteristics: [
        { key: "schema_stability", value: "0.62 — low" },
        { key: "fallback_to", value: "phi-3-mini" },
        { key: "oracle_agreement", value: "0.88" },
      ],
      handler_name: "fallback_phi_classifier",
      codified_handler: `// tier-2 fallback: ambiguous mid-market language
export const fallback_phi_classifier = (input: TicketInput) =>
  llmFallback(TicketPrioritySchema, {
    model: "phi-3-mini",
    prompt: \`classify priority for: \${input.subject} :: \${input.body}\`,
  });`,
      annual_savings_usd: 1_300,
    },
  ],
  production: {
    calls_per_minute: 350,
    vault_share: 0.95,
    frontier_share: 0.05,
    vault_latency_ms: 0.6,
    frontier_latency_ms: 1180,
    dollars_saved_per_minute: 4.0,
    annual_savings_usd: 32_100,
  },
};

// ─────────────────────────────────────────────────────────────────────
// 2) match_product_sku — tier-1, narrower domain, more deterministic.

const FALLBACK_MATCH_SKU: Workflow = {
  id: "wf_match_sku",
  file_path: "src/ops.ts",
  call_site_id: "ops:match_product_sku",
  function_name: "match_product_sku",
  display_name: "SKU Matcher",
  description: "freeform product description → canonical SKU + variant",
  tier: "tier_1",
  provider: "openai",
  prompt_excerpt:
    "Match the product description to a canonical SKU. Return {sku, variant, confidence}.",
  monthly_calls: 178_000,
  per_call_cost_usd: 0.008,
  input_fields: [
    {
      name: "description",
      kind: "text",
      reason: "user-typed product description, biased noisy",
    },
    {
      name: "category_hint",
      kind: "enum",
      values: ["apparel", "electronics", "homeware", "beauty", "outdoor"],
      reason: "category narrows the catalog lookup",
    },
    {
      name: "color_hint",
      kind: "string",
      values: ["red", "navy", "olive", "natural", "mint", "indigo"],
      reason: "common color words explicitly present",
    },
    {
      name: "size_hint",
      kind: "enum",
      values: ["XS", "S", "M", "L", "XL", "n/a"],
      reason: "size attribute when described",
    },
  ],
  synthetic_strategies: [
    {
      name: "catalog template paraphrase",
      rationale: "240 catalog entries × 4 phrasings = 960 variants",
      share: 0.4,
    },
    {
      name: "color/size permutation",
      rationale: "Cross color × size against high-volume parents",
      share: 0.25,
    },
    {
      name: "alias resolution",
      rationale: "Bake known nicknames + slang from support tickets",
      share: 0.2,
    },
    {
      name: "adversarial typos",
      rationale: "Common misspellings + leetspeak",
      share: 0.15,
    },
  ],
  visible_node_count: 1000,
  narrative_call_count: 100_000,
  clusters: [
    {
      cluster_id: "sk_c0",
      label: "exact_match",
      centroid: [-0.5, 0.05],
      share: 0.34,
      tier: "tier_1",
      color: [122, 223, 255],
      characteristics: [
        { key: "match", value: "string == catalog row" },
        { key: "confidence", value: "≥ 0.99" },
        { key: "→ output", value: "lookup canonical SKU" },
      ],
      handler_name: "handle_exact_match",
      codified_handler: `// cluster: exact catalog hit
export const handle_exact_match = (input: SkuInput) => {
  const exact = CATALOG_INDEX.get(normalize(input.description));
  if (exact) return { sku: exact.sku, variant: null, confidence: 0.999 };
  return null;
};`,
      annual_savings_usd: 7_800,
    },
    {
      cluster_id: "sk_c1",
      label: "size_variant",
      centroid: [0.15, 0.45],
      share: 0.22,
      tier: "tier_1",
      color: [122, 223, 255],
      characteristics: [
        { key: "match", value: "parent + size attribute" },
        { key: "fields", value: "size_hint set or 'XS|S|M|L|XL' regex" },
        { key: "→ output", value: "{sku, variant: size}" },
      ],
      handler_name: "handle_size_variant",
      codified_handler: `// cluster: parent + size variant
export const handle_size_variant = (input: SkuInput) => {
  const parent = findParentSku(input.description);
  const size = input.size_hint ?? extractSize(input.description);
  if (parent && size) {
    return { sku: parent.sku, variant: { size }, confidence: 0.97 };
  }
  return null;
};`,
      annual_savings_usd: 4_900,
    },
    {
      cluster_id: "sk_c2",
      label: "color_variant",
      centroid: [0.55, -0.15],
      share: 0.18,
      tier: "tier_1",
      color: [122, 223, 255],
      characteristics: [
        { key: "match", value: "parent + color attribute" },
        { key: "fields", value: "color_hint or known color palette" },
        { key: "→ output", value: "{sku, variant: color}" },
      ],
      handler_name: "handle_color_variant",
      codified_handler: `// cluster: parent + color variant
export const handle_color_variant = (input: SkuInput) => {
  const parent = findParentSku(input.description);
  const color = input.color_hint ?? extractColor(input.description);
  if (parent && color) {
    return { sku: parent.sku, variant: { color }, confidence: 0.96 };
  }
  return null;
};`,
      annual_savings_usd: 3_600,
    },
    {
      cluster_id: "sk_c3",
      label: "bundle_lookup",
      centroid: [-0.15, -0.5],
      share: 0.12,
      tier: "tier_1",
      color: [122, 223, 255],
      characteristics: [
        { key: "match", value: "multi-item description" },
        { key: "keywords", value: "kit, bundle, set, pack" },
        { key: "→ output", value: "match BUNDLES table" },
      ],
      handler_name: "handle_bundle_lookup",
      codified_handler: `// cluster: bundle / kit
export const handle_bundle_lookup = (input: SkuInput) => {
  if (/kit|bundle|set|pack/i.test(input.description)) {
    const bundle = BUNDLES.find((b) => b.matches(input.description));
    if (bundle) return { sku: bundle.sku, variant: null, confidence: 0.94 };
  }
  return null;
};`,
      annual_savings_usd: 2_500,
    },
    {
      cluster_id: "sk_c4",
      label: "alias_resolution",
      centroid: [-0.6, -0.45],
      share: 0.08,
      tier: "tier_1",
      color: [122, 223, 255],
      characteristics: [
        { key: "match", value: "alias / nickname table" },
        { key: "examples", value: "'red dress' → APR-DRESS-RED" },
        { key: "→ output", value: "alias[input.description]" },
      ],
      handler_name: "handle_alias_resolution",
      codified_handler: `// cluster: known alias / nickname
export const handle_alias_resolution = (input: SkuInput) => {
  const alias = ALIAS_MAP[normalize(input.description)];
  if (alias) return { sku: alias.sku, variant: alias.variant, confidence: 0.92 };
  return null;
};`,
      annual_savings_usd: 1_500,
    },
    {
      cluster_id: "sk_c5",
      label: "ambiguous",
      centroid: [0.4, 0.4],
      share: 0.06,
      tier: "tier_2",
      color: [255, 179, 90],
      characteristics: [
        { key: "schema_stability", value: "0.71" },
        { key: "fallback_to", value: "phi-3-mini" },
        { key: "oracle_agreement", value: "0.91" },
      ],
      handler_name: "fallback_phi_sku",
      codified_handler: `// tier-2 fallback: novel descriptions
export const fallback_phi_sku = (input: SkuInput) =>
  llmFallback(SkuMatchSchema, {
    model: "phi-3-mini",
    prompt: \`match SKU: \${input.description} :: hint=\${input.category_hint}\`,
  });`,
      annual_savings_usd: 800,
    },
  ],
  production: {
    calls_per_minute: 246,
    vault_share: 0.94,
    frontier_share: 0.06,
    vault_latency_ms: 0.4,
    frontier_latency_ms: 940,
    dollars_saved_per_minute: 1.9,
    annual_savings_usd: 21_100,
  },
};

// ─────────────────────────────────────────────────────────────────────
// 3) classify_lead_tier — tier-2 (yellow). Demonstrates the T2 path
//    where most clusters are codified but the long tail still routes
//    to phi.

const FALLBACK_LEAD_TIER: Workflow = {
  id: "wf_lead_tier",
  file_path: "src/icp.ts",
  call_site_id: "icp:classify_lead_tier",
  function_name: "classify_lead_tier",
  display_name: "Lead Tier",
  description: "company signal → A/B/C tier + reason",
  tier: "tier_2",
  provider: "anthropic",
  prompt_excerpt:
    "Score this lead A/B/C based on the ICP. Return {tier, reason, confidence}.",
  monthly_calls: 86_000,
  per_call_cost_usd: 0.018,
  input_fields: [
    {
      name: "industry",
      kind: "string",
      values: [
        "fintech",
        "healthcare",
        "edu",
        "legal",
        "logistics",
        "saas",
      ],
      reason: "ICP-aligned industries cluster together by signal density",
    },
    {
      name: "employees",
      kind: "int",
      range: [10, 8000],
      reason: "size buckets the deterministic branch",
    },
    {
      name: "ARR",
      kind: "string",
      values: ["$2M", "$8M", "$20M", "$60M", "$150M", "n/a"],
      reason: "revenue, when present, dominates classification",
    },
    {
      name: "signal",
      kind: "enum",
      values: [
        "outbound_reply",
        "demo_booked",
        "trial_signed",
        "pmf_growth",
        "noise",
      ],
      reason: "intent signal correlates with tier upgrade",
    },
    {
      name: "region",
      kind: "enum",
      values: ["NA", "EMEA", "APAC", "LATAM"],
      reason: "region correlates with conversion bias",
    },
  ],
  synthetic_strategies: [
    {
      name: "industry × size grid",
      rationale: "6 industries × 5 size buckets × 3 ARR ranges = 90 cells",
      share: 0.35,
    },
    {
      name: "signal-led upgrade test",
      rationale:
        "fix industry+size, vary signal — checks signal monotonicity in scoring",
      share: 0.25,
    },
    {
      name: "ICP doc grounding",
      rationale:
        "Pulls actual customer profile rows from icp.md + competitive.md",
      share: 0.25,
    },
    {
      name: "edge-case companies",
      rationale: "Negative-vault carve-outs (PE-owned, gov, .edu)",
      share: 0.15,
    },
  ],
  visible_node_count: 1000,
  narrative_call_count: 100_000,
  clusters: [
    {
      cluster_id: "lt_c0",
      label: "enterprise_signal",
      centroid: [-0.55, 0.4],
      share: 0.25,
      tier: "tier_1",
      color: [180, 141, 255],
      characteristics: [
        { key: "employees", value: "≥ 1000" },
        { key: "ARR", value: "≥ $50M" },
        { key: "→ output", value: "tier: A · enterprise_signal" },
      ],
      handler_name: "handle_enterprise_signal",
      codified_handler: `// cluster: large enterprise → A
export const handle_enterprise_signal = (input: LeadInput) => {
  if (input.employees >= 1000 && parseArr(input.ARR) >= 50_000_000) {
    return { tier: "A", reason: "enterprise_signal", confidence: 0.98 };
  }
  return null;
};`,
      annual_savings_usd: 4_300,
    },
    {
      cluster_id: "lt_c1",
      label: "pmf_growth",
      centroid: [-0.15, -0.45],
      share: 0.2,
      tier: "tier_1",
      color: [180, 141, 255],
      characteristics: [
        { key: "signal", value: "pmf_growth" },
        { key: "employees", value: "200..1000" },
        { key: "→ output", value: "tier: A · pmf_growth" },
      ],
      handler_name: "handle_pmf_growth",
      codified_handler: `// cluster: PMF + growing → A
export const handle_pmf_growth = (input: LeadInput) => {
  if (input.signal === "pmf_growth" &&
      input.employees >= 200 && input.employees < 1000) {
    return { tier: "A", reason: "pmf_growth", confidence: 0.95 };
  }
  return null;
};`,
      annual_savings_usd: 3_400,
    },
    {
      cluster_id: "lt_c2",
      label: "mid_market",
      centroid: [0.45, 0.25],
      share: 0.22,
      tier: "tier_1",
      color: [180, 141, 255],
      characteristics: [
        { key: "employees", value: "100..500" },
        { key: "ARR", value: "$5M..$30M" },
        { key: "→ output", value: "tier: B · mid_market" },
      ],
      handler_name: "handle_mid_market",
      codified_handler: `// cluster: mid-market → B
export const handle_mid_market = (input: LeadInput) => {
  const arr = parseArr(input.ARR);
  if (input.employees >= 100 && input.employees < 500 &&
      arr >= 5_000_000 && arr < 30_000_000) {
    return { tier: "B", reason: "mid_market", confidence: 0.92 };
  }
  return null;
};`,
      annual_savings_usd: 2_800,
    },
    {
      cluster_id: "lt_c3",
      label: "smb",
      centroid: [0.55, -0.35],
      share: 0.18,
      tier: "tier_1",
      color: [180, 141, 255],
      characteristics: [
        { key: "employees", value: "20..100" },
        { key: "signal", value: "trial_signed | demo_booked" },
        { key: "→ output", value: "tier: C · smb" },
      ],
      handler_name: "handle_smb",
      codified_handler: `// cluster: SMB → C
export const handle_smb = (input: LeadInput) => {
  if (input.employees >= 20 && input.employees < 100 &&
      (input.signal === "trial_signed" || input.signal === "demo_booked")) {
    return { tier: "C", reason: "smb", confidence: 0.9 };
  }
  return null;
};`,
      annual_savings_usd: 1_900,
    },
    {
      cluster_id: "lt_c4",
      label: "pre_pmf",
      centroid: [-0.4, -0.6],
      share: 0.1,
      tier: "tier_1",
      color: [180, 141, 255],
      characteristics: [
        { key: "employees", value: "< 20" },
        { key: "ARR", value: "< $2M" },
        { key: "→ output", value: "tier: C · pre_pmf" },
      ],
      handler_name: "handle_pre_pmf",
      codified_handler: `// cluster: pre-PMF → C
export const handle_pre_pmf = (input: LeadInput) => {
  if (input.employees < 20 && parseArr(input.ARR) < 2_000_000) {
    return { tier: "C", reason: "pre_pmf", confidence: 0.88 };
  }
  return null;
};`,
      annual_savings_usd: 900,
    },
    {
      cluster_id: "lt_c5",
      label: "ambiguous",
      centroid: [0.05, 0.55],
      share: 0.05,
      tier: "tier_2",
      color: [255, 179, 90],
      characteristics: [
        { key: "schema_stability", value: "0.65" },
        { key: "fallback_to", value: "phi-3-mini" },
        { key: "oracle_agreement", value: "0.86" },
      ],
      handler_name: "fallback_phi_lead",
      codified_handler: `// tier-2 fallback: ambiguous lead language
export const fallback_phi_lead = (input: LeadInput) =>
  llmFallback(LeadTierSchema, {
    model: "phi-3-mini",
    prompt: \`score this lead: \${JSON.stringify(input)}\`,
  });`,
      annual_savings_usd: 700,
    },
  ],
  production: {
    calls_per_minute: 119,
    vault_share: 0.92,
    frontier_share: 0.08,
    vault_latency_ms: 0.7,
    frontier_latency_ms: 1320,
    dollars_saved_per_minute: 1.4,
    annual_savings_usd: 14_000,
  },
};

/**
 * The audit-stage call-site list. Includes both codifiable and rejected
 * sites so the audit visually demonstrates the *filter*, not just the
 * survivors. Negative entries cite a "reason" from the negative vault.
 */
export interface AuditCallSite {
  call_site_id: string;
  function_hint: string;
  file_path: string;
  line: number;
  /** Tier or "negative" when the audit decides the workflow is uncodifiable. */
  outcome: Tier | "negative";
  monthly_calls: number;
  reason: string;
  /** Workflow id when outcome is tier_1/tier_2. */
  workflow_id?: string;
}

const FALLBACK_WORKFLOWS: Workflow[] = [
  FALLBACK_TICKET_PRIORITY,
  FALLBACK_MATCH_SKU,
  FALLBACK_LEAD_TIER,
];

const FALLBACK_AUDIT_CALL_SITES: AuditCallSite[] = [
  {
    call_site_id: FALLBACK_TICKET_PRIORITY.call_site_id,
    function_hint: FALLBACK_TICKET_PRIORITY.function_name,
    file_path: FALLBACK_TICKET_PRIORITY.file_path,
    line: 22,
    outcome: "tier_1",
    monthly_calls: FALLBACK_TICKET_PRIORITY.monthly_calls,
    reason:
      "static prompt · zod schema · temperature 0 · followed by structured parse",
    workflow_id: FALLBACK_TICKET_PRIORITY.id,
  },
  {
    call_site_id: FALLBACK_MATCH_SKU.call_site_id,
    function_hint: FALLBACK_MATCH_SKU.function_name,
    file_path: FALLBACK_MATCH_SKU.file_path,
    line: 78,
    outcome: "tier_1",
    monthly_calls: FALLBACK_MATCH_SKU.monthly_calls,
    reason: "deterministic catalog lookup · 4-field input · response_format",
    workflow_id: FALLBACK_MATCH_SKU.id,
  },
  {
    call_site_id: FALLBACK_LEAD_TIER.call_site_id,
    function_hint: FALLBACK_LEAD_TIER.function_name,
    file_path: FALLBACK_LEAD_TIER.file_path,
    line: 22,
    outcome: "tier_2",
    monthly_calls: FALLBACK_LEAD_TIER.monthly_calls,
    reason:
      "stable schema · soft determinism · phi-3-mini covers the long tail",
    workflow_id: FALLBACK_LEAD_TIER.id,
  },
];

// Resolve real workflows from proxy-traces.jsonl. Falls back to the
// hand-tuned constants above when the trace file is missing/empty.
import { deriveAll } from "./derive-workflows.js";

const DERIVED = deriveAll();

export const WORKFLOWS: Workflow[] =
  DERIVED.workflows.length > 0 ? DERIVED.workflows : FALLBACK_WORKFLOWS;

export const AUDIT_CALL_SITES: AuditCallSite[] =
  DERIVED.auditCallSites.length > 0
    ? DERIVED.auditCallSites
    : FALLBACK_AUDIT_CALL_SITES;

/** Codifiable workflows (the survivors of the audit). One tab per. */
export const CODIFIABLE_WORKFLOWS: Workflow[] = WORKFLOWS;

/** Identifies whether the data came from real proxy traces or the fallback. */
export const WORKFLOW_DATA_SOURCE: "live" | "fallback" =
  DERIVED.workflows.length > 0 ? DERIVED.source : "fallback";

/** Aggregate stats — surfaced in the audit + workspace chrome. */
export const OBSERVED_SPEND_24H: number = DERIVED.observedSpend24h;
export const TRACE_COUNT: number = DERIVED.traceCount;
export const OBSERVED_SITE_COUNT: number = DERIVED.siteCount;
/** Production-scale assumption (proxy-sample inverse). */
export const SCALE_FACTOR: number = DERIVED.scaleFactor;
export const SCALE_SAMPLE_RATE_PCT: string = DERIVED.scaleSampleRatePct;
export const SCALED_ANNUAL_SPEND_USD: number = DERIVED.scaledAnnualSpendUsd;
/** Repo namespace + path derived from the first observed call_site_hash.
 *  Adapts the audit chrome when the underlying corpus changes (acme → folk). */
export const REPO_NAMESPACE: string = DERIVED.namespace;
export const REPO_PATH: string = DERIVED.repoPath;

/** Convenience accessor used by every page. */
export function getWorkflowById(id: string): Workflow | undefined {
  return WORKFLOWS.find((w) => w.id === id);
}

/** Total annual savings across all codified workflows. */
export function totalAnnualSavings(): number {
  return WORKFLOWS.reduce((acc, w) => acc + w.production.annual_savings_usd, 0);
}
