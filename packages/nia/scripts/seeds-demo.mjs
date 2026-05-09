/**
 * Live end-to-end: scanRepo over data/acme/agent → 100 grounded seeds per
 * GREEN/YELLOW call site. Proves the Lane D handoff: scanner output (main's
 * @compile/scanner) feeds the synthetic input generator (Lane D Nia
 * package) without any custom glue.
 */
import * as path from "node:path";
import { scanRepo } from "../../scanner/dist/scan.js";
import { generateSeeds, loadLocalCorpus } from "../dist/index.js";

const root = process.cwd();
const report = await scanRepo(path.join(root, "data/acme/agent"));
const corpus = loadLocalCorpus(path.join(root, "data/acme/corpus"));

const totals = report.call_sites.reduce(
  (acc, s) => ((acc[s.priors.pill]++), acc),
  { green: 0, yellow: 0, red: 0 },
);

console.log(`corpus: ${corpus.length} docs`);
console.log(
  `scan: ${report.call_sites.length} call sites (${totals.green} green / ${totals.yellow} yellow / ${totals.red} red)\n`,
);

let total = 0;
for (const site of report.call_sites) {
  if (site.priors.pill === "red") continue;
  const seeds = generateSeeds(site, corpus, { count: 100 });
  total += seeds.length;
  const sample = seeds[0];
  console.log(
    `${site.priors.pill.padEnd(7)} ${site.file_path}:${site.line} (${site.function_hint ?? "anonymous"}) → ${seeds.length} seeds`,
  );
  console.log(`  sample: ${JSON.stringify(sample.args).slice(0, 120)}`);
  console.log(`  grounded in: ${sample.grounded_in.join(", ") || "(none)"}\n`);
}
console.log(`TOTAL: ${total} seeds (Lane B will fan these → ${total * 200} via variation)`);
