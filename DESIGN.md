# Design: RealityCI — Runtime for Physical Procedures

Last refined: 2026-05-06 (v5 — adds self-improving loops)
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
happened **matched the rules — and then makes the response happen.** That
is not a sensor. It is a compiler with an executor.

- A company's documents (SOPs, manuals, incident logs, training transcripts,
Slack discussions) become a **policy graph** with cited rules and edges.
- A camera (or an AI-agent trace) emits **events.** Events are facts about
reality: "coffee mug is on power strip," "agent called `apply_label`
before `add_packing_material`."
- The verifier checks each event against the policy graph and emits a
**violation** with a citation.
- The **action layer** dispatches the response automatically: voice call
to the on-shift safety officer, Slack message to `#incidents`, SMS to
the facility manager, audit log written, escalation timer started. For
P0 hazards (fire), it dials a (mock) 911 line. The system *does
something* — it does not just light up a dashboard.

The same primitive verifies humans and AI agents — and runs the same
response protocol against both. That is the on-theme hook for "Build the
Future of AI Agents."

### Why detection without execution is half a product

Industry research is unambiguous on this. From the Crises-Control 2026
analysis of manufacturing incident response (citing Siemens TCOD 2024,
ARC Advisory 2023, OSHA/BLS 2024):

- **40% of plant incidents occur during or after shift changes.** The
ten minutes after a shift ends are statistically the riskiest of the
working day.
- A documented case: SCADA alert fired at 6:47 AM. **Nobody moved for
nine minutes.** Three people assumed someone else had it; the shift
lead had handed over 11 minutes earlier; the emergency plan named a
supervisor who transferred in February.
- **30% of manufacturing downtime** is from manual-process error.
- **220,000 manufacturing workplace injuries in 2024.**
- DuPont La Porte 2014: four deaths traced to shift-handover communication
failure.

The detection wasn't the problem. The response was. RealityCI's action
layer is the part that closes the gap from *"the system saw it"* to
*"the system acted on it."*

---

## Why This Design Wins

Four claims this build is making:

1. **Verification over detection.** "AI camera" demos are everywhere; an
  AI runtime that checks reality against the company's own policies, with
   citations, is rare.
2. **Knowledge graph over RAG.** Nia is not a retrieval tool here. It is
  the policy graph. The graph is rendered live, queried with multiple
   modes, refreshed continuously, and self-improves overnight via
   `nia vault dream`. Arlan's public thesis: "filesystem over RAG."
   We honor it.
3. **Same runtime, two substrates.** Today: a person violating a safety
  policy. Tomorrow: a Claude agent calling tools out of order. One
   verifier, one policy graph, two event sources.
4. **Detection AND execution.** The system doesn't stop at "the dashboard
  lit up." It calls the right person, sends the SMS, writes the audit
   trail, escalates if no acknowledgment lands within the SLA, and
   produces the OSHA 29 CFR 1904 / ISO 45001 record as a byproduct of
   the response. The execution layer is what turns *"interesting demo"*
   into *"this would actually have prevented the 9-minute delay."*

---

## What Changed in v4 (action layer) and v3 (hazard pivot)


| Area                      | v2 plan                                 | v3                                                  | v4 (this doc)                                                                         |
| ------------------------- | --------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Demo language             | pitch segments                          | "scenes"                                            | scenes (unchanged)                                                                    |
| Demo domain               | Shipping SOP, packing tape, blue cap    | Safety / hazard events                              | Safety / hazard events + execution                                                    |
| Detection stack           | YOLOv8n finetuned on 5 objects + Gemini | YOLO-World (zero-shot) + Gemini 3 Flash             | unchanged                                                                             |
| YOLO labeling             | ~8h Roboflow marathon                   | 0h                                                  | unchanged                                                                             |
| Gemini model              | Gemini 2.0 Flash                        | Gemini 3 Flash (Agentic Vision)                     | unchanged                                                                             |
| Nia usage                 | ingest + retrieval + cite               | 12 capability surfaces                              | + 2 surfaces for action plans (Document Agent JSON schema, Vault response-plan pages) |
| Visual primitive          | 5-step linear test graph                | Policy graph (rules, edges, prior incidents)        | + Action timeline pane                                                                |
| Build cadence             | Day-by-day                              | Flat task list                                      | unchanged                                                                             |
| Tensorlake                | Stretch (cut Day 5)                     | Cut entirely                                        | Cut                                                                                   |
| Image region (bbox) cites | Cut                                     | Re-introduced via Nia's `extract/detect` (free win) | unchanged                                                                             |
| Production-footage scene  | Half-in (architecture only)             | Removed                                             | Removed                                                                               |
| Sponsor stack             | Nia + Convex + Vercel                   | + InsForge + Aside (mentioned)                      | **InsForge load-bearing for action layer**, Aside stretch                             |
| **Execution / response**  | None                                    | None                                                | **Voice call + SMS + Slack + email + audit log + escalation**                         |
| **Demo wow moment**       | Live ingest scene                       | Live ingest + agent trace                           | + **The phone literally rings during the pitch**                                      |


