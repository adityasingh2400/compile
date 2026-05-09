# Test Plan — RealityCI

Last refined: 2026-05-04 (v3)
Branch: main
Repo: github.com/adityasingh2400/warden

## Frameworks

- **Unit:** Vitest
- **E2E:** Playwright
- **Eval:** simple input/output JSON comparison (no framework needed)

## Affected Routes / Pages

- `/` — main demo dashboard (camera/agent feed left, policy graph center, citation card right)
- `/runs/:id` — historical run replay
- `/source-inspector` — debug-only Nia file-tree pane (P2)

## Key Interactions to Verify

- **Hotkey START** triggers a new Run with correct `source` ('camera' | 'agent') and `policy_graph_id`
- **YOLO-World detection** emits structured events into the verifier
- **Gemini 3 Flash relation** prompts return scene-relation strings within 800ms cap
- **Verifier evaluation** of an event against the policy graph fires either a passing-rule or violation event
- **Policy graph node transitions** (gray → green pulse on pass, gray → red pulse on violation, edge animation on related rules)
- **Live ingest** of new incident JSON updates the policy graph in real time
- **Hidden hotkey fallback** for live ingest produces visually identical outcome
- **Source switch** (camera ↔ agent trace) creates a new Run, prior Run state stays isolated
- **Document Agent expansion** populates the citation card progressively via SSE → Convex stream

## Edge Cases

- **Verifier state machine:**
  - Event with no matching rule → silent ignore (no graph state change)
  - Same event fired within 2s → debounced (one violation, not two)
  - Camera feed stalls for 5s → LOST_SIGNAL banner; agent trace pane keeps running
  - Two violations in same frame → both surface; citation card shows the higher-severity one first
  - Multiple events of different types in <500ms → process in arrival order, no state collision
- **Citation resolver:**
  - Nia returns paragraph-level → use directly
  - Nia returns document-level → fall back to structured JSON for cite text; Nia still owns ingest, document-agent expansion, vault
  - Nia times out (>500ms budget) → fall back to JSON
  - `rule_id` not in cache or JSON → render "Citation lookup failed" with rule_id (do not blank out)
  - Document Agent SSE stream interrupted → already-rendered fields stay; "expansion paused" banner appears
- **Live ingest watcher:**
  - File added but malformed JSON → log error, do not crash, do not add node
  - Nia ingest fails → hidden hotkey fallback path adds node directly via Convex mutation
  - Multiple files added in rapid succession → process each independently, no race
- **YOLO-World wrapper:**
  - Frame with no detected hazard classes → empty event, verifier ignores
  - Frame with all hazard classes detected → verifier evaluates each against the graph
  - YOLO-World call fails (e.g. weights not loaded) → big visible error in dashboard, do not silently degrade
- **Gemini 3 Flash:**
  - Latency exceeds 800ms → discard in-flight call, emit YOLO-World-only event with a flag `vlm_skipped: true`
  - API rate limited → exponential backoff, surface "scene reasoning paused" status; verifier still works on YOLO-only signal
- **Network resilience:**
  - Nia unreachable → JSON-only citation path; ingest scenes use hidden hotkey fallback
  - Gemini Flash unreachable → YOLO-World-only mode
  - Convex cloud unreachable → fall back to local Convex dev instance
  - Full offline (Day 6 wifi-off rehearsal) → demo runs end-to-end, all 3 scenes

## Critical Paths (these MUST work end-to-end)

1. **Scene 1 — coffee mug on power strip.** START → YOLO-World detects mug + power strip → Gemini-3 confirms "above" relation → verifier finds OSHA 1910.305 rule node → red flash on node + edges to related rules and prior incidents animate → citation card hydrates with verbatim quote within 1s, then Document Agent expansion follows within 5s. **Acceptance:** red flash within 1s; verbatim quote correct; edge animation visible; no console errors.
2. **Scene 2 — incident ingest + bag on fire extinguisher.** Mid-run, drop new incident JSON into watched folder → "Nia ingesting..." spinner → within 8s, new incident node attaches to the rule → bag placed in front of fire extinguisher card → verifier fires → cite includes BOTH the rule text AND the just-ingested prior incident. **Acceptance:** new graph node within 8s online OR hidden hotkey fallback fires within 1s; both cite cards (rule + prior incident) visible; pre-recorded `nia vault dream` clip plays as outro within scene.
3. **Scene 3 — agent trace out-of-order tool call.** Source switch from camera to agent trace → scripted player emits `pick_up_box`, `add_product`, then `apply_label` (skipping `add_packing_material`) → verifier flags out-of-order → same red flash, same citation surface, same prior-incident edge animation. **Acceptance:** identical visual outcome to camera-driven violation; agent trace pane shows lines streaming via Convex websocket; no state bleed from previous run.

## What Not to Test (intentional)

- YOLO-World accuracy across general object classes — Ultralytics validates that. We do golden-frame integration tests for our specific hazard classes only.
- Convex schema correctness — TypeScript types are the test.
- Visual regressions on the dashboard — rehearsal is the test (3 timed dress rehearsals before demo day).
- Multi-tenant / auth flows — non-goals per design doc.
- Live LLM agent calls — Scene 3 ships scripted; live agent is post-hackathon.

## Test Counts (target end-state)

| Module                          | Tests | Type                            |
|---------------------------------|-------|---------------------------------|
| Verifier state machine          | 8     | Unit                            |
| Citation resolver               | 5     | Unit (mocked Nia)               |
| Policy graph compiler           | 4     | Unit + 1 integration            |
| Live ingest watcher             | 2     | Integration                     |
| Agent trace player              | 3     | Unit                            |
| YOLO-World wrapper              | 2     | Integration (golden frames)     |
| Gemini 3 Flash latency cap      | 1     | Integration (hard 800ms cap)    |
| Critical paths (3 scenes)       | 3     | E2E (Playwright)                |
| Policy graph render             | 2     | E2E                             |
| Network-off rehearsal           | 1     | Manual checklist                |
| **Total**                       | **31**| mixed                           |

## Test Implementation Order

P0 first, P1 alongside the corresponding feature, P2 only if buffer:

- **P0 — write before integrating:** verifier state machine (8), policy graph compiler (4), citation resolver (5)
- **P0 — write alongside feature:** YOLO-World wrapper integration (2), Gemini latency cap (1), agent trace player (3)
- **P0 — write before rehearsal:** the 3 critical-path E2E specs in Playwright
- **P1 — write before dress rehearsal:** live ingest watcher (2), policy graph render E2E (2)
- **P0 — manual:** network-off rehearsal checklist signed off the day before the hackathon

The verifier and the citation resolver are the highest-leverage modules — they're the single point of failure for the entire demo. Test them first, before integrating with anything.

Estimated total test work with CC+gstack: ~5-6 hours of focused effort spread across the build. The state machine alone is worth more than every other test combined.
