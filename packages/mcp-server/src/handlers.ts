import { randomUUID } from "node:crypto";
import {
  MCP_TOOLS,
  type McpToolName,
  ObserveCallInput,
  FindFunctionInput,
  RunCodifiedInput,
  ListCandidatesInput,
  RequestSynthesisInput,
  SubmitSynthesisInput,
  EstimateSavingsInput,
  SubmitSynthesisOutput,
  type SynthesisSpec,
  type Cluster,
  type Trace,
  RETRY_POLICY_BY_REASON,
} from "@compile/schemas";
import type { INiaClient } from "@compile/nia";
import { gate, runCodified } from "@compile/runtime";
import { validateEnvelope, assembleSpec } from "@compile/synthesizer";
import {
  type IReceiptStore,
  runPipeline,
  type CandidateCluster,
} from "@compile/identifier";
import type { z } from "zod";
import type { IRequestStore } from "./store.js";

type SubmitOutput = z.infer<typeof SubmitSynthesisOutput>;

export interface HandlerDeps {
  nia: INiaClient;
  store: IRequestStore;
  receipts: IReceiptStore;
  /**
   * Resolves a cluster_id to the candidate (cluster + receipts) the
   * pipeline produced. Defaults to running the pipeline live; tests/fixtures
   * can override.
   */
  resolveCandidate?: (cluster_id: string) => Promise<CandidateCluster | null>;
  /**
   * Build the per-cluster synthesis prompt and schemas. For the hackathon
   * defaults, we use the receipt prompt verbatim and infer schemas from the
   * first receipt.
   */
  buildSpecInputs?: (candidate: CandidateCluster) => {
    prompt_template: string;
    tool_schemas: Array<Record<string, unknown>>;
    input_schema: Record<string, unknown>;
    output_schema: Record<string, unknown>;
    customer_docs?: SynthesisSpec["customer_docs"];
  };
}

function defaultResolveCandidate(deps: HandlerDeps) {
  return async (cluster_id: string): Promise<CandidateCluster | null> => {
    const candidates = runPipeline({ receipts: deps.receipts.all() });
    return candidates.find((c) => c.cluster.cluster_id === cluster_id) ?? null;
  };
}

function defaultBuildSpecInputs(candidate: CandidateCluster): {
  prompt_template: string;
  tool_schemas: Array<Record<string, unknown>>;
  input_schema: Record<string, unknown>;
  output_schema: Record<string, unknown>;
} {
  const first = candidate.receipts[0]!;
  return {
    prompt_template: first.prompt,
    tool_schemas: first.tool_schemas,
    input_schema: inferShape(first.input),
    output_schema: inferShape(first.output),
  };
}

function inferShape(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return { type: "null" };
  if (typeof v === "string") return { type: "string" };
  if (typeof v === "number") return { type: "number" };
  if (typeof v === "boolean") return { type: "boolean" };
  if (Array.isArray(v)) {
    return { type: "array", items: v.length > 0 ? inferShape(v[0]) : {} };
  }
  if (typeof v === "object") {
    const props: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      props[k] = inferShape(val);
    }
    return { type: "object", properties: props, required: Object.keys(props) };
  }
  return {};
}

function tracesFromReceipts(receipts: ReadonlyArray<{
  input?: unknown;
  output?: unknown;
}>): Trace[] {
  return receipts.map((r) => ({
    input: r.input ?? null,
    output: r.output ?? null,
    tool_calls: [],
  }));
}

export function buildHandlers(deps: HandlerDeps): Record<
  McpToolName,
  (raw: unknown) => Promise<unknown>
