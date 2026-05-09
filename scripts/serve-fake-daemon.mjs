#!/usr/bin/env node
/**
 * Fake daemon HTTP server — drives the UI when Ayaan's real daemon isn't
 * available, plus serves as the demo-day fallback if his daemon flakes.
 *
 * Endpoints (matched by Vite proxy in packages/ui/vite.config.ts):
 *   GET /daemon/events?since=<isoTs>     →  newline-delimited DaemonEvent JSON
 *   GET /daemon/vault/inherited          →  VaultInherited JSON
 *
 * Behavior:
 *   - Serves a synthetic 24h history at startup so the badge reads
 *     "running 7h 23m · fire #4" the moment a judge lands on the page.
 *   - Emits live events forever: uptime ticks every 1s, cluster
 *     observations every 500ms, a fan-out fire every ~45s, and one
 *     vault-hit fire every other cycle so statefulness is visible
 *     without anyone clicking.
 *   - Once every ~3 minutes engages the local fallback to demonstrate
 *     graceful recovery.
 *
 * Run via:
 *     node scripts/serve-fake-daemon.mjs
 *
 * Or via npm in the repo root:
 *     npm run daemon:fake
 *
 * Environment overrides:
 *   PORT (default 8421)
 *   FIRE_INTERVAL_S (default 45)
 *   COLD_START_HOURS (default 7)
 */

import http from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { ConvexHttpClient } from "convex/browser";

const PORT = Number(process.env.PORT ?? 8421);
const CONVEX_URL = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;
const CONVEX_RUN_ID = process.env.CONVEX_RUN_ID ?? "demo-fake-daemon";
const convex = CONVEX_URL ? new ConvexHttpClient(CONVEX_URL) : null;
if (convex) {
  console.log(`[fake-daemon] convex sink: ${CONVEX_URL} (run_id=${CONVEX_RUN_ID})`);
} else {
  console.log("[fake-daemon] CONVEX_URL not set — skipping convex mirror");
}

/** Fire-and-forget Convex mutation. We never block the demo on Convex. */
function convexCall(name, args) {
  if (!convex) return;
  convex.mutation(name, args).catch((err) => {
    console.warn(`[fake-daemon] convex ${name} failed:`, err.message ?? err);
  });
}

const PHASE_TIMELINE = [
  { phase: "connect", page_index: 0 },
  { phase: "reading_code", page_index: 1 },
  { phase: "classify", page_index: 2 },
  { phase: "reading_docs", page_index: 3 },
  { phase: "expanding", page_index: 4 },
  { phase: "stress_test", page_index: 5 },
  { phase: "clusters_revealed", page_index: 6 },
  { phase: "agent_writing", page_index: 7 },
  { phase: "validate", page_index: 8 },
  { phase: "vault_write", page_index: 9 },
  { phase: "result", page_index: 10 },
];
const FIRE_INTERVAL_MS = Number(process.env.FIRE_INTERVAL_S ?? 45) * 1000;
const COLD_START_HOURS = Number(process.env.COLD_START_HOURS ?? 7);
const COLD_START_FIRES = 4;

const startedAt = Date.now() - COLD_START_HOURS * 60 * 60 * 1000;
let firesTotal = COLD_START_FIRES;
let dollarsSaved = 66_800;
let lastFireTs = new Date(Date.now() - 12 * 60 * 1000).toISOString();
let totalRetries = 0;

/** Ring buffer of recent events. UI reads `?since=<ts>` to incrementally
 *  fetch only new events since its last seen ts. We keep enough history
 *  to survive a tab reload during the demo. */
const eventsBuffer = [];
const MAX_BUFFER = 5000;

function pushEvent(event) {
  eventsBuffer.push(event);
  if (eventsBuffer.length > MAX_BUFFER) {
    eventsBuffer.splice(0, eventsBuffer.length - MAX_BUFFER);
  }
}

function isoNow() {
  return new Date().toISOString();
}

