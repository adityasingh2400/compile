import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Trace } from "@compile/schemas";

/** Walk up from this file to find the workspace root (containing node_modules/.bin/vitest). */
async function findVitestBin(): Promise<string> {
  let cur = dirname(fileURLToPath(import.meta.url));
  const root = parse(cur).root;
  while (cur !== root) {
    const candidate = resolve(cur, "node_modules/.bin/vitest");
    try {
      await stat(candidate);
      return candidate;
    } catch {
      cur = dirname(cur);
    }
  }
  throw new Error("vitest binary not found in any parent node_modules/.bin");
}

export interface RunHoldoutArgs {
  /** Body of the agent-emitted TS function — full file contents. */
  code: string;
  /** Function name exported by `code`. */
  function_name: string;
  /** Holdout traces Compile kept private. */
  holdout: Trace[];
  /** Optional: agent-emitted Vitest cases (smoke). */
  emitted_tests?: string;
  /** Override the working directory (used by tests). */
  cwd?: string;
  /** Match strategy applied to each holdout trace. */
  matcher?: "json_equality" | "embedding_cosine_stub";
}

export interface HoldoutRunResult {
  match_rate: number;
  total: number;
  passed: number;
  failures: Array<{ index: number; reason: string }>;
  emitted_tests_passed?: boolean;
  /** True if any code path called llmFallback during the holdout run. */
  fallback_invoked: boolean;
}

const HARNESS_RUNTIME = `
// Injected by Compile gate. Any call to llmFallback during the holdout run
// is treated as an uncovered branch — the gate records it and fails the trace.
let __fallbackCalls = 0;
export function llmFallback(_input: unknown, _name: string): never {
  __fallbackCalls++;
  throw new Error("GATE_FAIL: llmFallback invoked on holdout — uncovered branch");
}
export function __fallbackCallCount(): number { return __fallbackCalls; }
`;

function holdoutTestSource(opts: {
  function_name: string;
  matcher: "json_equality" | "embedding_cosine_stub";
  holdout: Trace[];
}): string {
  const traces = JSON.stringify(opts.holdout);
  return `
import { describe, it, expect } from "vitest";
import { ${opts.function_name} } from "./code";
import { __fallbackCallCount } from "./_runtime";

const HOLDOUT = ${traces} as Array<{ input: unknown; output: unknown }>;

function jsonEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Tier-2 cosine matcher is stubbed to a normalized-string compare for now;
// real embedding cosine arrives via Lane B / derisk #4.
function looseEqual(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => JSON.stringify(v ?? null).toLowerCase().replace(/\\s+/g, " ").trim();
  return norm(a) === norm(b);
}

const matcher = ${JSON.stringify(opts.matcher)} === "json_equality" ? jsonEqual : looseEqual;

describe("holdout gate", () => {
  HOLDOUT.forEach((trace, i) => {
    it(\`trace #\${i}\`, async () => {
      const result = await ${opts.function_name}(trace.input as never);
      expect(matcher(result, trace.output)).toBe(true);
    });
  });
  it("no llmFallback calls on holdout", () => {
    expect(__fallbackCallCount()).toBe(0);
  });
});
`;
}

interface VitestJsonReport {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  testResults: Array<{
    assertionResults: Array<{
      title: string;
      status: "passed" | "failed" | "skipped";
      failureMessages: string[];
    }>;
  }>;
}

export async function runHoldout(args: RunHoldoutArgs): Promise<HoldoutRunResult> {
  const matcher = args.matcher ?? "json_equality";
  const dir = await mkdtemp(join(args.cwd ?? tmpdir(), "compile-gate-"));
  try {
    await writeFile(join(dir, "_runtime.ts"), HARNESS_RUNTIME);
    await writeFile(join(dir, "code.ts"), args.code);
    await writeFile(
      join(dir, "holdout.test.ts"),
      holdoutTestSource({
        function_name: args.function_name,
        matcher,
        holdout: args.holdout,
      }),
    );
    if (args.emitted_tests) {
      await writeFile(join(dir, "emitted.test.ts"), args.emitted_tests);
    }
    const report = await runVitest(dir);
    const holdoutFile = report.testResults.find((r) =>
      r.assertionResults.some((a) => a.title.startsWith("trace #") || a.title.includes("llmFallback")),
    );
    const failures: Array<{ index: number; reason: string }> = [];
    let traceTotal = 0;
    let tracePassed = 0;
    let fallbackInvoked = false;
    if (holdoutFile) {
      for (const a of holdoutFile.assertionResults) {
        if (a.title.startsWith("trace #")) {
          traceTotal++;
          if (a.status === "passed") tracePassed++;
          else
            failures.push({
              index: parseInt(a.title.replace("trace #", ""), 10),
              reason: a.failureMessages.join("\n").slice(0, 400),
            });
        }
        if (a.title.includes("llmFallback")) {
          fallbackInvoked = a.status !== "passed";
        }
      }
    }
    const match_rate = traceTotal === 0 ? 0 : tracePassed / traceTotal;
    let emitted_tests_passed: boolean | undefined;
    if (args.emitted_tests) {
      emitted_tests_passed = report.testResults.some((r) =>
        r.assertionResults.some((a) => !a.title.startsWith("trace #") && !a.title.includes("llmFallback") && a.status === "passed"),
      );
    }
    return {
      match_rate,
      total: traceTotal,
      passed: tracePassed,
      failures,
      emitted_tests_passed,
      fallback_invoked: fallbackInvoked,
    };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function runVitest(cwd: string): Promise<VitestJsonReport> {
  const bin = await findVitestBin();
  return new Promise((res, reject) => {
    const proc = spawn(
      bin,
      ["run", "--reporter=json", "--no-color", "--root", cwd],
      { cwd, env: { ...process.env, CI: "1" } },
    );
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (b) => (stdout += b.toString()));
    proc.stderr.on("data", (b) => (stderr += b.toString()));
    proc.on("error", reject);
    proc.on("close", () => {
      const jsonStart = stdout.indexOf("{");
      const jsonEnd = stdout.lastIndexOf("}");
      if (jsonStart < 0 || jsonEnd < 0) {
        reject(
          new Error(
            `vitest produced no JSON report.\nstderr:\n${stderr}\nstdout:\n${stdout}`,
          ),
        );
        return;
      }
      try {
        const report = JSON.parse(stdout.slice(jsonStart, jsonEnd + 1));
        res(report as VitestJsonReport);
      } catch (e) {
        reject(new Error(`vitest JSON parse failed: ${(e as Error).message}`));
      }
    });
  });
}
