import { randomUUID } from "node:crypto";
import {
  MCP_TOOLS,
  type McpToolName,
  ObserveCallInput,
  FindFunctionInput,
  RunCodifiedInput,
  ListCandidatesInput,
  RequestSynthesisInput,
  SubmitSynthesisInput,
  EstimateSavingsInput,
  SubmitSynthesisOutput,
  ScanRepoInput,
  SyntheticConfirmInput,
  type SynthesisSpec,
  type Cluster,
  type Trace,
  type CallSiteDescriptor,
  type SyntheticRun,
  type ScanReport,
  type NegativeCachedOutput,
  RETRY_POLICY_BY_REASON,
} from "@compile/schemas";
import { isFreshEnough } from "./negative-freshness.js";
import type { INiaClient } from "@compile/nia";
import {
  gate,
  runCodified,
  LocalFakeTensorlakeClient,
  type ITensorlakeClient,
} from "@compile/runtime";
import { validateEnvelope, assembleSpec } from "@compile/synthesizer";
import {
  type IReceiptStore,
  runPipeline,
  type CandidateCluster,
} from "@compile/identifier";
import { scanRepo } from "@compile/scanner";
import { runStage2, type IOracleClient } from "@compile/synth-loader";
import {
  NoopBootstrapStream,
  type IBootstrapStream,
} from "@compile/stream";
import type { z } from "zod";
import type { IRequestStore } from "./store.js";

type SubmitOutput = z.infer<typeof SubmitSynthesisOutput>;

/**
 * v7 bootstrap state. Stage-1 scans and Stage-2 synthetic-confirmation runs
 * land here so request_synthesis / list_codify_candidates can read from the
 * code-first path, not just the receipt-based proxy path.
 */
export interface IBootstrapStore {
  putScan(report: ScanReport): void;
  getScan(): ScanReport | undefined;
  getCallSite(call_site_id: string): CallSiteDescriptor | undefined;
  putRun(run: SyntheticRun): void;
  getRun(call_site_id: string): SyntheticRun | undefined;
  allRuns(): SyntheticRun[];
  /** Active run_id binding bootstrap_phase + cells + metrics for this demo run. */
  setRunId(run_id: string): void;
  getRunId(): string | undefined;
}

export class MemoryBootstrapStore implements IBootstrapStore {
  private scan?: ScanReport;
  private readonly runs = new Map<string, SyntheticRun>();
  private runId?: string;
  putScan(r: ScanReport): void {
    this.scan = r;
  }
  getScan(): ScanReport | undefined {
    return this.scan;
  }
  getCallSite(id: string): CallSiteDescriptor | undefined {
    return this.scan?.call_sites.find((c) => c.call_site_id === id);
  }
  putRun(r: SyntheticRun): void {
    this.runs.set(r.call_site_id, r);
  }
  getRun(id: string): SyntheticRun | undefined {
    return this.runs.get(id);
  }
  allRuns(): SyntheticRun[] {
    return [...this.runs.values()];
  }
  setRunId(run_id: string): void {
    this.runId = run_id;
  }
  getRunId(): string | undefined {
    return this.runId;
  }
}

