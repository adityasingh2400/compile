import type {
  GenerateRequest,
  GenerateResponse,
  HealthResult,
  IPhiClient,
  WarmupResult,
} from "./client.js";

/**
 * Ollama-backed Phi-3-mini client. Local dev impl. Tensorlake-sandbox impl
 * will use the same HTTP shape against the sandbox URL.
 *
 * Streams /api/generate so we can measure first-token latency, which is the
 * Friday derisk #2 metric (cold start ≤ 10s, warm latency ~ Tier-2 budget).
 */
export interface OllamaClientOptions {
  baseUrl?: string;
  model?: string;
  /** How long ollama keeps the model resident after the call. */
  keepAlive?: string;
}

interface OllamaStreamChunk {
  response?: string;
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaPhiClient implements IPhiClient {
  readonly baseUrl: string;
  readonly model: string;
  readonly keepAlive: string;
  private lastUsedMs = 0;

  constructor(opts: OllamaClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? "http://localhost:11434";
    this.model = opts.model ?? "phi3:mini";
    this.keepAlive = opts.keepAlive ?? "10m";
  }

  async generate(req: GenerateRequest): Promise<GenerateResponse> {
    const start = performance.now();
    const body = {
      model: this.model,
      prompt: req.prompt,
      stream: true,
      keep_alive: this.keepAlive,
      format: req.schema ? "json" : undefined,
      options: {
        temperature: req.temperature ?? 0,
        num_predict: req.maxTokens ?? 512,
      },
    };
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      throw new Error(
        `ollama generate failed: ${res.status} ${res.statusText}`,
      );
    }
    let firstTokenMs = -1;
    let output = "";
    let promptTokens = -1;
    let completionTokens = -1;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        const chunk = JSON.parse(line) as OllamaStreamChunk;
        if (chunk.response) {
          if (firstTokenMs < 0) firstTokenMs = performance.now() - start;
          output += chunk.response;
        }
        if (chunk.done) {
          if (typeof chunk.prompt_eval_count === "number")
            promptTokens = chunk.prompt_eval_count;
          if (typeof chunk.eval_count === "number")
            completionTokens = chunk.eval_count;
        }
      }
    }
    const latencyMs = performance.now() - start;
    this.lastUsedMs = Date.now();
    return {
      output,
      latencyMs,
      firstTokenMs: firstTokenMs < 0 ? latencyMs : firstTokenMs,
      promptTokens,
      completionTokens,
    };
  }

  async warmup(): Promise<WarmupResult> {
    const start = performance.now();
    try {
      const res = await fetch(`${this.baseUrl}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          prompt: "",
          stream: false,
          keep_alive: this.keepAlive,
        }),
      });
      const ok = res.ok;
      await res.body?.cancel();
      return { ready: ok, latencyMs: performance.now() - start };
    } catch {
      return { ready: false, latencyMs: performance.now() - start };
    }
  }

  async health(): Promise<HealthResult> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      });
      return { alive: res.ok, lastUsedMs: this.lastUsedMs };
    } catch {
      return { alive: false, lastUsedMs: this.lastUsedMs };
    }
  }
}
