# Design: RealityCI — Runtime for Physical Procedures

Last refined: 2026-05-04 (v3)
Repo: github.com/adityasingh2400/warden
Status: APPROVED
Mode: Builder
Hackathon: Nozomio Hackathon, May 9 2026, EF office, San Francisco
Theme: "Build the Future of AI Agents"

---

## Problem Statement

Code has CI/CD. Physical work and AI-agent work do not. Both are governed by
written rules: SOPs, manuals, safety standards, OSHA, NFPA, training videos,
incident reports, lockout/tagout procedures, post-mortems. Those rules sit in
PDFs, drives, Slack threads, and Notion pages. **Nothing checks reality
against them in real time.**

Workers stack a coffee mug on a power strip. A bag blocks the fire
extinguisher. Someone climbs a chair instead of a ladder. An agent calls a
tool out of order and skips an approval step. The company "knows" the
procedure. There's no runtime that verifies it.

Reference data the demo cites: Siemens 2024 estimates the world's 500
largest companies lose ~~$1.4T/year to unplanned downtime (~~11% of revenue).
OSHA estimates correct lockout/tagout prevents ~120 fatalities and 50,000
injuries annually. Falls remain the #1 cause of workplace fatalities (BLS).

---

## The Inversion

Most camera systems detect what happened. RealityCI verifies whether what
happened **matched the rules.** That is not a sensor — it is a compiler:

- A company's documents (SOPs, manuals, incident logs, training transcripts,
Slack discussions) become a **policy graph** with cited rules and edges.
- A camera (or an AI-agent trace) emits **events.** Events are facts about
reality: "coffee mug is on power strip," "agent called `apply_label`
before `add_packing_material`."
- The verifier checks each event against the policy graph and surfaces a
**citation** for every pass and every violation.

The same primitive verifies humans and AI agents. That is the on-theme
hook for "Build the Future of AI Agents."

---

## Why This Design Wins

Three claims this build is making:

1. **Verification beats detection.** "AI camera" demos are everywhere; an
  AI runtime that checks reality against the company's own policies, with
   citations, is rare.
2. **Knowledge graph beats RAG.** Nia is not a retrieval tool here. It is
  the policy graph. The graph is rendered live, queried with multiple
   modes, refreshed continuously, and self-improves overnight via
   `nia vault dream`. Arlan's public thesis: "filesystem over RAG."
   We honor it.
3. **Same runtime, two substrates.** Today: a person violating a safety
  policy. Tomorrow: a Claude agent calling tools out of order. One
   verifier, one policy graph, two event sources.

---

## What Changed in v3 (vs. v2 design pulled 2026-05-04)


| Area                      | v2 plan                                 | v3 (this doc)                                                 |
| ------------------------- | --------------------------------------- | ------------------------------------------------------------- |
| Demo language             | "beats"                                 | "scenes"                                                      |
| Demo domain               | Shipping SOP, packing tape, blue cap    | **Safety / hazard events** (mug-on-power-strip, blocked exit) |
| Detection stack           | YOLOv8n finetuned on 5 objects + Gemini | **YOLO-World (zero-shot) + Gemini 3 Flash** — no training     |
| YOLO labeling             | ~8h Roboflow marathon                   | **0h** — open-vocabulary, prompt with text classes            |
| Gemini model              | Gemini 2.0 Flash                        | **Gemini 3 Flash** (Agentic Vision, released Jan 2026)        |
| Nia usage                 | ingest + retrieval + cite               | **12 capability surfaces** (see Nia Integration)              |
| Visual primitive          | 5-step linear test graph                | **Policy graph** — rules, references, prior-incident edges    |
| Build cadence             | Day-by-day                              | **Flat task list** with priority + dependency tags            |
| Tensorlake                | Stretch (cut Day 5)                     | Cut entirely                                                  |
| Image region (bbox) cites | Cut                                     | Re-introduced via Nia's native `extract/detect` (free win)    |
| Production-footage scene  | Half-in (architecture only)             | **Removed.** Three scenes, not four                           |


**Net effect:** ~14 hours saved (no labeling/training, no production-footage
hunt, no Tensorlake). Reinvested into a deeper Nia integration, the policy
graph, and rehearsals.

