/**
 * Real-repo end-to-end flow test for Compile.
 *
 * Drives the whole pipeline against an arbitrary public TS repo:
 *   1. scan_repo                — TS AST scan, picks best-prior call site
 *   2. synthetic_confirm        — N concurrent calls in Tensorlake sandboxes,
 *                                 cluster + analyse via real frontier oracle
 *   3. request_synthesis        — assembles SynthesisSpec + holdout traces
 *   4. (agent) emits envelope   — Anthropic Haiku via the synthesizer prompt
 *                                 (same tool-use contract as the Friday harness)
 *   5. submit_synthesis         — gate runs the agent's code in Tensorlake
 *                                 against the holdout
 *   6. run_codified             — executes the gated function
 *
 * Usage:
 *   unset ANTHROPIC_API_KEY      # so .env.local wins
 *   node --env-file=.env.local --import tsx \
 *     scripts/test-real-repo-flow.ts /tmp/chatbot-ui 1000
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
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
import {
  loadSynthesizerPrompt,
  validateEnvelope,
} from "@compile/synthesizer";
import {
  SynthesisSuccessSchema,
  SynthesisNegativeSchema,
} from "@compile/schemas";
import { MemoryRequestStore } from "../packages/mcp-server/src/store.js";
import {
  buildHandlers,
  MemoryBootstrapStore,
} from "../packages/mcp-server/src/handlers.js";
import type {
  ScanReport,
  SyntheticRun,
  CallSiteDescriptor,
  SynthesisSpec,
} from "@compile/schemas";

const target = process.argv[2] ?? "/tmp/chatbot-ui";
const totalCalls = Number(process.argv[3] ?? "50");
const workerCount = Number(process.argv[4] ?? totalCalls); // fully concurrent by default
const SYNTH_MODEL = process.env.COMPILE_SYNTHESIZER_MODEL ?? "claude-haiku-4-5";
const SYNTH_TIMEOUT_MS = Number(process.env.COMPILE_SYNTHESIZER_TIMEOUT_MS ?? "60000");

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
  return {
    client: new TensorlakeWithLocalFallback(real, fallback),
    mode: "real (with local fallback)",
  };
}

function buildOracle(): { client: IOracleClient; mode: string } {
  if (!process.env.ANTHROPIC_API_KEY) return { client: new StubOracleClient(), mode: "stub" };
  const model = process.env.COMPILE_ORACLE_MODEL ?? "claude-haiku-4-5";
  const real = new AnthropicOracleClient({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model,
    // Haiku 4.5 pricing (≈ $1 / $5 per M tokens) so the budget tracker doesn't
    // 3× overcount and trip early. Override the Sonnet defaults.
    inputUsdPerToken: 1 / 1_000_000,
    outputUsdPerToken: 5 / 1_000_000,
  });
  const budgetUsd = parseFloat(process.env.COMPILE_ORACLE_BUDGET_USD ?? "1");
  const budgeted = new BudgetedOracleClient(real, {
    budgetUsd,
    onTrip: (s, c) => console.error(`[oracle] budget tripped: ${s.toFixed(4)}/${c} USD`),
  });
  return {
    client: new OracleWithLocalFallback(budgeted, new StubOracleClient()),
    mode: `anthropic ${model} (budget=$${budgetUsd}, fallback=stub)`,
  };
}

function pickBestSite(report: ScanReport): CallSiteDescriptor | undefined {
  const score = (c: CallSiteDescriptor) =>
    c.priors.determinism_prior +
    c.priors.schema_stability_prior +
    c.priors.economic_value_prior;
  return [...report.call_sites].sort((a, b) => score(b) - score(a))[0];
}

/**
 * Anthropic tool-use schemas — same approach the Friday harness uses. Two
 * tools (success + negative) so the model picks one; cleaner than free-form
 * JSON in messages.
 */
