# RealityCI

> **CI/CD for physical procedures and AI agents.**
> Compile a company's SOPs, manuals, safety standards, and incident logs into a runtime policy graph. Verify reality against it with citations — whether the actor is a human, a camera, or an AI agent.

Built for the [Nozomio Hackathon](https://luma.com/rshibq6i) — May 9, 2026, EF office, San Francisco. Theme: *Build the Future of AI Agents.*

---

## The Pitch

Code has CI/CD. Physical work and AI-agent work do not.

Both are governed by written rules — OSHA, NFPA, lockout/tagout, SOPs, training videos, incident reports — that sit in PDFs, drives, and Slack threads. Nothing checks reality against them in real time.

A worker stacks a coffee mug on a power strip. A bag blocks the fire extinguisher. An agent calls a tool out of order and skips an approval step. The company "knows" the procedure. There's no runtime that verifies it.

Siemens estimates the world's 500 largest companies lose ~$1.4T/year to unplanned downtime. OSHA estimates correct procedure prevents ~120 fatalities a year.

**RealityCI is the missing primitive:** turn the company's own documents into a knowledge graph, then verify any actor — camera-observed human or AI agent — against it with citations.

> Most camera systems detect what happened. RealityCI verifies whether what happened matched the rules.

## How It Works

1. **Index.** [Nia](https://docs.trynia.ai) ingests OSHA / NFPA / SOPs / manuals / training transcripts / incident logs / Slack / Notion.
2. **Compile.** A Nia Vault becomes the policy graph: rules, prior incidents, and typed wikilinks (`cites`, `supersedes`, `applies_to`).
3. **Observe.** Three event sources feed one verifier: live camera (YOLO-World + Gemini 3 Flash), watched-folder incident ingest, and a scripted agent-trace player.
4. **Verify.** The verifier checks each event against the policy graph and emits a structured violation with the cited rule.
5. **Cite.** A Nia Document Agent expands the violation with cross-references and remediation, streamed live.
6. **Adapt.** `nia vault dream` runs overnight, finds new connections, and the graph self-improves.

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
            │ Verifier (state machine)  │
            │ event → policy graph     │
            │ lookup → citation        │
            └────────────┬─────────────┘
                         │
        ┌────────────────┴───────────────┐
        ▼                                ▼
┌─────────────────┐              ┌──────────────────┐
│  Nia            │              │  Convex          │
│  Knowledge      │              │  Real-time state │
│  Graph          │              │  + Agent threads │
│ (Vault + index) │              │  + websocket     │
└─────────────────┘              └─────────┬────────┘
                                           │
                                           ▼
                                ┌──────────────────┐
                                │ Next.js (Vercel) │
                                │ React Flow graph │
                                │ Citation card    │
                                └──────────────────┘
```

## The Three Demo Scenes (180 seconds)

1. **Reality, audited (0–60s).** Coffee mug placed on a power-strip card. The OSHA 1910.305 node in the policy graph turns red, edges to related rules and prior incidents light up, the verbatim citation appears.
2. **Memory, alive (60–120s).** A new incident JSON is dropped in a watched folder. The graph grows live as Nia ingests it. A bag is placed in front of the fire-extinguisher card; the cite + just-ingested prior incident both surface. A short pre-recorded `nia vault dream` clip plays in the corner — the graph self-improves overnight.
3. **The same runtime, but for agents (120–170s).** The dashboard switches to an agent-trace pane. A scripted Claude-style agent calls shipping tools out of order. The verifier fires the same red flash, the same citation, the same prior-incident edge. **Same primitive, different actor.**

## Sponsor Stack

- **Nia / Nozomio** (host, mandatory) — universal `index`, all 4 search modes, `nia_grep`, `nia_read`, `nia_explore`, **Document Agent**, **Data Extraction** (table + detect + engineering), **Vault** with `nia vault dream`, Context Sharing, Local Sync, Connectors (Notion + Slack), Scoped MCP. **~12 distinct Nia capabilities, all load-bearing.**
- **Convex** — reactive policy-graph state, Agent Component for the agent-trace thread, websocket streaming deltas.
- **Vercel** — Next.js deploy, edge.

Cut: Tensorlake, Hyperspell, Aside, World Labs, Reacher.

## Detection Stack

- **YOLO-World** — open-vocabulary, zero-shot detection. Prompt list lives in `packages/detect/yolo-world.prompts.ts`. **No labeling, no training.**
- **Gemini 3 Flash** — Agentic Vision for hazard relationships ("is the mug above the power strip?"). 800ms latency cap; never blocks the verifier.

The combination eliminates the v2 plan's #1 demo-day risk (YOLO mis-detection at venue lighting). YOLO-World was pretrained on huge corpora and is robust to lighting drift.

## Deliverables

- Live demo (camera + watched-folder ingest + scripted agent trace)
- This repo (Next.js + Convex + Nia + YOLO-World + Gemini 3 Flash)
- [`DESIGN.md`](./DESIGN.md) — full architecture, three scenes, flat task list
- [`DECISIONS.md`](./DECISIONS.md) — every architectural choice with rationale, sponsor tech map, lessons from Arlan/Nozomio
- [`TEST_PLAN.md`](./TEST_PLAN.md) — 31 tests across Vitest + Playwright + 1 eval suite
- `NIA_IMPROVEMENTS.md` — friction points hit during the build with concrete proposals (post-build deliverable)

## Status

Day 1, v3. Design refined. YOLO training cut. Demo pivoted to safety/hazard events. Build kickoff: tonight.

See [`DESIGN.md`](./DESIGN.md) for the full plan and [`DECISIONS.md`](./DECISIONS.md) for the why-of-each-decision.

---

*Built by adityasingh2400 for the Nozomio Hackathon. May 9, 2026.*
