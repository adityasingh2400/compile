import type { Receipt } from "@compile/schemas";

export interface IReceiptStore {
  put(r: Receipt): void;
  all(): Receipt[];
  byAgent(agent_id: string): Receipt[];
  size(): number;
  clear(): void;
}

export class MemoryReceiptStore implements IReceiptStore {
  private readonly receipts: Receipt[] = [];
  put(r: Receipt): void {
    this.receipts.push(r);
  }
  all(): Receipt[] {
    return [...this.receipts];
  }
  byAgent(agent_id: string): Receipt[] {
    return this.receipts.filter((r) => r.agent_id === agent_id);
  }
  size(): number {
    return this.receipts.length;
  }
  clear(): void {
    this.receipts.length = 0;
  }
}
