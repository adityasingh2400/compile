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
  type AuditCallSite,
} from "../data/workflows.js";

// ─────────────────────────────────────────────────────────────────────
// Boot lines — typewriter into the sandbox terminal.

const BOOT_LINES: { ts: string; level: "info" | "ok" | "warn"; text: string }[] = [
  { ts: "00:00.013", level: "info", text: "tensorlake.Sandbox.create({ image: 'compile-audit-agent' })" },
  { ts: "00:00.214", level: "info", text: "  · pulling layers — base, node22, ts-morph, tree-sitter" },
  { ts: "00:00.731", level: "info", text: "  · microvm boot · alloc 4 vCPU / 8GB · region us-west-2" },
  { ts: "00:01.027", level: "ok",   text: "✓ sandbox ready · sb_audit_4f12ae · 4012ms cold start" },
  { ts: "00:01.044", level: "info", text: "agent.audit({ repo: 'data/acme-agent' })" },
  { ts: "00:01.061", level: "info", text: "  · git rev-parse HEAD → a3f2d1b" },
  { ts: "00:01.118", level: "info", text: "  · ts-morph project · loading tsconfig.json" },
  { ts: "00:01.420", level: "ok",   text: "✓ project loaded · 38 source files · 4 packages" },
  { ts: "00:01.460", level: "info", text: "scanner.findCallSites({ providers: ['openai','anthropic','google'] })" },
];

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

const AUDIT_DRIVER = { started: false };

async function runAuditTimeline(): Promise<void> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const s = () => useRedesignStore.getState();

  // ── BOOT ───────────────────────────────────────────────────────────
  s().setAuditPhase("boot");
  for (let i = 0; i < BOOT_LINES.length; i++) {
    s().bumpBootLines();
    await sleep(180);
  }
  await sleep(340);

  // ── SCANNING ───────────────────────────────────────────────────────
  s().setAuditPhase("scanning");
  for (let i = 0; i < SCAN_FILES.length; i++) {
    s().setFilesScanned(i + 1);
    for (let k = 0; k < 18; k++) {
      s().bumpAstTokens(40 + Math.floor(Math.random() * 60));
      await sleep(14);
    }
    await sleep(120);
  }
  await sleep(380);

  // ── CLASSIFYING ────────────────────────────────────────────────────
  s().setAuditPhase("classifying");
  for (const site of AUDIT_CALL_SITES) {
    s().pushClassified(site);
    await sleep(280);
  }
  await sleep(520);

  // ── FILTERING ──────────────────────────────────────────────────────
  s().setAuditPhase("filtering");
  s().setFiltered(true);
  await sleep(2200);

  // ── MANIFEST ───────────────────────────────────────────────────────
  s().setAuditPhase("manifest");
  await sleep(3300);

  // ── TRANSITION → WORKSPACE ────────────────────────────────────────
  s().setAuditPhase("transition");
  await sleep(900);
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
      ctx.fillStyle = "rgba(5, 6, 8, 0.55)";
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
  return (
    <div className={`audit-sandbox-frame audit-phase-${phase}`}>
      <div className="audit-sandbox-corners">
        <span className="corner tl" />
        <span className="corner tr" />
        <span className="corner bl" />
        <span className="corner br" />
      </div>
      <div className="audit-sandbox-meta">
        <span className="dot live" />
        <span>tensorlake sandbox</span>
        <span className="sep">·</span>
        <span>sb_audit_4f12ae</span>
        <span className="sep">·</span>
        <span>image=compile-audit-agent</span>
        <span className="sep">·</span>
        <span>region=us-west-2</span>
        <span className="sep">·</span>
        <span>4 vCPU · 8 GB</span>
      </div>
    </div>
  );
}

