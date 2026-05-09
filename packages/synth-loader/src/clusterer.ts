import type { OnlineCluster } from "@compile/schemas";

/**
 * Online clusterer: streams output shape signatures and groups them.
 *
 * Real impl uses mini-batch k-means on output embeddings (DESIGN.md). For
 * the hackathon this is a single-pass shape-signature grouper — same
 * downstream contract (OnlineCluster[]), no external embedding service.
 * The visual grid still color-codes and surfaces N clusters in real time.
 */
export class OnlineClusterer {
  private readonly buckets = new Map<
    string,
    { ids: string[]; modal_output_shape: string }
  >();
  private total = 0;

  add(input_id: string, output: unknown): string {
    const sig = shapeSignature(output);
    const existing = this.buckets.get(sig);
    if (existing) {
      existing.ids.push(input_id);
    } else {
      this.buckets.set(sig, { ids: [input_id], modal_output_shape: sig });
    }
    this.total++;
    return sig;
  }

  snapshot(maxClusters: number = 50): OnlineCluster[] {
    const all = Array.from(this.buckets.entries())
      .map(([sig, v], i) => ({
        cluster_id: `cl_${sig.slice(0, 8) || "empty"}_${i}`,
        centroid: [], // signature-based clustering has no numeric centroid
        member_count: v.ids.length,
        share: this.total === 0 ? 0 : v.ids.length / this.total,
        modal_output_shape: v.modal_output_shape,
      }))
      .sort((a, b) => b.member_count - a.member_count)
      .slice(0, maxClusters);
    return all;
  }

  size(): number {
    return this.buckets.size;
  }
}

export function shapeSignature(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) {
    if (v.length === 0) return "array<empty>";
    const inner = Array.from(new Set(v.slice(0, 5).map(shapeSignature))).sort();
    return `array<${inner.join("|")}>`;
  }
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `obj{${keys.map((k) => `${k}:${shapeSignature(obj[k])}`).join(",")}}`;
  }
  return typeof v;
}
