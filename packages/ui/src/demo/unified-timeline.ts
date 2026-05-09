/**
 * Unified-dashboard timeline driver.
 *
 * Auto-advances the canvas through the four stages, with per-stage
 * dwells tuned for a ~70-second end-to-end run. The user can
 * interrupt at any time by clicking the stage strip / workflow tabs
 * (we set `manual_override` and stop auto-advancing).
 *
 * This driver is independent of the Convex daemon stream — it just
 * drives the unified store directly. The daemon meta in the header
 * is fed by a separate ticker (see `runFakeDaemonMeta`).
 */
import { useUnifiedStore, type Stage } from "../unified-store.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface TimelineHandle {
  stop: () => void;
}

const STAGE_DWELL_MS: Record<Stage, number> = {
  audit: 6_000,
  cluster: 11_000,
  codify: 7_500,
  route: 6_000,
};

export function runUnifiedTimeline(): TimelineHandle {
  let cancelled = false;
  const cancelGuard = () => cancelled || useUnifiedStore.getState().manual_override;

  (async () => {
    // start at audit
    useUnifiedStore.getState().setStage("audit");
    await sleep(STAGE_DWELL_MS.audit);
    if (cancelGuard()) return;

    // For each workflow, walk through cluster → codify → route.
    // First workflow gets longer dwells (the "demo" walkthrough),
    // subsequent workflows get faster dwells since the same shape.
    const workflows = useUnifiedStore.getState().workflows;
    for (let i = 0; i < workflows.length; i++) {
      if (cancelGuard()) return;
      const w = workflows[i]!;
      useUnifiedStore.getState().setActiveWorkflow(w.id);

      const clusterDwell = i === 0 ? STAGE_DWELL_MS.cluster : 7_500;
      const codifyDwell = i === 0 ? STAGE_DWELL_MS.codify : 5_500;
      const routeDwell = i === 0 ? STAGE_DWELL_MS.route : 4_500;

      useUnifiedStore.getState().setStage("cluster");
      await sleep(clusterDwell);
      if (cancelGuard()) return;

      useUnifiedStore.getState().setStage("codify");
      await sleep(codifyDwell);
      if (cancelGuard()) return;

      useUnifiedStore.getState().setStage("route");
      // Linger on the last workflow's route stage (it's the "result"
      // beat of the demo).
      const finalDwell = i === workflows.length - 1 ? 999_999 : routeDwell;
      await sleep(finalDwell);
      if (cancelGuard()) return;
    }
  })();

  return {
    stop: () => {
      cancelled = true;
    },
  };
}

/** Synthetic daemon meta — bumps fires + savings every few seconds so
 *  the header strip looks alive even in offline mode. */
export function runFakeDaemonMeta(): TimelineHandle {
  let cancelled = false;
  const startMs = Date.now();
  // Pretend the daemon's been running for 7h 23m
  const baseUptimeMs = 7 * 60 * 60 * 1000 + 23 * 60 * 1000;
  let firesTotal = 14;
  let dollarsSaved = 188_400;

  useUnifiedStore.getState().setDaemon({
    connected: true,
    uptime_ms: baseUptimeMs,
    fires_total: firesTotal,
    dollars_saved: dollarsSaved,
    last_fire_ts: new Date().toISOString(),
  });

  const tick = () => {
    if (cancelled) return;
    const elapsed = Date.now() - startMs;
    useUnifiedStore.getState().setDaemon({
      uptime_ms: baseUptimeMs + elapsed,
    });
    setTimeout(tick, 1000);
  };
  tick();

  // Bump fires + savings every ~25 seconds.
  const bump = () => {
    if (cancelled) return;
    firesTotal += 1;
    dollarsSaved += Math.floor(800 + Math.random() * 1800);
    useUnifiedStore.getState().setDaemon({
      fires_total: firesTotal,
      dollars_saved: dollarsSaved,
      last_fire_ts: new Date().toISOString(),
    });
    setTimeout(bump, 22_000 + Math.random() * 8_000);
  };
  setTimeout(bump, 18_000);

  return {
    stop: () => {
      cancelled = true;
    },
  };
}