---

## The Three Scenes (180-second pitch)

We use the word **scene**, not "beat." Each scene is one continuous,
rehearsed visual moment.

### Scene 1 — "Reality, audited" (0–60s)

Open shot: the dashboard. Top-left tile streams the live camera feed. The
center tile is the **policy graph**, a force-directed React Flow rendering
of rules retrieved from Nia: "OSHA 1910.305 — electrical hazards," "OSHA
1910.157 — emergency equipment," "OSHA 1910.23 — ladders." Right tile is
the citation card.

The demoer sets a coffee mug on top of a printed power-strip card on the
table. Within a second, two things happen:

1. The "OSHA 1910.305(g)(1)(iii) — Liquid near energized equipment" node in
  the graph turns red and pulses. Edges to the related rule "Spill
   prevention" and the prior incident "INC-2024-018: server room flooded
   from coffee spill" light up.
2. The citation card surfaces verbatim: "Energized parts of electric
  equipment operating at 50 volts or more shall be guarded against
   accidental contact... portable equipment shall be supported as
   needed..." with the source PDF page rendered as a thumbnail.

Demoer narrates: "RealityCI didn't just see a mug. It saw a policy
violation. The rule is from the company's own safety manual. Nia indexed
it once. Now reality runs against it in real time."

### Scene 2 — "Memory, alive" (60–120s)

Demoer drops a JSON file into a watched folder via a hotkey macro:

```json
{
  "id": "INC-2026-094",
  "type": "near-miss",
  "summary": "Bag blocking fire extinguisher in shipping bay 3",
  "occurred_at": "2026-05-04T14:30:00Z",
  "rule_violated": "OSHA 1910.157(c)(1)"
}
```

The dashboard spinner flashes "Nia ingesting..." For ~5–8 seconds, judges
see the policy graph **grow**: a new incident node attaches to the
"Emergency equipment access" rule. Rule weight visibly thickens (more
incidents = thicker edges = higher visual priority).

Demoer takes a paper bag and places it directly in front of the printed
"fire extinguisher" sign on the wall. The verifier fires immediately. The
new incident node is *already* in the graph — the rule cite + the
just-ingested prior incident both surface in the citation card.

Narration: "Most procedure systems are static. The company learns from
every incident. The runtime learns with it. Watch what happens when the
night-shift `nia vault dream` job runs..."

A short pre-recorded clip plays in the corner: the policy graph
self-improves overnight (Vault discovers a connection between three near-
misses and reclassifies a low-priority rule into a high-priority one). The
clip is real Nia output, recorded in dry-run.

### Scene 3 — "The same runtime, but for agents" (120–170s)

The dashboard shifts: top-left becomes an **agent trace pane** showing a
scripted agent calling shipping tools.

```
[00:00] agent.pick_up_box()              ✓
[00:03] agent.add_product()              ✓
[00:06] agent.apply_shipping_label()     ✗  out-of-order
                                              expected: add_packing_material
                                              first
```

The verifier fires the same red flash, the same citation, the same edge to
the prior incident. The graph shows it doesn't care whether the actor is a
person or an LLM. **Same policy. Same engine. Same memory.**

Narration: "Today: factories. Tomorrow: every AI agent that touches a real
process. We built the runtime."

### Outro (170–180s)

"Siemens estimates physical-work failures cost the world's largest
companies $1.4T a year. OSHA estimates correct procedure prevents 120
deaths a year. We turn your company's own documents into the runtime that
prevents them. Thank you. We're RealityCI."

**Timing notes:**

- Hard cap on Scene 1 = 60s. We trim citation narration if it runs long.
- Scene 2's `vault dream` clip is pre-recorded; cuttable to 5s if pacing demands.
- Scene 3 cannot be cut. It is the on-theme moment. If we run long, the
outro shrinks to 5 seconds.

