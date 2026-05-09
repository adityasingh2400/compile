/**
 * Synthesis page — node spawn, semantic clustering, and characteristic
 * halo reveal for one workflow.
 *
 * Visual:
 *
 *   ┌──────── synthetic input recipe ─────────┐  ┌──── meters ─────┐
 *   │ field name        kind   reason         │  │ 1,000 nodes     │
 *   │ subject           text   most variable  │  │ 7 clusters      │
 *   │ customer_tier     enum   drives prio    │  └─────────────────┘
 *   │ ...                                     │
 *   └────────────────────────── strategies ───┘
 *
 *   ┌────────────────── canvas (full bleed) ───────────────────────┐
 *   │                                                                │
 *   │                  ◌  ◌                                          │
 *   │              ◌ ◌ ✦ ◌ ◌      ┌─ outage:enterprise (28%) ─┐    │
 *   │                ◌ ◌                                            │
 *   │                                                                │
 *   │           ◌ ◌                                                  │
 *   │       ◌ ✦ ◌ ◌                 ┌─ feature_request (13%) ─┐    │
 *   │           ◌                                                    │
 *   └────────────────────────────────────────────────────────────────┘
 *
 * Node placement:
 *   - On spawn, each node lands in a "fan-in" position around its target
 *     centroid. This keeps the early-spawn frames legible — judges see
 *     clustering happening *as* nodes arrive, not as a post-hoc shuffle.
 *   - During the clustering phase a soft "drift" pulls nodes toward
 *     centroid + jitter, with mild brownian motion.
 *   - Once `clustering=false`, the drift becomes elastic so positions
 *     freeze visually with a tiny hum.
 *   - When `show_halos=true`, halo cards animate in next to each centroid.
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
  // Deterministic share-weighted assignment by index. Distributes nodes
  // proportional to cluster.share but in a stable order so we get the
  // exact same constellation across remounts.
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
  // Stable [0,1) for deterministic jitter per node index.
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

// Shared resize observer hook — keeps a child div's pixel size in state.
function useSize(
  ref: RefObject<HTMLElement>,
): { w: number; h: number } {
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
  /** lifetime ramp 0..1 for fade-in */
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

  // Mirror the latest values into a ref so the rAF loop reads them
  // without re-binding effects every store update.
  const live = useRef({
    nodes: nodes_emitted,
    clustering,
    showHalos,
  });
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

      // Trail-decay clear — slight motion blur.
      ctx.fillStyle = "rgba(5, 6, 8, 0.18)";
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const scale = Math.min(w, h) * 0.42;

      const k = live.current.clustering ? 2.2 : 4.5;

      // Step physics.
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

      // Render with additive blend for glow.
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < buf.count; i++) {
        const ramp = buf.ramp[i]!;
        const r = 0.95 * (1 - ramp) + buf.r[i]! * ramp;
        const g = 0.95 * (1 - ramp) + buf.g[i]! * ramp;
        const b = 0.95 * (1 - ramp) + buf.b[i]! * ramp;
        const alpha = 0.45 + ramp * 0.4;
        ctx.fillStyle = `rgba(${(r * 255) | 0}, ${(g * 255) | 0}, ${(b * 255) | 0}, ${alpha})`;
        const px = cx + buf.x[i]! * scale;
        const py = cy + buf.y[i]! * scale;
        const sz = live.current.clustering ? 1.5 : 1.9;
        ctx.fillRect(px, py, sz, sz);
      }
      ctx.globalCompositeOperation = "source-over";

      // Centroid halos beneath labels.
      if (live.current.showHalos) {
        for (const c of workflow.clusters) {
          const px = cx + c.centroid[0] * scale;
          const py = cy + c.centroid[1] * scale;
          const radius = 22 + Math.sin(now * 0.0028 + c.cluster_id.length) * 4;
          const grd = ctx.createRadialGradient(
            px,
            py,
            0,
            px,
            py,
            radius * 2.4,
          );
          grd.addColorStop(0, `rgba(${c.color[0]}, ${c.color[1]}, ${c.color[2]}, 0.34)`);
          grd.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = grd;
          ctx.beginPath();
          ctx.arc(px, py, radius * 2.4, 0, Math.PI * 2);
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
    <div ref={containerRef} className="cluster-canvas-host">
      <canvas ref={ref} className="cluster-canvas" />
      {showHalos ? <CharacteristicHalos workflow={workflow} /> : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Halo info cards — placed near each centroid in screen space.
// Uses an SVG overlay for clean leader lines from card edge to centroid.

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

  // Compute card placement: offset radially outward + clamp into viewport.
  const cards = workflow.clusters.map((c) => {
    const px = cx + c.centroid[0] * scale;
    const py = cy + c.centroid[1] * scale;
    const dx = c.centroid[0];
    const dy = c.centroid[1];
    const len = Math.hypot(dx, dy) || 1;
    const offX = (dx / len) * Math.max(110, scale * 0.2);
    const offY = (dy / len) * Math.max(70, scale * 0.14);
    let cardX = px + offX;
    let cardY = py + offY;
    // Clamp to viewport so labels don't escape the canvas.
    cardX = Math.max(160, Math.min(w - 240, cardX));
    cardY = Math.max(40, Math.min(h - 130, cardY));
    return { c, px, py, cardX, cardY };
  });

  return (
    <div ref={ref} className="cluster-halos">
      <svg className="halo-leaders" width={w} height={h}>
        {cards.map(({ c, px, py, cardX, cardY }) => (
          <line
            key={c.cluster_id}
            x1={cardX}
            y1={cardY}
            x2={px}
            y2={py}
            stroke={`rgba(${c.color[0]}, ${c.color[1]}, ${c.color[2]}, 0.6)`}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        ))}
      </svg>
      {cards.map(({ c, cardX, cardY }, i) => (
        <div
          key={c.cluster_id}
          className={`cluster-halo ${c.tier}`}
          style={{
            left: `${cardX}px`,
            top: `${cardY}px`,
            animationDelay: `${i * 130}ms`,
          }}
        >
          <div className="halo-head">
            <span
              className="dot"
              style={{
                background: `rgb(${c.color[0]}, ${c.color[1]}, ${c.color[2]})`,
              }}
            />
            <span className="lbl">{c.label}</span>
            <span className={`tier ${c.tier}`}>
              {c.tier === "tier_1" ? "T1" : "T2"}
            </span>
            <span className="share">{Math.round(c.share * 100)}%</span>
          </div>
          <div className="halo-body">
            {c.characteristics.map((ch) => (
              <div className="ch-row" key={ch.key}>
                <span className="ch-key">{ch.key}</span>
                <span className="ch-val">{ch.value}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Side panels.

function RecipePanel({ workflow }: { workflow: Workflow }): JSX.Element {
  return (
    <aside className="syn-recipe">
      <div className="syn-card-head">
        <span className="num">01</span>
        <span className="title">synthetic recipe</span>
        <span className="hint">audit-chosen</span>
      </div>
      <div className="syn-prompt">
        <span className="dim">prompt</span>
        <span className="prompt">{workflow.prompt_excerpt}</span>
      </div>
      <div className="syn-fields">
        <div className="syn-fields-head">
          <span>field</span>
          <span>kind</span>
          <span>variation reason</span>
        </div>
        {workflow.input_fields.map((f) => (
          <div key={f.name} className="syn-field">
            <span className="name">{f.name}</span>
            <span className="kind">{f.kind}</span>
            <span className="reason">{f.reason}</span>
          </div>
        ))}
      </div>
      <div className="syn-strategies">
        <div className="syn-strategies-head">strategies</div>
        {workflow.synthetic_strategies.map((s) => (
          <div key={s.name} className="syn-strategy">
            <div className="strat-row">
              <span className="strat-name">{s.name}</span>
              <span className="strat-share">
                {Math.round(s.share * 100)}%
              </span>
            </div>
            <div className="strat-bar">
              <span style={{ width: `${s.share * 100}%` }} />
            </div>
            <div className="strat-rationale">{s.rationale}</div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function MetersPanel({ workflow }: { workflow: Workflow }): JSX.Element {
  const slice = useRedesignStore((s) => s.workflows[workflow.id]);
  const emitted = slice?.synthesis.nodes_emitted ?? 0;
  const clustering = slice?.synthesis.clustering ?? true;
  const showHalos = slice?.synthesis.show_halos ?? false;
  const settled = !clustering;

  const narrativeShare =
    workflow.visible_node_count > 0
      ? emitted / workflow.visible_node_count
      : 0;
  const narrative = Math.floor(
    workflow.narrative_call_count * narrativeShare,
  );

  return (
    <aside className="syn-meters">
      <div className="syn-card-head right">
        <span className="num">02</span>
        <span className="title">live meters</span>
        <span className="hint">tensorlake grid</span>
      </div>
      <div className="syn-meter-big">
        <div className="big">{narrative.toLocaleString()}</div>
        <div className="lbl">
          of {workflow.narrative_call_count.toLocaleString()} synthetic calls
        </div>
      </div>
      <div className="syn-meter-row">
        <div className="cell">
          <div className="big">{emitted.toLocaleString()}</div>
          <div className="lbl">visible nodes</div>
        </div>
        <div className="cell">
          <div className="big">{workflow.clusters.length}</div>
          <div className="lbl">clusters</div>
        </div>
      </div>
      <div className="syn-state">
        <div className="row">
          <span className={`pill ${emitted > 0 ? "active" : ""}`}>
            {emitted > 0 ? "spawning" : "idle"}
          </span>
          <span className={`pill ${clustering ? "active" : "done"}`}>
            {clustering ? "clustering" : "settled"}
          </span>
          <span className={`pill ${showHalos ? "active" : ""}`}>
            {showHalos ? "halos lit" : "halos off"}
          </span>
        </div>
        <div className="hint dim">
          {emitted < workflow.visible_node_count
            ? "fan-in from edge nodes · color = projected cluster"
            : !settled
              ? "drift to centroid · semantic similarity = spatial proximity"
              : !showHalos
                ? "settled · awaiting feature reveal"
                : "characteristics revealed · ready to codify"}
        </div>
      </div>
      <div className="syn-cluster-legend">
        <div className="legend-head">cluster legend</div>
        {workflow.clusters.map((c) => {
          const cls = c.tier === "tier_1" ? "tier1" : "tier2";
          return (
            <div key={c.cluster_id} className={`legend-row ${cls}`}>
              <span
                className="dot"
                style={{
                  background: `rgb(${c.color[0]}, ${c.color[1]}, ${c.color[2]})`,
                }}
              />
              <span className="lbl">{c.label}</span>
              <span className="tier">{c.tier === "tier_1" ? "T1" : "T2"}</span>
              <span className="share">{Math.round(c.share * 100)}%</span>
            </div>
          );
        })}
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Top-level page.

export function SynthesisPage({ workflow }: { workflow: Workflow }): JSX.Element {
  return (
    <div className="syn-page">
      <RecipePanel workflow={workflow} />
      <ClusteringCanvas workflow={workflow} />
      <MetersPanel workflow={workflow} />
    </div>
  );
}
