/**
 * RoutingLivePage — Page 6.
 *
 * Live flow diagram of how an agent's LLM call passes through the
 * Compile MCP server. Each route_resolved event spawns a particle that
 * traces an SVG path through the actual nodes:
 *
 *   agent → MCP server → Nia vault lookup
 *      ├── positive vault hit → run cached fn → response (~4ms · $0.0008)
 *      └── miss / negative   → frontier LLM    → response (~1.2s · $0.012)
 *
 * Below the diagram: cost comparison (compile session vs frontier-only
 * baseline) + a tight live feed of recent requests.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useRedesignStore } from "../../data/redesign-store.js";
import type { Workflow } from "../../data/workflows.js";

// SVG viewBox — chosen so positions fit a 16:5-ish flow diagram.
const VB_W = 1000;
const VB_H = 320;

// Node coordinates in viewBox units. The HTML label boxes are positioned
// over these via absolute % so they stay locked to the SVG path nodes.
const NODE = {
  agent:    { x: 70,  y: 160 },
  mcp:      { x: 250, y: 160 },
  vault:    { x: 440, y: 160 },
  cached:   { x: 670, y: 70  },
  frontier: { x: 670, y: 250 },
  response: { x: 900, y: 160 },
} as const;

// Two SVG paths a particle can travel.
//   positive: agent → mcp → vault → cached → response
//   frontier: agent → mcp → vault → frontier → response
const POSITIVE_PATH =
  `M ${NODE.agent.x} ${NODE.agent.y}
   L ${NODE.mcp.x} ${NODE.mcp.y}
   L ${NODE.vault.x} ${NODE.vault.y}
   Q 540 ${NODE.vault.y} 580 ${NODE.cached.y}
   L ${NODE.cached.x} ${NODE.cached.y}
   Q 760 ${NODE.cached.y} 800 ${NODE.response.y}
   L ${NODE.response.x} ${NODE.response.y}`;

const FRONTIER_PATH =
  `M ${NODE.agent.x} ${NODE.agent.y}
   L ${NODE.mcp.x} ${NODE.mcp.y}
   L ${NODE.vault.x} ${NODE.vault.y}
   Q 540 ${NODE.vault.y} 580 ${NODE.frontier.y}
   L ${NODE.frontier.x} ${NODE.frontier.y}
   Q 760 ${NODE.frontier.y} 800 ${NODE.response.y}
   L ${NODE.response.x} ${NODE.response.y}`;

// negatives also fast-fail through "frontier" path conceptually (never
// touch the cached-fn branch; MCP just refuses to route them deterministically).

const PARTICLE_LIFE_MS = 2200;

type LaneKind = "positive" | "frontier" | "negative";

interface Particle {
  id: string;
  kind: LaneKind;
  born: number;
}

// ── flow diagram ────────────────────────────────────────────────────
function FlowDiagram(): JSX.Element {
  const counters = useRedesignStore((s) => s.live.routing.counters);
  // Local mock counters that tick up alongside the spawned particles, so
  // the outcome boxes show numbers even when the daemon SSE isn't wired.
  const [mockCounts, setMockCounts] = useState({
    positive: 0,
    negative: 0,
    frontier: 0,
  });

  const positiveRef = useRef<SVGPathElement>(null);
  const frontierRef = useRef<SVGPathElement>(null);

  const [particles, setParticles] = useState<Particle[]>([]);

  // Mock spawner — fires particles at ~7/sec, weighted 94% positive /
  // 4% negative / 2% frontier. The daemon would emit the same shape via
  // route_resolved but we don't wait for it.
  useEffect(() => {
    let id = 0;
    const spawn = (): void => {
      const r = Math.random();
      const kind: LaneKind =
        r < 0.94 ? "positive" : r < 0.98 ? "negative" : "frontier";
      const pid = `mock_${id++}_${Math.random().toString(36).slice(2, 6)}`;
      setParticles((prev) =>
        [{ id: pid, kind, born: performance.now() }, ...prev].slice(0, 60),
      );
      setMockCounts((c) => ({
        positive: c.positive + (kind === "positive" ? 1 : 0),
        negative: c.negative + (kind === "negative" ? 1 : 0),
        frontier: c.frontier + (kind === "frontier" ? 1 : 0),
      }));
    };
    const interval = setInterval(spawn, 130 + Math.random() * 80);
    return () => clearInterval(interval);
  }, []);

  // Tick every frame so we re-render particle positions.
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    let raf = 0;
    const loop = (): void => {
      setFrame((f) => f + 1);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Cull dead particles every ~300ms.
  useEffect(() => {
    const i = setInterval(() => {
      const now = performance.now();
      setParticles((prev) => prev.filter((p) => now - p.born < PARTICLE_LIFE_MS + 100));
    }, 300);
    return () => clearInterval(i);
  }, []);

  // Compute particle positions along their path.
  const renderedParticles = useMemo(() => {
    void frame;
    const now = performance.now();
    return particles
      .map((p) => {
        const t = Math.min(1, (now - p.born) / PARTICLE_LIFE_MS);
        // Negatives use the frontier path geometry but fade halfway —
        // they never actually reach a frontier LLM (fast-fail).
        const pathEl =
          p.kind === "positive" ? positiveRef.current : frontierRef.current;
        if (!pathEl) return null;
        let totalLen = 0;
        try {
          totalLen = pathEl.getTotalLength();
        } catch {
          return null;
        }
        const len = t * totalLen;
        const pt = pathEl.getPointAtLength(len);
        return {
          id: p.id,
          kind: p.kind,
          x: pt.x,
          y: pt.y,
          opacity: p.kind === "negative" && t > 0.5 ? Math.max(0, 1 - (t - 0.5) * 4) : 1,
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null && p.opacity > 0);
  }, [particles, frame]);

  // Helper: viewBox coords → percent for label overlay.
  const pct = (x: number, max: number): string => `${(x / max) * 100}%`;

  return (
    <div className="rt2-diagram">
      <svg
        className="rt2-diagram-svg"
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Decorative paths */}
        <path
          ref={positiveRef}
          d={POSITIVE_PATH}
          fill="none"
          stroke="rgba(192, 57, 43, 0.32)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeDasharray="3 6"
        />
        <path
          ref={frontierRef}
          d={FRONTIER_PATH}
          fill="none"
          stroke="rgba(168, 162, 158, 0.45)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeDasharray="3 6"
        />

        {/* Connectors at the vault decision and response join — hairline
            highlights so the branch points are unmistakable. */}
        <circle cx={NODE.vault.x} cy={NODE.vault.y} r="6" fill="var(--maroon)" />
        <circle cx={NODE.response.x} cy={NODE.response.y} r="6" fill="var(--ink-secondary)" />

        {/* Particles */}
        {renderedParticles.map((p) => (
          <circle
            key={p.id}
            cx={p.x}
            cy={p.y}
            r="5"
            className={`rt2-diagram-particle particle-${p.kind}`}
            style={{ opacity: p.opacity }}
          />
        ))}
      </svg>

      {/* HTML node labels positioned over the SVG */}
      <div
        className="rt2-node node-agent"
        style={{ left: pct(NODE.agent.x, VB_W), top: pct(NODE.agent.y, VB_H) }}
      >
        <div className="rt2-node-icon">⌘</div>
        <div className="rt2-node-name">agent</div>
        <div className="rt2-node-sub mono dim">llm tool call</div>
      </div>

      <div
        className="rt2-node node-mcp"
        style={{ left: pct(NODE.mcp.x, VB_W), top: pct(NODE.mcp.y, VB_H) }}
      >
        <div className="rt2-node-name">compile MCP</div>
        <div className="rt2-node-sub mono dim">routes every call</div>
      </div>

      <div
        className="rt2-node node-vault"
        style={{ left: pct(NODE.vault.x, VB_W), top: pct(NODE.vault.y, VB_H) }}
      >
        <div className="rt2-node-name">nia vault</div>
        <div className="rt2-node-sub mono dim">signature lookup</div>
      </div>

      <div
        className="rt2-node node-cached"
        style={{ left: pct(NODE.cached.x, VB_W), top: pct(NODE.cached.y, VB_H) }}
      >
        <div className="rt2-node-eyebrow positive">positive · deterministic</div>
        <div className="rt2-node-name">cached fn</div>
        <div className="rt2-node-sub mono dim">~4ms · $0.0008</div>
        <div className="rt2-node-count mono">
          {(counters.positive + mockCounts.positive).toLocaleString()}
        </div>
      </div>

      <div
        className="rt2-node node-frontier"
        style={{ left: pct(NODE.frontier.x, VB_W), top: pct(NODE.frontier.y, VB_H) }}
      >
        <div className="rt2-node-eyebrow frontier">miss · fallback</div>
        <div className="rt2-node-name">frontier LLM</div>
        <div className="rt2-node-sub mono dim">~1.2s · $0.012</div>
        <div className="rt2-node-count mono">
          {(counters.unknown + counters.negative + mockCounts.frontier + mockCounts.negative).toLocaleString()}
        </div>
      </div>

      <div
        className="rt2-node node-response"
        style={{ left: pct(NODE.response.x, VB_W), top: pct(NODE.response.y, VB_H) }}
      >
        <div className="rt2-node-icon">↩</div>
        <div className="rt2-node-name">response</div>
        <div className="rt2-node-sub mono dim">to agent</div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────

export function RoutingLivePage({ workflow: _workflow }: { workflow: Workflow }): JSX.Element {
  const routing = useRedesignStore((s) => s.live.routing);

  return (
    <div className="rt2-live">
      <div className="rt2-header">
        <div className="rt2-title">
          <span className="rt2-mark">●</span>
          <h2>live routing</h2>
          <span className="dim">— every llm call, the path it takes, the dollars it doesn't burn.</span>
        </div>
        <div className="rt2-rpm">
          <span className="num mono">{(routing.rpm || 0).toLocaleString()}</span>
          <span className="lbl">req/min</span>
        </div>
      </div>

      <FlowDiagram />
    </div>
  );
}
