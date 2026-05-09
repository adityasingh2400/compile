import type { SynthesisSpec, Trace } from "@compile/schemas";

export interface PendingRequest {
  request_id: string;
  cluster_id: string;
  /** template-skeleton hash used as Vault key — the same key find_function derives at routing time. */
  cluster_signature: string;
  spec: SynthesisSpec;
  /** Indices into the FULL trace list — kept private from the agent. */
  holdout_traces: Trace[];
  created_at: number;
}

export interface IRequestStore {
  put(req: PendingRequest): void;
  get(request_id: string): PendingRequest | undefined;
  delete(request_id: string): void;
  size(): number;
}

export class MemoryRequestStore implements IRequestStore {
  private readonly map = new Map<string, PendingRequest>();
  put(req: PendingRequest): void {
    this.map.set(req.request_id, req);
  }
  get(request_id: string): PendingRequest | undefined {
    return this.map.get(request_id);
  }
  delete(request_id: string): void {
    this.map.delete(request_id);
  }
  size(): number {
    return this.map.size;
  }
}
