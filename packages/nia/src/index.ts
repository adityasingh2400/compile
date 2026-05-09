import type {
  VaultEntry,
  VaultLookupResult,
  PositiveVaultEntry,
  NegativeVaultEntry,
  CallSiteDescriptor,
  SyntheticInput,
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

  /**
   * v7 Stage 2: Document Agent generates seed inputs for a call site by
   * reading the customer's docs corpus. Real impl reads via Nia retrieval
   * + small frontier-LLM call; stub uses deterministic templates.
   */
  generateSyntheticSeeds(args: {
    call_site: CallSiteDescriptor;
    seed_count: number;
    docs_corpus_path?: string;
  }): Promise<SyntheticInput[]>;
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

  async generateSyntheticSeeds(args: {
    call_site: CallSiteDescriptor;
    seed_count: number;
  }): Promise<SyntheticInput[]> {
    // Deterministic stub: pick a generator from a small library keyed by the
    // function_hint. Real impl reads docs and prompts a frontier LLM for
    // diverse realistic seeds. This is enough to drive the architecture
    // end-to-end; fixture generators live in @compile/synth-loader.
    const out: SyntheticInput[] = [];
    for (let i = 0; i < args.seed_count; i++) {
      out.push({
        input_id: `${args.call_site.call_site_id}_seed_${i}`,
        call_site_id: args.call_site.call_site_id,
        origin: `seed_${i}`,
        payload: defaultSeedPayloadFor(args.call_site, i),
      });
    }
    return out;
  }
}

/**
 * Library of seed payload generators keyed by the function the call site
 * lives in. Hackathon-grade — covers the Acme demo functions.
 */
function defaultSeedPayloadFor(
  cs: CallSiteDescriptor,
  i: number,
): Record<string, unknown> {
  const hint = cs.function_hint ?? "";
  const industries = ["fintech", "healthtech", "retail", "media", "manufacturing", "saas"];
  const tones = ["whimsical", "stoic", "punchy", "literary", "absurdist"];
  switch (hint) {
    case "classify_lead_tier":
      return {
        domain: `acme${i}.example`,
        employees: 20 + ((i * 13) % 480),
        industry: industries[i % industries.length]!,
      };
    case "extract_invoice_fields": {
      const num = `INV-${1000 + i}`;
      const date = `2026-04-${String((i % 28) + 1).padStart(2, "0")}`;
      const total = (Math.round((10 + i * 17.13) * 100) / 100).toFixed(2);
      return { body: `Invoice ${num}\nDate: ${date}\nTotal: $${total}\nThank you.` };
    }
    case "resolve_company_domain":
      return { name: `Acme${i} Inc.` };
    case "summarize_support_thread":
      return {
        thread: [
          `customer: issue ${i}`,
          `agent: investigating ${i}`,
          `customer: resolved ${i}`,
        ],
      };
    case "draft_outreach_subject":
      return { name: `Acme${i}`, signal: `recent funding round ${i % 7}` };
    case "classify_ticket_priority":
      return { text: `system down for tenant ${i}, severity ${["P0","P1","P2","P3"][i%4]}` };
    case "match_product_sku":
      return { query: `widget ${i % 50} blue` };
    case "classify_sentiment":
      return { text: `customer feedback ${i} ${i % 3 === 0 ? "great" : "not great"}` };
    case "rewrite_email_formal":
      return { draft: `hey team, can we ship this ${i}? thx` };
    case "generate_marketing_copy":
      return {
        product: `Widget v${i % 5}`,
        audience: industries[i % industries.length]!,
        tone: tones[i % tones.length]!,
      };
    default:
      return { payload: `seed_${i}` };
  }
}
