import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, parse } from "node:path";

/**
 * Single source of truth: extract the verbatim synthesizer prompt from
 * prompts/synthesizer.md. The block is between the first ``` opening fence
 * after "## The prompt" and the next closing ```.
 */
export async function loadSynthesizerPrompt(repoRoot?: string): Promise<string> {
  const root = repoRoot ?? (await findRepoRoot());
  const path = resolve(root, "prompts/synthesizer.md");
  const md = await readFile(path, "utf8");
  const headingIdx = md.indexOf("## The prompt");
  if (headingIdx < 0) throw new Error("synthesizer.md: missing '## The prompt' heading");
  const fenceOpen = md.indexOf("```", headingIdx);
  if (fenceOpen < 0) throw new Error("synthesizer.md: no opening code fence after '## The prompt'");
  const bodyStart = md.indexOf("\n", fenceOpen) + 1;
  const fenceClose = md.indexOf("```", bodyStart);
  if (fenceClose < 0) throw new Error("synthesizer.md: no closing code fence");
  return md.slice(bodyStart, fenceClose).trim();
}

/** Walk up from this file until we find prompts/synthesizer.md. */
async function findRepoRoot(): Promise<string> {
  let cur = dirname(fileURLToPath(import.meta.url));
  const root = parse(cur).root;
  while (cur !== root) {
    try {
      await stat(resolve(cur, "prompts/synthesizer.md"));
      return cur;
    } catch {
      cur = dirname(cur);
    }
  }
  throw new Error("findRepoRoot: prompts/synthesizer.md not found in any parent directory");
}
