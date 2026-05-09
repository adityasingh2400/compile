import { describe, it, expect } from "vitest";
import { LocalFakeTensorlakeClient } from "@compile/runtime";
import {
  StubCandidateClient,
  phiPromptForCallSite,
} from "../src/candidate.js";
import type { CallSiteDescriptor, SyntheticInput } from "@compile/schemas";

function callSite(pill: "green" | "yellow" | "red"): CallSiteDescriptor {
  return {
    call_site_id: `cs_${pill}`,
    file_path: "fake.ts",
    line: 1,
    column: 1,
    provider: "anthropic",
    function_hint: "classify_lead_tier",
    prompt_excerpt: "Classify the lead profile into A/B/C tiers.",
    priors: {
      schema_stability_prior: 0.9,
      determinism_prior: 0.9,
      economic_value_prior: 0.9,
      pill,
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
  call_site_id: "cs_yellow",
  origin: "seed_0",
  payload: { industry: "fintech", employees: 80 },
};

describe("StubCandidateClient (Tier-2 routes through runPhi)", () => {
  it("YELLOW pill calls tensorlake.runPhi when configured (D1)", async () => {
    let captured: { prompt: string; input: unknown } | null = null;
    const tensorlake = new LocalFakeTensorlakeClient({
      phiHandler: (args) => {
        captured = { prompt: args.prompt, input: args.input };
        return { tier: "B", confidence: 0.7, source: "phi" };
      },
    });
    const client = new StubCandidateClient({ tensorlake });
    const r = await client.call({ call_site: callSite("yellow"), input });
    expect(r.tier_assigned).toBe("tier_2");
    expect(r.output).toEqual({ tier: "B", confidence: 0.7, source: "phi" });
    expect(r.cost_usd).toBe(0.0001);
    expect(captured!.prompt).toContain("classify_lead_tier");
    expect(captured!.input).toEqual({ industry: "fintech", employees: 80 });
  });

  it("YELLOW pill falls through to inline mock when no tensorlake provided", async () => {
    const client = new StubCandidateClient();
    const r = await client.call({ call_site: callSite("yellow"), input });
    expect(r.tier_assigned).toBe("tier_2");
    // Inline mock path: output reflects the stubFrontierOutput shape (object
    // with tier/confidence/etc.), NOT the phi handler's structure.
    expect(r.output).not.toEqual({ tier: "B", confidence: 0.7, source: "phi" });
  });

  it("GREEN pill never calls runPhi (Tier-1 stays deterministic / in-process)", async () => {
    let phiCalled = false;
    const tensorlake = new LocalFakeTensorlakeClient({
      phiHandler: () => {
        phiCalled = true;
        return null;
      },
    });
    const client = new StubCandidateClient({ tensorlake });
    const r = await client.call({ call_site: callSite("green"), input });
    expect(r.tier_assigned).toBe("tier_1");
    expect(phiCalled).toBe(false);
  });

  it("phiPromptForCallSite includes the function_hint and prompt_excerpt", () => {
    const prompt = phiPromptForCallSite(callSite("yellow"));
    expect(prompt).toContain("classify_lead_tier");
    expect(prompt).toContain("Classify the lead profile");
    expect(prompt).toContain("Return JSON only");
  });
});
