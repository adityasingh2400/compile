/**
 * Generate seed proxy traces for the always-on demo.
 *
 * Three-pillar narrative — "Folk (Nozomio) is one platform doing
 * three things, and Compile finds the codifiable workflows across
 * all three":
 *
 *   META — Folk's iMessage/Telegram/Discord agent inbox.
 *     · classify_message_intent          (T1 GREEN)
 *     · extract_event_from_message       (T2 YELLOW)
 *     · extract_location_from_post       (RED — vision)
 *     · summarize_person_status          (RED — creative)
 *
 *   LINKEDIN — Arlan-style DM concierge. THE viral wedge: Arlan
 *     said on stage he gets 150 LinkedIn requests/day, 90% are
 *     unsolicited junk. Compile codifies the 90% into a lookup
 *     table; OpenClaw runs it deterministically; the LLM bill
 *     evaporates.
 *     · classify_inbound_dm_quality      (T1 GREEN)
 *     · pick_response_template           (T2 YELLOW)
 *     · draft_personal_response_to_dm    (RED — creative)
 *
 *   CUSTOMER SERVICE — generic B2B support routing. The "every
 *     SaaS company does this" generalizer that broadens the demo
 *     beyond Arlan.
 *     · classify_support_ticket_priority (T1 GREEN)
 *     · resolve_complex_support_ticket   (RED — creative)
 *     · infer_company_context            (RED — open-ended)
 *
 * The audit walks Folk's full repo (`data/folk-agent/src/*.ts`)
 * and surfaces all 10 sites; 5 land in the GREEN/YELLOW codifiable
 * tier, 5 stay RED with stated rejection reasons.
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
const pick = <T>(arr: T[], i: number): T => arr[i % arr.length]!;
const jitter = (base: number, spread: number) => base + Math.floor(Math.random() * spread);

/* ════════════════════════════════════════════════════════════════════
 * PILLAR 1 — META · Folk inbox (iMessage/Telegram/Discord agent)
 * ════════════════════════════════════════════════════════════════════ */

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
  "could you send me your address",
  "hi! is this still your number?",
  "you up?",
  "morning, how was your weekend",
];

const LIFE_EVENT_MESSAGES = [
  "btw I'm moving to NYC next month for the new role",
  "we got engaged 💍 saying yes was the easy part",
  "officially a dad — meet baby leo",
  "just closed our seed round, $4M from sequoia",
  "left bigco today, cofounding something with friends",
  "starting at OpenAI in march, can't wait",
  "married my best friend last weekend ❤️",
  "leaving sf, austin here we come",
  "promoted to staff engineer effective next quarter",
  "joining anthropic next month",
  "we raised our series A — 18M led by a16z",
  "just bought a house in austin 🏡",
  "our company just got acquired by stripe",
  "back from paternity leave starting monday",
  "my wife and I are expecting another one in june!",
  "morning coffee in the new kitchen",
  "morning runs are getting easier",
  "just hit 1k followers, thanks everyone",
  "this dog is my whole personality",
  "throwback to that lisbon trip last summer",
];

/* ════════════════════════════════════════════════════════════════════
 * PILLAR 2 — LINKEDIN · DM concierge (Arlan's pain on stage)
 *
 * 150 inbound DMs/day. 90%+ are templated AI slop, recruiter blasts,
 * VC outreach, or generic founder pitches. Folk's concierge runs every
 * inbound through this stack.
 * ════════════════════════════════════════════════════════════════════ */

