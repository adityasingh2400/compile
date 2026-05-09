# folk/agent

Demo customer for Compile — modeled on **Folk by Nozomio** (`getfolk.app`),
the personal AI agent that lives in your iMessage / Telegram / Discord and
drafts your replies in your own voice.

Two source files mirror Folk's two hot paths:

- **`src/messaging.ts`** — the inbound-message pipeline (OpenAI). Every text
  that lands in the user's iMessage triggers this whole file end-to-end.
- **`src/memory.ts`** — the memory + relationship-context layer (Anthropic).
  Reads from Nia Vault, summarizes threads back into long-term memory.

Ten LLM call sites total, spread across three flavors:

- **GREEN** — structured output, `temperature: 0`, templated prompts. Strong
  tier-1 candidates. (`classify_message_intent`, `score_message_urgency`)
- **YELLOW** — partial discipline; one or two signals missing. Tier-2 with
  Phi-3-mini fallback. (`extract_event_from_message`, `score_relationship_warmth`,
  `summarize_thread_for_memory`)
- **RED** — free-form generation, runtime-assembled prompts. Stays at frontier.
  (`apply_user_writing_style`, `draft_reply_in_user_voice`,
  `retrieve_relevant_memory`, `infer_relationship_context`,
  `summarize_recent_messages`)

This is what `compile.scan_repo("data/folk-agent")` walks during the demo.
The Folk corpus (ICP doc, pricing, persona) lives next to it; the Nia Document
Agent reads those for synthetic input generation.

## Why these particular call sites

A real-world Folk inbound flow looks like:

```
iMessage delivers a text
    ↓
[1] classify_message_intent       — should we reply at all?
    ↓
[2] score_message_urgency         — how fast?
    ↓
[3] retrieve_relevant_memory      — pull relationship context from Nia
    ↓
[4] score_relationship_warmth     — calibrate tone
    ↓
[5] extract_event_from_message    — flights, meetings, deadlines
    ↓
[6] apply_user_writing_style      — match the user's voice
    ↓
[7] draft_reply_in_user_voice     — the actual creative draft (Sonnet)
    ↓
notify the user / auto-send
```

Steps 1–6 are **codifiable** (deterministic shape, bounded outputs, repeatable
inputs). Step 7 is genuinely creative — frontier-only. Compile retires the
72% of token spend currently buying capability nobody uses for steps 1–6.

The cron-watcher path (`watches your flights`, `alerts for new listings`)
is a separate hot loop that fans out the same memory + extract sites against
scheduled tickers — even higher aggregate spend, identical codification story.
