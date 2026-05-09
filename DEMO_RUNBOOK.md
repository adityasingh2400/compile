# Demo Runbook — Saturday May 9 (Nozomio Hackathon)

**Goal:** judges see the constellation, hear the agent-writes-its-own-replacement punchline, and land on $66,800.

## Pre-demo checklist (Friday night)

```bash
npm install
npm run build                          # all 9 workspaces
npm test                               # confirm 22+ tests still green
npm run snapshot                       # regenerate bootstrap-snapshot.json
                                       # → packages/ui/public/bootstrap-snapshot.json
npm run dev:ui                         # boot vite on :5173
```

**Confirm:** open `http://localhost:5173` — auto-timeline runs end-to-end (~90s) and lands on the result page with $66,800.

**Then:** open `http://localhost:5173?source=real` — same demo, but the `LIVE` badge appears next to "compile · acme/agent" in the top-left corner. Real call sites including `rewrite_email_formal` show on Page 3.

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

## What's wired (architecture proof for Q&A)

- `@compile/scanner` — real AST scanner against Acme repo (10 sites, 2g/3y/5r match)
- `@compile/synth-loader` — real Stage-2 fan-out with stub clients
- `@compile/stream` — `IBootstrapStream` interface; `MemoryBootstrapStream` ships, `ConvexBootstrapStream` wraps Convex
- `@compile/synthesizer` — assemble + holdout split + envelope validator
- `@compile/runtime` — Tensorlake wrapper + Vitest gate runner
- `@compile/mcp-server` — 9 MCP tools, npm-published as `@compile/mcp`
- `@compile/ui` — this app

Live snapshot (`?source=real`) loads `bootstrap-snapshot.json` produced by an actual `scanRepo` + `runStage2` invocation against `data/acme-agent`. Real call sites, real cluster shapes, deterministic playback. Best of both worlds.
