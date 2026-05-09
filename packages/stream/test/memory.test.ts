import { describe, it, expect } from "vitest";
import { MemoryBootstrapStream } from "../src/memory.js";
import { ConvexBootstrapStream, type IConvexClientLike } from "../src/convex.js";

describe("MemoryBootstrapStream", () => {
  it("rejects backward phase writes (UI relies on monotonic page index)", async () => {
    const s = new MemoryBootstrapStream();
    await s.advancePhase({ run_id: "r1", phase: "stress_test" });
    await expect(
      s.advancePhase({ run_id: "r1", phase: "connect" }),
    ).rejects.toThrow(/phase regression/);
  });

  it("preserves started_at across phase advances; updates updated_at", async () => {
    const s = new MemoryBootstrapStream();
    const a = await s.advancePhase({ run_id: "r1", phase: "connect" });
    await new Promise((r) => setTimeout(r, 5));
    const b = await s.advancePhase({ run_id: "r1", phase: "reading_code" });
    expect(b.started_at).toBe(a.started_at);
    expect(b.updated_at >= a.updated_at).toBe(true);
    expect(b.page_index).toBe(2);
  });

  it("phaseOrderFor filters by run_id", async () => {
    const s = new MemoryBootstrapStream();
    await s.advancePhase({ run_id: "a", phase: "connect" });
    await s.advancePhase({ run_id: "b", phase: "connect" });
    await s.advancePhase({ run_id: "a", phase: "reading_code" });
    expect(s.phaseOrderFor("a")).toEqual(["connect", "reading_code"]);
    expect(s.phaseOrderFor("b")).toEqual(["connect"]);
  });
});

describe("ConvexBootstrapStream wire batching", () => {
  function recordingClient() {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const client: IConvexClientLike = {
      async mutation(name, args) {
        calls.push({ name, args });
        return null;
      },
    };
    return { client, calls };
  }

  it("emitCell buffers and flushes by max-batch-size", async () => {
    const { client, calls } = recordingClient();
    const s = new ConvexBootstrapStream({
      client,
      flushIntervalMs: 100_000, // never auto-flush in this test
      maxBatchSize: 3,
    });
    for (let i = 0; i < 7; i++) {
      await s.emitCell({
        run_id: "r1",
        call_site_id: "cs1",
        cell: {
          input_id: `in_${i}`,
          worker_id: 0,
          status: "done",
          path: "candidate",
        },
      });
    }
    // At maxBatchSize=3, after 7 cells we get two batch flushes (3 + 3) and
    // 1 cell still buffered.
    const inserts = calls.filter((c) => c.name === "cells:insertMany");
    expect(inserts).toHaveLength(2);
    expect((inserts[0]!.args.cells as unknown[]).length).toBe(3);
    expect((inserts[1]!.args.cells as unknown[]).length).toBe(3);

    await s.flush();
    const insertsAfter = calls.filter((c) => c.name === "cells:insertMany");
    expect(insertsAfter).toHaveLength(3);
    expect((insertsAfter[2]!.args.cells as unknown[]).length).toBe(1);
  });

  it("advancePhase flushes pending cells first (page-6 grid finishes painting before page-7 reveals)", async () => {
    const { client, calls } = recordingClient();
    const s = new ConvexBootstrapStream({
      client,
      flushIntervalMs: 100_000,
      maxBatchSize: 1000,
    });
    await s.emitCell({
      run_id: "r1",
      call_site_id: "cs1",
      cell: {
        input_id: "in_0",
        worker_id: 0,
        status: "done",
        path: "candidate",
      },
    });
    await s.advancePhase({ run_id: "r1", phase: "clusters_revealed" });
    const order = calls.map((c) => c.name);
    expect(order.indexOf("cells:insertMany")).toBeLessThan(
      order.indexOf("phase:advance"),
    );
  });
});