> {
  const resolveCandidate = deps.resolveCandidate ?? defaultResolveCandidate(deps);
  const buildSpecInputs = deps.buildSpecInputs ?? defaultBuildSpecInputs;

  return {
    "compile.observe_call": async (raw) => {
      const r = ObserveCallInput.parse(raw);
      deps.receipts.put(r);
      return { ok: true as const, receipt_id: r.call_id };
    },

    "compile.find_function": async (raw) => {
      const { description, prompt, tool_schemas } = FindFunctionInput.parse(raw);
      // Three-state lookup keyed by cluster_signature. The cluster signature
      // for routing is derived from the templated form of the incoming
      // prompt — not the description — so a misleading description can't
      // mask a real codified hit.
      const sig = derivePromptSignature(prompt ?? description, tool_schemas ?? []);
      return await deps.nia.vaultLookup(sig);
    },

    "compile.run_codified": async (raw) => {
      const { function_id, input } = RunCodifiedInput.parse(raw);
      // Lookup the positive Vault entry for this function_id.
      const lookup = await deps.nia.vaultLookup(function_id);
      if (lookup.state !== "positive") {
        // Try lookup-by-function_id semantics: scan all entries (Lane D will
        // make this an indexed query).
        throw new Error(`run_codified: no positive Vault entry for ${function_id}`);
      }
      const env = lookup.entry.envelope;
      return await runCodified({
        function_id: lookup.entry.function_id,
        function_name: env.function_name,
        code: env.code,
        input,
        tier: env.tier === "tier_1" ? "tier_1" : "tier_2",
      });
    },

    "compile.list_codify_candidates": async (raw) => {
      const { limit } = ListCandidatesInput.parse(raw);
      const ranked = runPipeline({ receipts: deps.receipts.all() });
      return {
        candidates: ranked.slice(0, limit).map((c) => ({
          ...c.cluster,
          projected_annual_savings_usd: c.projected_annual_savings_usd,
          sample_prompt: c.sample_prompt,
        })),
      };
    },

    "compile.request_synthesis": async (raw): Promise<SynthesisSpec> => {
      const { cluster_id } = RequestSynthesisInput.parse(raw);
      const candidate = await resolveCandidate(cluster_id);
      if (!candidate) throw new Error(`unknown cluster: ${cluster_id}`);
      const inputs = buildSpecInputs(candidate) as ReturnType<typeof defaultBuildSpecInputs> & {
        customer_docs?: SynthesisSpec["customer_docs"];
      };
      const request_id = randomUUID();
      const { spec, holdout_traces } = assembleSpec({
        request_id,
        cluster: candidate.cluster,
        prompt_template: inputs.prompt_template,
        tool_schemas: inputs.tool_schemas,
        input_schema: inputs.input_schema,
        output_schema: inputs.output_schema,
        traces: tracesFromReceipts(candidate.receipts),
        customer_docs: inputs.customer_docs,
      });
      deps.store.put({
        request_id,
        cluster_id,
        cluster_signature: candidate.cluster.cluster_signature,
        spec,
        holdout_traces,
        created_at: Date.now(),
      });
      return spec;
    },

    "compile.submit_synthesis": async (raw): Promise<SubmitOutput> => {
      const { request_id, envelope } = SubmitSynthesisInput.parse(raw);
      const pending = deps.store.get(request_id);
      if (!pending) {
        return {
          gate_verdict: "fail",
          failure_reason: `unknown request_id: ${request_id}`,
        };
      }
      const validated = validateEnvelope(envelope);
      if (!validated.ok) {
        return { gate_verdict: "fail", failure_reason: validated.failure_reason };
      }
      if (validated.envelope.synthesizable === false) {
        // Negative outcome → write negative entry to Vault per D8 retry policy.
        await deps.nia.vaultWrite({
          kind: "negative",
          cluster_signature: pending.cluster_signature,
          reason: validated.envelope.reason,
          retry_policy:
            validated.envelope.retry_policy ??
            RETRY_POLICY_BY_REASON[validated.envelope.reason],
          trace_count_at_decision: pending.spec.traces.length + pending.holdout_traces.length,
          created_at: new Date().toISOString(),
        });
        deps.store.delete(request_id);
        return {
          gate_verdict: "fail",
          failure_reason: `synthesizable=false: ${validated.envelope.reason}`,
        };
      }
      const verdict = await gate({
        envelope: validated.envelope,
        holdout: pending.holdout_traces,
      });
      deps.store.delete(request_id);
      if (verdict.verdict === "pass") {
        const function_id = `fn_${validated.envelope.function_name}_${request_id.slice(0, 8)}`;
        await deps.nia.vaultWrite({
          kind: "positive",
          function_id,
          cluster_signature: pending.cluster_signature,
          tier: validated.envelope.tier,
          envelope: validated.envelope,
          holdout_match_rate: verdict.match_rate,
          created_at: new Date().toISOString(),
          hit_count: 0,
          estimated_savings_usd_total: 0,
        });
        return {
          gate_verdict: "pass",
          function_id,
          holdout_match_rate: verdict.match_rate,
          savings_estimate_usd_annual:
            validated.envelope.estimated_savings_per_call_usd *
            (pending.spec.axis_scores.economic_value.monthly_calls * 12),
        };
      }
      return {
        gate_verdict: "fail",
        holdout_match_rate: verdict.match_rate,
        failure_reason: verdict.failure_reason,
      };
    },

    "compile.estimate_savings": async (raw) => {
      const { cluster_id, monthly_volume } = EstimateSavingsInput.parse(raw);
      const candidate = await resolveCandidate(cluster_id);
      if (!candidate) throw new Error(`unknown cluster: ${cluster_id}`);
      const ev = candidate.cluster.axis_scores!.economic_value;
      const t1 = 0.0001;
      const t2 = 0.0005;
      const monthly_calls = monthly_volume ?? ev.monthly_calls;
      const per_call_t3 =
        candidate.receipts.reduce((s, r) => s + r.cost_usd, 0) /
        Math.max(1, candidate.receipts.length);
      return {
        axis_scores: candidate.cluster.axis_scores!,
        per_call_savings_usd: {
          tier_1: per_call_t3 - t1,
          tier_2: per_call_t3 - t2,
        },
        annual_savings_usd: monthly_calls * 12 * (per_call_t3 - t1) - ev.synthesis_cost_usd - ev.maintenance_cost_usd,
        break_even_hits: ev.break_even_hits,
      };
    },
  };
}

