import type { CallSiteDescriptor, SyntheticInput } from "@compile/schemas";
import { stubFrontierOutput } from "./oracle.js";

/**
 * The "candidate path" — the cheap path that 99% of Stage-2 synthetic calls
 * traverse. At Stage 2 we don't yet have a synthesized typed function (that
 * comes in Stage 3 / synthesis). What we DO have is a heuristic prototype
 * that the static priors suggest, plus a Tier-2 prompt-pack on Phi-3-mini.
 *
 * Hackathon stub: the candidate output mirrors the oracle output ~95% of the
 * time and intentionally diverges ~5% (to make the oracle-agreement axis
 * non-trivial). Variability is keyed deterministically by input_id so demo
 * runs are reproducible.
 */
export interface ICandidateClient {
  call(args: {
    call_site: CallSiteDescriptor;
    input: SyntheticInput;
  }): Promise<{
    output: unknown;
    tier_assigned: "tier_1" | "tier_2" | "tier_3";
    latency_ms: number;
    cost_usd: number;
  }>;
}

function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class StubCandidateClient implements ICandidateClient {
  async call(args: {
    call_site: CallSiteDescriptor;
    input: SyntheticInput;
  }): Promise<{
    output: unknown;
    tier_assigned: "tier_1" | "tier_2" | "tier_3";
    latency_ms: number;
    cost_usd: number;
  }> {
    const t0 = performance.now();
    const baseOutput = stubFrontierOutput(args.call_site, args.input.payload);
    // Tier assignment from static-prior pill — green→T1, yellow→T2, red→T3.
    const tier_assigned: "tier_1" | "tier_2" | "tier_3" =
      args.call_site.priors.pill === "green"
        ? "tier_1"
        : args.call_site.priors.pill === "yellow"
          ? "tier_2"
          : "tier_3";
    // Inject deterministic divergence keyed by input_id, modeling reality:
    //   - tier_1 (greens): perfectly deterministic. Codified TS function will
    //     match exactly on the holdout — that's the whole point of tier 1.
    //   - tier_2 (yellows): ~5% paraphrase variance (small Phi model drift).
    //     Caught by the embedding-cosine gate ≥0.92, not JSON-equality.
    //   - tier_3 (reds): high shape variance to model creative-task output
    //     drift — Stage-2 gate should reject these.
    const h = hash32(args.input.input_id);
    let output = baseOutput;
    if (tier_assigned === "tier_3") {
      const r = h % 100;
      if (r < 30) output = String(baseOutput ?? "").slice(0, 50);
      else if (r < 50) output = { text: String(baseOutput ?? ""), length: r };
      else if (r < 70) output = [String(baseOutput ?? "")];
      else if (r < 80) output = null;
      // else keep baseOutput
    } else if (tier_assigned === "tier_2" && (h % 100) < 5) {
      if (typeof baseOutput === "object" && baseOutput !== null && !Array.isArray(baseOutput)) {
        const obj = { ...(baseOutput as Record<string, unknown>) };
        if ("confidence" in obj && typeof obj.confidence === "number") {
          obj.confidence = Math.max(0, Math.min(1, obj.confidence - 0.1));
        }
        output = obj;
      }
    }
    const latency_ms = performance.now() - t0;
    const cost_usd = tier_assigned === "tier_1" ? 0 : tier_assigned === "tier_2" ? 0.0001 : 0.05;
    return { output, tier_assigned, latency_ms, cost_usd };
  }
}
