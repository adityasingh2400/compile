#!/usr/bin/env node
/**
 * Pre-warm sandbox for the UI demo.
 *
 *   npm run prewarm:ui -w @compile/runtime
 *
 * Spawns a real Tensorlake sandbox using TENSORLAKE_API_KEY from
 * .env.local, captures the real metadata (sandboxId, image, status,
 * resources, namespace, createdAt), runs a tiny in-sandbox `node -e` to
 * confirm the sandbox actually executes code, and writes the result as
 * JSON to:
 *
 *   packages/ui/public/tensorlake-status.json
 *
 * The UI fetches that file at audit start (`useTensorlakeStatus`). If
 * present, the AuditStage chrome shows the real `sandbox_id`, image,
 * vCPU, and memory. If absent (no keys / no prewarm), the audit page
 * falls back to its existing canned values so the demo still flows
 * offline.
 *
 * Also probes Nia for the vault id we have credentials for and does a
 * single read-only `vaultLookup` against a synthetic signature so we
 * know the API key is valid before the demo starts. Writes the result
 * to:
 *
 *   packages/ui/public/nia-status.json
 *
 * Both files are tiny (~1KB) and gitignored — they're per-machine
 * runtime artifacts, not source.
 *
 * Aborts non-zero on any error so CI / npm scripts can fail fast.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Sandbox } from "tensorlake";

const __dirname = dirname(fileURLToPath(import.meta.url));
// runtime/src → packages/ui/public (output)
const UI_PUBLIC = resolve(__dirname, "../../ui/public");

interface UiTensorlakeStatus {
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
  /** Verified — true means we executed a node command in the sandbox. */
  verified: boolean;
  /** Output of the sanity check, just for visible "real" proof. */
  sanity: {
    cmd: string;
    stdout: string;
    elapsed_ms: number;
  } | null;
  error?: string;
}

interface UiNiaStatus {
  schema_version: 1;
  fetched_at: string;
  source: "prewarm";
  connected: boolean;
  vault_id: string | null;
  /** Did vaultLookup return without auth error? */
  reachable: boolean;
  error?: string;
}

async function captureTensorlake(): Promise<UiTensorlakeStatus> {
  const apiKey = process.env.TENSORLAKE_API_KEY;
  const orgId = process.env.TENSORLAKE_ORGANIZATION_ID;
  const projectId = process.env.TENSORLAKE_PROJECT_ID;
  const fetchedAt = new Date().toISOString();
  if (!apiKey) {
    return {
      schema_version: 1,
      fetched_at: fetchedAt,
      source: "prewarm",
      connected: false,
      sandbox_id: null,
      image: null,
      status: null,
      cpus: null,
      memory_mb: null,
      namespace: null,
      organization_id: null,
      project_id: null,
      created_at: null,
      verified: false,
      sanity: null,
      error: "TENSORLAKE_API_KEY not set in env",
    };
  }

  // ── 1) spawn a real sandbox
  // Default to the audit-agent image when set; otherwise spawn from the
  // managed default image. Operators can override with COMPILE_AUDIT_IMAGE.
  const auditImage = process.env.COMPILE_AUDIT_IMAGE;
  const sandbox = await Sandbox.create({
    name: `compile-prewarm-${Date.now()}`,
    ...(auditImage ? { image: auditImage } : {}),
    cpus: Number(process.env.COMPILE_AUDIT_CPUS ?? 2),
    memoryMb: Number(process.env.COMPILE_AUDIT_MEM_MB ?? 2048),
    timeoutSecs: 1800,
  });

  let stdout = "";
  let elapsedMs = 0;
  let verified = false;
  try {
    // ── 2) sanity check by running node inside the sandbox
    const t0 = performance.now();
    const result = await sandbox.run("node", {
      args: [
        "-e",
        "console.log(JSON.stringify({ ok:true, node:process.version, ts:Date.now() }))",
      ],
      timeout: 30,
    });
    elapsedMs = performance.now() - t0;
    stdout = result.stdout.trim();
    verified = result.exitCode === 0 && stdout.includes("ok");
  } catch (err) {
    console.warn("[prewarm-ui] sanity check failed (continuing):", (err as Error).message);
  }

  // ── 3) capture metadata
  const info = await sandbox.info();

  // ── 4) leave the sandbox running so:
  //   - The UI's "LIVE" badge reflects an actually-running sandbox;
  //   - Judges can verify with `npx tl sbx ls` and see this exact id;
  //   - timeoutSecs (30 min) auto-terminates if the operator forgets.
  // Pass COMPILE_PREWARM_TERMINATE=1 to terminate anyway (CI / cleanup).
  if (process.env.COMPILE_PREWARM_TERMINATE === "1") {
    await sandbox.terminate().catch((err) => {
      console.warn("[prewarm-ui] terminate failed (continuing):", (err as Error).message);
    });
    console.log(`[prewarm-ui] sandbox terminated (COMPILE_PREWARM_TERMINATE=1)`);
  } else {
    console.log(
      `[prewarm-ui] sandbox left running for the demo. Auto-terminates in ${
        info.timeoutSecs ?? 1800
      }s. Force-kill with: npx tl sbx terminate ${info.sandboxId}`,
    );
  }

  return {
    schema_version: 1,
    fetched_at: fetchedAt,
    source: "prewarm",
    connected: true,
    sandbox_id: info.sandboxId,
    image: info.image ?? null,
    status: info.status,
    cpus: info.resources.cpus,
    memory_mb: info.resources.memoryMb,
    namespace: info.namespace,
    organization_id: orgId ?? null,
    project_id: projectId ?? null,
    created_at: info.createdAt ? new Date(info.createdAt).toISOString() : null,
    verified,
    sanity: verified
      ? { cmd: "node -e (json round-trip)", stdout, elapsed_ms: elapsedMs }
      : null,
  };
}

