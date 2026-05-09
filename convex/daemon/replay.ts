import { internalMutation } from "../_generated/server.js";
import { internal } from "../_generated/api.js";
import { v } from "convex/values";
import { DEFAULT_SPEED_FACTOR } from "./config.js";
import { appendLog } from "./log.js";

/**
 * Replay tick — fires every REPLAY_TICK_SECONDS via crons.ts.
 *
 * Reads cursor from replay_state, calculates how much simulated time has
 * elapsed since last tick (real_dt × speed_factor), pulls all seed_traces
 * with offset_ms in (cursor_offset_ms, cursor_offset_ms + sim_dt],
 * runs ingestTrace on each.
 */
export const tick = internalMutation({
  args: {},
  returns: v.object({
    inserted: v.number(),
    cursor_seq: v.number(),
    cursor_offset_ms: v.number(),
    paused: v.boolean(),
  }),
  handler: async (ctx) => {
    const now = new Date().toISOString();

    let state = await ctx.db
      .query("replay_state")
      .withIndex("by_singleton", (q) => q.eq("singleton", "only"))
      .unique();
    if (!state) {
      const id = await ctx.db.insert("replay_state", {
        singleton: "only",
        cursor_seq: 0,
        cursor_offset_ms: 0,
        speed_factor: DEFAULT_SPEED_FACTOR,
        paused: false,
        started_at: now,
      });
      state = await ctx.db.get(id);
      if (!state) throw new Error("replay_state insert failed");
      await appendLog(ctx, { kind: "BOOT", message: "replay_state initialized" });
    }

    if (state.paused) {
      return {
        inserted: 0,
        cursor_seq: state.cursor_seq,
        cursor_offset_ms: state.cursor_offset_ms,
        paused: true,
      };
    }

    // Each real tick = 1s; advance cursor by speed_factor seconds of sim time.
    const SIM_MS_PER_TICK = 1000 * state.speed_factor;
    const newCursorOffsetMs = state.cursor_offset_ms + SIM_MS_PER_TICK;

    // Pull next batch by seq (ordered by ts via seed loader).
    // Bound the batch so a giant catch-up doesn't blow the mutation.
    const BATCH_CAP = 50;
    const batch = await ctx.db
      .query("seed_traces")
      .withIndex("by_seq", (q) => q.gte("seq", state!.cursor_seq))
      .take(BATCH_CAP * 4); // headroom; we'll filter by offset below

    const toInsert = batch.filter((r) => r.offset_ms <= newCursorOffsetMs).slice(0, BATCH_CAP);

    if (toInsert.length === 0) {
      // No new traces in this window. Still log a SCHEDULE heartbeat every ~10 ticks.
      // Cheap signal that the cron is alive.
      const recent = await ctx.db
        .query("trigger_log")
        .withIndex("by_kind", (q) => q.eq("kind", "TRIGGER:SCHEDULE"))
        .order("desc")
        .take(1);
      const lastTs = recent[0]?.ts;
      const elapsedMs = lastTs ? Date.now() - new Date(lastTs).getTime() : Infinity;
      if (elapsedMs > 10_000) {
        await appendLog(ctx, {
          kind: "TRIGGER:SCHEDULE",
          message: `replayTick — idle (cursor_seq=${state.cursor_seq})`,
        });
      }
      await ctx.db.patch(state._id, { cursor_offset_ms: newCursorOffsetMs });
      return {
        inserted: 0,
        cursor_seq: state.cursor_seq,
        cursor_offset_ms: newCursorOffsetMs,
        paused: false,
      };
    }

    await appendLog(ctx, {
      kind: "TRIGGER:SCHEDULE",
      message: `replayTick — ingesting ${toInsert.length} trace${toInsert.length === 1 ? "" : "s"}`,
      payload: { speed_factor: state.speed_factor, batch: toInsert.length },
    });

    let lastSeq = state.cursor_seq;
    for (const row of toInsert) {
      // Inline ingest logic via internal mutation. Convex restricts mutation→mutation
      // calls; using runMutation pattern via scheduler instead would lose atomicity.
      // Instead we inline the call by invoking the helper.
      await ingestInline(ctx, row.call_site_hash, row.payload);
      lastSeq = row.seq + 1;
    }

    await ctx.db.patch(state._id, {
      cursor_seq: lastSeq,
      cursor_offset_ms: newCursorOffsetMs,
    });

    return {
      inserted: toInsert.length,
      cursor_seq: lastSeq,
      cursor_offset_ms: newCursorOffsetMs,
      paused: false,
    };
  },
});

import type { MutationCtx } from "../_generated/server.js";
import { THRESHOLD } from "./config.js";

/**
 * Inline ingest used by the replay tick. Same logic as ingest.ts:ingestTrace
 * but called within the same mutation transaction.
 */
async function ingestInline(
  ctx: MutationCtx,
  call_site_hash: string,
  payload: unknown,
): Promise<void> {
  const now = new Date().toISOString();
  await ctx.db.insert("proxy_traces", { call_site_hash, inserted_at: now, payload });

  const existing = await ctx.db
    .query("buckets")
    .withIndex("by_hash", (q) => q.eq("call_site_hash", call_site_hash))
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

  const vaultEntry = await ctx.db
    .query("vault_index")
    .withIndex("by_hash", (q) => q.eq("call_site_hash", call_site_hash))
    .unique();
  if (vaultEntry) {
    if (vaultEntry.state === "POSITIVE") return;
    if (vaultEntry.state === "NEGATIVE" && vaultEntry.sticky) return;
    if (vaultEntry.state === "NEGATIVE" && vaultEntry.expires_at && vaultEntry.expires_at > now)
      return;
  }

  const refreshed = await ctx.db.get(bucketId);
  if (!refreshed || refreshed.status !== "collecting") return;
  if (bucketCount < THRESHOLD) return;

  await ctx.db.patch(bucketId, { status: "queued", fired_at: now });
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
}
