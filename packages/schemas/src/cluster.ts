import { z } from "zod";

/**
 * The 3-axis codifiability rubric (D10). Replaces LLM-vibes tier classification.
 *  - schema_stability: structural, no LLM oracle needed
 *  - determinism:      self-consistency check (re-run K traces)
 *  - economic_value:   break-even formula
 */
export const AxisScoresSchema = z.object({
  schema_stability: z.number().min(0).max(1),
  determinism: z.number().min(0).max(1),
  economic_value: z.object({
    monthly_calls: z.number().int().nonnegative(),
    annual_savings_usd: z.number(),
    break_even_hits: z.number().int().nonnegative(),
    synthesis_cost_usd: z.number().nonnegative(),
    maintenance_cost_usd: z.number().nonnegative(),
  }),
});
export type AxisScores = z.infer<typeof AxisScoresSchema>;

/**
 * A semantically equivalent group of templates, keyed by Nia centroid.
 * Output of the embed/cluster stage.
 */
export const ClusterSchema = z.object({
  cluster_id: z.string(),
  cluster_signature: z.string(),
  template_ids: z.array(z.string()),
  trace_count: z.number().int().nonnegative(),
  centroid: z.array(z.number()).optional(),
  axis_scores: AxisScoresSchema.optional(),
  passes_synthesis_gate: z.boolean().default(false),
});
export type Cluster = z.infer<typeof ClusterSchema>;

/** Threshold constants shared across identification + synthesis. */
export const AXIS_THRESHOLDS = {
  schema_stability: 0.95,
  determinism: 0.95,
} as const;
