// Acme fixture call site #4 — should classify RED (dynamic_prompt).
// Prompt is built by string concatenation from runtime-pulled fragments.

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

export async function researchCompetitor(name: string, fetchedFacts: string[]) {
  let prompt = "Research the competitor named " + name + ".\n";
  for (const f of fetchedFacts) {
    prompt = prompt + "- " + f + "\n";
  }
  const resp = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 2048,
    messages: [
      { role: "user", content: "Context:\n" + prompt + "\nWrite a competitive brief." },
    ],
  });
  return resp.content[0].text;
}
