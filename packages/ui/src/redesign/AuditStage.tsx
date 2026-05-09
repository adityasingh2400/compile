/**
 * Audit stage — the opening act.
 *
 * Renders the Compile agent operating inside a Tensorlake sandbox while
 * it audits the repo. End state: a clean list of codifiable workflows
 * that promote into tabs in the workspace.
 *
 * Five visible sub-phases (driven by `useAuditDriver`):
 *
 *   boot         · sandbox materializes, shell-style boot logs scroll
 *   scanning     · AST tokens stream, file tree fills, hits register
 *   classifying  · each call site lands in the right column with a tier
 *   filtering    · negatives dim, codifiables pulse green
 *   manifest     · large "N codifiable workflows" reveal + tab pill morph
 *
 * The component uses no external animation library — it's straight
 * React state + a few canvas particles for the boot / sandbox visual.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  useRedesignStore,
  type AuditPhase,
} from "../data/redesign-store.js";
import {
  AUDIT_CALL_SITES,
  CODIFIABLE_WORKFLOWS,
  REPO_PATH,
  type Workflow,
} from "../data/workflows.js";

// ─────────────────────────────────────────────────────────────────────
// Boot lines — typewriter into the sandbox terminal.
//
// `buildBootLines()` substitutes the real sandbox_id and resources from
// `tensorlake-status.json` when prewarm has written it; otherwise the
// canned values keep the offline demo readable.

interface BootLine {
  ts: string;
  level: "info" | "ok" | "warn";
  text: string;
}

function buildBootLines(args: {
  live: boolean;
  sandboxId: string;
  image: string;
  cpus: number;
  memMb: number;
}): BootLine[] {
  const memGb =
    args.memMb >= 1024 ? `${(args.memMb / 1024).toFixed(args.memMb % 1024 === 0 ? 0 : 1)}GB` : `${args.memMb}MB`;
  return [
    {
      ts: "00:00.013",
      level: "info",
      text: `tensorlake.Sandbox.create({ image: '${args.image}', cpus: ${args.cpus}, memoryMb: ${args.memMb} })`,
    },
    { ts: "00:00.214", level: "info", text: "  · pulling layers — base, node22, ts-morph, tree-sitter" },
    {
      ts: "00:00.731",
      level: "info",
      text: `  · microvm boot · alloc ${args.cpus} vCPU / ${memGb} · region us-west-2`,
    },
    {
      ts: "00:01.027",
      level: "ok",
      text: `✓ sandbox ready · ${args.sandboxId}${args.live ? "" : ""} · ${args.live ? "real cold start" : "4012ms cold start"}`,
    },
    { ts: "00:01.044", level: "info", text: `agent.audit({ repo: '${REPO_PATH}' })` },
    { ts: "00:01.061", level: "info", text: "  · git rev-parse HEAD → a3f2d1b" },
    { ts: "00:01.118", level: "info", text: "  · ts-morph project · loading tsconfig.json" },
    { ts: "00:01.420", level: "ok", text: "✓ project loaded · 38 source files · 4 packages" },
    {
      ts: "00:01.460",
      level: "info",
      text: "scanner.findCallSites({ providers: ['openai','anthropic','google'] })",
    },
  ];
}

/** Default canned values used by the audit driver before tensorlake-status.json
 *  has loaded. The driver only reads the COUNT — content is component-side. */
const DEFAULT_BOOT_LINES = buildBootLines({
  live: false,
  sandboxId: "sb_audit_4f12ae",
  image: "compile-audit-agent",
  cpus: 4,
  memMb: 8192,
});

const BOOT_LINES = DEFAULT_BOOT_LINES;

const SCAN_FILES = [
  "src/index.ts",
  "src/router.ts",
  "src/icp.ts",
  "src/ops.ts",
  "src/utils/parse.ts",
  "src/utils/format.ts",
  "src/llm/openai.ts",
  "src/llm/anthropic.ts",
  "package.json",
  "tsconfig.json",
];

// ─────────────────────────────────────────────────────────────────────
// Audit driver — runs the timed walk through the five phases. Wires the
// store; idempotent across StrictMode double-mounts via a module-level
// singleton so the timeline survives unmount/remount cycles.

