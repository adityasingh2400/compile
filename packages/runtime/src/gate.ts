import {
  GATE_THRESHOLDS,
  type SynthesisSuccess,
  type Tier,
  type Trace,
} from "@compile/schemas";
import { runHoldout, type HoldoutRunResult } from "./vitest-runner.js";

export interface GateInput {
  envelope: SynthesisSuccess;
  holdout: Trace[];
}

export interface GateVerdict {
  verdict: "pass" | "fail";
  tier: Tier;
  match_rate: number;
  threshold: number;
  failure_reason?: string;
  run: HoldoutRunResult;
}

/**
 * Tier-aware quality gate (D3).
 *  - tier_1 → JSON-equality match rate ≥ 0.98
 *  - tier_2 → embedding cosine ≥ 0.92 (stubbed to normalized-string compare;
 *             real cosine arrives via derisk #4)
 *  - tier_3_only → never gated; should not reach here.
 */
export async function gate(input: GateInput): Promise<GateVerdict> {
  const tier = input.envelope.tier;
  if (tier === "tier_3_only") {
    return {
      verdict: "fail",
      tier,
      match_rate: 0,
      threshold: 0,
      failure_reason: "envelope is tier_3_only — should not have been submitted",
      run: { match_rate: 0, total: 0, passed: 0, failures: [], fallback_invoked: false },
    };
  }
  const matcher = tier === "tier_1" ? "json_equality" : "embedding_cosine_stub";
  const threshold =
    tier === "tier_1"
      ? GATE_THRESHOLDS.tier_1_json_equality
      : GATE_THRESHOLDS.tier_2_embedding_cosine;

  const run = await runHoldout({
    code: input.envelope.code,
    function_name: input.envelope.function_name,
    emitted_tests: input.envelope.tests,
    holdout: input.holdout,
    matcher,
  });

  if (run.total === 0) {
    return {
      verdict: "fail",
      tier,
      match_rate: 0,
      threshold,
      failure_reason: "no holdout traces evaluated (empty holdout or runner crashed)",
      run,
    };
  }
  if (run.fallback_invoked) {
    return {
      verdict: "fail",
      tier,
      match_rate: run.match_rate,
      threshold,
      failure_reason: "emitted code called llmFallback on the holdout — uncovered branch",
      run,
    };
  }
  const verdict = run.match_rate >= threshold ? "pass" : "fail";
  return {
    verdict,
    tier,
    match_rate: run.match_rate,
    threshold,
    failure_reason:
      verdict === "fail"
        ? `match rate ${run.match_rate.toFixed(3)} below threshold ${threshold}`
        : undefined,
    run,
  };
}
