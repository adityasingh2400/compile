/**
 * Acme — operational ops calls. Five more LLM call sites.
 */
import OpenAI from "openai";
import { z } from "zod";

const client = new OpenAI();

/**
 * GREEN — uses response_format with JSON schema, temperature 0.
 */
const TicketPrioritySchema = z.object({
  priority: z.enum(["P0", "P1", "P2", "P3"]),
  category: z.enum(["billing", "auth", "outage", "feature_request", "other"]),
  confidence: z.number(),
});
export async function classify_ticket_priority(text: string) {
  const resp = await client.chat.completions.create({
    model: "gpt-5",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Classify ticket priority and category. Return JSON." },
      { role: "user", content: text },
    ],
  });
  return TicketPrioritySchema.parse(JSON.parse(resp.choices[0]!.message.content!));
}

/**
 * GREEN — schema, low temperature, templated prompt.
 */
const SkuMatchSchema = z.object({
  sku: z.string(),
  match_confidence: z.number(),
});
export async function match_product_sku(query: string) {
  const resp = await client.chat.completions.create({
    model: "gpt-5",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Match the query to a SKU from our catalog. Return JSON." },
      { role: "user", content: query },
    ],
  });
  return SkuMatchSchema.parse(JSON.parse(resp.choices[0]!.message.content!));
}

/**
 * YELLOW — has schema but temperature is unset (defaults to 1).
 */
const SentimentSchema = z.object({ sentiment: z.enum(["pos", "neg", "neu"]) });
export async function classify_sentiment(text: string) {
  const resp = await client.chat.completions.create({
    model: "gpt-5",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Classify sentiment. Return JSON." },
      { role: "user", content: text },
    ],
  });
  return SentimentSchema.parse(JSON.parse(resp.choices[0]!.message.content!));
}

/**
 * YELLOW — temperature 0 but free-form output.
 */
export async function rewrite_email_formal(draft: string) {
  const resp = await client.chat.completions.create({
    model: "gpt-5",
    temperature: 0,
    messages: [
      { role: "system", content: "Rewrite in formal business English." },
      { role: "user", content: draft },
    ],
  });
  return resp.choices[0]!.message.content;
}

/**
 * RED — free-form, default temp, prompt assembled from runtime variables.
 */
export async function generate_marketing_copy(product: string, audience: string, tone: string) {
  const resp = await client.chat.completions.create({
    model: "gpt-5",
    messages: [
      {
        role: "user",
        content: `Write ${tone} marketing copy for ${product} targeting ${audience}.`,
      },
    ],
  });
  return resp.choices[0]!.message.content;
}
