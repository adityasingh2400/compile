/**
 * Unified-dashboard store. Different conceptual shape than the
 * 11-phase bootstrap store: four canvas-shaped stages, three
 * production workflows in tabs, and per-workflow progress for
 * each stage so flipping tabs preserves animation state.
 */
import { create } from "zustand";
import { WORKFLOWS, type Workflow, type WorkflowCluster } from "./demo/workflows.js";

export type Stage = "audit" | "cluster" | "codify" | "route";

export const STAGES: Stage[] = ["audit", "cluster", "codify", "route"];

/** Per-cluster codegen "agent" running in parallel on Stage 3. */
export interface CodegenAgent {
  cluster_id: string;
  /** Display name of the function-branch the agent is writing. */
  label: string;
  /** Which workflow's cluster the agent belongs to. */
  workflow_id: string;
  /** 0..1 progress through the agent's allotted work. */
  progress: number;
  /** Lines of typed-TS the agent has emitted so far. */
  lines_emitted: number;
  /** Once the agent commits, the entry shows up in the vault. */
  status: "idle" | "running" | "vault_committed";
}

/** Per-workflow Stage-2 progress — drives the constellation animation. */
export interface ClusterProgress {
  workflow_id: string;
  /** Number of synthetic-call nodes spawned so far (target ≈ 800). */
  nodes_emitted: number;
  /** 0..1 — when 1.0, force simulation is settled and clusters are revealed. */
  cohesion: number;
  /** Whether each cluster's characteristics box is visible yet. */
  cluster_revealed: Record<string, boolean>;
}

/** Per-workflow Stage-3 progress. */
export interface CodifyProgress {
  workflow_id: string;
  agents: CodegenAgent[];
  /** Cluster-IDs that have already shipped to the Neo Vault. */
  vault_committed: string[];
}

/** Per-workflow Stage-4 traffic flow. */
export interface RouteProgress {
  workflow_id: string;
  /** 0..1 — fraction of the steady-state traffic currently animating. */
  flow_intensity: number;
  /** Live-counter of dollars saved this minute (for the meter). */
  saved_per_minute_usd: number;
  /** Calls processed by tier in the last simulated minute. */
  per_minute_tier_1: number;
  per_minute_tier_2: number;
  per_minute_tier_3: number;
}

export interface UnifiedAuditState {
  /** Files the AST scanner has crossed over so far. */
  files_scanned: { path: string; lit: boolean; done: boolean; sites: number }[];
  /** Sites the scanner has surfaced — animated tier-decision badges. */
  sites_decided: Array<{
    source_name: string;
    file_path: string;
    decision: "tier_1" | "tier_2" | "tier_3";
    /** True once the audit stage has dispatched this site to its destination
     *  (codifiable workflow tab or negative-vault). */
    placed: boolean;
  }>;
  /** Whether the audit terminal is "running" (cursor blinking). */
  running: boolean;
}

export interface UnifiedDemoState {
  /** Which stage the canvas is currently rendering. */
  stage: Stage;
  /** Tab selection — which workflow's data the canvas is showing. */
  active_workflow_id: string;
  /** All workflows, fixed once at boot. */
  workflows: Workflow[];

  audit: UnifiedAuditState;

  /** Per-workflow stage state, keyed by workflow_id. */
  cluster: Record<string, ClusterProgress>;
  codify: Record<string, CodifyProgress>;
  route: Record<string, RouteProgress>;

  /** Daemon meta — kept for the top-right header strip. */
  daemon: {
    connected: boolean;
    uptime_ms: number;
    fires_total: number;
    dollars_saved: number;
    last_fire_ts: string | null;
  };

  /** Operator manually advanced — pause auto-timeline. */
  manual_override: boolean;
}

