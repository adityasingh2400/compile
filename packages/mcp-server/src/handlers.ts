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
} from "@compile/schemas";
import type { z } from "zod";

type SubmitOutput = z.infer<typeof SubmitSynthesisOutput>;
import type { INiaClient } from "@compile/nia";
import { gate } from "@compile/runtime";
import { validateEnvelope } from "@compile/synthesizer";
import type { IRequestStore } from "./store.js";

export interface HandlerDeps {
  nia: INiaClient;
  store: IRequestStore;
  /**
   * Source of clusters/traces. Lane A's harness injects a fixture-backed
   * resolver; the production identification pipeline plugs in here too.
   */
  resolveCluster?: (cluster_id: string) => Promise<{
    cluster: import("@compile/schemas").Cluster;
    prompt_template: string;
    tool_schemas: Array<Record<string, unknown>>;
    input_schema: Record<string, unknown>;
    output_schema: Record<string, unknown>;
    traces: import("@compile/schemas").Trace[];
    customer_docs?: import("@compile/schemas").SynthesisSpec["customer_docs"];
  } | null>;
}

const NOT_IMPLEMENTED = (name: McpToolName): never => {
  throw new Error(`${name} not implemented yet (Lane A1 ships request/submit only)`);
};

export function buildHandlers(deps: HandlerDeps): Record<
  McpToolName,
  (raw: unknown) => Promise<unknown>
> {
  return {
    "compile.observe_call": async (raw) => {
      ObserveCallInput.parse(raw);
      NOT_IMPLEMENTED("compile.observe_call");
    },

    "compile.find_function": async (raw) => {
      FindFunctionInput.parse(raw);
      NOT_IMPLEMENTED("compile.find_function");
    },

    "compile.run_codified": async (raw) => {
      RunCodifiedInput.parse(raw);
      NOT_IMPLEMENTED("compile.run_codified");
    },

    "compile.list_codify_candidates": async (raw) => {
      ListCandidatesInput.parse(raw);
      NOT_IMPLEMENTED("compile.list_codify_candidates");
    },

    "compile.request_synthesis": async (raw): Promise<SynthesisSpec> => {
      const { cluster_id } = RequestSynthesisInput.parse(raw);
      const resolved = await deps.resolveCluster?.(cluster_id);
      if (!resolved) {
        throw new Error(`unknown cluster: ${cluster_id}`);
      }
      const { assembleSpec } = await import("@compile/synthesizer");
      const request_id = randomUUID();
      const { spec, holdout_traces } = assembleSpec({
        request_id,
        cluster: resolved.cluster,
        prompt_template: resolved.prompt_template,
        tool_schemas: resolved.tool_schemas,
        input_schema: resolved.input_schema,
        output_schema: resolved.output_schema,
        traces: resolved.traces,
        customer_docs: resolved.customer_docs,
      });
      deps.store.put({
        request_id,
        cluster_id,
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
        // Negative outcome — Lane D writes to Nia Vault as negative entry.
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
        // TODO(lane-D): write positive entry to Nia Vault here.
        return {
          gate_verdict: "pass",
          function_id: validated.envelope.function_name,
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
      EstimateSavingsInput.parse(raw);
      NOT_IMPLEMENTED("compile.estimate_savings");
    },
  };
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