export interface HandlerDeps {
  nia: INiaClient;
  store: IRequestStore;
  receipts: IReceiptStore;
  bootstrap: IBootstrapStore;
  /**
   * Optional UI/Convex stream. When supplied, every handler emits the
   * appropriate `bootstrap_phase` advance + lifecycle event (scan / cell /
   * cluster / synthesis / vault / result) so the eleven-page demo flow
   * (ENG_REVIEW.md D7) can render in real time. Defaults to a no-op so
   * library users (Friday harness, unit tests) don't have to wire one.
   */
  stream?: IBootstrapStream;
  /**
   * Tensorlake sandbox client (D1, D6). Used to:
   *   - run agent-emitted code against the holdout in submit_synthesis
   *   - host Phi-3-mini for Tier-2 candidate paths in synthetic_confirm
   *   - host Phi-3-mini for run_codified on tier_2 Vault entries
   * Production callers pass TensorlakeWithLocalFallback so a sandbox
   * outage drops to in-process execution per failure mode #2. When
   * omitted, defaults to LocalFakeTensorlakeClient — fully offline,
   * deterministic, used by tests + the Friday harness.
   */
  tensorlake?: ITensorlakeClient;
  /**
   * Real frontier oracle (D9, D10). The 1% sample in Stage-2 runs through
   * this client — production callers wrap AnthropicOracleClient in
   * BudgetedOracleClient + OracleWithLocalFallback so a flaky API or
   * budget trip degrades to stub-oracle samples for the remainder of the
   * run, not crashes. When omitted, runStage2 builds StubOracleClient.
   */
  oracle?: IOracleClient;
  /**
   * Resolves the active run_id. The bootstrap store is the natural home —
   * scan_repo sets it; subsequent handlers reuse it. Defaults to a
   * call-keyed UUID when no resolver is supplied (one run per handler call,
   * which is fine for unit tests).
   */
  runId?: () => string;
  /**
   * Resolves a cluster_id to the candidate (cluster + receipts) the
   * pipeline produced. Defaults to running the pipeline live; tests/fixtures
   * can override.
   */
  resolveCandidate?: (cluster_id: string) => Promise<CandidateCluster | null>;
  /**
   * Build the per-cluster synthesis prompt and schemas. For the hackathon
   * defaults, we use the receipt prompt verbatim and infer schemas from the
   * first receipt.
   */
  buildSpecInputs?: (candidate: CandidateCluster) => {
    prompt_template: string;
    tool_schemas: Array<Record<string, unknown>>;
    input_schema: Record<string, unknown>;
    output_schema: Record<string, unknown>;
    customer_docs?: SynthesisSpec["customer_docs"];
  };
  /**
   * Optional handle for callers (UI / report panels) to read session-scoped
   * negative-vault telemetry. Populated by buildHandlers — pass an empty
   * object and it will be filled with a `snapshot()` getter.
   */
  negativeVaultMetricsRef?: {
    snapshot?: () => { hits: number; dollars_saved_total: number };
  };
}

function defaultResolveCandidate(deps: HandlerDeps) {
  return async (cluster_id: string): Promise<CandidateCluster | null> => {
    // First check the v7 bootstrap path: every Stage-2 run becomes a
    // candidate keyed by `cl_<call_site_id>`.
    for (const run of deps.bootstrap.allRuns()) {
      if (`cl_${run.call_site_id}` === cluster_id) {
        return runToCandidate(run, deps.bootstrap.getCallSite(run.call_site_id));
      }
    }
    // Fall back to the receipt-based proxy pipeline.
    const candidates = runPipeline({ receipts: deps.receipts.all() });
    return candidates.find((c) => c.cluster.cluster_id === cluster_id) ?? null;
  };
}

function runToCandidate(
  run: SyntheticRun,
  cs: CallSiteDescriptor | undefined,
): CandidateCluster {
  const cluster: Cluster = {
    cluster_id: `cl_${run.call_site_id}`,
    cluster_signature: run.call_site_id,
    template_ids: [run.call_site_id],
    trace_count: run.preserved_traces.length,
    axis_scores: run.axis_scores,
    passes_synthesis_gate: run.passes_synthesis_gate,
  };
  return {
    cluster,
    receipts: run.preserved_traces.map((t, i) => ({
      call_id: `synth_${run.run_id}_${i}`,
      timestamp: new Date().toISOString(),
      agent_id: "stage2-synthetic",
      prompt: cs?.prompt_excerpt ?? cs?.function_hint ?? run.call_site_id,
      tool_schemas: [],
      input: t.input,
      output: t.output,
      tokens_in: 0,
      tokens_out: 0,
      cost_usd: 0.05,
      latency_ms: 0,
      model: "synthetic-stub",
    })),
    sample_prompt: cs?.prompt_excerpt ?? cs?.function_hint ?? run.call_site_id,
    projected_annual_savings_usd: run.axis_scores.economic_value.annual_savings_usd,
    passes_gate: run.passes_synthesis_gate,
  };
}

function defaultBuildSpecInputs(candidate: CandidateCluster): {
  prompt_template: string;
  tool_schemas: Array<Record<string, unknown>>;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
} {
  const first = candidate.receipts[0]!;
  return {
    prompt_template: first.prompt,
    tool_schemas: first.tool_schemas,
    input_schema: inferShape(first.input),
    output_schema: inferShape(first.output),
  };
}