---

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
│  Graph          │◄────write────│  + Agent threads │
│ (Vault + index) │  audit       │  + websocket     │
│                 │  trail       │  streaming       │
│ search/query/   │              │                  │
│ deep, document  │              └─────────┬────────┘
│ agent, oracle,  │                        │
│ tracer, vault   │                        ▼
│ dream, scoped   │              ┌──────────────────┐
│ MCP, local sync │              │ Next.js (Vercel) │
└─────────────────┘              │ React Flow graph │
                                 │ Agent trace pane │
                                 │ Citation card    │
                                 │ Camera feed      │
                                 └──────────────────┘
```

The verifier is **substrate-agnostic.** It does not know whether an event
came from a camera, a watched folder, or an agent trace. Same state machine,
same policy graph, same citation pipeline.

---

## Detection Stack

We do not train any model. The 8 hours we'd spend labeling buys nothing
the open-vocabulary stack doesn't already give us.

### Layer 1 — YOLO-World (object detection, zero-shot)

YOLO-World is open-vocabulary YOLO. You hand it a list of text classes; it
detects them. CVPR 2024, 18.3ms inference on a laptop, 22.4M parameters,
shipped as a model in Ultralytics.

Our prompt list (lives in `packages/detect/yolo-world.prompts.ts`):

```typescript
const HAZARD_CLASSES = [
  "fire", "smoke", "candle",
  "person", "hard hat", "high-vis vest", "ladder",
  "coffee mug", "water bottle", "open container", "drink",
  "power strip", "extension cord", "outlet", "cable",
  "fire extinguisher", "exit sign",
  "paper bag", "cardboard box", "stack of papers",
  "chair", "step stool",
];
```

YOLO-World runs locally at 1 fps. Output: bounding boxes + class labels +
confidences.

### Layer 2 — Gemini 3 Flash (scene reasoning, agentic vision)

Gemini 3 Flash (released January 2026) supports **Agentic Vision** —
active investigation through zoom, inspect, and step-wise reasoning. It
takes the YOLO-World detections and answers structured questions:

- "Is the coffee mug positioned over the power strip?" → yes/no + reason
- "Is the bag occluding the fire extinguisher?" → yes/no + reason
- "Is the person standing on a ladder, chair, or step stool? At what
approximate angle?"

Latency budget: **800ms hard cap** per Gemini call. Beyond that, the
in-flight call is discarded; the verifier falls back to YOLO-World-only
proximity heuristic. Gemini is *additive context*, never blocking.

The two layers merge into a single **structured event stream**:

```typescript
type HazardEvent = {
  ts: number;
  source: 'camera' | 'agent' | 'incident_ingest';
  observed: {
    objects: { class: string; bbox: [number,number,number,number]; conf: number }[];
    scene_relation?: string; // from Gemini, e.g., "mug above power strip"
  };
  candidate_rules: string[]; // ids of policy graph nodes the verifier should check
};
```

### Why this beats the v2 plan

- **No labeling, no training, no fine-tuning.** Saves ~14 hours of build.
- **Robust to venue lighting.** YOLO-World was pretrained on huge corpora.
v2 plan's #1 demo-day risk was venue-lighting drift on a custom-finetuned
model. That risk is now zero.
- **Open vocabulary = expandable demo.** Adding a new hazard scenario is
one line in the prompt list, not a new labeling marathon.

---

## Nia Integration — Use the Whole Surface

Arlan Rakhmetzhanov (Nozomio) wrote: *"If your team is still pasting docs
into coding agents, you're already behind."* The whole point of Nia is
that context is infrastructure. We treat it as such. We use ~12 distinct
Nia capabilities, not just `search`.

### 1. Indexing (universal `index`)

One call ingests all source types:


| Source                           | What it gives the policy graph                          |
| -------------------------------- | ------------------------------------------------------- |
| OSHA 1910 PDF                    | Authoritative rule nodes with paragraph anchors         |
| Company SOP PDFs                 | Internal rule nodes (override OSHA where stricter)      |
| NFPA 1 PDF                       | Fire-code rule nodes                                    |
| Equipment manuals                | Equipment-specific rule nodes (proximity, torque, etc.) |
| Training video transcripts       | "Why this matters" framing for rules                    |
| Incident log JSONL               | Prior-incident nodes, edges to violated rules           |
| Slack `#safety-incidents` (mock) | Real-time incident reports                              |
| Notion safety wiki (Connector)   | Internal procedural notes                               |


