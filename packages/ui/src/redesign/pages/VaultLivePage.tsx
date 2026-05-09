/**
 * VaultLivePage — Page 5.
 *
 * "Two Shelves" layout: positive vault on the left (committed cached
 * functions with hit counts, savings, tier), negative vault on the right
 * (declined patterns with reasons + retry policies). A function flying
 * in from page 4 is shown as a glowing in-flight card while a
 * `vault_write_start` is pending.
 *
 * Drives off `useRedesignStore().live.vault` — populated by the daemon's
 * `vault_write_start` and `vault_write_committed` events.
 */

import { useEffect, useMemo, useState } from "react";
import {
  useRedesignStore,
  type LiveVaultEntry,
} from "../../data/redesign-store.js";
import type { Workflow } from "../../data/workflows.js";

// ── seed entries so the shelf isn't empty on first paint ──────────────
// These are baked from the prewarmed snapshot (Acme demo seed). The
// daemon's first vault_write_committed events will join these on the
// shelf, then push them down as new entries land on top.
const SEED_POSITIVE: LiveVaultEntry[] = [
  {
    function_id: "fn_classifyMessageIntent_seed",
    function_name: "classifyMessageIntent",
    cluster_id: "cluster_message_intent",
    kind: "positive",
    tier: "tier_1",
    hits_per_day: 4_240,
    dollars_saved_per_day: 87,
    committed_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    function_id: "fn_scoreMessageUrgency_seed",
    function_name: "scoreMessageUrgency",
    cluster_id: "cluster_message_urgency",
    kind: "positive",
    tier: "tier_1",
    hits_per_day: 2_810,
    dollars_saved_per_day: 51,
    committed_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    function_id: "fn_scoreRelationshipWarmth_seed",
    function_name: "scoreRelationshipWarmth",
    cluster_id: "cluster_relationship_warmth",
    kind: "positive",
    tier: "tier_1",
    hits_per_day: 1_180,
    dollars_saved_per_day: 34,
    committed_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    function_id: "fn_extractEventFromMessage_seed",
    function_name: "extractEventFromMessage",
    cluster_id: "cluster_event_extract",
    kind: "positive",
    tier: "tier_2",
    hits_per_day: 920,
    dollars_saved_per_day: 24,
    committed_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

const SEED_NEGATIVE: LiveVaultEntry[] = [
  {
    function_id: "fn_fuzzy_intent_classifier_seed",
    function_name: "fuzzy_intent_classifier",
    cluster_id: "cluster_fuzzy_intent_classifier",
    kind: "negative",
    reason: "oracle_disagreement",
    committed_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    function_id: "fn_vague_status_check_seed",
    function_name: "vague_status_check",
    cluster_id: "cluster_vague_status_check",
    kind: "negative",
    reason: "high_entropy",
    committed_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    function_id: "fn_creative_rewrite_seed",
    function_name: "creative_rewrite",
    cluster_id: "cluster_creative_rewrite",
    kind: "negative",
    reason: "non_deterministic",
    committed_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
  },
];

const REASON_LABEL: Record<string, string> = {
  oracle_disagreement: "oracle disagreement",
  high_entropy: "high entropy",
  low_confidence: "low confidence",
  schema_unstable: "schema unstable",
  non_deterministic: "non-deterministic",
};

const RETRY_LABEL: Record<string, string> = {
  oracle_disagreement: "retry in 30d",
  high_entropy: "never retry",
  low_confidence: "retry in 7d",
  schema_unstable: "retry in 14d",
  non_deterministic: "never retry",
};

function relativeWhen(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

// ──────────────────────────────────────────────────────────────────────

function PositiveCard({
  entry,
  isFresh,
  index,
}: {
  entry: LiveVaultEntry;
  isFresh: boolean;
  index: number;
}): JSX.Element {
  return (
    <div
      className={`vlt-card positive ${isFresh ? "fresh" : ""}`}
      style={{ ["--i" as never]: index } as React.CSSProperties}
    >
      <div className="vlt-card-head">
        <span className="vlt-card-check">✓</span>
        <span className="vlt-card-fn mono">{entry.function_name}</span>
        {entry.tier ? (
          <span className={`tier-tag ${entry.tier}`}>
            {entry.tier === "tier_1" ? "T1" : entry.tier === "tier_2" ? "T2" : "T3"}
          </span>
        ) : null}
      </div>
      <div className="vlt-card-stats">
        <div className="vlt-card-stat">
          <span className="num mono">
            {(entry.hits_per_day ?? 0).toLocaleString()}
          </span>
          <span className="lbl">hits/day</span>
        </div>
        <div className="vlt-card-stat">
          <span className="num mono">
            ${(entry.dollars_saved_per_day ?? 0).toFixed(0)}
          </span>
          <span className="lbl">/day saved</span>
        </div>
      </div>
      <div className="vlt-card-foot mono dim">
        committed {relativeWhen(entry.committed_at)}
      </div>
    </div>
  );
}

function NegativeCard({
  entry,
  index,
}: {
  entry: LiveVaultEntry;
  index: number;
}): JSX.Element {
  const reason = entry.reason ?? "unknown";
  return (
    <div
      className="vlt-card negative"
      style={{ ["--i" as never]: index } as React.CSSProperties}
    >
      <div className="vlt-card-head">
        <span className="vlt-card-cross">✗</span>
        <span className="vlt-card-fn mono">{entry.function_name}</span>
      </div>
      <div className="vlt-card-reason">
        <span className="dim">reason</span>
        <span className="mono">{REASON_LABEL[reason] ?? reason}</span>
      </div>
      <div className="vlt-card-retry">
        <span className="dim">policy</span>
        <span className="mono">{RETRY_LABEL[reason] ?? "—"}</span>
      </div>
      <div className="vlt-card-foot mono dim">
        declined {relativeWhen(entry.committed_at)}
      </div>
    </div>
  );
}

export function VaultLivePage({ workflow }: { workflow: Workflow }): JSX.Element {
  const liveVault = useRedesignStore((s) => s.live.vault);
  const inFlight = liveVault.in_flight;

  // Merge daemon-streamed entries with seeded ones, daemon-first.
  const positive = useMemo(() => {
    const seenFns = new Set(liveVault.positive.map((e) => e.function_name));
    return [
      ...liveVault.positive,
      ...SEED_POSITIVE.filter((s) => !seenFns.has(s.function_name)),
    ];
  }, [liveVault.positive]);

  const negative = useMemo(() => {
    const seenFns = new Set(liveVault.negative.map((e) => e.function_name));
    return [
      ...liveVault.negative,
      ...SEED_NEGATIVE.filter((s) => !seenFns.has(s.function_name)),
    ];
  }, [liveVault.negative]);

  const totalDailySaved = positive.reduce(
    (acc, e) => acc + (e.dollars_saved_per_day ?? 0),
    0,
  );

  // ── Classification reveal sequence ────────────────────────────────
  // On mount: shelves are visible but empty. Functions appear one-by-one
  // in a center stage, pulse "classifying", then slot into their shelf.
  // Once each settles, we advance to the next.
  //
  // queue interleaves positives and negatives so judges see both shelves
  // populating in turn instead of one shelf filling first.
  const classifyQueue = useMemo(() => {
    const queue: { entry: LiveVaultEntry; shelf: "positive" | "negative" }[] = [];
    const p = positive.map((e) => ({ entry: e, shelf: "positive" as const }));
    const n = negative.map((e) => ({ entry: e, shelf: "negative" as const }));
    let pi = 0, ni = 0;
    // Pattern: P, N, P, P, N, P, N, P  → roughly proportional to ~4:3
    const pattern = ["positive", "negative", "positive", "positive", "negative", "positive", "negative", "positive"];
    for (const want of pattern) {
      if (want === "positive" && pi < p.length) queue.push(p[pi++]!);
      else if (want === "negative" && ni < n.length) queue.push(n[ni++]!);
    }
    while (pi < p.length) queue.push(p[pi++]!);
    while (ni < n.length) queue.push(n[ni++]!);
    return queue;
  }, [positive, negative]);

  // Step = number of items already settled. classifyQueue[step] = current.
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<"appearing" | "pulsing" | "settling">("appearing");

  useEffect(() => {
    if (step >= classifyQueue.length) return;
    // Sequence per item:
    //   appearing  (~600ms) — fade in + scale up in center stage
    //   pulsing    (~700ms) — "classifying…" beat
    //   settling   (~600ms) — center fades while shelf card fades in
    // total ~1.9s per item
    setPhase("appearing");
    const t1 = setTimeout(() => setPhase("pulsing"), 600);
    const t2 = setTimeout(() => setPhase("settling"), 1300);
    const t3 = setTimeout(() => setStep((s) => s + 1), 1900);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [step, classifyQueue.length]);

  const settledIds = useMemo(
    () => new Set(classifyQueue.slice(0, step).map((q) => q.entry.function_id)),
    [classifyQueue, step],
  );
  const settlingThisTick =
    phase === "settling" && step < classifyQueue.length
      ? classifyQueue[step]!.entry.function_id
      : null;
  const visiblePositive = positive.filter(
    (e) => settledIds.has(e.function_id) || e.function_id === settlingThisTick,
  );
  const visibleNegative = negative.filter(
    (e) => settledIds.has(e.function_id) || e.function_id === settlingThisTick,
  );

  // Center-stage entry — null when sequence has finished.
  const currentClassifying =
    step < classifyQueue.length ? classifyQueue[step]! : null;

  return (
    <div className="vlt-live">
      <div className="vlt-live-header">
        <div className="vlt-live-title">
          <span className="vlt-live-mark">●</span>
          <h2>the vault</h2>
          <span className="dim">— what we cache, and what we won't.</span>
        </div>
        <div className="vlt-live-totals">
          <div className="vlt-live-total">
            <span className="num mono">{visiblePositive.length}</span>
            <span className="lbl">positive</span>
          </div>
          <div className="vlt-live-total">
            <span className="num mono">{visibleNegative.length}</span>
            <span className="lbl">negative</span>
          </div>
          <div className="vlt-live-total">
            <span className="num mono">${totalDailySaved.toFixed(0)}</span>
            <span className="lbl">/day saved</span>
          </div>
        </div>
      </div>

      <div className="vlt-live-shelves">
        <section className="vlt-live-shelf positive-shelf">
          <header className="vlt-live-shelf-head">
            <span className="vlt-live-shelf-eyebrow">positive vault · nia</span>
            <span className="vlt-live-shelf-sub mono dim">
              committed cached functions
            </span>
          </header>
          <div className="vlt-live-cards">
            {visiblePositive.map((e, idx) => (
              <PositiveCard
                key={e.function_id}
                entry={e}
                isFresh={e.function_id === settlingThisTick}
                index={idx}
              />
            ))}
            {inFlight && inFlight.kind === "positive" ? (
              <div className="vlt-card positive in-flight">
                <div className="vlt-card-head">
                  <span className="vlt-card-check">✓</span>
                  <span className="vlt-card-fn mono">writing…</span>
                </div>
                <div className="vlt-card-foot mono dim">flying in from gate…</div>
              </div>
            ) : null}
          </div>
        </section>

        <div className="vlt-live-divider" />

        <section className="vlt-live-shelf negative-shelf">
          <header className="vlt-live-shelf-head">
            <span className="vlt-live-shelf-eyebrow">negative vault</span>
            <span className="vlt-live-shelf-sub mono dim">
              patterns we won't retry
            </span>
          </header>
          <div className="vlt-live-cards">
            {visibleNegative.map((e, idx) => (
              <NegativeCard
                key={e.function_id}
                entry={e}
                index={idx}
              />
            ))}
            {inFlight && inFlight.kind === "negative" ? (
              <div className="vlt-card negative in-flight">
                <div className="vlt-card-head">
                  <span className="vlt-card-cross">✗</span>
                  <span className="vlt-card-fn mono">declining…</span>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        {/* Center classification stage — the function being decided right now. */}
        {currentClassifying ? (
          <div
            className={`vlt-classify-stage phase-${phase} target-${currentClassifying.shelf}`}
          >
            <div className="vlt-classify-card">
              <div className="vlt-classify-head">
                <span className="vlt-classify-fn mono">
                  {currentClassifying.entry.function_name}
                </span>
              </div>
              <div className="vlt-classify-status mono">
                {phase === "appearing"
                  ? "incoming…"
                  : phase === "pulsing"
                    ? currentClassifying.shelf === "positive"
                      ? "oracle ✓ schema stable · committing"
                      : `oracle ✗ ${REASON_LABEL[currentClassifying.entry.reason ?? ""] ?? "declined"}`
                    : currentClassifying.shelf === "positive"
                      ? "→ positive vault"
                      : "→ negative vault"}
              </div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="vlt-live-foot">
        <span className="dim">we don't pretend everything codifies.</span>
        <span className="mono">
          {negative.length} patterns in negative vault · never re-attempted unless
          input distribution shifts
        </span>
      </div>
    </div>
  );
}
