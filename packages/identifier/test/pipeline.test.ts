import { describe, it, expect } from "vitest";
import { runPipeline } from "../src/pipeline.js";
import type { Receipt } from "@compile/schemas";

function makeReceipts(): Receipt[] {
  // 30 high-quality "extract invoice id" receipts (T1 candidate)
  const tier1 = Array.from({ length: 30 }, (_, i) => ({
    call_id: `t1_${i}`,
    timestamp: new Date().toISOString(),
    agent_id: "test",
    prompt: `Extract invoice id from email "INV-${1000 + i}"`,
    tool_schemas: [],
    input: { body: `INV-${1000 + i}` },
    output: { id: `INV-${1000 + i}` },
    tokens_in: 50,
    tokens_out: 10,
    cost_usd: 0.04,
    latency_ms: 300,
    model: "frontier",
  }));
  // 10 creative-writing receipts (negative candidate — divergent shapes)
  const t3 = Array.from({ length: 10 }, (_, i) => ({
    call_id: `t3_${i}`,
    timestamp: new Date().toISOString(),
    agent_id: "test",
    prompt: `Write a short poem about "topic_${i}"`,
    tool_schemas: [],
    input: { topic: `topic_${i}` },
    output:
      i % 2 === 0
        ? { text: "x".repeat(i + 5) }
        : { lines: ["a", "b", "c".repeat(i)] },
    tokens_in: 80,
    tokens_out: 200,
    cost_usd: 0.07,
    latency_ms: 1200,
    model: "frontier",
  }));
  return [...tier1, ...t3];
}

describe("runPipeline", () => {
  it("ranks the high-stability cluster above the low-stability one", () => {
    const candidates = runPipeline({ receipts: makeReceipts() });
    expect(candidates.length).toBeGreaterThanOrEqual(2);
    const t1 = candidates.find((c) => c.cluster.passes_synthesis_gate);
    expect(t1).toBeDefined();
    expect(t1!.cluster.axis_scores!.schema_stability).toBe(1);
    expect(t1!.projected_annual_savings_usd).toBeGreaterThan(0);
    // Top of the list should be a passing candidate (highest savings).
    expect(candidates[0]!.passes_gate).toBe(true);
  });
});
