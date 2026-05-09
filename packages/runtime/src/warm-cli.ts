#!/usr/bin/env node
/**
 * Operator-triggered Tensorlake pre-warm. Runs `npm run warm` ~10 min
 * before the demo per ENG_REVIEW.md D6: "Pre-warm sandbox 10 min before
 * demo + keep-alive throughout. Cold start in Tensorlake is unverified
 * (5–30s plausible)."
 *
 * Behavior:
 *   1. Construct the same client the MCP server would (Real wrapped in
 *      LocalFallback when TENSORLAKE_API_KEY is set; otherwise LocalFake).
 *   2. Call warm() — Tensorlake spins up the Phi sandbox + worker grid.
 *   3. Issue 3 sample runPhi calls and report observed latency. The
 *      operator uses this to confirm the sandbox is responding before
 *      walking on stage. Failure mode #5: cold start >10s — we catch it
 *      here, not during the demo.
 */
import {
  LocalFakeTensorlakeClient,
  RealTensorlakeClient,
  TensorlakeWithLocalFallback,
  type ITensorlakeClient,
} from "./tensorlake.js";

function build(): { client: ITensorlakeClient; mode: string } {
  const fallback = new LocalFakeTensorlakeClient();
  if (process.env.TENSORLAKE_API_KEY) {
    const real = new RealTensorlakeClient({
      apiKey: process.env.TENSORLAKE_API_KEY,
      endpoint: process.env.TENSORLAKE_ENDPOINT,
      phiImage: process.env.COMPILE_PHI_IMAGE ?? "compile-phi-mini",
      phiModel: process.env.COMPILE_PHI_MODEL ?? "phi3:mini",
    });
    return {
      client: new TensorlakeWithLocalFallback(real, fallback),
      mode: "real (with local fallback)",
    };
  }
  return { client: fallback, mode: "local-fake (no TENSORLAKE_API_KEY set)" };
}

async function main(): Promise<void> {
  const { client, mode } = build();
  console.log(`[warm] tensorlake mode: ${mode}`);
  const t0 = performance.now();
  await client.warm();
  const warmMs = performance.now() - t0;
  console.log(`[warm] warm() returned in ${warmMs.toFixed(0)}ms`);

  const samples: number[] = [];
  for (let i = 0; i < 3; i++) {
    const ts = performance.now();
    await client.runPhi({
      prompt: "warm-up smoke",
      input: { sample: i },
    });
    samples.push(performance.now() - ts);
  }
  const avg = samples.reduce((s, v) => s + v, 0) / samples.length;
  console.log(`[warm] 3 sample runPhi calls: ${samples.map((s) => s.toFixed(0)).join("ms, ")}ms`);
  console.log(`[warm] average: ${avg.toFixed(0)}ms`);
  if (avg > 10_000) {
    console.error(
      `[warm] WARNING: average latency > 10s — failure mode #5 territory. Check Phi sandbox.`,
    );
    process.exit(2);
  }
  console.log(`[warm] sandbox is hot. Demo in ~10 min.`);
}

main().catch((err) => {
  console.error(`[warm] failed: ${(err as Error).message}`);
  process.exit(1);
});
