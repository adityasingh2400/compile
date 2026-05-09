import { describe, it, expect } from "vitest";
import { templatize } from "../src/templater.js";
import type { Receipt } from "@compile/schemas";

const mk = (i: number, prompt: string): Receipt => ({
  call_id: `c${i}`,
  timestamp: new Date().toISOString(),
  agent_id: "test",
  prompt,
  tool_schemas: [],
  input: {},
  output: {},
  tokens_in: 0,
  tokens_out: 0,
  cost_usd: 0,
  latency_ms: 0,
  model: "test",
});

describe("templatize", () => {
  it("collapses prompts that share a structural skeleton", () => {
    const recs = [
      mk(0, 'Extract order id from email "foo bar 123"'),
      mk(1, 'Extract order id from email "qux quux 999"'),
      mk(2, 'Extract order id from email "zap zip 7"'),
    ];
    const r = templatize(recs);
    expect(r.templates).toHaveLength(1);
    expect(r.templates[0]!.receipt_ids).toHaveLength(3);
  });
  it("separates prompts with different skeletons", () => {
    const recs = [
      mk(0, 'Extract order id from email "x"'),
      mk(1, "Classify ticket priority for: complaint about delivery"),
    ];
    const r = templatize(recs);
    expect(r.templates).toHaveLength(2);
  });
});
