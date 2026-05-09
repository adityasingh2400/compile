import type { Trace } from "@compile/schemas";

/**
 * Thin wrapper over Tensorlake. ENG_REVIEW recommendation: every sponsor
 * integration sits behind an interface so we can swap to a stub mid-build
 * without changing call sites.
 */
export interface ITensorlakeClient {
  /** Run agent-emitted TS against held-out traces; used by the ≥98% gate. */
  runEmittedFunction(args: {
    code: string;
    holdout: Trace[];
  }): Promise<{ outputs: unknown[]; latency_ms: number[] }>;

  /** Tier-2 inference against the hosted Phi-3-mini sandbox. */
  runPhi(args: {
    prompt: string;
    input: unknown;
  }): Promise<{ output: unknown; latency_ms: number }>;

  /** Pre-warm before demo (D6). */
  warm(): Promise<void>;
}

export class StubTensorlakeClient implements ITensorlakeClient {
  async runEmittedFunction(): Promise<{ outputs: unknown[]; latency_ms: number[] }> {
    throw new Error("StubTensorlakeClient: not implemented");
  }
  async runPhi(): Promise<{ output: unknown; latency_ms: number }> {
    throw new Error("StubTensorlakeClient: not implemented");
  }
  async warm(): Promise<void> {
    /* no-op */
  }
}