**Net effect:** v3 saved ~14 hours by killing YOLO training and the
production-footage scene. v4 spends some of that budget on the action
layer (Twilio voice + SMS + Slack + email + audit log + escalation +
ack tracker) and the InsForge integration that powers it. The 3-scene
pitch length stays at 180 seconds — execution is *folded into* each
scene, not added as a fourth scene.

---

## The Three Scenes (180-second pitch)

Each scene is one continuous, rehearsed visual moment.

### Scene 1 — "Reality, audited and dispatched" (0–65s)

**Open shot.** The dashboard. Four tiles:

- **Top-left:** live camera feed.
- **Center:** the **policy graph** — a force-directed React Flow rendering
of rules retrieved from Nia ("OSHA 1910.305 — electrical hazards,"
"OSHA 1910.157 — emergency equipment access," "OSHA 1910.23 —
ladders," and ~15 other safety rule nodes with edges to prior
incidents).
- **Right:** the citation card (currently empty).
- **Bottom:** the **action timeline pane** (currently empty).

**The violation.** Demoer sets a coffee mug on top of a printed power-
strip card. Within ~1 second:

1. YOLO-World detects `coffee_mug` and `power_strip`. Gemini 3 Flash
  confirms "mug above power strip" relation. Verifier matches OSHA
   1910.305(g)(1)(iii). The policy-graph node turns red and pulses.
   Edges to "Spill prevention" and prior incident "INC-2024-018" light up.
   Citation card hydrates with the verbatim quote and source PDF
   thumbnail.
2. Severity classifier reads the rule's `severity: P1` tag from the Nia
  Vault page for that rule.
3. The action layer reads the Nia-extracted response plan:
  `safety_officer_voice + sms + slack + email + audit_log`, SLA 2 minutes.
4. InsForge edge function fans out the response. The demoer's phone rings
  on stage:
  > "RealityCI alert. Electrical hazard detected at Demo Station 1. Coffee
  > mug is positioned over energized equipment. Rule OSHA 1910.305. Press 1
  > to acknowledge, 2 to escalate."
5. Demoer presses `1`. The action timeline updates live:
  ```
   T+000ms  violation fired
   T+120ms  audit log written (InsForge Postgres)
   T+220ms  Slack #incidents sent
   T+310ms  SMS sent to Safety Officer
   T+480ms  voice call started
   T+12.4s  acknowledgement received from Safety Officer
  ```

Narration: "A dashboard is not enough. The first ten minutes of a plant
incident are where response breaks down. RealityCI assigns ownership,
calls the right role, and builds the audit trail automatically."

**Demo discipline:** we never call real 911. The P0 fire path calls a
mock `911_DISPATCH_DEMO_NUMBER` controlled by the team. The on-screen label
says "mock emergency dispatch" so the demo is ethically clean.

### Scene 2 — "Memory, alive and executable" (65–125s)

Demoer says: "The company's procedures don't stay static, and response
plans shouldn't either."

Demo ops drops a new incident JSON into the watched folder via hotkey:

```json
{
  "id": "INC-2026-094",
  "type": "near-miss",
  "summary": "Bag blocking fire extinguisher in shipping bay 3",
  "occurred_at": "2026-05-04T14:30:00Z",
  "rule_violated": "OSHA 1910.157(c)(1)",
  "recommended_response": {
    "severity": "P1",
    "roles": ["safety_officer", "floor_supervisor"],
    "channels": ["slack", "sms"],
    "sla_seconds": 120
  }
}
```

The dashboard spinner flashes "Nia ingesting..." For ~5–8 seconds, judges
see the policy graph **grow**: a new incident node attaches to the
"Emergency equipment access" rule. The response-plan edge also appears:
`OSHA-1910.157 -> response.fire_equipment_blocked -> safety_officer`.

Demoer places a paper bag in front of the printed "fire extinguisher"
sign. The verifier fires immediately. The system surfaces:

- The OSHA citation
- The just-ingested prior incident
- The response plan Nia extracted from the incident + SOP
- A Slack + SMS dispatch in the action timeline

