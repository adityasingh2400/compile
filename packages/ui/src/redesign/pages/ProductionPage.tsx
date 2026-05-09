/**
 * Production page — the steady-state traffic visualization.
 *
 *      ┌────────────┐
 *      │  NeoVault  │ ◀────╮
 *      └─────┬──────┘      │ (95% of traffic)
 *            │             │
 *      ┌─────┴──────┐  ╭──┴──╮
 *      │   Output   │  │ User│
 *      └─────┬──────┘  ╰──┬──╯
 *            │             │
 *      ┌─────┴──────┐      │ (5% of traffic)
 *      │ Frontier   │ ◀────╯
 *      └────────────┘
 *
 * Particles emit from the User node, choose path based on the
 * workflow's vault_share / frontier_share, animate along a cubic
 * bezier to the intermediate node, then a second bezier to Output.
 * Green particles = vault path; amber = frontier path.
 *
 * Live stats panel shows calls/min, dollars saved, and the latency +
 * cost gap between the two paths.
 */

import { useEffect, useMemo, useRef } from "react";
import { useRedesignStore } from "../../data/redesign-store.js";
import type { Workflow } from "../../data/workflows.js";

// ─────────────────────────────────────────────────────────────────────
// Topology layout — positions in 0..1 normalized space.

interface NodePos {
  /** Display id. */
  id: "user" | "vault" | "frontier" | "output";
  x: number;
  y: number;
  label: string;
  sub: string;
}

const NODES: NodePos[] = [
  { id: "user", x: 0.12, y: 0.5, label: "user", sub: "production caller" },
  { id: "vault", x: 0.55, y: 0.22, label: "neo vault", sub: "deterministic · ~0ms" },
  { id: "frontier", x: 0.55, y: 0.78, label: "frontier llm", sub: "novel inputs · ~1.2s" },
  { id: "output", x: 0.92, y: 0.5, label: "output", sub: "structured response" },
];

interface EdgeSpec {
  from: NodePos["id"];
  to: NodePos["id"];
  /** "vault" or "frontier" — drives color + share. */
  channel: "vault" | "frontier";
  /** Control points relative to (from, to) for the cubic bezier. */
  c1: [number, number];
  c2: [number, number];
}

const EDGES: EdgeSpec[] = [
  // user → vault: bows upward
  { from: "user", to: "vault", channel: "vault", c1: [0.35, 0.4], c2: [0.4, 0.22] },
  // user → frontier: bows downward
  { from: "user", to: "frontier", channel: "frontier", c1: [0.35, 0.6], c2: [0.4, 0.78] },
  // vault → output: bows downward to center
  { from: "vault", to: "output", channel: "vault", c1: [0.7, 0.22], c2: [0.78, 0.4] },
  // frontier → output: bows upward to center
  { from: "frontier", to: "output", channel: "frontier", c1: [0.7, 0.78], c2: [0.78, 0.6] },
];

function nodeBy(id: NodePos["id"]): NodePos {
  return NODES.find((n) => n.id === id)!;
}

// Bezier evaluation (cubic).
function bezier(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  t: number,
): [number, number] {
  const u = 1 - t;
  const x =
    u * u * u * p0[0]! +
    3 * u * u * t * p1[0]! +
    3 * u * t * t * p2[0]! +
    t * t * t * p3[0]!;
  const y =
    u * u * u * p0[1]! +
    3 * u * u * t * p1[1]! +
    3 * u * t * t * p2[1]! +
    t * t * t * p3[1]!;
  return [x, y];
}

// ─────────────────────────────────────────────────────────────────────
// Particle system. Particles are pooled — when one finishes, it goes
// back into a free list and gets re-emitted from the User node.

interface Particle {
  /** -1 = inactive (in free pool). */
  active: boolean;
  /** Edge index in path[]. */
  segIndex: number;
  /** Progress along current segment, 0..1. */
  t: number;
  /** Channel (drives color). */
  channel: "vault" | "frontier";
  /** Path = list of (from→to) segments to traverse. */
  path: { from: NodePos["id"]; to: NodePos["id"] }[];
  /** Speed multiplier. */
  speed: number;
}

function makeParticle(): Particle {
  return {
    active: false,
    segIndex: 0,
    t: 0,
    channel: "vault",
    path: [],
    speed: 1,
  };
}

function findEdge(from: NodePos["id"], to: NodePos["id"]): EdgeSpec | null {
  return EDGES.find((e) => e.from === from && e.to === to) ?? null;
}

