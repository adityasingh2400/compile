import { describe, it, expect } from "vitest";
import { gate } from "../src/gate.js";
import {
  LocalFakeTensorlakeClient,
  RealTensorlakeClient,
  TensorlakeWithLocalFallback,
} from "../src/tensorlake.js";
import type { SynthesisSuccess, Trace } from "@compile/schemas";

const code = `
  import { llmFallback } from "./_runtime";
  export function double(input) {
    if (typeof input?.n !== "number") return llmFallback(input, "double");
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
    input_schema: { type: "object" },
    output_schema: { type: "object" },
    preconditions: [],
    doc_dependencies: [],
  },
  fallback_strategy: "frontier_llm",
  estimated_savings_per_call_usd: 0.05,
  reasoning: "trivial",
};

const holdout: Trace[] = [
  { input: { n: 1 }, output: { result: 2 }, tool_calls: [] },
  { input: { n: 5 }, output: { result: 10 }, tool_calls: [] },
  { input: { n: -3 }, output: { result: -6 }, tool_calls: [] },
];

describe("gate via Tensorlake", () => {
  it("executes through tensorlake.runEmittedFunction when client provided", async () => {
    const tensorlake = new LocalFakeTensorlakeClient();
    const verdict = await gate({ envelope, holdout, tensorlake });
    expect(verdict.verdict).toBe("pass");
    expect(verdict.executed_via).toBe("tensorlake");
    expect(verdict.match_rate).toBe(1);
  });

  it("falls back to local executor when the wrapper's primary fails (D6 / failure mode #2)", async () => {
    const real = new RealTensorlakeClient({ apiKey: "x", endpoint: "y" });
    const fallback = new LocalFakeTensorlakeClient();
    const wrapper = new TensorlakeWithLocalFallback(real, fallback, () => {});
    const verdict = await gate({ envelope, holdout, tensorlake: wrapper });
    expect(verdict.verdict).toBe("pass");
    expect(verdict.executed_via).toBe("tensorlake"); // surfaced through wrapper
    expect(wrapper.isFallbackEngaged()).toBe(true);
  });

  it("flags fail when match rate falls below tier_1 threshold (0.98)", async () => {
    const tensorlake = new LocalFakeTensorlakeClient();
    const wrong = { ...envelope, code: code.replace("input.n * 2", "input.n + 1") };
    const verdict = await gate({ envelope: wrong, holdout, tensorlake });
    expect(verdict.verdict).toBe("fail");
    expect(verdict.match_rate).toBeLessThan(0.98);
    expect(verdict.executed_via).toBe("tensorlake");
  });

  it("default path (no tensorlake supplied) still works via local vitest", async () => {
    const verdict = await gate({ envelope, holdout });
    expect(verdict.executed_via).toBe("local_vitest");
    expect(verdict.verdict).toBe("pass");
  }, 60000);
});
