import { z } from "zod";
import { AxisScoresSchema } from "./cluster.js";

/**
 * Trace observed from real customer traffic. Train/val/holdout split applied
 * inside the spec; holdout indices are NEVER sent to the agent.
 */
export const TraceSchema = z.object({
  input: z.unknown(),
  output: z.unknown(),
  tool_calls: z.array(z.record(z.unknown())).default([]),
});
export type Trace = z.infer<typeof TraceSchema>;

export const TraceSplitSchema = z.object({
  train: z.array(z.number().int().nonnegative()),
  val: z.array(z.number().int().nonnegative()),
  /** Indices kept private by Compile — not present in the spec sent to the agent. */
  holdout: z.array(z.number().int().nonnegative()),
});

/**
 * Spec returned by compile.request_synthesis() to the customer's agent.
 * The agent runs codegen on its OWN LLM keys against this spec.
 */
export const SynthesisSpecSchema = z.object({
  request_id: z.string(),
  cluster_id: z.string(),
  prompt_template: z.string(),
  tool_schemas: z.array(z.record(z.unknown())).default([]),
  input_schema: z.record(z.unknown()),
  output_schema: z.record(z.unknown()),
  /** train + val traces only. Holdout is withheld for the gate. */
  traces: z.array(TraceSchema),
  trace_split: TraceSplitSchema.pick({ train: true, val: true }),
  holdout_count: z.number().int().nonnegative(),
  axis_scores: AxisScoresSchema,
  customer_docs: z
    .array(
      z.object({
        title: z.string(),
        nia_doc_id: z.string(),
        excerpt: z.string(),
      }),
    )
    .default([]),
});
export type SynthesisSpec = z.infer<typeof SynthesisSpecSchema>;

/* ───── Synthesis envelopes (what the agent emits back) ────────────────── */

export const TierSchema = z.enum(["tier_1", "tier_2", "tier_3_only"]);
export type Tier = z.infer<typeof TierSchema>;

export const SynthesisSuccessSchema = z.object({
  synthesizable: z.literal(true),
  tier: TierSchema,
  confidence: z.number().min(0).max(1),
  function_name: z.string().regex(/^[a-z][a-z0-9_]*$/),
  description: z.string(),
  code: z.string(),
  tests: z.string(),
  contract: z.object({
    input_schema: z.record(z.unknown()),
    output_schema: z.record(z.unknown()),
    preconditions: z.array(z.string()).default([]),
    doc_dependencies: z.array(z.string()).default([]),
  }),
  fallback_strategy: z.enum(["frontier_llm", "tier_2_local_llm", "none"]),
  estimated_savings_per_call_usd: z.number(),
  reasoning: z.string(),
});
export type SynthesisSuccess = z.infer<typeof SynthesisSuccessSchema>;

export const NegativeReasonSchema = z.enum([
  "insufficient_data",
  "high_variance_outputs",
  "creative_task",
  "novel_reasoning_required",
  /** v7: site failed Stage-1 static priors. Expires on code change. */
  "low_static_prior",
]);
export type NegativeReason = z.infer<typeof NegativeReasonSchema>;

export const RetryPolicySchema = z.object({
  type: z.enum(["sticky", "expiring"]),
  retry_when_traces: z.number().int().positive().optional(),
  retry_on_distribution_shift: z.boolean().default(false),
  /** v7: re-evaluate when the call site's git SHA changes. */
  retry_on_code_change: z.boolean().default(false),
});
export type RetryPolicy = z.infer<typeof RetryPolicySchema>;

export const SynthesisNegativeSchema = z.object({
  synthesizable: z.literal(false),
  reason: NegativeReasonSchema,
  recommendation: z.enum(["stay_tier_3", "wait_for_more_traces"]),
  retry_policy: RetryPolicySchema,
  cluster_signature: z.string(),
});
export type SynthesisNegative = z.infer<typeof SynthesisNegativeSchema>;

export const SynthesisEnvelopeSchema = z.discriminatedUnion("synthesizable", [
  SynthesisSuccessSchema,
  SynthesisNegativeSchema,
]);
export type SynthesisEnvelope = z.infer<typeof SynthesisEnvelopeSchema>;

/** Default retry policy by negative reason — see ENG_REVIEW.md D8 (v7 row added). */
export const RETRY_POLICY_BY_REASON: Record<NegativeReason, RetryPolicy> = {
  creative_task: { type: "sticky", retry_on_distribution_shift: false, retry_on_code_change: false },
  novel_reasoning_required: { type: "sticky", retry_on_distribution_shift: false, retry_on_code_change: false },
  high_variance_outputs: { type: "sticky", retry_on_distribution_shift: true, retry_on_code_change: false },
  insufficient_data: {
    type: "expiring",
    retry_when_traces: 30,
    retry_on_distribution_shift: false,
    retry_on_code_change: false,
  },
  low_static_prior: {
    type: "expiring",
    retry_on_distribution_shift: false,
    retry_on_code_change: true,
  },
};

/** Quality gate thresholds (D3, tier-aware). */
export const GATE_THRESHOLDS = {
  tier_1_json_equality: 0.98,
  tier_2_embedding_cosine: 0.92,
} as const;