const VAULT_INHERITED = {
  schema_version: 1,
  fetched_at: isoNow(),
  count: 7,
  items: [
    {
      vault_key: "vault://folk/message_intent_v3",
      cluster_id: "cluster_message_intent",
      function_name: "classifyMessageIntent",
      compiled_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      calls_saved: 184_000,
      dollars_saved: 36_400,
      tier: "tier_1",
    },
    {
      vault_key: "vault://folk/urgency_score_v2",
      cluster_id: "cluster_message_urgency",
      function_name: "scoreMessageUrgency",
      compiled_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      calls_saved: 92_300,
      dollars_saved: 18_700,
      tier: "tier_1",
    },
    {
      vault_key: "vault://folk/relationship_warmth_v1",
      cluster_id: "cluster_relationship_warmth",
      function_name: "scoreRelationshipWarmth",
      compiled_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      calls_saved: 41_100,
      dollars_saved: 12_500,
      tier: "tier_1",
    },
    {
      vault_key: "vault://folk/event_extract_v4",
      cluster_id: "cluster_event_extract",
      function_name: "extractEventFromMessage",
      compiled_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      calls_saved: 28_800,
      dollars_saved: 8_900,
      tier: "tier_2",
    },
    {
      vault_key: "vault://folk/thread_memory_v1",
      cluster_id: "cluster_thread_memory",
      function_name: "summarizeThreadForMemory",
      compiled_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      calls_saved: 7_200,
      dollars_saved: 2_880,
      tier: "tier_2",
    },
    {
      vault_key: "vault://folk/style_rewrite_v2",
      cluster_id: "cluster_style_rewrite",
      function_name: "applyUserWritingStyle",
      compiled_at: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
      calls_saved: 3_100,
      dollars_saved: 1_200,
      tier: "tier_2",
    },
    {
      vault_key: "vault://folk/spam_filter_v3",
      cluster_id: "cluster_spam_filter",
      function_name: "classifySpamMessage",
      compiled_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
      calls_saved: 1_380,
      dollars_saved: 520,
      tier: "tier_1",
    },
  ],
};

const FAN_OUT_CLUSTERS = [
  { id: "cluster_message_intent_v2", fn: "classifyMessageIntent", sig: "openai|messageIntent_v2|tools=0", samples: 50 },
  { id: "cluster_event_extract_v1", fn: "extractEventFromMessage", sig: "openai|eventExtract_v1|tools=0", samples: 50 },
];

/** Pre-generated code blobs streamed char-by-char as the agent "writes". */
const CODE_BLOBS = {
  classifyMessageIntent: `import { z } from "zod";

const IntentSchema = z.enum([
  "scheduling", "follow_up", "introduction", "thank_you",
  "request", "decline", "casual", "urgent",
]);

export type MessageIntent = z.infer<typeof IntentSchema>;

const KEYWORD_HINTS: Record<MessageIntent, RegExp[]> = {
  scheduling: [/\\b(meet|schedule|calendar|when works|available)\\b/i],
  follow_up:  [/\\b(checking in|circling back|any update)\\b/i],
  introduction: [/\\b(introduce|wanted to connect|reach out)\\b/i],
  thank_you:  [/\\b(thanks|thank you|appreciate)\\b/i],
  request:    [/\\b(could you|can you|would you|please)\\b/i],
  decline:    [/\\b(unfortunately|can't|won't be able)\\b/i],
  casual:     [/\\b(hey|sup|what's up)\\b/i],
  urgent:     [/\\b(urgent|asap|today|right now)\\b/i],
};

export function classifyMessageIntent(input: { body: string }): MessageIntent {
  const b = input.body.trim();
  for (const [intent, hints] of Object.entries(KEYWORD_HINTS) as [MessageIntent, RegExp[]][]) {
    if (hints.some((re) => re.test(b))) return intent;
  }
  return "casual";
}
`,
  extractEventFromMessage: `import { z } from "zod";

const ExtractedEventSchema = z.object({
  has_event: z.boolean(),
  title: z.string().optional(),
  start_iso: z.string().datetime().optional(),
  duration_min: z.number().int().positive().optional(),
});

export type ExtractedEvent = z.infer<typeof ExtractedEventSchema>;

const TIME_RE = /\\b(\\d{1,2})(:\\d{2})?\\s*(am|pm)?\\b/i;
const DAY_RE  = /\\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday)\\b/i;

export function extractEventFromMessage(input: { body: string }): ExtractedEvent {
  const day = input.body.match(DAY_RE);
  const time = input.body.match(TIME_RE);
  if (!day && !time) return { has_event: false };
  const title = input.body.split(/[.!?\\n]/)[0]?.slice(0, 80) ?? "Untitled";
  return {
    has_event: true,
    title,
    start_iso: synthesizeIso(day?.[1] ?? "today", time?.[0] ?? "09:00"),
    duration_min: 30,
  };
}

function synthesizeIso(day: string, time: string): string {
  const base = new Date();
  if (day === "tomorrow") base.setDate(base.getDate() + 1);
  return base.toISOString();
}
`,
};

