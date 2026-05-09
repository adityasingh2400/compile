import { describe, it, expect, beforeEach } from "vitest";
import { StubNiaClient } from "@compile/nia";
import { MemoryReceiptStore } from "@compile/identifier";
import { MemoryRequestStore } from "../src/store.js";
import { buildHandlers } from "../src/handlers.js";
import type { Receipt } from "@compile/schemas";

function mkReceipt(i: number, prompt: string, input: unknown, output: unknown): Receipt {
  return {
    call_id: `c${i}`,
    timestamp: new Date().toISOString(),
    agent_id: "test-agent",
    prompt,
    tool_schemas: [],
    input,
    output,
    tokens_in: 50,
    tokens_out: 10,
    cost_usd: 0.04,
    latency_ms: 300,
    model: "frontier",
  };
}

const positiveEnvelope = {
  synthesizable: true as const,
  tier: "tier_1" as const,
  confidence: 0.95,
  function_name: "extract_id",
  description: "Extract invoice id",
  code: `
    import { llmFallback } from "./fallback";
    export function extract_id(input: { body: string }): { id: string } {
      const m = input.body.match(/INV-\\d+/);
      if (!m) return llmFallback(input, "extract_id") as never;
      return { id: m[0] };
    }
  `,
  tests: "",
  contract: {
    input_schema: { type: "object" },
    output_schema: { type: "object" },
    preconditions: [],
    doc_dependencies: [],
  },
  fallback_strategy: "frontier_llm" as const,
  estimated_savings_per_call_usd: 0.04,
  reasoning: "regex extraction",
};

describe("MCP handlers", () => {
  let nia: StubNiaClient;
  let store: MemoryRequestStore;
  let receipts: MemoryReceiptStore;
  let h: ReturnType<typeof buildHandlers>;

  beforeEach(() => {
    nia = new StubNiaClient();
    store = new MemoryRequestStore();
    receipts = new MemoryReceiptStore();
    h = buildHandlers({ nia, store, receipts });
  });

  it("observe_call appends to receipt store", async () => {
    const r = mkReceipt(0, 'Extract id from "INV-1001"', { body: "INV-1001" }, { id: "INV-1001" });
    const result = (await h["compile.observe_call"](r)) as { ok: true; receipt_id: string };
    expect(result.ok).toBe(true);
    expect(receipts.size()).toBe(1);
  });

  it("list_codify_candidates ranks scored clusters by savings", async () => {
    for (let i = 0; i < 30; i++) {
      await h["compile.observe_call"](
        mkReceipt(
          i,
          `Extract id from "INV-${1000 + i}"`,
          { body: `INV-${1000 + i}` },
          { id: `INV-${1000 + i}` },
        ),
      );
    }
    const out = (await h["compile.list_codify_candidates"]({ limit: 10 })) as {
      candidates: Array<{ projected_annual_savings_usd: number; passes_synthesis_gate: boolean }>;
    };
    expect(out.candidates.length).toBeGreaterThan(0);
    expect(out.candidates[0]!.passes_synthesis_gate).toBe(true);
    expect(out.candidates[0]!.projected_annual_savings_usd).toBeGreaterThan(0);
  });

  it("end-to-end: observe → list → request → submit (positive) → find → run", async () => {
    for (let i = 0; i < 30; i++) {
      await h["compile.observe_call"](
        mkReceipt(
          i,
          `Extract id from "INV-${1000 + i}"`,
          { body: `INV-${1000 + i}` },
          { id: `INV-${1000 + i}` },
        ),
      );
    }
    const list = (await h["compile.list_codify_candidates"]({ limit: 5 })) as {
      candidates: Array<{ cluster_id: string }>;
    };
    const cluster_id = list.candidates[0]!.cluster_id;

    const spec = (await h["compile.request_synthesis"]({ cluster_id })) as {
      request_id: string;
      cluster_id: string;
    };
    expect(spec.cluster_id).toBe(cluster_id);

    // Submit a working envelope; gate should pass against the holdout.
    const submit = (await h["compile.submit_synthesis"]({
      request_id: spec.request_id,
      envelope: positiveEnvelope,
    })) as {
      gate_verdict: "pass" | "fail";
      function_id?: string;
      holdout_match_rate?: number;
      failure_reason?: string;
    };
    expect(submit.gate_verdict).toBe("pass");
    expect(submit.function_id).toBeDefined();

    const find = (await h["compile.find_function"]({
      description: "extract id",
      prompt: `Extract id from "INV-9999"`,
    })) as { state: "positive" | "negative" | "unknown" };
    expect(find.state).toBe("positive");

    const run = (await h["compile.run_codified"]({
      function_id: submit.function_id!,
      input: { body: "Order INV-2026 received" },
    })) as { output: { id: string }; tier_used: string };
    expect(run.output).toEqual({ id: "INV-2026" });
    expect(run.tier_used).toBe("tier_1");
  }, 60000);

  it("submit_synthesis with synthesizable=false writes negative Vault entry", async () => {
    for (let i = 0; i < 30; i++) {
      await h["compile.observe_call"](
        mkReceipt(
          i,
          `Write a poem about "topic_${i}"`,
          { topic: `topic_${i}` },
          { text: "x".repeat(i + 1) },
        ),
      );
    }
    const list = (await h["compile.list_codify_candidates"]({ limit: 5 })) as {
      candidates: Array<{ cluster_id: string }>;
    };
    const cluster_id = list.candidates[0]!.cluster_id;
    const spec = (await h["compile.request_synthesis"]({ cluster_id })) as {
      request_id: string;
    };

    const submit = (await h["compile.submit_synthesis"]({
      request_id: spec.request_id,
      envelope: {
        synthesizable: false,
        reason: "creative_task",
        recommendation: "stay_tier_3",
        retry_policy: { type: "sticky", retry_on_distribution_shift: false },
        cluster_signature: cluster_id,
      },
    })) as { gate_verdict: "pass" | "fail"; failure_reason?: string };

    expect(submit.gate_verdict).toBe("fail");
    expect(submit.failure_reason).toContain("creative_task");

    // Negative entry now in Nia stub — find_function should return negative.
    const find = (await h["compile.find_function"]({
      description: "write a poem",
      prompt: `Write a poem about "another topic"`,
    })) as { state: "positive" | "negative" | "unknown" };
    expect(find.state).toBe("negative");
  });

  it("estimate_savings returns axis scores + per-tier projections", async () => {
    for (let i = 0; i < 30; i++) {
      await h["compile.observe_call"](
        mkReceipt(
          i,
          `Extract id from "INV-${1000 + i}"`,
          { body: `INV-${1000 + i}` },
          { id: `INV-${1000 + i}` },
        ),
      );
    }
    const list = (await h["compile.list_codify_candidates"]({ limit: 5 })) as {
      candidates: Array<{ cluster_id: string }>;
    };
    const cluster_id = list.candidates[0]!.cluster_id;
    const out = (await h["compile.estimate_savings"]({ cluster_id })) as {
      axis_scores: { schema_stability: number };
      per_call_savings_usd: { tier_1: number; tier_2: number };
      annual_savings_usd: number;
    };
    expect(out.axis_scores.schema_stability).toBeGreaterThan(0);
    expect(out.per_call_savings_usd.tier_1).toBeGreaterThan(out.per_call_savings_usd.tier_2);
  });
});
