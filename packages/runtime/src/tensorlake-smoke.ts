import { Sandbox } from "tensorlake";
import { RealTensorlakeClient } from "./tensorlake.js";

/**
 * Live smoke: prove Tensorlake SDK + TENSORLAKE_API_KEY round-trip and that
 * RealTensorlakeClient.runEmittedFunction actually executes agent-emitted
 * code in a sandbox. Run with `npm run live-smoke` (loads .env.local).
 *
 * Two phases:
 *   1. Bare SDK round-trip — `Sandbox.create` + `sandbox.run("node", ...)`.
 *   2. RealTensorlakeClient.runEmittedFunction against a small synthetic
 *      holdout. Mirrors what the gate does at submit_synthesis time.
 */
async function main(): Promise<void> {
  if (!process.env.TENSORLAKE_API_KEY) {
    console.error("[smoke] TENSORLAKE_API_KEY not set (expected via .env.local)");
    process.exit(2);
  }

  const tStart = performance.now();

  // ── Phase 1: bare SDK round-trip ────────────────────────────────────────
  console.log("[smoke/1] creating sandbox...");
  const sandbox = await Sandbox.create({
    name: `compile-smoke-${Date.now()}`,
    cpus: 1,
    memoryMb: 1024,
    timeoutSecs: 300,
  });
  console.log(`[smoke/1] up in ${(performance.now() - tStart).toFixed(0)}ms id=${sandbox.sandboxId}`);
  try {
    const r = await sandbox.run("node", {
      args: ["-e", "console.log(JSON.stringify({hello:'world',pid:process.pid}))"],
      timeout: 30,
    });
    console.log(`[smoke/1] stdout: ${r.stdout.trim()}`);
    if (JSON.parse(r.stdout.trim()).hello !== "world") throw new Error("phase 1 payload mismatch");
    console.log("[smoke/1] PASS");
  } finally {
    await sandbox.terminate();
  }

  // ── Phase 2: RealTensorlakeClient.runEmittedFunction ────────────────────
  console.log("[smoke/2] gate path — emitting + running agent function in sandbox...");
  const client = new RealTensorlakeClient();
  try {
    const code = `
      export function classify_priority(input) {
        const text = String(input.text ?? "").toLowerCase();
        if (text.includes("urgent") || text.includes("critical")) return { priority: "high" };
        if (text.includes("question") || text.includes("how do")) return { priority: "low" };
        return { priority: "medium" };
      }
    `;
    const holdout = [
      { input: { text: "URGENT: server is down" }, output: { priority: "high" }, tool_calls: [] },
      { input: { text: "How do I reset my password?" }, output: { priority: "low" }, tool_calls: [] },
      { input: { text: "Can you update the dashboard color?" }, output: { priority: "medium" }, tool_calls: [] },
    ];
    const t = performance.now();
    const result = await client.runEmittedFunction({
      code,
      function_name: "classify_priority",
      holdout,
    });
    const elapsed = performance.now() - t;
    console.log(`[smoke/2] runEmittedFunction returned in ${elapsed.toFixed(0)}ms`);
    console.log(`[smoke/2] outputs: ${JSON.stringify(result.outputs)}`);
    console.log(`[smoke/2] per-trace latency_ms: [${result.latency_ms.map((n) => n.toFixed(2)).join(", ")}]`);
    console.log(`[smoke/2] fallback_invoked: ${result.fallback_invoked}`);

    let correct = 0;
    for (let i = 0; i < holdout.length; i++) {
      if (JSON.stringify(result.outputs[i]) === JSON.stringify(holdout[i]!.output)) correct++;
    }
    console.log(`[smoke/2] gate score: ${correct}/${holdout.length} = ${((correct / holdout.length) * 100).toFixed(0)}%`);
    if (correct !== holdout.length) throw new Error("phase 2 gate mismatch — emitted fn returned wrong outputs");
    console.log("[smoke/2] PASS");
  } finally {
    await client.close();
  }

  console.log(`[smoke] all phases PASS in ${(performance.now() - tStart).toFixed(0)}ms total`);
}

main().catch((err) => {
  console.error("[smoke] FAIL:", err);
  process.exit(1);
});
