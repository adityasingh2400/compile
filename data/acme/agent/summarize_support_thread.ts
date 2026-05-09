// Acme fixture call site #3 — should classify YELLOW.
// Free-form summarization: parameterized prompt but no response_format, no tools.

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

export async function summarizeSupportThread(threadId: string, messages: { author: string; body: string }[]) {
  const transcript = messages.map((m) => `${m.author}: ${m.body}`).join("\n");
  const resp = await anthropic.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 1024,
    temperature: 0,
    messages: [
      { role: "user", content: `Summarize this support thread for ticket ${threadId}:\n${transcript}` },
    ],
  });
  return resp.content[0].text;
}