We do **not** fire a second voice call here unless pacing allows; Scene 1
already proved voice. Scene 2 proves live memory + role-based response.

Narration: "Most emergency plans name people. People transfer, go on leave,
or hand off shifts. RealityCI assigns tasks to **roles**, not names, and
routes to whoever is active on the shift."

Short pre-recorded clip in the corner: `nia vault dream` links three
near-miss incidents to the same emergency-equipment rule and upgrades its
visual priority in the graph. The runtime learned overnight.

### Scene 3 — "The same runtime, but for agents" (125–170s)

The dashboard shifts. Top-left becomes an **agent trace pane** showing a
scripted agent calling shipping tools.

```
[00:00] agent.pick_up_box()              ✓
[00:03] agent.add_product()              ✓
[00:06] agent.apply_shipping_label()     ✗  out-of-order
                                             expected: add_packing_material
                                             first
```

The verifier fires the same red flash, same citation card, same edge to
the prior incident. Then the execution layer kicks in again, but the
recipient is different:

> "RealityCI agent alert. Agent `ship-bot-7` violated procedure
> `PACK-2.3`: label applied before packing material. Press 1 to halt the
> agent, 2 to allow with audit note."

The demoer presses `1`. The action timeline shows `agent_halt_requested`,
`owner_acknowledged`, and `audit_log_written`.

Narration: "Today, a person. Tomorrow, every AI agent that touches a real
process. Same policy graph, same verifier, same execution protocol."

### Outro (170–180s)

"Siemens estimates the world's largest manufacturers lose $1.4T a year to
unplanned downtime. The worst failures aren't only detection failures.
They're execution failures. RealityCI turns company knowledge into a
runtime that detects, verifies, dispatches, escalates, and records. We're
RealityCI."

**Timing notes:**

- Scene 1 voice call is the memorable moment. Do not cut it.
- Scene 2's `vault dream` clip is optional if pacing runs long.
- Scene 3 cannot be cut; it is the on-theme AI-agent moment.
- If total pitch length is under 3 minutes, keep Scene 1 + Scene 3 and
compress Scene 2 to a 15-second live-ingest flash.

---

## Architecture

```
                         EVENT SOURCES
   ┌─────────────────────┬──────────────────────┬─────────────────────┐
   │                     │                      │                     │
   ▼                     ▼                      ▼
Live camera         Watched folder          Agent trace player
(YOLO-World +       (incidents/*.json)      (scripted JSON
 Gemini 3 Flash)           │                 events)
   │                       ▼                      │
   │              Nia Local Sync                   │
   │              + Vault ingest                   │
   │                       │                      │
   └───────────────────────┼──────────────────────┘
                           ▼
              ┌──────────────────────────┐
              │ Verifier                 │
              │ event → policy graph     │
              │ lookup → citation        │
              │ severity → response plan │
              └─────────────┬────────────┘
                            │
        ┌───────────────────┼──────────────────────┐
        ▼                   ▼                      ▼
┌─────────────────┐ ┌──────────────────┐   ┌─────────────────────┐
│ Nia             │ │ Convex           │   │ InsForge             │
│ Knowledge Graph │ │ real-time state  │   │ action ledger        │
│ Vault + docs    │ │ Agent Component  │   │ Postgres + Edge Fn   │
│ Document Agent  │ │ websocket deltas │   │ dispatcher + audit   │
└────────┬────────┘ └─────────┬────────┘   └──────────┬──────────┘
         │                    │                       │
         │                    ▼                       ▼
         │          ┌──────────────────┐     ┌─────────────────────┐
         └─────────▶│ Next.js (Vercel) │◀────│ Twilio/Bland-style  │
                    │ React Flow graph │     │ channels: voice,    │
                    │ citation card    │     │ SMS, Slack, email   │
                    │ action timeline  │     └─────────────────────┘
                    │ agent trace pane │
                    └──────────────────┘
```

The verifier is **substrate-agnostic.** It does not know whether an event
came from a camera, a watched folder, or an agent trace. Same state
machine, same policy graph, same citation pipeline, same execution layer.

**Separation of duties:**

- **Nia** owns source truth: policies, citations, response-plan extraction,
Vault graph, context sharing, local sync.
- **Convex** owns live UI state: graph transitions, agent trace thread,
websocket deltas, hotkeys, dashboard reactivity.
- **InsForge** owns irreversible side effects: action ledger, edge-function
fan-out, channel dispatch, acknowledgements, escalation timers, audit log.
- **Twilio/Bland-style voice** owns the on-stage phone call. Demo path uses
Twilio + pre-recorded ElevenLabs TwiML for reliability; production path
can swap to Bland/Vapi/Retell for fully conversational calls.

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

