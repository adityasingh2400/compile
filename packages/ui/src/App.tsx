import { useEffect, useState } from "react";
import { useStore } from "./store.js";
import { runDemoTimeline } from "./demo/timeline.js";
import { ensurePhaseContent } from "./demo/page-drivers.js";
import { resolveFixtures } from "./demo/snapshot-source.js";
import { ConnectPage } from "./pages/ConnectPage.js";
import { ReadingCodePage } from "./pages/ReadingCodePage.js";
import { ClassifyPage } from "./pages/ClassifyPage.js";
import { ReadingDocsPage } from "./pages/ReadingDocsPage.js";
import { ExpandingPage } from "./pages/ExpandingPage.js";
import { StressTestPage } from "./pages/StressTestPage.js";
import { ClustersRevealedPage } from "./pages/ClustersRevealedPage.js";
import { AgentWritesPage } from "./pages/AgentWritesPage.js";
import { ValidatePage } from "./pages/ValidatePage.js";
import { VaultWritePage } from "./pages/VaultWritePage.js";
import { ResultPage } from "./pages/ResultPage.js";
import { PersistentConstellation } from "./components/PersistentConstellation.js";
import {
  BOOTSTRAP_PHASES,
  PHASE_INDEX,
  type BootstrapPhase,
} from "@compile/schemas";

const PAGE_COMPONENT: Record<BootstrapPhase, React.ComponentType> = {
  connect: ConnectPage,
  reading_code: ReadingCodePage,
  classify: ClassifyPage,
  reading_docs: ReadingDocsPage,
  expanding: ExpandingPage,
  stress_test: StressTestPage,
  clusters_revealed: ClustersRevealedPage,
  agent_writing: AgentWritesPage,
  validate: ValidatePage,
  vault_write: VaultWritePage,
  result: ResultPage,
};

const PAGE_LABEL: Record<BootstrapPhase, string> = {
  connect: "CONNECT",
  reading_code: "READING YOUR CODE",
  classify: "CLASSIFY · CODIFIABILITY DECIDED",
  reading_docs: "READING YOUR DOCS",
  expanding: "EXPANDING TO 100,000",
  stress_test: "STRESS TEST · CONSTELLATION",
  clusters_revealed: "CLUSTERS REVEALED",
  agent_writing: "THE AGENT WRITES THE CODE",
  validate: "VALIDATE",
  vault_write: "VAULT WRITE",
  result: "RESULT",
};

const CONSTELLATION_PHASES: BootstrapPhase[] = [
  "stress_test",
  "clusters_revealed",
  "agent_writing",
];

export function App(): JSX.Element {
  const phase = useStore((s) => s.phase);
  const pageIndex = useStore((s) => s.page_index);
  const cells = useStore((s) => s.cells);
  const reset = useStore((s) => s.reset);
  const jumpToPhase = useStore((s) => s.jumpToPhase);
  const [showOps, setShowOps] = useState(false);

  // resolve data source first (baked fixtures vs real scanner snapshot),
  // then start the timeline.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fx = await resolveFixtures();
      if (cancelled) return;
      useStore.getState().setFixtures(fx);
      setTimeout(() => {
        runDemoTimeline(useStore.getState).catch((err) => console.error(err));
      }, 800);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // page-mount drivers — keep each phase looking live even when an operator
  // jumps directly to it (failure mode #4 fallback)
  useEffect(() => {
    ensurePhaseContent(phase, useStore.getState).catch((err) => console.error(err));
  }, [phase]);

  // operator hotkeys (failure mode #4 — keyboard override for live demo)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === " " || e.key === "ArrowRight") {
        e.preventDefault();
        const cur = useStore.getState().phase;
        const idx = BOOTSTRAP_PHASES.indexOf(cur);
        const next = BOOTSTRAP_PHASES[Math.min(BOOTSTRAP_PHASES.length - 1, idx + 1)];
        if (next) jumpToPhase(next);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        const cur = useStore.getState().phase;
        const idx = BOOTSTRAP_PHASES.indexOf(cur);
        const prev = BOOTSTRAP_PHASES[Math.max(0, idx - 1)];
        if (prev) jumpToPhase(prev);
      } else if (e.key === "r" || e.key === "R") {
        reset();
        runDemoTimeline(useStore.getState).catch((err) => console.error(err));
      } else if (e.key === "o" || e.key === "O") {
        setShowOps((v) => !v);
      } else if (e.key >= "1" && e.key <= "9") {
        const i = parseInt(e.key, 10);
        const target = BOOTSTRAP_PHASES[i - 1];
        if (target) jumpToPhase(target);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [jumpToPhase, reset]);

  const constellationVisible = CONSTELLATION_PHASES.includes(phase);
  const constellationCentroidsRevealed =
    phase === "clusters_revealed" || phase === "agent_writing";
  const constellationDimmed = phase === "agent_writing";

  return (
    <div className="app">
      <PersistentConstellation
        cells={cells}
        visible={constellationVisible}
        centroidsRevealed={constellationCentroidsRevealed}
        dimmed={constellationDimmed}
      />

      <PhaseProgress phaseIndex={pageIndex} />

      {BOOTSTRAP_PHASES.map((p) => {
        const Page = PAGE_COMPONENT[p];
        const isActive = p === phase;
        return (
          <div key={p} className={`page ${isActive ? "active" : ""}`} style={{ zIndex: 2 }}>
            <div className="page-corner">
              compile · acme/agent
              <SourceBadge />
              · <b>{PAGE_LABEL[p]}</b>
            </div>
            <div className="page-counter">
              page <b>{PHASE_INDEX[p].toString().padStart(2, "0")}</b> / 11
            </div>
            {isActive ? <Page /> : null}
          </div>
        );
      })}

      {showOps ? (
        <div className="dev-controls">
          <button
            onClick={() => {
              reset();
              runDemoTimeline(useStore.getState).catch((err) => console.error(err));
            }}
          >
            ↻ replay
          </button>
          {BOOTSTRAP_PHASES.map((p, i) => (
            <button key={p} onClick={() => jumpToPhase(p)}>
              {i + 1}
            </button>
          ))}
        </div>
      ) : null}

      <div className="hotkey-hint">space · ← → · 1-9 · r · o</div>
    </div>
  );
}

function SourceBadge(): JSX.Element | null {
  const fx = useStore((s) => s.fixtures);
  if (!fx || fx.source !== "real") return null;
  return (
    <>
      {" "}
      <span
        style={{
          color: "var(--green)",
          fontSize: 9,
          marginLeft: 6,
          marginRight: 4,
          letterSpacing: "0.18em",
          padding: "1px 6px",
          border: "1px solid var(--green)",
          borderRadius: 3,
        }}
      >
        LIVE
      </span>
    </>
  );
}

function PhaseProgress({ phaseIndex }: { phaseIndex: number }): JSX.Element {
  return (
    <div className="phase-progress">
      {Array.from({ length: 11 }, (_, i) => i + 1).map((i) => (
        <div
          key={i}
          className={`tick ${i <= phaseIndex ? "done" : ""} ${
            i === phaseIndex ? "current" : ""
          }`}
        />
      ))}
    </div>
  );
}
