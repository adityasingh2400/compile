import { createHash } from "node:crypto";
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
  apiKey: string;
  endpoint: string;
  /** Phi model name in Tensorlake's catalog (D1: "Phi-3-mini"). */
  phiModel?: string;
  /** Worker count for runEmittedFunction. Demo uses 64 (DESIGN.md). */
  workerCount?: number;
}

export class RealTensorlakeClient implements ITensorlakeClient {
  constructor(private readonly opts: RealTensorlakeOptions) {}

  async runEmittedFunction(_args: RunEmittedFunctionArgs): Promise<RunEmittedFunctionResult> {
    // TODO(B2): wire @tensorlake/sdk sandbox primitive. Until then, the
    // TensorlakeWithLocalFallback wrapper catches this and falls back to
    // the LocalFake. Tests assert the fallback fires.
    throw new Error("RealTensorlakeClient.runEmittedFunction: SDK not wired (TODO B2)");
  }

  async runPhi(_args: RunPhiArgs): Promise<RunPhiResult> {
    // TODO(B2): wire Phi-3-mini hosted sandbox via @tensorlake/sdk.
    throw new Error("RealTensorlakeClient.runPhi: SDK not wired (TODO B2)");
  }

  async warm(): Promise<void> {
    // TODO(B2): pre-warm the Phi sandbox + emitted-fn worker pool per D6.
    // For now, we resolve instantly so `npm run warm` doesn't crash when
    // the real client is configured but unwired.
    return;
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
export class TensorlakeWithLocalFallback implements ITensorlakeClient {
  private fallbackEngaged = false;
  constructor(
    private readonly primary: ITensorlakeClient,
    private readonly fallback: ITensorlakeClient,
    private readonly onFallback: (
      method: "runEmittedFunction" | "runPhi" | "warm",
      err: unknown,
    ) => void = (m, e) => {
      console.error(`[tensorlake] primary failed in ${m}: ${(e as Error).message}; using local fallback`);
    },
  ) {}

  isFallbackEngaged(): boolean {
    return this.fallbackEngaged;
  }

  async runEmittedFunction(args: RunEmittedFunctionArgs): Promise<RunEmittedFunctionResult> {
    try {
      return await this.primary.runEmittedFunction(args);
    } catch (err) {
      this.fallbackEngaged = true;
      this.onFallback("runEmittedFunction", err);
      return await this.fallback.runEmittedFunction(args);
    }
  }

  async runPhi(args: RunPhiArgs): Promise<RunPhiResult> {
    try {
      return await this.primary.runPhi(args);
    } catch (err) {
      this.fallbackEngaged = true;
      this.onFallback("runPhi", err);
      return await this.fallback.runPhi(args);
    }
  }

  async warm(): Promise<void> {
    try {
      await this.primary.warm();
    } catch (err) {
      this.fallbackEngaged = true;
      this.onFallback("warm", err);
      await this.fallback.warm();
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
