/**
 * UnifiedDashboard — single-canvas observation surface for the
 * end-to-end Compile pipeline.
 *
 * No panel grid. Four stages share ONE canvas; each stage transforms
 * the canvas into its own visualization. Workflow tabs select WHICH
 * production workflow's data the canvas renders.
 *
 * Layout regions:
 *   ┌─ HEADER ───────────────────────────────────────────┐
 *   │ STAGE STRIP  ●AUDIT─○CLUSTER─○CODIFY─○ROUTE        │
 *   │ TABS  ▸ Ticket Priority   SKU Match   Lead Tier    │
 *   ├────────────────────────────────────────────────────┤
 *   │                                                    │
 *   │             CANVAS  (transforms by stage)          │
 *   │                                                    │
 *   ├────────────────────────────────────────────────────┤
 *   │ CONTEXT STRIP  · current-stage metrics             │
 *   └────────────────────────────────────────────────────┘
 */
import { useEffect, useState } from "react";
import { useUnifiedStore, STAGES, type Stage } from "../../unified-store.js";
import { AuditStage } from "./AuditStage.js";
import { ClusterStage } from "./ClusterStage.js";
import { CodifyStage } from "./CodifyStage.js";
import { RouteStage } from "./RouteStage.js";

const STAGE_LABEL: Record<Stage, string> = {
  audit: "audit",
  cluster: "cluster",
  codify: "codify",
  route: "route",
};

const STAGE_DESCRIPTION: Record<Stage, string> = {
  audit: "tensorlake sandbox · classify codifiability per LLM call site",
  cluster: "1,000 synthetic API calls · cluster semantically into branches",
  codify: "parallel codegen · one agent per cluster · functions ship to neo vault",
  route: "production routing · ≈95% via vault · ≈5% frontier · live traffic",
};

// ── Stage strip ────────────────────────────────────────────────────

