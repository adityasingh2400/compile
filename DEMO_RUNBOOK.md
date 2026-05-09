# Demo Runbook — Saturday May 9 (Nozomio Hackathon)

**Goal:** judges see the constellation, hear the agent-writes-its-own-replacement punchline, and land on $66,800.

## Pre-demo checklist (Friday night)

```bash
npm install
npm run build                          # all 9 workspaces
npm test                               # confirm 22+ tests still green
npm run snapshot                       # regenerate bootstrap-snapshot.json
                                       # → packages/ui/public/bootstrap-snapshot.json
```

**Confirm `.env.local` is present at the repo root** (gitignored, never check in). Required keys:

```dotenv
TENSORLAKE_API_KEY=tl_apiKey_…
TENSORLAKE_ORGANIZATION_ID=org_…
TENSORLAKE_PROJECT_ID=project_…
NIA_API_KEY=nk_…
NIA_VAULT_ID=…
COMPILE_PHI_IMAGE=compile-phi-mini    # registered via `npm run build:phi-image`
COMPILE_PHI_MODEL=phi3:mini
```

**Live SDK smoke** — proves Tensorlake keys + phi image + gate path all round-trip:

```bash
cd packages/runtime && npm run live-smoke      # ~25s; all 3 phases must PASS
```

Healthy output: `[smoke] all phases PASS in <30000ms total`.

If you want to skip the slow phi phase while debugging: `COMPILE_SKIP_PHI=1 npm run live-smoke`.

## On-demo-day boot (in two terminals)

```bash
# Terminal A — fake daemon (drives the always-on visualization)
npm run daemon:fake          # listens on http://127.0.0.1:8421

# Terminal B — UI dev server
npm run dev:ui               # http://localhost:5173 (vite proxies /daemon/* to :8421)
```

**Confirm:** open `http://localhost:5173` — within ~5s the daemon-strip shows `DAEMON · LIVE · up 7h 23m · fire #4 · $66,800 saved · 7 inherited fns`. A fan-out fire begins automatically every ~45s, alternating with vault-hits. During a fan-out you'll see the center meter ramp **0 → 100,000 calls fired** and the throughput meter sit at **~3,500/s · TENSORLAKE 64-WORKER GRID · COMPILE-PHI-MINI**.

**Optional `?source=real`** — same demo, with the `LIVE` badge appearing next to "compile · acme/agent" in the top-left corner. Real call sites (including `rewrite_email_formal`) show in the SCAN/CLASSIFY lanes.

## ~10 minutes before going on stage

```bash
npm run warm    # builds runtime, then pre-warms the Tensorlake gate sandbox + phi sandbox
```

