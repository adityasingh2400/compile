# Engineering Review

Plan-eng-review of [`DESIGN.md`](./DESIGN.md) on 2026-05-07. Pre-implementation review for the Nozomio Hackathon Saturday May 9. **Twelve architectural decisions locked**, 1 critical gap flagged, five Friday derisks identified. D11 + D12 added 2026-05-07 (afternoon) after canonicalizing **two-stage codifiability** — static-prior + 100K synthetic-load — as the bootstrap path. D10 was revised in the same pass.

The 3-minute demo constraint is the load-bearing requirement. Proxy observation is real and ships, but it cannot be the demo's hero loop because we cannot stand on stage and "watch 48 hours of traffic." Bootstrap must finish in front of judges in <90 seconds.

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
| **D5** | Pre-rehearsed demo workflow | Sales lead qualification / ICP fit, run against Acme demo repo (`acme/agent`) we control | Naturally splits across all three tiers — visually obvious in the synthetic-load grid. Universal B2B GTM pain. Repo is ours, scanner detection is bulletproof. |
| **D6** | Phi-3-mini cold-start mitigation | Pre-warm sandbox 10 min before demo + keep-alive throughout | Cold start in Tensorlake is unverified (5–30s plausible). Audience sees only warm latency. |
| **D7** | Demo UI scope | Full 5-panel pipeline dashboard (~3h build) **with the synthetic-load grid as the centerpiece panel** | Visual assembly line IS the differentiator. The 100K-call grid is the screenshot judges take home. Lane C becomes a full-time worktree. |
| **D8** | Uncodifiable patterns: re-synthesize every miss? | **Negative Vault cache** — store `synthesizable=false` verdicts as first-class Vault entries; check before triggering synthesis | Without this, every Tier-3-only pattern re-triggers a 100K-input sandbox run. Synthesis bill replaces the LLM bill — product eats itself. Three-state lookup: codified hit / negative hit / genuine unknown. |

### D8 detail: negative cache retry policy

The five `synthesizable=false` reason codes don't behave the same — the negative Vault entry needs a retry policy field, not just a flag:

| Reason | Retry policy |
|---|---|
| `creative_task` | Sticky — never retry. Output variance is intrinsic to task value. |
| `novel_reasoning_required` | Sticky — never retry. |
| `high_variance_outputs` | Re-evaluate only if input distribution shifts (new cluster centroid in Nia semantic space) |
| `insufficient_data` | Expiring — retry once observed trace count for the cluster crosses 30 (then 100) |
| `low_static_prior` | Expiring — retry on next code change to the call site (git SHA mismatch) |

Schema addition to synthesizer output envelope (see `prompts/synthesizer.md`): `retry_policy: { type: "sticky" | "expiring", retry_when_traces?: number, retry_on_distribution_shift?: bool, retry_on_code_change?: bool }`.

Pattern miner checks negative Vault before sandbox spin-up via the same `nia_grep` semantic match used for positive hits — near-zero added cost.

**Demo upside:** the savings panel shows *both* codified savings AND avoided-synthesis cost from negative cache hits. Direct answer to the obvious judge question: *"doesn't the 100K-call sandbox cost money?"*

| **D9** | Where does codegen run? | **In the customer's own agent, on the customer's own LLM keys** — not behind Compile's API key | (a) Customer's prompts/traces never leave their trust boundary; (b) Compile's unit economics don't depend on absorbing synthesis cost — we make money on routing, not codegen; (c) the customer pays for codegen on the LLM bill they were already paying anyway. The MCP round-trip is `compile.request_synthesis()` (returns spec) → agent runs codegen → `compile.submit_synthesis()` (Compile validates against private holdout, gates ≥98%, writes Vault). |

### D9 detail: synthesis round-trip protocol

```
1. Customer agent calls: compile.request_synthesis(cluster_id)
2. Compile assembles spec from Stage-2 synthetic traces:
   { prompt_template, tool_schemas, input_schema, output_schema,
     traces { train, val }   ← holdout indices NOT included,
     axis_scores, customer_docs, request_id, holdout_count }
3. Compile returns spec to agent (single MCP response)
4. Customer's agent runs codegen on its own LLM key
   → emits { code, tests, contract, tier, ... } per synthesizer.md envelope
5. Customer agent calls: compile.submit_synthesis(request_id, envelope)
6. Compile validates in Tensorlake sandbox:
   - run emitted code on private holdout synthetic traces (15% slice)
   - tier-aware match: T1 = JSON-equality ≥98%, T2 = embedding cosine ≥0.92 + JSON Schema validation
   - schema-stability axis re-verified on holdout
7. Compile writes outcome to Nia Vault (positive or negative entry per D8)
8. Returns { function_id?, gate_verdict, holdout_match_rate, savings_estimate } to agent
```

