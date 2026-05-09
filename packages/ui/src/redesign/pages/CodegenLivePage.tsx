/**
 * CodegenLivePage — Page 4.
 *
 * "Editor Theatre" layout: a big code panel on the left where the agent's
 * TypeScript chunks stream in via the daemon `code_chunk` events, and a
 * narrow right-side panel showing Tensorlake's holdout-gate progress
 * (`gate_progress` events).
 *
 * Drives entirely off `useRedesignStore().live.codegen` — no per-workflow
 * timers, no fixtures. When the daemon is silent, an idle frame plays.
 */

import { useEffect, useRef, useState } from "react";
import { useRedesignStore } from "../../data/redesign-store.js";
import type { Workflow } from "../../data/workflows.js";

function clusterLabel(clusterId: string | null, fallback: string): string {
  if (!clusterId) return fallback;
  return clusterId.replace(/^cluster_/, "").replace(/_/g, " ");
}

function fnNameFromCode(code: string, fallback: string): string {
  const m = code.match(/export function\s+([A-Za-z0-9_]+)/);
  return m?.[1] ?? fallback;
}

/** Baked example shown when no live fire has landed yet. Same code the
 *  daemon will eventually stream — pre-rendered so the page is never blank. */
const SEED_CODE = `import { z } from "zod";

const IntentSchema = z.enum([
  "scheduling", "follow_up", "introduction", "thank_you",
  "request", "decline", "casual", "urgent",
]);

export type MessageIntent = z.infer<typeof IntentSchema>;

const KEYWORD_HINTS: Record<MessageIntent, RegExp[]> = {
  scheduling:   [/\\b(meet|schedule|calendar|when works|available)\\b/i],
  follow_up:    [/\\b(checking in|circling back|any update)\\b/i],
  introduction: [/\\b(introduce|wanted to connect|reach out)\\b/i],
  thank_you:    [/\\b(thanks|thank you|appreciate)\\b/i],
  request:      [/\\b(could you|can you|would you|please)\\b/i],
  decline:      [/\\b(unfortunately|can't|won't be able)\\b/i],
  casual:       [/\\b(hey|sup|what's up)\\b/i],
  urgent:       [/\\b(urgent|asap|today|right now)\\b/i],
};

export function classifyMessageIntent(input: { body: string }): MessageIntent {
  const b = input.body.trim();
  for (const [intent, hints] of Object.entries(KEYWORD_HINTS) as [MessageIntent, RegExp[]][]) {
    if (hints.some((re) => re.test(b))) return intent;
  }
  return "casual";
}
`;

