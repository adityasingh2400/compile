/**
 * End-to-end smoke for the autonomous daemon.
 *
 * Pre-req: a daemon worker is running (`npm run dev -w @compile/daemon`).
 *
 * Phases:
 *   1. reset state, kick replay
 *   2. wait for ≥3 done compiles + ≥1 SCHEDULE + ≥3 EVENT + ≥3 VOLUME
 *   3. bump SHA, wait for CODE_CHANGE (≥1)
 *   4. assert vault has ≥2 positive entries
 *   5. assert daemon heartbeat is fresh
 */

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = anyApi as any;

const url = process.env.CONVEX_URL;
if (!url) throw new Error("CONVEX_URL missing");
const client = new ConvexHttpClient(url);

const TIMEOUT_MS = 180_000;
const POLL_MS = 2000;

async function waitFor(label: string, predicate: () => Promise<boolean>): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < TIMEOUT_MS) {
    if (await predicate()) {
      console.log(`✓ ${label} (${Date.now() - t0}ms)`);
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  throw new Error(`✗ timed out waiting for: ${label}`);
}

async function main() {
  console.log("smoke: reset (full wipe)");
  await client.mutation(api.daemon.state.reset, { wipe_vault: true });
  await client.mutation(api.daemon.state.setSpeed, { speed_factor: 10_000 });
  await client.mutation(api.daemon.state.setPaused, { paused: false });

  await waitFor("≥3 compiles done", async () => {
    const q = await client.query(api.daemon.queue.status, {});
    return q.done >= 3;
  });

  const counts = await client.query(api.daemon.log.countByKind, {});
  console.log("triggers:", counts);
  if (counts.schedule < 1) throw new Error("no SCHEDULE triggers");
  if (counts.event < 3) throw new Error("no EVENT triggers");
  if (counts.volume < 3) throw new Error("no VOLUME triggers");

  // Wait for the daemon to establish a post-reset baseline SHA before
  // bumping. Without this gate, the smoke can write .bumped during the
  // window between reset (which wipes code_sha) and the daemon's first
  // post-reset code-watch tick — at which point the daemon observes the
  // already-bumped state as a fresh INSERT, no diff, no CODE_CHANGE.
  await waitFor("code_sha baseline established", async () => {
    const row = await client.query(api.daemon.code_sha.get, { target: "data/acme-agent" });
    return row !== null;
  });

  console.log("smoke: bumping SHA");
  appendFileSync(resolve(process.cwd(), "data/acme-agent/.bumped"), `${Date.now()}\n`);
  await waitFor("CODE_CHANGE fired", async () => {
    const c = await client.query(api.daemon.log.countByKind, {});
    return c.code_change >= 1;
  });

  await waitFor("≥2 vault positives", async () => {
    const v = await client.query(api.daemon.vault.sizeByState, {});
    return v.positive >= 2;
  });

  await waitFor("daemon heartbeat fresh", async () => {
    const h = await client.query(api.daemon.heartbeat.status, {});
    return h.online === true;
  });

  console.log("\n=== SMOKE PASSED ===");
  const final = await client.query(api.daemon.log.countByKind, {});
  console.log("final trigger counts:", final);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
