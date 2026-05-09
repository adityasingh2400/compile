import type {
  BootstrapPhase,
  BootstrapPhaseDoc,
  ClusterSnapshotDoc,
  LiveMetrics,
  ResultSummary,
  ScanReport,
  SyntheticCell,
  SyntheticRun,
  SynthesisEvent,
  VaultEvent,
  StreamEvent,
} from "@compile/schemas";

/**
 * The single seam Lane B writes through and Lane C subscribes to. Per
 * ENG_REVIEW.md "Coordination point — Lane B writes the bootstrap_phase
 * Convex doc shape first; Lane C imports it as the page-routing trigger."
 *
 * Implementations:
 *   - MemoryBootstrapStream — in-process, used by tests and by the
 *     synth-loader's internal harness.
 *   - ConvexBootstrapStream — wraps a thin Convex-client interface so we
 *     can swap the SDK in last (matches the ITensorlakeClient pattern).
 *
 * The stream is single-writer per `run_id`. A run is one bootstrap pass
 * end-to-end (CONNECT → RESULT). Most demos run one run.
 */
export interface IBootstrapStream {
  /**
   * Advance the singleton phase doc for `run_id`. Idempotent; advancing to
   * the same phase twice is a no-op. Phases must advance forward only —
   * implementations may reject backward writes (UI relies on monotonicity).
   */
  advancePhase(args: {
    run_id: string;
    phase: BootstrapPhase;
    current_call_site_id?: string;
    current_request_id?: string;
    error?: string;
  }): Promise<BootstrapPhaseDoc>;

  /** Page 2 / Page 3 source: the static-scan report. */
  emitScan(args: { run_id: string; report: ScanReport }): Promise<void>;

  /**
   * Page 6 source: per-cell row, one per completed Stage-2 call.
   * DESIGN.md: "Each Tensorlake worker writes one row per completed call
   * to Convex; React subscribes and the canvas paints diffs only."
   *
   * Implementations may batch these on the wire — but each cell remains
   * one logical row that the canvas can paint as a delta.
   */
  emitCell(args: {
    run_id: string;
    call_site_id: string;
    cell: SyntheticCell;
  }): Promise<void>;

  /** Live readout updates for the constellation chrome (top-of-screen counters). */
  emitLiveMetrics(args: { metrics: LiveMetrics }): Promise<void>;

  /** Periodic cluster snapshot — drives the centroid pulse on Page 7. */
  emitClusterSnapshot(args: { snapshot: ClusterSnapshotDoc }): Promise<void>;

  /** Final SyntheticRun — Page 7 freezes on this. */
  emitRunComplete(args: {
    run_id: string;
    run: SyntheticRun;
  }): Promise<void>;

  /** Page 8 / Page 9 lifecycle (spec returned → code emitted → validating → passed/failed). */
  emitSynthesisEvent(args: { event: SynthesisEvent }): Promise<void>;

  /** Page 10: every Vault write (positive or negative). */
  emitVaultEvent(args: { event: VaultEvent }): Promise<void>;

  /** Page 11: cost / savings summary. */
  emitResult(args: { summary: ResultSummary }): Promise<void>;

  /** Optional: flush any wire-level batching. Called between phases. */
  flush?(): Promise<void>;
}

/**
 * No-op implementation — useful when a handler isn't wired to a UI
 * (e.g. unit tests of a single MCP tool that don't care about the stream).
 */
export class NoopBootstrapStream implements IBootstrapStream {
  async advancePhase(args: {
    run_id: string;
    phase: BootstrapPhase;
  }): Promise<BootstrapPhaseDoc> {
    const now = new Date().toISOString();
    return {
      run_id: args.run_id,
      phase: args.phase,
      page_index: 1,
      started_at: now,
      updated_at: now,
    };
  }
  async emitScan(): Promise<void> {}
  async emitCell(): Promise<void> {}
  async emitLiveMetrics(): Promise<void> {}
  async emitClusterSnapshot(): Promise<void> {}
  async emitRunComplete(): Promise<void> {}
  async emitSynthesisEvent(): Promise<void> {}
  async emitVaultEvent(): Promise<void> {}
  async emitResult(): Promise<void> {}
}

/** Re-export the wire-event union for ergonomics. */
export type { StreamEvent };
