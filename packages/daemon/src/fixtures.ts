/**
 * Pre-baked synthesis envelopes per Acme call-site hash.
 *
 * These represent what a customer's agent would return from
 * compile.submit_synthesis() during the demo. Stub here keeps the
 * autonomous daemon loop deterministic without reaching out to an
 * external LLM (which would flake live and cost ~30s per fire).
 *
 * Each envelope conforms to the SubmitSynthesisInput shape — the
 * existing validateEnvelope + Vault writer accept it as-is.
 */

export type FixtureEnvelope = {
  function_name: string;
  language: "typescript";
  source: string;
  tests: string;
  contract: {
    schema_stability: number;
    determinism: number;
    oracle_agreement: number;
    cluster_count: number;
  };
};

const FIXTURES: Record<string, FixtureEnvelope> = {
  "acme:classify_ticket_priority:v1": {
    function_name: "classifyTicketPriority",
    language: "typescript",
    source: `import { z } from "zod";

export const Output = z.object({
  priority: z.enum(["low", "medium", "high", "urgent"]),
  category: z.enum(["billing", "technical", "account", "feature_request", "other"]),
});

const RULES: Array<[RegExp, z.infer<typeof Output>]> = [
  [/refund|charged twice|double charge|billing/i, { priority: "medium", category: "billing" }],
  [/down|outage|cannot access|broken|crash/i,    { priority: "urgent", category: "technical" }],
  [/password reset|locked out|2fa/i,              { priority: "high",   category: "account" }],
  [/feature request|would be nice/i,              { priority: "low",    category: "feature_request" }],
];

export function classifyTicketPriority(text: string): z.infer<typeof Output> {
  for (const [re, out] of RULES) if (re.test(text)) return out;
  return { priority: "low", category: "other" };
}`,
    tests: `import { describe, it, expect } from "vitest";
import { classifyTicketPriority } from "./fn.js";

describe("classifyTicketPriority", () => {
  it("billing", () => {
    expect(classifyTicketPriority("Need refund for double charge")).toEqual({ priority: "medium", category: "billing" });
  });
  it("urgent technical", () => {
    expect(classifyTicketPriority("Site is down")).toEqual({ priority: "urgent", category: "technical" });
  });
});`,
    contract: { schema_stability: 0.984, determinism: 0.991, oracle_agreement: 0.946, cluster_count: 5 },
  },

  "acme:classify_sentiment:v1": {
    function_name: "classifySentiment",
    language: "typescript",
    source: `import { z } from "zod";

export const Output = z.object({
  sentiment: z.enum(["positive", "negative", "neutral"]),
  confidence: z.number(),
});

const NEG = /churn|hate|terrible|broken|not.*kept up|cancel|refund/i;
const POS = /love|great|excellent|amazing|best/i;

export function classifySentiment(text: string): z.infer<typeof Output> {
  if (NEG.test(text)) return { sentiment: "negative", confidence: 0.87 };
  if (POS.test(text)) return { sentiment: "positive", confidence: 0.91 };
  return { sentiment: "neutral", confidence: 0.72 };
}`,
    tests: `import { describe, it, expect } from "vitest";
import { classifySentiment } from "./fn.js";

describe("classifySentiment", () => {
  it("negative", () => {
    expect(classifySentiment("we're churning, broken")).toEqual({ sentiment: "negative", confidence: 0.87 });
  });
});`,
    contract: { schema_stability: 0.972, determinism: 0.988, oracle_agreement: 0.931, cluster_count: 3 },
  },

  "acme:match_product_sku:v1": {
    function_name: "matchProductSku",
    language: "typescript",
    source: `import { z } from "zod";

export const Output = z.object({
  sku: z.string(),
  match_confidence: z.number(),
});

const CATALOG: Array<[RegExp, string, number]> = [
  [/27.?inch.*5k.*matte/i,  "SKU-215D90", 0.91],
  [/27.?inch.*5k/i,          "SKU-215D89", 0.87],
  [/14.?inch.*pro/i,         "SKU-302M14", 0.93],
  [/keyboard.*mechanical/i,  "SKU-451KB7", 0.85],
];

export function matchProductSku(query: string): z.infer<typeof Output> {
  for (const [re, sku, conf] of CATALOG) if (re.test(query)) return { sku, match_confidence: conf };
  return { sku: "SKU-UNKNOWN", match_confidence: 0.40 };
}`,
    tests: `import { describe, it, expect } from "vitest";
import { matchProductSku } from "./fn.js";

describe("matchProductSku", () => {
  it("matches matte 5k", () => {
    expect(matchProductSku("27 inch 5k display matte").sku).toBe("SKU-215D90");
  });
});`,
    contract: { schema_stability: 0.964, determinism: 0.998, oracle_agreement: 0.918, cluster_count: 4 },
  },

  "acme:classify_lead_tier:v1": {
    function_name: "classifyLeadTier",
    language: "typescript",
    source: `import { z } from "zod";
export const Output = z.object({ tier: z.enum(["A","B","C"]), score: z.number() });
export function classifyLeadTier(profile: { employees: number; industry: string }): z.infer<typeof Output> {
  if (profile.employees >= 250 && /fintech|saas/i.test(profile.industry)) return { tier: "A", score: 0.94 };
  if (profile.employees >= 50)  return { tier: "B", score: 0.78 };
  return { tier: "C", score: 0.55 };
}`,
    tests: `import { describe, it, expect } from "vitest";
import { classifyLeadTier } from "./fn.js";
describe("classifyLeadTier", () => { it("tier A", () => { expect(classifyLeadTier({ employees: 500, industry: "fintech" }).tier).toBe("A"); }); });`,
    contract: { schema_stability: 0.978, determinism: 0.996, oracle_agreement: 0.952, cluster_count: 3 },
  },

  "acme:extract_invoice_fields:v1": {
    function_name: "extractInvoiceFields",
    language: "typescript",
    source: `import { z } from "zod";
export const Output = z.object({ total_usd: z.number(), invoice_id: z.string(), due_date: z.string() });
export function extractInvoiceFields(doc: string): z.infer<typeof Output> {
  const total = Number((doc.match(/\\$([0-9]+\\.[0-9]{2})/) ?? [,"0"])[1]);
  const id = (doc.match(/INV-([0-9A-Z]+)/) ?? [,"UNKNOWN"])[1] ?? "UNKNOWN";
  const date = (doc.match(/due (\\d{4}-\\d{2}-\\d{2})/i) ?? [,"1970-01-01"])[1] ?? "1970-01-01";
  return { total_usd: total, invoice_id: \`INV-\${id}\`, due_date: date };
}`,
    tests: `import { describe, it, expect } from "vitest"; import { extractInvoiceFields } from "./fn.js";
describe("extractInvoiceFields", () => { it("parses", () => { expect(extractInvoiceFields("Total $42.50 INV-AB12 due 2026-06-01").total_usd).toBe(42.5); }); });`,
    contract: { schema_stability: 0.988, determinism: 0.999, oracle_agreement: 0.961, cluster_count: 2 },
  },
};

/**
 * Look up a fixture envelope, or return a synthetic generic one when the
 * call-site is one we didn't pre-bake. Keeps the daemon honest for
 * unexpected Acme bucket fires.
 */
export function lookupFixture(callSiteHash: string): FixtureEnvelope {
  const hit = FIXTURES[callSiteHash];
  if (hit) return hit;
  return {
    function_name: "compiledFunction",
    language: "typescript",
    source: `export function compiledFunction(input: unknown): unknown { return input; }`,
    tests: `import { describe, it, expect } from "vitest"; import { compiledFunction } from "./fn.js";
describe("compiledFunction", () => { it("identity", () => { expect(compiledFunction(1)).toBe(1); }); });`,
    contract: { schema_stability: 0.95, determinism: 0.99, oracle_agreement: 0.93, cluster_count: 3 },
  };
}
