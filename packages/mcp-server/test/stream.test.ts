import { describe, it, expect, beforeEach } from "vitest";
import { resolve } from "node:path";
import { StubNiaClient } from "@compile/nia";
import { MemoryReceiptStore } from "@compile/identifier";
import { MemoryBootstrapStream } from "@compile/stream";
import {
  BOOTSTRAP_PHASES,
  PHASE_INDEX,
  RETRY_POLICY_BY_REASON,
  type ScanReport,
  type SynthesisSuccess,
} from "@compile/schemas";
import { MemoryRequestStore } from "../src/store.js";
import { buildHandlers, MemoryBootstrapStore } from "../src/handlers.js";

const FOLK = resolve(__dirname, "../../../data/folk-agent");

describe("MCP handlers + IBootstrapStream wiring", () => {
  let nia: StubNiaClient;
  let bootstrap: MemoryBootstrapStore;
  let stream: MemoryBootstrapStream;
  let h: ReturnType<typeof buildHandlers>;

  beforeEach(() => {
    nia = new StubNiaClient();
    bootstrap = new MemoryBootstrapStore();
    stream = new MemoryBootstrapStream();
    h = buildHandlers({
      nia,
      store: new MemoryRequestStore(),
      receipts: new MemoryReceiptStore(),
      bootstrap,
      stream,
    });
  });

  it("scan_repo advances connect → reading_code → classify and emits scan", async () => {
    await h["compile.scan_repo"]({ repo_path: FOLK });
    const phases = stream.phaseOrderFor(bootstrap.getRunId()!);
    expect(phases).toEqual(["connect", "reading_code", "classify"]);
    expect(stream.eventsOf("scan")).toHaveLength(1);
  });

  it("scan_repo emits a vault event for every RED call site (D8 low_static_prior)", async () => {
    const report = (await h["compile.scan_repo"]({ repo_path: FOLK })) as ScanReport;
    const reds = report.call_sites.filter((c) => c.priors.pill === "red");
    const vaultEvents = stream.eventsOf("vault");
    expect(vaultEvents).toHaveLength(reds.length);
    for (const ev of vaultEvents) {
      expect(ev.event.entry.kind).toBe("negative");
      if (ev.event.entry.kind === "negative") {
        expect(ev.event.entry.reason).toBe("low_static_prior");
        expect(ev.event.entry.retry_policy).toEqual(
          RETRY_POLICY_BY_REASON.low_static_prior,
        );
      }
    }
  });

  it("synthetic_confirm advances reading_docs → expanding → stress_test → clusters_revealed and streams cells + run_complete", async () => {
    const report = (await h["compile.scan_repo"]({ repo_path: FOLK })) as ScanReport;
    const green = report.call_sites.find((c) => c.priors.pill === "green")!;

    await h["compile.synthetic_confirm"]({
      call_site_id: green.call_site_id,
      total_calls: 200,
      oracle_fraction: 0.05,
      worker_count: 4,
    });

    const phases = stream.phaseOrderFor(bootstrap.getRunId()!);
    expect(phases).toEqual([
      "connect",
      "reading_code",
      "classify",
      "reading_docs",
      "expanding",
      "stress_test",
      "clusters_revealed",
    ]);

    // Page indices monotonic 1 → N.
    const indices = phases.map((p) => PHASE_INDEX[p]);
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]!).toBeGreaterThan(indices[i - 1]!);
    }

    // One cell per Stage-2 call (DESIGN.md: "one row per completed call").
    const cells = stream.eventsOf("cell");
    expect(cells.length).toBe(200);
    expect(cells.every((c) => c.cell.status === "done")).toBe(true);

    // run_complete fires exactly once.
    expect(stream.eventsOf("run_complete")).toHaveLength(1);

    // Live metrics + cluster snapshots fired periodically + on completion.
    expect(stream.eventsOf("live_metrics").length).toBeGreaterThan(0);
    expect(stream.eventsOf("cluster_snapshot").length).toBeGreaterThan(0);

    // current_call_site_id is threaded so Page 6 chrome can render
    // "STRESS TEST: <call_site_id>" per ENG_REVIEW D7.
    const stressEntry = stream.events.find(
      (e) => e.kind === "phase" && e.doc.phase === "stress_test",
    );
    expect(stressEntry).toBeDefined();
    if (stressEntry?.kind === "phase") {
      expect(stressEntry.doc.current_call_site_id).toBe(green.call_site_id);
    }
  });

  it("request_synthesis advances to agent_writing and emits spec_returned", async () => {
    const report = (await h["compile.scan_repo"]({ repo_path: FOLK })) as ScanReport;
    const green = report.call_sites.find((c) => c.priors.pill === "green")!;
    await h["compile.synthetic_confirm"]({
      call_site_id: green.call_site_id,
      total_calls: 200,
      oracle_fraction: 0.05,
      worker_count: 4,
    });

    await h["compile.request_synthesis"]({
      cluster_id: `cl_${green.call_site_id}`,
    });

    const phases = stream.phaseOrderFor(bootstrap.getRunId()!);
    expect(phases.at(-1)).toBe("agent_writing");

    const synthesisEvents = stream.eventsOf("synthesis");
    expect(synthesisEvents).toHaveLength(1);
    expect(synthesisEvents[0]!.event.stage).toBe("spec_returned");
  });

  it("submit_synthesis (passing) advances validate → vault_write and emits the full lifecycle", async () => {
    const report = (await h["compile.scan_repo"]({ repo_path: FOLK })) as ScanReport;
    const green = report.call_sites.find(
      (c) => c.priors.pill === "green" && c.function_hint === "classify_message_intent",
    )!;
    await h["compile.synthetic_confirm"]({
      call_site_id: green.call_site_id,
      total_calls: 300,
      oracle_fraction: 0.03,
      worker_count: 4,
    });
    const cluster_id = `cl_${green.call_site_id}`;
    const spec = (await h["compile.request_synthesis"]({ cluster_id })) as {
      request_id: string;
    };
    // Envelope mirrors the candidate-path stub for classify_message_intent
    // — copied from v7-bootstrap.test.ts where it's the canonical passing
    // case for the holdout gate.
    const envelope: SynthesisSuccess = {
      synthesizable: true,
      tier: "tier_1",
      confidence: 0.95,
      function_name: "classify_intent",
      description: "Classify inbound message intent from text",
      code: `
        import { llmFallback } from "./_runtime";
        // Mirrors the oracle stub's classify_message_intent classifier EXACTLY
        // — same regex order, same labels — so the holdout gate passes.
        export function classify_intent(input: { text: string }) {
          const text = String(input?.text ?? "");
          const intent = /\\?$|\\bcan you\\b|\\bwhat\\b|\\bhow\\b|\\bwhen\\b/i.test(text)
            ? "question"
            : /\\b(meeting|call|dinner|lunch|coffee|tomorrow|tonight|when)\\b/i.test(text)
              ? "logistics"
              : /\\b(love|miss|sorry|hate|hurts|happy|excited)\\b/i.test(text)
                ? "emotional"
                : /^\\s*(hey|hi|hello|yo|sup|wassup)\\b/i.test(text)
                  ? "greeting"
                  : /\\b(buy|sale|free|click|link|http)\\b/i.test(text)
                    ? "spam"
                    : "task";
          return {
            intent,
            requires_reply: intent !== "spam" && intent !== "greeting",
            confidence: 0.91,
          };
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
      estimated_savings_per_call_usd: 0.0019,
      reasoning: "deterministic regex classifier mirroring stub oracle",
    };
    const result = (await h["compile.submit_synthesis"]({
      request_id: spec.request_id,
      envelope,
    })) as { gate_verdict: string };
    expect(result.gate_verdict).toBe("pass");

    const phases = stream.phaseOrderFor(bootstrap.getRunId()!);
    // After full pipeline the demo has reached vault_write (page 10).
    expect(phases.at(-1)).toBe("vault_write");
    expect(PHASE_INDEX[phases.at(-1)!]).toBe(10);

    const stages = stream.eventsOf("synthesis").map((e) => e.event.stage);
    expect(stages).toEqual([
      "spec_returned",
      "code_emitted",
      "validating",
      "passed",
    ]);

    // Vault events: RED-site negatives from scan + the positive write.
    const vaultEvents = stream.eventsOf("vault");
    expect(vaultEvents.some((e) => e.event.entry.kind === "positive")).toBe(true);
  });

  it("phase enum matches the canonical ENG_REVIEW D7 page order", () => {
    expect(BOOTSTRAP_PHASES).toEqual([
      "connect",
      "reading_code",
      "classify",
      "reading_docs",
      "expanding",
      "stress_test",
      "clusters_revealed",
      "agent_writing",
      "validate",
      "vault_write",
      "result",
    ]);
    // Page indices are 1..11.
    BOOTSTRAP_PHASES.forEach((p, i) => {
      expect(PHASE_INDEX[p]).toBe(i + 1);
    });
  });
});
