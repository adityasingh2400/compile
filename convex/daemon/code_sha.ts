import { mutation, query } from "../_generated/server.js";
import { v } from "convex/values";
import { appendLog } from "./log.js";

/**
 * Code-change trigger source. Daemon worker computes the SHA of
 * data/acme-agent/ on a 30s interval (it has fs/git access; Convex
 * actions don't). When the SHA differs from the value stored here,
 * Convex fires the CODE_CHANGE trigger and expires non-sticky negatives.
 */

export const observe = mutation({
  args: { target: v.string(), sha: v.string() },
  returns: v.object({ changed: v.boolean(), prior_sha: v.optional(v.string()) }),
  handler: async (ctx, { target, sha }) => {
    const now = new Date().toISOString();
    const existing = await ctx.db
      .query("code_sha")
      .withIndex("by_target", (q) => q.eq("target", target))
      .unique();
    if (!existing) {
      await ctx.db.insert("code_sha", { target, sha, observed_at: now });
      await appendLog(ctx, {
        kind: "BOOT",
        message: `code_sha registered ${target} → ${sha.slice(0, 8)}`,
      });
      return { changed: false };
    }
    if (existing.sha === sha) return { changed: false, prior_sha: existing.sha };

    const prior = existing.sha;
    await ctx.db.patch(existing._id, { sha, observed_at: now });

    // Expire non-sticky low_static_prior negatives.
    const negatives = await ctx.db.query("vault_index").collect();
    let expired = 0;
    for (const row of negatives) {
      if (row.state === "NEGATIVE" && !row.sticky && row.reason === "low_static_prior") {
        await ctx.db.delete(row._id);
        expired++;
      }
    }

    await appendLog(ctx, {
      kind: "TRIGGER:CODE_CHANGE",
      message: `${target} SHA changed ${prior.slice(0, 8)} → ${sha.slice(0, 8)} — expired ${expired} negative entr${expired === 1 ? "y" : "ies"}`,
      payload: { target, prior_sha: prior, new_sha: sha, expired },
    });

    return { changed: true, prior_sha: prior };
  },
});

export const get = query({
  args: { target: v.string() },
  returns: v.union(
    v.null(),
    v.object({ target: v.string(), sha: v.string(), observed_at: v.string() }),
  ),
  handler: async (ctx, { target }) => {
    const row = await ctx.db
      .query("code_sha")
      .withIndex("by_target", (q) => q.eq("target", target))
      .unique();
    if (!row) return null;
    return { target: row.target, sha: row.sha, observed_at: row.observed_at };
  },
});
