/**
 * Codification page — the "deterministic router" stage.
 *
 * For one workflow, we run N codegen agents in parallel (one per
 * cluster from the synthesis stage). Each agent walks four short
 * status beats:
 *
 *   queued  →  analyzing  →  synthesizing  →  validating  →  committing
 *
 * No source code is shown — the visual is a status feed of *what each
 * agent is doing right now*. As each agent commits its handler, a
 * code packet flies into the NeoVault on the right.
 *
 * Layout:
 *
 *   ┌─ deterministic router · live ─────────────────────────────────┐
 *   │  6 / 7 branches sealed · annual savings $26,400/yr            │
 *   ├──────────── codegen agents (parallel) ────────────┬─ NeoVault ┤
 *   │  ┌─ agent 01 ─────────────────────────────────┐   │ ⬢ entry 1│
 *   │  │ ◐ outage:enterprise · 78% · synthesizing │   │ ⬢ entry 2│
 *   │  │ ▸ pattern: outage_keywords + ent. tier   │   │ ⬢ entry 3│
 *   │  │ ▸ branch: priority="P0", confidence=1.0  │   │           │
 *   │  └────────────────────────────────────────────┘   │           │
 *   │  ...                                                │ ⬢ entry 6│
 *   └──────────────────────────────────────────────────┴───────────┘
 */

import { useEffect, useMemo, useState } from "react";
import { useRedesignStore } from "../../data/redesign-store.js";
import type { Workflow, WorkflowCluster } from "../../data/workflows.js";

// ─────────────────────────────────────────────────────────────────────
// Status helpers — convert 0..100 progress to one of four named beats.

type StatusBeat =
  | "queued"
  | "analyzing"
  | "synthesizing"
  | "validating"
  | "committing"
  | "committed";

interface BeatSpec {
  id: StatusBeat;
  label: string;
  color: string;
  glyph: string;
}

const BEATS: BeatSpec[] = [
  { id: "queued", label: "queued", color: "var(--muted)", glyph: "○" },
  { id: "analyzing", label: "analyzing characteristics", color: "var(--cyan)", glyph: "◐" },
  { id: "synthesizing", label: "synthesizing handler", color: "var(--cyan)", glyph: "◑" },
  { id: "validating", label: "validating against holdout", color: "var(--violet)", glyph: "◒" },
  { id: "committing", label: "committing to neo vault", color: "var(--green)", glyph: "◓" },
  { id: "committed", label: "committed", color: "var(--green)", glyph: "●" },
];

function beatFromProgress(progress: number, committed: boolean): StatusBeat {
  if (committed) return "committed";
  if (progress <= 0) return "queued";
  if (progress < 25) return "analyzing";
  if (progress < 55) return "synthesizing";
  if (progress < 85) return "validating";
  return "committing";
}

function specOf(beat: StatusBeat): BeatSpec {
  return BEATS.find((b) => b.id === beat) ?? BEATS[0]!;
}

// ─────────────────────────────────────────────────────────────────────
// Router preview header — single status line, not full code.

