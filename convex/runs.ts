import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const complete = mutation({
  args: {
    run_id: v.string(),
    run: v.any(), // SyntheticRun shape
  },
  handler: async (ctx, args) => {
    const doc = {
      run_id: args.run_id,
      call_site_id: args.run.call_site_id,
      payload: args.run,
      completed_at: new Date().toISOString(),
    };
    const existing = await ctx.db
      .query("synthetic_run")
      .withIndex("by_run_callsite", (q) =>
        q.eq("run_id", args.run_id).eq("call_site_id", args.run.call_site_id),
      )
      .first();
    if (existing) {
      await ctx.db.replace(existing._id, doc);
      return existing._id;
    }
    return await ctx.db.insert("synthetic_run", doc);
  },
});

export const get = query({
  args: { run_id: v.string(), call_site_id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("synthetic_run")
      .withIndex("by_run_callsite", (q) =>
        q.eq("run_id", args.run_id).eq("call_site_id", args.call_site_id),
      )
      .first();
  },
});
