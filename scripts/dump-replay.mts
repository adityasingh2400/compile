import { resolve } from "node:path";
import { CaptureBootstrapStream } from "../packages/synth-loader/src/replay-capture.js";
import { NoopBootstrapStream } from "../packages/stream/src/index.js";
import { scanRepo } from "../packages/scanner/src/scan.js";
import { StubNiaClient } from "../packages/nia/src/index.js";
import { runStage2 } from "../packages/synth-loader/src/grid.js";

const FOLK = resolve("./data/folk-agent");
const capture = new CaptureBootstrapStream(new NoopBootstrapStream());
const scan = await scanRepo(FOLK);
const green = scan.call_sites.find(
  (c) => c.priors.pill === "green" && c.function_hint === "classify_message_intent",
)!;
console.log("call site prompt_excerpt:", JSON.stringify(green.prompt_excerpt));
await runStage2({
  call_site: green,
  total_calls: 100,
  oracle_fraction: 0.05,
  worker_count: 2,
  nia: new StubNiaClient(),
  stream: capture,
  run_id: "test",
});
const file = capture.serialize({
  call_site: green,
  config: {
    total_calls: 100,
    oracle_fraction: 0.05,
    worker_count: 2,
    seed_count: 100,
  },
});
const s = JSON.stringify(file);
const codeUnits = s.length;
const bytes = Buffer.byteLength(s, "utf-8");
console.log("codeunits:", codeUnits, "bytes:", bytes, "diff:", bytes - codeUnits);
const nonAscii = s.match(/[^\x00-\x7F]/g) ?? [];
console.log("non-ASCII char count:", nonAscii.length);
console.log(
  "non-ASCII unique:",
  JSON.stringify([...new Set(nonAscii)].map((c) => `${c} (U+${c.charCodeAt(0).toString(16)})`)),
);
