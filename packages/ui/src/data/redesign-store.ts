/**
 * Redesign-only zustand store.
 *
 * Lives parallel to the existing `store.ts` so other in-flight UI work
 * (daemon stream, vault hit page, agent loop overlay) keeps working.
 * Once the redesign lands as the canonical UI, the legacy store can
 * be deleted.
 *
 * Drives the high-level state machine:
 *
 *   Audit (single screen)
 *     └─ phases: boot → scanning → classifying → filtering → manifest
 *           └─ transitions into Workspace when "complete"
 *
 *   Workspace (one tab per codifiable workflow)
 *     └─ per-workflow pipeline: synthesis → codification → production
 *
 * Animation is driven by `useWorkflowDriver` (see ../redesign/driver.ts).
 * The store is a passive "what's currently visible" accumulator — every
 * mutation comes from either the driver, or operator hotkeys, or live
 * daemon events (later).
 */

import { create } from "zustand";
import { CODIFIABLE_WORKFLOWS, type AuditCallSite, type Workflow } from "./workflows.js";

export type AuditPhase =
  | "boot"
  | "scanning"
  | "classifying"
  | "filtering"
  | "manifest"
  | "transition"
  | "complete";

export type PipelineStage = "codification" | "vault" | "production";

export interface AuditState {
  phase: AuditPhase;
  /** Lines of boot log emitted so far. */
  boot_lines_emitted: number;
  /** File index up to which scanning has revealed. */
  files_scanned: number;
  /** Counter for "tokens analyzed" — purely visual. */
  ast_tokens_seen: number;
  /** Call sites that have been classified (accumulator, in order). */
  classified: AuditCallSite[];
  /** True when the negative call sites should fade out + codifiable promote. */
  filtered: boolean;
}

export interface SynthesisState {
  /** Number of synthetic nodes currently rendered. */
  nodes_emitted: number;
  /** Whether nodes are still drifting toward cluster centroids (true) or have settled (false). */
  clustering: boolean;
  /** Show the characteristic halo boxes around each cluster centroid. */
  show_halos: boolean;
  /** Highlighted cluster id (for hover / pulse). */
  highlight_cluster_id: string | null;
}

export interface CodificationState {
  /** Cluster ids whose codegen agent is currently typing. */
  active_cluster_ids: string[];
  /** Cluster id → number of characters revealed. */
  code_progress: Record<string, number>;
  /** Cluster ids that have been committed to the vault. */
  vault_entries: string[];
  /** True when every cluster has landed in the vault. */
  all_committed: boolean;
}

export interface ProductionState {
  /** True when traffic particles should animate. */
  active: boolean;
  /** Calls served via the codified path so far in this animation cycle. */
  vault_calls: number;
  /** Calls served via the frontier path. */
  frontier_calls: number;
  /** $ saved counter. */
  dollars_saved: number;
}

/**
 * Real-Tensorlake connection state. Populated by `useTensorlakeStatus`
 * (fetches the static `/tensorlake-status.json` produced by the prewarm
 * CLI) and/or by daemon `sandbox_spawn_start` events. When `connected`
 * is true the audit chrome flips to "LIVE TENSORLAKE" + displays the
 * real sandbox metadata; when false the visuals fall back to canned
 * fixture values so the demo still flows offline.
 */
export interface TensorlakeStatus {
  connected: boolean;
  /** Real `Sandbox.create()` id from Tensorlake. */
  sandbox_id: string | null;
  /** Resolved image name (e.g. `compile-phi-mini` or undefined for default). */
  image: string | null;
  /** Sandbox status: pending|running|terminated|… */
  status: string | null;
  /** Resources reported by the SDK (cpus, memoryMb, diskMb). */
  cpus: number | null;
  memory_mb: number | null;
  /** Tensorlake namespace + project+org IDs (org/project just first 8 chars
   *  for display). */
  namespace: string | null;
  organization_id: string | null;
  project_id: string | null;
  /** Where the sandbox was spawned from. `prewarm` = local CLI, `daemon` =
   *  friend's always-on daemon emitted a sandbox_spawn_start event,
   *  `null` = offline / no signal. */
  source: "prewarm" | "daemon" | null;
  /** ISO timestamp of the sandbox creation. */
  created_at: string | null;
  /** ISO timestamp when the prewarm CLI wrote the status file. */
  fetched_at: string | null;
}