**Hackathon implication:** Lane A no longer needs Codex API integration — it implements the request/submit MCP surface and the validation harness. The Saturday demo's codegen step runs in Claude Code (the demo machine's agent), visibly. Removes one external dependency from the critical path.

| **D10** | How is "codifiability" measured before triggering synthesis? | **Two-stage codifiability: structural prior from code (Stage 1) + empirical confirmation from 100K synthetic calls (Stage 2). 3-axis rubric (schema stability, determinism, economic value) computed at both stages.** Replaces the original LLM-vibes-based tier-decision tree AND replaces the proxy-observed approach. | Stage 1 is pure AST (no LLM oracle, no runtime data) — gives us a 90-second onboarding story. Stage 2 grounds the prior in real LLM behavior on 100K realistic inputs (generated by Nia Document Agent from customer docs). Schema stability is structural; determinism is replay-based; oracle agreement is sampled at 1% to keep cost low. The 70/15/15 train/val/holdout split is now over synthetic traces, with holdout kept private to Compile to prevent the agent overfitting its emitted code (resolves Codex audit "gameable 98% gate"). Economic value IS the operational cost model judges expect. |

### D10 detail: the two-stage rubric

**Stage 1 — Static Prior (instant):**

| Axis | Computed how (no runtime data) | Threshold to enter Stage 2 |
|---|---|---|
| Schema stability prior | `responseFormat` / Zod schema / structured output API present? Bounded tool array? | ≥0.5 |
| Determinism prior | `temperature: 0` declared? Prompt template fully parameterized at compile time? | ≥0.5 |
| Economic value prior | Telemetry on call site (logging, metrics) gives volume estimate; if absent, customer-supplied or skip | non-zero monthly volume |

A site failing any Stage-1 prior with `<0.5` goes straight to negative Vault with `reason: low_static_prior` (expiring on code change).

**Stage 2 — Synthetic Confirmation (28s, in Tensorlake):**

| Axis | Threshold to pass | Computed from |
|---|---|---|
| Schema stability | ≥0.95 | % of 100K outputs that validate against inferred JSON Schema |
| Determinism | ≥0.95 | Replay K=200 inputs through frontier; cosine similarity + JSON-equality |
| Oracle agreement | ≥0.92 | 1K oracle samples through customer's frontier vs candidate path; embedding cosine + structural match |
| Economic value | annual_savings_usd > sandbox + maintenance cost AND break_even_hits achievable in 90 days | volume × per-call cost − sandbox cost − maintenance |

A cluster failing any Stage-2 axis goes to negative Vault with that axis as the `reason`. A cluster failing only on the candidate-path side (e.g., the proposed Tier-1 fn diverges from frontier on >2% of inputs) gets demoted to Tier-2 and re-tested with Phi-3-mini.

| **D11** | What's the scope of the static analyzer for the hackathon? | **TS + Python AST scan, hardcoded for `acme/agent` demo repo.** Detect calls to `anthropic.messages.create`, `openai.chat.completions.create`, MCP tool invocations matching a fixed pattern set. Heuristics for `responseFormat`, `temperature`, prompt-template detection. ~600 LOC. Generalize post-hackathon. | We control the Acme repo, so we can guarantee scanner coverage on the demo. Generalizing the scanner to arbitrary repos (mixed languages, indirection, dynamic prompts) is a multi-week project — out of scope for 9 hours. The demo doesn't need it; the *narrative* doesn't depend on it (judges accept "we wrote the scanner for these SDKs and are extending"). |

### D11 detail: scanner hedge

If AST scanner has bugs Friday night, fall back: pre-compute the call-site list as a JSON file checked into the demo repo (`acme/agent/.compile-scan.json`). Scanner reads cached file. Demo still works; only the "live AST scan" beat is faked. Acceptable degradation — Stage 2 is the real visual centerpiece anyway.

