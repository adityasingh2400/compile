import type { Cluster, SynthesisSpec, Trace } from "@compile/schemas";

export interface AssembleSpecArgs {
  request_id: string;
  cluster: Cluster;
  prompt_template: string;
  tool_schemas: Array<Record<string, unknown>>;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  traces: Trace[];
  customer_docs?: SynthesisSpec["customer_docs"];
  /** Fraction kept private for the gate. ENG_REVIEW.md D10 specifies 70/15/15. */
  split?: { train: number; val: number; holdout: number };
}

/**
 * Assemble the spec. Holdout indices are computed but NOT included in the
 * returned spec — Compile keeps them private to gate the agent's submission.
 *
 * TODO(lane-A): wire to identification pipeline output; deterministic shuffle
 * keyed by cluster_id so train/val/holdout is reproducible across calls.
 */
export function assembleSpec(_args: AssembleSpecArgs): SynthesisSpec {
  throw new Error("assembleSpec: not implemented");
}
