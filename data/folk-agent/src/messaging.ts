/**
 * Folk — inbound-message pipeline.
 * Five LLM call sites; the hot path that fires on every iMessage.
 *
 * Pattern lifted from Hermes Agent (Nous) + Folk's own dispatcher:
 *   1. classify intent  →  decide if reply needed at all
 *   2. score urgency    →  decide how fast (immediate / soon / today / later)
 *   3. extract event    →  pull flights, meetings, deadlines for cron watchers
 *   4. apply user voice →  rewrite candidate draft in user style
 *   5. draft reply      →  the actual creative generation (frontier-only)
 */
import OpenAI from "openai";
import { z } from "zod";

const client = new OpenAI();

/**
 * GREEN — bounded enum + response_format + zod + temperature 0 + parse.
 * Runs on EVERY inbound message. Hottest call site in Folk.
 */
const MessageIntentSchema = z.object({
  intent: z.enum(["question", "logistics", "emotional", "greeting", "spam", "task"]),
  requires_reply: z.boolean(),
  confidence: z.number(),
});
export async function classify_message_intent(text: string) {
  const resp = await client.chat.completions.create({
    model: "gpt-5",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "Classify the user's intent in this inbound message. Return JSON {intent, requires_reply, confidence}.",
      },
      { role: "user", content: text },
    ],
  });
  return MessageIntentSchema.parse(JSON.parse(resp.choices[0]!.message.content!));
}

/**
 * GREEN — bounded ordinal output, response_format + zod + temperature 0 + parse.
 * Decides whether Folk drafts now, batches, or punts to overnight summary.
 */
const UrgencySchema = z.object({
  urgency: z.enum(["immediate", "soon", "today", "later", "never"]),
  reason: z.string(),
  confidence: z.number(),
});
export async function score_message_urgency(text: string, sender: string) {
  const resp = await client.chat.completions.create({
    model: "gpt-5",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "Score reply urgency for a personal message. Return JSON {urgency, reason, confidence}.",
      },
      { role: "user", content: `From: ${sender}\n${text}` },
    ],
  });
  return UrgencySchema.parse(JSON.parse(resp.choices[0]!.message.content!));
}

/**
 * YELLOW — has zod schema + response_format + structured parse, but no
 * temperature 0 (defaults to 1). Pulls calendar-relevant events out of
 * inbound messages and feeds them to the cron-watcher pipeline.
 */
const EventSchema = z.object({
  event_type: z.enum(["meeting", "flight", "deadline", "booking", "task", "none"]),
  when_iso: z.string().nullable(),
  title: z.string().nullable(),
  participants: z.array(z.string()),
});
export async function extract_event_from_message(text: string) {
  const resp = await client.chat.completions.create({
    model: "gpt-5",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "Extract any time-bound event from this message. Return JSON {event_type, when_iso, title, participants}.",
      },
      { role: "user", content: text },
    ],
  });
  return EventSchema.parse(JSON.parse(resp.choices[0]!.message.content!));
}

/**
 * RED — temperature 0 but free-form output, no schema, no structured parse.
 * Stylistic rewrite of a candidate draft to match the user's voice.
 */
export async function apply_user_writing_style(draft: string, style_excerpts: string[]) {
  const resp = await client.chat.completions.create({
    model: "gpt-5",
    temperature: 0,
    messages: [
      {
        role: "system",
        content: "Rewrite the candidate draft in the user's voice based on the style excerpts.",
      },
      { role: "user", content: draft + "\n---STYLE---\n" + style_excerpts.join("\n") },
    ],
  });
  return resp.choices[0]!.message.content;
}

/**
 * RED — pure creative generation, default temperature, prompt assembled
 * from runtime fragments via string concatenation. THE call site Folk
 * pays the most for; stays at frontier permanently.
 */
export async function draft_reply_in_user_voice(
  inbound: string,
  history: string[],
  persona: string,
  context: string,
) {
  let prompt = "You are drafting a text reply in the user's voice.\n";
  prompt = prompt + "Persona: " + persona + "\n";
  prompt = prompt + "Context: " + context + "\n";
  prompt = prompt + "Recent history:\n";
  for (const h of history) {
    prompt = prompt + "- " + h + "\n";
  }
  prompt = prompt + "---\nInbound message: " + inbound + "\n---\nDraft a reply:";
  const resp = await client.chat.completions.create({
    model: "gpt-5",
    messages: [{ role: "user", content: prompt }],
  });
  return resp.choices[0]!.message.content;
}