function BootTerminal(): JSX.Element {
  const emitted = useRedesignStore((s) => s.audit.boot_lines_emitted);
  const phase = useRedesignStore((s) => s.audit.phase);
  const visible = BOOT_LINES.slice(0, emitted);
  const showCaret = phase === "boot" && emitted < BOOT_LINES.length;
  return (
    <div className="audit-terminal">
      <div className="audit-terminal-head">
        <span className="t-dot red" />
        <span className="t-dot yellow" />
        <span className="t-dot green" />
        <span className="t-title">agent.audit() · stdout</span>
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

function ScanColumn(): JSX.Element {
  const filesScanned = useRedesignStore((s) => s.audit.files_scanned);
  const tokens = useRedesignStore((s) => s.audit.ast_tokens_seen);
  const phase = useRedesignStore((s) => s.audit.phase);
  const active =
    phase === "scanning" || phase === "classifying" || phase === "filtering" ||
    phase === "manifest";
  return (
    <div className={`audit-scan ${active ? "active" : ""}`}>
      <div className="audit-card-head">
        <span className="num">02</span>
        <span className="title">scan · ast</span>
        <span className="hint">ts-morph + tree-sitter</span>
        {phase === "scanning" ? <span className="audit-pulse" /> : null}
      </div>
      <div className="audit-scan-files">
        {SCAN_FILES.map((path, i) => {
          const isLit = i === filesScanned - 1 && phase === "scanning";
          const isDone = i < filesScanned;
          return (
            <div
              key={path}
              className={`audit-scan-file ${isLit ? "lit" : ""} ${isDone ? "done" : ""}`}
            >
              <span className="dot" />
              <span className="path">{path}</span>
            </div>
          );
        })}
      </div>
      <div className="audit-scan-meters">
        <div className="meter">
          <div className="big">{filesScanned}</div>
          <div className="lbl">files scanned</div>
        </div>
        <div className="meter">
          <div className="big">{tokens.toLocaleString()}</div>
          <div className="lbl">ast tokens</div>
        </div>
        <div className="meter">
          <div className="big">{phase === "boot" ? "—" : "10"}</div>
          <div className="lbl">llm call sites</div>
        </div>
      </div>
    </div>
  );
}

function pillCls(outcome: AuditCallSite["outcome"]): string {
  if (outcome === "tier_1") return "tier1";
  if (outcome === "tier_2") return "tier2";
  return "neg";
}

function ClassifyColumn(): JSX.Element {
  const classified = useRedesignStore((s) => s.audit.classified);
  const phase = useRedesignStore((s) => s.audit.phase);
  const filtered = useRedesignStore((s) => s.audit.filtered);
  const active = phase === "classifying" || phase === "filtering" ||
    phase === "manifest";
  const t1 = classified.filter((c) => c.outcome === "tier_1").length;
  const t2 = classified.filter((c) => c.outcome === "tier_2").length;
  const neg = classified.filter((c) => c.outcome === "negative").length;
  return (
    <div className={`audit-classify ${active ? "active" : ""}`}>
      <div className="audit-card-head">
        <span className="num">03</span>
        <span className="title">classify · tier verdict</span>
        <span className="hint">priors from code structure</span>
        {phase === "classifying" ? <span className="audit-pulse" /> : null}
      </div>
      <div className="audit-classify-list">
        {classified.map((site, i) => {
          const cls = pillCls(site.outcome);
          const dim = filtered && site.outcome === "negative";
          const promoted = filtered && site.outcome !== "negative";
          return (
            <div
              key={site.call_site_id}
              className={`audit-classify-row ${cls} ${dim ? "dim" : ""} ${promoted ? "promoted" : ""}`}
              style={{
                transitionDelay: `${i * 28}ms`,
              }}
            >
              <span className={`tier-pill ${cls}`}>
                {site.outcome === "tier_1"
                  ? "T1"
                  : site.outcome === "tier_2"
                    ? "T2"
                    : "—"}
              </span>
              <span className="fn">{site.function_hint}</span>
              <span className="path">
                {site.file_path}:{site.line}
              </span>
              <span className="reason">{site.reason}</span>
              <span className="vol">
                {site.monthly_calls.toLocaleString()}/mo
              </span>
            </div>
          );
        })}
      </div>
      <div className="audit-classify-foot">
        <span className="bucket t1">
          T1 <b>{t1}</b>
        </span>
        <span className="sep">·</span>
        <span className="bucket t2">
          T2 <b>{t2}</b>
        </span>
        <span className="sep">·</span>
        <span className="bucket neg">
          negative <b>{neg}</b>
        </span>
      </div>
    </div>
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
      <div className="audit-manifest-pills">
        {codifiable.map((w, i) => (
          <div
            key={w.id}
            className={`audit-manifest-pill ${w.tier}`}
            style={{ animationDelay: `${i * 140}ms` }}
          >
            <span className="tier-tag">{w.tier === "tier_1" ? "T1" : "T2"}</span>
            <span className="fn">{w.display_name}</span>
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
          </div>
          <div className="audit-title">{title}</div>
        </div>
        <div className="audit-grid">
          <BootTerminal />
          <ScanColumn />
          <ClassifyColumn />
        </div>
        <PhaseIndicator />
        <ManifestOverlay />
      </div>
    </div>
  );
}

/** Used by the App shell to keep the audit screen mounted (folding) while
 *  the workspace mounts beneath, then unmount once the fold completes. */
export function shouldShowAuditStage(phase: AuditPhase): boolean {
  return phase !== "complete";
}