### Why this is better than the v2 plan

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


| Node type               | Color          | Source                                      |
| ----------------------- | -------------- | ------------------------------------------- |
| Active rule             | gray           | Indexed source (OSHA, SOP, NFPA)            |
| Violated rule           | red pulse      | Verifier flagged it in this run             |
| Passing rule            | green          | Verifier confirmed compliance               |
| Prior incident          | amber dot      | Incident log, edges to cited rules          |
| Self-generated incident | amber dashed   | Loop A: written by RealityCI on ack         |
| Agent self-report       | teal           | Loop B: written by agent on failure ack     |
| Equipment               | blue           | Equipment manual node                       |


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

## Action Layer — From Detection To Response

This is the part that makes RealityCI operational instead of observational.
When the verifier fires a violation, it creates an `ActionPlan` from the
Nia policy graph and dispatches it through InsForge.

### Response protocol model

Each policy graph rule has a response plan page in the Nia Vault. Nia's
Document Agent extracts it into a typed object at compile time:

```typescript
type ActionPlan = {
  rule_id: string;
  severity: 'P0' | 'P1' | 'P2' | 'P3';
  summary: string;
  roles: ('safety_officer' | 'floor_supervisor' | 'facility_manager' | 'agent_owner' | 'mock_911_dispatch')[];
  channels: ('voice' | 'sms' | 'slack' | 'email' | 'in_app')[];
  sla_seconds: number;
  escalation: {
    if_unacknowledged_after_s: number;
    next_roles: string[];
  };
  audit_requirements: ('osha_1904' | 'iso_45001' | 'internal_postmortem')[];
  source_citation: { source_doc: string; page: number; paragraph?: number };
};
```

### Severity tiers


| Tier   | Trigger examples                                                 | SLA      | Channels                                                        |
| ------ | ---------------------------------------------------------------- | -------- | --------------------------------------------------------------- |
| **P0** | Active fire, smoke + accelerant, person down                     | <30s     | Mock-911 voice, safety officer voice, SMS, Slack, email, in-app |
| **P1** | Blocked extinguisher, liquid near energized equipment, fall risk | <2min    | Safety officer voice, SMS, Slack, email                         |
| **P2** | Procedure violation without immediate harm                       | <10min   | Slack, email digest, in-app                                     |
| **P3** | Advisory / weak signal                                           | log only | Audit log                                                       |


Severity is not hard-coded. It comes from the Nia-extracted policy page.
The demo's mug-on-power-strip event is P1. A staged flame/smoke event would
be P0, but we do not stage real fire at EF.

### Dispatch pipeline

```
Violation fired
      │
      ▼
Nia: resolve rule + ActionPlan
      │
      ▼
InsForge Edge Function: dispatch(action_plan, violation)
      │
      ├── write immutable action ledger row (Postgres)
      ├── send Slack message (#incidents)
      ├── send SMS (safety officer / supervisor)
      ├── start voice call (Twilio demo path)
      ├── send email (facility manager)
      └── start SLA timer (escalate if no ack)
      │
      ▼
Convex: stream action timeline to dashboard
```

### Why InsForge belongs here

Convex is excellent for live UI state. InsForge is the better place for
the execution ledger:

- Postgres gives an audit log that looks like a real compliance record.
- Edge Functions are the right primitive for fan-out dispatch.
- Realtime pub/sub can notify Convex or the frontend if needed.
- AI Model Gateway can summarize the incident into human-readable voice,
SMS, and email payloads.
- Agent-native metadata makes it easier for coding agents to inspect and
modify the response schema while building.

### Voice call demo path

**Demo implementation:** Twilio outbound call + pre-recorded ElevenLabs
voice via TwiML. No live LLM in the phone call. It is deterministic, fast,
and safe.

**Production path:** Bland / Vapi / Retell. Research summary:

- Bland is purpose-built for outbound high-volume calling and has a
graph-based flow system ("Pathways"). Good production fit.
- Retell has the lowest median orchestration-platform latency (~680ms).
- Vapi is flexible and orchestration-first.

We do not need those risks for the hackathon demo. Twilio + pre-recorded
TwiML is the right build-time tradeoff.

### Ethical and legal guardrail

RealityCI never calls real 911 in a demo. The P0 path calls a controlled
mock emergency number owned by the team. The UI labels it **MOCK EMERGENCY
DISPATCH**. Production deployments require customer-owned emergency-action
plans, verified contact trees, and explicit site approval before any real
external emergency call is enabled.

### What gets logged

