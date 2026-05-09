# Compile

> **MCP server that compiles repeat LLM work out of the agent loop — in 90 seconds, without waiting two days for proxy data.**

Built for the [Nozomio Hackathon](https://luma.com/rshibq6i) — May 9, 2026, EF office, San Francisco. Theme: *Build the Future of AI Agents.*

---

## The Pitch

**Point Compile at a customer's repo. 90 seconds later they have their *personal* number** — which of their LLM call sites are deterministically replaceable, what those calls cost per month, and a typed function that retires the most expensive one. Not industry vibes, not hand-waving — actual line items derived from their actual code, stress-tested against 100,000 synthetic calls in a sandbox before we tell them anything.

> *"Call site #7 — `classify_lead_tier()` — 8,400 calls/day, $31k/year, schema-stable across 100,000 synthetic inputs, replaceable with a 12-line typed function. Want us to retire it?"*

That's the wedge. The supporting math (research across the Anthropic Economic Index, OpenAI State of Enterprise AI, a16z LLM cost surveys) is why the line items exist:

- **~38% of production LLM volume is highly codifiable** — extraction, classification, glue, boilerplate codegen, repetitive browser flows
- **~34% is partially codifiable** — RAG retrieval, support replies, partial summarization, sales research. Small local LLMs handle these at 1/100th the cost of frontier
- **~28% is genuinely frontier-only** — creative work, novel reasoning, true open-ended tasks

Today the entire 100% gets routed to a frontier model at frontier prices. The 38% that could be a typed function and the 34% that could be a 1B-parameter local model are paying for capability they don't use.

**Compile is an MCP server that any AI agent installs in one line. Two pipelines, two timescales:**

1. **Bootstrap (90 seconds, code-first):** Static analysis of the customer's repo finds every LLM call site, computes a structural codifiability prior from the code itself, then fires 100,000 synthetic calls per candidate through Tensorlake to confirm schema stability, determinism, and economic value. Every step is visible.

2. **Always-on (continuous, proxy):** Once installed, Compile observes real traffic to refine priors with production distributions, catch drift, and surface new clusters that emerge over time.

3. **Synthesis (on-demand, agent-driven):** When a candidate clears the 3-axis gate, Compile returns a synthesis spec to the *customer's own agent*, which runs the codegen using its *own LLM keys* on its *own data* and submits the typed function back. Compile validates against held-out synthetic traces, gates at ≥98% match, and writes to Nia Vault.

**The codegen happens in the customer's agent context — Compile spends zero frontier-LLM tokens.** The agent literally writes its own replacement, billed to the agent's existing API key. The agent puts itself out of a job, and the codified library belongs to the customer.

---

## Two-Stage Codifiability — How Bootstrap Works

> *We don't need to watch your traffic for 48 hours. We read your code, then we prove it works with 100,000 synthetic calls in a sandbox. You see every call land.*

Codifiability is a measurable property of an LLM call site, not a vibe. Compile measures it in two stages — a fast structural pass over source, then a heavyweight empirical pass in the sandbox.

### Stage 1 — Static Prior (instant, from code alone)

Compile walks the customer's repo with an AST scanner, finds every LLM call site (`anthropic.messages.create`, `openai.chat.completions.create`, MCP tool invocations, etc.), and computes a **structural codifiability prior** from the code itself — no runtime data needed.

| Code signal | What it tells us | Prior contribution |
|---|---|---|
| `responseFormat: zodSchema(...)` | Output schema is bounded by construction | +0.4 schema stability |
| `temperature: 0` + templated prompt | Determinism intent is explicit | +0.3 determinism |
| Bounded `tool` array (≤10 schemas) | Output space is finite | +0.2 schema stability |
| Prompt template fully parameterized at compile time | No runtime prompt construction | +0.2 determinism |
| Call site instrumented with logging | Volume estimate available from telemetry | enables economic-value scoring |
| Few-shot examples present in prompt | Pattern is well-defined | +0.1 schema stability |
| Tool call followed by structured parse | Pipeline shape is deterministic | +0.1 determinism |

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

Greens go to Stage 2 immediately. Yellows go to Stage 2 with stricter sandbox thresholds. Reds go straight to the negative Vault with `reason: low_static_prior` and a sticky retry policy.

**Stage 1 cost: zero LLM tokens, milliseconds wall time.** Pure AST work.

### Stage 2 — Synthetic Confirmation (live, in the VM, 100,000 calls per candidate)

For every Stage-1 candidate that passes, Compile fires **100,000 synthetic calls** through a Tensorlake sandbox grid. This is the heart of the demo and the heart of the product.

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
                │  ~1% sample │  │  Phi-3-mini │  │  on outputs │
                │  (~1,000)   │  │  ~99%       │  │             │
                └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
                       │                │                │
                       └────────┬───────┴────────────────┘
                                ▼
                  ┌──────────────────────────────────┐
                  │  3-Axis Scorer (live, streaming) │
                  │  • Schema stability  → 0.984     │
                  │  • Determinism       → 0.991     │
                  │  • Oracle agreement  → 0.946     │
                  │  • Economic value    → $31,200/yr│
                  └──────────────────────────────────┘
```

**The 100K-call grid (visible on stage):**

```
   SYNTHETIC LOAD GRID — classify_lead_tier — 100,000 calls in flight

   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
   ░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒▒▒▒▒▒▒▒░░░░░░░░░░░░▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒░░░░░░░░░░░
   ░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒▒▒▒▒▒▒▒░░░░░░░░░░░░▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒░░░░░░░░░░░
   ░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒▒▒▒▒▒▒▒░░░░░░░░░░░░▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒░░░░░░░░░░░
   ░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒▒▒▒▒▒▒▒░░░░░░░░░░░░▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒░░░░░░░░░░░
   ░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒▒▒▒▒▒▒▒░░░░░░░░░░░░▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒░░░░░░░░░░░
   ░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒▒▒▒▒▒▒▒░░░░░░░░░░░░▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒░░░░░░░░░░░
   ░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒▒▒▒▒▒▒▒░░░░░░░░░░░░▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒░░░░░░░░░░░
   ░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒▒▒▒▒▒▒▒░░░░░░░░░░░░▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒░░░░░░░░░░░
   ░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒▒▒▒▒▒▒▒░░░░░░░░░░░░▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒░░░░░░░░░░░
   ░▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒▒▒▒▒▒▒▒░░░░░░░░░░░░▓▓▓▓▓▓▓▓▓▓▒▒▒▒▒▒░░░░░░░░░░░
   ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

   ▓ TIER 1 deterministic   52,400 calls   schema-stable, det≥0.98
   ▒ TIER 2 local LLM       28,300 calls   schema-stable, paraphrase variance
   ░ TIER 3 frontier escape 19,300 calls   novel inputs — kept on frontier

   Throughput: 3,571 req/s · Cores: 64 · Wall: 28s of 30s budget · Oracle: 982/1,000
   Cluster centroids: 7 · Schema validity: 98.4% · Determinism: 99.1% · Oracle agreement: 94.6%
```

Each cell is a synthetic call. As they land, color-coding updates in real time. The clusterer runs online (single-pass mini-batch k-means on output embeddings), so cluster boundaries materialize as the grid fills. Judges literally watch codifiability happen.

**Why 100,000 calls?**

| Reason | Detail |
|---|---|
| **Distribution coverage** | Real production traffic has long tails. 100K covers edge cases that 1K misses — gives the codified function an honest fitness score. |
| **Statistical confidence** | Schema stability of 98.4% on 100K samples has a tight 95% CI (±0.08%). On 1K it's ±1.0% — wide enough to land in the wrong tier. |
| **Cluster discovery** | Real call distributions are multi-modal. 100K reveals 5–50 clusters per call site; 1K conflates them. |
| **Visual conviction** | Judges remember the grid. "100,000 calls in 28 seconds" is the screenshot they take home. |

**Cost structure:**

| Component | Cost per candidate | Who pays |
|---|---|---|
| Synthetic input generation (Nia + 100 frontier seeds → 100K via variation) | ~$0.50 | Compile (one-time per onboarding) |
| 99K candidate-path calls (Tier-1 fn at $0; Tier-2 Phi-3-mini at $0.0001) | ~$10 | Compile (Tensorlake compute) |
| 1K oracle calls through customer's frontier LLM | ~$50 | Customer (their existing API key, per D9) |
| **Total to Compile** | **~$10–11** | — |
| **Total to customer** | **~$50** (one-time) | — |

Customer pays ~$50 once. We pay ~$10 in sandbox compute. Customer gets a typed function worth $31k/year. Unit economics are absurd.

### Stage 3 — Synthesis (agent-driven, unchanged from prior architecture)

Once Stage 2 confirms a candidate, Compile assembles a synthesis spec from the synthetic traces and returns it to the customer's agent via `compile.request_synthesis()`. The agent runs codegen using its own LLM keys, emits a typed TS function plus Vitest tests, and submits via `compile.submit_synthesis()`. Compile validates against held-out synthetic traces (15% holdout, kept private), gates at ≥98% match, and writes to Nia Vault.

The held-out split prevents the agent from overfitting to the same examples it generated from. The synthesis prompt itself is unchanged — see [`prompts/synthesizer.md`](./prompts/synthesizer.md).

---

## Three-Tier Routing

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
- **Negative hit** (pattern previously classified uncodifiable): forwards to Tier 3, **skips synthesis** — no sandbox spin-up
- **Genuine unknown** (no match in either positive or negative Vault): forwards to Tier 3 AND queues for the next bootstrap pass

The negative Vault is load-bearing for unit economics. Without it, every Tier-3-only pattern re-triggers a 100K-input sandbox run. Negative entries carry a retry policy: `creative_task` and `novel_reasoning_required` are sticky; `high_variance_outputs` re-evaluates on distribution shift; `low_static_prior` and `insufficient_data` expire when code changes or trace count crosses a threshold.

---

## Always-On Proxy Mode (post-bootstrap)

After the 90-second bootstrap, Compile keeps watching. Real traffic flows through three jobs:

| Job | What it does |
|---|---|
| **Drift watcher** | 1% sampling of Tier-1/Tier-2 hits, replayed against frontier oracle. Schema or output divergence triggers re-validation. |
| **Cluster refiner** | Real receipts update synthetic cluster centroids — the synthetic distribution becomes the prior, real traffic becomes the posterior. |
| **New-pattern miner** | Tier-3 calls that don't match positive or negative Vault are queued; once 30+ similar calls accumulate, a fresh Stage-2 sandbox run kicks off. |

Proxy mode is what makes Compile improve in production. Bootstrap gets you to the demo; proxy mode gets you to year two.

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
compile.synthetic_confirm(call_site_id, n=100k)  → fires N synthetic calls in Tensorlake, streams cluster + scores
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

Nia is not a checkbox — it's the substrate the entire product is built on. Remove Nia and Compile collapses. Eight load-bearing capabilities, with **synthetic-input generation now elevated as a first-class Nia surface**:

| # | Capability | Role |
|---|---|---|
| 1 | **Vault** | Codified function library. Each function = one Vault page with source, tests, contracts, cost graph, drift events |
| 2 | **Vault write API (`nia sources write`)** | Functions get written to Vault live during demo and operation |
| 3 | **Document Agent — synthetic input generation** | **Reads customer docs (ICP doc, pricing, policy) and generates 100K realistic synthetic inputs per call site.** This is what makes Stage 2 honest — synthetic data matches the customer's real input distribution because it's grounded in their own corpus. |
| 4 | **Semantic search + `nia_grep`** | Cluster centroids stored in Nia's vector index; lookups for routing replace a custom embedding store |
| 5 | **Connectors (Notion, Slack)** | Stream policy doc changes continuously; trigger contract re-validation when a doc the function depends on changes |
| 6 | **`nia vault dream`** | Overnight cross-customer pattern discovery. Network effect |
| 7 | **Data Extraction** | Replaces LLM web/PDF parsing. Codified functions call `nia.extract()` directly |
| 8 | **Scoped MCP + Context Sharing** | Customer's agent queries its library through Nia-mediated MCP namespace; failure context carries to next synthesis |

Arlan's stated thesis: Nia exposes data and filerooms to AI agents. Compile extends it: **expose codified work to AI agents in the same shape, mediated through Nia.** The synthetic-input generation flip is the cleanest expression of this — Nia's document understanding *becomes* Compile's stress-test harness.

---

## Architecture

Five pipelines: static scan (bootstrap, fast), synthetic load (bootstrap, heavy), routing (live), synthesis (on-demand, agent-driven), and proxy observation (always-on).

```
┌─── BOOTSTRAP STAGE 1 — STATIC SCAN (instant, on-install) ─────────────┐
│                                                                       │
│  customer's repo → AST scanner → LLM call sites (N) →                 │
│  per-site structural priors {schema, determinism, economic} →         │
│  ranked candidates (greens + yellows for Stage 2)                     │
└───────────────────────────────────────────────────────────────────────┘

┌─── BOOTSTRAP STAGE 2 — SYNTHETIC LOAD (28s, in Tensorlake) ───────────┐
│                                                                       │
│  Nia Document Agent → 100 seed inputs per candidate →                 │
│  programmatic variation → 100,000 synthetic inputs →                  │
│  64-worker Tensorlake grid:                                           │
│    ├── 1% (1,000)  → customer's frontier LLM (oracle)                 │
│    ├── 99% (99,000) → Tier-1 candidate fn / Tier-2 Phi-3-mini         │
│    └── all → online clusterer (mini-batch k-means)                    │
│  → live 3-axis scores (schema, determinism, oracle-agreement)         │
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
│  1. Compile assembles synthesis spec from Stage 2 traces:             │
│     {prompt_template, tool_schemas, synthetic_traces (real,           │
│      Stage-2-generated), customer_docs (Nia Document Agent),          │
│      3-axis scores, holdout split}                                    │
│  2. compile.request_synthesis(cluster_id) → returns the spec          │
│  3. CUSTOMER'S AGENT runs codegen using its OWN LLM keys              │
│     (Codex CLI / Claude Code / Cursor / Devin)                        │
│     → emits typed TS function + Vitest tests + contract               │
│  4. compile.submit_synthesis(request_id, code, tests, contract)       │
│  5. Compile validates in Tensorlake sandbox:                          │
│     - run emitted code against held-out synthetic traces              │
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

## Five-Stage Visible Pipeline (the demo)

```
[1] SCAN              [2] SYNTHESIZE LOAD    [3] CLUSTER           [4] EMIT             [5] VERIFY+SAVINGS
    AST walks repo,     Tensorlake fans 100K   Online clusterer      Customer's agent      Validation harness
    finds 23 LLM call   synthetic inputs       groups outputs in     (Codex / Claude)      replays against
    sites, computes     across 64 workers.     real time. 3-axis     receives synthesis    held-out 15% slice.
    structural priors,  Nia Document Agent     scores update         spec, emits typed     ≥98% → promote.
    ranks them          generates inputs       streaming.            TS + Vitest tests.    Cost panel:
    red/yellow/green.   from Acme corpus.                                                  $40 → $1.20.
    ~200ms              ~28s wall              ~throughout Stage 2   ~25s wall             ~5s wall
                        ($10 sandbox cost,     (concurrent)                                Nia Vault grows.
                         $50 oracle to cust.)                                              Total: ~90s
```

Total demo: **~90 seconds for one workflow end-to-end, every step visible.** Each stage gets a panel; data flows left-to-right in real time as the MCP server processes the customer's repo.

---

## Demo Workflow: Sales Lead Qualification (ICP fit)

**The demo "customer" is Acme Corp.** We pre-build a small TS agent (`acme/agent`) with 23 LLM call sites, of which 5 are obvious codify candidates. The agent does sales lead qualification — input: company profile, output: `{ fit: bool, confidence: number, tier_used: string, reasoning: string }`.

The workflow naturally splits across all three tiers:

| Tier | When it fires | Example |
|---|---|---|
| **Tier 1** (deterministic) | Hard rules match: employee count, industry, revenue band | "500-person fintech in NA → fit: true, conf: 0.96" |
| **Tier 2** (local LLM) | Mid-market with mixed signals — needs judgment but bounded | "85-person hybrid SaaS/services, healthcare-adjacent → conf: 0.72" |
| **Tier 3** (frontier) | Novel positioning the rules don't cover | "stealth-mode AI/biotech with no website → escalate" |

Why this workflow:
- Every founder + investor in the room recognizes ICP-fit pain (Clay charges $0.30–$3.75/row for this exact lookup)
- Three tiers produce visibly distinct routing paths in the synthetic-load grid (clear color regions)
- Acme corpus (fake ICP doc in Notion) gets ingested by Nia Document Agent — visible Nia surface in synthetic input generation
- Synthetic generation is clean: 100 seed company profiles × programmatic variation = 100K realistic inputs

---

## Sponsor Stack

| Sponsor | Role | Surfaces used |
|---|---|---|
| **Nia (Nozomio)** | Substrate of substrate. **Document Agent now generates the 100K synthetic inputs** — Nia's document understanding IS Compile's stress-test harness. | Vault, Vault write API, Document Agent (input generation), Connectors, `vault dream`, Scoped MCP, Data Extraction, Context Sharing, semantic search, `nia_grep`, Local Sync |
| **Tensorlake** | **The 100K-call grid runs here.** 64 parallel sandbox workers, online clustering, validation harness, Tier-2 Phi-3-mini hosting. The most visually load-bearing sponsor — judges watch Tensorlake fan-out happen. *Note:* synthesis-time codegen runs in the customer's agent, not in Tensorlake — Compile does not pay for codegen tokens. | Sandbox compute (64-worker grid), sandboxed model execution, parallel job orchestration |
| **Convex** | Reactive console state. Pipeline panels, run ledger, cost-decay graphs, real-time promotion events, MCP call stream. **The synthetic-load grid renders from Convex subscriptions.** | Real-time DB, Agent component |
| **InsForge** | Postgres function registry. Audit trail (every Stage-2 run logged with synthetic seed + cluster centroids for reproducibility). Edge-function dispatch on drift / promotion / de-promotion. | Postgres, edge functions, auth |
| **Vercel** | Console deploy. Public docs site. MCP server registry endpoint. | Next.js, edge |
| **OpenAI Codex / Devin** | The customer's agent in our demo — installs Compile via MCP, gets scanned, sees the 100K-call grid run on its own call sites, then receives the synthesis spec and writes the typed TS that retires its own future calls. **Codex's API key, customer's data, codified function belongs to customer.** Compile spends 0 tokens here. *"We use Codex to write the function that retires Codex from this task — and Codex pays for it."* | MCP client; codegen via customer's own API key |
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
Stage-1 priors computed:       23 (instant)
Stage-2 sandbox runs:          5 candidates × 100,000 calls = 500,000 synthetic calls
Wall time:                     91s

CODIFY CANDIDATES (ranked by annual savings):

#1  classify_lead_tier()
    8,400 calls/day · $31,200/yr · schema-stable (98.4%) · oracle agreement 94.6%
    → Tier 1 typed function, break-even at hit #4

#2  extract_invoice_fields()
    3,100/day · $14,800/yr · schema-stable (96.1%) · oracle agreement 97.2%
    → Tier 1 typed function with enum output

#3  resolve_company_domain()
    2,200/day · $11,400/yr · schema-stable (94.0%) · oracle agreement 92.8%
    → Tier 1 typed function with regex + Nia data extraction fallback

#4  summarize_support_thread()
    900/day · $9,400/yr · partially codifiable (Tier 2)
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
  synth-loader/      # Nia-grounded synthetic input generation + Tensorlake fan-out
  synthesizer/       # cluster → typed function emission (agent-driven)
  runtime/           # Tensorlake sandbox runner + Tier-2 Phi hosting
  ui/                # 5-panel pipeline dashboard (Next.js + Convex)
  nia/               # thin wrapper over Nia API surfaces

convex/              # Convex backend (reactive state, agent component)
data/                # fake Acme corpus (Notion + Slack samples) + acme/agent demo repo
prompts/
  synthesizer.md     # the load-bearing prompt — see ENG_REVIEW.md
```

---

## Status

Day 1 of build. Plan reviewed via /office-hours and /plan-eng-review on 2026-05-07, then revised 2026-05-07 to canonicalize **two-stage codifiability (static prior + 100K synthetic confirmation)** as the bootstrap path, demoting proxy observation to always-on monitoring. Twelve architectural decisions locked (see `ENG_REVIEW.md`). Critical Friday derisks identified: AST scanner on Acme repo, Tensorlake 64-worker fan-out, Nia synthetic-input generation, npm publish, demo cached playback. Implementation starts Saturday May 9.

See [`ENG_REVIEW.md`](./ENG_REVIEW.md) for architectural decisions, scope cuts, and Friday derisk plan.
See [`prompts/synthesizer.md`](./prompts/synthesizer.md) for the synthesizer prompt spec — the demo's load-bearing artifact.

---

*Building the future of AI agents by putting them out of repeat work — and showing every call land in the sandbox while we do it.*
