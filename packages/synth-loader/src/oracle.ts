import type { CallSiteDescriptor, SyntheticInput } from "@compile/schemas";

/**
 * The oracle runs ~1% of synthetic inputs through the customer's frontier LLM
 * to establish ground-truth output for the determinism + agreement axes.
 *
 * Hackathon stub: deterministic generators per Acme call site that emit the
 * shape the model would. Production swaps in a real Anthropic/OpenAI client
 * (paid by the customer's API key per D9 — Compile burns 0 frontier tokens).
 */
export interface IOracleClient {
  call(args: {
    call_site: CallSiteDescriptor;
    input: SyntheticInput;
  }): Promise<{ output: unknown; latency_ms: number; cost_usd: number }>;
}

const TONES = ["whimsical", "stoic", "punchy", "literary", "absurdist"];

export class StubOracleClient implements IOracleClient {
  async call(args: {
    call_site: CallSiteDescriptor;
    input: SyntheticInput;
  }): Promise<{ output: unknown; latency_ms: number; cost_usd: number }> {
    const t0 = performance.now();
    const output = stubFrontierOutput(args.call_site, args.input.payload);
    const latency_ms = performance.now() - t0;
    return { output, latency_ms, cost_usd: 0.05 };
  }
}

export function stubFrontierOutput(
  cs: CallSiteDescriptor,
  payload: unknown,
): unknown {
  const hint = cs.function_hint ?? "";
  const p = (payload ?? {}) as Record<string, unknown>;
  switch (hint) {
    case "classify_lead_tier": {
      const employees = (p.employees as number) ?? 0;
      const industry = String(p.industry ?? "");
      const fit = employees >= 50 && (industry === "fintech" || industry === "healthtech");
      const tier = fit ? (employees > 200 ? "A" : "B") : "C";
      return {
        fit,
        confidence: fit ? 0.92 : 0.4,
        tier,
        reasoning: `${industry} with ${employees} employees`,
      };
    }
    case "extract_invoice_fields": {
      const body = String(p.body ?? "");
      const num = body.match(/INV-\d+/)?.[0] ?? "INV-0000";
      const date = body.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "1970-01-01";
      const total = parseFloat(body.match(/\$([\d,]+\.\d{2})/)?.[1]?.replace(/,/g, "") ?? "0");
      return { invoice_number: num, total_usd: total, date };
    }
    case "resolve_company_domain": {
      const name = String(p.name ?? "Unknown");
      const slug = name.toLowerCase().replace(/[^\w]/g, "").replace(/inc$/, "");
      return `${slug}.com`;
    }
    case "summarize_support_thread":
      return ((p.thread as string[]) ?? []).slice(0, 3).map((s) => `• ${s}`).join("\n");
    case "draft_outreach_subject":
      return `Quick question for ${p.name ?? "you"} re: ${p.signal ?? "growth"}`;
    case "classify_ticket_priority": {
      const text = String(p.text ?? "");
      const priority = /down|outage|P0/.test(text) ? "P0" : /P1|urgent/.test(text) ? "P1" : "P2";
      return {
        priority,
        category: /billing/.test(text) ? "billing" : /auth|login/.test(text) ? "auth" : "outage",
        confidence: 0.9,
      };
    }
    case "match_product_sku":
      return { sku: `SKU-${String(p.query ?? "x").length.toString().padStart(4, "0")}`, match_confidence: 0.85 };
    case "classify_sentiment":
      return { sentiment: /great|good|love/.test(String(p.text ?? "")) ? "pos" : "neu" };
    case "rewrite_email_formal":
      return `Dear team, ${String(p.draft ?? "").replace(/hey/i, "Hello").trim()}`;
    case "generate_marketing_copy": {
      const tone = String(p.tone ?? TONES[0]!);
      return `[${tone}] introducing ${p.product ?? "our product"} for ${p.audience ?? "you"}.`;
    }
    default:
      return { echo: payload };
  }
}

/* ───── Real Anthropic frontier oracle (B5) ─────────────────────────────── */

import Anthropic from "@anthropic-ai/sdk";

