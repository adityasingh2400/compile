/**
 * Convex deployment smoke test.
 *
 * Verifies the live deployment + the @compile/stream writer adapter end
 * to end: advances a phase, inserts a synthetic cell, reads both back.
 *
 * Usage:
 *   CONVEX_URL=https://flexible-turtle-311.convex.cloud \
 *     npx tsx scripts/smoke-convex.ts
 *
 * Defaults to the dev deployment if CONVEX_URL is unset.
 */
import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { createConvexAdapter, ConvexBootstrapStream } from "@compile/stream";

const url =
  process.env.CONVEX_URL ?? "https://watchful-oriole-309.convex.cloud";
const runId = `smoke-${Date.now()}`;

console.log(`▶ smoke test against ${url}`);
console.log(`  run_id: ${runId}\n`);

const adapter = createConvexAdapter({ url });
const stream = new ConvexBootstrapStream({ client: adapter, flushIntervalMs: 10 });

// 1. Advance phase via the high-level stream API.
await stream.advancePhase({ run_id: runId, phase: "connect" });
console.log("✓ advancePhase(connect)");

// 2. Emit one synthetic cell, force flush.
await stream.emitCell({
  run_id: runId,
  call_site_id: "classify_lead_tier",
  cell: {
    input_id: "smoke-input-1",
    worker_id: 0,
    status: "done",
    path: "candidate",
    tier_assigned: "tier_1",
    output: { fit: true, confidence: 0.96 },
    cluster_id: "cluster-1",
    latency_ms: 12,
    cost_usd: 0,
  },
});
await stream.flush();
console.log("✓ emitCell + flush");

// 3. Read both back via raw client to confirm round-trip.
const client = new ConvexHttpClient(url);
const phaseDoc = await client.query(anyApi.phase.get as never, {
  run_id: runId,
} as never);
console.log("✓ phase.get →", phaseDoc);

const cells = await client.query(anyApi.cells.stream as never, {
  run_id: runId,
  call_site_id: "classify_lead_tier",
  only_done: true,
} as never);
console.log(`✓ cells.stream → ${(cells as unknown[]).length} row(s)`);

if (!phaseDoc || (cells as unknown[]).length !== 1) {
  console.error("✗ smoke test FAILED — round-trip mismatch");
  process.exit(1);
}

console.log("\n✅ smoke test passed");
