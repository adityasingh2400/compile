import { useEffect, useState } from "react";
import { useStore } from "../store.js";

/**
 * Persistent always-on chrome — the "running 7h 23m · fire #4 · $66,800
 * saved" badge that's visible on every phase. This is the single most
 * load-bearing visual for the Background Execution scoring axis: a judge
 * who lands on the URL mid-demo immediately sees the agent is uptime'd
 * and stateful.
 *
 * Reads `daemonState` from the store, which is mutated by the
 * `uptime_tick` event handler in daemon-stream.ts. When the daemon is
 * unreachable (`connected === false`), the badge gracefully shows a
 * "fixture mode" subline so we never lie about being live.
 */

function formatUptime(ms: number): string {
  if (ms < 1000) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (days > 0) return `${days}d ${hours}h ${mins}m`;
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function formatRelative(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function formatDollars(n: number): string {
  if (n >= 100_000) return `$${Math.round(n / 1000).toLocaleString()}k`;
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}k`;
  return `$${Math.round(n).toLocaleString()}`;
}

export function DaemonBadge(): JSX.Element {
  const daemon = useStore((s) => s.daemonState);
  const fallback = useStore((s) => s.fallbackBanner);
  const phi = useStore((s) => s.phiProgress);
  const inherited = useStore((s) => s.inheritedVaultItems);
  const [, force] = useState(0);

  // Tick the relative timestamps once a second so "12m ago" advances
  // without waiting for a server event.
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Auto-dismiss the fallback banner when its timer expires.
  useEffect(() => {
    if (!fallback) return;
    const ms = Math.max(0, fallback.expires_at - Date.now());
    const id = setTimeout(() => {
      const cur = useStore.getState().fallbackBanner;
      if (cur && cur.expires_at <= Date.now()) {
        useStore.getState().clearFallbackBanner();
      }
    }, ms);
    return () => clearTimeout(id);
  }, [fallback]);

  const lastFireRel = formatRelative(daemon.last_fire_ts);
  const live = daemon.connected;
  const retryCount = phi?.retry_count ?? 0;

  return (
    <div className={`daemon-badge ${live ? "live" : "fixture"}`}>
      <div className="daemon-badge-row top">
        <span className={`daemon-dot ${live ? "live" : "idle"}`} />
        <span className="daemon-strap">
          compile daemon ·{" "}
          <b>{live ? "live" : "fixture mode"}</b>
        </span>
      </div>
      <div className="daemon-badge-row meta">
        <span>running {formatUptime(daemon.uptime_ms)}</span>
        <span className="sep">·</span>
        <span>
          fire <b>#{daemon.fires_total}</b>
        </span>
        {lastFireRel ? (
          <>
            <span className="sep">·</span>
            <span>last {lastFireRel}</span>
          </>
        ) : null}
      </div>
      <div className="daemon-badge-row money">
        <b>{formatDollars(daemon.dollars_saved)}</b>
        <span className="lbl">saved</span>
        {retryCount > 0 ? (
          <span className="retries">+{retryCount} retry handled</span>
        ) : null}
      </div>
      {inherited.length > 0 ? (
        <div className="daemon-badge-row inherited">
          <span>↻ {inherited.length} fn{inherited.length === 1 ? "" : "s"} inherited</span>
          <span className="lbl">from prior sessions</span>
        </div>
      ) : null}
      {fallback ? (
        <div className={`daemon-fallback ${fallback.recovered ? "recovered" : "engaged"}`}>
          <b>{fallback.recovered ? "recovered" : "fallback engaged"}</b>
          <span> · {fallback.surface}</span>
          <div className="reason">{fallback.reason}</div>
        </div>
      ) : null}
    </div>
  );
}
