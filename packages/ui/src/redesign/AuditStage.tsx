/**
 * Audit stage — organic / panel-less.
 *
 * The compile agent boots inside a Tensorlake sandbox, scans the
 * Nozomio repo, and identifies production LLM workflows. For each
 * workflow we surface ~16 *synthetic call samples* — micro inputs
 * the codifier will fan out across — so judges immediately see what
 * each workflow actually handles in production.
 *
 * Visual rules (Claude-style cream + maroon palette):
 *   · NO rectangular cards. Type, dots, and soft auras only.
 *   · Each workflow is a column of (display name → description →
 *     synthetic-call nodes radiating out).
 *   · One node per workflow is "active" at any time — its label
 *     prints into a streaming line above the column. Cycles every
 *     ~700ms.
 *   · Sub-pattern clusters are conveyed by hue (different maroon
 *     tints) and gentle proximity, not boxes.
 *   · Manifest reveal at the end is plain centered type, no panels.
 *
 * Phase machine is unchanged from the previous AuditStage:
 *   boot → scanning → classifying → filtering → manifest → transition
 */

import { useEffect, useMemo, useState } from "react";
import {
  useRedesignStore,
  type AuditPhase,
} from "../data/redesign-store.js";
import {
  AUDIT_CALL_SITES,
  CODIFIABLE_WORKFLOWS,
  type Workflow,
} from "../data/workflows.js";
import { getSamplePack } from "./synthetic-call-samples.js";

const REPO_DISPLAY = "nozomio/personal-agent";

// ─────────────────────────────────────────────────────────────────────
// Audit driver — singleton timeline survives StrictMode double-mounts.

const AUDIT_DRIVER = { started: false };

export function resetAuditDriver(): void {
  AUDIT_DRIVER.started = false;
}

async function runAuditTimeline(): Promise<void> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const s = () => useRedesignStore.getState();

  // BOOT — short, just enough for the sandbox handshake to feel real
  s().setAuditPhase("boot");
  for (let i = 0; i < 6; i++) {
    s().bumpBootLines();
    await sleep(180);
  }
  await sleep(280);

  // SCANNING — token meter scrolls while the repo readout types in
  s().setAuditPhase("scanning");
  const SCAN_FILES = 22;
  for (let i = 0; i < SCAN_FILES; i++) {
    s().setFilesScanned(i + 1);
    for (let k = 0; k < 8; k++) {
      s().bumpAstTokens(70 + Math.floor(Math.random() * 90));
      await sleep(8);
    }
    await sleep(40);
  }
  await sleep(220);

  // CLASSIFYING — workflows pop in one at a time
  s().setAuditPhase("classifying");
  for (const site of AUDIT_CALL_SITES) {
    s().pushClassified(site);
    await sleep(220);
  }
  await sleep(420);

  // FILTERING — synthetic calls fan out (visual is driven from
  // the node enumerator below; we just hold this phase long enough
  // for the columns to fully emit + cycle a few active labels)
  s().setAuditPhase("filtering");
  s().setFiltered(true);
  await sleep(8200);

  // MANIFEST — settle, summarize
  s().setAuditPhase("manifest");
  await sleep(3200);

  // TRANSITION → WORKSPACE
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
  }, []);
}

// ─────────────────────────────────────────────────────────────────────
// Header — minimal chrome. Pure type. No panel.

