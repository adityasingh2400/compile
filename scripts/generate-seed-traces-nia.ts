/**
 * Generate seed proxy traces for the nia-bench demo.
 *
 * (Sibling of `generate-seed-traces.ts` which is the Folk demo. Both
 *  write the same `data/proxy-traces.jsonl` + summary; whichever you
 *  ran last drives the UI. To switch demos:
 *    npx tsx scripts/generate-seed-traces.ts        ← Folk
 *    npx tsx scripts/generate-seed-traces-nia.ts    ← nia-bench)
 *
 * THEME — Compile audits Nozomio's own publicly-shipped repo
 *   `https://github.com/nozomio-labs/nia-bench`
 *
 * The scanner walks `data/nia-bench/src/` and finds **one physical
 * LLM call site** at `src/judge/openrouter-client.ts:70`:
 *
 *   await client.chat.completions.create({ model, temperature: 0, ... })
 *
 * BUT — and this is the punchline — that one call site evaluates ~5
 * rubric criteria per invocation, and across the 40 benchmark tasks
 * there are **201 total criterion evaluations** falling into 8
 * recurring archetypes. Compile splits the single physical site into
 * its 8 logical sub-workflows and codifies each independently.
 *
 *   GREEN  ──────────────────────────────────────────────────────────
 *     judge_no_hallucination          (29/40 tasks · pure pattern match
 *                                       against task.common_hallucinations)
 *     judge_correct_replacements      (8/40 tasks · regex-driven
 *                                       migration check)
 *     judge_correct_import            (4/40 tasks · AST scan, no LLM
 *                                       needed at all)
 *
 *   YELLOW (T2 phi-3-mini) ──────────────────────────────────────────
 *     judge_correct_api_usage         (bounded API surface ·
 *                                       AST + phi for context)
 *     judge_correct_alternatives      (migration audit · phi for
 *                                       open replacements)
 *
 *   RED (frontier residuals) ────────────────────────────────────────
 *     judge_overall_quality            (one-off task-specific criteria)
 *     apply_majority_vote_disagreement (when 3 judges disagree)
 *     classify_hallucination_complex   (novel hallucinations beyond
 *                                       the known list)
 *
 * Note: `nia-bench/src/judge/hallucination-classifier.ts` is ALREADY
 * rule-based for some patterns. The audit reads this as evidence that
 * Nozomio themselves are halfway codified — Compile just factors the
 * same approach across the rest of the rubric.
 *
 *   npx tsx scripts/generate-seed-traces-nia.ts
 */

import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

type Trace = {
  ts: string;
  call_site_hash: string;
  model: string;
  provider: "openai" | "anthropic";
  system_prompt: string;
  system_prompt_hash: string;
  user_prompt: string;
  response: string;
  response_tokens: number;
  latency_ms: number;
  cost_usd: number;
};

type SiteSpec = {
  fn: string;
  count: number;
  provider: "openai" | "anthropic";
  model: string;
  system: string;
  inputs: string[];
  responder: (input: string) => string;
  baseLatency: number;
  tokenCost: number;
};

const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const pick = <T>(arr: T[], i: number): T => arr[i % arr.length]!;
const jitter = (base: number, spread: number) => base + Math.floor(Math.random() * spread);

/* ════════════════════════════════════════════════════════════════════
 * Real-shaped fixtures pulled from `data/nia-bench/tasks/*.json`.
 * Every input below is a real or near-real input the judge sees in
 * production — known hallucination patterns, real import specifiers,
 * real migration archetypes from Next.js / React / tRPC / Zod / AI SDK.
 * ════════════════════════════════════════════════════════════════════ */