/**
 * Module-level guard — survives StrictMode double-mounts. Exposed via
 * `resetAuditDriver()` so the reset hotkey can re-run the audit.
 */
const AUDIT_DRIVER = { started: false };

export function resetAuditDriver(): void {
  AUDIT_DRIVER.started = false;
}

async function runAuditTimeline(): Promise<void> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const s = () => useRedesignStore.getState();

  // ── BOOT ───────────────────────────────────────────────────────────
  s().setAuditPhase("boot");
  for (let i = 0; i < BOOT_LINES.length; i++) {
    s().bumpBootLines();
    await sleep(120);
  }
  await sleep(220);

  // ── SCANNING ───────────────────────────────────────────────────────
  s().setAuditPhase("scanning");
  for (let i = 0; i < SCAN_FILES.length; i++) {
    s().setFilesScanned(i + 1);
    for (let k = 0; k < 12; k++) {
      s().bumpAstTokens(60 + Math.floor(Math.random() * 80));
      await sleep(10);
    }
    await sleep(70);
  }
  await sleep(240);

  // ── CLASSIFYING ────────────────────────────────────────────────────
  s().setAuditPhase("classifying");
  for (const site of AUDIT_CALL_SITES) {
    s().pushClassified(site);
    await sleep(160);
  }
  await sleep(340);

  // ── FILTERING ──────────────────────────────────────────────────────
  s().setAuditPhase("filtering");
  s().setFiltered(true);
  await sleep(1400);

  // ── MANIFEST ───────────────────────────────────────────────────────
  s().setAuditPhase("manifest");
  await sleep(2400);

  // ── TRANSITION → WORKSPACE ────────────────────────────────────────
  s().setAuditPhase("transition");
  await sleep(700);
  s().setAuditPhase("complete");
  s().setUiStage("workspace");
}

function useAuditDriver(): void {
  useEffect(() => {
    if (AUDIT_DRIVER.started) return;
    AUDIT_DRIVER.started = true;
    runAuditTimeline().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[audit] timeline failed", err);
    });
    // Intentionally no cleanup — timeline runs to completion regardless
    // of remounts. The store is the single source of truth.
  }, []);
}

// ─────────────────────────────────────────────────────────────────────
// Components.

function PhaseIndicator(): JSX.Element {
  const phase = useRedesignStore((s) => s.audit.phase);
  const labels: { id: AuditPhase; label: string }[] = [
    { id: "boot", label: "sandbox boot" },
    { id: "scanning", label: "scan repo" },
    { id: "classifying", label: "classify" },
    { id: "filtering", label: "filter" },
    { id: "manifest", label: "manifest" },
  ];
  const idx = labels.findIndex((l) => l.id === phase);
  return (
    <div className="audit-phase-strip">
      {labels.map((l, i) => {
        const cur = i === idx;
        const done = i < idx;
        return (
          <div
            key={l.id}
            className={`audit-phase-step ${cur ? "current" : ""} ${done ? "done" : ""}`}
          >
            <span className="num">{(i + 1).toString().padStart(2, "0")}</span>
            <span className="label">{l.label}</span>
            {cur ? <span className="dot pulse" /> : <span className="dot" />}
          </div>
        );
      })}
    </div>
  );
}

/** Small starfield canvas behind everything — pure aesthetic. */
function SandboxParticles(): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);
    const N = 280;
    const px = new Float32Array(N);
    const py = new Float32Array(N);
    const pv = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      px[i] = Math.random();
      py[i] = Math.random();
      pv[i] = 0.04 + Math.random() * 0.18;
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.fillStyle = "rgba(255, 247, 240, 0.55)";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(122, 223, 255, 0.55)";
      for (let i = 0; i < N; i++) {
        py[i] = py[i]! + pv[i]! * dt;
        if (py[i]! > 1) {
          py[i] = 0;
          px[i] = Math.random();
        }
        const x = px[i]! * w;
        const y = py[i]! * h;
        ctx.fillRect(x, y, 1.2, 1.2);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);
  return <canvas ref={ref} className="audit-particles" />;
}

