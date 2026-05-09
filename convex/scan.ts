import { mutation, query } from "./_generated/server.js";
import { v } from "convex/values";

export const put = mutation({
  args: {
    run_id: v.string(),
    report: v.any(), // ScanReport shape lives in @compile/schemas/scanner.ts
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("scan_report")
      .withIndex("by_run", (q) => q.eq("run_id", args.run_id))
      .first();
    const doc = {
      run_id: args.run_id,
      repo_path: args.report.repo_path,
      files_scanned: args.report.files_scanned,
      tree_signature: args.report.tree_signature,
      scanned_at: args.report.scanned_at,
      call_sites: args.report.call_sites,
    };
    if (existing) {
      await ctx.db.replace(existing._id, doc);
      return existing._id;
    }
    return await ctx.db.insert("scan_report", doc);
  },
});

export const get = query({
  args: { run_id: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("scan_report")
      .withIndex("by_run", (q) => q.eq("run_id", args.run_id))
      .first();
  },
});
