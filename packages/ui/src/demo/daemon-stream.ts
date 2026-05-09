import {
  DaemonEventSchema,
  VaultInheritedSchema,
  type DaemonEvent,
  type VaultInherited,
} from "@compile/schemas";
import { PHASE_INDEX } from "@compile/schemas";
import type { useStore } from "../store.js";

type GetState = typeof useStore.getState;

/**
 * Daemon stream consumer — drives the always-on demo.
 *
 * Wire format (locked with Ayaan):
 *   GET  /daemon/events?since=<isoTs>   →   newline-delimited DaemonEvent JSON
 *   GET  /daemon/vault/inherited        →   VaultInherited
 *
 * The UI polls the events endpoint every POLL_MS (250ms) and applies events
 * in order to the zustand store. When a phase-bearing event lands
 * (`cluster_threshold_hit`, `oracle_agreement`, `fire_complete`, etc.) the
 * store advances the phase — there is no other timeline. The judge sees the
 * agent decide; nobody clicks.
 *
 * Fallback ladder:
 *   1. VITE_COMPILE_DEMO_STATIC=1                        → fixture timeline
 *   2. Daemon unreachable for >COLD_START_GRACE_MS       → fixture timeline
 *   3. Daemon connects mid-run                           → take over
 */

const POLL_MS = 250;
const COLD_START_GRACE_MS = 5_000;

interface RunDaemonStreamOpts {
  /** Override default base URL. Defaults to "" (same-origin). */
  baseUrl?: string;
  /** Called once when the stream gives up reaching the daemon. The caller
   *  uses this to start the fixture timeline. */
  onUnreachable?: () => void;
  /** Called once when the first event lands, so the caller can cancel any
   *  fallback timeline that started during the grace window. */
  onConnected?: () => void;
}

function isStaticMode(): boolean {
  try {
    // Vite injects `import.meta.env` at build time. Cast through unknown
    // because the @types environment in this monorepo doesn't include
    // vite/client (would pull in too many ambient types).
    const env = (import.meta as unknown as { env?: Record<string, string> }).env;
    return env?.VITE_COMPILE_DEMO_STATIC === "1";
  } catch {
    return false;
  }
}

export interface DaemonStreamHandle {
  stop: () => void;
}

export function runDaemonStream(
  getState: GetState,
  opts: RunDaemonStreamOpts = {},
): DaemonStreamHandle {
  if (isStaticMode()) {
    opts.onUnreachable?.();
    return { stop: () => {} };
  }
  const base = opts.baseUrl ?? "";
  const startedAt = performance.now();
  let cancelled = false;
  let connected = false;
  let lastTs: string | null = null;

  void loadVaultInherited(base, getState).catch(() => {
    // best-effort; if vault fetch fails the cold-start frame falls back
    // to the baked DEMO_VAULT_EXISTING fixtures.
  });

  const poll = async (): Promise<void> => {
    if (cancelled) return;
    try {
      const url = `${base}/daemon/events${lastTs ? `?since=${encodeURIComponent(lastTs)}` : ""}`;
      const res = await fetch(url, { headers: { accept: "application/x-ndjson" } });
      if (!res.ok) throw new Error(`daemon http ${res.status}`);
      const text = await res.text();
      const lines = text.split("\n").filter((l) => l.trim().length > 0);
      for (const line of lines) {
        try {
          const event = DaemonEventSchema.parse(JSON.parse(line));
          applyEvent(event, getState);
          lastTs = event.ts;
          if (!connected) {
            connected = true;
            opts.onConnected?.();
          }
        } catch (err) {
          // single bad line shouldn't kill the stream
          // eslint-disable-next-line no-console
          console.warn("daemon: skipping bad event line", err);
        }
      }
    } catch {
      const elapsed = performance.now() - startedAt;
      if (!connected && elapsed > COLD_START_GRACE_MS) {
        // Daemon hasn't responded for the grace window; surrender to
        // the fixture timeline. We don't *stop* polling — if the daemon
        // comes back up later we'll still take over.
        cancelled = true;
        opts.onUnreachable?.();
        return;
      }
    }
    if (!cancelled) {
      setTimeout(poll, POLL_MS);
    }
  };
  void poll();

  return {
    stop: () => {
      cancelled = true;
    },
  };
}