/**
 * Pricing for Claude Sonnet 4.6 (USD per token). Used to compute cost_usd
 * per call from the response usage block. Update if the model default changes.
 */
const SONNET_4_6_INPUT_USD_PER_TOKEN = 3 / 1_000_000;
const SONNET_4_6_OUTPUT_USD_PER_TOKEN = 15 / 1_000_000;

/**
 * Real frontier oracle (D9, D10). Hits the customer's Anthropic API with
 * the call site's prompt + the synthetic input payload, parses JSON output,
 * and reports cost from the response's token usage so the BudgetedOracleClient
 * can enforce caps.
 *
 * The SDK's built-in retry is disabled (maxRetries: 0) because retries +
 * fallback are owned by OracleWithLocalFallback; double-retrying would just
 * delay the inevitable when the API is down.
 */
export interface AnthropicOracleOptions {
  apiKey: string;
  /** Defaults to claude-sonnet-4-6 (latest Sonnet at 2026-01 cutoff). */
  model?: string;
  maxTokens?: number;
  timeoutMs?: number;
  /** Override pricing if a future model is configured. Default is Sonnet 4.6. */
  inputUsdPerToken?: number;
  outputUsdPerToken?: number;
}

export class AnthropicOracleClient implements IOracleClient {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly inputUsdPerToken: number;
  private readonly outputUsdPerToken: number;

  constructor(opts: AnthropicOracleOptions) {
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      maxRetries: 0,
      timeout: opts.timeoutMs ?? 30_000,
    });
    this.model = opts.model ?? "claude-sonnet-4-6";
    this.maxTokens = opts.maxTokens ?? 1024;
    this.inputUsdPerToken = opts.inputUsdPerToken ?? SONNET_4_6_INPUT_USD_PER_TOKEN;
    this.outputUsdPerToken = opts.outputUsdPerToken ?? SONNET_4_6_OUTPUT_USD_PER_TOKEN;
  }

  async call(args: {
    call_site: CallSiteDescriptor;
    input: SyntheticInput;
  }): Promise<{ output: unknown; latency_ms: number; cost_usd: number }> {
    const t0 = performance.now();
    const userPrompt = renderOraclePrompt(args.call_site, args.input.payload);
    const message = await this.client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system:
        "You are a JSON oracle standing in for a customer's frontier LLM. " +
        "Return ONLY a valid JSON value (object, array, string, number, boolean, or null) " +
        "matching the schema implied by the call site's prompt. No prose, no markdown fences.",
      messages: [{ role: "user", content: userPrompt }],
    });
    const latency_ms = performance.now() - t0;
    const cost_usd =
      (message.usage?.input_tokens ?? 0) * this.inputUsdPerToken +
      (message.usage?.output_tokens ?? 0) * this.outputUsdPerToken;
    const text = extractText(message);
    const output = tryParseJson(text);
    return { output, latency_ms, cost_usd };
  }
}

/**
 * Build the user-side prompt the oracle sees. Deterministic from the call
 * site so rehearsals are reproducible (modulo the model's own temperature).
 */
export function renderOraclePrompt(cs: CallSiteDescriptor, payload: unknown): string {
  return [
    `Function: ${cs.function_hint ?? "(unnamed)"}`,
    `Original prompt context:`,
    cs.prompt_excerpt,
    ``,
    `Input payload:`,
    JSON.stringify(payload, null, 2),
    ``,
    `Return JSON only.`,
  ].join("\n");
}

function extractText(message: Anthropic.Message): string {
  const block = message.content.find((b) => b.type === "text");
  return block && block.type === "text" ? block.text : "";
}

