# DECISIONS.md — Why RealityCI Looks Like This

This is the doc that explains every meaningful choice in the build. It
exists because at a hackathon, judges (and post-hackathon readers) often
ask "why did you do X?" and the answer should be one paragraph deep, not
"because it was the first thing we tried."

Three layers in this doc:

1. **The North Star** — what we're optimizing for at this hackathon.
2. **Per-decision rationale** — every architectural call, what we considered,
   why we chose it, and what would change our mind.
3. **Sponsor tech map** — every sponsor we use, exactly how, and what we'd
   show a judge from that company in 60 seconds.

We close with a section on **what we learned from Arlan Rakhmetzhanov and
Nozomio's prior hackathon (Aug 2025 YC Agents Hackathon)** — and how his
public theses shaped the build.

---

## 1. The North Star

The Nozomio Hackathon theme is *Build the Future of AI Agents.* The host
sponsor is Nia. The audience is ~390 builders, engineers, and judges who
will see dozens of "AI camera" demos and dozens of "AI agent" demos.

We're not trying to win one of those. We're trying to ship the **runtime
that verifies any procedure** — physical or agentic — against the
company's own rules, with citations. The same engine for both. That's what
makes it new.

Four things every choice in this build is optimizing for:

1. **Visible Nia depth.** A judge from Nozomio should be able to point at
   the dashboard and identify five distinct Nia capabilities in use within
   60 seconds. If a feature can be done with Nia, it is.
2. **Demo certainty under EF venue conditions.** No untrained models, no
   un-rehearsed scenes, no soft "should work" assumptions. Pre-cache,
   pre-stage, pre-rehearse, network-off rehearsal day before.
3. **On-theme synthesis.** Physical work AND AI agents through the same
   primitive. Most teams pick one. We get the synthesis dividend by
   rendering both into one verifier.
4. **Execution, not observation.** Detection-only products still leave
   humans to coordinate the response. RealityCI assigns ownership, calls
   the right role, logs the audit trail, and escalates when nobody
   acknowledges.

If a decision below makes one of those three weaker, it's a bad decision
and we revisit it.

---

## 2. Per-Decision Rationale

### Decision 1 — "CI/CD for Physical Procedures," not "AI Camera"

**What:** Frame the product as a runtime that compiles company rules into
checks and runs reality through them. Not as a vision system that detects
hazards.

**Why:**
- An "AI camera" demo is a sensor. Nia is invisible behind a sensor.
- A "CI/CD for procedures" demo is a runtime. Nia is the runtime's brain.
- Judges retain mental models, not features. *"GitHub Actions for
  factories"* sticks. *"AI hazard detection"* doesn't.
- The framing extends naturally to AI agents (Scene 3). A "camera" doesn't.

**What would change our mind:**
- If at dress rehearsal the camera scene is so visually compelling that
  judges can't process the framing, we lean harder into the camera
  language and demote the runtime framing to subtitle. (Unlikely. The
  policy graph is the visual primary, not the camera feed.)

---

### Decision 2 — Hazard Events, Not Assembly Steps

**What:** The demo's events are safety/regulatory hazards (mug-on-power-
strip, blocked fire extinguisher, ladder posture), not packing-line steps
(red block, blue cap, screw, label).

**Why:**
- Magnitude. A mug-on-a-power-strip has $200K downstream impact and
  potentially a fatality. A blue cap on a screw doesn't. Judges feel
  magnitude.
- The cited rules (OSHA 1910, NFPA 1) are recognizable. Judges have read
  about workplace fatality lawsuits in the news. They have not read about
  packing-line defects.
- The same camera-rig setup we'd use for the v2 packing demo runs the v3
  hazard demo. No additional rig cost.
- Variety. The packing demo had one violation type ("skipped step"). The
  hazard demo has many (proximity, occlusion, posture, presence-of-flame),
  which lets the policy graph show interesting structure rather than a
  linear chain.

