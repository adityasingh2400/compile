import { useStore } from "../store.js";
import type { VaultCard } from "../demo/fixtures.js";

function MiniCard({ c }: { c: VaultCard }): JSX.Element {
  if (c.kind === "positive") {
    return (
      <div className="vault-card-mini">
        <h5>{c.function_name}</h5>
        <span className="pos">
          {c.tier?.toUpperCase()} · ${c.annual_savings_usd?.toLocaleString()}/yr
        </span>
        <div style={{ marginTop: 6 }}>
          match {Math.round((c.holdout_match_rate ?? 0) * 1000) / 10}%
        </div>
      </div>
    );
  }
  return (
    <div className="vault-card-mini">
      <h5>{c.function_name}</h5>
      <span className="neg">— · {c.reason}</span>
      <div style={{ marginTop: 6 }}>negative vault</div>
    </div>
  );
}

export function VaultWritePage(): JSX.Element {
  const incoming = useStore((s) => s.vaultIncoming);
  const shrunk = useStore((s) => s.vaultIncomingShrunk);
  const existing = useStore((s) => s.vaultExisting);

  return (
    <div className="vault-stage">
      {incoming ? (
        <div className={`vault-newcard ${shrunk ? "shrunk" : ""}`}>
          <h4>{incoming.function_name}</h4>
          <div>tier · {incoming.tier?.toUpperCase()}</div>
          <div>match · {((incoming.holdout_match_rate ?? 0) * 100).toFixed(1)}%</div>
          <div>cluster · 7 sub-patterns</div>
          <div>tests · vitest · 47 passed</div>
          <div className="meta">
            ${(incoming.annual_savings_usd ?? 0).toLocaleString()} / year
          </div>
          {shrunk ? null : (
            <div
              style={{
                marginTop: 16,
                fontSize: 9,
                color: "var(--muted)",
                lineHeight: 1.5,
                opacity: 0.7,
              }}
            >
              import {`{ z }`} from "zod";
              <br />
              import {`{ llmFallback }`} from "@compile/runtime";
              <br />
              ...
            </div>
          )}
        </div>
      ) : null}
      <div className="vault-stack">
        {existing.map((c) => (
          <MiniCard key={c.function_id} c={c} />
        ))}
      </div>
    </div>
  );
}