// ── judge_no_hallucination · 29/40 tasks ─────────────────────────────
// Inputs: (library × known_hallucination_pattern × generated_code).
// The code either contains a known bad pattern or is clean.
const NO_HALLUCINATION_INPUTS = [
  "lib: next@16\npattern: \"export function middleware(request: NextRequest)\"\ncode: \"export function middleware(req: NextRequest) { ... }\"",
  "lib: next@16\npattern: \"runtime: 'edge'\"\ncode: \"export const config = { runtime: 'edge' };\"",
  "lib: next@16\npattern: \"middleware.ts file\"\ncode: \"// proxy.ts\\nexport function proxy(req) {...}\"",
  "lib: trpc@11\npattern: \"createTRPCProxyClient\"\ncode: \"const trpc = createTRPCProxyClient<AppRouter>({...})\"",
  "lib: trpc@11\npattern: \"transformer at link level\"\ncode: \"createTRPCClient({ transformer: superjson, links: [httpBatchLink({})]})\"",
  "lib: trpc@11\npattern: \"@trpc/react-query import\"\ncode: \"import { createTRPCClient } from '@trpc/client';\"",
  "lib: react@19\npattern: \"React.forwardRef wrapper\"\ncode: \"const Input = forwardRef<HTMLInputElement, Props>((props, ref) => ...)\"",
  "lib: react@19\npattern: \"useFormState (renamed)\"\ncode: \"const [state, action] = useFormState(reducer, init);\"",
  "lib: zod@4\npattern: \"z.string().email() chained\"\ncode: \"const schema = z.string().email();\"",
  "lib: zod@4\npattern: \"z.string().ip()\"\ncode: \"const schema = z.string().ip();\"",
  "lib: zod@4\npattern: \"z.uuidv4()\"\ncode: \"const schema = z.uuidv4();\"",
  "lib: zod@4\npattern: \"z.string().uuid()\"\ncode: \"const schema = z.string().uuid();\"",
  "lib: ai@6\npattern: \"generateObject({ schema })\"\ncode: \"const { object } = await generateObject({ model, schema });\"",
  "lib: ai@6\npattern: \"experimental_output parameter\"\ncode: \"const r = await generateText({ model, experimental_output: ... });\"",
  "lib: ai@6\npattern: \"destructure { object }\"\ncode: \"const { object } = await generateText({ model, output: Output.object({schema}) });\"",
  "lib: next@16\npattern: \"sync params access\"\ncode: \"export default function Page({ params }: { params: { id: string } }) { return params.id; }\"",
  "lib: next@16\npattern: \"clean — proxy.ts with proxy()\"\ncode: \"export function proxy(req: NextRequest) { return NextResponse.next(); }\"",
  "lib: react@19\npattern: \"clean — ref as prop\"\ncode: \"export function Input({ ref, ...props }: { ref?: Ref<HTMLInputElement> }) { return <input ref={ref} />; }\"",
  "lib: zod@4\npattern: \"clean — top-level z.email()\"\ncode: \"const schema = z.email();\"",
  "lib: ai@6\npattern: \"clean — Output.object()\"\ncode: \"const { output } = await generateText({ model, output: Output.object({schema}) });\"",
];

// ── judge_correct_replacements · 8/40 tasks ─────────────────────────
// Audit-style migration tasks: identify v_old patterns and propose
// v_new replacements. Input: code containing legacy patterns.
const REPLACEMENT_INPUTS = [
  "task: \"Migrate this trpc v10 code to v11\"\ncode: \"import { createTRPCProxyClient, wsLink, splitLink } from '@trpc/client';\"",
  "task: \"Update this Next.js 13 page to 16\"\ncode: \"export default function Page({ params }) { return params.id; }\"",
  "task: \"Migrate AI SDK v5 to v6\"\ncode: \"const { object } = await generateObject({ model, schema });\"",
  "task: \"Audit this React 18 form\"\ncode: \"const [state, action] = useFormState(reducer, init);\"",
  "task: \"Identify Zod v3 → v4 issues\"\ncode: \"z.string().email().min(5); z.string().uuid(); z.string().ip();\"",
  "task: \"Audit this Next.js middleware\"\ncode: \"// middleware.ts\\nexport function middleware(req: NextRequest) { ... }\"",
  "task: \"Migrate trpc subscription\"\ncode: \"return observable(emit => { ws.on('message', m => emit.next(m)); });\"",
  "task: \"Audit this React.forwardRef component\"\ncode: \"const Btn = React.forwardRef<HTMLButtonElement, Props>((props, ref) => <button ref={ref}/>);\"",
];

