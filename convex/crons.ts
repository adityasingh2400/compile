import { cronJobs } from "convex/server";
import { internal } from "./_generated/api.js";

const crons = cronJobs();

/**
 * Replay cron — TRIGGER:SCHEDULE.
 * Fires every second. Advances replay cursor by speed_factor × 1s of
 * simulated time, inserts due seed traces into proxy_traces, which
 * cascades through ingestInline → bucket++ → threshold check.
 */
crons.interval("replayTick", { seconds: 1 }, internal.daemon.replay.tick);

export default crons;
