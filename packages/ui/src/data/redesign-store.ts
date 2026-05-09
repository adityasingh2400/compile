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

export type PipelineStage = "synthesis" | "codification" | "production";

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

export interface WorkflowSlice {
  pipeline: PipelineStage;
  synthesis: SynthesisState;
  codification: CodificationState;
  production: ProductionState;
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
  pipeline: "synthesis",
  synthesis: blankSynthesis(),
  codification: blankCodification(),
  production: blankProduction(),
});

export interface RedesignState {
  ui_stage: "audit" | "workspace";
  audit: AuditState;
  active_workflow_id: string | null;
  workflows: Record<string, WorkflowSlice>;

  // Actions
  setUiStage(stage: "audit" | "workspace"): void;
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

export const useRedesignStore = create<RedesignState>((set) => ({
  ui_stage: "audit",
  audit: initialAudit(),
  active_workflow_id: CODIFIABLE_WORKFLOWS[0]?.id ?? null,
  workflows: initialWorkflows(),

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
  resetAll: () =>
    set({
      ui_stage: "audit",
      audit: initialAudit(),
      active_workflow_id: CODIFIABLE_WORKFLOWS[0]?.id ?? null,
      workflows: initialWorkflows(),
    }),
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
