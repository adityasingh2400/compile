# Synthesizer Prompt Spec

Concrete spec for the LLM call that turns a trace cluster into a typed function. This is the demo's spine — derisk Friday by validating it against 3 hardcoded clusters.

## Input format (what we send to Codex / Claude)

```json
{
  "prompt_template": "<the original LLM prompt that the agent was running>",
  "tool_schemas": [<JSON-Schema objects for any tools the agent could call>],
  "input_schema": <JSON Schema inferred from observed inputs>,
  "output_schema": <JSON Schema inferred from observed outputs>,
  "traces": [
    { "input": <observed input>, "output": <observed output>, "tool_calls": [...] },
    ...up to 100 traces, downsampled if more
  ],
  "customer_docs": [
    { "title": "ICP definition", "nia_doc_id": "...", "excerpt": "..." }
  ]
}
```

Trace count target: **30 minimum, 100 ideal**. Below 30, return null with reason "insufficient_data".

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

Fallback when can't synthesize:
```json
{
  "synthesizable": false,
  "reason": "insufficient_data" | "high_variance_outputs" | "creative_task" | "novel_reasoning_required",
  "recommendation": "stay_tier_3" | "wait_for_more_traces"
}
```

## The prompt (verbatim, send to Codex/Claude)

```
You are a code synthesizer. Your job: examine a cluster of LLM call traces and emit a deterministic TypeScript function that reproduces the LLM's behavior on hot patterns, with explicit fallback for branches you can't capture.

YOU WILL RECEIVE: a JSON object with prompt_template, tool_schemas, input_schema, output_schema, traces (30-100 examples), and customer_docs.

YOU WILL EMIT: a single JSON object matching the output schema below. NO PROSE OUTSIDE THE JSON.

DECISION TREE FOR TIER CLASSIFICATION:

1. Tier 1 (deterministic) — emit if ALL hold:
   - Output is fully determined by structured features of input (regex matches, enum values, schema fields, template substitution)
   - No two traces with the "same input features" produced different outputs
   - Logic can be expressed in <50 lines of TS without ML
   Examples: invoice field extraction, intent classification with stable label set, format normalization, cross-system glue.

2. Tier 2 (local small LLM) — emit if Tier 1 doesn't fit AND:
   - Outputs vary in surface form but converge on small set of meanings (paraphrases, light summarization, classification with fuzzy boundaries)
   - A 1B-parameter model could plausibly produce equivalent outputs given the prompt + few-shot examples
   - You can write an optimized prompt + 5 few-shots that demonstrably steer the small model
   Examples: support reply tone-matching, lead qualification with judgment calls, light translation.

3. Tier 3 only (do not synthesize) — emit synthesizable=false if:
   - Outputs require novel reasoning per call (creative writing, debugging, multi-step planning)
   - Variance in output is intrinsic to the task value (no two summaries should be identical)
   - <30 traces observed (insufficient_data)

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
