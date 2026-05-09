/**
 * Daemon supervisor — keeps the always-on @compile/daemon worker alive
 * without forcing the customer to run a second command.
 *
 * On `compile-mcp` boot we:
 *   1. Resolve the daemon's bin file via `require.resolve("@compile/daemon")`.
 *   2. Read ~/.compile/daemon.pid. If alive (kill 0 succeeds) we skip.
 *   3. Else spawn `node <daemon-bin>` detached, with stdout/stderr piped to
 *      ~/.compile/daemon.log. Detached + .unref() lets the daemon outlive
 *      the agent host process.
 *   4. Write the new PID. Subsequent boots from any agent see the live PID.
 *
 * Opt out with COMPILE_NO_DAEMON=1 (for users who run the daemon manually
 * or on a different host pointed at the same Convex deployment).
 *
 * State directory:  ~/.compile/
 *   daemon.pid    — last spawned daemon's pid
 *   daemon.log    — stdout + stderr of the spawned daemon (append-only)
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

const STATE_DIR = join(homedir(), ".compile");
const PID_FILE = join(STATE_DIR, "daemon.pid");
const LOG_FILE = join(STATE_DIR, "daemon.log");

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  const raw = readFileSync(PID_FILE, "utf8").trim();
  const pid = Number.parseInt(raw, 10);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function resolveDaemonBin(): string {
  // Find @compile/daemon's package.json, then construct the bin path. We
  // avoid require.resolve("@compile/daemon") directly because it returns
  // the `main` (a library export) rather than the bin script.
  const req = createRequire(import.meta.url);
  const pkgJsonPath = req.resolve("@compile/daemon/package.json");
  const pkgDir = pkgJsonPath.replace(/[/\\]package\.json$/, "");
  return join(pkgDir, "dist", "index.js");
}

export type SupervisorResult =
  | { status: "skipped"; reason: string }
  | { status: "already-running"; pid: number }
  | { status: "spawned"; pid: number; logFile: string };

export function ensureDaemon(): SupervisorResult {
  if (process.env.COMPILE_NO_DAEMON === "1") {
    return { status: "skipped", reason: "COMPILE_NO_DAEMON=1" };
  }
  if (!process.env.CONVEX_URL) {
    return { status: "skipped", reason: "CONVEX_URL not set" };
  }

  const existing = readPid();
  if (existing && isAlive(existing)) {
    return { status: "already-running", pid: existing };
  }

  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });

  let bin: string;
  try {
    bin = resolveDaemonBin();
  } catch (err) {
    return {
      status: "skipped",
      reason: `@compile/daemon not resolvable: ${(err as Error).message}`,
    };
  }
  if (!existsSync(bin)) {
    return { status: "skipped", reason: `daemon bin missing at ${bin}` };
  }

  const log = openSync(LOG_FILE, "a");
  const child = spawn(process.execPath, [bin], {
    detached: true,
    stdio: ["ignore", log, log],
    env: process.env,
  });
  child.unref();

  if (typeof child.pid !== "number") {
    return { status: "skipped", reason: "spawn returned no pid" };
  }
  writeFileSync(PID_FILE, String(child.pid));
  return { status: "spawned", pid: child.pid, logFile: LOG_FILE };
}
