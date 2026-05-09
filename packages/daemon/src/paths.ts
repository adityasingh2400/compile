/**
 * Corpus path resolution for the daemon.
 *
 * Priority order:
 *   1. COMPILE_WATCH_TARGET env (absolute path) — full override.
 *   2. Bundled corpus inside the installed package: <pkg>/data/acme-agent.
 *      The `prepack` script copies the monorepo's data/acme-agent here so
 *      the published tarball is self-contained.
 *   3. Monorepo source mode: data/acme-agent at the repo root, located by
 *      walking up from the compiled file location.
 *
 * The compiled file location varies:
 *   - tsup bundle in @compile/mcp: <pkg>/dist/daemon-entry.js
 *   - tsc emit in @compile/daemon dev mode: <pkg>/dist/paths.js
 * We probe both layouts.
 */

import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export function getAcmeCorpusPath(): string {
  const override = process.env.COMPILE_WATCH_TARGET;
  if (override) return resolve(override);

  // Candidates ordered so the monorepo source-of-truth wins in dev mode.
  // Smoke tests and developers edit data/acme-agent at the repo root; the
  // bundled copy inside the package is only the published-tarball fallback.
  const candidates = [
    // Dev / monorepo: walk up to repo root from <pkg>/dist
    resolve(HERE, "..", "..", "..", "data", "acme-agent"),
    resolve(HERE, "..", "..", "..", "..", "data", "acme-agent"),
    // Installed: <pkg>/data/acme-agent (compiled file at <pkg>/dist/*.js)
    resolve(HERE, "..", "data", "acme-agent"),
  ];

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }

  throw new Error(
    `Could not locate the Acme corpus. Set COMPILE_WATCH_TARGET to an absolute path, or install @compile/daemon (which bundles the corpus). Searched: ${candidates.join(", ")}`,
  );
}