function SandboxFrame(): JSX.Element {
  const phase = useRedesignStore((s) => s.audit.phase);
  const tl = useRedesignStore((s) => s.tensorlake);

  // When prewarm wrote a real tensorlake-status.json, the sandbox_id /
  // resources / image fields below are LIVE values straight from the
  // Tensorlake SDK. Falls through to canned values offline so the demo
  // still flows when keys aren't set.
  const live = tl.connected && tl.sandbox_id != null;
  const sandboxId = tl.sandbox_id ?? "sb_audit_4f12ae";
  const image = tl.image ?? "compile-audit-agent";
  const cpus = tl.cpus ?? 4;
  const memMb = tl.memory_mb ?? 8192;
  const memDisplay =
    memMb >= 1024 ? `${(memMb / 1024).toFixed(memMb % 1024 === 0 ? 0 : 1)} GB` : `${memMb} MB`;
  const region = "us-west-2";

  return (
    <div className={`audit-sandbox-frame audit-phase-${phase}`}>
      <div className="audit-sandbox-corners">
        <span className="corner tl" />
        <span className="corner tr" />
        <span className="corner bl" />
        <span className="corner br" />
      </div>
      <div className="audit-sandbox-meta">
        <span className={`dot ${live ? "live" : ""}`} />
        <span>tensorlake sandbox</span>
        <span className="sep">·</span>
        <span title={live ? "real Tensorlake sandbox id" : "canned (offline mode)"}>{sandboxId}</span>
        <span className="sep">·</span>
        <span>image={image}</span>
        <span className="sep">·</span>
        <span>region={region}</span>
        <span className="sep">·</span>
        <span>
          {cpus} vCPU · {memDisplay}
        </span>
        {live ? (
          <>
            <span className="sep">·</span>
            <span className="audit-live-tag" title={`spawned ${tl.created_at ?? "—"} from ${tl.source ?? "prewarm"}`}>
              ◉ live
            </span>
          </>
        ) : null}
      </div>
    </div>
  );
}

function BootTerminal(): JSX.Element {
  const emitted = useRedesignStore((s) => s.audit.boot_lines_emitted);
  const phase = useRedesignStore((s) => s.audit.phase);
  const tl = useRedesignStore((s) => s.tensorlake);

  // Substitute live values into the boot lines when we have them. The
  // driver only ticks `boot_lines_emitted`; the content rendered here
  // is computed per-render so a late-arriving prewarm fetch upgrades
  // the visible terminal mid-boot.
  const lines = useMemo(() => {
    const live = tl.connected && tl.sandbox_id != null;
    if (!live) return BOOT_LINES;
    return buildBootLines({
      live: true,
      sandboxId: tl.sandbox_id ?? "sb_audit_4f12ae",
      image: tl.image ?? "compile-audit-agent",
      cpus: tl.cpus ?? 4,
      memMb: tl.memory_mb ?? 8192,
    });
  }, [tl.connected, tl.sandbox_id, tl.image, tl.cpus, tl.memory_mb]);

  const visible = lines.slice(0, emitted);
  const showCaret = phase === "boot" && emitted < lines.length;
  return (
    <div className="audit-terminal">
      <div className="audit-terminal-head">
        <span className="t-dot red" />
        <span className="t-dot yellow" />
        <span className="t-dot green" />
        <span className="t-title">agent.audit() · stdout</span>
        {tl.connected && tl.sandbox_id != null ? (
          <span className="t-live-tag" title="live tensorlake sandbox">
            ◉ live
          </span>
        ) : null}
      </div>
      <div className="audit-terminal-body">
        {visible.map((line, i) => (
          <div key={i} className={`audit-term-line ${line.level}`}>
            <span className="ts">{line.ts}</span>
            <span className="text">{line.text}</span>
          </div>
        ))}
        {showCaret ? <span className="audit-term-caret" /> : null}
      </div>
    </div>
  );
}

function formatMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

function inferBehaviorTags(wf: Workflow): string[] {
  const tags: string[] = [];
  // Prompt is short / templated → static prompt
  if (wf.prompt_excerpt.length < 160) tags.push("static prompt");
  // Has structured input shape → schema-bounded
  if (wf.input_fields.length > 0) tags.push("typed input shape");
  // Most workflows here use temp 0 / structured output
  tags.push("temperature 0");
  tags.push("structured output");
  return tags;
}