// Real-shaped LinkedIn / email cold-outreach templates. The whole
// demo lives or dies on these reading as instantly recognizable.
const LINKEDIN_DMS = [
  "Hi Arlan! Hope you're doing well. I came across your work on AI agents and was incredibly impressed by your insights on agent architecture. Would love to connect and learn more about what you're building.",
  "Hey Arlan, big fan of OpenClaw! As someone deeply passionate about the future of agentic AI, I'd love the opportunity to connect.",
  "Hi Arlan, I'm a founder building [stealth] in the AI agents space — series A funded, ex-Google team. Would love 15 min to share what we're working on — think there's a strong fit.",
  "Hey Arlan! I'm building an open-source agent framework and would love your feedback. Free for a 30 min chat next week?",
  "Arlan — quick one. We just shipped v2 of our agent observability platform and I'd love your take. 20 min coffee?",
  "Hi Arlan, I'm a senior recruiter at Stripe and we have a Staff Engineer opportunity that I think would be a perfect match for your background. Can we schedule a quick call?",
  "Hello Arlan, I came across your profile and would love to connect — we have an exciting Principal Engineer role at a YC-backed company.",
  "Are you open to new opportunities? We're hiring Heads of AI for $400-600k base + equity.",
  "Looking to expand my network in the AI space — would love to connect!",
  "I'd love to be considered for any open roles at OpenClaw. My resume is attached.",
  "Arlan, [VC firm] here — we're investing in agentic AI and OpenClaw caught our attention. Are you raising or open to a chat?",
  "Hi Arlan, partner at [Tier-1 VC] — would love to chat about what you're building. Have time next week?",
  "Hey Arlan, leading agent investments at [fund]. Big fan, would love to swap notes.",
  "Hi Arlan, are you the founder of OpenClaw? I'd like to discuss a potential acquisition opportunity confidentially.",
  "Hey Arlan, quick question on the OpenClaw permissions model: how do you handle credential scoping across delegated tools?",
  "Hi Arlan! Loved your talk at AI Eng Summit. Genuinely curious — how are you thinking about agent memory persistence beyond the session?",
  "Arlan, I tried OpenClaw and it crashed when I tried to spawn 3 sandboxes in parallel. Wanted to flag.",
  "Got a weird issue where OpenClaw's WebSocket disconnects after ~90s. Any idea why?",
  "Hey, the docs say the budget cap is hard but I'm seeing it overflow by ~12%. Bug or by design?",
  "yo arlan saw your dunk on llamaindex 😂",
  "Big fan of your work btw, the llamaindex thread sent me",
  "Hey arlan! Met you at SXSW briefly — wanted to follow up on that agents conversation",
  "BUY VERIFIED LINKEDIN ACCOUNTS DM ME PRICES",
  "Make $5000/week working from home — see my profile",
  "Free crypto airdrop for verified profiles, click here ⬇️",
  "Hi Arlan, would you be open to advising us? Equity comp negotiable.",
  "We're Series B, building agent infra, think you'd love what we're doing — 30 min next week?",
  "Hi! Our open-source project would be a perfect fit for OpenClaw — would love to explore a partnership.",
];

// Pre-classified DM samples used as input to pick_response_template.
// The "ask" axis cross-products with quality to pick a canned response.
const DM_QUALITY_ASK_PAIRS = [
  "quality: ai_slop\nask: connection",
  "quality: ai_slop\nask: meeting",
  "quality: ai_slop\nask: feedback",
  "quality: generic_pitch\nask: meeting",
  "quality: generic_pitch\nask: partnership",
  "quality: generic_pitch\nask: advisor_role",
  "quality: recruiter_blast\nask: role",
  "quality: recruiter_blast\nask: connection",
  "quality: vc_outreach\nask: intro",
  "quality: vc_outreach\nask: acquisition",
  "quality: vc_outreach\nask: meeting",
  "quality: spam\nask: any",
  "quality: real_question\nask: technical_help",
  "quality: real_question\nask: feedback",
  "quality: friend\nask: greeting",
  "quality: friend\nask: meeting",
];

// Real Arlan-shaped personal replies for the FRONTIER residual —
// the ~10% of DMs he actually answers himself. These show the audit
// honestly admitting frontier still earns its keep here.
const REAL_DM_DRAFT_INPUTS = [
  "from: Karthik (real founder, agent infra)\ntheir msg: \"how do you handle credential scoping?\"",
  "from: Amir (CMU prof, did agents paper)\ntheir msg: \"would you be on a panel at CMU?\"",
  "from: Sasha (old colleague)\ntheir msg: \"in SF next week, drinks?\"",
];