/** Real-Nia connection state — drives the small Nia chrome badge. */
export interface NiaStatus {
  connected: boolean;
  vault_id: string | null;
  /** Total entries currently in the vault (from the prewarm + lookup probe). */
  vault_entries: number | null;
  fetched_at: string | null;
}

export interface WorkflowSlice {
  pipeline: PipelineStage;
  synthesis: SynthesisState;
  codification: CodificationState;
  production: ProductionState;
}

/**
 * Live daemon-driven slice — feeds CodegenPage / VaultPage / RoutingPage.
 * Updated exclusively by `useDaemonEvents` from /daemon/events SSE.
 */
export type CodegenPhase = "idle" | "writing" | "gating" | "done";

export interface LiveCodegenState {
  cluster_id: string | null;
  function_id: string | null;
  /** Accumulated code text from code_chunk events. */
  code: string;
  /** Best-effort total estimate so we can render a typewriter progress bar. */
  total_chars_estimate: number;
  /** Tensorlake holdout gate progress. */
  gate_done: number;
  gate_total: number;
  gate_p50_ms: number;
  phase: CodegenPhase;
}

export interface LiveVaultEntry {
  function_id: string;
  function_name: string;
  cluster_id: string;
  kind: "positive" | "negative";
  tier?: "tier_1" | "tier_2" | "tier_3";
  reason?: string;
  hits_per_day?: number;
  dollars_saved_per_day?: number;
  committed_at: string;
}

export interface LiveVaultState {
  positive: LiveVaultEntry[];
  negative: LiveVaultEntry[];
  /** Currently-flying function (for the in-flight animation). */
  in_flight: { function_id: string; kind: "positive" | "negative" } | null;
}

export interface LiveRouteEvent {
  request_id: string;
  ts: string;
  outcome: "positive" | "negative" | "unknown";
  function_name: string | null;
  latency_ms: number;
  dollars_saved: number;
}

export interface LiveRoutingState {
  /** Recent events (most-recent-first), capped at 80. */
  recent: LiveRouteEvent[];
  counters: { positive: number; negative: number; unknown: number };
  /** Rolling sum of dollars over the lifetime of this stream. */
  dollars_saved_total: number;
  /** Per-second sparkline window — sums of dollars per 1s bucket, last 60s. */
  sparkline: number[];
  /** Smoothed requests-per-minute estimate. */
  rpm: number;
}

export interface LiveState {
  codegen: LiveCodegenState;
  vault: LiveVaultState;
  routing: LiveRoutingState;
}

const blankSynthesis = (): SynthesisState => ({
  nodes_emitted: 0,
  clustering: true,
  show_halos: false,
  highlight_cluster_id: null,
});

const blankCodification = (): CodificationState => ({
  active_cluster_ids: [],
  code_progress: {},
  vault_entries: [],
  all_committed: false,
});

const blankProduction = (): ProductionState => ({
  active: false,
  vault_calls: 0,
  frontier_calls: 0,
  dollars_saved: 0,
});

const blankWorkflow = (): WorkflowSlice => ({
  pipeline: "codification",
  synthesis: blankSynthesis(),
  codification: blankCodification(),
  production: blankProduction(),
});

export interface RedesignState {
  ui_stage: "landing" | "audit" | "workspace";
  audit: AuditState;
  active_workflow_id: string | null;
  workflows: Record<string, WorkflowSlice>;
  tensorlake: TensorlakeStatus;
  nia: NiaStatus;
  live: LiveState;

  // Actions
  setUiStage(stage: "landing" | "audit" | "workspace"): void;
  setAuditPhase(phase: AuditPhase): void;
  bumpBootLines(): void;
  setFilesScanned(n: number): void;
  bumpAstTokens(n: number): void;
  pushClassified(site: AuditCallSite): void;
  setFiltered(on: boolean): void;
  setActiveWorkflow(id: string): void;
  setPipelineStage(workflowId: string, stage: PipelineStage): void;
  patchSynthesis(workflowId: string, patch: Partial<SynthesisState>): void;
  patchCodification(
    workflowId: string,
    patch: Partial<CodificationState> | ((prev: CodificationState) => Partial<CodificationState>),
  ): void;
  patchProduction(workflowId: string, patch: Partial<ProductionState>): void;
  startCodifyCluster(workflowId: string, clusterId: string): void;
  setCodeProgress(workflowId: string, clusterId: string, chars: number): void;
  commitClusterToVault(workflowId: string, clusterId: string): void;
  setTensorlakeStatus(patch: Partial<TensorlakeStatus>): void;
  setNiaStatus(patch: Partial<NiaStatus>): void;

