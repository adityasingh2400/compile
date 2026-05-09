/**
 * Loads real Tensorlake + Nia connection status into the redesign store.
 *
 * Two sources of truth:
 *
 * 1. **Static prewarm files** — `/tensorlake-status.json` and
 *    `/nia-status.json`, written by `npm run prewarm:ui` (which spawns a
 *    real Tensorlake sandbox + does a real Nia round-trip). Vite serves
 *    these from `packages/ui/public/`. Fetched once on mount.
 *
 * 2. **Daemon stream events** (planned — owned by Ayaan's daemon, not
 *    this hook). When `sandbox_spawn_start` events land on /daemon/events,
 *    the UI overrides the prewarm metadata with live values. The hook
 *    exposes `setTensorlakeStatus` so the daemon-stream consumer can
 *    write directly.
 *
 * Behavior:
 *   - If a status file is present and `connected=true`, the audit chrome
 *     flips into "LIVE TENSORLAKE" mode and shows the real sandbox_id.
 *   - If absent / errored, the UI keeps the canned animation values so
 *     the demo runs offline (failure mode #1 — Tensorlake outage).
 *
 * The hook is fire-once on mount. Calling `useTensorlakeStatus()` from
 * the App shell is enough — every component that reads the
 * `useRedesignStore.tensorlake` slice gets reactive updates.
 */

import { useEffect } from "react";
import { useRedesignStore } from "../data/redesign-store.js";

interface PrewarmTensorlakeStatus {
  schema_version: 1;
  fetched_at: string;
  source: "prewarm";
  connected: boolean;
  sandbox_id: string | null;
  image: string | null;
  status: string | null;
  cpus: number | null;
  memory_mb: number | null;
  namespace: string | null;
  organization_id: string | null;
  project_id: string | null;
  created_at: string | null;
  verified: boolean;
  sanity: {
    cmd: string;
    stdout: string;
    elapsed_ms: number;
  } | null;
  error?: string;
}

interface PrewarmNiaStatus {
  schema_version: 1;
  fetched_at: string;
  source: "prewarm";
  connected: boolean;
  vault_id: string | null;
  reachable: boolean;
  error?: string;
}

let LOADED = false;

async function loadOnce(): Promise<void> {
  if (LOADED) return;
  LOADED = true;
  try {
    const [tlRes, niaRes] = await Promise.all([
      fetch("/tensorlake-status.json", { cache: "no-store" }).catch(() => null),
      fetch("/nia-status.json", { cache: "no-store" }).catch(() => null),
    ]);

    const setTensorlake = useRedesignStore.getState().setTensorlakeStatus;
    const setNia = useRedesignStore.getState().setNiaStatus;

    if (tlRes && tlRes.ok) {
      const tl = (await tlRes.json()) as PrewarmTensorlakeStatus;
      if (tl.schema_version === 1) {
        setTensorlake({
          connected: tl.connected,
          sandbox_id: tl.sandbox_id,
          image: tl.image,
          status: tl.status,
          cpus: tl.cpus,
          memory_mb: tl.memory_mb,
          namespace: tl.namespace,
          organization_id: tl.organization_id,
          project_id: tl.project_id,
          source: "prewarm",
          created_at: tl.created_at,
          fetched_at: tl.fetched_at,
        });
        // eslint-disable-next-line no-console
        console.log("[tensorlake-status] connected=", tl.connected, "sandbox=", tl.sandbox_id);
      }
    }

    if (niaRes && niaRes.ok) {
      const nia = (await niaRes.json()) as PrewarmNiaStatus;
      if (nia.schema_version === 1) {
        setNia({
          connected: nia.connected && nia.reachable,
          vault_id: nia.vault_id,
          fetched_at: nia.fetched_at,
        });
        // eslint-disable-next-line no-console
        console.log("[nia-status] connected=", nia.connected, "vault=", nia.vault_id);
      }
    }
  } catch (err) {
    // Silent — UI falls back to canned values.
    // eslint-disable-next-line no-console
    console.warn("[tensorlake-status] load failed; falling back to canned values", err);
  }
}

/** Mount-once hook. Idempotent; safe to call from multiple components. */
export function useTensorlakeStatus(): void {
  useEffect(() => {
    void loadOnce();
  }, []);
}
