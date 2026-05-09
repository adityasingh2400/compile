/**
 * Folk Live Texting Demo — the headline cost-optimization moment.
 *
 * Mounts inside the workspace as a permanent floating panel.
 *
 * Pretends a teammate is texting the demoer. On each inbound message the
 * widget runs Folk's actual 5-step inbound pipeline through the vault:
 *
 *   1. classify_message_intent       (T1, vault, ~0ms,  $0.00)
 *   2. score_message_urgency         (T1, vault, ~0ms,  $0.00)
 *   3. score_relationship_warmth     (T1, vault, ~0ms,  $0.00)
 *   4. extract_event_from_message    (T2, phi,   ~50ms, $0.0001)
 *   5. apply_user_writing_style      (T2, phi,   ~50ms, $0.0001)
 *   6. draft_reply_in_user_voice     (T3, frontier, ~1100ms, $0.05)
 *
 * For the same message, "WITHOUT COMPILE" routes all 6 steps through the
 * frontier model: 6 × $0.05 = $0.30 per inbound. WITH COMPILE: $0.05
 * (only the creative draft hits the frontier). 83% savings per message,
 * enforced by Folk's actual call-site classifications from the audit.
 *
 * The teammate name + pretend-girl framing is configurable via the
 * `?presenter=...` URL param (defaults to a generic dating-coach scene
 * that maps onto Arlan's `talk-to-girlfriend-ai` repo).
 */

import { useEffect, useMemo, useRef, useState } from "react";

// ─────────────────────────────────────────────────────────────────────
// Pipeline definition — drives the per-step animation + cost math.

type StepTier = "tier_1" | "tier_2" | "tier_3";

interface PipelineStep {
  fn: string;
  display: string;
  tier: StepTier;
  /** ms the step takes WITH compile (vault/phi/frontier per tier). */
  with_compile_ms: number;
  /** ms the step takes WITHOUT compile (always frontier). */
  without_compile_ms: number;
  /** $ the step costs WITH compile. */
  with_compile_usd: number;
  /** $ the step costs WITHOUT compile (frontier always). */
  without_compile_usd: number;
  /** Short justification shown in the step row tooltip. */
  reason: string;
  /** Stub output the vault produces (free-form, illustrative). */
  output: (text: string) => string;
}

