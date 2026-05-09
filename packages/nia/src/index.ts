import type {
  VaultEntry,
  VaultLookupResult,
  PositiveVaultEntry,
  NegativeVaultEntry,
} from "@compile/schemas";

/**
 * Substrate of substrate. Eight Nia capabilities (DESIGN.md table) live
 * behind this interface. Lane D owns the real implementation; everyone else
 * imports the interface so swapping to a stub during the build is one line.
 */
export interface INiaClient {
  /** Three-state lookup keyed by cluster signature (semantic centroid). */
  vaultLookup(cluster_signature: string): Promise<VaultLookupResult>;

  /** Vault write API — used live during demo and operation. */
  vaultWrite(entry: VaultEntry): Promise<{ vault_page_id: string }>;

  /** Replaces a custom embedding store; powers cluster centroids. */
  semanticSearch(args: {
    query: string;
    top_k?: number;
  }): Promise<Array<{ id: string; score: number; text: string }>>;

  /** Document Agent grounding — used inside synthesis specs. */
  fetchDocs(doc_ids: string[]): Promise<
    Array<{ nia_doc_id: string; title: string; excerpt: string }>
  >;
}

export class StubNiaClient implements INiaClient {
  private readonly bySignature = new Map<
    string,
    PositiveVaultEntry | NegativeVaultEntry
  >();
  private readonly byFunctionId = new Map<string, PositiveVaultEntry>();

  async vaultLookup(key: string): Promise<VaultLookupResult> {
    // Two-index lookup: try cluster_signature first (routing path), then
    // function_id (run_codified path).
    const hit = this.bySignature.get(key) ?? this.byFunctionId.get(key);
    if (!hit) return { state: "unknown" };
    return hit.kind === "positive"
      ? { state: "positive", entry: hit }
      : { state: "negative", entry: hit };
  }

  async vaultWrite(entry: VaultEntry): Promise<{ vault_page_id: string }> {
    this.bySignature.set(entry.cluster_signature, entry);
    if (entry.kind === "positive") {
      this.byFunctionId.set(entry.function_id, entry);
    }
    return { vault_page_id: `stub:${entry.cluster_signature}` };
  }

  async semanticSearch(): Promise<
    Array<{ id: string; score: number; text: string }>
  > {
    return [];
  }

  async fetchDocs(): Promise<
    Array<{ nia_doc_id: string; title: string; excerpt: string }>
  > {
    return [];
  }
}