function derivePromptSignature(
  prompt: string,
  tool_schemas: Array<Record<string, unknown>>,
): string {
  // Reuse the templater's skeletonization indirectly via a local mirror.
  // Keeping this inline avoids a circular dep on @compile/identifier internals.
  const skel = prompt
    .replace(/https?:\/\/\S+/gi, "<URL>")
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi, "<EMAIL>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<UUID>")
    .replace(/\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?Z?)?\b/g, "<DATE>")
    .replace(/\b[0-9a-f]{16,}\b/gi, "<HEX_ID>")
    .replace(/"[^"\\]*(?:\\.[^"\\]*)*"/g, '"<STR>"')
    .replace(/'[^'\\]*(?:\\.[^'\\]*)*'/g, "'<STR>'")
    .replace(/-?\b\d[\d,]*\.?\d*\b/g, "<NUM>")
    .replace(/\s+/g, " ")
    .trim();
  // Hash to match the templater's tpl_<hex> shape so positive cache lookups
  // are by the same key. We use the cluster_signature on Vault entries which
  // identifier sets to template_id.
  const h = require("node:crypto").createHash("sha1");
  h.update(skel);
  h.update(" ");
  h.update(JSON.stringify(tool_schemas ?? []));
  return `tpl_${h.digest("hex").slice(0, 12)}`;
}

export const TOOL_DESCRIPTIONS: Record<McpToolName, string> = {
  "compile.observe_call": "Log an LLM call receipt to the identification pipeline.",
  "compile.find_function":
    "Three-state lookup against Nia Vault: positive hit / negative hit / unknown.",
  "compile.run_codified": "Execute a codified function (Tier 1 or Tier 2).",
  "compile.list_codify_candidates":
    "Ranked clusters that passed 3-axis scoring; powers the 48h report.",
  "compile.request_synthesis":
    "Returns a synthesis spec. The CALLING agent runs codegen on its own LLM keys.",
  "compile.submit_synthesis":
    "Agent submits emitted code; Compile validates against private holdout, gates ≥98%.",
  "compile.estimate_savings":
    "Projected $ savings per tier with break-even formula.",
};

export const TOOLS = MCP_TOOLS;
