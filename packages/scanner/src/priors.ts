import {
  type StaticPriorSignals,
  type StaticPriors,
  STATIC_PILL_THRESHOLDS,
} from "@compile/schemas";

/**
 * Convert raw signals to per-axis priors and a UI pill (D11).
 *
 *   schema  = response_format / zod / bounded tools / few-shot / structured parse
 *   det     = temperature 0 / static prompt template
 *   econ    = telemetry presence (binary for the hackathon — real volume
 *             numbers come from customer-supplied telemetry post-bootstrap)
 *
 * Coefficients lifted directly from DESIGN.md "Static Prior" table so the
 * scoring is auditable / explainable in the panel.
 */
export function priorsFromSignals(signals: StaticPriorSignals): StaticPriors {
  let schema = 0;
  if (signals.has_response_format) schema += 0.4;
  if (signals.has_zod_schema) schema += 0.4;
  if (signals.bounded_tool_array && signals.tool_count > 0) schema += 0.2;
  if (signals.has_few_shot_examples) schema += 0.1;
  if (signals.followed_by_structured_parse) schema += 0.1;
  schema = Math.min(1, schema);

  let det = 0;
  if (signals.has_temperature_zero) det += 0.5;
  if (signals.prompt_template_static) det += 0.4;
  if (signals.followed_by_structured_parse) det += 0.1;
  det = Math.min(1, det);

  // Hackathon proxy: if telemetry is wired we assume meaningful volume.
  const econ = signals.has_telemetry ? 0.8 : 0.4;

  const composite = (schema + det + econ) / 3;
  const pill: StaticPriors["pill"] =
    composite >= STATIC_PILL_THRESHOLDS.green
      ? "green"
      : composite >= STATIC_PILL_THRESHOLDS.yellow
        ? "yellow"
        : "red";

  return {
    schema_stability_prior: round3(schema),
    determinism_prior: round3(det),
    economic_value_prior: round3(econ),
    pill,
    signals,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
