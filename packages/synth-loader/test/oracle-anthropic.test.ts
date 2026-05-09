import { describe, it, expect } from "vitest";
import {
  AnthropicOracleClient,
  BudgetedOracleClient,
  OracleBudgetExceededError,
  OracleWithLocalFallback,
  StubOracleClient,
  renderOraclePrompt,
  type IOracleClient,
} from "../src/oracle.js";
import type { CallSiteDescriptor, SyntheticInput } from "@compile/schemas";

function callSite(): CallSiteDescriptor {
  return {
    call_site_id: "cs_x",
    file_path: "x.ts",
    line: 1,
    column: 1,
    provider: "anthropic",
    function_hint: "classify_lead_tier",
    prompt_excerpt: "Classify the lead profile.",
    priors: {
      schema_stability_prior: 0.9,
      determinism_prior: 0.9,
      economic_value_prior: 0.9,
      pill: "green",
      signals: {
        has_response_format: true,
        has_zod_schema: true,
        has_temperature_zero: true,
        prompt_template_static: true,
        bounded_tool_array: true,
        tool_count: 0,
        has_few_shot_examples: false,
        followed_by_structured_parse: false,
        has_telemetry: true,
      },
    },
  };
}

const input: SyntheticInput = {
  input_id: "in_1",
  call_site_id: "cs_x",
  origin: "seed_0",
  payload: { industry: "fintech", employees: 80 },
};

describe("renderOraclePrompt", () => {
  it("includes function_hint, prompt_excerpt, and the JSON-stringified payload", () => {
    const prompt = renderOraclePrompt(callSite(), input.payload);
    expect(prompt).toContain("classify_lead_tier");
    expect(prompt).toContain("Classify the lead profile");
    expect(prompt).toContain('"industry": "fintech"');
    expect(prompt).toContain("Return JSON only");
  });

  it("is deterministic across calls (rehearsal reproducibility)", () => {
    const a = renderOraclePrompt(callSite(), input.payload);
    const b = renderOraclePrompt(callSite(), input.payload);
    expect(a).toBe(b);
  });
});

describe("AnthropicOracleClient construction", () => {
  it("constructs without making a network call", () => {
    const client = new AnthropicOracleClient({ apiKey: "sk-test" });
    expect(client).toBeInstanceOf(AnthropicOracleClient);
  });

  it("accepts custom model + pricing overrides", () => {
    const client = new AnthropicOracleClient({
      apiKey: "sk-test",
      model: "claude-haiku-4-5-20251001",
      inputUsdPerToken: 0.000_001,
      outputUsdPerToken: 0.000_005,
    });
    expect(client).toBeInstanceOf(AnthropicOracleClient);
  });
});

/* ───── Wrapper tests use a fake IOracleClient — no Anthropic SDK calls ──── */

class ProgrammableOracle implements IOracleClient {
  public callCount = 0;
  constructor(
    private readonly responses: Array<{
      output?: unknown;
      cost_usd?: number;
      error?: Error;
    }>,
  ) {}
  async call(): Promise<{ output: unknown; latency_ms: number; cost_usd: number }> {
    const r = this.responses[this.callCount];
    this.callCount++;
    if (!r) throw new Error("ProgrammableOracle exhausted");
    if (r.error) throw r.error;
    return { output: r.output ?? null, latency_ms: 1, cost_usd: r.cost_usd ?? 0 };
  }
}

describe("OracleWithLocalFallback", () => {
  it("returns the primary's output when it succeeds first try", async () => {
    const primary = new ProgrammableOracle([{ output: { src: "primary" } }]);
    const fallback = new StubOracleClient();
    const wrapped = new OracleWithLocalFallback(primary, fallback);
    const r = await wrapped.call({ call_site: callSite(), input });
    expect(r.output).toEqual({ src: "primary" });
    expect(primary.callCount).toBe(1);
    expect(wrapped.fallbacksEngaged()).toBe(0);
  });

  it("retries once on first error, returns primary on second-try success", async () => {
    const primary = new ProgrammableOracle([
      { error: new Error("transient 429") },
      { output: { src: "primary_after_retry" } },
    ]);
    const wrapped = new OracleWithLocalFallback(primary, new StubOracleClient(), {
      retryDelayMs: 1,
    });
    const r = await wrapped.call({ call_site: callSite(), input });
    expect(r.output).toEqual({ src: "primary_after_retry" });
    expect(primary.callCount).toBe(2);
    expect(wrapped.fallbacksEngaged()).toBe(0);
  });

  it("falls back to stub for that input only when primary fails twice", async () => {
    const primary = new ProgrammableOracle([
      { error: new Error("api down 1") },
      { error: new Error("api down 2") },
    ]);
    const wrapped = new OracleWithLocalFallback(primary, new StubOracleClient(), {
      retryDelayMs: 1,
    });
    const r = await wrapped.call({ call_site: callSite(), input });
    // Stub returns deterministic stubFrontierOutput for this call site.
    expect(r.output).toBeDefined();
    expect(primary.callCount).toBe(2);
    expect(wrapped.fallbacksEngaged()).toBe(1);
  });

  it("calls onFallback exactly once with the second error", async () => {
    const errs: unknown[] = [];
    const primary = new ProgrammableOracle([
      { error: new Error("first") },
      { error: new Error("second") },
    ]);
    const wrapped = new OracleWithLocalFallback(primary, new StubOracleClient(), {
      retryDelayMs: 1,
      onFallback: (err) => errs.push(err),
    });
    await wrapped.call({ call_site: callSite(), input });
    expect(errs).toHaveLength(1);
    expect((errs[0] as Error).message).toBe("second");
  });
});

