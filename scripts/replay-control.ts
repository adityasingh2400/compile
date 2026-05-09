/**
 * Demo control surface for the always-on daemon.
 *
 *   npm run daemon:ctl start          # unpause replay cron
 *   npm run daemon:ctl pause
 *   npm run daemon:ctl reset          # clear all daemon state, keep seed_traces
 *   npm run daemon:ctl speed 500
 *   npm run daemon:ctl bump-sha       # trigger CODE_CHANGE by touching a file
 *   npm run daemon:ctl inject <hash>  # push N traces of given hash to fire VOLUME on cue
 *   npm run daemon:ctl status         # one-shot health snapshot
 */

import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = anyApi as any;

const CONVEX_URL = process.env.CONVEX_URL;
if (!CONVEX_URL) {
  console.error("CONVEX_URL is not set — run via npm script with --env-file=.env.local");
  process.exit(1);
}
const client = new ConvexHttpClient(CONVEX_URL);

const cmd = process.argv[2];
const arg = process.argv[3];

async function main() {
  switch (cmd) {
    case "start":
      await client.mutation(api.daemon.state.setPaused, { paused: false });
      console.log("replay started");
      break;
    case "pause":
      await client.mutation(api.daemon.state.setPaused, { paused: true });
      console.log("replay paused");
      break;
    case "reset":
      await client.mutation(api.daemon.state.reset, {});
      console.log("daemon state reset (seed_traces preserved)");
      break;
    case "speed":
      if (!arg) throw new Error("usage: speed <factor>");
      await client.mutation(api.daemon.state.setSpeed, { speed_factor: Number(arg) });
      console.log(`speed_factor → ${arg}`);
      break;
    case "bump-sha": {
      const target = resolve(process.cwd(), "data/acme-agent/.bumped");
      appendFileSync(target, `${new Date().toISOString()} demo bump\n`);
      console.log(`appended marker to ${target} — code-watch will fire within 30s`);
      break;
    }
    case "inject": {
      if (!arg) throw new Error("usage: inject <call_site_hash> [count]");
      const count = Number(process.argv[4] ?? "5");
      for (let i = 0; i < count; i++) {
        await client.mutation(api.daemon.ingest.ingestTrace, {
          call_site_hash: arg,
          payload: {
            ts: new Date().toISOString(),
            call_site_hash: arg,
            user_prompt: `injected demo trace ${i}`,
            response: "{}",
            response_tokens: 5,
            latency_ms: 250,
            cost_usd: 0.001,
          },
        });
      }
      console.log(`injected ${count} traces of ${arg}`);
      break;
    }
    case "status": {
      const heart = await client.query(api.daemon.heartbeat.status, {});
      const queue = await client.query(api.daemon.queue.status, {});
      const counts = await client.query(api.daemon.log.countByKind, {});
      const vault = await client.query(api.daemon.vault.sizeByState, {});
      const buckets = await client.query(api.daemon.ingest.allBuckets, {});
      console.log(JSON.stringify({ heart, queue, triggers: counts, vault, bucket_count: buckets.length }, null, 2));
      break;
    }
    default:
      console.error("commands: start | pause | reset | speed <n> | bump-sha | inject <hash> [count] | status");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