function toJsonSchema(s: typeof SynthesisSuccessSchema | typeof SynthesisNegativeSchema): Record<string, unknown> {
  const schema = zodToJsonSchema(s, { $refStrategy: "none" }) as Record<string, unknown>;
  delete schema.$schema;
  delete (schema as { additionalProperties?: unknown }).additionalProperties;
  return schema;
}
const SUCCESS_TOOL = {
  name: "emit_synthesis_success",
  description:
    "Call this when the cluster IS codifiable. Emits a typed function (Tier 1) or prompt pack (Tier 2). Set synthesizable=true.",
  input_schema: toJsonSchema(SynthesisSuccessSchema),
};
const NEGATIVE_TOOL = {
  name: "emit_synthesis_negative",
  description:
    "Call this when the cluster is NOT codifiable on inspection. Set synthesizable=false. Pick the reason from the enum.",
  input_schema: toJsonSchema(SynthesisNegativeSchema),
};

async function callSynthesizer(
  client: Anthropic,
  prompt: string,
  spec: SynthesisSpec,
): Promise<unknown> {
  const userMsg = `SYNTHESIS_SPEC:\n${JSON.stringify(spec, null, 2)}\n\nCall exactly one of: emit_synthesis_success (when codifiable) or emit_synthesis_negative (when not). Do not respond in text.`;
  const resp = await Promise.race([
    client.messages.create({
      model: SYNTH_MODEL,
      max_tokens: 4000,
      system: prompt,
      tools: [SUCCESS_TOOL, NEGATIVE_TOOL],
      tool_choice: { type: "any" },
      messages: [{ role: "user", content: userMsg }],
    }),
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error(`synthesizer timeout after ${SYNTH_TIMEOUT_MS}ms`)), SYNTH_TIMEOUT_MS),
    ),
  ]);
  const toolUse = resp.content.find(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) throw new Error("synthesizer did not call any tool");
  return toolUse.input;
}