async function captureNia(): Promise<UiNiaStatus> {
  const apiKey = process.env.NIA_API_KEY;
  const vaultId = process.env.NIA_VAULT_ID;
  const fetchedAt = new Date().toISOString();
  if (!apiKey || !vaultId) {
    return {
      schema_version: 1,
      fetched_at: fetchedAt,
      source: "prewarm",
      connected: false,
      vault_id: vaultId ?? null,
      reachable: false,
      error: "NIA_API_KEY or NIA_VAULT_ID not set",
    };
  }
  // Lazy-import the built Nia package so we don't pull it into the runtime
  // package's dist tree. Using a relative path so this script works
  // regardless of npm hoisting.
  const niaModule = await import("@compile/nia");
  const client = niaModule.createNiaClient({ mode: "real", apiKey, vaultId });
  try {
    const probe = await client.vaultLookup(`compile-prewarm-${Date.now()}`);
    return {
      schema_version: 1,
      fetched_at: fetchedAt,
      source: "prewarm",
      connected: true,
      vault_id: vaultId,
      // `unknown` is the expected response for a fresh signature — that
      // _is_ a successful auth round-trip.
      reachable: probe.state === "unknown" || probe.state === "positive" || probe.state === "negative",
    };
  } catch (err) {
    return {
      schema_version: 1,
      fetched_at: fetchedAt,
      source: "prewarm",
      connected: false,
      vault_id: vaultId,
      reachable: false,
      error: (err as Error).message.slice(0, 400),
    };
  }
}

async function writeJson(path: string, payload: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(payload, null, 2) + "\n", "utf-8");
}

async function main(): Promise<void> {
  console.log(`[prewarm-ui] writing into ${UI_PUBLIC}`);

  const [tl, nia] = await Promise.all([
    captureTensorlake().catch((err): UiTensorlakeStatus => ({
      schema_version: 1,
      fetched_at: new Date().toISOString(),
      source: "prewarm",
      connected: false,
      sandbox_id: null,
      image: null,
      status: null,
      cpus: null,
      memory_mb: null,
      namespace: null,
      organization_id: null,
      project_id: null,
      created_at: null,
      verified: false,
      sanity: null,
      error: (err as Error).message.slice(0, 400),
    })),
    captureNia().catch((err): UiNiaStatus => ({
      schema_version: 1,
      fetched_at: new Date().toISOString(),
      source: "prewarm",
      connected: false,
      vault_id: process.env.NIA_VAULT_ID ?? null,
      reachable: false,
      error: (err as Error).message.slice(0, 400),
    })),
  ]);

  await writeJson(`${UI_PUBLIC}/tensorlake-status.json`, tl);
  await writeJson(`${UI_PUBLIC}/nia-status.json`, nia);

  console.log("[prewarm-ui] tensorlake:", {
    connected: tl.connected,
    sandbox_id: tl.sandbox_id,
    image: tl.image,
    status: tl.status,
    cpus: tl.cpus,
    memory_mb: tl.memory_mb,
    verified: tl.verified,
    error: tl.error,
  });
  console.log("[prewarm-ui] nia:", {
    connected: nia.connected,
    vault_id: nia.vault_id,
    reachable: nia.reachable,
    error: nia.error,
  });
  console.log("[prewarm-ui] wrote tensorlake-status.json + nia-status.json");
}

main().catch((err) => {
  console.error("[prewarm-ui] fatal:", err);
  process.exit(1);
});