Every action creates an append-only audit event:

```typescript
type ActionEvent = {
  id: string;
  violation_id: string;
  action_plan_id: string;
  channel: 'voice' | 'sms' | 'slack' | 'email' | 'in_app' | 'audit';
  recipient_role: string;
  recipient_contact_hash?: string;
  status: 'queued' | 'sent' | 'delivered' | 'acknowledged' | 'failed' | 'escalated';
  ts: number;
  provider_event_id?: string;
  payload_summary: string;
};
```

This is how the OSHA 29 CFR 1904 / ISO 45001 record exists as a byproduct
of the response, not a separate admin task two hours later.

---

## Self-Improving Loops

RealityCI v4 detects and dispatches. v5 adds the feedback layer: the system
learns from every acknowledged violation and agent failure, using Nia as a
read-write knowledge substrate instead of a read-only one.

**The demo itself is the proof.** By the end of Scene 3, the policy graph has
2–3 new nodes that didn't exist when Scene 1 started — created from violations
the judges just watched happen.

**Nia capability additions (v5 brings total to 14):**

| New capability              | API                                              | Where used      |
| --------------------------- | ------------------------------------------------ | --------------- |
| Vault write (agent-created) | `nia sources write <vault-id> /path.md --body …` | Loop A, Loop B  |
| Context Sharing — procedural memory | `POST /contexts` with `memory_type: procedural` | Loop B      |

> **Confirmed from docs.trynia.ai:** `nia sources write` is documented and works
> via `NIA_API_KEY` env var. JSONL is NOT a supported index format — loops write
> Vault markdown pages directly, not JSON files.

### Loop A — Violations Write Themselves (P0)

Every acknowledged violation (DTMF `1` received) calls `nia sources write` to
create a new Vault page. The graph grows from the demo's own operation.

```
Violation acknowledged
        │
        ▼
formatViolationAsVaultPage(violation, citation) → markdown with typed wikilinks:
  [[INC-{id}]] cites [[{rule_id}]]
        │
        ▼
nia sources write $NIA_VAULT_ID /incidents/INC-{id}.md --body "..."
  # /incidents/INC-{id}.md is a Vault namespace path, not a local path
  # Auth: NIA_API_KEY env var. Confirm exact --help flag on Day 4 spike.
        │
        ▼
nia vault sync  (= POST /v2/vaults/{id}/run, workflow: "sync")
  # Triggers Local Sync daemon → new node propagates to Convex → React Flow
  # FALLBACK: if propagation >5s, pre-stage node in Convex directly on ack;
  # Vault write still happens async. Counter increments immediately.
        │
        ▼
React Flow: new amber dashed node appears
Loop counter badge increments: "Self-Improvement Events: N (human)"
```

**Day 4 evening spike (go/no-go gate before any Loop A code):**
```bash
nia sources write --help   # confirm exact flag syntax first
nia sources write $NIA_VAULT_ID /test/spike-001.md \
  --body "# Test\n[[OSHA-1910.305]] cites [[test-001]]"
```
If the node appears in the Vault graph: Loop A is build-ready.
If it fails: use Day 5 to resolve before writing any Loop A code.

**Demo narration addition (Scene 1, after demoer presses 1):**
> "The system didn't just dispatch the response — watch the graph. A new
> incident node just appeared. RealityCI wrote it. Nia indexed it. Tonight,
> `nia vault dream` will connect it to every similar incident in the Vault."

### Loop B — Agent Self-Annotation (P1, add Day 6 if Loop A is solid)

After Scene 3's agent violation is acknowledged, the scripted agent posts its
own failure report to both a Vault page and Nia's procedural memory.

```
Scene 3 halt acknowledged (2s delay — allows halt animation to complete)
        │
        ▼
agent-trace-player.ts emits self_report event:
  { agent_id: "ship-bot-7", violated_rule: "PACK-2.3",
    missed_step: "add_packing_material",
    root_cause: "SOP §2 not in context window",
    suggested_fix: "Include PACK-SOP §2 in system prompt" }
        │
        ├── nia sources write $NIA_VAULT_ID /agent-reports/SHIP-BOT-7-001.md
        │     Vault page with wikilinks:
        │     [[SHIP-BOT-7-001]] cites [[PACK-2.3]]
        │     [[PACK-2.3]] applies_to [[ship-bot-7]]
        │
        └── POST /contexts { memory_type: "procedural",
              title: "apply_label before add_packing_material — PACK-2.3",
              summary: "ship-bot-7 failed PACK-2.3: SOP §2 not in context." }
              # FALLBACK: if Context Sharing auth unresolved by Day 6 noon,
              # ship Vault node only — story still works without the API call
        │
        ▼
React Flow: teal "Agent Self-Report" node appears
Counter: "Self-Improvement Events: 3 (2 human, 1 agent)"
```

