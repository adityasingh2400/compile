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
import {
  getClusterDescription,
  getSamplePack,
  inferSampleDetail,
  type SampleDetail,
} from "./synthetic-call-samples.js";

// Pulled into module scope so the cluster + node detail overlays
// can format costs / latencies cheaply.
const fmtUsd = (n: number): string => {
  if (n === 0) return "$0";
  if (n < 0.001) return `$${n.toFixed(5)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
};
const fmtMs = (n: number): string => (n < 1 ? "<1 ms" : `${Math.round(n)} ms`);

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
  // the node enumerator below; we hold this phase long enough for
  // the columns to fully emit + cycle a few active labels)
  s().setAuditPhase("filtering");
  s().setFiltered(true);
  await sleep(8200);

  // MANIFEST — settle, summarize. We park here so judges can hover
  // / click any node and inspect the simulated interaction. The
  // workspace transition is operator-driven (Enter / →) from this
  // point.
  s().setAuditPhase("manifest");
  // Auto-advance after a generous window so the demo still flows
  // even if nobody touches the keyboard.
  await sleep(45_000);

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
  /** node x in [0, 1] within the canvas */
  x: number;
  y: number;
  /** sub-cluster slug */
  cluster: string;
  /** label text */
  label: string;
  /** centroid of this node's cluster (normalized) */
  cx: number;
  cy: number;
  /** radius of this node's cluster region (normalized) */
  cr: number;
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Deterministic, disk-filling placement.
 *
 * Clusters are arranged on a soft ring around the canvas center, sized by
 * sample count (more samples → bigger blob). Within each cluster, samples
 * are packed via a Vogel sunflower so they fill the *whole disk*, center
 * included — not just two perimeter rings.
 */
function placeNodes(
  workflowIndex: number,
  samples: { label: string; cluster: string }[],
): NodePlacement[] {
  const byCluster = new Map<string, { label: string; cluster: string }[]>();
  for (const s of samples) {
    if (!byCluster.has(s.cluster)) byCluster.set(s.cluster, []);
    byCluster.get(s.cluster)!.push(s);
  }
  const clusterOrder = [...byCluster.keys()];
  const N = clusterOrder.length;
  const TAU = Math.PI * 2;

  // Cluster ring radius: keep clusters comfortably inside the canvas.
  const ringR = N <= 2 ? 0.0 : N <= 4 ? 0.34 : 0.38;
  // Phase offset keyed on workflow so each workflow's layout feels unique.
  const phase = (workflowIndex * 0.37) % 1;

  // Per-cluster radius — proportional to sqrt(count). Kept small so
  // every cluster reads as its own group instead of one giant blob.
  const total = samples.length || 1;
  const baseR = N === 1 ? 0.30 : N === 2 ? 0.18 : N <= 4 ? 0.12 : 0.10;

  // Density multiplier: only every Nth node carries a label; the rest
  // are unlabeled satellites that read as call volume in the demo.
  const DENSITY = 8;

  const out: NodePlacement[] = [];
  clusterOrder.forEach((cluster, ci) => {
    const arr = byCluster.get(cluster)!;
    const a = (ci / N + phase) * TAU;
    const cx = 0.5 + Math.cos(a) * ringR;
    // Squash vertically so the constellation feels landscape-friendly.
    const cy = 0.5 + Math.sin(a) * ringR * 0.78;
    const share = arr.length / total;
    const cr = baseR * (0.78 + 0.6 * Math.sqrt(share * N));

    const totalCount = Math.max(arr.length * DENSITY, 14);
    for (let j = 0; j < totalCount; j++) {
      const labelSlot = j % DENSITY === 0 ? Math.floor(j / DENSITY) : -1;
      const label = labelSlot >= 0 && labelSlot < arr.length ? arr[labelSlot]!.label : "";
      // Vogel disk fill: r = cr * sqrt((j+0.5)/count), theta = j*GOLDEN_ANGLE.
      // Add deterministic jitter so the lattice doesn't read as too perfect.
      const jitterSeed = (workflowIndex * 977 + ci * 211 + j * 131) % 1000;
      const jr = ((jitterSeed % 19) - 9) / 360; // ±~0.025
      const ja = ((jitterSeed % 13) - 6) / 60;
      const r = cr * Math.sqrt((j + 0.5) / totalCount) + jr;
      const theta = j * GOLDEN_ANGLE + ja + ci * 0.7;
      const x = cx + Math.cos(theta) * r;
      const y = cy + Math.sin(theta) * r * 0.92;
      out.push({ x, y, cluster, label, cx, cy, cr });
    }
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
  /** Selected cluster slug (when focused) or null (overview). */
  focusedCluster: string | null;
  /** Whether *some* workflow has a focused cluster (used to dim siblings). */
  anyFocused: boolean;
  onFocusCluster(clusterSlug: string | null): void;
  onOpenNode(nodeIdx: number): void;
}

function WorkflowColumn({
  workflow,
  index,
  reveal,
  emit,
  focusedCluster,
  anyFocused,
  onFocusCluster,
  onOpenNode,
}: WorkflowColumnProps): JSX.Element {
  const pack = useMemo(() => getSamplePack(workflow.function_name), [workflow.function_name]);
  const placements = useMemo(
    () => placeNodes(index, pack.samples),
    [index, pack.samples],
  );

  // Number of nodes currently visible — emits one every 110ms while
  // `emit` is true. Once a cluster is focused, all nodes are forced
  // visible so the user can hover/click any of them.
  const [visible, setVisible] = useState(0);
  useEffect(() => {
    if (focusedCluster) {
      setVisible(placements.length);
      return;
    }
    if (!emit) return;
    let cancelled = false;
    const start = performance.now();
    // Faster spawn — nodes are pre-baked, no reason to drip-feed.
    // ~28ms per node so a 16-node workflow fully populates in ~450ms.
    const STAGGER = 26;
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
  }, [emit, placements.length, index, focusedCluster]);

  // Active node — cycles through visible nodes; its label streams
  // into the headline above the column. Pauses while a cluster is
  // focused so it doesn't fight with the hover state.
  const [activeIdx, setActiveIdx] = useState(0);
  useEffect(() => {
    if (visible === 0) return;
    if (focusedCluster) return;
    const interval = window.setInterval(() => {
      setActiveIdx((i) => (i + 1) % visible);
    }, 720);
    return () => window.clearInterval(interval);
  }, [visible, focusedCluster]);

  // Hover state — which node the user is pointing at, and screen
  // coords for the floating tooltip.
  const [hover, setHover] = useState<{
    nodeIdx: number;
    x: number;
    y: number;
  } | null>(null);

  const activeSample = visible > 0 ? placements[activeIdx % visible] : null;

  const yearly = workflow.monthly_calls * workflow.per_call_cost_usd * 12;
  const tierLabel = workflow.tier === "tier_2" ? "tier 2 · phi-3-mini" : "tier 1 · vault";
  const dimmed = anyFocused && focusedCluster == null;

  return (
    <div
      className={`audit-org-wf ${reveal ? "is-revealed" : ""} ${workflow.tier} ${
        focusedCluster ? "has-focus" : ""
      } ${dimmed ? "is-dimmed" : ""}`}
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

      <div
        className={`audit-org-wf-canvas ${focusedCluster ? "is-focused" : ""}`}
        onMouseLeave={() => setHover(null)}
      >
        {/* soft halo — pure aesthetic, no border */}
        <div className="audit-org-wf-halo" aria-hidden />

        {/* Cluster tags float at each cluster centroid. Click to zoom. */}
        {pack.clusters.map((c, ci) => {
          const clusterNodes = placements.filter((p) => p.cluster === c.slug);
          if (clusterNodes.length === 0) return null;
          const cx = clusterNodes[0]!.cx;
          const cy = clusterNodes[0]!.cy;
          const cr = clusterNodes[0]!.cr;
          // Anchor tag just above the cluster blob.
          const tx = cx;
          const ty = Math.max(0.04, cy - cr * 0.92 - 0.04);
          const visibleCount = clusterNodes.filter((n) => {
            const idx = placements.indexOf(n);
            return idx < visible;
          }).length;
          const isFocus = focusedCluster === c.slug;
          const isFaded = focusedCluster != null && !isFocus;
          return (
            <button
              key={c.slug}
              type="button"
              className={`audit-org-cluster-tag ${isFocus ? "is-focus" : ""} ${
                isFaded ? "is-faded" : ""
              }`}
              style={{
                left: `${tx * 100}%`,
                top: `${ty * 100}%`,
                ["--cluster-delay" as never]: `${ci * 220 + 600}ms`,
                opacity: visibleCount > 0 ? undefined : 0,
              }}
              data-cluster={c.slug}
              onClick={(e) => {
                e.stopPropagation();
                onFocusCluster(isFocus ? null : c.slug);
              }}
              aria-label={`${isFocus ? "Exit" : "Focus"} cluster: ${c.label}`}
            >
              <span className="audit-org-cluster-label">{c.label}</span>
              <span className="audit-org-cluster-share">
                {visibleCount}/{clusterNodes.length}
              </span>
            </button>
          );
        })}

        {placements.map((p, i) => {
          const isVisible = i < visible;
          const isActive = activeSample === p && !focusedCluster;
          const isFocusCluster = focusedCluster === p.cluster;
          const isFadedNode = focusedCluster != null && !isFocusCluster;
          const isLabeled = p.label !== "";
          // When a cluster is focused, scale-out its nodes so they're
          // easier to hover/click. We apply this via a CSS variable so
          // the radius push is GPU-cheap (transform).
          const focusBoost = isFocusCluster ? 1.35 : 1;
          return (
            <div
              key={i}
              className={`audit-org-node ${isVisible ? "is-visible" : ""} ${
                isActive ? "is-active" : ""
              } ${isFocusCluster ? "is-focus" : ""} ${
                isFadedNode ? "is-faded" : ""
              } ${isLabeled ? "is-labeled" : "is-satellite"}`}
              style={{
                left: `${50 + (p.x - 0.5) * 100 * focusBoost}%`,
                top: `${50 + (p.y - 0.5) * 100 * focusBoost}%`,
                ["--node-delay" as never]: `${i * 18}ms`,
              }}
              data-cluster={p.cluster}
              onMouseEnter={(e) => {
                if (!isVisible || !isLabeled || isFadedNode) return;
                setHover({
                  nodeIdx: i,
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
              onMouseMove={(e) => {
                if (!isVisible || !isLabeled || isFadedNode) return;
                setHover({
                  nodeIdx: i,
                  x: e.clientX,
                  y: e.clientY,
                });
              }}
              onClick={(e) => {
                if (!isVisible || !isLabeled || isFadedNode) return;
                e.stopPropagation();
                onOpenNode(i);
              }}
              role={isLabeled ? "button" : undefined}
              tabIndex={isVisible && isLabeled && !isFadedNode ? 0 : -1}
              aria-label={isLabeled ? `Open synthetic call: ${p.label}` : undefined}
            >
              <span className="audit-org-node-dot" aria-hidden />
              <span className="audit-org-node-label">{p.label}</span>
            </div>
          );
        })}

        {/* Floating hover tooltip — quick preview, click for full detail */}
        {hover && (() => {
          const sample = pack.samples.find(
            (s) => s.label === placements[hover.nodeIdx]?.label,
          );
          if (!sample) return null;
          const detail = inferSampleDetail(workflow.function_name, sample);
          // Tooltip is fixed-positioned to viewport coords. Nudge so it
          // stays on-screen near the right/bottom edges.
          const tipX = Math.min(window.innerWidth - 320, hover.x + 14);
          const tipY = Math.min(window.innerHeight - 220, hover.y + 14);
          return (
            <div
              className="audit-org-hover-tip"
              style={{ left: tipX, top: tipY }}
              role="tooltip"
            >
              <div className="audit-org-hover-head">
                {detail.author ? (
                  <span className={`audit-org-hover-avatar hue-${detail.author.hue ?? "maroon"}`}>
                    {detail.author.initials}
                  </span>
                ) : null}
                <div className="audit-org-hover-id">
                  <span className="audit-org-hover-name">
                    {detail.author?.name ?? "synthetic call"}
                  </span>
                  <span className="audit-org-hover-meta">
                    {detail.author?.handle ? `${detail.author.handle} · ` : ""}
                    {detail.posted_at ?? ""}
                    {detail.source ? ` · ${detail.source}` : ""}
                  </span>
                </div>
              </div>
              <div className="audit-org-hover-quote">"{sample.label}"</div>
              <div className="audit-org-hover-foot">
                <span className="audit-org-hover-match">{detail.match_type}</span>
                <span className="audit-org-hover-sep">·</span>
                <span>frontier {fmtMs(detail.frontier_latency_ms ?? 0)}</span>
                <span className="audit-org-hover-arrow">→</span>
                <span className="audit-org-hover-vault">vault {fmtMs(detail.vault_latency_ms ?? 0)}</span>
              </div>
              <div className="audit-org-hover-cta">click for full interaction →</div>
            </div>
          );
        })()}
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

  // Cross-workflow selection state. Driven from this parent so:
  //   · clicking a cluster in workflow A dims workflow B's clusters
  //   · the cluster-zoom side panel + node-detail overlay can read
  //     the same selection without prop-drilling deep
  const [focused, setFocused] = useState<{
    workflowId: string;
    cluster: string;
  } | null>(null);
  const [openNode, setOpenNode] = useState<{
    workflowId: string;
    nodeIdx: number;
  } | null>(null);

  // ESC closes the most-specific overlay first, then unfocuses.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      if (openNode) {
        e.preventDefault();
        setOpenNode(null);
      } else if (focused) {
        e.preventDefault();
        setFocused(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openNode, focused]);

  // The cluster-focus side rail dispatches a CustomEvent when the
  // user picks one of its synthetic-call rows; route that through
  // to setOpenNode here so the rail doesn't need to know about
  // the parent state shape.
  useEffect(() => {
    const onPick = (e: Event): void => {
      const detail = (e as CustomEvent<{ workflowId: string; nodeIdx: number }>)
        .detail;
      if (!detail) return;
      setOpenNode({ workflowId: detail.workflowId, nodeIdx: detail.nodeIdx });
    };
    window.addEventListener("audit-org:open-node", onPick);
    return () => window.removeEventListener("audit-org:open-node", onPick);
  }, []);

  const emit = phase === "filtering" || phase === "manifest" || phase === "transition";

  // Active tab. Defaults to first workflow; advances automatically as
  // more workflows are classified so the audit feels like it's narrating
  // through the discovered call sites.
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [userPicked, setUserPicked] = useState(false);
  useEffect(() => {
    if (userPicked) return;
    const last = identifiedWorkflows[identifiedWorkflows.length - 1];
    if (last && last.id !== activeTabId) setActiveTabId(last.id);
  }, [identifiedWorkflows, userPicked, activeTabId]);

  // Number-key shortcuts (1..9) hop between tabs.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key < "1" || e.key > "9") return;
      const n = Number(e.key) - 1;
      const wf = identifiedWorkflows[n];
      if (!wf) return;
      setUserPicked(true);
      setActiveTabId(wf.id);
      setFocused(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [identifiedWorkflows]);

  if (identifiedWorkflows.length === 0) return <></>;

  const activeWorkflow =
    identifiedWorkflows.find((w) => w.id === activeTabId) ??
    identifiedWorkflows[0]!;
  const activeIndex = identifiedWorkflows.indexOf(activeWorkflow);

  const focusedWorkflow = focused
    ? identifiedWorkflows.find((w) => w.id === focused.workflowId) ?? null
    : null;
  const openWorkflow = openNode
    ? identifiedWorkflows.find((w) => w.id === openNode.workflowId) ?? null
    : null;

  return (
    <>
      <nav className="audit-org-tabs" aria-label="Workflows">
        {identifiedWorkflows.map((wf, i) => {
          const isActive = wf.id === activeWorkflow.id;
          const pack = getSamplePack(wf.function_name);
          return (
            <button
              key={wf.id}
              type="button"
              className={`audit-org-tab ${isActive ? "is-active" : ""} ${wf.tier}`}
              onClick={() => {
                setUserPicked(true);
                setActiveTabId(wf.id);
                setFocused(null);
              }}
              aria-pressed={isActive}
            >
              <span className="audit-org-tab-num">
                {(i + 1).toString().padStart(2, "0")}
              </span>
              <span className="audit-org-tab-name">{wf.display_name}</span>
              <span className="audit-org-tab-meta">
                {pack.clusters.length} clusters
              </span>
            </button>
          );
        })}
      </nav>

      <div
        className={`audit-org-grid is-tabbed ${focused ? "has-focus" : ""}`}
        data-phase={phase}
        onClick={(e) => {
          if (e.target === e.currentTarget && focused) {
            setFocused(null);
          }
        }}
      >
        <WorkflowColumn
          key={activeWorkflow.id}
          workflow={activeWorkflow}
          index={activeIndex}
          reveal
          emit={emit}
          focusedCluster={
            focused?.workflowId === activeWorkflow.id ? focused.cluster : null
          }
          anyFocused={focused != null}
          onFocusCluster={(cluster) =>
            setFocused(
              cluster ? { workflowId: activeWorkflow.id, cluster } : null,
            )
          }
          onOpenNode={(nodeIdx) =>
            setOpenNode({ workflowId: activeWorkflow.id, nodeIdx })
          }
        />
      </div>

      {focusedWorkflow && focused ? (
        <ClusterFocusOverlay
          workflow={focusedWorkflow}
          clusterSlug={focused.cluster}
          onClose={() => setFocused(null)}
        />
      ) : null}

      {openWorkflow && openNode ? (
        <NodeDetailOverlay
          workflow={openWorkflow}
          nodeIdx={openNode.nodeIdx}
          onClose={() => setOpenNode(null)}
        />
      ) : null}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Cluster focus overlay — slides in from the right as a side rail.
// Pure type, no panel border. Lists characteristics + the synthetic
// calls in this cluster, each clickable to open the node detail.

function ClusterFocusOverlay({
  workflow,
  clusterSlug,
  onClose,
}: {
  workflow: Workflow;
  clusterSlug: string;
  onClose(): void;
}): JSX.Element {
  const pack = useMemo(() => getSamplePack(workflow.function_name), [workflow.function_name]);
  const cluster = pack.clusters.find((c) => c.slug === clusterSlug);
  const samples = useMemo(
    () => pack.samples.filter((s) => s.cluster === clusterSlug),
    [pack.samples, clusterSlug],
  );
  if (!cluster) return <></>;

  const description = getClusterDescription(pack, clusterSlug);

  return (
    <aside className="audit-org-cluster-focus" role="dialog" aria-modal="false">
      <header className="audit-org-cluster-focus-head">
        <div className="audit-org-cluster-focus-eyebrow">
          {workflow.display_name} · cluster
        </div>
        <h3 className="audit-org-cluster-focus-name">{cluster.label}</h3>
        <p className="audit-org-cluster-focus-desc">{description}</p>
        <div className="audit-org-cluster-focus-stats">
          <span>
            <em>{samples.length}</em> synthetic calls
          </span>
          <span className="sep">·</span>
          <span>
            <em>
              {((samples.length / pack.samples.length) * 100).toFixed(0)}%
            </em>{" "}
            of fan-out
          </span>
        </div>
        <button
          type="button"
          className="audit-org-cluster-focus-close"
          onClick={onClose}
          aria-label="Close cluster focus"
        >
          ×
        </button>
      </header>

      <div className="audit-org-cluster-focus-list-label">
        click any to inspect the simulated interaction
      </div>
      <ul className="audit-org-cluster-focus-list">
        {samples.map((s) => {
          const detail = inferSampleDetail(workflow.function_name, s);
          // Find this sample's index in pack.samples so the parent
          // can open it consistently.
          const nodeIdx = pack.samples.findIndex(
            (p) => p === s || (p.label === s.label && p.cluster === s.cluster),
          );
          return (
            <li key={`${s.label}::${s.cluster}`}>
              <button
                type="button"
                className="audit-org-cluster-focus-item"
                onClick={() => {
                  // Defer opening through a custom event so the
                  // overlay state lives on WorkflowGrid; we surface
                  // it via a window CustomEvent. Simpler: re-route
                  // through a query param? No — just call onClose
                  // and let user click in the canvas. Better: emit
                  // a window event that WorkflowGrid listens for.
                  window.dispatchEvent(
                    new CustomEvent("audit-org:open-node", {
                      detail: { workflowId: workflow.id, nodeIdx },
                    }),
                  );
                }}
              >
                <span className={`audit-org-cluster-focus-avatar hue-${detail.author?.hue ?? "maroon"}`}>
                  {detail.author?.initials ?? "··"}
                </span>
                <div className="audit-org-cluster-focus-item-text">
                  <span className="audit-org-cluster-focus-item-quote">
                    "{s.label}"
                  </span>
                  <span className="audit-org-cluster-focus-item-meta">
                    {detail.author?.name ?? ""}
                    {detail.posted_at ? ` · ${detail.posted_at}` : ""}
                    {detail.source ? ` · ${detail.source}` : ""}
                  </span>
                </div>
                <span className="audit-org-cluster-focus-item-arrow">→</span>
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Node detail overlay — full screen-ish reveal of a single synthetic
// call's complete interaction. Cream backdrop blur over the audit
// behind, no rectangular panel — just type laid out.

function NodeDetailOverlay({
  workflow,
  nodeIdx,
  onClose,
}: {
  workflow: Workflow;
  nodeIdx: number;
  onClose(): void;
}): JSX.Element {
  const pack = useMemo(() => getSamplePack(workflow.function_name), [workflow.function_name]);
  const sample = pack.samples[nodeIdx];
  if (!sample) return <></>;

  const detail = inferSampleDetail(workflow.function_name, sample);
  const cluster = pack.clusters.find((c) => c.slug === sample.cluster);

  const speedup =
    detail.vault_latency_ms && detail.frontier_latency_ms
      ? Math.max(1, detail.frontier_latency_ms / Math.max(1, detail.vault_latency_ms))
      : null;
  const savingsPct =
    detail.frontier_cost_usd && detail.frontier_cost_usd > 0
      ? Math.max(
          0,
          (1 - (detail.vault_cost_usd ?? 0) / detail.frontier_cost_usd) * 100,
        )
      : null;

  return (
    <div className="audit-org-node-detail" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="audit-org-node-detail-inner"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="audit-org-node-detail-close"
          onClick={onClose}
          aria-label="Close detail"
        >
          ×
        </button>

        <div className="audit-org-node-detail-eyebrow">
          {workflow.display_name}
          {cluster ? (
            <>
              <span className="sep">·</span>
              <span className="audit-org-node-detail-cluster">{cluster.label}</span>
            </>
          ) : null}
          <span className="sep">·</span>
          <span>simulated call</span>
        </div>

        <div className="audit-org-node-detail-author">
          {detail.author ? (
            <span
              className={`audit-org-node-detail-avatar hue-${detail.author.hue ?? "maroon"}`}
            >
              {detail.author.initials}
            </span>
          ) : null}
          <div className="audit-org-node-detail-author-text">
            <span className="audit-org-node-detail-name">
              {detail.author?.name ?? "synthetic call"}
            </span>
            <span className="audit-org-node-detail-handle">
              {detail.author?.handle ?? ""}
              {detail.posted_at ? ` · ${detail.posted_at}` : ""}
              {detail.source ? ` · ${detail.source}` : ""}
            </span>
          </div>
        </div>

        <h2 className="audit-org-node-detail-quote">"{sample.label}"</h2>

        <div className="audit-org-node-detail-grid">
          <div className="audit-org-node-detail-col">
            <div className="audit-org-node-detail-col-eyebrow">input</div>
            <dl className="audit-org-node-detail-fields">
              {detail.input.map((row) => (
                <div key={row.key} className={`row ${row.block ? "is-block" : ""}`}>
                  <dt>{row.key}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="audit-org-node-detail-col">
            <div className="audit-org-node-detail-col-eyebrow">codified output</div>
            <dl className="audit-org-node-detail-fields">
              {detail.output.map((row) => (
                <div key={row.key} className={`row ${row.block ? "is-block" : ""}`}>
                  <dt>{row.key}</dt>
                  <dd className="is-output">{row.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        <div className="audit-org-node-detail-compare">
          <div className="cmp-col">
            <div className="cmp-col-eyebrow">frontier (before)</div>
            <div className="cmp-col-model">{detail.frontier_model ?? "gpt-5"}</div>
            <div className="cmp-col-stat">
              <em>{fmtMs(detail.frontier_latency_ms ?? 0)}</em> latency
            </div>
            <div className="cmp-col-stat">
              <em>{fmtUsd(detail.frontier_cost_usd ?? 0)}</em> per call
            </div>
          </div>
          <div className="cmp-arrow" aria-hidden>→</div>
          <div className="cmp-col is-vault">
            <div className="cmp-col-eyebrow">compile (after)</div>
            <div className="cmp-col-model">{detail.match_type ?? "vault"}</div>
            <div className="cmp-col-stat">
              <em>{fmtMs(detail.vault_latency_ms ?? 0)}</em> latency
            </div>
            <div className="cmp-col-stat">
              <em>{fmtUsd(detail.vault_cost_usd ?? 0)}</em> per call
            </div>
          </div>
          <div className="cmp-summary">
            {speedup ? (
              <span>
                <em>{speedup.toFixed(0)}×</em> faster
              </span>
            ) : null}
            {savingsPct != null ? (
              <span>
                <em>{savingsPct.toFixed(1)}%</em> cheaper
              </span>
            ) : null}
            <span>
              <em>{((detail.confidence ?? 0) * 100).toFixed(0)}%</em> confidence
            </span>
          </div>
        </div>

        <div className="audit-org-node-detail-hint">
          press <kbd>Esc</kbd> or click outside to close
        </div>
      </div>
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
