import { createHash } from "node:crypto";
import { transformSync } from "esbuild";
import { Sandbox } from "tensorlake";
import type { Trace } from "@compile/schemas";
import { compileFunction } from "./executor.js";

/**
 * Sandbox compute primitives Compile uses Tensorlake for. Per ENG_REVIEW.md
 * Code Quality §2 every sponsor surface sits behind a thin interface so we
 * can swap to a stub mid-build without changing call sites.
 *
 * Three implementations live in this file:
 *   - LocalFakeTensorlakeClient   — offline, deterministic. Used by tests
 *                                   and as the fallback layer when the real
 *                                   Tensorlake endpoint is unreachable.
 *   - RealTensorlakeClient        — production adapter. Has one TODO at the
 *                                   SDK boundary; flips on when credentials
 *                                   land. Currently throws the same
 *                                   "TODO: wire SDK" everywhere so the
 *                                   fallback wrapper exercises cleanly.
 *   - TensorlakeWithLocalFallback — production wrapper. Tries the primary
 *                                   client; on `Error`, falls back to the
 *                                   local fake. Maps to failure mode #2 in
 *                                   ENG_REVIEW.md ("if grid fails, replay
 *                                   pre-recorded run from disk").
 */

export interface RunEmittedFunctionArgs {
  code: string;
  function_name: string;
  holdout: Trace[];
}

export interface RunEmittedFunctionResult {
  outputs: unknown[];
  latency_ms: number[];
  /** True if the emitted function invoked llmFallback on any holdout trace.
   * Surfaced so the gate can fail uncovered branches per existing semantics. */
  fallback_invoked: boolean;
}

export interface RunPhiArgs {
  prompt: string;
  input: unknown;
}

export interface RunPhiResult {
  output: unknown;
  latency_ms: number;
}

export interface ITensorlakeClient {
  /** Run agent-emitted TS against held-out traces; used by the ≥98% gate. */
  runEmittedFunction(args: RunEmittedFunctionArgs): Promise<RunEmittedFunctionResult>;

  /** Tier-2 inference against the hosted Phi-3-mini sandbox (D1). */
  runPhi(args: RunPhiArgs): Promise<RunPhiResult>;

  /** Pre-warm before demo (D6). Operator runs `npm run warm` ~10 min ahead. */
  warm(): Promise<void>;
}

/**
 * Offline-deterministic implementation. `runEmittedFunction` compiles the
 * agent-emitted code in-process via the existing executor; `runPhi`
 * delegates to a caller-supplied function (defaults to identity-shape).
 *
 * In tests, this stands in for Tensorlake completely. In production, it's
 * the fallback half of TensorlakeWithLocalFallback.
 */
export class LocalFakeTensorlakeClient implements ITensorlakeClient {
  private readonly phiHandler: (args: RunPhiArgs) => Promise<unknown> | unknown;
  constructor(opts: {
    /** Lets tests inject a deterministic Phi mirror — typically the same
     * stubFrontierOutput the synth-loader oracle uses, so YELLOW Stage-2
     * outputs match the rest of the demo. */
    phiHandler?: (args: RunPhiArgs) => Promise<unknown> | unknown;
  } = {}) {
    this.phiHandler =
      opts.phiHandler ?? ((args) => ({ phi_echo: args.input }));
  }

  async runEmittedFunction(args: RunEmittedFunctionArgs): Promise<RunEmittedFunctionResult> {
    // Cache key includes a hash of the code so two gate runs with the
    // same function_name but different bodies don't collide. The
    // executor's cache is sized for runCodified's runtime-routing path
    // where the same Vault entry is hit many times; the gate sees each
    // submission once, but Vitest re-runs them in the same process.
    const codeHash = createHash("sha1").update(args.code).digest("hex").slice(0, 12);
    const fn = compileFunction({
      function_id: `gate_${args.function_name}_${codeHash}`,
      function_name: args.function_name,
      code: args.code,
    });
    const outputs: unknown[] = [];
    const latency_ms: number[] = [];
    let fallback_invoked = false;
    for (const trace of args.holdout) {
      const t0 = performance.now();
      try {
        const out = await fn(trace.input);
        outputs.push(out);
      } catch (err) {
        // Mirror the vitest-runner contract: llmFallback throws inside
        // emitted code → counts as an uncovered branch + fails the trace.
        const msg = (err as Error).message ?? "";
        if (msg.includes("RUNTIME_FALLBACK") || msg.includes("GATE_FAIL")) {
          fallback_invoked = true;
        }
        outputs.push({ __error: msg.slice(0, 200) });
      }
      latency_ms.push(performance.now() - t0);
    }
    return { outputs, latency_ms, fallback_invoked };
  }

