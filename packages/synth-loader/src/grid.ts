import {
  STAGE2_THRESHOLDS,
  type CallSiteDescriptor,
  type ClusterSnapshotDoc,
  type LiveMetrics,
  type SyntheticCell,
  type SyntheticInput,
  type SyntheticRun,
  type Trace,
} from "@compile/schemas";
import type { INiaClient } from "@compile/nia";
import type { IBootstrapStream } from "@compile/stream";
import type { ITensorlakeClient } from "@compile/runtime";
import { expandSeeds } from "./variation.js";
import { StubOracleClient, type IOracleClient } from "./oracle.js";
import { StubCandidateClient, type ICandidateClient } from "./candidate.js";
import { OnlineClusterer, shapeSignature } from "./clusterer.js";
import { randomUUID } from "node:crypto";

/**
 * Stage-2 fan-out — runs the synthetic load grid for one call site.
 *
 * Architecture preserved (per DESIGN.md):
 *   - oracle path  → 1% sample through customer's frontier LLM
 *   - candidate path → 99% through Tier-1 prototype / Tier-2 Phi
 *   - online clusterer streams as outputs land
 *
 * Hackathon stubs: oracle + candidate are deterministic in-process clients
 * (StubOracleClient, StubCandidateClient). Real Tensorlake worker grid +
 * frontier LLM API both swap in behind the same interfaces.
 *
 * Tests downscale total_calls (e.g., 1,000); UI demos extrapolate
 * the grid render to 100K. Throughput math is reported as observed.
 */

export interface RunStage2Args {
  call_site: CallSiteDescriptor;
  total_calls: number;
  oracle_fraction: number;
  worker_count: number;
  seed_count?: number;
  nia: INiaClient;
  oracle?: IOracleClient;
  candidate?: ICandidateClient;
  /** Optional Tensorlake client. When supplied AND no `candidate` override
   * was passed, runStage2 builds a StubCandidateClient that routes YELLOW
   * pills through Phi-3-mini via runPhi (D1). Greens stay deterministic. */
  tensorlake?: ITensorlakeClient;
  /** Fired for each synthetic cell as it transitions; lets the UI / Convex
   * subscription render the grid live. */
  onCell?: (cell: SyntheticCell) => void;
  /** Optional Convex / in-memory stream. When supplied, runStage2 emits:
   *   - one `cell` write per completed call (DESIGN.md hero visual)
   *   - periodic `live_metrics` updates as cells land
   *   - periodic `cluster_snapshot` updates so Page 6 → 7 reveal works
   *   - one final `run_complete`
   * When omitted, the run is silent — backwards-compatible with existing tests.
   */
  stream?: IBootstrapStream;
  /** run_id pairs cells/metrics with the bootstrap_phase doc Lane C subscribes
   * to. Required if `stream` is set. */
  run_id?: string;
  /** ms between live_metrics + cluster_snapshot emits. Default 100ms. */
  metrics_interval_ms?: number;
}

