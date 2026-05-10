/**
 * Synthetic call samples per workflow.
 *
 * Each sample is one micro-input the codifier would feed into a
 * synthetic run, expressed as a short human-readable phrase. The
 * audit page floats these around the workflow centroid so judges
 * can immediately see what kind of inputs each workflow actually
 * handles in production — instead of staring at unlabeled dots.
 *
 * Samples are tagged with a `cluster` slug so the visual grouping
 * matches the eventual sub-pattern clusters discovered post-synthesis.
 *
 * Lookup is keyword-based on the workflow's `function_name` so the
 * mapping survives renames in the underlying derivation, and falls
 * back to a generic set if no keyword matches.
 */

/**
 * Author metadata shown in the node hover + click detail. Optional —
 * inferred from the label when not authored.
 */
export interface SampleAuthor {
  name: string;
  handle?: string;
  /** Two-letter avatar initials (auto-derived from name if absent). */
  initials?: string;
  /** Hue used for the avatar disc (`maroon` / `coral` / `orange` / etc.). */
  hue?: "maroon" | "coral" | "orange" | "ink";
}

/**
 * Field row rendered in the node-detail overlay. Each row is a small
 * mono `key` paired with a value (string or short JSON).
 */
export interface SampleFieldRow {
  key: string;
  value: string;
  /** When true, render the value in a slightly larger mono block
   *  (used for the raw caption / message body). */
  block?: boolean;
}

/**
 * Full interaction detail for one synthetic call. Hand-authored where
 * the demo benefits, otherwise auto-filled from the deriver.
 */
export interface SampleDetail {
  /** Who the post / message / contact came from. */
  author?: SampleAuthor;
  /** Human readable when ("2h ago", "yesterday"). */
  posted_at?: string;
  /** Provider context shown subtly ("instagram", "imessage"). */
  source?: string;
  /** Ordered list of input rows passed to the LLM. */
  input: SampleFieldRow[];
  /** Ordered list of output rows the LLM (or codified handler) returned. */
  output: SampleFieldRow[];
  /** Match path: how Compile served this call in production. */
  match_type?:
    | "deterministic vault hit"
    | "fuzzy vault hit"
    | "tier-2 phi-3-mini"
    | "frontier fallback";
  /** Confidence on the codified handler's output (0..1). */
  confidence?: number;
  /** Frontier model originally serving this call. */
  frontier_model?: string;
  frontier_latency_ms?: number;
  frontier_cost_usd?: number;
  /** Vault path served via Compile. */
  vault_latency_ms?: number;
  vault_cost_usd?: number;
}

export interface SyntheticSample {
  /** Short imperative phrase displayed next to the node. */
  label: string;
  /** Sub-cluster slug — drives node hue + grouping. */
  cluster: string;
  /** Rich interaction detail. Optional — `inferSampleDetail` fills
   *  in plausible values when this is omitted. */
  detail?: SampleDetail;
}

interface SamplePack {
  /** Cluster slug → human label. */
  clusters: { slug: string; label: string; description?: string }[];
  samples: SyntheticSample[];
}

