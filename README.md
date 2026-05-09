# RealityCI

> **CI/CD for physical procedures and AI agents.**
> Compile a company's SOPs, manuals, safety standards, and incident logs into a runtime policy graph. Verify reality against it with citations, then dispatch the right response — whether the actor is a human, a camera, or an AI agent.

Built for the [Nozomio Hackathon](https://luma.com/rshibq6i) — May 9, 2026, EF office, San Francisco. Theme: *Build the Future of AI Agents.*

---

## The Pitch

Code has CI/CD. Physical work and AI-agent work do not.

Both are governed by written rules — OSHA, NFPA, lockout/tagout, SOPs, training videos, incident reports — that sit in PDFs, drives, and Slack threads. Nothing checks reality against them in real time.

A worker stacks a coffee mug on a power strip. A bag blocks the fire extinguisher. An agent calls a tool out of order and skips an approval step. The company "knows" the procedure. There's no runtime that verifies it and no execution layer that calls the right person before the first ten minutes are gone.

Siemens estimates the world's 500 largest companies lose ~$1.4T/year to unplanned downtime. OSHA estimates correct procedure prevents ~120 fatalities a year.

**RealityCI is the missing primitive:** turn the company's own documents into a knowledge graph, verify any actor — camera-observed human or AI agent — against it with citations, then call/text/email/escalate according to the exact response plan.

> Most camera systems detect what happened. RealityCI verifies whether what happened matched the rules, then makes the response happen.

## How It Works

1. **Index.** [Nia](https://docs.trynia.ai) ingests OSHA / NFPA / SOPs / manuals / training transcripts / incident logs / Slack / Notion.
2. **Compile.** A Nia Vault becomes the policy graph: rules, prior incidents, and typed wikilinks (`cites`, `supersedes`, `applies_to`).
3. **Observe.** Three event sources feed one verifier: live camera (YOLO-World + Gemini 3 Flash), watched-folder incident ingest, and a scripted agent-trace player.
4. **Verify.** The verifier checks each event against the policy graph and emits a structured violation with the cited rule.
5. **Cite.** A Nia Document Agent expands the violation with cross-references, remediation, and the response plan, streamed live.
6. **Dispatch.** InsForge edge functions fan out the response: voice call, SMS, Slack, email, audit log, escalation timer.
7. **Learn.** Every acknowledged violation writes a new Vault page via `nia sources write`. Agent failures write to Nia Context Sharing as procedural memory. The graph grows from its own operation — visibly, during the demo. `nia vault dream` runs overnight and finds connections across all self-generated incidents.

## Architecture

```
                EVENT SOURCES
   ┌────────────────────┬─────────────────────┐
   │                    │                     │
   ▼                    ▼                     ▼
Live camera        Watched folder         Agent trace player
(YOLO-World +      (incidents/*.json)     (scripted JSON
 Gemini 3 Flash)         │                  events)
   │                    │                     │
   │                    ▼                     │
   │            Nia continuous-monitor        │
   │            ingest (event source 2        │
   │            also writes new policy        │
   │            graph nodes)                  │
   │                    │                     │
   └────────────────────┼─────────────────────┘
                        ▼
            ┌──────────────────────────┐
            │ Verifier                 │
            │ event → policy graph     │
            │ citation → action plan   │
            └────────────┬─────────────┘
                         │
        ┌────────────────┼─────────────────┐
        ▼                ▼                 ▼
┌─────────────────┐ ┌──────────────────┐ ┌────────────────────┐
│  Nia            │ │  Convex          │ │ InsForge           │
│  Knowledge      │ │  Real-time state │ │ action ledger      │
│  Graph          │ │  + Agent threads │ │ + Edge dispatcher  │
└─────────────────┘ └─────────┬────────┘ └─────────┬──────────┘
                              │                    │
                              ▼                    ▼
                   ┌──────────────────┐   ┌────────────────────┐
                   │ Next.js (Vercel) │   │ Voice / SMS /      │
                   │ React Flow graph │   │ Slack / email      │
                   │ Citation card    │   └────────────────────┘
                   │ Action timeline  │
                   └──────────────────┘
```

## The Three Demo Scenes (180 seconds)

1. **Reality, audited and dispatched (0–65s).** Coffee mug placed on a power-strip card. The OSHA 1910.305 node turns red, related edges light up, the citation appears, and the demoer's phone rings with a safety-officer alert. Press `1` to acknowledge; the action timeline updates live.
2. **Memory, alive and executable (65–125s).** A new incident JSON is dropped in a watched folder. The graph grows live as Nia ingests it. A bag blocks the fire-extinguisher card; the cite + just-ingested prior incident + response plan all surface. Slack/SMS dispatch appears in the action timeline.
3. **The same runtime, but for agents (125–170s).** A scripted Claude-style agent calls shipping tools out of order. The verifier fires the same red flash, same citation, same prior-incident edge, then calls the agent owner: press `1` to halt, `2` to override with audit note.

## Sponsor Stack

- **Nia / Nozomio** (host, mandatory) — universal `index`, all 4 search modes, `nia_grep`, `nia_read`, `nia_explore`, **Document Agent**, **Data Extraction** (table + detect + engineering), **Vault** with `nia vault dream` + **Vault write API** (`nia sources write`), **Context Sharing** (procedural memory for agent failures), Local Sync, Connectors (Notion + Slack), Scoped MCP. **~14 distinct Nia capabilities, all load-bearing.**
- **Convex** — reactive policy-graph state, Agent Component for the agent-trace thread, websocket streaming deltas, action timeline UI.
- **InsForge** — Postgres action ledger, edge-function dispatch, role roster, acknowledgements, escalation timers, audit export.
- **Vercel** — Next.js deploy, edge.

Stretch: Aside for browser-based OSHA/ServiceNow/VelocityEHS form filling after the core demo works.

Cut: Tensorlake, Hyperspell, World Labs, Reacher.

## Detection Stack

- **YOLO-World** — open-vocabulary, zero-shot detection. Prompt list lives in `packages/detect/yolo-world.prompts.ts`. **No labeling, no training.**
- **Gemini 3 Flash** — Agentic Vision for hazard relationships ("is the mug above the power strip?"). 800ms latency cap; never blocks the verifier.

The combination eliminates the v2 plan's #1 demo-day risk (YOLO mis-detection at venue lighting). YOLO-World was pretrained on huge corpora and is robust to lighting drift.

## Deliverables

- Live demo (camera + watched-folder ingest + scripted agent trace)
- This repo (Next.js + Convex + Nia + YOLO-World + Gemini 3 Flash)
- [`DESIGN.md`](./DESIGN.md) — full architecture, three scenes, flat task list
- [`DECISIONS.md`](./DECISIONS.md) — every architectural choice with rationale, sponsor tech map, lessons from Arlan/Nozomio
- [`TEST_PLAN.md`](./TEST_PLAN.md) — 42 tests across Vitest + Playwright + 1 eval suite
- `NIA_IMPROVEMENTS.md` — friction points hit during the build with concrete proposals (post-build deliverable)

## Status

Day 3, v5. Self-improving loops added: violations write themselves to Nia Vault on acknowledgement (Loop A); agent failures write to Nia Context Sharing and Vault (Loop B). Graph grows from its own operation during the demo. 14 Nia capabilities, all load-bearing.

See [`DESIGN.md`](./DESIGN.md) for the full plan and [`DECISIONS.md`](./DECISIONS.md) for the why-of-each-decision.

---

*Built by adityasingh2400 for the Nozomio Hackathon. May 9, 2026.*