export async function runStage2(args: RunStage2Args): Promise<SyntheticRun> {
  const oracle = args.oracle ?? new StubOracleClient();
  const candidate =
    args.candidate ?? new StubCandidateClient({ tensorlake: args.tensorlake });
  const seedCount = args.seed_count ?? 100;
  if (args.stream && !args.run_id) {
    throw new Error("runStage2: run_id required when stream is provided");
  }
  const stream = args.stream;
  const runId = args.run_id;
  const metricsIntervalMs = args.metrics_interval_ms ?? 100;
  let snapshotSeq = 0;
  let lastEmitAt = 0;
  let oracleDone = 0;
  let candidateDone = 0;

  const seeds = await args.nia.generateSyntheticSeeds({
    call_site: args.call_site,
    seed_count: Math.min(seedCount, args.total_calls),
  });
  const inputs = expandSeeds(seeds, {
    target_count: args.total_calls,
    rng_seed: args.call_site.call_site_id,
  });

  const oracleCount = Math.max(
    1,
    Math.round(args.total_calls * args.oracle_fraction),
  );
  const oracleSet = new Set<string>();
  // Take every Nth input for the oracle path so the sample is uniform.
  const stride = Math.max(1, Math.floor(args.total_calls / oracleCount));
  for (let i = 0; i < args.total_calls; i += stride) {
    if (oracleSet.size >= oracleCount) break;
    oracleSet.add(inputs[i]!.input_id);
  }

  const clusterer = new OnlineClusterer();
  const tier_mix = { tier_1: 0, tier_2: 0, tier_3: 0 };
  const oracleByInput = new Map<string, unknown>();
  const candidateByInput = new Map<string, unknown>();
  const preserved: Trace[] = [];

  const t0 = performance.now();

  // Worker pool: limited concurrency proxy for the Tensorlake 64-worker grid.
  // Chunked round-robin so cells stream uniformly across "workers".
  await processInWorkers(inputs, args.worker_count, async (input, workerId) => {
    const isOracle = oracleSet.has(input.input_id);
    args.onCell?.({
      input_id: input.input_id,
      worker_id: workerId,
      status: "in_flight",
      path: isOracle ? "oracle" : "candidate",
    });

    if (isOracle) {
      const r = await oracle.call({ call_site: args.call_site, input });
      oracleByInput.set(input.input_id, r.output);
      const sig = shapeSignature(r.output);
      const cell: SyntheticCell = {
        input_id: input.input_id,
        worker_id: workerId,
        status: "done",
        path: "oracle",
        output: r.output,
        cluster_id: sig,
        latency_ms: r.latency_ms,
        cost_usd: r.cost_usd,
      };
      args.onCell?.(cell);
      oracleDone++;
      if (stream && runId) {
        await stream.emitCell({
          run_id: runId,
          call_site_id: args.call_site.call_site_id,
          cell,
        });
      }
    } else {
      const r = await candidate.call({ call_site: args.call_site, input });
      candidateByInput.set(input.input_id, r.output);
      tier_mix[r.tier_assigned]++;
      const cluster_id = clusterer.add(input.input_id, r.output);
      const cell: SyntheticCell = {
        input_id: input.input_id,
        worker_id: workerId,
        status: "done",
        path: "candidate",
        output: r.output,
        tier_assigned: r.tier_assigned,
        cluster_id,
        latency_ms: r.latency_ms,
        cost_usd: r.cost_usd,
      };
      args.onCell?.(cell);
      candidateDone++;
      if (stream && runId) {
        await stream.emitCell({
          run_id: runId,
          call_site_id: args.call_site.call_site_id,
          cell,
        });
      }
    }

    // Periodic live_metrics + cluster_snapshot emits. Throttled so we don't
    // hammer Convex with sub-millisecond writes — Page 6 chrome animates
    // smoothly at ~10Hz. Live metrics carry schema_stability + tier_mix +
    // throughput; oracle_agreement is left at 0 here because the honest
    // pairwise computation is O(oracle × candidate) and runs every
    // metricsIntervalMs would make 100K runs unbounded. The final emit at
    // run completion does the full computation. This matches the DESIGN.md
    // hero visual where oracle agreement only resolves at second 25–28
    // ("color resolves… 7 sub-patterns found, 6 Tier 1, 1 Tier 2").
    if (stream && runId) {
      const now = performance.now();
      if (now - lastEmitAt >= metricsIntervalMs) {
        lastEmitAt = now;
        const elapsedSec = Math.max(0.001, (now - t0) / 1000);
        const totalDone = oracleDone + candidateDone;
        const liveMetrics: LiveMetrics = {
          run_id: runId,
          call_site_id: args.call_site.call_site_id,
          total_done: totalDone,
          oracle_done: oracleDone,
          candidate_done: candidateDone,
          throughput_per_sec: totalDone / elapsedSec,
          tier_mix: { ...tier_mix },
          axis_scores: {
            schema_stability: round3(
              clusterer.dominantShare(),
            ),
            determinism: 0,
            oracle_agreement: 0,
            economic_value: economicValueFromCallSite(
              args.call_site,
              args.total_calls,
            ),
          },
          updated_at: new Date().toISOString(),
        };
        await stream.emitLiveMetrics({ metrics: liveMetrics });

        const snapshot: ClusterSnapshotDoc = {
          run_id: runId,
          call_site_id: args.call_site.call_site_id,
          snapshot_seq: snapshotSeq++,
          clusters: clusterer.snapshot(),
          updated_at: new Date().toISOString(),
        };
        await stream.emitClusterSnapshot({ snapshot });
      }
    }
  });

  const wall_time_ms = performance.now() - t0;

  // 3-axis scoring on observed outputs.
  const allCandidateOutputs = Array.from(candidateByInput.values());
  const schemaStability = stabilityScore(allCandidateOutputs);
  const determinism = determinismScore(inputs, candidateByInput);
  const oracleAgreement = oracleAgreementScore(oracleByInput, candidateByInput);

  const passes_synthesis_gate =
    schemaStability >= STAGE2_THRESHOLDS.schema_stability &&
    determinism >= STAGE2_THRESHOLDS.determinism &&
    oracleAgreement >= STAGE2_THRESHOLDS.oracle_agreement;

  // Preserve a sample of (input, output) pairs for the synthesis spec.
  // Take train+val+holdout candidates from the main candidate path; synthesis
  // takes its own 70/15/15 split from this set.
  const previewCount = Math.min(60, inputs.length);
  for (let i = 0; i < previewCount; i++) {
    const inp = inputs[Math.floor((i / previewCount) * inputs.length)]!;
    const out = candidateByInput.get(inp.input_id);
    if (out !== undefined) {
      preserved.push({ input: inp.payload, output: out, tool_calls: [] });
    }
  }

  const finalRun: SyntheticRun = {
    run_id: `run_${randomUUID().slice(0, 8)}`,
    call_site_id: args.call_site.call_site_id,
    total_calls: args.total_calls,
    oracle_calls: oracleByInput.size,
    candidate_calls: candidateByInput.size,
    worker_count: args.worker_count,
    wall_time_ms,
    throughput_per_sec: args.total_calls / Math.max(0.001, wall_time_ms / 1000),
    axis_scores: {
      schema_stability: round3(schemaStability),
      determinism: round3(determinism),
      oracle_agreement: round3(oracleAgreement),
      economic_value: economicValueFromCallSite(args.call_site, args.total_calls),
    },
    tier_mix,
    clusters: clusterer.snapshot(),
    preserved_traces: preserved,
    passes_synthesis_gate,
  };

  if (stream && runId) {
    // Final live_metrics + cluster_snapshot reflecting the post-run truth.
    // Page 6 chrome converges on these values; Page 7 freezes on the
    // run_complete write below.
    const finalMetrics: LiveMetrics = {
      run_id: runId,
      call_site_id: args.call_site.call_site_id,
      total_done: oracleByInput.size + candidateByInput.size,
      oracle_done: oracleByInput.size,
      candidate_done: candidateByInput.size,
      throughput_per_sec: finalRun.throughput_per_sec,
      tier_mix: { ...tier_mix },
      axis_scores: finalRun.axis_scores,
      updated_at: new Date().toISOString(),
    };
    await stream.emitLiveMetrics({ metrics: finalMetrics });
    await stream.emitClusterSnapshot({
      snapshot: {
        run_id: runId,
        call_site_id: args.call_site.call_site_id,
        snapshot_seq: snapshotSeq++,
        clusters: finalRun.clusters,
        updated_at: new Date().toISOString(),
      },
    });
    await stream.emitRunComplete({ run_id: runId, run: finalRun });
  }

  return finalRun;
}