We use **branch/ref selection** for OSHA (current revision) and **global
source dedup** so OSHA gets indexed once across the community.

### 2. Search (4 modes)


| Mode        | Where we use it                                                           |
| ----------- | ------------------------------------------------------------------------- |
| `query`     | Conversational lookup in the dashboard's "Why?" tooltip                   |
| `universal` | Vector + BM25 across all sources for the verifier's rule lookup           |
| `deep`      | Multi-step research powering the post-violation "what happened" expansion |
| `web`       | Cross-reference OSHA updates and recent regulatory changes (live)         |


### 3. nia_grep (regex)

Used for exact rule-number lookups: `1910\.305\(g\)\(1\)\(iii\)`. Faster
than semantic search for this specific case.

### 4. nia_read

When a violation fires, the citation card calls `nia_read` to fetch the
exact paragraph (with page + line range). No client-side PDF rendering;
Nia returns the snippet + thumbnail.

### 5. nia_explore

The dashboard's "Source Inspector" pane (debug-only, judges optional)
shows the file tree of indexed sources via `nia_explore`. Demonstrates
that Nia is the substrate, not just a search box.

### 6. Document Agent

When a violation fires, RealityCI optionally launches a **Document Agent**
against the specific manual PDF with a JSON schema:

```typescript
{
  rule_id: string,
  exact_quote: string,
  page: number,
  paragraph: number,
  cross_references: { rule_id: string, source: string }[],
  recommended_remediation: string,
}
```

The agent plans, navigates the PDF tree, follows cross-references, and
returns the typed object. **This is autonomous tool use inside a single
PDF — exactly the kind of feature Arlan publicly emphasizes.**

Use Claude Haiku for speed (sub-second). Schema-bound. SSE-streamed into
Convex so the citation card hydrates progressively.

### 7. Data Extraction — `detect`

Nia's `extract/detect` returns bounding boxes for visual elements (tables,
figures, diagrams) on PDF pages. We use this to **render the violated
diagram** in the citation card, with the bbox highlighted. (We cut hand-
rolled bbox citations in v2; Nia exposes them natively in v3 — free win.)

### 8. Engineering Extraction

For technical manuals (P&IDs, schematics, lockout-tagout diagrams), Nia
has a purpose-built `extract/engineering` mode with `accuracy_mode`
(`fast` or `precise`). Used at compile time when ingesting equipment
manuals.

### 9. Vault — agent-maintained policy wiki

This is where we differentiate. The compiled **policy graph** is a Nia
Vault. Every rule is a wiki page with:

- **Compiled Truth** (above `---`): the current canonical statement of the
rule, rewritten when evidence changes.
- **Timeline** (below `---`): append-only evidence trail of every incident
that has cited this rule.
- **Wikilinks** with typed relationships: `[[1910.305]] supersedes [[NFPA-70]]`, `[[INC-2024-018]] cites [[1910.305]]`.

Workflows we use:


| Command                     | When                                                 |
| --------------------------- | ---------------------------------------------------- |
| `nia vault init`            | Day 1 setup                                          |
| `nia vault ingest`          | When a new manual / incident is added                |
| `nia vault sync`            | Hourly auto-run; on demand for the demo              |
| `nia vault dream`           | **Demo Scene 2 finale** — recorded, played in corner |
| `nia vault open --c "tree"` | Demo dashboard's source inspector                    |


The Vault's force-directed graph view in `app.trynia.ai/vaults` is what
we render in our React Flow pane. We are mirroring Arlan's UI choice.

### 10. Context Sharing

Episodic + procedural memory across runs. Specifically:

- After every demo run, save a `procedural` context: "tabletop hazard
setup with mug + power strip" so the next agent can replay it.
- Cross-thread message search lets the agent trace look up "have we seen
`apply_label` before `add_packing_material` before?"

### 11. Local Sync

The incidents folder is a Local Sync source. The daemon (`nia`) watches
the folder with real-time file events. When the demo drops a new JSON
file, Nia detects it within seconds without polling.

### 12. Connectors

Notion connector ingests our mock "internal safety wiki." Slack connector
(BYOT mode) ingests `#safety-incidents`. Both feed the policy graph
automatically with cron-scheduled re-index.

