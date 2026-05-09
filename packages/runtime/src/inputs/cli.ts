/**
 * Generate synthetic inputs for a demo cluster, optionally run them
 * through the configured LLM and print the captured outputs.
 *
 *   # generate-only (no LLM calls)
 *   npm run generate:inputs -w @compile/runtime -- --cluster icp_fit --n 10
 *
 *   # render prompts without calling (verify template substitution)
 *   npm run generate:inputs -w @compile/runtime -- --cluster icp_fit --n 5 --run --dry-run
 *
 *   # actually call the LLM (uses ANTHROPIC_API_KEY)
 *   npm run generate:inputs -w @compile/runtime -- --cluster icp_fit --n 5 --run --max-calls 5
 *
 * Flags:
 *   --cluster     icp_fit | ambiguous_lead | novel_positioning   (required)
 *   --n           number of inputs to generate (default 10)
 *   --seed        PRNG seed (default 42)
 *   --perturb     fraction drawn from real-trace perturbation (default 0.5)
 *   --run         actually invoke the LLM on each input
 *   --dry-run     with --run, render prompts but do not call (no token cost)
 *   --max-calls   hard cap on LLM calls (default = --n)
 *   --model       Anthropic model id (default claude-sonnet-4-5)
 */

import { generateInputs } from "./generator.js";
import {
  ICP_FIT_FIXTURE,
  AMBIGUOUS_LEAD_FIXTURE,
  NOVEL_POSITIONING_FIXTURE,
  type ClusterFixture,
} from "./fixtures.js";
import { AnthropicChatClient, runInputs } from "./runner.js";

const FIXTURES: Record<string, ClusterFixture> = {
  icp_fit: ICP_FIT_FIXTURE,
  ambiguous_lead: AMBIGUOUS_LEAD_FIXTURE,
  novel_positioning: NOVEL_POSITIONING_FIXTURE,
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main(): Promise<void> {
  const cluster = arg("cluster");
  if (!cluster || !FIXTURES[cluster]) {
    console.error(
      `usage: --cluster <${Object.keys(FIXTURES).join("|")}> [--n N] [--seed S] [--perturb F] [--run [--dry-run] [--max-calls K] [--model M]]`,
    );
    process.exit(2);
  }
  const fixture = FIXTURES[cluster];
  const n = Number(arg("n") ?? 10);
  const seed = Number(arg("seed") ?? 42);
  const perturbArg = arg("perturb");
  const perturbFraction = perturbArg !== undefined ? Number(perturbArg) : undefined;

  const inputs = generateInputs({
    inputSchema: fixture.input_schema,
    traces: fixture.traces,
    n,
    seed,
    perturbFraction,
  });

  if (!flag("run")) {
    console.log(
      JSON.stringify(
        {
          cluster: fixture.cluster_id,
          expected_tier: fixture.expected_tier,
          seed,
          n,
          inputs,
        },
        null,
        2,
      ),
    );
    return;
  }

  const dryRun = flag("dry-run");
  const maxCalls = arg("max-calls") !== undefined ? Number(arg("max-calls")) : undefined;
  const model = arg("model");

  const client = dryRun
    ? // Dry-run never reaches client.chat(), but TS still needs a value.
      ({
        model: model ?? "dry-run",
        chat: async () => ({
          output: "",
          latencyMs: 0,
          inputTokens: 0,
          outputTokens: 0,
          model: "dry-run",
        }),
      } as const)
    : new AnthropicChatClient({ model });

  const summary = await runInputs({
    template: fixture.prompt_template,
    inputs,
    client,
    dryRun,
    maxCalls,
  });

  console.log(
    JSON.stringify(
      {
        cluster: fixture.cluster_id,
        expected_tier: fixture.expected_tier,
        model: client.model,
        dry_run: dryRun,
        seed,
        n,
        cluster_calls: summary.cluster_calls,
        ok: summary.ok,
        errors: summary.errors,
        total_input_tokens: summary.total_input_tokens,
        total_output_tokens: summary.total_output_tokens,
        total_latency_ms: summary.total_latency_ms,
        results: summary.results,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
