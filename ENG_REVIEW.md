# Engineering Review

Plan-eng-review of [`DESIGN.md`](./DESIGN.md) on 2026-05-07. Pre-implementation review for the Nozomio Hackathon Saturday May 9. Six architectural decisions locked, 1 critical gap flagged, four Friday derisks identified.

---

## Status: CLEAR

Plan ready to implement. Friday derisks must pass before Saturday morning.

## Decisions Locked

| # | Question | Decision | Rationale |
|---|---|---|---|
| **D1** | Tier-2 local LLM: real or recommendation? | Real Phi-3-mini in Tensorlake | Three-tier story has to actually work, not be shown. Audience can tell when something is mocked. |
| **D2** | Synthesizer prompt structure | Spec written to [`prompts/synthesizer.md`](./prompts/synthesizer.md) | Highest-risk artifact. Concrete spec lets Friday focus on quality calibration, not format iteration. |
| **D3** | Quality gate match criterion | Tier-aware: T1 = JSON-equality ≥98%, T2 = embedding cosine ≥0.92 + JSON Schema validation | Strict equality rejects T2 paraphrase variation; pure cosine lets T1 numeric drift slip. Threshold calibrated Friday from real distribution. |
| **D4** | MCP install mechanic on stage | Publish `@compile/mcp` to npm Friday night, demo `claude mcp add compile -- npx @compile/mcp` | One-line install matches Arlan's thesis. npm name claimed early to avoid squatters. |
| **D5** | Pre-rehearsed demo workflow | Sales lead qualification / ICP fit | Naturally splits across all three tiers — visually obvious on screen. Universal B2B GTM pain. |
| **D6** | Phi-3-mini cold-start mitigation | Pre-warm sandbox 10 min before demo + keep-alive throughout | Cold start in Tensorlake is unverified (5–30s plausible). Audience sees only warm latency. |
| **D7** | Demo UI scope | Full 5-panel pipeline dashboard (~3h build) | Visual assembly line IS the differentiator. Lane C becomes a full-time worktree. |

## Architecture Findings

Four issues surfaced and resolved during review. All have answers above (D1–D7).

## Code Quality (build-time recommendations)

Pre-implementation code, no blocking issues. Three discipline rules for the 9-hour build:

1. **Monorepo with packages**: `packages/mcp-server`, `packages/synthesizer`, `packages/runtime`, `packages/ui`. TypeScript workspaces. Each package has a single owner during the build.
2. **All sponsor integrations behind thin wrapper interfaces**: `INiaClient`, `ITensorlakeClient`, `IConvexClient`, `IInsForgeClient`. If any sponsor's API has issues during build, swap to a stub without changing call sites. Critical hedge.
3. **Schemas first**: write all Zod schemas (synthesizer input/output, MCP tool inputs/outputs, function contracts) before any implementation. Single source of truth, prevents 9-hour drift. **Mandatory for the UI lane** — panels bind to data shapes from minute one.

## Test Plan (hackathon-scoped)

```
PRIORITY 1 (must work):
  Synthesizer prompt validation harness          [Friday derisk]
    ├── Cluster A: ICP-fit Tier 1 input
    │     → expect synthesizable=true, tier=tier_1, conf>0.9
    ├── Cluster B: ambiguous lead Tier 2
    │     → expect tier=tier_2, conf>0.7
    └── Cluster C: novel positioning Tier 3
          → expect synthesizable=false

PRIORITY 2 (smoke, Saturday morning):
  MCP tool surface
    ├── compile.list_codified() returns array
    ├── compile.codify_prompt() returns function_id within 90s
    └── compile.run_codified() returns deterministic output

PRIORITY 3 (demo dry-run):
  End-to-end demo path
    └── Run the full pipeline scripted, twice, before doors open Saturday

OUT OF SCOPE for hackathon:
  - Drift watcher tests (component is stubbed)
  - Multi-customer auth tests (no auth)
  - Tier 2 quality gate calibration tests (calibrated Friday, not unit-tested)
```

The Friday synthesizer harness is the gating test. If it doesn't pass on 2 of 3 hardcoded clusters, ship Tier-1-only demo and stub Tiers 2/3.

## Performance

One issue, resolved (D6).

**Phi-3-mini cold start in Tensorlake** is unverified. Documented Tensorlake sandbox spin-up is 150ms, but hosting a 1B-parameter local LLM is a different beast — model load + first-token latency could be 5–30 seconds. The demo budget for Tier 2 is ~10s. Mitigation: pre-warm sandbox + keep-alive throughout demo (D6-A). If Friday verification shows cold start is unrecoverable, fall back to Tier-2 recommendation surface.

## NOT in Scope (deferred to v2)

| # | Item | Why deferred |
|---|---|---|
| 1 | Drift watcher with continuous 1% sampling | Stubbed Saturday with manual "trigger" button; real implementation needs production traffic |
| 2 | `nia vault dream` overnight cross-customer pattern discovery | Stubbed with 3 pre-seeded "discovered patterns" in Vault; needs multiple customers to be real |
| 3 | Multi-customer auth + per-customer Vault namespacing | Saturday is single-tenant |
| 4 | OpenAI-compatible gateway proxy | MCP-only Saturday; gateway adds in v2 for non-MCP agents |
| 5 | Tier 2 quality gate calibration test suite | Calibrated by hand Friday from distribution; unit tests post-hackathon |
| 6 | Hyperspell + Aside integrations | Stretches dropped to v2 |
| 7 | Production-scale Tier-2 local LLM cluster | One Phi-3-mini in Tensorlake is enough for demo |
| 8 | SOC2 audit trail | Mock InsForge ledger only |
| 9 | Real Helicone / Langfuse log import | v2 |

