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

const PORT = Number(process.env.PORT ?? 8421);
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
      vault_key: "vault://acme/lead_tier_v3",
      cluster_id: "cluster_lead_tier",
      function_name: "classifyLeadTier",
      compiled_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      calls_saved: 18_400,
      dollars_saved: 27_600,
      tier: "tier_1",
    },
    {
      vault_key: "vault://acme/invoice_extract_v2",
      cluster_id: "cluster_invoice_fields",
      function_name: "extractInvoiceFields",
      compiled_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      calls_saved: 9_300,
      dollars_saved: 14_900,
      tier: "tier_1",
    },
    {
      vault_key: "vault://acme/support_summary_v1",
      cluster_id: "cluster_support_thread",
      function_name: "summarizeSupportThread",
      compiled_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      calls_saved: 4_100,
      dollars_saved: 6_500,
      tier: "tier_2",
    },
    {
      vault_key: "vault://acme/domain_resolve_v4",
      cluster_id: "cluster_domain_resolve",
      function_name: "resolveCompanyDomain",
      compiled_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      calls_saved: 11_800,
      dollars_saved: 16_900,
      tier: "tier_1",
    },
    {
      vault_key: "vault://acme/competitor_research_v1",
      cluster_id: "cluster_competitor_research",
      function_name: "researchCompetitor",
      compiled_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      calls_saved: 720,
      dollars_saved: 880,
      tier: "tier_2",
    },
    {
      vault_key: "vault://acme/lead_score_v1",
      cluster_id: "cluster_lead_score",
      function_name: "computeLeadScore",
      compiled_at: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
      calls_saved: 2_100,
      dollars_saved: 3_200,
      tier: "tier_1",
    },
    {
      vault_key: "vault://acme/intent_classify_v2",
      cluster_id: "cluster_intent_classify",
      function_name: "classifyIntent",
      compiled_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
      calls_saved: 380,
      dollars_saved: 520,
      tier: "tier_2",
    },
  ],
};

const FAN_OUT_CLUSTERS = [
  { id: "cluster_lead_score_v2", fn: "computeLeadScore", sig: "anthropic|leadScore_v2|tools=0", samples: 50 },
  { id: "cluster_email_intent_v1", fn: "classifyEmailIntent", sig: "anthropic|emailIntent_v1|tools=0", samples: 50 },
];
const VAULT_HIT_CLUSTERS = [
  {
    id: "cluster_lead_tier",
    fn: "classifyLeadTier",
    sig: "anthropic|leadTier_v3|tools=0",
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
    vault_key: `vault://acme/${cluster.fn}_v1`,
    tier: "tier_1",
    fallback_count: didFallback ? 1 : 0,
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
    vault_key: `vault://acme/${cluster.fn}_v3`,
    tier: "tier_1",
    fallback_count: 0,
  });
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

async function fireLoop() {
  // Brief boot delay so judges see "fixture mode → live" transition.
  await sleep(2000);
  while (true) {
    cycleCounter++;
    if (cycleCounter % 2 === 0) {
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

uptimeLoop().catch((err) => console.error("[fake-daemon] uptime loop crashed:", err));
fireLoop().catch((err) => console.error("[fake-daemon] fire loop crashed:", err));
