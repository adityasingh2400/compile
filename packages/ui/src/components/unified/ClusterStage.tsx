/**
 * ClusterStage — the technical hero of the dashboard.
 *
 * For the active workflow:
 *   • ~1,000 synthetic API-call nodes spawn over time, each one a
 *     point of light that flies in from the canvas edge
 *   • A force simulation pulls each node toward its semantically
 *     assigned cluster centroid + small jitter
 *   • Once cohesion ≥ ~0.6 we render the cluster hulls (translucent
 *     filled circles) and the cluster annotations (label + tier
 *     badge + share% + bullet-pointed defining characteristics with
 *     a connector line back to the centroid)
 *
 * Switching tabs at any time swaps the workflow being rendered;
 * each workflow keeps its own progress in the unified store so
 * the animation resumes coherently.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useUnifiedStore } from "../../unified-store.js";
import { pickCluster, type Workflow, type WorkflowCluster } from "../../demo/workflows.js";

const NODE_TARGET = 1000;
const MAX_NODES = 1200;

interface NodeBuffer {
  x: Float32Array;
  y: Float32Array;
  tx: Float32Array;
  ty: Float32Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  /** 0..1 ramp to terminal color (mirrors the cluster's tier color). */
  ramp: Float32Array;
  /** Cluster index (into workflow.clusters) for each node. */
  ci: Int16Array;
  count: number;
  /** Workflow ID this buffer was populated for; resetting when tab changes. */
  workflow_id: string;
}

function makeBuffer(workflow_id: string): NodeBuffer {
  return {
    x: new Float32Array(MAX_NODES),
    y: new Float32Array(MAX_NODES),
    tx: new Float32Array(MAX_NODES),
    ty: new Float32Array(MAX_NODES),
    r: new Float32Array(MAX_NODES),
    g: new Float32Array(MAX_NODES),
    b: new Float32Array(MAX_NODES),
    ramp: new Float32Array(MAX_NODES),
    ci: new Int16Array(MAX_NODES),
    count: 0,
    workflow_id,
  };
}