export function CodegenLivePage({ workflow }: { workflow: Workflow }): JSX.Element {
  const codegen = useRedesignStore((s) => s.live.codegen);
  const tensorlakeConnected = useRedesignStore((s) => s.tensorlake.connected);
  const codeRef = useRef<HTMLPreElement>(null);

  const isIdle = codegen.phase === "idle" || codegen.code.length === 0;

  // ── Idle-state typewriter ──────────────────────────────────────────
  // When no live fan-out is happening, animate the seeded code in as if
  // the agent were writing it. After the full blob is typed, dwell, then
  // restart from 0 — so judges who linger see continuous activity. As
  // soon as the daemon emits a `code_chunk`, the live stream takes over.
  const [idleCursor, setIdleCursor] = useState(0);
  const [idlePhase, setIdlePhase] = useState<"writing" | "gating" | "done">(
    "writing",
  );
  const [idleGateDone, setIdleGateDone] = useState(0);

  useEffect(() => {
    if (!isIdle) return;
    let cancelled = false;

    const typeOne = (): void => {
      if (cancelled) return;
      setIdleCursor((cur) => {
        const stride = 5 + Math.floor(Math.random() * 11);
        const next = Math.min(SEED_CODE.length, cur + stride);
        if (next >= SEED_CODE.length) {
          setIdlePhase("gating");
          setIdleGateDone(0);
          return SEED_CODE.length;
        }
        setTimeout(typeOne, 170 + Math.random() * 120);
        return next;
      });
    };

    const tickGate = (): void => {
      if (cancelled) return;
      setIdleGateDone((d) => {
        const next = Math.min(200, d + 8 + Math.floor(Math.random() * 14));
        if (next >= 200) {
          setIdlePhase("done");
          // Pause on "done" briefly, then restart the loop.
          setTimeout(() => {
            if (cancelled) return;
            setIdleCursor(0);
            setIdleGateDone(0);
            setIdlePhase("writing");
            setTimeout(typeOne, 240);
          }, 2200);
          return 200;
        }
        setTimeout(tickGate, 140);
        return next;
      });
    };

    setIdleCursor(0);
    setIdleGateDone(0);
    setIdlePhase("writing");
    const t = setTimeout(typeOne, 240);

    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [isIdle]);

  // Drive the gate-tick loop one frame after we transition to "gating".
  useEffect(() => {
    if (!isIdle || idlePhase !== "gating") return;
    let cancelled = false;
    const tick = (): void => {
      if (cancelled) return;
      setIdleGateDone((d) => {
        const next = Math.min(200, d + 8 + Math.floor(Math.random() * 14));
        if (next < 200) setTimeout(tick, 140);
        return next;
      });
    };
    const t = setTimeout(tick, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [isIdle, idlePhase]);

  // Display code: live stream when present, else the typewriter-revealed
  // slice of the seed.
  const displayCode = isIdle ? SEED_CODE.slice(0, idleCursor) : codegen.code;
  const fnName = fnNameFromCode(SEED_CODE, workflow.function_name);
  const lineCount = displayCode.split("\n").length;
  const writeProgress = isIdle
    ? Math.min(1, idleCursor / Math.max(SEED_CODE.length, 1))
    : Math.min(1, codegen.code.length / Math.max(codegen.total_chars_estimate, 1));
  const gateDone = isIdle ? idleGateDone : codegen.gate_done;
  const gateTotal = isIdle ? 200 : codegen.gate_total;
  const gateP50 = isIdle
    ? idlePhase === "writing"
      ? 0
      : 3.4 + Math.random() * 1.2
    : codegen.gate_p50_ms;
  const gatePct = Math.min(1, gateDone / Math.max(gateTotal, 1));

  // Auto-scroll the code pane as new chunks land (live or typewriter).
  useEffect(() => {
    const el = codeRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [displayCode]);

  const effectivePhase = isIdle ? idlePhase : codegen.phase;
  const phaseLabel =
    effectivePhase === "writing"
      ? "agent writing"
      : effectivePhase === "gating"
        ? "validating in tensorlake"
        : effectivePhase === "done"
          ? "ready to commit"
          : "waiting for next fire";

  return (
    <div className="cd-live">
      <div className="cd-live-header">
        <div className="cd-live-cluster">
          <span className="cd-live-cluster-mark">●</span>
          <span className="cd-live-cluster-name">
            {clusterLabel(codegen.cluster_id, workflow.function_name)}
          </span>
          <span className="cd-live-cluster-meta">
            <span className={`tier-tag ${workflow.tier}`}>
              {workflow.tier === "tier_1" ? "T1" : "T2"}
            </span>
            <span className="dim">·</span>
            <span className="mono">cluster #{(codegen.cluster_id ?? "—").slice(-2)}</span>
            <span className="dim">·</span>
            <span className="mono">n=247</span>
          </span>
        </div>
        <div className={`cd-live-phase phase-${effectivePhase}`}>
          <span className="cd-live-phase-dot" />
          {phaseLabel}
        </div>
      </div>

      <div className="cd-live-body">
        <div className="cd-live-code-pane">
          <div className="cd-live-code-eyebrow">
            <span className="mono dim">// generated by acme/agent — codex / sonnet 4.6</span>
            <span className="cd-live-code-meta mono dim">
              {fnName}.ts · {lineCount} lines
            </span>
          </div>
          <pre ref={codeRef} className="cd-live-code">
            <code>{displayCode}</code>
            {effectivePhase === "writing" ? (
              <span className="cd-live-cursor">▍</span>
            ) : null}
          </pre>
          <div className="cd-live-code-progress">
            <div
              className="cd-live-code-progress-fill"
              style={{ width: `${writeProgress * 100}%` }}
            />
          </div>
        </div>

        <aside className="cd-live-side">
          <div className="cd-live-side-block">
            <div className="cd-live-side-eyebrow">tensorlake holdout</div>
            <div className="cd-live-side-headline mono">
              {gateDone}
              <span className="dim"> / {gateTotal}</span>
            </div>
            <div className="cd-live-side-bar">
              <div
                className="cd-live-side-bar-fill"
                style={{ width: `${gatePct * 100}%` }}
              />
            </div>
            <div className="cd-live-side-row">
              <span className="dim">p50 latency</span>
              <span className="mono">{gateP50 ? gateP50.toFixed(1) : "—"} ms</span>
            </div>
            <div className="cd-live-side-row">
              <span className="dim">workers</span>
              <span className="mono">64 · phi-3-mini</span>
            </div>
            <div className="cd-live-side-row">
              <span className="dim">sandbox</span>
              <span className={`mono ${tensorlakeConnected ? "live" : ""}`}>
                {tensorlakeConnected ? "hot" : "cold"}
              </span>
            </div>
          </div>

          <div className="cd-live-side-block punch">
            <div className="cd-live-punch-eyebrow">the punchline</div>
            <div className="cd-live-punch-body">
              the agent is writing the function that{" "}
              <em>retires its own future calls.</em>
            </div>
            <div className="cd-live-punch-foot mono dim">
              codex's keys · acme's data · compile spends $0
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
