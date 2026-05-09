/**
 * Round-trip: write a vault entry, then look it up by signature. Allows up to
 * a few seconds for Nia's vector index to catch up.
 */
import { createNiaClient } from "../dist/index.js";

const SIG = `compile-roundtrip-${Date.now()}`;
const client = createNiaClient({ mode: "real" });

console.log("→ vaultWrite", SIG);
const written = await client.vaultWrite({
  kind: "negative",
  cluster_signature: SIG,
  reason: "creative_task",
  retry_policy: { type: "sticky", retry_on_distribution_shift: false },
  trace_count_at_decision: 0,
  created_at: new Date().toISOString(),
});
console.log("  vault_page_id:", written.vault_page_id);

for (let attempt = 1; attempt <= 4; attempt++) {
  await new Promise((r) => setTimeout(r, attempt * 500));
  const got = await client.vaultLookup(SIG);
  console.log(`  attempt ${attempt}: ${got.state}`);
  if (got.state === "negative") {
    console.log("OK — round-trip confirmed.");
    process.exit(0);
  }
}
console.error("FAIL — entry not found after 4 attempts.");
process.exit(1);
