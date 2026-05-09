/**
 * Real-repo end-to-end flow test for Compile.
 *
 * Goal: prove the published `@compile/mcp` works against an arbitrary
 * real-world TypeScript repo (default: chatbot-ui), not just the synthetic
 * `data/folk-agent` shipped in this monorepo.
 *
 * Walks scan_repo → synthetic_confirm → list_codify_candidates →
 * request_synthesis → submit_synthesis using a generic pick-best-site
 * strategy and a generic envelope. Reports per-beat pass/fail.
 *
 *   node --import tsx scripts/test-real-repo-flow.ts /tmp/chatbot-ui [n_calls]
 */
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
import { MemoryRequestStore } from "../packages/mcp-server/src/store.js";
import {
  buildHandlers,
  MemoryBootstrapStore,
} from "../packages/mcp-server/src/handlers.js";
import type { ScanReport, SyntheticRun, CallSiteDescriptor } from "@compile/schemas";

const target = process.argv[2] ?? "/tmp/chatbot-ui";
const totalCalls = Number(process.argv[3] ?? "200");

interface Beat {
  name: string;
  ok: boolean;
  ms: number;
  detail?: string;
  error?: string;
}
const beats: Beat[] = [];

async function beat<T>(
  name: string,
  fn: () => Promise<T>,
  detail?: (r: T) => string,
): Promise<T | undefined> {
  const t0 = performance.now();
  try {
    const out = await fn();
    const ms = performance.now() - t0;
    beats.push({ name, ok: true, ms, detail: detail?.(out) });
    console.log(`  ✓ ${name} (${ms.toFixed(0)}ms)${detail ? ` — ${detail(out)}` : ""}`);
    return out;
  } catch (err) {
    const ms = performance.now() - t0;
    const msg = err instanceof Error ? err.stack ?? err.message : String(err);
    beats.push({ name, ok: false, ms, error: msg });
    console.error(`  ✗ ${name} (${ms.toFixed(0)}ms)\n${msg}`);
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
  return {
    client: new TensorlakeWithLocalFallback(real, fallback),
    mode: "real (with local fallback)",
  };
}

function buildOracle(): { client: IOracleClient; mode: string } {
  if (!process.env.ANTHROPIC_API_KEY) return { client: new StubOracleClient(), mode: "stub" };
  const real = new AnthropicOracleClient({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.COMPILE_ORACLE_MODEL ?? "claude-sonnet-4-6",
  });
  const budgetUsd = parseFloat(process.env.COMPILE_ORACLE_BUDGET_USD ?? "1");
  const budgeted = new BudgetedOracleClient(real, {
    budgetUsd,
    onTrip: (s, c) => console.error(`[oracle] budget tripped: ${s.toFixed(4)}/${c} USD`),
  });
  return {
    client: new OracleWithLocalFallback(budgeted, new StubOracleClient()),
    mode: `anthropic (budget=$${budgetUsd}, fallback=stub)`,
  };
}

function pickBestSite(report: ScanReport): CallSiteDescriptor | undefined {
  const score = (c: CallSiteDescriptor) =>
    c.priors.determinism_prior +
    c.priors.schema_stability_prior +
    c.priors.economic_value_prior;
  const sorted = [...report.call_sites].sort((a, b) => score(b) - score(a));
  return sorted[0];
}

async function main() {
  console.log(`=== Compile real-repo flow test ===`);
  console.log(`target:      ${target}`);
  console.log(`total_calls: ${totalCalls}\n`);

  const nia = createNiaClient();
  const { client: tensorlake, mode: tlMode } = buildTensorlake();
  const { client: oracle, mode: oracleMode } = buildOracle();
  const stream = new MemoryBootstrapStream();

  console.log("Services:");
  console.log(`  nia        : ${nia.constructor.name}`);
  console.log(`  tensorlake : ${tlMode}`);
  console.log(`  oracle     : ${oracleMode}\n`);

  const h = buildHandlers({
    nia,
    store: new MemoryRequestStore(),
    receipts: new MemoryReceiptStore(),
    bootstrap: new MemoryBootstrapStore(),
    stream,
    tensorlake,
    oracle,
  });

  console.log(`▶ Beat 1 — scan_repo (${target})`);
  const report = (await beat(
    "scan_repo",
    () => h["compile.scan_repo"]({ repo_path: target }) as Promise<ScanReport>,
    (r) =>
      `${r.files_scanned} files, ${r.call_sites.length} sites, pills=${["green", "yellow", "red"]
        .map((p) => `${p}:${r.call_sites.filter((c) => c.priors.pill === p).length}`)
        .join(",")}`,
  )) as ScanReport | undefined;
  if (!report) return finish();

  if (report.call_sites.length === 0) {
    console.error("FAIL: scanner found 0 call sites in this repo");
    return finish();
  }

  const pick = pickBestSite(report);
  if (!pick) return finish();
  console.log(
    `\n  → picked site: ${pick.file_path}:${pick.line} (${pick.provider}) ` +
      `pill=${pick.priors.pill} ` +
      `det=${pick.priors.determinism_prior.toFixed(2)} ` +
      `schema=${pick.priors.schema_stability_prior.toFixed(2)} ` +
      `econ=${pick.priors.economic_value_prior.toFixed(2)}`,
  );

  console.log(`\n▶ Beat 2 — synthetic_confirm (n=${totalCalls})`);
  const run = (await beat(
    "synthetic_confirm",
    () =>
      h["compile.synthetic_confirm"]({
        call_site_id: pick.call_site_id,
        total_calls: totalCalls,
        oracle_fraction: 0.02,
        worker_count: 8,
      }) as Promise<SyntheticRun>,
    (r) =>
      `passes_gate=${r.passes_synthesis_gate} ` +
      `tier_mix=${JSON.stringify(r.tier_mix)} ` +
      `clusters=${r.clusters.length}`,
  )) as SyntheticRun | undefined;
  if (!run) return finish();

  console.log(`\n▶ Beat 3 — list_codify_candidates`);
  const list = (await beat(
    "list_codify_candidates",
    () =>
      h["compile.list_codify_candidates"]({ limit: 5 }) as Promise<{
        candidates: Array<{ cluster_id: string; passes_synthesis_gate: boolean }>;
      }>,
    (r) =>
      `${r.candidates.length} candidates (${r.candidates.filter((c) => c.passes_synthesis_gate).length} pass gate)`,
  )) as
    | { candidates: Array<{ cluster_id: string; passes_synthesis_gate: boolean }> }
    | undefined;
  if (!list) return finish();

  const top = list.candidates.find((c) => c.passes_synthesis_gate) ?? list.candidates[0];
  if (!top) {
    console.log("\n  (no candidates returned — synthesis flow ends here for this repo)");
    return finish();
  }
  if (!run.passes_synthesis_gate) {
    console.log(
      `\n  Note: site did not pass the synthesis gate (expected for many real sites — ` +
        `most chatbot routes have free-form output). request_synthesis will exit early.`,
    );
  }

  console.log(`\n▶ Beat 4 — request_synthesis (${top.cluster_id})`);
  const spec = (await beat(
    "request_synthesis",
    () =>
      h["compile.request_synthesis"]({ cluster_id: top.cluster_id }) as Promise<{
        request_id: string;
        traces: unknown[];
        holdout_count: number;
      }>,
    (r) =>
      `request_id=${r.request_id.slice(0, 8)}…, traces=${r.traces.length}, holdout=${r.holdout_count}`,
  )) as
    | { request_id: string; traces: unknown[]; holdout_count: number }
    | undefined;

  if (spec) {
    console.log(`\n▶ Beat 5 — submit_synthesis (generic pass-through envelope)`);
    const envelope = {
      synthesizable: true as const,
      tier: "tier_1" as const,
      confidence: 0.6,
      function_name: "echo_passthrough",
      description:
        "Generic identity passthrough — proves the gate accepts arbitrary tier_1 code.",
      code: `
        export function echo_passthrough(input) {
          return { ok: true, input };
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
      estimated_savings_per_call_usd: 0.01,
      reasoning: "smoke-test envelope to confirm the gate path runs end to end",
    };
    await beat(
      "submit_synthesis",
      () =>
        h["compile.submit_synthesis"]({
          request_id: spec.request_id,
          envelope,
        }) as Promise<{
          gate_verdict: "pass" | "fail";
          function_id?: string;
          failure_reason?: string;
        }>,
      (r) =>
        r.gate_verdict === "pass"
          ? `function_id=${r.function_id?.slice(0, 12)}…`
          : `gate verdict=fail (${r.failure_reason ?? "no reason"}) — expected for generic envelope`,
    );
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
    const errLine = b.error ? `  err=${b.error.split("\n")[0].slice(0, 100)}` : "";
    console.log(
      `  ${mark} ${tag.padEnd(4)} ${b.name.padEnd(25)} ${b.ms.toFixed(0).padStart(6)}ms${errLine}`,
    );
  }
  console.log(
    `\n  total: ${total.toFixed(0)}ms across ${beats.length} beats — ${passed} pass, ${failed} fail`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[real-repo-flow] fatal:", err);
  finish();
});