Healthy output: `warm() returned in <30000ms`, then `3 sample runPhi calls: <5000ms` average, ending with `sandbox is hot. Demo in ~10 min.` This pays the cold-start cost (failure mode #5) before judges see anything.

## On-stage operation

Two browser tabs open before going on:

1. **Tab A:** `http://localhost:5173?source=real` (stretch / hero version)
2. **Tab B:** `http://localhost:5173` (baked fallback if WiFi or anything misbehaves)

Default to Tab A. If anything stalls, switch to Tab B and hit `R`.

### Hotkeys (memorize)

- `space` — advance one phase (use if a phase stalls)
- `←` — back one phase (use if you talk past a screen)
- `R` — reset and replay full timeline from page 1
- `O` — toggle the dev panel (jump buttons 1–11)

### Talking track per page (~7 sec each, totaling 90s)

| Page | What you say |
|---|---|
| 1 CONNECT | "One line. MCP-native. Every agent that supports MCP installs in seconds." |
| 2 READING CODE | "We're scanning the repo with an AST walker. No traffic, no telemetry — just code." |
| 3 CLASSIFY | "Codifiability is decided **here**, from code structure alone. Two greens, three yellows, five reds." |
| 4 READING DOCS | "Nia Document Agent reads Acme's actual docs to generate realistic seed inputs." |
| 5 EXPANDING | "100 seeds become 100,000 synthetic calls via deterministic variation." |
| 6 CONSTELLATION | (let it run) "Tensorlake fires all 100K through 64 parallel workers. Sub-patterns emerge from chaos." |
| 7 CLUSTERS | "Seven sub-patterns. Six tier-1 typed branches. One tier-2 fallback for ambiguous mid-market language." |
| 8 AGENT WRITES | "**The agent writes the function that retires its own future calls.** Codex's keys, Acme's data — Compile spends zero frontier tokens." |
| 9 VALIDATE | "Held-out 15% slice the agent never saw. 98.7% — gate passed." |
| 10 VAULT WRITE | "Function lives in Nia Vault. Reachable from production immediately." |
| 11 RESULT | "Sixty-six thousand eight hundred dollars a year. We're honest about what we can't codify — six patterns are in the negative vault, never re-tried unless the input distribution shifts." |

## Failure-mode response matrix

| Symptom | Action |
|---|---|
| A page is blank / stuck | Press `space`. Page mount drivers populate content idempotently. |
| Constellation is empty | Press `space` (you advanced past stress_test before cells loaded). Press `←` to retreat. |
| Live badge missing | You're on Tab B (baked). That's fine — keep going. |
| Replay needed mid-pitch | Press `R`. Whole timeline restarts from page 1. |
| Whole UI unresponsive | Open the second tab. Don't try to debug live. |
| Center meter stuck at 100,000 | The fan-out finished or hasn't started. The meter only animates during a fan-out fire (every 90s in the fake daemon's cycle). Wait one cycle, or press `R`. |
| Daemon strip says "fixture mode" | The fake daemon isn't running — start it with `npm run daemon:fake`. The UI auto-falls-back to the deterministic 90s timeline within 5s, so the demo still works. |
| `live-smoke` Phase 1 fails | TENSORLAKE_API_KEY in `.env.local` is wrong / org+project mismatch. Re-paste from the Tensorlake dashboard. |
| `live-smoke` Phase 3 fails | `compile-phi-mini` image isn't registered. Run `npm run build:phi-image` (multi-minute) once, then re-smoke. Until then `COMPILE_SKIP_PHI=1` lets you exercise gate-only. |
| `npm run warm` >10s avg phi call | Phi sandbox is degraded. Re-run warm; if still slow, kill all running sandboxes from the Tensorlake dashboard and retry. The `TensorlakeWithLocalFallback` wrapper means the demo still serves correct outputs even if the Tensorlake side flakes. |

## What's wired (architecture proof for Q&A)

- `@compile/scanner` — real AST scanner against Acme repo (10 sites, 2g/3y/5r match)
- `@compile/synth-loader` — real Stage-2 fan-out with stub clients
- `@compile/stream` — `IBootstrapStream` interface; `MemoryBootstrapStream` ships, `ConvexBootstrapStream` wraps Convex
- `@compile/synthesizer` — assemble + holdout split + envelope validator
- `@compile/runtime` — Tensorlake wrapper + Vitest gate runner
- `@compile/mcp-server` — 9 MCP tools, npm-published as `@compile/mcp`
- `@compile/ui` — this app

Live snapshot (`?source=real`) loads `bootstrap-snapshot.json` produced by an actual `scanRepo` + `runStage2` invocation against `data/acme-agent`. Real call sites, real cluster shapes, deterministic playback. Best of both worlds.

## Tensorlake — what's actually live

Three production clients live in `packages/runtime/src/tensorlake.ts`:

- `RealTensorlakeClient` — calls `Sandbox.create` + `sandbox.run("node", …)` against `https://api.tensorlake.ai`. Two sandbox types: a **gate sandbox** (cpus=1, mem=1GB) for `runEmittedFunction`, and a **phi sandbox** (image=`compile-phi-mini`, cpus=2, mem=4GB) running `ollama serve` + `phi3:mini` for `runPhi`.
- `LocalFakeTensorlakeClient` — in-process executor + identity-shape phi handler. Used by Vitest tests and as the disaster-recovery fallback.
- `TensorlakeWithLocalFallback` — wraps the Real client; on any thrown `Error`, calls the LocalFake. Maps directly to ENG_REVIEW failure mode #2. Surfaces `onFallbackResolved(event)` so the daemon can emit `fallback_engaged` UI events.

The Tensorlake SDK auto-reads `TENSORLAKE_API_KEY`, `TENSORLAKE_ORGANIZATION_ID`, `TENSORLAKE_PROJECT_ID` from `process.env`. Once `.env.local` is loaded via `--env-file`, no further wiring is needed.

The visualization at the center of the dashboard is **driven entirely by daemon events** (`sandbox_spawn_start`, `phi_tick`, `oracle_agreement`, `fallback_engaged`, `fire_complete`). The UI subscribes to `/daemon/events` (vite proxy → `:8421`). The fake daemon synthesizes those events deterministically; a real daemon would emit the identical events while actually executing on Tensorlake. Same UI, either way.