## What Already Exists

Nothing in the repo (fresh project post-pivot from RealityCI). External dependencies pulled as-is:
- `@modelcontextprotocol/sdk` — MCP server scaffold
- Tensorlake SDK — sandbox compute
- Convex starter — reactive state
- InsForge SDK — Postgres + edge functions
- Nia API client — substrate

## Failure Modes (top 5)

| # | Failure mode | Test? | Error handling? | User sees? |
|---|---|---|---|---|
| 1 | Synthesizer fails to emit valid JSON | Friday harness | Retry with truncated cluster, then return synthesizable=false | UI panel shows "synthesis failed, staying Tier 3" — graceful |
| 2 | **Tensorlake sandbox cold start >10s** | Friday verify only | Pre-warm + keep-alive | Audience sees pre-warmed sandbox, no failure visible |
| 3 | Codex emits broken TS code | Smoke only | Vitest catches syntax errors → re-emit once → if still bad, stay Tier 3 | UI panel shows "code rejected by quality gate" |
| 4 | npm `@compile/mcp` install fails on stage WiFi | Friday verify | Backup local-path install command pre-rehearsed | None if backup activates within 5s |
| 5 | Nia Vault write API errors during demo | Smoke only | Catch + retry once + log to InsForge audit | None — write retries silently |

**Critical gap (#2):** Phi cold start has no test, only Friday manual verification. Single point of failure for Tier 2 demo beat. **Friday night action**: if Tier 2 sandbox dies mid-demo, write a 1-line recovery script that falls back to Tier 1 + frontier in the demo narrative.

## Worktree Parallelization

Four lanes, all independent enough to run in parallel:

| Lane | Steps | Modules touched |
|---|---|---|
| **A — MCP server + synthesizer** | scaffold MCP server, write synthesizer prompt loop, wire Codex calls | `packages/mcp-server/`, `packages/synthesizer/` |
| **B — Tensorlake runtime + Phi sandbox** | sandbox spin-up, synthetic input generator, Phi cold-start verification, Tier-2 routing | `packages/runtime/` |
| **C — UI + Convex (full-time owner)** | 5-panel pipeline dashboard, reactive state, cost-decay chart, Vault explorer | `packages/ui/`, `convex/` |
| **D — Nia integration + Acme corpus** | Vault setup, Document Agent grounding, Connector ingestion, fake Notion/Slack data | `packages/nia/`, `data/` |

**Execution:** Launch A + B + C + D in parallel Friday night / Saturday morning. Merge Saturday hour 3. Hours 4–6 = integration. Hours 6–8 = polish + rehearse.

**Conflict flag:** Lanes A and D both touch `packages/mcp-server/`. Coordinate: Lane D writes the `INiaClient` interface first; Lane A imports it.

## Friday Derisks (priority order)

| Priority | Derisk | Pass criteria | Fallback if it fails |
|---|---|---|---|
| **1** | Synthesizer prompt validation | 2 of 3 hardcoded clusters classify correctly | Tier-1-only demo, stub Tiers 2/3 |
| **2** | Phi-3-mini cold start in Tensorlake | Cold start ≤10s OR persistent caching works | Tier 2 becomes recommendation surface |
| **3** | npm `@compile/mcp` publish + install | Fresh Claude Code session installs cleanly via `npx` | Backup `claude mcp add compile -- node /path/to/server.js` ready |
| **4** | Embedding cosine threshold calibration | Run 100 actual Tier 2 outputs through embedder, plot distribution | Adjust 0.92 hypothesis to lower edge of "obviously correct" cluster |

## Saturday Build Plan (9 hours, 9:15 AM → 6:00 PM)

| Hour | Lane | What ships |
|---|---|---|
| 0–1 | A | MCP server live, exposes 6 tools, Claude Code can install it locally |
| 1–2 | A | Synthesizer wired to real Codex calls; emits one passing function on a fixed input |
| 0–3 | B | Synthetic input generator + Tensorlake sandbox run loop; Phi-3-mini hosted |
| 0–6 | C | Pipeline UI: 5 panels wired, reactive state, animated transitions |
| 0–3 | D | Nia Vault setup, Document Agent grounding, Acme corpus indexed |
| 3.5–5 | A+D | Pattern miner — clusters via Nia semantic search, classifies T1/T2/T3 |
| 5–6.5 | A+B | Three-tier router; Tier-2 Phi call working end-to-end |
| 6.5–7.5 | all | Demo workflow polished end-to-end; Nia Vault writes confirmed |
| 7.5–8.5 | all | Rehearse demo twice; build 90-second backup video |
| 8.5–9 | all | Submit, eat, prepare to pitch |

## Adept-Grave Defense (pre-rehearse this answer)

> *"Adept tried this horizontally without fallback. We're vertical-first with explicit three-tier fallback — codified, local LLM, frontier. We never claim to replace the LLM. We claim to keep it off the hot path."*

If a judge asks: deliver this in 30 seconds, then pivot back to demo.

## Completion Summary

- Step 0 Scope Challenge: scope confirmed (one cut considered: Tier-2 → real, not stub)
- Architecture Review: 4 issues, all resolved (D2–D5)
- Code Quality Review: 0 blocking issues, 3 discipline recommendations
- Test Review: hackathon-scoped, gating test = Friday synthesizer harness
- Performance Review: 1 issue resolved (D6)
- Failure modes: 5 mapped, 1 critical gap flagged (Phi cold start)
- Outside voice (Codex): skipped — time pressure
- Parallelization: 4 lanes, all parallel; single coordination point on `INiaClient`
- Lake Score: 7/7 decisions chose complete option
