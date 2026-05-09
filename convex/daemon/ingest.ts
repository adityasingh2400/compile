import { internalMutation, mutation, query } from "../_generated/server.js";
import { v } from "convex/values";
import { THRESHOLD } from "./config.js";
import { appendLog } from "./log.js";

/**
 * Ingest a single proxy trace. Called by replayTick (cron) and by
 * scripts/replay-control.ts inject-trace.
 *
 * Side effects:
 *  - insert into proxy_traces (UI subscribes)
 *  - bucket++ (TRIGGER:EVENT log row)
 *  - vault lookup (skip if POSITIVE/NEGATIVE)
 *  - if count crosses THRESHOLD and bucket not fired:
 *      → enqueue pending_compiles (TRIGGER:VOLUME log row)
 */
export const ingestTrace = mutation({
  args: {
    call_site_hash: v.string(),
    payload: v.any(),
  },
  returns: v.object({
    bucket_count: v.number(),
    fired: v.boolean(),
    skipped_reason: v.optional(v.string()),
  }),
  handler: async (ctx, { call_site_hash, payload }) => {
    const now = new Date().toISOString();

    await ctx.db.insert("proxy_traces", {
      call_site_hash,
      inserted_at: now,
      payload,
    });

    const existing = await ctx.db
      .query("buckets")
      .withIndex("by_hash", (q) => q.eq("call_site_hash", call_site_hash))
      .unique();

    let bucketCount: number;
    let bucketId;
    if (existing) {
      bucketCount = existing.count + 1;
      bucketId = existing._id;
      await ctx.db.patch(existing._id, {
        count: bucketCount,
        last_seen_at: now,
      });
    } else {
      bucketCount = 1;
      bucketId = await ctx.db.insert("buckets", {
        call_site_hash,
        count: 1,
        first_seen_at: now,
        last_seen_at: now,
        status: "collecting",
      });
    }

    await appendLog(ctx, {
      kind: "TRIGGER:EVENT",
      message: `+1 trace → ${call_site_hash} (${bucketCount}/${THRESHOLD})`,
      call_site_hash,
      payload: { count: bucketCount },
    });

    // Vault-aware dedup. Already codified or known negative → skip.
    const vaultEntry = await ctx.db
      .query("vault_index")
      .withIndex("by_hash", (q) => q.eq("call_site_hash", call_site_hash))
      .unique();

    if (vaultEntry) {
      if (vaultEntry.state === "POSITIVE") {
        return {
          bucket_count: bucketCount,
          fired: false,
          skipped_reason: "vault:positive (already codified)",
        };
      }
      if (vaultEntry.state === "NEGATIVE" && vaultEntry.sticky) {
        return {
          bucket_count: bucketCount,
          fired: false,
          skipped_reason: "vault:negative (sticky)",
        };
      }
      // Non-sticky negative may have expired; treat as fireable.
      if (vaultEntry.state === "NEGATIVE" && vaultEntry.expires_at) {
        if (vaultEntry.expires_at > now) {
          return {
            bucket_count: bucketCount,
            fired: false,
            skipped_reason: "vault:negative (not yet expired)",
          };
        }
      }
    }

    const refreshedBucket = await ctx.db.get(bucketId);
    if (!refreshedBucket) {
      throw new Error("bucket vanished");
    }

    if (refreshedBucket.status !== "collecting") {
      // Already queued / compiling / codified — don't double-fire.
      return {
        bucket_count: bucketCount,
        fired: false,
        skipped_reason: `bucket status: ${refreshedBucket.status}`,
      };
    }

    if (bucketCount < THRESHOLD) {
      return { bucket_count: bucketCount, fired: false };
    }

    // VOLUME trigger fires.
    await ctx.db.patch(bucketId, {
      status: "queued",
      fired_at: now,
    });

    await ctx.db.insert("pending_compiles", {
      call_site_hash,
      enqueued_at: now,
      trigger_source: "VOLUME",
      bucket_count: bucketCount,
      status: "pending",
      attempt: 0,
    });

    await appendLog(ctx, {
      kind: "TRIGGER:VOLUME",
      message: `THRESHOLD CROSSED → enqueue compile for ${call_site_hash} (n=${bucketCount})`,
      call_site_hash,
      payload: { trigger: "VOLUME", count: bucketCount },
    });

    return { bucket_count: bucketCount, fired: true };
  },
});

