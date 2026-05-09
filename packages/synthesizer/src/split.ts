/**
 * Deterministic train/val/holdout split keyed by cluster_id.
 * Same cluster always produces the same split, so re-issuing a synthesis
 * spec for a cluster does not leak the holdout via different shuffles.
 */

function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Mulberry32 — deterministic PRNG seeded from a 32-bit int. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Split {
  train: number[];
  val: number[];
  holdout: number[];
}

export function splitIndices(
  count: number,
  cluster_id: string,
  ratios: { train: number; val: number; holdout: number } = {
    train: 0.7,
    val: 0.15,
    holdout: 0.15,
  },
): Split {
  const indices = Array.from({ length: count }, (_, i) => i);
  const rng = mulberry32(hash32(cluster_id));
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j]!, indices[i]!];
  }
  const trainEnd = Math.floor(count * ratios.train);
  const valEnd = trainEnd + Math.floor(count * ratios.val);
  return {
    train: indices.slice(0, trainEnd),
    val: indices.slice(trainEnd, valEnd),
    holdout: indices.slice(valEnd),
  };
}