  async runPhi(args: RunPhiArgs): Promise<RunPhiResult> {
    const t0 = performance.now();
    const output = await this.phiHandler(args);
    return { output, latency_ms: performance.now() - t0 };
  }

  async warm(): Promise<void> {
    // No-op; in-process executor has no cold start. Resolves quickly so the
    // operator's `npm run warm` returns instantly when running offline.
  }
}

/**
 * Production adapter. The real Tensorlake SDK call lives at the TODO inside
 * each method. While unwired, every method throws — TensorlakeWithLocalFallback
 * routes around the throw to the LocalFake so the gate / candidate path
 * keeps working end-to-end.
 *
 * Flip-on plan when credentials arrive:
 *   1. Add `import { TensorlakeClient } from "@tensorlake/sdk"` (or whatever).
 *   2. Replace the TODO bodies with the real call surface.
 *   3. Keep the wrapper — local fallback stays as the disaster recovery path
 *      ENG_REVIEW.md failure mode #2 calls for.
 */
export interface RealTensorlakeOptions {
  /** Defaults to env TENSORLAKE_API_KEY. Pass explicitly to override or for tests. */
  apiKey?: string;
  /** Tensorlake API base URL. Defaults to the SDK's cloud endpoint. */
  endpoint?: string;
  /** Worker count for runEmittedFunction. Demo uses 64 (DESIGN.md). */
  workerCount?: number;
  /** Gate sandbox sizing. */
  name?: string;
  cpus?: number;
  memoryMb?: number;
  timeoutSecs?: number;

  /** Tensorlake-registered image with ollama + the Phi model pre-pulled.
   * Built once via `npm run build:phi-image` (see build-phi-image.ts).
   * When unset, runPhi throws so TensorlakeWithLocalFallback engages. */
  phiImage?: string;
  /** Ollama model tag inside the image. Defaults to "phi3:mini" (D1). */
  phiModel?: string;
  phiCpus?: number;
  phiMemoryMb?: number;
}

export class RealTensorlakeClient implements ITensorlakeClient {
  /** Reused across calls within a session. Created lazily on first use,
   * pre-warmed by `warm()`, kept alive until `close()`. Sharing one sandbox
   * is the difference between ~600ms cold-start per call and ~400ms node
   * exec per call. */
  private sandbox: Sandbox | null = null;
  private warming: Promise<void> | null = null;

  constructor(private readonly opts: RealTensorlakeOptions = {}) {}

  private async getSandbox(): Promise<Sandbox> {
    if (this.sandbox) return this.sandbox;
    if (!this.warming) {
      this.warming = (async () => {
        this.sandbox = await Sandbox.create({
          name: this.opts.name ?? `compile-runtime-${Date.now()}`,
          cpus: this.opts.cpus ?? 1,
          memoryMb: this.opts.memoryMb ?? 1024,
          timeoutSecs: this.opts.timeoutSecs ?? 1800,
          ...(this.opts.apiKey ? { apiKey: this.opts.apiKey } : {}),
          ...(this.opts.endpoint ? { apiUrl: this.opts.endpoint } : {}),
        });
      })();
    }
    await this.warming;
    if (!this.sandbox) throw new Error("RealTensorlakeClient: sandbox creation failed");
    return this.sandbox;
  }

