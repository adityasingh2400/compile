import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * One row per Stage-2 call (DESIGN.md "each Tensorlake worker writes one
 * row per completed call to Convex"). The wire transport batches via
 * insertMany; the data model still has one row per cell so the canvas
 * paints diffs cleanly.
 */
export const insertMany = mutation({
  args: {
    run_id: v.string(),
    call_site_id: v.string(),
    cells: v.array(v.any()),
  },
  handler: async (ctx, args) => {
    const ids: unknown[] = [];
    for (const cell of args.cells) {
      ids.push(
        await ctx.db.insert("synthetic_cells", {
          run_id: args.run_id,
          call_site_id: args.call_site_id,
          input_id: cell.input_id,
          worker_id: cell.worker_id,
          status: cell.status,
          path: cell.path,
          tier_assigned: cell.tier_assigned,
          output: cell.output,
          cluster_id: cell.cluster_id,
          latency_ms: cell.latency_ms,
          cost_usd: cell.cost_usd,
        }),
      );
    }
    return ids.length;
  },
});

/** Streaming subscription point for the constellation canvas. */
export const stream = query({
  args: {
    run_id: v.string(),
    call_site_id: v.string(),
    /** Page-6 grid only paints `done` cells in the constellation. */
    only_done: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("synthetic_cells")
      .withIndex("by_run_callsite", (q) =>
        q.eq("run_id", args.run_id).eq("call_site_id", args.call_site_id),
      )
      .collect();
    if (args.only_done) return rows.filter((r) => r.status === "done");
    return rows;
  },
});
