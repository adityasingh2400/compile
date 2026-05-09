import type {
  INiaClient,
} from "./index.js";
import type {
  VaultEntry,
  VaultLookupResult,
  PositiveVaultEntry,
  NegativeVaultEntry,
  CallSiteDescriptor,
  SyntheticInput,
} from "@compile/schemas";
import { generateSeeds, loadLocalCorpus } from "./seed-generator.js";

const DEFAULT_BASE = "https://apigcp.trynia.ai/v2";

/** Tag and content marker we use to stash structured cluster_signature ↔ entry JSON. */
const COMPILE_VAULT_TAG = "compile-vault-entry";

export interface RealNiaClientOptions {
  apiKey: string;
  /** Vault that holds Compile's codified functions for this customer. */
  vaultId: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Live Nia client. Maps Compile's INiaClient onto the v2 REST API:
 *
 *  - vaultLookup     → POST /vaults/{id}/search with cluster_signature as query.
 *                       Hit above VAULT_HIT_THRESHOLD ⇒ parse the page body's
 *                       `compile:vault-entry` JSON block. Below ⇒ "unknown".
 *  - vaultWrite      → POST /vaults/{id}/sources (a tiny inline doc per entry).
 *                       Stage-1 quick path — Nia's vault sync workflow turns
 *                       this into wiki pages.
 *  - semanticSearch  → POST /vaults/{id}/search (same primitive).
 *  - fetchDocs       → GET /sources/{id}/content for each id.
 */
export class RealNiaClient implements INiaClient {
  private readonly apiKey: string;
  private readonly vaultId: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: RealNiaClientOptions) {
    this.apiKey = opts.apiKey;
    this.vaultId = opts.vaultId;
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Nia ${init.method ?? "GET"} ${path} → ${res.status}: ${body.slice(0, 400)}`);
    }
    return (await res.json()) as T;
  }

  /**
   * Lookup is exact: list contexts tagged with the cluster_signature. We do
   * NOT use semantic-search here because vault routing requires identity, not
   * similarity — a near-match in embedding space is the wrong cluster.
   */
  async vaultLookup(cluster_signature: string): Promise<VaultLookupResult> {
    const tags = `${COMPILE_VAULT_TAG},${tagFor(cluster_signature)}`;
    const result = await this.request<{
      contexts?: Array<{ id: string; content?: string }>;
      items?: Array<{ id: string; content?: string }>;
    }>(`/contexts?${new URLSearchParams({ tags, limit: "5" })}`);
    const items = result.contexts ?? result.items ?? [];
    for (const item of items) {
      const parsed = extractVaultEntryJSON(item.content ?? "");
      if (parsed && parsed.cluster_signature === cluster_signature) {
        return parsed.kind === "positive"
          ? { state: "positive", entry: parsed as PositiveVaultEntry }
          : { state: "negative", entry: parsed as NegativeVaultEntry };
      }
    }
    return { state: "unknown" };
  }

  /**
   * Stored as a Nia "context" with memory_type=fact (permanent). One context
   * per VaultEntry. The cluster_signature is in the tags so vaultLookup can
   * filter by exact match.
   */
  async vaultWrite(entry: VaultEntry): Promise<{ vault_page_id: string }> {
    const body = renderVaultEntryDoc(entry);
    const created = await this.request<{ id: string }>(`/contexts`, {
      method: "POST",
      body: JSON.stringify({
        title: `compile vault entry: ${entry.cluster_signature}`.slice(0, 200),
        summary: `Compile ${entry.kind} vault entry for cluster ${entry.cluster_signature}`,
        content: body,
        tags: [COMPILE_VAULT_TAG, tagFor(entry.cluster_signature), entry.kind],
        agent_source: "compile",
        memory_type: "fact",
        metadata: { cluster_signature: entry.cluster_signature, kind: entry.kind },
      }),
    });
    return { vault_page_id: created.id };
  }

  /**
   * Vector search across saved contexts (cluster centroids). GET endpoint per
   * the OpenAPI spec.
   */
  async semanticSearch(args: {
    query: string;
    top_k?: number;
  }): Promise<Array<{ id: string; score: number; text: string }>> {
    const params = new URLSearchParams({
      q: args.query,
      limit: String(args.top_k ?? 10),
    });
    const result = await this.request<{
      contexts?: Array<{ id: string; score?: number; content?: string; summary?: string }>;
      items?: Array<{ id: string; score?: number; content?: string; summary?: string }>;
    }>(`/contexts/semantic-search?${params}`);
    const items = result.contexts ?? result.items ?? [];
    return items.map((h) => ({
      id: h.id,
      score: h.score ?? 0,
      text: h.content ?? h.summary ?? "",
    }));
  }

  async fetchDocs(
    doc_ids: string[],
  ): Promise<Array<{ nia_doc_id: string; title: string; excerpt: string }>> {
    const out: Array<{ nia_doc_id: string; title: string; excerpt: string }> = [];
    for (const id of doc_ids) {
      const doc = await this.request<{ display_name?: string; content?: string; text?: string }>(
        `/sources/${id}/content`,
      ).catch(() => undefined);
      if (!doc) continue;
      out.push({
        nia_doc_id: id,
        title: doc.display_name ?? id,
        excerpt: (doc.content ?? doc.text ?? "").slice(0, 600),
      });
    }
    return out;
  }

  /**
   * Stage-2 seed generation. Uses the deterministic template generator with
   * grounding from the local corpus by default — swappable to live Document
   * Agent via `documentAgentQuery` when budget allows. Returns the v7
   * SyntheticInput shape so synth-loader can drive it directly.
   */
  async generateSyntheticSeeds(args: {
    call_site: CallSiteDescriptor;
    seed_count: number;
    docs_corpus_path?: string;
  }): Promise<SyntheticInput[]> {
    const corpus = args.docs_corpus_path ? loadLocalCorpus(args.docs_corpus_path) : [];
    const seeds = generateSeeds(args.call_site, corpus, { count: args.seed_count });
    return seeds.map((s) => ({
      input_id: `${args.call_site.call_site_id}_seed_${s.index}`,
      call_site_id: s.call_site_id,
      origin: `seed_${s.index}`,
      payload: s.args,
    }));
  }

  /**
   * Document Agent — used by the synthetic input generator for Stage-2 seed
   * production. Costs 1 query per call on the free plan (50/mo budget), so
   * keep it gated behind explicit opt-in.
   */
  async documentAgentQuery(args: {
    source_ids: string[];
    query: string;
    json_schema?: Record<string, unknown>;
  }): Promise<{ answer: string; structured_output?: unknown }> {
    return this.request(`/document/agent`, {
      method: "POST",
      body: JSON.stringify({
        source_ids: args.source_ids,
        query: args.query,
        ...(args.json_schema ? { json_schema: args.json_schema } : {}),
      }),
    });
  }
}

/* ───── helpers ───────────────────────────────────────────────────────── */

function renderVaultEntryDoc(entry: VaultEntry): string {
  return [
    `# ${COMPILE_VAULT_TAG}`,
    "",
    `cluster_signature: ${entry.cluster_signature}`,
    `kind: ${entry.kind}`,
    "",
    "```json",
    JSON.stringify(entry, null, 2),
    "```",
  ].join("\n");
}

/** Tags only allow alnum + a few punctuation chars in most stores. */
function tagFor(cluster_signature: string): string {
  return `cs-${cluster_signature.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60)}`;
}

function extractVaultEntryJSON(text: string): VaultEntry | undefined {
  const fence = text.match(/```json\s*([\s\S]*?)```/);
  if (!fence) return undefined;
  try {
    return JSON.parse(fence[1]!) as VaultEntry;
  } catch {
    return undefined;
  }
}
