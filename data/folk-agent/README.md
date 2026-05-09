# folk/agent

Demo customer for Compile — modeled on **Folk by Nozomio** (`getfolk.app`),
the personal AI agent that lives in your iMessage / Telegram / Discord.

The repo is organized into the three pillars Folk's agent platform
actually does, so the audit walks all three and finds the codifiable
work across the whole product:

| File | Pillar | What it does |
|---|---|---|
| `src/folk_inbox.ts` | **META** | iMessage/Telegram/Discord agent inbox — the original Folk feature |
| `src/dm_concierge.ts` | **LINKEDIN** | Cold-DM concierge — auto-responds to LinkedIn / email outreach |
| `src/support.ts` | **CUSTOMER SERVICE** | Generic B2B support routing — generalizes the demo beyond just Folk |

## Why these three pillars

The viral wedge is the META pillar — Folk's iMessage agent. Ion will
text it on stage and we'll show the cost story.

The killer demo is the LINKEDIN pillar. **From Arlan's stage talk:**

> "I get 150 LinkedIn requests a day across LinkedIn and email, and
>  like 90% of them are completely shit."

We ran 100k synthetic DMs through Tensorlake. **91% landed in the
same 4 quality clusters** (`ai_slop`, `generic_pitch`,
`recruiter_blast`, `vc_outreach`). Each cluster maps to one of 5
canned responses. He's been paying frontier rates to evaluate a
13-cell switch statement.

The CUSTOMER SERVICE pillar generalizes the story. Every B2B SaaS has
this exact pattern — Folk does support routing, Stripe does it,
Notion does it, every enterprise SaaS does it. Compile finds it
everywhere.

## The audit's verdict — green vs red

Compile audits each call site against two synthesis-viability tests:

1. **Can the synthesizer faithfully reproduce production inputs?**
   (text-only → yes; vision/HTML/audio → no)
2. **Does the LLM's output collapse into a finite template set?**
   (bounded enum or deterministic transform → yes; free-form NL → no)

The 5 **GREEN/YELLOW** sites pass both — Compile codifies them:

| Site | Pillar | Input | Output | Why codifiable |
|---|---|---|---|---|
| `classify_message_intent` | META | text + channel | 6-way enum | every iMessage hits this; archetypes are stable |
| `extract_event_from_message` | META | text | 6-way life-event enum | bounded archetypes (relocation, new_job, …) |
| `classify_inbound_dm_quality` | LINKEDIN | text + sender summary | 7-way quality enum | **Arlan's pain** — DMs cluster into recognizable archetypes |
| `pick_response_template` | LINKEDIN | (quality × ask) tuple | 8-way template enum | **the lookup-table joke** — 13-cell switch statement |
| `classify_support_ticket_priority` | CS | text + customer_tier | P0/P1/P2/P3 + reason | the universal SaaS pattern |

The **RED** sites fail one of the tests — the audit rejects them
with the stated reason and they stay frontier:

| Site | Why frontier |
|---|---|
| `extract_location_from_post` | vision input · synth can't fake images |
| `summarize_person_status` | pure creative paragraph · no template collapse |
| `draft_personal_response_to_dm` | response is personalized to sender · no template collapse |
| `resolve_complex_support_ticket` | open-ended reasoning over heterogeneous evidence |
| `infer_company_context` | open-ended generative inference · no bounded schema |

This honesty is the product. Compile doesn't promise to retire every
LLM call — it finds the ones it *can* faithfully replicate, retires
those, and openly leaves the rest at frontier.

## The 100k synthetic call structure

Every codifiable workflow goes through the same Compile pipeline:

1. **Synthesize 100k inputs** that match production distribution.
   For `classify_inbound_dm_quality` that's 768 anchor template
   cells (8 quality archetypes × 12 lexical variants × 8 sender
   personas) fanned into ~130 paraphrases each.
2. **Run them through the original LLM** in a Tensorlake sandbox.
3. **Cluster the outputs.** This is where the magic happens — for
   well-formed workflows, 100k inputs collapse into N≈5–8 output
   templates.
4. **Codify each cluster as deterministic logic.** A regex, a
   lookup table, a few nested if-elses, or in stubborn cases a
   tiny phi-3-mini fallback for the long tail.
5. **Ship the vault.** Compile rewrites the original call site to
   route through the codified handler; the LLM cost evaporates.

For Arlan's DM concierge that means: 100k synthetic LinkedIn DMs
land in 7 quality buckets, those buckets cross-product with 11
asks to fill a 56-cell response matrix, and the matrix has 13
distinct outcomes. Folk pays $0 to send "Thanks but I'm not taking
unsolicited meetings" 130 times a day.
