import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MemoryBootstrapStream,
  NoopBootstrapStream,
} from "@compile/stream";
import { scanRepo } from "@compile/scanner";
import { StubNiaClient } from "@compile/nia";
import { ReplayFileSchema } from "@compile/schemas";
import { runStage2 } from "../src/grid.js";
import {
  CaptureBootstrapStream,
  computeClusterLayout,
  writeReplayFile,
} from "../src/replay-capture.js";
import { replayRun } from "../src/replay-player.js";

const FOLK = resolve(__dirname, "../../../data/folk-agent");

describe("CaptureBootstrapStream", () => {
  it("forwards every event to the downstream stream and records timed copies", async () => {
    const downstream = new MemoryBootstrapStream();
    const capture = new CaptureBootstrapStream(downstream);

    const scan = await scanRepo(FOLK);
    const green = scan.call_sites.find(
      (c) => c.priors.pill === "green" && c.function_hint === "classify_message_intent",
    )!;

    const run = await runStage2({
      call_site: green,
      total_calls: 200,
      oracle_fraction: 0.05,
      worker_count: 4,
      nia: new StubNiaClient(),
      stream: capture,
      run_id: "bench_test",
    });

    expect(run.total_calls).toBe(200);
    // Every cell + run_complete + metrics + snapshots reached downstream.
    expect(downstream.eventsOf("cell").length).toBe(200);
    expect(downstream.eventsOf("run_complete")).toHaveLength(1);
    // And every event was recorded by the capture wrapper.
    expect(capture.eventCount()).toBeGreaterThanOrEqual(200);
  });

  it("serialize() returns a schema-valid ReplayFile", async () => {
    const capture = new CaptureBootstrapStream(new NoopBootstrapStream());
    const scan = await scanRepo(FOLK);
    const green = scan.call_sites.find(
      (c) => c.priors.pill === "green" && c.function_hint === "classify_message_intent",
    )!;
    await runStage2({
      call_site: green,
      total_calls: 200,
      oracle_fraction: 0.05,
      worker_count: 4,
      nia: new StubNiaClient(),
      stream: capture,
      run_id: "bench_test",
    });
    const file = capture.serialize({
      call_site: green,
      config: {
        total_calls: 200,
        oracle_fraction: 0.05,
        worker_count: 4,
        seed_count: 100,
      },
    });
    // Round-trips through Zod cleanly.
    expect(() => ReplayFileSchema.parse(file)).not.toThrow();
    expect(file.schema_version).toBe(1);
    expect(file.summary.candidate_calls + file.summary.oracle_calls).toBe(200);
    expect(file.clusters_layout.length).toBe(file.summary.cluster_count);
    // Events ordered by t_ms.
    for (let i = 1; i < file.events.length; i++) {
      expect(file.events[i]!.t_ms).toBeGreaterThanOrEqual(file.events[i - 1]!.t_ms);
    }
  });

  it("serialize() throws if run_complete never fired (partial capture)", () => {
    const capture = new CaptureBootstrapStream(new NoopBootstrapStream());
    expect(() =>
      capture.serialize({
        call_site: {
          call_site_id: "cs",
          file_path: "f",
          line: 1,
          column: 1,
          provider: "anthropic",
          prompt_excerpt: "x",
          priors: {
            schema_stability_prior: 0.9,
            determinism_prior: 0.9,
            economic_value_prior: 0.9,
            pill: "green",
            signals: {
              has_response_format: true,
              has_zod_schema: true,
              has_temperature_zero: true,
              prompt_template_static: true,
              bounded_tool_array: true,
              tool_count: 0,
              has_few_shot_examples: false,
              followed_by_structured_parse: false,
              has_telemetry: true,
            },
          },
        },
        config: {
          total_calls: 100,
          oracle_fraction: 0.01,
          worker_count: 1,
          seed_count: 100,
        },
      }),
    ).toThrow(/run_complete never fired/);
  });
});

