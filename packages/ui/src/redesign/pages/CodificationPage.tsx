/**
 * Codification page — the "deterministic router" stage.
 *
 * For one workflow, we run N codegen agents in parallel (one per
 * cluster from the synthesis stage). Each agent writes a typed
 * branch handler. As branches complete, they fly into the NeoVault
 * on the right and a router preview at the top assembles them in
 * declaration order.
 *
 * Layout:
 *
 *   ┌─ deterministic router (assembled live) ──────────────────────┐
 *   │  export const classify_ticket_priority = (input) =>          │
 *   │    handle_outage_enterprise(input)   // ✓ committed          │
 *   │      ?? handle_billing(input)        // ✓ committed          │
 *   │      ?? handle_auth_enterprise(...)  // ⏳ generating        │
 *   │      ?? llmFallback(input);                                   │
 *   └───────────────────────────────────────────────────────────────┘
 *
 *   ┌─ codegen agents (parallel) ──────────────────┐  ┌─ NeoVault ─┐
 *   │  ┌─ agent · c0 ─┐  ┌─ agent · c1 ─┐         │  │  ⬢ entry 1 │
 *   │  │ // outage    │  │ // billing   │  ...    │  │  ⬢ entry 2 │
 *   │  │ export const │  │ export const │         │  │  ⬢ entry 3 │
 *   │  └──────────────┘  └──────────────┘         │  │            │
 *   └────────────────────────────────────────────────┘  └────────────┘
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRedesignStore } from "../../data/redesign-store.js";
import type { Workflow, WorkflowCluster } from "../../data/workflows.js";

// ─────────────────────────────────────────────────────────────────────
// TS-ish syntax highlighter — same KW set as the legacy dashboard so
// the visual style is consistent if both code surfaces are visible.

const KEYWORDS = new Set([
  "import",
  "from",
  "const",
  "export",
  "async",
  "function",
  "return",
  "if",
  "true",
  "false",
  "await",
  "new",
  "let",
  "type",
  "interface",
  "null",
  "undefined",
]);

const IMPORTANT = new Set([
  "z",
  "llmFallback",
  "Compile",
  "TicketInput",
  "SkuInput",
  "LeadInput",
  "TicketPrioritySchema",
  "SkuMatchSchema",
  "LeadTierSchema",
  "CATALOG_INDEX",
  "ALIAS_MAP",
  "BUNDLES",
]);

function tokenize(src: string): JSX.Element[] {
  const out: JSX.Element[] = [];
  const re =
    /(\/\/[^\n]*)|(\/\*[\s\S]*?\*\/)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_$][A-Za-z0-9_$]*\b)|([\s\S])/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(src)) !== null) {
    if (m[1]) out.push(<span className="cg-com" key={i++}>{m[1]}</span>);
    else if (m[2]) out.push(<span className="cg-com" key={i++}>{m[2]}</span>);
    else if (m[3]) out.push(<span className="cg-str" key={i++}>{m[3]}</span>);
    else if (m[4]) out.push(<span className="cg-num" key={i++}>{m[4]}</span>);
    else if (m[5]) {
      const w = m[5];
      if (KEYWORDS.has(w)) out.push(<span className="cg-key" key={i++}>{w}</span>);
      else if (IMPORTANT.has(w)) out.push(<span className="cg-imp" key={i++}>{w}</span>);
      else out.push(<span key={i++}>{w}</span>);
    } else out.push(<span key={i++}>{m[6]}</span>);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Deterministic router code — assembled live as clusters commit.

function buildRouterPreview(
  workflow: Workflow,
  committed: string[],
  active: string[],
): string {
  const lines: string[] = [];
  lines.push(`// generated · deterministic router for ${workflow.function_name}`);
  lines.push(`// ${workflow.clusters.length} cluster handlers · 1 frontier fallback`);
  lines.push(``);
  lines.push(`export const ${workflow.function_name} = (input) =>`);
  const handlers = workflow.clusters
    .filter((c) => c.tier === "tier_1")
    .map((c) => c);
  const fallback = workflow.clusters.find((c) => c.tier === "tier_2");
  let isFirst = true;
  for (const c of handlers) {
    const status = committed.includes(c.cluster_id)
      ? "✓ committed"
      : active.includes(c.cluster_id)
        ? "⏳ generating"
        : "— pending";
    const prefix = isFirst ? "  " : "    ?? ";
    lines.push(`${prefix}${c.handler_name}(input)${" ".repeat(Math.max(0, 32 - c.handler_name.length))}// ${status}`);
    isFirst = false;
  }
  if (fallback) {
    const status = committed.includes(fallback.cluster_id)
      ? "✓ committed"
      : active.includes(fallback.cluster_id)
        ? "⏳ generating"
        : "— pending";
    lines.push(`    ?? ${fallback.handler_name}(input);${" ".repeat(Math.max(0, 16 - fallback.handler_name.length))}// ${status}`);
  } else {
    lines.push(`    ?? llmFallback(input);`);
  }
  return lines.join("\n");
}

function RouterPreview({ workflow }: { workflow: Workflow }): JSX.Element {
  const slice = useRedesignStore((s) => s.workflows[workflow.id]);
  const committed = slice?.codification.vault_entries ?? [];
  const active = slice?.codification.active_cluster_ids ?? [];
  const allCommitted = slice?.codification.all_committed ?? false;
  const code = useMemo(
    () => buildRouterPreview(workflow, committed, active),
    [workflow, committed, active],
  );
  return (
    <div className={`cf-router ${allCommitted ? "complete" : ""}`}>
      <div className="cf-router-head">
        <span className="num">★</span>
        <span className="title">deterministic router</span>
        <span className="hint">assembled live · zero frontier on the hot path</span>
        <span className={`status ${allCommitted ? "complete" : "live"}`}>
          {allCommitted
            ? `✓ ${workflow.clusters.length} branches sealed`
            : `${committed.length} / ${workflow.clusters.length} sealed`}
        </span>
      </div>
      <pre className="cf-router-pre">{tokenize(code)}</pre>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Per-cluster codegen agent panel.

interface AgentPanelProps {
  workflow: Workflow;
  cluster: WorkflowCluster;
  index: number;
}

function AgentPanel({ workflow, cluster, index }: AgentPanelProps): JSX.Element {
  const slice = useRedesignStore((s) => s.workflows[workflow.id]);
  const isActive = slice?.codification.active_cluster_ids.includes(cluster.cluster_id) ?? false;
  const committed = slice?.codification.vault_entries.includes(cluster.cluster_id) ?? false;
  const charsRevealed = slice?.codification.code_progress[cluster.cluster_id] ?? 0;
  const code = cluster.codified_handler;
  const visible = code.slice(0, charsRevealed);
  const isComplete = charsRevealed >= code.length;
  const status: "idle" | "writing" | "done" | "committed" = committed
    ? "committed"
    : isComplete
      ? "done"
      : isActive
        ? "writing"
        : "idle";
  const tierCls = cluster.tier === "tier_1" ? "tier1" : "tier2";

  // Auto-scroll within the pre as code reveals.
  const preRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (preRef.current) {
      preRef.current.scrollTop = preRef.current.scrollHeight;
    }
  }, [charsRevealed]);

  return (
    <div
      className={`cf-agent ${tierCls} ${status} ${committed ? "committed" : ""}`}
      style={{
        animationDelay: `${index * 60}ms`,
      }}
    >
      <div className="cf-agent-head">
        <span
          className="ag-dot"
          style={{
            background: `rgb(${cluster.color[0]}, ${cluster.color[1]}, ${cluster.color[2]})`,
          }}
        />
        <span className="ag-id">agent_{(index + 1).toString().padStart(2, "0")}</span>
        <span className="ag-cluster">{cluster.label}</span>
        <span className={`ag-tier ${tierCls}`}>
          {cluster.tier === "tier_1" ? "T1" : "T2"}
        </span>
        <span className={`ag-status ${status}`}>
          {status === "writing"
            ? "writing"
            : status === "done"
              ? "validating"
              : status === "committed"
                ? "✓ committed"
                : "queued"}
        </span>
      </div>
      <pre ref={preRef} className="cf-agent-code">
        {visible.length > 0 ? tokenize(visible) : (
          <span className="cg-placeholder">
            // agent {index + 1} · awaiting synthesis spec...
          </span>
        )}
        {!isComplete && visible.length > 0 ? <span className="cg-caret" /> : null}
      </pre>
      <div className="cf-agent-foot">
        <span className="lbl">handler</span>
        <span className="fn">{cluster.handler_name}</span>
        <span className="dim">·</span>
        <span className="dim">${cluster.annual_savings_usd.toLocaleString()}/yr</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// NeoVault — vertical column. Entries slide in as clusters commit.

function NeoVault({ workflow }: { workflow: Workflow }): JSX.Element {
  const slice = useRedesignStore((s) => s.workflows[workflow.id]);
  const entries = slice?.codification.vault_entries ?? [];
  const allCommitted = slice?.codification.all_committed ?? false;

  // Derive entry list in commit order
  const entryClusters = entries
    .map((id) => workflow.clusters.find((c) => c.cluster_id === id))
    .filter((c): c is WorkflowCluster => Boolean(c));

  const totalSavings = entryClusters.reduce(
    (acc, c) => acc + c.annual_savings_usd,
    0,
  );

  return (
    <aside className={`cf-vault ${allCommitted ? "sealed" : ""}`}>
      <div className="cf-vault-head">
        <span className="vmark">⬢</span>
        <span className="title">neo vault</span>
        <span className="hint">
          {entries.length} / {workflow.clusters.length}
        </span>
      </div>
      <div className="cf-vault-body">
        <div className="cf-vault-frame">
          <div className="cf-vault-grid" />
          <div className="cf-vault-entries">
            {entryClusters.map((c, i) => {
              const tierCls = c.tier === "tier_1" ? "tier1" : "tier2";
              return (
                <div
                  key={c.cluster_id}
                  className={`cf-vault-entry ${tierCls}`}
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <span
                    className="dot"
                    style={{
                      background: `rgb(${c.color[0]}, ${c.color[1]}, ${c.color[2]})`,
                    }}
                  />
                  <span className="key">vault://{workflow.function_name}/{c.handler_name}</span>
                  <span className={`tier ${tierCls}`}>
                    {c.tier === "tier_1" ? "T1" : "T2"}
                  </span>
                  <span className="savings">
                    ${c.annual_savings_usd.toLocaleString()}/yr
                  </span>
                </div>
              );
            })}
            {entries.length === 0 ? (
              <div className="cf-vault-empty">
                <span>vault empty · awaiting committed handlers</span>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="cf-vault-foot">
        <div className="meter">
          <div className="big">{entries.length}</div>
          <div className="lbl">handlers committed</div>
        </div>
        <div className="meter green">
          <div className="big">${totalSavings.toLocaleString()}</div>
          <div className="lbl">annualized · this workflow</div>
        </div>
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Cluster strip — small representation of clusters above the agents.

function ClusterStrip({ workflow }: { workflow: Workflow }): JSX.Element {
  const slice = useRedesignStore((s) => s.workflows[workflow.id]);
  const committed = slice?.codification.vault_entries ?? [];
  const active = slice?.codification.active_cluster_ids ?? [];
  return (
    <div className="cf-strip">
      <div className="cf-strip-head">clusters</div>
      <div className="cf-strip-pills">
        {workflow.clusters.map((c, i) => {
          const isCommitted = committed.includes(c.cluster_id);
          const isActive =
            active.includes(c.cluster_id) && !isCommitted;
          const cls = c.tier === "tier_1" ? "tier1" : "tier2";
          return (
            <div
              key={c.cluster_id}
              className={`cf-strip-pill ${cls} ${isActive ? "active" : ""} ${isCommitted ? "committed" : ""}`}
            >
              <span
                className="dot"
                style={{
                  background: `rgb(${c.color[0]}, ${c.color[1]}, ${c.color[2]})`,
                }}
              />
              <span className="lbl">
                {(i + 1).toString().padStart(2, "0")} · {c.label}
              </span>
              <span className="share">{Math.round(c.share * 100)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Top-level page.

export function CodificationPage({
  workflow,
}: {
  workflow: Workflow;
}): JSX.Element {
  return (
    <div className="cf-page">
      <RouterPreview workflow={workflow} />
      <ClusterStrip workflow={workflow} />
      <div className="cf-body">
        <div
          className="cf-agent-grid"
          style={{
            gridTemplateColumns: agentGridCols(workflow.clusters.length),
          }}
        >
          {workflow.clusters.map((c, i) => (
            <AgentPanel
              key={c.cluster_id}
              workflow={workflow}
              cluster={c}
              index={i}
            />
          ))}
        </div>
        <NeoVault workflow={workflow} />
      </div>
      <FlyOverlay workflow={workflow} />
    </div>
  );
}

function agentGridCols(n: number): string {
  // Compose a balanced grid for any cluster count up to 9.
  if (n <= 2) return "repeat(2, minmax(0, 1fr))";
  if (n <= 4) return "repeat(2, minmax(0, 1fr))";
  if (n <= 6) return "repeat(3, minmax(0, 1fr))";
  if (n <= 9) return "repeat(3, minmax(0, 1fr))";
  return "repeat(4, minmax(0, 1fr))";
}

// ─────────────────────────────────────────────────────────────────────
// FlyOverlay — when a cluster commits, briefly show a "code packet"
// animating from the agent panel to the vault. Kept simple: a CSS
// element that animates from a source rect to a target rect.

interface FlyParticle {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: string;
  label: string;
  startedAt: number;
}

function FlyOverlay({ workflow }: { workflow: Workflow }): JSX.Element {
  const slice = useRedesignStore((s) => s.workflows[workflow.id]);
  const entries = slice?.codification.vault_entries ?? [];
  const [particles, setParticles] = useState<FlyParticle[]>([]);
  const lastEntries = useRef<string[]>([]);

  useEffect(() => {
    // Detect newly-committed entries.
    const prev = new Set(lastEntries.current);
    const newOnes = entries.filter((id) => !prev.has(id));
    lastEntries.current = entries;
    if (newOnes.length === 0) return;
    const next: FlyParticle[] = [];
    for (const id of newOnes) {
      const cluster = workflow.clusters.find((c) => c.cluster_id === id);
      if (!cluster) continue;
      const fromEl = document.querySelector(
        `[data-fly-from="${id}"]`,
      ) as HTMLElement | null;
      const toEl = document.querySelector(
        `[data-fly-to="${workflow.id}"]`,
      ) as HTMLElement | null;
      if (!fromEl || !toEl) continue;
      const fromRect = fromEl.getBoundingClientRect();
      const toRect = toEl.getBoundingClientRect();
      next.push({
        id: `${id}-${Date.now()}`,
        fromX: fromRect.left + fromRect.width / 2,
        fromY: fromRect.top + fromRect.height / 2,
        toX: toRect.left + 24,
        toY: toRect.top + 32,
        color: `rgb(${cluster.color[0]}, ${cluster.color[1]}, ${cluster.color[2]})`,
        label: cluster.handler_name,
        startedAt: performance.now(),
      });
    }
    if (next.length > 0) {
      setParticles((p) => [...p, ...next]);
      // Cleanup after animation completes.
      setTimeout(() => {
        setParticles((p) =>
          p.filter((q) => !next.some((n) => n.id === q.id)),
        );
      }, 1400);
    }
  }, [entries, workflow]);

  // Inject data attributes on agent panels + vault by querying after mount.
  // Each agent panel exposes data-fly-from="<cluster_id>"; vault exposes
  // data-fly-to="<workflow_id>". We do this via DOM after mount.
  useEffect(() => {
    const agents = document.querySelectorAll(".cf-agent");
    agents.forEach((el, i) => {
      const cluster = workflow.clusters[i];
      if (cluster) el.setAttribute("data-fly-from", cluster.cluster_id);
    });
    const vault = document.querySelector(".cf-vault-frame");
    if (vault) vault.setAttribute("data-fly-to", workflow.id);
  }, [workflow]);

  if (particles.length === 0) return <div className="cf-fly-overlay" />;
  return (
    <div className="cf-fly-overlay">
      {particles.map((p) => (
        <div
          key={p.id}
          className="cf-fly-particle"
          style={
            {
              "--from-x": `${p.fromX}px`,
              "--from-y": `${p.fromY}px`,
              "--to-x": `${p.toX}px`,
              "--to-y": `${p.toY}px`,
              "--color": p.color,
            } as React.CSSProperties
          }
        >
          <span className="fly-bubble" />
          <span className="fly-label">{p.label}</span>
        </div>
      ))}
    </div>
  );
}
