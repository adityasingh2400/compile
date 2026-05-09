import { create } from "zustand";
import type {
  BootstrapPhase,
  BootstrapPhaseDoc,
  CallSiteDescriptor,
  ClusterSnapshotDoc,
  LiveMetrics,
  ResultSummary,
  ScanReport,
  SyntheticCell,
  SyntheticRun,
} from "@compile/schemas";
import { PHASE_INDEX } from "@compile/schemas";
import type { VaultCard } from "./demo/fixtures.js";
import type { ResolvedFixtures } from "./demo/snapshot-source.js";
import type { VaultInheritedItem } from "@compile/schemas";

/** Persistent always-on chrome — driven by daemon `uptime_tick`. */
export interface DaemonStateSnapshot {
  uptime_ms: number;
  fires_total: number;
  dollars_saved: number;
  last_fire_ts: string | null;
  connected: boolean;
  /** ISO ts of the last event we received — used for liveness display. */
  last_seen_ts?: string;
}

export interface ObservedClusterState {
  cluster_id: string;
  signature: string;
  sample_count: number;
  threshold: number;
}

export interface ActiveClusterState {
  cluster_id: string;
  signature: string;
  n_samples: number;
}

export interface ActiveSandboxState {
  sandbox_id: string;
  image: string;
  worker_count: number;
}

export interface PhiProgressState {
  sandbox_id: string;
  cluster_id: string;
  calls_done: number;
  calls_total: number;
  throughput_per_sec: number;
  retry_count: number;
}

export interface OracleAgreementState {
  score: number;
  threshold: number;
  decision: "commit" | "decline";
  oracle_samples: number;
}

export interface VaultHitState {
  cluster_id: string;
  inherited_from_session: string;
  prior_compiled_at: string;
  function_name: string;
  routed_in_ms: number;
  dollars_saved_this_hit: number;
}

export interface LastFireState {
  cluster_id: string;
  total_duration_ms: number;
  dollars_saved_this_fire: number;
  vault_key: string;
  tier: "tier_1" | "tier_2" | "tier_3";
  fallback_count: number;
}

export interface FallbackBannerState {
  surface: "sandbox_create" | "run_emitted_function" | "run_phi" | "warm";
  reason: string;
  recovered: boolean;
  ts: string;
  /** Wall-clock ms when the banner should auto-dismiss. */
  expires_at: number;
}

export type AgentLoopBeat = "plan" | "execute" | "reflect" | "recover" | null;

/**
 * Single in-memory store. Mirrors the table shape Convex would surface; the
 * timeline-driver writes through `streamSink` (an IBootstrapStream-shaped
 * thing) so the same code path works against either backend.
 */

export interface DemoState {
  run_id: string;
  phase: BootstrapPhase;
  page_index: number;
  scanReport?: ScanReport;
  callSites: CallSiteDescriptor[];
  /** Pre-baked file list animation for Page 2. */
  scannedFiles: { path: string; lit: boolean; done: boolean; hits: number }[];
  scanCounter: number;
  // Page 4 — Nia docs
  docTokens: { id: string; text: string; x: number; y: number }[];
  seedCount: number;
  // Page 5 — expansion counter
  expandCount: number;
  // Page 6 — constellation
  cells: SyntheticCell[];
  liveMetrics?: LiveMetrics;
  clusterSnapshot?: ClusterSnapshotDoc;
  syntheticRun?: SyntheticRun;
  // Page 8 / 9
  agentCodeRevealed: number; // chars revealed
  agentCodeFull: string;
  validateCells: ("pending" | "pass" | "fail")[];
  validateScore: number;
  // Page 10
  vaultExisting: VaultCard[];
  vaultIncoming?: VaultCard;
  vaultIncomingShrunk: boolean;
  // Page 11
  result?: ResultSummary;
  // operational
  startedAt: number;
  /** Set when an operator manually jumps via hotkey/dev panel; the auto-timeline halts. */
  manualOverride: boolean;
  /** "baked" (default fixtures) or "real" (snapshot from real scanner). */
  fixtures?: ResolvedFixtures;
  // ─── always-on / daemon-driven state ───────────────────────────────
  daemonState: DaemonStateSnapshot;
  inheritedVaultItems: VaultInheritedItem[];
  observedCluster?: ObservedClusterState;
  activeCluster?: ActiveClusterState;
  activeSandbox?: ActiveSandboxState;
  phiProgress?: PhiProgressState;
  oracleAgreement?: OracleAgreementState;
  vaultHit?: VaultHitState;
  lastFire?: LastFireState;
  fallbackBanner?: FallbackBannerState;
  agentLoopBeat: AgentLoopBeat;
}

type Setter = (s: Partial<DemoState> | ((s: DemoState) => Partial<DemoState>)) => void;

