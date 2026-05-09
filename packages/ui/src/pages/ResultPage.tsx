import { useEffect, useState } from "react";
import { useStore } from "../store.js";

function useCountUp(target: number, durationMs = 1500): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (target <= 0) {
      setValue(0);
      return;
    }
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setValue(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return value;
}

export function ResultPage(): JSX.Element {
  const r = useStore((s) => s.result);
  const savings = useCountUp(r?.projected_annual_savings_usd ?? 0, 1700);
  const calls = useCountUp(r?.total_synthetic_calls ?? 0, 1500);
  if (!r) return <div />;
  const wallSec = (r.wall_time_ms / 1000).toFixed(0);
  return (
    <div className="result-stage">
      <div className="result-headline">
        compile bootstrap complete · acme/agent · {wallSec}s wall time
      </div>
      <div className="result-savings">
        ${savings.toLocaleString()}
        <span className="sub">
          projected annual savings · {r.codified_count} codified · {r.negative_vault_count} negative-vault entries
        </span>
      </div>
      <div className="result-grid">
        <div className="result-tile">
          <div className="lbl">stage 1</div>
          <div className="val">
            {r.stage1_green}
            <span style={{ fontSize: 14, color: "var(--muted)" }}> · g </span>
            {r.stage1_yellow}
            <span style={{ fontSize: 14, color: "var(--muted)" }}> · y </span>
            {r.stage1_red}
            <span style={{ fontSize: 14, color: "var(--muted)" }}> · r</span>
          </div>
        </div>
        <div className="result-tile">
          <div className="lbl">stage 2 runs</div>
          <div className="val cyan">
            {r.stage2_runs} · {r.stage2_passes} pass
          </div>
        </div>
        <div className="result-tile">
          <div className="lbl">synthetic calls</div>
          <div className="val">{calls.toLocaleString()}</div>
        </div>
        <div className="result-tile">
          <div className="lbl">sandbox cost</div>
          <div className="val amber">${r.sandbox_compute_cost_usd.toFixed(0)}</div>
        </div>
      </div>
      <div className="result-cta">
        the agent paid for codegen on its own keys ·
        <b> compile spent zero frontier tokens</b>
      </div>
      <div className="result-negative">
        <div className="result-negative-hd">
          honest about what we don't codify · 6 patterns in negative vault
        </div>
        <div className="result-negative-grid">
          <div>
            <span className="lbl">creative_task</span>
            <span className="cnt">3</span>
          </div>
          <div>
            <span className="lbl">novel_reasoning_required</span>
            <span className="cnt">2</span>
          </div>
          <div>
            <span className="lbl">high_variance_outputs</span>
            <span className="cnt">1</span>
          </div>
        </div>
      </div>
      <div className="result-watcher">
        <span className="dot" />
        always-on proxy mode · drift watcher · cluster refiner · new-pattern miner
      </div>
    </div>
  );
}
