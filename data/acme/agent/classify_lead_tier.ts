// Acme fixture call site #1 — should classify GREEN.
// Bounded schema, temperature 0, parameterized prompt, structured parse.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { logger } from "./logger.js";

const anthropic = new Anthropic();

const leadTierSchema = z.object({
  tier: z.enum(["small", "mid", "large"]),
  confidence: z.number(),
  vertical: z.string(),
});

export async function classifyLeadTier(input: { company: string; size: number; revenue: number }) {
  logger.info({ company: input.company }, "classify_lead_tier");
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 256,
    temperature: 0,
    response_format: { type: "json_schema", json_schema: leadTierSchema },
    messages: [
      { role: "user", content: `Classify this company: ${input.company} (size ${input.size}, revenue ${input.revenue})` },
    ],
  });
  const parsed = leadTierSchema.parse(JSON.parse(response.content[0].text));
  return parsed;
}
