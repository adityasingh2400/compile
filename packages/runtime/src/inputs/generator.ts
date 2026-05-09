/**
 * Hybrid synthetic input generator (Path B).
 *
 * Powers the D10 identification pipeline's schema_stability and determinism
 * axes by producing N varied inputs per cluster. Pure-fuzz when no real
 * traces exist; mixed perturbation+fuzz when traces are available, so the
 * input distribution matches reality where reality exists.
 *
 * Deliberately NOT used to pad clusters with insufficient_data — D8's
 * negative-cache retry policy says wait for real traces, not invent fakes.
 * Synthetic inputs here only *probe* the LLM for axis scoring; they never
 * become training data sent to the agent.
 */

import type { Trace } from "@compile/schemas";
import { rngFromSeed, type Rng } from "./rng.js";
import { fuzzFromSchema, type JsonSchema } from "./schema-fuzz.js";
import { perturbTrace } from "./trace-perturb.js";

export interface GenerateInputsArgs {
  inputSchema: JsonSchema;
  /** Real traces from the cluster, if any. Inputs only — outputs ignored. */
  traces?: Trace[];
  /** How many synthetic inputs to produce. */
  n: number;
  /** Deterministic seed. Same (schema, traces, n, seed) → same outputs. */
  seed?: number;
  /** Fraction of n drawn by perturbing real traces (vs. pure schema fuzz). */
  perturbFraction?: number;
}

export interface GeneratedInput {
  input: unknown;
  source: "fuzz" | "perturb";
  /** For perturbed inputs, the index of the source trace within `traces`. */
  source_trace_index?: number;
}

export function generateInputs(args: GenerateInputsArgs): GeneratedInput[] {
  const seed = args.seed ?? 42;
  const rng = rngFromSeed(seed);
  const traces = args.traces ?? [];
  const haveTraces = traces.length > 0;
  const perturbFrac = haveTraces ? args.perturbFraction ?? 0.5 : 0;
  const perturbCount = Math.round(args.n * perturbFrac);
  const fuzzCount = args.n - perturbCount;

  const out: GeneratedInput[] = [];
  for (let i = 0; i < perturbCount; i++) {
    const idx = rng.int(0, traces.length - 1);
    const trace = traces[idx];
    if (!trace) continue;
    out.push({
      input: perturbTrace(trace, traces, rng),
      source: "perturb",
      source_trace_index: idx,
    });
  }
  for (let i = 0; i < fuzzCount; i++) {
    out.push({
      input: fuzzFromSchema(args.inputSchema, rng),
      source: "fuzz",
    });
  }
  return out;
}

export type { Rng };