**Demo narration addition (Scene 3, before outro):**
> "The agent didn't just get halted. It wrote its own incident report to Nia's
> memory. Next time any agent runs this procedure, it can query Nia: 'Have I
> seen this failure before?' and find this report. The system learns from agents
> — not just humans."

### Loop counter badge

Small badge in the top-right of the dashboard. Driven by a Convex query on the
new `selfImprovementEvents` table. Zero cost once Loop A exists.

```
┌──────────────────────────────┐
│  Self-Improvement Events: 3  │
│  2 human · 1 agent           │
└──────────────────────────────┘
```

### Three-speed self-improvement (narration frame)

1. **Real-time** — every acknowledged violation writes a new Vault page. Visible now.
2. **Nightly** — `nia vault dream` finds connections across all self-generated incidents.
3. **Perpetual** — agent failures stored as Nia procedural memory; future agents query it.

**Outro addition (weave in, no extra time):**
> "…detects, verifies, dispatches, escalates, records, and **learns**. We're RealityCI."

---

## Network Resilience

EF venue wifi cannot be a hard demo dependency. Pre-cache everything the
3-scene demo needs to the laptop:

- Compiled policy graph JSON (local file)
- All citations the demo will encounter (static JSON keyed by `rule_id`)
- 2 incident scenarios for Scene 2 (pre-staged JSON + Nia-cached
embeddings)
- 3 response plans (P0 mock emergency, P1 safety-officer call, P2 Slack-only)
- Pre-rendered Twilio TwiML voice payloads
- Slack/SMS/email payload templates
- Local Convex dev instance fallback
- Local InsForge action-ledger seed data export (JSON backup if hosted
InsForge is unreachable)
- YOLO-World weights (already local — Ultralytics ships them)
- Optional: a small local VLM (Llama 3.2 Vision via Ollama) as Gemini-3-
Flash fallback for the scene-reasoner
- Loop A fallback: 3 pre-staged self-generated incident nodes in Convex (fire
on ack if `nia sources write` is unreachable; Vault write retried later)
- Loop B fallback: agent self-report Vault page pre-written; skip
`POST /contexts` write if Context Sharing is unreachable

Day-of: turn wifi off, run the full demo. Anything that breaks gets fixed
before the pitch slot.

---

## Test Plan

**Frameworks:** Vitest (unit), Playwright (E2E), simple JSON-comparison eval.


| Module                     | Tests  | Type                         |
| -------------------------- | ------ | ---------------------------- |
| Verifier state machine         | 8      | Unit                         |
| Citation resolver              | 5      | Unit (mocked Nia)            |
| Policy graph compiler          | 4      | Unit + 1 integration         |
| Live ingest watcher            | 2      | Integration                  |
| Agent trace player             | 3      | Unit                         |
| YOLO-World wrapper             | 2      | Integration (golden frames)  |
| Gemini-3-Flash latency cap     | 1      | Integration (hard 800ms cap) |
| Severity classifier            | 3      | Unit                         |
| Action dispatcher              | 5      | Unit + mocked providers      |
| Acknowledgement tracker        | 3      | Unit                         |
| Loop A — Vault write           | 2      | Unit (formatVaultPage + nia sources write) |
| Loop A — graph node appearance | 1      | Integration (ack → node within 5s)  |
| Loop B — agent self-report     | 2      | Unit (self_report event + Vault page format) |
| Loop counter badge             | 1      | Unit (Convex query drives count)    |
| Critical paths (3 scenes)      | 3      | E2E (Playwright)             |
| Policy graph render            | 2      | E2E                          |
| Network-off rehearsal          | 1      | Manual checklist             |
| **Total**                      | **48** | mixed                        |


Critical paths:

1. Scene 1 — mug on power strip → red flash + cite + edge animation →
  voice call + acknowledgement
2. Scene 2 — drop incident JSON → graph node grows → bag in front of fire
  extinguisher → cite + matching prior incident + role-based dispatch
3. Scene 3 — agent trace player → out-of-order tool call → red flash +
  cite + agent-owner call + halt acknowledgement

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
- **P1** Document Agent extraction for response plans (`ActionPlan` schema)
- **P1** Vault init: build policy wiki from indexed sources
- **P1** Vault pages for response plans (`response/electrical_hazard.md`,
`response/fire_equipment_blocked.md`, `response/agent_procedure_violation.md`)
- **P1** Pre-record `nia vault dream` clip for Scene 2 finale
- **P1** Local Sync daemon watching the incidents folder
- **P1** Notion connector for mock internal safety wiki
- **P2** Slack connector (BYOT) for `#safety-incidents`
- **P2** `nia_explore` source inspector pane in dashboard

