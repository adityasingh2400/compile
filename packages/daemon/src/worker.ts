import { ConvexHttpClient } from "convex/browser";
import { anyApi } from "convex/server";
import { startCodeWatch } from "./code-watch.js";
import { getAcmeCorpusPath } from "./paths.js";

// Use anyApi to avoid pulling convex/* sibling .ts files into our typecheck.
// We trust the runtime-deployed function names; smoke tests catch typos.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const api = anyApi as any;

import { fireCompile } from "./fire-compile.js";

/**
 * The daemon's outer loop. One claim → one fireCompile → one post-back per
 * iteration. Single-worker, single-process. If you need parallelism, run
 * multiple processes with distinct worker_ids.
 */

const POLL_MS = 1500;
const HEARTBEAT_MS = 3000;

export type WorkerArgs = {
  worker_id: string;
  convex_url: string;
};

let triggersFired = {
  schedule: 0,
  event: 0,
  volume: 0,
  code_change: 0,
  recovery: 0,
};

export async function startWorker({ worker_id, convex_url }: WorkerArgs): Promise<void> {
  const client = new ConvexHttpClient(convex_url);

  console.log(`[daemon] worker=${worker_id} pid=${process.pid} polling ${convex_url}`);
  await client.mutation(api.daemon.log.append, {
    kind: "BOOT",
    message: `daemon online — worker=${worker_id} pid=${process.pid}`,
  });

  // Heartbeat loop (independent of compile loop).
  setInterval(async () => {
    try {
      const buckets = await client.query(api.daemon.ingest.allBuckets, {});
      const vault = await client.query(api.daemon.vault.sizeByState, {});
      await client.mutation(api.daemon.heartbeat.write, {
        worker_id,
        pid: process.pid,
        triggers_fired: triggersFired,
        buckets_active: buckets.length,
        vault_size: vault.positive + vault.negative,
      });
    } catch (err) {
      console.error("[daemon] heartbeat error:", err);
    }
  }, HEARTBEAT_MS);

  // Code-change trigger source — observes git SHA of the corpus every 30s.
  // getAcmeCorpusPath() resolves the bundled corpus or the dev-mode corpus.
  startCodeWatch({
    targetDir: getAcmeCorpusPath(),
    intervalMs: 30_000,
    onObserve: async (sha) => {
      try {
        await client.mutation(api.daemon.code_sha.observe, {
          target: "data/acme-agent",
          sha,
        });
      } catch (err) {
        console.error("[daemon] code_sha.observe failed:", (err as Error).message);
      }
    },
  });

  // Refresh trigger counts from the canonical log so the heartbeat is
  // honest even if the daemon restarted.
  setInterval(async () => {
    try {
      const counts = await client.query(api.daemon.log.countByKind, {});
      triggersFired = {
        schedule: counts.schedule,
        event: counts.event,
        volume: counts.volume,
        code_change: counts.code_change,
        recovery: counts.recovery,
      };
    } catch {
      // best-effort
    }
  }, 5000);

  while (true) {
    try {
      const claimed = await client.mutation(api.daemon.queue.claimNext, { worker_id });
      if (!claimed) {
        await sleep(POLL_MS);
        continue;
      }

      console.log(
        `[daemon] claimed ${claimed.call_site_hash} (attempt=${claimed.attempt}, n=${claimed.bucket_count})`,
      );
      await client.mutation(api.daemon.queue.markRunning, { id: claimed._id });

      const t0 = Date.now();
      try {
        await client.mutation(api.daemon.log.append, {
          kind: "STEP",
          message: `fireCompile() begin — ${claimed.call_site_hash}`,
          call_site_hash: claimed.call_site_hash,
        });

        let recoveryNotedThisRun = false;
        const result = await fireCompile(claimed.call_site_hash, {
          onRecovery: (method) => {
            // Log once per fire — spamming on every phi call would flood the log.
            if (recoveryNotedThisRun) return;
            recoveryNotedThisRun = true;
            client
              .mutation(api.daemon.log.append, {
                kind: "TRIGGER:RECOVERY",
                message: `tensorlake primary failed in ${method}; engaged local fallback`,
                call_site_hash: claimed.call_site_hash,
              })
              .catch(() => {});
          },
        });
        const wallMs = Date.now() - t0;

        await client.mutation(api.daemon.queue.markDone, {
          id: claimed._id,
          outcome: result.outcome,
          function_id: result.function_id,
          schema_stability: result.schema_stability,
          determinism: result.determinism,
          oracle_agreement: result.oracle_agreement,
          cluster_count: result.cluster_count,
          wall_time_ms: wallMs,
        });

        await client.mutation(api.daemon.vault.upsert, {
          call_site_hash: claimed.call_site_hash,
          state: result.outcome === "CODIFIED" ? "POSITIVE" : "NEGATIVE",
          function_id: result.function_id,
          reason: result.outcome === "NEGATIVE" ? "low_static_prior" : undefined,
          sticky: false,
        });

        console.log(
          `[daemon] ✓ ${claimed.call_site_hash} → ${result.outcome} in ${wallMs}ms`,
        );
      } catch (err) {
        const msg = (err as Error).message ?? String(err);
        console.error(`[daemon] ✗ ${claimed.call_site_hash}:`, msg);
        await client.mutation(api.daemon.queue.markFailed, {
          id: claimed._id,
          error: msg,
          retry: claimed.attempt < 2,
        });
      }
    } catch (err) {
      console.error("[daemon] loop error:", err);
      await sleep(2000);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}
