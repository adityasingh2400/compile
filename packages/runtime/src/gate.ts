import { GATE_THRESHOLDS, type Tier, type Trace } from "@compile/schemas";

export interface GateResult {
  verdict: "pass" | "fail";
  match_rate: number;
  tier: Tier;
  reason?: string;
}

/**
 * Tier-aware quality gate (D3).
 *  - tier_1 → JSON-equality match rate ≥ 0.98
 *  - tier_2 → embedding cosine ≥ 0.92 + JSON Schema validation
 *
 * TODO(lane-A): wire to runtime + embedder.
 */
export function gate(_args: {
  tier: Tier;
  emitted_outputs: unknown[];
  holdout: Trace[];
}): GateResult {
  void GATE_THRESHOLDS;
  throw new Error("gate: not implemented");
}
