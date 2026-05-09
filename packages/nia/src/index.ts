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

  /** Vault write API - used live during demo and operation. */
  vaultWrite(entry: VaultEntry): Promise<{ vault_page_id: string }>;

  /** Replaces a custom embedding store; powers cluster centroids. */
  semanticSearch(args: {
    query: string;
    top_k?: number;
  }): Promise<Array<{ id: string; score: number; text: string }>>;

  /** Document Agent grounding - used inside synthesis specs. */
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

export { RealNiaClient } from "./real-client.js";
export { createNiaClient } from "./factory.js";
export {
  generateSeeds,
  generateSeedsViaDocumentAgent,
  loadLocalCorpus,
} from "./seed-generator.js";
export type { CorpusDoc, SeedInput, GenerateOptions } from "./seed-generator.js";

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
 * lives in. Hackathon-grade - covers the Acme demo functions.
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
    /* ── Folk demo ─────────────────────────────────────────────────── */
    case "classify_message_intent": {
      const samples = [
        "hey can you grab dinner tomorrow night?",
        "running late, sorry - be there in 20",
        "yo wassup",
        "did you see the slides?",
        "love you",
        "can someone fix the staging deploy?",
        "FREE iPhone - click here",
        "what time were we meeting again",
      ];
      return { text: samples[i % samples.length]! };
    }
    case "score_message_urgency": {
      const samples = [
        ["mom", "call me when you can"],
        ["alex", "URGENT - server down"],
        ["sarah", "wanna grab coffee sometime?"],
        ["boss", "need this by EOD"],
        ["friend", "happy birthday!!"],
      ];
      const s = samples[i % samples.length]!;
      return { text: s[1]!, sender: s[0]! };
    }
    case "extract_event_from_message": {
      const samples = [
        "let's do dinner Thursday at 7",
        "my flight lands at SFO at 11pm",
        "deadline for the proposal is Friday",
        "booked the restaurant for tomorrow at 8",
        "no plans this weekend, free if you're around",
      ];
      return { text: samples[i % samples.length]! };
    }
    case "apply_user_writing_style":
      return {
        draft: `Hello, I am unable to attend the meeting this afternoon. I cannot make it.`,
        style_excerpts: ["yo cant make it sorry", "running late lmk"],
      };
    case "draft_reply_in_user_voice":
      return {
        inbound: `wanna get dinner tonight?`,
        history: ["yeah totally", "next week works better"],
        persona: "Arlan - founder, busy, terse, lowercase",
        context: `recent contact, last reply 2h ago`,
      };
    case "score_relationship_warmth": {
      const ids = ["mom", "alex_co_founder", "sarah_friend", "client_acme", "old_school"];
      return {
        contact_id: ids[i % ids.length]!,
        recent_thread: [
          `${ids[i % ids.length]}: hey how's it going`,
          `me: good, busy`,
          `${ids[i % ids.length]}: same`,
        ],
        total_msgs_30d: 5 + ((i * 7) % 250),
      };
    }
    case "summarize_thread_for_memory":
      return {
        thread: [
          `customer: figured out the bug`,
          `me: nice, what was it`,
          `customer: race condition in the writer`,
          `me: classic, ship it`,
        ],
      };
    case "retrieve_relevant_memory":
      return {
        query: `last time I talked to alex about funding`,
        candidate_memories: [
          `2026-04: alex mentioned series A close`,
          `2026-03: alex flew to NYC for meetings`,
          `2026-02: alex shipped v2 launch`,
        ],
      };
    case "infer_relationship_context":
      return {
        contact_id: `alex_co_founder`,
        vault_excerpts: [
          `co-founder, met 2024, daily contact`,
          `last topic: hiring`,
          `tone: collaborative, direct`,
        ],
      };
    case "summarize_recent_messages":
      return {
        messages: [
          { from: `mom`, body: `call me when you have time` },
          { from: `alex`, body: `staging is deploying again` },
          { from: `sarah`, body: `dinner thursday?` },
        ],
      };
    default:
      return { payload: `seed_${i}` };
  }
}
