/**
 * mulberry32 — small, fast, seeded PRNG. We need determinism for the axis
 * pipeline: same (schema, seed) must always produce the same inputs so
 * schema_stability and determinism scores are reproducible across runs.
 */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  /** [0, 1) */
  float(): number;
  /** [min, max] integer, both inclusive. */
  int(min: number, max: number): number;
  pick<T>(arr: readonly T[]): T;
  /** Bernoulli with given probability of returning true. */
  bool(p?: number): boolean;
}

export function rngFromSeed(seed: number): Rng {
  const r = mulberry32(seed);
  return {
    float: r,
    int: (min, max) => Math.floor(r() * (max - min + 1)) + min,
    pick: (arr) => {
      if (arr.length === 0) throw new Error("Rng.pick: empty array");
      return arr[Math.floor(r() * arr.length)] as (typeof arr)[number];
    },
    bool: (p = 0.5) => r() < p,
  };
}
