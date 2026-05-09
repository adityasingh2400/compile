/**
 * Workspace — the post-audit screen.
 *
 * Layout:
 *   ┌─ workspace top bar ───────────────────────────────────────────┐
 *   │  compile / workspace   tabs: [wf1] [wf2] [wf3]   global stats │
 *   ├─ pipeline strip ──────────────────────────────────────────────┤
 *   │   synthesize  ·  codify  ·  productionize                     │
 *   ├─ stage content (full-bleed) ──────────────────────────────────┤
 *   │                                                                │
 *   │           [SynthesisPage | CodificationPage | ProductionPage] │
 *   │                                                                │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * State management:
 *   - The active workflow's pipeline stage drives the page that renders.
 *   - useWorkflowDriver auto-advances each workflow through synthesis →
 *     codification → production once that workflow first becomes active.
 *   - Switching tabs preserves per-workflow state. The driver continues
 *     advancing the currently-active workflow.
 */

import { useEffect, useMemo, useRef } from "react";
import {
  useRedesignStore,
  type PipelineStage,
} from "../data/redesign-store.js";
import {
  CODIFIABLE_WORKFLOWS,
  totalAnnualSavings,
  type Workflow,
} from "../data/workflows.js";
import { SynthesisPage } from "./pages/SynthesisPage.js";
import { CodificationPage } from "./pages/CodificationPage.js";
import { ProductionPage } from "./pages/ProductionPage.js";

const PIPELINE_STAGES: { id: PipelineStage; label: string; sub: string }[] = [
  { id: "synthesis", label: "synthesize", sub: "1,000 grounded inputs · cluster" },
  { id: "codification", label: "codify", sub: "parallel codegen · neo-vault commit" },
  { id: "production", label: "productionize", sub: "user · vault · frontier · output" },
];

/**
 * Per-workflow driver — once a workflow is "armed" (becomes active for
 * the first time), runs the full pipeline timeline. Idempotent: if the
 * driver was previously started for a workflow, it doesn't restart.
 */
