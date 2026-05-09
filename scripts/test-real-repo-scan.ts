import { scanRepo } from "@compile/scanner";

const target = process.argv[2] ?? "/tmp/chatbot-ui";
const report = await scanRepo(target);

console.log(`\n=== Scan: ${target} ===`);
console.log(`files_scanned: ${report.files_scanned}`);
console.log(`call_sites:    ${report.call_sites.length}`);
console.log(`tree_signature: ${report.tree_signature}\n`);

const byProvider = new Map<string, number>();
const byPill = new Map<string, number>();
for (const s of report.call_sites) {
  byProvider.set(s.provider, (byProvider.get(s.provider) ?? 0) + 1);
  byPill.set(s.priors.pill, (byPill.get(s.priors.pill) ?? 0) + 1);
}
console.log("by provider:", Object.fromEntries(byProvider));
console.log("by pill:    ", Object.fromEntries(byPill));

console.log("\n--- call sites ---");
for (const s of report.call_sites) {
  console.log(
    `${s.file_path}:${s.line}  ${s.provider}  pill=${s.priors.pill}  ` +
      `det=${s.priors.determinism_prior.toFixed(2)} ` +
      `schema=${s.priors.schema_stability_prior.toFixed(2)} ` +
      `econ=${s.priors.economic_value_prior.toFixed(2)}`,
  );
  const sig = s.priors.signals;
  const flags = Object.entries(sig)
    .filter(([_, v]) => v === true || (typeof v === "number" && v > 0))
    .map(([k, v]) => (typeof v === "number" ? `${k}=${v}` : k))
    .join(", ");
  console.log(`  signals: ${flags || "(none)"}`);
  console.log(`  fn: ${s.function_hint ?? "?"}  excerpt: ${s.prompt_excerpt.slice(0, 80)}`);
}