function RouterPreview({ workflow }: { workflow: Workflow }): JSX.Element {
  const slice = useRedesignStore((s) => s.workflows[workflow.id]);
  const committed = slice?.codification.vault_entries ?? [];
  const allCommitted = slice?.codification.all_committed ?? false;
  const total = workflow.clusters.length;
  const totalSavings = workflow.clusters
    .filter((c) => committed.includes(c.cluster_id))
    .reduce((acc, c) => acc + c.annual_savings_usd, 0);

  return (
    <div className={`cf-router ${allCommitted ? "complete" : ""}`}>
      <div className="cf-router-head">
        <span className="num">★</span>
        <span className="title">deterministic router</span>
        <span className="hint">
          assembled live · {workflow.function_name}.ts · zero frontier on the hot path
        </span>
        <span className={`status ${allCommitted ? "complete" : "live"}`}>
          {allCommitted
            ? `✓ ${total} branches sealed · $${totalSavings.toLocaleString()}/yr`
            : `${committed.length} / ${total} branches · $${totalSavings.toLocaleString()}/yr so far`}
        </span>
      </div>
      <div className="cf-router-track">
        {workflow.clusters.map((c, i) => {
          const isCommitted = committed.includes(c.cluster_id);
          const cls = c.tier === "tier_1" ? "tier1" : "tier2";
          return (
            <div
              key={c.cluster_id}
              className={`cf-router-seg ${cls} ${isCommitted ? "sealed" : ""}`}
              style={{ animationDelay: `${i * 60}ms` }}
              title={c.label}
            >
              <span
                className="dot"
                style={{
                  background: isCommitted
                    ? `rgb(${c.color[0]}, ${c.color[1]}, ${c.color[2]})`
                    : "var(--dim)",
                }}
              />
              <span className="lbl">{c.handler_name}</span>
              <span className="state">
                {isCommitted ? "✓" : "—"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Per-cluster agent status panel.

interface AgentPanelProps {
  workflow: Workflow;
  cluster: WorkflowCluster;
  index: number;
}

function AgentPanel({ workflow, cluster, index }: AgentPanelProps): JSX.Element {
  const slice = useRedesignStore((s) => s.workflows[workflow.id]);
  const committed = slice?.codification.vault_entries.includes(cluster.cluster_id) ?? false;
  const isActive = slice?.codification.active_cluster_ids.includes(cluster.cluster_id) ?? false;
  const progress = slice?.codification.code_progress[cluster.cluster_id] ?? 0;
  const beat = beatFromProgress(progress, committed);
  const spec = specOf(beat);
  const tierCls = cluster.tier === "tier_1" ? "tier1" : "tier2";

  return (
    <div
      className={`cf-agent ${tierCls} beat-${beat} ${committed ? "committed" : ""} ${isActive ? "active" : ""}`}
      data-fly-from={cluster.cluster_id}
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
        <span className="ag-savings">
          ${cluster.annual_savings_usd.toLocaleString()}/yr
        </span>
      </div>

      <div className="cf-agent-body">
        <div className="cf-agent-status">
          <span className={`glyph beat-${beat}`}>{spec.glyph}</span>
          <span className="lbl">{spec.label}</span>
          <span className="pct">{committed ? 100 : progress}%</span>
        </div>

        <div className="cf-agent-progress">
          <span
            className={`bar beat-${beat}`}
            style={{ width: `${committed ? 100 : progress}%` }}
          />
        </div>

        <div className="cf-agent-trace">
          {BEATS.filter((b) => b.id !== "queued" && b.id !== "committed").map((b) => {
            const order = ["analyzing", "synthesizing", "validating", "committing"].indexOf(b.id);
            const curOrder = beat === "committed"
              ? 4
              : ["analyzing", "synthesizing", "validating", "committing"].indexOf(beat);
            const status =
              committed
                ? "done"
                : curOrder < 0
                  ? "pending"
                  : order < curOrder
                    ? "done"
                    : order === curOrder
                      ? "current"
                      : "pending";
            return (
              <div key={b.id} className={`trace-row ${status}`}>
                <span className="dot" />
                <span className="lbl">{b.label}</span>
                {status === "done" ? <span className="check">✓</span> : null}
                {status === "current" ? <span className="active-tag">live</span> : null}
              </div>
            );
          })}
        </div>

        <div className="cf-agent-spec">
          <div className="row">
            <span className="key">cluster</span>
            <span className="val">{cluster.handler_name}</span>
          </div>
          {cluster.characteristics.slice(0, 2).map((c) => (
            <div key={c.key} className="row">
              <span className="key">{c.key}</span>
              <span className="val">{c.value}</span>
            </div>
          ))}
        </div>
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
  const entryClusters = entries
    .map((id) => workflow.clusters.find((c) => c.cluster_id === id))
    .filter((c): c is WorkflowCluster => Boolean(c));
  const totalSavings = entryClusters.reduce(
    (acc, c) => acc + c.annual_savings_usd,
    0,
  );

  return (
    <aside
      className={`cf-vault ${allCommitted ? "sealed" : ""}`}
      data-fly-to={workflow.id}
    >
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
          <div className="cf-vault-spotlights" />
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
                  <span className="key">
                    {workflow.function_name}/{c.handler_name}
                  </span>
                  <span className={`tier ${tierCls}`}>
                    {c.tier === "tier_1" ? "T1" : "T2"}
                  </span>
                  <span className="savings">
                    ${c.annual_savings_usd.toLocaleString()}
                  </span>
                </div>
              );
            })}
            {entries.length === 0 ? (
              <div className="cf-vault-empty">
                <span>vault empty</span>
                <span className="dim">awaiting committed handlers</span>
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
// Top-level page.

export function CodificationPage({
  workflow,
}: {
  workflow: Workflow;
}): JSX.Element {
  return (
    <div className="cf-page">
      <RouterPreview workflow={workflow} />
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
  if (n <= 2) return "repeat(2, minmax(0, 1fr))";
  if (n <= 4) return "repeat(2, minmax(0, 1fr))";
  if (n <= 6) return "repeat(3, minmax(0, 1fr))";
  if (n <= 9) return "repeat(3, minmax(0, 1fr))";
  return "repeat(4, minmax(0, 1fr))";
}

// ─────────────────────────────────────────────────────────────────────
// FlyOverlay — when a cluster commits, briefly show a "code packet"
// animating from the agent panel to the vault.

interface FlyParticle {
  id: string;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  color: string;
  label: string;
}

function FlyOverlay({ workflow }: { workflow: Workflow }): JSX.Element {
  const slice = useRedesignStore((s) => s.workflows[workflow.id]);
  const entries = useMemo(
    () => slice?.codification.vault_entries ?? [],
    [slice],
  );
  const [particles, setParticles] = useState<FlyParticle[]>([]);
  const [seenIds] = useState(() => new Set<string>());

  useEffect(() => {
    const newOnes = entries.filter((id) => !seenIds.has(id));
    if (newOnes.length === 0) return;
    for (const id of newOnes) seenIds.add(id);
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
        fromX: fromRect.right - 16,
        fromY: fromRect.top + fromRect.height / 2,
        toX: toRect.left + 24,
        toY: toRect.top + 64,
        color: `rgb(${cluster.color[0]}, ${cluster.color[1]}, ${cluster.color[2]})`,
        label: cluster.handler_name,
      });
    }
    if (next.length > 0) {
      setParticles((p) => [...p, ...next]);
      setTimeout(() => {
        setParticles((p) =>
          p.filter((q) => !next.some((n) => n.id === q.id)),
        );
      }, 1400);
    }
  }, [entries, workflow, seenIds]);

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
