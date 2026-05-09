/**
 * RouteStage — production routing diagram.
 *
 * Four nodes:
 *   • USER (left) — incoming requests
 *   • NEO VAULT (top) — deterministic typed functions; ≈90–95% of traffic
 *   • FRONTIER LLM (bottom) — explicit fallback; ≈5–10% of traffic
 *   • OUTPUT (right) — successful response
 *
 * Edges carry animated traffic dots. Edge thickness + dot density
 * reflect actual distribution from the workflow fixture. Live
 * counters tick in the corners (calls/min, $/min saved).
 *
 * One canvas-shaped stage, no panels. Pure SVG for the graph.
 */
import { useEffect, useRef, useState } from "react";
import { useUnifiedStore } from "../../unified-store.js";
import type { Workflow } from "../../demo/workflows.js";

const PADDING = 80;

/** A single packet flowing along the routing diagram. */
interface Packet {
  id: number;
  /** Path the packet traverses: user → (vault|frontier) → output. */
  via: "vault" | "frontier";
  /** 0..1 progress along its path. */
  t: number;
  /** Speed multiplier so packets stagger naturally. */
  speed: number;
}

export function RouteStage(): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 1280, h: 720 });

  const workflows = useUnifiedStore((s) => s.workflows);
  const activeId = useUnifiedStore((s) => s.active_workflow_id);
  const setRouteCounters = useUnifiedStore((s) => s.setRouteCounters);
  const setRouteFlow = useUnifiedStore((s) => s.setRouteFlow);
  const route = useUnifiedStore((s) => s.route[s.active_workflow_id]);
  const workflow = workflows.find((w) => w.id === activeId)!;

  // Resize observation.
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

  // ── packet simulation ───────────────────────────────────────────
  const packetsRef = useRef<Packet[]>([]);
  const nextIdRef = useRef(1);

  // Animate flow intensity ramp-up on enter / on workflow switch.
  useEffect(() => {
    let cancelled = false;
    const start = performance.now();
    const dur = 1400;
    const tick = () => {
      if (cancelled) return;
      const t = Math.min(1, (performance.now() - start) / dur);
      const intensity = 1 - Math.pow(1 - t, 3);
      setRouteFlow(activeId, intensity);
      if (t < 1) requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelled = true;
    };
  }, [activeId, setRouteFlow]);

  // Drive packet spawn + per-minute counter accumulation.
  useEffect(() => {
    let cancelled = false;
    let raf = 0;
    let lastSpawn = performance.now();
    let lastCounterTick = performance.now();
    let counter = {
      saved_per_minute_usd: 0,
      per_minute_tier_1: 0,
      per_minute_tier_2: 0,
      per_minute_tier_3: 0,
    };
    const tick = () => {
      if (cancelled) return;
      const now = performance.now();
      const intensity = useUnifiedStore.getState().route[activeId]?.flow_intensity ?? 0;
      // packet spawn rate scales with intensity; cap at ~30 packets/sec
      const spawnRate = 16 + 14 * intensity;
      const dt = (now - lastSpawn) / 1000;
      const spawnCount = Math.floor(dt * spawnRate);
      if (spawnCount > 0) {
        for (let i = 0; i < spawnCount; i++) {
          const via = Math.random() < workflow.frontier_pct ? "frontier" : "vault";
          const speed = 0.7 + Math.random() * 0.5;
          packetsRef.current.push({
            id: nextIdRef.current++,
            via,
            t: 0,
            speed,
          });
          if (via === "vault") {
            counter.per_minute_tier_1 += 1;
            counter.saved_per_minute_usd += 0.05; // ≈ $0.05 saved per vault hit
          } else {
            counter.per_minute_tier_2 += Math.random() < 0.3 ? 1 : 0;
            counter.per_minute_tier_3 += 1;
          }
        }
        lastSpawn = now;
      }
      // advance packet positions
      const dt2 = 1 / 60; // ~stable rate
      packetsRef.current = packetsRef.current.filter((p) => {
        p.t += dt2 * p.speed * 0.42;
        return p.t < 1.05;
      });

      // throttle counter writes to ~5/sec
      if (now - lastCounterTick > 200) {
        setRouteCounters(activeId, counter);
        lastCounterTick = now;
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
    };
  }, [activeId, setRouteCounters, workflow]);

  // Compute node positions inside our svg viewport.
  const W = size.w;
  const H = size.h;
  const userPos = { x: PADDING, y: H / 2 };
  const vaultPos = { x: W / 2, y: PADDING + 30 };
  const frontierPos = { x: W / 2, y: H - PADDING - 30 };
  const outputPos = { x: W - PADDING, y: H / 2 };

  return (
    <div className="ud-stage route-stage" ref={containerRef}>
      <RouteHeader workflow={workflow} />

      <svg className="route-svg" width={W} height={H}>
        {/* ── edges ── */}
        <RouteEdge
          a={userPos}
          b={vaultPos}
          thickness={5 + workflow.vault_pct * 12}
          color="#5afca7"
          opacity={0.65}
        />
        <RouteEdge
          a={vaultPos}
          b={outputPos}
          thickness={5 + workflow.vault_pct * 12}
          color="#5afca7"
          opacity={0.65}
        />
        <RouteEdge
          a={userPos}
          b={frontierPos}
          thickness={1.5 + workflow.frontier_pct * 8}
          color="#ffb35a"
          opacity={0.55}
        />
        <RouteEdge
          a={frontierPos}
          b={outputPos}
          thickness={1.5 + workflow.frontier_pct * 8}
          color="#ffb35a"
          opacity={0.55}
        />

        {/* ── packets riding the edges ── */}
        <PacketLayer
          packets={packetsRef.current}
          userPos={userPos}
          vaultPos={vaultPos}
          frontierPos={frontierPos}
          outputPos={outputPos}
        />

        {/* ── nodes drawn on top ── */}
        <UserNode pos={userPos} />
        <VaultNode pos={vaultPos} workflow={workflow} />
        <FrontierNode pos={frontierPos} workflow={workflow} />
        <OutputNode pos={outputPos} />

        {/* ── edge labels (distribution % at midpoints) ── */}
        <EdgeLabel
          a={userPos}
          b={vaultPos}
          text={`${(workflow.vault_pct * 100).toFixed(1)}%`}
          tier="vault"
        />
        <EdgeLabel
          a={userPos}
          b={frontierPos}
          text={`${(workflow.frontier_pct * 100).toFixed(1)}%`}
          tier="frontier"
        />
      </svg>

      <RouteCounters workflow={workflow} route={route} />
    </div>
  );
}

