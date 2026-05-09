import { randomUUID } from "node:crypto";
import { startWorker } from "./worker.js";

const CONVEX_URL = process.env.CONVEX_URL;
if (!CONVEX_URL) {
  console.error("CONVEX_URL is not set — load .env.local via --env-file");
  process.exit(1);
}

const WORKER_ID = process.env.DAEMON_WORKER_ID ?? `worker-${randomUUID().slice(0, 8)}`;

startWorker({ worker_id: WORKER_ID, convex_url: CONVEX_URL }).catch((err) => {
  console.error("[daemon] fatal:", err);
  process.exit(1);
});
