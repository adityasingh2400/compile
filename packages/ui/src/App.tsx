import { useEffect } from "react";
import { UnifiedDashboard } from "./components/unified/UnifiedDashboard.js";
import {
  runUnifiedTimeline,
  runFakeDaemonMeta,
} from "./demo/unified-timeline.js";
import { useUnifiedStore, STAGES } from "./unified-store.js";

/**
 * App shell — boots the unified-dashboard timeline + fake daemon
 * meta, then renders the single-canvas observation surface.
 *
 * The earlier 11-page PowerPoint flow has been retired in favor of
 * a single dashboard with four canvas-shaped stages
 * (audit → cluster → codify → route) plus workflow tabs.
 */
export function App(): JSX.Element {
  const setStage = useUnifiedStore((s) => s.setStage);
  const setActive = useUnifiedStore((s) => s.setActiveWorkflow);
  const setManualOverride = useUnifiedStore((s) => s.setManualOverride);
  const reset = useUnifiedStore((s) => s.reset);

  useEffect(() => {
    const t = runUnifiedTimeline();
    const d = runFakeDaemonMeta();
    return () => {
      t.stop();
      d.stop();
    };
  }, []);

  // operator hotkeys — sane to keep for live demos
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        const cur = useUnifiedStore.getState().stage;
        const idx = STAGES.indexOf(cur);
        const next = STAGES[Math.min(STAGES.length - 1, idx + 1)];
        if (next) {
          setManualOverride(true);
          setStage(next);
        }
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        const cur = useUnifiedStore.getState().stage;
        const idx = STAGES.indexOf(cur);
        const prev = STAGES[Math.max(0, idx - 1)];
        if (prev) {
          setManualOverride(true);
          setStage(prev);
        }
      } else if (e.key === "r" || e.key === "R") {
        reset();
        // restart the timeline
        const t = runUnifiedTimeline();
        // intentionally don't return cleanup — timeline manages itself.
        void t;
      } else if (e.key === "1" || e.key === "2" || e.key === "3") {
        const i = parseInt(e.key, 10) - 1;
        const w = useUnifiedStore.getState().workflows[i];
        if (w) {
          setManualOverride(true);
          setActive(w.id);
        }
      } else if (e.key >= "4" && e.key <= "7") {
        // 4..7 maps to stages 1..4 (audit/cluster/codify/route)
        const i = parseInt(e.key, 10) - 4;
        const target = STAGES[i];
        if (target) {
          setManualOverride(true);
          setStage(target);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [reset, setActive, setManualOverride, setStage]);

  return <UnifiedDashboard />;
}
