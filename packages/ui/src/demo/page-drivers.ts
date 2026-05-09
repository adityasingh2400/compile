/**
 * Per-page idempotent content drivers. When the operator jumps to a phase
 * mid-demo (via hotkey or the dev panel), we still want the phase to look
 * "live" — typewriter running, validate ticking, vault card animating.
 *
 * These drivers run on phase entry. If the relevant content slot is already
 * populated (e.g. agentCodeFull already set by the main timeline), they
 * no-op so we don't restart an in-flight animation.
 */
import type { useStore } from "../store.js";
import {
  DEMO_AGENT_CODE,
  DEMO_CALL_SITES,
  DEMO_DOC_TOKENS,
  DEMO_FILES,
  DEMO_RESULT,
  DEMO_SCAN_REPORT,
  DEMO_VAULT_EXISTING,
  DEMO_VAULT_NEW,
  HERO_CALL_SITE_ID,
  HERO_CLUSTERS,
} from "./fixtures.js";
import type { SyntheticCell } from "@compile/schemas";

type GetState = typeof useStore.getState;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function ensurePhaseContent(
  phase: string,
  getState: GetState,
): Promise<void> {
  switch (phase) {
    case "reading_code":
      return ensureScan(getState);
    case "classify":
      return ensureScan(getState);
    case "reading_docs":
      return ensureDocs(getState);
    case "expanding":
      return ensureExpand(getState);
    case "stress_test":
    case "clusters_revealed":
      return ensureCells(getState);
    case "agent_writing":
      await ensureCells(getState);
      return ensureAgentCode(getState);
    case "validate":
      return ensureValidate(getState);
    case "vault_write":
      return ensureVault(getState);
    case "result":
      return ensureResult(getState);
  }
}

async function ensureScan(getState: GetState): Promise<void> {
  if (getState().callSites.length > 0) return;
  const fx = getState().fixtures;
  if (fx && fx.source === "real") {
    getState().setScan({
      scanned_at: new Date().toISOString(),
      repo_path: "data/acme-agent",
      files_scanned: fx.files.length,
      call_sites: fx.callSites,
      tree_signature: "live",
    });
    getState().setScannedFiles(
      fx.files.map((f) => ({ ...f, lit: false, done: true })),
    );
  } else {
    getState().setScan(DEMO_SCAN_REPORT);
    getState().setScannedFiles(
      DEMO_FILES.map((f) => ({ ...f, lit: false, done: true })),
    );
  }
  getState().setScanCounter(getState().callSites.length);
}

async function ensureDocs(getState: GetState): Promise<void> {
  // Skip when timeline is mid-flight to avoid clobbering in-progress animation
  if (getState().docTokens.length > 0) return;
  const tokens = DEMO_DOC_TOKENS.map((text, i) => ({
    id: `t${i}`,
    text,
    x: 8 + (i % 6) * 14,
    y: 30 + Math.floor(i / 6) * 8,
  }));
  getState().setDocTokens(tokens);
  getState().setSeedCount(100);
}

async function ensureExpand(getState: GetState): Promise<void> {
  if (getState().expandCount >= 100_000) return;
  getState().setExpandCount(100_000);
}

async function ensureCells(getState: GetState): Promise<void> {
  // Skip if we already have a substantial population (timeline filled them in)
  if (getState().cells.length >= 1500) return;
  const fx = getState().fixtures;
  // If we have real recorded cells, replay them but pad up to 4500 by
  // resampling with cluster preservation so the constellation looks dense.
  if (fx?.recordedCells && fx.recordedCells.length > 0) {
    for (const c of fx.recordedCells) getState().pushCell(c);
    const padTarget = 4500 - getState().cells.length;
    for (let i = 0; i < padTarget; i++) {
      const seed = fx.recordedCells[i % fx.recordedCells.length]!;
      getState().pushCell({
        ...seed,
        input_id: `pad_${i}`,
        worker_id: i % 64,
      });
    }
    return;
  }
  // Bulk-seed enough cells so the constellation is visually full when jumped to
  const needed = 4500 - getState().cells.length;
  for (let i = 0; i < needed; i++) {
    const cluster = pickCluster();
    const cell: SyntheticCell = {
      input_id: `i_${i}`,
      worker_id: i % 64,
      status: "done",
      path: Math.random() < 0.01 ? "oracle" : "candidate",
      tier_assigned: cluster.tier,
      cluster_id: cluster.cluster_id,
      latency_ms: 30,
      cost_usd: 0.0001,
    };
    getState().pushCell(cell);
  }
  getState().setLiveMetrics({
    run_id: getState().run_id,
    call_site_id: HERO_CALL_SITE_ID,
    total_done: 100_000,
    oracle_done: 1_000,
    candidate_done: 99_000,
    throughput_per_sec: 3_571,
    tier_mix: { tier_1: 94_840, tier_2: 5_160, tier_3: 0 },
    axis_scores: {
      schema_stability: 0.984,
      determinism: 0.991,
      oracle_agreement: 0.946,
      economic_value: {
        monthly_calls: 252_000,
        annual_savings_usd: 31_200,
        break_even_hits: 4,
        synthesis_cost_usd: 1.5,
        maintenance_cost_usd: 50,
      },
    } as never,
    updated_at: new Date().toISOString(),
  });
}

async function ensureAgentCode(getState: GetState): Promise<void> {
  if (getState().agentCodeFull) return; // already populated
  // Run the typewriter
  const full = DEMO_AGENT_CODE;
  getState().setAgentCode(full, 0);
  await sleep(2400); // wait for envelope to fly
  const totalChars = full.length;
  const totalMs = 18_000;
  const charsPerTick = Math.ceil(totalChars / (totalMs / 16));
  let revealed = 0;
  while (revealed < totalChars) {
    revealed = Math.min(totalChars, revealed + charsPerTick);
    getState().setAgentCode(full, revealed);
    await sleep(16);
    if (getState().phase !== "agent_writing") return; // user jumped away
  }
}

async function ensureValidate(getState: GetState): Promise<void> {
  if (getState().validateCells.length > 0) return;
  const N = 100;
  const cells: ("pending" | "pass" | "fail")[] = Array.from({ length: N }, () => "pending");
  getState().setValidateCells([...cells]);
  let pass = 0;
  for (let i = 0; i < N; i++) {
    const isPass = Math.random() > 0.013;
    cells[i] = isPass ? "pass" : "fail";
    if (isPass) pass++;
    if (i % 4 === 0) {
      getState().setValidateCells([...cells]);
      getState().setValidateScore(Math.round((pass / (i + 1)) * 1000) / 10);
    }
    await sleep(40);
    if (getState().phase !== "validate") return;
  }
  getState().setValidateCells([...cells]);
  getState().setValidateScore(98.7);
}

async function ensureVault(getState: GetState): Promise<void> {
  if (getState().vaultIncoming) return;
  getState().setVaultExisting(DEMO_VAULT_EXISTING);
  getState().setVaultIncoming(DEMO_VAULT_NEW, false);
  await sleep(1400);
  if (getState().phase !== "vault_write") return;
  getState().setVaultIncoming(DEMO_VAULT_NEW, true);
}

async function ensureResult(getState: GetState): Promise<void> {
  if (getState().result) return;
  getState().setResult(DEMO_RESULT);
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

// Re-export DEMO_CALL_SITES so tests can confirm the fixture is current
export { DEMO_CALL_SITES };