| **D12** | How are 100,000 synthetic inputs generated cheaply and realistically? | **Nia Document Agent generates 100 seed inputs per call site from customer docs (Acme ICP doc, pricing, policy). One-time frontier-LLM call per seed batch (~$0.50). Programmatic variation expands seeds → 100K via parameter sweeps + value-list combinations.** | Realistic synthetic distributions matter — if the inputs don't look like production, the cluster boundaries are noise. Grounding in customer docs gives semantic realism; programmatic variation gives volume coverage. Total generation cost: ~$0.50 per call site, ~$2.50 per onboarding. Negligible compared to the ~$10 sandbox compute. |

### D12 detail: input variation strategy

Four programmatic variation knobs applied to seeds:

1. **Field substitution from enumerated value lists** (industries, employee bands, revenue ranges) — produces ~10× expansion per seed
2. **Numeric perturbation within distribution-aware bands** (employee count ±20%, revenue ±30%) — 5×
3. **Optional-field inclusion/exclusion combinatorics** — 4×
4. **Surface-form paraphrase via small local LLM** (free in Tensorlake, batched) — 5×

100 seeds × 10 × 5 × 4 × 5 = 100,000 inputs. Variation is deterministic (seeded RNG) so demo runs are reproducible.

---

## Architecture Findings

Five issues surfaced and resolved during review (D1–D7, D8, D10–D12). All have answers above.

## Code Quality (build-time recommendations)

Pre-implementation code, no blocking issues. Three discipline rules for the 9-hour build:

1. **Monorepo with packages**: `packages/scanner`, `packages/mcp-server`, `packages/synth-loader`, `packages/synthesizer`, `packages/runtime`, `packages/ui`, `packages/nia`. TypeScript workspaces. Each package has a single owner during the build.
2. **All sponsor integrations behind thin wrapper interfaces**: `INiaClient`, `ITensorlakeClient`, `IConvexClient`, `IInsForgeClient`. If any sponsor's API has issues during build, swap to a stub without changing call sites. Critical hedge.
3. **Schemas first**: write all Zod schemas (synthesizer input/output, MCP tool inputs/outputs, function contracts, **scanner call-site descriptor, synth-loader job spec**) before any implementation. Single source of truth, prevents 9-hour drift. **Mandatory for the UI lane** — panels bind to data shapes from minute one. **Mandatory for the synth-loader lane** — Convex subscriptions render the 100K-call grid from streamed records.

## Test Plan (hackathon-scoped)

```
PRIORITY 1 (must work):
  Static scanner — Acme repo coverage         [Friday derisk #1]
    └── Scanner finds 23 call sites in acme/agent
        ├── 5 marked GREEN (Stage-1 priors all >0.7)
        ├── 3 marked YELLOW (mixed priors)
        └── 15 marked RED or non-LLM

  100K synthetic-load fan-out                  [Friday derisk #2]
    └── Tensorlake 64-worker grid completes in ≤30s wall
        ├── Throughput ≥3,000 req/s sustained
        ├── Convex subscription updates UI grid in real time
        └── 3-axis scores converge within 28s

  Synthesizer prompt validation harness        [Friday derisk #3]
    ├── Cluster A: ICP-fit Tier 1 input
    │     → expect synthesizable=true, tier=tier_1, conf>0.9
    ├── Cluster B: ambiguous lead Tier 2
    │     → expect tier=tier_2, conf>0.7
    └── Cluster C: novel positioning Tier 3
          → expect synthesizable=false

PRIORITY 2 (smoke, Saturday morning):
  MCP tool surface
    ├── compile.scan_repo() returns 23-site report in ≤500ms
    ├── compile.synthetic_confirm() streams updates and finishes ≤30s
    ├── compile.list_codify_candidates() returns ranked array
    ├── compile.request_synthesis() returns valid spec
    ├── compile.submit_synthesis() validates and writes Vault
    └── compile.run_codified() returns deterministic output

PRIORITY 3 (demo dry-run):
  End-to-end demo path
    └── Run the full pipeline scripted, twice, before doors open Saturday

OUT OF SCOPE for hackathon:
  - Drift watcher tests (component is stubbed; proxy mode demoed via blinking-light UI element)
  - Multi-customer auth tests (no auth)
  - Scanner generalization tests (TS+Python only on Acme repo)
  - Tier 2 quality gate calibration tests (calibrated Friday, not unit-tested)
```

The Friday gating tests are: scanner coverage on Acme, Tensorlake 64-worker fan-out, synthesizer envelope on 3 hardcoded clusters. **If any of those three fail, fall back to a degraded demo (cached-scan + cached-grid + Tier-1-only synthesis).**

