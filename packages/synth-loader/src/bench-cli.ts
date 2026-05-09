#!/usr/bin/env node
/**
 * 100K bench + replay-recorder. Produces `data/bench/golden.json` —
 * the load-bearing fallback artifact for ENG_REVIEW.md failure mode #2:
 * "Friday night action: record a successful run to disk; if grid fails
 * Saturday, demo plays the recording and narrates over it."
 *
 * Configuration (env):
 *   COMPILE_BENCH_TOTAL_CALLS    default 100000 (DESIGN.md hero figure)
 *   COMPILE_BENCH_ORACLE         default 0.01   (1% sample)
 *   COMPILE_BENCH_WORKERS        default 64     (DESIGN.md grid)
 *   COMPILE_BENCH_BUDGET_MS      default 30000  (Friday derisk #2 ceiling)
 *   COMPILE_BENCH_OUT            default data/bench/golden.json
 *   COMPILE_BENCH_TARGET         default classify_ticket_priority
 *
 * Exits non-zero if wall > budget so CI / Friday rehearsals fail loud.
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanRepo } from "@compile/scanner";
import { StubNiaClient } from "@compile/nia";
import { NoopBootstrapStream } from "@compile/stream";
import { runStage2 } from "./grid.js";
import { CaptureBootstrapStream, writeReplayFile } from "./replay-capture.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO = resolve(__dirname, "../../../data/folk-agent");
const DEFAULT_OUT = resolve(__dirname, "../../../data/bench/golden.json");

interface BenchConfig {
  total_calls: number;
  oracle_fraction: number;
  worker_count: number;
  budget_ms: number;
  target_function: string;
  acme_path: string;
  out_path: string;
}

function readConfig(): BenchConfig {
  return {
    total_calls: parseInt(process.env.COMPILE_BENCH_TOTAL_CALLS ?? "100000", 10),
    oracle_fraction: parseFloat(process.env.COMPILE_BENCH_ORACLE ?? "0.01"),
    worker_count: parseInt(process.env.COMPILE_BENCH_WORKERS ?? "64", 10),
    budget_ms: parseInt(process.env.COMPILE_BENCH_BUDGET_MS ?? "30000", 10),
    target_function:
      process.env.COMPILE_BENCH_TARGET ?? "classify_message_intent",
    acme_path: process.env.COMPILE_BENCH_REPO ?? DEFAULT_REPO,
    out_path: process.env.COMPILE_BENCH_OUT ?? DEFAULT_OUT,
  };
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

async function main(): Promise<void> {
  const cfg = readConfig();
  console.log(`[bench] runStage2 against ${cfg.acme_path}`);
  console.log(
    `[bench] config: total_calls=${fmt(cfg.total_calls)}, oracle=${(cfg.oracle_fraction * 100).toFixed(1)}%, workers=${cfg.worker_count}`,
  );
  console.log(`[bench] target: function_hint=${cfg.target_function}`);
  console.log(`[bench] budget: ${cfg.budget_ms}ms (Friday derisk #2)`);

  console.log(`[bench] scanning repo...`);
  const report = await scanRepo(cfg.acme_path);
  const target = report.call_sites.find(
    (c) => c.priors.pill === "green" && c.function_hint === cfg.target_function,
  );
  if (!target) {
    console.error(
      `[bench] no GREEN call site with function_hint=${cfg.target_function} in ${cfg.acme_path}`,
    );
    process.exit(2);
  }
  console.log(`[bench] target call_site_id: ${target.call_site_id}`);

  const capture = new CaptureBootstrapStream(new NoopBootstrapStream());
  const nia = new StubNiaClient();
  const t0 = performance.now();
  const run = await runStage2({
    call_site: target,
    total_calls: cfg.total_calls,
    oracle_fraction: cfg.oracle_fraction,
    worker_count: cfg.worker_count,
    nia,
    stream: capture,
    run_id: `bench_${Date.now().toString(36)}`,
  });
  const wall = performance.now() - t0;

  console.log(`[bench] DONE`);
  console.log(`[bench]   wall:        ${fmt(Math.round(wall))} ms  ← target ≤ ${fmt(cfg.budget_ms)} ms`);
  console.log(`[bench]   throughput:  ${fmt(Math.round(run.throughput_per_sec))} cells/sec`);
  console.log(`[bench]   oracle:      ${fmt(run.oracle_calls)} calls`);
  console.log(`[bench]   candidate:   ${fmt(run.candidate_calls)} calls`);
  console.log(
    `[bench]   tier mix:    T1=${fmt(run.tier_mix.tier_1)}  T2=${fmt(run.tier_mix.tier_2)}  T3=${fmt(run.tier_mix.tier_3)}`,
  );
  console.log(
    `[bench]   axis:        schema=${run.axis_scores.schema_stability.toFixed(3)}  det=${run.axis_scores.determinism.toFixed(3)}  oracle_agree=${run.axis_scores.oracle_agreement.toFixed(3)}`,
  );
  console.log(`[bench]   gate:        ${run.passes_synthesis_gate ? "PASS" : "FAIL"}`);
  console.log(`[bench]   clusters:    ${run.clusters.length}`);
  console.log(`[bench]   events:      ${fmt(capture.eventCount())} captured`);

  const file = capture.serialize({
    call_site: target,
    config: {
      total_calls: cfg.total_calls,
      oracle_fraction: cfg.oracle_fraction,
      worker_count: cfg.worker_count,
      seed_count: 100,
    },
  });
  const bytes = await writeReplayFile(cfg.out_path, file);
  console.log(
    `[bench] wrote replay → ${cfg.out_path} (${(bytes / 1024 / 1024).toFixed(1)} MB)`,
  );

  if (wall > cfg.budget_ms) {
    console.error(
      `[bench] WALL EXCEEDED ${cfg.budget_ms}ms BUDGET — Friday derisk #2 FAIL`,
    );
    console.error(
      `[bench] action: drop visible count to 25K per ENG_REVIEW.md failure mode #2`,
    );
    process.exit(1);
  }
  console.log(`[bench] ≤ ${cfg.budget_ms}ms budget — Friday derisk #2 PASS`);
}

main().catch((err) => {
  console.error(`[bench] crashed: ${(err as Error).message}`);
  console.error((err as Error).stack);
  process.exit(3);
});