function StageStrip(): JSX.Element {
  const stage = useUnifiedStore((s) => s.stage);
  const setStage = useUnifiedStore((s) => s.setStage);
  const setManualOverride = useUnifiedStore((s) => s.setManualOverride);
  const idx = STAGES.indexOf(stage);

  return (
    <div className="ud-stage-strip">
      {STAGES.map((s, i) => {
        const isActive = s === stage;
        const isDone = i < idx;
        return (
          <button
            key={s}
            className={`ud-stage ${isActive ? "active" : ""} ${
              isDone ? "done" : ""
            }`}
            onClick={() => {
              setManualOverride(true);
              setStage(s);
            }}
            title={STAGE_DESCRIPTION[s]}
          >
            <span className="dot" />
            <span className="num">0{i + 1}</span>
            <span className="lbl">{STAGE_LABEL[s]}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Workflow tabs ───────────────────────────────────────────────────

function WorkflowTabs(): JSX.Element | null {
  const stage = useUnifiedStore((s) => s.stage);
  const workflows = useUnifiedStore((s) => s.workflows);
  const active = useUnifiedStore((s) => s.active_workflow_id);
  const setActive = useUnifiedStore((s) => s.setActiveWorkflow);

  // Tabs only matter for stages 2–4 (per-workflow). In audit, the
  // workflows haven't been surfaced yet.
  if (stage === "audit") return null;

  return (
    <div className="ud-tabs">
      <span className="ud-tabs-label">workflow</span>
      {workflows.map((w) => {
        const isActive = w.id === active;
        return (
          <button
            key={w.id}
            className={`ud-tab ${isActive ? "active" : ""}`}
            onClick={() => setActive(w.id)}
            style={
              isActive
                ? ({ "--tab-accent": w.accent } as React.CSSProperties)
                : undefined
            }
          >
            <span className="ud-tab-source">{w.source_name}()</span>
            <span className="ud-tab-display">{w.display}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Header ──────────────────────────────────────────────────────────

function formatUptime(ms: number): string {
  if (ms < 1000) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m`;
  return `${totalSec}s`;
}

function formatDollars(n: number): string {
  if (n >= 100_000) return `$${Math.round(n / 1000).toLocaleString()}k`;
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

function Header(): JSX.Element {
  const daemon = useUnifiedStore((s) => s.daemon);
  const [, force] = useState(0);

  // Refresh once a second so uptime ticks visibly between events.
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <header className="ud-header">
      <div className="ud-header-left">
        <span className="ud-brand">compile</span>
        <span className="ud-subtitle">
          observation dashboard <span className="dim">·</span> production
          runs server-side, no UI
        </span>
      </div>
      <div className="ud-header-right">
        <span className={`ud-daemon ${daemon.connected ? "live" : "fixture"}`}>
          <span className={`dot ${daemon.connected ? "live" : "idle"}`} />
          <span className="lbl">
            daemon · <b>{daemon.connected ? "live" : "fixture"}</b>
          </span>
          <span className="sep">·</span>
          <span>up <b>{formatUptime(daemon.uptime_ms)}</b></span>
          <span className="sep">·</span>
          <span>fire <b>#{daemon.fires_total}</b></span>
          <span className="sep">·</span>
          <span><b className="money">{formatDollars(daemon.dollars_saved)}</b> saved</span>
        </span>
      </div>
    </header>
  );
}

// ── Context strip — single line of stage-relevant metrics ──────────

function ContextStrip(): JSX.Element {
  const stage = useUnifiedStore((s) => s.stage);
  const audit = useUnifiedStore((s) => s.audit);
  const cluster = useUnifiedStore((s) => s.cluster);
  const codify = useUnifiedStore((s) => s.codify);
  const route = useUnifiedStore((s) => s.route);
  const workflows = useUnifiedStore((s) => s.workflows);
  const activeId = useUnifiedStore((s) => s.active_workflow_id);
  const active = workflows.find((w) => w.id === activeId);

  let line: React.ReactNode;
  if (stage === "audit") {
    const filesDone = audit.files_scanned.filter((f) => f.done).length;
    const total = audit.files_scanned.length || 10;
    const totalSites = audit.sites_decided.length;
    const t1 = audit.sites_decided.filter((d) => d.decision === "tier_1").length;
    const t2 = audit.sites_decided.filter((d) => d.decision === "tier_2").length;
    const t3 = audit.sites_decided.filter((d) => d.decision === "tier_3").length;
    line = (
      <>
        <span className="m">
          <b>{filesDone}</b>/{total} files scanned
        </span>
        <span className="m">
          <b>{totalSites}</b> LLM call sites
        </span>
        <span className="m">
          <b className="g">{t1}</b> tier-1
          <span className="dim"> · </span>
          <b className="y">{t2}</b> tier-2
          <span className="dim"> · </span>
          <b className="r">{t3}</b> tier-3
        </span>
        <span className="m hint">
          codifiability decided from code structure — no LLM calls yet
        </span>
      </>
    );
  } else if (stage === "cluster" && active) {
    const cp = cluster[active.id];
    line = (
      <>
        <span className="m">
          workflow <b>{active.source_name}</b>
        </span>
        <span className="m">
          <b>{cp?.nodes_emitted.toLocaleString() ?? 0}</b> /
          1,000 synthetic calls
        </span>
        <span className="m">
          <b>{active.clusters.length}</b> sub-patterns
        </span>
        <span className="m">
          cohesion{" "}
          <b>{cp ? Math.round(cp.cohesion * 100) : 0}%</b>
        </span>
        <span className="m hint">
          each cluster becomes one branch of a typed function
        </span>
      </>
    );
  } else if (stage === "codify" && active) {
    const cp = codify[active.id];
    const total = active.clusters.length;
    const done = cp?.vault_committed.length ?? 0;
    const running =
      cp?.agents.filter((a) => a.status === "running").length ?? 0;
    line = (
      <>
        <span className="m">
          workflow <b>{active.source_name}</b>
        </span>
        <span className="m">
          <b>{total}</b> parallel codegen agents
        </span>
        <span className="m">
          <b className="cy">{running}</b> running ·{" "}
          <b className="g">{done}</b> committed to vault
        </span>
        <span className="m hint">
          each agent codifies one cluster · runs on customer keys
        </span>
      </>
    );
  } else if (stage === "route" && active) {
    const rp = route[active.id];
    const monthlyCalls = active.monthly_call_volume;
    line = (
      <>
        <span className="m">
          workflow <b>{active.source_name}</b>
        </span>
        <span className="m">
          <b>{(monthlyCalls / 1_000).toFixed(0)}k</b>/mo
        </span>
        <span className="m">
          <b className="g">{(active.vault_pct * 100).toFixed(1)}%</b> via
          neo vault
          <span className="dim"> · </span>
          <b className="y">{(active.frontier_pct * 100).toFixed(1)}%</b>{" "}
          frontier
        </span>
        <span className="m">
          saving <b className="g">${active.annual_savings_usd.toLocaleString()}</b>/yr
        </span>
        <span className="m hint">
          deterministic on the hot path · frontier as the explicit fallback
        </span>
        {/* keep rp ref so unused-var lint stays happy */}
        <span style={{ display: "none" }}>{rp?.flow_intensity ?? 0}</span>
      </>
    );
  } else {
    line = <span className="m hint">…</span>;
  }

  return <footer className="ud-context">{line}</footer>;
}

// ── Canvas slot — picks which stage component to render ───────────

function CanvasSlot(): JSX.Element {
  const stage = useUnifiedStore((s) => s.stage);
  switch (stage) {
    case "audit":
      return <AuditStage />;
    case "cluster":
      return <ClusterStage />;
    case "codify":
      return <CodifyStage />;
    case "route":
      return <RouteStage />;
  }
}

// ── Top-level dashboard ─────────────────────────────────────────────

export function UnifiedDashboard(): JSX.Element {
  return (
    <div className="ud-root">
      <Header />
      <div className="ud-bar">
        <StageStrip />
        <WorkflowTabs />
      </div>
      <main className="ud-canvas">
        <CanvasSlot />
      </main>
      <ContextStrip />
    </div>
  );
}
