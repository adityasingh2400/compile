import { mutation, query } from "../_generated/server.js";
import { v } from "convex/values";
import { HEARTBEAT_STALE_MS } from "./config.js";

const TRIGGERS = v.object({
  schedule: v.number(),
  event: v.number(),
  volume: v.number(),
  code_change: v.number(),
  recovery: v.number(),
});

export const write = mutation({
  args: {
    worker_id: v.string(),
    pid: v.number(),
    triggers_fired: TRIGGERS,
    buckets_active: v.number(),
    vault_size: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    const existing = await ctx.db
      .query("daemon_heartbeat")
      .withIndex("by_worker", (q) => q.eq("worker_id", args.worker_id))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        last_seen_at: now,
        pid: args.pid,
        triggers_fired: args.triggers_fired,
        buckets_active: args.buckets_active,
        vault_size: args.vault_size,
      });
    } else {
      await ctx.db.insert("daemon_heartbeat", {
        worker_id: args.worker_id,
        last_seen_at: now,
        pid: args.pid,
        triggers_fired: args.triggers_fired,
        buckets_active: args.buckets_active,
        vault_size: args.vault_size,
      });
    }
    return null;
  },
});

export const status = query({
  args: {},
  returns: v.object({
    online: v.boolean(),
    workers: v.array(
      v.object({
        worker_id: v.string(),
        last_seen_at: v.string(),
        age_ms: v.number(),
        stale: v.boolean(),
        pid: v.number(),
        triggers_fired: TRIGGERS,
        buckets_active: v.number(),
        vault_size: v.number(),
      }),
    ),
  }),
  handler: async (ctx) => {
    const rows = await ctx.db.query("daemon_heartbeat").collect();
    const nowMs = Date.now();
    const workers = rows.map((r) => {
      const age = nowMs - new Date(r.last_seen_at).getTime();
      return {
        worker_id: r.worker_id,
        last_seen_at: r.last_seen_at,
        age_ms: age,
        stale: age > HEARTBEAT_STALE_MS,
        pid: r.pid,
        triggers_fired: r.triggers_fired,
        buckets_active: r.buckets_active,
        vault_size: r.vault_size,
      };
    });
    return {
      online: workers.some((w) => !w.stale),
      workers,
    };
  },
});
