/**
 * Run the real Compile bootstrap pipeline against the Acme demo repo and
 * snapshot the result to a JSON the UI can replay. This is the "live data,
 * deterministic timing" path — the scanner runs against actual TS source,
 * the synth-loader runs against actual stub clients, and the UI shows real
 * call sites with real cluster shapes.
 *
 * Run: npx tsx packages/ui/scripts/snapshot-bootstrap.ts
 *
 * Output: packages/ui/public/bootstrap-snapshot.json
 */
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFile } from "node:fs/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
import { scanRepo } from "@compile/scanner";
import { runStage2 } from "@compile/synth-loader";
import { StubNiaClient } from "@compile/nia";
import {
  generateInputs,
  ICP_FIT_FIXTURE,
  AMBIGUOUS_LEAD_FIXTURE,
} from "@compile/runtime";
import type {
  CallSiteDescriptor,
  LiveMetrics,
  SyntheticCell,
  SyntheticRun,
} from "@compile/schemas";

interface BootstrapSnapshot {
  generated_at: string;
  scanner: {
    repo_path: string;
    files_scanned: number;
    tree_signature: string;
    call_sites: CallSiteDescriptor[];
  };
  green_call_sites: string[];
  /** Real generated inputs from @compile/runtime (Rishab's hybrid generator).
   * Surfaced on Page 4 (READING DOCS) seed-token strip in live mode. */
  generated_inputs: {
    cluster_id: string;
    samples: { input: unknown; source: "fuzz" | "perturb" }[];
  }[];
  stress_test: {
    call_site_id: string;
    cells_sampled: SyntheticCell[];
    final_metrics: LiveMetrics;
    final_run: SyntheticRun;
  };
}

async function main() {
  const ACME = resolve(__dirname, "../../../data/acme-agent");
  console.log(`[snapshot] scanning ${ACME}`);
  const scan = await scanRepo(ACME);
  console.log(
    `[snapshot] found ${scan.call_sites.length} call sites: ` +
      `${scan.call_sites.filter((c) => c.priors.pill === "green").length}g/` +
      `${scan.call_sites.filter((c) => c.priors.pill === "yellow").length}y/` +
      `${scan.call_sites.filter((c) => c.priors.pill === "red").length}r`,
  );

  const greens = scan.call_sites.filter((c) => c.priors.pill === "green");
  if (greens.length === 0) {
    throw new Error("no GREEN call sites — scanner may be stale");
  }
  const hero = greens[0]!;
  console.log(
    `[snapshot] running stage-2 on hero: ${hero.function_hint ?? hero.call_site_id}`,
  );

  const cellsSampled: SyntheticCell[] = [];
  let lastMetrics: LiveMetrics | undefined;
  const runId = "snapshot_run";

  // Use a small grid for the snapshot (1000 calls). The UI extrapolates
  // to 100K visually via the narrative counter; 1K is plenty for the real
  // cluster shape to emerge.
  const run = await runStage2({
    call_site: hero,
    total_calls: 1_000,
    oracle_fraction: 0.05,
    worker_count: 16,
    seed_count: 50,
    nia: new StubNiaClient(),
    onCell: (cell) => {
      // sample every 4th cell to keep the snapshot small (~250 cells)
      if (cell.status === "done" && cellsSampled.length < 600) {
        cellsSampled.push(cell);
      }
    },
    stream: {
      async advancePhase(args) {
        return {
          run_id: args.run_id,
          phase: args.phase,
          page_index: 1,
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
      },
      async emitScan() {},
      async emitCell() {},
      async emitLiveMetrics(args) {
        lastMetrics = args.metrics;
      },
      async emitClusterSnapshot() {},
      async emitRunComplete() {},
      async emitSynthesisEvent() {},
      async emitVaultEvent() {},
      async emitResult() {},
    },
    run_id: runId,
  });

  if (!lastMetrics) {
    throw new Error("no live metrics emitted — synth-loader stream may be broken");
  }

  console.log(`[snapshot] generating real synthetic inputs from runtime fixtures`);
  const icpInputs = generateInputs({
    inputSchema: ICP_FIT_FIXTURE.input_schema,
    traces: ICP_FIT_FIXTURE.traces,
    n: 16,
    seed: 7,
    perturbFraction: 0.5,
  });
  const ambInputs = generateInputs({
    inputSchema: AMBIGUOUS_LEAD_FIXTURE.input_schema,
    traces: AMBIGUOUS_LEAD_FIXTURE.traces,
    n: 8,
    seed: 11,
    perturbFraction: 0.5,
  });
  console.log(
    `[snapshot] generated ${icpInputs.length + ambInputs.length} inputs ` +
      `(icp_fit: ${icpInputs.length}, ambiguous_lead: ${ambInputs.length})`,
  );

  const snapshot: BootstrapSnapshot = {
    generated_at: new Date().toISOString(),
    scanner: {
      repo_path: scan.repo_path,
      files_scanned: scan.files_scanned,
      tree_signature: scan.tree_signature,
      call_sites: scan.call_sites,
    },
    green_call_sites: greens.map((g) => g.call_site_id),
    generated_inputs: [
      {
        cluster_id: ICP_FIT_FIXTURE.cluster_id,
        samples: icpInputs.map((g) => ({ input: g.input, source: g.source })),
      },
      {
        cluster_id: AMBIGUOUS_LEAD_FIXTURE.cluster_id,
        samples: ambInputs.map((g) => ({ input: g.input, source: g.source })),
      },
    ],
    stress_test: {
      call_site_id: hero.call_site_id,
      cells_sampled: cellsSampled,
      final_metrics: lastMetrics,
      final_run: run,
    },
  };

  const outPath = resolve(__dirname, "../public/bootstrap-snapshot.json");
  await writeFile(outPath, JSON.stringify(snapshot, null, 2), "utf8");
  console.log(`[snapshot] wrote ${outPath}`);
  console.log(
    `[snapshot] scanner: ${snapshot.scanner.call_sites.length} sites · ` +
      `stage-2 cells sampled: ${cellsSampled.length} · ` +
      `tier_mix: ${JSON.stringify(run.tier_mix)} · ` +
      `axis: ${JSON.stringify(run.axis_scores).slice(0, 80)}...`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
