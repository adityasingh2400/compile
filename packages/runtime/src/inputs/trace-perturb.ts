/**
 * Type-preserving perturbation of real trace inputs. The fuzzer can
 * produce schema-valid junk; perturbation keeps the realistic distribution
 * (shape, vocabulary, value scales) of actual customer traces and only
 * varies fields. Used for the determinism axis where realistic inputs
 * matter — the LLM behaves differently on plausible vs random inputs.
 */

import type { Trace } from "@compile/schemas";
import type { Rng } from "./rng.js";

export interface PerturbOptions {
  /** Probability per leaf field that we'll mutate it. Default 0.3. */
  mutationRate?: number;
}

export function perturbTrace(
  trace: Trace,
  pool: Trace[],
  rng: Rng,
  opts: PerturbOptions = {},
): unknown {
  const rate = opts.mutationRate ?? 0.3;
  return walk(trace.input, pool.map((t) => t.input), rng, rate);
}

function walk(
  value: unknown,
  poolValues: unknown[],
  rng: Rng,
  rate: number,
): unknown {
  if (Array.isArray(value)) {
    const peerArrays = poolValues.filter(Array.isArray) as unknown[][];
    return value.map((v, i) => {
      const peerSlice = peerArrays
        .map((a) => a[i])
        .filter((x) => x !== undefined);
      return walk(v, peerSlice, rng, rate);
    });
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    const peerObjects = poolValues.filter(
      (p): p is Record<string, unknown> => !!p && typeof p === "object" && !Array.isArray(p),
    );
    for (const [k, v] of Object.entries(value)) {
      const peerSlice = peerObjects
        .map((p) => p[k])
        .filter((x) => x !== undefined);
      out[k] = walk(v, peerSlice, rng, rate);
    }
    return out;
  }
  // Leaf: mutate by sampling a peer value of the same type.
  if (!rng.bool(rate)) return value;
  const sameType = poolValues.filter((p) => typeof p === typeof value);
  if (sameType.length === 0) return value;
  return rng.pick(sameType);
}
