import type { Cluster, SynthesisSpec, Trace } from "@compile/schemas";
import { splitIndices } from "./split.js";

export interface AssembleSpecArgs {
  request_id: string;
  cluster: Cluster;
  prompt_template: string;
  tool_schemas: Array<Record<string, unknown>>;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
  /** ALL traces; assemble splits 70/15/15 deterministically by cluster_id. */
  traces: Trace[];
  customer_docs?: SynthesisSpec["customer_docs"];
}

export interface AssembleSpecResult {
  /** Spec sent to the agent. Holdout indices are NOT included. */
  spec: SynthesisSpec;
  /** Holdout traces — Compile keeps these private to gate the submission. */
  holdout_traces: Trace[];
}

export function assembleSpec(args: AssembleSpecArgs): AssembleSpecResult {
  if (!args.cluster.axis_scores) {
    throw new Error(
      `assembleSpec: cluster ${args.cluster.cluster_id} has no axis_scores; identification pipeline must score before synthesis`,
    );
  }
  const split = splitIndices(args.traces.length, args.cluster.cluster_id);
  const trainTraces = split.train.map((i) => args.traces[i]!);
  const valTraces = split.val.map((i) => args.traces[i]!);
  const holdoutTraces = split.holdout.map((i) => args.traces[i]!);

  const spec: SynthesisSpec = {
    request_id: args.request_id,
    cluster_id: args.cluster.cluster_id,
    prompt_template: args.prompt_template,
    tool_schemas: args.tool_schemas,
    input_schema: args.input_schema,
    output_schema: args.output_schema,
    traces: [...trainTraces, ...valTraces],
    trace_split: {
      train: trainTraces.map((_, i) => i),
      val: valTraces.map((_, i) => i + trainTraces.length),
    },
    holdout_count: holdoutTraces.length,
    axis_scores: args.cluster.axis_scores,
    customer_docs: args.customer_docs ?? [],
  };

  return { spec, holdout_traces: holdoutTraces };
}
