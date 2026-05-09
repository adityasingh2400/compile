import { useStore } from "../store.js";

export function ValidatePage(): JSX.Element {
  const cells = useStore((s) => s.validateCells);
  const score = useStore((s) => s.validateScore);
  const passed = cells.filter((c) => c === "pass").length;
  const total = cells.length;
  const settled = score >= 98;
  return (
    <div className="validate-stage">
      <div
        style={{
          fontFamily: "var(--mono)",
          fontSize: 13,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--muted)",
        }}
      >
        validating against private 15% holdout
      </div>
      <div className="validate-grid">
        {cells.map((c, i) => (
          <div key={i} className={`validate-cell ${c === "pass" ? "pass" : c === "fail" ? "fail" : ""}`} />
        ))}
      </div>
      <div className="validate-bar">
        <div style={{ width: `${(passed / Math.max(1, total)) * 100}%` }} />
      </div>
      <div className="validate-score">{score.toFixed(1)}%</div>
      {settled ? <div className="gate-banner">GATE PASSED · ≥ 98%</div> : null}
    </div>
  );
}