/* ════════════════════════════════════════════════════════════════════
 * PILLAR 3 — CUSTOMER SERVICE · the universal generalizer
 *
 * Not Folk-specific. Demonstrates "every B2B SaaS has this exact
 * pattern" — generalizes Compile beyond just one demo customer.
 * ════════════════════════════════════════════════════════════════════ */

const SUPPORT_TICKETS = [
  "Our prod is down — every API call is returning 502. All my users affected, this is critical.",
  "URGENT: payment processing is failing in our checkout flow, losing $$ every minute",
  "site is completely down for me, can't log in at all, need help ASAP",
  "I was charged twice this month, please refund the duplicate",
  "Need a refund — we never used the service this billing cycle",
  "Invoice question: why am I being charged $200 on a Pro plan?",
  "How do I export my contacts to CSV?",
  "Where do I change my email address in the settings?",
  "How does the API rate limiting work?",
  "Could you add a dark mode? Pretty please 🥹",
  "Feature request: would love a Slack integration",
  "Idea — what if we could schedule messages to send later?",
  "I think there's a bug — when I click 'save' nothing happens",
  "The mobile app crashes when I open the inbox",
  "Search isn't returning results that I know exist in my account",
  "Hi, considering churning — your competitor just shipped a feature we need. Anything you can share?",
  "We're evaluating a switch — what's your roadmap on agent memory?",
  "Just wanted to say the new release is amazing, my whole team loves it 🚀",
  "The new dashboard is fantastic — much faster than before",
];

const COMPLEX_TICKETS = [
  "We're seeing intermittent 503s only on the EU region between 14:00-15:30 UTC, but only on accounts that were migrated last week. Our engineering team has correlated logs but can't repro locally. Need engineering deep-dive.",
  "Compliance team is blocking our renewal because the SOC2 type 2 report shows a finding around log retention that doesn't match what your DPA states. Need someone senior to walk our CISO through the discrepancy.",
];

const COMPANY_CONTEXT_INPUTS = [
  "Tell me about Acme Corp's likely use case based on their signals.",
  "Infer the buying motion at Stripe based on the support thread history.",
];

/* ════════════════════════════════════════════════════════════════════
 * SITE LIST — 10 sites, 5 codifiable + 5 frontier residuals.
 *
 * Volume targets:
 *   ≥50 traces  → WILL_COMPILE   (T1 green)
 *   ≥20 traces  → BELOW_THRESHOLD (T2 yellow)
 *   <20 traces  → FRONTIER_ZONE  (red — audit shows them but rejects)
 * ════════════════════════════════════════════════════════════════════ */