  // Live daemon-event reducers (used by useDaemonEvents).
  liveCodeChunk(args: { cluster_id: string; chunk: string; cursor: number; total_chars_estimate: number }): void;
  liveCodeComplete(args: { cluster_id: string; function_id: string; code: string }): void;
  liveGateProgress(args: { cluster_id: string; holdout_done: number; holdout_total: number; latency_ms_p50: number }): void;
  liveVaultWriteStart(args: { function_id: string; kind: "positive" | "negative" }): void;
  liveVaultWriteCommitted(args: {
    function_id: string;
    cluster_id: string;
    kind: "positive" | "negative";
    tier?: "tier_1" | "tier_2" | "tier_3";
    reason?: string;
    ts: string;
  }): void;
  liveRouteResolved(args: {
    request_id: string;
    ts: string;
    outcome: "positive" | "negative" | "unknown";
    function_name: string | null;
    latency_ms: number;
    dollars_saved: number;
  }): void;

  resetAll(): void;
}

const initialAudit = (): AuditState => ({
  phase: "boot",
  boot_lines_emitted: 0,
  files_scanned: 0,
  ast_tokens_seen: 0,
  classified: [],
  filtered: false,
});

function initialWorkflows(): Record<string, WorkflowSlice> {
  const slices: Record<string, WorkflowSlice> = {};
  for (const w of CODIFIABLE_WORKFLOWS) slices[w.id] = blankWorkflow();
  return slices;
}

const initialTensorlake = (): TensorlakeStatus => ({
  connected: false,
  sandbox_id: null,
  image: null,
  status: null,
  cpus: null,
  memory_mb: null,
  namespace: null,
  organization_id: null,
  project_id: null,
  source: null,
  created_at: null,
  fetched_at: null,
});

const initialNia = (): NiaStatus => ({
  connected: false,
  vault_id: null,
  vault_entries: null,
  fetched_at: null,
});

const initialLive = (): LiveState => ({
  codegen: {
    cluster_id: null,
    function_id: null,
    code: "",
    total_chars_estimate: 1,
    gate_done: 0,
    gate_total: 200,
    gate_p50_ms: 0,
    phase: "idle",
  },
  vault: {
    positive: [],
    negative: [],
    in_flight: null,
  },
  routing: {
    recent: [],
    counters: { positive: 0, negative: 0, unknown: 0 },
    dollars_saved_total: 0,
    sparkline: new Array(60).fill(0),
    rpm: 0,
  },
});

/** Pseudo-deterministic per-day hit count + savings for positive vault cards. */
function synthesizeHitMetrics(functionId: string): { hits: number; dollars: number } {
  let h = 0;
  for (let i = 0; i < functionId.length; i++) h = (h * 31 + functionId.charCodeAt(i)) | 0;
  const seed = Math.abs(h);
  const hits = 800 + (seed % 4400);
  const dollars = 12 + (seed % 90);
  return { hits, dollars };
}