// ── judge_correct_import · 4/40 tasks ───────────────────────────────
// Pure import path validation. AST-checkable.
const IMPORT_INPUTS = [
  "expected: createTRPCClient from '@trpc/client'\ncode: \"import { createTRPCClient } from '@trpc/client';\"",
  "expected: createTRPCClient from '@trpc/client'\ncode: \"import { createTRPCClient } from '@trpc/react-query';\"",
  "expected: createRoot from 'react-dom/client'\ncode: \"import { createRoot } from 'react-dom/client';\"",
  "expected: createRoot from 'react-dom/client'\ncode: \"import ReactDOM from 'react-dom';\"",
  "expected: Output from 'ai'\ncode: \"import { generateText, Output } from 'ai';\"",
  "expected: Output from 'ai'\ncode: \"import { generateText } from 'ai'; // Output not imported\"",
  "expected: useActionState from 'react'\ncode: \"import { useActionState } from 'react';\"",
  "expected: useActionState from 'react'\ncode: \"import { useFormState } from 'react'; // wrong v18 name\"",
  "expected: ToolLoopAgent from 'ai'\ncode: \"import { ToolLoopAgent } from 'ai';\"",
  "expected: ToolLoopAgent from 'ai'\ncode: \"import { Experimental_Agent } from 'ai'; // wrong v5 name\"",
];

// ── judge_correct_api_usage · 2 tasks (yellow tier) ─────────────────
const API_USAGE_INPUTS = [
  "lib: next@16\nexpected: NextResponse, NextRequest, cookies(), redirect()\ncode: \"return NextResponse.redirect(new URL('/login', req.url));\"",
  "lib: next@16\nexpected: NextResponse, NextRequest, cookies(), matcher\ncode: \"export const config = { matcher: ['/dashboard/:path*'] };\"",
  "lib: next@16\nexpected: cookies() awaited\ncode: \"const cookieStore = cookies(); cookieStore.get('session');\"",
  "lib: next@16\nexpected: request.cookies.get\ncode: \"const session = req.cookies.get('session')?.value;\"",
  "lib: trpc@11\nexpected: httpSubscriptionLink (not wsLink)\ncode: \"links: [httpSubscriptionLink({ url: '/api/trpc' })]\"",
  "lib: trpc@11\nexpected: async generator subscription\ncode: \"async function* messages(input) { for await (const m of source) yield m; }\"",
];

// ── judge_correct_alternatives · 2 tasks (yellow tier) ──────────────
const ALTERNATIVES_INPUTS = [
  "task: \"Audit this React 17 component & propose replacements\"\nfindings: [\"forwardRef wrapper\", \"ReactDOM.render usage\", \"defaultProps on FC\"]",
  "task: \"Audit this Next.js 13 page & propose 16 replacements\"\nfindings: [\"sync params\", \"middleware.ts file name\", \"runtime: edge config\"]",
  "task: \"Audit AI SDK v5 → v6 replacements\"\nfindings: [\"generateObject\", \"experimental_output\", \"DataStream class\"]",
];

// ── frontier residuals ──────────────────────────────────────────────
const OVERALL_QUALITY_INPUTS = [
  "task: react-19-use-hook\ngenerated_code: <90 lines>\nrubric: overall_quality_holistic",
  "task: nextjs-16-cache-components\ngenerated_code: <140 lines>\nrubric: cache_directive_correctness_holistic",
  "task: trpc-11-shorthand-streaming\ngenerated_code: <70 lines>\nrubric: shorthand_router_idiomatic",
];

const MAJORITY_VOTE_INPUTS = [
  "criterion: correct_typing\nverdicts: [PASS, FAIL, PASS]\nevidence_disagreement: high",
  "criterion: no_hallucination\nverdicts: [FAIL, PASS, FAIL]\nevidence_disagreement: medium",
];

