import { readFile } from "node:fs/promises";
import {
  REPLAY_SCHEMA_VERSION,
  ReplayFileSchema,
  type ReplayFile,
  type StreamEvent,
} from "@compile/schemas";
import type { IBootstrapStream } from "@compile/stream";

/**
 * Replays a captured ReplayFile through any IBootstrapStream — Memory,
 * Convex, or anything else implementing the seam. The UI cannot tell a
 * replayed run from a live one because every emit lands as the same kind
 * of stream event Lane C already subscribes to (ENG_REVIEW.md failure
 * mode #2: "if grid fails Saturday, demo plays the recording and narrates
 * over it").
 *
 * Scheduling: a single sleep-loop with an index pointer instead of 100K
 * setTimeouts. Sub-millisecond setTimeout precision in Node is unreliable
 * and queueing 100K timers blows the heap; a tight loop yielding to the
 * event loop is both faster and bounded.
 */

export interface ReplayPlayerOptions {
  /** Path or already-parsed file. String is read with `readFile`. */
  file: string | ReplayFile;
  /** Target stream — Convex/Memory/whatever implements IBootstrapStream. */
  stream: IBootstrapStream;
  /** Playback speed multiplier. 1 = original wall time. 5 = 5× faster. */
  speed?: number;
  /**
   * Uniformly scale event t_ms so the full playback spans this many ms.
   * Used when the recording's wall time doesn't match demo intent —
   * e.g., the stub bench finishes in 345ms but DESIGN.md's hero animation
   * wants ~28s of progressive painting. Setting `stretch_to_ms: 28000`
   * spreads events across 28s. Mutually exclusive with `speed`; if both
   * are supplied, `stretch_to_ms` wins (speed is ignored for clarity).
   * When real Tensorlake recordings land (~28-78s span naturally), leave
   * this unset and demo runs at 1×.
   */
  stretch_to_ms?: number;
  /** Override the run_id baked into captured events. Useful when re-using
   * one golden replay across multiple Convex demo runs without colliding
   * primary keys. When omitted, the original run_id is preserved. */
  run_id?: string;
  /** Called with the event's t_ms after each emit. Test hook. */
  onProgress?: (t_ms: number, eventIndex: number, total: number) => void;
  /** Called when playback finishes naturally. */
  onComplete?: () => void;
}

export async function replayRun(opts: ReplayPlayerOptions): Promise<void> {
  const file = await loadReplayFile(opts.file);
  if (file.schema_version !== REPLAY_SCHEMA_VERSION) {
    throw new Error(
      `replayRun: replay file schema version ${file.schema_version} does not match player ${REPLAY_SCHEMA_VERSION}`,
    );
  }

  // Resolve effective per-event scale factor. stretch_to_ms wins over speed
  // when both are supplied — a clearer mental model for the operator
  // ("make the demo span 28s") than juggling a multiplier.
  let scale = 1 / (opts.speed ?? 1);
  if (opts.stretch_to_ms !== undefined) {
    if (opts.stretch_to_ms <= 0) {
      throw new Error(`replayRun: stretch_to_ms must be > 0, got ${opts.stretch_to_ms}`);
    }
    const lastTms = file.events.at(-1)?.t_ms ?? 0;
    if (lastTms === 0) scale = 1; // can't stretch a zero-span recording
    else scale = opts.stretch_to_ms / lastTms;
  } else if ((opts.speed ?? 1) <= 0) {
    throw new Error(`replayRun: speed must be > 0, got ${opts.speed}`);
  }

  const events = file.events;
  const start = performance.now();
  let i = 0;

  while (i < events.length) {
    const dueTime = events[i]!.t_ms * scale;
    const elapsed = performance.now() - start;
    if (elapsed >= dueTime) {
      const event = remapRunId(events[i]!.event, opts.run_id);
      await emit(opts.stream, event);
      opts.onProgress?.(events[i]!.t_ms, i, events.length);
      i++;
      continue;
    }
    // Sleep for the smaller of (next event delta) or 25ms — short enough
    // to keep timing tight, long enough to avoid spinning the CPU.
    const wait = Math.min(25, dueTime - elapsed);
    await sleep(Math.max(1, wait));
  }
  opts.onComplete?.();
}

async function loadReplayFile(input: string | ReplayFile): Promise<ReplayFile> {
  if (typeof input !== "string") return ReplayFileSchema.parse(input);
  const raw = await readFile(input, "utf-8");
  const json = JSON.parse(raw);
  return ReplayFileSchema.parse(json);
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/**
 * Mirror of CaptureBootstrapStream's record() — translate a captured
 * StreamEvent into the equivalent IBootstrapStream call. Keeping this
 * paired with the capture wrapper so adding a new StreamEvent kind shows
 * up in both files at once.
 */
async function emit(stream: IBootstrapStream, event: StreamEvent): Promise<void> {
  switch (event.kind) {
    case "phase":
      await stream.advancePhase({
        run_id: event.doc.run_id,
        phase: event.doc.phase,
        current_call_site_id: event.doc.current_call_site_id,
        current_request_id: event.doc.current_request_id,
        error: event.doc.error,
      });
      return;
    case "scan":
      await stream.emitScan({ run_id: event.run_id, report: event.report });
      return;
    case "cell":
      await stream.emitCell({
        run_id: event.run_id,
        call_site_id: event.call_site_id,
        cell: event.cell,
      });
      return;
    case "live_metrics":
      await stream.emitLiveMetrics({ metrics: event.metrics });
      return;
    case "cluster_snapshot":
      await stream.emitClusterSnapshot({ snapshot: event.snapshot });
      return;
    case "run_complete":
      await stream.emitRunComplete({ run_id: event.run_id, run: event.run });
      return;
    case "synthesis":
      await stream.emitSynthesisEvent({ event: event.event });
      return;
    case "vault":
      await stream.emitVaultEvent({ event: event.event });
      return;
    case "result":
      await stream.emitResult({ summary: event.summary });
      return;
  }
}

/**
 * If the operator supplied a fresh run_id, walk the event and rewrite the
 * run_id field everywhere it appears. Each StreamEvent kind carries the
 * id in a different shape, so this is per-kind. Done before emit so
 * idempotent: replaying the same file twice with different run_ids yields
 * fresh Convex rows.
 */
function remapRunId(event: StreamEvent, run_id: string | undefined): StreamEvent {
  if (!run_id) return event;
  switch (event.kind) {
    case "phase":
      return { ...event, doc: { ...event.doc, run_id } };
    case "scan":
      return { ...event, run_id };
    case "cell":
      return { ...event, run_id };
    case "live_metrics":
      return { ...event, metrics: { ...event.metrics, run_id } };
    case "cluster_snapshot":
      return { ...event, snapshot: { ...event.snapshot, run_id } };
    case "run_complete":
      return { ...event, run_id };
    case "synthesis":
      return { ...event, event: { ...event.event, run_id } };
    case "vault":
      return { ...event, event: { ...event.event, run_id } };
    case "result":
      return { ...event, summary: { ...event.summary, run_id } };
  }
}