function annualSpend(wf: Workflow): number {
  return wf.monthly_calls * wf.per_call_cost_usd * 12;
}

/**
 * Single-card description for one identified production workflow.
 * Streams in as the audit progresses through `classifying` → `manifest`.
 */
function WorkflowIdentifiedCard({
  workflow,
  index,
}: {
  workflow: Workflow;
  index: number;
}): JSX.Element {
  const tags = inferBehaviorTags(workflow);
  const yearly = annualSpend(workflow);
  const inputSummary = workflow.input_fields
    .map((f) => f.name)
    .slice(0, 6)
    .join(", ");
  const accentRgb = workflow.tier === "tier_2" ? "255, 179, 90" : "90, 252, 167";

  return (
    <article
      className={`audit-wf-card ${workflow.tier}`}
      style={{
        animationDelay: `${index * 110}ms`,
        ["--accent" as never]: accentRgb,
      }}
    >
      <header className="audit-wf-card-head">
        <span className="audit-wf-idx">
          {(index + 1).toString().padStart(2, "0")}
        </span>
        <div className="audit-wf-title-block">
          <h3 className="audit-wf-fn">{workflow.function_name}</h3>
          <div className="audit-wf-loc">
            <span>{workflow.file_path}</span>
            <span className="sep">·</span>
            <span>{workflow.provider}</span>
          </div>
        </div>
        <div className="audit-wf-traffic">
          <div className="audit-wf-traffic-num">
            {(workflow.monthly_calls / 1000).toFixed(0)}
            <span className="unit">k</span>
          </div>
          <div className="audit-wf-traffic-lbl">calls / month</div>
        </div>
      </header>

      <p className="audit-wf-desc">{workflow.description}</p>

      <div className="audit-wf-prompt">
        <span className="audit-wf-prompt-q">"</span>
        {workflow.prompt_excerpt}
        <span className="audit-wf-prompt-q">"</span>
      </div>

      <div className="audit-wf-stats">
        <div className="audit-wf-stat">
          <div className="audit-wf-stat-val">
            {workflow.input_fields.length}
            <span className="audit-wf-stat-sub">
              {" "}
              {workflow.input_fields.length === 1 ? "field" : "fields"}
            </span>
          </div>
          <div className="audit-wf-stat-lbl">input shape</div>
          <div className="audit-wf-stat-detail">{inputSummary}</div>
        </div>
        <div className="audit-wf-stat">
          <div className="audit-wf-stat-val">
            ${workflow.per_call_cost_usd.toFixed(3)}
          </div>
          <div className="audit-wf-stat-lbl">per call</div>
          <div className="audit-wf-stat-detail">{workflow.provider} list price</div>
        </div>
        <div className="audit-wf-stat">
          <div className="audit-wf-stat-val">{formatMoney(yearly)}</div>
          <div className="audit-wf-stat-lbl">annual spend</div>
          <div className="audit-wf-stat-detail">at current traffic</div>
        </div>
      </div>

      <div className="audit-wf-tags">
        {tags.map((t) => (
          <span key={t} className="audit-wf-tag">
            {t}
          </span>
        ))}
      </div>
    </article>
  );
}

