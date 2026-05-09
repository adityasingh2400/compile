import { z } from "zod";

/**
 * Daemon event stream — the contract between Ayaan's always-on agent
 * (Node daemon polling proxy JSONL + clustering + threshold trigger) and
 * the UI (event-driven phase advance, persistent always-on chrome,
 * vault-hit short-circuit, agentic-loop overlay).
 *
 * Wire format: one JSON line per event, appended to
 *   data/daemon/events.jsonl
 * UI tails via HTTP GET /daemon/events?since=<ts> (or SSE, same shape).
 *
 * Stable schema: bumping a field shape requires a major bump on the
 * `schema_version` field at the top level so the UI can refuse to render
 * stale fixtures. Add new event kinds at the end of the union.
 */

export const DAEMON_EVENT_SCHEMA_VERSION = 1 as const;

const Iso = z.string().datetime();

/** Heartbeat — emitted ~1Hz so the UI badge reads "running 7h 23m". */
export const UptimeTickSchema = z.object({
  kind: z.literal("uptime_tick"),
  ts: Iso,
  uptime_ms: z.number().int().nonnegative(),
  fires_total: z.number().int().nonnegative(),
  /** Cumulative dollars saved across this daemon's lifetime. */
  dollars_saved: z.number().nonnegative(),
  /** Optional — null when uninitialized. */
  last_fire_ts: Iso.nullable().optional(),
});
export type UptimeTick = z.infer<typeof UptimeTickSchema>;

/** Daemon noticed a new call in the proxy stream and bucketed it. */
export const ClusterObservedSchema = z.object({
  kind: z.literal("cluster_observed"),
  ts: Iso,
  cluster_id: z.string(),
  /** Stable signature: model + system-prompt-hash + tool-shape. */
  signature: z.string(),
  /** Running sample count for this cluster. */
  sample_count: z.number().int().nonnegative(),
  /** Threshold above which the daemon will fan out (typically 50). */
  threshold: z.number().int().positive(),
});
export type ClusterObserved = z.infer<typeof ClusterObservedSchema>;

/**
 * Daemon decided to act on a cluster. Two outcomes:
 *   - "fan_out": new cluster, will spawn 100K validation in Tensorlake
 *   - "vault_hit": signature already in Nia vault, route deterministically
 *
 * When decision == "vault_hit", the UI should skip stress_test/agent_writing
 * entirely and show the VaultHitPage.
 */
export const ClusterThresholdHitSchema = z.object({
  kind: z.literal("cluster_threshold_hit"),
  ts: Iso,
  cluster_id: z.string(),
  signature: z.string(),
  n_samples: z.number().int().positive(),
  decision: z.enum(["fan_out", "vault_hit"]),
});
export type ClusterThresholdHit = z.infer<typeof ClusterThresholdHitSchema>;

/** Vault hit details — only emitted when threshold-hit decision == "vault_hit". */
export const VaultHitSchema = z.object({
  kind: z.literal("vault_hit"),
  ts: Iso,
  cluster_id: z.string(),
  /** ISO date of the session that originally compiled this function. */
  inherited_from_session: z.string(),
  /** When the inherited function was first compiled. */
  prior_compiled_at: Iso,
  /** Cached function name (TS or phi prompt id). */
  function_name: z.string(),
  /** Routing latency in ms (typically 1-10ms — the spectacle vs 28s). */
  routed_in_ms: z.number().nonnegative(),
  /** $ saved on this single hit (cluster.calls × per-call delta). */
  dollars_saved_this_hit: z.number().nonnegative(),
});
export type VaultHit = z.infer<typeof VaultHitSchema>;

/** Daemon spawned a Tensorlake sandbox for the 100K validation. */
export const SandboxSpawnStartSchema = z.object({
  kind: z.literal("sandbox_spawn_start"),
  ts: Iso,
  cluster_id: z.string(),
  sandbox_id: z.string(),
  /** Image registered with Tensorlake (e.g. "compile-phi-mini"). */
  image: z.string(),
  worker_count: z.number().int().positive(),
});
export type SandboxSpawnStart = z.infer<typeof SandboxSpawnStartSchema>;

/** Per-tick progress event from the running 100K-validation sandbox. */
export const PhiTickSchema = z.object({
  kind: z.literal("phi_tick"),
  ts: Iso,
  sandbox_id: z.string(),
  cluster_id: z.string(),
  calls_done: z.number().int().nonnegative(),
  calls_total: z.number().int().positive(),
  throughput_per_sec: z.number().nonnegative(),
  /** Number of in-progress phi retries. >0 lights the worker-retry indicator. */
  retry_count: z.number().int().nonnegative().default(0),
});
export type PhiTick = z.infer<typeof PhiTickSchema>;

