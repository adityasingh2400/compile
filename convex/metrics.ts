import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const put = mutation({
  args: {
    metrics: v.object({
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
      axis_scores: v.any(),
      updated_at: v.string(),
    }),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("live_metrics")
      .withIndex("by_run_callsite", (q) =>
        q
          .eq("run_id", args.metrics.run_id)
          .eq("call_site_id", args.metrics.call_site_id),
      )
      .first();
    if (existing) {
      await ctx.db.replace(existing._id, args.metrics);
      return existing._id;
    }
    return await ctx.db.insert("live_metrics", args.metrics);
  },
});

export const get = query({
  args: { run_id: v.string(), call_site_id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("live_metrics")
      .withIndex("by_run_callsite", (q) =>
        q.eq("run_id", args.run_id).eq("call_site_id", args.call_site_id),
      )
      .first();
  },
});
