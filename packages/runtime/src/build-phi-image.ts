#!/usr/bin/env node
import { Image } from "tensorlake";

/**
 * Builds a Tensorlake sandbox image with ollama + phi3:mini baked in.
 *
 * Run with: `npm run build:phi-image` (loads .env.local via --env-file).
 *
 * The image takes several minutes to build the first time because phi3:mini
 * (~2.3GB) is downloaded inside the build sandbox. Subsequent
 * `Sandbox.create({ image: "compile-phi-mini" })` calls boot in seconds
 * with the model already on disk.
 *
 * Per ENG_REVIEW.md D1: "Real Phi-3-mini in Tensorlake. The three-tier
 * story has to actually work, not be shown."
 */

const IMAGE_NAME = "compile-phi-mini";
const MODEL = "phi3:mini";

async function main(): Promise<void> {
  if (!process.env.TENSORLAKE_API_KEY) {
    console.error("[build] TENSORLAKE_API_KEY not set (expected via .env.local)");
    process.exit(2);
  }

  const t0 = performance.now();
  console.log(`[build] defining image ${IMAGE_NAME} ...`);

  // .run(string[]) concatenates with spaces, not && — each step has to be one
  // string. We chain with && so any failure aborts the layer.
  const image = new Image(IMAGE_NAME, "latest", "tensorlake/ubuntu-minimal")
    .run(
      "apt-get update -y && " +
        "apt-get install -y --no-install-recommends curl ca-certificates procps zstd && " +
        "rm -rf /var/lib/apt/lists/*",
    )
    // Official ollama install script.
    .run("curl -fsSL https://ollama.com/install.sh | sh")
    // Pre-pull phi3:mini. `ollama pull` requires `ollama serve` to be up;
    // run it in background, wait for the listener, pull, then stop.
    .run(
      // Save pid so we can kill the daemon by pid (not by name pattern, which
      // would also match this shell's argv). Image snapshot is filesystem-only
      // so leaving the daemon alive is fine; we kill explicitly to keep the
      // build deterministic.
      "nohup ollama serve > /tmp/ollama-build.log 2>&1 & " +
        "OLLAMA_PID=$!; " +
        "for i in $(seq 1 30); do " +
        "curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1 && break; " +
        "sleep 1; " +
        "done && " +
        `ollama pull ${MODEL} && ` +
        `ollama list | grep -q ${MODEL.split(":")[0]} && ` +
        "kill $OLLAMA_PID 2>/dev/null; " +
        "exit 0",
    )
    .env("OLLAMA_HOST", "127.0.0.1:11434")
    .env("OLLAMA_KEEP_ALIVE", "30m");

  console.log(`[build] starting build (this will take several minutes)...`);
  const result = await image.build({
    registeredName: IMAGE_NAME,
    cpus: 2,
    memoryMb: 4096,
    diskMb: 8192,
    verbose: true,
  });

  console.log(`[build] done in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`[build] result:`, JSON.stringify(result, null, 2));
  console.log(
    `[build] image registered as ${IMAGE_NAME}. ` +
      `Use with Sandbox.create({ image: "${IMAGE_NAME}" })`,
  );
}

main().catch((err) => {
  console.error("[build] FAIL:", err);
  process.exit(1);
});
