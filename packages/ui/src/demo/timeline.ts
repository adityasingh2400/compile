import type { SyntheticCell } from "@compile/schemas";
import { PHASE_INDEX, type BootstrapPhase } from "@compile/schemas";
import {
  DEMO_AGENT_CODE,
  DEMO_DOC_TOKENS,
  DEMO_RESULT,
  DEMO_RUN_ID,
  DEMO_SCAN_REPORT,
  DEMO_VAULT_EXISTING,
  DEMO_VAULT_NEW,
  HERO_CALL_SITE_ID,
  HERO_CLUSTERS,
} from "./fixtures.js";
import type { useStore } from "../store.js";

type GetState = typeof useStore.getState;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Total cells we render on the constellation. The real backend runs 100K;
 *  the visible canvas extrapolates ~6K animated points, which is plenty for
 *  the visual without thrashing the GPU. The on-screen counter still rolls
 *  to 100K (DESIGN.md hero — the count, not the dot count, is the spectacle). */
const VISIBLE_CELLS = 6000;
const NARRATIVE_CELLS = 100_000;

/**
 * Drives the entire 11-page demo. Calls `setPhase`-shaped store actions in
 * timed sequence — analogous to phase writes from the real backend over
 * Convex. Total wall time ≈ 90 seconds when run end-to-end.
 *
 * Built so each phase is independently demoable (jump-buttons in dev controls)
 * — every action sets a complete coherent state for its page.
 */
export async function runDemoTimeline(getState: GetState): Promise<void> {
  const advance = (phase: BootstrapPhase) => {
    if (getState().manualOverride) throw new Error("manual_override");
    const now = new Date().toISOString();
    getState().setPhase({
      run_id: DEMO_RUN_ID,
      phase,
      page_index: PHASE_INDEX[phase],
      started_at: now,
      updated_at: now,
      current_call_site_id: HERO_CALL_SITE_ID,
    });
  };
  try {
    await runTimelineInner(getState, advance);
  } catch (err) {
    if (err instanceof Error && err.message === "manual_override") return;
    throw err;
  }
}

async function runTimelineInner(
  getState: GetState,
  advance: (phase: BootstrapPhase) => void,
): Promise<void> {

  // Page 1 — CONNECT (≈ 3.5s)
  advance("connect");
  await sleep(3500);

  // Page 2 — READING YOUR CODE (≈ 4.5s)
  advance("reading_code");
  const fxAvail = getState().fixtures;
  if (fxAvail && fxAvail.source === "real") {
    // Use the real scanner output stuffed into a ScanReport-shaped doc.
    getState().setScan({
      scanned_at: new Date().toISOString(),
      repo_path: "data/acme-agent",
      files_scanned: fxAvail.files.length,
      call_sites: fxAvail.callSites,
      tree_signature: "live",
    });
  } else {
    getState().setScan(DEMO_SCAN_REPORT);
  }
  const filesActual = fxAvail?.files ?? [
    { path: "src/icp.ts", hits: 5 },
    { path: "src/ops.ts", hits: 5 },
    { path: "src/utils/parse.ts", hits: 0 },
    { path: "src/utils/format.ts", hits: 0 },
    { path: "src/index.ts", hits: 0 },
    { path: "src/router.ts", hits: 0 },
    { path: "package.json", hits: 0 },
    { path: "tsconfig.json", hits: 0 },
    { path: "docs/icp.md", hits: 0 },
    { path: "docs/pricing.md", hits: 0 },
  ];
  const files = filesActual.map((f) => ({ ...f, lit: false, done: false }));
  getState().setScannedFiles(files);
  let runningCount = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i]!;
    getState().setScannedFile(f.path, { lit: true });
    await sleep(140);
    getState().setScannedFile(f.path, { lit: false, done: true });
    runningCount += f.hits;
    getState().setScanCounter(runningCount);
    await sleep(120);
  }
  await sleep(400);

  // Page 3 — CLASSIFY (≈ 5s)
  advance("classify");
  // animation of pills falling into buckets is purely CSS-driven from the
  // call-site list already in the store
  await sleep(5000);

  // Page 4 — READING YOUR DOCS (≈ 5s)
  advance("reading_docs");
  getState().setDocTokens([]);
  getState().setSeedCount(0);
  for (let i = 0; i < DEMO_DOC_TOKENS.length; i++) {
    const text = DEMO_DOC_TOKENS[i]!;
    // floating tokens land near the seed pool counter at the top
    const x = 8 + (i % 6) * 14 + (Math.random() - 0.5) * 4;
    const y = 30 + Math.floor(i / 6) * 8 + (Math.random() - 0.5) * 4;
    getState().pushDocToken({ id: `t${i}`, text, x, y });
    getState().setSeedCount(Math.min(100, (i + 1) * Math.ceil(100 / DEMO_DOC_TOKENS.length)));
    await sleep(160);
  }
  getState().setSeedCount(100);
  await sleep(700);

  // Page 5 — EXPANDING TO 100,000 (≈ 3.5s)
  advance("expanding");
  const expandTargets = [100, 1_000, 10_000, 100_000];
  for (const t of expandTargets) {
    getState().setExpandCount(t);
    await sleep(700);
  }
  await sleep(400);

  // Page 6 — STRESS TEST · CONSTELLATION (≈ 28s)
  advance("stress_test");
  await runConstellationStream(getState);

  // Page 7 — CLUSTERS REVEALED (≈ 4s)
  advance("clusters_revealed");
  await sleep(4000);

  // Page 8 — THE AGENT WRITES THE CODE (≈ 22s)
  advance("agent_writing");
  await typewriterAgentCode(getState);

  // Page 9 — VALIDATE (≈ 5s)
  advance("validate");
  await runValidate(getState);

  // Page 10 — VAULT WRITE (≈ 4s)
  advance("vault_write");
  getState().setVaultExisting(DEMO_VAULT_EXISTING);
  getState().setVaultIncoming(DEMO_VAULT_NEW, false);
  await sleep(1400);
  getState().setVaultIncoming(DEMO_VAULT_NEW, true);
  await sleep(2000);

  // Page 11 — RESULT
  advance("result");
  getState().setResult(DEMO_RESULT);
}