export const useRedesignStore = create<RedesignState>((set) => ({
  ui_stage: "landing",
  audit: initialAudit(),
  active_workflow_id: CODIFIABLE_WORKFLOWS[0]?.id ?? null,
  workflows: initialWorkflows(),
  tensorlake: initialTensorlake(),
  nia: initialNia(),
  live: initialLive(),

  setUiStage: (stage) => set({ ui_stage: stage }),
  setAuditPhase: (phase) =>
    set((s) => ({ audit: { ...s.audit, phase } })),
  bumpBootLines: () =>
    set((s) => ({
      audit: { ...s.audit, boot_lines_emitted: s.audit.boot_lines_emitted + 1 },
    })),
  setFilesScanned: (n) =>
    set((s) => ({ audit: { ...s.audit, files_scanned: n } })),
  bumpAstTokens: (n) =>
    set((s) => ({
      audit: { ...s.audit, ast_tokens_seen: s.audit.ast_tokens_seen + n },
    })),
  pushClassified: (site) =>
    set((s) => ({
      audit: {
        ...s.audit,
        classified: s.audit.classified.some((c) => c.call_site_id === site.call_site_id)
          ? s.audit.classified
          : [...s.audit.classified, site],
      },
    })),
  setFiltered: (on) => set((s) => ({ audit: { ...s.audit, filtered: on } })),
  setActiveWorkflow: (id) => set({ active_workflow_id: id }),
  setPipelineStage: (workflowId, stage) =>
    set((s) => ({
      workflows: {
        ...s.workflows,
        [workflowId]: { ...(s.workflows[workflowId] ?? blankWorkflow()), pipeline: stage },
      },
    })),
  patchSynthesis: (workflowId, patch) =>
    set((s) => {
      const cur = s.workflows[workflowId] ?? blankWorkflow();
      return {
        workflows: {
          ...s.workflows,
          [workflowId]: {
            ...cur,
            synthesis: { ...cur.synthesis, ...patch },
          },
        },
      };
    }),
  patchCodification: (workflowId, patch) =>
    set((s) => {
      const cur = s.workflows[workflowId] ?? blankWorkflow();
      const next = typeof patch === "function" ? patch(cur.codification) : patch;
      return {
        workflows: {
          ...s.workflows,
          [workflowId]: {
            ...cur,
            codification: { ...cur.codification, ...next },
          },
        },
      };
    }),
  patchProduction: (workflowId, patch) =>
    set((s) => {
      const cur = s.workflows[workflowId] ?? blankWorkflow();
      return {
        workflows: {
          ...s.workflows,
          [workflowId]: {
            ...cur,
            production: { ...cur.production, ...patch },
          },
        },
      };
    }),
  startCodifyCluster: (workflowId, clusterId) =>
    set((s) => {
      const cur = s.workflows[workflowId] ?? blankWorkflow();
      if (cur.codification.active_cluster_ids.includes(clusterId)) {
        return s;
      }
      return {
        workflows: {
          ...s.workflows,
          [workflowId]: {
            ...cur,
            codification: {
              ...cur.codification,
              active_cluster_ids: [
                ...cur.codification.active_cluster_ids,
                clusterId,
              ],
            },
          },
        },
      };
    }),
  setCodeProgress: (workflowId, clusterId, chars) =>
    set((s) => {
      const cur = s.workflows[workflowId] ?? blankWorkflow();
      return {
        workflows: {
          ...s.workflows,
          [workflowId]: {
            ...cur,
            codification: {
              ...cur.codification,
              code_progress: {
                ...cur.codification.code_progress,
                [clusterId]: chars,
              },
            },
          },
        },
      };
    }),
  commitClusterToVault: (workflowId, clusterId) =>
    set((s) => {
      const cur = s.workflows[workflowId] ?? blankWorkflow();
      if (cur.codification.vault_entries.includes(clusterId)) return s;
      const wf = CODIFIABLE_WORKFLOWS.find((w) => w.id === workflowId);
      const totalClusters = wf?.clusters.length ?? 0;
      const newEntries = [...cur.codification.vault_entries, clusterId];
      return {
        workflows: {
          ...s.workflows,
          [workflowId]: {
            ...cur,
            codification: {
              ...cur.codification,
              vault_entries: newEntries,
              all_committed: newEntries.length >= totalClusters,
            },
          },
        },
      };
    }),
  setTensorlakeStatus: (patch) =>
    set((s) => ({ tensorlake: { ...s.tensorlake, ...patch } })),
  setNiaStatus: (patch) =>
    set((s) => ({ nia: { ...s.nia, ...patch } })),

  liveCodeChunk: ({ cluster_id, chunk, cursor, total_chars_estimate }) =>
    set((s) => {
      // First chunk for a new cluster — reset the codegen slice.
      const newCluster = s.live.codegen.cluster_id !== cluster_id;
      const code = newCluster ? chunk : s.live.codegen.code + chunk;
      return {
        live: {
          ...s.live,
          codegen: {
            ...(newCluster
              ? { ...initialLive().codegen, cluster_id, function_id: null }
              : s.live.codegen),
            code,
            total_chars_estimate,
            phase: "writing",
          },
        },
      };
    }),

  liveCodeComplete: ({ cluster_id, function_id, code }) =>
    set((s) => ({
      live: {
        ...s.live,
        codegen: {
          ...s.live.codegen,
          cluster_id,
          function_id,
          code,
          total_chars_estimate: code.length,
          phase: "gating",
        },
      },
    })),

  liveGateProgress: ({ cluster_id, holdout_done, holdout_total, latency_ms_p50 }) =>
    set((s) => {
      // Ignore gate ticks for clusters we haven't started yet.
      if (s.live.codegen.cluster_id && s.live.codegen.cluster_id !== cluster_id) return s;
      return {
        live: {
          ...s.live,
          codegen: {
            ...s.live.codegen,
            cluster_id,
            gate_done: holdout_done,
            gate_total: holdout_total,
            gate_p50_ms: latency_ms_p50,
            phase: holdout_done >= holdout_total ? "done" : "gating",
          },
        },
      };
    }),

  liveVaultWriteStart: ({ function_id, kind }) =>
    set((s) => ({
      live: {
        ...s.live,
        vault: { ...s.live.vault, in_flight: { function_id, kind } },
      },
    })),

  liveVaultWriteCommitted: ({ function_id, cluster_id, kind, tier, reason, ts }) =>
    set((s) => {
      // Derive a friendly function name from the function_id ("fn_<name>_<rand>")
      const parts = function_id.split("_");
      const fnName = parts.length >= 3 ? parts.slice(1, -1).join("_") : function_id;
      const { hits, dollars } = synthesizeHitMetrics(function_id);
      const entry: LiveVaultEntry = {
        function_id,
        function_name: fnName,
        cluster_id,
        kind,
        tier,
        reason,
        hits_per_day: kind === "positive" ? hits : undefined,
        dollars_saved_per_day: kind === "positive" ? dollars : undefined,
        committed_at: ts,
      };
      const positive =
        kind === "positive" && !s.live.vault.positive.some((e) => e.function_id === function_id)
          ? [entry, ...s.live.vault.positive].slice(0, 12)
          : s.live.vault.positive;
      const negative =
        kind === "negative" && !s.live.vault.negative.some((e) => e.function_id === function_id)
          ? [entry, ...s.live.vault.negative].slice(0, 8)
          : s.live.vault.negative;
      return {
        live: {
          ...s.live,
          vault: { positive, negative, in_flight: null },
        },
      };
    }),

  liveRouteResolved: (ev) =>
    set((s) => {
      const cur = s.live.routing;
      const recent = [{ ...ev }, ...cur.recent].slice(0, 80);
      const counters = {
        ...cur.counters,
        [ev.outcome]: cur.counters[ev.outcome] + 1,
      };
      const dollars_saved_total = cur.dollars_saved_total + ev.dollars_saved;
      // Sparkline: drop a tick into the most-recent bucket, age the rest by
      // shifting once per second of clock skew vs. the last observed event.
      const sparkline = [...cur.sparkline];
      sparkline[sparkline.length - 1] = (sparkline[sparkline.length - 1] ?? 0) + ev.dollars_saved;
      // Approximate rpm from recent buffer span.
      let rpm = cur.rpm;
      if (recent.length >= 10) {
        const first = new Date(recent[recent.length - 1]!.ts).getTime();
        const last = new Date(recent[0]!.ts).getTime();
        const span_s = Math.max((last - first) / 1000, 0.001);
        rpm = Math.round((recent.length / span_s) * 60);
      }
      return {
        live: {
          ...s.live,
          routing: { recent, counters, dollars_saved_total, sparkline, rpm },
        },
      };
    }),

  resetAll: () =>
    set((s) => ({
      ui_stage: "landing",
      audit: initialAudit(),
      active_workflow_id: CODIFIABLE_WORKFLOWS[0]?.id ?? null,
      workflows: initialWorkflows(),
      // Don't blow away the live-status read; once we know real Tensorlake
      // is connected, a UI reset shouldn't fall back to "no signal" — the
      // sandbox is still running on Tensorlake's side.
      tensorlake: s.tensorlake,
      nia: s.nia,
      // Live daemon state survives resets too — it's not part of the
      // demo timeline, it's reflecting what the real backend is doing.
      live: s.live,
    })),
}));

/** Convenience hook — workflow slice for the active tab. */
export function useActiveWorkflow(): {
  workflow: Workflow | null;
  slice: WorkflowSlice | null;
} {
  const id = useRedesignStore((s) => s.active_workflow_id);
  const slice = useRedesignStore((s) =>
    id ? s.workflows[id] ?? null : null,
  );
  if (!id) return { workflow: null, slice: null };
  const workflow = CODIFIABLE_WORKFLOWS.find((w) => w.id === id) ?? null;
  return { workflow, slice };
}

// Dev exposure for debugging in the browser console.
if (typeof window !== "undefined") {
  (window as unknown as { __redesignStore: typeof useRedesignStore }).__redesignStore =
    useRedesignStore;
}
