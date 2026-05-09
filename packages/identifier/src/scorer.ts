import { createHash } from "node:crypto";
import type { AxisScores, Receipt } from "@compile/schemas";

/**
 * Three-axis codifiability scorer (D10). All measurable from receipts alone
 * — no LLM oracle required for schema stability or determinism.
 */

/**
 * Schema stability: infer a JSON Schema from N outputs and measure the
 * fraction that re-validate. Stable shapes => 1.0; varying shapes => low.
 *
 * Implementation: compute a canonical "shape signature" per output (recursive
 * type fingerprint), take the modal signature, score = fraction of outputs
 * whose signature matches the mode. No external schema validator needed —
 * shape equality is exactly what we want for the stability axis.
 */
export function schemaStabilityFromOutputs(outputs: unknown[]): {
  score: number;
  inferred_signature: string;
} {
  if (outputs.length === 0) return { score: 0, inferred_signature: "" };
  const sigs = outputs.map(shapeSignature);
  const counts = new Map<string, number>();
  for (const s of sigs) counts.set(s, (counts.get(s) ?? 0) + 1);
  let mode = "";
  let modeCount = 0;
  for (const [k, v] of counts) {
    if (v > modeCount) {
      mode = k;
      modeCount = v;
    }
  }
  return { score: modeCount / outputs.length, inferred_signature: mode };
}

function shapeSignature(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) {
    if (v.length === 0) return "array<empty>";
    // Use the union of element signatures (sorted) to be order-invariant.
    const inner = Array.from(new Set(v.map(shapeSignature))).sort();
    return `array<${inner.join("|")}>`;
  }
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `obj{${keys.map((k) => `${k}:${shapeSignature(obj[k])}`).join(",")}}`;
  }
  return typeof v;
}

/**
 * Determinism: detect divergence by grouping receipts by canonical input.
 * If multiple receipts share the same input but produce different outputs,
 * the cluster is non-deterministic. No re-running the LLM required.
 *
 * Score: fraction of input-buckets where every receipt produced the same
 * output (by deep-equality of the canonical JSON form).
 */
export function determinismFromReceipts(receipts: Receipt[]): {
  score: number;
  divergent_inputs: number;
  unique_inputs: number;
} {
  const buckets = new Map<string, string[]>(); // inputHash -> outputHashes
  for (const r of receipts) {
    const ih = hashJson(r.input);
    const oh = hashJson(r.output);
    const arr = buckets.get(ih) ?? [];
    arr.push(oh);
    buckets.set(ih, arr);
  }
  let consistent = 0;
  let divergent = 0;
  for (const outs of buckets.values()) {
    const distinct = new Set(outs);
    if (distinct.size === 1) consistent++;
    else divergent++;
  }
  const total = consistent + divergent;
  // Repeated-input coverage: when every input was seen exactly once, we can't
  // measure determinism this way. Fall back to shape-stability of outputs as
  // a proxy in that regime.
  if (total === 0) return { score: 0, divergent_inputs: 0, unique_inputs: 0 };
  if (divergent === 0 && consistent === total && receipts.length === total) {
    // No repeated inputs => no evidence either way. Use output-shape stability.
    const stab = schemaStabilityFromOutputs(receipts.map((r) => r.output));
    return {
      score: stab.score,
      divergent_inputs: 0,
      unique_inputs: total,
    };
  }
  return {
    score: consistent / total,
    divergent_inputs: divergent,
    unique_inputs: total,
  };
}

function hashJson(v: unknown): string {
  const h = createHash("sha1");
  h.update(canonical(v));
  return h.digest("hex");
}

function canonical(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

/**
 * Economic value: volume × per-call cost vs synthesis + maintenance.
 *
 * Inputs:
 *   - monthly_calls: extrapolate from observation window
 *   - per_call_cost_usd: average from receipts (tokens × prices, or use receipt.cost_usd)
 *   - tier_target: tier_1 (~$0.0001/call) or tier_2 (~$0.0005/call)
 *   - synthesis_cost_usd: amortized cost of the synthesis pass (default: $1.50)
 *   - maintenance_cost_usd: annual ($0 for hackathon defaults; configurable)
 */
export interface EconomicValueInputs {
  monthly_calls: number;
  per_call_cost_usd: number;
  target_tier: "tier_1" | "tier_2";
  synthesis_cost_usd?: number;
  maintenance_cost_usd?: number;
}

export const TIER_PER_CALL_COST_USD = {
  tier_1: 0.0001,
  tier_2: 0.0005,
} as const;

export function economicValue(args: EconomicValueInputs): AxisScores["economic_value"] {
  const synth = args.synthesis_cost_usd ?? 1.5;
  const maint = args.maintenance_cost_usd ?? 50;
  const target_cost = TIER_PER_CALL_COST_USD[args.target_tier];
  const annual_calls = args.monthly_calls * 12;
  const annual_savings = annual_calls * (args.per_call_cost_usd - target_cost) - synth - maint;
  const per_call_savings = args.per_call_cost_usd - target_cost;
  const break_even = per_call_savings > 0 ? Math.ceil((synth + maint) / per_call_savings) : Number.POSITIVE_INFINITY;
  return {
    monthly_calls: args.monthly_calls,
    annual_savings_usd: Math.round(annual_savings * 100) / 100,
    break_even_hits: Number.isFinite(break_even) ? break_even : 0,
    synthesis_cost_usd: synth,
    maintenance_cost_usd: maint,
  };
}

export interface ScoreClusterArgs {
  receipts: Receipt[];
  /** Default tier_1 — scorer recommends; synthesizer prompt makes the final call. */
  target_tier?: "tier_1" | "tier_2";
  /** Days of observation; used to extrapolate monthly_calls. Default 2 (the 48h pitch). */
  observation_days?: number;
  synthesis_cost_usd?: number;
  maintenance_cost_usd?: number;
}

export function scoreCluster(args: ScoreClusterArgs): AxisScores {
  const days = args.observation_days ?? 2;
  const monthly_calls = Math.round((args.receipts.length / days) * 30);
  const per_call_cost_usd =
    args.receipts.reduce((s, r) => s + r.cost_usd, 0) / Math.max(1, args.receipts.length);

  const stab = schemaStabilityFromOutputs(args.receipts.map((r) => r.output));
  const det = determinismFromReceipts(args.receipts);
  const ev = economicValue({
    monthly_calls,
    per_call_cost_usd,
    target_tier: args.target_tier ?? "tier_1",
    synthesis_cost_usd: args.synthesis_cost_usd,
    maintenance_cost_usd: args.maintenance_cost_usd,
  });

  return {
    schema_stability: round3(stab.score),
    determinism: round3(det.score),
    economic_value: ev,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