const COMPLEX_HALLUCINATION_INPUTS = [
  "novel_pattern: \"using `use server` directive in client component\"",
  "novel_pattern: \"mixing v5 streaming with v6 Output API\"",
];

/* ════════════════════════════════════════════════════════════════════
 * SITE LIST — 8 logical workflows hidden inside one physical call site.
 *
 * Volume targets per 24h sample (extrapolates to ~1,800 judge calls
 * per benchmark run × ~30 runs/month with weekly cron + per-PR runs):
 *   ≥50 traces  → WILL_COMPILE   (T1 green)
 *   ≥20 traces  → BELOW_THRESHOLD (T2 yellow)
 *   <20 traces  → FRONTIER_ZONE  (red — audit shows them but rejects)
 * ════════════════════════════════════════════════════════════════════ */

const SITES: SiteSpec[] = [
  /* ─── GREEN · T1 codifiable ────────────────────────────────────── */

  /**
   * #1 GREEN — `no_hallucination` appears in 29 of 40 tasks. The
   * judge LLM is asked: "does this code contain any of these known
   * hallucination patterns?" That's literally a string-contains
   * check across `task.common_hallucinations[]`. Compile codifies as
   * a regex/AST scanner over the known-bad pattern list.
   */
  {
    fn: "judge_no_hallucination",
    count: 95,
    provider: "openai",
    model: "openai/gpt-5-mini",
    system:
      "Judge whether the generated code contains any known hallucination patterns. Return JSON {verdict: PASS|FAIL, evidence, reasoning}.",
    inputs: NO_HALLUCINATION_INPUTS,
    responder: (text) => {
      const isClean = /\bclean\b/i.test(text);
      const verdict = isClean ? "PASS" : "FAIL";
      const pattern = text.match(/pattern:\s*"([^"]+)"/)?.[1] ?? "";
      return JSON.stringify({
        verdict,
        evidence: isClean ? "no known hallucination patterns matched" : pattern,
        reasoning: isClean
          ? "code matches expected idiomatic shape for this version"
          : `lexical match on known-bad pattern: ${pattern}`,
      });
    },
    baseLatency: 1180,
    tokenCost: 0.012,
  },

  /**
   * #2 GREEN — `correct_replacements` appears in 8 audit tasks
   * (`version_locked_audit`). The judge identifies legacy patterns
   * and proposes the v_new replacements. Compile codifies as a
   * regex-driven migration map.
   */
  {
    fn: "judge_correct_replacements",
    count: 78,
    provider: "openai",
    model: "openai/gpt-5-mini",
    system:
      "Judge whether the candidate provides correct migration replacements for each identified legacy pattern. Return JSON {verdict, evidence, reasoning}.",
    inputs: REPLACEMENT_INPUTS,
    responder: (text) => {
      const t = text.toLowerCase();
      const correct = !/proxyclient|formstate|generateobject|forwardref|email\(\)|uuid\(\)|ip\(\)|middleware\.ts/.test(t);
      return JSON.stringify({
        verdict: correct ? "PASS" : "FAIL",
        evidence: correct ? "all replacements match v_new specification" : "legacy pattern detected in candidate",
        reasoning: correct
          ? "migration map covers all observed legacy patterns"
          : "candidate left v_old pattern unchanged",
      });
    },
    baseLatency: 1240,
    tokenCost: 0.013,
  },

  /**
   * #3 GREEN — `correct_import` appears in 4 tasks. Pure AST
   * import-path check. Compile codifies as a `ts-morph` scanner —
   * the existing `src/tests/ast-checker.ts` already has this exact
   * primitive (`import_exists`/`import_absent`); we just lift the
   * judgment out of the LLM.
   */
  {
    fn: "judge_correct_import",
    count: 62,
    provider: "openai",
    model: "openai/gpt-5-mini",
    system:
      "Judge whether the generated code imports from the correct module paths. Return JSON {verdict, evidence, reasoning}.",
    inputs: IMPORT_INPUTS,
    responder: (text) => {
      const expected = text.match(/expected:\s*([^\n]+)/)?.[1] ?? "";
      const codeLine = text.match(/code:\s*"([^"]+)"/)?.[1] ?? "";
      const [name, , from] = expected.split(/\s+/);
      const correct = codeLine.includes(name ?? "") && codeLine.includes(`'${from}'`);
      return JSON.stringify({
        verdict: correct ? "PASS" : "FAIL",
        evidence: codeLine.slice(0, 80),
        reasoning: correct
          ? `imports ${name} from ${from} as expected`
          : `expected import of ${name} from ${from} not found`,
      });
    },
    baseLatency: 1080,
    tokenCost: 0.011,
  },

  /* ─── YELLOW · T2 phi-3-mini fallback ─────────────────────────── */

  /**
   * #4 YELLOW — `correct_api_usage`. AST check covers ~70%; the
   * remaining 30% needs context (e.g. "is `cookies()` awaited where
   * it should be" requires control-flow awareness). Phi-3-mini
   * covers the long tail.
   */
  {
    fn: "judge_correct_api_usage",
    count: 38,
    provider: "openai",
    model: "openai/gpt-5-mini",
    system:
      "Judge whether the generated code uses the bounded API surface correctly. Return JSON {verdict, evidence, reasoning}.",
    inputs: API_USAGE_INPUTS,
    responder: (text) => {
      const t = text.toLowerCase();
      const correct = /nextresponse|httpsubscriptionlink|async function\*|await cookies/.test(t);
      return JSON.stringify({
        verdict: correct ? "PASS" : "FAIL",
        evidence: text.match(/code:\s*"([^"]+)"/)?.[1]?.slice(0, 80) ?? "",
        reasoning: correct
          ? "candidate uses expected version-correct API surface"
          : "candidate API call doesn't match expected pattern",
      });
    },
    baseLatency: 1320,
    tokenCost: 0.014,
  },

  /**
   * #5 YELLOW — `correct_alternatives`. Like correct_replacements
   * but for open-ended audit tasks where the migration map isn't
   * pre-specified. Phi-3-mini handles the structured-but-flexible
   * judgment.
   */
  {
    fn: "judge_correct_alternatives",
    count: 28,
    provider: "openai",
    model: "openai/gpt-5-mini",
    system:
      "Judge whether the candidate proposes correct alternatives for each finding. Return JSON {verdict, evidence, reasoning}.",
    inputs: ALTERNATIVES_INPUTS,
    responder: (text) => {
      const findings = text.match(/findings:\s*\[([^\]]+)\]/)?.[1] ?? "";
      const correct = findings.length > 0;
      return JSON.stringify({
        verdict: correct ? "PASS" : "FAIL",
        evidence: findings.slice(0, 80),
        reasoning: correct
          ? "candidate covers all identified findings with version-correct alternatives"
          : "candidate misses one or more findings",
      });
    },
    baseLatency: 1380,
    tokenCost: 0.015,
  },

  /* ─── RED · FRONTIER residuals (audit explicitly REJECTS) ────── */

  /**
   * RED · open-ended task-specific criteria. The 70+ one-off rubric
   * criteria that don't generalize across tasks. Frontier permanently.
   */
  {
    fn: "judge_overall_quality",
    count: 18,
    provider: "openai",
    model: "openai/gpt-5-mini",
    system:
      "Judge the overall quality of this generated code against the task-specific rubric. Return JSON {verdict, evidence, reasoning}.",
    inputs: OVERALL_QUALITY_INPUTS,
    responder: () =>
      JSON.stringify({
        verdict: "PASS",
        evidence: "code is idiomatic, types are precise, follows version-specific patterns end-to-end",
        reasoning: "holistic review across rubric weights yields >0.8 score",
      }),
    baseLatency: 1480,
    tokenCost: 0.018,
  },

  /**
   * RED · majority-vote disagreement resolution. When 3 judges
   * disagree on a borderline case, frontier reasoning is needed to
   * break the tie. Compile cannot codify this — the reasoning
   * surface is open-ended.
   */
  {
    fn: "apply_majority_vote_disagreement",
    count: 12,
    provider: "openai",
    model: "openai/gpt-5-mini",
    system: "",
    inputs: MAJORITY_VOTE_INPUTS,
    responder: () =>
      "Tie-break analysis: judge B's evidence cites a deprecation warning that judges A&C missed. Final verdict: FAIL.",
    baseLatency: 1620,
    tokenCost: 0.021,
  },

  /**
   * RED · novel hallucinations. Beyond the known-bad list, the LLM
   * still catches genuinely-new mistakes (combining v_old/v_new
   * patterns, using directives in wrong contexts, etc.) These by
   * definition can't be pre-codified.
   */
  {
    fn: "classify_hallucination_complex",
    count: 8,
    provider: "openai",
    model: "openai/gpt-5-mini",
    system: "",
    inputs: COMPLEX_HALLUCINATION_INPUTS,
    responder: () =>
      "Detected: cross-version contamination — mixing v5 DataStream with v6 Output API, neither will work. Type: future_api + outdated_api compound.",
    baseLatency: 1740,
    tokenCost: 0.024,
  },
];

