import {
  PHASE_INDEX,
  type BootstrapPhase,
  type BootstrapPhaseDoc,
  type ClusterSnapshotDoc,
  type LiveMetrics,
  type ResultSummary,
  type ScanReport,
  type SyntheticCell,
  type SyntheticRun,
  type SynthesisEvent,
  type VaultEvent,
} from "@compile/schemas";
import type { IBootstrapStream } from "./interface.js";

/**
 * Thin wrapper interface over the Convex client. Keeping the SDK behind
 * this seam lets us defer pulling in `convex` proper until Lane C wires
 * the deployment. ENG_REVIEW.md "all sponsor integrations behind thin
 * wrapper interfaces" — same pattern as ITensorlakeClient / INiaClient.
 *
 * The function-name strings here MUST match the mutation paths in
 * convex/*.ts. Lane C will register the real ConvexHttpClient bindings.
 */
export interface IConvexClientLike {
  mutation(name: string, args: Record<string, unknown>): Promise<unknown>;
}

/**
 * Real-Convex implementation. Wraps the IConvexClientLike seam — Lane C
 * passes a `new ConvexHttpClient(url).mutation`-compatible adapter when
 * the deployment is live.
 *
 * Wire-level batching: `emitCell` is called once per completed Stage-2
 * call (DESIGN.md "one row per completed call"). At 100K calls / 28s
 * that's ~3.5K writes/sec — past Convex's safe per-mutation rate. We
 * buffer per `run_id` and flush every `flushIntervalMs` (default 50ms).
 * Each flush is one mutation `cells.insertMany` taking N cells; the
 * mutation inserts N rows, preserving "one row per cell" at the data
 * model level. The wire transport is the only thing batched.
 */
export interface ConvexBootstrapStreamOptions {
  client: IConvexClientLike;
  /** Cell-batch flush cadence in ms. Default 50ms (~20 paints/sec). */
  flushIntervalMs?: number;
  /** Max cells per batch mutation. Convex caps mutation argument size. */
  maxBatchSize?: number;
}

export class ConvexBootstrapStream implements IBootstrapStream {
  private readonly client: IConvexClientLike;
  private readonly flushIntervalMs: number;
  private readonly maxBatchSize: number;
  private readonly cellBuffer = new Map<
    string,
    { run_id: string; call_site_id: string; cell: SyntheticCell }[]
  >();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(opts: ConvexBootstrapStreamOptions) {
    this.client = opts.client;
    this.flushIntervalMs = opts.flushIntervalMs ?? 50;
    this.maxBatchSize = opts.maxBatchSize ?? 1000;
  }

  async advancePhase(args: {
    run_id: string;
    phase: BootstrapPhase;
    current_call_site_id?: string;
    current_request_id?: string;
    error?: string;
  }): Promise<BootstrapPhaseDoc> {
    // Flush any pending cells before transitioning so the UI sees the
    // page-6 grid fully painted before page-7 reveals clusters.
    await this.flush();
    const doc = (await this.client.mutation("phase:advance", {
      run_id: args.run_id,
      phase: args.phase,
      page_index: PHASE_INDEX[args.phase],
      current_call_site_id: args.current_call_site_id,
      current_request_id: args.current_request_id,
      error: args.error,
    })) as BootstrapPhaseDoc;
    return doc;
  }

  async emitScan(args: { run_id: string; report: ScanReport }): Promise<void> {
    await this.client.mutation("scan:put", { run_id: args.run_id, report: args.report });
  }

  async emitCell(args: {
    run_id: string;
    call_site_id: string;
    cell: SyntheticCell;
  }): Promise<void> {
    const key = args.run_id;
    const buf = this.cellBuffer.get(key) ?? [];
    buf.push(args);
    this.cellBuffer.set(key, buf);
    if (buf.length >= this.maxBatchSize) {
      await this.flushKey(key);
      return;
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        // Best-effort; errors surface via flush() on next phase advance.
        void this.flush();
      }, this.flushIntervalMs);
    }
  }

  async emitLiveMetrics(args: { metrics: LiveMetrics }): Promise<void> {
    await this.client.mutation("metrics:put", { metrics: args.metrics });
  }

  async emitClusterSnapshot(args: { snapshot: ClusterSnapshotDoc }): Promise<void> {
    await this.client.mutation("clusters:put", { snapshot: args.snapshot });
  }

  async emitRunComplete(args: { run_id: string; run: SyntheticRun }): Promise<void> {
    await this.flushKey(args.run_id);
    await this.client.mutation("runs:complete", { run_id: args.run_id, run: args.run });
  }

  async emitSynthesisEvent(args: { event: SynthesisEvent }): Promise<void> {
    await this.client.mutation("synthesis:event", { event: args.event });
  }

  async emitVaultEvent(args: { event: VaultEvent }): Promise<void> {
    await this.client.mutation("vault:event", { event: args.event });
  }

  async emitResult(args: { summary: ResultSummary }): Promise<void> {
    await this.client.mutation("result:put", { summary: args.summary });
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    const keys = [...this.cellBuffer.keys()];
    for (const k of keys) await this.flushKey(k);
  }

  private async flushKey(key: string): Promise<void> {
    const buf = this.cellBuffer.get(key);
    if (!buf || buf.length === 0) return;
    this.cellBuffer.set(key, []);
    // Group by call_site_id so each mutation row is single-call-site —
    // simplifies the UI subscription filter on Page 6.
    const byCallSite = new Map<string, SyntheticCell[]>();
    for (const c of buf) {
      const arr = byCallSite.get(c.call_site_id) ?? [];
      arr.push(c.cell);
      byCallSite.set(c.call_site_id, arr);
    }
    for (const [call_site_id, cells] of byCallSite) {
      await this.client.mutation("cells:insertMany", {
        run_id: key,
        call_site_id,
        cells,
      });
    }
  }
}