interface CanvasProps {
  workflow: Workflow;
}

function ProductionCanvas({ workflow }: CanvasProps): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const particles = useMemo<Particle[]>(() => {
    return Array.from({ length: 360 }, () => makeParticle());
  }, []);

  // Read from store inside rAF rather than re-rendering React.
  const productionActive = useRedesignStore(
    (s) => s.workflows[workflow.id]?.production.active ?? false,
  );

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
    const ro = new ResizeObserver(resize);
    if (containerRef.current) ro.observe(containerRef.current);

    let raf = 0;
    let last = performance.now();
    let emitAccum = 0;

    const emitOne = () => {
      const free = particles.find((p) => !p.active);
      if (!free) return;
      const r = Math.random();
      const useVault = r < workflow.production.vault_share;
      free.active = true;
      free.segIndex = 0;
      free.t = 0;
      free.channel = useVault ? "vault" : "frontier";
      free.path = useVault
        ? [
            { from: "user", to: "vault" },
            { from: "vault", to: "output" },
          ]
        : [
            { from: "user", to: "frontier" },
            { from: "frontier", to: "output" },
          ];
      // Particles on the slower frontier path animate ~0.4× slower so
      // the speed gap is also visible (latency story).
      free.speed = useVault ? 1.0 : 0.55;
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;

      // Trail-decay clear.
      ctx.fillStyle = "rgba(255, 247, 240, 0.45)";
      ctx.fillRect(0, 0, w, h);

      // ── Draw edges (faint glow lines).
      for (const e of EDGES) {
        const a = nodeBy(e.from);
        const b = nodeBy(e.to);
        const ax = a.x * w;
        const ay = a.y * h;
        const bx = b.x * w;
        const by = b.y * h;
        const c1x = e.c1[0] * w;
        const c1y = e.c1[1] * h;
        const c2x = e.c2[0] * w;
        const c2y = e.c2[1] * h;
        const isVault = e.channel === "vault";
        // Cream backdrop → use maroon for the vault edge (high signal,
        // dominant path) and a softer warm orange for the frontier edge.
        const stroke = isVault
          ? "rgba(192, 57, 43, 0.32)"
          : "rgba(255, 159, 67, 0.32)";
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.bezierCurveTo(c1x, c1y, c2x, c2y, bx, by);
        ctx.stroke();

        // Subtle wide-stroke shadow underlay on the vault path.
        if (isVault) {
          ctx.strokeStyle = "rgba(192, 57, 43, 0.08)";
          ctx.lineWidth = 8;
          ctx.beginPath();
          ctx.moveTo(ax, ay);
          ctx.bezierCurveTo(c1x, c1y, c2x, c2y, bx, by);
          ctx.stroke();
        }
      }

      // ── Emit new particles based on calls/min.
      if (productionActive) {
        // Target rate: calls_per_minute / 60 = calls_per_sec.
        // Visual dial-up: emit ~1/8 of the real rate so we don't blow
        // the canvas; the side panel still shows true production rate.
        const visRate = (workflow.production.calls_per_minute / 60) * 0.18;
        emitAccum += visRate * dt;
        while (emitAccum >= 1) {
          emitOne();
          emitAccum -= 1;
        }
      }

      // ── Step particles + render.
      // No additive blending on cream — render in normal alpha mode
      // with rich maroon (vault) / orange (frontier) ink colors.
      for (const p of particles) {
        if (!p.active) continue;
        const seg = p.path[p.segIndex];
        if (!seg) {
          p.active = false;
          continue;
        }
        const e = findEdge(seg.from, seg.to);
        if (!e) {
          p.active = false;
          continue;
        }
        const baseDuration = 1.4;
        p.t += (dt / baseDuration) * p.speed;
        if (p.t >= 1) {
          p.t = 0;
          p.segIndex += 1;
          if (p.segIndex >= p.path.length) {
            p.active = false;
            continue;
          }
        }
        const seg2 = p.path[p.segIndex];
        if (!seg2) {
          p.active = false;
          continue;
        }
        const e2 = findEdge(seg2.from, seg2.to);
        if (!e2) {
          p.active = false;
          continue;
        }
        const a = nodeBy(e2.from);
        const b = nodeBy(e2.to);
        const [px, py] = bezier(
          [a.x * w, a.y * h],
          [e2.c1[0] * w, e2.c1[1] * h],
          [e2.c2[0] * w, e2.c2[1] * h],
          [b.x * w, b.y * h],
          p.t,
        );
        const isVault = p.channel === "vault";
        const trailColor = isVault
          ? "rgba(192, 57, 43, 0.95)"
          : "rgba(255, 159, 67, 0.95)";
        ctx.fillStyle = trailColor;
        ctx.fillRect(px, py, 2.6, 2.6);
        ctx.fillStyle = isVault
          ? "rgba(192, 57, 43, 0.18)"
          : "rgba(255, 159, 67, 0.18)";
        ctx.beginPath();
        ctx.arc(px, py, 5.5, 0, Math.PI * 2);
        ctx.fill();
      }

      // ── Draw nodes (over particles).
      drawNodes(ctx, w, h, now);

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [particles, productionActive, workflow]);

  return (
    <div ref={containerRef} className="prod-canvas-host">
      <canvas ref={ref} className="prod-canvas" />
    </div>
  );
}

