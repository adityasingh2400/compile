import { useEffect, useRef } from "react";
import { useStore } from "../store.js";
import { HERO_CALL_SITE_ID } from "../demo/fixtures.js";

function heroName(state: ReturnType<typeof useStore.getState>): string {
  const fx = state.fixtures;
  const id = fx?.heroCallSiteId ?? HERO_CALL_SITE_ID;
  const site = state.callSites.find((c) => c.call_site_id === id);
  return site?.function_hint ?? id.split(":")[1] ?? id;
}

const NARRATIONS = [
  { at: 0, text: "stress-testing 100,000 synthetic inputs..." },
  { at: 7, text: "discovering sub-pattern structure..." },
  {
    at: 16,
    text: "empirical confirmation: schema 98%, determinism 99%, oracle 95%",
  },
  {
    at: 24,
    text:
      "7 sub-patterns found · 6 tier-1 · 1 tier-2 · 0 fallbacks · codifiability confirmed",
  },
];

export function StressTestPage(): JSX.Element {
  const live = useStore((s) => s.liveMetrics);
  const startedAt = useRef(performance.now());
  const narrationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    startedAt.current = performance.now();
    let raf = 0;
    const tick = () => {
      const elapsedSec = (performance.now() - startedAt.current) / 1000;
      let active = NARRATIONS[0]!;
      for (const n of NARRATIONS) {
        if (elapsedSec >= n.at) active = n;
      }
      if (narrationRef.current) {
        narrationRef.current.textContent = active.text;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const totalDone = live?.total_done ?? 0;
  const throughput = live?.throughput_per_sec ?? 0;
  const axis = live?.axis_scores;
  const schemaPct = axis ? Math.round(axis.schema_stability * 1000) / 10 : 0;
  const detPct = axis ? Math.round(axis.determinism * 1000) / 10 : 0;
  const oraclePct = axis
    ? Math.round((axis as { oracle_agreement: number }).oracle_agreement * 1000) / 10
    : 0;

  return (
    <div className="overlay-root">
      <div className="const-chrome-tl">
        <div>
          <b>{heroName(useStore.getState())}</b>
        </div>
        <div>predicted Tier 1 · schema-prior 0.92</div>
      </div>
      <div className="const-chrome-tr">
        <div className="big">{totalDone.toLocaleString()}</div>
        <div className="lbl">of 100,000 · {throughput.toLocaleString()} req/s</div>
      </div>
      <div className="const-axis-row">
        <div className="axis">
          <b>{schemaPct.toFixed(1)}%</b>schema stability
        </div>
        <div className="axis">
          <b>{detPct.toFixed(1)}%</b>determinism
        </div>
        <div className="axis">
          <b>{oraclePct.toFixed(1)}%</b>oracle agreement
        </div>
      </div>
      <div className="const-tier-legend">
        <span className="legend-pill t1">
          <span className="dot" /> tier 1 · typed function · ~$0
        </span>
        <span className="legend-pill t2">
          <span className="dot" /> tier 2 · phi-3-mini · ~$0.0001
        </span>
        <span className="legend-pill t3">
          <span className="dot" /> tier 3 · frontier fallback · ~$0.05
        </span>
      </div>
      <div className="const-narration" ref={narrationRef}>
        stress-testing 100,000 synthetic inputs...
      </div>
    </div>
  );
}
