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
}));

/** Selector helpers used across pages. */
export const selectActivePage = (s: DemoState) => s.page_index;

// Dev exposure — lets the operator inspect store state from the browser
// console (`window.__compileStore.getState()`). No-op in non-browser builds.
if (typeof window !== "undefined") {
  (window as unknown as { __compileStore: typeof useStore }).__compileStore = useStore;
}
