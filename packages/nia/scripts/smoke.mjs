/**
 * Live smoke test against the real Nia API. Uses NIA_API_KEY and NIA_VAULT_ID
 * from the environment. Exits non-zero on the first failure.
 *
 *   NIA_API_KEY=nk_... NIA_VAULT_ID=<vault-uuid> node scripts/smoke.mjs
 */
import { createNiaClient } from "../dist/index.js";

const SIG = `compile-smoke-${Date.now()}`;

const client = createNiaClient({ mode: "real" });

console.log("→ vaultLookup (expect unknown for fresh signature)");
const before = await client.vaultLookup(SIG);
console.log("  result:", before);
if (before.state !== "unknown") {
  console.error("  FAIL: expected state=unknown, got", before.state);
  process.exit(1);
}

console.log("→ vaultWrite (negative entry — fewer required fields than positive)");
const written = await client.vaultWrite({
  kind: "negative",
  cluster_signature: SIG,
  reason: "insufficient_data",
  retry_policy: { type: "expiring", retry_when_traces: 30, retry_on_distribution_shift: false },
  trace_count_at_decision: 0,
  created_at: new Date().toISOString(),
});
console.log("  vault_page_id:", written.vault_page_id);

console.log("→ semanticSearch (compile-smoke)");
const hits = await client.semanticSearch({ query: SIG, top_k: 5 });
console.log(`  ${hits.length} hits`);
for (const h of hits.slice(0, 3)) {
  console.log(`   - score=${h.score?.toFixed?.(3) ?? h.score} id=${h.id} ${h.text.slice(0, 80).replace(/\n/g, " ")}…`);
}

console.log("\nOK — Nia round-trip wired.");
