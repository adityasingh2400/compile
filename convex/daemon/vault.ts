import { mutation, query } from "../_generated/server.js";
import { v } from "convex/values";

const STATE = v.union(v.literal("POSITIVE"), v.literal("NEGATIVE"));

/**
 * Read-through cache of the Nia vault. Source of truth is Nia; the daemon
 * worker mirrors writes here so ingestTrace can dedup in O(1) without
 * round-tripping Nia for every incoming proxy trace.
 */
export const upsert = mutation({
  args: {
    call_site_hash: v.string(),
    state: STATE,
    function_id: v.optional(v.string()),
    reason: v.optional(v.string()),
    sticky: v.boolean(),
    expires_at: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    const existing = await ctx.db
      .query("vault_index")
      .withIndex("by_hash", (q) => q.eq("call_site_hash", args.call_site_hash))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, {
        state: args.state,
        function_id: args.function_id,
        reason: args.reason,
        sticky: args.sticky,
        expires_at: args.expires_at,
      });
    } else {
      await ctx.db.insert("vault_index", {
        call_site_hash: args.call_site_hash,
        state: args.state,
        function_id: args.function_id,
        reason: args.reason,
        sticky: args.sticky,
        created_at: now,
        expires_at: args.expires_at,
      });
    }
    return null;
  },
});

export const expireByReason = mutation({
  args: { reason: v.string() },
  returns: v.number(),
  handler: async (ctx, { reason }) => {
    const all = await ctx.db.query("vault_index").collect();
    let expired = 0;
    for (const row of all) {
      if (row.state === "NEGATIVE" && row.reason === reason && !row.sticky) {
        await ctx.db.delete(row._id);
        expired++;
      }
    }
    return expired;
  },
});

export const all = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("vault_index"),
      _creationTime: v.number(),
      call_site_hash: v.string(),
      state: STATE,
      function_id: v.optional(v.string()),
      reason: v.optional(v.string()),
      sticky: v.boolean(),
      created_at: v.string(),
      expires_at: v.optional(v.string()),
    }),
  ),
  handler: async (ctx) => ctx.db.query("vault_index").collect(),
});

export const sizeByState = query({
  args: {},
  returns: v.object({ positive: v.number(), negative: v.number() }),
  handler: async (ctx) => {
    const all = await ctx.db.query("vault_index").collect();
    let positive = 0,
      negative = 0;
    for (const r of all) {
      if (r.state === "POSITIVE") positive++;
      else negative++;
    }
    return { positive, negative };
  },
});
