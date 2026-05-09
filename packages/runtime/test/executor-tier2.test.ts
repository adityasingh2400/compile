import { describe, it, expect } from "vitest";
import { runCodified } from "../src/executor.js";
import { LocalFakeTensorlakeClient } from "../src/tensorlake.js";

describe("runCodified tier_2 routes through Tensorlake.runPhi", () => {
  it("calls runPhi with the envelope's prompt and the input", async () => {
    let captured: { prompt: string; input: unknown } | null = null;
    const tensorlake = new LocalFakeTensorlakeClient({
      phiHandler: (args) => {
        captured = { prompt: args.prompt, input: args.input };
        return { sentiment: "pos" };
      },
    });
    const result = await runCodified({
      function_id: "fn_phi_test",
      function_name: "classify_sentiment",
      code: "Phi prompt: classify the sentiment of {input.text}",
      input: { text: "great product" },
      tier: "tier_2",
      tensorlake,
    });
    expect(result.tier_used).toBe("tier_2");
    expect(result.output).toEqual({ sentiment: "pos" });
    expect(captured!.prompt).toContain("Phi prompt");
    expect(captured!.input).toEqual({ text: "great product" });
  });

  it("throws when tier_2 invoked without a tensorlake client (D1 enforcement)", async () => {
    await expect(
      runCodified({
        function_id: "fn",
        function_name: "f",
        code: "p",
        input: {},
        tier: "tier_2",
      }),
    ).rejects.toThrow(/tier_2 requires a tensorlake client/);
  });

  it("tier_1 still uses the in-process compiler (no tensorlake call)", async () => {
    let phiCalled = false;
    const tensorlake = new LocalFakeTensorlakeClient({
      phiHandler: () => {
        phiCalled = true;
        return null;
      },
    });
    const result = await runCodified({
      function_id: "fn_t1",
      function_name: "double",
      code: `export function double(input) { return { x: input.x * 2 }; }`,
      input: { x: 4 },
      tier: "tier_1",
      tensorlake,
    });
    expect(result.tier_used).toBe("tier_1");
    expect(result.output).toEqual({ x: 8 });
    expect(phiCalled).toBe(false);
  });
});