## Performance

Two issues. One resolved (D6, Phi cold start). One new from the architectural pivot.

**New: Tensorlake 64-worker fan-out throughput** is unverified. Documented Tensorlake parallelism is "elastic," but sustaining 3,000+ req/s on a single sandbox grid is untested at scale. If wall time on Friday's first run exceeds 45s, drop the visible call count to 25,000 and adjust narrative ("statistically significant sample"). Mitigation: pre-warm grid 10 min before demo (same as Phi).

## NOT in Scope (deferred to v2)

| # | Item | Why deferred |
|---|---|---|
| 1 | Always-on proxy mode (drift watcher, cluster refiner, new-pattern miner) | Stubbed Saturday with a blinking "monitoring" status indicator on the dashboard; real implementation needs production traffic and is post-hackathon |
| 2 | `nia vault dream` overnight cross-customer pattern discovery | Stubbed with 3 pre-seeded "discovered patterns" in Vault; needs multiple customers to be real |
| 3 | Multi-customer auth + per-customer Vault namespacing | Saturday is single-tenant |
| 4 | OpenAI-compatible gateway proxy | MCP-only Saturday; gateway adds in v2 for non-MCP agents |
| 5 | Tier 2 quality gate calibration test suite | Calibrated by hand Friday from synthetic distribution; unit tests post-hackathon |
| 6 | Scanner generalization (mixed-language repos, dynamic prompt construction, indirection) | Hardcoded Acme repo Saturday; generalize post-hackathon |
| 7 | Hyperspell + Aside integrations | Stretches dropped to v2 |
| 8 | Production-scale Tier-2 local LLM cluster | One Phi-3-mini in Tensorlake is enough for demo |
| 9 | SOC2 audit trail | Mock InsForge ledger only |
| 10 | Real Helicone / Langfuse log import | v2 |

## What Already Exists

Nothing in the repo (fresh project post-pivot from RealityCI). External dependencies pulled as-is:
- `@modelcontextprotocol/sdk` — MCP server scaffold
- Tensorlake SDK — 64-worker sandbox compute
- Convex starter — reactive state for the synthetic-load grid
- InsForge SDK — Postgres + edge functions
- Nia API client — substrate (Vault + Document Agent)
- `ts-morph` — TypeScript AST traversal for the scanner
- `tree-sitter-python` — Python AST traversal for the scanner

## Failure Modes (top 6)

| # | Failure mode | Test? | Error handling? | User sees? |
|---|---|---|---|---|
| 1 | **Static scanner misses a call site or false-positives a non-LLM call** | Friday derisk #1 against Acme repo | If scanner output diverges from cached `.compile-scan.json` baseline by >10%, fall back to cached file | UI panel shows "scanner cache" badge — graceful, judges don't notice |
| 2 | **Tensorlake 64-worker grid throttles or fails mid-run** | Friday derisk #2 | Pre-warm + keep-alive; if grid fails, replay pre-recorded run from disk | Audience sees pre-warmed grid; if total failure, cached playback within 5s |
| 3 | **Phi-3-mini cold start >10s** (Tier-2 in synthetic load) | Friday verify only | Pre-warm + keep-alive | None visible |
| 4 | Customer agent emits invalid JSON envelope (synthesis step) | Friday derisk #3 | Compile rejects via Zod, agent retries once, then stays Tier 3 | UI panel shows "synthesis failed, staying Tier 3" — graceful |
| 5 | Customer agent emits broken TS code | Smoke only | Validation harness catches via Vitest → returns gate_verdict=fail to agent → agent re-emits once → if still bad, negative Vault entry | UI panel shows "code rejected by quality gate" |
| 6 | npm `@compile/mcp` install fails on stage WiFi | Friday derisk #4 | Backup local-path install command pre-rehearsed | None if backup activates within 5s |
| 7 | Nia Vault write API errors during demo | Smoke only | Catch + retry once + log to InsForge audit | None — write retries silently |
| 8 | Customer agent times out on synthesis (live demo: Claude Code emits TS in front of audience) | Friday derisk #5 | Pre-record one synthesis run, replay from cache for the live demo; only show *real* synthesis on the stretch beat | Audience sees deterministic pacing |