function tryParseJson(text: string): unknown {
  // Strip markdown fences if the model added them despite instructions.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Last-ditch: extract the first balanced JSON object/array if the model
    // wrapped it in prose. If that also fails, surface the raw text — the
    // agreement axis will treat it as a divergent output, which is honest.
    const firstBrace = cleaned.search(/[{[]/);
    if (firstBrace >= 0) {
      const slice = cleaned.slice(firstBrace);
      try {
        return JSON.parse(slice);
      } catch {
        /* fall through */
      }
    }
    return cleaned;
  }
}

/* ───── OracleWithLocalFallback wrapper ─────────────────────────────────── */

/**
 * Mirrors TensorlakeWithLocalFallback. On any error from the primary
 * (rate-limit, server, network, parse), retries once with a small backoff,
 * then falls back to the supplied fallback client (typically StubOracleClient)
 * for that single input. Keeps the demo honest under transient failures.
 */
export interface OracleWithLocalFallbackOptions {
  retryDelayMs?: number;
  onFallback?: (
    err: unknown,
    args: { call_site: CallSiteDescriptor; input: SyntheticInput },
  ) => void;
}

export class OracleWithLocalFallback implements IOracleClient {
  private fallbackCount = 0;
  constructor(
    private readonly primary: IOracleClient,
    private readonly fallback: IOracleClient,
    private readonly opts: OracleWithLocalFallbackOptions = {},
  ) {}

  fallbacksEngaged(): number {
    return this.fallbackCount;
  }

  async call(args: {
    call_site: CallSiteDescriptor;
    input: SyntheticInput;
  }): Promise<{ output: unknown; latency_ms: number; cost_usd: number }> {
    try {
      return await this.primary.call(args);
    } catch (firstErr) {
      // Retry once — most flaky-API errors clear on a single retry.
      const delay = this.opts.retryDelayMs ?? 250;
      await new Promise((r) => setTimeout(r, delay));
      try {
        return await this.primary.call(args);
      } catch (secondErr) {
        this.fallbackCount++;
        const onFallback =
          this.opts.onFallback ??
          ((e) => {
            console.error(
              `[oracle] primary failed twice for ${args.input.input_id}: ${(e as Error).message}; using stub fallback`,
            );
          });
        onFallback(secondErr, args);
        return await this.fallback.call(args);
      }
    }
  }
}

/* ───── BudgetedOracleClient ────────────────────────────────────────────── */

/**
 * Hard-cap on cumulative oracle spend. Reads cost_usd off each wrapped call
 * and refuses to issue further calls once the budget is hit. Used by Saturday
 * rehearsals so a runaway loop can't drain the Anthropic billing console.
 *
 * Default budget per run is $5 — Sonnet 4.6 oracle samples at ~$0.005/call,
 * so 1,000 calls budgets to $5 with no headroom. Bump COMPILE_ORACLE_BUDGET_USD
 * for high-fidelity rehearsals.
 *
 * When the budget is hit, subsequent calls throw `OracleBudgetExceededError`.
 * The OracleWithLocalFallback wrapper catches that just like any other error
 * and falls back per-input — so a budget cap degrades gracefully into
 * stubbed oracle samples for the remainder of the run rather than crashing
 * the demo mid-Stage-2.
 */
export class OracleBudgetExceededError extends Error {
  constructor(public readonly spent_usd: number, public readonly budget_usd: number) {
    super(
      `oracle budget exceeded: spent ${spent_usd.toFixed(4)} USD, cap ${budget_usd.toFixed(2)} USD`,
    );
    this.name = "OracleBudgetExceededError";
  }
}

export interface BudgetedOracleClientOptions {
  budgetUsd: number;
  onTrip?: (spent_usd: number, budget_usd: number) => void;
}

export class BudgetedOracleClient implements IOracleClient {
  private spent = 0;
  private tripped = false;

  constructor(
    private readonly inner: IOracleClient,
    private readonly opts: BudgetedOracleClientOptions,
  ) {}

  spentUsd(): number {
    return this.spent;
  }

  reset(): void {
    this.spent = 0;
    this.tripped = false;
  }

  async call(args: {
    call_site: CallSiteDescriptor;
    input: SyntheticInput;
  }): Promise<{ output: unknown; latency_ms: number; cost_usd: number }> {
    if (this.spent >= this.opts.budgetUsd) {
      throw new OracleBudgetExceededError(this.spent, this.opts.budgetUsd);
    }
    const r = await this.inner.call(args);
    this.spent += r.cost_usd;
    if (this.spent >= this.opts.budgetUsd && !this.tripped) {
      this.tripped = true;
      this.opts.onTrip?.(this.spent, this.opts.budgetUsd);
    }
    return r;
  }
}