const SITES: SiteSpec[] = [
  /* ─── PILLAR 1 · META · Folk inbox ─────────────────────────────── */

  /**
   * #1 GREEN — every inbound message hits this. Pure text in, 6-way
   * enum out. The hottest call site in Folk's inbox path.
   */
  {
    fn: "classify_message_intent",
    count: 95,
    provider: "openai",
    model: "gpt-5",
    system:
      "Classify the user's intent in this inbound message. Return JSON {intent, requires_reply, confidence}.",
    inputs: INBOUND_MESSAGES,
    responder: (text) => {
      const isQ = /\?$|\bcan you\b|\bwhat\b|\bhow\b|\bwhen\b|\bwhere\b/i.test(text);
      const isLog = /\b(meeting|call|dinner|lunch|coffee|tomorrow|tonight|book|flight|deadline|sign|review|pr|move our)\b/i.test(text);
      const isEmo = /\b(love|miss|sorry|hate|hurt|happy|excited|birthday|anniversary|thinking)\b/i.test(text);
      const isGreet = /^\s*(hey|hi|hello|yo|sup|wassup|morning)\b/i.test(text) && text.length < 24;
      const isSpam = /\b(buy|sale|free|click|http|claim)\b/i.test(text);
      const intent = isSpam
        ? "spam"
        : isGreet
          ? "greeting"
          : isLog
            ? "logistics"
            : isEmo
              ? "emotional"
              : isQ
                ? "question"
                : "task";
      return JSON.stringify({
        intent,
        requires_reply: intent !== "spam" && intent !== "greeting",
        confidence: 0.91,
      });
    },
    baseLatency: 320,
    tokenCost: 0.0019,
  },

  /* ─── PILLAR 2 · LINKEDIN · DM concierge (THE ARLAN WORKFLOW) ──── */

  /**
   * #2 GREEN — runs on every inbound LinkedIn DM + cold-email reply.
   * Arlan's volume: ~150/day per power user. The "100k synthetic
   * DMs cluster into 5 templates" demo lives or dies here. Quality
   * is a 7-way enum — every cluster is a recognizable archetype.
   */
  {
    fn: "classify_inbound_dm_quality",
    count: 88,
    provider: "openai",
    model: "gpt-5",
    system:
      "Classify the quality of this inbound LinkedIn DM / cold email. Return JSON {quality, requires_human, confidence}.",
    inputs: LINKEDIN_DMS,
    responder: (text) => {
      const t = text.toLowerCase();
      const quality = /\b(buy|crypto|airdrop|verified accounts|make \$\d|free|click here)\b/.test(t)
        ? "spam"
        : /\bhope you're doing well\b|\bcame across your\b|\bincredibly impressed\b|\bdeeply passionate\b|\bbig fan of\b/.test(t)
          ? "ai_slop"
          : /\brecruiter\b|\bopen to new\b|\bopen roles\b|\bperfect match\b|\bhiring\b/.test(t)
            ? "recruiter_blast"
            : /\bvc\b|\binvest|\bpartner at\b|\braising\b|\bacquisition\b|\btier-1\b/.test(t)
              ? "vc_outreach"
              : /\bdunk\b|\bmet you\b|\bsxsw\b|\b😂\b|\bllamaindex thread\b|\byo arlan\b/.test(t)
                ? "friend"
                : /\bquestion\b|\bbug\b|\bcrash|\b502\b|\bdocs say\b|\bissue\b|\bhow do you\b|\bbudget cap\b/.test(t)
                  ? "real_question"
                  : "generic_pitch";
      return JSON.stringify({
        quality,
        requires_human: quality === "real_question" || quality === "friend",
        confidence: 0.92,
      });
    },
    baseLatency: 340,
    tokenCost: 0.0022,
  },

  /* ─── PILLAR 3 · CUSTOMER SERVICE · canonical generalizer ──────── */

  /**
   * #3 GREEN — every B2B SaaS has this exact workflow. Generalizes
   * Compile beyond just Arlan/Folk. Text in, 4-way priority enum out.
   */
  {
    fn: "classify_support_ticket_priority",
    count: 72,
    provider: "openai",
    model: "gpt-5",
    system:
      "Classify the priority of this support ticket. Return JSON {priority, reason, confidence}.",
    inputs: SUPPORT_TICKETS,
    responder: (text) => {
      const t = text.toLowerCase();
      const priority = /\b(urgent|prod is down|critical|losing \$|asap|every api call|completely down)\b/.test(t)
        ? "P0"
        : /\b(charged twice|refund|payment|invoice|billing)\b/.test(t)
          ? "P1"
          : /\b(bug|crash|isn'?t (working|returning)|nothing happens)\b/.test(t)
            ? "P2"
            : /\b(feature request|would love|idea|could you add|please add|🥹)\b/.test(t)
              ? "P3"
              : "P2";
      const reason =
        priority === "P0" ? "outage" : priority === "P1" ? "billing" : priority === "P2" ? "bug" : "feature_request";
      return JSON.stringify({ priority, reason, confidence: 0.94 });
    },
    baseLatency: 360,
    tokenCost: 0.0025,
  },

  /* ─── PILLAR 1 · META · life-event extractor (T2 yellow) ───────── */

  /**
   * #4 YELLOW — extracts life events from inbound messages. Bounded
   * 6-way enum but `when_iso` resolution introduces some fuzziness,
   * so it lands in the phi-3-mini fallback tier.
   */
  {
    fn: "extract_event_from_message",
    count: 38,
    provider: "openai",
    model: "gpt-5",
    system:
      "Extract any major life event from this inbound message. Return JSON {event_type, when_iso, confidence}.",
    inputs: LIFE_EVENT_MESSAGES,
    responder: (text) => {
      const t = text.toLowerCase();
      const event_type = /\bmoving\b|\bmoved\b|\brelocat|\bbought a house\b|\bback home\b|\bleaving sf\b/.test(t)
        ? "relocation"
        : /\bjoined\b|\bjoining\b|\bstarting at\b|\bnew role\b|\bpromoted\b|\bleft.*today\b|\bcofound/.test(t)
          ? "new_job"
          : /\braised\b|\bseed round\b|\bseries [a-z]\b|\bacquired\b/.test(t)
            ? "raised_funding"
            : /\bengaged\b|\bmarried\b|\bwedding\b|\bsaying yes\b/.test(t)
              ? "got_married"
              : /\bdad\b|\bbaby\b|\banother one\b|\bpaternity\b|\bkid\b/.test(t)
                ? "had_kid"
                : "none";
      return JSON.stringify({
        event_type,
        when_iso: event_type === "none" ? null : "2026-Q2",
        confidence: 0.89,
      });
    },
    baseLatency: 380,
    tokenCost: 0.0026,
  },

  /* ─── PILLAR 2 · LINKEDIN · response template picker (T2 yellow) ─ */

  /**
   * #5 YELLOW — THE Arlan resolution. (quality × ask) tuple → one
   * of 8 canned response templates. Pure lookup table. Folk is
   * paying frontier rates to evaluate `RESPONSES[quality][ask]`.
   *
   * The codified handler is literally a switch statement over the
   * 56-cell quality×ask matrix.
   */
  {
    fn: "pick_response_template",
    count: 28,
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    system:
      "Pick the right canned response template for this DM quality + ask combination. Return JSON {template, route, send_now}.",
    inputs: DM_QUALITY_ASK_PAIRS,
    responder: (text) => {
      const quality = text.match(/quality:\s*(\w+)/)?.[1] ?? "";
      const ask = text.match(/ask:\s*(\w+)/)?.[1] ?? "";
      const TEMPLATES: Record<string, { template: string; route: string; send_now: boolean }> = {
        ai_slop_connection: { template: "auto_dismiss", route: "archive", send_now: true },
        ai_slop_meeting: { template: "polite_decline_meeting", route: "auto_send", send_now: true },
        ai_slop_feedback: { template: "polite_decline_advisor", route: "auto_send", send_now: true },
        generic_pitch_meeting: { template: "redirect_to_email", route: "auto_send", send_now: true },
        generic_pitch_partnership: { template: "redirect_to_bd", route: "auto_send", send_now: true },
        generic_pitch_advisor_role: { template: "polite_decline_advisor", route: "auto_send", send_now: true },
        recruiter_blast_role: { template: "polite_decline_recruiter", route: "auto_send", send_now: true },
        recruiter_blast_connection: { template: "auto_dismiss", route: "archive", send_now: true },
        vc_outreach_intro: { template: "redirect_to_email", route: "auto_send", send_now: true },
        vc_outreach_acquisition: { template: "route_to_human", route: "human_queue", send_now: false },
        vc_outreach_meeting: { template: "redirect_to_email", route: "auto_send", send_now: true },
        spam_any: { template: "auto_dismiss", route: "report_spam", send_now: true },
        real_question_technical_help: { template: "route_to_human", route: "human_queue", send_now: false },
        real_question_feedback: { template: "route_to_human", route: "human_queue", send_now: false },
        friend_greeting: { template: "ack_friend", route: "auto_send", send_now: true },
        friend_meeting: { template: "route_to_human", route: "human_queue", send_now: false },
      };
      const key = `${quality}_${ask}`;
      const r = TEMPLATES[key] ?? { template: "route_to_human", route: "human_queue", send_now: false };
      return JSON.stringify(r);
    },
    baseLatency: 520,
    tokenCost: 0.0034,
  },

  /* ─── FRONTIER RESIDUALS · audit explicitly REJECTS these ──────── */

  /**
   * RED · Folk people-finder vision call. The audit chrome shows
   * this as rejected with reason: "vision input · synth can't fake
   * images". Stays frontier permanently. Surfaces in the audit so
   * judges see the honesty: Compile DOESN'T claim every LLM call.
   */
  {
    fn: "extract_location_from_post",
    count: 18,
    provider: "openai",
    model: "gpt-5",
    system:
      "Extract a location from this social-media post (caption + image + geotag). Return JSON {city, country, neighborhood, confidence}.",
    inputs: [
      "caption: \"vibing in tokyo 🇯🇵\" + image",
      "caption: \"back in NYC for the week\" + image",
      "caption: \"sunset at venice beach\" + image",
      "caption: \"writing this from a coffee shop in shibuya\" + image",
      "caption: \"first day at the new office\" + image",
    ],
    responder: () =>
      JSON.stringify({ city: "tokyo", country: "jp", neighborhood: "shibuya", confidence: 0.93 }),
    baseLatency: 1180,
    tokenCost: 0.0084,
  },

  /**
   * RED · creative summary. Final natural-language paragraph the
   * user reads in iMessage. Pure creative, frontier permanently.
   */
  {
    fn: "summarize_person_status",
    count: 12,
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    system: "",
    inputs: [
      "signals: location=tokyo, activity=conf-speaking, recency=3hrs",
      "signals: location=austin, activity=fundraising, recency=1d",
      "signals: location=nyc, activity=new-job, recency=2d",
    ],
    responder: () =>
      "Sarah's currently in Tokyo (last IG post 3 hours ago from a coffee shop in Shibuya). She was at SXSW in Austin yesterday — looks like she flew straight there. Still at OpenAI. No signal she's ghosting you.",
    baseLatency: 1240,
    tokenCost: 0.0091,
  },

  /**
   * RED · Arlan's personal replies — the ~10% of DMs that aren't
   * codifiable. Audit reason: "creative output · response is
   * personalized to the sender's actual question". Stays frontier.
   */
  {
    fn: "draft_personal_response_to_dm",
    count: 8,
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    system: "",
    inputs: REAL_DM_DRAFT_INPUTS,
    responder: () =>
      "Hey Karthik — we scope credentials per-tool with a capability token signed at sandbox spawn time. Happy to hop on a call next week if useful. CC'ing my asst.",
    baseLatency: 1320,
    tokenCost: 0.0094,
  },

  /**
   * RED · open-ended customer-service reasoning. The 5% of tickets
   * that need a human-in-the-loop reasoning trace. Audit reason:
   * "free-form reasoning over heterogeneous evidence". Frontier.
   */
  {
    fn: "resolve_complex_support_ticket",
    count: 6,
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    system: "",
    inputs: COMPLEX_TICKETS,
    responder: () =>
      "Recommendation: escalate to platform-eng pod, attach the EU-region shard logs from the 14:00-15:30 window, and have on-call walk through the migration runbook with the customer's CTO.",
    baseLatency: 1480,
    tokenCost: 0.011,
  },

  /**
   * RED · open-ended company-context inference. Audit reason:
   * "generative output · no bounded schema". Frontier.
   */
  {
    fn: "infer_company_context",
    count: 4,
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    system: "",
    inputs: COMPANY_CONTEXT_INPUTS,
    responder: () =>
      "Likely use case: enterprise-wide deployment of agent infrastructure, prioritizing audit trails and per-team budget controls. Buying motion suggests platform-team led with finance review.",
    baseLatency: 1620,
    tokenCost: 0.012,
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