function generate(): Trace[] {
  const traces: Trace[] = [];
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;

  for (const site of SITES) {
    const spHash = sha(site.system + ":" + site.fn);
    for (let i = 0; i < site.count; i++) {
      const userPrompt = pick(site.inputs, i + Math.floor(Math.random() * 7));
      const ts = new Date(dayAgo + Math.random() * (now - dayAgo)).toISOString();
      const response = site.responder(userPrompt);
      traces.push({
        ts,
        // The namespace `nia-bench` flows through derive-workflows.ts
        // → REPO_NAMESPACE / REPO_PATH so the audit chrome reads
        // "data/nia-bench" instead of "data/folk-agent".
        call_site_hash: `nia-bench:${site.fn}:v1`,
        model: site.model,
        provider: site.provider,
        system_prompt: site.system,
        system_prompt_hash: spHash,
        user_prompt: userPrompt,
        response,
        response_tokens: Math.ceil(response.length / 4),
        latency_ms: jitter(site.baseLatency, 400),
        cost_usd: site.tokenCost,
      });
    }
  }

  return traces.sort((a, b) => a.ts.localeCompare(b.ts));
}

function main() {
  const traces = generate();
  const outPath = "data/proxy-traces.jsonl";
  const summaryPath = "data/proxy-traces-summary.json";

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, traces.map((t) => JSON.stringify(t)).join("\n") + "\n");

  const buckets: Record<string, number> = {};
  for (const t of traces) buckets[t.call_site_hash] = (buckets[t.call_site_hash] ?? 0) + 1;

  const summary = {
    generated_at: new Date().toISOString(),
    total_traces: traces.length,
    threshold: 50,
    buckets: Object.fromEntries(
      Object.entries(buckets)
        .sort(([, a], [, b]) => b - a)
        .map(([k, v]) => [
          k,
          { count: v, status: v >= 50 ? "WILL_COMPILE" : v >= 20 ? "BELOW_THRESHOLD" : "FRONTIER_ZONE" },
        ])
    ),
    spend_usd: +traces.reduce((s, t) => s + t.cost_usd, 0).toFixed(2),
    timespan_hours: 24,
  };

  writeFileSync(summaryPath, JSON.stringify(summary, null, 2));

  console.log(`✓ wrote ${traces.length} traces to ${outPath}`);
  console.log(`✓ wrote summary to ${summaryPath}`);
  console.log(`\nbucket distribution:`);
  for (const [hash, info] of Object.entries(summary.buckets)) {
    const bar = "█".repeat(Math.round((info as { count: number }).count / 3));
    console.log(`  ${hash.padEnd(50)} ${String((info as { count: number }).count).padStart(3)}  ${bar}  ${(info as { status: string }).status}`);
  }
  console.log(`\ntotal seed spend: $${summary.spend_usd}  (24h sample · scales × 5000 to ~$${(summary.spend_usd * 5000 * 365).toFixed(0)}/yr at production traffic)`);
}

main();