function AuditHeader(): JSX.Element {
  const phase = useRedesignStore((s) => s.audit.phase);
  const tl = useRedesignStore((s) => s.tensorlake);
  const live = tl.connected && tl.sandbox_id != null;

  const phaseLabel = (() => {
    switch (phase) {
      case "boot":
        return "spawning sandbox";
      case "scanning":
        return "scanning repo";
      case "classifying":
        return "identifying workflows";
      case "filtering":
        return "fanning out synthetic calls";
      case "manifest":
      case "transition":
        return "audit complete";
      default:
        return "ready";
    }
  })();

  return (
    <header className="audit-org-header">
      <div className="audit-org-mark">
        <span className="audit-org-mark-dot" aria-hidden />
        <span className="audit-org-mark-name">Compile</span>
        <span className="audit-org-mark-sep">·</span>
        <span className="audit-org-mark-task">audit</span>
      </div>

      <div className="audit-org-repo">
        <span className="audit-org-repo-arrow" aria-hidden>↳</span>
        <span className="audit-org-repo-path">{REPO_DISPLAY}</span>
        <span className="audit-org-repo-rev">@a3f2d1b</span>
      </div>

      <div className="audit-org-phase">
        <span className={`audit-org-phase-dot ${phase}`} aria-hidden />
        <span className="audit-org-phase-text">{phaseLabel}</span>
        <span className="audit-org-phase-sep">·</span>
        <span className={`audit-org-svc ${live ? "live" : "offline"}`}>
          tensorlake {live ? "live" : "offline"}
        </span>
      </div>
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Repo readout — appears during scanning. No box; just a streaming
// type-out of the directory tree.

const REPO_TREE_LINES = [
  "  ├── src/agent/",
  "  │   ├── intent.ts        ← classify_message_intent",
  "  │   ├── urgency.ts       ← score_message_urgency",
  "  │   ├── warmth.ts        ← score_relationship_warmth",
  "  │   ├── events.ts        ← extract_event_from_message",
  "  │   └── memory.ts        ← summarize_thread_for_memory",
  "  ├── src/llm/openai.ts",
  "  ├── src/llm/anthropic.ts",
  "  ├── prompts/",
  "  └── package.json",
];

function RepoReadout(): JSX.Element | null {
  const phase = useRedesignStore((s) => s.audit.phase);
  const filesScanned = useRedesignStore((s) => s.audit.files_scanned);
  const tokens = useRedesignStore((s) => s.audit.ast_tokens_seen);

  if (phase !== "scanning" && phase !== "boot") return null;

  // Reveal tree lines progressively as files scanned.
  const treeReveal = Math.min(
    REPO_TREE_LINES.length,
    Math.floor((filesScanned / 22) * REPO_TREE_LINES.length),
  );

  return (
    <div className="audit-org-readout">
      <div className="audit-org-readout-head">
        <span className="prompt">$</span>
        <span>compile audit {REPO_DISPLAY}</span>
        <span className="caret" />
      </div>
      <div className="audit-org-readout-tree">
        <div className="line dim">  {REPO_DISPLAY}/</div>
        {REPO_TREE_LINES.slice(0, treeReveal).map((ln, i) => (
          <div key={i} className="line">
            {ln}
          </div>
        ))}
      </div>
      <div className="audit-org-readout-meter">
        <span>
          <em>{filesScanned}</em> files
        </span>
        <span className="audit-org-readout-sep">·</span>
        <span>
          <em>{tokens.toLocaleString()}</em> ast tokens
        </span>
        <span className="audit-org-readout-sep">·</span>
        <span>walking call graph · matching providers</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Workflow column — the big visual. No panel. Just a workflow name,
// a description, and a constellation of synthetic-call nodes.

function formatMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

interface NodePlacement {
  /** node x in [0, 1] within the column */
  x: number;
  y: number;
  /** sub-cluster slug */
  cluster: string;
  /** label text */
  label: string;
}

/**
 * Deterministic placement so HMR / remount keeps nodes still.
 * Tight golden-angle scatter inside the column with a small jitter
 * keyed on (workflowIndex, nodeIndex) so workflows look unique.
 */
function placeNodes(
  workflowIndex: number,
  samples: { label: string; cluster: string }[],
): NodePlacement[] {
  const out: NodePlacement[] = [];
  // Pre-bucket by cluster so each cluster lives in roughly the same
  // angular wedge — that's what gives the visual its grouping.
  const byCluster = new Map<string, { label: string; cluster: string }[]>();
  for (const s of samples) {
    if (!byCluster.has(s.cluster)) byCluster.set(s.cluster, []);
    byCluster.get(s.cluster)!.push(s);
  }
  const clusterOrder = [...byCluster.keys()];
  const TAU = Math.PI * 2;
  let placedIdx = 0;
  clusterOrder.forEach((cluster, ci) => {
    const arr = byCluster.get(cluster)!;
    const wedgeStart = (ci / clusterOrder.length) * TAU;
    const wedgeEnd = ((ci + 1) / clusterOrder.length) * TAU;
    arr.forEach((s, j) => {
      const t = (j + 0.5) / arr.length;
      const angle = wedgeStart + t * (wedgeEnd - wedgeStart);
      // Two visual rings; ring decided by sample index parity within cluster.
      const ring = j % 2 === 0 ? 0.32 : 0.46;
      // Jitter keyed on (workflowIndex, placedIdx) — deterministic per node.
      const jitterSeed = (workflowIndex * 977 + placedIdx * 131) % 1000;
      const jr = ((jitterSeed % 23) - 11) / 220; // ±0.05
      const ja = ((jitterSeed % 17) - 8) / 70; // small angular jitter
      const r = ring + jr;
      const a = angle + ja;
      const x = 0.5 + Math.cos(a) * r;
      const y = 0.5 + Math.sin(a) * r * 0.78; // squash vertically
      out.push({ x, y, cluster, label: s.label });
      placedIdx += 1;
    });
  });
  return out;
}

interface WorkflowColumnProps {
  workflow: Workflow;
  index: number;
  /** When false, column is pre-revealed but nodes hidden. */
  reveal: boolean;
  /** When true, animate nodes (during filtering / manifest phases). */
  emit: boolean;
}

function WorkflowColumn({
  workflow,
  index,
  reveal,
  emit,
}: WorkflowColumnProps): JSX.Element {
  const pack = useMemo(() => getSamplePack(workflow.function_name), [workflow.function_name]);
  const placements = useMemo(
    () => placeNodes(index, pack.samples),
    [index, pack.samples],
  );

  // Number of nodes currently visible — emits one every 110ms while
  // `emit` is true.
  const [visible, setVisible] = useState(0);
  useEffect(() => {
    if (!emit) return;
    let cancelled = false;
    const start = performance.now();
    const STAGGER = 90 + index * 25; // staggered fan-out across columns
    const tick = (now: number): void => {
      if (cancelled) return;
      const n = Math.min(
        placements.length,
        Math.floor((now - start) / STAGGER),
      );
      setVisible(n);
      if (n < placements.length) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return () => {
      cancelled = true;
    };
  }, [emit, placements.length, index]);

  // Active node — cycles through visible nodes; its label streams
  // into the headline above the column.
  const [activeIdx, setActiveIdx] = useState(0);
  useEffect(() => {
    if (visible === 0) return;
    const interval = window.setInterval(() => {
      setActiveIdx((i) => (i + 1) % visible);
    }, 720);
    return () => window.clearInterval(interval);
  }, [visible]);

  const activeSample = visible > 0 ? placements[activeIdx % visible] : null;

  const yearly = workflow.monthly_calls * workflow.per_call_cost_usd * 12;
  const tierLabel = workflow.tier === "tier_2" ? "tier 2 · phi-3-mini" : "tier 1 · vault";

  return (
    <div
      className={`audit-org-wf ${reveal ? "is-revealed" : ""} ${workflow.tier}`}
      style={{ ["--wf-delay" as never]: `${index * 140}ms` }}
    >
      <div className="audit-org-wf-meta">
        <span className="audit-org-wf-num">{(index + 1).toString().padStart(2, "0")}</span>
        <span className={`audit-org-wf-tier ${workflow.tier}`}>{tierLabel}</span>
      </div>

      <h2 className="audit-org-wf-name">
        {workflow.display_name}
      </h2>
      <p className="audit-org-wf-desc">{workflow.description}</p>

      <div className="audit-org-wf-stats">
        <span>
          <em>{(workflow.monthly_calls / 1000).toFixed(0)}k</em> calls / mo
        </span>
        <span className="sep">·</span>
        <span>
          <em>{formatMoney(yearly)}</em> annual spend
        </span>
        <span className="sep">·</span>
        <span>
          <em>{pack.clusters.length}</em> clusters
        </span>
      </div>

      {/* The active synthetic-call line — the game-changer the user
          asked for. As nodes pop in, this line rotates through them
          so judges read what each node actually represents. */}
      <div className="audit-org-wf-active">
        <span className="audit-org-wf-active-dot" aria-hidden />
        <span className="audit-org-wf-active-prefix">running synthetic call:</span>
        <span className="audit-org-wf-active-text">
          {activeSample ? `"${activeSample.label}"` : "warming up…"}
        </span>
      </div>

      <div className="audit-org-wf-canvas">
        {/* soft halo — pure aesthetic, no border */}
        <div className="audit-org-wf-halo" aria-hidden />

        {/* Cluster tags float at the edge of the canvas. */}
        {pack.clusters.map((c, ci) => {
          // Place each tag near the centroid of nodes in that cluster
          // so the tag visually belongs to its wedge. Pre-compute
          // cluster center from placements.
          const clusterNodes = placements.filter((p) => p.cluster === c.slug);
          if (clusterNodes.length === 0) return null;
          const cx =
            clusterNodes.reduce((acc, n) => acc + n.x, 0) / clusterNodes.length;
          const cy =
            clusterNodes.reduce((acc, n) => acc + n.y, 0) / clusterNodes.length;
          // Push tag slightly outward from the centroid for legibility.
          const dx = cx - 0.5;
          const dy = cy - 0.5;
          const len = Math.max(0.02, Math.hypot(dx, dy));
          const tx = 0.5 + (dx / len) * (Math.hypot(dx, dy) + 0.06);
          const ty = 0.5 + (dy / len) * (Math.hypot(dx, dy) + 0.06);
          const visibleCount = clusterNodes.filter((n) => {
            const idx = placements.indexOf(n);
            return idx < visible;
          }).length;
          return (
            <div
              key={c.slug}
              className="audit-org-cluster-tag"
              style={{
                left: `${tx * 100}%`,
                top: `${ty * 100}%`,
                ["--cluster-delay" as never]: `${ci * 220 + 600}ms`,
                opacity: visibleCount > 0 ? 1 : 0,
              }}
              data-cluster={c.slug}
            >
              <span className="audit-org-cluster-label">{c.label}</span>
              <span className="audit-org-cluster-share">
                {visibleCount}/{clusterNodes.length}
              </span>
            </div>
          );
        })}

        {placements.map((p, i) => {
          const isVisible = i < visible;
          const isActive = activeSample === p;
          return (
            <div
              key={i}
              className={`audit-org-node ${isVisible ? "is-visible" : ""} ${isActive ? "is-active" : ""}`}
              style={{
                left: `${p.x * 100}%`,
                top: `${p.y * 100}%`,
                ["--node-delay" as never]: `${i * 18}ms`,
              }}
              data-cluster={p.cluster}
            >
              <span className="audit-org-node-dot" aria-hidden />
              <span className="audit-org-node-label">{p.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Workflow grid — the centerpiece. Reveals one column per workflow as
// the audit progresses through `classifying`. Once all are revealed,
// `filtering` triggers the synthetic-call emission across columns.

function WorkflowGrid(): JSX.Element {
  const phase = useRedesignStore((s) => s.audit.phase);
  const classified = useRedesignStore((s) => s.audit.classified);

  // Identified workflows in the order they were classified.
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

  const emit = phase === "filtering" || phase === "manifest" || phase === "transition";

  if (identifiedWorkflows.length === 0) return <></>;

  return (
    <div
      className={`audit-org-grid wf-count-${identifiedWorkflows.length}`}
      data-phase={phase}
    >
      {identifiedWorkflows.map((wf, i) => (
        <WorkflowColumn key={wf.id} workflow={wf} index={i} reveal emit={emit} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Manifest reveal — clean centered type, no panel.

function ManifestReveal(): JSX.Element | null {
  const phase = useRedesignStore((s) => s.audit.phase);
  if (phase !== "manifest" && phase !== "transition") return null;

  const codifiable = CODIFIABLE_WORKFLOWS;
  const totalSavings = codifiable.reduce(
    (acc, w) => acc + w.production.annual_savings_usd,
    0,
  );
  const totalCalls = codifiable.reduce((acc, w) => acc + w.monthly_calls, 0);

  return (
    <div className={`audit-org-manifest ${phase === "transition" ? "is-folding" : ""}`}>
      <div className="audit-org-manifest-eyebrow">audit complete</div>
      <h2 className="audit-org-manifest-headline">
        <span className="num">{codifiable.length}</span>
        <span className="lbl">codifiable workflows</span>
      </h2>
      <p className="audit-org-manifest-sub">
        <em>{(totalCalls / 1000).toFixed(0)}k</em> calls / mo will be lifted out
        of the agent loop · projected <em>{formatMoney(totalSavings)}</em> annual
        savings
      </p>
      <div className="audit-org-manifest-cta">
        <span className="prompt">→</span>
        <span>opening workspace</span>
        <span className="caret" />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Phase ticker — minimal dotted progress line at the bottom.

function PhaseTicker(): JSX.Element {
  const phase = useRedesignStore((s) => s.audit.phase);
  const labels: { id: AuditPhase; label: string }[] = [
    { id: "boot", label: "boot" },
    { id: "scanning", label: "scan" },
    { id: "classifying", label: "identify" },
    { id: "filtering", label: "synthesize" },
    { id: "manifest", label: "ship" },
  ];
  const idx = labels.findIndex((l) => l.id === phase);
  return (
    <div className="audit-org-ticker">
      {labels.map((l, i) => {
        const cur = i === idx;
        const done = i < idx;
        return (
          <span key={l.id} className={`tick ${cur ? "current" : ""} ${done ? "done" : ""}`}>
            <span className="tick-dot" aria-hidden />
            <span className="tick-label">{l.label}</span>
          </span>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Top-level audit stage.

export function AuditStage(): JSX.Element {
  useAuditDriver();

  return (
    <div className="audit-org">
      <div className="audit-org-grain" aria-hidden />
      <div className="audit-org-glow" aria-hidden />

      <AuditHeader />

      <main className="audit-org-main">
        <RepoReadout />
        <WorkflowGrid />
        <ManifestReveal />
      </main>

      <PhaseTicker />
    </div>
  );
}

/** Used by the App shell to keep audit mounted while transition folds. */
export function shouldShowAuditStage(phase: AuditPhase): boolean {
  return phase !== "complete";
}
