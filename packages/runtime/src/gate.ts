import {
  GATE_THRESHOLDS,
  type SynthesisSuccess,
  type Tier,
  type Trace,
} from "@compile/schemas";
import { runHoldout, type HoldoutRunResult } from "./vitest-runner.js";
import type { ITensorlakeClient, RunEmittedFunctionResult } from "./tensorlake.js";

export interface GateInput {
  envelope: SynthesisSuccess;
  holdout: Trace[];
  /**
   * When provided, the emitted code runs in Tensorlake (D1: real sandbox).
   * Caller passes a TensorlakeWithLocalFallback so a sandbox outage drops
   * to in-process execution instead of crashing the gate (failure mode #2).
   * When omitted, the gate uses the historical local vitest path — kept so
   * unit tests don't need a Tensorlake handle.
   */
  tensorlake?: ITensorlakeClient;
}

export interface GateVerdict {
  verdict: "pass" | "fail";
  tier: Tier;
  match_rate: number;
  threshold: number;
  failure_reason?: string;
  run: HoldoutRunResult;
  /** "tensorlake" if executed via runEmittedFunction; "local_vitest" otherwise. */
  executed_via: "tensorlake" | "local_vitest";
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
      executed_via: "local_vitest",
    };
  }
  const threshold =
    tier === "tier_1"
      ? GATE_THRESHOLDS.tier_1_json_equality
      : GATE_THRESHOLDS.tier_2_embedding_cosine;
  const matcher: "json_equality" | "embedding_cosine_stub" =
    tier === "tier_1" ? "json_equality" : "embedding_cosine_stub";

  const { run, executed_via } = input.tensorlake
    ? await runViaTensorlake(input, matcher)
    : await runViaLocalVitest(input, matcher);

  if (run.total === 0) {
    return {
      verdict: "fail",
      tier,
      match_rate: 0,
      threshold,
      failure_reason: "no holdout traces evaluated (empty holdout or runner crashed)",
      run,
      executed_via,
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
      executed_via,
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
    executed_via,
  };
}

async function runViaLocalVitest(
  input: GateInput,
  matcher: "json_equality" | "embedding_cosine_stub",
): Promise<{ run: HoldoutRunResult; executed_via: "local_vitest" }> {
  const run = await runHoldout({
    code: input.envelope.code,
    function_name: input.envelope.function_name,
    emitted_tests: input.envelope.tests,
    holdout: input.holdout,
    matcher,
  });
  return { run, executed_via: "local_vitest" };
}

async function runViaTensorlake(
  input: GateInput,
  matcher: "json_equality" | "embedding_cosine_stub",
): Promise<{ run: HoldoutRunResult; executed_via: "tensorlake" }> {
  const tensorlake = input.tensorlake!;
  const result: RunEmittedFunctionResult = await tensorlake.runEmittedFunction({
    code: input.envelope.code,
    function_name: input.envelope.function_name,
    holdout: input.holdout,
  });
  let passed = 0;
  const failures: HoldoutRunResult["failures"] = [];
  for (let i = 0; i < input.holdout.length; i++) {
    const expected = input.holdout[i]!.output;
    const got = result.outputs[i];
    const ok = match(got, expected, matcher);
    if (ok) passed++;
    else
      failures.push({
        index: i,
        reason: `expected ${truncate(expected)} got ${truncate(got)}`,
      });
  }
  const total = input.holdout.length;
  const run: HoldoutRunResult = {
    match_rate: total === 0 ? 0 : passed / total,
    total,
    passed,
    failures,
    fallback_invoked: result.fallback_invoked,
  };
  return { run, executed_via: "tensorlake" };
}

function match(
  a: unknown,
  b: unknown,
  matcher: "json_equality" | "embedding_cosine_stub",
): boolean {
  if (matcher === "json_equality") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  // Tier-2 cosine matcher — same normalized-string compare the vitest harness
  // uses; real embedding cosine swaps in via derisk #4 / #9.
  const norm = (v: unknown) =>
    JSON.stringify(v ?? null)
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  return norm(a) === norm(b);
}

function truncate(v: unknown): string {
  return JSON.stringify(v ?? null).slice(0, 80);
}
