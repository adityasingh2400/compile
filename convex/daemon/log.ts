import { mutation, query } from "../_generated/server.js";
import { v } from "convex/values";
import type { MutationCtx } from "../_generated/server.js";

const KIND = v.union(
  v.literal("TRIGGER:SCHEDULE"),
  v.literal("TRIGGER:EVENT"),
  v.literal("TRIGGER:VOLUME"),
  v.literal("TRIGGER:CODE_CHANGE"),
  v.literal("TRIGGER:RECOVERY"),
  v.literal("STEP"),
  v.literal("BOOT"),
  v.literal("ERROR"),
);

export async function appendLog(
  ctx: MutationCtx,
  args: {
    kind: "TRIGGER:SCHEDULE" | "TRIGGER:EVENT" | "TRIGGER:VOLUME" | "TRIGGER:CODE_CHANGE" | "TRIGGER:RECOVERY" | "STEP" | "BOOT" | "ERROR";
    message: string;
    call_site_hash?: string;
    payload?: unknown;
  },
): Promise<void> {
  await ctx.db.insert("trigger_log", {
    ts: new Date().toISOString(),
    kind: args.kind,
    message: args.message,
    call_site_hash: args.call_site_hash,
    payload: args.payload,
  });
}

/** Worker-callable mutation form for the local daemon process. */
export const append = mutation({
  args: {
    kind: KIND,
    message: v.string(),
    call_site_hash: v.optional(v.string()),
    payload: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await appendLog(ctx, args);
    return null;
  },
});

export const recent = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(
    v.object({
      _id: v.id("trigger_log"),
      _creationTime: v.number(),
      ts: v.string(),
      kind: KIND,
      message: v.string(),
      call_site_hash: v.optional(v.string()),
      payload: v.optional(v.any()),
    }),
  ),
  handler: async (ctx, { limit }) => {
    const all = await ctx.db.query("trigger_log").order("desc").take(limit ?? 100);
    return all;
  },
});

export const countByKind = query({
  args: {},
  returns: v.object({
    schedule: v.number(),
    event: v.number(),
    volume: v.number(),
    code_change: v.number(),
    recovery: v.number(),
    step: v.number(),
    boot: v.number(),
    error: v.number(),
  }),
  handler: async (ctx) => {
    const all = await ctx.db.query("trigger_log").collect();
    const counts = {
      schedule: 0,
      event: 0,
      volume: 0,
      code_change: 0,
      recovery: 0,
      step: 0,
      boot: 0,
      error: 0,
    };
    for (const r of all) {
      if (r.kind === "TRIGGER:SCHEDULE") counts.schedule++;
      else if (r.kind === "TRIGGER:EVENT") counts.event++;
      else if (r.kind === "TRIGGER:VOLUME") counts.volume++;
      else if (r.kind === "TRIGGER:CODE_CHANGE") counts.code_change++;
      else if (r.kind === "TRIGGER:RECOVERY") counts.recovery++;
      else if (r.kind === "STEP") counts.step++;
      else if (r.kind === "BOOT") counts.boot++;
      else if (r.kind === "ERROR") counts.error++;
    }
    return counts;
  },
});