export function useWorkflowDriver(): void {
  const activeId = useRedesignStore((s) => s.active_workflow_id);
  const stage = useRedesignStore((s) =>
    activeId ? s.workflows[activeId]?.pipeline ?? "synthesis" : "synthesis",
  );
  const setPipelineStage = useRedesignStore((s) => s.setPipelineStage);
  const patchSynthesis = useRedesignStore((s) => s.patchSynthesis);
  const patchProduction = useRedesignStore((s) => s.patchProduction);
  const startCodifyCluster = useRedesignStore((s) => s.startCodifyCluster);
  const setCodeProgress = useRedesignStore((s) => s.setCodeProgress);
  const commitClusterToVault = useRedesignStore((s) => s.commitClusterToVault);

  const armed = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!activeId) return;
    if (armed.current.has(activeId)) return;
    armed.current.add(activeId);

    const wf = CODIFIABLE_WORKFLOWS.find((w) => w.id === activeId);
    if (!wf) return;

    let cancelled = false;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    (async () => {
      // ── SYNTHESIS ───────────────────────────────────────────────
      setPipelineStage(activeId, "synthesis");
      patchSynthesis(activeId, {
        nodes_emitted: 0,
        clustering: true,
        show_halos: false,
      });
      // Spawn nodes in batches over ~5s.
      const target = wf.visible_node_count;
      const stepMs = 32;
      const totalMs = 5000;
      const stepCount = Math.ceil(totalMs / stepMs);
      const perStep = Math.ceil(target / stepCount);
      let emitted = 0;
      while (emitted < target) {
        if (cancelled) return;
        emitted = Math.min(target, emitted + perStep);
        patchSynthesis(activeId, { nodes_emitted: emitted });
        await sleep(stepMs);
      }
      // Settle and reveal halos.
      await sleep(1700);
      if (cancelled) return;
      patchSynthesis(activeId, { clustering: false });
      await sleep(900);
      if (cancelled) return;
      patchSynthesis(activeId, { show_halos: true });
      await sleep(2400);
      if (cancelled) return;

      // ── CODIFICATION ────────────────────────────────────────────
      setPipelineStage(activeId, "codification");
      // Stagger codegen agent spawn — every 250ms the next cluster
      // begins. They type in parallel; finish times stagger naturally.
      const promises: Promise<void>[] = [];
      for (let i = 0; i < wf.clusters.length; i++) {
        const cluster = wf.clusters[i]!;
        const startDelay = 360 + i * 240;
        promises.push(
          (async () => {
            await sleep(startDelay);
            if (cancelled) return;
            startCodifyCluster(activeId, cluster.cluster_id);
            const code = cluster.codified_handler;
            const totalChars = code.length;
            const typeMs = 4200 + i * 220;
            const tick = 16;
            const charsPerTick = Math.max(
              1,
              Math.ceil(totalChars / (typeMs / tick)),
            );
            let revealed = 0;
            while (revealed < totalChars) {
              if (cancelled) return;
              revealed = Math.min(totalChars, revealed + charsPerTick);
              setCodeProgress(activeId, cluster.cluster_id, revealed);
              await sleep(tick);
            }
            // Brief settle, then commit to vault.
            await sleep(600);
            if (cancelled) return;
            commitClusterToVault(activeId, cluster.cluster_id);
          })(),
        );
      }
      await Promise.all(promises);
      if (cancelled) return;
      await sleep(1700);
      if (cancelled) return;

      // ── PRODUCTION ──────────────────────────────────────────────
      setPipelineStage(activeId, "production");
      patchProduction(activeId, {
        active: true,
        vault_calls: 0,
        frontier_calls: 0,
        dollars_saved: 0,
      });
      // Ramp counters up over ~10s, then keep them ticking.
      const startTs = performance.now();
      const cyclesPerSec = wf.production.calls_per_minute / 60;
      const dollarsPerSec = wf.production.dollars_saved_per_minute / 60;
      while (!cancelled) {
        const elapsed = (performance.now() - startTs) / 1000;
        // Soft ease-in over the first 1.5s.
        const ease = Math.min(1, elapsed / 1.5);
        const total = cyclesPerSec * elapsed * ease;
        const vault = Math.floor(total * wf.production.vault_share);
        const frontier = Math.floor(total * wf.production.frontier_share);
        const dollars = dollarsPerSec * elapsed * ease;
        patchProduction(activeId, {
          vault_calls: vault,
          frontier_calls: frontier,
          dollars_saved: dollars,
        });
        await sleep(140);
      }
    })();

    return () => {
      cancelled = true;
    };
    // We intentionally re-run the driver only when the *active workflow*
    // changes, not when its pipeline stage advances (the inner async
    // walks the stages itself).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  void stage;
}

// ─────────────────────────────────────────────────────────────────────
// Top bar with tabs.

