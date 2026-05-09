import { mutation, query } from "../_generated/server.js";
import { v } from "convex/values";
import { DEFAULT_SPEED_FACTOR } from "./config.js";

/**
 * Singleton replay-state row. Created lazily by replayTick on first run.
 * Mutated by scripts/replay-control.ts (start / pause / reset / speed).
 */

export const getOrInit = mutation({
  args: {},
  returns: v.object({
    cursor_seq: v.number(),
    cursor_offset_ms: v.number(),
    speed_factor: v.number(),
    paused: v.boolean(),
    started_at: v.string(),
  }),
  handler: async (ctx) => {
    const existing = await ctx.db
      .query("replay_state")
      .withIndex("by_singleton", (q) => q.eq("singleton", "only"))
      .unique();
    if (existing) {
      return {
        cursor_seq: existing.cursor_seq,
        cursor_offset_ms: existing.cursor_offset_ms,
        speed_factor: existing.speed_factor,
        paused: existing.paused,
        started_at: existing.started_at,
      };
    }
    const now = new Date().toISOString();
    const fresh = {
      singleton: "only" as const,
      cursor_seq: 0,
      cursor_offset_ms: 0,
      speed_factor: DEFAULT_SPEED_FACTOR,
      paused: false,
      started_at: now,
    };
    await ctx.db.insert("replay_state", fresh);
    return {
      cursor_seq: fresh.cursor_seq,
      cursor_offset_ms: fresh.cursor_offset_ms,
      speed_factor: fresh.speed_factor,
      paused: fresh.paused,
      started_at: fresh.started_at,
    };
  },
});

export const get = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      cursor_seq: v.number(),
      cursor_offset_ms: v.number(),
      speed_factor: v.number(),
      paused: v.boolean(),
      started_at: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const row = await ctx.db
      .query("replay_state")
      .withIndex("by_singleton", (q) => q.eq("singleton", "only"))
      .unique();
    if (!row) return null;
    return {
      cursor_seq: row.cursor_seq,
      cursor_offset_ms: row.cursor_offset_ms,
      speed_factor: row.speed_factor,
      paused: row.paused,
      started_at: row.started_at,
    };
  },
});

export const setPaused = mutation({
  args: { paused: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { paused }) => {
    const row = await ctx.db
      .query("replay_state")
      .withIndex("by_singleton", (q) => q.eq("singleton", "only"))
      .unique();
    if (!row) throw new Error("replay_state not initialized");
    await ctx.db.patch(row._id, { paused });
    return null;
  },
});

export const setSpeed = mutation({
  args: { speed_factor: v.number() },
  returns: v.null(),
  handler: async (ctx, { speed_factor }) => {
    const row = await ctx.db
      .query("replay_state")
      .withIndex("by_singleton", (q) => q.eq("singleton", "only"))
      .unique();
    if (!row) throw new Error("replay_state not initialized");
    await ctx.db.patch(row._id, { speed_factor });
    return null;
  },
});

export const reset = mutation({
  args: { wipe_vault: v.optional(v.boolean()) },
  returns: v.null(),
  handler: async (ctx, { wipe_vault }) => {
    const row = await ctx.db
      .query("replay_state")
      .withIndex("by_singleton", (q) => q.eq("singleton", "only"))
      .unique();
    const now = new Date().toISOString();
    if (row) {
      await ctx.db.patch(row._id, {
        cursor_seq: 0,
        cursor_offset_ms: 0,
        paused: false,
        started_at: now,
      });
    }
    // Clear downstream state so reset is total.
    for (const t of await ctx.db.query("proxy_traces").collect()) await ctx.db.delete(t._id);
    for (const b of await ctx.db.query("buckets").collect()) await ctx.db.delete(b._id);
    for (const p of await ctx.db.query("pending_compiles").collect()) await ctx.db.delete(p._id);
    for (const r of await ctx.db.query("compile_results").collect()) await ctx.db.delete(r._id);
    for (const l of await ctx.db.query("trigger_log").collect()) await ctx.db.delete(l._id);
    if (wipe_vault) {
      for (const v of await ctx.db.query("vault_index").collect()) await ctx.db.delete(v._id);
      // Also clear code_sha so first-observe fires BOOT.
      for (const c of await ctx.db.query("code_sha").collect()) await ctx.db.delete(c._id);
    }
    return null;
  },
});
