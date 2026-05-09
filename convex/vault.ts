import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const event = mutation({
  args: {
    event: v.object({
      run_id: v.string(),
      entry: v.any(), // VaultEntry discriminated union (positive | negative)
      emitted_at: v.string(),
    }),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("vault_event", args.event);
  },
});

export const byRun = query({
  args: { run_id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("vault_event")
      .withIndex("by_run", (q) => q.eq("run_id", args.run_id))
      .collect();
  },
});