describe("BudgetedOracleClient", () => {
  it("accumulates spend from each wrapped call", async () => {
    const inner = new ProgrammableOracle([
      { output: 1, cost_usd: 0.01 },
      { output: 2, cost_usd: 0.02 },
    ]);
    const budgeted = new BudgetedOracleClient(inner, { budgetUsd: 10 });
    await budgeted.call({ call_site: callSite(), input });
    await budgeted.call({ call_site: callSite(), input });
    expect(budgeted.spentUsd()).toBeCloseTo(0.03);
  });

  it("throws OracleBudgetExceededError once spend hits the cap", async () => {
    const inner = new ProgrammableOracle([
      { output: 1, cost_usd: 4 },
      { output: 2, cost_usd: 2 },
      { output: 3, cost_usd: 1 },
    ]);
    const budgeted = new BudgetedOracleClient(inner, { budgetUsd: 5 });
    await budgeted.call({ call_site: callSite(), input }); // $4 spent
    await budgeted.call({ call_site: callSite(), input }); // $6 spent → trips
    await expect(
      budgeted.call({ call_site: callSite(), input }),
    ).rejects.toThrow(OracleBudgetExceededError);
  });

  it("onTrip fires exactly once when the cap is first hit", async () => {
    const inner = new ProgrammableOracle([
      { output: 1, cost_usd: 3 },
      { output: 2, cost_usd: 3 },
      { output: 3, cost_usd: 3 },
    ]);
    let trips = 0;
    const budgeted = new BudgetedOracleClient(inner, {
      budgetUsd: 5,
      onTrip: () => trips++,
    });
    await budgeted.call({ call_site: callSite(), input });
    await budgeted.call({ call_site: callSite(), input });
    // At this point spent=6, tripped=true. Third call should throw without
    // re-firing onTrip.
    await expect(
      budgeted.call({ call_site: callSite(), input }),
    ).rejects.toThrow(OracleBudgetExceededError);
    expect(trips).toBe(1);
  });

  it("reset() clears spend so rehearsals can re-run cleanly", async () => {
    const inner = new ProgrammableOracle([
      { output: 1, cost_usd: 4 },
      { output: 2, cost_usd: 4 },
    ]);
    const budgeted = new BudgetedOracleClient(inner, { budgetUsd: 5 });
    await budgeted.call({ call_site: callSite(), input });
    expect(budgeted.spentUsd()).toBe(4);
    budgeted.reset();
    expect(budgeted.spentUsd()).toBe(0);
    // Should be able to spend up to $5 again.
    await budgeted.call({ call_site: callSite(), input });
    expect(budgeted.spentUsd()).toBe(4);
  });
});

describe("Budget+Fallback composition (production wiring)", () => {
  it("budget trip in the budgeted layer is caught by OracleWithLocalFallback", async () => {
    // Real production stack: AnthropicOracleClient → BudgetedOracleClient
    // → OracleWithLocalFallback. We simulate the inner layer as a
    // programmable oracle so we can drive cost behavior deterministically.
    const inner = new ProgrammableOracle([
      { output: { src: "real" }, cost_usd: 4 },
      { output: { src: "real" }, cost_usd: 4 }, // trips at $8 > $5
    ]);
    const budgeted = new BudgetedOracleClient(inner, { budgetUsd: 5 });
    const wrapped = new OracleWithLocalFallback(budgeted, new StubOracleClient(), {
      retryDelayMs: 1,
    });
    // Call 1 — under cap; primary returns real output.
    const r1 = await wrapped.call({ call_site: callSite(), input });
    expect(r1.output).toEqual({ src: "real" });
    // Call 2 — budgeted now has $4 spent + this call $4 → trips at $8.
    const r2 = await wrapped.call({ call_site: callSite(), input });
    expect(r2.output).toEqual({ src: "real" });
    // Call 3 — budgeted is over cap, throws OracleBudgetExceededError, the
    // fallback catches it and we get a Stub output (still defined).
    const r3 = await wrapped.call({ call_site: callSite(), input });
    expect(r3.output).toBeDefined();
    expect(wrapped.fallbacksEngaged()).toBeGreaterThanOrEqual(1);
  });
});
