import {
  BOOTSTRAP_PHASES,
  PHASE_INDEX,
  type BootstrapPhase,
  type BootstrapPhaseDoc,
  type ClusterSnapshotDoc,
  type LiveMetrics,
  type ResultSummary,
  type ScanReport,
  type StreamEvent,
  type SyntheticCell,
  type SyntheticRun,
  type SynthesisEvent,
  type VaultEvent,
} from "@compile/schemas";
import type { IBootstrapStream } from "./interface.js";

/**
 * In-process implementation. Used by tests, the synth-loader Friday harness,
 * and Lane C local dev (no Convex dependency). Records every wire event in
 * `events` for assertions; `phase`, `liveMetricsByCallSite`, etc. expose
 * the same materialized views Convex would surface to subscribers.
 */
export class MemoryBootstrapStream implements IBootstrapStream {
  readonly events: StreamEvent[] = [];
  readonly phaseByRun = new Map<string, BootstrapPhaseDoc>();
  readonly scanByRun = new Map<string, ScanReport>();
  readonly cellsByRun = new Map<string, SyntheticCell[]>();
  readonly liveMetricsByCallSite = new Map<string, LiveMetrics>();
  readonly clusterSnapshots: ClusterSnapshotDoc[] = [];
  readonly runs = new Map<string, SyntheticRun>();
  readonly synthesisEvents: SynthesisEvent[] = [];
  readonly vaultEvents: VaultEvent[] = [];
  readonly results = new Map<string, ResultSummary>();

  async advancePhase(args: {
    run_id: string;
    phase: BootstrapPhase;
    current_call_site_id?: string;
    current_request_id?: string;
    error?: string;
  }): Promise<BootstrapPhaseDoc> {
    const now = new Date().toISOString();
    const prev = this.phaseByRun.get(args.run_id);
    // Forward-only — UI relies on monotonic page index.
    if (prev && PHASE_INDEX[args.phase] < PHASE_INDEX[prev.phase]) {
      throw new Error(
        `phase regression: ${prev.phase} → ${args.phase} for run ${args.run_id}`,
      );
    }
    const doc: BootstrapPhaseDoc = {
      run_id: args.run_id,
      phase: args.phase,
      page_index: PHASE_INDEX[args.phase],
      started_at: prev?.started_at ?? now,
      updated_at: now,
      current_call_site_id: args.current_call_site_id ?? prev?.current_call_site_id,
      current_request_id: args.current_request_id ?? prev?.current_request_id,
      error: args.error,
    };
    this.phaseByRun.set(args.run_id, doc);
    this.events.push({ kind: "phase", doc });
    return doc;
  }

  async emitScan(args: { run_id: string; report: ScanReport }): Promise<void> {
    this.scanByRun.set(args.run_id, args.report);
    this.events.push({ kind: "scan", run_id: args.run_id, report: args.report });
  }

  async emitCell(args: {
    run_id: string;
    call_site_id: string;
    cell: SyntheticCell;
  }): Promise<void> {
    const list = this.cellsByRun.get(args.run_id) ?? [];
    list.push(args.cell);
    this.cellsByRun.set(args.run_id, list);
    this.events.push({
      kind: "cell",
      run_id: args.run_id,
      call_site_id: args.call_site_id,
      cell: args.cell,
    });
  }

  async emitLiveMetrics(args: { metrics: LiveMetrics }): Promise<void> {
    this.liveMetricsByCallSite.set(args.metrics.call_site_id, args.metrics);
    this.events.push({ kind: "live_metrics", metrics: args.metrics });
  }

  async emitClusterSnapshot(args: { snapshot: ClusterSnapshotDoc }): Promise<void> {
    this.clusterSnapshots.push(args.snapshot);
    this.events.push({ kind: "cluster_snapshot", snapshot: args.snapshot });
  }

  async emitRunComplete(args: { run_id: string; run: SyntheticRun }): Promise<void> {
    this.runs.set(args.run.call_site_id, args.run);
    this.events.push({ kind: "run_complete", run_id: args.run_id, run: args.run });
  }

  async emitSynthesisEvent(args: { event: SynthesisEvent }): Promise<void> {
    this.synthesisEvents.push(args.event);
    this.events.push({ kind: "synthesis", event: args.event });
  }

  async emitVaultEvent(args: { event: VaultEvent }): Promise<void> {
    this.vaultEvents.push(args.event);
    this.events.push({ kind: "vault", event: args.event });
  }

  async emitResult(args: { summary: ResultSummary }): Promise<void> {
    this.results.set(args.summary.run_id, args.summary);
    this.events.push({ kind: "result", summary: args.summary });
  }

  async flush(): Promise<void> {}

  /** Test ergonomics: events of a given kind, in order. */
  eventsOf<K extends StreamEvent["kind"]>(
    kind: K,
  ): Array<Extract<StreamEvent, { kind: K }>> {
    return this.events.filter((e): e is Extract<StreamEvent, { kind: K }> => e.kind === kind);
  }

  /** Test ergonomics: ordered list of phases written for a run. */
  phaseOrderFor(run_id: string): BootstrapPhase[] {
    return this.events
      .filter((e): e is Extract<StreamEvent, { kind: "phase" }> => e.kind === "phase")
      .filter((e) => e.doc.run_id === run_id)
      .map((e) => e.doc.phase);
  }
}

/** Sanity helper exported so tests don't reach into the const. */
export { BOOTSTRAP_PHASES };
