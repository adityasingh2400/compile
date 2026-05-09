/**
 * One-time seed of Convex `seed_traces` table from data/proxy-traces.jsonl.
 *
 * The replay cron reads this in (seq, offset_ms) order, inserts batches
 * into proxy_traces at compressed wall time, which fires the volume
 * trigger autonomously.
 *
 *   npx tsx scripts/seed-convex-traces.ts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";

// Run via: node --env-file=.env.local --import tsx scripts/seed-convex-traces.ts
const CONVEX_URL = process.env.CONVEX_URL;
if (!CONVEX_URL) throw new Error("CONVEX_URL missing in .env.local");

const JSONL = resolve(process.cwd(), "data/proxy-traces.jsonl");

type RawTrace = {
  ts: string;
  call_site_hash: string;
  [k: string]: unknown;
};

async function main() {
  const lines = readFileSync(JSONL, "utf-8")
    .split("\n")
    .filter((l) => l.trim().length > 0);

  const traces: RawTrace[] = lines.map((l) => JSON.parse(l));
  if (traces.length === 0) throw new Error("no traces in JSONL");

  // Sort by ts ascending so seq is monotonic in time.
  traces.sort((a, b) => a.ts.localeCompare(b.ts));

  const t0 = new Date(traces[0]!.ts).getTime();
  const rows = traces.map((trace, i) => ({
    seq: i,
    offset_ms: new Date(trace.ts).getTime() - t0,
    call_site_hash: trace.call_site_hash,
    payload: trace,
  }));

  console.log(`loaded ${rows.length} traces; window = ${rows.at(-1)!.offset_ms}ms`);

  const client = new ConvexHttpClient(CONVEX_URL!);

  // Convex mutation arg-size cap is generous but chunk to be safe.
  const CHUNK = 200;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const res = await client.mutation(api.daemon.seed.bulkInsert, {
      rows: chunk,
      clear_first: i === 0,
    });
    inserted += res.inserted;
    process.stdout.write(`  inserted ${inserted}/${rows.length}\r`);
  }
  process.stdout.write("\n");

  const summary = await client.query(api.daemon.seed.summary, {});
  console.log(`\nseed_traces total=${summary.total}`);
  for (const { hash, count } of summary.by_hash) {
    console.log(`  ${hash.padEnd(45)} ${count}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