/** Patterns we *don't* compile — populates the negative vault on Page 5. */
const NEGATIVE_PATTERNS = [
  { fn: "fuzzy_intent_classifier", reason: "oracle_disagreement", retry: "30d" },
  { fn: "vague_status_check", reason: "high_entropy", retry: "never" },
  { fn: "stub_question_answer", reason: "low_confidence", retry: "7d" },
  { fn: "open_ended_summary", reason: "schema_unstable", retry: "14d" },
  { fn: "creative_rewrite", reason: "non_deterministic", retry: "never" },
  { fn: "subjective_review", reason: "oracle_disagreement", retry: "30d" },
];
const VAULT_HIT_CLUSTERS = [
  {
    id: "cluster_message_intent",
    fn: "classifyMessageIntent",
    sig: "openai|messageIntent_v3|tools=0",
    samples: 50,
    inherited_from_session: "2026-05-02-A1",
    prior_compiled_at: VAULT_INHERITED.items[0].compiled_at,
  },
];

let cycleCounter = 0;

async function fanOutFire() {
  const cluster = FAN_OUT_CLUSTERS[cycleCounter % FAN_OUT_CLUSTERS.length];
  const sandboxId = `sb_${Math.random().toString(36).slice(2, 10)}`;
  const t0 = Date.now();

  // Pre-fire observation building up
  for (let i = 0; i < 5; i++) {
    pushEvent({
      kind: "cluster_observed",
      ts: isoNow(),
      cluster_id: cluster.id,
      signature: cluster.sig,
      sample_count: 30 + i * 5,
      threshold: 50,
    });
    await sleep(180);
  }

  pushEvent({
    kind: "cluster_threshold_hit",
    ts: isoNow(),
    cluster_id: cluster.id,
    signature: cluster.sig,
    n_samples: cluster.samples,
    decision: "fan_out",
  });
  await sleep(800);

  pushEvent({
    kind: "sandbox_spawn_start",
    ts: isoNow(),
    cluster_id: cluster.id,
    sandbox_id: sandboxId,
    image: "compile-phi-mini",
    worker_count: 64,
  });

  // Phi ticks — 100K validation, ~25-30s wall clock to mirror the real bench.
  // Throughput ramps to ~3500/s.
  const total = 100_000;
  let done = 0;
  let retryCount = 0;
  while (done < total) {
    const step = Math.min(total - done, Math.floor(2400 + Math.random() * 1800));
    done += step;
    if (Math.random() < 0.06) retryCount++; // occasional retry
    pushEvent({
      kind: "phi_tick",
      ts: isoNow(),
      sandbox_id: sandboxId,
      cluster_id: cluster.id,
      calls_done: done,
      calls_total: total,
      throughput_per_sec: 3300 + Math.floor(Math.random() * 600),
      retry_count: retryCount,
    });
    await sleep(700);
  }
  totalRetries += retryCount;

  // Mirror live throughput into Convex live_metrics so subscribers see it.
  convexCall("metrics:put", {
    metrics: {
      run_id: CONVEX_RUN_ID,
      call_site_id: cluster.id,
      total_done: total,
      oracle_done: 1000,
      candidate_done: total - 1000,
      throughput_per_sec: 3500,
      tier_mix: { tier_1: 0.7, tier_2: 0.25, tier_3: 0.05 },
      axis_scores: { schema_stability: 0.97, determinism: 0.94, oracle_agreement: 0.96 },
      updated_at: isoNow(),
    },
  });

  // Occasional fallback engagement to demonstrate recovery. fanOutFire()
  // runs only on even cycles (2, 4, 6, 8 …) so we trigger every cycle
  // whose counter is divisible by 4 — that's every other fan-out, ~150s
  // apart, which matches the "~3 min in" cadence in the runbook.
  const didFallback = cycleCounter % 4 === 0;
  if (didFallback) {
    pushEvent({
      kind: "fallback_engaged",
      ts: isoNow(),
      cluster_id: cluster.id,
      surface: "run_phi",
      reason: "primary phi sandbox returned exit=137 (oom-kill); local fallback served the holdout",
      recovered: true,
    });
    await sleep(1200);
  }

  pushEvent({
    kind: "oracle_agreement",
    ts: isoNow(),
    cluster_id: cluster.id,
    score: 0.94 + Math.random() * 0.04,
    threshold: 0.85,
    decision: "commit",
    oracle_samples: 1000,
  });
  await sleep(1500);

  // ── Page 4: agent typewrites the function ──────────────────────────────
  const code = CODE_BLOBS[cluster.fn] ?? CODE_BLOBS.classifyMessageIntent;
  const functionId = `fn_${cluster.fn}_${Date.now().toString(36)}`;
  let cursor = 0;
  const codeTotal = code.length;
  while (cursor < codeTotal) {
    const stride = 18 + Math.floor(Math.random() * 30);
    const next = Math.min(codeTotal, cursor + stride);
    const chunk = code.slice(cursor, next);
    cursor = next;
    pushEvent({
      kind: "code_chunk",
      ts: isoNow(),
      cluster_id: cluster.id,
      chunk,
      cursor,
      total_chars_estimate: codeTotal,
    });
    await sleep(120);
  }
  pushEvent({
    kind: "code_complete",
    ts: isoNow(),
    cluster_id: cluster.id,
    function_id: functionId,
    code,
    sha: `sha_${Math.random().toString(36).slice(2, 12)}`,
    line_count: code.split("\n").length,
  });
  await sleep(400);

  // ── Page 4 right pane: Tensorlake holdout gate ─────────────────────────
  const gateTotal = 200;
  let gateDone = 0;
  while (gateDone < gateTotal) {
    gateDone = Math.min(gateTotal, gateDone + 8 + Math.floor(Math.random() * 12));
    pushEvent({
      kind: "gate_progress",
      ts: isoNow(),
      cluster_id: cluster.id,
      holdout_done: gateDone,
      holdout_total: gateTotal,
      latency_ms_p50: 3.2 + Math.random() * 1.6,
    });
    await sleep(160);
  }
  await sleep(400);

  // ── Page 5: vault write animation ──────────────────────────────────────
  pushEvent({
    kind: "vault_write_start",
    ts: isoNow(),
    cluster_id: cluster.id,
    function_id: functionId,
    kind_label: "positive",
  });
  await sleep(900);
  pushEvent({
    kind: "vault_write_committed",
    ts: isoNow(),
    cluster_id: cluster.id,
    function_id: functionId,
    kind_label: "positive",
    vault_page_id: `nia_pg_${Math.random().toString(36).slice(2, 10)}`,
    tier: "tier_1",
  });
  await sleep(300);

  // Every fourth fan-out, also write a negative entry so the negative
  // shelf populates over the demo.
  if (cycleCounter % 8 === 0) {
    const neg = NEGATIVE_PATTERNS[(cycleCounter / 8) % NEGATIVE_PATTERNS.length | 0];
    const negId = `fn_${neg.fn}_${Date.now().toString(36)}`;
    pushEvent({
      kind: "vault_write_start",
      ts: isoNow(),
      cluster_id: `cluster_${neg.fn}`,
      function_id: negId,
      kind_label: "negative",
    });
    await sleep(700);
    pushEvent({
      kind: "vault_write_committed",
      ts: isoNow(),
      cluster_id: `cluster_${neg.fn}`,
      function_id: negId,
      kind_label: "negative",
      reason: neg.reason,
    });
    await sleep(300);
  }

  const dollarsThis = 8_400 + Math.floor(Math.random() * 4_200);
  dollarsSaved += dollarsThis;
  firesTotal += 1;
  lastFireTs = isoNow();
  pushEvent({
    kind: "fire_complete",
    ts: isoNow(),
    cluster_id: cluster.id,
    total_duration_ms: Date.now() - t0,
    dollars_saved_this_fire: dollarsThis,
    vault_key: `vault://folk/${cluster.fn}_v1`,
    tier: "tier_1",
    fallback_count: didFallback ? 1 : 0,
  });

  // Mirror the fire-complete into Convex: a vault_event + bumped result_summary.
  convexCall("vault:event", {
    event: {
      run_id: CONVEX_RUN_ID,
      entry: {
        kind: "positive",
        vault_key: `vault://folk/${cluster.fn}_v1`,
        cluster_id: cluster.id,
        function_name: cluster.fn,
        tier: "tier_1",
        dollars_saved_this_fire: dollarsThis,
        compiled_at: isoNow(),
      },
      emitted_at: isoNow(),
    },
  });
  convexCall("result:put", {
    summary: {
      run_id: CONVEX_RUN_ID,
      files_scanned: 47,
      call_sites_total: 10,
      stage1_green: 2,
      stage1_yellow: 3,
      stage1_red: 5,
      stage2_runs: firesTotal,
      stage2_passes: firesTotal,
      codified_count: firesTotal,
      negative_vault_count: 6,
      projected_annual_savings_usd: dollarsSaved,
      sandbox_compute_cost_usd: Math.round(firesTotal * 28),
      total_synthetic_calls: firesTotal * 100_000,
      wall_time_ms: Date.now() - startedAt,
      emitted_at: isoNow(),
    },
  });
}