### Convex

- **P0** Schema: `runs`, `policy_graph_state`, `events`, `citations`,
`incidents`, `violations`, `action_timeline`
- **P0** Mutations for: start_run, end_run, emit_event, fire_violation,
ingest_incident, record_action_event, acknowledge_action
- **P0** Query for live policy graph state (drives React Flow)
- **P0** Query for live action timeline state (drives bottom timeline pane)
- **P1** Convex Agent Component for the agent-trace thread
- **P1** Streaming deltas via websocket for the agent trace pane

### InsForge action layer

- **P0** InsForge project setup (Postgres + Edge Functions)
- **P0** Tables: `action_plans`, `action_events`, `contacts`, `role_roster`,
`acknowledgements`
- **P0** Edge function: `dispatchActionPlan(violation_id, action_plan_id)`
- **P0** Mock providers: Slack, SMS, email, voice call (return deterministic
provider IDs; no external dependency during offline rehearsal)
- **P0** Twilio live provider for Scene 1 phone call (controlled number only)
- **P0** Acknowledgement webhook: keypress/DTMF `1` → `acknowledged`
- **P0** Escalation timer: if no ack within SLA, create `escalated` action
event
- **P1** Provider switch: demo mode (mock + Twilio) vs. production mode
(Bland/Vapi/Retell pluggable)
- **P1** Audit export route (JSON timeline for OSHA 1904 / ISO 45001 style
record)

### Frontend (Next.js + Vercel)

- **P0** Three-pane shell: camera feed (left), policy graph (center),
citation card (right)
- **P0** React Flow + dagre layout for the policy graph
- **P0** Node + edge styles (gray / green / red pulse / amber dot / blue)
- **P0** Citation card component (rule cite, source thumbnail, prior
incident card)
- **P0** Action timeline pane (audit log row stream, channel icons,
acknowledgement status, escalation timer)
- **P0** Agent trace pane (left side, swaps from camera feed in
Scene 3)
- **P0** Hotkey macro: `START`, `INGEST_INCIDENT`, `SWITCH_TO_AGENT`,
`ACK_CALL`, `MOCK_ESCALATE`
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
- **P0** Team-controlled phone number for Scene 1 voice call
- **P0** Pre-recorded ElevenLabs voice clips for P1 and agent-owner calls
- **P0** Mock emergency-dispatch number for P0 path (never real 911)
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

### Self-improving loops (v5 additions — insert before Tests)

**Pre-loop gate (Day 4 evening — required before any Loop A code):**

- **P0** Create or locate Nia Vault; store `vault-id` in `.env` as `NIA_VAULT_ID`
- **P0** Run spike: `nia sources write --help` then `nia sources write $NIA_VAULT_ID /test/spike-001.md --body "# Test\n[[OSHA-1910.305]] cites [[test-001]]"` — confirm node appears in Vault graph. This is a go/no-go gate.
- **P0** Measure `nia vault sync` propagation latency. If >5s, implement Convex-direct fallback.
- **P0** Confirm Context Sharing auth: test `POST /contexts` with `memory_type: procedural` — same `NIA_API_KEY` or separate key?

**Loop A (P0 — Day 5):**

- **P0** `selfImprovementEvents` table added to Convex schema
- **P0** `createSelfImprovementEvent(violation_id, type, vault_page_path)` Convex mutation
- **P0** `getSelfImprovementCount()` Convex query (drives badge)
- **P0** `formatViolationAsVaultPage(violation, citation)` — TypeScript function producing markdown with typed wikilinks
- **P0** Wire acknowledgement: on DTMF `1` received → `createSelfImprovementEvent` → `nia sources write` → `nia vault sync`
- **P0** React Flow: amber dashed node style for self-generated incidents
- **P0** Loop counter badge component (top-right, live Convex query)
- **P0** Unit test: `formatViolationAsVaultPage` produces valid wikilink syntax
- **P0** Integration test: ack → new amber dashed node in graph within 5s
- **P0** Offline fallback: pre-stage 3 incident nodes in Convex; fire on ack if `nia sources write` unreachable

**Loop B (P1 — Day 6 if Loop A is solid AND Context Sharing auth resolved):**

