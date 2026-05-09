import { z } from "zod";
import { ReceiptSchema } from "./receipt.js";
import { ClusterSchema, AxisScoresSchema } from "./cluster.js";
import {
  SynthesisSpecSchema,
  SynthesisEnvelopeSchema,
} from "./synthesis.js";
import { VaultLookupResultSchema } from "./vault.js";

/**
 * I/O schemas for the 7 MCP tools (DESIGN.md lines 109–119).
 * Every published tool MUST validate input/output against the schema below.
 */

/* 1. compile.observe_call(receipt) */
export const ObserveCallInput = ReceiptSchema;
export const ObserveCallOutput = z.object({
  ok: z.literal(true),
  receipt_id: z.string(),
});

/* 2. compile.find_function(description) */
export const FindFunctionInput = z.object({
  description: z.string(),
  prompt: z.string().optional(),
  tool_schemas: z.array(z.record(z.unknown())).optional(),
});
export const FindFunctionOutput = VaultLookupResultSchema;

/* 3. compile.run_codified(function_id, input) */
export const RunCodifiedInput = z.object({
  function_id: z.string(),
  input: z.unknown(),
});
export const RunCodifiedOutput = z.object({
  output: z.unknown(),
  tier_used: z.enum(["tier_1", "tier_2"]),
  latency_ms: z.number().nonnegative(),
  cost_usd: z.number().nonnegative(),
});

/* 4. compile.list_codify_candidates() */
export const ListCandidatesInput = z.object({
  limit: z.number().int().positive().max(100).default(20),
});
export const ListCandidatesOutput = z.object({
  candidates: z.array(
    ClusterSchema.extend({
      projected_annual_savings_usd: z.number(),
      sample_prompt: z.string(),
    }),
  ),
});

/* 5. compile.request_synthesis(cluster_id) */
export const RequestSynthesisInput = z.object({
  cluster_id: z.string(),
});
export const RequestSynthesisOutput = SynthesisSpecSchema;

/* 6. compile.submit_synthesis(request_id, envelope) */
export const SubmitSynthesisInput = z.object({
  request_id: z.string(),
  envelope: SynthesisEnvelopeSchema,
});
export const SubmitSynthesisOutput = z.object({
  gate_verdict: z.enum(["pass", "fail"]),
  function_id: z.string().optional(),
  holdout_match_rate: z.number().min(0).max(1).optional(),
  failure_reason: z.string().optional(),
  savings_estimate_usd_annual: z.number().optional(),
});

/* 7. compile.estimate_savings(cluster_id, monthly_vol) */
export const EstimateSavingsInput = z.object({
  cluster_id: z.string(),
  monthly_volume: z.number().int().positive().optional(),
});
export const EstimateSavingsOutput = z.object({
  axis_scores: AxisScoresSchema,
  per_call_savings_usd: z.object({
    tier_1: z.number(),
    tier_2: z.number(),
  }),
  annual_savings_usd: z.number(),
  break_even_hits: z.number().int().nonnegative(),
});

/** Single source of truth for the MCP tool registry. */
export const MCP_TOOLS = {
  "compile.observe_call": {
    input: ObserveCallInput,
    output: ObserveCallOutput,
  },
  "compile.find_function": {
    input: FindFunctionInput,
    output: FindFunctionOutput,
  },
  "compile.run_codified": {
    input: RunCodifiedInput,
    output: RunCodifiedOutput,
  },
  "compile.list_codify_candidates": {
    input: ListCandidatesInput,
    output: ListCandidatesOutput,
  },
  "compile.request_synthesis": {
    input: RequestSynthesisInput,
    output: RequestSynthesisOutput,
  },
  "compile.submit_synthesis": {
    input: SubmitSynthesisInput,
    output: SubmitSynthesisOutput,
  },
  "compile.estimate_savings": {
    input: EstimateSavingsInput,
    output: EstimateSavingsOutput,
  },
} as const;

export type McpToolName = keyof typeof MCP_TOOLS;
