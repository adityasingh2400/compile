import { useEffect, useMemo, useRef } from "react";
import type { SyntheticCell } from "@compile/schemas";
import { HERO_CLUSTERS } from "../demo/fixtures.js";

interface Props {
  cells: SyntheticCell[];
  /** Page 7 reveal — true after stress_test ends, freezes color + draws labels. */
  revealed?: boolean;
}

interface PointBuffer {
  x: Float32Array;
  y: Float32Array;
  tx: Float32Array; // target x (centroid + jitter)
  ty: Float32Array; // target y
  r: Float32Array; // red 0..1
  g: Float32Array;
  b: Float32Array;
  a: Float32Array;
  /** opacity ramp toward terminal color (0..1) */
  ramp: Float32Array;
  count: number;
}

const MAX_POINTS = 12_000;

/**
 * 100K-equivalent constellation. Renders ≤12K animated points to stay
 * comfortably above 60fps; the on-screen counter (parent component) tells
 * the story of 100K. Visual fidelity matches DESIGN.md hero treatment:
 * fly-in from edges → force-pull toward cluster centroids → tier color
 * lerp.
 */
export function Constellation({ cells, revealed = false }: Props): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const buf = useMemo<PointBuffer>(
    () => ({
      x: new Float32Array(MAX_POINTS),
      y: new Float32Array(MAX_POINTS),
      tx: new Float32Array(MAX_POINTS),
      ty: new Float32Array(MAX_POINTS),
      r: new Float32Array(MAX_POINTS),
      g: new Float32Array(MAX_POINTS),
      b: new Float32Array(MAX_POINTS),
      a: new Float32Array(MAX_POINTS),
      ramp: new Float32Array(MAX_POINTS),
      count: 0,
    }),
    [],
  );

  // ingest new cells into the point buffer
  useEffect(() => {
    while (buf.count < cells.length && buf.count < MAX_POINTS) {
      const idx = buf.count;
      const cell = cells[idx]!;
      const cluster = HERO_CLUSTERS.find((c) => c.cluster_id === cell.cluster_id) ??
        HERO_CLUSTERS[0]!;
      // fly-in: random edge
      const edge = Math.floor(Math.random() * 4);
      const px = edge === 0 ? -1.05 : edge === 1 ? 1.05 : Math.random() * 2 - 1;
      const py = edge === 2 ? -1.05 : edge === 3 ? 1.05 : Math.random() * 2 - 1;
      buf.x[idx] = px;
      buf.y[idx] = py;
      // target = centroid + small gaussian jitter
      const jitter = 0.07 + (1 - cluster.share) * 0.05;
      buf.tx[idx] = cluster.centroid[0] + (Math.random() - 0.5) * jitter * 2;
      buf.ty[idx] = cluster.centroid[1] + (Math.random() - 0.5) * jitter * 2;
      buf.r[idx] = cluster.color[0] / 255;
      buf.g[idx] = cluster.color[1] / 255;
      buf.b[idx] = cluster.color[2] / 255;
      buf.a[idx] = 0.5;
      buf.ramp[idx] = 0;
      buf.count++;
    }
  }, [cells, buf]);

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
    window.addEventListener("resize", resize);

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.fillStyle = "rgba(5, 6, 8, 0.18)";
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const scale = Math.min(w, h) * 0.42;

      // attract toward target with critical damping
      const k = 2.6; // attraction
      for (let i = 0; i < buf.count; i++) {
        const dx = buf.tx[i]! - buf.x[i]!;
        const dy = buf.ty[i]! - buf.y[i]!;
        buf.x[i]! += dx * k * dt;
        buf.y[i]! += dy * k * dt;
        // tiny brownian motion for life
        buf.x[i]! += (Math.random() - 0.5) * 0.0015;
        buf.y[i]! += (Math.random() - 0.5) * 0.0015;
        // ramp toward cluster color (tier resolution)
        if (buf.ramp[i]! < 1) buf.ramp[i]! = Math.min(1, buf.ramp[i]! + dt * 0.4);
      }

      // draw
      ctx.globalCompositeOperation = "lighter";
      for (let i = 0; i < buf.count; i++) {
        const ramp = buf.ramp[i]!;
        // pre-resolve color: white-ish initially, lerp to cluster color
        const r = 0.9 * (1 - ramp) + buf.r[i]! * ramp;
        const g = 0.9 * (1 - ramp) + buf.g[i]! * ramp;
        const b = 0.95 * (1 - ramp) + buf.b[i]! * ramp;
        const alpha = 0.42 + ramp * 0.36;
        ctx.fillStyle = `rgba(${(r * 255) | 0}, ${(g * 255) | 0}, ${
          (b * 255) | 0
        }, ${alpha})`;
        const px = cx + buf.x[i]! * scale;
        const py = cy + buf.y[i]! * scale;
        ctx.fillRect(px, py, 1.5, 1.5);
      }
      ctx.globalCompositeOperation = "source-over";

      // optional pulsing centroids in revealed mode
      if (revealed) {
        for (const c of HERO_CLUSTERS) {
          const px = cx + c.centroid[0] * scale;
          const py = cy + c.centroid[1] * scale;
          const radius = 14 + Math.sin(now * 0.003) * 3;
          const grd = ctx.createRadialGradient(px, py, 0, px, py, radius * 2);
          grd.addColorStop(
            0,
            `rgba(${c.color[0]}, ${c.color[1]}, ${c.color[2]}, 0.5)`,
          );
          grd.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = grd;
          ctx.beginPath();
          ctx.arc(px, py, radius * 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [buf, revealed]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        background: "transparent",
      }}
    />
  );
}
