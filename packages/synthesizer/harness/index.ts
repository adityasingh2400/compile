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
  SynthesisSuccessSchema,
  SynthesisNegativeSchema,
} from "@compile/schemas";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  assembleSpec,
  loadSynthesizerPrompt,
  validateEnvelope,
} from "../src/index.js";
import { gate } from "@compile/runtime";
import { FIXTURES, type Fixture } from "./fixtures.js";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DEBUG_DIR = join(process.cwd(), "harness-debug");

/**
 * Anthropic tool-use requires a single object schema per tool (no top-level
 * oneOf). We expose the discriminated envelope as TWO tools and let the model
 * pick. Same agent contract from prompts/synthesizer.md — more reliable wire.
 */
function toJsonSchema(s: typeof SynthesisSuccessSchema | typeof SynthesisNegativeSchema): Record<string, unknown> {
  const schema = zodToJsonSchema(s, { $refStrategy: "none" }) as Record<string, unknown>;
  // Anthropic tool-use rejects $schema and additionalProperties at top level.
  delete schema.$schema;
  delete (schema as { additionalProperties?: unknown }).additionalProperties;
  return schema;
}

const SUCCESS_TOOL = {
  name: "emit_synthesis_success",
  description:
    "Call this when the cluster IS codifiable. Emits a typed function (Tier 1) or prompt pack (Tier 2). Set synthesizable=true.",
  input_schema: toJsonSchema(SynthesisSuccessSchema),
};

const NEGATIVE_TOOL = {
  name: "emit_synthesis_negative",
  description:
    "Call this when the cluster is NOT codifiable on inspection. Set synthesizable=false. Pick the reason from the enum.",
  input_schema: toJsonSchema(SynthesisNegativeSchema),
};

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

  const userMsg = `SYNTHESIS_SPEC:\n${JSON.stringify(spec, null, 2)}\n\nCall exactly one of: emit_synthesis_success (when codifiable) or emit_synthesis_negative (when not). Do not respond in text.`;

  const resp = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 8000,
    system: prompt,
    tools: [SUCCESS_TOOL, NEGATIVE_TOOL],
    tool_choice: { type: "any" },
    messages: [{ role: "user", content: userMsg }],
  });

  await mkdir(DEBUG_DIR, { recursive: true });
  await writeFile(
    join(DEBUG_DIR, `${fx.name}.response.json`),
    JSON.stringify(resp, null, 2),
  );

  const toolUse = resp.content.find(
    (b): b is Anthropic.Messages.ToolUseBlock => b.type === "tool_use",
  );
  if (!toolUse) {
    return {
      fixture: fx.name,
      expected_synthesizable: fx.expected.synthesizable,
      expected_tier_or_reason: fx.expected.tier ?? fx.expected.reason ?? "—",
      classification_match: false,
      envelope_valid: false,
      notes: "model did not call any envelope tool",
    };
  }
  const raw = toolUse.input;
  await writeFile(
    join(DEBUG_DIR, `${fx.name}.envelope.json`),
    JSON.stringify(raw, null, 2),
  );

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
