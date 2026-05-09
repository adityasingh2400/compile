# Compile

> **MCP server that compiles repeat LLM work out of the agent loop.**

Built for the [Nozomio Hackathon](https://luma.com/rshibq6i) — May 9, 2026, EF office, San Francisco. Theme: *Build the Future of AI Agents.*

---

## The Pitch

Every AI agent / API product running on OpenAI or Anthropic in 2026 is paying a recurring frontier-LLM bill where a large fraction of calls are pattern-repetitive. Research across the Anthropic Economic Index, OpenAI State of Enterprise AI, and a16z LLM cost surveys converges on:

- **~38% of production LLM volume is highly codifiable** — extraction, classification, glue, boilerplate codegen, repetitive browser flows
- **~34% is partially codifiable** — RAG retrieval, support replies, partial summarization, sales research. Small local LLMs handle these at 1/100th the cost of frontier
- **~28% is genuinely frontier-only** — creative work, novel reasoning, true open-ended tasks

Today the entire 100% gets routed to a frontier model at frontier prices. The 38% that could be a typed function and the 34% that could be a 1B-parameter local model are paying for capability they don't use.

**Compile is an MCP server that any AI agent installs in one line and immediately gets the ability to compile its own repeat work out of the LLM loop.**

Before an agent makes an LLM call, it asks Compile: *"do I have a codified version of this?"* If yes, deterministic function runs. If no, Compile **synthetically bootstraps** a codified version on the spot — generates 100 diverse inputs in a Tensorlake sandbox, runs them through the LLM, mines patterns, emits a typed function with tests, stores it in Nia Vault. The agent's next call hits the codified path. Bill drops, agent runs faster, the codified library compounds.

The agent puts itself out of a job, and the codified library belongs to the customer.

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

When a call hits Compile, it pattern-matches against the customer's Nia Vault library:
- **High-confidence match**: routes to Tier 1 (deterministic emitted function)
- **Medium-confidence match**: routes to Tier 2 (local small LLM with the pattern as prior)
- **No match / low confidence**: routes to Tier 3 (forwards to upstream frontier LLM)

Every Tier 3 call is observed for the pattern miner. Hot clusters become candidates for synthesis. Synthesized functions get sandbox-tested against the LLM oracle, and only promoted when they pass the quality gate.

## Distribution: One-Line Install

For Claude Code:
```bash
claude mcp add compile -- npx @compile/mcp
```

For Cursor (`cursor.json`):
```json
{ "mcpServers": { "compile": { "command": "npx", "args": ["@compile/mcp"] } } }
```

For any custom Anthropic / OpenAI agent: standard MCP server config, one line. The agent gains six new tools:

```
compile.list_codified()                          → list functions in Vault, with savings stats
compile.find_function(description)               → semantic search via Nia
compile.run_codified(function_id, input)         → execute via Tensorlake runtime
compile.codify_prompt(template, tool_schemas)    → synthetic bootstrap
compile.observe_call(prompt, input, output)      → record for pattern miner
compile.estimate_savings(template, monthly_vol)  → projected $ savings per tier
```

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

```
┌────────── customer's agent (Claude Code / Cursor / Devin) ──────────┐
│                                                                     │
│  agent intends to call LLM, but first asks:                        │
│                                                                     │
│       compile.find_function("describe what I'm about to do")        │
│                          │                                           │
│              ┌───────────┴────────────┐                             │
│              │                        │                              │
│         FOUND match?              NO match?                          │
│              │                        │                              │
│              ▼                        ▼                              │
│   compile.run_codified         compile.codify_prompt                 │
│   (Tier 1 or Tier 2)           (synthetic bootstrap)                 │
│              │                        │                              │
│              │                        │ 1. Tensorlake spins 100      │
│              │                        │    synthetic inputs          │
│              │                        │ 2. Inputs run through        │
│              │                        │    frontier LLM in sandbox   │
│              │                        │ 3. Pattern miner clusters    │
│              │                        │    via Nia semantic search   │
│              │                        │ 4. Synthesizer (Codex)       │
│              │                        │    emits typed function      │
│              │                        │ 5. Sandbox-test ≥98% match   │
│              │                        │ 6. Write to Nia Vault        │
│              ▼                        ▼                              │
│      deterministic output      function_id + savings                 │
│      ~$0, ~1ms                                                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
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
| **Tensorlake** | Sandbox compute. Synthetic input generation, frontier-LLM execution during bootstrap, replay quality-gate testing, Tier-2 Phi-3-mini hosting, drift sampling. | Sandbox compute, sandboxed model execution |
| **Convex** | Reactive console state. Pipeline panels, run ledger, cost-decay graphs, real-time promotion events, MCP call stream. | Real-time DB, Agent component |
| **InsForge** | Postgres function registry. Audit trail. Edge-function dispatch on drift / promotion / de-promotion. | Postgres, edge functions, auth |
| **Vercel** | Console deploy. Public docs site. MCP server registry endpoint. | Next.js, edge |
| **OpenAI Codex / Devin** | Synthesizer model. Codex emits typed TS function from a cluster. *"We use Codex to write the function that retires Codex from this task."* | Code generation API |
| Hyperspell (stretch) | Long-term per-customer prompt-tuning state for Tier-2 calls | Memory layer |
| Aside (stretch) | Browser-portal codification for Tier-3 calls touching vendor portals | Browser-as-OS |

## Distribution Plan

**Saturday demo:** Live Vercel deploy of MCP server + console at `compile-demo.vercel.app`. Backup 90-second video recording in case venue WiFi fails.

**Post-hackathon:** Open-source SDK on npm (`@compile/mcp`). Public docs at compile.dev. Hosted MCP server on Vercel + Convex. The MCP server is the primary install surface; an OpenAI-compatible gateway proxy is added in v2. CI/CD: GitHub Actions builds and publishes the MCP server on tag; Vercel auto-deploys console on push to main.

**Distribution thesis:** Submit to the Anthropic / Claude Code MCP server registry. Tweet the install command. Every agent that supports MCP is one-line away. No dev-rel team needed; the MCP ecosystem IS the distribution.

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