const PACKS: { match: (fn: string) => boolean; pack: SamplePack }[] = [
  // ═════════════════════════════════════════════════════════════════
  // nia-bench · judge_no_hallucination
  // 29/40 tasks · pure pattern match against task.common_hallucinations
  // ═════════════════════════════════════════════════════════════════
  {
    match: (fn) => /judge.*no.*hallucination|no.*hallucination/i.test(fn),
    pack: {
      clusters: [
        { slug: "next_legacy", label: "next.js 13–15 patterns" },
        { slug: "trpc_legacy", label: "trpc v10 patterns" },
        { slug: "react_legacy", label: "react 17/18 patterns" },
        { slug: "zod_legacy", label: "zod v3 chained patterns" },
        { slug: "ai_legacy", label: "ai sdk v5 patterns" },
        { slug: "clean_pass", label: "idiomatic v_new · pass" },
      ],
      samples: [
        { label: "export function middleware(req)", cluster: "next_legacy" },
        { label: "// middleware.ts file", cluster: "next_legacy" },
        { label: "runtime: 'edge' in proxy", cluster: "next_legacy" },
        { label: "createTRPCProxyClient<T>", cluster: "trpc_legacy" },
        { label: "transformer at link level", cluster: "trpc_legacy" },
        { label: "import from @trpc/react-query", cluster: "trpc_legacy" },
        { label: "React.forwardRef wrapper", cluster: "react_legacy" },
        { label: "useFormState (renamed)", cluster: "react_legacy" },
        { label: "z.string().email() chained", cluster: "zod_legacy" },
        { label: "z.string().uuid()", cluster: "zod_legacy" },
        { label: "z.uuidv4() (does not exist)", cluster: "zod_legacy" },
        { label: "z.string().ip()", cluster: "zod_legacy" },
        { label: "generateObject({ schema })", cluster: "ai_legacy" },
        { label: "experimental_output param", cluster: "ai_legacy" },
        { label: "destructure { object }", cluster: "ai_legacy" },
        { label: "proxy.ts with proxy()", cluster: "clean_pass" },
        { label: "ref as a regular prop", cluster: "clean_pass" },
        { label: "z.email() top-level", cluster: "clean_pass" },
        { label: "Output.object({schema})", cluster: "clean_pass" },
      ],
    },
  },

  // ═════════════════════════════════════════════════════════════════
  // nia-bench · judge_correct_replacements
  // 8 audit tasks · v_old → v_new migration check
  // ═════════════════════════════════════════════════════════════════
  {
    match: (fn) => /correct.*replacements|replacements.*correct/i.test(fn),
    pack: {
      clusters: [
        { slug: "trpc_v11", label: "trpc v10 → v11" },
        { slug: "next_16", label: "next.js 13 → 16" },
        { slug: "ai_v6", label: "ai sdk v5 → v6" },
        { slug: "react_19", label: "react 18 → 19" },
        { slug: "zod_v4", label: "zod v3 → v4" },
      ],
      samples: [
        { label: "createTRPCProxyClient → createTRPCClient", cluster: "trpc_v11" },
        { label: "wsLink → httpSubscriptionLink", cluster: "trpc_v11" },
        { label: "transformer to root config", cluster: "trpc_v11" },
        { label: "middleware.ts → proxy.ts", cluster: "next_16" },
        { label: "sync params → await params", cluster: "next_16" },
        { label: "remove runtime: 'edge'", cluster: "next_16" },
        { label: "generateObject → generateText + Output", cluster: "ai_v6" },
        { label: "{ object } → { output } destructure", cluster: "ai_v6" },
        { label: "DataStream → UIMessageStream", cluster: "ai_v6" },
        { label: "forwardRef → ref as prop", cluster: "react_19" },
        { label: "useFormState → useActionState", cluster: "react_19" },
        { label: ".email() → z.email()", cluster: "zod_v4" },
        { label: ".uuid() → z.uuid()", cluster: "zod_v4" },
      ],
    },
  },

  // ═════════════════════════════════════════════════════════════════
  // nia-bench · judge_correct_import (pure ts-morph AST scan)
  // ═════════════════════════════════════════════════════════════════
  {
    match: (fn) => /correct.*import|import.*correct|import.*path/i.test(fn),
    pack: {
      clusters: [
        { slug: "trpc_path_correct", label: "@trpc/client · pass" },
        { slug: "trpc_path_wrong", label: "@trpc/react-query · fail" },
        { slug: "react_dom_client_correct", label: "react-dom/client · pass" },
        { slug: "react_dom_client_wrong", label: "react-dom (legacy) · fail" },
        { slug: "ai_output_present", label: "Output imported · pass" },
        { slug: "ai_output_missing", label: "Output missing · fail" },
        { slug: "renamed_hook_correct", label: "useActionState · pass" },
        { slug: "renamed_hook_wrong", label: "useFormState · fail" },
      ],
      samples: [
        { label: "import { createTRPCClient } from '@trpc/client'", cluster: "trpc_path_correct" },
        { label: "import { httpSubscriptionLink } from '@trpc/client'", cluster: "trpc_path_correct" },
        { label: "import { createTRPCClient } from '@trpc/react-query'", cluster: "trpc_path_wrong" },
        { label: "import { createRoot } from 'react-dom/client'", cluster: "react_dom_client_correct" },
        { label: "import ReactDOM from 'react-dom'", cluster: "react_dom_client_wrong" },
        { label: "import { generateText, Output } from 'ai'", cluster: "ai_output_present" },
        { label: "import { ToolLoopAgent } from 'ai'", cluster: "ai_output_present" },
        { label: "import { generateText } from 'ai' // missing Output", cluster: "ai_output_missing" },
        { label: "import { Experimental_Agent } from 'ai'", cluster: "ai_output_missing" },
        { label: "import { useActionState } from 'react'", cluster: "renamed_hook_correct" },
        { label: "import { useFormState } from 'react'", cluster: "renamed_hook_wrong" },
      ],
    },
  },

  // ═════════════════════════════════════════════════════════════════
  // nia-bench · judge_correct_api_usage (T2 yellow)
  // ═════════════════════════════════════════════════════════════════
  {
    match: (fn) => /correct.*api.*usage|api.*usage|usage.*correct/i.test(fn),
    pack: {
      clusters: [
        { slug: "next_response", label: "NextResponse.redirect" },
        { slug: "next_matcher", label: "config.matcher" },
        { slug: "next_cookies_await", label: "cookies() awaited" },
        { slug: "trpc_subscription", label: "httpSubscriptionLink" },
        { slug: "trpc_async_gen", label: "async function* yield" },
      ],
      samples: [
        { label: "NextResponse.redirect(new URL(...))", cluster: "next_response" },
        { label: "NextResponse.next()", cluster: "next_response" },
        { label: "config = { matcher: ['/dashboard/...'] }", cluster: "next_matcher" },
        { label: "await cookies()", cluster: "next_cookies_await" },
        { label: "req.cookies.get('session')?.value", cluster: "next_cookies_await" },
        { label: "links: [httpSubscriptionLink({ url })]", cluster: "trpc_subscription" },
        { label: "async function* messages(input) { yield m }", cluster: "trpc_async_gen" },
      ],
    },
  },

  // ═════════════════════════════════════════════════════════════════
  // nia-bench · judge_correct_alternatives (T2 yellow audit tasks)
  // ═════════════════════════════════════════════════════════════════
  {
    match: (fn) => /correct.*alternatives|alternatives.*correct|audit.*alternatives/i.test(fn),
    pack: {
      clusters: [
        { slug: "react_17_audit", label: "react 17 audit" },
        { slug: "next_13_audit", label: "next.js 13 audit" },
        { slug: "ai_v5_audit", label: "ai sdk v5 audit" },
      ],
      samples: [
        { label: "forwardRef → React.forwardRef alternatives", cluster: "react_17_audit" },
        { label: "ReactDOM.render → ReactDOM alternatives", cluster: "react_17_audit" },
        { label: "defaultProps → propTypes alternatives", cluster: "react_17_audit" },
        { label: "sync params → await params alternatives", cluster: "next_13_audit" },
        { label: "middleware.ts → proxy.ts alternatives", cluster: "next_13_audit" },
        { label: "edge runtime → node runtime alternatives", cluster: "next_13_audit" },
        { label: "generateObject → generateText alternatives", cluster: "ai_v5_audit" },
        { label: "DataStream → UIMessageStream alternatives", cluster: "ai_v5_audit" },
      ],
    },
  },

  // ═════════════════════════════════════════════════════════════════
  // PILLAR 2 · LINKEDIN · DM concierge — THE ARLAN WORKFLOW
  //
  // 100k synthetic LinkedIn DMs collapse into 7 quality buckets.
  // Each bucket is instantly recognizable as "yeah, that's exactly
  // the garbage I get every day."
  // ═════════════════════════════════════════════════════════════════
  {
    match: (fn) => /classify.*inbound.*dm|inbound.*dm.*quality|dm.*quality/i.test(fn),
    pack: {
      clusters: [
        { slug: "ai_slop", label: "ai-slop · auto-dismiss" },
        { slug: "generic_pitch", label: "generic founder pitch" },
        { slug: "recruiter_blast", label: "recruiter blast" },
        { slug: "vc_outreach", label: "vc outreach" },
        { slug: "spam", label: "spam · drop" },
        { slug: "real_question", label: "real question · → human" },
        { slug: "friend", label: "friend · → human" },
      ],
      samples: [
        { label: "\"Hi Arlan, hope you're doing well…\"", cluster: "ai_slop" },
        { label: "\"came across your work, incredibly impressed\"", cluster: "ai_slop" },
        { label: "\"deeply passionate about agentic AI\"", cluster: "ai_slop" },
        { label: "\"big fan of OpenClaw, would love to connect\"", cluster: "ai_slop" },
        { label: "\"series A founder, 15 min next week?\"", cluster: "generic_pitch" },
        { label: "\"we just shipped v2, would love your take\"", cluster: "generic_pitch" },
        { label: "\"perfect partnership opportunity, 30 min?\"", cluster: "generic_pitch" },
        { label: "\"recruiter at Stripe, Staff Eng role\"", cluster: "recruiter_blast" },
        { label: "\"are you open to new opportunities?\"", cluster: "recruiter_blast" },
        { label: "\"$400-600k base + equity, interested?\"", cluster: "recruiter_blast" },
        { label: "\"Tier-1 VC, are you raising?\"", cluster: "vc_outreach" },
        { label: "\"investing in agents, swap notes?\"", cluster: "vc_outreach" },
        { label: "\"acquisition opportunity confidentially\"", cluster: "vc_outreach" },
        { label: "\"BUY VERIFIED LINKEDIN ACCOUNTS\"", cluster: "spam" },
        { label: "\"FREE crypto airdrop ⬇️\"", cluster: "spam" },
        { label: "\"how do you scope credentials per-tool?\"", cluster: "real_question" },
        { label: "\"OpenClaw crashed when spawning 3 sandboxes\"", cluster: "real_question" },
        { label: "\"budget cap overflows by ~12%, bug?\"", cluster: "real_question" },
        { label: "\"yo arlan, the llamaindex dunk 😂\"", cluster: "friend" },
        { label: "\"met you at SXSW, follow up?\"", cluster: "friend" },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // pick_response_template — (quality × ask) → canned response
  // The "Folk is paying frontier rates to evaluate a switch
  // statement" punchline. 8 response templates total.
  {
    match: (fn) => /pick.*response.*template|response.*template|template.*pick/i.test(fn),
    pack: {
      clusters: [
        { slug: "auto_dismiss", label: "auto_dismiss · archive · no reply" },
        { slug: "polite_decline_meeting", label: "decline_meeting · auto-send" },
        { slug: "polite_decline_recruiter", label: "decline_recruiter · auto-send" },
        { slug: "polite_decline_advisor", label: "decline_advisor · auto-send" },
        { slug: "redirect_to_email", label: "redirect_to_email · auto-send" },
        { slug: "route_to_human", label: "route_to_human · queue for Arlan" },
        { slug: "ack_friend", label: "ack_friend · 👍 reaction" },
      ],
      samples: [
        { label: "ai_slop + connection", cluster: "auto_dismiss" },
        { label: "spam + any", cluster: "auto_dismiss" },
        { label: "recruiter + connection", cluster: "auto_dismiss" },
        { label: "ai_slop + meeting → \"thanks but not taking unsolicited mtgs\"", cluster: "polite_decline_meeting" },
        { label: "ai_slop + feedback → \"appreciate it, can't help right now\"", cluster: "polite_decline_meeting" },
        { label: "recruiter + role → \"not looking, thanks\"", cluster: "polite_decline_recruiter" },
        { label: "ai_slop + advisor_role → \"not taking new advisory roles\"", cluster: "polite_decline_advisor" },
        { label: "generic_pitch + meeting → \"send a 1-pager to arlan@…\"", cluster: "redirect_to_email" },
        { label: "vc + intro → \"intros via arlan@…\"", cluster: "redirect_to_email" },
        { label: "real_question + technical_help", cluster: "route_to_human" },
        { label: "vc + acquisition", cluster: "route_to_human" },
        { label: "friend + meeting", cluster: "route_to_human" },
        { label: "friend + greeting → 👍", cluster: "ack_friend" },
      ],
    },
  },

  // ═════════════════════════════════════════════════════════════════
  // PILLAR 1 · META · Folk inbox — message intent classifier
  // ═════════════════════════════════════════════════════════════════
  {
    match: (fn) => /classify.*message.*intent|message.*intent.*class/i.test(fn),
    pack: {
      clusters: [
        { slug: "scheduling", label: "logistics · scheduling" },
        { slug: "urgent", label: "task · urgent" },
        { slug: "warmth", label: "emotional · warmth" },
        { slug: "logistics", label: "logistics · checkin" },
        { slug: "noise", label: "noise · spam" },
        { slug: "greeting", label: "greeting · low signal" },
      ],
      samples: [
        { label: "lunch tuesday at noon", cluster: "scheduling" },
        { label: "can we move our 3pm to 4pm?", cluster: "scheduling" },
        { label: "anniversary dinner saturday", cluster: "scheduling" },
        { label: "booked the restaurant for tomorrow", cluster: "scheduling" },
        { label: "team standup tomorrow 10am", cluster: "scheduling" },
        { label: "client: prod is on fire RIGHT NOW", cluster: "urgent" },
        { label: "boss: need this by EOD please", cluster: "urgent" },
        { label: "deadline for the proposal is friday", cluster: "urgent" },
        { label: "happy birthday!!", cluster: "warmth" },
        { label: "love you", cluster: "warmth" },
        { label: "thinking of you", cluster: "warmth" },
        { label: "mom: how was your day", cluster: "warmth" },
        { label: "running 5 mins late", cluster: "logistics" },
        { label: "on my way, ETA 10", cluster: "logistics" },
        { label: "got the package, thanks", cluster: "logistics" },
        { label: "FREE iPhone — click here", cluster: "noise" },
        { label: "claim your reward now", cluster: "noise" },
        { label: "yo", cluster: "greeting" },
        { label: "hey, free this weekend?", cluster: "greeting" },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // extract_event_from_message — text → 6-way life-event enum
  {
    match: (fn) => /extract.*event.*message|event.*extract.*message|life.*event/i.test(fn),
    pack: {
      clusters: [
        { slug: "relocation", label: "relocation · move" },
        { slug: "new_job", label: "new job · promo · cofound" },
        { slug: "raised_funding", label: "raised funding · acquired" },
        { slug: "got_married", label: "engaged · married" },
        { slug: "had_kid", label: "had kid · new parent" },
        { slug: "none", label: "no event · skip" },
      ],
      samples: [
        { label: "moving to NYC next month for the new role", cluster: "relocation" },
        { label: "leaving sf, austin here we come", cluster: "relocation" },
        { label: "just bought a house in austin 🏡", cluster: "relocation" },
        { label: "starting at OpenAI in march", cluster: "new_job" },
        { label: "joining anthropic next month", cluster: "new_job" },
        { label: "left bigco today, cofounding something", cluster: "new_job" },
        { label: "promoted to staff engineer next quarter", cluster: "new_job" },
        { label: "just closed our seed round, $4M from sequoia", cluster: "raised_funding" },
        { label: "we raised our series A — 18M led by a16z", cluster: "raised_funding" },
        { label: "our company just got acquired by stripe", cluster: "raised_funding" },
        { label: "we got engaged 💍", cluster: "got_married" },
        { label: "married my best friend last weekend ❤️", cluster: "got_married" },
        { label: "officially a dad — meet baby leo", cluster: "had_kid" },
        { label: "back from paternity leave starting monday", cluster: "had_kid" },
        { label: "morning coffee in the new kitchen", cluster: "none" },
        { label: "this dog is my whole personality", cluster: "none" },
      ],
    },
  },

  // ═════════════════════════════════════════════════════════════════
  // PILLAR 3 · CUSTOMER SERVICE — ticket priority classifier
  // The "every B2B SaaS does this" generalizer.
  // ═════════════════════════════════════════════════════════════════
  {
    match: (fn) => /classify.*support|support.*priority|ticket.*priority|priority.*ticket/i.test(fn),
    pack: {
      clusters: [
        { slug: "p0_outage", label: "P0 · outage" },
        { slug: "p1_billing", label: "P1 · billing" },
        { slug: "p2_bug", label: "P2 · bug · how-to" },
        { slug: "p3_feature", label: "P3 · feature request" },
        { slug: "churn_risk", label: "churn risk · → CSM" },
        { slug: "praise", label: "praise · → marketing" },
      ],
      samples: [
        { label: "prod is down, every API returning 502", cluster: "p0_outage" },
        { label: "URGENT: payment processing failing", cluster: "p0_outage" },
        { label: "site is completely down for me", cluster: "p0_outage" },
        { label: "I was charged twice this month", cluster: "p1_billing" },
        { label: "Need a refund — never used the service", cluster: "p1_billing" },
        { label: "why am I being charged $200 on Pro plan?", cluster: "p1_billing" },
        { label: "How do I export my contacts to CSV?", cluster: "p2_bug" },
        { label: "the mobile app crashes when I open inbox", cluster: "p2_bug" },
        { label: "search isn't returning results I know exist", cluster: "p2_bug" },
        { label: "Could you add dark mode? 🥹", cluster: "p3_feature" },
        { label: "Feature request: Slack integration", cluster: "p3_feature" },
        { label: "considering churning — competitor shipped X", cluster: "churn_risk" },
        { label: "evaluating switch — what's your roadmap?", cluster: "churn_risk" },
        { label: "the new release is amazing, team loves it", cluster: "praise" },
        { label: "new dashboard is fantastic — much faster", cluster: "praise" },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // classify_message_intent — incoming message → intent label
  {
    match: (fn) => /classify.*intent|intent.*class/i.test(fn),
    pack: {
      clusters: [
        { slug: "scheduling", label: "scheduling" },
        { slug: "urgent", label: "urgent · escalation" },
        { slug: "warmth", label: "warmth · personal" },
        { slug: "logistics", label: "logistics · checkin" },
        { slug: "noise", label: "noise · spam" },
      ],
      samples: [
        { label: "lunch tuesday at noon", cluster: "scheduling" },
        { label: "can we move our 3pm to 4pm?", cluster: "scheduling" },
        { label: "anniversary dinner saturday", cluster: "scheduling" },
        { label: "booked the restaurant for tomorrow", cluster: "scheduling" },
        { label: "team standup tomorrow 10am", cluster: "scheduling" },
        { label: "client: prod is on fire RIGHT NOW", cluster: "urgent" },
        { label: "boss: need this by EOD please", cluster: "urgent" },
        { label: "deadline for the proposal is friday", cluster: "urgent" },
        { label: "happy birthday!!", cluster: "warmth" },
        { label: "love you", cluster: "warmth" },
        { label: "thinking of you", cluster: "warmth" },
        { label: "mom: how was your day", cluster: "warmth" },
        { label: "running 5 mins late", cluster: "logistics" },
        { label: "on my way, ETA 10", cluster: "logistics" },
        { label: "got the package, thanks", cluster: "logistics" },
        { label: "FREE iPhone — click here", cluster: "noise" },
        { label: "claim your reward now", cluster: "noise" },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // score_message_urgency — message → urgency 0..1
  {
    match: (fn) => /urgency|priority|score.*urgent/i.test(fn),
    pack: {
      clusters: [
        { slug: "p0", label: "P0 · fire" },
        { slug: "p1", label: "P1 · today" },
        { slug: "p2", label: "P2 · this week" },
        { slug: "p3", label: "P3 · whenever" },
      ],
      samples: [
        { label: "client: prod is on fire RIGHT NOW", cluster: "p0" },
        { label: "site is down, can't log in", cluster: "p0" },
        { label: "need eyes on this, paging", cluster: "p0" },
        { label: "boss: need this by EOD please", cluster: "p1" },
        { label: "deadline today reminder", cluster: "p1" },
        { label: "ship before 5pm", cluster: "p1" },
        { label: "deadline for the proposal is friday", cluster: "p2" },
        { label: "review by end of week", cluster: "p2" },
        { label: "let me know thoughts when free", cluster: "p2" },
        { label: "no plans this weekend, free if around", cluster: "p3" },
        { label: "fyi update, no action needed", cluster: "p3" },
        { label: "coffee invite, no rush", cluster: "p3" },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // score_relationship_warmth — contact → warmth 0..1
  {
    match: (fn) => /warmth|relationship|warm/i.test(fn),
    pack: {
      clusters: [
        { slug: "inner", label: "inner circle · daily" },
        { slug: "active", label: "active contacts · weekly" },
        { slug: "ambient", label: "ambient · monthly" },
        { slug: "dormant", label: "dormant · 90d+" },
      ],
      samples: [
        { label: "mom — 142 msgs in last 30d", cluster: "inner" },
        { label: "alex_co_founder — 189 msgs / 30d", cluster: "inner" },
        { label: "sarah_partner — 224 msgs / 30d", cluster: "inner" },
        { label: "best_friend — 96 msgs / 30d", cluster: "inner" },
        { label: "sarah_friend — 87 msgs / 30d", cluster: "active" },
        { label: "investor_dan — 28 msgs / 30d", cluster: "active" },
        { label: "client_acme — 32 msgs / 30d", cluster: "active" },
        { label: "dad — 142 msgs / 30d", cluster: "active" },
        { label: "old_school_friend — 11 msgs / 30d", cluster: "ambient" },
        { label: "ex_coworker — 8 msgs / 30d", cluster: "ambient" },
        { label: "vendor_stripe — 6 msgs / 30d", cluster: "ambient" },
        { label: "mentor_alice — 14 msgs / 30d", cluster: "ambient" },
        { label: "college_roommate — 0 msgs / 90d", cluster: "dormant" },
        { label: "ex_intern — 0 msgs / 120d", cluster: "dormant" },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // extract_event_from_message — message → calendar event
  {
    match: (fn) => /extract.*event|event.*extract|calendar/i.test(fn),
    pack: {
      clusters: [
        { slug: "deadline", label: "deadlines" },
        { slug: "meeting", label: "meetings · calls" },
        { slug: "social", label: "social · meals" },
        { slug: "travel", label: "travel · transit" },
      ],
      samples: [
        { label: "deadline for the proposal is friday", cluster: "deadline" },
        { label: "draft due monday eod", cluster: "deadline" },
        { label: "ship by end of sprint", cluster: "deadline" },
        { label: "can we move our 3pm to 4pm?", cluster: "meeting" },
        { label: "team standup tomorrow 10am", cluster: "meeting" },
        { label: "intro call thursday at 2", cluster: "meeting" },
        { label: "demo for the board next tuesday", cluster: "meeting" },
        { label: "anniversary dinner saturday", cluster: "social" },
        { label: "lunch tuesday at noon", cluster: "social" },
        { label: "drinks tonight after 7", cluster: "social" },
        { label: "bday party saturday 8pm", cluster: "social" },
        { label: "flight at 7am, jfk → sfo", cluster: "travel" },
        { label: "uber booked for 6:15", cluster: "travel" },
        { label: "train arrives 10:42", cluster: "travel" },
      ],
    },
  },

  // ─────────────────────────────────────────────────────────────────
  // summarize_thread_for_memory — thread → memory note
  {
    match: (fn) => /summari[sz]e|memory|recap/i.test(fn),
    pack: {
      clusters: [
        { slug: "decision", label: "decisions · outcomes" },
        { slug: "context", label: "context · status" },
        { slug: "vibe", label: "vibe · sentiment" },
      ],
      samples: [
        { label: "alex thread · agreed to ship friday", cluster: "decision" },
        { label: "sarah thread · picked thursday 8pm", cluster: "decision" },
        { label: "client thread · accepted scope", cluster: "decision" },
        { label: "team thread · staging deploys again", cluster: "context" },
        { label: "mom thread · weekend visit planned", cluster: "context" },
        { label: "investor thread · waiting on update", cluster: "context" },
        { label: "boss thread · pleased with progress", cluster: "vibe" },
        { label: "co-founder · race condition fixed", cluster: "vibe" },
        { label: "friend · low-stakes check-in", cluster: "vibe" },
      ],
    },
  },
];

const FALLBACK_PACK: SamplePack = {
  clusters: [
    { slug: "common_a", label: "common · primary" },
    { slug: "common_b", label: "common · secondary" },
    { slug: "edge", label: "edge cases" },
  ],
  samples: [
    { label: "this user's primary input · variant 1", cluster: "common_a" },
    { label: "this user's primary input · variant 2", cluster: "common_a" },
    { label: "this user's primary input · variant 3", cluster: "common_a" },
    { label: "this user's primary input · variant 4", cluster: "common_a" },
    { label: "this user's secondary input · variant 1", cluster: "common_b" },
    { label: "this user's secondary input · variant 2", cluster: "common_b" },
    { label: "this user's secondary input · variant 3", cluster: "common_b" },
    { label: "edge · adversarial input", cluster: "edge" },
    { label: "edge · noise input", cluster: "edge" },
  ],
};

export function getSamplePack(functionName: string): SamplePack {
  for (const entry of PACKS) {
    if (entry.match(functionName)) return entry.pack;
  }
  return FALLBACK_PACK;
}

// ─────────────────────────────────────────────────────────────────────
// Detail deriver — synthesizes plausible interaction data from
// (function_name + cluster + label). Each workflow kind maps to a
// builder that returns:
//
//   - input: the structured shape passed to the LLM (caption + meta)
//   - output: the parsed JSON the codified handler returns
//   - match_type: which path served this in production
//   - latency / cost numbers for the frontier vs vault comparison
//
// The deriver is deterministic: same (fn, label, cluster) → same
// detail. The author / handle is hashed off the label so the same
// "Sarah Chen · location" always shows Sarah Chen.
//
// When a sample carries an authored `detail` (richer copy from the
// data agent), the deriver is bypassed.

const FIRST_NAMES = [
  "Sarah", "Marcus", "Yusuke", "Camila", "Ravi", "Priya", "Liam", "Hana",
  "Jenny", "Alex", "Nora", "David", "Elena", "Chen", "Maya", "Jordan",
  "Aria", "Tomás", "Zoe", "Theo", "Imani", "Devi", "Olu", "Rin",
];
const LAST_NAMES = [
  "Chen", "Rodriguez", "Watanabe", "Santos", "Iyer", "Sharma", "Walsh",
  "Lee", "Patel", "Tanaka", "Bennett", "Kim", "Park", "Garcia", "Singh",
  "Nguyen", "Cohen", "Adler", "O'Connor", "Müller",
];

/** djb2-style hash → small positive integer; deterministic on string. */
function hashStr(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function pickFromArray<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length] as T;
}

function deriveAuthor(label: string): SampleAuthor {
  // If the label already contains a "Name · …" or "Name —" form,
  // reuse that. Otherwise hash an author from FIRST/LAST.
  const nameMatch = label.match(/^([A-Z][a-zà-ÿ]+(?:\s[A-Z][a-zà-ÿ]+)?)\s*[·—-]/);
  const fromLabel = nameMatch?.[1];
  const seed = hashStr(label);
  const first = fromLabel ?? `${pickFromArray(FIRST_NAMES, seed)} ${pickFromArray(LAST_NAMES, seed >> 3)}`;
  const handle = "@" + first.toLowerCase().replace(/[^a-z]/g, "");
  const initials = first
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]!)
    .join("")
    .toUpperCase();
  const hueChoices: SampleAuthor["hue"][] = ["maroon", "coral", "orange", "ink"];
  const hue = hueChoices[seed % hueChoices.length];
  return { name: first, handle, initials, hue };
}

function pickPostedAt(seed: number, cluster: string): string {
  // Cluster-aware: stale clusters get older timestamps, live clusters get fresh.
  if (/stale|throwback|drop/i.test(cluster)) {
    return pickFromArray(
      ["8mo ago", "1y ago", "2y ago", "18mo ago", "3y ago"],
      seed,
    );
  }
  if (/live|fresh|p0|urgent/i.test(cluster)) {
    return pickFromArray(["just now", "5m ago", "12m ago", "30m ago", "1h ago"], seed);
  }
  if (/recent|p1|today/i.test(cluster)) {
    return pickFromArray(["2h ago", "4h ago", "8h ago", "yesterday", "1d ago"], seed);
  }
  if (/dormant/i.test(cluster)) {
    return pickFromArray(["120d ago", "180d ago", "300d ago", "1y ago"], seed);
  }
  return pickFromArray(["2d ago", "5d ago", "1w ago", "2w ago", "3w ago"], seed);
}

interface DerivedShape {
  source: string;
  input: SampleFieldRow[];
  output: SampleFieldRow[];
  matchType: SampleDetail["match_type"];
  confidence: number;
  frontierModel: string;
  frontierLatency: number;
  frontierCost: number;
  vaultLatency: number;
  vaultCost: number;
}

function buildLocationShape(label: string, cluster: string, seed: number): DerivedShape {
  const us = ["us_cities"].includes(cluster);
  const asia = cluster.startsWith("asia");
  const eu = cluster.startsWith("europe");
  const transit = cluster === "in_transit";
  const stale = cluster === "throwback_stale";
  const city = transit
    ? pickFromArray(["SFO", "LAX", "JFK", "LHR", "HND"], seed)
    : us
      ? pickFromArray(["New York", "San Francisco", "Los Angeles", "Austin", "Miami", "Venice Beach"], seed)
      : asia
        ? pickFromArray(["Tokyo", "Shanghai", "Seoul", "Shibuya"], seed)
        : eu
          ? pickFromArray(["Berlin", "Amsterdam", "Paris", "Lisbon", "London"], seed)
          : pickFromArray(["Unknown", "—", null as unknown as string], seed) ?? "Unknown";
  const country = us ? "US" : asia ? pickFromArray(["JP", "CN", "KR"], seed) : eu ? pickFromArray(["DE", "FR", "PT", "GB", "NL"], seed) : "—";
  const conf = stale ? 0.42 : transit ? 0.78 : 0.94;
  return {
    source: "instagram",
    input: [
      { key: "caption", value: `"${label}"`, block: true },
      { key: "geotag", value: stale ? "(none)" : pickFromArray(["📍 SFO", "📍 venice beach", "📍 shibuya, tokyo", "📍 la condesa, mx", "(none)"], seed) },
      { key: "media_type", value: pickFromArray(["photo", "carousel", "reel"], seed) },
    ],
    output: [
      { key: "city", value: stale ? "null" : `"${city}"` },
      { key: "country", value: stale ? "null" : `"${country}"` },
      { key: "neighborhood", value: cluster === "us_cities" && city === "San Francisco" ? '"soma"' : "null" },
      { key: "confidence", value: conf.toFixed(2) },
    ],
    matchType: stale ? "frontier fallback" : transit ? "fuzzy vault hit" : "deterministic vault hit",
    confidence: conf,
    frontierModel: "gpt-5",
    frontierLatency: 380 + (seed % 220),
    frontierCost: 0.0024,
    vaultLatency: stale ? 0 : 1 + (seed % 3),
    vaultCost: stale ? 0 : 0.0001,
  };
}

function buildActivityShape(label: string, cluster: string, seed: number): DerivedShape {
  const map: Record<string, { activity: string; category: string; professional: boolean }> = {
    shipping: { activity: "shipping a release", category: "professional · launch", professional: true },
    speaking: { activity: "speaking · panel", category: "professional · public", professional: true },
    career_move: { activity: "changing roles", category: "professional · career", professional: true },
    fundraising: { activity: "fundraising", category: "professional · raise", professional: true },
    personal_milestone: { activity: "personal milestone", category: "personal · life event", professional: false },
    training: { activity: "training", category: "personal · fitness", professional: false },
  };
  const m = map[cluster] ?? { activity: "unknown", category: "—", professional: false };
  return {
    source: "instagram",
    input: [
      { key: "caption", value: `"${label}"`, block: true },
      { key: "media_type", value: pickFromArray(["photo", "reel", "story"], seed) },
      { key: "hashtags", value: pickFromArray(["#shipit", "#building", "#raising", "#sxsw", "(none)"], seed) },
    ],
    output: [
      { key: "activity", value: `"${m.activity}"` },
      { key: "category", value: `"${m.category}"` },
      { key: "professional", value: String(m.professional) },
      { key: "confidence", value: "0.93" },
    ],
    matchType: "deterministic vault hit",
    confidence: 0.93,
    frontierModel: "gpt-5",
    frontierLatency: 410 + (seed % 200),
    frontierCost: 0.0026,
    vaultLatency: 1,
    vaultCost: 0.0001,
  };
}

function buildRecencyShape(label: string, cluster: string, seed: number): DerivedShape {
  const ageMap: Record<string, { recency: string; stale: boolean; conf: number }> = {
    live: { recency: "live", stale: false, conf: 0.99 },
    recent: { recency: "recent", stale: false, conf: 0.96 },
    this_month: { recency: "this_month", stale: false, conf: 0.92 },
    stale_throwback: { recency: "stale", stale: true, conf: 0.97 },
  };
  const m = ageMap[cluster] ?? ageMap.recent!;
  const tsMatch = label.match(/posted\s+([^·]+)·/);
  const captionMatch = label.match(/·\s+"([^"]+)"/);
  const posted = tsMatch?.[1]?.trim() ?? "—";
  const caption = captionMatch?.[1] ?? label;
  return {
    source: "instagram",
    input: [
      { key: "posted_at", value: posted },
      { key: "caption", value: `"${caption}"`, block: true },
    ],
    output: [
      { key: "recency", value: `"${m.recency}"` },
      { key: "stale", value: String(m.stale) },
      { key: "confidence", value: m.conf.toFixed(2) },
    ],
    matchType: "deterministic vault hit",
    confidence: m.conf,
    frontierModel: "gpt-5",
    frontierLatency: 280 + (seed % 120),
    frontierCost: 0.0018,
    vaultLatency: 0,
    vaultCost: 0.00005,
  };
}

function buildSourceRouterShape(label: string, cluster: string, seed: number): DerivedShape {
  const map: Record<string, { sources: string[]; priority: string[] }> = {
    location_intent: {
      sources: ["instagram", "find_my", "google_maps"],
      priority: ["instagram", "find_my", "google_maps"],
    },
    activity_intent: { sources: ["instagram", "twitter", "linkedin"], priority: ["instagram", "twitter", "linkedin"] },
    contact_intent: { sources: ["icloud", "email_finder"], priority: ["icloud", "email_finder"] },
    recent_post_intent: { sources: ["instagram", "twitter", "tiktok"], priority: ["instagram", "twitter", "tiktok"] },
    employment_intent: { sources: ["linkedin", "crunchbase"], priority: ["linkedin", "crunchbase"] },
  };
  const m = map[cluster] ?? map.location_intent!;
  const personMatch = label.match(/^(.+?)\s+·\s+(.+)$/);
  const person = personMatch?.[1] ?? "Unknown";
  const intent = personMatch?.[2] ?? "lookup";
  return {
    source: "internal_router",
    input: [
      { key: "person", value: `"${person}"` },
      { key: "intent", value: `"${intent}"` },
    ],
    output: [
      { key: "sources", value: `[${m.sources.map((s) => `"${s}"`).join(", ")}]` },
      { key: "priority_order", value: `[${m.priority.slice(0, 2).map((s) => `"${s}"`).join(", ")} …]` },
      { key: "skip_reason", value: "null" },
    ],
    matchType: "tier-2 phi-3-mini",
    confidence: 0.88,
    frontierModel: "claude-sonnet-4-6",
    frontierLatency: 540 + (seed % 280),
    frontierCost: 0.0078,
    vaultLatency: 50 + (seed % 30),
    vaultCost: 0.0001,
  };
}

function buildHandleShape(label: string, cluster: string, seed: number): DerivedShape {
  const variants: Record<string, { ig: string; tw: string; li: string; conf: number }> = {
    fullname_clean: { ig: "@sarah.chen", tw: "@sarahc", li: "/in/sarahchen", conf: 0.92 },
    abbreviated: { ig: "@s.chen", tw: "@schen", li: "/in/sarahchen", conf: 0.74 },
    underscore_handle: { ig: `@${label}`, tw: `@${label.replace(/_/g, "")}`, li: `/in/${label.replace(/_/g, "")}`, conf: 0.81 },
    single_word: { ig: "(ambiguous)", tw: "(ambiguous)", li: "(ambiguous)", conf: 0.4 },
  };
  const m = variants[cluster] ?? variants.fullname_clean!;
  return {
    source: "internal_normalize",
    input: [{ key: "name", value: `"${label}"`, block: true }],
    output: [
      { key: "instagram", value: `"${m.ig}"` },
      { key: "twitter", value: `"${m.tw}"` },
      { key: "linkedin", value: `"${m.li}"` },
      { key: "confidence", value: m.conf.toFixed(2) },
    ],
    matchType: cluster === "single_word" ? "frontier fallback" : "deterministic vault hit",
    confidence: m.conf,
    frontierModel: "gpt-5",
    frontierLatency: 320 + (seed % 100),
    frontierCost: 0.002,
    vaultLatency: cluster === "single_word" ? 0 : 1,
    vaultCost: cluster === "single_word" ? 0 : 0.00005,
  };
}

function buildIntentShape(label: string, cluster: string, seed: number): DerivedShape {
  const map: Record<string, string> = {
    scheduling: "scheduling",
    urgent: "urgent_escalation",
    warmth: "warmth_personal",
    logistics: "logistics_checkin",
    noise: "noise_spam",
  };
  const intent = map[cluster] ?? "unknown";
  return {
    source: "imessage",
    input: [{ key: "message", value: `"${label}"`, block: true }],
    output: [
      { key: "intent", value: `"${intent}"` },
      { key: "confidence", value: "0.95" },
    ],
    matchType: cluster === "noise" ? "deterministic vault hit" : "fuzzy vault hit",
    confidence: 0.95,
    frontierModel: "gpt-5",
    frontierLatency: 240 + (seed % 120),
    frontierCost: 0.0014,
    vaultLatency: 1,
    vaultCost: 0.00004,
  };
}

function buildUrgencyShape(label: string, cluster: string, seed: number): DerivedShape {
  const tier = cluster.toUpperCase();
  const score = cluster === "p0" ? 0.98 : cluster === "p1" ? 0.78 : cluster === "p2" ? 0.45 : 0.12;
  return {
    source: "imessage",
    input: [{ key: "message", value: `"${label}"`, block: true }],
    output: [
      { key: "urgency", value: `"${tier}"` },
      { key: "score", value: score.toFixed(2) },
      { key: "confidence", value: "0.93" },
    ],
    matchType: "deterministic vault hit",
    confidence: 0.93,
    frontierModel: "gpt-5",
    frontierLatency: 220 + (seed % 100),
    frontierCost: 0.0012,
    vaultLatency: 1,
    vaultCost: 0.00004,
  };
}

function buildWarmthShape(label: string, cluster: string, seed: number): DerivedShape {
  const score = cluster === "inner" ? 0.95 : cluster === "active" ? 0.72 : cluster === "ambient" ? 0.38 : 0.08;
  return {
    source: "imessage",
    input: [{ key: "contact", value: `"${label}"`, block: true }],
    output: [
      { key: "warmth", value: score.toFixed(2) },
      { key: "bucket", value: `"${cluster}"` },
      { key: "confidence", value: "0.92" },
    ],
    matchType: "deterministic vault hit",
    confidence: 0.92,
    frontierModel: "claude-sonnet-4-6",
    frontierLatency: 510 + (seed % 200),
    frontierCost: 0.005,
    vaultLatency: 1,
    vaultCost: 0.00004,
  };
}

function buildEventShape(label: string, cluster: string, seed: number): DerivedShape {
  return {
    source: "imessage",
    input: [{ key: "message", value: `"${label}"`, block: true }],
    output: [
      { key: "event_type", value: `"${cluster}"` },
      { key: "when", value: pickFromArray(["friday 17:00", "tuesday 12:00", "saturday 20:00", "thursday 14:00"], seed) },
      { key: "confidence", value: "0.91" },
    ],
    matchType: "fuzzy vault hit",
    confidence: 0.91,
    frontierModel: "gpt-5",
    frontierLatency: 360 + (seed % 140),
    frontierCost: 0.002,
    vaultLatency: 2,
    vaultCost: 0.00006,
  };
}

function buildGenericShape(label: string, cluster: string, seed: number): DerivedShape {
  return {
    source: "internal",
    input: [{ key: "input", value: `"${label}"`, block: true }],
    output: [
      { key: "label", value: `"${cluster}"` },
      { key: "confidence", value: "0.9" },
    ],
    matchType: "deterministic vault hit",
    confidence: 0.9,
    frontierModel: "gpt-5",
    frontierLatency: 300 + (seed % 200),
    frontierCost: 0.0018,
    vaultLatency: 1,
    vaultCost: 0.00005,
  };
}

const SHAPE_BUILDERS: { match: (fn: string) => boolean; build: typeof buildGenericShape }[] = [
  { match: (fn) => /location.*post|extract.*location/i.test(fn), build: buildLocationShape },
  { match: (fn) => /activity.*post|extract.*activity/i.test(fn), build: buildActivityShape },
  { match: (fn) => /post.*recency|recency.*post|fresh|stale/i.test(fn), build: buildRecencyShape },
  { match: (fn) => /route.*source|route.*lookup|source.*route/i.test(fn), build: buildSourceRouterShape },
  { match: (fn) => /normalize.*handle|handle.*normalize/i.test(fn), build: buildHandleShape },
  { match: (fn) => /classify.*intent|intent.*class/i.test(fn), build: buildIntentShape },
  { match: (fn) => /urgency|priority/i.test(fn), build: buildUrgencyShape },
  { match: (fn) => /warmth|relationship/i.test(fn), build: buildWarmthShape },
  { match: (fn) => /event|calendar/i.test(fn), build: buildEventShape },
];

/**
 * Returns the rich SampleDetail for a sample, hand-authored or derived.
 *
 * The other agent on the team is iterating on the perfect mock data —
 * when they author `sample.detail`, this function returns it verbatim.
 * Until then it produces deterministic, plausible interaction data.
 */
export function inferSampleDetail(
  functionName: string,
  sample: SyntheticSample,
): SampleDetail {
  if (sample.detail) return sample.detail;

  const seed = hashStr(`${functionName}:${sample.label}:${sample.cluster}`);
  const builder =
    SHAPE_BUILDERS.find((b) => b.match(functionName))?.build ?? buildGenericShape;
  const shape = builder(sample.label, sample.cluster, seed);

  return {
    author: deriveAuthor(sample.label),
    posted_at: pickPostedAt(seed, sample.cluster),
    source: shape.source,
    input: shape.input,
    output: shape.output,
    match_type: shape.matchType,
    confidence: shape.confidence,
    frontier_model: shape.frontierModel,
    frontier_latency_ms: shape.frontierLatency,
    frontier_cost_usd: shape.frontierCost,
    vault_latency_ms: shape.vaultLatency,
    vault_cost_usd: shape.vaultCost,
  };
}

/**
 * Cluster description lookup — used by the cluster-zoom panel to
 * explain "what makes a node belong here". Defaults to a derived
 * one-liner if the pack didn't author it.
 */
export function getClusterDescription(
  pack: SamplePack,
  clusterSlug: string,
): string {
  const c = pack.clusters.find((x) => x.slug === clusterSlug);
  if (c?.description) return c.description;
  // Fallback heuristic — count + cluster label.
  const count = pack.samples.filter((s) => s.cluster === clusterSlug).length;
  const label = c?.label ?? clusterSlug;
  return `${count} synthetic call${count === 1 ? "" : "s"} matched the ${label} pattern.`;
}
