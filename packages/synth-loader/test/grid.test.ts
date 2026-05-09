import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { scanRepo } from "@compile/scanner";
import { StubNiaClient } from "@compile/nia";
import { runStage2 } from "../src/grid.js";
import type { SyntheticCell } from "@compile/schemas";

const FOLK = resolve(__dirname, "../../../data/folk-agent");

describe("synth-loader Stage 2", () => {
  it("runs a downscaled (1k) grid against a GREEN call site and produces axis scores", async () => {
    const scan = await scanRepo(FOLK);
    const green = scan.call_sites.find((c) => c.priors.pill === "green");
    expect(green).toBeDefined();

    const cells: SyntheticCell[] = [];
    const run = await runStage2({
      call_site: green!,
      total_calls: 1000,
      oracle_fraction: 0.01,
      worker_count: 8,
      seed_count: 50,
      nia: new StubNiaClient(),
      onCell: (c) => cells.push(c),
    });

    expect(run.total_calls).toBe(1000);
    expect(run.candidate_calls + run.oracle_calls).toBe(1000);
    expect(run.oracle_calls).toBeGreaterThan(0);
    expect(run.oracle_calls).toBeLessThan(50);
    // Most cells should be done; we stream both in_flight + done.
    expect(cells.filter((c) => c.status === "done").length).toBe(1000);
    // Axis scores in [0, 1].
    expect(run.axis_scores.schema_stability).toBeGreaterThan(0);
    expect(run.axis_scores.schema_stability).toBeLessThanOrEqual(1);
    expect(run.axis_scores.determinism).toBeLessThanOrEqual(1);
    expect(run.axis_scores.oracle_agreement).toBeLessThanOrEqual(1);
    // Tier mix populated.
    const totalTier =
      run.tier_mix.tier_1 + run.tier_mix.tier_2 + run.tier_mix.tier_3;
    expect(totalTier).toBe(run.candidate_calls);
    // GREEN call site → all candidate calls land in tier_1.
    expect(run.tier_mix.tier_1).toBe(run.candidate_calls);
    // Cluster snapshot produced.
    expect(run.clusters.length).toBeGreaterThan(0);
    // Preserved traces capped at 60.
    expect(run.preserved_traces.length).toBeLessThanOrEqual(60);
    expect(run.preserved_traces.length).toBeGreaterThan(0);
    // Throughput math sane.
    expect(run.throughput_per_sec).toBeGreaterThan(0);
  }, 30000);

  it("RED call site lands in tier_3 and does not pass the synthesis gate", async () => {
    const scan = await scanRepo(FOLK);
    const red = scan.call_sites.find((c) => c.priors.pill === "red");
    expect(red).toBeDefined();

    const run = await runStage2({
      call_site: red!,
      total_calls: 500,
      oracle_fraction: 0.02,
      worker_count: 4,
      seed_count: 25,
      nia: new StubNiaClient(),
    });
    expect(run.tier_mix.tier_3).toBe(run.candidate_calls);
    // Most reds have free-form output → low or non-applicable schema stability.
    // The gate should fail one of the axes.
    expect(run.passes_synthesis_gate).toBe(false);
  }, 30000);
});
