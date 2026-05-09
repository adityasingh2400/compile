# Compile

> **MCP server that compiles repeat LLM work out of the agent loop — codifiability decided from your code in milliseconds, then confirmed by 100,000 synthetic calls in 28 seconds.**

Built for the [Nozomio Hackathon](https://luma.com/rshibq6i) — May 9, 2026, EF office, San Francisco. Theme: *Build the Future of AI Agents.*

---

## The Pitch

**Point Compile at a customer's repo. 90 seconds later they have their *personal* number** — which of their LLM call sites are deterministically replaceable, what those calls cost per month, and a typed function that retires the most expensive one. Not industry vibes, not hand-waving — actual line items derived from their actual code, then stress-tested against 100,000 synthetic calls in a sandbox before we tell them anything.

> *"Call site #7 — `classify_lead_tier()` — 8,400 calls/day, $31k/year, 7 sub-patterns discovered, 6 deterministically reproducible, replaceable with a 12-line typed function. Want us to retire it?"*

That's the wedge. The supporting math (research across the Anthropic Economic Index, OpenAI State of Enterprise AI, a16z LLM cost surveys) is why the line items exist:

- **~38% of production LLM volume is highly codifiable** — extraction, classification, glue, boilerplate codegen, repetitive browser flows
- **~34% is partially codifiable** — RAG retrieval, support replies, partial summarization, sales research. Small local LLMs handle these at 1/100th the cost of frontier
- **~28% is genuinely frontier-only** — creative work, novel reasoning, true open-ended tasks

Today the entire 100% gets routed to a frontier model at frontier prices. The 38% that could be a typed function and the 34% that could be a 1B-parameter local model are paying for capability they don't use.

**Compile is an MCP server that any AI agent installs in one line. Three pipelines, three timescales:**

1. **Bootstrap (90 seconds, code-first):** Static analysis of the customer's repo finds every LLM call site and **decides codifiability from code structure alone** — no LLM calls yet. Only then do we fire 100,000 synthetic calls per codifiable candidate to *confirm* the structural verdict and *discover the sub-pattern shape* the synthesizer needs.

2. **Synthesis (on-demand, agent-driven):** When a candidate clears both the static and empirical gates, Compile returns a synthesis spec to the *customer's own agent*, which runs the codegen using its *own LLM keys* on its *own data* and submits the typed function back. Compile validates against a private 15% holdout of synthetic traces, gates at ≥98% match, and writes to Nia Vault.

3. **Always-on (continuous, proxy):** Once installed, Compile observes real traffic to refine priors with production distributions, catch drift, and surface new clusters that emerge over time.

**The codegen happens in the customer's agent context — Compile spends zero frontier-LLM tokens.** The agent literally writes its own replacement, billed to the agent's existing API key. The agent puts itself out of a job, and the codified library belongs to the customer.

---

## Two-Stage Codifiability — Where the Decision Is Made vs. Confirmed

The single most important architectural distinction in Compile:

> **Codifiability is *decided* from code (Stage 1, causal evidence). It is *confirmed and shaped* by synthetic calls (Stage 2, empirical evidence).**

These are different questions answered by different evidence at different times. Conflating them is the trap every observability product falls into. Compile doesn't.

### Stage 1 — The Codifiability Decision (instant, from code alone)

Compile walks the customer's repo with an AST scanner, finds every LLM call site (`anthropic.messages.create`, `openai.chat.completions.create`, MCP tool invocations, etc.), and **decides codifiability from the code itself** — no LLM calls, no traffic, no synthetic data.

The decision rests on structural signals that are causal, not correlative:

| Code signal | What it proves | Prior contribution |
|---|---|---|
| `responseFormat: zodSchema(...)` | Output schema is bounded by construction — the LLM cannot return arbitrary text | +0.4 schema stability |
| `temperature: 0` + templated prompt | Determinism intent is explicit at the API level | +0.3 determinism |
| Bounded `tool` array (≤10 schemas) | Output space is finite — every reachable output is enumerable | +0.2 schema stability |
| Prompt template fully parameterized at compile time | No runtime prompt construction — input space is typed | +0.2 determinism |
| Call site instrumented with logging | Volume estimate available from telemetry | enables economic-value scoring |
| Few-shot examples present in prompt | Pattern is well-defined and demonstrated | +0.1 schema stability |
| Tool call followed by structured parse | Pipeline shape is deterministic by code structure | +0.1 determinism |

Each call site gets three priors (schema, determinism, economic) in `[0, 1]`. The output is a ranked list with red/yellow/green pills:

```
   STATIC SCAN — acme/agent — 23 LLM call sites found

   ●  classify_lead_tier              schema 0.92 │ det 0.95 │ econ 0.87  GREEN
   ●  extract_invoice_fields          schema 0.96 │ det 0.91 │ econ 0.81  GREEN
   ●  resolve_company_domain          schema 0.88 │ det 0.83 │ econ 0.74  GREEN
   ◐  summarize_support_thread        schema 0.71 │ det 0.62 │ econ 0.69  YELLOW
   ◐  draft_outreach_subject          schema 0.65 │ det 0.51 │ econ 0.58  YELLOW
   ○  generate_marketing_copy         schema 0.34 │ det 0.18 │ econ 0.42  RED
   ...
```

**This is where codifiability is decided.** Greens advance to Stage 2 for empirical confirmation. Yellows advance to Stage 2 with stricter thresholds. Reds go straight to the negative Vault with `reason: low_static_prior` (sticky, expiring on code change).

**Why code-first is causal, not correlative.** A `responseFormat: leadTierSchema` declaration on a `temperature: 0` call is not evidence that outputs *might* be bounded — it is the *cause* that they are. Reading that cause directly is strictly stronger than inferring it from a sample of effects, no matter how large the sample. This dodges the "how many traces is enough" sampling problem entirely.

**Stage 1 cost: zero LLM tokens, milliseconds wall time.** Pure AST work.

### Stage 2 — Empirical Confirmation + Sub-Pattern Discovery (28s, in Tensorlake)

For every Stage-1 GREEN (and stricter-threshold YELLOWs), Compile fires **100,000 synthetic calls** through a Tensorlake sandbox grid. Stage 2 does **not** decide codifiability — that was decided in Stage 1. Stage 2 has three different jobs:

| Job | What it does | Why we need it |
|---|---|---|
| **1. Empirical confirmation** | Replay 100K synthetic inputs against the customer's frontier LLM (sampled at 1%) and against the candidate codified path. Compute schema-stability, determinism, and oracle-agreement on real outputs. | Validates the structural prior from Stage 1. If the code's structural signals lied (rare, but possible), evidence overrides the prior. |
| **2. Sub-pattern discovery** | Cluster the 100K outputs in embedding space. A call site like `classify_lead_tier` doesn't have one shape — it has 7 sub-patterns ("fintech-large", "healthcare-mid", "edu-small", etc.). | The synthesizer needs the branch boundaries to write the typed function with the right `if/switch` structure or the right Tier-2 few-shots. |
| **3. Tier assignment per cluster** | Each cluster gets T1 / T2 / T3 based on whether the candidate matches frontier on that subset. | The codified function handles common clusters at T1, hands rare clusters to T2, falls through to T3 for genuine edge cases. |

**Architecture:**

```
   SYNTHETIC LOAD ARCHITECTURE
   ───────────────────────────

           ┌─────────────────────────────────────────────────────────┐
           │  Nia Document Agent reads customer's docs (Acme corpus) │
           │  Generates 100 seed input templates per call site       │
           │  Programmatic variation expands seeds → 100,000 inputs  │
           └────────────────────────────┬────────────────────────────┘
                                        │
                                        ▼
           ┌─────────────────────────────────────────────────────────┐
           │  Tensorlake Sandbox Grid — 64 parallel workers          │
           │                                                         │
           │  ┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐  │
           │  │ W ││ W ││ W ││ W ││ W ││ W ││ W ││ W ││ W ││ W │  │
           │  └───┘└───┘└───┘└───┘└───┘└───┘└───┘└───┘└───┘└───┘  │
           │  ┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐  │
           │  │ W ││ W ││ W ││ W ││ W ││ W ││ W ││ W ││ W ││ W │  │
           │  └───┘└───┘└───┘└───┘└───┘└───┘└───┘└───┘└───┘└───┘  │
           │  …64 workers total, ~1,500 calls/sec each…            │
           └────────────────────────────┬────────────────────────────┘
                                        │
                       ┌────────────────┼────────────────┐
                       ▼                ▼                ▼
                ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
                │  ORACLE     │  │  CANDIDATE  │  │  CLUSTERER  │
                │  Frontier   │  │  Tier-1 fn  │  │  Online     │
                │  LLM        │  │  + Tier-2   │  │  k-means    │
                │  ~1% sample │  │  Phi-3-mini │  │  on output  │
                │  (~1,000)   │  │  ~99%       │  │  embeddings │
                └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
                       │                │                │
                       └────────┬───────┴────────────────┘
                                ▼
                  ┌──────────────────────────────────┐
                  │  3-Axis Empirical Confirmation   │
                  │  • Schema stability  → 0.984     │
                  │  • Determinism       → 0.991     │
                  │  • Oracle agreement  → 0.946     │
                  │                                  │
                  │  Sub-pattern map: 7 clusters     │
                  │  • 6 → Tier 1 typed branches    │
                  │  • 1 → Tier 2 (paraphrase var.) │
                  │  • 0 → Tier 3 fallback          │
                  └──────────────────────────────────┘
```

**Why 100,000 calls?**

| Reason | Detail |
|---|---|
| **Distribution coverage** | Real production traffic has long tails. 100K covers edge cases that 1K misses — gives the codified function an honest fitness score on the whole input space. |
| **Statistical confidence** | Schema stability of 98.4% on 100K samples has a tight 95% CI (±0.08%). On 1K it's ±1.0% — wide enough to land in the wrong tier. |
| **Sub-pattern resolution** | Real call distributions are multi-modal. 100K reveals 5–50 clusters per call site; 1K conflates them. Synthesizer needs the resolution. |
| **Visual conviction** | The constellation is the screenshot judges take home. "100,000 calls in 28 seconds" is the moment. |

**Cost structure:**

| Component | Cost per candidate | Who pays |
|---|---|---|
| Synthetic input generation (Nia + 100 frontier seeds → 100K via variation) | ~$0.50 | Compile (one-time per onboarding) |
| 99K candidate-path calls (Tier-1 fn at $0; Tier-2 Phi-3-mini at $0.0001) | ~$10 | Compile (Tensorlake compute) |
| 1K oracle calls through customer's frontier LLM | ~$50 | Customer (their existing API key, per D9) |
| **Total to Compile** | **~$10–11** | — |
| **Total to customer** | **~$50** (one-time) | — |

Customer pays ~$50 once. We pay ~$10 in sandbox compute. Customer gets a typed function worth $31k/year. Unit economics are absurd.

### Stage 3 — Synthesis (agent-driven)

Once Stage 2 confirms a candidate AND maps its sub-patterns, Compile assembles a synthesis spec from the synthetic traces (with cluster centroids included) and returns it to the customer's agent via `compile.request_synthesis()`. The agent runs codegen using its own LLM keys, emits a typed TS function plus Vitest tests, and submits via `compile.submit_synthesis()`. Compile validates against held-out synthetic traces (15% holdout, kept private from the agent), gates at ≥98% match, and writes to Nia Vault.

The held-out split prevents the agent from overfitting to the same examples it generated from. The synthesis prompt itself is unchanged — see [`prompts/synthesizer.md`](./prompts/synthesizer.md).

---

## Three-Tier Routing (Live, Post-Codification)

Once a candidate is codified, every future call to that site flows through Compile's router:

```
                      ┌─────────────────────────────┐
                      │  Compile MCP Server         │
agent calls           │                             │
LLM →                 │  pattern match              │
                      │                             │
                      ├──────────┬──────────┬───────┤
                      ▼          ▼          ▼
                  TIER 1      TIER 2      TIER 3
              deterministic  local LLM   frontier
                  ~$0       ~$0.0001    ~$0.05
                  ~1ms        ~50ms       ~500ms
              codified fn   Phi-3-mini   GPT/Claude
              with tests    + few-shot   (the LLM
              in Nia Vault                you started
                                          with)
```

When a call hits Compile, it pattern-matches against the customer's Nia Vault library — a **three-state lookup**:

- **Codified hit** (high confidence): routes to Tier 1 (deterministic emitted function) or Tier 2 (local small LLM with the pattern as prior)
- **Negative hit** (pattern previously classified uncodifiable in Stage 1 OR failed Stage 2 confirmation): forwards to Tier 3, **skips synthesis** — no sandbox spin-up
- **Genuine unknown** (no match in either positive or negative Vault): forwards to Tier 3 AND queues for the next bootstrap pass

The negative Vault is load-bearing for unit economics. Without it, every Tier-3-only pattern re-triggers a 100K-input sandbox run. Negative entries carry a retry policy: `creative_task` and `novel_reasoning_required` are sticky; `high_variance_outputs` re-evaluates on distribution shift; `low_static_prior` and `insufficient_data` expire when code changes or trace count crosses a threshold.

---

## Always-On Proxy Mode (Post-Bootstrap)

After the 90-second bootstrap, Compile keeps watching. Real traffic flows through three jobs:

| Job | What it does |
|---|---|
| **Drift watcher** | 1% sampling of Tier-1/Tier-2 hits, replayed against frontier oracle. Schema or output divergence triggers re-validation. |
| **Cluster refiner** | Real receipts update synthetic cluster centroids — the synthetic distribution becomes the prior, real traffic becomes the posterior. |
| **New-pattern miner** | Tier-3 calls that don't match positive or negative Vault are queued; once 30+ similar calls accumulate, a fresh Stage-2 sandbox run kicks off. |

Proxy mode is what makes Compile improve in production. Bootstrap gets you to value in 90 seconds; proxy mode gets you to year two.

---

## Distribution: One-Line Install

For Claude Code:
```bash
claude mcp add compile -- npx @compile/mcp
```

For Cursor (`cursor.json`):
```json
{ "mcpServers": { "compile": { "command": "npx", "args": ["@compile/mcp"] } } }
```

For any custom Anthropic / OpenAI agent: standard MCP server config, one line. The agent gains nine tools:

```
compile.scan_repo(path)                          → static AST scan, returns ranked call sites with priors
                                                   (THIS is where codifiability is decided)
compile.synthetic_confirm(call_site_id, n=100k)  → fires N synthetic calls in Tensorlake, streams cluster
                                                   centroids + 3-axis empirical scores + tier-per-cluster
compile.list_codify_candidates()                 → ranked clusters that passed both stages; powers the 90-second report
compile.request_synthesis(cluster_id)            → returns a synthesis spec (prompt + traces + schemas + customer docs)
                                                   the AGENT runs codegen using its OWN LLM keys
compile.submit_synthesis(request_id, code, tests, contract)
                                                 → agent submits emitted TS; Compile validates against
                                                   held-out synthetic traces, gates ≥98%, writes to Nia Vault
compile.run_codified(function_id, input)         → execute codified function via Tensorlake runtime
compile.find_function(description)               → semantic search via Nia (returns hit / negative-hit / unknown)
compile.estimate_savings(cluster_id, monthly_vol)→ projected $ savings per tier with break-even formula
compile.observe_call(receipt)                    → always-on proxy logging (drift, refinement, new-pattern mining)
```

**The synthesis round-trip is the architectural pivot.** Compile does NOT call Codex/Claude with its own API key to generate functions. It returns a synthesis spec to the calling agent and the agent's existing LLM does the codegen. Three customer wins fall out: (a) prompts and traces never leave the agent's trust boundary; (b) the customer pays for codegen on the LLM bill they were already paying; (c) Compile's unit economics don't depend on absorbing synthesis cost — we make money on routing, not codegen.

---

## How Compile Uses Nia (Nozomio's Flagship)

Nia is not a checkbox — it's the substrate the entire product is built on. Remove Nia and Compile collapses. Eight load-bearing capabilities:

| # | Capability | Role |
|---|---|---|
| 1 | **Vault** | Codified function library. Each function = one Vault page with source, tests, contracts, cost graph, drift events |
| 2 | **Vault write API (`nia sources write`)** | Functions get written to Vault live during demo and operation |
| 3 | **Document Agent — synthetic input generation** | **Reads customer docs (ICP doc, pricing, policy) and generates 100 realistic seed inputs per call site.** This is what makes Stage 2 honest — synthetic data matches the customer's real input distribution because it's grounded in their own corpus. |
| 4 | **Semantic search + `nia_grep`** | Cluster centroids stored in Nia's vector index; lookups for routing replace a custom embedding store |
| 5 | **Connectors (Notion, Slack)** | Stream policy doc changes continuously; trigger contract re-validation when a doc the function depends on changes |
| 6 | **`nia vault dream`** | Overnight cross-customer pattern discovery. Network effect |
| 7 | **Data Extraction** | Replaces LLM web/PDF parsing. Codified functions call `nia.extract()` directly |
| 8 | **Scoped MCP + Context Sharing** | Customer's agent queries its library through Nia-mediated MCP namespace; failure context carries to next synthesis |

Arlan's stated thesis: Nia exposes data and filerooms to AI agents. Compile extends it: **expose codified work to AI agents in the same shape, mediated through Nia.** The synthetic-input generation flip is the cleanest expression of this — Nia's document understanding *becomes* Compile's stress-test harness.

---

## Architecture

Five pipelines: static scan (bootstrap, fast — codifiability decision), synthetic load (bootstrap, heavy — empirical confirmation + sub-pattern discovery), routing (live), synthesis (on-demand, agent-driven), and proxy observation (always-on).

```
┌─── BOOTSTRAP STAGE 1 — STATIC SCAN (instant, on-install) ─────────────┐
│   THIS IS WHERE CODIFIABILITY IS DECIDED.                             │
│                                                                       │
│  customer's repo → AST scanner → LLM call sites (N) →                 │
│  per-site structural priors {schema, determinism, economic} →         │
│  ranked candidates (greens + yellows for Stage 2;                     │
│  reds → negative Vault with reason: low_static_prior)                 │
└───────────────────────────────────────────────────────────────────────┘

┌─── BOOTSTRAP STAGE 2 — SYNTHETIC LOAD (28s, in Tensorlake) ───────────┐
│   THIS IS WHERE CODIFIABILITY IS CONFIRMED AND SUB-PATTERNS MAPPED.   │
│   Codifiability is NOT decided here — that already happened.          │
│                                                                       │
│  Nia Document Agent → 100 seed inputs per candidate →                 │
│  programmatic variation → 100,000 synthetic inputs →                  │
│  64-worker Tensorlake grid:                                           │
│    ├── 1% (1,000)  → customer's frontier LLM (oracle)                 │
│    ├── 99% (99,000) → Tier-1 candidate fn / Tier-2 Phi-3-mini         │
│    └── all → online clusterer (mini-batch k-means on output emb)      │
│  → live 3-axis scores (schema, determinism, oracle-agreement)         │
│  → cluster centroids + tier-per-cluster assignment                    │
│  → ranked codify candidates with $ projections                        │
└───────────────────────────────────────────────────────────────────────┘

┌─── ROUTING (live, in-band on every agent call) ───────────────────────┐
│                                                                       │
│  agent: compile.find_function("describe what I'm about to do")        │
│                              │                                         │
│         ┌────────────────────┼────────────────────┐                   │
│         │                    │                    │                    │
│   POSITIVE hit         NEGATIVE hit          UNKNOWN                   │
│   (codified)           (uncodifiable —       (no match either side)    │
│         │               sticky or expiring)         │                  │
│         ▼                    ▼                       │                 │
│  compile.run_         forward to Tier 3              │                 │
│  codified             skip synthesis                 │                 │
│  (T1 or T2)                                          │                 │
│  ~$0, ~1ms                                           ▼                 │
│                                          (queue for next bootstrap)   │
└───────────────────────────────────────────────────────────────────────┘

┌─── SYNTHESIS (on-demand, agent-driven — Compile spends 0 LLM tokens) ─┐
│                                                                       │
│  1. Compile assembles synthesis spec from Stage-2 traces + cluster    │
│     centroids: {prompt_template, tool_schemas, synthetic_traces       │
│      (real, Stage-2-generated), cluster_map, customer_docs (Nia       │
│      Document Agent), 3-axis scores, holdout split}                   │
│  2. compile.request_synthesis(cluster_id) → returns the spec          │
│  3. CUSTOMER'S AGENT runs codegen using its OWN LLM keys              │
│     (Codex CLI / Claude Code / Cursor / Devin)                        │
│     → emits typed TS function + Vitest tests + contract               │
│  4. compile.submit_synthesis(request_id, code, tests, contract)       │
│  5. Compile validates in Tensorlake sandbox:                          │
│     - run emitted code against held-out synthetic traces (15%)        │
│     - schema-stability + determinism + ≥98% match required            │
│  6. Write outcome to Nia Vault:                                       │
│     - PASS  → positive entry (function_id + savings)                  │
│     - FAIL  → negative entry with retry_policy (D8)                   │
└───────────────────────────────────────────────────────────────────────┘

┌─── PROXY OBSERVATION (always-on, post-bootstrap) ─────────────────────┐
│                                                                       │
│  real receipts → drift watcher (1% sample replay) →                   │
│                  cluster refiner (real → posterior over synthetic) →  │
│                  new-pattern miner (queue for next sandbox run)       │
└───────────────────────────────────────────────────────────────────────┘
```

---

## Demo Flow — Phase by Phase

The demo is **not** a multi-panel dashboard. Multi-panel dashboards force judges to scan for the important thing; we put the important thing on a full screen and advance when it's done.

The flow is **eleven full-bleed pages**, each owning one moment, each auto-advancing when the underlying pipeline phase completes. Total wall time ~90 seconds.

| # | Page | What's on screen | Duration | Why |
|---|---|---|---|---|
| 1 | **CONNECT** | Big terminal in the center of a black screen. The install command (`claude mcp add compile -- npx @compile/mcp`) types itself. A handshake animation when the MCP server registers. Resolves: `Compile connected to acme/agent.` | ~3s | Anchors the one-line install pitch. |
| 2 | **READING YOUR CODE** | File tree on the left lights up file-by-file as the AST scanner walks the repo. Center: source code scrolling fast; lines containing LLM calls highlight in cyan as they're detected. Counter: `LLM call sites found: 0 → 7 → 14 → 23`. | ~4s | We never asked for traffic. We're reading code. |
| 3 | **CLASSIFY** ★ | Subtitle: *"Codifiability decided from code — no LLM calls yet."* The 23 site names start clustered in the center, white. They drift outward to GREEN (top), YELLOW (middle), RED (bottom) buckets based on Stage-1 priors. Each shows three tiny bars (schema/det/economic). The 5 GREENs pulse when settled. | ~5s | **This is the codifiability decision moment.** First "huh, that's clever" beat for judges. |
| 4 | **READING YOUR DOCS** | Stack of customer documents fans out across the screen. Pages flip rapidly as Nia Document Agent reads. Phrases get extracted and float upward into a "seed pool" at the top — `{industry: "fintech", employees: 500, region: "NA"}`, etc. Counter: `Seed inputs generated: 100`. | ~5s | Nia on screen as the substrate. Synthetic inputs are grounded in customer context. |
| 5 | **EXPANDING TO 100,000** | The 100 seeds in the pool split, and split, and split — like cells dividing — until the screen is filled with a dense field of dim points. Counter rolls: `100 → 1,000 → 10,000 → 100,000`. | ~3s | Establishes the scale of the stress test. |
| 6 | **STRESS TEST: classify_lead_tier** ★★ | Subtitle: *"Confirming codifiability empirically + discovering sub-patterns for synthesis."* The hero page. Constellation animation — see [The Hero Visual](#the-hero-visual). | ~28s | The screenshot judges take home. |
| 7 | **CLUSTERS REVEALED** | Constellation freezes. Cluster centroids pulse. Labels fly in to each: `Cluster #1 — fintech-large — 28,400 calls — Tier 1`. Failed clusters dim to gray with a small "negative Vault" badge. | ~4s | The empirical reveal. Sub-pattern shape made explicit. |
| 8 | **THE AGENT WRITES THE CODE** | Code editor center-screen. Typed TS appears character-by-character (Claude Code emission, or pre-recorded for safety). Vitest tests appear below. The line `import { llmFallback } from "@compile/runtime"` highlights when typed. | ~25s | "The agent writes the function that retires the agent." Punchline of D9. |
| 9 | **VALIDATE** | A progress bar fills. Each held-out trace flashes briefly with a green ✓ or red ✗. Final score ticks up: `94% → 97% → 98.7% PASS`. Big "GATE PASSED" banner. | ~5s | The 98% gate is real. Evidence. |
| 10 | **VAULT WRITE** | The TS function shrinks down to a card and slides into a "Vault" library on screen. Existing Vault entries are visible as a stack of cards; the new one slots in. | ~3s | Closes the loop. Function lives in Nia forever. |
| 11 | **RESULT** | Cost / savings summary. Final design TBD. | ~5s | The kicker. |

Pages auto-advance based on backend state (Convex subscriptions). No clicks, no panels, no scrolling. The pipeline drives the navigation.

---

## The Hero Visual

Page 6 is the page judges remember. Treatment:

**Black screen. A 2D embedding-space projection (UMAP/t-SNE-style), full-bleed.**

```
                 .  .   .              .
              .       .   .       .       .
            .   .  .              .  .  .
              .                       .
                                              .
        .  .                 ╭─────╮            .
      .   .                  │ ◉◉◉ │ ╭───╮       .
       .                     │◉◉◉◉◉│ │◉◉◉│  .
      .                      ╰─────╯ ╰───╯
                                                  .
                       ╭─────╮                .
                       │◉◉◉◉◉│
        .              │◉◉◉◉◉│       .  .
                       ╰─────╯
   .                                              .
              .   .                          .
                            .  .   .
```

**Animation, second-by-second:**

- **0–5s:** Points fly in from off-screen edges, scattered. Each point is one synthetic call's output, embedded into 2D via UMAP-style projection. 64 streams in parallel — one per Tensorlake worker. Density grows.
- **5–15s:** Force-directed simulation kicks in. Points with similar outputs (proximity in embedding space) gravitate toward each other with a small attractive force. Distinct clusters begin to emerge from the noise.
- **15–25s:** Clusters tighten and separate. Counter: `0 → 12,847 → 47,193 → 99,841`. Schema-stability and determinism scores tick up at the top in real time, *confirming* the Stage-1 prior empirically.
- **25–28s:** Color resolves. Clusters where the candidate (Tier-1 fn or Phi-3-mini) matches frontier oracle within tolerance shift from white → green (Tier 1) or amber (Tier 2). Outlier clusters (>2% divergence from oracle) dim to gray (Tier 3 fallback). Motion settles.
- **28s:** Frozen constellation. The judge sees structure, scale, and tier classification at a single glance.

**On-screen chrome (minimal):**
- **Top-right:** live counter `0 → 100,000`, throughput readout (`3,571 req/s`).
- **Top-left:** call site name and Stage-1 prior for context (`classify_lead_tier — predicted Tier 1, schema 0.92`).
- **Bottom-center:** a single sentence updating in time with the visual:
  - *"Stress-testing 100,000 synthetic inputs..."*
  - *"Discovering sub-pattern structure..."*
  - *"Empirical confirmation: schema 98.4%, determinism 99.1%, oracle agreement 94.6%"*
  - *"7 sub-patterns found. 6 Tier 1, 1 Tier 2, 0 fallbacks. Codifiability confirmed."*

**Why the constellation, not a dashboard:**

- The grid showed 100K equivalent boxes — visually flat, no narrative.
- The constellation has *emergence* — chaos → structure → classification — which is exactly what the algorithm is doing. The visual carries the meaning by itself.
- Judges who know ML recognize UMAP/t-SNE immediately and respect the rigor; judges who don't see "the magic happen" and remember it.
- Cluster boundaries are visible without labels, so the visual works from across a room.

**Critical narrative point — what the colors mean:**

> Color resolution is **not** "codifiable yes/no." That was already decided in Page 3 from the code.
>
> Color resolution is **tier-per-cluster**: among the sub-patterns within an already-codifiable call site, which ones the typed function handles directly (Tier 1), which ones need a small local LLM (Tier 2), and which rare edges fall through to the frontier LLM (Tier 3 fallback).

This distinction is load-bearing. Codifiability is a property of the call site (decided from code). Tier per sub-pattern is a property of the cluster (decided from empirical evidence). Different questions, different evidence, different pages.

**Implementation:**

- Canvas / WebGL (deck.gl `ScatterplotLayer` or raw Three.js points). 100K points at 60fps is well within budget on a modern laptop.
- We don't need real-time UMAP at runtime — pre-compute cluster centroid positions Friday from a representative run, then on-demo each incoming call gets dropped near its assigned cluster's centroid with small jitter. The illusion of online projection is enough; we are not publishing a paper.
- Force simulation with `d3-force` or a custom GPU shader. Tunable cluster tightness.
- Color resolution is a simple lerp from white → tier color based on cluster confidence updates streamed from Convex.
- Each Tensorlake worker writes one row per completed call to Convex; React subscribes and the canvas paints diffs only.

---

## Demo Workflow: Sales Lead Qualification (ICP fit)

**The demo "customer" is Acme Corp.** We pre-build a small TS agent (`acme/agent`) with 23 LLM call sites, of which 5 are obvious codify candidates. The agent does sales lead qualification — input: company profile, output: `{ fit: bool, confidence: number, tier_used: string, reasoning: string }`.

The workflow naturally splits across all three tiers within the codified function — exactly the sub-pattern structure the constellation reveals:

| Tier | When it fires (sub-pattern within the codified site) | Example |
|---|---|---|
| **Tier 1** (deterministic) | Hard rules match: employee count, industry, revenue band | "500-person fintech in NA → fit: true, conf: 0.96" |
| **Tier 2** (local LLM) | Mid-market with mixed signals — needs judgment but bounded | "85-person hybrid SaaS/services, healthcare-adjacent → conf: 0.72" |
| **Tier 3** (frontier fallback) | Novel positioning the rules don't cover | "stealth-mode AI/biotech with no website → escalate" |

Why this workflow:
- Every founder + investor in the room recognizes ICP-fit pain (Clay charges $0.30–$3.75/row for this exact lookup)
- The three tiers produce visibly distinct cluster regions in the constellation (clear color separation)
- Acme corpus (fake ICP doc in Notion) gets ingested by Nia Document Agent — visible Nia surface in synthetic input generation
- Synthetic generation is clean: 100 seed company profiles × programmatic variation = 100K realistic inputs

---

## Sponsor Stack

| Sponsor | Role | Surfaces used |
|---|---|---|
| **Nia (Nozomio)** | Substrate of substrate. **Document Agent generates the 100 seed inputs** that programmatic variation expands to 100K — Nia's document understanding IS Compile's stress-test harness. Vault stores every codified function. Semantic search powers routing lookups. | Vault, Vault write API, Document Agent (input generation), Connectors, `vault dream`, Scoped MCP, Data Extraction, Context Sharing, semantic search, `nia_grep`, Local Sync |
| **Tensorlake** | **The 64-worker grid runs the constellation.** Online clustering, validation harness, Tier-2 Phi-3-mini hosting. The most visually load-bearing sponsor — judges watch Tensorlake fan-out happen. *Note:* synthesis-time codegen runs in the customer's agent, not in Tensorlake — Compile does not pay for codegen tokens. | Sandbox compute (64-worker grid), sandboxed model execution, parallel job orchestration |
| **Convex** | **Reactive state engine for the constellation.** Each completed call writes one row; the canvas subscribes and paints diffs. The phase-by-phase navigation is also Convex-driven (pages advance when backend state updates). | Real-time DB, Agent component |
| **InsForge** | Postgres function registry. Audit trail (every Stage-2 run logged with synthetic seed + cluster centroids for reproducibility). Edge-function dispatch on drift / promotion / de-promotion. | Postgres, edge functions, auth |
| **Vercel** | Console deploy. Public docs site. MCP server registry endpoint. | Next.js, edge |
| **OpenAI Codex / Devin** | The customer's agent in our demo — installs Compile via MCP, gets scanned, sees the constellation run on its own call sites, then receives the synthesis spec and writes the typed TS that retires its own future calls. **Codex's API key, customer's data, codified function belongs to customer.** Compile spends 0 tokens here. *"We use Codex to write the function that retires Codex from this task — and Codex pays for it."* | MCP client; codegen via customer's own API key |
| Hyperspell (stretch) | Long-term per-customer prompt-tuning state for Tier-2 calls | Memory layer |
| Aside (stretch) | Browser-portal codification for Tier-3 calls touching vendor portals | Browser-as-OS |

---

## Distribution Plan

**Saturday demo:** Live Vercel deploy of MCP server + console at `compile-demo.vercel.app`. Backup 90-second video recording in case venue WiFi fails.

**Post-hackathon:** Open-source SDK on npm (`@compile/mcp`). Public docs at compile.dev. Hosted MCP server on Vercel + Convex. The MCP server is the primary install surface; an OpenAI-compatible gateway proxy is added in v2. CI/CD: GitHub Actions builds and publishes the MCP server on tag; Vercel auto-deploys console on push to main.

**Distribution thesis:** Submit to the Anthropic / Claude Code MCP server registry. Tweet the install command. Every agent that supports MCP is one-line away. No dev-rel team needed; the MCP ecosystem IS the distribution.

### The 90-Second Report

The sales motion that follows from the bootstrap pipeline. A prospect installs Compile (one-line MCP add), points it at their repo, and 90 seconds later receives a customer-specific PDF / dashboard:

```
COMPILE REPORT — <customer_name> — bootstrap on commit a3f2d1b

Repo scanned:                  142 files
LLM call sites identified:     23
Stage-1 priors computed:       23 (instant — codifiability decided)
Stage-2 sandbox runs:          5 candidates × 100,000 calls = 500,000 synthetic calls
Wall time:                     91s

CODIFY CANDIDATES (ranked by annual savings):

#1  classify_lead_tier()
    8,400 calls/day · $31,200/yr · schema-stable (98.4%) · oracle agreement 94.6%
    7 sub-patterns: 6 Tier 1, 1 Tier 2, 0 fallback
    → Tier 1 typed function with 6 branches, break-even at hit #4

#2  extract_invoice_fields()
    3,100/day · $14,800/yr · schema-stable (96.1%) · oracle agreement 97.2%
    4 sub-patterns: all Tier 1
    → Tier 1 typed function with enum output

#3  resolve_company_domain()
    2,200/day · $11,400/yr · schema-stable (94.0%) · oracle agreement 92.8%
    3 sub-patterns: 2 Tier 1, 1 Tier 2
    → Tier 1 typed function with regex + Nia data extraction fallback

#4  summarize_support_thread()
    900/day · $9,400/yr · partially codifiable (Tier 2)
    5 sub-patterns: 0 Tier 1, 4 Tier 2, 1 fallback
    → Phi-3-mini with 5 few-shots, oracle agreement 91.3%

#5  draft_outreach_subject() — UNCODIFIABLE
    2,800/day · creative_task · keep at frontier
    → negative Vault entry (sticky)

PROJECTED ANNUAL SAVINGS (T1+T2 promotions): $66,800
SANDBOX COMPUTE COST AMORTIZED: $52 one-time
```

No industry stats. Their numbers, their clusters, their savings, derived from their code and stress-tested in front of their eyes. The dashboard is the demo *and* the lead magnet *and* the contract trigger. Codify candidates flow directly into the synthesis pipeline — the customer's agent writes the replacements with one click.

---

## Repo Structure (planned)

```
packages/
  mcp-server/        # @compile/mcp — the MCP server with 9 tools
  scanner/           # AST-based static prior computation (TS + Python)
                     # ← codifiability is decided here
  synth-loader/      # Nia-grounded synthetic input generation + Tensorlake fan-out
                     # ← codifiability is confirmed + sub-patterns mapped here
  synthesizer/       # cluster → typed function emission (agent-driven)
  runtime/           # Tensorlake sandbox runner + Tier-2 Phi hosting
  ui/                # Phase-by-phase pages (Next.js + Convex)
                     # — 11 full-bleed pages, constellation hero on Page 6
  nia/               # thin wrapper over Nia API surfaces

convex/              # Convex backend (reactive state, agent component)
data/                # fake Acme corpus (Notion + Slack samples) + acme/agent demo repo
prompts/
  synthesizer.md     # the load-bearing prompt — see ENG_REVIEW.md
```

---

## Status

Day 2 of build (Friday derisk day). Plan reviewed via /office-hours and /plan-eng-review on 2026-05-07, then revised same day to canonicalize **two-stage codifiability (static prior decision + 100K synthetic confirmation + sub-pattern discovery)** as the bootstrap path. UI revised 2026-05-08 from 5-panel dashboard to **phase-by-phase single-page flow with constellation hero**. Thirteen architectural decisions locked (see `ENG_REVIEW.md`). Critical Friday derisks identified: AST scanner on Acme repo, Tensorlake 64-worker fan-out, constellation 60fps render at 100K points, npm publish, demo cached playback. Implementation continues Saturday May 9.

See [`ENG_REVIEW.md`](./ENG_REVIEW.md) for architectural decisions, scope cuts, and Friday derisk plan.
See [`PITCH.md`](./PITCH.md) for the canonical pitch, problem framing, and ROI math.
See [`prompts/synthesizer.md`](./prompts/synthesizer.md) for the synthesizer prompt spec — the demo's load-bearing artifact.

---

*Building the future of AI agents by putting them out of repeat work — and showing every call land in the constellation while we do it.*