/** Internal-only flavor for the replay cron — same logic, marked internal. */
export const ingestTraceInternal = internalMutation({
  args: {
    call_site_hash: v.string(),
    payload: v.any(),
  },
  returns: v.object({
    bucket_count: v.number(),
    fired: v.boolean(),
    skipped_reason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    // Inline the same logic. Convex doesn't allow mutations to call mutations.
    const now = new Date().toISOString();
    await ctx.db.insert("proxy_traces", {
      call_site_hash: args.call_site_hash,
      inserted_at: now,
      payload: args.payload,
    });

    const existing = await ctx.db
      .query("buckets")
      .withIndex("by_hash", (q) => q.eq("call_site_hash", args.call_site_hash))
      .unique();

    let bucketCount: number;
    let bucketId;
    if (existing) {
      bucketCount = existing.count + 1;
      bucketId = existing._id;
      await ctx.db.patch(existing._id, { count: bucketCount, last_seen_at: now });
    } else {
      bucketCount = 1;
      bucketId = await ctx.db.insert("buckets", {
        call_site_hash: args.call_site_hash,
        count: 1,
        first_seen_at: now,
        last_seen_at: now,
        status: "collecting",
      });
    }

    await appendLog(ctx, {
      kind: "TRIGGER:EVENT",
      message: `+1 trace → ${args.call_site_hash} (${bucketCount}/${THRESHOLD})`,
      call_site_hash: args.call_site_hash,
      payload: { count: bucketCount },
    });

    const vaultEntry = await ctx.db
      .query("vault_index")
      .withIndex("by_hash", (q) => q.eq("call_site_hash", args.call_site_hash))
      .unique();
    if (vaultEntry) {
      if (vaultEntry.state === "POSITIVE")
        return { bucket_count: bucketCount, fired: false, skipped_reason: "vault:positive" };
      if (vaultEntry.state === "NEGATIVE" && vaultEntry.sticky)
        return { bucket_count: bucketCount, fired: false, skipped_reason: "vault:negative-sticky" };
      if (vaultEntry.state === "NEGATIVE" && vaultEntry.expires_at && vaultEntry.expires_at > now)
        return { bucket_count: bucketCount, fired: false, skipped_reason: "vault:negative-active" };
    }

    const refreshed = await ctx.db.get(bucketId);
    if (!refreshed) throw new Error("bucket vanished");
    if (refreshed.status !== "collecting")
      return { bucket_count: bucketCount, fired: false, skipped_reason: `status:${refreshed.status}` };

    if (bucketCount < THRESHOLD) return { bucket_count: bucketCount, fired: false };

    await ctx.db.patch(bucketId, { status: "queued", fired_at: now });
    await ctx.db.insert("pending_compiles", {
      call_site_hash: args.call_site_hash,
      enqueued_at: now,
      trigger_source: "VOLUME",
      bucket_count: bucketCount,
      status: "pending",
      attempt: 0,
    });
    await appendLog(ctx, {
      kind: "TRIGGER:VOLUME",
      message: `THRESHOLD CROSSED → enqueue compile for ${args.call_site_hash} (n=${bucketCount})`,
      call_site_hash: args.call_site_hash,
      payload: { trigger: "VOLUME", count: bucketCount },
    });
    return { bucket_count: bucketCount, fired: true };
  },
});

export const allBuckets = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("buckets"),
      _creationTime: v.number(),
      call_site_hash: v.string(),
      count: v.number(),
      first_seen_at: v.string(),
      last_seen_at: v.string(),
      fired_at: v.optional(v.string()),
      status: v.union(
        v.literal("collecting"),
        v.literal("queued"),
        v.literal("compiling"),
        v.literal("codified"),
        v.literal("negative"),
        v.literal("frontier_only"),
      ),
    }),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db.query("buckets").collect();
    return rows.sort((a, b) => b.count - a.count);
  },
});