describe("computeClusterLayout", () => {
  it("returns one normalized position per cluster, sorted by share descending", () => {
    const positions = computeClusterLayout([
      {
        cluster_id: "c1",
        centroid: [0],
        member_count: 30,
        share: 0.3,
        modal_output_shape: "obj",
      },
      {
        cluster_id: "c2",
        centroid: [0],
        member_count: 50,
        share: 0.5,
        modal_output_shape: "obj",
      },
      {
        cluster_id: "c3",
        centroid: [0],
        member_count: 20,
        share: 0.2,
        modal_output_shape: "obj",
      },
    ]);
    expect(positions).toHaveLength(3);
    // Highest-share cluster first.
    expect(positions[0]!.cluster_id).toBe("c2");
    expect(positions[1]!.cluster_id).toBe("c1");
    expect(positions[2]!.cluster_id).toBe("c3");
    // Bounded.
    for (const p of positions) {
      expect(p.x).toBeGreaterThanOrEqual(-1);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(-1);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });

  it("is deterministic across calls (rehearsal reproducibility)", () => {
    const clusters = [
      { cluster_id: "a", centroid: [0], member_count: 1, share: 0.5, modal_output_shape: "x" },
      { cluster_id: "b", centroid: [0], member_count: 1, share: 0.3, modal_output_shape: "x" },
      { cluster_id: "c", centroid: [0], member_count: 1, share: 0.2, modal_output_shape: "x" },
    ];
    const a = computeClusterLayout(clusters);
    const b = computeClusterLayout(clusters);
    expect(a).toEqual(b);
  });

  it("returns empty array on empty input", () => {
    expect(computeClusterLayout([])).toEqual([]);
  });
});

describe("replayRun (player drives an arbitrary IBootstrapStream)", () => {
  async function captureSmallRun(): Promise<ReturnType<CaptureBootstrapStream["serialize"]>> {
    const capture = new CaptureBootstrapStream(new NoopBootstrapStream());
    const scan = await scanRepo(FOLK);
    const green = scan.call_sites.find(
      (c) => c.priors.pill === "green" && c.function_hint === "classify_message_intent",
    )!;
    await runStage2({
      call_site: green,
      total_calls: 100,
      oracle_fraction: 0.05,
      worker_count: 2,
      nia: new StubNiaClient(),
      stream: capture,
      run_id: "orig_run",
    });
    return capture.serialize({
      call_site: green,
      config: {
        total_calls: 100,
        oracle_fraction: 0.05,
        worker_count: 2,
        seed_count: 100,
      },
    });
  }

  it("re-emits events through the target stream in the same order", async () => {
    const file = await captureSmallRun();
    const target = new MemoryBootstrapStream();
    await replayRun({ file, stream: target, speed: 100 }); // 100× so test is fast
    expect(target.eventsOf("cell").length).toBe(file.summary.candidate_calls + file.summary.oracle_calls);
    expect(target.eventsOf("run_complete")).toHaveLength(1);
  });

  it("speed multiplier reduces wall time", async () => {
    // Use a hand-built ReplayFile with deliberately spaced events so
    // wall-time delta is observable in CI (a real captured small run can
    // finish in <1ms — below the player's per-iteration sleep floor).
    const file = await captureSmallRun();
    const synthetic = {
      ...file,
      events: [
        { t_ms: 0, event: file.events[0]!.event },
        { t_ms: 200, event: file.events[Math.floor(file.events.length / 2)]!.event },
        { t_ms: 400, event: file.events.at(-1)!.event },
      ],
    };
    const t0 = performance.now();
    await replayRun({ file: synthetic, stream: new MemoryBootstrapStream(), speed: 10 });
    const fast = performance.now() - t0;
    // 400ms span / speed 10 = 40ms target. Anything under 200ms proves the
    // multiplier is honored (huge bound for CI variance).
    expect(fast).toBeLessThan(200);
    expect(fast).toBeLessThan(400); // beats original wall span
  });

  it("run_id override rewrites every event so a fresh demo doesn't collide", async () => {
    // runStage2 alone does not emit phase advances (those live in the MCP
    // handlers' wiring of bootstrap_phase), so this test asserts the
    // per-event payloads runStage2 actually emits: cell, live_metrics,
    // cluster_snapshot, run_complete.
    const file = await captureSmallRun();
    const target = new MemoryBootstrapStream();
    await replayRun({ file, stream: target, speed: 1000, run_id: "fresh_demo" });
    const cellEvents = target.eventsOf("cell");
    expect(cellEvents.length).toBeGreaterThan(0);
    expect(cellEvents.every((e) => e.run_id === "fresh_demo")).toBe(true);
    const metrics = target.eventsOf("live_metrics");
    expect(metrics.every((e) => e.metrics.run_id === "fresh_demo")).toBe(true);
    const snaps = target.eventsOf("cluster_snapshot");
    expect(snaps.every((e) => e.snapshot.run_id === "fresh_demo")).toBe(true);
    const runs = target.eventsOf("run_complete");
    expect(runs.every((e) => e.run_id === "fresh_demo")).toBe(true);
  });

  it("stretch_to_ms uniformly scales event timings to span the requested wall", async () => {
    // Stub bench produces a fast recording (~hundreds of ms). The demo
    // wants ~28s on Page 6. stretch_to_ms is how Lane C bridges the gap.
    const file = await captureSmallRun();
    const target = new MemoryBootstrapStream();
    const t0 = performance.now();
    // Use a small stretch to keep the test fast — same scaling math.
    await replayRun({ file, stream: target, stretch_to_ms: 200 });
    const elapsed = performance.now() - t0;
    // Should be within range of 200ms, with generous CI tolerance.
    expect(elapsed).toBeGreaterThan(150);
    expect(elapsed).toBeLessThan(800);
    // All cells still landed.
    expect(target.eventsOf("cell").length).toBe(
      file.summary.candidate_calls + file.summary.oracle_calls,
    );
  });

  it("rejects mismatched schema_version", async () => {
    const file = await captureSmallRun();
    const tampered = { ...file, schema_version: 999 as unknown as 1 };
    await expect(
      replayRun({ file: tampered, stream: new MemoryBootstrapStream(), speed: 1000 }),
    ).rejects.toThrow();
  });

  it("can read a ReplayFile from disk and replay it", async () => {
    const file = await captureSmallRun();
    const dir = await mkdtemp(join(tmpdir(), "replay-test-"));
    try {
      const path = join(dir, "golden.json");
      const bytes = await writeReplayFile(path, file);
      expect(bytes).toBeGreaterThan(0);
      const raw = await readFile(path, "utf-8");
      expect(raw.length).toBe(bytes);
      const target = new MemoryBootstrapStream();
      await replayRun({ file: path, stream: target, speed: 1000 });
      expect(target.eventsOf("cell").length).toBe(
        file.summary.candidate_calls + file.summary.oracle_calls,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
