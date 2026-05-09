# RealityCI

> **CI/CD for the physical world.**
> Compile company SOPs, manuals, and incident logs into executable tests. Use cameras to verify whether real-world work followed company truth.

Built for the [Nozomio Hackathon](https://luma.com/rshibq6i) — May 9, 2026, EF office, San Francisco. Theme: *Build the Future of AI Agents.*

---

## The Pitch

Code has CI/CD. Physical work doesn't.

Factories, labs, warehouses, hospitals, and construction sites all have written procedures. Workers skip steps, use the wrong part, miss safety checks, repeat mistakes from old incidents. The company "knows" the right process, but no runtime checks whether reality followed it.

Siemens estimates the world's 500 largest companies lose ~$1.4T/year to unplanned downtime. OSHA tracks ~120 fatalities per year preventable by correct lockout/tagout compliance.

**RealityCI** is the missing primitive: turn the company's own SOPs and incident history into a runtime test plan, then verify reality against it with citation.

> Cameron detects events. RealityCI tests reality against company procedure.

## How It Works

1. **Ingest:** [Nia](https://docs.trynia.ai) indexes the company's SOPs, equipment manuals, incident logs, training videos, Slack notes, and safety memos.
2. **Compile:** The SOP → test graph compiler emits a directed graph of step nodes, branch nodes for safety checks, and reference edges to Nia citations.
3. **Verify:** Live camera frames are analyzed (YOLO + Gemini 2.0 Flash). Detected actions are checked against the expected node in the test graph.
4. **Cite:** On deviation, Nia retrieves the violated rule (paragraph-level provenance) and the matching prior incident.
5. **Adapt:** When a new incident is logged, Nia's continuous-monitor ingest updates the test graph in real time. Procedural memory accrues.

## Architecture

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│ Camera (live)    │     │ Production video │     │ Watched folder   │
│ — shipping demo  │     │ — factory floor  │     │ — incidents.json │
└────────┬─────────┘     └────────┬─────────┘     └────────┬─────────┘
         │                        │                        │
         ▼                        ▼                        ▼
┌─────────────────────────────────────────────┐   ┌──────────────────┐
│ YOLOv8 + Gemini Flash → step detection      │   │ Nia continuous   │
└─────────────────────┬───────────────────────┘   │ ingest           │
                      │                            └────────┬─────────┘
                      ▼                                     │
┌─────────────────────────────────────────────┐             │
│ Verifier (state machine)                    │             │
│ checks current step vs. expected            │             │
└─────────────────────┬───────────────────────┘             │
                      │                                     │
                      ▼                                     ▼
              ┌──────────────────────────────────────────────────┐
              │ Nia knowledge layer (SOPs, manuals, incidents)   │
              └─────────────────────┬────────────────────────────┘
                                    │
                                    ▼
                   ┌──────────────────────────────────┐
                   │ Convex (real-time state)         │
                   └─────────────────┬────────────────┘
                                     │
                                     ▼
                       ┌─────────────────────────────┐
                       │ Next.js dashboard (Vercel)  │
                       └─────────────────────────────┘
```

## Sponsor Stack

- **Nia / Nozomio** (host) — knowledge layer; indexes SOPs/manuals/incidents/videos/Slack/Drive; paragraph-level citations; continuous-monitor ingest.
- **Convex** — real-time backend; test runs, detections, citations, incidents, reports.
- **Vercel** — frontend deploy, edge.
- **Tensorlake** (Stretch) — sandboxed compiler runtime for the SOP → test graph step.
- **Hyperspell** (Stretch, hour 36+) — operator/station personalization layer.

## Demo Loop (180-second pitch)

1. **Live tabletop:** 5-step shipping SOP (everyday box-packing). Correct steps go green. Skipped step → red, with verbatim citation and prior-incident lookup.
2. **Production playback:** 30-second clip of real manufacturing-line footage runs through the same pipeline. Citations stream in real time.
3. **Live ingest:** A fresh incident JSON drops into the watched folder. Nia ingests; test graph adds a new check node within 10 seconds.
4. **Closing:** Same primitive runs against AI agent traces. Today: shipping floors. Tomorrow: agent governance.

## Deliverables

- Live demo (live camera + production playback + live-ingest beat)
- This repo (Next.js frontend + Convex backend + YOLO/Nia integration)
- `DESIGN.md` — full architecture, premises, day-by-day plan
- `NIA_IMPROVEMENTS.md` — friction points hit during the build, with concrete proposals (post-build deliverable)

## Status

Day 0. Design locked. Build kickoff: tonight.

See [`DESIGN.md`](./DESIGN.md) for the full plan.

---

*Built by adityasingh2400 for the Nozomio Hackathon. May 9, 2026.*