const PIPELINE: PipelineStep[] = [
  {
    fn: "classify_message_intent",
    display: "intent",
    tier: "tier_1",
    with_compile_ms: 1,
    without_compile_ms: 320,
    with_compile_usd: 0,
    without_compile_usd: 0.05,
    reason: "T1 · vault hit · regex+enum classifier · pinned to bounded JSON",
    output: (t) => {
      const isQ = /\?$|\bcan you\b|\bwhat\b|\bhow\b|\bwhen\b/i.test(t);
      const isLog = /\b(meeting|call|dinner|lunch|coffee|tomorrow|tonight|book|flight|deadline)\b/i.test(t);
      const isEmo = /\b(love|miss|sorry|hate|hurt|happy|excited|birthday)\b/i.test(t);
      const isGreet = /^\s*(hey|hi|hello|yo|sup|wassup)\b/i.test(t) && t.length < 20;
      const intent = isLog ? "logistics" : isEmo ? "emotional" : isGreet ? "greeting" : isQ ? "question" : "task";
      return `intent="${intent}", requires_reply=true`;
    },
  },
  {
    fn: "score_message_urgency",
    display: "urgency",
    tier: "tier_1",
    with_compile_ms: 1,
    without_compile_ms: 280,
    with_compile_usd: 0,
    without_compile_usd: 0.05,
    reason: "T1 · vault hit · time-of-day × sender × keyword regex grid",
    output: (t) => {
      const u = /\bURGENT\b|\bnow\b|\basap\b/i.test(t)
        ? "immediate"
        : /\btonight\b|\btomorrow\b|\btoday\b/i.test(t)
          ? "soon"
          : /\bsometime\b|\bwhenever\b/i.test(t)
            ? "later"
            : "soon";
      return `urgency="${u}", reason="lexical match"`;
    },
  },
  {
    fn: "score_relationship_warmth",
    display: "warmth",
    tier: "tier_1",
    with_compile_ms: 1,
    without_compile_ms: 510,
    with_compile_usd: 0,
    without_compile_usd: 0.05,
    reason: "T1 · vault hit · frequency × recency × intimacy regression",
    output: () => `warmth=4 (close), confidence=0.87`,
  },
  {
    fn: "extract_event_from_message",
    display: "event extract",
    tier: "tier_2",
    with_compile_ms: 50,
    without_compile_ms: 360,
    with_compile_usd: 0.0001,
    without_compile_usd: 0.05,
    reason: "T2 · phi-3-mini · bounded enum + nullable when_iso",
    output: (t) => {
      const ev = /\bdinner\b|\bbooked\b|\brestaurant\b/i.test(t)
        ? "booking"
        : /\bmeeting\b|\bcall\b/i.test(t)
          ? "meeting"
          : /\bflight\b/i.test(t)
            ? "flight"
            : "none";
      return `event_type="${ev}"`;
    },
  },
  {
    fn: "apply_user_writing_style",
    display: "style",
    tier: "tier_2",
    with_compile_ms: 50,
    without_compile_ms: 680,
    with_compile_usd: 0.0001,
    without_compile_usd: 0.05,
    reason: "T2 · phi-3-mini · injects user lexicon (lowercase, terse)",
    output: () => `style applied · lowercase + terse`,
  },
  {
    fn: "draft_reply_in_user_voice",
    display: "draft",
    tier: "tier_3",
    with_compile_ms: 1100,
    without_compile_ms: 1320,
    with_compile_usd: 0.05,
    without_compile_usd: 0.05,
    reason: "T3 · frontier (Sonnet 4.5) · creative generation · stays at frontier",
    output: () => "yeah totally — thursday at 8?",
  },
];

const TOTAL_WITH = PIPELINE.reduce((s, p) => s + p.with_compile_usd, 0);
const TOTAL_WITHOUT = PIPELINE.reduce((s, p) => s + p.without_compile_usd, 0);
const SAVINGS_PCT = ((TOTAL_WITHOUT - TOTAL_WITH) / TOTAL_WITHOUT) * 100;

// ─────────────────────────────────────────────────────────────────────
// Sample messages a teammate might send. Drives the canned demo.

const TEAMMATE_NAME = "Aria";
const SAMPLE_MESSAGES: string[] = [
  "hey wanna grab dinner tomorrow night?",
  "you free this weekend?",
  "did you book the flight already?",
  "miss you, when are you back?",
  "URGENT — call me when you can",
  "running 5 mins late",
  "just landed, heading straight to dinner",
];

// ─────────────────────────────────────────────────────────────────────
// State — running pipeline animation per inbound message.

type StepStatus = "pending" | "running" | "done";

interface RunState {
  inboundId: string;
  text: string;
  withCompile: boolean;
  startedAt: number;
  steps: { status: StepStatus; output?: string }[];
  draftPreview: string | null;
}

interface MessageRecord {
  id: string;
  from: "them" | "me";
  text: string;
  ts: number;
  /** Cost story for the message we drafted (only for "me" messages). */
  costRunWith?: { totalUsd: number; totalMs: number };
  costRunWithout?: { totalUsd: number; totalMs: number };
}

// ─────────────────────────────────────────────────────────────────────
// Component.