  async runEmittedFunction(args: RunEmittedFunctionArgs): Promise<RunEmittedFunctionResult> {
    const sandbox = await this.getSandbox();

    // Transpile the agent-emitted TS locally (we own esbuild). Upload pure JS
    // to the sandbox so we don't need to ship a build toolchain inside.
    const stripped = args.code.replace(
      /import\s*\{[^}]*llmFallback[^}]*\}\s*from\s*['"][^'"]+['"]\s*;?/g,
      "",
    );
    const transpiled = transformSync(stripped, {
      loader: "ts",
      format: "esm",
      target: "node20",
      logLevel: "silent",
    }).code;

    // The runner shares the same llmFallback semantics as the in-process
    // executor: throwing RUNTIME_FALLBACK / GATE_FAIL fails the trace and
    // marks fallback_invoked. Output is one NDJSON record per holdout trace
    // so a partial-failure run still streams what completed.
    const runner = `\
function llmFallback(_input, _name) {
  throw new Error("RUNTIME_FALLBACK: llmFallback invoked at runtime — should escalate to Tier 3");
}
${transpiled.replace(/\bexport\s+(async\s+)?function\b/g, "$1function")}
const fn = ${args.function_name};
const fs = await import('node:fs/promises');
const traces = JSON.parse(await fs.readFile('/tmp/holdout.json', 'utf-8'));
for (const t of traces) {
  const t0 = performance.now();
  try {
    const out = await fn(t.input);
    process.stdout.write(JSON.stringify({ ok: true, output: out, latency_ms: performance.now() - t0 }) + "\\n");
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: String(err && err.message || err).slice(0, 200), latency_ms: performance.now() - t0 }) + "\\n");
  }
}
`;

    const enc = new TextEncoder();
    await sandbox.writeFile("/tmp/runner.mjs", enc.encode(runner));
    await sandbox.writeFile("/tmp/holdout.json", enc.encode(JSON.stringify(args.holdout)));

    const result = await sandbox.run("node", {
      args: ["/tmp/runner.mjs"],
      timeout: 120,
    });

    const outputs: unknown[] = [];
    const latency_ms: number[] = [];
    let fallback_invoked = false;
    for (const line of result.stdout.split("\n")) {
      const s = line.trim();
      if (!s) continue;
      let row: { ok: boolean; output?: unknown; error?: string; latency_ms: number };
      try {
        row = JSON.parse(s);
      } catch {
        // Defensive: skip non-JSON lines (e.g. accidental console.log inside
        // emitted code). The gate's output-count check will catch missing rows.
        continue;
      }
      if (row.ok) {
        outputs.push(row.output);
      } else {
        if (row.error?.includes("RUNTIME_FALLBACK") || row.error?.includes("GATE_FAIL")) {
          fallback_invoked = true;
        }
        outputs.push({ __error: row.error?.slice(0, 200) ?? "unknown" });
      }
      latency_ms.push(row.latency_ms);
    }

    if (outputs.length !== args.holdout.length) {
      throw new Error(
        `RealTensorlakeClient.runEmittedFunction: produced ${outputs.length} outputs for ${args.holdout.length} traces (exit=${result.exitCode}, stderr=${result.stderr.slice(0, 300)})`,
      );
    }

    return { outputs, latency_ms, fallback_invoked };
  }

  // ── Phi sandbox lifecycle ───────────────────────────────────────────────
  // Distinct from the gate sandbox: phi runs inside an image that has
  // ollama + phi3:mini baked in (built via `npm run build:phi-image`). Gate
  // doesn't need that footprint. Keeping them separate lets `warm()` boot
  // both in parallel without one stalling on the other.
  private phiSandbox: Sandbox | null = null;
  private phiWarming: Promise<void> | null = null;
  private phiServePid: number | null = null;

  private async getPhiSandbox(): Promise<Sandbox> {
    if (!this.opts.phiImage) {
      throw new Error(
        "RealTensorlakeClient.runPhi: phiImage not configured — set opts.phiImage to the registered Tensorlake image (e.g. 'compile-phi-mini' built via npm run build:phi-image)",
      );
    }
    if (this.phiSandbox) return this.phiSandbox;
    if (!this.phiWarming) {
      this.phiWarming = (async () => {
        const sb = await Sandbox.create({
          name: `${this.opts.name ?? "compile-runtime"}-phi-${Date.now()}`,
          image: this.opts.phiImage,
          cpus: this.opts.phiCpus ?? 2,
          memoryMb: this.opts.phiMemoryMb ?? 4096,
          timeoutSecs: this.opts.timeoutSecs ?? 1800,
          ...(this.opts.apiKey ? { apiKey: this.opts.apiKey } : {}),
          ...(this.opts.endpoint ? { apiUrl: this.opts.endpoint } : {}),
        });

        // Start ollama serve as a long-running process.
        const proc = await sb.startProcess("bash", {
          args: ["-lc", "ollama serve > /tmp/ollama.log 2>&1"],
        });
        this.phiServePid = proc.pid;

        // Wait up to 30s for the API to come online. We poll inside the
        // sandbox via curl rather than via createTunnel so this works even
        // when the runtime can't reach the sandbox's exposed port directly.
        const ready = await sb.run("bash", {
          args: [
            "-lc",
            "for i in $(seq 1 30); do " +
              "curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && exit 0; " +
              "sleep 1; " +
              "done; exit 1",
          ],
          timeout: 60,
        });
        if (ready.exitCode !== 0) {
          throw new Error(
            `RealTensorlakeClient: ollama serve never came up (stderr=${ready.stderr.slice(0, 300)})`,
          );
        }

        // Force-load the model into RAM with a tiny generate. This pays the
        // first-load cost (~3-8s for phi3:mini) here instead of on the
        // first runPhi call. Without this, demo's first Tier-2 call lands
        // with a 5s+ stall.
        const model = this.opts.phiModel ?? "phi3:mini";
        await sb.run("bash", {
          args: [
            "-lc",
            `curl -fsS -X POST http://127.0.0.1:11434/api/generate ` +
              `-H 'Content-Type: application/json' ` +
              `-d '${JSON.stringify({ model, prompt: "hi", stream: false }).replace(/'/g, "'\\''")}'`,
          ],
          timeout: 60,
        });

        this.phiSandbox = sb;
      })();
    }
    await this.phiWarming;
    if (!this.phiSandbox) throw new Error("RealTensorlakeClient: phi sandbox creation failed");
    return this.phiSandbox;
  }

  async runPhi(args: RunPhiArgs): Promise<RunPhiResult> {
    const sb = await this.getPhiSandbox();
    const t0 = performance.now();

    // Compose the final prompt: emitted-tier-2 "code" is the prompt template;
    // the input is the call-site payload. Ollama's /api/generate returns
    // `{ model, response, done, total_duration, ... }`. We ask for JSON-mode
    // output since the demo's call sites all return structured shapes.
    const composed = `${args.prompt}\n\nInput: ${JSON.stringify(args.input)}\n\nReturn ONLY a single JSON value.`;
    const body = JSON.stringify({
      model: this.opts.phiModel ?? "phi3:mini",
      prompt: composed,
      stream: false,
      format: "json",
      options: { temperature: 0 },
    });

    // Avoid argv length blowups: write the body to a tmp file and curl from it.
    const enc = new TextEncoder();
    const reqPath = `/tmp/phi-req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    await sb.writeFile(reqPath, enc.encode(body));
    const result = await sb.run("bash", {
      args: [
        "-lc",
        `curl -fsS -X POST http://127.0.0.1:11434/api/generate ` +
          `-H 'Content-Type: application/json' ` +
          `--data-binary @${reqPath}`,
      ],
      timeout: 60,
    });

    if (result.exitCode !== 0) {
      throw new Error(
        `RealTensorlakeClient.runPhi: ollama returned exit=${result.exitCode} stderr=${result.stderr.slice(0, 300)}`,
      );
    }

    let parsed: { response?: string };
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      throw new Error(`RealTensorlakeClient.runPhi: ollama response not JSON: ${result.stdout.slice(0, 200)}`);
    }
    let output: unknown = parsed.response ?? null;
    // Ollama in `format: "json"` mode wraps the model's JSON inside the
    // `response` string — try to deserialize it so the caller sees a real
    // object. If the model misbehaved we surface the raw string.
    if (typeof output === "string") {
      try {
        output = JSON.parse(output);
      } catch {
        /* keep raw string */
      }
    }
    return { output, latency_ms: performance.now() - t0 };
  }

  async warm(): Promise<void> {
    // Warm gate + phi in parallel so total cold-start isn't the sum of both.
    await Promise.all([
      this.getSandbox(),
      this.opts.phiImage ? this.getPhiSandbox() : Promise.resolve(),
    ]);
  }

  async close(): Promise<void> {
    const errors: unknown[] = [];
    if (this.sandbox) {
      try { await this.sandbox.terminate(); } catch (e) { errors.push(e); }
      this.sandbox = null;
      this.warming = null;
    }
    if (this.phiSandbox) {
      try { await this.phiSandbox.terminate(); } catch (e) { errors.push(e); }
      this.phiSandbox = null;
      this.phiWarming = null;
      this.phiServePid = null;
    }
    if (errors.length) throw errors[0];
  }
}

