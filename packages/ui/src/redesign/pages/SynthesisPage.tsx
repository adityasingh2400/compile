/**
 * Synthesis page — minimal.
 *
 * The whole page is the canvas. Nodes spawn, drift, and cluster.
 * When clustering settles, each cluster's defining characteristic
 * card reveals next to its centroid. That's it.
 *
 * The only persistent overlay is a small counter in the corner
 * (synthetic-call count) — chrome stays out of the way of the
 * centerpiece.
 */

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useRedesignStore } from "../../data/redesign-store.js";
import type { Workflow, WorkflowCluster } from "../../data/workflows.js";

// ─────────────────────────────────────────────────────────────────────
// Helpers — stable-shuffled cluster assignment so two runs of the same
// workflow produce the same node→cluster map.

function pickClusterIndex(
  i: number,
  clusters: WorkflowCluster[],
): number {
  const total = clusters.reduce((acc, c) => acc + c.share, 0);
  const t = ((i * 9301 + 49297) % 233280) / 233280;
  let acc = 0;
  for (let k = 0; k < clusters.length; k++) {
    acc += clusters[k]!.share / total;
    if (t < acc) return k;
  }
  return clusters.length - 1;
}

function hashFloat(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function useSize(ref: RefObject<HTMLElement>): { w: number; h: number } {
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 1280, h: 720 });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const sync = () => {
      setSize({ w: node.clientWidth, h: node.clientHeight });
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(node);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

// ─────────────────────────────────────────────────────────────────────
// Canvas — paints all nodes + halos. Updates 60fps via rAF.

interface Buf {
  x: Float32Array;
  y: Float32Array;
  tx: Float32Array;
  ty: Float32Array;
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  ramp: Float32Array;
  count: number;
  capacity: number;
}

function makeBuf(capacity: number): Buf {
  return {
    x: new Float32Array(capacity),
    y: new Float32Array(capacity),
    tx: new Float32Array(capacity),
    ty: new Float32Array(capacity),
    r: new Float32Array(capacity),
    g: new Float32Array(capacity),
    b: new Float32Array(capacity),
    ramp: new Float32Array(capacity),
    count: 0,
    capacity,
  };
}

interface CanvasProps {
  workflow: Workflow;
}

function ClusteringCanvas({ workflow }: CanvasProps): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const buf = useMemo(
    () => makeBuf(Math.max(1500, workflow.visible_node_count + 200)),
    [workflow.id, workflow.visible_node_count],
  );

  const nodes_emitted = useRedesignStore(
    (s) => s.workflows[workflow.id]?.synthesis.nodes_emitted ?? 0,
  );
  const clustering = useRedesignStore(
    (s) => s.workflows[workflow.id]?.synthesis.clustering ?? true,
  );
  const showHalos = useRedesignStore(
    (s) => s.workflows[workflow.id]?.synthesis.show_halos ?? false,
  );

  const live = useRef({ nodes: nodes_emitted, clustering, showHalos });
  live.current = { nodes: nodes_emitted, clustering, showHalos };

  // Ingest new nodes when the visible count grows.
  useEffect(() => {
    while (buf.count < live.current.nodes && buf.count < buf.capacity) {
      const idx = buf.count;
      const ci = pickClusterIndex(idx, workflow.clusters);
      const cluster = workflow.clusters[ci]!;
      const edge = Math.floor(hashFloat(idx + 7) * 4);
      buf.x[idx] = edge === 0
        ? -1.15
        : edge === 1
          ? 1.15
          : (hashFloat(idx) - 0.5) * 2.4;
      buf.y[idx] = edge === 2
        ? -1.15
        : edge === 3
          ? 1.15
          : (hashFloat(idx + 13) - 0.5) * 2.4;
      const jitter = 0.06 + (1 - cluster.share) * 0.05;
      buf.tx[idx] =
        cluster.centroid[0] + (hashFloat(idx + 23) - 0.5) * jitter * 2;
      buf.ty[idx] =
        cluster.centroid[1] + (hashFloat(idx + 47) - 0.5) * jitter * 2;
      buf.r[idx] = cluster.color[0] / 255;
      buf.g[idx] = cluster.color[1] / 255;
      buf.b[idx] = cluster.color[2] / 255;
      buf.ramp[idx] = 0;
      buf.count++;
    }
  }, [nodes_emitted, buf, workflow]);

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
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;

      // Cream trail-fade — leaves a subtle ghost behind moving nodes.
      ctx.fillStyle = "rgba(255, 247, 240, 0.22)";
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const scale = Math.min(w, h) * 0.42;
      const k = live.current.clustering ? 2.2 : 4.5;

      for (let i = 0; i < buf.count; i++) {
        const dx = buf.tx[i]! - buf.x[i]!;
        const dy = buf.ty[i]! - buf.y[i]!;
        buf.x[i]! += dx * k * dt;
        buf.y[i]! += dy * k * dt;
        const noise = live.current.clustering ? 0.0035 : 0.0008;
        buf.x[i]! += (Math.random() - 0.5) * noise;
        buf.y[i]! += (Math.random() - 0.5) * noise;
        if (buf.ramp[i]! < 1) {
          buf.ramp[i]! = Math.min(1, buf.ramp[i]! + dt * 0.9);
        }
      }

      // Standard alpha compositing on the cream canvas — additive
      // would wash out against the light backdrop.
      for (let i = 0; i < buf.count; i++) {
        const ramp = buf.ramp[i]!;
        // Start as a soft warm ink, lerp to the cluster's accent color.
        const r = 0.45 * (1 - ramp) + buf.r[i]! * ramp;
        const g = 0.25 * (1 - ramp) + buf.g[i]! * ramp;
        const b = 0.18 * (1 - ramp) + buf.b[i]! * ramp;
        const alpha = 0.55 + ramp * 0.35;
        ctx.fillStyle = `rgba(${(r * 255) | 0}, ${(g * 255) | 0}, ${(b * 255) | 0}, ${alpha})`;
        const px = cx + buf.x[i]! * scale;
        const py = cy + buf.y[i]! * scale;
        const sz = live.current.clustering ? 1.6 : 2.0;
        ctx.fillRect(px, py, sz, sz);
      }

      if (live.current.showHalos) {
        for (const c of workflow.clusters) {
          const px = cx + c.centroid[0] * scale;
          const py = cy + c.centroid[1] * scale;
          const radius = 22 + Math.sin(now * 0.0028 + c.cluster_id.length) * 4;
          // Soft warm halo — peach blooms instead of dark glow.
          const grd = ctx.createRadialGradient(
            px,
            py,
            0,
            px,
            py,
            radius * 2.6,
          );
          grd.addColorStop(0, `rgba(${c.color[0]}, ${c.color[1]}, ${c.color[2]}, 0.22)`);
          grd.addColorStop(1, "rgba(255, 247, 240, 0)");
          ctx.fillStyle = grd;
          ctx.beginPath();
          ctx.arc(px, py, radius * 2.6, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = `rgba(${c.color[0]}, ${c.color[1]}, ${c.color[2]}, 0.55)`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(px, py, radius, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [buf, workflow]);

  return (
    <div ref={containerRef} className="syn-canvas-host">
      <canvas ref={ref} className="syn-canvas" />
      {showHalos ? <CharacteristicHalos workflow={workflow} /> : null}
      <SynthCounter workflow={workflow} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Halo info cards — cleaner, single accent line per cluster.

function CharacteristicHalos({
  workflow,
}: {
  workflow: Workflow;
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const size = useSize(ref);

  const w = size.w;
  const h = size.h;
  const scale = Math.min(w, h) * 0.42;
  const cx = w / 2;
  const cy = h / 2;

  // Place each card radially outward from its centroid, with a 6-pass
  // collision resolver so adjacent clusters don't stack.
  const cards = workflow.clusters.map((c) => {
    const px = cx + c.centroid[0] * scale;
    const py = cy + c.centroid[1] * scale;
    const dx = c.centroid[0];
    const dy = c.centroid[1];
    const len = Math.hypot(dx, dy) || 1;
    const offMag = Math.max(150, scale * 0.28);
    const offX = (dx / len) * offMag;
    const offY = (dy / len) * (offMag * 0.65);
    let cardX = px + offX;
    let cardY = py + offY;
    cardX = Math.max(150, Math.min(w - 230, cardX));
    cardY = Math.max(70, Math.min(h - 90, cardY));
    return { c, px, py, cardX, cardY };
  });

  const minX = 230;
  const minY = 100;
  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const a = cards[i]!;
        const b = cards[j]!;
        const dxs = b.cardX - a.cardX;
        const dys = b.cardY - a.cardY;
        const overlapX = minX - Math.abs(dxs);
        const overlapY = minY - Math.abs(dys);
        if (overlapX > 0 && overlapY > 0) {
          if (overlapX < overlapY) {
            const sign = dxs >= 0 ? 1 : -1;
            a.cardX -= (overlapX / 2) * sign;
            b.cardX += (overlapX / 2) * sign;
          } else {
            const sign = dys >= 0 ? 1 : -1;
            a.cardY -= (overlapY / 2) * sign;
            b.cardY += (overlapY / 2) * sign;
          }
          a.cardX = Math.max(150, Math.min(w - 230, a.cardX));
          a.cardY = Math.max(70, Math.min(h - 90, a.cardY));
          b.cardX = Math.max(150, Math.min(w - 230, b.cardX));
          b.cardY = Math.max(70, Math.min(h - 90, b.cardY));
          moved = true;
        }
      }
    }
    if (!moved) break;
  }

  return (
    <div ref={ref} className="syn-halos">
      <svg className="syn-halo-leaders" width={w} height={h}>
        {cards.map(({ c, px, py, cardX, cardY }) => (
          <line
            key={c.cluster_id}
            x1={cardX}
            y1={cardY}
            x2={px}
            y2={py}
            stroke={`rgba(${c.color[0]}, ${c.color[1]}, ${c.color[2]}, 0.55)`}
            strokeWidth={1}
            strokeDasharray="3 4"
          />
        ))}
      </svg>
      {cards.map(({ c, cardX, cardY }, i) => {
        // Pick the most-illustrative single characteristic — the "→ output"
        // one when it exists, otherwise the first.
        const primary =
          c.characteristics.find((ch) => ch.key.startsWith("→")) ??
          c.characteristics[0];
        return (
          <div
            key={c.cluster_id}
            className="syn-halo"
            style={{
              left: `${cardX}px`,
              top: `${cardY}px`,
              animationDelay: `${i * 100}ms`,
              borderColor: `rgba(${c.color[0]}, ${c.color[1]}, ${c.color[2]}, 0.55)`,
              boxShadow: `0 0 28px -6px rgba(${c.color[0]}, ${c.color[1]}, ${c.color[2]}, 0.4)`,
            }}
          >
            <div className="syn-halo-row">
              <span
                className="dot"
                style={{
                  background: `rgb(${c.color[0]}, ${c.color[1]}, ${c.color[2]})`,
                  boxShadow: `0 0 10px rgba(${c.color[0]}, ${c.color[1]}, ${c.color[2]}, 0.7)`,
                }}
              />
              <span className="lbl">{c.label}</span>
              <span className="share">{Math.round(c.share * 100)}%</span>
            </div>
            {primary ? (
              <div className="syn-halo-primary">
                <span className="key">{primary.key}</span>
                <span className="val">{primary.value}</span>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Single live counter — bottom-left of the canvas.

function SynthCounter({ workflow }: { workflow: Workflow }): JSX.Element {
  const slice = useRedesignStore((s) => s.workflows[workflow.id]);
  const emitted = slice?.synthesis.nodes_emitted ?? 0;
  const clustering = slice?.synthesis.clustering ?? true;
  const showHalos = slice?.synthesis.show_halos ?? false;
  const narrativeShare =
    workflow.visible_node_count > 0
      ? emitted / workflow.visible_node_count
      : 0;
  const narrative = Math.floor(
    workflow.narrative_call_count * narrativeShare,
  );
  const subText = !clustering
    ? showHalos
      ? `${workflow.clusters.length} clusters · characteristics revealed`
      : `${workflow.clusters.length} clusters · settling`
    : emitted < workflow.visible_node_count
      ? `${emitted.toLocaleString()} visible nodes · fan-in from edges`
      : `${emitted.toLocaleString()} visible nodes · drifting toward centroids`;
  return (
    <div className="syn-counter">
      <div className="big">{narrative.toLocaleString()}</div>
      <div className="lbl">
        of {workflow.narrative_call_count.toLocaleString()} synthetic calls
      </div>
      <div className="sub">{subText}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Top-level page — just the canvas, full-bleed.

export function SynthesisPage({ workflow }: { workflow: Workflow }): JSX.Element {
  return (
    <div className="syn-page">
      <ClusteringCanvas workflow={workflow} />
    </div>
  );
}
