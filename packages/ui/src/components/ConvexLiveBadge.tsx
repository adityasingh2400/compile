/**
 * Tiny "Convex · LIVE" readout. Subscribes to result_summary + the latest
 * vault_event for the demo run, so judges can SEE that Convex is round-
 * tripping while the fake daemon writes mutations.
 *
 * No-op when VITE_CONVEX_URL isn't set (falls back to fixture-only mode).
 */
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api.js";
import { CONVEX_RUN_ID, CONVEX_URL } from "../convex-client.js";

export function ConvexLiveBadge() {
  if (!CONVEX_URL) return null;

  const summary = useQuery(api.result.get, { run_id: CONVEX_RUN_ID });
  const vaultEvents = useQuery(api.vault.byRun, { run_id: CONVEX_RUN_ID });

  const connected = summary !== undefined; // undefined = loading, null = not yet written
  const dollars = summary?.projected_annual_savings_usd ?? 0;
  const fires = summary?.stage2_runs ?? 0;
  const vaultCount = vaultEvents?.length ?? 0;

  const host = (() => {
    try {
      return new URL(CONVEX_URL).host;
    } catch {
      return CONVEX_URL;
    }
  })();

  return (
    <div
      style={{
        position: "fixed",
        bottom: 12,
        right: 12,
        zIndex: 9999,
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 11,
        lineHeight: 1.45,
        padding: "8px 12px",
        borderRadius: 6,
        background: "rgba(8, 12, 24, 0.85)",
        color: connected ? "#7CFFB2" : "#FFD479",
        border: `1px solid ${connected ? "#1f6b3a" : "#6b5b1f"}`,
        backdropFilter: "blur(6px)",
        boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        pointerEvents: "none",
        letterSpacing: 0.2,
      }}
    >
      <div style={{ fontWeight: 600 }}>
        CONVEX · {connected ? "LIVE" : "CONNECTING"}
      </div>
      <div style={{ opacity: 0.75 }}>{host}</div>
      <div style={{ marginTop: 4 }}>
        run <span style={{ color: "#9ec1ff" }}>{CONVEX_RUN_ID}</span>
      </div>
      <div>
        fires <span style={{ color: "#fff" }}>{fires}</span> · vault{" "}
        <span style={{ color: "#fff" }}>{vaultCount}</span>
      </div>
      <div>
        saved <span style={{ color: "#fff" }}>${dollars.toLocaleString()}</span>
      </div>
    </div>
  );
}