### What we are NOT using (and why)

- **Sandbox Search** — we have no public-Git lookup needs in the demo flow.
- **Tracer** — same. Nice for a follow-up post if we cite OSHA's GitHub.
- **End-to-End Encryption** — no PII / personal data in the demo.
- **Package Search** — irrelevant.

If a judge asks "why aren't you using X?", the answer is honest: we used
the surfaces that make the demo better; we left the rest for a v2 that
needs them.

---

## The Policy Graph (visual + structural)

The center of the dashboard is a force-directed React Flow graph. Nodes:


| Node type      | Color     | Source                             |
| -------------- | --------- | ---------------------------------- |
| Active rule    | gray      | Indexed source (OSHA, SOP, NFPA)   |
| Violated rule  | red pulse | Verifier flagged it in this run    |
| Passing rule   | green     | Verifier confirmed compliance      |
| Prior incident | amber dot | Incident log, edges to cited rules |
| Equipment      | blue      | Equipment manual node              |


Edges:

- `cites` (incident → rule)
- `supersedes` (newer rule → older)
- `references` (rule → rule, e.g., NFPA-70 → OSHA-1910.305)
- `applies_to` (rule → equipment)

The graph is a Convex query. Convex's reactive `useQuery` propagates node
state changes to the React Flow component without polling. Animated edge
draws on transitions. Pulsing border on violations.

---

## Verifier State Machine

Simpler than v2 (no per-step "AWAITING_N" linear progression — hazards are
asynchronous). The state machine watches an event stream and fires
violations.

```
                    event arrives
                          │
                          ▼
                   ┌──────────────┐
                   │  EVALUATING  │
                   └──┬───────────┘
                      │
       ┌──────────────┼─────────────────────────┐
       │              │                          │
       ▼              ▼                          ▼
matches passing   matches violation        no relevant rule
  rule (green)    rule (red flash +          (silent ignore)
                  citation render)
       │              │
       └──────┬───────┘
              ▼
   ┌─────────────────────┐
   │  EMIT_TO_CONVEX     │
   │  + write to Vault   │
   │  timeline           │
   └─────────────────────┘
```

State data:

- `current_run_id`
- `events_observed` (append-only)
- `violations_fired` (with citations)
- `last_emit_ts` (for debouncing — same event within 2s = ignore)

LOST_SIGNAL: still relevant. If the camera feed stalls for 5s, we render a
yellow banner "camera stalled, verification paused"; the agent-trace pane
keeps running independently.

---

## Network Resilience

EF venue wifi cannot be a hard demo dependency. Pre-cache everything the
3-scene demo needs to the laptop:

- Compiled policy graph JSON (local file)
- All citations the demo will encounter (static JSON keyed by `rule_id`)
- 2 incident scenarios for Scene 2 (pre-staged JSON + Nia-cached
embeddings)
- Local Convex dev instance fallback
- YOLO-World weights (already local — Ultralytics ships them)
- Optional: a small local VLM (Llama 3.2 Vision via Ollama) as Gemini-3-
Flash fallback for the scene-reasoner

Day-of: turn wifi off, run the full demo. Anything that breaks gets fixed
before the pitch slot.

---

## Test Plan

**Frameworks:** Vitest (unit), Playwright (E2E), simple JSON-comparison eval.


| Module                     | Tests  | Type                         |
| -------------------------- | ------ | ---------------------------- |
| Verifier state machine     | 8      | Unit                         |
| Citation resolver          | 5      | Unit (mocked Nia)            |
| Policy graph compiler      | 4      | Unit + 1 integration         |
| Live ingest watcher        | 2      | Integration                  |
| Agent trace player         | 3      | Unit                         |
| YOLO-World wrapper         | 2      | Integration (golden frames)  |
| Gemini-3-Flash latency cap | 1      | Integration (hard 800ms cap) |
| Critical paths (3 scenes)  | 3      | E2E (Playwright)             |
| Policy graph render        | 2      | E2E                          |
| Network-off rehearsal      | 1      | Manual checklist             |
| **Total**                  | **31** | mixed                        |


