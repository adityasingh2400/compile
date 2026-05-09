/**
 * Folk · LinkedIn DM concierge (PILLAR 2 · LINKEDIN).
 *
 * The Arlan workflow. From his stage talk:
 *
 *   "I get 150 LinkedIn requests a day across LinkedIn and email,
 *    and like 90% of them are completely shit."
 *
 * Folk's concierge runs every inbound DM through this two-stage
 * stack. Compile finds that ~91% of those DMs cluster into 4 quality
 * archetypes and each archetype maps to one of 5 canned responses,
 * meaning the LLM is being paid frontier rates to evaluate a switch
 * statement.
 *
 * The escape hatch — `draft_personal_response_to_dm` — is the ~9%
 * of DMs Arlan actually replies to himself. The audit explicitly
 * leaves this at frontier because the response must be personalized
 * to the sender's actual question.
 */
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const oai = new OpenAI();
const anth = new Anthropic();

/* ─── GREEN · CODIFIABLE ────────────────────────────────────────── */

/**
 * #2 GREEN — every inbound LinkedIn DM + cold email reply fires
 * this. 7-way quality enum. The "100k synthetic DMs cluster into
 * 5 templates" demo lives or dies here.
 */
const DMQualitySchema = z.object({
  quality: z.enum([
    "spam",
    "ai_slop",
    "generic_pitch",
    "recruiter_blast",
    "vc_outreach",
    "real_question",
    "real_intro",
    "friend",
  ]),
  requires_human: z.boolean(),
  confidence: z.number(),
});
export async function classify_inbound_dm_quality(args: {
  text: string;
  sender_profile_summary: string;
  is_first_contact: boolean;
}) {
  const resp = await oai.chat.completions.create({
    model: "gpt-5",
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          "Classify the quality of this inbound LinkedIn DM / cold email. Return JSON {quality, requires_human, confidence}.",
      },
      { role: "user", content: JSON.stringify(args) },
    ],
  });
  return DMQualitySchema.parse(JSON.parse(resp.choices[0]!.message.content!));
}

/**
 * #5 YELLOW — THE Arlan resolution. (quality × ask) tuple → one of
 * 8 canned response templates. Pure lookup table that Folk's been
 * paying frontier rates for. Compile finds that 91% of inbound
 * traffic resolves via a 13-cell switch statement.
 *
 * Every response is auto-sendable except {acquisition, real_question,
 * friend+meeting}, which route to Arlan's human queue.
 */
const ResponseTemplateSchema = z.object({
  template: z.enum([
    "auto_dismiss",
    "polite_decline_meeting",
    "polite_decline_recruiter",
    "polite_decline_advisor",
    "redirect_to_email",
    "redirect_to_bd",
    "route_to_human",
    "ack_friend",
  ]),
  route: z.enum(["archive", "auto_send", "human_queue", "report_spam"]),
  send_now: z.boolean(),
});
export async function pick_response_template(args: {
  quality: z.infer<typeof DMQualitySchema>["quality"];
  ask:
    | "connection"
    | "meeting"
    | "feedback"
    | "advisor_role"
    | "partnership"
    | "role"
    | "intro"
    | "acquisition"
    | "technical_help"
    | "greeting"
    | "any";
  user_tier: "free" | "pro" | "enterprise";
}) {
  const resp = await anth.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content:
          "Pick the right canned response template for this DM quality + ask combination. Return JSON {template, route, send_now}.\n" +
          JSON.stringify(args),
      },
    ],
  });
  const txt = resp.content[0]?.type === "text" ? resp.content[0].text : "{}";
  return ResponseTemplateSchema.parse(JSON.parse(txt));
}

/* ─── RED · FRONTIER residual (audit explicitly REJECTS) ────────── */

/**
 * Creative reply · REJECT axis: response must be personalized to the
 * sender's actual question. The ~9% of DMs Arlan answers himself —
 * real founders asking real questions, old colleagues, panel invites.
 * Stays frontier permanently. Folk's audit is honest about this.
 */
export async function draft_personal_response_to_dm(args: {
  inbound_dm: string;
  thread_history: string;
}) {
  const resp = await anth.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 400,
    messages: [
      {
        role: "user",
        content:
          "Draft a personal reply in Arlan's voice to this DM.\n" + JSON.stringify(args),
      },
    ],
  });
  return resp.content[0]?.type === "text" ? resp.content[0].text : "";
}
