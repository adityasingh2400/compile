/**
 * Folk - memory + relationship-context layer.
 * Five LLM call sites that talk to Nia Vault and shape long-term memory.
 *
 * The messaging pipeline asks this layer:
 *   "what should the agent know about this sender right now?"
 * The cron-watcher pipeline asks this layer:
 *   "did anything material change in the user's relationships overnight?"
 */
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

const client = new Anthropic();

/**
 * YELLOW - zod schema + temperature 0 + structured parse on Anthropic
 * (no `response_format` available on the Messages API, so this lands
 * yellow even though intent is fully bounded).
 *
 * Calibrates reply tone per contact: 1 (cold) -> 5 (close).
 */
const WarmthSchema = z.object({
  warmth: z.number(),
  axes: z.object({
    frequency: z.number(),
    recency: z.number(),
    intimacy: z.number(),
  }),
  confidence: z.number(),
});
export async function score_relationship_warmth(input: {
  contact_id: string;
  recent_thread: string[];
  total_msgs_30d: number;
}) {
  const resp = await client.messages.create({
    model: "claude-sonnet-4-6",
    temperature: 0,
    max_tokens: 200,
    system:
      "You score the warmth of a personal relationship based on the recent message history. Return JSON {warmth (1-5), axes:{frequency, recency, intimacy}, confidence}.",
    messages: [
      {
        role: "user",
        content: `Contact ${input.contact_id}, ${input.total_msgs_30d} msgs in last 30d. Recent:\n${input.recent_thread.join("\n")}`,
      },
    ],
  });
  return WarmthSchema.parse(JSON.parse((resp.content[0] as { text: string }).text));
}

/**
 * YELLOW - zod schema + temperature 0 + structured parse, no
 * response_format (Anthropic). Compresses a thread into long-term Vault
 * memory; runs once per closed thread.
 */
const ThreadMemorySchema = z.object({
  summary: z.string(),
  topics: z.array(z.string()),
  open_loops: z.array(z.string()),
  sentiment: z.enum(["positive", "neutral", "negative"]),
});
export async function summarize_thread_for_memory(thread: string[]) {
  const resp = await client.messages.create({
    model: "claude-sonnet-4-6",
    temperature: 0,
    max_tokens: 500,
    system:
      "Summarize this thread for long-term memory. Return JSON {summary, topics, open_loops, sentiment}.",
    messages: [{ role: "user", content: thread.join("\n---\n") }],
  });
  return ThreadMemorySchema.parse(JSON.parse((resp.content[0] as { text: string }).text));
}

/**
 * RED - free-form retrieval against Nia Vault. The LLM is used as a
 * re-ranker over candidate memories; output is a free-text rationale, no
 * schema, no parse. Wide variance, frontier-only.
 */
export async function retrieve_relevant_memory(query: string, candidate_memories: string[]) {
  const resp = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 800,
    system:
      "Pick the most relevant memory for the given inbound query. Explain your choice.",
    messages: [
      {
        role: "user",
        content: `Query: ${query}\n\nCandidates:\n${candidate_memories.map((m, i) => `${i}. ${m}`).join("\n")}`,
      },
    ],
  });
  return (resp.content[0] as { text: string }).text;
}

/**
 * RED - free-form, default temperature, prompt assembled by runtime
 * concatenation. Infers full relationship context (history, dynamics,
 * unfinished business) from the Vault page. Prose output, frontier-only.
 */
export async function infer_relationship_context(contact_id: string, vault_excerpts: string[]) {
  let prompt = "Infer the user's relationship context with " + contact_id + ".\n";
  for (const e of vault_excerpts) {
    prompt = prompt + "- " + e + "\n";
  }
  const resp = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });
  return (resp.content[0] as { text: string }).text;
}

/**
 * RED - runtime-concatenated prompt, free-form prose. Compresses the
 * user's last N messages across all threads into a single overview.
 * Used by the morning-summary cron.
 */
export async function summarize_recent_messages(messages: { from: string; body: string }[]) {
  let prompt = "Write a one-paragraph summary of these recent messages:\n";
  for (const m of messages) {
    prompt = prompt + m.from + ": " + m.body + "\n";
  }
  const resp = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  });
  return (resp.content[0] as { text: string }).text;
}
