import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  REPLAY_SCHEMA_VERSION,
  ReplayFileSchema,
  type CallSiteDescriptor,
  type ClusterLayoutPosition,
  type OnlineCluster,
  type ReplayConfig,
  type ReplayFile,
  type ReplaySummary,
  type StreamEvent,
  type SyntheticRun,
  type BootstrapPhase,
  type BootstrapPhaseDoc,
  type ClusterSnapshotDoc,
  type LiveMetrics,
  type ScanReport,
  type SyntheticCell,
  type SynthesisEvent,
  type VaultEvent,
  type ResultSummary,
} from "@compile/schemas";
import type { IBootstrapStream } from "@compile/stream";

/**
 * IBootstrapStream wrapper that timestamps every event with `performance.now()
 * - t0`, forwards the call to a downstream stream (so live wiring stays
 * intact), and accumulates the timed list in memory. `serialize()` emits a
 * complete ReplayFile.
 *
 * Used by the bench (Friday derisk #2): runStage2 streams as usual; the
 * recorder captures the wire trace; on completion we write the JSON to
 * data/bench/golden.json.
 */
export class CaptureBootstrapStream implements IBootstrapStream {
  private readonly t0 = performance.now();
  private readonly events: { t_ms: number; event: StreamEvent }[] = [];
  private finalRun?: SyntheticRun;
  private finalClusters: OnlineCluster[] = [];

  constructor(private readonly downstream: IBootstrapStream) {}

  private record(event: StreamEvent): void {
    this.events.push({ t_ms: performance.now() - this.t0, event });
  }

  async advancePhase(args: {
    run_id: string;
    phase: BootstrapPhase;
    current_call_site_id?: string;
    current_request_id?: string;
    error?: string;
  }): Promise<BootstrapPhaseDoc> {
    const doc = await this.downstream.advancePhase(args);
    this.record({ kind: "phase", doc });
    return doc;
  }
  async emitScan(args: { run_id: string; report: ScanReport }): Promise<void> {
    await this.downstream.emitScan(args);
    this.record({ kind: "scan", run_id: args.run_id, report: args.report });
  }
  async emitCell(args: {
    run_id: string;
    call_site_id: string;
    cell: SyntheticCell;
  }): Promise<void> {
    await this.downstream.emitCell(args);
    this.record({
      kind: "cell",
      run_id: args.run_id,
      call_site_id: args.call_site_id,
      cell: args.cell,
    });
  }
  async emitLiveMetrics(args: { metrics: LiveMetrics }): Promise<void> {
    await this.downstream.emitLiveMetrics(args);
    this.record({ kind: "live_metrics", metrics: args.metrics });
  }
  async emitClusterSnapshot(args: { snapshot: ClusterSnapshotDoc }): Promise<void> {
    await this.downstream.emitClusterSnapshot(args);
    this.record({ kind: "cluster_snapshot", snapshot: args.snapshot });
    this.finalClusters = args.snapshot.clusters;
  }
  async emitRunComplete(args: { run_id: string; run: SyntheticRun }): Promise<void> {
    await this.downstream.emitRunComplete(args);
    this.record({ kind: "run_complete", run_id: args.run_id, run: args.run });
    this.finalRun = args.run;
    if (args.run.clusters.length > 0) this.finalClusters = args.run.clusters;
  }
  async emitSynthesisEvent(args: { event: SynthesisEvent }): Promise<void> {
    await this.downstream.emitSynthesisEvent(args);
    this.record({ kind: "synthesis", event: args.event });
  }
  async emitVaultEvent(args: { event: VaultEvent }): Promise<void> {
    await this.downstream.emitVaultEvent(args);
    this.record({ kind: "vault", event: args.event });
  }
  async emitResult(args: { summary: ResultSummary }): Promise<void> {
    await this.downstream.emitResult(args);
    this.record({ kind: "result", summary: args.summary });
  }
  async flush(): Promise<void> {
    await this.downstream.flush?.();
  }

