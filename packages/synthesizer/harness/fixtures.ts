import type { Cluster, Trace } from "@compile/schemas";

export interface Fixture {
  name: string;
  expected: {
    synthesizable: boolean;
    tier?: "tier_1" | "tier_2" | "tier_3_only";
    reason?: string;
  };
  cluster: Cluster;
  prompt_template: string;
  tool_schemas: Array<Record<string, unknown>>;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  traces: Trace[];
}

/* ─── Fixture 1: Tier-1 invoice field extraction (50 traces) ───────────── */

function tier1Traces(): Trace[] {
  const samples = [
    { num: "INV-1001", total: "1240.50", date: "2026-04-12" },
    { num: "INV-1002", total: "85.00", date: "2026-04-13" },
    { num: "INV-1003", total: "9999.99", date: "2026-04-14" },
    { num: "INV-1004", total: "12.34", date: "2026-04-15" },
    { num: "INV-1005", total: "500.00", date: "2026-04-16" },
  ];
  const out: Trace[] = [];
  for (let i = 0; i < 50; i++) {
    const s = samples[i % samples.length]!;
    const num = `INV-${1000 + i + 1}`;
    const total = (Math.round((10 + i * 17.13) * 100) / 100).toFixed(2);
    const date = `2026-04-${String((i % 28) + 1).padStart(2, "0")}`;
    out.push({
      input: {
        body: `Invoice ${num}\nDate: ${date}\nTotal: $${total}\nThank you for your business.`,
      },
      output: { invoice_number: num, total_usd: parseFloat(total), date },
      tool_calls: [],
    });
    void s;
  }
  return out;
}

/* ─── Fixture 2: Tier-2 lead qualification — fuzzy boundary (50 traces) ── */

function tier2Traces(): Trace[] {
  const out: Trace[] = [];
  const industries = ["fintech", "healthtech", "retail", "media", "manufacturing"];
  for (let i = 0; i < 50; i++) {
    const employees = 20 + ((i * 13) % 480);
    const industry = industries[i % industries.length]!;
    const fit = employees > 50 && (industry === "fintech" || industry === "healthtech");
    const conf = fit ? 0.7 + (i % 3) * 0.05 : 0.3 + (i % 4) * 0.05;
    out.push({
      input: { domain: `acme${i}.example`, employees, industry },
      output: {
        fit,
        confidence: Math.round(conf * 100) / 100,
        reasoning:
          fit
            ? `${industry} with ${employees} employees fits ICP band`
            : `${industry} with ${employees} employees outside ICP band`,
      },
      tool_calls: [],
    });
  }
  return out;
}

/* ─── Fixture 3: Tier-3 creative — high variance (50 traces) ───────────── */

function tier3Traces(): Trace[] {
  const out: Trace[] = [];
  const tones = ["whimsical", "stoic", "punchy", "literary", "absurdist"];
  for (let i = 0; i < 50; i++) {
    const tone = tones[i % tones.length]!;
    out.push({
      input: { topic: `topic_${i}`, tone },
      output: {
        // Intentionally varied — no schema, no determinism. Should be uncodifiable.
        text: `${tone} riff #${i}: ${"x".repeat((i * 7) % 60 + 5)}`,
      },
      tool_calls: [],
    });
  }
  return out;
}

export const FIXTURES: Fixture[] = [
  {
    name: "tier_1_invoice_extract",
    expected: { synthesizable: true, tier: "tier_1" },
    cluster: {
      cluster_id: "fx-tier1-invoice",
      cluster_signature: "fx-tier1-invoice",
      template_ids: ["fx-tier1-invoice-tpl"],
      trace_count: 50,
      passes_synthesis_gate: true,
      axis_scores: {
        schema_stability: 1.0,
        determinism: 1.0,
        economic_value: {
          monthly_calls: 240_000,
          annual_savings_usd: 144_000,
          break_even_hits: 4,
          synthesis_cost_usd: 1.5,
          maintenance_cost_usd: 50,
        },
      },
    },
    prompt_template:
      "Extract invoice_number, total_usd (number), and date (YYYY-MM-DD) from the email body.",
    tool_schemas: [],
    input_schema: { type: "object", properties: { body: { type: "string" } }, required: ["body"] },
    output_schema: {
      type: "object",
      properties: {
        invoice_number: { type: "string" },
        total_usd: { type: "number" },
        date: { type: "string" },
      },
      required: ["invoice_number", "total_usd", "date"],
    },
    traces: tier1Traces(),
  },
  {
    name: "tier_2_lead_qual",
    expected: { synthesizable: true, tier: "tier_2" },
    cluster: {
      cluster_id: "fx-tier2-leadqual",
      cluster_signature: "fx-tier2-leadqual",
      template_ids: ["fx-tier2-leadqual-tpl"],
      trace_count: 50,
      passes_synthesis_gate: true,
      axis_scores: {
        schema_stability: 0.93,
        determinism: 0.91,
        economic_value: {
          monthly_calls: 90_000,
          annual_savings_usd: 41_000,
          break_even_hits: 12,
          synthesis_cost_usd: 1.5,
          maintenance_cost_usd: 80,
        },
      },
    },
    prompt_template:
      "Decide if this company is a fit for our ICP. Return {fit, confidence, reasoning}.",
    tool_schemas: [],
    input_schema: {
      type: "object",
      properties: {
        domain: { type: "string" },
        employees: { type: "integer" },
        industry: { type: "string" },
      },
      required: ["domain", "employees", "industry"],
    },
    output_schema: {
      type: "object",
      properties: {
        fit: { type: "boolean" },
        confidence: { type: "number" },
        reasoning: { type: "string" },
      },
      required: ["fit", "confidence", "reasoning"],
    },
    traces: tier2Traces(),
  },
  {
    name: "tier_3_creative",
    expected: { synthesizable: false, reason: "creative_task" },
    cluster: {
      cluster_id: "fx-tier3-creative",
      cluster_signature: "fx-tier3-creative",
      template_ids: ["fx-tier3-creative-tpl"],
      trace_count: 50,
      passes_synthesis_gate: false,
      axis_scores: {
        schema_stability: 0.4,
        determinism: 0.2,
        economic_value: {
          monthly_calls: 30_000,
          annual_savings_usd: 0,
          break_even_hits: 0,
          synthesis_cost_usd: 1.5,
          maintenance_cost_usd: 100,
        },
      },
    },
    prompt_template: "Write a short creative riff on the given topic and tone.",
    tool_schemas: [],
    input_schema: {
      type: "object",
      properties: { topic: { type: "string" }, tone: { type: "string" } },
      required: ["topic", "tone"],
    },
    output_schema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
    traces: tier3Traces(),
  },
];