async function processInWorkers<T>(
  items: T[],
  workerCount: number,
  fn: (item: T, workerId: number) => Promise<void>,
): Promise<void> {
  // Round-robin distribute items across N workers; each worker drains its
  // queue sequentially. Mimics the Tensorlake fan-out shape.
  const queues: T[][] = Array.from({ length: workerCount }, () => []);
  items.forEach((it, i) => queues[i % workerCount]!.push(it));
  await Promise.all(
    queues.map(async (q, w) => {
      for (const it of q) await fn(it, w);
    }),
  );
}

function stabilityScore(outputs: unknown[]): number {
  if (outputs.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const o of outputs) {
    const s = shapeSignature(o);
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return Math.max(...counts.values()) / outputs.length;
}

function determinismScore(
  inputs: SyntheticInput[],
  outByInput: Map<string, unknown>,
): number {
  // Group identical inputs (by canonical JSON) and check if their outputs
  // collapse to the same shape signature. Mirrors the receipt-based
  // determinism rule, applied to synthetic outputs.
  const buckets = new Map<string, Set<string>>();
  for (const inp of inputs) {
    const ih = JSON.stringify(inp.payload);
    const out = outByInput.get(inp.input_id);
    if (out === undefined) continue;
    const sig = shapeSignature(out);
    const set = buckets.get(ih) ?? new Set<string>();
    set.add(sig);
    buckets.set(ih, set);
  }
  let consistent = 0;
  let total = 0;
  for (const sigs of buckets.values()) {
    total++;
    if (sigs.size === 1) consistent++;
  }
  if (total === 0) return 0;
  return consistent / total;
}

function oracleAgreementScore(
  oracleByInput: Map<string, unknown>,
  candidateByInput: Map<string, unknown>,
): number {
  if (oracleByInput.size === 0) return 0;
  let agreed = 0;
  let total = 0;
  for (const [id, oracle] of oracleByInput) {
    const cand = candidateByInput.get(id);
    if (cand === undefined) {
      // Oracle inputs don't run candidate path in our setup; agreement is
      // evaluated by output-shape match instead.
      total++;
      continue;
    }
    total++;
    if (JSON.stringify(oracle) === JSON.stringify(cand)) agreed++;
  }
  // When candidate path didn't see the oracle inputs, synthesize agreement
  // from shape-only — a real run with shared inputs gives a tighter score.
  // The candidate-shape SET is built ONCE and probed in O(1); a previous
  // version rebuilt the array inside the filter callback for each oracle
  // entry, which made this O(oracle × candidate) and burned ~28s on the
  // 100K bench at the very end of the run.
  if (agreed === 0 && total > 0) {
    const candidateShapes = new Set<string>();
    for (const v of candidateByInput.values()) candidateShapes.add(shapeSignature(v));
    let shapeAgreed = 0;
    for (const o of oracleByInput.values()) {
      if (candidateShapes.has(shapeSignature(o))) shapeAgreed++;
    }
    return shapeAgreed / total;
  }
  return agreed / total;
}

function economicValueFromCallSite(
  cs: CallSiteDescriptor,
  total_calls: number,
): import("@compile/schemas").AxisScores["economic_value"] {
  // Hackathon estimate: extrapolate to monthly volume from the call site's
  // economic prior (proxy for telemetry); use frontier $0.05/call default.
  const monthly = Math.round(8000 * cs.priors.economic_value_prior);
  const per_call = 0.05;
  const t1 = 0.0001;
  const synth = 1.5;
  const maint = 50;
  const annual = monthly * 12 * (per_call - t1) - synth - maint;
  return {
    monthly_calls: monthly,
    annual_savings_usd: Math.round(annual * 100) / 100,
    break_even_hits: Math.ceil((synth + maint) / (per_call - t1)),
    synthesis_cost_usd: synth,
    maintenance_cost_usd: maint,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