interface Actions {
  setStage(stage: Stage): void;
  setActiveWorkflow(id: string): void;
  setManualOverride(on: boolean): void;
  // audit
  setAuditFile(path: string, patch: Partial<UnifiedAuditState["files_scanned"][number]>): void;
  setAuditFiles(files: UnifiedAuditState["files_scanned"]): void;
  pushAuditDecision(d: UnifiedAuditState["sites_decided"][number]): void;
  markAuditPlaced(source_name: string): void;
  setAuditRunning(running: boolean): void;
  // cluster
  setClusterNodesEmitted(workflow_id: string, n: number): void;
  setClusterCohesion(workflow_id: string, c: number): void;
  revealCluster(workflow_id: string, cluster_id: string): void;
  // codify
  setCodifyAgents(workflow_id: string, agents: CodegenAgent[]): void;
  setCodifyAgent(
    workflow_id: string,
    cluster_id: string,
    patch: Partial<CodegenAgent>,
  ): void;
  commitVaultEntry(workflow_id: string, cluster_id: string): void;
  // route
  setRouteFlow(workflow_id: string, intensity: number): void;
  setRouteCounters(
    workflow_id: string,
    counters: Partial<Pick<RouteProgress, "saved_per_minute_usd" | "per_minute_tier_1" | "per_minute_tier_2" | "per_minute_tier_3">>,
  ): void;
  // daemon
  setDaemon(d: Partial<UnifiedDemoState["daemon"]>): void;

  reset(): void;
}

function emptyClusterProgress(w: Workflow): ClusterProgress {
  return {
    workflow_id: w.id,
    nodes_emitted: 0,
    cohesion: 0,
    cluster_revealed: Object.fromEntries(
      w.clusters.map((c) => [c.id, false]),
    ),
  };
}

function emptyCodifyProgress(w: Workflow): CodifyProgress {
  return {
    workflow_id: w.id,
    agents: w.clusters.map((c: WorkflowCluster) => ({
      cluster_id: c.id,
      label: c.label,
      workflow_id: w.id,
      progress: 0,
      lines_emitted: 0,
      status: "idle" as const,
    })),
    vault_committed: [],
  };
}

function emptyRouteProgress(w: Workflow): RouteProgress {
  return {
    workflow_id: w.id,
    flow_intensity: 0,
    saved_per_minute_usd: 0,
    per_minute_tier_1: 0,
    per_minute_tier_2: 0,
    per_minute_tier_3: 0,
  };
}

const initial: UnifiedDemoState = {
  stage: "audit",
  active_workflow_id: WORKFLOWS[0]!.id,
  workflows: WORKFLOWS,

  audit: {
    files_scanned: [],
    sites_decided: [],
    running: false,
  },

  cluster: Object.fromEntries(WORKFLOWS.map((w) => [w.id, emptyClusterProgress(w)])),
  codify: Object.fromEntries(WORKFLOWS.map((w) => [w.id, emptyCodifyProgress(w)])),
  route: Object.fromEntries(WORKFLOWS.map((w) => [w.id, emptyRouteProgress(w)])),

  daemon: {
    connected: false,
    uptime_ms: 0,
    fires_total: 0,
    dollars_saved: 0,
    last_fire_ts: null,
  },

  manual_override: false,
};

