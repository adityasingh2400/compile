/**
 * Folk · customer-service router (PILLAR 3 · CUSTOMER SERVICE).
 *
 * The "every B2B SaaS does this" generalizer that broadens the demo
 * beyond Arlan's specific pain. Every inbound support ticket runs
 * through priority classification; the small fraction that need
 * deeper reasoning escalate to the frontier `resolve_complex_ticket`
 * call.
 */
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const oai = new OpenAI();
const anth = new Anthropic();

/* ─── GREEN · CODIFIABLE ────────────────────────────────────────── */

/**
 * #3 GREEN — every B2B SaaS has this exact workflow. Generalizes
 * Compile beyond just Arlan/Folk. Text in, 4-way priority enum out
 * with a 6-way reason axis.
 */
const TicketPrioritySchema = z.object({
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  reason: z.enum([
    "outage",
    "billing",
    "bug",
    "how_to",
    "feature_request",
    "churn_risk",
  ]),
  confidence: z.number(),
});
export async function classify_support_ticket_priority(args: {
  subject: string;
  body: string;
  customer_tier: "free" | "pro" | "enterprise";
  has_outage_keywords: boolean;
}) {
  const resp = await oai.chat.completions.create({
    model: "gpt-5",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Classify the priority of this support ticket. Return JSON {priority, reason, confidence}.",
      },
      { role: "user", content: JSON.stringify(args) },
    ],
  });
  return TicketPrioritySchema.parse(JSON.parse(resp.choices[0]!.message.content!));
}

/* ─── RED · FRONTIER residuals (audit explicitly REJECTS) ───────── */

/**
 * Open-ended reasoning · REJECT axis: free-form reasoning over
 * heterogeneous evidence (logs, runbooks, customer history). The 5%
 * of tickets that need a human-in-the-loop reasoning trace.
 */
export async function resolve_complex_support_ticket(args: {
  ticket_text: string;
  log_excerpts: string;
}) {
  const resp = await anth.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    messages: [
      {
        role: "user",
        content:
          "Recommend an escalation path and supporting evidence for this complex support ticket.\n" +
          JSON.stringify(args),
      },
    ],
  });
  return resp.content[0]?.type === "text" ? resp.content[0].text : "";
}

/**
 * Open-ended generative inference · REJECT axis: no bounded schema.
 * Used by the customer-success team to infer buying motion from
 * heterogeneous customer signals.
 */
export async function infer_company_context(args: {
  signals: string;
}) {
  const resp = await anth.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: "Infer the company's likely use case and buying motion.\n" + JSON.stringify(args),
      },
    ],
  });
  return resp.content[0]?.type === "text" ? resp.content[0].text : "";
}
