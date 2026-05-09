import { describe, it, expect } from "vitest";
import {
  LocalFakeTensorlakeClient,
  RealTensorlakeClient,
  TensorlakeWithLocalFallback,
} from "../src/tensorlake.js";

describe("LocalFakeTensorlakeClient", () => {
  it("runEmittedFunction executes emitted code in-process and returns outputs+latency", async () => {
    const client = new LocalFakeTensorlakeClient();
    const code = `export function double(input) { return { x: input.x * 2 }; }`;
    const r = await client.runEmittedFunction({
      code,
      function_name: "double",
      holdout: [
        { input: { x: 1 }, output: { x: 2 }, tool_calls: [] },
        { input: { x: 5 }, output: { x: 10 }, tool_calls: [] },
      ],
    });
    expect(r.outputs).toEqual([{ x: 2 }, { x: 10 }]);
    expect(r.latency_ms).toHaveLength(2);
    expect(r.fallback_invoked).toBe(false);
  });

  it("runEmittedFunction flags fallback_invoked when emitted code calls llmFallback", async () => {
    const client = new LocalFakeTensorlakeClient();
    const code = `
      import { llmFallback } from "./_runtime";
      export function f(input) {
        if (!input.known) return llmFallback(input, "f");
        return { ok: true };
      }
    `;
    const r = await client.runEmittedFunction({
      code,
      function_name: "f",
      holdout: [{ input: { known: false }, output: { ok: true }, tool_calls: [] }],
    });
    expect(r.fallback_invoked).toBe(true);
  });

  it("runPhi delegates to a configured handler (default echoes input)", async () => {
    const client = new LocalFakeTensorlakeClient({
      phiHandler: ({ input }) => ({ phi_says: input }),
    });
    const r = await client.runPhi({ prompt: "p", input: { foo: "bar" } });
    expect(r.output).toEqual({ phi_says: { foo: "bar" } });
    expect(r.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("warm() resolves immediately (no cold start in-process)", async () => {
    const t0 = performance.now();
    await new LocalFakeTensorlakeClient().warm();
    expect(performance.now() - t0).toBeLessThan(50);
  });
});

describe("TensorlakeWithLocalFallback (failure mode #2)", () => {
  it("falls back to local when the real client throws (runEmittedFunction)", async () => {
    const real = new RealTensorlakeClient({
      apiKey: "fake",
      endpoint: "https://example.invalid",
    });
    const fallback = new LocalFakeTensorlakeClient();
    let fallbackMethod: string | null = null;
    const wrapper = new TensorlakeWithLocalFallback(real, fallback, (m) => {
      fallbackMethod = m;
    });
    const code = `export function id(input) { return input; }`;
    const r = await wrapper.runEmittedFunction({
      code,
      function_name: "id",
      holdout: [{ input: 7, output: 7, tool_calls: [] }],
    });
    expect(r.outputs).toEqual([7]);
    expect(wrapper.isFallbackEngaged()).toBe(true);
    expect(fallbackMethod).toBe("runEmittedFunction");
  });

  it("falls back on runPhi failure too", async () => {
    const real = new RealTensorlakeClient({ apiKey: "x", endpoint: "y" });
    const fallback = new LocalFakeTensorlakeClient({
      phiHandler: () => ({ from_local: true }),
    });
    const wrapper = new TensorlakeWithLocalFallback(real, fallback, () => {});
    const r = await wrapper.runPhi({ prompt: "p", input: 1 });
    expect(r.output).toEqual({ from_local: true });
  });

  it("warm() falls back silently — operator script still reports success", async () => {
    const real = new RealTensorlakeClient({ apiKey: "x", endpoint: "y" });
    const fallback = new LocalFakeTensorlakeClient();
    const wrapper = new TensorlakeWithLocalFallback(real, fallback, () => {});
    await expect(wrapper.warm()).resolves.toBeUndefined();
  });

  it("succeeds on primary when primary works (does not engage fallback)", async () => {
    const okPrimary = new LocalFakeTensorlakeClient({
      phiHandler: () => ({ source: "primary" }),
    });
    const fallback = new LocalFakeTensorlakeClient({
      phiHandler: () => ({ source: "fallback" }),
    });
    const wrapper = new TensorlakeWithLocalFallback(okPrimary, fallback, () => {});
    const r = await wrapper.runPhi({ prompt: "p", input: 1 });
    expect(r.output).toEqual({ source: "primary" });
    expect(wrapper.isFallbackEngaged()).toBe(false);
  });
});
