/**
 * Folk · iMessage / Telegram / Discord agent inbox (PILLAR 1 · META).
 *
 * The hot path. Every inbound text on every channel runs through
 * the intent classifier here. Compile finds two codifiable workflows
 * in this file and rejects two more (vision / creative).
 */
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const oai = new OpenAI();
const anth = new Anthropic();

/* ─── GREEN · CODIFIABLE ────────────────────────────────────────── */

/**
 * #1 GREEN — every inbound text fires this. Text in, 6-way enum out.
 * The hottest call site in Folk. Embarrassingly codifiable.
 */
const MessageIntentSchema = z.object({
  intent: z.enum(["question", "logistics", "emotional", "greeting", "spam", "task"]),
  requires_reply: z.boolean(),
  confidence: z.number(),
});
export async function classify_message_intent(args: {
  text: string;
  sender_id: string;
  channel: "imessage" | "telegram" | "discord" | "sms";
  thread_length: number;
}) {
  const resp = await oai.chat.completions.create({
    model: "gpt-5",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Classify the user's intent in this inbound message. Return JSON {intent, requires_reply, confidence}.",
      },
      { role: "user", content: JSON.stringify(args) },
    ],
  });
  return MessageIntentSchema.parse(JSON.parse(resp.choices[0]!.message.content!));
}

/**
 * #4 YELLOW — life-event extractor. 6-way enum (relocation, new_job,
 * raised_funding, got_married, had_kid, none) with a soft `when_iso`
 * axis that justifies the phi-3-mini fallback tier.
 */
const LifeEventSchema = z.object({
  event_type: z.enum([
    "relocation",
    "new_job",
    "raised_funding",
    "got_married",
    "had_kid",
    "none",
  ]),
  when_iso: z.string().nullable(),
  confidence: z.number(),
});
export async function extract_event_from_message(args: {
  text: string;
  user_timezone?: string;
  today_iso: string;
}) {
  const resp = await oai.chat.completions.create({
    model: "gpt-5",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Extract any major life event from this inbound message. Return JSON {event_type, when_iso, confidence}.",
      },
      { role: "user", content: JSON.stringify(args) },
    ],
  });
  return LifeEventSchema.parse(JSON.parse(resp.choices[0]!.message.content!));
}

/* ─── RED · FRONTIER residuals (audit explicitly REJECTS) ───────── */

/**
 * Vision call · REJECT axis: image input. Used by Folk's people-finder
 * feature — when the user asks "where is X" the agent fetches X's
 * Instagram and runs this on every image. Synthesizer cannot fake
 * image distribution, so Compile leaves this at frontier.
 */
export async function extract_location_from_post(args: {
  caption: string;
  image_bytes: string;
  geotag?: string;
}) {
  const resp = await oai.chat.completions.create({
    model: "gpt-5",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Extract a location from this social post (caption + image + geotag). Return JSON {city, country, neighborhood, confidence}.",
      },
      { role: "user", content: JSON.stringify(args) },
    ],
  });
  return JSON.parse(resp.choices[0]!.message.content!);
}

/**
 * Creative summary · REJECT axis: free-form NL output with no
 * template collapse. The actual paragraph the user reads in iMessage
 * when they ask "what's everyone up to". Stays frontier permanently.
 */
export async function summarize_person_status(args: {
  signals: string;
  user_relationship: string;
}) {
  const resp = await anth.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    messages: [
      {
        role: "user",
        content:
          "Summarize this person's status for the user.\n" + JSON.stringify(args),
      },
    ],
  });
  return resp.content[0]?.type === "text" ? resp.content[0].text : "";
}
