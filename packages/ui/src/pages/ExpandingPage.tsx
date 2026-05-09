import { useEffect, useRef } from "react";
import { useStore } from "../store.js";

export function ExpandingPage(): JSX.Element {
  const count = useStore((s) => s.expandCount);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const resize = () => {
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = canvas.clientHeight * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener("resize", resize);
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      // dot field whose density grows over time (capped at the count level)
      const target = Math.min(2200, Math.max(80, Math.floor(2200 * (count / 100_000) + 80)));
      for (let i = 0; i < target; i++) {
        const seed = (i * 9301 + 49297) % 233280;
        const rx = ((seed / 233280) * 2 - 1) * 0.92;
        const ry = (((seed * 17) % 233280) / 233280) * 2 - 1;
        const jx = Math.sin(t * 0.6 + i * 0.07) * 6;
        const jy = Math.cos(t * 0.5 + i * 0.11) * 6;
        const x = w / 2 + rx * (w * 0.42) + jx;
        const y = h / 2 + ry * (h * 0.42) + jy;
        const a = 0.16 + Math.abs(Math.sin(i * 0.31 + t)) * 0.4;
        ctx.fillStyle = `rgba(122, 223, 255, ${a})`;
        ctx.fillRect(x, y, 1.6, 1.6);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [count]);

  return (
    <div className="expand-stage">
      <canvas
        ref={canvasRef}
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      />
      <div className="expand-counter">{count.toLocaleString()}</div>
      <div
        style={{
          position: "absolute",
          top: "calc(50% + 80px)",
          left: "50%",
          transform: "translateX(-50%)",
          fontFamily: "var(--mono)",
          fontSize: 12,
          color: "var(--muted)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
        }}
      >
        synthetic inputs
      </div>
    </div>
  );
}
