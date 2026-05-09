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
import { CodegenLivePage } from "./pages/CodegenLivePage.js";
import { VaultLivePage } from "./pages/VaultLivePage.js";
import { RoutingLivePage } from "./pages/RoutingLivePage.js";

const PIPELINE_STAGES: { id: PipelineStage; label: string; sub: string }[] = [
  { id: "codification", label: "codify", sub: "agent writes · tensorlake gate" },
  { id: "vault", label: "vault", sub: "positive · negative · in-flight" },
  { id: "production", label: "route", sub: "live request flow · 3 lanes" },
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

export function resetWorkflowDriver(): void {
  ARMED_WORKFLOWS.clear();
}

async function runWorkflowPipeline(workflowId: string): Promise<void> {
  const wf = CODIFIABLE_WORKFLOWS.find((w) => w.id === workflowId);
  if (!wf) return;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const s = () => useRedesignStore.getState();

  // ── CODIFY (page 4) ───────────────────────────────────────────────
  // Each page renders fullscreen and auto-advances. Live data on each
  // page comes from daemon SSE (live.codegen / live.vault / live.routing).
  // The driver here just paces the dwell so judges read each page
  // without clicking. Hotkeys (q/w/e and arrows) still work as override.
  s().setPipelineStage(workflowId, "codification");
  await sleep(16_000);

  // ── VAULT (page 5) ────────────────────────────────────────────────
  // Classification sequence runs ~1.9s × 7 items = ~13s. Add breathing
  // room so the last entry settles before we move on.
  s().setPipelineStage(workflowId, "vault");
  await sleep(16_000);

  // ── ROUTE (page 6) ────────────────────────────────────────────────
  // Steady state. Stay here forever — this is the closing page of the
  // demo. The live ticker keeps moving, judges can keep watching.
  s().setPipelineStage(workflowId, "production");
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
    activeId ? s.workflows[activeId]?.pipeline ?? "codification" : "codification",
  );
  const workflow =
    CODIFIABLE_WORKFLOWS.find((w) => w.id === activeId) ??
    CODIFIABLE_WORKFLOWS[0]!;

  const totalSavings = useMemo(totalAnnualSavings, []);

  return (
    <div className="ws-root">
      <div className="ws-top-min">
        <div className="ws-top-left">
          <span className="ws-brand-mark">●</span>
          <b>compile</b>
          <span className="dim">/ {workflow.function_name}</span>
        </div>
        <div className="ws-top-right">
          <span className="ws-top-stat-num">{formatDollars(totalSavings)}</span>
          <span className="ws-top-stat-lbl">/year codified</span>
        </div>
      </div>

      <div className="ws-stage-area">
        {stage === "codification" ? (
          <CodegenLivePage workflow={workflow} />
        ) : null}
        {stage === "vault" ? <VaultLivePage workflow={workflow} /> : null}
        {stage === "production" ? <RoutingLivePage workflow={workflow} /> : null}
      </div>
    </div>
  );
}