async function loadVaultInherited(
  base: string,
  getState: GetState,
): Promise<void> {
  const res = await fetch(`${base}/daemon/vault/inherited`);
  if (!res.ok) return;
  const json: unknown = await res.json();
  const parsed: VaultInherited = VaultInheritedSchema.parse(json);
  getState().setInheritedVaultItems(parsed.items);
}

/**
 * Map a daemon event onto store mutations + phase transitions.
 * Single source of truth for "what does the UI do when X fires."
 */
function applyEvent(event: DaemonEvent, getState: GetState): void {
  const s = getState();
  const advance = (phase: keyof typeof PHASE_INDEX) => {
    if (s.manualOverride) return;
    s.setPhase({
      run_id: s.run_id,
      phase,
      page_index: PHASE_INDEX[phase],
      started_at: new Date(s.startedAt).toISOString(),
      updated_at: new Date().toISOString(),
    });
  };

  switch (event.kind) {
    case "uptime_tick":
      s.setDaemonState({
        uptime_ms: event.uptime_ms,
        fires_total: event.fires_total,
        dollars_saved: event.dollars_saved,
        last_fire_ts: event.last_fire_ts ?? null,
        connected: true,
        last_seen_ts: event.ts,
      });
      break;

    case "cluster_observed":
      // Pre-fire; the daemon is just watching. No phase advance.
      s.setObservedCluster({
        cluster_id: event.cluster_id,
        signature: event.signature,
        sample_count: event.sample_count,
        threshold: event.threshold,
      });
      break;

    case "cluster_threshold_hit":
      s.setActiveCluster({
        cluster_id: event.cluster_id,
        signature: event.signature,
        n_samples: event.n_samples,
      });
      s.setAgentLoopBeat("plan");
      if (event.decision === "vault_hit") {
        advance("vault_write");
      } else {
        advance("stress_test");
      }
      break;

    case "vault_hit":
      s.setVaultHit({
        cluster_id: event.cluster_id,
        inherited_from_session: event.inherited_from_session,
        prior_compiled_at: event.prior_compiled_at,
        function_name: event.function_name,
        routed_in_ms: event.routed_in_ms,
        dollars_saved_this_hit: event.dollars_saved_this_hit,
      });
      break;

    case "sandbox_spawn_start":
      s.setAgentLoopBeat("execute");
      s.setActiveSandbox({
        sandbox_id: event.sandbox_id,
        image: event.image,
        worker_count: event.worker_count,
      });
      // Reset phi progress to 0/100k so the constellation-hero meters
      // animate cleanly from zero on every new fire. Without this they
      // would start at the previous fire's terminal value (100k) and only
      // tick down to 3k on the first phi_tick, which reads as a jump cut.
      s.setPhiProgress({
        sandbox_id: event.sandbox_id,
        cluster_id: event.cluster_id,
        calls_done: 0,
        calls_total: 100_000,
        throughput_per_sec: 0,
        retry_count: 0,
      });
      break;

    case "phi_tick":
      s.setPhiProgress({
        sandbox_id: event.sandbox_id,
        cluster_id: event.cluster_id,
        calls_done: event.calls_done,
        calls_total: event.calls_total,
        throughput_per_sec: event.throughput_per_sec,
        retry_count: event.retry_count,
      });
      break;

    case "oracle_agreement":
      s.setAgentLoopBeat("reflect");
      s.setOracleAgreement({
        score: event.score,
        threshold: event.threshold,
        decision: event.decision,
        oracle_samples: event.oracle_samples,
      });
      if (event.decision === "commit") {
        advance("agent_writing");
      } else {
        // Decline path — visible self-aware failure. Stay on stress_test
        // long enough for the operator to read it, then advance to result
        // with a "rolled back" framing.
        setTimeout(() => {
          if (!getState().manualOverride) {
            advance("result");
          }
        }, 3500);
      }
      break;

    case "fallback_engaged":
      s.setAgentLoopBeat("recover");
      s.flashFallbackBanner({
        surface: event.surface,
        reason: event.reason,
        recovered: event.recovered,
        ts: event.ts,
      });
      break;

    case "fire_complete":
      s.setLastFire({
        cluster_id: event.cluster_id,
        total_duration_ms: event.total_duration_ms,
        dollars_saved_this_fire: event.dollars_saved_this_fire,
        vault_key: event.vault_key,
        tier: event.tier,
        fallback_count: event.fallback_count,
      });
      advance("result");
      break;
  }
}