async function runConstellationStream(getState: GetState): Promise<void> {
  const t0 = performance.now();
  const totalDurationMs = 28_000;
  const cellsPerBatch = 80;
  const batchIntervalMs = 32; // ~30 batches/sec
  const expectedBatches = Math.floor(totalDurationMs / batchIntervalMs);
  const cellsPerBatchAdjusted = Math.ceil(VISIBLE_CELLS / expectedBatches);
  let emitted = 0;
  let narrative = 0;
  // narrative counter rises faster than visible — caps at 100K
  const narrativeStep = Math.ceil(NARRATIVE_CELLS / expectedBatches);

  while (performance.now() - t0 < totalDurationMs && emitted < VISIBLE_CELLS) {
    const batchSize = Math.min(cellsPerBatchAdjusted, VISIBLE_CELLS - emitted);
    for (let i = 0; i < batchSize; i++) {
      const cluster = pickCluster();
      const cell: SyntheticCell = {
        input_id: `i_${emitted + i}`,
        worker_id: (emitted + i) % 64,
        status: "done",
        path: Math.random() < 0.01 ? "oracle" : "candidate",
        tier_assigned: cluster.tier,
        cluster_id: cluster.cluster_id,
        latency_ms: 30 + Math.random() * 20,
        cost_usd: 0.0001,
      };
      getState().pushCell(cell);
    }
    emitted += batchSize;
    narrative = Math.min(NARRATIVE_CELLS, narrative + narrativeStep);

    const elapsedSec = Math.max(0.001, (performance.now() - t0) / 1000);
    const tier_mix = countTierMix(getState().cells);
    getState().setLiveMetrics({
      run_id: getState().run_id,
      call_site_id: HERO_CALL_SITE_ID,
      total_done: narrative,
      oracle_done: Math.floor(narrative * 0.01),
      candidate_done: narrative - Math.floor(narrative * 0.01),
      throughput_per_sec: Math.round(narrative / elapsedSec),
      tier_mix,
      axis_scores: {
        schema_stability: clamp01(0.6 + (emitted / VISIBLE_CELLS) * 0.39),
        determinism: clamp01(0.6 + (emitted / VISIBLE_CELLS) * 0.39),
        oracle_agreement: clamp01(0.55 + (emitted / VISIBLE_CELLS) * 0.4),
        economic_value: {
          monthly_calls: 252_000,
          annual_savings_usd: 31_200,
          break_even_hits: 4,
          synthesis_cost_usd: 1.5,
          maintenance_cost_usd: 50,
        },
      } as any,
      updated_at: new Date().toISOString(),
    });
    await sleep(batchIntervalMs);
  }
}

function pickCluster(): (typeof HERO_CLUSTERS)[number] {
  const r = Math.random();
  let acc = 0;
  for (const c of HERO_CLUSTERS) {
    acc += c.share;
    if (r < acc) return c;
  }
  return HERO_CLUSTERS[HERO_CLUSTERS.length - 1]!;
}

function countTierMix(cells: SyntheticCell[]): { tier_1: number; tier_2: number; tier_3: number } {
  const out = { tier_1: 0, tier_2: 0, tier_3: 0 };
  for (const c of cells) {
    if (c.tier_assigned === "tier_1") out.tier_1++;
    else if (c.tier_assigned === "tier_2") out.tier_2++;
    else if (c.tier_assigned === "tier_3") out.tier_3++;
  }
  return out;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

async function typewriterAgentCode(getState: GetState): Promise<void> {
  const full = DEMO_AGENT_CODE;
  getState().setAgentCode(full, 0);
  const totalChars = full.length;
  const totalMs = 22_000;
  const charsPerTick = Math.ceil(totalChars / (totalMs / 16));
  let revealed = 0;
  while (revealed < totalChars) {
    revealed = Math.min(totalChars, revealed + charsPerTick + Math.floor(Math.random() * 2));
    getState().setAgentCode(full, revealed);
    await sleep(16);
  }
  await sleep(800);
}

async function runValidate(getState: GetState): Promise<void> {
  const N = 100;
  const cells: ("pending" | "pass" | "fail")[] = Array.from({ length: N }, () => "pending");
  getState().setValidateCells([...cells]);
  let pass = 0;
  let fail = 0;
  for (let i = 0; i < N; i++) {
    const isPass = Math.random() > 0.013; // ≈ 98.7% pass
    cells[i] = isPass ? "pass" : "fail";
    if (isPass) pass++;
    else fail++;
    if (i % 4 === 0) {
      getState().setValidateCells([...cells]);
      const score = Math.round((pass / (i + 1)) * 1000) / 10;
      getState().setValidateScore(score);
    }
    await sleep(40);
  }
  getState().setValidateCells([...cells]);
  getState().setValidateScore(98.7);
  await sleep(900);
}