export function ClusterStage(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 1280, h: 720 });

  const workflows = useUnifiedStore((s) => s.workflows);
  const activeId = useUnifiedStore((s) => s.active_workflow_id);
  const cluster = useUnifiedStore((s) => s.cluster);
  const setNodesEmitted = useUnifiedStore((s) => s.setClusterNodesEmitted);
  const setCohesion = useUnifiedStore((s) => s.setClusterCohesion);
  const revealCluster = useUnifiedStore((s) => s.revealCluster);

  const workflow = workflows.find((w) => w.id === activeId)!;
  const progress = cluster[activeId];

  // Buffer survives across renders. Re-init on workflow switch.
  const bufRef = useRef<NodeBuffer>(makeBuffer(activeId));
  if (bufRef.current.workflow_id !== activeId) {
    bufRef.current = makeBuffer(activeId);
  }
  const buf = bufRef.current;

  // ── observe container size ────────────────────────────────────
  useEffect(() => {
    const sync = () => {
      if (containerRef.current) {
        setSize({
          w: containerRef.current.clientWidth,
          h: containerRef.current.clientHeight,
        });
      }
    };
    sync();
    const obs = new ResizeObserver(sync);
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  // ── node spawner: emit cells into the buffer over ~6 seconds ──
  useEffect(() => {
    let cancelled = false;
    let lastEmitTs = performance.now();
    const startCount = buf.count;
    const remaining = NODE_TARGET - startCount;
    if (remaining <= 0) return;

    const tickEmit = () => {
      if (cancelled) return;
      const now = performance.now();
      const dt = (now - lastEmitTs) / 1000;
      lastEmitTs = now;
      // Roughly NODE_TARGET nodes over ~6s → ~165 nodes/sec.
      const want = Math.min(NODE_TARGET, buf.count + Math.ceil(165 * dt));
      while (buf.count < want && buf.count < MAX_NODES) {
        const idx = buf.count;
        const c = pickCluster(workflow);
        const ci = workflow.clusters.indexOf(c);
        buf.ci[idx] = ci;
        // fly-in from a random edge of the canvas
        const edge = Math.floor(Math.random() * 4);
        buf.x[idx] = edge === 0 ? -1.1 : edge === 1 ? 1.1 : Math.random() * 2 - 1;
        buf.y[idx] = edge === 2 ? -1.1 : edge === 3 ? 1.1 : Math.random() * 2 - 1;
        // small jitter around centroid
        const jitter = 0.08 + (1 - c.share) * 0.04;
        buf.tx[idx] = c.centroid[0] + (Math.random() - 0.5) * jitter * 2;
        buf.ty[idx] = c.centroid[1] + (Math.random() - 0.5) * jitter * 2;
        buf.r[idx] = c.color[0] / 255;
        buf.g[idx] = c.color[1] / 255;
        buf.b[idx] = c.color[2] / 255;
        buf.ramp[idx] = 0;
        buf.count++;
      }
      setNodesEmitted(activeId, buf.count);
      if (buf.count < NODE_TARGET) {
        setTimeout(tickEmit, 30);
      }
    };
    tickEmit();
    return () => {
      cancelled = true;
    };
    // re-emit when workflow changes
  }, [activeId, workflow, buf, setNodesEmitted]);

  // ── reveal each cluster's annotation once nodes settle near it ──
  useEffect(() => {
    if (!progress) return;
    const allRevealed = workflow.clusters.every(
      (c) => progress.cluster_revealed[c.id],
    );
    if (allRevealed) return;
    let cancelled = false;
    let i = 0;
    const next = () => {
      if (cancelled) return;
      if (i >= workflow.clusters.length) return;
      const c = workflow.clusters[i]!;
      revealCluster(activeId, c.id);
      i++;
      setTimeout(next, 380);
    };
    // Begin revealing once node emission is well underway.
    const startAfter = setTimeout(next, 4500);
    return () => {
      cancelled = true;
      clearTimeout(startAfter);
    };
    // revealCluster is stable; deps focus on workflow + progress completion
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, workflow]);

  // ── render loop ───────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
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
    const obs = new ResizeObserver(resize);
    obs.observe(canvas);

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;

      // Trail-fade clears the previous frame to a near-black, leaving
      // motion trails visible. Same trick as the original constellation.
      ctx.fillStyle = "rgba(5, 6, 8, 0.18)";
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      // Constrain the cluster span so cluster annotations have room
      // to sit just outside the cluster radius without bleeding into
      // the tab strip / context strip.
      const scale = Math.min(w, h) * 0.34;

      // physics
      const k = 2.6;
      let settled = 0;
      for (let i = 0; i < buf.count; i++) {
        const dx = buf.tx[i]! - buf.x[i]!;
        const dy = buf.ty[i]! - buf.y[i]!;
        const dist = Math.hypot(dx, dy);
        buf.x[i]! += dx * k * dt;
        buf.y[i]! += dy * k * dt;
        // small Brownian jitter so settled nodes still breathe
        buf.x[i]! += (Math.random() - 0.5) * 0.0014;
        buf.y[i]! += (Math.random() - 0.5) * 0.0014;
        if (buf.ramp[i]! < 1) buf.ramp[i]! = Math.min(1, buf.ramp[i]! + dt * 0.45);
        if (dist < 0.05) settled++;
      }
      const cohesion = buf.count > 0 ? settled / buf.count : 0;
      // Throttle store updates to ~10/sec so we don't trash zustand subs.
      if (Math.floor(now / 100) !== Math.floor(last / 100)) {
        setCohesion(activeId, cohesion);
      }

      // Draw cluster hulls *behind* the points so nodes sit on top.
      for (const c of workflow.clusters) {
        const px = cx + c.centroid[0] * scale;
        const py = cy + c.centroid[1] * scale;
        // hull radius scales with cluster share
        const radius = (0.16 + Math.sqrt(c.share) * 0.18) * scale;
        const grd = ctx.createRadialGradient(px, py, 0, px, py, radius);
        const a = 0.04 + Math.min(0.1, cohesion * 0.18);
        grd.addColorStop(0, `rgba(${c.color[0]}, ${c.color[1]}, ${c.color[2]}, ${a})`);
        grd.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();

        // Hull outline once cohesion is high enough.
        if (cohesion > 0.5) {
          ctx.strokeStyle = `rgba(${c.color[0]}, ${c.color[1]}, ${c.color[2]}, ${
            0.12 + cohesion * 0.18
          })`;
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.arc(px, py, radius, 0, Math.PI * 2);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // Draw nodes with additive blending so cluster cores glow.
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < buf.count; i++) {
        const ramp = buf.ramp[i]!;
        const r = 0.92 * (1 - ramp) + buf.r[i]! * ramp;
        const g = 0.92 * (1 - ramp) + buf.g[i]! * ramp;
        const b = 0.95 * (1 - ramp) + buf.b[i]! * ramp;
        const alpha = 0.45 + ramp * 0.4;
        ctx.fillStyle = `rgba(${(r * 255) | 0}, ${(g * 255) | 0}, ${
          (b * 255) | 0
        }, ${alpha})`;
        const px = cx + buf.x[i]! * scale;
        const py = cy + buf.y[i]! * scale;
        ctx.fillRect(px, py, 1.7, 1.7);
      }
      ctx.globalCompositeOperation = "source-over";

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      obs.disconnect();
    };
  }, [activeId, buf, setCohesion, workflow]);

  return (
    <div className="ud-stage cluster-stage" ref={containerRef}>
      <canvas ref={canvasRef} className="ud-cluster-canvas" />
      <ClusterAnnotations workflow={workflow} size={size} />
      <ClusterHeader workflow={workflow} />
    </div>
  );
}

