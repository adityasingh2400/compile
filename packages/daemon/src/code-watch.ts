/**
 * Code-change trigger source — runs inside the local daemon process.
 *
 * Every 30s, computes a SHA over `data/acme-agent/` (git tree if available,
 * file-content hash otherwise) and posts to Convex. Convex compares,
 * fires TRIGGER:CODE_CHANGE if changed, and expires non-sticky negatives.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const TARGET = "data/acme-agent";

export function computeSha(repoRoot: string): string {
  // Content hash of the working tree. Sensitive to uncommitted edits, which
  // is what the demo needs (we won't commit between bumps mid-pitch).
  const targetDir = resolve(repoRoot, TARGET);
  const hasher = createHash("sha256");
  for (const file of walk(targetDir).sort()) {
    hasher.update(file);
    hasher.update(readFileSync(join(targetDir, file)));
  }
  return hasher.digest("hex");
}

function walk(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full, rel));
    else out.push(rel);
  }
  return out;
}

export type CodeWatchOptions = {
  repoRoot: string;
  intervalMs?: number;
  onObserve: (sha: string) => Promise<void>;
};

export function startCodeWatch({ repoRoot, intervalMs = 30_000, onObserve }: CodeWatchOptions): NodeJS.Timeout {
  const tick = async () => {
    try {
      const sha = computeSha(repoRoot);
      await onObserve(sha);
    } catch (err) {
      console.error("[daemon] code-watch error:", (err as Error).message);
    }
  };
  void tick();
  return setInterval(tick, intervalMs);
}
