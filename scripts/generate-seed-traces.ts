/**
 * Generate seed proxy traces for the always-on demo (Folk-themed).
 *
 * Reads the 10 call sites from data/folk-agent/src/, fabricates realistic
 * inputs/outputs per site, spreads timestamps over the last 24h, writes
 * data/proxy-traces.jsonl + data/proxy-traces-summary.json.
 *
 * Daemon reads the JSONL on startup, buckets by call_site_hash, fires
 * compile when a bucket crosses threshold (50).
 *
 *   npx tsx scripts/generate-seed-traces.ts
 */

import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

type Trace = {
  ts: string;
  call_site_hash: string;
  model: string;
  provider: "openai" | "anthropic";
  system_prompt: string;
  system_prompt_hash: string;
  user_prompt: string;
  response: string;
  response_tokens: number;
  latency_ms: number;
  cost_usd: number;
};

type SiteSpec = {
  fn: string;
  count: number;
  provider: "openai" | "anthropic";
  model: string;
  system: string;
  inputs: string[];
  responder: (input: string) => string;
  baseLatency: number;
  tokenCost: number;
};

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/* ────────────────────────────────────────────────────────────────────
 * Folk-themed input fixtures.
 * Real-shaped messages an iMessage/Telegram/Discord agent would see.
 * ──────────────────────────────────────────────────────────────────── */

const INBOUND_MESSAGES = [
  "hey can you grab dinner tomorrow night?",
  "running late, sorry — be there in 20",
  "did you see the slides?",
  "love you",
  "can you review the PR by friday?",
  "yo what time was the call again",
  "FREE iPhone — click here to claim now",
  "wanna grab coffee this week?",
  "URGENT — staging is down",
  "happy birthday!! hope it's amazing",
  "did you book the flight already?",
  "I need to talk to you about something",
  "thinking about you, hope you're doing okay",
  "can we move our 3pm to 4pm?",
  "the contract should be signed by EOW",
  "miss you, when are you back?",
  "lol that meme was great",
  "just landed, gonna head straight to the office",
  "need this signed by tonight please",
  "yo",
  "hey, free this weekend?",
  "deadline for the proposal is friday",
  "booked the restaurant for thursday at 8",
  "running 5 mins late",
  "could you send me your address",
];

const URGENCY_MESSAGES = [
  "from: mom\ncall me when you can",
  "from: alex\nURGENT — server down, all hands",
  "from: sarah\nwanna grab coffee sometime soon?",
  "from: boss\nneed this by EOD please",
  "from: friend\nhappy birthday!!",
  "from: investor\ncan we sync this week?",
  "from: doctor\nappointment confirmation for tomorrow 10am",
  "from: school\npicture day is friday",
  "from: brother\nhey wassup nothing important just checking in",
  "from: client\nour prod is on fire RIGHT NOW",
  "from: tinder match\nso what do you do?",
  "from: gym friend\nyou going tonight?",
];

const EVENT_MESSAGES = [
  "let's do dinner Thursday at 7",
  "my flight lands at SFO at 11pm",
  "deadline for the proposal is Friday",
  "booked the restaurant for tomorrow at 8",
  "no plans this weekend, free if you're around",
  "demo with the team is monday 2pm",
  "JFK->SFO friday, back monday",
  "need to ship the v2 launch by tuesday",
  "anniversary dinner saturday — table for 2",
  "kid's recital is wednesday at 6",
  "doctor at 3pm thursday",
];

const STYLE_DRAFTS = [
  "Hello, I am unable to attend the meeting this afternoon.",
  "Thank you for the invitation. I would be delighted to attend.",
  "I cannot make it tonight, perhaps another evening.",
  "Please let me know when you are available next week.",
];

const DRAFT_INBOUNDS = [
  "wanna get dinner tonight?",
  "are you free this weekend",
  "did you see my last text?",
  "miss u",
];

const WARMTH_CONTACTS = [
  ["mom", 247],
  ["alex_co_founder", 189],
  ["sarah_friend", 87],
  ["client_acme", 32],
  ["old_school_friend", 11],
  ["dad", 142],
  ["partner", 412],
  ["investor_dan", 28],
  ["barber", 4],
];

