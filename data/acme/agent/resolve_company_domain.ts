// Acme fixture call site #5 — should classify GREEN.
// Bounded tools array, temperature 0, parameterized prompt, structured parse.

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { logger } from "./logger.js";

const anthropic = new Anthropic();

const domainSchema = z.object({ domain: z.string(), confidence: z.number() });

const tools = [
  { name: "lookup_dns", description: "Resolve DNS for a candidate domain", input_schema: { type: "object" } },
  { name: "search_crunchbase", description: "Search Crunchbase by company name", input_schema: { type: "object" } },
];

export async function resolveCompanyDomain(companyName: string) {
  logger.info({ companyName }, "resolve_company_domain");
  const resp = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 256,
    temperature: 0,
    tools,
    response_format: { type: "json_schema", json_schema: domainSchema },
    messages: [
      { role: "user", content: `Find the canonical domain for ${companyName}.` },
    ],
  });
  return domainSchema.parse(JSON.parse(resp.content[0].text));
}
