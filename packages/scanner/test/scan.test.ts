import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { scanRepo } from "../src/scan.js";

const FOLK = resolve(__dirname, "../../../data/folk-agent");

describe("scanner — Folk repo", () => {
  it("finds all 10 LLM call sites", async () => {
    const r = await scanRepo(FOLK);
    expect(r.files_scanned).toBeGreaterThanOrEqual(2);
    expect(r.call_sites).toHaveLength(10);
  });

  it("classifies pills per static priors", async () => {
    const r = await scanRepo(FOLK);
    const pills = r.call_sites.reduce<Record<string, number>>(
      (acc, c) => ((acc[c.priors.pill] = (acc[c.priors.pill] ?? 0) + 1), acc),
      {},
    );
    // Folk split per the static-prior weights in DESIGN.md (Anthropic has no
    // response_format, so Zod-only Anthropic sites land in yellow):
    //   green:  response_format + zod + temp_0 (OpenAI) — classify_message_intent, score_message_urgency
    //   yellow: zod-only Anthropic / partial — score_relationship_warmth,
    //           summarize_thread_for_memory, extract_event_from_message (no temp_0)
    //   red:    no schema discipline — the rest
    expect(pills.green ?? 0).toBe(2);
    expect(pills.yellow ?? 0).toBe(3);
    expect(pills.red ?? 0).toBe(5);
  });

  it("the two GREEN sites are exactly classify_message_intent and score_message_urgency", async () => {
    const r = await scanRepo(FOLK);
    const greens = r.call_sites
      .filter((c) => c.priors.pill === "green")
      .map((c) => c.function_hint)
      .sort();
    expect(greens).toEqual(["classify_message_intent", "score_message_urgency"]);
  });

  it("identifies provider for every site", async () => {
    const r = await scanRepo(FOLK);
    const anthropic = r.call_sites.filter((c) => c.provider === "anthropic").length;
    const openai = r.call_sites.filter((c) => c.provider === "openai").length;
    expect(anthropic).toBe(5);
    expect(openai).toBe(5);
  });

  it("captures function names for declared functions", async () => {
    const r = await scanRepo(FOLK);
    const names = new Set(r.call_sites.map((c) => c.function_hint).filter(Boolean));
    expect(names).toContain("classify_message_intent");
    expect(names).toContain("score_message_urgency");
    expect(names).toContain("score_relationship_warmth");
    expect(names).toContain("draft_reply_in_user_voice");
    expect(names).toContain("summarize_recent_messages");
  });

  it("produces a stable tree_signature", async () => {
    const a = await scanRepo(FOLK);
    const b = await scanRepo(FOLK);
    expect(a.tree_signature).toBe(b.tree_signature);
    expect(a.tree_signature).toMatch(/^[0-9a-f]{16}$/);
  });
});
