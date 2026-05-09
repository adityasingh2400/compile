/**
 * Demo cluster fixtures — the 3 hardcoded clusters from the synthesizer
 * harness (ENG_REVIEW.md:99). Each fixture pairs a prompt template with
 * an input schema and (optionally) real traces, so the generator can be
 * exercised end-to-end before real customer data is wired up.
 *
 * Cluster A — ICP-fit Tier-1: deterministic structured classification.
 * Cluster B — ambiguous lead Tier-2: paraphrase-tolerant judgement.
 * Cluster C — novel positioning Tier-3: creative reasoning, uncodifiable.
 */

import type { Trace } from "@compile/schemas";
import type { JsonSchema } from "./schema-fuzz.js";

export interface ClusterFixture {
  cluster_id: string;
  prompt_template: string;
  input_schema: JsonSchema;
  output_schema: JsonSchema;
  traces: Trace[];
  expected_tier: "tier_1" | "tier_2" | "tier_3_only";
}

export const ICP_FIT_FIXTURE: ClusterFixture = {
  cluster_id: "demo:icp_fit",
  expected_tier: "tier_1",
  prompt_template: `You score a sales lead for ICP fit. Output JSON only.

Lead:
  company: {{company}}
  size: {{size}}
  industry: {{industry}}
  signal: {{signal}}

Return: {"icp_fit": "yes" | "no" | "maybe", "confidence": 0.0-1.0, "reason": string}`,
  input_schema: {
    type: "object",
    required: ["company", "size", "industry", "signal"],
    properties: {
      company: { type: "string" },
      size: { type: "string" },
      industry: { type: "string" },
      signal: { type: "string" },
    },
  },
  output_schema: {
    type: "object",
    required: ["icp_fit", "confidence", "reason"],
    properties: {
      icp_fit: { type: "string", enum: ["yes", "no", "maybe"] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reason: { type: "string" },
    },
  },
  traces: [
    {
      input: {
        company: "Acme Robotics",
        size: "120 employees",
        industry: "industrial automation",
        signal: "downloaded our pricing page twice in 3 days",
      },
      output: { icp_fit: "yes", confidence: 0.86, reason: "mid-market industrial buyer with active intent" },
      tool_calls: [],
    },
    {
      input: {
        company: "Tinybox",
        size: "12 employees",
        industry: "consumer mobile",
        signal: "joined our Slack community last week",
      },
      output: { icp_fit: "no", confidence: 0.78, reason: "below size floor and wrong vertical" },
      tool_calls: [],
    },
    {
      input: {
        company: "Globex",
        size: "350 employees",
        industry: "logistics",
        signal: "matched 3 of 5 ICP attributes via enrichment",
      },
      output: { icp_fit: "maybe", confidence: 0.61, reason: "size and vertical fit, but no active signal" },
      tool_calls: [],
    },
  ],
};

export const AMBIGUOUS_LEAD_FIXTURE: ClusterFixture = {
  cluster_id: "demo:ambiguous_lead",
  expected_tier: "tier_2",
  prompt_template: `You triage an inbound lead with mixed signals. Write 2-3 sentences for the AE explaining how to approach. Output JSON only.

Lead:
  company: {{company}}
  industry: {{industry}}
  signal: {{signal}}
  notes: {{notes}}

Return: {"approach": string, "next_step": "discovery_call" | "nurture" | "disqualify", "urgency": 1-5}`,
  input_schema: {
    type: "object",
    required: ["company", "industry", "signal", "notes"],
    properties: {
      company: { type: "string" },
      industry: { type: "string" },
      signal: { type: "string" },
      notes: { type: "string", maxLength: 200 },
    },
  },
  output_schema: {
    type: "object",
    required: ["approach", "next_step", "urgency"],
    properties: {
      approach: { type: "string" },
      next_step: { type: "string", enum: ["discovery_call", "nurture", "disqualify"] },
      urgency: { type: "integer", minimum: 1, maximum: 5 },
    },
  },
  traces: [
    {
      input: {
        company: "Pied Piper",
        industry: "developer tools",
        signal: "abandoned signup at the billing step",
        notes: "second visit this quarter",
      },
      output: {
        approach: "Light-touch nurture; reach out with billing FAQ and a self-serve discount.",
        next_step: "nurture",
        urgency: 2,
      },
      tool_calls: [],
    },
  ],
};

export const NOVEL_POSITIONING_FIXTURE: ClusterFixture = {
  cluster_id: "demo:novel_positioning",
  expected_tier: "tier_3_only",
  prompt_template: `Write a one-paragraph cold-email opening that contrasts our positioning against {{competitor}} for a {{industry}} buyer who cares about {{value_dimension}}. Tone: {{tone}}.`,
  input_schema: {
    type: "object",
    required: ["competitor", "industry", "value_dimension", "tone"],
    properties: {
      competitor: { type: "string" },
      industry: { type: "string" },
      value_dimension: { type: "string" },
      tone: { type: "string", enum: ["confident", "humble", "playful"] },
    },
  },
  output_schema: { type: "string" },
  traces: [],
};

export const DEMO_FIXTURES = [
  ICP_FIT_FIXTURE,
  AMBIGUOUS_LEAD_FIXTURE,
  NOVEL_POSITIONING_FIXTURE,
];
