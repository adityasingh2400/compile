/**
 * Offline smoke test for the vitest-subprocess gate runner.
 * Proves the gate can validate emitted code against a holdout WITHOUT
 * hitting the Anthropic API. Uses a hand-written envelope.
 */
import { describe, it, expect } from "vitest";
import { gate } from "../src/gate.js";
import type { SynthesisSuccess, Trace } from "@compile/schemas";

const code = `
import { llmFallback } from "./_runtime";
export function double(input: { n: number }): { result: number } {
  if (typeof input?.n !== "number") return llmFallback(input, "double") as never;
  return { result: input.n * 2 };
}
`;

const envelope: SynthesisSuccess = {
  synthesizable: true,
  tier: "tier_1",
  confidence: 1,
  function_name: "double",
  description: "doubles a number",
  code,
  tests: "",
  contract: {
    input_schema: { type: "object", properties: { n: { type: "number" } } },
    output_schema: { type: "object", properties: { result: { type: "number" } } },
    preconditions: [],
    doc_dependencies: [],
  },
  fallback_strategy: "frontier_llm",
  estimated_savings_per_call_usd: 0.05,
  reasoning: "trivial deterministic doubler",
};

const holdout: Trace[] = [
  { input: { n: 1 }, output: { result: 2 }, tool_calls: [] },
  { input: { n: 5 }, output: { result: 10 }, tool_calls: [] },
  { input: { n: -3 }, output: { result: -6 }, tool_calls: [] },
];

describe("gate (offline)", () => {
  it("passes a correct deterministic function on the holdout", async () => {
    const verdict = await gate({ envelope, holdout });
    expect(verdict.verdict).toBe("pass");
    expect(verdict.match_rate).toBe(1);
    expect(verdict.run.fallback_invoked).toBe(false);
  }, 60000);

  it("fails when emitted code is wrong", async () => {
    const wrong = { ...envelope, code: code.replace("input.n * 2", "input.n + 1") };
    const verdict = await gate({ envelope: wrong, holdout });
    expect(verdict.verdict).toBe("fail");
    expect(verdict.match_rate).toBeLessThan(0.98);
  }, 60000);
});
