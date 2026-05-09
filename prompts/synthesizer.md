# Synthesizer Prompt Spec

Concrete spec for the codegen call that turns a trace cluster into a typed function. **Critical architectural note:** this prompt is sent to the **customer's own agent** (Codex CLI / Claude Code / Cursor / Devin / etc.) via the `compile.request_synthesis()` MCP call — NOT to a model behind Compile's API key. The customer's agent runs the codegen on its own LLM key, against its own data, and submits the result back via `compile.submit_synthesis()`. Compile validates and gates; it does not generate.

This is the demo's spine — derisk Friday by validating it against 3 hardcoded clusters.

## Input format (the synthesis spec Compile returns to the customer's agent)

```json
{
  "prompt_template": "<the original LLM prompt that the agent was running>",
  "tool_schemas": [<JSON-Schema objects for any tools the agent could call>],
  "input_schema": <JSON Schema inferred from observed inputs>,
  "output_schema": <JSON Schema inferred from observed outputs>,
  "traces": [
    { "input": <observed input>, "output": <observed output>, "tool_calls": [...] },
    ...all traces split into:
  ],
  "trace_split": {
    "train": [<70% of indices — the agent sees these for codegen>],
    "val":   [<15% — the agent may use for self-validation>],
    "holdout": [<15% — Compile keeps these private, used for ≥98% gate>]
  },
  "axis_scores": {
    "schema_stability": 0.0-1.0,
    "determinism":      0.0-1.0,
    "economic_value":   { "monthly_calls": N, "annual_savings_usd": N, "break_even_hits": N }
  },
  "customer_docs": [
    { "title": "ICP definition", "nia_doc_id": "...", "excerpt": "..." }
  ]
}
```

Trace count target: **30 minimum, 100 ideal**. Below 30, the identification pipeline does not surface the cluster as a candidate (cluster is in the negative Vault with `reason: insufficient_data`, expiring retry policy).

The `holdout` indices are NOT included in the spec sent to the agent — Compile keeps holdout traces private and runs them post-hoc to gate. This prevents the agent from overfitting its emitted function to the same examples it generated from. Resolves the "98% gate is gameable" critique.

## Output format (what the synthesizer emits)

Strict JSON envelope. Codex/Claude must respond in this shape — validated by `zod` before any further processing.

```json
{
  "synthesizable": true,
  "tier": "tier_1" | "tier_2" | "tier_3_only",
  "confidence": 0.0-1.0,
  "function_name": "snake_case_id",
  "description": "<one-line plain English>",
  "code": "<typed TS function body>",
  "tests": "<Vitest test file body — 3 to 8 cases from observed I/O>",
  "contract": {
    "input_schema": <JSON Schema>,
    "output_schema": <JSON Schema>,
    "preconditions": ["<assertion>", ...],
    "doc_dependencies": ["<nia_doc_id>", ...]
  },
  "fallback_strategy": "frontier_llm" | "tier_2_local_llm" | "none",
  "estimated_savings_per_call_usd": 0.000,
  "reasoning": "<why this classifies as the chosen tier>"
}
```

Fallback when can't synthesize. **This envelope is written to Nia Vault as a negative entry** — pattern miner checks it before triggering future synthesis runs on matching clusters, so the retry_policy is load-bearing for unit economics.

```json
{
  "synthesizable": false,
  "reason": "insufficient_data" | "high_variance_outputs" | "creative_task" | "novel_reasoning_required",
  "recommendation": "stay_tier_3" | "wait_for_more_traces",
  "retry_policy": {
    "type": "sticky" | "expiring",
    "retry_when_traces": 30,
    "retry_on_distribution_shift": false
  },
  "cluster_signature": "<embedding hash or nia semantic id — used as negative cache key>"
}
```

Retry policy by reason:

| reason | type | retry_when_traces | retry_on_distribution_shift |
|---|---|---|---|
| `creative_task` | sticky | — | false |
| `novel_reasoning_required` | sticky | — | false |
| `high_variance_outputs` | sticky | — | true |
| `insufficient_data` | expiring | 30 (then 100) | false |

