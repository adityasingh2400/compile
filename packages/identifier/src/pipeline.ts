import { AXIS_THRESHOLDS, type Cluster, type Receipt } from "@compile/schemas";
import { templatize } from "./templater.js";
import { scoreCluster } from "./scorer.js";

/**
 * Identification pipeline: receipts → templates → clusters → scored
 * candidates ranked by projected annual savings.
 *
 * Hackathon clustering rule: one template = one cluster. Real semantic
 * clustering (cross-template consolidation via Nia centroids) is Lane D's
 * job. The schema and downstream code already accept a many-to-one
 * template->cluster relationship, so swap-in is non-breaking.
 */

export interface CandidateCluster {
  cluster: Cluster;
  receipts: Receipt[];
  /** Canonical sample for surfacing in compile.list_codify_candidates(). */
  sample_prompt: string;
  /** Projected annual savings from axis_scores.economic_value (already in cluster). */
  projected_annual_savings_usd: number;
  passes_gate: boolean;
}

export interface RunPipelineArgs {
  receipts: Receipt[];
  observation_days?: number;
  synthesis_cost_usd?: number;
  maintenance_cost_usd?: number;
}

export function runPipeline(args: RunPipelineArgs): CandidateCluster[] {
  const { templates, assignments } = templatize(args.receipts);
  const receiptsByCallId = new Map(args.receipts.map((r) => [r.call_id, r] as const));

  const out: CandidateCluster[] = [];
  for (const tpl of templates) {
    const tplReceipts = tpl.receipt_ids
      .map((id) => receiptsByCallId.get(id))
      .filter((r): r is Receipt => Boolean(r));
    if (tplReceipts.length === 0) continue;

    const axis_scores = scoreCluster({
      receipts: tplReceipts,
      observation_days: args.observation_days,
      synthesis_cost_usd: args.synthesis_cost_usd,
      maintenance_cost_usd: args.maintenance_cost_usd,
    });

    const passes_gate =
      axis_scores.schema_stability >= AXIS_THRESHOLDS.schema_stability &&
      axis_scores.determinism >= AXIS_THRESHOLDS.determinism &&
      axis_scores.economic_value.annual_savings_usd > 0;

    const cluster: Cluster = {
      cluster_id: `cl_${tpl.template_id.replace(/^tpl_/, "")}`,
      cluster_signature: tpl.template_id,
      template_ids: [tpl.template_id],
      trace_count: tplReceipts.length,
      axis_scores,
      passes_synthesis_gate: passes_gate,
    };

    out.push({
      cluster,
      receipts: tplReceipts,
      sample_prompt: tplReceipts[0]!.prompt,
      projected_annual_savings_usd: axis_scores.economic_value.annual_savings_usd,
      passes_gate,
    });
  }
  // Rank by annual savings, descending.
  out.sort(
    (a, b) => b.projected_annual_savings_usd - a.projected_annual_savings_usd,
  );
  void assignments; // available if downstream wants per-receipt template lookup
  return out;
}