  /** Final captured event count (cells + metrics + snapshots + everything). */
  eventCount(): number {
    return this.events.length;
  }

  /** Throw if the run never completed — replay would be partial. */
  serialize(args: {
    call_site: CallSiteDescriptor;
    config: ReplayConfig;
  }): ReplayFile {
    if (!this.finalRun) {
      throw new Error(
        "CaptureBootstrapStream.serialize: run_complete never fired — capture is partial",
      );
    }
    const summary: ReplaySummary = {
      wall_time_ms: this.finalRun.wall_time_ms,
      throughput_per_sec: this.finalRun.throughput_per_sec,
      oracle_calls: this.finalRun.oracle_calls,
      candidate_calls: this.finalRun.candidate_calls,
      tier_mix: this.finalRun.tier_mix,
      axis_scores: this.finalRun.axis_scores,
      cluster_count: this.finalClusters.length,
      passes_synthesis_gate: this.finalRun.passes_synthesis_gate,
      events_captured: this.events.length,
    };
    const clusters_layout = computeClusterLayout(this.finalClusters);
    const file: ReplayFile = {
      schema_version: REPLAY_SCHEMA_VERSION,
      captured_at: new Date().toISOString(),
      call_site: args.call_site,
      config: args.config,
      summary,
      run: this.finalRun,
      clusters_layout,
      events: [...this.events].sort((a, b) => a.t_ms - b.t_ms),
    };
    // Validate before returning so a malformed capture surfaces here, not
    // later when Lane C tries to read the file.
    return ReplayFileSchema.parse(file);
  }
}

/**
 * Persist a captured ReplayFile to disk. Creates parent directory if needed.
 * Returns the byte size for the bench reporter.
 */
export async function writeReplayFile(
  path: string,
  file: ReplayFile,
): Promise<number> {
  await mkdir(dirname(path), { recursive: true });
  const json = JSON.stringify(file);
  await writeFile(path, json, "utf-8");
  return Buffer.byteLength(json, "utf-8");
}

/**
 * Deterministic 2D layout for the constellation. Approach:
 *   - Sort clusters by share descending so the dominant cluster sits near
 *     the center.
 *   - Use Vogel's golden-angle phyllotaxis (used in sunflower seeds) to
 *     spread clusters in [-1, 1]² without any cluster fighting another for
 *     space. Yields a visually balanced spread regardless of K.
 *   - Radius scales by 1/sqrt(share) so dense clusters cluster tighter
 *     toward the center, sparse clusters drift outward — matches the
 *     constellation's "structure-from-noise" feel from DESIGN.md.
 *
 * Lane C's deck.gl ScatterplotLayer can scale to canvas + add jitter per
 * incoming cell. Centroid embeddings from OnlineClusterer are not used as
 * positions (they're not 2D); this layout is the "Friday precompute" the
 * design spec calls for.
 */
export function computeClusterLayout(
  clusters: OnlineCluster[],
): ClusterLayoutPosition[] {
  if (clusters.length === 0) return [];
  const sorted = [...clusters].sort((a, b) => b.share - a.share);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5)); // ≈ 137.5°
  const positions: ClusterLayoutPosition[] = [];
  const maxR = 0.92; // small inset so canvas paddings don't clip
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i]!;
    // Phyllotaxis r = sqrt(i / N), capped at maxR.
    const r = Math.min(maxR, Math.sqrt((i + 0.5) / sorted.length));
    const theta = i * goldenAngle;
    let x = r * Math.cos(theta);
    let y = r * Math.sin(theta);
    // Clamp to schema range (rounding paranoia).
    x = Math.max(-1, Math.min(1, x));
    y = Math.max(-1, Math.min(1, y));
    positions.push({ cluster_id: c.cluster_id, x, y, share: c.share });
  }
  return positions;
}