async function vaultHitFire() {
  const cluster = VAULT_HIT_CLUSTERS[0];
  pushEvent({
    kind: "cluster_threshold_hit",
    ts: isoNow(),
    cluster_id: cluster.id,
    signature: cluster.sig,
    n_samples: cluster.samples,
    decision: "vault_hit",
  });
  await sleep(450);

  const dollarsThis = 5_200 + Math.floor(Math.random() * 2_800);
  dollarsSaved += dollarsThis;
  firesTotal += 1;
  lastFireTs = isoNow();
  pushEvent({
    kind: "vault_hit",
    ts: isoNow(),
    cluster_id: cluster.id,
    inherited_from_session: cluster.inherited_from_session,
    prior_compiled_at: cluster.prior_compiled_at,
    function_name: cluster.fn,
    routed_in_ms: 3.4 + Math.random() * 4.2,
    dollars_saved_this_hit: dollarsThis,
  });
  await sleep(2500);

  pushEvent({
    kind: "fire_complete",
    ts: isoNow(),
    cluster_id: cluster.id,
    total_duration_ms: Math.floor(2900 + Math.random() * 200),
    dollars_saved_this_fire: dollarsThis,
    vault_key: `vault://folk/${cluster.fn}_v3`,
    tier: "tier_1",
    fallback_count: 0,
  });

  convexCall("vault:event", {
    event: {
      run_id: CONVEX_RUN_ID,
      entry: {
        kind: "vault_hit",
        vault_key: `vault://folk/${cluster.fn}_v3`,
        cluster_id: cluster.id,
        function_name: cluster.fn,
        inherited_from_session: cluster.inherited_from_session,
        dollars_saved_this_fire: dollarsThis,
        emitted_at: isoNow(),
      },
      emitted_at: isoNow(),
    },
  });
}

