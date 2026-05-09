/**
 * Generate seed proxy traces for the always-on demo.
 *
 * Reads the 10 call sites from data/acme-agent/src/, fabricates realistic
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

const COMPANIES = [
  "Linear", "Notion", "Ramp", "Mercury", "Brex", "Carta", "Retool", "Vercel",
  "Modal", "Replicate", "Anyscale", "Pinecone", "Weaviate", "Supabase",
  "PlanetScale", "Neon", "Turso", "Resend", "Clerk", "Stytch",
];
const DOMAINS = COMPANIES.map((c) => `${c.toLowerCase()}.com`);
const INDUSTRIES = ["fintech", "healthtech", "vertical SaaS", "B2B AI tooling", "devtools"];

const TICKET_BODIES = [
  "Server returning 502 errors intermittently since 2pm. Affecting checkout flow.",
  "Cannot reset password — link expires before I click it.",
  "Billing charged me twice for September. Need refund.",
  "API rate limit hit at 9am, traffic was below quota. Logs attached.",
  "Webhook signature validation failing after yesterday's deploy.",
  "Dashboard shows wrong MRR number — off by ~$4k.",
  "User invites stuck in pending for 24h, no email delivered.",
  "Custom domain SSL renewal failed, site is now showing cert warning.",
  "Export to CSV truncates at 10k rows even on Scale plan.",
  "OAuth flow loops back to login after Google consent screen.",
  "Slack integration not posting to channel since Friday.",
  "Search index missing entries created in the last 6 hours.",
];

const SENTIMENT_TEXTS = [
  "honestly the worst onboarding flow I've ever used",
  "love the new dashboard, way faster than before",
  "it works but the docs are useless",
  "team has been responsive, even on weekends — appreciate it",
  "we're churning, the product hasn't kept up",
  "saved us probably 30 hours this week alone",
  "buggy as hell on safari, fix it",
  "exactly what we needed, signing up the rest of the team",
  "pricing change felt like a bait and switch",
  "the new model routing is genuinely impressive",
];

const SKU_QUERIES = [
  "16 inch macbook pro m4 max 64gb 2tb",
  "logitech mx master 3s graphite",
  "standing desk 60x30 walnut",
  "sony wh-1000xm5 black",
  "thunderbolt 4 cable 1m",
  "27 inch 5k display matte",
  "ergonomic chair lumbar mesh",
  "usb-c hub 7-in-1 with hdmi",
  "mechanical keyboard tkl brown switches",
  "webcam 1080p with ring light",
];

const INVOICE_BODIES = [
  "INVOICE #ACM-2026-0418\nDate: April 18, 2026\nTotal Due: $4,820.00\nNet 30 terms.",
  "Acme Corp Invoice\nNumber: INV-77231\nIssued 2026-03-22\nAmount: $1,299.50 USD",
  "Bill To: Linear\nInvoice ID: ACM-99812\n2026-05-01\nGrand total: $12,400",
  "Statement #2026-Q1-882\nDated 2026-02-14\nBalance: 8920.00 USD",
  "Receipt: ACM-RCT-4471 | 2026-04-30 | Total $549.99",
];

const COMPANY_NAMES_FOR_DOMAIN = [
  "OpenAI", "Anthropic Inc", "The Hugging Face Company", "Stripe Payments",
  "Datadog Inc.", "Snowflake Computing", "MongoDB Atlas", "Cloudflare Inc",
];

const SUPPORT_THREADS = [
  ["Customer: My export is stuck.", "Agent: Which workspace?", "Customer: acme-prod-2", "Agent: Looking now.", "Agent: Re-queued, should land in 5min."],
  ["Customer: Webhook signing broke.", "Agent: When did it start?", "Customer: After your friday deploy.", "Agent: Checking changelog."],
  ["Customer: SSO not working.", "Agent: SAML or OIDC?", "Customer: SAML, Okta.", "Agent: Send me the error from /auth/debug."],
];

const EMAIL_DRAFTS = [
  "hey just wanted to follow up on the demo, did you get a chance to chat with your team about it",
  "ya so basically we need the contract signed by friday or the procurement window closes",
  "lol this is the third time the integration broke can someone actually fix it",
];

const OUTREACH_SIGNALS = [
  ["Linear", "just raised Series C, hiring 5 SDRs"],
  ["Notion", "switched from Salesforce to Apollo last quarter"],
  ["Ramp", "shipped AI bookkeeping feature, GTM team expanding"],
];

const MARKETING_PROMPTS = [
  ["AI sales copilot", "early-stage founders", "punchy"],
];

const pick = <T>(arr: T[], i: number): T => arr[i % arr.length]!;
const jitter = (base: number, spread: number) => base + Math.floor(Math.random() * spread);

const SITES: SiteSpec[] = [
  {
    fn: "classify_ticket_priority",
    count: 65, // crosses threshold → compiles live
    provider: "openai",
    model: "gpt-5",
    system: "Classify ticket priority and category. Return JSON.",
    inputs: TICKET_BODIES,
    responder: (text) => {
      const isHigh = /error|failing|down|stuck|broken|cannot|crash/i.test(text);
      const cat = /billing|refund|charge|MRR/i.test(text) ? "billing" :
                  /API|rate|webhook|deploy|index/i.test(text) ? "infrastructure" :
                  /SSO|password|invite|OAuth|domain|SSL/i.test(text) ? "auth" : "general";
      return JSON.stringify({ priority: isHigh ? "high" : "medium", category: cat });
    },
    baseLatency: 380,
    tokenCost: 0.0021,
  },
  {
    fn: "classify_sentiment",
    count: 55, // crosses threshold → compiles live
    provider: "openai",
    model: "gpt-5",
    system: "Classify sentiment. Return JSON.",
    inputs: SENTIMENT_TEXTS,
    responder: (text) => {
      const pos = /love|appreciate|saved|impressive|exactly|signing/i.test(text);
      const neg = /worst|useless|churning|bait|buggy|fix it|broke/i.test(text);
      return JSON.stringify({ sentiment: pos ? "positive" : neg ? "negative" : "neutral", confidence: 0.87 });
    },
    baseLatency: 210,
    tokenCost: 0.0014,
  },
  {
    fn: "match_product_sku",
    count: 38, // close to threshold but under
    provider: "openai",
    model: "gpt-5",
    system: "Match the query to a SKU from our catalog. Return JSON.",
    inputs: SKU_QUERIES,
    responder: (q) => JSON.stringify({ sku: `SKU-${sha(q).slice(0, 6).toUpperCase()}`, match_confidence: 0.91 }),
    baseLatency: 295,
    tokenCost: 0.0018,
  },
  {
    fn: "classify_lead_tier",
    count: 28,
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    system: "You are a sales analyst classifying lead tier (A/B/C).",
    inputs: DOMAINS.flatMap((d, i) =>
      [50, 120, 240, 480].map((emp) => `Classify ${d} (${emp}-person ${pick(INDUSTRIES, i)}). Return JSON.`)
    ),
    responder: (q) => {
      const m = q.match(/\((\d+)-person/);
      const emp = m ? +m[1]! : 100;
      const tier = emp >= 50 && emp <= 500 ? "A" : emp <= 2000 ? "B" : "C";
      return JSON.stringify({ fit: tier !== "C", confidence: 0.82, tier, reasoning: `${emp}-person fits ${tier}-tier band.` });
    },
    baseLatency: 520,
    tokenCost: 0.0034,
  },
  {
    fn: "extract_invoice_fields",
    count: 22,
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    system: "Extract invoice_number, total_usd (number), and date (YYYY-MM-DD).",
    inputs: INVOICE_BODIES,
    responder: (body) => {
      const num = body.match(/(?:#|Number:|ID:|Statement #|Receipt:)\s*([A-Z0-9-]+)/)?.[1] ?? "UNKNOWN";
      const total = +(body.match(/[\$]?([\d,]+\.\d{2}|\d+)/g)?.slice(-1)[0]?.replace(/[$,]/g, "") ?? 0);
      const date = body.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? "2026-01-01";
      return JSON.stringify({ invoice_number: num, total_usd: total, date });
    },
    baseLatency: 610,
    tokenCost: 0.0042,
  },
  {
    fn: "summarize_support_thread",
    count: 18, // yellow zone
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    system: "Summarize this support thread in 3 bullets.",
    inputs: SUPPORT_THREADS.map((t) => t.join("\n---\n")),
    responder: () => "- Customer reported issue with workspace tooling\n- Agent diagnosed root cause from logs\n- Fix queued, ETA under 5 minutes",
    baseLatency: 890,
    tokenCost: 0.0067,
  },
  {
    fn: "resolve_company_domain",
    count: 12,
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    system: "Resolve a company name to its primary domain. Return only the domain.",
    inputs: COMPANY_NAMES_FOR_DOMAIN,
    responder: (name) => `${name.toLowerCase().replace(/[^a-z]/g, "").slice(0, 12)}.com`,
    baseLatency: 240,
    tokenCost: 0.0009,
  },
  {
    fn: "rewrite_email_formal",
    count: 8,
    provider: "openai",
    model: "gpt-5",
    system: "Rewrite in formal business English.",
    inputs: EMAIL_DRAFTS,
    responder: () => "Following up on the demo discussion. Could you share an update on whether your team has had the opportunity to evaluate the proposal? Happy to provide additional context if useful.",
    baseLatency: 740,
    tokenCost: 0.0051,
  },
  {
    fn: "draft_outreach_subject",
    count: 3, // red zone, frontier-only
    provider: "anthropic",
    model: "claude-sonnet-4-6",
    system: "",
    inputs: OUTREACH_SIGNALS.map(([n, s]) => `Write a punchy outreach subject for ${n} given signal: ${s}`),
    responder: () => "Linear's SDR push — got 60s?",
    baseLatency: 480,
    tokenCost: 0.0028,
  },
  {
    fn: "generate_marketing_copy",
    count: 1, // truly frontier
    provider: "openai",
    model: "gpt-5",
    system: "",
    inputs: MARKETING_PROMPTS.map(([p, a, t]) => `Write ${t} marketing copy for ${p} targeting ${a}.`),
    responder: () => "Stop guessing which leads to call. Acme reads every signal — funding, headcount, job posts — and tells you who's ready to buy this week. Built for founders who'd rather close than research.",
    baseLatency: 1240,
    tokenCost: 0.0089,
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
        call_site_hash: `acme:${site.fn}:v1`,
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

  // chronological order (matches what a real proxy would write)
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
      Object.entries(buckets).sort(([, a], [, b]) => b - a).map(([k, v]) => [
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
