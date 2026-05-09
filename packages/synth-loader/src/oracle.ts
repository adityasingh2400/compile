import type { CallSiteDescriptor, SyntheticInput } from "@compile/schemas";

/**
 * The oracle runs ~1% of synthetic inputs through the customer's frontier LLM
 * to establish ground-truth output for the determinism + agreement axes.
 *
 * Hackathon stub: deterministic generators per Acme call site that emit the
 * shape the model would. Production swaps in a real Anthropic/OpenAI client
 * (paid by the customer's API key per D9 — Compile burns 0 frontier tokens).
 */
export interface IOracleClient {
  call(args: {
    call_site: CallSiteDescriptor;
    input: SyntheticInput;
  }): Promise<{ output: unknown; latency_ms: number; cost_usd: number }>;
}

const TONES = ["whimsical", "stoic", "punchy", "literary", "absurdist"];

export class StubOracleClient implements IOracleClient {
  async call(args: {
    call_site: CallSiteDescriptor;
    input: SyntheticInput;
  }): Promise<{ output: unknown; latency_ms: number; cost_usd: number }> {
    const t0 = performance.now();
    const output = stubFrontierOutput(args.call_site, args.input.payload);
    const latency_ms = performance.now() - t0;
    return { output, latency_ms, cost_usd: 0.05 };
  }
}

export function stubFrontierOutput(
  cs: CallSiteDescriptor,
  payload: unknown,
): unknown {
  const hint = cs.function_hint ?? "";
  const p = (payload ?? {}) as Record<string, unknown>;
  switch (hint) {
    case "classify_lead_tier": {
      const employees = (p.employees as number) ?? 0;
      const industry = String(p.industry ?? "");
      const fit = employees >= 50 && (industry === "fintech" || industry === "healthtech");
      const tier = fit ? (employees > 200 ? "A" : "B") : "C";
      return {
        fit,
        confidence: fit ? 0.92 : 0.4,
        tier,
        reasoning: `${industry} with ${employees} employees`,
      };
    }
    case "extract_invoice_fields": {
      const body = String(p.body ?? "");
      const num = body.match(/INV-\d+/)?.[0] ?? "INV-0000";
      const date = body.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? "1970-01-01";
      const total = parseFloat(body.match(/\$([\d,]+\.\d{2})/)?.[1]?.replace(/,/g, "") ?? "0");
      return { invoice_number: num, total_usd: total, date };
    }
    case "resolve_company_domain": {
      const name = String(p.name ?? "Unknown");
      const slug = name.toLowerCase().replace(/[^\w]/g, "").replace(/inc$/, "");
      return `${slug}.com`;
    }
    case "summarize_support_thread":
      return ((p.thread as string[]) ?? []).slice(0, 3).map((s) => `• ${s}`).join("\n");
    case "draft_outreach_subject":
      return `Quick question for ${p.name ?? "you"} re: ${p.signal ?? "growth"}`;
    case "classify_ticket_priority": {
      const text = String(p.text ?? "");
      const priority = /down|outage|P0/.test(text) ? "P0" : /P1|urgent/.test(text) ? "P1" : "P2";
      return {
        priority,
        category: /billing/.test(text) ? "billing" : /auth|login/.test(text) ? "auth" : "outage",
        confidence: 0.9,
      };
    }
    case "match_product_sku":
      return { sku: `SKU-${String(p.query ?? "x").length.toString().padStart(4, "0")}`, match_confidence: 0.85 };
    case "classify_sentiment":
      return { sentiment: /great|good|love/.test(String(p.text ?? "")) ? "pos" : "neu" };
    case "rewrite_email_formal":
      return `Dear team, ${String(p.draft ?? "").replace(/hey/i, "Hello").trim()}`;
    case "generate_marketing_copy": {
      const tone = String(p.tone ?? TONES[0]!);
      return `[${tone}] introducing ${p.product ?? "our product"} for ${p.audience ?? "you"}.`;
    }
    default:
      return { echo: payload };
  }
}
