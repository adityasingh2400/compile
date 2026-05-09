import { Project, SyntaxKind, Node, type CallExpression, type SourceFile } from "ts-morph";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import {
  type CallSiteDescriptor,
  type ScanReport,
  type StaticPriorSignals,
} from "@compile/schemas";
import { priorsFromSignals } from "./priors.js";

const TS_EXTS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "build", ".next", ".git"]);

/**
 * Static AST scan over a TS repo (Stage 1, D11).
 *
 * Detects every call to:
 *   - <client>.messages.create(...)        (Anthropic)
 *   - <client>.chat.completions.create(..) (OpenAI)
 *
 * For each call site, computes the StaticPriorSignals from the argument
 * literal (response_format, temperature, prompt template, tools array,
 * few-shot heuristic) and returns a CallSiteDescriptor.
 */
export async function scanRepo(repoPath: string): Promise<ScanReport> {
  const root = resolve(repoPath);
  const tsFiles: string[] = [];
  await walk(root, tsFiles);

  const project = new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: false, noEmit: true },
  });
  for (const f of tsFiles) project.addSourceFileAtPath(f);

  const call_sites: CallSiteDescriptor[] = [];
  for (const sf of project.getSourceFiles()) {
    extractFromFile(sf, root, call_sites);
  }

  const tree_signature = await fingerprintTree(tsFiles);
  return {
    scanned_at: new Date().toISOString(),
    repo_path: root,
    files_scanned: tsFiles.length,
    call_sites,
    tree_signature,
  };
}

async function walk(dir: string, out: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    let st;
    try {
      st = await stat(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      await walk(full, out);
    } else if (st.isFile() && TS_EXTS.has(extname(full))) {
      out.push(full);
    }
  }
}

function extractFromFile(sf: SourceFile, root: string, out: CallSiteDescriptor[]): void {
  sf.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return;
    const call = node as CallExpression;
    const expr = call.getExpression();
    if (!Node.isPropertyAccessExpression(expr)) return;

    const accessChain = readAccessChain(expr);
    const provider = providerFor(accessChain);
    if (!provider) return;

    const arg = call.getArguments()[0];
    if (!arg || !Node.isObjectLiteralExpression(arg)) return;

    const signals = signalsFromArgs(arg);
    const priors = priorsFromSignals(signals);
    const start = call.getStart();
    const { line, column } = sf.getLineAndColumnAtPos(start);
    const filePath = relative(root, sf.getFilePath());
    const id = makeId(filePath, line, column);
    const promptExcerpt = excerptPrompt(arg) ?? accessChain.join(".");
    const fnHint = enclosingFunctionName(call);

    out.push({
      call_site_id: id,
      file_path: filePath,
      line,
      column,
      provider,
      function_hint: fnHint,
      prompt_excerpt: promptExcerpt.slice(0, 200),
      priors,
    });
  });
}

function readAccessChain(node: Node): string[] {
  const parts: string[] = [];
  let cur: Node | undefined = node;
  while (cur && Node.isPropertyAccessExpression(cur)) {
    parts.unshift(cur.getName());
    cur = cur.getExpression();
  }
  if (cur && Node.isIdentifier(cur)) parts.unshift(cur.getText());
  return parts;
}

function providerFor(chain: string[]): "anthropic" | "openai" | "mcp" | null {
  if (chain.length < 2) return null;
  const tail = chain.slice(-2).join(".");
  if (tail === "messages.create") return "anthropic";
  if (tail === "completions.create") return "openai";
  if (tail === "tools.call" || tail === "tools.use") return "mcp";
  return null;
}

function signalsFromArgs(arg: Node): StaticPriorSignals {
  const props = readObjectProps(arg);
  const has_response_format = !!props.response_format;
  const tempVal = props.temperature;
  const has_temperature_zero =
    tempVal !== undefined && tempVal !== null && Number(tempVal) === 0;
  const messages = props.messages_text ?? "";
  // Prompt is "static template" if all message contents are string literals or
  // template literals with no substitutions.
  const prompt_template_static = props.messages_static === true;
  const tools = props.tools_count ?? 0;
  const has_few_shot_examples = /role.*(user|assistant)/.test(messages) && messages.split("role").length > 3;
  const followed_by_structured_parse = !!props.parent_has_structured_parse;
  const has_zod_schema = !!props.parent_has_zod_parse;
  const has_telemetry = !!props.parent_has_logging;

  return {
    has_response_format,
    has_zod_schema,
    has_temperature_zero,
    prompt_template_static,
    bounded_tool_array: tools > 0 && tools <= 10,
    tool_count: tools,
    has_few_shot_examples,
    followed_by_structured_parse,
    has_telemetry,
  };
}

interface ReadProps {
  response_format?: boolean;
  temperature?: unknown;
  messages_text?: string;
  messages_static?: boolean;
  tools_count?: number;
  parent_has_structured_parse?: boolean;
  parent_has_zod_parse?: boolean;
  parent_has_logging?: boolean;
}