function formatDollars(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

function WorkspaceTabBar(): JSX.Element {
  const activeId = useRedesignStore((s) => s.active_workflow_id);
  const setActive = useRedesignStore((s) => s.setActiveWorkflow);
  const workflowSlices = useRedesignStore((s) => s.workflows);

  return (
    <div className="ws-tabs">
      <div className="ws-tabs-eyebrow">workflows</div>
      <div className="ws-tabs-list">
        {CODIFIABLE_WORKFLOWS.map((wf) => {
          const slice = workflowSlices[wf.id];
          const isActive = activeId === wf.id;
          const stage = slice?.pipeline ?? "synthesis";
          const stageDots = ["synthesis", "codification", "production"].map(
            (s) => {
              const order =
                s === "synthesis" ? 0 : s === "codification" ? 1 : 2;
              const curOrder =
                stage === "synthesis" ? 0 : stage === "codification" ? 1 : 2;
              const status =
                order < curOrder ? "done" : order === curOrder ? "current" : "pending";
              return { stage: s, status };
            },
          );
          return (
            <button
              key={wf.id}
              className={`ws-tab ${wf.tier} ${isActive ? "active" : ""}`}
              onClick={() => setActive(wf.id)}
              title={`${wf.display_name} · ${wf.tier === "tier_1" ? "tier 1" : "tier 2"}`}
            >
              <span className={`tier-tag ${wf.tier}`}>
                {wf.tier === "tier_1" ? "T1" : "T2"}
              </span>
              <span className="fn">{wf.display_name}</span>
              <span className="vol">
                {(wf.monthly_calls / 1000).toFixed(0)}k/mo
              </span>
              <span className="dots">
                {stageDots.map((d, i) => (
                  <span key={i} className={`dot ${d.status}`} />
                ))}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function GlobalSavings(): JSX.Element {
  const totalSavings = useMemo(totalAnnualSavings, []);
  const workflowSlices = useRedesignStore((s) => s.workflows);
  const totalCommitted = useMemo(() => {
    let n = 0;
    for (const id of Object.keys(workflowSlices)) {
      n += workflowSlices[id]!.codification.vault_entries.length;
    }
    return n;
  }, [workflowSlices]);
  const totalClusters = useMemo(
    () =>
      CODIFIABLE_WORKFLOWS.reduce((acc, w) => acc + w.clusters.length, 0),
    [],
  );
  return (
    <div className="ws-global-stats">
      <div className="stat">
        <span className="big">{formatDollars(totalSavings)}</span>
        <span className="lbl">/year codified</span>
      </div>
      <div className="stat">
        <span className="big">
          {totalCommitted}
          <span className="dim"> / {totalClusters}</span>
        </span>
        <span className="lbl">vault entries</span>
      </div>
      <div className="stat">
        <span className="big">{CODIFIABLE_WORKFLOWS.length}</span>
        <span className="lbl">workflows live</span>
      </div>
    </div>
  );
}

function PipelineNav({
  workflow,
  current,
}: {
  workflow: Workflow;
  current: PipelineStage;
}): JSX.Element {
  const setPipelineStage = useRedesignStore((s) => s.setPipelineStage);
  return (
    <div className="ws-pipeline">
      {PIPELINE_STAGES.map((s, i) => {
        const order = i;
        const currentOrder = PIPELINE_STAGES.findIndex(
          (x) => x.id === current,
        );
        const isCurrent = s.id === current;
        const isDone = order < currentOrder;
        return (
          <button
            key={s.id}
            className={`ws-pipeline-step ${isCurrent ? "current" : ""} ${isDone ? "done" : ""}`}
            onClick={() => setPipelineStage(workflow.id, s.id)}
            title={s.sub}
          >
            <span className="num">{(i + 1).toString().padStart(2, "0")}</span>
            <span className="lbl">{s.label}</span>
            <span className="sub">{s.sub}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Top-level Workspace

export function Workspace(): JSX.Element {
  useWorkflowDriver();
  const activeId = useRedesignStore((s) => s.active_workflow_id);
  const stage = useRedesignStore((s) =>
    activeId ? s.workflows[activeId]?.pipeline ?? "synthesis" : "synthesis",
  );
  const workflow =
    CODIFIABLE_WORKFLOWS.find((w) => w.id === activeId) ??
    CODIFIABLE_WORKFLOWS[0]!;

  return (
    <div className="ws-root">
      <div className="ws-top">
        <div className="ws-brand">
          <span className="ws-brand-mark">●</span>
          <b>compile</b>
          <span className="dim">/ workspace</span>
        </div>
        <WorkspaceTabBar />
        <GlobalSavings />
      </div>

      <div className="ws-subtop">
        <div className="ws-subtop-left">
          <span className="dim">workflow</span>
          <span className="ws-workflow-name">{workflow.display_name}</span>
          <span className="dim">·</span>
          <span className="ws-workflow-fn">{workflow.function_name}</span>
          <span className="dim">·</span>
          <span className="ws-workflow-path">{workflow.file_path}</span>
        </div>
        <div className="ws-subtop-right">
          <span className={`tier-tag ${workflow.tier}`}>
            {workflow.tier === "tier_1" ? "T1" : "T2"}
          </span>
          <span className="ws-workflow-prov">{workflow.provider}</span>
          <span className="dim">·</span>
          <span>{workflow.monthly_calls.toLocaleString()} calls/mo</span>
        </div>
      </div>

      <PipelineNav workflow={workflow} current={stage} />

      <div className="ws-stage-area">
        {stage === "synthesis" ? <SynthesisPage workflow={workflow} /> : null}
        {stage === "codification" ? (
          <CodificationPage workflow={workflow} />
        ) : null}
        {stage === "production" ? <ProductionPage workflow={workflow} /> : null}
      </div>
    </div>
  );
}
