#!/usr/bin/env node
/**
 * Copies the monorepo's data/acme-agent into packages/daemon/data/acme-agent
 * before pack/publish so the published tarball is self-contained.
 *
 * Idempotent: re-running overwrites. Safe in CI.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, "..");
const SRC = resolve(PKG_ROOT, "..", "..", "data", "acme-agent");
const DST = resolve(PKG_ROOT, "data", "acme-agent");

if (!existsSync(SRC)) {
  console.error(`[copy-corpus] source not found: ${SRC}`);
  process.exit(1);
}

if (existsSync(DST)) rmSync(DST, { recursive: true });
mkdirSync(dirname(DST), { recursive: true });
cpSync(SRC, DST, { recursive: true });

console.log(`[copy-corpus] ${SRC} → ${DST}`);