function inferShape(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return { type: "null" };
  if (typeof v === "string") return { type: "string" };
  if (typeof v === "number") return { type: "number" };
  if (typeof v === "boolean") return { type: "boolean" };
  if (Array.isArray(v)) {
    return { type: "array", items: v.length > 0 ? inferShape(v[0]) : {} };
  }
  if (typeof v === "object") {
    const props: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      props[k] = inferShape(val);
    }
    return { type: "object", properties: props, required: Object.keys(props) };
  }
  return {};
}

function tracesFromReceipts(receipts: ReadonlyArray<{
  input?: unknown;
  output?: unknown;
}>): Trace[] {
  return receipts.map((r) => ({
    input: r.input ?? null,
    output: r.output ?? null,
    tool_calls: [],
  }));
}

/**
 * Best-effort Nia vault write. Failures are logged to stderr but never
 * thrown — the demo flow must survive Nia outages, quota exhaustion (free
 * tier is 5 saves / month at the time of writing), and transient 5xx. The
 * UI still gets its `vault_event` stream emit because we treat the write
 * as a side-channel observation, not part of the agent contract.
 *
 * Set COMPILE_VAULT_STRICT=1 to surface errors during dev. */
async function safeVaultWrite(
  nia: INiaClient,
  entry: Parameters<INiaClient["vaultWrite"]>[0],
  label: string,
): Promise<void> {
  try {
    await nia.vaultWrite(entry);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[vault] ${label} write failed (continuing): ${msg.slice(0, 200)}`);
    if (process.env.COMPILE_VAULT_STRICT === "1") throw err;
  }
}

export function buildHandlers(deps: HandlerDeps): Record<
  McpToolName,
  (raw: unknown) => Promise<unknown>
> {
  const resolveCandidate = deps.resolveCandidate ?? defaultResolveCandidate(deps);
  const buildSpecInputs = deps.buildSpecInputs ?? defaultBuildSpecInputs;
  const stream: IBootstrapStream = deps.stream ?? new NoopBootstrapStream();
  const tensorlake: ITensorlakeClient =
    deps.tensorlake ?? new LocalFakeTensorlakeClient();
  /**
   * Local mirror of positive Vault entries written this session. Belt-and-
   * suspenders for run_codified: when Nia's vaultWrite succeeds we end up
   * in both stores; when Nia is degraded (quota / outage) we still have a
   * source of truth for what the agent just emitted. Lookup order in
   * run_codified is local-first then Nia, so a freshly-gated function
   * always runs even when Nia is dark.
   */
  const localPositiveMirror = new Map<
    string,
    Extract<Parameters<INiaClient["vaultWrite"]>[0], { kind: "positive" }>
  >();
  /**
   * Session-scoped telemetry for negative-vault short-circuits. Each hit is
   * a synthesis spin-up we *didn't* pay for. NEG_CACHE_SAVINGS_USD is a flat
   * demo-grade estimate of agent + spec LLM cost per attempt; replace with a
   * real cost-model when the synthesizer reports actuals.
   */
  const negativeVaultMetrics = {
    hits: 0,
    dollars_saved_total: 0,
  };
  const NEG_CACHE_SAVINGS_USD = 0.1;
  if (deps.negativeVaultMetricsRef) {
    deps.negativeVaultMetricsRef.snapshot = () => ({ ...negativeVaultMetrics });
  }
  const runId = (): string => {
    if (deps.runId) return deps.runId();
    let rid = deps.bootstrap.getRunId();
    if (!rid) {
      rid = `run_${randomUUID().slice(0, 8)}`;
      deps.bootstrap.setRunId(rid);
    }
    return rid;
  };

  return {
    "compile.scan_repo": async (raw): Promise<ScanReport> => {
      const { repo_path } = ScanRepoInput.parse(raw);
      const rid = runId();
      // Page 1 → Page 2: MCP handshake → AST scan begins.
      await stream.advancePhase({ run_id: rid, phase: "connect" });
      await stream.advancePhase({ run_id: rid, phase: "reading_code" });
      const report = await scanRepo(repo_path);
      deps.bootstrap.putScan(report);
      await stream.emitScan({ run_id: rid, report });
      // Page 2 → Page 3: Stage-1 priors computed; codifiability decided (D13).
      await stream.advancePhase({ run_id: rid, phase: "classify" });
      // Eagerly write Stage-1 RED sites to negative Vault per D8 / D11 so
      // routing skips synthesis on them next time. Parallel + best-effort
      // so a Nia quota / outage doesn't add 5s of dead air to page 2.
      await Promise.all(
        report.call_sites
          .filter((cs) => cs.priors.pill === "red")
          .map(async (cs) => {
            const entry = {
              kind: "negative" as const,
              cluster_signature: cs.call_site_id,
              reason: "low_static_prior" as const,
              retry_policy: RETRY_POLICY_BY_REASON.low_static_prior,
              trace_count_at_decision: 0,
              created_at: new Date().toISOString(),
            };
            await safeVaultWrite(deps.nia, entry, `scan_repo:red:${cs.call_site_id}`);
            await stream.emitVaultEvent({
              event: { run_id: rid, entry, emitted_at: entry.created_at },
            });
          }),
      );
      return report;
    },

    "compile.synthetic_confirm": async (raw): Promise<SyntheticRun> => {
      const { call_site_id, total_calls, oracle_fraction, worker_count } =
        SyntheticConfirmInput.parse(raw);
      const cs = deps.bootstrap.getCallSite(call_site_id);
      if (!cs) {
        throw new Error(
          `synthetic_confirm: call_site ${call_site_id} not found; run scan_repo first`,
        );
      }
      const rid = runId();
      // Page 3 → Pages 4, 5, 6 in sequence. Nia seed gen happens inside
      // runStage2 (via INiaClient.generateSyntheticSeeds) — we mark the
      // page transitions around it so the UI can animate the doc-fan and
      // expansion before the constellation kicks in.
      await stream.advancePhase({
        run_id: rid,
        phase: "reading_docs",
        current_call_site_id: call_site_id,
      });
      await stream.advancePhase({
        run_id: rid,
        phase: "expanding",
        current_call_site_id: call_site_id,
      });
      await stream.advancePhase({
        run_id: rid,
        phase: "stress_test",
        current_call_site_id: call_site_id,
      });
      const run = await runStage2({
        call_site: cs,
        total_calls,
        oracle_fraction,
        worker_count,
        nia: deps.nia,
        stream,
        run_id: rid,
        tensorlake,
        oracle: deps.oracle,
      });
      deps.bootstrap.putRun(run);
      // Page 6 → Page 7: constellation freezes, cluster centroids labeled.
      await stream.advancePhase({
        run_id: rid,
        phase: "clusters_revealed",
        current_call_site_id: call_site_id,
      });
      return run;
    },

    "compile.observe_call": async (raw) => {
      const r = ObserveCallInput.parse(raw);
      deps.receipts.put(r);
      return { ok: true as const, receipt_id: r.call_id };
    },

    "compile.find_function": async (raw) => {
      const { description, prompt, tool_schemas } = FindFunctionInput.parse(raw);
      // Three-state lookup keyed by cluster_signature. The cluster signature
      // for routing is derived from the templated form of the incoming
      // prompt — not the description — so a misleading description can't
      // mask a real codified hit.
      const sig = derivePromptSignature(prompt ?? description, tool_schemas ?? []);
      return await deps.nia.vaultLookup(sig);
    },

    "compile.run_codified": async (raw) => {
      const { function_id, input } = RunCodifiedInput.parse(raw);
      // Local mirror first — survives Nia outage / quota exhaustion. Then
      // Nia for cross-session lookups (entries written in a previous run).
      const local = localPositiveMirror.get(function_id);
      const entry = local ?? (await (async () => {
        const lookup = await deps.nia.vaultLookup(function_id);
        return lookup.state === "positive" ? lookup.entry : null;
      })());
      if (!entry) {
        throw new Error(`run_codified: no positive Vault entry for ${function_id}`);
      }
      const env = entry.envelope;
      return await runCodified({
        function_id: entry.function_id,
        function_name: env.function_name,
        code: env.code,
        input,
        tier: env.tier === "tier_1" ? "tier_1" : "tier_2",
        tensorlake,
      });
    },

    "compile.list_codify_candidates": async (raw) => {
      const { limit } = ListCandidatesInput.parse(raw);
      // v7: blend Stage-2 synthetic candidates (bootstrap) with receipt-based
      // proxy candidates. Both paths feed the 90-second report panel.
      const stage2 = deps.bootstrap
        .allRuns()
        .filter((r) => r.passes_synthesis_gate)
        .map((r) => runToCandidate(r, deps.bootstrap.getCallSite(r.call_site_id)));
      const proxy = runPipeline({ receipts: deps.receipts.all() });
      const merged = [...stage2, ...proxy].sort(
        (a, b) => b.projected_annual_savings_usd - a.projected_annual_savings_usd,
      );
      // Gap 2: drop candidates whose cluster_signature has a binding negative
      // vault entry. Sticky negatives are dropped outright; expiring negatives
      // are dropped unless the cluster has accumulated enough new traces (or
      // the underlying code SHA has shifted) to justify another attempt.
      // Lookups are batched in parallel — Nia may be remote, so we don't want
      // O(N) sequential round-trips on every candidate-list call.
      const lookups = await Promise.all(
        merged.map(async (c) => ({
          c,
          lookup: await deps.nia.vaultLookup(c.cluster.cluster_signature),
        })),
      );
      const survivors = lookups.filter(({ c, lookup }) => {
        if (lookup.state !== "negative") return true;
        return isFreshEnough(lookup.entry, {
          trace_count: c.cluster.trace_count,
        });
      });
      const dropped = lookups.length - survivors.length;
      if (dropped > 0) {
        negativeVaultMetrics.hits += dropped;
        negativeVaultMetrics.dollars_saved_total += dropped * NEG_CACHE_SAVINGS_USD;
      }
      return {
        candidates: survivors.slice(0, limit).map(({ c, lookup }) => ({
          ...c.cluster,
          projected_annual_savings_usd: c.projected_annual_savings_usd,
          sample_prompt: c.sample_prompt,
          ...(lookup.state === "negative"
            ? { previously_negative: true as const }
            : {}),
        })),
      };
    },

    "compile.request_synthesis": async (
      raw,
    ): Promise<SynthesisSpec | NegativeCachedOutput> => {
      const { cluster_id } = RequestSynthesisInput.parse(raw);
      const candidate = await resolveCandidate(cluster_id);
      if (!candidate) throw new Error(`unknown cluster: ${cluster_id}`);
      // Gap 1: short-circuit on a binding negative-vault entry. Sticky reasons
      // never re-attempt; expiring reasons re-attempt only when isFreshEnough
      // says the cluster's state has shifted enough to be worth another spin.
      const sig = candidate.cluster.cluster_signature;
      const lookup = await deps.nia.vaultLookup(sig);
      if (lookup.state === "negative") {
        const fresh = isFreshEnough(lookup.entry, {
          trace_count: candidate.cluster.trace_count,
        });
        if (!fresh) {
          negativeVaultMetrics.hits += 1;
          negativeVaultMetrics.dollars_saved_total += NEG_CACHE_SAVINGS_USD;
          const rid = runId();
          await stream.emitSynthesisEvent({
            event: {
              run_id: rid,
              request_id: `neg_${randomUUID().slice(0, 8)}`,
              cluster_id,
              stage: "failed",
              failure_reason: `negative_cached: ${lookup.entry.reason}`,
              emitted_at: new Date().toISOString(),
            },
          });
          return {
            negative_cached: true,
            cluster_signature: lookup.entry.cluster_signature,
            reason: lookup.entry.reason,
            retry_policy: lookup.entry.retry_policy,
            trace_count_at_decision: lookup.entry.trace_count_at_decision,
            created_at: lookup.entry.created_at,
            synthesis_dollars_saved_estimate: NEG_CACHE_SAVINGS_USD,
          };
        }
      }
      const inputs = buildSpecInputs(candidate) as ReturnType<typeof defaultBuildSpecInputs> & {
        customer_docs?: SynthesisSpec["customer_docs"];
      };
      const request_id = randomUUID();
      const { spec, holdout_traces } = assembleSpec({
        request_id,
        cluster: candidate.cluster,
        prompt_template: inputs.prompt_template,
        tool_schemas: inputs.tool_schemas,
        input_schema: inputs.input_schema,
        output_schema: inputs.output_schema,
        traces: tracesFromReceipts(candidate.receipts),
        customer_docs: inputs.customer_docs,
      });
      deps.store.put({
        request_id,
        cluster_id,
        cluster_signature: candidate.cluster.cluster_signature,
        spec,
        holdout_traces,
        created_at: Date.now(),
      });
      const rid = runId();
      // Page 7 → Page 8: agent now holds the synthesis spec. Page 8 typewriter
      // starts the moment the agent's codegen begins.
      await stream.advancePhase({
        run_id: rid,
        phase: "agent_writing",
        current_request_id: request_id,
      });
      await stream.emitSynthesisEvent({
        event: {
          run_id: rid,
          request_id,
          cluster_id,
          stage: "spec_returned",
          emitted_at: new Date().toISOString(),
        },
      });
      return spec;
    },

    "compile.submit_synthesis": async (raw): Promise<SubmitOutput> => {
      const { request_id, envelope } = SubmitSynthesisInput.parse(raw);
      const rid = runId();
      const pending = deps.store.get(request_id);
      if (!pending) {
        return {
          gate_verdict: "fail",
          failure_reason: `unknown request_id: ${request_id}`,
        };
      }
      const validated = validateEnvelope(envelope);
      if (!validated.ok) {
        await stream.emitSynthesisEvent({
          event: {
            run_id: rid,
            request_id,
            cluster_id: pending.cluster_id,
            stage: "failed",
            failure_reason: validated.failure_reason,
            emitted_at: new Date().toISOString(),
          },
        });
        return { gate_verdict: "fail", failure_reason: validated.failure_reason };
      }
      // Agent has emitted code → Page 8 typewriter is done, Page 9 begins.
      await stream.emitSynthesisEvent({
        event: {
          run_id: rid,
          request_id,
          cluster_id: pending.cluster_id,
          stage: "code_emitted",
          function_name:
            validated.envelope.synthesizable === true
              ? validated.envelope.function_name
              : undefined,
          emitted_at: new Date().toISOString(),
        },
      });
      if (validated.envelope.synthesizable === false) {
        // Negative outcome → write negative entry to Vault per D8 retry policy.
        const entry = {
          kind: "negative" as const,
          cluster_signature: pending.cluster_signature,
          reason: validated.envelope.reason,
          retry_policy:
            validated.envelope.retry_policy ??
            RETRY_POLICY_BY_REASON[validated.envelope.reason],
          trace_count_at_decision: pending.spec.traces.length + pending.holdout_traces.length,
          created_at: new Date().toISOString(),
        };
        await safeVaultWrite(deps.nia, entry, "submit_synthesis");
        await stream.emitSynthesisEvent({
          event: {
            run_id: rid,
            request_id,
            cluster_id: pending.cluster_id,
            stage: "failed",
            failure_reason: `synthesizable=false: ${validated.envelope.reason}`,
            emitted_at: entry.created_at,
          },
        });
        await stream.advancePhase({ run_id: rid, phase: "vault_write" });
        await stream.emitVaultEvent({
          event: { run_id: rid, entry, emitted_at: entry.created_at },
        });
        deps.store.delete(request_id);
        return {
          gate_verdict: "fail",
          failure_reason: `synthesizable=false: ${validated.envelope.reason}`,
        };
      }
      // Page 8 → Page 9: holdout validation begins.
      await stream.advancePhase({ run_id: rid, phase: "validate" });
      await stream.emitSynthesisEvent({
        event: {
          run_id: rid,
          request_id,
          cluster_id: pending.cluster_id,
          stage: "validating",
          function_name: validated.envelope.function_name,
          emitted_at: new Date().toISOString(),
        },
      });
      const verdict = await gate({
        envelope: validated.envelope,
        holdout: pending.holdout_traces,
        tensorlake,
      });
      deps.store.delete(request_id);
      if (verdict.verdict === "pass") {
        const function_id = `fn_${validated.envelope.function_name}_${request_id.slice(0, 8)}`;
        const entry = {
          kind: "positive" as const,
          function_id,
          cluster_signature: pending.cluster_signature,
          tier: validated.envelope.tier,
          envelope: validated.envelope,
          holdout_match_rate: verdict.match_rate,
          created_at: new Date().toISOString(),
          hit_count: 0,
          estimated_savings_usd_total: 0,
        };
        localPositiveMirror.set(function_id, entry);
        await safeVaultWrite(deps.nia, entry, "submit_synthesis");
        await stream.emitSynthesisEvent({
          event: {
            run_id: rid,
            request_id,
            cluster_id: pending.cluster_id,
            stage: "passed",
            function_name: validated.envelope.function_name,
            holdout_match_rate: verdict.match_rate,
            emitted_at: entry.created_at,
          },
        });
        // Page 9 → Page 10: gate passed, Vault write next.
        await stream.advancePhase({ run_id: rid, phase: "vault_write" });
        await stream.emitVaultEvent({
          event: { run_id: rid, entry, emitted_at: entry.created_at },
        });
        return {
          gate_verdict: "pass",
          function_id,
          holdout_match_rate: verdict.match_rate,
          savings_estimate_usd_annual:
            validated.envelope.estimated_savings_per_call_usd *
            (pending.spec.axis_scores.economic_value.monthly_calls * 12),
        };
      }
      await stream.emitSynthesisEvent({
        event: {
          run_id: rid,
          request_id,
          cluster_id: pending.cluster_id,
          stage: "failed",
          function_name: validated.envelope.function_name,
          holdout_match_rate: verdict.match_rate,
          failure_reason: verdict.failure_reason,
          emitted_at: new Date().toISOString(),
        },
      });
      return {
        gate_verdict: "fail",
        holdout_match_rate: verdict.match_rate,
        failure_reason: verdict.failure_reason,
      };
    },

    "compile.estimate_savings": async (raw) => {
      const { cluster_id, monthly_volume } = EstimateSavingsInput.parse(raw);
      const candidate = await resolveCandidate(cluster_id);
      if (!candidate) throw new Error(`unknown cluster: ${cluster_id}`);
      const ev = candidate.cluster.axis_scores!.economic_value;
      const t1 = 0.0001;
      const t2 = 0.0005;
      const monthly_calls = monthly_volume ?? ev.monthly_calls;
      const per_call_t3 =
        candidate.receipts.reduce((s, r) => s + r.cost_usd, 0) /
        Math.max(1, candidate.receipts.length);
      return {
        axis_scores: candidate.cluster.axis_scores!,
        per_call_savings_usd: {
          tier_1: per_call_t3 - t1,
          tier_2: per_call_t3 - t2,
        },
        annual_savings_usd: monthly_calls * 12 * (per_call_t3 - t1) - ev.synthesis_cost_usd - ev.maintenance_cost_usd,
        break_even_hits: ev.break_even_hits,
      };
    },
  };
}

function derivePromptSignature(
  prompt: string,
  tool_schemas: Array<Record<string, unknown>>,
): string {
  // Reuse the templater's skeletonization indirectly via a local mirror.
  // Keeping this inline avoids a circular dep on @compile/identifier internals.
  const skel = prompt
    .replace(/https?:\/\/\S+/gi, "<URL>")
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi, "<EMAIL>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<UUID>")
    .replace(/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?Z?)?\b/g, "<DATE>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<HEX_ID>")
    .replace(/"[^"\\]*(?:\\.[^"\\]*)*"/g, '"<STR>"')
    .replace(/'[^'\\]*(?:\\.[^'\\]*)*'/g, "'<STR>'")
    .replace(/-?\b\d[\d,]*\.?\d*\b/g, "<NUM>")
    .replace(/\s+/g, " ")
    .trim();
  // Hash to match the templater's tpl_<hex> shape so positive cache lookups
  // are by the same key. We use the cluster_signature on Vault entries which
  // identifier sets to template_id.
  const h = require("node:crypto").createHash("sha1");
  h.update(skel);
  h.update(" ");
  h.update(JSON.stringify(tool_schemas ?? []));
  return `tpl_${h.digest("hex").slice(0, 12)}`;
}

export const TOOL_DESCRIPTIONS: Record<McpToolName, string> = {
  "compile.scan_repo":
    "Stage 1 (v7 bootstrap): walk the repo, find LLM call sites, compute static priors. Returns ranked sites with red/yellow/green pills.",
  "compile.synthetic_confirm":
    "Stage 2 (v7 bootstrap): fire 100K synthetic calls per candidate through the worker grid. Returns axis scores + tier mix + clusters.",
  "compile.observe_call": "Log an LLM call receipt to the identification pipeline.",
  "compile.find_function":
    "Three-state lookup against Nia Vault: positive hit / negative hit / unknown.",
  "compile.run_codified": "Execute a codified function (Tier 1 or Tier 2).",
  "compile.list_codify_candidates":
    "Ranked clusters that passed 3-axis scoring; powers the 48h report.",
  "compile.request_synthesis":
    "Returns a synthesis spec. The CALLING agent runs codegen on its own LLM keys.",
  "compile.submit_synthesis":
    "Agent submits emitted code; Compile validates against private holdout, gates ≥98%.",
  "compile.estimate_savings":
    "Projected $ savings per tier with break-even formula.",
};

export const TOOLS = MCP_TOOLS;
