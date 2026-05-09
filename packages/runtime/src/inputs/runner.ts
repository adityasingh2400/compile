/**
 * Run synthetic inputs through an LLM, capture outputs.
 *
 * The output of this runner is what the D10 axis scorer ingests:
 *   schema_stability — % of outputs that validate against the inferred output schema
 *   determinism      — re-run K traces; embedding cosine + JSON-equality vs original
 *
 * Generic over IChatClient so OpenAI / Phi / a stub can swap in. Default
 * impl is Anthropic (Claude); pass a different client to use anything else.
 *
 * Cost guardrails:
 *   - maxCalls hard-caps the number of LLM calls, regardless of input count.
 *   - dryRun renders prompts without calling the API — useful for verifying
 *     template substitution before spending tokens.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { GeneratedInput } from "./generator.js";

export interface ChatRequest {
  prompt: string;
  maxTokens?: number;
}

export interface ChatResponse {
  output: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  /** Provider model identifier (e.g. "claude-sonnet-4-6"). */
  model: string;
}

export interface IChatClient {
  chat(req: ChatRequest): Promise<ChatResponse>;
  readonly model: string;
}

export class AnthropicChatClient implements IChatClient {
  readonly model: string;
  private readonly client: Anthropic;

  constructor(opts: { apiKey?: string; model?: string } = {}) {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "AnthropicChatClient: ANTHROPIC_API_KEY not set. Export it or pass apiKey explicitly.",
      );
    }
    this.model = opts.model ?? "claude-sonnet-4-5";
    this.client = new Anthropic({ apiKey });
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const start = performance.now();
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 512,
      messages: [{ role: "user", content: req.prompt }],
    });
    const latencyMs = performance.now() - start;
    const text = res.content
      .flatMap((c) => (c.type === "text" ? [c.text] : []))
      .join("");
    return {
      output: text,
      latencyMs,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
      model: this.model,
    };
  }
}

export interface RunInputsArgs {
  template: string;
  inputs: GeneratedInput[];
  client: IChatClient;
  /** Hard cap on LLM calls. Truncates `inputs` if exceeded. */
  maxCalls?: number;
  /** Skip the LLM call; record rendered prompt only. */
  dryRun?: boolean;
  /** Forwarded to chat(). */
  maxTokensPerCall?: number;
}

export interface RunResult {
  input: unknown;
  source: GeneratedInput["source"];
  rendered_prompt: string;
  output?: string;
  latency_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  error?: string;
}

export interface RunSummary {
  cluster_calls: number;
  ok: number;
  errors: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_latency_ms: number;
  /** Estimated USD spend, if a price table is provided to estimateCost. */
  results: RunResult[];
}

export async function runInputs(args: RunInputsArgs): Promise<RunSummary> {
  const limit = args.maxCalls ?? args.inputs.length;
  const slice = args.inputs.slice(0, limit);
  const results: RunResult[] = [];
  let totalIn = 0;
  let totalOut = 0;
  let totalLatency = 0;
  let ok = 0;
  let errors = 0;

  for (const g of slice) {
    const rendered = renderTemplate(args.template, g.input);
    if (args.dryRun) {
      results.push({
        input: g.input,
        source: g.source,
        rendered_prompt: rendered,
      });
      continue;
    }
    try {
      const r = await args.client.chat({
        prompt: rendered,
        maxTokens: args.maxTokensPerCall,
      });
      results.push({
        input: g.input,
        source: g.source,
        rendered_prompt: rendered,
        output: r.output,
        latency_ms: r.latencyMs,
        input_tokens: r.inputTokens,
        output_tokens: r.outputTokens,
      });
      totalIn += r.inputTokens;
      totalOut += r.outputTokens;
      totalLatency += r.latencyMs;
      ok++;
    } catch (e) {
      results.push({
        input: g.input,
        source: g.source,
        rendered_prompt: rendered,
        error: (e as Error).message,
      });
      errors++;
    }
  }

  return {
    cluster_calls: slice.length,
    ok,
    errors,
    total_input_tokens: totalIn,
    total_output_tokens: totalOut,
    total_latency_ms: totalLatency,
    results,
  };
}

/**
 * Replace `{{field}}` placeholders with stringified values from `input`.
 * Missing fields render as `<missing:field>` so it's visible in dry-run
 * rather than silently dropped.
 */
export function renderTemplate(template: string, input: unknown): string {
  const obj = (input ?? {}) as Record<string, unknown>;
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, key: string) => {
    const value = key.split(".").reduce<unknown>((acc, k) => {
      if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[k];
      return undefined;
    }, obj);
    if (value === undefined) return `<missing:${key}>`;
    return typeof value === "string" ? value : JSON.stringify(value);
  });
}
