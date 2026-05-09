# Compile

> **MCP server that compiles repeat LLM work out of the agent loop — codifiability decided from your code in milliseconds, then confirmed by 100,000 synthetic calls in 28 seconds.**

Built for the [Nozomio Hackathon](https://luma.com/rshibq6i) — May 9, 2026, EF office, San Francisco.

---

## Install

```bash
git clone https://github.com/rmotgi1227/Compile.git
cd Compile
npm install
npm run build      # all workspaces
npm test           # 100+ tests across the monorepo
```

Requires **Node.js >= 22** (Tensorlake SDK requirement).

---

## Configure (API keys)

Create `.env.local` in the repo root. **Never commit this file** — it's gitignored.

```bash
# Tensorlake — sandbox compute for the gate + Phi-3-mini Tier-2 (D1, D6)
TENSORLAKE_API_KEY=tl_apiKey_...
TENSORLAKE_ORGANIZATION_ID=org_...
TENSORLAKE_PROJECT_ID=project_...

# Anthropic — frontier oracle for Stage-2 1% sample (D9, D10)
ANTHROPIC_API_KEY=sk-ant-...

# Nia — vault + document grounding (D2, D8)
NIA_API_KEY=nk_...
NIA_VAULT_ID=...
```

| Variable | Required for | Get it from |
|---|---|---|
| `TENSORLAKE_API_KEY` | Real gate validation, Tier-2 Phi inference | [tensorlake.ai](https://cloud.tensorlake.ai) → API keys |
| `TENSORLAKE_ORGANIZATION_ID` | Same | `npx tl whoami` after `tl login` |
| `TENSORLAKE_PROJECT_ID` | Same | `npx tl whoami` after `tl init` |
| `ANTHROPIC_API_KEY` | Real Sonnet 4.6 oracle for cluster discovery | [console.anthropic.com](https://console.anthropic.com) |
| `NIA_API_KEY` + `NIA_VAULT_ID` | Real Vault writes + Document Agent grounding | [trynia.ai](https://trynia.ai) |

**Without keys**, the system falls back to local stubs — fully functional offline for development. Each surface flips to real independently:

- No `TENSORLAKE_API_KEY` → `LocalFakeTensorlakeClient` (in-process gate, no Phi)
- No `ANTHROPIC_API_KEY` → `StubOracleClient` (deterministic stub outputs)
- No `NIA_API_KEY` → `StubNiaClient` (in-memory vault, local corpus seeds)

---

## Local model setup (Phi-3-mini in Tensorlake)

Tier-2 routing uses **real Phi-3-mini** running in a Tensorlake sandbox (D1). The model lives in a custom Tensorlake image with `ollama` and `phi3:mini` (~2.3GB) baked in.

**One-time setup:**

```bash
# 1. Install the Tensorlake CLI deps (already in node_modules after npm install)
npx tl login          # interactive — paste a browser-supplied PAT
npx tl init           # picks an org + project; writes .tensorlake/config.toml

# 2. Copy the org+project IDs into .env.local
cat .tensorlake/config.toml      # shows organization + project values
# add as TENSORLAKE_ORGANIZATION_ID + TENSORLAKE_PROJECT_ID in .env.local

# 3. Build the custom image (downloads phi3:mini inside Tensorlake; ~40s)
npm run build:phi-image -w @compile/runtime
# → registers `compile-phi-mini` as a sandbox template
```

After the image is registered, every `Sandbox.create({ image: "compile-phi-mini" })` boots a fresh MicroVM with Phi already on disk.

**Sanity check it works:**

```bash
npm run live-smoke -w @compile/runtime
# Expected: 3 phases pass — bare SDK round-trip, gate path, Phi inference
```

If you also want a local copy of phi3:mini on your Mac (handy for offline iteration, NOT used by the demo):

```bash
brew install ollama
ollama pull phi3:mini
ollama run phi3:mini "hi"
```

---

## Test

### Unit tests (offline, no keys needed)

```bash
npm test                     # all workspaces — ~100 tests
npm test -w @compile/runtime # one package
```

### Live integration test against real services

This is the gate that proves the backend is demo-ready. Walks scan_repo → synthetic_confirm → request_synthesis → submit_synthesis → run_codified (Tier-1 + Tier-2) through real Tensorlake + real Nia + (if key set) real Anthropic.

```bash
npm run demo:dry-run -w @compile/mcp
```

Expected output:

```
=== Compile demo dry-run ===

Services:
  nia        : RealNiaClient
  tensorlake : real (with local fallback)
  oracle     : anthropic (budget=$5, fallback=stub)
  stream     : MemoryBootstrapStream (in-process capture)

▶ Beat 1 — scan_repo (Lane E scanner against Acme)
  ✓ scan_repo (625ms) — 10 sites, pills=green:2,yellow:3,red:5
... (7 beats)

=== Report card ===
  ✓ PASS scan_repo                       625ms
  ✓ PASS synthetic_confirm                 7ms
  ✓ PASS list_codify_candidates            0ms
  ✓ PASS request_synthesis                 1ms
  ✓ PASS submit_synthesis               1616ms   (real Tensorlake gate)
  ✓ PASS run_codified.tier_1               4ms
  ✓ PASS run_codified.tier_2           20581ms   (real Phi cold start)
  total: 22834ms across 7 beats — 7 pass, 0 fail
```

### Bench (100K synthetic calls)

```bash
npm run bench
# → produces data/bench/golden.json (~39MB) — replay-ready
```

---

## Run the demo

### Pre-warm Tensorlake (10 min before going on stage)

```bash
npm run warm
# Boots gate + Phi sandboxes in parallel, force-loads Phi into RAM.
# Reports steady-state runPhi latency. Aborts if avg > 10s (failure mode #5).
```

Expected: `~23s warm + 3 sample runPhi at ~4.5s each`.

After warm, on-stage Tier-2 inference lands in ~few hundred ms.

### Start the MCP server

```bash
npm run dev:mcp
# stdio-based; agents connect via:
#   claude mcp add compile -- npx @compile/mcp
```

### Start the UI

The cleanest path is `npm run demo`, which:

1. Spawns a **real** Tensorlake sandbox via the prewarm CLI, captures its
   real `sandbox_id` / `cpus` / `memory_mb` / `namespace`, and writes them
   to `packages/ui/public/tensorlake-status.json`.
2. Probes the **real** Nia vault with a read-only `vaultLookup` to confirm
   the API key is valid; writes the result to `packages/ui/public/nia-status.json`.
3. Starts Vite. The audit page boots, fetches both JSON files, and pulls the
   real metadata into the boot terminal + chrome:
   - `● TENSORLAKE LIVE` and `● NIA LIVE` badges go green.
   - The boot terminal renders `tensorlake.Sandbox.create({ image: '…', cpus: <REAL>, … })`
     followed by `✓ sandbox ready · <REAL_SANDBOX_ID> · real cold start`.
   - `npx tl sbx ls` shows the same `sandbox_id` running — judges can verify.

```bash
npm run demo                          # prewarm + dev:ui in one shot
```

Or run the steps individually:

```bash
npm run prewarm:ui                    # spawns a real Tensorlake sandbox + verifies Nia
npm run dev:ui                        # http://localhost:5173
```

The prewarmed sandbox is left running for the demo (auto-terminates in
30 min via `timeoutSecs`). To force-terminate now:
`npx tl sbx terminate <sandbox_id>` — the sandbox_id is printed by the
prewarm CLI and visible in the UI's audit chrome.

Without `npm run prewarm:ui`, the audit page falls back to its canned
animation values (works fully offline).

Append `?source=real` to drive from real scanner output instead of the canned timeline.

### Cleanup (after demo)

```bash
npx tl sbx ls                         # list active sandboxes (incl. the prewarmed one)
npx tl sbx terminate <ID> [<ID>...]   # terminate them (or just walk away — auto-die in 30 min)
```

---

## Documents

| Doc | Purpose |
|---|---|
| [`PITCH.md`](./PITCH.md) | Why Compile matters — the 600× ROI math |
| [`DESIGN.md`](./DESIGN.md) | Full architecture spec — two-stage codifiability, three-tier routing, eleven-page demo flow |
| [`ENG_REVIEW.md`](./ENG_REVIEW.md) | Thirteen architectural decisions locked, Friday derisks, build plan |
| [`DEMO_RUNBOOK.md`](./DEMO_RUNBOOK.md) | On-stage operation: hotkeys, talking track per page, failure-mode response |
| [`prompts/synthesizer.md`](./prompts/synthesizer.md) | Load-bearing synthesizer prompt spec |

---

## Packages

| Package | Role |
|---|---|
| `@compile/schemas` | Shared Zod schemas — single source of truth for all wire shapes |
| `@compile/scanner` | TS AST scanner — decides Stage-1 codifiability from code structure |
| `@compile/synth-loader` | Stage-2 fan-out — generates synthetic inputs, runs the parallel grid, real Anthropic oracle |
| `@compile/synthesizer` | Synthesis spec assembly + holdout split + envelope validator + harness |
| `@compile/identifier` | Pattern identification + scoring + templating |
| `@compile/runtime` | Real Tensorlake adapter (gate + Phi), Vitest gate runner, synthetic input generator |
| `@compile/nia` | Nia API client (Vault + Document Agent) |
| `@compile/stream` | `IBootstrapStream` interface + Memory and Convex implementations |
| `@compile/mcp-server` | The MCP server with 9 tools — `npm pack`-ready as `@compile/mcp` |
| `@compile/ui` | The 11-page bootstrap demo (Vite + React + canvas constellation) |

---

## Three-tier insurance (failure modes)

1. **Tensorlake outage** → `TensorlakeWithLocalFallback` drops to in-process gate + local Phi mirror.
2. **Anthropic outage / budget trip** → `OracleWithLocalFallback` retries once, then per-input falls back to stub oracle.
3. **Stage-2 grid total failure** → replay `data/bench/golden.json` through `replayRun()` — UI cannot tell live from replay.
4. **Nia quota / outage** → `safeVaultWrite` swallows write errors, local positive Vault mirror keeps `run_codified` working.

---

## Useful commands

```bash
npm run demo                                # prewarm:ui + dev:ui — real Tensorlake in UI
npm run prewarm:ui                          # spawn real Tensorlake sandbox + probe Nia, write JSON for UI
npm run demo:dry-run -w @compile/mcp        # full backend dry-run against real services
npm run dev:ui                              # UI demo on :5173 (audit chrome falls back to canned values without prewarm)
npm run dev:mcp                             # MCP stdio server
npm run warm                                # pre-warm Tensorlake (10 min before demo) + run 3 sample Phi inferences
npm run bench                               # 100K synthetic calls → data/bench/golden.json
npm run live-smoke -w @compile/runtime      # 3-phase smoke: SDK + gate + Phi
npm run build:phi-image -w @compile/runtime # rebuild the Tensorlake Phi sandbox image
npm run harness                             # synthesizer harness on hardcoded clusters
npm run snapshot                            # regenerate live bootstrap snapshot
```

---

90 seconds end to end. MCP-native. Real Tensorlake compute. Real Phi-3-mini. Real frontier oracle. Real Nia vault. First place is ours if we execute.