// ── header ──────────────────────────────────────────────────────────

function RouteHeader({ workflow }: { workflow: Workflow }): JSX.Element {
  return (
    <div className="route-header">
      <div className="title">
        <span className="caret">⇆</span>
        <span>production routing</span>
      </div>
      <div className="meta">
        {workflow.source_name}() <span className="dim">·</span>{" "}
        live traffic distribution <span className="dim">·</span>{" "}
        {workflow.monthly_call_volume.toLocaleString()}/mo
      </div>
    </div>
  );
}

// ── nodes ───────────────────────────────────────────────────────────

function UserNode({ pos }: { pos: { x: number; y: number } }): JSX.Element {
  return (
    <g className="route-node user">
      <circle cx={pos.x} cy={pos.y} r={42} className="halo" />
      <circle cx={pos.x} cy={pos.y} r={32} className="core" />
      <text x={pos.x} y={pos.y - 3} className="title">
        USER
      </text>
      <text x={pos.x} y={pos.y + 12} className="sub">
        production call
      </text>
    </g>
  );
}

function VaultNode({
  pos,
  workflow,
}: {
  pos: { x: number; y: number };
  workflow: Workflow;
}): JSX.Element {
  const W = 220;
  const H = 78;
  return (
    <g className="route-node vault">
      <rect
        x={pos.x - W / 2}
        y={pos.y - H / 2}
        width={W}
        height={H}
        rx={10}
        className="frame"
      />
      <text x={pos.x} y={pos.y - H / 2 + 18} className="title">
        NEO VAULT
      </text>
      <text x={pos.x} y={pos.y - H / 2 + 34} className="sub">
        {workflow.clusters.length} typed branches · deterministic
      </text>
      <text x={pos.x} y={pos.y - H / 2 + 50} className="value">
        ≈{(workflow.vault_pct * 100).toFixed(1)}% of traffic
      </text>
      <text x={pos.x} y={pos.y - H / 2 + 66} className="cost">
        ~$0 / call · ~1ms
      </text>
    </g>
  );
}

function FrontierNode({
  pos,
  workflow,
}: {
  pos: { x: number; y: number };
  workflow: Workflow;
}): JSX.Element {
  const W = 220;
  const H = 78;
  return (
    <g className="route-node frontier">
      <rect
        x={pos.x - W / 2}
        y={pos.y - H / 2}
        width={W}
        height={H}
        rx={10}
        className="frame"
      />
      <text x={pos.x} y={pos.y - H / 2 + 18} className="title">
        FRONTIER LLM
      </text>
      <text x={pos.x} y={pos.y - H / 2 + 34} className="sub">
        explicit fallback · sonnet-4.6
      </text>
      <text x={pos.x} y={pos.y - H / 2 + 50} className="value">
        ≈{(workflow.frontier_pct * 100).toFixed(1)}% of traffic
      </text>
      <text x={pos.x} y={pos.y - H / 2 + 66} className="cost">
        ~$0.05 / call · ~500ms
      </text>
    </g>
  );
}

