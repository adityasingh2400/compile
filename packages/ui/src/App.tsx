/**
 * Compile redesign — App shell.
 *
 * Two top-level stages, driven by the redesign store's `ui_stage`:
 *
 *   audit        →  full-screen Tensorlake sandbox + repo audit animation.
 *                   When the audit completes, ui_stage flips to "workspace"
 *                   and the audit screen folds out.
 *   workspace    →  per-workflow tabbed flow. Each tab walks through
 *                   synthesis → codification → production via
 *                   useWorkflowDriver().
 *
 * Keyboard shortcuts (when not focused in an input):
 *
 *   1 / 2 / 3      switch active workflow tab
 *   ← / →          step pipeline stage backward / forward within active tab
 *   q / w / e      jump directly to synthesis / codification / production
 *   r              reset everything → audit
 *
 * Note: this redesign supersedes the legacy 11-page Dashboard. A
 * parallel `components/unified/*` implementation (built by another agent
 * in the same session) is left in tree but not mounted here.
 */

import { useEffect } from "react";
import {
  useRedesignStore,
  type PipelineStage,
} from "./data/redesign-store.js";
import { CODIFIABLE_WORKFLOWS } from "./data/workflows.js";
import { AuditStage } from "./redesign/AuditStage.js";
import { Workspace } from "./redesign/Workspace.js";

const PIPELINE_ORDER: PipelineStage[] = [
  "synthesis",
  "codification",
  "production",
];

export function App(): JSX.Element {
  const stage = useRedesignStore((s) => s.ui_stage);
  const auditPhase = useRedesignStore((s) => s.audit.phase);
  const setActiveWorkflow = useRedesignStore((s) => s.setActiveWorkflow);
  const setPipelineStage = useRedesignStore((s) => s.setPipelineStage);
  const resetAll = useRedesignStore((s) => s.resetAll);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.target instanceof HTMLTextAreaElement) return;
      const state = useRedesignStore.getState();
      const activeId = state.active_workflow_id;
      const slice = activeId ? state.workflows[activeId] : null;
      const cur = slice?.pipeline ?? "synthesis";

      if (e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key, 10) - 1;
        const wf = CODIFIABLE_WORKFLOWS[idx];
        if (wf) {
          e.preventDefault();
          setActiveWorkflow(wf.id);
        }
        return;
      }

      if (e.key === "ArrowRight") {
        if (!activeId) return;
        const i = PIPELINE_ORDER.indexOf(cur);
        const next = PIPELINE_ORDER[Math.min(PIPELINE_ORDER.length - 1, i + 1)];
        if (next) {
          e.preventDefault();
          setPipelineStage(activeId, next);
        }
        return;
      }
      if (e.key === "ArrowLeft") {
        if (!activeId) return;
        const i = PIPELINE_ORDER.indexOf(cur);
        const prev = PIPELINE_ORDER[Math.max(0, i - 1)];
        if (prev) {
          e.preventDefault();
          setPipelineStage(activeId, prev);
        }
        return;
      }
      if (e.key === "q" || e.key === "Q") {
        if (activeId) {
          e.preventDefault();
          setPipelineStage(activeId, "synthesis");
        }
        return;
      }
      if (e.key === "w" || e.key === "W") {
        if (activeId) {
          e.preventDefault();
          setPipelineStage(activeId, "codification");
        }
        return;
      }
      if (e.key === "e" || e.key === "E") {
        if (activeId) {
          e.preventDefault();
          setPipelineStage(activeId, "production");
        }
        return;
      }
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        resetAll();
        return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setActiveWorkflow, setPipelineStage, resetAll]);

  const showAudit = stage === "audit" || auditPhase === "transition";
  const showWorkspace = stage === "workspace";
  const folding = auditPhase === "transition";

  return (
    <div className="rd-app">
      {showAudit ? (
        <div className={`rd-audit-layer ${folding ? "folding-out" : ""}`}>
          <AuditStage />
        </div>
      ) : null}
      {showWorkspace ? (
        <div className="rd-workspace-layer">
          <Workspace />
        </div>
      ) : null}
      <div className="rd-hotkeys">
        <span>tabs</span>
        <kbd>1</kbd>
        <kbd>2</kbd>
        <kbd>3</kbd>
        <span className="sep">·</span>
        <span>stages</span>
        <kbd>←</kbd>
        <kbd>→</kbd>
        <span className="sep">·</span>
        <span>jump</span>
        <kbd>q</kbd>
        <kbd>w</kbd>
        <kbd>e</kbd>
        <span className="sep">·</span>
        <span>reset</span>
        <kbd>r</kbd>
      </div>
    </div>
  );
}
