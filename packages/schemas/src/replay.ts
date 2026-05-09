import { z } from "zod";
import { CallSiteDescriptorSchema } from "./scanner.js";
import {
  TierMixSchema,
  SyntheticRunSchema,
} from "./synthload.js";
import { AxisScoresSchema } from "./cluster.js";
import { StreamEventSchema } from "./stream.js";

/**
 * Versioned JSON shape for `data/bench/golden.json`. Produced by
 * `npm run bench`; consumed by the replay player and by Lane C.
 *
 * Two roles:
 *   1. Bench artifact — proves Friday derisk #2 (100K calls in ≤30s).
 *   2. Demo escape hatch — if Saturday's Tensorlake fails, the player
 *      re-emits these events through any IBootstrapStream and the UI
 *      can't tell live runs from replayed runs (failure mode #2).
 *
 * Schema is versioned so the player can refuse incompatible recordings
 * after future changes to the StreamEvent union.
 */
export const REPLAY_SCHEMA_VERSION = 1 as const;

export const ReplayConfigSchema = z.object({
  total_calls: z.number().int().positive(),
  oracle_fraction: z.number().min(0).max(1),
  worker_count: z.number().int().positive(),
  seed_count: z.number().int().positive(),
});
export type ReplayConfig = z.infer<typeof ReplayConfigSchema>;

export const ReplaySummarySchema = z.object({
  wall_time_ms: z.number().nonnegative(),
  throughput_per_sec: z.number().nonnegative(),
  oracle_calls: z.number().int().nonnegative(),
  candidate_calls: z.number().int().nonnegative(),
  tier_mix: TierMixSchema,
  axis_scores: AxisScoresSchema.extend({
    oracle_agreement: z.number().min(0).max(1),
  }),
  cluster_count: z.number().int().nonnegative(),
  passes_synthesis_gate: z.boolean(),
  /** Number of stream events captured (cells + metrics + snapshots + run_complete + phase advances). */
  events_captured: z.number().int().nonnegative(),
});
export type ReplaySummary = z.infer<typeof ReplaySummarySchema>;

/**
 * Pre-computed 2D layout for the constellation. DESIGN.md: "we don't need
 * real-time UMAP at runtime — pre-compute cluster centroid positions
 * Friday from a representative run, then on-demo each incoming call gets
 * dropped near its assigned cluster's centroid with small jitter."
 *
 * `x` and `y` are normalized to [-1, 1]. Lane C scales them to canvas size.
 */
export const ClusterLayoutPositionSchema = z.object({
  cluster_id: z.string(),
  x: z.number().min(-1).max(1),
  y: z.number().min(-1).max(1),
  share: z.number().min(0).max(1),
});
export type ClusterLayoutPosition = z.infer<typeof ClusterLayoutPositionSchema>;

/**
 * One captured event with its offset (ms from t0). Player schedules emits
 * at `t_ms / speed` from playback start.
 */
export const TimedStreamEventSchema = z.object({
  t_ms: z.number().nonnegative(),
  event: StreamEventSchema,
});
export type TimedStreamEvent = z.infer<typeof TimedStreamEventSchema>;

export const ReplayFileSchema = z.object({
  schema_version: z.literal(REPLAY_SCHEMA_VERSION),
  captured_at: z.string().datetime(),
  /** The exact CallSiteDescriptor the bench ran against. Lane C can render
   * Page 6 chrome from this (e.g. "STRESS TEST: classify_ticket_priority"). */
  call_site: CallSiteDescriptorSchema,
  config: ReplayConfigSchema,
  summary: ReplaySummarySchema,
  /** The synthetic run produced — same shape Stage-2 returned live. */
  run: SyntheticRunSchema,
  clusters_layout: z.array(ClusterLayoutPositionSchema),
  /** All captured events in emission order. Already sorted by t_ms. */
  events: z.array(TimedStreamEventSchema),
});
export type ReplayFile = z.infer<typeof ReplayFileSchema>;
