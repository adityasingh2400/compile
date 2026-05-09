import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Singleton phase doc per run_id. Forward-only — UI relies on monotonic
 * page index. The mutation rejects backward writes to keep the demo flow
 * deterministic across ten rehearsals.
 */
const PHASE_ORDER = [
  "connect",
  "reading_code",
  "classify",
  "reading_docs",
  "expanding",
  "stress_test",
  "clusters_revealed",
  "agent_writing",
  "validate",
  "vault_write",
  "result",
] as const;

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

export const advance = mutation({
  args: {
    run_id: v.string(),
    phase: phaseLiteral,
    page_index: v.number(),
    current_call_site_id: v.optional(v.string()),
    current_request_id: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    const incomingIdx = PHASE_ORDER.indexOf(args.phase as (typeof PHASE_ORDER)[number]);
    if (incomingIdx === -1) {
      throw new Error(`unknown phase: ${args.phase}`);
    }
    const existing = await ctx.db
      .query("bootstrap_phase")
      .withIndex("by_run", (q) => q.eq("run_id", args.run_id))
      .first();
    if (existing) {
      const existingIdx = PHASE_ORDER.indexOf(
        existing.phase as (typeof PHASE_ORDER)[number],
      );
      if (incomingIdx < existingIdx) {
        throw new Error(
          `phase regression: ${existing.phase} → ${args.phase}`,
        );
      }
      const patch = {
        phase: args.phase,
        page_index: args.page_index,
        updated_at: now,
        current_call_site_id: args.current_call_site_id ?? existing.current_call_site_id,
        current_request_id: args.current_request_id ?? existing.current_request_id,
        error: args.error,
      };
      await ctx.db.patch(existing._id, patch);
      return { ...existing, ...patch };
    }
    const doc = {
      run_id: args.run_id,
      phase: args.phase,
      page_index: args.page_index,
      started_at: now,
      updated_at: now,
      current_call_site_id: args.current_call_site_id,
      current_request_id: args.current_request_id,
      error: args.error,
    };
    const id = await ctx.db.insert("bootstrap_phase", doc);
    return { _id: id, ...doc };
  },
});

export const get = query({
  args: { run_id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("bootstrap_phase")
      .withIndex("by_run", (q) => q.eq("run_id", args.run_id))
      .first();
  },
});