/**
 * Continuous live-routing simulation. Drives Page 6: each event lights one
 * of three lanes. Weighted 94% positive / 4% negative / 2% unknown.
 */
const POSITIVE_FNS = [
  "classifyMessageIntent", "extractEventFromMessage", "scoreMessageUrgency",
  "scoreRelationshipWarmth", "summarizeThreadForMemory", "applyUserWritingStyle",
  "classifySpamMessage",
];
async function routeLoop() {
  await sleep(3000);
  while (true) {
    const r = Math.random();
    let outcome, latency, dollars, fn, sig;
    if (r < 0.94) {
      outcome = "positive";
      fn = POSITIVE_FNS[Math.floor(Math.random() * POSITIVE_FNS.length)];
      sig = `openai|${fn}|tools=0`;
      latency = 2.1 + Math.random() * 5.4;
      dollars = 0.0008 + Math.random() * 0.0014;
    } else if (r < 0.98) {
      outcome = "negative";
      fn = null;
      sig = `openai|fuzzy_pattern_${Math.random().toString(36).slice(2, 6)}|tools=0`;
      latency = 0.4 + Math.random() * 0.6;
      dollars = 0;
    } else {
      outcome = "unknown";
      fn = null;
      sig = `openai|new_pattern_${Math.random().toString(36).slice(2, 6)}|tools=0`;
      latency = 800 + Math.random() * 800;
      dollars = 0;
    }
    pushEvent({
      kind: "route_resolved",
      ts: isoNow(),
      request_id: `req_${Math.random().toString(36).slice(2, 10)}`,
      cluster_signature: sig,
      outcome,
      function_name: fn,
      latency_ms: latency,
      dollars_saved: dollars,
    });
    await sleep(60 + Math.random() * 80);
  }
}

