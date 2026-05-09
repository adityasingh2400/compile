import type { NegativeVaultEntry } from "@compile/schemas";

/**
 * Inputs the freshness check needs from the *current* state of a cluster
 * to decide whether an existing negative entry should still block synthesis.
 */
export interface FreshnessSignals {
  /** Total trace count for the cluster as of right now. */
  trace_count: number;
  /** Current call-site git SHA, if known. */
  code_sha?: string;
}

/**
 * Decide whether a negative vault entry is "stale enough" that it's worth
 * re-attempting synthesis for the cluster.
 *
 * Sticky negatives are never fresh. Expiring negatives are fresh when any
 * of their configured trigger conditions have been met since the entry was
 * written.
 */
export function isFreshEnough(
  entry: NegativeVaultEntry,
  current: FreshnessSignals,
): boolean {
  const policy = entry.retry_policy;
  if (policy.type === "sticky") return false;

  const traceTrigger =
    typeof policy.retry_when_traces === "number" &&
    current.trace_count >=
      entry.trace_count_at_decision + policy.retry_when_traces;

  const shaTrigger =
    policy.retry_on_code_change === true &&
    typeof current.code_sha === "string" &&
    typeof entry.code_sha_at_decision === "string" &&
    current.code_sha !== entry.code_sha_at_decision;

  return traceTrigger || shaTrigger;
}