/**
 * Stage-2 oracle reflection — agreement score + commit decision.
 * Threshold is configurable per fire (default 0.85). When score < threshold,
 * decision == "decline" and the UI shows the rollback path.
 */
export const OracleAgreementSchema = z.object({
  kind: z.literal("oracle_agreement"),
  ts: Iso,
  cluster_id: z.string(),
  /** 0..1 inclusive. */
  score: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
  decision: z.enum(["commit", "decline"]),
  /** Oracle samples drawn (typically 1% of 100K = 1000). */
  oracle_samples: z.number().int().nonnegative(),
});
export type OracleAgreement = z.infer<typeof OracleAgreementSchema>;

/**
 * Tensorlake primary path failed; daemon engaged the LocalFake fallback.
 * Maps to TensorlakeWithLocalFallback.onFallback in runtime/tensorlake.ts.
 */
export const FallbackEngagedSchema = z.object({
  kind: z.literal("fallback_engaged"),
  ts: Iso,
  cluster_id: z.string(),
  /** Operation that flaked. */
  surface: z.enum(["sandbox_create", "run_emitted_function", "run_phi", "warm"]),
  /** Brief reason string, safe to display in UI. */
  reason: z.string(),
  /** True if the fallback path then succeeded — informs "recovered" framing. */
  recovered: z.boolean(),
});
export type FallbackEngaged = z.infer<typeof FallbackEngagedSchema>;

/** Final commit beat — codified function written to Nia vault. */
export const FireCompleteSchema = z.object({
  kind: z.literal("fire_complete"),
  ts: Iso,
  cluster_id: z.string(),
  /** Time from threshold_hit → vault commit, in ms. */
  total_duration_ms: z.number().nonnegative(),
  /** Total $ saved by this single fire, projected over cluster volume. */
  dollars_saved_this_fire: z.number().nonnegative(),
  /** Nia vault key the function was written under. */
  vault_key: z.string(),
  /** Tier label from the gate verdict. */
  tier: z.enum(["tier_1", "tier_2", "tier_3"]),
  /** Number of fallback engagements during this fire (0 = clean run). */
  fallback_count: z.number().int().nonnegative().default(0),
});
export type FireComplete = z.infer<typeof FireCompleteSchema>;

/** Discriminated union over every event kind. */
export const DaemonEventSchema = z.discriminatedUnion("kind", [
  UptimeTickSchema,
  ClusterObservedSchema,
  ClusterThresholdHitSchema,
  VaultHitSchema,
  SandboxSpawnStartSchema,
  PhiTickSchema,
  OracleAgreementSchema,
  FallbackEngagedSchema,
  FireCompleteSchema,
]);
export type DaemonEvent = z.infer<typeof DaemonEventSchema>;

export type DaemonEventKind = DaemonEvent["kind"];

/**
 * Vault inheritance — read-on-mount payload. Hit by the UI cold-start
 * frame: GET /daemon/vault/inherited returns this. Daemon proxies to
 * the Nia vault and projects each entry to the shape below.
 */
export const VaultInheritedItemSchema = z.object({
  vault_key: z.string(),
  cluster_id: z.string(),
  function_name: z.string(),
  compiled_at: Iso,
  /** Total calls saved against this entry across all sessions. */
  calls_saved: z.number().int().nonnegative(),
  dollars_saved: z.number().nonnegative(),
  tier: z.enum(["tier_1", "tier_2", "tier_3"]),
});
export type VaultInheritedItem = z.infer<typeof VaultInheritedItemSchema>;

export const VaultInheritedSchema = z.object({
  schema_version: z.literal(DAEMON_EVENT_SCHEMA_VERSION),
  fetched_at: Iso,
  count: z.number().int().nonnegative(),
  items: z.array(VaultInheritedItemSchema),
});
export type VaultInherited = z.infer<typeof VaultInheritedSchema>;

/**
 * Wire-format helpers. The daemon writes events via writeEventLine; the
 * UI parses lines via parseEventLine. Bad lines throw — caller decides
 * whether to skip or surface.
 */
export function serializeEvent(event: DaemonEvent): string {
  return JSON.stringify(event);
}

export function parseEventLine(line: string): DaemonEvent {
  return DaemonEventSchema.parse(JSON.parse(line));
}
