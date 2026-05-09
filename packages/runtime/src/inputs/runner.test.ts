import { describe, it, expect } from "vitest";
import { renderTemplate, runInputs, type IChatClient } from "./runner.js";
import { generateInputs } from "./generator.js";
import { ICP_FIT_FIXTURE } from "./fixtures.js";

describe("renderTemplate", () => {
  it("substitutes flat fields", () => {
    expect(renderTemplate("hi {{name}}", { name: "Acme" })).toBe("hi Acme");
  });

  it("flags missing fields visibly", () => {
    expect(renderTemplate("hi {{name}}", {})).toBe("hi <missing:name>");
  });

  it("JSON-stringifies non-string values", () => {
    expect(renderTemplate("n={{n}}", { n: 42 })).toBe("n=42");
    expect(renderTemplate("ok={{ok}}", { ok: true })).toBe("ok=true");
  });

  it("supports dotted paths", () => {
    expect(
      renderTemplate("hi {{lead.company}}", { lead: { company: "Acme" } }),
    ).toBe("hi Acme");
  });
});

describe("runInputs — dry run", () => {
  it("renders prompts without calling the client", async () => {
    const inputs = generateInputs({
      inputSchema: ICP_FIT_FIXTURE.input_schema,
      traces: ICP_FIT_FIXTURE.traces,
      n: 3,
      seed: 1,
    });
    const calls: string[] = [];
    const client: IChatClient = {
      model: "fake",
      chat: async (req) => {
        calls.push(req.prompt);
        return {
          output: "x",
          latencyMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          model: "fake",
        };
      },
    };
    const summary = await runInputs({
      template: ICP_FIT_FIXTURE.prompt_template,
      inputs,
      client,
      dryRun: true,
    });
    expect(calls).toHaveLength(0);
    expect(summary.results).toHaveLength(3);
    for (const r of summary.results) {
      expect(r.rendered_prompt).not.toContain("{{");
      expect(r.rendered_prompt).not.toContain("<missing:");
    }
  });
});

describe("runInputs — maxCalls cap", () => {
  it("truncates inputs to the cap", async () => {
    const inputs = generateInputs({
      inputSchema: ICP_FIT_FIXTURE.input_schema,
      n: 20,
      seed: 1,
    });
    let calls = 0;
    const client: IChatClient = {
      model: "fake",
      chat: async () => {
        calls++;
        return {
          output: "x",
          latencyMs: 1,
          inputTokens: 1,
          outputTokens: 1,
          model: "fake",
        };
      },
    };
    const summary = await runInputs({
      template: ICP_FIT_FIXTURE.prompt_template,
      inputs,
      client,
      maxCalls: 5,
    });
    expect(calls).toBe(5);
    expect(summary.cluster_calls).toBe(5);
    expect(summary.ok).toBe(5);
  });
});

describe("runInputs — error path", () => {
  it("captures errors and continues", async () => {
    const inputs = generateInputs({
      inputSchema: ICP_FIT_FIXTURE.input_schema,
      n: 4,
      seed: 1,
    });
    let n = 0;
    const client: IChatClient = {
      model: "fake",
      chat: async () => {
        n++;
        if (n === 2) throw new Error("rate limited");
        return {
          output: "ok",
          latencyMs: 1,
          inputTokens: 1,
          outputTokens: 1,
          model: "fake",
        };
      },
    };
    const summary = await runInputs({
      template: ICP_FIT_FIXTURE.prompt_template,
      inputs,
      client,
    });
    expect(summary.ok).toBe(3);
    expect(summary.errors).toBe(1);
    expect(summary.results[1]?.error).toBe("rate limited");
  });
});