function drawNodes(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  now: number,
): void {
  for (const n of NODES) {
    const x = n.x * w;
    const y = n.y * h;
    const pulse = 0.6 + 0.4 * Math.sin(now * 0.003 + n.x * 6);
    let radius = 28;
    let glow = "rgba(122, 223, 255, 0.45)";
    if (n.id === "vault") {
      radius = 36;
      glow = "rgba(90, 252, 167, 0.55)";
    } else if (n.id === "frontier") {
      radius = 32;
      glow = "rgba(255, 179, 90, 0.45)";
    } else if (n.id === "output") {
      radius = 28;
      glow = "rgba(180, 141, 255, 0.45)";
    }
    // Outer glow
    const grd = ctx.createRadialGradient(x, y, 0, x, y, radius * 2.6);
    grd.addColorStop(0, glow);
    grd.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.arc(x, y, radius * 2.6, 0, Math.PI * 2);
    ctx.fill();
    // Inner ring
    ctx.strokeStyle = glow;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.4 + pulse * 0.4;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // Inner solid
    ctx.fillStyle = "rgba(7, 9, 14, 0.94)";
    ctx.beginPath();
    ctx.arc(x, y, radius - 4, 0, Math.PI * 2);
    ctx.fill();
    // Symbol — vault hex, frontier diamond, user circle, output arrow.
    ctx.strokeStyle =
      n.id === "vault"
        ? "rgba(90, 252, 167, 0.95)"
        : n.id === "frontier"
          ? "rgba(255, 179, 90, 0.9)"
          : n.id === "user"
            ? "rgba(122, 223, 255, 0.95)"
            : "rgba(180, 141, 255, 0.95)";
    ctx.lineWidth = 1.2;
    if (n.id === "vault") {
      drawHex(ctx, x, y, radius - 14);
    } else if (n.id === "frontier") {
      drawDiamond(ctx, x, y, radius - 14);
    } else if (n.id === "user") {
      drawUser(ctx, x, y, radius - 14);
    } else if (n.id === "output") {
      drawOutput(ctx, x, y, radius - 14);
    }
    // Label below node
    ctx.fillStyle = "rgba(232, 234, 238, 0.95)";
    ctx.font = "600 13px 'Inter', sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(n.label, x, y + radius + 22);
    ctx.fillStyle = "rgba(106, 112, 128, 0.95)";
    ctx.font = "11px 'JetBrains Mono', ui-monospace, monospace";
    ctx.fillText(n.sub, x, y + radius + 38);
  }
}

function drawHex(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
): void {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.45, cy);
  ctx.lineTo(cx + r * 0.45, cy);
  ctx.moveTo(cx, cy - r * 0.45);
  ctx.lineTo(cx, cy + r * 0.45);
  ctx.stroke();
}

function drawDiamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r, cy);
  ctx.closePath();
  ctx.stroke();
}

function drawUser(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.3, r * 0.4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.65, cy + r * 0.7);
  ctx.bezierCurveTo(
    cx - r * 0.6,
    cy + r * 0.1,
    cx + r * 0.6,
    cy + r * 0.1,
    cx + r * 0.65,
    cy + r * 0.7,
  );
  ctx.stroke();
}

function drawOutput(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.7, cy);
  ctx.lineTo(cx + r * 0.7, cy);
  ctx.moveTo(cx + r * 0.2, cy - r * 0.5);
  ctx.lineTo(cx + r * 0.7, cy);
  ctx.lineTo(cx + r * 0.2, cy + r * 0.5);
  ctx.stroke();
}

// ─────────────────────────────────────────────────────────────────────
// Stats panel — shows live counters + comparison metrics.

