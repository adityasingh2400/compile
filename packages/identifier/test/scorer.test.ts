import { describe, it, expect } from "vitest";
import {
  schemaStabilityFromOutputs,
  determinismFromReceipts,
  economicValue,
  scoreCluster,
} from "../src/scorer.js";
import type { Receipt } from "@compile/schemas";

describe("schemaStability", () => {
  it("scores 1.0 for identical shapes", () => {
    const out = schemaStabilityFromOutputs([
      { a: 1, b: "x" },
      { a: 2, b: "y" },
      { a: 3, b: "z" },
    ]);
    expect(out.score).toBe(1);
  });
  it("drops with shape variance", () => {
    const out = schemaStabilityFromOutputs([
      { a: 1, b: "x" },
      { a: 1, b: "x" },
      { c: 9 },
    ]);
    expect(out.score).toBeCloseTo(2 / 3, 3);
  });
});

describe("determinism", () => {
  const base = (input: unknown, output: unknown, i: number): Receipt => ({
    call_id: `c${i}`,
    timestamp: new Date(2026, 0, 1, 0, 0, i).toISOString(),
    agent_id: "test",
    prompt: "Extract field from <NUM>",
    tool_schemas: [],
    input,
    output,
    tokens_in: 10,
    tokens_out: 5,
    cost_usd: 0.01,
    latency_ms: 100,
    model: "test-model",
  });
  it("scores 1.0 when same input always yields same output", () => {
    const recs = [
      base({ x: 1 }, { y: 1 }, 0),
      base({ x: 1 }, { y: 1 }, 1),
      base({ x: 2 }, { y: 2 }, 2),
    ];
    expect(determinismFromReceipts(recs).score).toBe(1);
  });
  it("scores below 1.0 when same input yields divergent output", () => {
    const recs = [
      base({ x: 1 }, { y: 1 }, 0),
      base({ x: 1 }, { y: 99 }, 1),
      base({ x: 2 }, { y: 2 }, 2),
    ];
    const r = determinismFromReceipts(recs);
    expect(r.score).toBeLessThan(1);
    expect(r.divergent_inputs).toBe(1);
  });
});

describe("economicValue", () => {
  it("computes positive savings for high-volume cluster", () => {
    const ev = economicValue({
      monthly_calls: 100_000,
      per_call_cost_usd: 0.05,
      target_tier: "tier_1",
    });
    expect(ev.annual_savings_usd).toBeGreaterThan(0);
    expect(ev.break_even_hits).toBeGreaterThan(0);
    expect(ev.break_even_hits).toBeLessThan(2000);
  });
  it("computes negative savings for low-volume cluster", () => {
    const ev = economicValue({
      monthly_calls: 5,
      per_call_cost_usd: 0.05,
      target_tier: "tier_1",
    });
    expect(ev.annual_savings_usd).toBeLessThanOrEqual(0);
  });
});

describe("scoreCluster (integration)", () => {
  it("produces all three axes from a receipt batch", () => {
    const recs: Receipt[] = Array.from({ length: 30 }, (_, i) => ({
      call_id: `c${i}`,
      timestamp: new Date().toISOString(),
      agent_id: "test",
      prompt: `Extract id from "INV-${1000 + i}"`,
      tool_schemas: [],
      input: { body: `INV-${1000 + i}` },
      output: { id: `INV-${1000 + i}` },
      tokens_in: 10,
      tokens_out: 5,
      cost_usd: 0.05,
      latency_ms: 100,
      model: "test",
    }));
    const scores = scoreCluster({ receipts: recs });
    expect(scores.schema_stability).toBe(1);
    expect(scores.determinism).toBe(1);
    expect(scores.economic_value.monthly_calls).toBeGreaterThan(0);
  });
});
