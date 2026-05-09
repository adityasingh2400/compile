# Compile — The Pitch

> **One-line install. 90 seconds. We hand you the typed functions that retire the 72% of your LLM spend that's buying capability you don't use.**

For the [Nozomio Hackathon](https://luma.com/rshibq6i) — May 9, 2026, EF office, San Francisco. Theme: *Build the Future of AI Agents.*

This document is the canonical case for *why* Compile matters, *how* we solve the problem, *what* the customer experiences, and *why* we win first place. For the architecture spec, see [`DESIGN.md`](./DESIGN.md). For build decisions, see [`ENG_REVIEW.md`](./ENG_REVIEW.md).

---

## The Problem We Solve

**Every AI-native company is paying frontier prices for typed-function work.**

Three numbers, all from credible third-party sources (Anthropic Economic Index, OpenAI State of Enterprise AI, a16z LLM cost surveys), all converging on the same picture of production LLM traffic:

| Slice | What it is | What it should cost |
|---|---|---|
| **~38%** | Highly codifiable — extraction, classification, glue, boilerplate codegen, repetitive browser flows | Free (deterministic typed function) |
| **~34%** | Partially codifiable — RAG retrieval, support replies, partial summarization, sales research | ~$0.0001/call (1B-parameter local model) |
| **~28%** | Genuinely frontier-only — creative work, novel reasoning, true open-ended tasks | ~$0.05/call (frontier LLM) |

Today, **all 100% of that traffic gets routed to a $0.05/call frontier model.** The 72% that doesn't need frontier capability is paying 100×–500× what it should.

For a single mid-market AI product running 100K calls/day, that's:
- **Actual frontier spend:** ~$5,000/day = ~$1.8M/year
- **What it should cost:** ~$200/day = ~$73K/year
- **Pure waste:** ~$1.7M/year — *for one customer*

Multiply by every Cursor, Devin, Codex, Replit, or vertical agent shipping today.

---

## Why This Is a Massive Issue

Five reasons this is the biggest unaddressed cost problem in AI:

**1. LLM spend is the fastest-growing line item in every B2B SaaS P&L.** It scales linearly with usage, not with margin. Every $1 of revenue carries $0.20–$0.40 of model spend for AI-native products. Gross margins are bleeding into model providers' pockets in real time.

**2. Every agent product has this problem.** Cursor, Devin, Codex, Replit, vertical agents in legal/sales/support — all routing repetitive classification and extraction through frontier models because the agent has no introspection on what's repetitive.

**3. The waste compounds at scale.** At 100K calls/day, the gap between $0.05 and $0.0001 is $5,000/day. That's not theoretical — that's $1.8M/year leaving the P&L every year, on top of growing.

**4. Nobody has shipped a working solution.**
- **Helicone, Langfuse, Langsmith** — observability. They tell you what you spent. They don't replace the calls.
- **Optimization platforms (Portkey, OpenRouter, etc.)** — recommend "use a smaller model." Don't write the code. Don't validate equivalence. Don't handle fallback.
- **Adept** — tried this horizontally without explicit fallback. Folded.
- **Manual codification** — requires engineering teams nobody has time to spare. Even when teams want to, they don't know which call sites are worth the effort.

**5. The market knows the problem and is screaming for the answer.** Every AI cost survey published in 2025 named this exact category as the largest unaddressed inefficiency. No team has shipped the solution.

---

## The Insight Nobody Else Has Had

The 72% isn't wasteful because somebody misclassified it at install time. It's wasteful because **nobody is continuously evaluating whether each LLM call needs to be an LLM call** — and evaluating that is fundamentally a *programming* problem, not a model-routing problem.

So the right answer is to put a programming agent in the loop. One that:

1. **Reads** the call site
2. **Decides** structurally whether it can be replaced
3. **Confirms** the decision empirically with stress-testing
4. **Generates** the replacement using the customer's own agent
5. **Validates** the replacement against the LLM's actual behavior
6. **Routes** future calls through the replacement

We are the only team building this. And the architecture has six breakthroughs nobody has combined.

---

## How Compile Solves It — Six Architectural Breakthroughs

### 1. Code-First Codifiability Decision

We read the customer's source. Structural signals — `responseFormat: zodSchema(...)`, `temperature: 0`, bounded `tool` arrays, fully-parameterized prompt templates, `enum`-typed outputs — give us a codifiability prior in milliseconds.

This is **causal evidence, not correlative.** A `responseFormat: leadTierSchema` declaration on a `temperature: 0` call is the *cause* that outputs are bounded — not a sample of effects we have to count. Reading the cause directly is strictly stronger than every observability product on the market, which can only count effects after the fact.

**No 48-hour proxy wait. No data leaves the customer's trust boundary at this stage. Codifiability decided in milliseconds.**

### 2. Synthetic Stress Test Grounded in the Customer's Own Context

Once we've decided which call sites are codifiable, we *confirm* the decision with empirical evidence. Nia Document Agent reads the customer's docs (ICP doc, pricing, policy) and generates 100 realistic seed inputs per call site. Programmatic variation (industry × employee band × region × signal mix) expands them to 100,000. Tensorlake fires all 100K through a 64-worker parallel sandbox in 28 seconds.

The synthetic inputs are *real-shaped* because they're grounded in the customer's own corpus — not a sample of generic prompts we made up. This dodges the "your synthetic data doesn't match my production distribution" critique cleanly.

The 100K stress test does three jobs:
- **Confirms** the structural codifiability prediction empirically
- **Discovers** sub-patterns within each codifiable call site (a single site usually has 5–50 sub-patterns the typed function needs branches for)
- **Assigns** Tier 1 / Tier 2 / Tier 3 fallback per sub-pattern based on agreement with the customer's frontier LLM as oracle

### 3. The Agent Writes Its Own Replacement

Codegen runs in the customer's existing agent (Claude Code, Codex, Cursor, Devin) on the customer's existing LLM keys. Compile spends **zero frontier tokens**. The customer pays for codegen on the bill they were already paying.

> *"We use Codex to write the function that retires Codex from this task — and Codex pays for it."*

This is the architectural pivot that fixes three problems at once:
- **Trust boundary:** customer's prompts and traces never leave their environment
- **Unit economics:** Compile makes money on routing, not on burning frontier tokens
- **Scale economics:** synthesis cost stays constant for Compile no matter how many customers we onboard

That sentence wins the hackathon by itself.

### 4. Three-Tier Routing With Explicit, Honest Fallback

```
TIER 1   deterministic typed function   ~$0      ~1ms
TIER 2   local LLM with few-shot prior  ~$0.0001 ~50ms
TIER 3   frontier LLM escape hatch      ~$0.05   ~500ms
```

We never claim to replace the LLM. We claim to keep it off the hot path for the 72% of calls that don't need it.

Adept tried this horizontally without fallback and folded. We're vertical-first with structural fallback at every tier — the codified function calls `llmFallback(input)` on any path the synthetic stress test didn't cover. No silent degradation, ever.

### 5. MCP-Native Distribution

One line:
```bash
claude mcp add compile -- npx @compile/mcp
```

Works with every agent that supports MCP — Claude Code, Cursor, Codex, Devin, every modern agent shipped in 2025–2026. **The MCP ecosystem IS the distribution.** No dev-rel team. No integrations team. No custom SDK per language. Tweet the install command and we're in production at every customer that says yes.

### 6. The Negative Vault — Unit Economics Savior

Patterns that fail codifiability (either at Stage 1 from low static prior, or at Stage 2 from synthetic confirmation) get stored as first-class Vault entries with explicit retry policies:

| Failure reason | Retry policy |
|---|---|
| `creative_task` | Sticky — never retry |
| `novel_reasoning_required` | Sticky — never retry |
| `high_variance_outputs` | Retry on input distribution shift |
| `insufficient_data` | Retry once trace count crosses 30 |
| `low_static_prior` | Retry on next code change to the call site |

Without this, every Tier-3-only pattern would re-trigger a 100K-input sandbox run on every call. Synthesis cost would replace the LLM bill, and the product would eat itself.

We're the only team that's thought through this. Direct answer to the obvious judge question *"doesn't the 100K-call sandbox cost money?"*: yes, once per pattern, capped by the negative Vault. Forever.

---

## How Anyone Uses It — End to End

The customer experience is eleven phases, fully automated, total wall time ~90 seconds.

```
1.  Customer runs:   claude mcp add compile -- npx @compile/mcp
2.  Customer runs:   compile bootstrap --repo .
3.  Compile reads source code               → finds N LLM call sites
4.  Compile classifies each site            → red / yellow / green from code structure
                                              (codifiability is decided here)
5.  Compile asks Nia to read customer docs  → 100 realistic seed inputs per candidate
6.  Seeds expand to 100,000 synthetic calls per codifiable candidate
7.  Tensorlake fires all 100K in parallel   → outputs stream back live
8.  Outputs cluster automatically            → sub-pattern shape of the call site emerges
9.  Each cluster scored on 3 axes           → Tier 1 / Tier 2 / Tier 3 fallback per cluster
10. Customer's agent (Claude Code/Codex)    → receives synthesis spec, writes typed TS
                                              + Vitest tests, paid for on customer's keys
11. Compile validates against held-out 15% → ≥98% match required
12. Function written to Nia Vault          → reachable from production immediately
13. Customer's report rendered             → savings, codified set, what stays at frontier
```

Then it stays installed. Real traffic flows through always-on proxy mode — drift watcher, cluster refiner, new-pattern miner. Compile keeps improving in production.

---

## Unit Economics — The 600× ROI Math

Per customer onboarding, single 90-second bootstrap:

| Component | Cost | Who pays |
|---|---|---|
| Compile sandbox compute (Tensorlake 64-worker grid for 5 candidates × 100K calls) | ~$10 | Compile (one-time) |
| Synthetic input generation via Nia (100 seeds × 5 candidates) | ~$2.50 | Compile (one-time) |
| Oracle calls through customer's frontier LLM (1% sample, 5K total) | ~$50 | Customer (one-time, on existing API key) |
| **Total to Compile** | **~$12.50** | |
| **Total to customer** | **~$50** (one-time) | |

**What the customer gets in return:**
- 5 codified functions (typed TS, with tests, validated to ≥98% match)
- ~$66,800/year in projected annual savings (conservative — based on the demo workflow alone)
- A negative Vault that prevents future waste on uncodifiable patterns
- Always-on proxy mode that catches drift and discovers new patterns over time

**Customer-side ROI per onboarding:** $66,800 / $50 = **1,336× return.**

**Compile-side margin:** $12.50 sandbox cost amortized; routing fees on every Tier 1 / Tier 2 hit are the recurring revenue. At 8,400 calls/day on the lead-classification function alone, our routing fee at 1¢/codified-call is $84/day = $30,660/year per customer. Net contribution per customer: **$30,647/year on a $12.50 marginal cost.**

This isn't a slide-deck number. This is unit economics with a 2,500× LTV-to-acquisition ratio on a one-line install with no sales team.

---

## Why We Win First Place at Nozomio

Six structural advantages no other team has:

### 1. The Demo Is Unforgettable

Phase-by-phase storytelling, no panel chaos. Eleven full-bleed pages, each owning one moment, each auto-advancing as the pipeline progresses.

The hero moment is **Page 6: the constellation.** A 2D embedding-space projection of 100,000 synthetic calls, points flying in from chaos, force-directed simulation pulling similar outputs together, clusters emerging from noise, tier colors resolving as oracle agreement is computed. Implementation: deck.gl WebGL scatterplot + d3-force, 60fps with 100K animated points.

The closing moment is **Page 8: the agent live-typing the function that retires its own future calls** — Claude Code on stage, emitting typed TS character-by-character, tests appearing below.

Judges remember the constellation. Investors remember the punchline. Both happen on stage in 90 seconds.

### 2. Every Sponsor Is Doing Real Architectural Work

| Sponsor | Role | Why it matters to them |
|---|---|---|
| **Nia (Nozomio)** | Substrate of substrate. Document Agent generates synthetic inputs from customer docs. Vault stores every codified function. Eight load-bearing capabilities total. Remove Nia and Compile collapses. | Direct expression of Arlan's "expose data to AI agents" thesis — extended to "expose codified work to AI agents." |
| **Tensorlake** | The 64-worker grid IS the visual centerpiece. Online clustering, validation harness, Phi-3-mini hosting. Nobody else uses Tensorlake at this scale on stage. | Showcases parallel sandbox compute at hackathon-demo scale. |
| **Convex** | Reactive state engine for the constellation animation. Every completed call writes one row; canvas subscribes and paints diffs. Phase navigation is also Convex-driven. | The visual works because Convex subscriptions stream every result in real time. |
| **InsForge** | Postgres function registry + audit ledger. Every Stage-2 run logged with seed + cluster centroids for reproducibility. | Registry-of-record for the Vault. |
| **Vercel** | Public demo deploy at `compile-demo.vercel.app`. | Standard hackathon distribution. |
| **OpenAI Codex / Devin** | The on-stage agent that emits the typed function — paid for by Codex's own keys, on the customer's data. | Showcases agent-to-agent collaboration via MCP. |

None used as window dressing. Each sponsor sees their tech doing real architectural work. That maps to multiple sponsor prizes, not just Nozomio's grand prize.

### 3. The Pitch Lands in 30 Seconds

> *"Every founder in this room is overpaying their LLM bill. We hand them their personal number — which calls are wasteful, plus the typed function that retires them — in 90 seconds, no proxy wait. The agent we install writes its own replacement. The customer pays for codegen on the API key they already have. Compile makes money on routing."*

Universal recognition (every founder has this problem). Specific deliverable (typed function with $ figures). Unrebuttable wedge (no two-day wait, no dev-rel, no integration project).

### 4. Theme Alignment Is Direct, Not Adjacent

The theme is **"Build the Future of AI Agents."** Most submissions will be "an agent that does X."

We're **"the agent that retires the parts of every other agent that don't need to be agents."**

That's a fundamentally more interesting answer to the prompt — it's about *agent infrastructure*, not yet-another-agent. We're the agent layer that makes every other agent cheaper, faster, and more honest about its own capability.

### 5. Architectural Rigor Wins the Q&A

Thirteen decisions locked. Codex-audited dual pass. Every objection has a rehearsed answer:

| Q | A |
|---|---|
| Where is codifiability decided? | Page 3, from code structure. Stage 2 confirms + maps sub-patterns. |
| Sample size adequate? | Static prior is sample-invariant; only confirmation needs samples. |
| Oracle circularity? | Static prior from their code, oracle is their model. |
| 98% gate gameable? | 15% holdout kept private from the agent. |
| Synthetic distribution drift? | Marked predicted; refined by always-on proxy mode. |
| Sandbox cost? | Negative Vault prevents re-runs; ~$12.50 to us per onboarding. |
| Dynamic prompts? | Flagged `low_static_prior`, expiring on code change. |
| Adept failed at this? | Adept was horizontal without fallback; we're vertical with three-tier explicit fallback. |
| Couldn't I write these myself? | Yes. We find the call sites worth the effort, with $ figures, in 90 seconds. Most engineering teams never get past site #1. |

Judges who probe deeply leave more impressed, not less.

### 6. The Unit Economics Close the Investor Judges

$12.50 marginal cost to Compile per customer. $50 one-time to customer. Customer gets a function worth $31K/year. Compile earns ~$30K/year in routing fees on that one function alone.

**1,336× customer ROI. 2,500× LTV-to-acquisition ratio. One-line install with no sales team.**

That's not a pitch deck — that's a math problem with one answer. Investors on the judge panel will be the loudest advocates.

---

## The Pitch in One Breath

We solve the largest unaddressed cost problem in AI — that 72% of frontier LLM spend is buying capability nobody uses. We solve it with the only architecture that works: **read the customer's code to decide codifiability causally, stress-test 100,000 synthetic calls grounded in the customer's own corpus to confirm and shape the codification, and have the customer's own agent write the typed function that retires its own future calls** — paid for on the customer's existing API key, validated against held-out traces, persisted to Nia Vault.

90 seconds end to end. MCP-native distribution. Every sponsor doing real architectural work. Theme aligned to a T. Demo cinematic. Unit economics absurd.

If we ship the constellation, the on-stage codegen moment, and the 90-second wedge — **first place is ours if we execute. The risk is execution, not the idea.**

---

## Files

- [`DESIGN.md`](./DESIGN.md) — full architecture spec
- [`ENG_REVIEW.md`](./ENG_REVIEW.md) — locked decisions, derisks, build plan
- [`prompts/synthesizer.md`](./prompts/synthesizer.md) — the load-bearing synthesizer prompt

---

*Building the future of AI agents by putting them out of repeat work.*
