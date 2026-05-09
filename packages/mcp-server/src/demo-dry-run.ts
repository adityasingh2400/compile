/**
 * Demo dry-run: walks the full Compile demo flow through real services and
 * reports pass/fail + timing per beat.
 *
 * Run with: `npm run demo:dry-run` (loads .env.local).
 *
 * What it exercises (in demo order):
 *   1. compile.scan_repo           — Lane E scanner against data/acme-agent
 *   2. compile.synthetic_confirm   — Stage-2 fan-out (downscaled to 500
 *                                    calls so this finishes in ~2s)
 *   3. compile.list_codify_candidates
 *   4. compile.request_synthesis   — returns the synthesis spec
 *   5. compile.submit_synthesis    — gate via real Tensorlake sandbox
 *   6. compile.run_codified (tier_1)
 *   7. compile.run_codified (tier_2) — real Phi-3-mini in Tensorlake
 *
 * Real services engaged when env keys are set:
 *   - TENSORLAKE_API_KEY    → real sandbox compute (gate + Phi)
 *   - ANTHROPIC_API_KEY     → real frontier oracle (Stage-2 1% sample)
 *   - NIA_API_KEY + VAULT   → real Nia (vault read/write + doc grounding)
 *
 * Anything missing falls back to the local stub for that surface, so this
 * script also works fully offline as a sanity check.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createNiaClient } from "@compile/nia";
import { MemoryReceiptStore } from "@compile/identifier";
import { MemoryBootstrapStream } from "@compile/stream";
import {
  LocalFakeTensorlakeClient,
  RealTensorlakeClient,
  TensorlakeWithLocalFallback,
  type ITensorlakeClient,
} from "@compile/runtime";
import {
  AnthropicOracleClient,
  BudgetedOracleClient,
  OracleWithLocalFallback,
  StubOracleClient,
  type IOracleClient,
} from "@compile/synth-loader";
import { MemoryRequestStore } from "./store.js";
import { buildHandlers, MemoryBootstrapStore } from "./handlers.js";
import type {
  ScanReport,
  SyntheticRun,
  CallSiteDescriptor,
} from "@compile/schemas";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ACME = resolve(__dirname, "../../../data/acme-agent");

interface BeatResult {
  name: string;
  ok: boolean;
  ms: number;
  detail?: string;
  error?: string;
}

const beats: BeatResult[] = [];

async function beat<T>(name: string, fn: () => Promise<T>, detail?: (r: T) => string): Promise<T | undefined> {
  const t0 = performance.now();
  try {
    const out = await fn();
    const ms = performance.now() - t0;
    beats.push({ name, ok: true, ms, detail: detail?.(out) });
    console.log(`  ✓ ${name} (${ms.toFixed(0)}ms)${detail ? ` — ${detail(out)}` : ""}`);
    return out;
  } catch (err) {
    const ms = performance.now() - t0;
    const msg = err instanceof Error ? err.message : String(err);
    beats.push({ name, ok: false, ms, error: msg });
    console.error(`  ✗ ${name} (${ms.toFixed(0)}ms) — ${msg}`);
    return undefined;
  }
}

function buildTensorlake(): { client: ITensorlakeClient; mode: string } {
  const fallback = new LocalFakeTensorlakeClient();
  if (!process.env.TENSORLAKE_API_KEY) return { client: fallback, mode: "local-fake" };
  const real = new RealTensorlakeClient({
    apiKey: process.env.TENSORLAKE_API_KEY,
    endpoint: process.env.TENSORLAKE_ENDPOINT,
    phiImage: process.env.COMPILE_PHI_IMAGE ?? "compile-phi-mini",
    phiModel: process.env.COMPILE_PHI_MODEL ?? "phi3:mini",
  });
  return { client: new TensorlakeWithLocalFallback(real, fallback), mode: "real (with local fallback)" };
}

function buildOracle(): { client: IOracleClient; mode: string } {
  if (!process.env.ANTHROPIC_API_KEY) return { client: new StubOracleClient(), mode: "stub" };
  const real = new AnthropicOracleClient({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.COMPILE_ORACLE_MODEL ?? "claude-sonnet-4-6",
  });
  const budgetUsd = parseFloat(process.env.COMPILE_ORACLE_BUDGET_USD ?? "5");
  const budgeted = new BudgetedOracleClient(real, {
    budgetUsd,
    onTrip: (spent, cap) =>
      console.error(`[oracle] budget tripped: ${spent.toFixed(4)}/${cap} USD`),
  });
  const stub = new StubOracleClient();
  return {
    client: new OracleWithLocalFallback(budgeted, stub),
    mode: `anthropic (budget=$${budgetUsd}, fallback=stub)`,
  };
}

async function main(): Promise<void> {
  const tStart = performance.now();
  console.log("=== Compile demo dry-run ===\n");

  // ── Service selection ──
  const nia = createNiaClient();
  const niaMode = nia.constructor.name;
  const { client: tensorlake, mode: tlMode } = buildTensorlake();
  const { client: oracle, mode: oracleMode } = buildOracle();
  const stream = new MemoryBootstrapStream();

  console.log("Services:");
  console.log(`  nia        : ${niaMode}`);
  console.log(`  tensorlake : ${tlMode}`);
  console.log(`  oracle     : ${oracleMode}`);
  console.log(`  stream     : MemoryBootstrapStream (in-process capture)\n`);

  const h = buildHandlers({
    nia,
    store: new MemoryRequestStore(),
    receipts: new MemoryReceiptStore(),
    bootstrap: new MemoryBootstrapStore(),
    stream,
    tensorlake,
    oracle,
  });

  // ── Beat 1: scan_repo ──
  console.log("▶ Beat 1 — scan_repo (Lane E scanner against Acme)");
  const report = (await beat(
    "scan_repo",
    () => h["compile.scan_repo"]({ repo_path: ACME }) as Promise<ScanReport>,
    (r) =>
      `${r.call_sites.length} sites, pills=${["green", "yellow", "red"]
        .map((p) => `${p}:${r.call_sites.filter((c) => c.priors.pill === p).length}`)
        .join(",")}`,
  )) as ScanReport | undefined;
  if (!report) return finish();

  const green = report.call_sites.find(
    (c) => c.priors.pill === "green" && c.function_hint === "classify_ticket_priority",
  );
  if (!green) {
    console.error("FAIL: no green classify_ticket_priority call site found in Acme");
    return finish();
  }

  // ── Beat 2: synthetic_confirm ──
  console.log(`\n▶ Beat 2 — synthetic_confirm (${green.call_site_id}, n=500 downscaled)`);
  const run = (await beat(
    "synthetic_confirm",
    () =>
      h["compile.synthetic_confirm"]({
        call_site_id: green.call_site_id,
        total_calls: 500,
        oracle_fraction: 0.02,
        worker_count: 8,
      }) as Promise<SyntheticRun>,
    (r) =>
      `passes_gate=${r.passes_synthesis_gate}, tier_mix=${JSON.stringify(r.tier_mix)}, clusters=${r.clusters.length}`,
  )) as SyntheticRun | undefined;
  if (!run) return finish();

  // ── Beat 3: list_codify_candidates ──
  console.log("\n▶ Beat 3 — list_codify_candidates");
  const list = (await beat(
    "list_codify_candidates",
    () => h["compile.list_codify_candidates"]({ limit: 5 }) as Promise<{
      candidates: Array<{ cluster_id: string; passes_synthesis_gate: boolean }>;
    }>,
    (r) => `${r.candidates.length} candidates, ${r.candidates.filter((c) => c.passes_synthesis_gate).length} pass gate`,
  )) as { candidates: Array<{ cluster_id: string; passes_synthesis_gate: boolean }> } | undefined;
  if (!list) return finish();
  const top = list.candidates.find((c) => c.passes_synthesis_gate);
  if (!top) {
    console.error("FAIL: no candidate passes the synthesis gate");
    return finish();
  }

  // ── Beat 4: request_synthesis ──
  console.log(`\n▶ Beat 4 — request_synthesis (${top.cluster_id})`);
  const spec = (await beat(
    "request_synthesis",
    () =>
      h["compile.request_synthesis"]({ cluster_id: top.cluster_id }) as Promise<{
        request_id: string;
        cluster_id: string;
        traces: unknown[];
        holdout_count: number;
      }>,
    (r) => `request_id=${r.request_id.slice(0, 8)}…, traces=${r.traces.length}, holdout=${r.holdout_count}`,
  )) as { request_id: string; cluster_id: string; traces: unknown[]; holdout_count: number } | undefined;
  if (!spec) return finish();

  // ── Beat 5: submit_synthesis (gate via real Tensorlake) ──
  console.log("\n▶ Beat 5 — submit_synthesis (gate runs in real Tensorlake sandbox)");
  const envelope = {
    synthesizable: true as const,
    tier: "tier_1" as const,
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
      input_schema: { type: "object" as const },
      output_schema: { type: "object" as const },
      preconditions: [],
      doc_dependencies: [],
    },
    fallback_strategy: "frontier_llm" as const,
    estimated_savings_per_call_usd: 0.04,
    reasoning: "deterministic regex classifier",
  };
  const submit = (await beat(
    "submit_synthesis",
    () =>
      h["compile.submit_synthesis"]({
        request_id: spec.request_id,
        envelope,
      }) as Promise<{ gate_verdict: "pass" | "fail"; function_id?: string; failure_reason?: string }>,
    (r) =>
      r.gate_verdict === "pass"
        ? `function_id=${r.function_id?.slice(0, 12)}…`
        : `FAIL: ${r.failure_reason}`,
  )) as { gate_verdict: "pass" | "fail"; function_id?: string; failure_reason?: string } | undefined;
  if (!submit || submit.gate_verdict !== "pass" || !submit.function_id) return finish();

  // ── Beat 6: run_codified tier_1 ──
  console.log("\n▶ Beat 6 — run_codified (tier_1, in-process)");
  await beat(
    "run_codified.tier_1",
    () =>
      h["compile.run_codified"]({
        function_id: submit.function_id!,
        input: { text: "system down for tenant 42, severity P0" },
      }) as Promise<{ output: { priority: string }; tier_used: string; latency_ms: number }>,
    (r) => `priority=${r.output.priority}, tier=${r.tier_used}, ${r.latency_ms.toFixed(2)}ms`,
  );

  // ── Beat 7: run_codified tier_2 (real Phi in Tensorlake) ──
  // Skip this beat if Tensorlake isn't real — tier_2 throws when no client.
  if (process.env.TENSORLAKE_API_KEY && process.env.COMPILE_SKIP_PHI !== "1") {
    console.log("\n▶ Beat 7 — run_codified (tier_2, real Phi-3-mini in Tensorlake)");
    console.log("  (cold start: ~20s sandbox boot + model load)");
    // Construct a tier_2 envelope to run. We use a fresh request to avoid
    // disturbing the tier_1 function we just gated.
    const phiEnvelope = {
      ...envelope,
      tier: "tier_2" as const,
      function_name: "phi_classify",
      // The "code" field for tier_2 is the prompt template.
      code: "You classify support tickets. Output a JSON object with key `priority` set to one of: P0, P1, P2.",
    };
    // Build a temporary phi vault entry to feed runCodified through the
    // executor's tier_2 path. The MCP gate path doesn't accept tier_2
    // envelopes today (it always runs through compileFunction), so we
    // exercise runPhi through the runtime directly for this beat.
    await beat(
      "run_codified.tier_2",
      async () => {
        const result = await tensorlake.runPhi({
          prompt: phiEnvelope.code,
          input: { text: "Server is on fire, P0 incident" },
        });
        return result;
      },
      (r) => `output=${JSON.stringify(r.output).slice(0, 80)}, ${r.latency_ms.toFixed(0)}ms`,
    );
  } else {
    console.log("\n▶ Beat 7 — run_codified tier_2 SKIPPED (no TENSORLAKE_API_KEY or COMPILE_SKIP_PHI=1)");
  }

  // ── Stream verification ──
  console.log("\n▶ Stream verification (Lane C subscribes to these)");
  const phaseEvents = stream.eventsOf("phase");
  const cellEvents = stream.eventsOf("cell");
  const clusterEvents = stream.eventsOf("cluster_snapshot");
  const synthEvents = stream.eventsOf("synthesis");
  const vaultEvents = stream.eventsOf("vault");
  console.log(`  phase advances : ${phaseEvents.length}`);
  console.log(`  cells          : ${cellEvents.length}`);
  console.log(`  cluster snaps  : ${clusterEvents.length}`);
  console.log(`  synth events   : ${synthEvents.length}`);
  console.log(`  vault events   : ${vaultEvents.length}`);

  // Cleanup any sandboxes the real client may have created.
  if (tensorlake instanceof TensorlakeWithLocalFallback) {
    // close() on the wrapper isn't part of the interface; if the inner Real
    // client has one, call it.
    const inner = (tensorlake as unknown as { primary?: { close?: () => Promise<void> } }).primary;
    if (inner?.close) {
      try { await inner.close(); console.log("\n[cleanup] terminated Tensorlake sandboxes"); } catch {}
    }
  }

  finish();
}

function finish(): void {
  const total = beats.reduce((s, b) => s + b.ms, 0);
  const passed = beats.filter((b) => b.ok).length;
  const failed = beats.filter((b) => !b.ok).length;

  console.log("\n=== Report card ===");
  for (const b of beats) {
    const mark = b.ok ? "✓" : "✗";
    const tag = b.ok ? "PASS" : "FAIL";
    console.log(`  ${mark} ${tag.padEnd(4)} ${b.name.padEnd(28)} ${b.ms.toFixed(0).padStart(6)}ms${b.error ? `  err=${b.error.slice(0, 80)}` : ""}`);
  }
  console.log(`\n  total: ${total.toFixed(0)}ms across ${beats.length} beats — ${passed} pass, ${failed} fail`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[dry-run] fatal:", err);
  finish();
});
