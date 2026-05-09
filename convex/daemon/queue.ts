import { mutation, query } from "../_generated/server.js";
import { v } from "convex/values";
import { appendLog } from "./log.js";

const STATUS = v.union(
  v.literal("pending"),
  v.literal("claimed"),
  v.literal("running"),
  v.literal("done"),
  v.literal("failed"),
);

const TRIGGER_SOURCE = v.union(
  v.literal("VOLUME"),
  v.literal("CODE_CHANGE"),
  v.literal("MANUAL"),
);

/**
 * Atomically claim the oldest pending compile. Returns the row + flips status
 * to "claimed". Called by the local Node daemon worker on every poll.
 */
export const claimNext = mutation({
  args: { worker_id: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      _id: v.id("pending_compiles"),
      call_site_hash: v.string(),
      bucket_count: v.number(),
      trigger_source: TRIGGER_SOURCE,
      attempt: v.number(),
    }),
  ),
  handler: async (ctx, { worker_id }) => {
    const next = await ctx.db
      .query("pending_compiles")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .order("asc")
      .first();
    if (!next) return null;

    const now = new Date().toISOString();
    await ctx.db.patch(next._id, {
      status: "claimed",
      claimed_by: worker_id,
      claimed_at: now,
    });

    // Bucket → compiling so dashboard can show in-flight state.
    const bucket = await ctx.db
      .query("buckets")
      .withIndex("by_hash", (q) => q.eq("call_site_hash", next.call_site_hash))
      .unique();
    if (bucket) await ctx.db.patch(bucket._id, { status: "compiling" });

    await appendLog(ctx, {
      kind: "STEP",
      message: `claimed compile ${next.call_site_hash} (worker=${worker_id}, attempt=${next.attempt})`,
      call_site_hash: next.call_site_hash,
    });

    return {
      _id: next._id,
      call_site_hash: next.call_site_hash,
      bucket_count: next.bucket_count,
      trigger_source: next.trigger_source,
      attempt: next.attempt,
    };
  },
});

export const markRunning = mutation({
  args: { id: v.id("pending_compiles") },
  returns: v.null(),
  handler: async (ctx, { id }) => {
    await ctx.db.patch(id, { status: "running" });
    return null;
  },
});

export const markDone = mutation({
  args: {
    id: v.id("pending_compiles"),
    outcome: v.union(v.literal("CODIFIED"), v.literal("NEGATIVE")),
    function_id: v.optional(v.string()),
    schema_stability: v.optional(v.number()),
    determinism: v.optional(v.number()),
    oracle_agreement: v.optional(v.number()),
    cluster_count: v.optional(v.number()),
    wall_time_ms: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const pending = await ctx.db.get(args.id);
    if (!pending) throw new Error("pending row missing");
    const now = new Date().toISOString();

    await ctx.db.patch(args.id, {
      status: "done",
      completed_at: now,
    });

    await ctx.db.insert("compile_results", {
      call_site_hash: pending.call_site_hash,
      pending_id: args.id,
      outcome: args.outcome,
      function_id: args.function_id,
      schema_stability: args.schema_stability,
      determinism: args.determinism,
      oracle_agreement: args.oracle_agreement,
      cluster_count: args.cluster_count,
      wall_time_ms: args.wall_time_ms,
      completed_at: now,
    });

    const bucket = await ctx.db
      .query("buckets")
      .withIndex("by_hash", (q) => q.eq("call_site_hash", pending.call_site_hash))
      .unique();
    if (bucket) {
      await ctx.db.patch(bucket._id, {
        status: args.outcome === "CODIFIED" ? "codified" : "negative",
      });
    }

    await appendLog(ctx, {
      kind: "STEP",
      message:
        args.outcome === "CODIFIED"
          ? `✓ codified ${pending.call_site_hash} → fn=${args.function_id} (${args.wall_time_ms}ms)`
          : `✗ negative ${pending.call_site_hash} (${args.wall_time_ms}ms)`,
      call_site_hash: pending.call_site_hash,
      payload: {
        outcome: args.outcome,
        schema_stability: args.schema_stability,
        oracle_agreement: args.oracle_agreement,
      },
    });
    return null;
  },
});

export const markFailed = mutation({
  args: {
    id: v.id("pending_compiles"),
    error: v.string(),
    retry: v.boolean(),
  },
  returns: v.null(),
  handler: async (ctx, { id, error, retry }) => {
    const pending = await ctx.db.get(id);
    if (!pending) throw new Error("pending row missing");
    const now = new Date().toISOString();

    if (retry && pending.attempt < 2) {
      // Re-enqueue with attempt++, fire RECOVERY trigger.
      await ctx.db.patch(id, {
        status: "pending",
        claimed_by: undefined,
        claimed_at: undefined,
        attempt: pending.attempt + 1,
        error,
      });
      await appendLog(ctx, {
        kind: "TRIGGER:RECOVERY",
        message: `retry compile ${pending.call_site_hash} (attempt=${pending.attempt + 1}, error=${error.slice(0, 80)})`,
        call_site_hash: pending.call_site_hash,
      });
    } else {
      await ctx.db.patch(id, {
        status: "failed",
        completed_at: now,
        error,
      });
      const bucket = await ctx.db
        .query("buckets")
        .withIndex("by_hash", (q) => q.eq("call_site_hash", pending.call_site_hash))
        .unique();
      if (bucket) await ctx.db.patch(bucket._id, { status: "frontier_only" });
      await appendLog(ctx, {
        kind: "ERROR",
        message: `compile failed ${pending.call_site_hash}: ${error.slice(0, 120)}`,
        call_site_hash: pending.call_site_hash,
      });
    }
    return null;
  },
});

/** UI/worker pull — list pending + recent results. */
export const status = query({
  args: {},
  returns: v.object({
    pending: v.number(),
    claimed: v.number(),
    running: v.number(),
    done: v.number(),
    failed: v.number(),
  }),
  handler: async (ctx) => {
    const all = await ctx.db.query("pending_compiles").collect();
    const counts = { pending: 0, claimed: 0, running: 0, done: 0, failed: 0 };
    for (const r of all) counts[r.status]++;
    return counts;
  },
});

export const recentResults = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      _id: v.id("compile_results"),
      _creationTime: v.number(),
      call_site_hash: v.string(),
      outcome: v.union(v.literal("CODIFIED"), v.literal("NEGATIVE"), v.literal("FAILED")),
      function_id: v.optional(v.string()),
      schema_stability: v.optional(v.number()),
      determinism: v.optional(v.number()),
      oracle_agreement: v.optional(v.number()),
      cluster_count: v.optional(v.number()),
      wall_time_ms: v.number(),
      completed_at: v.string(),
      pending_id: v.id("pending_compiles"),
    }),
  ),
  handler: async (ctx, { limit }) => {
    return await ctx.db.query("compile_results").order("desc").take(limit ?? 20);
  },
});