**What we considered and rejected:**
- *Surgical instrument detection (à la Google's SurgAgent demo).*
  Compelling magnitude but requires medical-domain prompting and a
  surgical-tool kit we don't have. Reject.
- *Packing-line + safety hybrid.* Splits attention. Reject.
- *Pure agent-trace demo, no camera.* Loses the "physical world" half of
  the synthesis. Reject.

---

### Decision 3 — YOLO-World + Gemini 3 Flash, Not Custom-Trained YOLO

**What:** Zero training. Open-vocabulary detection via YOLO-World; scene
reasoning via Gemini 3 Flash with Agentic Vision.

**Why:**
- **No labeling.** Saves ~8 hours of Roboflow work.
- **No training.** Saves ~6 hours of finetune + validation.
- **No venue-lighting drift.** YOLO-World was pretrained on huge corpora.
  v2 plan's #1 demo-day risk was *"YOLO mis-detection at venue lighting is
  a silent failure."* That risk is now zero.
- **Open vocabulary = expandable demo.** Adding a new hazard class is one
  line in the prompt list, not a new labeling marathon.
- **Gemini 3 Flash > Gemini 2.0 Flash.** Released January 2026. *Agentic
  Vision* gives it active investigation (zoom, inspect, manipulate) — a
  consistent 5-10% quality boost on vision benchmarks.

**Why this is technically right:**
- YOLO-World hits 18.3ms inference, 22.4M params, runs on a laptop CPU.
- Gemini 3 Flash on hazard relations ("is X near Y?") with bounded
  prompts is sub-second; we cap at 800ms.
- Failure mode of the VLM (slow response) gracefully degrades to YOLO-
  World-only proximity heuristic. Verifier never blocks.

**What would change our mind:**
- If YOLO-World's prompt-list accuracy on our specific hazard scenes is
  <80% in dress rehearsal, we add a final 30-minute calibration pass with
  prompt-engineering tricks (the research literature shows 8 mAP swing
  from "fork lift" → "forklift" — we'll tune carefully).
- If Gemini 3 Flash latency exceeds 1.5s consistently, we drop the VLM
  layer for the demo and rely on YOLO-World + hand-coded proximity rules.

---

### Decision 4 — Knowledge Graph (Vault), Not RAG

**What:** Compile indexed sources into a Nia Vault. Render the Vault as a
force-directed React Flow graph. The graph is the visual primary of the
dashboard.

**Why:**
- Arlan publicly opposes RAG-chunked context. His Threads post on Vault:
  *"It updates while you sleep. Built for both agents and humans."* That
  is the platonic Nia experience. We mirror it.
- A graph reveals structure. A list of citations doesn't. Judges retain
  structure.
- Self-improvement story. `nia vault dream` discovers connections weekly.
  We get a free "the system gets smarter overnight" moment in Scene 2.
- Wikilinks with typed relationships (`supersedes`, `cites`, `references`,
  `applies_to`) give us the edges we want to animate during a violation.

**What we considered and rejected:**
- *Pure list-based citation card, no graph.* Smaller scope, less wow.
  Reject.
- *3D graph (e.g. force-graph-3d or three.js).* Cool but slower to build,
  janky on a hackathon laptop. Reject; React Flow + dagre is the right
  level of polish.
- *Graph compiled by us, not by Vault.* Possible but reinvents what Nia
  already does. Reject; we use Vault and inherit `nia vault dream` for free.

---

### Decision 5 — React Flow + Dagre, Not D3 or Custom Canvas

**What:** Use React Flow for the graph viz, with the dagre layout
algorithm.

**Why:**
- React Flow is the Layer 1 (well-trodden) choice. 50K+ stars, used in
  production at scale, MIT licensed.
- Dagre handles directed graphs cleanly. Force-directed via `react-flow-
  renderer`'s built-in support.
- Custom node and edge components let us animate state transitions
  (gray → green pulse → red pulse).
- Convex `useQuery` reactive subscription drops directly into React Flow's
  `useNodesState` / `useEdgesState`. No glue code.

**What would change our mind:**
- If React Flow + dagre janks on >50 nodes, we cap visible nodes to top-N-
  most-relevant and lazy-load the rest. (Easily handled, unlikely to hit.)

---

### Decision 6 — Three Scenes, Not Four

**What:** Demo is exactly three scenes (Reality audited, Memory alive,
Same runtime for agents). 180 seconds total. We removed the production-
footage scene from v2.

**Why:**
- Four scenes in 3 minutes is 45s per scene. Tight.
- Three scenes lets each one breathe (60s + 60s + 50s + 10s outro).
- Scene 3 (agent trace) is the on-theme moment. Cutting Scene 3 was never
  on the table; cutting the production-footage scene to make Scene 3
  breathe was correct.
- Less surface area to break = less demo-day risk.

**What we considered and rejected:**
- *Live agent (real Claude tool-use) in Scene 3.* Network-dependent,
  rate-limit-dependent, slow. Demo killer. Architecture is ready for
  one-file swap post-hackathon; ship the scripted trace.
- *Production-footage scene as backup if hardware fails.* Adding a
  conditional scene to a rehearsed pitch creates timing variance.
  Reject; backup is the recorded video on a hidden hotkey.

---

### Decision 7 — Pre-Cache Everything, Demo Offline

**What:** The full 3-scene demo runs end-to-end with the laptop in
airplane mode. Network failure cannot break the pitch.

**Why:**
- EF wifi at 390-person hackathon is unreliable.
- Day-of, you can't debug network issues on a 5-minute warning.
- Pre-cache costs ~3 hours on the day before; it's the cheapest insurance
  in the build.

**Specifics:**
- Compiled policy graph → local JSON
- All citations → static JSON keyed by `rule_id`
- 2 incident JSON files (Scene 2) pre-staged with embeddings already
  cached in Nia
- Local Convex dev instance running on laptop as fallback for cloud
  Convex
- YOLO-World weights → local (Ultralytics ships them)
- Gemini 3 Flash fallback → optional Llama 3.2 Vision via Ollama for
  scene-relation reasoning

**Acceptance test:** Day before hackathon, turn wifi off, run the demo
end-to-end. Anything that breaks gets fixed before sleep.

---

### Decision 8 — Convex Agent Component for the Agent Trace Thread

**What:** Use Convex's Agent Component (introduced 2025) for the Scene 3
agent-trace thread, not raw Convex tables.

**Why:**
- Threads + messages + websocket streaming deltas are exactly what we
  need for the agent-trace pane.
- `saveStreamDeltas` writes chunks to the database as generated, with
  configurable throttling. Free real-time UI.
- Cross-thread message search lets the agent trace lookup "have I seen
  `apply_label` before `add_packing_material` historically?"
- Same Convex deployment as the rest of the app — no extra infra.

**What we considered and rejected:**
- *Raw Convex tables + manual query subscriptions.* More work, fewer
  features. Reject.
- *Separate microservice for the agent trace.* Splits state. Reject.

---

### Decision 9 — Action Layer, Not Dashboard-Only

**What:** Every violation triggers an execution protocol: role-based
dispatch, voice/SMS/Slack/email, acknowledgement tracking, escalation, and
an audit log. Detection is not done until someone owns the response.

**Why:**
- Manufacturing incident response fails in the first ten minutes. The
  research pattern is consistent: outdated contact lists, shift handover
  gaps, unclear task ownership, fragmented communication, and paper plans.
- A real case from manufacturing incident-response literature: SCADA alert
  at 6:47 AM; nobody moved for nine minutes; three people assumed someone
  else owned it; the shift lead had handed over 11 minutes earlier; the
  emergency plan named a supervisor who had transferred months earlier.
- OSHA 29 CFR 1910.38 requires emergency action plans with reporting,
  evacuation, critical operations, employee accounting, rescue/medical
  duties, and contact information. OSHA 29 CFR 1904 / ISO 45001 require
  records. An action timeline creates that record as a byproduct.
- A phone ringing on stage is a better demo than another red dashboard
  tile. Everyone in the room understands "the system called the safety
  officer."

**What we considered and rejected:**
- *Dashboard-only.* Easier but incomplete. Reject.
- *Send Slack only.* Too quiet for a live demo, too weak for a P1/P0 safety
  scenario. Reject as the only channel; keep it as one channel.
- *Real 911 / external emergency dispatch.* Illegal and reckless in a
  demo. Reject categorically. Use a mock dispatch number only.

---

### Decision 10 — InsForge Owns the Action Ledger

**What:** Use InsForge for the execution side: Postgres action ledger,
edge-function dispatch, role roster, acknowledgements, escalation timers,
and audit export. Convex remains the live UI/state layer.

**Why:**
- Convex is great for live UI reactivity. InsForge is better for durable
  backend records and fan-out side effects.
- InsForge's pitch is agent-native backend: Postgres, auth, storage, edge
  functions, realtime, AI model gateway, vector DB. The action layer uses
  exactly those primitives.
- Postgres rows feel like a real compliance/audit record; this matters
  for OSHA 1904 / ISO 45001 style reporting.
- Edge Functions are the right place to dispatch to Twilio/Slack/SMS/email
  and update provider status.
- This adds a fifth sponsor in a load-bearing way without polluting the
  Nia story.

**What would change our mind:**
- If InsForge setup burns more than 2 hours, we fall back to Convex tables
  for the hackathon and document InsForge as the production execution
  layer. But the preferred path is InsForge.

---

### Decision 11 — Twilio + Pre-Recorded Voice for Demo, Bland/Vapi/Retell for Production

**What:** The stage demo uses Twilio outbound call + pre-recorded
ElevenLabs audio/TwiML. Production architecture can swap to Bland, Vapi,
or Retell for conversational voice agents.

**Why:**
- A live LLM voice agent failing or wandering during the pitch is not a
  risk worth taking.
- Twilio + static TwiML is deterministic. It rings the phone reliably and
  accepts DTMF `1`/`2` reliably.
- Bland is strong for outbound production calling (Pathways, high-volume
  dialing). Retell has lower median latency. Vapi is flexible. All are
  reasonable production options. None needs to be live in the hackathon
  demo to prove the concept.

**What we considered and rejected:**
- *Bland live in demo.* Strong production fit, but dependency risk and
  account setup risk. Reject for hackathon path.
- *Vapi live in demo.* Flexible but more integration surface. Reject.
- *Retell live in demo.* Lower median latency but still live voice-agent
  risk. Reject.

---

### Decision 12 — Document Agent for Post-Violation Expansion

**What:** When a violation fires, RealityCI optionally launches a Nia
Document Agent against the violated rule's source PDF, with a JSON schema
extracting `{rule_id, exact_quote, page, paragraph, cross_references,
recommended_remediation}`.

**Why:**
- This is autonomous tool use *inside a single document.* Not a static
  read of a single chunk. The agent plans, navigates the PDF tree, follows
  cross-references.
- Arlan publicly emphasizes Document Agent. Using it shows we read the
  full Nia surface, not just the search box.
- JSON schema → typed object → renders cleanly in the citation card.
- Claude Haiku (sub-second) is the right model here. We don't need Opus
  reasoning for "extract this rule's exact text + cross-refs."
- Streaming via SSE → Convex hydrates the citation card progressively.
  Visible "loading more detail" UX without polling.

**What we considered and rejected:**
- *Static `nia_read` only.* Faster but loses the "agent-inside-a-doc"
  story. We do BOTH: `nia_read` for the immediate visible quote (fast),
  Document Agent for the cross-references and remediation (richer, async).

---

### Decision 13 — Hazard Setup with Everyday Items

**What:** Stage the demo with everyday items (coffee mug, paper bag,
extension cord, candle, a stick simulating a ladder, printed signs for
"power strip" and "fire extinguisher" where actually-electrical-and-
flammable rigs would be unsafe to bring to EF office).

**Why:**
- No mail-order specialty hardware = no "did the part arrive?" risk.
- Recognizable items = judges instantly understand the hazard.
- Real-life everyday hazards (mug on power strip is a thing people
  actually do at desks) = real-life empathy from the audience.

**Why printed cards for some items:**
- An actual energized power strip with a mug on it is a real fire risk.
  We use a printed card.
- An actual fire extinguisher would be borrowed; the printed card sign is
  visually identical from a camera POV and can't be tripped over by a
  judge.

**Trade-off acknowledged:** Some judges will notice the printed cards.
The narration owns this: "We use printed cards because we're not bringing
real fire hazards to the EF office. The same model runs on real
equipment in production."

---

### Decision 14 — Manual Hotkey Run Lifecycle, Not Auto-Detect

**What:** Demo operator presses a hotkey to start each scene. No auto-
detection of "the demo is starting now."

**Why:**
- A scripted hackathon pitch is, well, scripted. Auto-detect adds risk
  for a feature judges won't notice was missing.
- Hotkey gives the operator precise control over pacing.
- Auto-detect is on the v2 list and the architecture supports it. Not a
  permanent decision.

---

### Decision 15 — Tasks, Not Days

**What:** Track work as a flat priority-tagged task list, not a day-by-day
schedule.

**Why:**
- Hackathon teams work in parallel. A day-by-day schedule pretends
  everyone hits the same milestone at the same time. Reality: the CV
  person and the frontend person are working on different things at hour
  20 vs hour 30.
- Priority tags (P0/P1/P2) let any team member pick up the next-most-
  important unfinished task whenever they have a free hour.
- Dependency tracking is implicit in the order — but explicit in the doc
  when there's a real ordering constraint (e.g., "policy graph compiler
  before React Flow rendering").

---

### Decision 16 — Self-Improving Loops via Nia Vault Write API

**What:** On every acknowledged violation, call `nia sources write` to create a
new Vault markdown page with typed wikilinks. On agent failure ack, write a
second page under `/agent-reports/` and a Nia Context Sharing entry
(`memory_type: procedural`). This turns the policy graph into a living
record that grows during the demo's own operation.

**Why:**
- Detection + dispatch is observational. Loops make it compound.
- Judges retain what they see move. A pre-recorded overnight clip
  (`nia vault dream`) is not enough — the graph must visibly grow in real time.
- Every acknowledged violation currently throws away signal (who, how fast,
  what was violated). Writing it to the Vault costs ~20ms and creates a
  first-class knowledge node.
- `nia sources write` is documented API (confirmed from docs.trynia.ai). Auth
  is `NIA_API_KEY`. Path is a Vault namespace path, not a local path.
- This extends Nia from a read layer to a read+write substrate, directly
  honoring Arlan's "filesystem as infrastructure" thesis.
- For agents specifically: the agent writing its own failure report to Nia's
  procedural memory is the most on-theme "Future of AI Agents" feature in
  the entire demo. Future agents can query it before acting.

**Validated from docs (2026-05-06):**
- `nia sources write <vault-id> /path.md --body "..."` — confirmed.
- Context Sharing with `memory_type: procedural` — confirmed.
- **JSONL is NOT supported** by universal `index` (CSV/TSV/XLSX only). All
  loop outputs must be Vault markdown pages, not JSON files.

**Critical pre-gate:** Run `nia sources write --help` spike on Day 4 evening.
Do not write any Loop A code until the spike confirms the call works and a
node appears in the Vault graph. This is the go/no-go for all loop work.

**What would change our mind:**
- If `nia sources write` spike fails and the correct CLI form can't be found
  within 2 hours: pre-stage the new incident nodes directly in Convex and
  write to Vault async. The demo story still works; Vault writes become an
  audit trail rather than the primary trigger.
- If Loop B Context Sharing auth is unresolved by Day 6 noon: ship Loop B
  with the Vault page only. The procedural memory write is additive.

---

## 3. Sponsor Tech Map

For each sponsor: what they do, exactly how we use them, and the 60-
second judge-pitch from that sponsor's POV.

### Nia / Nozomio (mandatory, host sponsor)

**What Nia is, in their words:** "An API layer that gives agents up-to-
date, continuously monitored context across repositories, documentation,
PDFs, datasets, Slack, Google Drive, and local knowledge sources."

**What we use (12 surfaces):**

| Capability             | How we use it                                                                                |
|------------------------|----------------------------------------------------------------------------------------------|
| Universal `index`      | Ingest OSHA, NFPA, SOPs, manuals, response plans, training transcripts, incident logs, mock Slack channel |
| Search modes (4)       | `query` (UI tooltip), `universal` (verifier rule lookup), `deep` (post-violation expansion), `web` (live OSHA cross-reference) |
| `nia_grep`             | Exact rule-number regex lookups                                                              |
| `nia_read`             | Fast snippet + page fetch for citation card                                                  |
| `nia_explore`          | Source inspector pane (debug-only)                                                           |
| Document Agent         | Post-violation typed extraction + response-plan extraction with JSON schemas + Claude Haiku   |
| Data Extraction (`detect`) | Bounding-box highlighting of violated diagrams in citation card                          |
| Engineering Extraction | P&ID and equipment-manual diagram parsing at compile time                                    |
| Vault                  | The policy graph itself: compiled-truth pages with timeline, wikilinks, force-graph view     |
| Vault write API        | `nia sources write` creates new incident + agent-report pages on acknowledgement (Loop A/B)  |
| `nia vault dream`      | Pre-recorded clip in Scene 2 finale: graph self-improves overnight                           |
| Context Sharing        | Procedural memory for agent failures: future agents query before acting (Loop B)             |
| Local Sync             | Daemon watches incidents folder; real-time file events drive Scene 2                         |
| Connectors             | Notion (mock safety wiki), Slack (BYOT, `#safety-incidents`)                                 |

**60-second pitch from Nia's POV:** "The policy graph in the center pane
is a Nia Vault rendered with React Flow. Every node is a wiki page Nia
maintains. The edges are typed wikilinks Nia generated. When the camera
catches a violation, we use Nia's `universal` search mode to find the
matching rule, `nia_read` for the immediate quote, then a Document Agent
with a JSON schema for cross-references, remediation, and the response
plan. The incident ingest scene is Local Sync watching a folder. The
'graph improves overnight' moment is `nia vault dream`. But here's what's
new: every acknowledged violation calls `nia sources write` to create a
new Vault page — Nia is a write layer, not just a read layer. And when the
agent fails in Scene 3, it writes its own failure report to Nia's
procedural memory via Context Sharing. Future agents can query it before
acting. We use 14 distinct Nia capabilities. None of them is 'just RAG.'"

### Convex (strong-fit, real-time backend)

**What Convex is:** Real-time database with reactive queries, durable
workflows, and a 2025-shipped Agent Component for AI workflows.

**What we use:**

| Surface                      | How                                                              |
|------------------------------|------------------------------------------------------------------|
| Reactive queries             | Drives policy graph state in React Flow. No polling.            |
| Mutations                    | `start_run`, `emit_event`, `fire_violation`, `ingest_incident`, `record_action_event` |
| Agent Component              | Threads + messages for Scene 3 agent trace                       |
| Streaming deltas (websocket) | Live agent trace pane updates                                    |
| Cross-thread message search  | "Have I seen this tool-call sequence before?" lookup             |

**60-second pitch from Convex's POV:** "Every visible state change in the
dashboard — graph nodes turning green or red, citation card hydrating,
agent trace lines streaming, action timeline rows appearing — is a Convex reactive query. We don't poll.
Convex pushes deltas over a websocket. The agent-trace thread in Scene 3
uses the Agent Component's `saveStreamDeltas` so the pane updates as the
script runs."

### InsForge (strong-fit, action backend)

**What InsForge is:** Agent-native backend with managed Postgres,
auto-generated APIs, auth, storage, Edge Functions, realtime, AI model
gateway, and vector DB.

**What we use:**

| Surface         | How |
|-----------------|-----|
| Postgres        | Immutable `action_events`, role roster, acknowledgements, audit log |
| Edge Functions  | `dispatchActionPlan` fans out Slack/SMS/email/voice and starts SLA timers |
| Realtime        | Optional push from action ledger to dashboard if Convex bridge is unavailable |
| AI Model Gateway| Summarize violation into voice/SMS/email payloads in production mode |
| Auto REST       | Fast inspection/debugging by the team and agents |

**60-second pitch from InsForge's POV:** "Nia decides what the company
policy says. Convex shows it live. InsForge executes the response. Every
voice call, SMS, Slack message, acknowledgement, and escalation becomes an
append-only Postgres action event. That is the compliance record."

### Vercel (strong-fit, frontend deploy)

**What we use:**
- Next.js 14 with App Router
- Vercel auto-deploy on every push to `main`
- Vercel Edge for fast global delivery (the demo runs locally but the
  Vercel-hosted version is the submission link)

**60-second pitch from Vercel's POV:** "Every commit on `main` is live at
the Vercel deploy URL within 60 seconds. The dashboard is a Next.js App
Router app with React Server Components for the static shell and Convex
React for live state."

### Aside (stretch, browser-action layer)

**What Aside is:** A browser that acts as an OS for AI agents.

**Stretch use:** After a violation closes, the RealityCI action agent opens
a mock ServiceNow / OSHA 300 / VelocityEHS form in a browser and fills it
from the InsForge action ledger. This is visually compelling, but not P0.
Core demo already proves execution through voice/SMS/Slack/email.

### Cut sponsors and why

- **Tensorlake** — Cut entirely in v3 (was Stretch in v2). The local
  policy-graph compiler runs in <30s on a laptop; Tensorlake's sandboxed
  compute is overkill for a single-tenant hackathon demo. If a Tensorlake
  judge asks, the answer is honest: "Roadmap, when this becomes multi-
  tenant. Not load-bearing for the demo."
- **Hyperspell** — Was Stretch in v2 for operator-personal memory. Cut
  because Nia's Vault + Context Sharing already covers personal/episodic
  memory, and adding Hyperspell on top would split the memory story.
- **World Labs** — Was a stretch for generated training environments. Not
  on the critical path.
- **Reacher** — Distribution-layer sponsor. Not relevant.

---

## 4. Lessons from Arlan and Nozomio's Prior Hackathon

Arlan Rakhmetzhanov is Nozomio's solo founder — 18 years old, YC S25,
$6M raise from Paul Graham, BoxGroup, CRV, LocalGlobe, and Spotify's
cofounder. He hosted the **$65K YC Agents Hackathon** at the YC Office on
August 22-23, 2025 — the first overnight hackathon held there. Tracks
were Tools for Agents, Developer & Code Agents, Consumer Agents, and Web
Agents.

He's a builder who pays attention to depth over polish. He pushes back on
shallow integrations publicly. The two posts that shaped our build:

### Arlan's "Planning is more important than writing actual code"

**Source:** LinkedIn, October 2025, on Nia Oracle's launch.

> "Mistakes in the research phase become a flood of silent bugs. Every
> missing file and every hidden dependency turns into a future headache.
> If you're frustrated with the agent's output, go back and review the
> plan, not the implementation. Spec-first development isn't just a
> methodology; it's the only way to turn fragile prototypes into robust,
> production-ready automation."

**How this shaped our build:**

- We are spending the night on this design doc instead of jumping into
  code, and it is the right call.
- The Document Agent's JSON-schema extraction is *spec-first reading* of
  the source rule. Instead of asking the LLM "summarize this rule," we
  give it a typed schema and the agent fills it. No hallucination.
- The verifier state machine is a single TypeScript module with 8 unit
  tests written *before* the integration. Spec-first.

### Arlan's "If your team is still pasting docs into coding agents, you're already behind"

**Source:** LinkedIn, November 2025, on Nia's Organizations launch.

> "Context shouldn't live in 17 people's Downloads folder. ... If it
> holds context, Nia turns it into something your agents can reason about.
> Excel → each sheet parsed into structured tables. Word/RTF → headings,
> lists, tables, formatting preserved. PDFs → layout-aware extraction +
> OCR for scanned docs."

**How this shaped our build:**

- Our policy graph is *not* a curated, hand-built knowledge base. It's
  Nia indexing the company's actual documents and producing the structure
  automatically.
- The "Memory, alive" scene (Scene 2) explicitly demonstrates this: when
  a new incident is reported, it's just a JSON file dropped in a folder.
  Nia handles the rest. No human curation step.

### Arlan's Vault thesis

**Source:** Threads, on Vault's launch.

> "I built vault, a self-improving knowledge base that can index your
> entire life (personal mini agi). It updates while you sleep, supports
> 50+ integrations like notion, snowflake, datadog, and more. When you
> connect a source (like stripe), all the data becomes a filesystem.
> Built for both agents and humans, so you can interact with it through
> either cli or ui."

**How this shaped our build:**

- The policy graph IS a Vault. We don't build a parallel "rules database."
- `nia vault dream` is in the demo (Scene 2 finale clip). The "self-
  improving" moment is Arlan's framing applied to safety policies.
- Force-directed graph view in `app.trynia.ai/vaults` is the visual we
  mirror in our React Flow pane. Mirroring his UI is a deliberate
  signal: *we use this, we know what it looks like, we built around it.*

### Arlan's "AgentSearch" / filesystem-over-RAG thesis

**Source:** Threads.

> "Solves code hallucination by letting agents browse documentation as
> filesystems using bash commands, rather than traditional RAG chunking."

**How this shaped our build:**

- Our citation lookups go through Nia's structural primitives
  (`nia_read`, `nia_grep`, `nia_explore`), not a chunked vector retrieval.
  We honor the filesystem-over-RAG ethos.
- The "Source Inspector" pane (P2 task) literally exposes the file tree
  via `nia_explore`. If a judge wants to see what's indexed, they can
  browse it as a filesystem.

### Lessons from the Aug 2025 YC Agents Hackathon

We don't have a public list of winners and losers from that event, but
the track structure is informative:

| Track                      | Implication for us                                         |
|----------------------------|------------------------------------------------------------|
| Tools for Agents           | RealityCI exposes itself as an MCP server (v2 hook noted)  |
| Developer & Code Agents    | Our Scene 3 (agent trace) directly addresses this          |
| Consumer Agents            | Not our lane                                               |
| Web Agents                 | Not our lane                                               |

The previous hackathon's $80K prize pool with overnight execution at the
YC Office tells us Arlan rewards builders who ship deep over builders who
ship shallow-but-clean. Our build leans depth.

### What we'd ask Arlan during office hours

If we get a chance to talk to him at the venue:

1. *"Is the Vault graph view the right primary visual, or does the demo
   need something simpler?"* — His taste matters.
2. *"What's the most underused part of Nia we could lean into?"* — Lets
   him brag about a feature and possibly tell us we missed a free win.
3. *"Are paragraph-level citations a first-class field, or are we building
   a fallback we don't need?"* — Resolves the Day-1 spike risk.
4. *"What did the August hackathon's winners do well that most teams
   missed?"* — Pattern-match without leaking strategy.

---

## 5. Lessons from Manufacturing Incident Response Research

The action layer came from one pattern: the expensive failure is often not
that the facility failed to detect the problem. It is that nobody owned
the next step.

Research summary:

- OSHA 29 CFR 1910.38 requires emergency action plans to cover reporting,
  evacuation, critical plant operations, employee accounting, rescue /
  medical duties, and contact information.
- OSHA 29 CFR 1904 and ISO 45001-style systems require records of what
  happened, who was notified, what action was taken, and when.
- A manufacturing-response case study: SCADA alert fired at 6:47 AM;
  nobody moved for nine minutes; three people assumed someone else owned
  it; the shift lead had handed over eleven minutes earlier; the printed
  emergency plan named a supervisor who had transferred months before.
- The most common first-ten-minute failures: stale contact data, shift
  handover gaps, no task ownership, fragmented communications, and paper
  plans under pressure.
- Good response infrastructure does five things: tasks go to roles, alerts
  reach people simultaneously, workflows activate on declaration,
  decision-makers get a live view, and the audit trail builds itself.

RealityCI mirrors those five points exactly:

| Failure mode | RealityCI response |
|--------------|--------------------|
| Stale named contacts | Dispatch to roles from `role_roster`, not names |
| Shift handover gap | Active incidents and unresolved hazards appear in Convex + InsForge ledger |
| No task ownership | First violation creates a role-owned action plan |
| Fragmented channels | Voice + SMS + Slack + email fan out simultaneously |
| Paper plan under pressure | Nia Document Agent extracts the plan; InsForge executes it |
| Missing audit trail | Every action event is append-only and timestamped |

This is why the phone-call scene matters. It is not a gimmick. It is the
visible version of "workflows activate on declaration."

---

## 6. Why Each Cut Feature Was Cut

| Feature                         | Why cut                                                             |
|---------------------------------|---------------------------------------------------------------------|
| Custom-trained YOLO             | Open-vocab YOLO-World eliminates training entirely. Saves 14h.      |
| Production-footage scene        | 4 scenes in 3 minutes is too tight. Scene 3 is the on-theme moment. |
| Image-region (bbox) custom code | Nia's `extract/detect` exposes bbox natively. Free win, less code.  |
| Tensorlake                      | Local compiler is fast enough; sandboxed compute is overkill.       |
| Hyperspell                      | Vault + Context Sharing covers the same memory layer, more cleanly. |
| World Labs                      | Generated training environments are off-critical-path.              |
| Reacher                         | Distribution layer; not in the demo.                                |
| Auto-detect run start           | Manual hotkey is bulletproof for scripted demos. v2 feature.        |
| Live (real LLM) agent in Scene 3| Network-dependent. Scripted trace ships; live is one-file v2 swap.  |
| Live voice-agent conversation   | Twilio + pre-recorded TwiML is deterministic for demo; Bland/Vapi/Retell are production paths. |
| 6 Nia ingest sources            | 3 Core in v2 plan. v3 keeps 5-7 Core; the rest are Stretch.         |

---

## 7. What Would Cause Us to Replan

If any of these turn out to be true at dress rehearsal, we replan:

- YOLO-World prompt accuracy <80% on our staged hazard scenes. (Mitigation:
  prompt-tune; if still <80%, fall back to hard-coded geometric heuristics
  on YOLO-World detections. Don't reintroduce training.)
- Gemini 3 Flash latency consistently >1.5s. (Mitigation: drop the VLM
  layer for the demo; YOLO-World + heuristics carry it.)
- Nia paragraph-level retrieval is unreliable. (Mitigation: structured
  JSON fallback already designed; demo carries on with cite text from JSON
  while Nia handles incident ingest, vault, and document-agent expansion.)
- Convex Agent Component has a sharp edge we didn't anticipate. (Mitigation:
  drop to raw Convex tables; we lose websocket streaming deltas but keep
  reactive queries. Demo still works, less polished.)
- InsForge setup burns more than 2 hours. (Mitigation: keep the InsForge
  section in the architecture, but use Convex tables for the hackathon
  action ledger and document InsForge as the production execution backend.)
- Twilio outbound call setup fails. (Mitigation: hidden hotkey marks the
  call as placed and plays the voice message from laptop speakers; still
  show the action timeline.)
- Pitch length is shorter than 3 minutes. (Mitigation: cut Scene 1 to 30s,
  Scene 2 to 30s, Scene 3 to 60s. Outro to 5s. Still fits.)
- One team member can't finish their P0 tasks on time. (Mitigation:
  P0/P1/P2 priority tags let anyone pick up the next-most-important
  thing. Cut all P2 first, then re-evaluate which P1s are demo-load-
  bearing.)

---

## 8. Open Questions For The Team

These are the calls that haven't been made yet and need to be made early:

1. **Team size.** How many builders, what skills?
2. **Pitch length.** Confirm with org. 3 minutes vs. 5 minutes changes
   Scene 3.
3. **Hotkey framework.** Karabiner Elements (macOS-native, scripted) vs.
   a small Electron overlay (cross-platform, in-app). Decide before
   building scenes.
4. **Backup video ownership.** Who records, who owns the hotkey runbook,
   who is the demo-day backup operator if the primary runs into a
   problem.
5. **Phone number ownership.** Which team-controlled number receives the
   live call? Which number acts as mock emergency dispatch?
6. **Live LLM in Scene 3 (post-hackathon).** Worth a Q&A line: "the
   architecture supports live tool-use; we ship the deterministic
   scripted version for demo reliability."

---

This doc is meant to be **read top-to-bottom by anyone joining the build**
and to be the answer to *"why did you do X?"* for every X a judge asks
about. If you find a decision below that doesn't match the code, the
code is wrong, not the doc — fix the code. If the decision needs to
change, update this doc *first*, then change the code.