interface DemoActions {
  setPhase(doc: BootstrapPhaseDoc): void;
  setScan(report: ScanReport): void;
  setScannedFiles(files: DemoState["scannedFiles"]): void;
  setScannedFile(path: string, patch: Partial<DemoState["scannedFiles"][number]>): void;
  setScanCounter(n: number): void;
  setDocTokens(tokens: DemoState["docTokens"]): void;
  pushDocToken(token: DemoState["docTokens"][number]): void;
  setSeedCount(n: number): void;
  setExpandCount(n: number): void;
  pushCell(cell: SyntheticCell): void;
  setLiveMetrics(m: LiveMetrics): void;
  setClusterSnapshot(s: ClusterSnapshotDoc): void;
  setSyntheticRun(r: SyntheticRun): void;
  setAgentCode(full: string, revealed: number): void;
  setValidateCells(cells: DemoState["validateCells"]): void;
  setValidateScore(n: number): void;
  setVaultExisting(cards: VaultCard[]): void;
  setVaultIncoming(card: VaultCard, shrunk?: boolean): void;
  setResult(r: ResultSummary): void;
  reset(): void;
  jumpToPhase(phase: BootstrapPhase): void;
  setManualOverride(on: boolean): void;
  setFixtures(f: ResolvedFixtures): void;
  // ─── daemon-driven setters ─────────────────────────────────────────
  setDaemonState(s: DaemonStateSnapshot): void;
  setInheritedVaultItems(items: VaultInheritedItem[]): void;
  setObservedCluster(c: ObservedClusterState): void;
  setActiveCluster(c: ActiveClusterState): void;
  setActiveSandbox(s: ActiveSandboxState): void;
  setPhiProgress(p: PhiProgressState): void;
  setOracleAgreement(o: OracleAgreementState): void;
  setVaultHit(v: VaultHitState): void;
  setLastFire(f: LastFireState): void;
  flashFallbackBanner(b: Omit<FallbackBannerState, "expires_at">): void;
  clearFallbackBanner(): void;
  setAgentLoopBeat(b: AgentLoopBeat): void;
}

const initial: DemoState = {
  run_id: "demo_run",
  phase: "connect",
  page_index: 1,
  callSites: [],
  scannedFiles: [],
  scanCounter: 0,
  docTokens: [],
  seedCount: 0,
  expandCount: 0,
  cells: [],
  agentCodeRevealed: 0,
  agentCodeFull: "",
  validateCells: [],
  validateScore: 0,
  vaultExisting: [],
  vaultIncomingShrunk: false,
  startedAt: Date.now(),
  manualOverride: false,
  daemonState: {
    uptime_ms: 0,
    fires_total: 0,
    dollars_saved: 0,
    last_fire_ts: null,
    connected: false,
  },
  inheritedVaultItems: [],
  agentLoopBeat: null,
};

export const useStore = create<DemoState & DemoActions>((set: Setter) => ({
  ...initial,
  setPhase: (doc) =>
    set({ phase: doc.phase, page_index: doc.page_index, run_id: doc.run_id }),
  setScan: (report) =>
    set({ scanReport: report, callSites: report.call_sites }),
  setScannedFiles: (files) => set({ scannedFiles: files }),
  setScannedFile: (path, patch) =>
    set((s) => ({
      scannedFiles: s.scannedFiles.map((f) => (f.path === path ? { ...f, ...patch } : f)),
    })),
  setScanCounter: (n) => set({ scanCounter: n }),
  setDocTokens: (tokens) => set({ docTokens: tokens }),
  pushDocToken: (token) =>
    set((s) =>
      s.docTokens.some((t) => t.id === token.id)
        ? s
        : { docTokens: [...s.docTokens, token] },
    ),
  setSeedCount: (n) => set({ seedCount: n }),
  setExpandCount: (n) => set({ expandCount: n }),
  pushCell: (cell) => set((s) => ({ cells: [...s.cells, cell] })),
  setLiveMetrics: (m) => set({ liveMetrics: m }),
  setClusterSnapshot: (snapshot) => set({ clusterSnapshot: snapshot }),
  setSyntheticRun: (r) => set({ syntheticRun: r }),
  setAgentCode: (full, revealed) =>
    set({ agentCodeFull: full, agentCodeRevealed: revealed }),
  setValidateCells: (cells) => set({ validateCells: cells }),
  setValidateScore: (n) => set({ validateScore: n }),
  setVaultExisting: (cards) => set({ vaultExisting: cards }),
  setVaultIncoming: (card, shrunk = false) =>
    set({ vaultIncoming: card, vaultIncomingShrunk: shrunk }),
  setResult: (r) => set({ result: r }),
  reset: () => set({ ...initial, startedAt: Date.now() }),
  jumpToPhase: (phase) =>
    set({ phase, page_index: PHASE_INDEX[phase] ?? 1, manualOverride: true }),
  setManualOverride: (on) => set({ manualOverride: on }),
  setFixtures: (f) => set({ fixtures: f }),
  setDaemonState: (snapshot) => set({ daemonState: snapshot }),
  setInheritedVaultItems: (items) => set({ inheritedVaultItems: items }),
  setObservedCluster: (c) => set({ observedCluster: c }),
  setActiveCluster: (c) => set({ activeCluster: c }),
  setActiveSandbox: (sb) => set({ activeSandbox: sb }),
  setPhiProgress: (p) => set({ phiProgress: p }),
  setOracleAgreement: (o) => set({ oracleAgreement: o }),
  setVaultHit: (v) => set({ vaultHit: v }),
  setLastFire: (f) => set({ lastFire: f }),
  flashFallbackBanner: (b) =>
    set({ fallbackBanner: { ...b, expires_at: Date.now() + 4500 } }),
  clearFallbackBanner: () => set({ fallbackBanner: undefined }),
  setAgentLoopBeat: (b) => set({ agentLoopBeat: b }),
}));

/** Selector helpers used across pages. */
export const selectActivePage = (s: DemoState) => s.page_index;

// Dev exposure — lets the operator inspect store state from the browser
// console (`window.__compileStore.getState()`). No-op in non-browser builds.
if (typeof window !== "undefined") {
  (window as unknown as { __compileStore: typeof useStore }).__compileStore = useStore;
}
