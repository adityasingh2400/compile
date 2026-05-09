import { useStore } from "../store.js";

/**
 * PLAN / EXECUTE / REFLECT / RECOVER — the four named beats of the
 * agentic loop, lit by the daemon as the fire progresses.
 *
 * Visible during stress_test, agent_writing, and vault_write phases —
 * the constellation is happening behind it, this overlay narrates the
 * decision-making that's driving it.
 *
 * The killer beat is REFLECT-with-decline: when oracle agreement < threshold,
 * the REFLECT glyph turns red and the detail line shows the rollback.
 * That's the single highest-leverage moment for Agentic Depth=5
 * ("plans, executes, reflects, recovers, and improves autonomously").
 */

const BEATS = [
  { id: "plan", label: "plan" },
  { id: "execute", label: "execute" },
  { id: "reflect", label: "reflect" },
  { id: "recover", label: "recover" },
] as const;

const VISIBLE_PHASES = new Set([
  "stress_test",
  "clusters_revealed",
  "agent_writing",
  "validate",
  "vault_write",
]);

const BEAT_ORDER: Record<string, number> = {
  plan: 0,
  execute: 1,
  reflect: 2,
  recover: 3,
};

export function AgentLoopOverlay(): JSX.Element | null {
  const phase = useStore((s) => s.phase);
  const beat = useStore((s) => s.agentLoopBeat);
  const cluster = useStore((s) => s.activeCluster);
  const sandbox = useStore((s) => s.activeSandbox);
  const oracle = useStore((s) => s.oracleAgreement);
  const fallback = useStore((s) => s.fallbackBanner);

  if (!VISIBLE_PHASES.has(phase)) return null;
  if (!beat && !cluster) return null;

  const activeIdx = beat ? BEAT_ORDER[beat] ?? -1 : -1;

  const detailFor = (id: string): string | null => {
    switch (id) {
      case "plan":
        return cluster
          ? `cluster ${cluster.cluster_id} · ${cluster.n_samples} samples crossed threshold`
          : null;
      case "execute":
        return sandbox
          ? `tensorlake sandbox · ${sandbox.image} · ${sandbox.worker_count} workers`
          : null;
      case "reflect":
        if (!oracle) return null;
        return oracle.decision === "commit"
          ? `oracle agreement ${(oracle.score * 100).toFixed(1)}% ≥ threshold — committing to vault`
          : `oracle agreement ${(oracle.score * 100).toFixed(1)}% < ${(oracle.threshold * 100).toFixed(0)}% — declining, rolling back to LLM`;
      case "recover":
        return fallback
          ? `${fallback.surface} flaked · ${fallback.recovered ? "recovered" : "engaged"}`
          : null;
      default:
        return null;
    }
  };

  return (
    <div className="agent-loop-overlay">
      {BEATS.map((b, i) => {
        const isActive = b.id === beat;
        const isDone = activeIdx >= 0 && i < activeIdx;
        const isDeclined =
          b.id === "reflect" && oracle?.decision === "decline" && (isActive || isDone);
        const cls = [
          "beat",
          isActive ? "active" : "",
          isDone ? "done" : "",
          isDeclined ? "declined" : "",
        ]
          .filter(Boolean)
          .join(" ");
        const detail = detailFor(b.id);
        return (
          <div key={b.id} className={cls}>
            <span className="glyph" />
            <span>{b.label}</span>
            {(isActive || isDone) && detail ? (
              <span className="detail">{detail}</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