- **P1** Add `self_report` event to `agent-trace-player.ts` (fires 2s after halt ack)
- **P1** `formatAgentReportAsVaultPage(agent_id, violation, root_cause)` function
- **P1** `nia sources write` call for agent self-report Vault page (`/agent-reports/`)
- **P1** `POST /contexts` write with `memory_type: procedural` (fallback: skip if auth unresolved by Day 6 noon)
- **P1** React Flow: teal node style for agent self-reports
- **P1** Demo script: Scene 3 narration addition for agent self-annotation (~15s)
- **P1** Unit test: `self_report` event fires and `formatAgentReportAsVaultPage` produces valid output
- **P1** Offline fallback: agent self-report Vault page pre-written; `POST /contexts` skipped if unreachable

### Tests

- **P0** 8 verifier unit tests
- **P0** 5 citation resolver unit tests
- **P0** 4 policy graph compiler unit tests
- **P0** 3 severity-classifier unit tests
- **P0** 5 action-dispatcher tests with mocked providers
- **P0** 3 acknowledgement/escalation tests
- **P0** 3 critical-path E2E tests in Playwright
- **P0** 2 Loop A unit tests (`formatViolationAsVaultPage`, loop counter query)
- **P0** 1 Loop A integration test (ack → Vault node within 5s)
- **P1** 2 ingest watcher integration tests
- **P1** 3 agent-trace player unit tests
- **P1** 2 Loop B unit tests (`self_report` event, `formatAgentReportAsVaultPage`)
- **P1** 1 Loop B integration test (agent ack → teal node within 5s)
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
4. Scene 1 action layer: the phone rings within 5 seconds of violation,
  the action timeline shows Slack/SMS/email/audit rows, and
  acknowledgement updates live after the demoer presses `1`.
5. React Flow graph animates smoothly (no jank, no flicker).
6. Scene 2 ingest scene: incident JSON → graph grows → cite within 8s,
  reliably.
7. Scene 2 response layer: new incident adds a response-plan edge and
  dispatches role-based Slack/SMS without a second voice call unless pacing
  allows.
8. Scene 3 agent trace: scripted out-of-order call → same red flash + same
  citation surface + agent-owner call/halt acknowledgement.
9. Convex propagates all UI state without page reload throughout.
10. InsForge action ledger contains every dispatch, acknowledgement, and
  escalation event with timestamps.
11. `NIA_IMPROVEMENTS.md` delivered as a submission deliverable with 3-5
  concrete proposals.
12. Full demo runs offline except for the deliberately tested live phone
  call path (which has a local mock fallback).
13. Judges leave saying "wait, that was Nia under the hood?" — meaning the
  Nia integration was visible and load-bearing, not invisible plumbing.
14. After Scene 1 acknowledgement: new amber dashed incident node appears in
  React Flow graph within 5 seconds of DTMF `1`.
15. Loop counter increments correctly: 1 after Scene 1, 2 after Scene 2, 3
  after Scene 3 agent ack.
16. After Scene 3 agent ack: teal "Agent Self-Report" node appears in graph.
  *(P1 — only if Loop B ships.)*
17. After Scene 3 agent ack: Nia Context Sharing has a new procedural memory
  entry for PACK-2.3 failure within 5 seconds. *(P1 — only if Loop B ships.)*
18. All self-improvement loop events work offline (pre-staged fallback nodes fire).

### Non-goals

- General industrial CV (we use open-vocabulary text prompts; we are not
building a generic safety detector)
- Multi-camera support
- Authentication / multi-tenant
- Real LLM agent in Scene 3 (scripted trace ships; live agent is v2)
- Real 911 / external emergency dispatch during demo
- Hyperspell, World Labs, Reacher
- Aside is stretch only (browser-based OSHA form fill after core demo works)
- Tensorlake (cut)

---

## Sponsor Stack (brief — full mapping in DECISIONS.md)

- **Nia / Nozomio (mandatory):** indexing, search (4 modes), Document Agent,
Data Extraction (table + detect + engineering), Vault, Context Sharing,
Local Sync, Connectors (Notion, Slack), Scoped MCP, `nia vault dream`.
~12 capability surfaces in load-bearing roles.
- **Convex:** real-time policy graph state, Agent Component for the agent-
trace thread, websocket streaming deltas.
- **InsForge:** Postgres action ledger, Edge Function dispatcher, provider
fan-out, acknowledgements, escalation timers, audit export.
- **Vercel:** Next.js deploy, edge.
- **Aside:** stretch — browser automation to fill a mock OSHA 300 /
ServiceNow/VelocityEHS incident form after the core demo works.
- **Tensorlake:** cut.
- **Hyperspell, World Labs, Reacher:** cut.

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