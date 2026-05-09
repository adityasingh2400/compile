/**
 * Acme — sales lead qualification.
 * Five LLM call sites; expected priors mostly green.
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const client = new Anthropic();

/**
 * GREEN — structured Zod schema, temperature 0, fully templated prompt.
 * Classic codify candidate.
 */
const LeadTierSchema = z.object({
  fit: z.boolean(),
  confidence: z.number(),
  tier: z.enum(["A", "B", "C"]),
  reasoning: z.string(),
});
export async function classify_lead_tier(input: {
  domain: string;
  employees: number;
  industry: string;
}) {
  const resp = await client.messages.create({
    model: "claude-sonnet-4-6",
    temperature: 0,
    max_tokens: 200,
    system: "You are a sales analyst classifying lead tier (A/B/C).",
    messages: [
      {
        role: "user",
        content: `Classify ${input.domain} (${input.employees}-person ${input.industry}). Return JSON.`,
      },
    ],
  });
  return LeadTierSchema.parse(JSON.parse((resp.content[0] as { text: string }).text));
}

/**
 * GREEN — bounded enum output, structured parse, temperature 0.
 */
const InvoiceFieldsSchema = z.object({
  invoice_number: z.string(),
  total_usd: z.number(),
  date: z.string(),
});
export async function extract_invoice_fields(body: string) {
  const resp = await client.messages.create({
    model: "claude-sonnet-4-6",
    temperature: 0,
    max_tokens: 300,
    system: "Extract invoice_number, total_usd (number), and date (YYYY-MM-DD).",
    messages: [{ role: "user", content: body }],
  });
  return InvoiceFieldsSchema.parse(JSON.parse((resp.content[0] as { text: string }).text));
}

/**
 * GREEN — bounded tools, structured parse.
 */
export async function resolve_company_domain(name: string) {
  const resp = await client.messages.create({
    model: "claude-sonnet-4-6",
    temperature: 0,
    max_tokens: 100,
    system: "Resolve a company name to its primary domain. Return only the domain.",
    messages: [{ role: "user", content: name }],
  });
  return (resp.content[0] as { text: string }).text.trim();
}

/**
 * YELLOW — has structured prompt but no schema, default temperature.
 */
export async function summarize_support_thread(thread: string[]) {
  const resp = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 500,
    system: "Summarize this support thread in 3 bullets.",
    messages: [{ role: "user", content: thread.join("\n---\n") }],
  });
  return (resp.content[0] as { text: string }).text;
}

/**
 * RED — free-form generation, no schema, default temperature, prompt
 * concatenated at runtime.
 */
export async function draft_outreach_subject(name: string, signal: string) {
  const resp = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 80,
    messages: [
      {
        role: "user",
        content: "Write a punchy outreach subject for " + name + " given signal: " + signal,
      },
    ],
  });
  return (resp.content[0] as { text: string }).text;
}
