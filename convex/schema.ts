import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Source-of-truth Convex schema for the eleven-page bootstrap demo.
 * Mirrors @compile/schemas wire shapes — keep them in lockstep when
 * adding fields. ENG_REVIEW.md D7: "Pages render from a Convex
 * subscription on a `bootstrap_phase` document. Each phase write moves
 * the UI forward."
 */

const phaseLiteral = v.union(
  v.literal("connect"),
  v.literal("reading_code"),
  v.literal("classify"),
  v.literal("reading_docs"),
  v.literal("expanding"),
  v.literal("stress_test"),
  v.literal("clusters_revealed"),
  v.literal("agent_writing"),
  v.literal("validate"),
  v.literal("vault_write"),
  v.literal("result"),
);

const tierLiteral = v.union(
  v.literal("tier_1"),
  v.literal("tier_2"),
  v.literal("tier_3"),
);

const cellStatus = v.union(
  v.literal("queued"),
  v.literal("in_flight"),
  v.literal("done"),
  v.literal("error"),
);

export default defineSchema({
  // Singleton-per-run. UI subscribes to this and renders the matching page.
  bootstrap_phase: defineTable({
    run_id: v.string(),
    phase: phaseLiteral,
    page_index: v.number(),
    started_at: v.string(),
    updated_at: v.string(),
    current_call_site_id: v.optional(v.string()),
    current_request_id: v.optional(v.string()),
    error: v.optional(v.string()),
  }).index("by_run", ["run_id"]),

  // Static-scan output (Stage 1). Drives Pages 2 + 3.
  scan_report: defineTable({
    run_id: v.string(),
    repo_path: v.string(),
    files_scanned: v.number(),
    tree_signature: v.string(),
    scanned_at: v.string(),
    // CallSiteDescriptor[] mirrored as opaque records — strict shape lives
    // in @compile/schemas/scanner.ts. Keeping it `v.any()` here avoids
    // schema duplication across two source-of-truth files.
    call_sites: v.array(v.any()),
  }).index("by_run", ["run_id"]),

  // The constellation source. One row per completed Stage-2 call (DESIGN.md).
  // Lane B emits via @compile/stream which batches on the wire only.
  synthetic_cells: defineTable({
    run_id: v.string(),
    call_site_id: v.string(),
    input_id: v.string(),
    worker_id: v.number(),
    status: cellStatus,
    path: v.union(v.literal("oracle"), v.literal("candidate")),
    tier_assigned: v.optional(tierLiteral),
    output: v.optional(v.any()),
    cluster_id: v.optional(v.string()),
    latency_ms: v.optional(v.number()),
    cost_usd: v.optional(v.number()),
  })
    .index("by_run_callsite", ["run_id", "call_site_id"])
    .index("by_run_cluster", ["run_id", "cluster_id"]),

  // Live readout — Page 6 top chrome (counters, throughput, axis scores).
  live_metrics: defineTable({
    run_id: v.string(),
    call_site_id: v.string(),
    total_done: v.number(),
    oracle_done: v.number(),
    candidate_done: v.number(),
    throughput_per_sec: v.number(),
    tier_mix: v.object({
      tier_1: v.number(),
      tier_2: v.number(),
      tier_3: v.number(),
    }),
    axis_scores: v.any(), // shape lives in @compile/schemas/cluster.ts
    updated_at: v.string(),
  }).index("by_run_callsite", ["run_id", "call_site_id"]),

  // Versioned cluster snapshots — Page 6 → 7 reveal.
  cluster_snapshot: defineTable({
    run_id: v.string(),
    call_site_id: v.string(),
    snapshot_seq: v.number(),
    clusters: v.array(v.any()),
    updated_at: v.string(),
  }).index("by_run_callsite_seq", ["run_id", "call_site_id", "snapshot_seq"]),

  // Final SyntheticRun per call site. Page 7 freezes on this.
  synthetic_run: defineTable({
    run_id: v.string(),
    call_site_id: v.string(),
    payload: v.any(), // SyntheticRun shape
    completed_at: v.string(),
  }).index("by_run_callsite", ["run_id", "call_site_id"]),

  // Pages 8 + 9 lifecycle — spec_returned → code_emitted → validating → passed/failed
  synthesis_event: defineTable({
    run_id: v.string(),
    request_id: v.string(),
    cluster_id: v.string(),
    stage: v.union(
      v.literal("spec_returned"),
      v.literal("code_emitted"),
      v.literal("validating"),
      v.literal("passed"),
      v.literal("failed"),
    ),
    function_name: v.optional(v.string()),
    holdout_match_rate: v.optional(v.number()),
    failure_reason: v.optional(v.string()),
    emitted_at: v.string(),
  })
    .index("by_request", ["request_id"])
    .index("by_run", ["run_id"]),

  // Page 10 — every Vault write (positive + negative D8).
  vault_event: defineTable({
    run_id: v.string(),
    entry: v.any(), // VaultEntry discriminated union
    emitted_at: v.string(),
  }).index("by_run", ["run_id"]),

  // Page 11 — final cost / savings panel.
  result_summary: defineTable({
    run_id: v.string(),
    files_scanned: v.number(),
    call_sites_total: v.number(),
    stage1_green: v.number(),
    stage1_yellow: v.number(),
    stage1_red: v.number(),
    stage2_runs: v.number(),
    stage2_passes: v.number(),
    codified_count: v.number(),
    negative_vault_count: v.number(),
    projected_annual_savings_usd: v.number(),
    sandbox_compute_cost_usd: v.number(),
    total_synthetic_calls: v.number(),
    wall_time_ms: v.number(),
    emitted_at: v.string(),
  }).index("by_run", ["run_id"]),
});
