import { describe, it, expect } from "vitest";
import { generateInputs } from "./generator.js";
import {
  ICP_FIT_FIXTURE,
  AMBIGUOUS_LEAD_FIXTURE,
  NOVEL_POSITIONING_FIXTURE,
} from "./fixtures.js";

describe("generateInputs — determinism", () => {
  it("same seed produces identical outputs", () => {
    const a = generateInputs({
      inputSchema: ICP_FIT_FIXTURE.input_schema,
      traces: ICP_FIT_FIXTURE.traces,
      n: 20,
      seed: 42,
    });
    const b = generateInputs({
      inputSchema: ICP_FIT_FIXTURE.input_schema,
      traces: ICP_FIT_FIXTURE.traces,
      n: 20,
      seed: 42,
    });
    expect(a).toEqual(b);
  });

  it("different seeds diverge", () => {
    const a = generateInputs({
      inputSchema: ICP_FIT_FIXTURE.input_schema,
      n: 20,
      seed: 1,
    });
    const b = generateInputs({
      inputSchema: ICP_FIT_FIXTURE.input_schema,
      n: 20,
      seed: 2,
    });
    expect(a).not.toEqual(b);
  });
});

describe("generateInputs — schema conformance", () => {
  it("ICP-fit fuzz inputs have all required fields with correct types", () => {
    const out = generateInputs({
      inputSchema: ICP_FIT_FIXTURE.input_schema,
      n: 30,
      seed: 7,
    });
    expect(out).toHaveLength(30);
    for (const { input } of out) {
      const obj = input as Record<string, unknown>;
      expect(typeof obj.company).toBe("string");
      expect(typeof obj.size).toBe("string");
      expect(typeof obj.industry).toBe("string");
      expect(typeof obj.signal).toBe("string");
    }
  });

  it("ambiguous-lead respects maxLength on notes", () => {
    const out = generateInputs({
      inputSchema: AMBIGUOUS_LEAD_FIXTURE.input_schema,
      n: 30,
      seed: 7,
    });
    for (const { input } of out) {
      const notes = (input as Record<string, unknown>).notes as string;
      expect(notes.length).toBeLessThanOrEqual(200);
    }
  });

  it("novel-positioning enum field always picks from the enum", () => {
    const out = generateInputs({
      inputSchema: NOVEL_POSITIONING_FIXTURE.input_schema,
      n: 30,
      seed: 7,
    });
    for (const { input } of out) {
      const tone = (input as Record<string, unknown>).tone as string;
      expect(["confident", "humble", "playful"]).toContain(tone);
    }
  });
});

describe("generateInputs — hybrid fuzz/perturb mix", () => {
  it("uses perturbation when traces are present", () => {
    const out = generateInputs({
      inputSchema: ICP_FIT_FIXTURE.input_schema,
      traces: ICP_FIT_FIXTURE.traces,
      n: 20,
      seed: 7,
      perturbFraction: 0.5,
    });
    const perturb = out.filter((g) => g.source === "perturb").length;
    const fuzz = out.filter((g) => g.source === "fuzz").length;
    expect(perturb).toBe(10);
    expect(fuzz).toBe(10);
  });

  it("falls back to all-fuzz when no traces", () => {
    const out = generateInputs({
      inputSchema: NOVEL_POSITIONING_FIXTURE.input_schema,
      n: 10,
      seed: 7,
    });
    expect(out.every((g) => g.source === "fuzz")).toBe(true);
  });

  it("perturbed inputs preserve field types from the source trace", () => {
    const out = generateInputs({
      inputSchema: ICP_FIT_FIXTURE.input_schema,
      traces: ICP_FIT_FIXTURE.traces,
      n: 30,
      seed: 7,
      perturbFraction: 1,
    });
    for (const { input, source, source_trace_index } of out) {
      expect(source).toBe("perturb");
      expect(source_trace_index).toBeDefined();
      const obj = input as Record<string, unknown>;
      expect(typeof obj.company).toBe("string");
      expect(typeof obj.size).toBe("string");
      expect(typeof obj.industry).toBe("string");
      expect(typeof obj.signal).toBe("string");
    }
  });
});