// ── annotations: each cluster's label + characteristics card ─────────

function ClusterAnnotations({
  workflow,
  size,
}: {
  workflow: Workflow;
  size: { w: number; h: number };
}): JSX.Element {
  const activeId = useUnifiedStore((s) => s.active_workflow_id);
  const progress = useUnifiedStore((s) => s.cluster[s.active_workflow_id]);
  const cx = size.w / 2;
  const cy = size.h / 2;
  const scale = Math.min(size.w, size.h) * 0.34;

  return (
    <div className="ud-cluster-annotations">
      {workflow.clusters.map((c, i) => {
        const px = cx + c.centroid[0] * scale;
        const py = cy + c.centroid[1] * scale;
        const radius = (0.16 + Math.sqrt(c.share) * 0.18) * scale;
        // Position the card just outside the hull on whichever side has
        // most room. Heuristic: use the centroid direction from canvas
        // center to push the card outward.
        const ang = Math.atan2(c.centroid[1], c.centroid[0] || 0.0001);
        const cardOffset = radius + 14;
        const cardX = px + Math.cos(ang) * cardOffset;
        const cardY = py + Math.sin(ang) * cardOffset;
        const revealed = !!progress?.cluster_revealed[c.id];
        return (
          <ClusterCard
            key={`${activeId}:${c.id}`}
            cluster={c}
            indexNumber={i + 1}
            cardX={cardX}
            cardY={cardY}
            centroidX={px}
            centroidY={py}
            visible={revealed}
          />
        );
      })}
    </div>
  );
}

function ClusterCard({
  cluster,
  indexNumber,
  cardX,
  cardY,
  centroidX,
  centroidY,
  visible,
}: {
  cluster: WorkflowCluster;
  indexNumber: number;
  cardX: number;
  cardY: number;
  centroidX: number;
  centroidY: number;
  visible: boolean;
}): JSX.Element {
  const tierLabel =
    cluster.tier === "tier_1" ? "T1" : cluster.tier === "tier_2" ? "T2" : "T3";
  return (
    <>
      {/* connector line from card to centroid */}
      <svg
        className="ud-cluster-connector"
        style={{
          opacity: visible ? 0.55 : 0,
          transition: "opacity 380ms ease",
        }}
      >
        <line
          x1={cardX}
          y1={cardY}
          x2={centroidX}
          y2={centroidY}
          stroke={`rgb(${cluster.color[0]}, ${cluster.color[1]}, ${cluster.color[2]})`}
          strokeDasharray="3 4"
          strokeWidth="1"
        />
        <circle
          cx={centroidX}
          cy={centroidY}
          r={3}
          fill={`rgb(${cluster.color[0]}, ${cluster.color[1]}, ${cluster.color[2]})`}
        />
      </svg>

      <div
        className={`ud-cluster-card ${cluster.tier}`}
        style={{
          left: cardX,
          top: cardY,
          opacity: visible ? 1 : 0,
          transform: visible
            ? "translate(-50%, -50%) scale(1)"
            : "translate(-50%, -50%) scale(0.92)",
          transition: "opacity 380ms ease, transform 380ms ease",
        }}
      >
        <div className="head">
          <span className="num">cluster {indexNumber.toString().padStart(2, "0")}</span>
          <span className="tier">{tierLabel}</span>
          <span className="share">{Math.round(cluster.share * 100)}%</span>
        </div>
        <div className="lbl">{cluster.label}</div>
        <ul className="characteristics">
          {cluster.characteristics.map((ch) => (
            <li key={ch}>{ch}</li>
          ))}
        </ul>
        <div className="branch">{cluster.branch_summary}</div>
      </div>
    </>
  );
}

// ── stage header — top-left workflow ID + node counter ──────────────

function ClusterHeader({ workflow }: { workflow: Workflow }): JSX.Element {
  const progress = useUnifiedStore((s) => s.cluster[s.active_workflow_id]);
  const cohesionPct = progress ? Math.round(progress.cohesion * 100) : 0;
  return (
    <>
      <div className="ud-cluster-header">
        <div className="ud-cluster-title">
          <span className="caret">★</span>
          <span>semantic clustering</span>
        </div>
        <div className="ud-cluster-meta">
          {workflow.source_name}() <span className="dim">·</span>{" "}
          {workflow.clusters.length} sub-patterns surfacing
        </div>
      </div>

      <div className="ud-cluster-counter">
        <div className="big">
          {(progress?.nodes_emitted ?? 0).toLocaleString()}
        </div>
        <div className="lbl">/ 1,000 synthetic api calls</div>
      </div>

      <div className="ud-cluster-cohesion">
        <span className="lbl">cohesion</span>
        <div className="bar">
          <span style={{ width: `${cohesionPct}%` }} />
        </div>
        <span className="val">{cohesionPct}%</span>
      </div>
    </>
  );
}
