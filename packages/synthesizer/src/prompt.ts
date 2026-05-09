import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Single source of truth: extract the verbatim synthesizer prompt from
 * prompts/synthesizer.md. The block is between the first ``` opening fence
 * after "## The prompt" and the next closing ```.
 */
export async function loadSynthesizerPrompt(repoRoot?: string): Promise<string> {
  const root = repoRoot ?? findRepoRoot();
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

function findRepoRoot(): string {
  // synthesizer compiles to dist/prompt.js → repo root is ../../../..
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "..", "..", "..", "..");
}
