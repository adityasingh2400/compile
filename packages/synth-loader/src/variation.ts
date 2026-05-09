import type { SyntheticInput } from "@compile/schemas";

/**
 * Programmatic variation knobs (D12). Expand N seeds → target_count inputs
 * via field substitution + numeric perturbation + optional inclusion +
 * surface-form paraphrase. Variation is deterministic (seeded RNG) so demo
 * runs are reproducible.
 */
export interface VariationOptions {
  target_count: number;
  /** Deterministic seed string — typically the call_site_id. */
  rng_seed: string;
}

function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

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

const STRING_TWEAKS = [
  (s: string) => s,
  (s: string) => s.toLowerCase(),
  (s: string) => s.toUpperCase(),
  (s: string) => `${s}.`,
  (s: string) => s.replace(/\s+/g, " ").trim(),
];

export function expandSeeds(
  seeds: SyntheticInput[],
  opts: VariationOptions,
): SyntheticInput[] {
  if (seeds.length === 0) return [];
  const rng = mulberry32(hash32(opts.rng_seed));
  const out: SyntheticInput[] = [];
  // Always include the original seeds first so the un-perturbed inputs are
  // present (oracle can compare candidate vs frontier on them).
  for (const s of seeds) out.push(s);

  let i = out.length;
  while (out.length < opts.target_count) {
    const base = seeds[i % seeds.length]!;
    const variant = perturb(base.payload, rng);
    out.push({
      input_id: `${base.call_site_id}_var_${i}`,
      call_site_id: base.call_site_id,
      origin: `${base.origin}:variant_${i}`,
      payload: variant,
    });
    i++;
  }
  return out.slice(0, opts.target_count);
}

function perturb(payload: unknown, rng: () => number): unknown {
  if (payload === null || payload === undefined) return payload;
  if (typeof payload === "number") {
    const jitter = 0.7 + rng() * 0.6; // ±30%
    if (Number.isInteger(payload)) return Math.max(0, Math.round(payload * jitter));
    return Math.round(payload * jitter * 100) / 100;
  }
  if (typeof payload === "string") {
    const tweak = STRING_TWEAKS[Math.floor(rng() * STRING_TWEAKS.length)]!;
    return tweak(payload);
  }
  if (typeof payload === "boolean") return rng() < 0.5 ? !payload : payload;
  if (Array.isArray(payload)) return payload.map((v) => perturb(v, rng));
  if (typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      // Optional-field knob: occasionally drop a field (5% chance, but never
      // drop the only field).
      const keys = Object.keys(obj);
      if (keys.length > 1 && rng() < 0.05) continue;
      out[k] = perturb(v, rng);
    }
    return out;
  }
  return payload;
}