function WorkflowsPanel(): JSX.Element {
  const classified = useRedesignStore((s) => s.audit.classified);
  const phase = useRedesignStore((s) => s.audit.phase);
  const filesScanned = useRedesignStore((s) => s.audit.files_scanned);
  const tokens = useRedesignStore((s) => s.audit.ast_tokens_seen);

  // Derive identified workflows from the classified stream — only
  // tier_1 / tier_2 entries become rich cards. Negatives are silently
  // dropped from this surface (we no longer show the rejection list).
  const identifiedWorkflows = useMemo<Workflow[]>(() => {
    const ids = new Set<string>();
    const out: Workflow[] = [];
    for (const site of classified) {
      if (site.outcome === "negative") continue;
      const id = site.workflow_id;
      if (!id || ids.has(id)) continue;
      const wf = CODIFIABLE_WORKFLOWS.find((w) => w.id === id);
      if (wf) {
        ids.add(id);
        out.push(wf);
      }
    }
    return out;
  }, [classified]);

  const totalSpend = useMemo(
    () =>
      identifiedWorkflows.reduce((acc, w) => acc + annualSpend(w), 0),
    [identifiedWorkflows],
  );
  const totalCalls = useMemo(
    () => identifiedWorkflows.reduce((acc, w) => acc + w.monthly_calls, 0),
    [identifiedWorkflows],
  );

  const headline = (() => {
    if (phase === "boot") return "spinning up sandbox…";
    if (phase === "scanning") return "scanning repository";
    if (phase === "classifying") return "identifying production workflows";
    if (phase === "filtering") return "scoring candidates";
    return "production workflows identified";
  })();

  const showEmpty =
    identifiedWorkflows.length === 0 &&
    (phase === "boot" || phase === "scanning");

  return (
    <section className="audit-workflows-panel">
      <header className="audit-wf-panel-head">
        <div className="audit-wf-panel-eyebrow">
          <span className="dot" />
          {headline}
        </div>
        <div className="audit-wf-panel-meters">
          <div className="meter">
            <span className="big">{filesScanned}</span>
            <span className="lbl">files</span>
          </div>
          <div className="meter">
            <span className="big">{tokens.toLocaleString()}</span>
            <span className="lbl">ast tokens</span>
          </div>
          <div className="meter">
            <span className="big">
              {identifiedWorkflows.length}
              <span className="dim"> / {CODIFIABLE_WORKFLOWS.length}</span>
            </span>
            <span className="lbl">workflows</span>
          </div>
          <div className="meter accent">
            <span className="big">{formatMoney(totalSpend)}</span>
            <span className="lbl">annual spend</span>
          </div>
          <div className="meter">
            <span className="big">{(totalCalls / 1000).toFixed(0)}k</span>
            <span className="lbl">calls/mo</span>
          </div>
        </div>
      </header>

      <div className="audit-wf-list">
        {showEmpty ? (
          <div className="audit-wf-empty">
            <span className="audit-wf-empty-pulse" />
            <span>walking AST · resolving call graph · matching providers</span>
          </div>
        ) : null}

        {identifiedWorkflows.map((wf, i) => (
          <WorkflowIdentifiedCard key={wf.id} workflow={wf} index={i} />
        ))}
      </div>
    </section>
  );
}

