import { z } from "zod";

/**
 * Static-prior signals the scanner pulls from a single LLM call site.
 * See ENG_REVIEW.md D11 — TS-only for the hackathon.
 */
export const StaticPriorSignalsSchema = z.object({
  has_response_format: z.boolean(),
  has_zod_schema: z.boolean(),
  has_temperature_zero: z.boolean(),
  prompt_template_static: z.boolean(),
  bounded_tool_array: z.boolean(),
  tool_count: z.number().int().nonnegative(),
  has_few_shot_examples: z.boolean(),
  followed_by_structured_parse: z.boolean(),
  has_telemetry: z.boolean(),
});
export type StaticPriorSignals = z.infer<typeof StaticPriorSignalsSchema>;

export const StaticPriorsSchema = z.object({
  schema_stability_prior: z.number().min(0).max(1),
  determinism_prior: z.number().min(0).max(1),
  economic_value_prior: z.number().min(0).max(1),
  /** rgb-pill for the scanner UI panel */
  pill: z.enum(["green", "yellow", "red"]),
  signals: StaticPriorSignalsSchema,
});
export type StaticPriors = z.infer<typeof StaticPriorsSchema>;

export const CallSiteDescriptorSchema = z.object({
  call_site_id: z.string(),
  file_path: z.string(),
  line: z.number().int().nonnegative(),
  column: z.number().int().nonnegative(),
  /** SDK that owns this call: "anthropic", "openai", "mcp", "unknown" */
  provider: z.enum(["anthropic", "openai", "mcp", "unknown"]),
  function_hint: z.string().optional(),
  prompt_excerpt: z.string(),
  priors: StaticPriorsSchema,
});
export type CallSiteDescriptor = z.infer<typeof CallSiteDescriptorSchema>;

export const ScanReportSchema = z.object({
  scanned_at: z.string().datetime(),
  repo_path: z.string(),
  files_scanned: z.number().int().nonnegative(),
  call_sites: z.array(CallSiteDescriptorSchema),
  /** SHA of the scanned tree (or 'dirty'). Used by negative Vault retry policy
   * for `low_static_prior` entries — they expire on code change. */
  tree_signature: z.string(),
});
export type ScanReport = z.infer<typeof ScanReportSchema>;

/** Static-prior thresholds — sites passing all three enter Stage 2 (D10). */
export const STATIC_PRIOR_THRESHOLDS = {
  schema_stability: 0.5,
  determinism: 0.5,
  economic_value: 0,
} as const;

export const STATIC_PILL_THRESHOLDS = {
  green: 0.7,
  yellow: 0.5,
} as const;
