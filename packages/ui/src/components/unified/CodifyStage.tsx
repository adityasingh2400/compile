/**
 * CodifyStage — parallel codegen + vault filling.
 *
 * For the active workflow, one codegen "agent" per cluster runs
 * simultaneously. Each agent emits typed-TS lines until it commits
 * its branch. As soon as a branch commits, an envelope animation
 * flies from the agent lane to the Neo Vault on the right; the
 * vault shelf grows as commits land. Once all agents commit, the
 * timeline can advance to the route stage.
 *
 * One canvas-shaped stage. Left: agent lanes laid out in a grid.
 * Right: vault. Connecting "shipping" animations cross the gap.
 */
import { useEffect, useMemo, useRef } from "react";
import { useUnifiedStore, type CodegenAgent } from "../../unified-store.js";
import type { Workflow, WorkflowCluster } from "../../demo/workflows.js";

export function CodifyStage(): JSX.Element {
  const workflows = useUnifiedStore((s) => s.workflows);
  const activeId = useUnifiedStore((s) => s.active_workflow_id);
  const codify = useUnifiedStore((s) => s.codify[s.active_workflow_id]);
  const setAgents = useUnifiedStore((s) => s.setCodifyAgents);
  const setAgent = useUnifiedStore((s) => s.setCodifyAgent);
  const commit = useUnifiedStore((s) => s.commitVaultEntry);
  const workflow = workflows.find((w) => w.id === activeId)!;

  // ── ensure agents exist for this workflow on first mount ───────
  useEffect(() => {
    if (!codify || codify.agents.length === 0) {
      setAgents(
        activeId,
        workflow.clusters.map((c: WorkflowCluster) => ({
          cluster_id: c.id,
          label: c.label,
          workflow_id: activeId,
          progress: 0,
          lines_emitted: 0,
          status: "idle" as const,
        })),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // ── start the agents in a stagger; each runs to commit ─────────
  useEffect(() => {
    if (!codify) return;
    let cancelled = false;
    const timeouts: ReturnType<typeof setTimeout>[] = [];
    codify.agents.forEach((a, idx) => {
      if (a.status === "vault_committed") return; // already done
      const startDelay = 300 + idx * 220;
      timeouts.push(
        setTimeout(() => {
          if (cancelled) return;
          setAgent(activeId, a.cluster_id, { status: "running" });
          // step the agent's progress toward 1.0 over ~3.5s
          const totalMs = 2800 + Math.random() * 1400;
          const start = performance.now();
          const tick = () => {
            if (cancelled) return;
            const cur = useUnifiedStore.getState().codify[activeId]?.agents.find(
              (x) => x.cluster_id === a.cluster_id,
            );
            if (!cur) return;
            if (cur.status === "vault_committed") return;
            const t = Math.min(1, (performance.now() - start) / totalMs);
            setAgent(activeId, a.cluster_id, {
              progress: t,
              lines_emitted: Math.floor(t * (8 + idx)),
            });
            if (t >= 1) {
              commit(activeId, a.cluster_id);
            } else {
              timeouts.push(setTimeout(tick, 80));
            }
          };
          tick();
        }, startDelay),
      );
    });
    return () => {
      cancelled = true;
      timeouts.forEach((t) => clearTimeout(t));
    };
    // re-run if user switches workflow tabs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  return (
    <div className="ud-stage codify-stage">
      <div className="codify-header">
        <div className="title">
          <span className="caret">⚙</span>
          <span>parallel codegen</span>
        </div>
        <div className="meta">
          {workflow.source_name}() <span className="dim">·</span>{" "}
          {workflow.clusters.length} agents <span className="dim">·</span>{" "}
          customer keys <span className="dim">·</span> compile spends 0 frontier
          tokens
        </div>
      </div>

      <div className="codify-body">
        <AgentGrid workflow={workflow} agents={codify?.agents ?? []} />
        <VaultColumn
          workflow={workflow}
          committed={codify?.vault_committed ?? []}
        />
      </div>
    </div>
  );
}

// ── Agent grid: NxM small "code editor cards" ──────────────────────

function AgentGrid({
  workflow,
  agents,
}: {
  workflow: Workflow;
  agents: CodegenAgent[];
}): JSX.Element {
  // Grid columns: prefer 3 (compact) but allow 4 for many-cluster workflows.
  const cols = agents.length >= 7 ? 4 : 3;
  return (
    <div
      className="codify-agent-grid"
      style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
    >
      {agents.map((a) => {
        const cluster = workflow.clusters.find((c) => c.id === a.cluster_id);
        if (!cluster) return null;
        return <AgentCard key={a.cluster_id} agent={a} cluster={cluster} />;
      })}
    </div>
  );
}

const KW = new Set([
  "import",
  "from",
  "const",
  "export",
  "async",
  "function",
  "return",
  "if",
  "else",
  "true",
  "false",
  "await",
]);

function tokenize(src: string): JSX.Element[] {
  const out: JSX.Element[] = [];
  const re =
    /(\/\/[^\n]*)|(\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_$][A-Za-z0-9_$]*\b)|([\s\S])/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(src)) !== null) {
    if (m[1]) out.push(<span className="com" key={i++}>{m[1]}</span>);
    else if (m[2]) out.push(<span className="com" key={i++}>{m[2]}</span>);
    else if (m[3]) out.push(<span className="str" key={i++}>{m[3]}</span>);
    else if (m[4]) out.push(<span className="num" key={i++}>{m[4]}</span>);
    else if (m[5]) {
      const w = m[5];
      if (KW.has(w)) out.push(<span className="key" key={i++}>{w}</span>);
      else if (w === "z" || w === "llmFallback")
        out.push(<span className="imp" key={i++}>{w}</span>);
      else out.push(<span key={i++}>{w}</span>);
    } else out.push(<span key={i++}>{m[6]}</span>);
  }
  return out;
}

/** Slice out a cluster's "would-be" code chunk from the workflow's
 *  generated source so each agent appears to be writing its own
 *  branch. We just take a visual approximation per cluster. */
function codeFragmentFor(workflow: Workflow, cluster: WorkflowCluster): string {
  const lines = workflow.generated_code.split("\n");
  const idx = workflow.clusters.indexOf(cluster);
  // 6 lines per cluster, offset into the body
  const total = lines.length;
  const headerCount = 8;
  const perCluster = Math.max(
    4,
    Math.floor((total - headerCount) / workflow.clusters.length),
  );
  const start = headerCount + idx * perCluster;
  const end = Math.min(total, start + perCluster);
  return lines.slice(start, end).join("\n").trim();
}

function AgentCard({
  agent,
  cluster,
}: {
  agent: CodegenAgent;
  cluster: WorkflowCluster;
}): JSX.Element {
  const workflows = useUnifiedStore((s) => s.workflows);
  const workflow = workflows.find((w) => w.id === agent.workflow_id)!;
  const fragment = useMemo(
    () => codeFragmentFor(workflow, cluster),
    [workflow, cluster],
  );
  const visibleLen = Math.floor(agent.progress * fragment.length);
  const visible = fragment.slice(0, visibleLen);
  const tierLabel =
    cluster.tier === "tier_1" ? "T1" : cluster.tier === "tier_2" ? "T2" : "T3";

  const isDone = agent.status === "vault_committed";
  const isRunning = agent.status === "running";
  return (
    <div
      className={`codify-agent ${cluster.tier} ${
        isRunning ? "running" : ""
      } ${isDone ? "done" : ""}`}
      data-cluster-id={cluster.id}
    >
      <header>
        <span className="tier">{tierLabel}</span>
        <span className="lbl">{cluster.label}</span>
        {isDone ? (
          <span className="committed">✓ committed</span>
        ) : isRunning ? (
          <span className="dot" />
        ) : (
          <span className="idle">queued</span>
        )}
      </header>
      <pre>
        {visible ? tokenize(visible) : (
          <span className="placeholder">
            // codegen agent ready · awaiting synthesis spec
          </span>
        )}
        {!isDone && isRunning ? <span className="caret" /> : null}
      </pre>
      <footer>
        <div className="bar">
          <span style={{ width: `${Math.round(agent.progress * 100)}%` }} />
        </div>
        <span className="pct">
          {Math.round(agent.progress * 100)}%
        </span>
      </footer>
    </div>
  );
}

// ── Vault column: stacked entries with envelope-fly-in animation ─────

function VaultColumn({
  workflow,
  committed,
}: {
  workflow: Workflow;
  committed: string[];
}): JSX.Element {
  const total = workflow.clusters.length;
  const filledPct = Math.round((committed.length / total) * 100);
  return (
    <aside className="codify-vault">
      <header>
        <span className="title">neo vault</span>
        <span className="meta">
          {committed.length}/{total}
        </span>
      </header>
      <div className="vault-fill-bar">
        <span style={{ width: `${filledPct}%` }} />
      </div>
      <div className="vault-shelf">
        {workflow.clusters.map((c) => {
          const isCommitted = committed.includes(c.id);
          return (
            <div
              key={c.id}
              className={`vault-entry ${c.tier} ${
                isCommitted ? "committed" : "pending"
              }`}
            >
              <span
                className="dot"
                style={{
                  background: isCommitted
                    ? `rgb(${c.color[0]}, ${c.color[1]}, ${c.color[2]})`
                    : undefined,
                }}
              />
              <span className="lbl">
                {workflow.source_name}.{c.id}
              </span>
              <span className="status">
                {isCommitted ? "✓" : "···"}
              </span>
            </div>
          );
        })}
      </div>
      <footer>
        <span className="hint">
          deterministic · ready for production routing
        </span>
      </footer>
    </aside>
  );
}
