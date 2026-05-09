# Compile

> **MCP server that compiles repeat LLM work out of the agent loop.**

Built for the [Nozomio Hackathon](https://luma.com/rshibq6i) — May 9, 2026, EF office, San Francisco. Theme: *Build the Future of AI Agents.*

---

## The Pitch

**Plug Compile into a customer's agent traffic for 48 hours and we hand them their *personal* number** — which clusters of their LLM calls are pattern-repetitive, what they cost per month, and which ones are deterministically replaceable. Not industry vibes, not hand-waving — actual line items from their actual receipts:

> *"Cluster #3 is 'extract order ID from support emails,' 8,400 calls/day, $31k/year, replaceable with a 12-line regex. Want us to retire it?"*

That's the wedge. The supporting math (research across the Anthropic Economic Index, OpenAI State of Enterprise AI, a16z LLM cost surveys) is why the line items exist:

- **~38% of production LLM volume is highly codifiable** — extraction, classification, glue, boilerplate codegen, repetitive browser flows
- **~34% is partially codifiable** — RAG retrieval, support replies, partial summarization, sales research. Small local LLMs handle these at 1/100th the cost of frontier
- **~28% is genuinely frontier-only** — creative work, novel reasoning, true open-ended tasks

Today the entire 100% gets routed to a frontier model at frontier prices. The 38% that could be a typed function and the 34% that could be a 1B-parameter local model are paying for capability they don't use.

**Compile is an MCP server that any AI agent installs in one line and immediately gets the ability to compile its own repeat work out of the LLM loop.** Two pipelines:

1. **Identification (passive):** the MCP shim logs every call as a receipt, templates them, clusters them, and scores each cluster on three codifiability axes. Codifiability is a measurable property, not a vibe.
2. **Synthesis (on-demand, agent-driven):** when a hot cluster has no Vault entry, Compile returns a synthesis spec to the *customer's own agent*, which runs the codegen using its *own LLM keys* on its *own data* and submits the typed function back. Compile validates against held-out traces, gates at ≥98% match, and writes to Nia Vault.

**The codegen happens in the customer's agent context — Compile spends zero frontier-LLM tokens.** The agent literally writes its own replacement, billed to the agent's existing API key, on data that never leaves the customer's trust boundary. The agent puts itself out of a job, and the codified library belongs to the customer.

## Three-Tier Routing

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
- **Genuine unknown** (no match in either positive or negative Vault): forwards to Tier 3 AND queues for synthesis

The negative Vault is load-bearing for unit economics. Without it, every Tier-3-only pattern re-triggers a 100-input sandbox run on every call — synthesis cost replaces LLM cost and the product eats itself. Negative entries carry a retry policy: `creative_task` and `novel_reasoning_required` are sticky; `high_variance_outputs` re-evaluates on distribution shift; `insufficient_data` expires once observed trace count crosses 30.

Every Tier 3 call is observed for the pattern miner. Hot clusters with no Vault entry (positive or negative) become candidates for synthesis. Synthesized functions get sandbox-tested against held-out traces, and either promoted (positive Vault) or recorded as uncodifiable (negative Vault) — both outcomes compound the library.

## Identification Pipeline

Codifiability is a measurable property of a cluster of LLM calls, not a vibe. The identification pipeline runs passively against the call stream and surfaces ranked candidates with concrete dollar figures attached. Five stages:

**1. Receipt logging.** Every MCP call is logged as a receipt:

```
{
  call_id, timestamp, agent_id, prompt, tool_schemas,
  input, output, tokens_in, tokens_out, cost_usd, latency_ms,
  model, parent_task_id?
}
```

Receipts are the substrate everything else runs on.

**2. Template-ization.** A prompt like *"Extract the order ID from this email: <body>"* and another *"Extract the order ID from this email: <other body>"* are the same job with different inputs. The templater detects the static wrapper vs. the variable slot via structural diff (longest common prefix/suffix on tokenized prompts, plus tool-schema match) and collapses thousands of calls into a handful of templates with typed slots.

**3. Embed and cluster.** Templates are embedded (Nia semantic search) and clustered. Semantically equivalent jobs group together even when surface form differs. Cluster centroids become the lookup key for routing (D8 negative cache + positive hits).

**4. Score on three axes.** Each cluster gets three measurable scores — these *replace* LLM-vibes-based tier classification:

| Axis | Definition | Computed how |
|---|---|---|
| **Schema stability** | Does the output always validate against the same inferred JSON shape? | Infer JSON Schema from N outputs; measure % that validate. ≥0.95 = stable. **No LLM oracle needed.** |
| **Determinism** | Replay the same input twice — do answers match semantically >95% of the time? | Re-run K traces through the LLM; compare via embedding cosine + JSON-equality. Self-consistency check. |
| **Economic value** | Volume × per-call cost vs. engineering effort to replace | `(monthly_call_count × tier_3_cost) - synthesis_cost - maintenance_cost`. Break-even hit count published per cluster. |

A cluster passes to synthesis only when **all three** clear thresholds. Clusters that fail any axis go to the negative Vault with the failing axis as the `reason`. (Stickiness: schema-instability and economic-non-viability can flip on schema/volume change; non-determinism is sticky unless the upstream model changes.)

**5. Rank and surface.** Passing clusters are ranked by projected annual savings and exposed via `compile.list_codify_candidates()`. The 48-hour report (see Distribution) is the customer-facing output of this stage.

**Why this matters for the audit.** Two of the sharpest review findings dissolve here: schema stability is a structural check that doesn't need an LLM oracle (resolves the "circular oracle" critique for that axis); the economic-value axis IS the break-even formula that judges expect. Determinism is still LLM-grounded but as *self-consistency*, not accuracy — Compile guarantees we faithfully reproduce what the LLM does, which is what the customer already trusted.

## Distribution: One-Line Install

For Claude Code:
```bash
claude mcp add compile -- npx @compile/mcp
```

For Cursor (`cursor.json`):
```json
{ "mcpServers": { "compile": { "command": "npx", "args": ["@compile/mcp"] } } }
```

For any custom Anthropic / OpenAI agent: standard MCP server config, one line. The agent gains seven tools:

```
compile.observe_call(receipt)                    → log a receipt to the identification pipeline
compile.find_function(description)               → semantic search via Nia (returns hit / negative-hit / unknown)
compile.run_codified(function_id, input)         → execute codified function via Tensorlake runtime
compile.list_codify_candidates()                 → ranked clusters that passed 3-axis scoring; powers the 48h report
compile.request_synthesis(cluster_id)            → returns a synthesis spec (prompt + traces + schemas + customer docs)
                                                   the AGENT runs codegen using its OWN LLM keys
compile.submit_synthesis(request_id, code, tests, contract)
                                                 → agent submits emitted TS; Compile validates against
                                                   holdout traces, gates ≥98%, writes to Nia Vault
compile.estimate_savings(cluster_id, monthly_vol)→ projected $ savings per tier with break-even formula
```

**The synthesis round-trip is the architectural pivot.** Compile does NOT call Codex/Claude with its own API key to generate functions. It returns a synthesis spec to the calling agent and the agent's existing LLM does the codegen. Three customer wins fall out: (a) prompts and traces never leave the agent's trust boundary; (b) the customer pays for codegen on the LLM bill they were already paying; (c) Compile's unit economics don't depend on absorbing synthesis cost — we make money on routing, not codegen.

## How Compile Uses Nia (Nozomio's Flagship)

Nia is not a checkbox — it's the substrate the entire product is built on. Remove Nia and Compile collapses. Eight load-bearing capabilities:

| # | Capability | Role |
|---|---|---|
| 1 | **Vault** | Codified function library. Each function = one Vault page with source, tests, contracts, cost graph, drift events |
| 2 | **Vault write API (`nia sources write`)** | Functions get written to Vault live during demo and operation |
| 3 | **Semantic search + `nia_grep`** | Pattern miner clusters traces; replaces a custom embedding store |
| 4 | **Document Agent** | Grounds emitted functions in customer docs (ICP doc, pricing, policy). Functions cite sources |
| 5 | **Connectors (Notion, Slack)** | Stream policy doc changes continuously; trigger contract re-validation |
| 6 | **`nia vault dream`** | Overnight cross-customer pattern discovery. Network effect |
| 7 | **Data Extraction** | Replaces LLM web/PDF parsing. Codified functions call `nia.extract()` directly |
| 8 | **Scoped MCP + Context Sharing** | Customer's agent queries its library through Nia-mediated MCP namespace; failure context carries to next synthesis |

Arlan's stated thesis: Nia exposes data and filerooms to AI agents. Compile extends it: **expose codified work to AI agents in the same shape, mediated through Nia.**

## Architecture

Three pipelines: identification (passive), routing (live), synthesis (on-demand, agent-driven).

```
┌─── IDENTIFICATION (passive, runs against the receipt stream) ─────────┐
│                                                                       │
│  receipts → templates → embed/cluster (Nia) → 3-axis score →          │
│  ranked codify_candidates (with $ projections)                        │
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
│                                          (drop into SYNTHESIS)        │
└───────────────────────────────────────────────────────────────────────┘

┌─── SYNTHESIS (on-demand, agent-driven — Compile spends 0 LLM tokens) ─┐
│                                                                       │
│  1. Compile assembles synthesis spec from Identification pipeline:    │
│     {prompt_template, tool_schemas, observed traces (real, ≥30),      │
│      customer_docs (Nia Document Agent), 3-axis scores, holdout split}│
│                                                                       │
│  2. compile.request_synthesis(cluster_id) → returns the spec          │
│                                                                       │
│  3. CUSTOMER'S AGENT runs codegen using its OWN LLM keys              │
│     (Codex CLI / Claude Code / Cursor / Devin)                        │
│     → emits typed TS function + Vitest tests + contract               │
│                                                                       │
│  4. compile.submit_synthesis(request_id, code, tests, contract)       │
│                                                                       │
│  5. Compile validates in Tensorlake sandbox:                          │
│     - run emitted code against held-out traces                        │
│     - schema-stability + determinism + ≥98% match required            │
│                                                                       │
│  6. Write outcome to Nia Vault:                                       │
│     - PASS  → positive entry (function_id + savings)                  │
│     - FAIL  → negative entry with retry_policy (D8)                   │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

## Five-Stage Visible Pipeline (the demo)

```
[1] IDENTIFY          [2] SYNTHESIZE        [3] SANDBOX           [4] VERIFY            [5] SAVINGS
    Pattern miner       Tensorlake spins      Replay codified       Compare deterministic    Cost tally:
    queries Nia for     100 synthetic         function against       output vs. frontier      $40.00 → $1.20
    similar functions;  inputs; runs them     real or synthetic      LLM oracle on every      on this batch.
    surfaces matches    through frontier      cluster. Vitest         input. ≥98% match →     Projected:
    or NEW pattern.     LLM in sandbox.       passes / fails.        promote. <98% →          $X / month.
                                                                     stay frontier.           Nia Vault grows.
```

Total demo: ~75–90 seconds for one workflow end-to-end. Each stage gets a panel; data flows left-to-right in real time as the MCP server processes a single agent call.

## Demo Workflow: Sales Lead Qualification (ICP fit)

Input: company profile (domain, employee count, industry, signals).
Output: `{ fit: bool, confidence: number, tier_used: string, reasoning: string }`.

The workflow naturally splits across all three tiers:

| Tier | When it fires | Example |
|---|---|---|
| **Tier 1** (deterministic) | Hard rules match: employee count, industry, revenue band | "500-person fintech in NA → fit: true, conf: 0.96" |
| **Tier 2** (local LLM) | Mid-market with mixed signals — needs judgment but bounded | "85-person hybrid SaaS/services, healthcare-adjacent → conf: 0.72" |
| **Tier 3** (frontier) | Novel positioning the rules don't cover | "stealth-mode AI/biotech with no website → escalate" |

Why this workflow:
- Every founder + investor in the room recognizes ICP-fit pain (Clay charges $0.30–$3.75/row for this exact lookup)
- Three tiers produce visibly distinct routing paths on screen
- Acme corpus (fake ICP doc in Notion) gets ingested by Nia Document Agent — visible Nia surface
- Synthetic generation is clean: 100 fake company profiles with varied signal mixes

## Sponsor Stack

| Sponsor | Role | Surfaces used |
|---|---|---|
| **Nia (Nozomio)** | Substrate of substrate. 8 capabilities, all load-bearing (see above). | Vault, Vault write API, Document Agent, Connectors, `vault dream`, Scoped MCP, Data Extraction, Context Sharing, semantic search, `nia_grep`, Local Sync |
| **Tensorlake** | Sandbox compute. Validation (running agent-emitted TS against held-out traces), Tier-2 Phi-3-mini hosting, drift sampling. *Note:* synthesis-time codegen runs in the customer's agent, not in Tensorlake — Compile does not pay for codegen tokens. | Sandbox compute, sandboxed model execution |
| **Convex** | Reactive console state. Pipeline panels, run ledger, cost-decay graphs, real-time promotion events, MCP call stream. | Real-time DB, Agent component |
| **InsForge** | Postgres function registry. Audit trail. Edge-function dispatch on drift / promotion / de-promotion. | Postgres, edge functions, auth |
| **Vercel** | Console deploy. Public docs site. MCP server registry endpoint. | Next.js, edge |
| **OpenAI Codex / Devin** | The customer's agent in our demo — installs Compile via MCP, observes its own traffic, then receives the synthesis spec and writes the typed TS that retires its own future calls. **Codex's API key, customer's data, codified function belongs to customer.** Compile spends 0 tokens here. *"We use Codex to write the function that retires Codex from this task — and Codex pays for it."* | MCP client; codegen via customer's own API key |
| Hyperspell (stretch) | Long-term per-customer prompt-tuning state for Tier-2 calls | Memory layer |
| Aside (stretch) | Browser-portal codification for Tier-3 calls touching vendor portals | Browser-as-OS |

## Distribution Plan

**Saturday demo:** Live Vercel deploy of MCP server + console at `compile-demo.vercel.app`. Backup 90-second video recording in case venue WiFi fails.

**Post-hackathon:** Open-source SDK on npm (`@compile/mcp`). Public docs at compile.dev. Hosted MCP server on Vercel + Convex. The MCP server is the primary install surface; an OpenAI-compatible gateway proxy is added in v2. CI/CD: GitHub Actions builds and publishes the MCP server on tag; Vercel auto-deploys console on push to main.

**Distribution thesis:** Submit to the Anthropic / Claude Code MCP server registry. Tweet the install command. Every agent that supports MCP is one-line away. No dev-rel team needed; the MCP ecosystem IS the distribution.

### The 48-Hour Report

The sales motion that follows from the identification pipeline. A prospect installs Compile (one-line MCP add), opts the agent into receipt logging, and runs their normal traffic for 48 hours. Compile delivers a customer-specific PDF / dashboard:

```
COMPILE REPORT — <customer_name> — 48h sample (Mon–Wed)

Total LLM spend observed:           $4,217
Calls observed:                     142,318
Templates collapsed:                47
Clusters identified:                23

CODIFY CANDIDATES (ranked by annual savings):

#1  "extract order ID from support emails"
    8,400 calls/day · $31,200/yr · schema-stable · deterministic
    → 12-line regex, break-even at hit #4
#2  "classify ticket priority"
    3,100/day · $14,800/yr · schema-stable · deterministic
    → typed function with enum output
#3  "summarize PDF invoice line items"
    900/day · $9,400/yr · partially codifiable (Tier 2)
    → Phi-3-mini with 5 few-shots
...

UNCODIFIABLE (negative Vault):
    "draft customer reply" — 2,800/day · creative_task — keep at frontier
    ...

PROJECTED ANNUAL SAVINGS (T1+T2 promotions): $187k
```

No industry stats. Their numbers, their clusters, their savings. The dashboard is the demo *and* the lead magnet *and* the contract trigger. Codify candidates flow directly into the synthesis pipeline — the customer's agent writes the replacements with one click.

## Repo Structure (planned)

```
packages/
  mcp-server/        # @compile/mcp — the MCP server with 6 tools
  synthesizer/       # cluster → typed function emission
  runtime/           # Tensorlake sandbox runner + Tier-2 Phi hosting
  ui/                # 5-panel pipeline dashboard (Next.js + Convex)
  nia/               # thin wrapper over Nia API surfaces

convex/              # Convex backend (reactive state, agent component)
data/                # fake Acme corpus (Notion + Slack samples)
prompts/
  synthesizer.md     # the load-bearing prompt — see ENG_REVIEW.md
```

## Status

Day 1 of build. Plan reviewed via /office-hours and /plan-eng-review on 2026-05-07. Six architectural decisions locked (see `ENG_REVIEW.md`). Critical Friday derisks identified (synthesizer harness, Phi cold start, npm publish). Implementation starts Saturday May 9.

See [`ENG_REVIEW.md`](./ENG_REVIEW.md) for architectural decisions, scope cuts, and Friday derisk plan.
See [`prompts/synthesizer.md`](./prompts/synthesizer.md) for the synthesizer prompt spec — the demo's load-bearing artifact.

---

*Building the future of AI agents by putting them out of repeat work.*