export const useUnifiedStore = create<UnifiedDemoState & Actions>((set) => ({
  ...initial,

  setStage: (stage) => set({ stage }),
  setActiveWorkflow: (id) => set({ active_workflow_id: id }),
  setManualOverride: (on) => set({ manual_override: on }),

  setAuditFile: (path, patch) =>
    set((s) => ({
      audit: {
        ...s.audit,
        files_scanned: s.audit.files_scanned.map((f) =>
          f.path === path ? { ...f, ...patch } : f,
        ),
      },
    })),
  setAuditFiles: (files) =>
    set((s) => ({ audit: { ...s.audit, files_scanned: files } })),
  pushAuditDecision: (d) =>
    set((s) =>
      s.audit.sites_decided.some((x) => x.source_name === d.source_name)
        ? s
        : {
            audit: {
              ...s.audit,
              sites_decided: [...s.audit.sites_decided, d],
            },
          },
    ),
  markAuditPlaced: (source_name) =>
    set((s) => ({
      audit: {
        ...s.audit,
        sites_decided: s.audit.sites_decided.map((d) =>
          d.source_name === source_name ? { ...d, placed: true } : d,
        ),
      },
    })),
  setAuditRunning: (running) =>
    set((s) => ({ audit: { ...s.audit, running } })),

  setClusterNodesEmitted: (workflow_id, n) =>
    set((s) => ({
      cluster: {
        ...s.cluster,
        [workflow_id]: {
          ...(s.cluster[workflow_id] ??
            emptyClusterProgress(s.workflows.find((w) => w.id === workflow_id)!)),
          nodes_emitted: n,
        },
      },
    })),
  setClusterCohesion: (workflow_id, c) =>
    set((s) => ({
      cluster: {
        ...s.cluster,
        [workflow_id]: {
          ...(s.cluster[workflow_id] ??
            emptyClusterProgress(s.workflows.find((w) => w.id === workflow_id)!)),
          cohesion: c,
        },
      },
    })),
  revealCluster: (workflow_id, cluster_id) =>
    set((s) => {
      const cur =
        s.cluster[workflow_id] ??
        emptyClusterProgress(s.workflows.find((w) => w.id === workflow_id)!);
      return {
        cluster: {
          ...s.cluster,
          [workflow_id]: {
            ...cur,
            cluster_revealed: { ...cur.cluster_revealed, [cluster_id]: true },
          },
        },
      };
    }),

  setCodifyAgents: (workflow_id, agents) =>
    set((s) => ({
      codify: {
        ...s.codify,
        [workflow_id]: {
          ...(s.codify[workflow_id] ??
            emptyCodifyProgress(s.workflows.find((w) => w.id === workflow_id)!)),
          agents,
        },
      },
    })),
  setCodifyAgent: (workflow_id, cluster_id, patch) =>
    set((s) => {
      const cur =
        s.codify[workflow_id] ??
        emptyCodifyProgress(s.workflows.find((w) => w.id === workflow_id)!);
      return {
        codify: {
          ...s.codify,
          [workflow_id]: {
            ...cur,
            agents: cur.agents.map((a) =>
              a.cluster_id === cluster_id ? { ...a, ...patch } : a,
            ),
          },
        },
      };
    }),
  commitVaultEntry: (workflow_id, cluster_id) =>
    set((s) => {
      const cur =
        s.codify[workflow_id] ??
        emptyCodifyProgress(s.workflows.find((w) => w.id === workflow_id)!);
      if (cur.vault_committed.includes(cluster_id)) return s;
      return {
        codify: {
          ...s.codify,
          [workflow_id]: {
            ...cur,
            vault_committed: [...cur.vault_committed, cluster_id],
            agents: cur.agents.map((a) =>
              a.cluster_id === cluster_id ? { ...a, status: "vault_committed", progress: 1 } : a,
            ),
          },
        },
      };
    }),

  setRouteFlow: (workflow_id, intensity) =>
    set((s) => ({
      route: {
        ...s.route,
        [workflow_id]: {
          ...(s.route[workflow_id] ??
            emptyRouteProgress(s.workflows.find((w) => w.id === workflow_id)!)),
          flow_intensity: intensity,
        },
      },
    })),
  setRouteCounters: (workflow_id, counters) =>
    set((s) => ({
      route: {
        ...s.route,
        [workflow_id]: {
          ...(s.route[workflow_id] ??
            emptyRouteProgress(s.workflows.find((w) => w.id === workflow_id)!)),
          ...counters,
        },
      },
    })),

  setDaemon: (d) =>
    set((s) => ({ daemon: { ...s.daemon, ...d } })),

  reset: () =>
    set(() => ({
      ...initial,
      // re-init keyed maps so each fresh reset gives clean per-workflow state
      cluster: Object.fromEntries(
        WORKFLOWS.map((w) => [w.id, emptyClusterProgress(w)]),
      ),
      codify: Object.fromEntries(
        WORKFLOWS.map((w) => [w.id, emptyCodifyProgress(w)]),
      ),
      route: Object.fromEntries(
        WORKFLOWS.map((w) => [w.id, emptyRouteProgress(w)]),
      ),
    })),
}));

// Browser console hook for inspection
if (typeof window !== "undefined") {
  (window as unknown as { __unifiedStore: typeof useUnifiedStore }).__unifiedStore = useUnifiedStore;
}
