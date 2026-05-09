import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const put = mutation({
  args: {
    summary: v.object({
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
    }),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("result_summary")
      .withIndex("by_run", (q) => q.eq("run_id", args.summary.run_id))
      .first();
    if (existing) {
      await ctx.db.replace(existing._id, args.summary);
      return existing._id;
    }
    return await ctx.db.insert("result_summary", args.summary);
  },
});

export const get = query({
  args: { run_id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("result_summary")
      .withIndex("by_run", (q) => q.eq("run_id", args.run_id))
      .first();
  },
});
