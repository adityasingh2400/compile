/**
 * Minimal JSON-Schema-aware value generator. Covers what real customer
 * input schemas use in practice: primitive types, enums, arrays, nested
 * objects, optionals via `required`, examples-as-pool. Deliberately does
 * NOT support $ref, oneOf/anyOf/allOf, or pattern — those don't appear in
 * the 3 demo clusters and would balloon scope.
 *
 * Used by the identification pipeline (D10) to probe schema_stability
 * and determinism axes by generating N varied inputs per cluster template.
 */

import type { Rng } from "./rng.js";

export interface JsonSchema {
  type?: string | string[];
  enum?: unknown[];
  examples?: unknown[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  default?: unknown;
}

const WORDS = [
  "Acme",
  "Globex",
  "Initech",
  "Umbrella",
  "Wayne",
  "Stark",
  "Hooli",
  "Pied Piper",
  "Soylent",
  "Massive Dynamic",
  "Cyberdyne",
  "Tyrell",
  "Wonka",
  "Oscorp",
  "Yoyodyne",
  "Vandelay",
];
const INDUSTRIES = [
  "industrial automation",
  "fintech",
  "healthcare SaaS",
  "logistics",
  "consumer mobile",
  "developer tools",
  "biotech",
  "education",
];
const SIGNALS = [
  "downloaded our pricing page twice in 3 days",
  "joined our Slack community last week",
  "came inbound from a partner referral",
  "abandoned signup at the billing step",
  "matched 3 of 5 ICP attributes via enrichment",
  "requested a demo via the website form",
];
const SIZES = ["12 employees", "47 employees", "120 employees", "350 employees", "1,200 employees"];

export function fuzzFromSchema(schema: JsonSchema, rng: Rng): unknown {
  if (schema.examples && schema.examples.length > 0 && rng.bool(0.4)) {
    return rng.pick(schema.examples);
  }
  if (schema.enum && schema.enum.length > 0) {
    return rng.pick(schema.enum);
  }
  const type = Array.isArray(schema.type) ? rng.pick(schema.type) : schema.type;
  switch (type) {
    case "string":
      return fuzzString(schema, rng);
    case "integer":
      return rng.int(schema.minimum ?? 0, schema.maximum ?? 1000);
    case "number": {
      const min = schema.minimum ?? 0;
      const max = schema.maximum ?? 1;
      return min + rng.float() * (max - min);
    }
    case "boolean":
      return rng.bool();
    case "array":
      return fuzzArray(schema, rng);
    case "object":
      return fuzzObject(schema, rng);
    case "null":
      return null;
    default:
      // No type declared — best effort: walk properties if present, else string.
      if (schema.properties) return fuzzObject(schema, rng);
      return fuzzString(schema, rng);
  }
}

function fuzzString(schema: JsonSchema, rng: Rng): string {
  // Heuristic: schema fragments that look like names/industries/signals get
  // domain-pool values via the property name (handled in fuzzObject). Bare
  // strings fall back to a short pool of safe placeholders.
  const pool = [...WORDS, ...INDUSTRIES, ...SIGNALS, ...SIZES];
  const min = schema.minLength ?? 1;
  const max = schema.maxLength ?? 80;
  const candidate = rng.pick(pool);
  if (candidate.length < min) return candidate.padEnd(min, ".");
  if (candidate.length > max) return candidate.slice(0, max);
  return candidate;
}

function fuzzArray(schema: JsonSchema, rng: Rng): unknown[] {
  const min = schema.minItems ?? 0;
  const max = schema.maxItems ?? 4;
  const n = rng.int(min, max);
  const items: unknown[] = [];
  if (!schema.items) return items;
  for (let i = 0; i < n; i++) items.push(fuzzFromSchema(schema.items, rng));
  return items;
}

function fuzzObject(schema: JsonSchema, rng: Rng): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? Object.keys(props));
  for (const [key, child] of Object.entries(props)) {
    if (!required.has(key) && rng.bool(0.3)) continue;
    out[key] = fuzzPropertyAware(key, child, rng);
  }
  return out;
}

/**
 * Property-name-aware string fuzzing. If the schema property is named
 * "company" or "industry", pull from the matching pool — produces inputs
 * that look like real customer data, not random word salad.
 */
function fuzzPropertyAware(name: string, schema: JsonSchema, rng: Rng): unknown {
  if (schema.type === "string" && !schema.enum && !schema.examples) {
    const lower = name.toLowerCase();
    if (lower.includes("company") || lower === "name") return rng.pick(WORDS);
    if (lower.includes("industry") || lower.includes("vertical"))
      return rng.pick(INDUSTRIES);
    if (lower.includes("signal") || lower.includes("event"))
      return rng.pick(SIGNALS);
    if (lower.includes("size") || lower.includes("headcount"))
      return rng.pick(SIZES);
  }
  return fuzzFromSchema(schema, rng);
}