const THREAD_FIXTURES = [
  ["alex: figured out the staging bug", "me: nice, what was it", "alex: race condition in the writer", "me: classic ship it"],
  ["mom: how was your day", "me: good, long", "mom: get some rest sweetie", "me: love you mom"],
  ["sarah: still on for thursday?", "me: yeah totally", "sarah: 8pm at the new place?", "me: see you then"],
  ["client: prod is on fire", "me: looking now", "client: what's the eta", "me: 10 min", "me: fixed"],
];

const RETRIEVE_QUERIES = [
  "last time I talked to alex about funding",
  "what did mom say about the family dinner",
  "what's sarah's restaurant preference again",
  "remind me what we agreed on the contract",
];

const INFER_CONTACTS = [
  "alex_co_founder",
  "sarah_friend",
  "client_acme",
  "old_school_friend",
  "mom",
];

const RECENT_FEEDS = [
  [
    { from: "mom", body: "call me when you have time" },
    { from: "alex", body: "staging is deploying again" },
    { from: "sarah", body: "dinner thursday?" },
    { from: "investor", body: "loved the deck" },
  ],
];

/* ────────────────────────────────────────────────────────────────────
 * Site list — 10 call sites mirroring data/folk-agent/src/.
 *
 * Counts chosen so:
 *   3 sites → WILL_COMPILE (>=50)  — show up as tier_1 workflow tabs
 *   2 sites → BELOW_THRESHOLD (>=20, <50) — tier_2 workflow tabs
 *   5 sites → FRONTIER_ZONE (<20) — show in audit, never compile
 * ──────────────────────────────────────────────────────────────────── */

const pick = <T>(arr: T[], i: number): T => arr[i % arr.length]!;
const jitter = (base: number, spread: number) => base + Math.floor(Math.random() * spread);

