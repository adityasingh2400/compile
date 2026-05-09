import { transformSync } from "esbuild";

/**
 * Tier-1 in-process executor. Compiles emitted TS to JS once via esbuild,
 * caches the resulting function by function_id, executes in ~1ms.
 *
 * Trust model: code MUST have already passed the gate (≥98% holdout match,
 * Zod-validated envelope, llmFallback-on-uncovered-branch). Vault entries
 * are the only valid source for code passed here.
 */

type CompiledFn = (input: unknown) => unknown | Promise<unknown>;

const cache = new Map<string, CompiledFn>();

const FALLBACK_PRELUDE = `
function llmFallback(_input, _name) {
  throw new Error("RUNTIME_FALLBACK: llmFallback invoked at runtime — should escalate to Tier 3");
}
`;

export function compileFunction(args: {
  function_id: string;
  function_name: string;
  code: string;
}): CompiledFn {
  const cached = cache.get(args.function_id);
  if (cached) return cached;

  // Strip the agent's `import { llmFallback } from ...` (any path) — we inject
  // our own implementation so emitted code is single-file, deps-free.
  const stripped = args.code.replace(
    /import\s*\{[^}]*llmFallback[^}]*\}\s*from\s*['"][^'"]+['"]\s*;?/g,
    "",
  );

  const prelude = `${FALLBACK_PRELUDE}\nlet __exported;\n`;
  const exportCapture = `\n__exported = typeof ${args.function_name} === "function" ? ${args.function_name} : undefined;\nreturn __exported;`;
  const wrapped = `${prelude}${stripped.replace(/\bexport\s+(async\s+)?function\b/g, "$1function")}${exportCapture}`;

  const transpiled = transformSync(wrapped, {
    loader: "ts",
    format: "cjs",
    target: "node20",
    logLevel: "silent",
  }).code;

  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(transpiled) as () => CompiledFn | undefined;
  const fn = factory();
  if (typeof fn !== "function") {
    throw new Error(
      `compileFunction: emitted code did not export ${args.function_name}`,
    );
  }
  cache.set(args.function_id, fn);
  return fn;
}

export interface RunResult {
  output: unknown;
  latency_ms: number;
  cost_usd: number;
  tier_used: "tier_1" | "tier_2";
}

export async function runCodified(args: {
  function_id: string;
  function_name: string;
  code: string;
  input: unknown;
  tier: "tier_1" | "tier_2";
}): Promise<RunResult> {
  const fn = compileFunction({
    function_id: args.function_id,
    function_name: args.function_name,
    code: args.code,
  });
  const t0 = performance.now();
  const output = await fn(args.input);
  const latency_ms = performance.now() - t0;
  const cost_usd = args.tier === "tier_1" ? 0.0001 : 0.0005;
  return { output, latency_ms, cost_usd, tier_used: args.tier };
}

export function clearCompileCache(): void {
  cache.clear();
}
