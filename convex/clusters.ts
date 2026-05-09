import { mutation, query } from "./_generated/server.js";
import { v } from "convex/values";

export const put = mutation({
  args: {
    snapshot: v.object({
      run_id: v.string(),
      call_site_id: v.string(),
      snapshot_seq: v.number(),
      clusters: v.array(v.any()),
      updated_at: v.string(),
    }),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("cluster_snapshot", args.snapshot);
  },
});

/** Page 7 reads the latest snapshot per call site. */
export const latest = query({
  args: { run_id: v.string(), call_site_id: v.string() },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("cluster_snapshot")
      .withIndex("by_run_callsite_seq", (q) =>
        q.eq("run_id", args.run_id).eq("call_site_id", args.call_site_id),
      )
      .order("desc")
      .first();
    return all;
  },
});
