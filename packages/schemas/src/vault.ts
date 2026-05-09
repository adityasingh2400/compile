import { z } from "zod";
import {
  SynthesisSuccessSchema,
  NegativeReasonSchema,
  RetryPolicySchema,
  TierSchema,
} from "./synthesis.js";

/**
 * Positive Vault entry — a codified function the router can run.
 * Stored as one Nia Vault page per function_id.
 */
export const PositiveVaultEntrySchema = z.object({
  kind: z.literal("positive"),
  function_id: z.string(),
  cluster_signature: z.string(),
  tier: TierSchema,
  envelope: SynthesisSuccessSchema,
  holdout_match_rate: z.number().min(0).max(1),
  created_at: z.string().datetime(),
  hit_count: z.number().int().nonnegative().default(0),
  estimated_savings_usd_total: z.number().nonnegative().default(0),
});
export type PositiveVaultEntry = z.infer<typeof PositiveVaultEntrySchema>;

/**
 * Negative Vault entry — D8 negative cache. Checked by the router before
 * any synthesis spin-up. Without this, every Tier-3-only pattern re-triggers
 * a 100-input sandbox run on every call.
 */
export const NegativeVaultEntrySchema = z.object({
  kind: z.literal("negative"),
  cluster_signature: z.string(),
  reason: NegativeReasonSchema,
  retry_policy: RetryPolicySchema,
  trace_count_at_decision: z.number().int().nonnegative(),
  created_at: z.string().datetime(),
  /**
   * Call-site git SHA at the time the negative was written. Used by the
   * freshness check when retry_policy.retry_on_code_change is true: a
   * different SHA means the underlying code changed and the cluster is
   * worth re-attempting.
   */
  code_sha_at_decision: z.string().optional(),
});
export type NegativeVaultEntry = z.infer<typeof NegativeVaultEntrySchema>;

export const VaultEntrySchema = z.discriminatedUnion("kind", [
  PositiveVaultEntrySchema,
  NegativeVaultEntrySchema,
]);
export type VaultEntry = z.infer<typeof VaultEntrySchema>;

/** Three-state lookup result — the live routing primitive. */
export const VaultLookupResultSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("positive"), entry: PositiveVaultEntrySchema }),
  z.object({ state: z.literal("negative"), entry: NegativeVaultEntrySchema }),
  z.object({ state: z.literal("unknown") }),
]);
export type VaultLookupResult = z.infer<typeof VaultLookupResultSchema>;
