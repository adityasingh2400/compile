import { describe, it, expect, beforeEach } from "vitest";
import { resolve } from "node:path";
import { StubNiaClient } from "@compile/nia";
import { MemoryReceiptStore } from "@compile/identifier";
import { MemoryRequestStore } from "../src/store.js";
import { buildHandlers, MemoryBootstrapStore } from "../src/handlers.js";
import type { ScanReport, SyntheticRun } from "@compile/schemas";

const ACME = resolve(__dirname, "../../../data/acme-agent");

describe("v7 bootstrap: scan_repo + synthetic_confirm", () => {
  let nia: StubNiaClient;
  let bootstrap: MemoryBootstrapStore;
  let h: ReturnType<typeof buildHandlers>;

  beforeEach(() => {
    nia = new StubNiaClient();
    bootstrap = new MemoryBootstrapStore();
    h = buildHandlers({
      nia,
      store: new MemoryRequestStore(),
      receipts: new MemoryReceiptStore(),
      bootstrap,
    });
  });

  it("scan_repo finds 10 Acme call sites and writes RED sites to negative Vault", async () => {
    const report = (await h["compile.scan_repo"]({ repo_path: ACME })) as ScanReport;
    expect(report.call_sites).toHaveLength(10);
    expect(report.tree_signature).toMatch(/^[0-9a-f]{16}$/);

    // RED sites should now be findable as negative entries via find_function.
    const redSite = report.call_sites.find((c) => c.priors.pill === "red")!;
    const lookup = (await nia.vaultLookup(redSite.call_site_id)) as { state: string };
    expect(lookup.state).toBe("negative");
  });

  it("synthetic_confirm runs Stage 2 against a green call site (downscaled)", async () => {
    const report = (await h["compile.scan_repo"]({ repo_path: ACME })) as ScanReport;
    const green = report.call_sites.find((c) => c.priors.pill === "green")!;

    const run = (await h["compile.synthetic_confirm"]({
      call_site_id: green.call_site_id,
      total_calls: 500,
      oracle_fraction: 0.02,
      worker_count: 8,
    })) as SyntheticRun;

    expect(run.total_calls).toBe(500);
    expect(run.tier_mix.tier_1).toBeGreaterThan(0);
    expect(run.tier_mix.tier_2).toBe(0);
    expect(run.tier_mix.tier_3).toBe(0);
    expect(run.passes_synthesis_gate).toBe(true);
    expect(run.preserved_traces.length).toBeGreaterThan(0);
  }, 30000);

  it("end-to-end v7: scan → synthetic_confirm → request_synthesis → submit (positive) → run_codified", async () => {
    const report = (await h["compile.scan_repo"]({ repo_path: ACME })) as ScanReport;
    const green = report.call_sites.find(
      (c) => c.priors.pill === "green" && c.function_hint === "classify_ticket_priority",
    )!;
    expect(green).toBeDefined();

    await h["compile.synthetic_confirm"]({
      call_site_id: green.call_site_id,
      total_calls: 300,
      oracle_fraction: 0.03,
      worker_count: 4,
    });

    const list = (await h["compile.list_codify_candidates"]({ limit: 5 })) as {
      candidates: Array<{ cluster_id: string; passes_synthesis_gate: boolean }>;
    };
    expect(list.candidates.length).toBeGreaterThan(0);
    const top = list.candidates.find((c) => c.passes_synthesis_gate)!;
    expect(top).toBeDefined();

    const spec = (await h["compile.request_synthesis"]({ cluster_id: top.cluster_id })) as {
      request_id: string;
      cluster_id: string;
      traces: unknown[];
      holdout_count: number;
    };
    expect(spec.cluster_id).toBe(top.cluster_id);
    expect(spec.traces.length).toBeGreaterThan(0);
    expect(spec.holdout_count).toBeGreaterThan(0);

    // Submit a hand-rolled deterministic envelope for classify_ticket_priority.
    // Mirrors the candidate-path stub so the holdout gate passes.
    const submit = (await h["compile.submit_synthesis"]({
      request_id: spec.request_id,
      envelope: {
        synthesizable: true,
        tier: "tier_1",
        confidence: 0.95,
        function_name: "classify_ticket",
        description: "Classify ticket priority + category from text",
        code: `
          import { llmFallback } from "./_runtime";
          export function classify_ticket(input: { text: string }) {
            const t = String(input?.text ?? "");
            const priority = /down|outage|P0/.test(t) ? "P0" : /P1|urgent/.test(t) ? "P1" : "P2";
            const category = /billing/.test(t) ? "billing" : /auth|login/.test(t) ? "auth" : "outage";
            return { priority, category, confidence: 0.9 };
          }
        `,
        tests: "",
        contract: {
          input_schema: { type: "object" },
          output_schema: { type: "object" },
          preconditions: [],
          doc_dependencies: [],
        },
        fallback_strategy: "frontier_llm",
        estimated_savings_per_call_usd: 0.04,
        reasoning: "deterministic regex classifier",
      },
    })) as { gate_verdict: "pass" | "fail"; function_id?: string; failure_reason?: string };

    if (submit.gate_verdict !== "pass") {
      // Surface the reason for diagnosis if the holdout gate rejects.
      console.error("submit failed:", submit.failure_reason);
    }
    expect(submit.gate_verdict).toBe("pass");
    expect(submit.function_id).toBeDefined();

    const run = (await h["compile.run_codified"]({
      function_id: submit.function_id!,
      input: { text: "system down for tenant 42, severity P0" },
    })) as { output: { priority: string }; tier_used: string };
    expect(run.output.priority).toBe("P0");
    expect(run.tier_used).toBe("tier_1");
  }, 60000);

  it("RED site goes straight to negative Vault on scan; find_function returns negative", async () => {
    const report = (await h["compile.scan_repo"]({ repo_path: ACME })) as ScanReport;
    const red = report.call_sites.find(
      (c) => c.priors.pill === "red" && c.function_hint === "generate_marketing_copy",
    )!;
    expect(red).toBeDefined();
    const lookup = (await nia.vaultLookup(red.call_site_id)) as {
      state: string;
      entry?: { reason?: string };
    };
    expect(lookup.state).toBe("negative");
    expect(lookup.entry?.reason).toBe("low_static_prior");
  });
});