## The prompt (verbatim, sent to the customer's agent)

```
You are a code synthesizer. Your job: examine a cluster of LLM call traces from the calling agent's own traffic and emit a deterministic TypeScript function (or a Tier-2 prompt pack) that reproduces the LLM's behavior on hot patterns, with explicit fallback for branches you can't capture.

YOU WILL RECEIVE: a JSON object with prompt_template, tool_schemas, input_schema, output_schema, traces (train+val splits — holdout is withheld for gating), customer_docs, and axis_scores from Compile's identification pipeline.

YOU WILL EMIT: a single JSON object matching the output schema below. NO PROSE OUTSIDE THE JSON.

The cluster has ALREADY passed Compile's three codifiability axes (schema_stability ≥0.95, determinism ≥0.95, economic_value positive at break-even). Your job is to choose the tier and emit code, not to re-litigate whether the cluster is codifiable.

TIER SELECTION (use the axis_scores to decide):

1. Tier 1 (deterministic TS function) — choose if:
   - schema_stability ≥ 0.98 AND determinism ≥ 0.98
   - Logic expressible in <50 lines of TS without ML
   - Output reconstructable from structured input features (regex, enum, schema field, template substitution)
   Examples: invoice field extraction, intent classification with stable label set, format normalization.

2. Tier 2 (local small LLM with prompt pack) — choose if Tier 1 doesn't fit AND:
   - schema_stability ≥ 0.90 with surface-form variance under fixed meaning
   - A 1B-parameter model can plausibly produce equivalent outputs given a tuned prompt + 5 few-shots drawn from train traces
   Output a prompt_pack (system prompt + few-shots) AND an acceptance test that gates Tier 2 outputs at runtime — failures escalate immediately to Tier 3 (no silent degradation).

3. synthesizable=false — emit if neither tier fits given the actual traces (e.g., axis scores qualify the cluster but on inspection the variance is intrinsic to a creative subtask). This should be rare since the identification pipeline already filtered.

QUALITY RULES:

- code field must be a complete TypeScript function with explicit types
- The function MUST call llmFallback(input, function_name) on any code path the traces don't cover; never silently default
- tests field must contain 3-8 Vitest cases drawn from actual observed traces (use real trace inputs/outputs, not hallucinated)
- contract.preconditions must list invariants that, if violated at runtime, trigger drift detection (e.g., "input.email must match RFC 5322")
- doc_dependencies must list nia_doc_ids for any customer_docs whose content the function relies on (so contract tests can re-validate when those docs change)
- estimated_savings_per_call_usd: assume Tier 1 = $0.0001/call, Tier 2 = $0.0005/call, Tier 3 = $0.05/call; compute as (tier_3 - target_tier) * confidence

OUTPUT THE JSON ENVELOPE ONLY. No markdown fences, no commentary.
```

## Validation harness for Friday

Build 3 hardcoded test clusters, validate each:

1. **Easy Tier 1 cluster:** invoice field extraction, 50 traces, fields are stable. Expected: synthesizable=true, tier=tier_1, confidence>0.9, tests pass.
2. **Easy Tier 2 cluster:** lead qualification with fuzzy boundary, 50 traces. Expected: synthesizable=true, tier=tier_2, confidence>0.7.
3. **Hard Tier 3 cluster:** creative writing prompts, 50 traces. Expected: synthesizable=false, reason=creative_task.

If all 3 produce expected classifications on Friday, ship Saturday confident. If 2 of 3, debug and retry. If <2 of 3, fall back to Tier 1 demo only and stub Tiers 2/3.

## Cost / latency targets

- One synthesis call: ~$0.50–$2.00 with Opus-class model, 60–120s wall time
- Acceptable for demo: synthesis completes in ≤90s on stage
- If wall time >90s on Friday, switch to streaming mode and show progress in the UI panel