async function main() {
  console.log(`=== Compile real-repo full pipeline test ===`);
  console.log(`target:           ${target}`);
  console.log(`total_calls:      ${totalCalls}`);
  console.log(`worker_count:     ${workerCount} (concurrent)`);
  console.log(`synthesizer:      ${SYNTH_MODEL}\n`);

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

  // ── Beat 1: scan_repo ──
  console.log(`▶ Beat 1 — scan_repo (${target})`);
  const report = (await beat(
    "scan_repo",
    () => h["compile.scan_repo"]({ repo_path: target }) as Promise<ScanReport>,
    (r) =>
      `${r.files_scanned} files, ${r.call_sites.length} sites, pills=${["green", "yellow", "red"]
        .map((p) => `${p}:${r.call_sites.filter((c) => c.priors.pill === p).length}`)
        .join(",")}`,
  )) as ScanReport | undefined;
  if (!report || report.call_sites.length === 0) return finish();

  const pick = pickBestSite(report);
  if (!pick) return finish();
  console.log(
    `\n  → picked site: ${pick.file_path}:${pick.line} (${pick.provider}) ` +
      `pill=${pick.priors.pill} ` +
      `det=${pick.priors.determinism_prior.toFixed(2)} ` +
      `schema=${pick.priors.schema_stability_prior.toFixed(2)} ` +
      `econ=${pick.priors.economic_value_prior.toFixed(2)}`,
  );

  // ── Beat 2: synthetic_confirm ──
  console.log(`\n▶ Beat 2 — synthetic_confirm (n=${totalCalls} concurrent in Tensorlake)`);
  const run = (await beat(
    "synthetic_confirm",
    () =>
      h["compile.synthetic_confirm"]({
        call_site_id: pick.call_site_id,
        total_calls: totalCalls,
        oracle_fraction: 0.04, // ≈ 2 oracle calls at n=50, keeps cost <<$0.01
        worker_count: workerCount,
      }) as Promise<SyntheticRun>,
    (r) =>
      `passes_gate=${r.passes_synthesis_gate} ` +
      `tier_mix=${JSON.stringify(r.tier_mix)} ` +
      `clusters=${r.clusters.length} ` +
      `traces_preserved=${r.preserved_traces.length}`,
  )) as SyntheticRun | undefined;
  if (!run) return finish();

  // ── Beat 3: request_synthesis (force-construct cluster_id from the run) ──
  // The bootstrap-keyed cluster id format is `cl_${call_site_id}` per
  // handlers.ts:runToCandidate. We don't filter through list_codify_candidates
  // here because we want to drive the synthesis pipeline even when the
  // Stage-2 gate said "not codifiable" — the agent's job is to make that
  // call independently from the spec.
  const cluster_id = `cl_${run.call_site_id}`;
  console.log(`\n▶ Beat 3 — request_synthesis (${cluster_id})`);
  const spec = (await beat(
    "request_synthesis",
    () =>
      h["compile.request_synthesis"]({ cluster_id }) as Promise<
        SynthesisSpec | { negative_cached: true; reason?: string }
      >,
    (r) =>
      "negative_cached" in r
        ? `negative_cached: ${(r as { reason?: string }).reason ?? "?"}`
        : `request_id=${r.request_id.slice(0, 8)}…, traces=${r.traces.length}, holdout (private)`,
  )) as SynthesisSpec | { negative_cached: true } | undefined;
  if (!spec || "negative_cached" in spec) return finish();

  // ── Beat 4: agent emits envelope (Anthropic Haiku via synthesizer prompt) ──
  console.log(`\n▶ Beat 4 — agent synthesizes code (${SYNTH_MODEL} + synthesizer prompt + tool-use)`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("  ✗ ANTHROPIC_API_KEY not set — skipping agent + gate beats");
    return finish();
  }
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const synthPrompt = await loadSynthesizerPrompt();

  const rawEnvelope = (await beat(
    "agent_emit_envelope",
    () => callSynthesizer(anthropic, synthPrompt, spec),
    (env) => {
      const e = env as Record<string, unknown>;
      if (e.synthesizable === true) {
        return `synthesizable=true tier=${e.tier} fn=${e.function_name}`;
      }
      return `synthesizable=false reason=${(e as { reason?: string }).reason ?? "?"}`;
    },
  )) as unknown;
  if (rawEnvelope === undefined) return finish();

  // Validate the agent's envelope before submitting (mirrors what
  // submit_synthesis does internally — surfaces validation errors clearly).
  const validated = validateEnvelope(rawEnvelope);
  if (!validated.ok) {
    console.error(`  envelope validation failed: ${validated.failure_reason}`);
    return finish();
  }

  // ── Beat 5: submit_synthesis (gate runs envelope.code in Tensorlake) ──
  console.log(`\n▶ Beat 5 — submit_synthesis (gate runs in ${tlMode === "local-fake" ? "in-process vitest" : "real Tensorlake sandbox"})`);
  const submit = (await beat(
    "submit_synthesis",
    () =>
      h["compile.submit_synthesis"]({
        request_id: spec.request_id,
        envelope: validated.envelope,
      }) as Promise<{
        gate_verdict: "pass" | "fail";
        function_id?: string;
        failure_reason?: string;
      }>,
    (r) =>
      r.gate_verdict === "pass"
        ? `gate=PASS function_id=${r.function_id?.slice(0, 16)}…`
        : `gate=FAIL ${r.failure_reason ?? "(no reason)"}`,
  )) as
    | { gate_verdict: "pass" | "fail"; function_id?: string }
    | undefined;
  if (!submit || submit.gate_verdict !== "pass" || !submit.function_id) {
    return finish();
  }

  // ── Beat 6: run_codified (executes the gated function on a real input) ──
  console.log(`\n▶ Beat 6 — run_codified (live invocation of agent-emitted code)`);
  // Use the first holdout trace's input shape to drive a realistic call.
  // synthesizer split keeps holdout private from the agent — but for the
  // demo we just need any plausible input shape.
  const sampleInput =
    (validated.envelope as { synthesizable: true }).synthesizable === true &&
    spec.traces.length > 0
      ? spec.traces[0].input
      : { text: "Server is on fire, P0 incident" };
  await beat(
    "run_codified",
    () =>
      h["compile.run_codified"]({
        function_id: submit.function_id!,
        input: sampleInput,
      }) as Promise<{ output: unknown; tier_used: string; latency_ms: number }>,
    (r) =>
      `tier=${r.tier_used} latency=${r.latency_ms.toFixed(2)}ms output=${JSON.stringify(r.output).slice(0, 80)}`,
  );

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
