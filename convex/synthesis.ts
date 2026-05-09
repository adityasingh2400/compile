import { mutation, query } from "./_generated/server.js";
import { v } from "convex/values";

export const event = mutation({
  args: {
    event: v.object({
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
    }),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("synthesis_event", args.event);
  },
});

export const byRequest = query({
  args: { request_id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("synthesis_event")
      .withIndex("by_request", (q) => q.eq("request_id", args.request_id))
      .collect();
  },
});
