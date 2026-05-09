import { mutation, query } from "../_generated/server.js";
import { v } from "convex/values";

/**
 * Bulk-insert seed traces from data/proxy-traces.jsonl. Called once by
 * scripts/seed-convex-traces.ts. Idempotent: clears existing seed_traces
 * first so re-runs are safe.
 */
export const bulkInsert = mutation({
  args: {
    rows: v.array(
      v.object({
        seq: v.number(),
        offset_ms: v.number(),
        call_site_hash: v.string(),
        payload: v.any(),
      }),
    ),
    clear_first: v.boolean(),
  },
  returns: v.object({ inserted: v.number() }),
  handler: async (ctx, { rows, clear_first }) => {
    if (clear_first) {
      const existing = await ctx.db.query("seed_traces").collect();
      for (const row of existing) await ctx.db.delete(row._id);
    }
    for (const row of rows) await ctx.db.insert("seed_traces", row);
    return { inserted: rows.length };
  },
});

export const count = query({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const all = await ctx.db.query("seed_traces").collect();
    return all.length;
  },
});

export const summary = query({
  args: {},
  returns: v.object({
    total: v.number(),
    by_hash: v.array(v.object({ hash: v.string(), count: v.number() })),
  }),
  handler: async (ctx) => {
    const all = await ctx.db.query("seed_traces").collect();
    const byHash = new Map<string, number>();
    for (const r of all) byHash.set(r.call_site_hash, (byHash.get(r.call_site_hash) ?? 0) + 1);
    return {
      total: all.length,
      by_hash: [...byHash.entries()]
        .map(([hash, count]) => ({ hash, count }))
        .sort((a, b) => b.count - a.count),
    };
  },
});