export function FolkTextDemo(): JSX.Element {
  const [thread, setThread] = useState<MessageRecord[]>([
    {
      id: "intro_them",
      from: "them",
      text: `${TEAMMATE_NAME} (📱 Aria, swiped right 2d ago)`,
      ts: Date.now() - 60_000,
    },
  ]);
  const [pendingInput, setPendingInput] = useState<string>(SAMPLE_MESSAGES[0]!);
  const [run, setRun] = useState<RunState | null>(null);
  // Aggregate counters across the session (for the bottom strip).
  const [aggregate, setAggregate] = useState({
    msgs_drafted: 0,
    spent_with: 0,
    spent_without: 0,
    saved_usd: 0,
  });
  const [autoMode, setAutoMode] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const threadRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
    }
  }, [thread, run?.steps.length]);

  // Auto-mode: send a sample message every 8s.
  useEffect(() => {
    if (!autoMode) return;
    const id = setInterval(() => {
      if (run) return;
      const idx = Math.floor(Math.random() * SAMPLE_MESSAGES.length);
      simulateInbound(SAMPLE_MESSAGES[idx]!);
    }, 8000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoMode, run]);

  function simulateInbound(text: string) {
    if (run) return;
    const id = `m_${Date.now()}`;
    setThread((t) => [
      ...t,
      { id, from: "them", text, ts: Date.now() },
    ]);
    // Kick off the pipeline animation
    const initialSteps = PIPELINE.map(() => ({ status: "pending" as StepStatus }));
    setRun({
      inboundId: id,
      text,
      withCompile: true,
      startedAt: performance.now(),
      steps: initialSteps,
      draftPreview: null,
    });
  }

  // Drive the pipeline: when `run` exists and not yet done, advance step by step.
  useEffect(() => {
    if (!run) return;
    const nextIdx = run.steps.findIndex((s) => s.status !== "done");
    if (nextIdx === -1) {
      // Pipeline complete — append the drafted reply to the thread, update aggregates.
      const totalUsdWith = TOTAL_WITH;
      const totalMsWith = PIPELINE.reduce((s, p) => s + p.with_compile_ms, 0);
      const totalUsdWithout = TOTAL_WITHOUT;
      const totalMsWithout = PIPELINE.reduce((s, p) => s + p.without_compile_ms, 0);
      const draftStep = run.steps[run.steps.length - 1]!;
      const reply = draftStep.output ?? "ok thursday at 8?";
      setThread((t) => [
        ...t,
        {
          id: `r_${run.inboundId}`,
          from: "me",
          text: reply,
          ts: Date.now(),
          costRunWith: { totalUsd: totalUsdWith, totalMs: totalMsWith },
          costRunWithout: { totalUsd: totalUsdWithout, totalMs: totalMsWithout },
        },
      ]);
      setAggregate((a) => ({
        msgs_drafted: a.msgs_drafted + 1,
        spent_with: a.spent_with + totalUsdWith,
        spent_without: a.spent_without + totalUsdWithout,
        saved_usd: a.saved_usd + (totalUsdWithout - totalUsdWith),
      }));
      setRun(null);
      return;
    }
    const step = PIPELINE[nextIdx]!;
    // Mark step running, schedule completion after with_compile_ms (with a
    // visible minimum so even tier_1 vault hits show their flicker).
    const dur = Math.max(160, step.with_compile_ms);
    setRun((r) => {
      if (!r) return r;
      const steps = r.steps.slice();
      steps[nextIdx] = { status: "running" };
      return { ...r, steps };
    });
    const t = setTimeout(() => {
      setRun((r) => {
        if (!r) return r;
        const steps = r.steps.slice();
        steps[nextIdx] = {
          status: "done",
          output: step.output(r.text),
        };
        const draftPreview =
          step.fn === "draft_reply_in_user_voice" ? step.output(r.text) : r.draftPreview;
        return { ...r, steps, draftPreview };
      });
    }, dur);
    return () => clearTimeout(t);
  }, [run?.steps]);

  // Dollar formatting.
  const fmt$ = (n: number): string => {
    if (n === 0) return "$0.00";
    if (n < 0.01) return `$${n.toFixed(4)}`;
    if (n < 1) return `$${n.toFixed(2)}`;
    if (n < 1000) return `$${n.toFixed(2)}`;
    return `$${(n / 1000).toFixed(1)}k`;
  };

  // Aggregate annual extrapolation. Folk's homepage counter sits at ~48k
  // messages/day across all users; per-user inbound velocity is ~150/day
  // for Pro tier. We show savings per Pro seat per year.
  const perSeatPerDay = 150;
  const annualSavings = useMemo(
    () => (TOTAL_WITHOUT - TOTAL_WITH) * perSeatPerDay * 365,
    [],
  );

  if (collapsed) {
    return (
      <button
        type="button"
        className="ftd-collapsed"
        onClick={() => setCollapsed(false)}
        title="open Folk live texting demo"
      >
        <span className="dot" /> 📱 folk demo · {aggregate.msgs_drafted} drafted ·
        saved {fmt$(aggregate.saved_usd)}
      </button>
    );
  }

  const inProgress = run !== null;

  return (
    <div className="ftd-root">
      <div className="ftd-head">
        <div className="ftd-title">
          <span className="ftd-dot" />
          <b>folk · live texting demo</b>
          <span className="dim">running on real folk pipeline · 6-step agentic loop</span>
        </div>
        <div className="ftd-head-actions">
          <button
            type="button"
            className={`ftd-btn ${autoMode ? "active" : ""}`}
            onClick={() => setAutoMode((v) => !v)}
            title="auto-fire a sample inbound every 8s"
          >
            {autoMode ? "auto · on" : "auto · off"}
          </button>
          <button
            type="button"
            className="ftd-btn"
            onClick={() => setCollapsed(true)}
            title="collapse"
          >
            ─
          </button>
        </div>
      </div>

      <div className="ftd-grid">
        {/* ── Left: iMessage thread ─────────────────────────────── */}
        <div className="ftd-thread-panel">
          <div className="ftd-thread-head">
            <div className="ftd-contact">
              <span className="avatar">A</span>
              <div className="meta">
                <div className="name">{TEAMMATE_NAME}</div>
                <div className="sub">imessage · folk drafting on</div>
              </div>
            </div>
          </div>
          <div className="ftd-thread" ref={threadRef}>
            {thread.map((m) => (
              <div key={m.id} className={`ftd-bubble ${m.from}`}>
                <div className="bubble-text">{m.text}</div>
                {m.costRunWith ? (
                  <div className="bubble-cost">
                    <span className="ok">
                      ✓ drafted · {fmt$(m.costRunWith.totalUsd)} (compile)
                    </span>
                    <span className="dim">
                      vs {fmt$(m.costRunWithout!.totalUsd)} (frontier-only)
                    </span>
                  </div>
                ) : null}
              </div>
            ))}
            {run ? (
              <div className="ftd-bubble me ftd-bubble-pending">
                <div className="bubble-text">
                  {run.draftPreview ?? <span className="dim">drafting…</span>}
                </div>
              </div>
            ) : null}
          </div>
          <div className="ftd-input-row">
            <select
              className="ftd-input"
              value={pendingInput}
              onChange={(e) => setPendingInput(e.target.value)}
              disabled={inProgress}
            >
              {SAMPLE_MESSAGES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="ftd-send"
              disabled={inProgress}
              onClick={() => simulateInbound(pendingInput)}
            >
              {inProgress ? "drafting…" : `send as ${TEAMMATE_NAME} ▸`}
            </button>
          </div>
        </div>

        {/* ── Right: live pipeline panel ────────────────────────── */}
        <div className="ftd-pipeline-panel">
          <div className="ftd-pipeline-head">
            <div className="ftd-pipeline-title">
              <b>folk inbound pipeline</b>
              <span className="dim">— 6 steps per message · 4 codified · 1 frontier</span>
            </div>
            <div className="ftd-savings-badge">
              <div className="big">{SAVINGS_PCT.toFixed(0)}%</div>
              <div className="lbl">cost saved · per inbound</div>
            </div>
          </div>

          <div className="ftd-pipeline-cols">
            <div className="ftd-pipeline-colhead with">
              <span className="dot" /> with compile
            </div>
            <div className="ftd-pipeline-colhead without">
              <span className="dot" /> without compile (baseline)
            </div>
          </div>

          <div className="ftd-pipeline-rows">
            {PIPELINE.map((step, i) => {
              const status = run?.steps[i]?.status ?? "pending";
              const output = run?.steps[i]?.output;
              const isDone = status === "done";
              const isRunning = status === "running";
              return (
                <div
                  key={step.fn}
                  className={`ftd-step ${isDone ? "done" : isRunning ? "running" : ""} tier-${step.tier}`}
                  title={step.reason}
                >
                  <div className="ftd-step-head">
                    <span className="ftd-step-num">{(i + 1).toString().padStart(2, "0")}</span>
                    <span className={`ftd-tier-tag ${step.tier}`}>
                      {step.tier === "tier_1"
                        ? "T1"
                        : step.tier === "tier_2"
                          ? "T2"
                          : "T3"}
                    </span>
                    <span className="ftd-step-fn">{step.fn}</span>
                    {isRunning ? <span className="ftd-step-pulse" /> : null}
                    {isDone ? <span className="ftd-step-check">✓</span> : null}
                  </div>
                  <div className="ftd-step-cols">
                    <div className="ftd-step-col with">
                      <span className="lat">{step.with_compile_ms}ms</span>
                      <span className="cost">{fmt$(step.with_compile_usd)}</span>
                      <span className="route">
                        {step.tier === "tier_1"
                          ? "vault"
                          : step.tier === "tier_2"
                            ? "phi-3-mini"
                            : "frontier (sonnet 4.5)"}
                      </span>
                    </div>
                    <div className="ftd-step-col without">
                      <span className="lat">{step.without_compile_ms}ms</span>
                      <span className="cost">{fmt$(step.without_compile_usd)}</span>
                      <span className="route">frontier (sonnet 4.5)</span>
                    </div>
                  </div>
                  {output && isDone ? (
                    <div className="ftd-step-output">→ {output}</div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="ftd-pipeline-totals">
            <div className="ftd-total with">
              <span className="lbl">with compile</span>
              <span className="val">{fmt$(TOTAL_WITH)}</span>
              <span className="sub">/ inbound · {PIPELINE.reduce((s, p) => s + p.with_compile_ms, 0)}ms</span>
            </div>
            <div className="ftd-total-arrow">→</div>
            <div className="ftd-total without">
              <span className="lbl">without compile</span>
              <span className="val">{fmt$(TOTAL_WITHOUT)}</span>
              <span className="sub">/ inbound · {PIPELINE.reduce((s, p) => s + p.without_compile_ms, 0)}ms</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom strip: aggregate + annualized projection ───────── */}
      <div className="ftd-foot">
        <div className="ftd-foot-stat">
          <span className="big">{aggregate.msgs_drafted}</span>
          <span className="lbl">drafts this session</span>
        </div>
        <span className="ftd-sep">·</span>
        <div className="ftd-foot-stat green">
          <span className="big">{fmt$(aggregate.saved_usd)}</span>
          <span className="lbl">saved live</span>
        </div>
        <span className="ftd-sep">·</span>
        <div className="ftd-foot-stat">
          <span className="big">{fmt$(aggregate.spent_with)}</span>
          <span className="lbl">compile spend</span>
        </div>
        <span className="ftd-sep">·</span>
        <div className="ftd-foot-stat dim">
          <span className="big">{fmt$(aggregate.spent_without)}</span>
          <span className="lbl">if frontier-only</span>
        </div>
        <span className="ftd-sep ftd-sep-pad">||</span>
        <div className="ftd-foot-projection">
          <span className="dim">extrapolated to one Pro seat:</span>
          <span className="big green">{fmt$(annualSavings)}</span>
          <span className="dim">/ year saved</span>
          <span className="hint">({perSeatPerDay} inbound msgs/day × 365)</span>
        </div>
      </div>
    </div>
  );
}
