import { z } from "zod";
import { CallSiteDescriptorSchema, ScanReportSchema } from "./scanner.js";
import { AxisScoresSchema } from "./cluster.js";
import {
  TierMixSchema,
  OnlineClusterSchema,
  SyntheticRunSchema,
  SyntheticCellSchema,
} from "./synthload.js";
import { VaultEntrySchema } from "./vault.js";

/**
 * The eleven bootstrap phases. Names match ENG_REVIEW.md D7 page table
 * 1:1 — pages render from a Convex subscription on a `bootstrap_phase`
 * doc and each phase write moves the UI forward (no clicks, no scrolling).
 *
 * Phase ordering MUST be preserved — the constellation hero is page 6.
 */
export const BOOTSTRAP_PHASES = [
  "connect",          //  1 — CONNECT
  "reading_code",     //  2 — READING YOUR CODE
  "classify",         //  3 — CLASSIFY (codifiability decided, D13 / Stage 1)
  "reading_docs",     //  4 — READING YOUR DOCS
  "expanding",        //  5 — EXPANDING TO 100,000
  "stress_test",      //  6 — STRESS TEST: classify_lead_tier (constellation hero)
  "clusters_revealed",//  7 — CLUSTERS REVEALED
  "agent_writing",    //  8 — THE AGENT WRITES THE CODE
  "validate",         //  9 — VALIDATE
  "vault_write",      // 10 — VAULT WRITE
  "result",           // 11 — RESULT
] as const;

export const BootstrapPhaseEnum = z.enum(BOOTSTRAP_PHASES);
export type BootstrapPhase = z.infer<typeof BootstrapPhaseEnum>;

/** Numeric page index 1..11 for ergonomics in the UI. */
export const PHASE_INDEX: Record<BootstrapPhase, number> =
  Object.fromEntries(
    BOOTSTRAP_PHASES.map((p, i) => [p, i + 1]),
  ) as Record<BootstrapPhase, number>;

/**
 * Singleton-per-run document Lane C subscribes to. Each phase write moves
 * the page forward. `current_call_site_id` lets Page 6 / Page 7 render the
 * specific call site under stress test (D7: "STRESS TEST: classify_lead_tier").
 */
export const BootstrapPhaseDocSchema = z.object({
  run_id: z.string(),
  phase: BootstrapPhaseEnum,
  page_index: z.number().int().min(1).max(11),
  started_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  current_call_site_id: z.string().optional(),
  current_request_id: z.string().optional(),
  error: z.string().optional(),
});
export type BootstrapPhaseDoc = z.infer<typeof BootstrapPhaseDocSchema>;

/**
 * Stage-2 live metrics row. Updated as cells land so Page 6 readouts can
 * tick in real time (per DESIGN.md hero visual: "Schema-stability and
 * determinism scores tick up at the top in real time").
 */
export const LiveMetricsSchema = z.object({
  run_id: z.string(),
  call_site_id: z.string(),
  total_done: z.number().int().nonnegative(),
  oracle_done: z.number().int().nonnegative(),
  candidate_done: z.number().int().nonnegative(),
  throughput_per_sec: z.number().nonnegative(),
  tier_mix: TierMixSchema,
  axis_scores: AxisScoresSchema.extend({
    oracle_agreement: z.number().min(0).max(1),
  }),
  updated_at: z.string().datetime(),
});
export type LiveMetrics = z.infer<typeof LiveMetricsSchema>;

/**
 * Per-snapshot cluster state. DESIGN.md: "we don't need real-time UMAP at
 * runtime — pre-compute cluster centroid positions Friday from a
 * representative run, then on-demo each incoming call gets dropped near its
 * assigned cluster's centroid with small jitter."
 */
export const ClusterSnapshotDocSchema = z.object({
  run_id: z.string(),
  call_site_id: z.string(),
  snapshot_seq: z.number().int().nonnegative(),
  clusters: z.array(OnlineClusterSchema),
  updated_at: z.string().datetime(),
});
export type ClusterSnapshotDoc = z.infer<typeof ClusterSnapshotDocSchema>;

/**
 * Synthesis lifecycle event for Page 8 (THE AGENT WRITES) + Page 9 (VALIDATE).
 * Drives the typewriter animation of agent-emitted code and the
 * holdout-trace pass/fail flashes.
 */
export const SynthesisStage = z.enum([
  "spec_returned",   // request_synthesis returned spec to agent
  "code_emitted",    // agent submitted envelope (pre-validation)
  "validating",      // gate harness running on holdout
  "passed",          // gate ≥98% — Vault write next
  "failed",          // gate failed OR synthesizable=false
]);
export type SynthesisStageType = z.infer<typeof SynthesisStage>;

export const SynthesisEventSchema = z.object({
  run_id: z.string(),
  request_id: z.string(),
  cluster_id: z.string(),
  stage: SynthesisStage,
  function_name: z.string().optional(),
  holdout_match_rate: z.number().min(0).max(1).optional(),
  failure_reason: z.string().optional(),
  emitted_at: z.string().datetime(),
});
export type SynthesisEvent = z.infer<typeof SynthesisEventSchema>;

/** Vault write event for Page 10. Mirrors the D8 negative-Vault retry policy. */
export const VaultEventSchema = z.object({
  run_id: z.string(),
  entry: VaultEntrySchema,
  emitted_at: z.string().datetime(),
});
export type VaultEvent = z.infer<typeof VaultEventSchema>;

/**
 * Final cost / savings row for Page 11. Mirrors the 90-second report
 * shape from DESIGN.md (Distribution Plan section).
 */
export const ResultSummarySchema = z.object({
  run_id: z.string(),
  files_scanned: z.number().int().nonnegative(),
  call_sites_total: z.number().int().nonnegative(),
  stage1_green: z.number().int().nonnegative(),
  stage1_yellow: z.number().int().nonnegative(),
  stage1_red: z.number().int().nonnegative(),
  stage2_runs: z.number().int().nonnegative(),
  stage2_passes: z.number().int().nonnegative(),
  codified_count: z.number().int().nonnegative(),
  negative_vault_count: z.number().int().nonnegative(),
  projected_annual_savings_usd: z.number(),
  sandbox_compute_cost_usd: z.number(),
  total_synthetic_calls: z.number().int().nonnegative(),
  wall_time_ms: z.number().nonnegative(),
  emitted_at: z.string().datetime(),
});
export type ResultSummary = z.infer<typeof ResultSummarySchema>;

/**
 * The wire envelope the IBootstrapStream emits. Discriminated union so the
 * Convex / memory implementations can route to the right table.
 */
export const StreamEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("phase"), doc: BootstrapPhaseDocSchema }),
  z.object({ kind: z.literal("scan"), report: ScanReportSchema, run_id: z.string() }),
  z.object({
    kind: z.literal("cell"),
    run_id: z.string(),
    call_site_id: z.string(),
    cell: SyntheticCellSchema,
  }),
  z.object({ kind: z.literal("live_metrics"), metrics: LiveMetricsSchema }),
  z.object({ kind: z.literal("cluster_snapshot"), snapshot: ClusterSnapshotDocSchema }),
  z.object({
    kind: z.literal("run_complete"),
    run_id: z.string(),
    run: SyntheticRunSchema,
  }),
  z.object({ kind: z.literal("synthesis"), event: SynthesisEventSchema }),
  z.object({ kind: z.literal("vault"), event: VaultEventSchema }),
  z.object({ kind: z.literal("result"), summary: ResultSummarySchema }),
]);
export type StreamEvent = z.infer<typeof StreamEventSchema>;

export const _CallSiteDescriptorRef = CallSiteDescriptorSchema;