/**
 * The production primitive. Wraps a primary client (typically Real) and a
 * fallback (typically LocalFake). On any `Error` from the primary, falls
 * back; logs once per session so the operator knows which path served the
 * call.
 *
 * Maps directly to ENG_REVIEW.md failure mode #2 ("Tensorlake 64-worker grid
 * throttles or fails mid-run → replay pre-recorded run from disk"). The
 * "local fallback" here is the runtime-equivalent of the disk replay: the
 * gate / candidate path keeps producing outputs even if Tensorlake is dark.
 */
/** Methods on which the fallback can engage. */
export type TensorlakeFallbackMethod =
  | "runEmittedFunction"
  | "runPhi"
  | "warm";

/** Resolved-event surface — emitted AFTER the fallback path has either
 *  produced a result (`recovered=true`) or itself thrown (`recovered=false`).
 *  The daemon turns this into a `fallback_engaged` event for the UI. */
export interface TensorlakeFallbackResolution {
  method: TensorlakeFallbackMethod;
  /** Original error from the primary client. */
  error: unknown;
  /** True once the fallback produced a result; false if it also threw. */
  recovered: boolean;
  /** ISO timestamp when the primary failure was observed. */
  ts: string;
}

export class TensorlakeWithLocalFallback implements ITensorlakeClient {
  private fallbackEngaged = false;
  private fallbackCount = 0;
  private lastFallback: TensorlakeFallbackResolution | null = null;

