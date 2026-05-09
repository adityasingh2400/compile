# Compile

> **MCP server that compiles repeat LLM work out of the agent loop — codifiability decided from your code in milliseconds, then confirmed by 100,000 synthetic calls in 28 seconds.**

Built for the [Nozomio Hackathon](https://luma.com/rshibq6i) — May 9, 2026, EF office, San Francisco. Theme: *Build the Future of AI Agents.*

## Quick start

```bash
npm install
npm run build       # all 9 workspaces
npm test            # 57 tests across the monorepo
npm run dev:ui      # boot the demo on http://localhost:5173
```

Open `http://localhost:5173` and the 90-second auto-timeline runs. Open `http://localhost:5173?source=real` to see the same demo backed by real scanner output (a `LIVE` badge appears in the page corner).

## Documents

| Doc | Purpose |
|---|---|
| [`PITCH.md`](./PITCH.md) | Why Compile matters, the 600× ROI math, why we win first place |
| [`DESIGN.md`](./DESIGN.md) | Full architecture spec — two-stage codifiability, three-tier routing, MCP-native distribution, eleven-page demo flow |
| [`ENG_REVIEW.md`](./ENG_REVIEW.md) | Thirteen architectural decisions locked, derisks, build plan |
| [`DEMO_RUNBOOK.md`](./DEMO_RUNBOOK.md) | On-stage operation: hotkeys, talking track per page, failure-mode response |
| [`prompts/synthesizer.md`](./prompts/synthesizer.md) | Load-bearing synthesizer prompt spec |

## Packages

| Package | Role |
|---|---|
| `@compile/schemas` | Shared Zod schemas — single source of truth for all wire shapes |
| `@compile/scanner` | TS AST scanner that decides Stage-1 codifiability from code structure |
| `@compile/synth-loader` | Stage-2 fan-out — generates synthetic inputs and runs the parallel grid |
| `@compile/synthesizer` | Synthesis spec assembly + holdout split + envelope validator + harness |
| `@compile/identifier` | Pattern identification + scoring + templating |
| `@compile/runtime` | Tensorlake wrapper, Phi-3-mini client (Ollama-backed), Vitest gate runner, synthetic input generator |
| `@compile/nia` | Nia API client (Vault + Document Agent) |
| `@compile/stream` | `IBootstrapStream` interface + Memory and Convex implementations |
| `@compile/mcp-server` | The MCP server with 9 tools — `npm pack`-ready as `@compile/mcp` |
| `@compile/ui` | The 11-page bootstrap demo (Vite + React + canvas constellation) |

## Useful commands

```bash
npm run dev:ui                                    # boot the UI demo
npm run dev:mcp                                   # boot the MCP server
npm run snapshot                                  # regenerate live bootstrap snapshot
npm run harness                                   # run the synthesizer harness on hardcoded clusters
npm run derisk:phi -w @compile/runtime            # measure Phi-3-mini cold start (needs ollama)
npm run generate:inputs -w @compile/runtime --    # generate synthetic inputs for a demo cluster
                  --cluster icp_fit --n 10
```

## What ships Saturday

Sub-90-second bootstrap that turns repeat LLM work into typed functions, with the agent that wrote the function paid for by the customer's existing API key. We solve the largest unaddressed cost problem in AI: 72% of frontier LLM spend is buying capability nobody uses. We solve it by reading the customer's code (causal evidence of codifiability), stress-testing 100,000 synthetic calls grounded in their corpus (empirical confirmation + sub-pattern shape), and having the customer's own agent write the typed function that retires its own future calls.

90 seconds end to end. MCP-native. Every sponsor doing real architectural work. First place is ours if we execute.