Critical paths:

1. Scene 1 — mug on power strip → red flash + cite + edge animation
2. Scene 2 — drop incident JSON → graph node grows → bag in front of fire
  extinguisher → cite + matching prior incident
3. Scene 3 — agent trace player → out-of-order tool call → red flash + cite

---

## Tasks (flat, with priority + dependencies)

Priority: **P0** = must work for demo. **P1** = makes demo great. **P2** =
nice-to-have polish.

### Detection + verifier

- **P0** Set up YOLO-World locally (`pip install ultralytics`, model
download, smoke test on a sample frame)
- **P0** Define hazard prompt list (`packages/detect/yolo-world.prompts.ts`)
- **P0** YOLO-World wrapper module: `detect(frame) → DetectionEvent[]`
- **P0** Gemini 3 Flash wrapper with hard 800ms latency cap
- **P0** Hazard-relation prompts for Gemini (proximity, occlusion,
posture)
- **P0** Verifier state machine (`packages/verifier/state-machine.ts`)
with 8 unit tests
- **P0** Citation resolver (Nia primary, structured-JSON fallback)
with 5 unit tests
- **P0** Two golden-frame integration tests for YOLO-World
- **P1** Latency profiling harness (event-to-render histogram)
- **P2** Local VLM fallback (Llama 3.2 Vision via Ollama)

### Nia integration

- **P0** Nia API key + project setup
- **P0** Index OSHA 1910, NFPA 1, mock company SOP, equipment manual,
incident log JSONL
- **P0** Verify paragraph-level retrieval works for known rule IDs
- **P0** Citation provenance fallback: structured-JSON shadow copy of
SOP and incidents
- **P1** Document Agent integration for post-violation expansion
(Claude Haiku, JSON schema)
- **P1** Vault init: build policy wiki from indexed sources
- **P1** Pre-record `nia vault dream` clip for Scene 2 finale
- **P1** Local Sync daemon watching the incidents folder
- **P1** Notion connector for mock internal safety wiki
- **P2** Slack connector (BYOT) for `#safety-incidents`
- **P2** `nia_explore` source inspector pane in dashboard

### Convex

- **P0** Schema: `runs`, `policy_graph_state`, `events`, `citations`,
`incidents`, `violations`
- **P0** Mutations for: start_run, end_run, emit_event, fire_violation,
ingest_incident
- **P0** Query for live policy graph state (drives React Flow)
- **P1** Convex Agent Component for the agent-trace thread
- **P1** Streaming deltas via websocket for the agent trace pane

### Frontend (Next.js + Vercel)

- **P0** Three-pane shell: camera feed (left), policy graph (center),
citation card (right)
- **P0** React Flow + dagre layout for the policy graph
- **P0** Node + edge styles (gray / green / red pulse / amber dot / blue)
- **P0** Citation card component (rule cite, source thumbnail, prior
incident card)
- **P0** Agent trace pane (left side, swaps from camera feed in
Scene 3)
- **P0** Hotkey macro: `START`, `INGEST_INCIDENT`, `SWITCH_TO_AGENT`
- **P1** Edge-draw animation on rule transitions
- **P1** Pulsing border on violation
- **P1** "Why this rule?" tooltip wired to Nia `query` mode
- **P2** Source inspector pane

### Demo prep

- **P0** SOP authoring: 3 mock company hazard policies with real
OSHA/NFPA cross-references and section anchors
- **P0** Incident log: 5 prior incidents in JSONL with cited rule IDs
- **P0** Stage materials: coffee mug, paper bag, printed power-strip
card, printed fire-extinguisher card, ladder/stick, candle, papers
- **P0** Camera mount + ring light
- **P0** Hidden hotkey fallback for incident ingest (direct Convex
mutation)
- **P0** Backup video recorded
- **P0** Network-off dress rehearsal
- **P1** Pre-recorded `nia vault dream` clip
- **P1** Pitch deck (3 slides max)
- **P1** `NIA_IMPROVEMENTS.md` drafted as friction-points-encountered

### Agent trace (Scene 3)