**Critical gap (#2):** Tensorlake fan-out has no scale test, only Friday manual verification. Single point of failure for the synthetic-load grid (the visual centerpiece of the demo). **Friday night action**: record a successful run to disk; if grid fails Saturday, demo plays the recording and narrates over it ("watching Tuesday's run, our 64-worker grid…").

## Worktree Parallelization

Five lanes, all independent enough to run in parallel:

| Lane | Steps | Modules touched |
|---|---|---|
| **A — MCP server + synthesizer** | scaffold MCP server, write synthesizer prompt loop, validation harness, request/submit round-trip | `packages/mcp-server/`, `packages/synthesizer/` |
| **B — Tensorlake runtime + 100K fan-out + Phi sandbox** | 64-worker grid setup, sandbox spin-up, synthetic input generator coordination, Phi cold-start verification, Tier-2 routing | `packages/runtime/`, `packages/synth-loader/` |
| **C — UI + Convex (full-time owner)** | 5-panel pipeline dashboard, **synthetic-load grid (the centerpiece)**, reactive state, cost-decay chart, Vault explorer | `packages/ui/`, `convex/` |
| **D — Nia integration + Acme corpus + synthetic input generation** | Vault setup, Document Agent grounding, Connector ingestion, fake Notion/Slack data, **100-seed synthetic input generator backed by Nia Document Agent** | `packages/nia/`, `data/` |
| **E — Static scanner (new lane)** | TS + Python AST traversal for `acme/agent`, prior computation heuristics, JSON output for cached fallback | `packages/scanner/` |

**Execution:** Launch A + B + C + D + E in parallel Friday night / Saturday morning. Merge Saturday hour 3. Hours 4–6 = integration. Hours 6–8 = polish + rehearse.

**Conflict flag:** Lanes A, D, and E all touch `packages/mcp-server/` indirectly through schema definitions. Coordinate: Lane E writes the `CallSiteDescriptor` Zod schema first; Lanes A and B import it. Lane D writes the `INiaClient` interface first; Lane A imports it.

**Lane sizing:**
- Lane C is the largest (full-time owner) — the 5-panel UI plus the live synthetic-load grid is ~6h of work
- Lane B is second-largest — Tensorlake fan-out + Phi hosting is ~5h
- Lane E is smallest but on the critical path — ~3h, must finish by hour 4

## Friday Derisks (priority order)

| Priority | Derisk | Pass criteria | Fallback if it fails |
|---|---|---|---|
| **1** | **Static scanner on Acme repo** | Scanner finds all 23 call sites, classifies 5 as GREEN matching hand-labeled ground truth | Use pre-computed `.compile-scan.json`; demo narrates "cached scan from Tuesday" |
| **2** | **Tensorlake 64-worker fan-out + Convex grid rendering** | 100K calls complete in ≤30s wall; Convex grid updates at ≥30fps | Drop visible count to 25K; or replay pre-recorded grid run |
| **3** | Synthesizer round-trip via MCP | Claude Code (or Codex CLI) receives synthesis spec, emits valid envelope, Compile's validator gates correctly on 2 of 3 hardcoded clusters | Tier-1-only demo with pre-baked function; stub the agent-driven path |
| **4** | npm `@compile/mcp` publish + install | Fresh Claude Code session installs cleanly via `npx` | Backup `claude mcp add compile -- node /path/to/server.js` ready |
| **5** | Pre-cached synthesis playback for live demo | One full synthesis run captured to disk Friday night; demo replays it within the 75–90s budget | Live synthesis on stretch beat only; main demo uses cached run |
| **6** | Phi-3-mini cold start in Tensorlake | Cold start ≤10s OR persistent caching works | Tier 2 becomes recommendation surface |
| **7** | Embedding cosine threshold calibration | Run 100 actual Tier 2 outputs through embedder, plot distribution | Adjust 0.92 hypothesis to lower edge of "obviously correct" cluster |

## Saturday Build Plan (9 hours, 9:15 AM → 6:00 PM)

| Hour | Lane | What ships |
|---|---|---|
| 0–1 | A | MCP server live, exposes 9 tools, Claude Code can install it locally |
| 0–1 | E | Static scanner walks Acme repo, returns 23 call sites with priors |
| 1–2 | A | Synthesizer wired to validation harness; emits one passing function on a fixed input (mocked agent) |
| 0–3 | B | 64-worker Tensorlake grid + Phi-3-mini hosted + 100K synthetic load completes in ≤30s |
| 0–3 | D | Nia Vault setup, Document Agent grounding, Acme corpus indexed, 100-seed synthetic input generator working |
| 0–6 | C | Pipeline UI: 5 panels wired, **synthetic-load grid renders from Convex subscription**, reactive state, animated transitions |
| 3.5–5 | A+D | Pattern miner — clusters via Nia semantic search on Stage-2 outputs, classifies T1/T2/T3 |
| 5–6.5 | A+B | Three-tier router; Tier-2 Phi call working end-to-end |
| 6.5–7.5 | all | Demo workflow polished end-to-end; Nia Vault writes confirmed; cached synthesis playback recorded |
| 7.5–8.5 | all | Rehearse demo twice; build 90-second backup video; record Tensorlake grid run as fallback |
| 8.5–9 | all | Submit, eat, prepare to pitch |

## Adept-Grave Defense (pre-rehearse this answer)

> *"Adept tried this horizontally without fallback. We're vertical-first with explicit three-tier fallback — codified, local LLM, frontier. We never claim to replace the LLM. We claim to keep it off the hot path. And unlike Adept, we prove it works on your code in 90 seconds, not after a six-month integration."*

If a judge asks: deliver this in 30 seconds, then pivot back to demo.

## Anticipated Judge Questions (with answers)

| Q | A |
|---|---|
| *"Why synthetic data? Real production traffic is more honest."* | We do both. Bootstrap is synthetic because customers won't wait 48 hours for a report. Always-on proxy mode refines our priors with real distributions. The synthetic inputs are grounded in customer docs via Nia, so they match the customer's input distribution; the 1% oracle sample uses real frontier LLM as ground truth. |
| *"Doesn't 100,000 calls cost a fortune?"* | ~$10 in sandbox compute (99% of calls hit our Tier-1 candidate or local Phi-3-mini, not frontier). The 1% oracle sample (1,000 calls) goes through the customer's frontier LLM at their cost — about $50 one-time per onboarding. They get a typed function worth $31k/year. |
| *"What if the synthetic distribution doesn't match production?"* | Stage 2 results are marked *predicted*. Always-on proxy mode (Vault drift watcher) refines them with real traffic over time — schema or output divergence triggers re-validation. Honest framing: predicted savings until 30 days of real traffic confirm. |
| *"How do you handle dynamic prompts (constructed at runtime)?"* | Static scanner detects them and marks the call site `low_static_prior` (negative Vault, expiring on code change). Always-on proxy mode picks them up later if their distribution stabilizes. |
| *"What about 98% gate gameability?"* | 15% holdout slice of the synthetic traces is kept private to Compile — agent never sees it. Agent emits code from train+val, Compile validates against holdout. Resolves the Codex audit critique. |

## Completion Summary

- Step 0 Scope Challenge: scope confirmed; one significant pivot in this review (proxy → static + synthetic for bootstrap)
- Architecture Review: 7 issues, all resolved (D2–D5, D8, D9, D10, D11, D12)
- Post-review audit (2026-05-07 morning): dual-pass audit run by Claude + Codex consult. D8 added in response to negative-cache gap; D9+D10 added in response to (a) "we shouldn't burn our own tokens on codegen for the customer" and (b) Codex findings on oracle circularity, gameable 98% gate, vibes-based tier classification.
- Post-review revision (2026-05-07 afternoon): D10 revised, D11 + D12 added, after recognizing the proxy-only bootstrap path could not be demonstrated within the 3-minute hackathon constraint. Two-stage codifiability (static prior + 100K synthetic confirmation) became the canonical bootstrap; proxy demoted to always-on monitoring layer. DESIGN.md rewritten to match.
- Code Quality Review: 0 blocking issues, 3 discipline recommendations
- Test Review: hackathon-scoped, gating tests = scanner coverage, Tensorlake fan-out, synthesizer harness
- Performance Review: 2 issues — D6 (Phi cold start, resolved), Tensorlake fan-out (Friday derisk #2)
- Failure modes: 8 mapped, 1 critical gap flagged (Tensorlake fan-out at scale)
- Outside voice (Codex): consulted in pre-revision audit; remaining concerns deferred to v2
- Parallelization: 5 lanes, all parallel; coordination points on `INiaClient` and `CallSiteDescriptor` schemas
- Lake Score: 9/9 decisions chose complete option (Tier-2 real, full UI, two-stage codifiability, scanner real-not-recommendation, synthetic input generation real-not-faked)
