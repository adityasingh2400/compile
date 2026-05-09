/**
 * Daemon-wide constants. Single place to tune for the demo.
 *
 * Threshold = 30 gives us ~3 compiles during a 3-min pitch:
 *   classify_ticket_priority (65), classify_sentiment (55), match_product_sku (38).
 * The replay-control inject-trace command can push additional buckets
 * across the line for a 4th/5th compile mid-pitch.
 */
export const THRESHOLD = 30;

/** Replay speed: 500× wall time. 24h of seed traces play in ~3 min. */
export const DEFAULT_SPEED_FACTOR = 500;

/** Replay tick cadence in real seconds. */
export const REPLAY_TICK_SECONDS = 1;

/** Stale heartbeat alert threshold. Worker writes every ~3s. */
export const HEARTBEAT_STALE_MS = 10_000;
