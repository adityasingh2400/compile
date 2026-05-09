import { describe, it, expect } from "vitest";
import { runCodified, clearCompileCache } from "../src/executor.js";

const code = `
import { llmFallback } from "./fallback";
export function add_one(input: { n: number }): { result: number } {
  if (typeof input?.n !== "number") return llmFallback(input, "add_one") as never;
  return { result: input.n + 1 };
}
`;

describe("executor", () => {
  it("runs Tier-1 emitted code in <50ms after first call", async () => {
    clearCompileCache();
    await runCodified({
      function_id: "fn_addone_001",
      function_name: "add_one",
      code,
      input: { n: 1 },
      tier: "tier_1",
    });
    const r = await runCodified({
      function_id: "fn_addone_001",
      function_name: "add_one",
      code,
      input: { n: 41 },
      tier: "tier_1",
    });
    expect(r.output).toEqual({ result: 42 });
    expect(r.latency_ms).toBeLessThan(50);
    expect(r.tier_used).toBe("tier_1");
    expect(r.cost_usd).toBeCloseTo(0.0001, 6);
  });
  it("throws if emitted code calls llmFallback at runtime", async () => {
    clearCompileCache();
    await expect(
      runCodified({
        function_id: "fn_addone_002",
        function_name: "add_one",
        code,
        input: { n: "not-a-number" },
        tier: "tier_1",
      }),
    ).rejects.toThrow(/RUNTIME_FALLBACK/);
  });
});