const SITES: SiteSpec[] = [
  {
    fn: "classify_message_intent",
    count: 78, // hottest path — every inbound msg fires this
    provider: "openai",
    model: "gpt-5",
    system:
      "Classify the user's intent in this inbound message. Return JSON {intent, requires_reply, confidence}.",
    inputs: INBOUND_MESSAGES,
    responder: (text) => {
      const isQ = /\?$|\bcan you\b|\bwhat\b|\bhow\b|\bwhen\b|\bwhere\b/i.test(text);
      const isLog = /\b(meeting|call|dinner|lunch|coffee|tomorrow|tonight|book|flight|deadline)\b/i.test(text);
      const isEmo = /\b(love|miss|sorry|hate|hurt|happy|excited|birthday|anniversary)\b/i.test(text);
      const isGreet = /^\s*(hey|hi|hello|yo|sup|wassup)\b/i.test(text) && text.length < 20;
      const isSpam = /\b(buy|sale|free|click|http|claim)\b/i.test(text);
      const intent = isSpam ? "spam" : isGreet ? "greeting" : isLog ? "logistics" : isEmo ? "emotional" : isQ ? "question" : "task";
      return JSON.stringify({
        intent,
        requires_reply: intent !== "spam" && intent !== "greeting",
        confidence: 0.91,
      });
    },
    baseLatency: 320,
    tokenCost: 0.0019,
  },
  {
    fn: "score_message_urgency",
    count: 62, // fires whenever requires_reply=true (most inbounds)
    provider: "openai",
    model: "gpt-5",
    system: "Score reply urgency for a personal message. Return JSON {urgency, reason, confidence}.",
    inputs: URGENCY_MESSAGES,
    responder: (text) => {
      const isImm = /\bURGENT\b|\bnow\b|\bfire\b|\basap\b/i.test(text);
      const isSoon = /\btonight\b|\btomorrow\b|\btoday\b|\bsoon\b|\bEOD\b/i.test(text);
      const isToday = /\bthis week\b|\bfriday\b|\bmonday\b|\bEOW\b/i.test(text);
      const isLater = /\bsometime\b|\bwhenever\b|\bchecking in\b/i.test(text);
      const urgency = isImm ? "immediate" : isSoon ? "soon" : isToday ? "today" : isLater ? "later" : "soon";
      return JSON.stringify({ urgency, reason: `lexical match`, confidence: 0.88 });
    },
    baseLatency: 280,
    tokenCost: 0.0017,
  },
  {
    fn: "score_relationship_warmth",
    count: 56, // fires per contact when generating a draft
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    system:
      "You score the warmth of a personal relationship. Return JSON {warmth (1-5), axes:{frequency, recency, intimacy}, confidence}.",
    inputs: WARMTH_CONTACTS.map(([id, n]) => `Contact ${id}, ${n} msgs in last 30d.`),
    responder: (q) => {
      const m = q.match(/(\d+)\s+msgs/);
      const n = m ? +m[1]! : 30;
      const w = n > 200 ? 5 : n > 80 ? 4 : n > 30 ? 3 : n > 8 ? 2 : 1;
      return JSON.stringify({
        warmth: w,
        axes: { frequency: Math.min(5, n / 40), recency: 4, intimacy: w >= 3 ? 4 : 2 },
        confidence: 0.84,
      });
    },
    baseLatency: 510,
    tokenCost: 0.0033,
  },
  {
    fn: "extract_event_from_message",
    count: 38, // fires on ~50% of inbounds (logistics/task class)
    provider: "openai",
    model: "gpt-5",
    system:
      "Extract any time-bound event from this message. Return JSON {event_type, when_iso, title, participants}.",
    inputs: EVENT_MESSAGES,
    responder: (text) => {
      const t = /\bflight\b|\bSFO\b|\bJFK\b|\bairport\b/i.test(text)
        ? "flight"
        : /\bmeeting\b|\bcall\b|\bsync\b|\bdemo\b/i.test(text)
          ? "meeting"
          : /\bdeadline\b|\bship\b|\bdue\b/i.test(text)
            ? "deadline"
            : /\bdinner\b|\brestaurant\b|\bbooked\b|\btable\b/i.test(text)
              ? "booking"
              : /\bship\b|\bpicture\b|\brecital\b|\bdoctor\b/i.test(text)
                ? "task"
                : "none";
      const w = text.match(/\b(tomorrow|tonight|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i)?.[1]?.toLowerCase() ?? null;
      return JSON.stringify({
        event_type: t,
        when_iso: w,
        title: t === "none" ? null : text.slice(0, 40),
        participants: [],
      });
    },
    baseLatency: 360,
    tokenCost: 0.0024,
  },
  {
    fn: "summarize_thread_for_memory",
    count: 26, // fires once per closed thread
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    system:
      "Summarize this thread for long-term memory. Return JSON {summary, topics, open_loops, sentiment}.",
    inputs: THREAD_FIXTURES.map((t) => t.join("\n---\n")),
    responder: (thread) => {
      const sent = /\b(love|happy|nice|sweetie)\b/i.test(thread)
        ? "positive"
        : /\b(fire|bug|down|hate)\b/i.test(thread)
          ? "negative"
          : "neutral";
      return JSON.stringify({
        summary: "Conversation across multiple turns covering one main topic.",
        topics: ["follow-up", "logistics"],
        open_loops: [],
        sentiment: sent,
      });
    },
    baseLatency: 720,
    tokenCost: 0.0049,
  },
  {
    fn: "apply_user_writing_style",
    count: 18, // yellow zone — fires when draft refinement triggers
    provider: "openai",
    model: "gpt-5",
    system: "Rewrite the candidate draft in the user's voice based on the style excerpts.",
    inputs: STYLE_DRAFTS,
    responder: (d) =>
      d
        .replace(/\bI am\b/g, "i'm")
        .replace(/\bcannot\b/g, "can't")
        .replace(/^([A-Z])/, (c) => c.toLowerCase()),
    baseLatency: 680,
    tokenCost: 0.0046,
  },
  {
    fn: "retrieve_relevant_memory",
    count: 12, // wide variance, frontier-only
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    system: "Pick the most relevant memory for the inbound query. Explain your choice.",
    inputs: RETRIEVE_QUERIES,
    responder: () =>
      "Best match: candidate 0 — most semantically aligned with the inbound query and most recent in time window.",
    baseLatency: 880,
    tokenCost: 0.0061,
  },
  {
    fn: "infer_relationship_context",
    count: 7, // frontier-only
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    system: "",
    inputs: INFER_CONTACTS.map((c) => `Infer the user's relationship context with ${c}.`),
    responder: () =>
      "Long-term close contact; recent thread suggests collaborative dynamic with ongoing planning around a future meet-up. Tone is relaxed, low-stakes.",
    baseLatency: 1080,
    tokenCost: 0.0078,
  },
  {
    fn: "summarize_recent_messages",
    count: 4, // frontier-only — morning summary cron
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    system: "",
    inputs: RECENT_FEEDS.map((f) => f.map((m) => `${m.from}: ${m.body}`).join("\n")),
    responder: () =>
      "Caught up with 4 senders this morning — mostly logistics (alex on staging, sarah on dinner) plus a check-in from mom. Nothing urgent, no replies overdue.",
    baseLatency: 1140,
    tokenCost: 0.0084,
  },
  {
    fn: "draft_reply_in_user_voice",
    count: 2, // pure creative — TRULY frontier-only, never compiled
    provider: "openai",
    model: "gpt-5",
    system: "",
    inputs: DRAFT_INBOUNDS.map((m) => `Draft a reply to: "${m}"`),
    responder: () => "yeah totally — thursday at 8 work for you?",
    baseLatency: 1320,
    tokenCost: 0.0094,
  },
];

function generate(): Trace[] {
  const traces: Trace[] = [];
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;

  for (const site of SITES) {
    const spHash = sha(site.system + ":" + site.fn);
    for (let i = 0; i < site.count; i++) {
      const userPrompt = pick(site.inputs, i + Math.floor(Math.random() * 7));
      const ts = new Date(dayAgo + Math.random() * (now - dayAgo)).toISOString();
      const response = site.responder(userPrompt);
      traces.push({
        ts,
        call_site_hash: `folk:${site.fn}:v1`,
        model: site.model,
        provider: site.provider,
        system_prompt: site.system,
        system_prompt_hash: spHash,
        user_prompt: userPrompt,
        response,
        response_tokens: Math.ceil(response.length / 4),
        latency_ms: jitter(site.baseLatency, 400),
        cost_usd: site.tokenCost,
      });
    }
  }

  return traces.sort((a, b) => a.ts.localeCompare(b.ts));
}

function main() {
  const traces = generate();
  const outPath = "data/proxy-traces.jsonl";
  const summaryPath = "data/proxy-traces-summary.json";

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, traces.map((t) => JSON.stringify(t)).join("\n") + "\n");

  const buckets: Record<string, number> = {};
  for (const t of traces) buckets[t.call_site_hash] = (buckets[t.call_site_hash] ?? 0) + 1;

  const summary = {
    generated_at: new Date().toISOString(),
    total_traces: traces.length,
    threshold: 50,
    buckets: Object.fromEntries(
      Object.entries(buckets)
        .sort(([, a], [, b]) => b - a)
        .map(([k, v]) => [
          k,
          { count: v, status: v >= 50 ? "WILL_COMPILE" : v >= 20 ? "BELOW_THRESHOLD" : "FRONTIER_ZONE" },
        ])
    ),
    spend_usd: +traces.reduce((s, t) => s + t.cost_usd, 0).toFixed(2),
    timespan_hours: 24,
  };

  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.log(`✓ wrote ${traces.length} traces to ${outPath}`);
  console.log(`✓ wrote summary to ${summaryPath}`);
  console.log(`\nbucket distribution:`);
  for (const [hash, info] of Object.entries(summary.buckets)) {
    const bar = "█".repeat(Math.round((info as { count: number }).count / 3));
    console.log(`  ${hash.padEnd(45)} ${String((info as { count: number }).count).padStart(3)}  ${bar}  ${(info as { status: string }).status}`);
  }
  console.log(`\ntotal seed spend: $${summary.spend_usd}`);
}

main();