function OutputNode({ pos }: { pos: { x: number; y: number } }): JSX.Element {
  return (
    <g className="route-node output">
      <circle cx={pos.x} cy={pos.y} r={42} className="halo" />
      <circle cx={pos.x} cy={pos.y} r={32} className="core" />
      <text x={pos.x} y={pos.y - 3} className="title">
        OUTPUT
      </text>
      <text x={pos.x} y={pos.y + 12} className="sub">
        ≥98% match
      </text>
    </g>
  );
}

// ── edges ──────────────────────────────────────────────────────────

function RouteEdge({
  a,
  b,
  thickness,
  color,
  opacity,
}: {
  a: { x: number; y: number };
  b: { x: number; y: number };
  thickness: number;
  color: string;
  opacity: number;
}): JSX.Element {
  return (
    <line
      x1={a.x}
      y1={a.y}
      x2={b.x}
      y2={b.y}
      stroke={color}
      strokeWidth={thickness}
      strokeLinecap="round"
      opacity={opacity}
    />
  );
}

function EdgeLabel({
  a,
  b,
  text,
  tier,
}: {
  a: { x: number; y: number };
  b: { x: number; y: number };
  text: string;
  tier: "vault" | "frontier";
}): JSX.Element {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  return (
    <g className={`route-edge-lbl ${tier}`}>
      <rect
        x={mx - 30}
        y={my - 10}
        width={60}
        height={20}
        rx={4}
        className="bg"
      />
      <text x={mx} y={my + 4}>
        {text}
      </text>
    </g>
  );
}

// ── packet layer (rendered inside the svg) ─────────────────────────

function PacketLayer({
  packets,
  userPos,
  vaultPos,
  frontierPos,
  outputPos,
}: {
  packets: Packet[];
  userPos: { x: number; y: number };
  vaultPos: { x: number; y: number };
  frontierPos: { x: number; y: number };
  outputPos: { x: number; y: number };
}): JSX.Element {
  // Fragment of paths for the two route choices.
  const renderForVia = (p: Packet) => {
    // First half: user → middle node. Second half: middle node → output.
    const via = p.via === "vault" ? vaultPos : frontierPos;
    let x: number;
    let y: number;
    if (p.t < 0.5) {
      const tt = p.t / 0.5;
      x = userPos.x + (via.x - userPos.x) * tt;
      y = userPos.y + (via.y - userPos.y) * tt;
    } else {
      const tt = (p.t - 0.5) / 0.5;
      x = via.x + (outputPos.x - via.x) * tt;
      y = via.y + (outputPos.y - via.y) * tt;
    }
    return { x, y };
  };
  return (
    <g className="route-packets">
      {packets.map((p) => {
        const pos = renderForVia(p);
        return (
          <circle
            key={p.id}
            cx={pos.x}
            cy={pos.y}
            r={p.via === "vault" ? 2.2 : 2.4}
            className={`packet ${p.via}`}
          />
        );
      })}
    </g>
  );
}

// ── live counters in corners ───────────────────────────────────────

function RouteCounters({
  workflow,
  route,
}: {
  workflow: Workflow;
  route?: { saved_per_minute_usd: number; per_minute_tier_1: number; per_minute_tier_2: number; per_minute_tier_3: number };
}): JSX.Element {
  const saved = route?.saved_per_minute_usd ?? 0;
  const t1 = route?.per_minute_tier_1 ?? 0;
  const t3 = route?.per_minute_tier_3 ?? 0;
  return (
    <>
      <div className="route-counter saved">
        <div className="big">${saved.toFixed(2)}</div>
        <div className="lbl">saved this minute</div>
      </div>
      <div className="route-counter calls">
        <div className="big">
          {(workflow.monthly_call_volume / 60 / 60 / 24 / 30).toFixed(0)}
          <span className="unit">/s</span>
        </div>
        <div className="lbl">live throughput</div>
        <div className="ticker">
          <span className="g">{t1}</span>
          <span className="dim"> · </span>
          <span className="y">{t3}</span>
          <span className="lbl-mini">  T1 / T3 · last min</span>
        </div>
      </div>
      <div className="route-counter savings">
        <div className="big">${workflow.annual_savings_usd.toLocaleString()}</div>
        <div className="lbl">projected annual savings</div>
      </div>
    </>
  );
}
