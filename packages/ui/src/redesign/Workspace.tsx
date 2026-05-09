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

import { useEffect, useMemo } from "react";
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
 * Per-workflow driver. Module-level — survives StrictMode double-mounts
 * and intentionally never cancels mid-flight; the store is the source
 * of truth so even tab switches keep prior workflows progressing.
 *
 * The driver runs each workflow's pipeline END-TO-END once it becomes
 * active for the first time. After audit, the store auto-activates the
 * first workflow → it begins running. As soon as it commits the last
 * cluster, the next workflow auto-arms (so the dashboard cycles through
 * all three workflows without operator input).
 */

const ARMED_WORKFLOWS = new Set<string>();

async function runWorkflowPipeline(workflowId: string): Promise<void> {
  const wf = CODIFIABLE_WORKFLOWS.find((w) => w.id === workflowId);
  if (!wf) return;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const s = () => useRedesignStore.getState();

  // ── SYNTHESIS ─────────────────────────────────────────────────────
  s().setPipelineStage(workflowId, "synthesis");
  s().patchSynthesis(workflowId, {
    nodes_emitted: 0,
    clustering: true,
    show_halos: false,
  });
  const target = wf.visible_node_count;
  const stepMs = 32;
  const totalMs = 4500;
  const stepCount = Math.ceil(totalMs / stepMs);
  const perStep = Math.ceil(target / stepCount);
  let emitted = 0;
  while (emitted < target) {
    emitted = Math.min(target, emitted + perStep);
    s().patchSynthesis(workflowId, { nodes_emitted: emitted });
    await sleep(stepMs);
  }
  await sleep(1300);
  s().patchSynthesis(workflowId, { clustering: false });
  await sleep(800);
  s().patchSynthesis(workflowId, { show_halos: true });
  await sleep(3000);

  // ── CODIFICATION ──────────────────────────────────────────────────
  s().setPipelineStage(workflowId, "codification");
  // Spawn parallel codegen agents. Each runs its own short status
  // walk: queued → analyzing → synthesizing → validating → committing.
  const promises: Promise<void>[] = [];
  for (let i = 0; i < wf.clusters.length; i++) {
    const cluster = wf.clusters[i]!;
    const startDelay = 280 + i * 180;
    promises.push(
      (async () => {
        await sleep(startDelay);
        s().startCodifyCluster(workflowId, cluster.cluster_id);
        // Drive the status progress as a chars counter — same shape so
        // the existing setCodeProgress action works. We map progress
        // to phases on the render side:
        //   0–0.25 analyzing · 0.25–0.55 synthesizing · 0.55–0.85
        //   validating · 0.85–1.0 committing
        const totalSteps = 100;
        const totalMs = 2700 + i * 140;
        const tick = totalMs / totalSteps;
        for (let p = 1; p <= totalSteps; p++) {
          s().setCodeProgress(workflowId, cluster.cluster_id, p);
          await sleep(tick);
        }
        await sleep(280);
        s().commitClusterToVault(workflowId, cluster.cluster_id);
      })(),
    );
  }
  await Promise.all(promises);
  await sleep(1500);

  // ── PRODUCTION ────────────────────────────────────────────────────
  s().setPipelineStage(workflowId, "production");
  s().patchProduction(workflowId, {
    active: true,
    vault_calls: 0,
    frontier_calls: 0,
    dollars_saved: 0,
  });
  const startTs = performance.now();
  const cyclesPerSec = wf.production.calls_per_minute / 60;
  const dollarsPerSec = wf.production.dollars_saved_per_minute / 60;
  // Run production for ~6s, then auto-advance to the next workflow.
  const runForMs = 6000;
  while (performance.now() - startTs < runForMs) {
    const elapsed = (performance.now() - startTs) / 1000;
    const ease = Math.min(1, elapsed / 1.2);
    const total = cyclesPerSec * elapsed * ease;
    const vault = Math.floor(total * wf.production.vault_share);
    const frontier = Math.floor(total * wf.production.frontier_share);
    const dollars = dollarsPerSec * elapsed * ease;
    s().patchProduction(workflowId, {
      vault_calls: vault,
      frontier_calls: frontier,
      dollars_saved: dollars,
    });
    await sleep(140);
  }

  // ── AUTO-ADVANCE TO NEXT WORKFLOW ─────────────────────────────────
  const idx = CODIFIABLE_WORKFLOWS.findIndex((w) => w.id === workflowId);
  const next = CODIFIABLE_WORKFLOWS[idx + 1];
  if (next) {
    s().setActiveWorkflow(next.id);
  } else {
    // Last workflow — keep production looping forever (steady state).
    while (true) {
      const elapsed = (performance.now() - startTs) / 1000;
      const total = cyclesPerSec * elapsed;
      const vault = Math.floor(total * wf.production.vault_share);
      const frontier = Math.floor(total * wf.production.frontier_share);
      const dollars = dollarsPerSec * elapsed;
      s().patchProduction(workflowId, {
        vault_calls: vault,
        frontier_calls: frontier,
        dollars_saved: dollars,
      });
      await sleep(220);
    }
  }
}

export function useWorkflowDriver(): void {
  const activeId = useRedesignStore((s) => s.active_workflow_id);
  useEffect(() => {
    if (!activeId) return;
    if (ARMED_WORKFLOWS.has(activeId)) return;
    ARMED_WORKFLOWS.add(activeId);
    runWorkflowPipeline(activeId).catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[workflow-driver] failed", err);
    });
  }, [activeId]);
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