  constructor(
    private readonly primary: ITensorlakeClient,
    private readonly fallback: ITensorlakeClient,
    /** Legacy hook — fires the moment the primary throws, before the
     *  fallback is attempted. Backward-compatible with pre-Lane-X callers. */
    private readonly onFallback: (
      method: TensorlakeFallbackMethod,
      err: unknown,
    ) => void = (m, e) => {
      console.error(`[tensorlake] primary failed in ${m}: ${(e as Error).message}; using local fallback`);
    },
    /** Resolved hook — fires AFTER the fallback completes (success or
     *  failure). The daemon uses this to emit a `fallback_engaged` event
     *  with `recovered=true|false` so the UI can flash the right banner. */
    private readonly onFallbackResolved?: (
      event: TensorlakeFallbackResolution,
    ) => void,
  ) {}

  isFallbackEngaged(): boolean {
    return this.fallbackEngaged;
  }

  /** Number of times the fallback path has engaged this session. */
  getFallbackCount(): number {
    return this.fallbackCount;
  }

  /** Most recent resolved fallback — useful when the daemon emits
   *  `fallback_engaged` daemon events. */
  getLastFallback(): TensorlakeFallbackResolution | null {
    return this.lastFallback;
  }

  private resolve(method: TensorlakeFallbackMethod, error: unknown, recovered: boolean): void {
    this.fallbackEngaged = true;
    this.fallbackCount++;
    this.lastFallback = {
      method,
      error,
      recovered,
      ts: new Date().toISOString(),
    };
    if (this.onFallbackResolved) {
      try {
        this.onFallbackResolved(this.lastFallback);
      } catch (cbErr) {
        // The hook is observability — never let it take the request down.
        console.error("[tensorlake] onFallbackResolved callback threw:", cbErr);
      }
    }
  }

  async runEmittedFunction(args: RunEmittedFunctionArgs): Promise<RunEmittedFunctionResult> {
    try {
      return await this.primary.runEmittedFunction(args);
    } catch (err) {
      this.onFallback("runEmittedFunction", err);
      try {
        const result = await this.fallback.runEmittedFunction(args);
        this.resolve("runEmittedFunction", err, true);
        return result;
      } catch (fallbackErr) {
        this.resolve("runEmittedFunction", err, false);
        throw fallbackErr;
      }
    }
  }

  async runPhi(args: RunPhiArgs): Promise<RunPhiResult> {
    try {
      return await this.primary.runPhi(args);
    } catch (err) {
      this.onFallback("runPhi", err);
      try {
        const result = await this.fallback.runPhi(args);
        this.resolve("runPhi", err, true);
        return result;
      } catch (fallbackErr) {
        this.resolve("runPhi", err, false);
        throw fallbackErr;
      }
    }
  }

  async warm(): Promise<void> {
    try {
      await this.primary.warm();
    } catch (err) {
      this.onFallback("warm", err);
      try {
        await this.fallback.warm();
        this.resolve("warm", err, true);
      } catch (fallbackErr) {
        this.resolve("warm", err, false);
        throw fallbackErr;
      }
    }
  }
}

/**
 * Back-compat shim. The previous name was StubTensorlakeClient and threw on
 * every method; we keep the symbol exported as an alias for one merge cycle
 * so anything still importing it surfaces a clear deprecation message.
 *
 * @deprecated Use LocalFakeTensorlakeClient (works) or RealTensorlakeClient
 * (production skeleton). Will be removed after Lane B2 lands.
 */
export class StubTensorlakeClient implements ITensorlakeClient {
  async runEmittedFunction(): Promise<RunEmittedFunctionResult> {
    throw new Error("StubTensorlakeClient is deprecated — use LocalFakeTensorlakeClient");
  }
  async runPhi(): Promise<RunPhiResult> {
    throw new Error("StubTensorlakeClient is deprecated — use LocalFakeTensorlakeClient");
  }
  async warm(): Promise<void> {
    /* no-op */
  }
}