function StatsPanel({ workflow }: { workflow: Workflow }): JSX.Element {
  const slice = useRedesignStore((s) => s.workflows[workflow.id]);
  const vaultCalls = slice?.production.vault_calls ?? 0;
  const frontierCalls = slice?.production.frontier_calls ?? 0;
  const dollars = slice?.production.dollars_saved ?? 0;
  const total = vaultCalls + frontierCalls;
  const ratio = total > 0 ? vaultCalls / total : workflow.production.vault_share;
  const totalMonthlyAt = workflow.monthly_calls;

  return (
    <aside className="prod-stats">
      <div className="prod-card">
        <div className="prod-card-head">
          <span className="num">★</span>
          <span className="title">live routing</span>
          <span className="hint">production · last 60s</span>
        </div>
        <div className="prod-bar">
          <span
            className="seg vault"
            style={{ width: `${ratio * 100}%` }}
          />
          <span
            className="seg frontier"
            style={{ width: `${(1 - ratio) * 100}%` }}
          />
        </div>
        <div className="prod-bar-meta">
          <span className="vault">
            <span className="dot vault" />
            <b>{Math.round(ratio * 100)}%</b> vault · {vaultCalls.toLocaleString()} calls
          </span>
          <span className="frontier">
            <span className="dot frontier" />
            <b>{Math.round((1 - ratio) * 100)}%</b> frontier ·{" "}
            {frontierCalls.toLocaleString()} calls
          </span>
        </div>
      </div>

      <div className="prod-card">
        <div className="prod-card-head">
          <span className="num">$</span>
          <span className="title">savings</span>
          <span className="hint">vs all-frontier baseline</span>
        </div>
        <div className="prod-savings-big">
          <div className="big">${dollars.toFixed(2)}</div>
          <div className="lbl">saved · this animation cycle</div>
        </div>
        <div className="prod-savings-row">
          <div className="cell">
            <div className="big">${workflow.production.annual_savings_usd.toLocaleString()}</div>
            <div className="lbl">annualized · projected</div>
          </div>
          <div className="cell">
            <div className="big">{(totalMonthlyAt / 1000).toFixed(0)}k</div>
            <div className="lbl">calls/month</div>
          </div>
        </div>
      </div>

      <div className="prod-card">
        <div className="prod-card-head">
          <span className="num">μ</span>
          <span className="title">latency · cost</span>
          <span className="hint">per call</span>
        </div>
        <CompareRow
          label="latency"
          vault={`${workflow.production.vault_latency_ms.toFixed(1)}ms`}
          frontier={`${workflow.production.frontier_latency_ms}ms`}
          ratio={
            workflow.production.frontier_latency_ms /
            Math.max(workflow.production.vault_latency_ms, 0.1)
          }
          unit="x faster"
        />
        <CompareRow
          label="cost"
          vault={`$0.0000`}
          frontier={`$${workflow.per_call_cost_usd.toFixed(4)}`}
          ratio={workflow.per_call_cost_usd > 0 ? Number.POSITIVE_INFINITY : 1}
          unit="x cheaper"
          showInfinity
        />
      </div>

      <div className="prod-card subtle">
        <div className="prod-card-head">
          <span className="num">⊙</span>
          <span className="title">why frontier still fires</span>
          <span className="hint">5–8% novel inputs</span>
        </div>
        <p className="prod-note">
          The frontier model picks up inputs that don't match any codified
          branch — true novelty, schema drift, edge cases. Compile observes
          those calls and, when the cluster signature reappears at threshold,
          fires another bootstrap to cover them. The vault grows over time.
        </p>
      </div>
    </aside>
  );
}

function CompareRow({
  label,
  vault,
  frontier,
  ratio,
  unit,
  showInfinity = false,
}: {
  label: string;
  vault: string;
  frontier: string;
  ratio: number;
  unit: string;
  showInfinity?: boolean;
}): JSX.Element {
  const text = showInfinity || !isFinite(ratio)
    ? `∞ ${unit}`
    : `${ratio.toFixed(0)}× ${unit}`;
  return (
    <div className="prod-compare-row">
      <span className="lbl">{label}</span>
      <span className="vault">{vault}</span>
      <span className="vs">vs</span>
      <span className="frontier">{frontier}</span>
      <span className="ratio">{text}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Top-level page.

export function ProductionPage({
  workflow,
}: {
  workflow: Workflow;
}): JSX.Element {
  return (
    <div className="prod-page">
      <ProductionCanvas workflow={workflow} />
      <StatsPanel workflow={workflow} />
    </div>
  );
}