function readObjectProps(arg: Node): ReadProps {
  if (!Node.isObjectLiteralExpression(arg)) return {};
  const out: ReadProps = {};
  for (const p of arg.getProperties()) {
    if (!Node.isPropertyAssignment(p)) continue;
    const name = p.getName();
    const init = p.getInitializer();
    if (!init) continue;
    if (name === "response_format") out.response_format = true;
    else if (name === "temperature") out.temperature = readLiteral(init);
    else if (name === "messages") {
      out.messages_text = init.getText();
      out.messages_static = isStaticMessages(init);
    } else if (name === "tools") {
      if (Node.isArrayLiteralExpression(init)) out.tools_count = init.getElements().length;
    }
  }
  // Look at the enclosing function body for downstream usage signals.
  // Schema validation (`Foo.parse(...)`) usually happens on the next line as
  // `return SomeSchema.parse(JSON.parse(resp.content[0].text))` — so a
  // statement-level scan misses it. Function-level is the right granularity.
  const fnBody = findEnclosingFunctionBody(arg);
  if (fnBody) {
    const text = fnBody.getText();
    const hasZodImportLike = /\bz\b\.|Zod|Schema|schema/.test(text);
    out.parent_has_zod_parse = /\.parse\s*\(/.test(text) && hasZodImportLike;
    out.parent_has_structured_parse =
      /JSON\.parse\s*\(/.test(text) || out.parent_has_zod_parse;
    out.parent_has_logging = /console\.|logger\.|metrics\./.test(text);
  }
  return out;
}

function findEnclosingFunctionBody(node: Node): Node | undefined {
  let cur: Node | undefined = node;
  while (cur) {
    if (
      Node.isFunctionDeclaration(cur) ||
      Node.isMethodDeclaration(cur) ||
      Node.isFunctionExpression(cur) ||
      Node.isArrowFunction(cur)
    ) {
      return cur;
    }
    cur = cur.getParent();
  }
  return undefined;
}

function readLiteral(node: Node): unknown {
  if (Node.isNumericLiteral(node)) return Number(node.getText());
  if (Node.isStringLiteral(node)) return node.getLiteralText();
  if (node.getKind() === SyntaxKind.TrueKeyword) return true;
  if (node.getKind() === SyntaxKind.FalseKeyword) return false;
  return null;
}

function isStaticMessages(node: Node): boolean {
  // "Statically parameterized" per DESIGN.md: prompt assembled at compile
  // time from the function's args. Accepts string literals, template literals
  // (substitutions = slots), and identifier references (parameter passthrough).
  // Rejects runtime string concatenation and arbitrary expressions.
  if (!Node.isArrayLiteralExpression(node)) return false;
  return node.getElements().every((el) => {
    if (!Node.isObjectLiteralExpression(el)) return false;
    const content = el.getProperty("content");
    if (!content || !Node.isPropertyAssignment(content)) return false;
    const init = content.getInitializer();
    if (!init) return false;
    if (
      Node.isStringLiteral(init) ||
      Node.isNoSubstitutionTemplateLiteral(init) ||
      Node.isTemplateExpression(init) ||
      Node.isIdentifier(init)
    ) {
      return true;
    }
    return false;
  });
}

function enclosingFunctionName(call: CallExpression): string | undefined {
  // Prefer the named declaration that ENCLOSES the call (function/method/exported
  // const arrow). Walking up first into the variable that captures the *result*
  // of the call (`const resp = client.messages.create(...)`) yields "resp",
  // which is wrong. So we skip variable declarations whose initializer IS the
  // call itself, and we keep walking until we hit a function-scoped declaration.
  let cur: Node | undefined = call.getParent();
  while (cur) {
    if (Node.isFunctionDeclaration(cur)) return cur.getName();
    if (Node.isMethodDeclaration(cur)) return cur.getName();
    if (Node.isFunctionExpression(cur) || Node.isArrowFunction(cur)) {
      // Find the binding name (e.g., `const x = () => {}` or `export const x = async () => {}`).
      const parent = cur.getParent();
      if (parent && Node.isVariableDeclaration(parent)) return parent.getName();
    }
    cur = cur.getParent();
  }
  return undefined;
}

function excerptPrompt(arg: Node): string | undefined {
  if (!Node.isObjectLiteralExpression(arg)) return undefined;
  const sys = arg.getProperty("system");
  if (sys && Node.isPropertyAssignment(sys)) {
    const init = sys.getInitializer();
    if (init && Node.isStringLiteral(init)) return init.getLiteralText();
  }
  const msgs = arg.getProperty("messages");
  if (msgs && Node.isPropertyAssignment(msgs)) {
    const text = msgs.getInitializer()?.getText();
    if (text) return text.replace(/\s+/g, " ").slice(0, 200);
  }
  return undefined;
}

function makeId(file: string, line: number, col: number): string {
  const h = createHash("sha1").update(`${file}:${line}:${col}`).digest("hex").slice(0, 10);
  return `cs_${h}`;
}

async function fingerprintTree(files: string[]): Promise<string> {
  const h = createHash("sha1");
  for (const f of files.sort()) {
    try {
      const buf = await readFile(f);
      h.update(f);
      h.update("\n");
      h.update(buf);
      h.update("\n");
    } catch {
      /* ignore */
    }
  }
  return h.digest("hex").slice(0, 16);
}
