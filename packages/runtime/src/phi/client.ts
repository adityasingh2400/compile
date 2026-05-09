/**
 * Phi-3-mini client interface (Tier-2 local LLM).
 *
 * Per ENG_REVIEW D6: Tier-2 must be a real Phi-3-mini call, with cold-start
 * mitigated via pre-warm + keep-alive. The HTTP shape is identical for the
 * local ollama dev impl and the Tensorlake-sandbox prod impl, so the runtime
 * only ever talks to this interface.
 */

export interface GenerateRequest {
  prompt: string;
  maxTokens?: number;
  /** Optional JSON Schema for structured output (D3 tier-2 gate). */
  schema?: Record<string, unknown>;
  /** Sampling. Default 0 — Tier-2 wants determinism on the holdout. */
  temperature?: number;
}

export interface GenerateResponse {
  output: string;
  /** End-to-end wall time. */
  latencyMs: number;
  /** Time from request send to first token byte. The metric the derisk gates on. */
  firstTokenMs: number;
  /** Token counts when the backend reports them; -1 if unknown. */
  promptTokens: number;
  completionTokens: number;
}

export interface WarmupResult {
  ready: boolean;
  /** Wall time for the warmup probe — includes model load if cold. */
  latencyMs: number;
}

export interface HealthResult {
  alive: boolean;
  /** Epoch ms of the last successful generate(); 0 if never. */
  lastUsedMs: number;
}

export interface IPhiClient {
  generate(req: GenerateRequest): Promise<GenerateResponse>;
  warmup(): Promise<WarmupResult>;
  health(): Promise<HealthResult>;
}