function ManifestOverlay(): JSX.Element | null {
  const phase = useRedesignStore((s) => s.audit.phase);
  const visible =
    phase === "manifest" || phase === "transition" || phase === "filtering";
  const folding = phase === "transition";
  if (!visible) return null;
  const codifiable = CODIFIABLE_WORKFLOWS;
  const totalSavings = codifiable.reduce(
    (acc, w) => acc + w.production.annual_savings_usd,
    0,
  );
  const totalCalls = codifiable.reduce(
    (acc, w) => acc + w.monthly_calls,
    0,
  );
  return (
    <div className={`audit-manifest ${folding ? "folding" : ""}`}>
      <div className="audit-manifest-eyebrow">audit complete</div>
      <div className="audit-manifest-headline">
        <span className="num">{codifiable.length}</span>
        <span className="lbl"> codifiable workflows</span>
      </div>
      <div className="audit-manifest-stats">
        <div className="stat">
          <span className="big">
            {(totalCalls / 1000).toFixed(0)}
            <span className="unit">k</span>
          </span>
          <span className="lbl">monthly calls codified</span>
        </div>
        <div className="stat green">
          <span className="big">
            ${(totalSavings / 1000).toFixed(1)}
            <span className="unit">k</span>
          </span>
          <span className="lbl">projected annual savings</span>
        </div>
        <div className="stat">
          <span className="big">7</span>
          <span className="lbl">left in negative vault</span>
        </div>
      </div>
      <div className="audit-manifest-list">
        {codifiable.map((w, i) => (
          <div
            key={w.id}
            className="audit-manifest-row"
            style={{ animationDelay: `${i * 140}ms` }}
          >
            <span className="fn">{w.function_name}</span>
            <span className="dim">·</span>
            <span className="path">{w.file_path}</span>
            <span className="dim">·</span>
            <span className="vol">
              {(w.monthly_calls / 1000).toFixed(0)}k/mo
            </span>
          </div>
        ))}
      </div>
      <div className="audit-manifest-cta">
        <span className="prompt">$</span>
        <span className="text">
          opening workspace · {codifiable.length} tabs · auto-routing
        </span>
        <span className="caret" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Top-level audit stage.

export function AuditStage(): JSX.Element {
  useAuditDriver();
  const phase = useRedesignStore((s) => s.audit.phase);

  // Keep a memoized class on the outer container — drives sandbox glow.
  const containerCls = useMemo(() => `audit-stage stage-${phase}`, [phase]);

  // Ambient phase title shown in the upper-right corner.
  const title = (() => {
    switch (phase) {
      case "boot":
        return "compile · agent · spinning up tensorlake sandbox";
      case "scanning":
        return "compile · agent · scanning repo";
      case "classifying":
        return "compile · agent · classifying call sites";
      case "filtering":
        return "compile · agent · filtering negatives";
      case "manifest":
      case "transition":
        return "compile · agent · audit complete";
      default:
        return "compile · agent";
    }
  })();

  return (
    <div className={containerCls}>
      <SandboxParticles />
      <div className="audit-shell">
        <SandboxFrame />
        <div className="audit-top">
          <div className="audit-brand">
            <span className="audit-brand-mark">●</span>
            <b>compile</b>
            <span className="dim">/ audit</span>
            <ServiceStatusBadges />
          </div>
          <div className="audit-title">{title}</div>
          <AuditLiveStats />
        </div>
        <div className="audit-grid">
          <BootTerminal />
          <WorkflowsPanel />
        </div>
        <PhaseIndicator />
        <ManifestOverlay />
      </div>
    </div>
  );
}

/**
 * Small chrome badges showing whether Tensorlake + Nia are reachable.
 * `live` (green) = real round-trip succeeded via prewarm.
 * `offline` (gray) = no key, fetch failed, or prewarm not yet run.
 */
function ServiceStatusBadges(): JSX.Element {
  const tl = useRedesignStore((s) => s.tensorlake);
  const nia = useRedesignStore((s) => s.nia);
  return (
    <div className="audit-svc-badges">
      <span
        className={`svc ${tl.connected ? "live" : "offline"}`}
        title={
          tl.connected
            ? `tensorlake · sandbox=${tl.sandbox_id ?? "?"} · cpus=${tl.cpus ?? "?"} · mem=${tl.memory_mb ?? "?"}MB · ns=${tl.namespace ?? "?"}`
            : "tensorlake · offline (run `npm run prewarm:ui` to connect)"
        }
      >
        <span className="svc-dot" />
        <span className="svc-name">tensorlake</span>
        <span className="svc-state">{tl.connected ? "live" : "offline"}</span>
      </span>
      <span
        className={`svc ${nia.connected ? "live" : "offline"}`}
        title={
          nia.connected
            ? `nia · vault=${nia.vault_id ?? "?"} · reachable`
            : "nia · offline (run `npm run prewarm:ui` to connect)"
        }
      >
        <span className="svc-dot" />
        <span className="svc-name">nia</span>
        <span className="svc-state">{nia.connected ? "live" : "offline"}</span>
      </span>
    </div>
  );
}

function AuditLiveStats(): JSX.Element {
  const phase = useRedesignStore((s) => s.audit.phase);
  const filesScanned = useRedesignStore((s) => s.audit.files_scanned);
  const classified = useRedesignStore((s) => s.audit.classified);
  const identified = classified.filter((c) => c.outcome !== "negative").length;
  return (
    <div className="audit-live-stats">
      <div className="stat">
        <span className="big">{filesScanned}</span>
        <span className="lbl">files</span>
      </div>
      <span className="sep">·</span>
      <div className="stat">
        <span className="big">{identified}</span>
        <span className="lbl">workflows</span>
      </div>
      <span className="sep">·</span>
      <span className={`audit-stage-tag ${phase}`}>{phase}</span>
    </div>
  );
}

/** Used by the App shell to keep the audit screen mounted (folding) while
 *  the workspace mounts beneath, then unmount once the fold completes. */
export function shouldShowAuditStage(phase: AuditPhase): boolean {
  return phase !== "complete";
}
