import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { scanRepo } from "../src/scan.js";

const ACME = resolve(__dirname, "../../../data/acme-agent");

describe("scanner — Acme repo", () => {
  it("finds all 10 LLM call sites", async () => {
    const r = await scanRepo(ACME);
    expect(r.files_scanned).toBeGreaterThanOrEqual(2);
    expect(r.call_sites).toHaveLength(10);
  });

  it("classifies pills per static priors", async () => {
    const r = await scanRepo(ACME);
    const pills = r.call_sites.reduce<Record<string, number>>(
      (acc, c) => ((acc[c.priors.pill] = (acc[c.priors.pill] ?? 0) + 1), acc),
      {},
    );
    // Acme split per the static-prior weights in DESIGN.md (Anthropic has no
    // response_format, so Zod-only Anthropic sites land in yellow):
    //   green:  response_format + zod + temp_0 (OpenAI) — classify_ticket_priority, match_product_sku
    //   yellow: zod-only Anthropic / partial — classify_lead_tier, extract_invoice_fields, classify_sentiment
    //   red:    no schema discipline — the rest
    expect(pills.green ?? 0).toBe(2);
    expect(pills.yellow ?? 0).toBe(3);
    expect(pills.red ?? 0).toBe(5);
  });

  it("the two GREEN sites are exactly classify_ticket_priority and match_product_sku", async () => {
    const r = await scanRepo(ACME);
    const greens = r.call_sites
      .filter((c) => c.priors.pill === "green")
      .map((c) => c.function_hint)
      .sort();
    expect(greens).toEqual(["classify_ticket_priority", "match_product_sku"]);
  });

  it("identifies provider for every site", async () => {
    const r = await scanRepo(ACME);
    const anthropic = r.call_sites.filter((c) => c.provider === "anthropic").length;
    const openai = r.call_sites.filter((c) => c.provider === "openai").length;
    expect(anthropic).toBe(5);
    expect(openai).toBe(5);
  });

  it("captures function names for declared functions", async () => {
    const r = await scanRepo(ACME);
    const names = new Set(r.call_sites.map((c) => c.function_hint).filter(Boolean));
    expect(names).toContain("classify_lead_tier");
    expect(names).toContain("extract_invoice_fields");
    expect(names).toContain("classify_ticket_priority");
    expect(names).toContain("draft_outreach_subject");
    expect(names).toContain("generate_marketing_copy");
  });

  it("produces a stable tree_signature", async () => {
    const a = await scanRepo(ACME);
    const b = await scanRepo(ACME);
    expect(a.tree_signature).toBe(b.tree_signature);
    expect(a.tree_signature).toMatch(/^[0-9a-f]{16}$/);
  });
});
