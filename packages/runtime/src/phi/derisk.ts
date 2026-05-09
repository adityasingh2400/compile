/**
 * Friday Derisk #2 — Phi-3-mini cold-start verification.
 *
 * Pass criteria from ENG_REVIEW.md:184:
 *   "Cold start ≤ 10s OR persistent caching works."
 *
 * What this script measures:
 *   1. Cold start: evict the model, then time warmup() to first-token-ready.
 *   2. Warm path: 20× generate() on a fixed Tier-2-shaped prompt, log
 *      firstTokenMs and end-to-end latency. p50/p95 reported.
 *   3. Keep-alive after idle: sleep N seconds, generate again, confirm
 *      the model didn't get evicted (keep_alive default = 10m).
 *
 * Run from the runtime package: `tsx src/phi/derisk.ts`.
 */

import { OllamaPhiClient } from "./ollama.js";

const TIER2_PROMPT = `You score a sales lead for ICP fit. Return JSON only.

Lead:
  company: "Acme Robotics"
  size: "120 employees"
  industry: "industrial automation"
  signal: "downloaded our pricing page twice in 3 days"

Return: {"icp_fit": "yes" | "no" | "maybe", "confidence": 0.0-1.0, "reason": string}`;

const COLD_START_BUDGET_MS = 10_000;
const WARM_LATENCY_BUDGET_MS = 3_000;
const N_WARM_RUNS = Number(process.env.PHI_WARM_RUNS ?? 20);
const KEEP_ALIVE_PROBE_DELAY_MS = Number(
  process.env.PHI_IDLE_MS ?? 30_000,
);

interface RunStats {
  p50: number;
  p95: number;
  mean: number;
  min: number;
  max: number;
}

function stats(samples: number[]): RunStats {
  if (samples.length === 0) {
    return { p50: 0, p95: 0, mean: 0, min: 0, max: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const pct = (p: number): number => {
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx] ?? 0;
  };
  return {
    p50: pct(50),
    p95: pct(95),
    mean: samples.reduce((a, b) => a + b, 0) / samples.length,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

async function evict(client: OllamaPhiClient): Promise<void> {
  await fetch(`${client.baseUrl}/api/generate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: client.model,
      prompt: "",
      keep_alive: 0,
      stream: false,
    }),
  }).catch(() => {});
}

async function main(): Promise<void> {
  const model = process.env.PHI_MODEL ?? "phi3:mini";
  const baseUrl = process.env.OLLAMA_URL ?? "http://localhost:11434";
  const client = new OllamaPhiClient({ baseUrl, model });

  console.log(`[derisk] target: ${baseUrl} model=${model}`);
  const health = await client.health();
  if (!health.alive) {
    console.error(
      `[derisk] FAIL — ollama not reachable at ${baseUrl}. Run: ollama serve &`,
    );
    process.exit(2);
  }

  console.log("[derisk] phase 1: cold start");
  await evict(client);
  const cold = await client.warmup();
  console.log(
    `  warmup: ready=${cold.ready} latency=${cold.latencyMs.toFixed(0)}ms`,
  );
  if (!cold.ready) {
    console.error("[derisk] FAIL — model not ready after warmup");
    process.exit(2);
  }
  const coldGen = await client.generate({ prompt: TIER2_PROMPT, maxTokens: 80 });
  console.log(
    `  cold generate: e2e=${coldGen.latencyMs.toFixed(0)}ms firstToken=${coldGen.firstTokenMs.toFixed(0)}ms tokens=${coldGen.completionTokens}`,
  );

  console.log(`[derisk] phase 2: warm path × ${N_WARM_RUNS}`);
  const e2e: number[] = [];
  const firstToken: number[] = [];
  for (let i = 0; i < N_WARM_RUNS; i++) {
    const r = await client.generate({ prompt: TIER2_PROMPT, maxTokens: 80 });
    e2e.push(r.latencyMs);
    firstToken.push(r.firstTokenMs);
  }
  const e2eS = stats(e2e);
  const ftS = stats(firstToken);
  console.log(
    `  e2e:        p50=${e2eS.p50.toFixed(0)} p95=${e2eS.p95.toFixed(0)} mean=${e2eS.mean.toFixed(0)} ms`,
  );
  console.log(
    `  firstToken: p50=${ftS.p50.toFixed(0)} p95=${ftS.p95.toFixed(0)} mean=${ftS.mean.toFixed(0)} ms`,
  );

  console.log(`[derisk] phase 3: keep-alive (${KEEP_ALIVE_PROBE_DELAY_MS}ms idle)`);
  await new Promise((r) => setTimeout(r, KEEP_ALIVE_PROBE_DELAY_MS));
  const post = await client.generate({ prompt: TIER2_PROMPT, maxTokens: 80 });
  console.log(
    `  post-idle: e2e=${post.latencyMs.toFixed(0)}ms firstToken=${post.firstTokenMs.toFixed(0)}ms`,
  );

  const coldOk = cold.latencyMs <= COLD_START_BUDGET_MS;
  const warmOk = e2eS.p95 <= WARM_LATENCY_BUDGET_MS;
  const keepAliveOk = post.latencyMs <= e2eS.p95 * 2;

  // ENG_REVIEW.md:184 — pass criterion is
  //   "Cold start ≤10s OR persistent caching works"
  // i.e. either cold start fits the budget, OR pre-warm + keep-alive (D6)
  // empirically holds. Warm p95 is a separate must-pass for the demo budget.
  const persistentCachingWorks = keepAliveOk;
  const overall = (coldOk || persistentCachingWorks) && warmOk;

  console.log("\n=== VERDICT ===");
  console.log(
    `cold start (${cold.latencyMs.toFixed(0)}ms ≤ ${COLD_START_BUDGET_MS}ms): ${coldOk ? "PASS" : "FAIL"}`,
  );
  console.log(
    `warm p95   (${e2eS.p95.toFixed(0)}ms ≤ ${WARM_LATENCY_BUDGET_MS}ms): ${warmOk ? "PASS" : "FAIL"}`,
  );
  console.log(
    `keep-alive (post-idle ${post.latencyMs.toFixed(0)}ms ≤ 2× warm p95, idle=${KEEP_ALIVE_PROBE_DELAY_MS}ms): ${keepAliveOk ? "PASS" : "FAIL"}`,
  );
  console.log(
    `gate: (cold OR keep-alive) AND warm — ${overall ? "PASS" : "FAIL"}`,
  );
  if (!coldOk && persistentCachingWorks) {
    console.log(
      "  → cold start over budget; D6 mitigation (pre-warm 10 min before demo + keep-alive) is mandatory.",
    );
  }
  process.exit(overall ? 0 : 1);
}

main().catch((e) => {
  console.error("[derisk] crash:", e);
  process.exit(2);
});