- **P0** Pre-scripted agent trace player (TypeScript module that emits
events into the verifier)
- **P0** 3 unit tests for the trace player
- **P0** Agent trace UI pane (log lines, timestamps, status)
- **P1** Architecture doc note: live LLM trace is a one-file swap
(post-hackathon)

### Tests

- **P0** 8 verifier unit tests
- **P0** 5 citation resolver unit tests
- **P0** 4 policy graph compiler unit tests
- **P0** 3 critical-path E2E tests in Playwright
- **P1** 2 ingest watcher integration tests
- **P1** 3 agent-trace player unit tests
- **P1** Network-off manual checklist signed off

### Pre-pitch checklist (day-of)

- **P0** Arrive 90 minutes before pitch slot
- **P0** Camera + ring light + mount setup
- **P0** YOLO-World prompt smoke test under venue lighting
- **P0** Hidden hotkeys tested (5+ presses)
- **P0** Backup video on hotkey
- **P0** Network-off path verified one last time

---

## Open Questions (still pending)

- **Team size and roles.** CV/ML, Backend, Frontend, Demo ops. Confirm
before serious build starts.
- **Pitch length.** 3 minutes is tight even with three scenes. Confirm with
org. If 5 minutes, expand Scene 3 with a live (not scripted) agent.
- **Backup video ownership.** One person owns recording, hotkey, and
fallback runbook.
- **Hotkey macro framework.** Karabiner Elements vs. a simple Electron
overlay. Decide on Day 1.
- **MCP exposure (v2).** Worth mentioning in Q&A: RealityCI as an MCP server
any agent can plug into. Strong "Future of AI Agents" follow-on.

---

## Success Criteria

The demo is a success if:

1. Policy graph compiles from OSHA + SOP PDFs in <30 seconds at startup.
2. YOLO-World detects all hazard classes correctly under venue lighting
  (no training, no calibration drift).
3. Violation event → red flash + Nia citation visible to judges within 1
  second.
4. React Flow graph animates smoothly (no jank, no flicker).
5. Scene 2 ingest beat: incident JSON → graph grows → cite within 8s,
  reliably.
6. Scene 3 agent trace: scripted out-of-order call → same red flash + same
  citation surface.
7. Convex propagates all state without page reload throughout.
8. `NIA_IMPROVEMENTS.md` delivered as a submission deliverable with 3-5
  concrete proposals.
9. Full demo runs offline (network-off rehearsal passes).
10. Judges leave saying "wait, that was Nia under the hood?" — meaning the
  Nia integration was visible and load-bearing, not invisible plumbing.

### Non-goals

- General industrial CV (we use open-vocabulary text prompts; we are not
building a generic safety detector)
- Multi-camera support
- Authentication / multi-tenant
- Real LLM agent in Scene 3 (scripted trace ships; live agent is v2)
- Hyperspell, Aside, World Labs, Reacher
- Tensorlake (cut)

---

## Sponsor Stack (brief — full mapping in DECISIONS.md)

- **Nia / Nozomio (mandatory):** indexing, search (4 modes), Document Agent,
Data Extraction (table + detect + engineering), Vault, Context Sharing,
Local Sync, Connectors (Notion, Slack), Scoped MCP, `nia vault dream`.
~12 capability surfaces in load-bearing roles.
- **Convex:** real-time policy graph state, Agent Component for the agent-
trace thread, websocket streaming deltas.
- **Vercel:** Next.js deploy, edge.
- **Tensorlake:** cut.
- **Hyperspell, Aside, World Labs, Reacher:** cut.

---

## Distribution

- **Hackathon submission:** GitHub repo, Vercel deploy URL, demo video,
`NIA_IMPROVEMENTS.md`.
- **Devpost:** standard submission with screenshots + 3-min demo video.
- **CI/CD:** Vercel auto-deploy on `main`. Convex deploys via
`npx convex deploy`.
- **Post-hackathon (v2 hooks already in place):** expose RealityCI as an
MCP server; live LLM agent in Scene 3 via one-file swap; Document Agent
expansion to multi-PDF.

---

See **DECISIONS.md** for: per-sponsor exact usage, architectural
rationale for every choice, what we learned from Arlan's prior hackathons
and public theses, and why every cut feature was cut.