/**
 * Friday derisk #1: synthesizer round-trip harness.
 *
 *   1. Load each fixture cluster (tier-1 invoice, tier-2 lead-qual, tier-3 creative)
 *   2. Build the synthesis spec via assembleSpec — holdout indices kept private
 *   3. Send the spec + verbatim prompt from prompts/synthesizer.md to Claude
 *      via the Anthropic SDK
 *   4. Validate the returned envelope (Zod)
 *   5. Run the holdout gate via @compile/runtime (vitest subprocess)
 *   6. Print pass/fail table; exit non-zero if <2/3 pass
 *
 * Pass criteria (ENG_REVIEW.md derisk #1): 2 of 3 expected classifications.
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  assembleSpec,
  loadSynthesizerPrompt,
  validateEnvelope,
} from "../src/index.js";
import { gate } from "@compile/runtime";
import { FIXTURES, type Fixture } from "./fixtures.js";
import { randomUUID } from "node:crypto";

interface Outcome {
  fixture: string;
  expected_synthesizable: boolean;
  expected_tier_or_reason: string;
  classification_match: boolean;
  envelope_valid: boolean;
  gate_verdict?: "pass" | "fail";
  match_rate?: number;
  notes: string;
}

async function runFixture(
  client: Anthropic,
  prompt: string,
  fx: Fixture,
): Promise<Outcome> {
  const { spec, holdout_traces } = assembleSpec({
    request_id: randomUUID(),
    cluster: fx.cluster,
    prompt_template: fx.prompt_template,
    tool_schemas: fx.tool_schemas,
    input_schema: fx.input_schema,
    output_schema: fx.output_schema,
    traces: fx.traces,
  });

  const userMsg = `SYNTHESIS_SPEC:\n${JSON.stringify(spec, null, 2)}`;

  const resp = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 8000,
    system: prompt,
    messages: [{ role: "user", content: userMsg }],
  });

  const text =
    resp.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

  let raw: unknown;
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    raw = JSON.parse(text.slice(start, end + 1));
  } catch (e) {
    return {
      fixture: fx.name,
      expected_synthesizable: fx.expected.synthesizable,
      expected_tier_or_reason: fx.expected.tier ?? fx.expected.reason ?? "—",
      classification_match: false,
      envelope_valid: false,
      notes: `JSON parse failed: ${(e as Error).message}`,
    };
  }

  const validated = validateEnvelope(raw);
  if (!validated.ok) {
    return {
      fixture: fx.name,
      expected_synthesizable: fx.expected.synthesizable,
      expected_tier_or_reason: fx.expected.tier ?? fx.expected.reason ?? "—",
      classification_match: false,
      envelope_valid: false,
      notes: `envelope rejected: ${validated.failure_reason.slice(0, 200)}`,
    };
  }

  const env = validated.envelope;
  const classificationMatch =
    env.synthesizable === fx.expected.synthesizable &&
    (env.synthesizable
      ? env.tier === fx.expected.tier
      : env.reason === fx.expected.reason);

  if (!env.synthesizable) {
    return {
      fixture: fx.name,
      expected_synthesizable: fx.expected.synthesizable,
      expected_tier_or_reason: fx.expected.tier ?? fx.expected.reason ?? "—",
      classification_match: classificationMatch,
      envelope_valid: true,
      notes: `agent emitted negative: reason=${env.reason}`,
    };
  }

  // Synthesizable → run the holdout gate.
  let verdict: Awaited<ReturnType<typeof gate>>;
  try {
    verdict = await gate({ envelope: env, holdout: holdout_traces });
  } catch (e) {
    return {
      fixture: fx.name,
      expected_synthesizable: fx.expected.synthesizable,
      expected_tier_or_reason: fx.expected.tier ?? "—",
      classification_match: classificationMatch,
      envelope_valid: true,
      notes: `gate runner crashed: ${(e as Error).message.slice(0, 200)}`,
    };
  }

  return {
    fixture: fx.name,
    expected_synthesizable: fx.expected.synthesizable,
    expected_tier_or_reason: fx.expected.tier ?? "—",
    classification_match: classificationMatch,
    envelope_valid: true,
    gate_verdict: verdict.verdict,
    match_rate: verdict.match_rate,
    notes:
      verdict.verdict === "pass"
        ? `tier=${env.tier} match=${verdict.match_rate.toFixed(3)}`
        : `tier=${env.tier} ${verdict.failure_reason ?? ""}`,
  };
}

function printTable(rows: Outcome[]): void {
  const lines = [
    "",
    "FRIDAY HARNESS — synthesizer round-trip",
    "=".repeat(72),
    ...rows.map(
      (r) =>
        `${r.classification_match ? "✓" : "✗"} ${r.fixture.padEnd(24)}` +
        ` expect=${r.expected_tier_or_reason.padEnd(14)}` +
        ` valid=${r.envelope_valid ? "y" : "n"}` +
        (r.gate_verdict ? ` gate=${r.gate_verdict}` : "") +
        `\n    ${r.notes}`,
    ),
    "=".repeat(72),
  ];
  console.log(lines.join("\n"));
}

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(
      "ANTHROPIC_API_KEY not set — skipping live harness. Set it in .env to run.",
    );
    process.exit(0);
  }
  const client = new Anthropic({ apiKey });
  const prompt = await loadSynthesizerPrompt();

  const outcomes: Outcome[] = [];
  for (const fx of FIXTURES) {
    console.error(`[harness] running ${fx.name}…`);
    try {
      outcomes.push(await runFixture(client, prompt, fx));
    } catch (e) {
      outcomes.push({
        fixture: fx.name,
        expected_synthesizable: fx.expected.synthesizable,
        expected_tier_or_reason: fx.expected.tier ?? fx.expected.reason ?? "—",
        classification_match: false,
        envelope_valid: false,
        notes: `harness threw: ${(e as Error).message}`,
      });
    }
  }
  printTable(outcomes);
  const passed = outcomes.filter((o) => o.classification_match).length;
  console.log(`\n${passed}/${outcomes.length} fixtures classified correctly`);
  process.exit(passed >= 2 ? 0 : 1);
}

main().catch((err) => {
  console.error("[harness] fatal:", err);
  process.exit(1);
});