async function uptimeLoop() {
  while (true) {
    pushEvent({
      kind: "uptime_tick",
      ts: isoNow(),
      uptime_ms: Date.now() - startedAt,
      fires_total: firesTotal,
      dollars_saved: dollarsSaved,
      last_fire_ts: lastFireTs,
    });
    await sleep(1000);
  }
}

async function bootstrapConvex() {
  if (!convex) return;
  // Walk the phase timeline (fast) so any UI subscribed to bootstrap_phase
  // flips through the demo and lands on `result`. Phase mutation is
  // forward-only so we just advance to the terminal state on boot.
  for (const step of PHASE_TIMELINE) {
    convexCall("phase:advance", {
      run_id: CONVEX_RUN_ID,
      phase: step.phase,
      page_index: step.page_index,
    });
  }
  // Initial result summary so subscribers have something to render before
  // the first fan-out fire writes a real one.
  convexCall("result:put", {
    summary: {
      run_id: CONVEX_RUN_ID,
      files_scanned: 47,
      call_sites_total: 10,
      stage1_green: 2,
      stage1_yellow: 3,
      stage1_red: 5,
      stage2_runs: firesTotal,
      stage2_passes: firesTotal,
      codified_count: firesTotal,
      negative_vault_count: 6,
      projected_annual_savings_usd: dollarsSaved,
      sandbox_compute_cost_usd: firesTotal * 28,
      total_synthetic_calls: firesTotal * 100_000,
      wall_time_ms: Date.now() - startedAt,
      emitted_at: isoNow(),
    },
  });
}

async function fireLoop() {
  // Brief boot delay so judges see "fixture mode → live" transition.
  await sleep(2000);
  // Open with a fan-out (not vault-hit) so the codify page is populated
  // within ~5s of landing. After that, alternate as before.
  cycleCounter = 0;
  while (true) {
    cycleCounter++;
    if (cycleCounter % 2 === 1) {
      await fanOutFire();
    } else {
      await vaultHitFire();
    }
    await sleep(FIRE_INTERVAL_MS);
  }
}

const server = http.createServer((req, res) => {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("cache-control", "no-store");

  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  if (url.pathname === "/daemon/events") {
    const since = url.searchParams.get("since");
    let events = eventsBuffer;
    if (since) {
      events = eventsBuffer.filter((e) => e.ts > since);
    } else {
      // First request — give them only the most recent ~50 events so the
      // UI doesn't get blasted with all history.
      events = eventsBuffer.slice(-50);
    }
    res.setHeader("content-type", "application/x-ndjson");
    res.end(events.map((e) => JSON.stringify(e)).join("\n"));
    return;
  }
  if (url.pathname === "/daemon/vault/inherited") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ...VAULT_INHERITED, fetched_at: isoNow() }));
    return;
  }
  res.statusCode = 404;
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`[fake-daemon] listening on http://127.0.0.1:${PORT}`);
  console.log(`[fake-daemon] cold-start: ${COLD_START_HOURS}h uptime, ${COLD_START_FIRES} fires, $${dollarsSaved.toLocaleString()} saved`);
  console.log(`[fake-daemon] fire interval: ${FIRE_INTERVAL_MS / 1000}s · alternates fan-out / vault-hit`);
});

bootstrapConvex();
uptimeLoop().catch((err) => console.error("[fake-daemon] uptime loop crashed:", err));
fireLoop().catch((err) => console.error("[fake-daemon] fire loop crashed:", err));
routeLoop().catch((err) => console.error("[fake-daemon] route loop crashed:", err));
