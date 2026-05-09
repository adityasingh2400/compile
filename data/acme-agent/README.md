# acme/agent

Demo customer for Compile. Small TypeScript agent with ~10 LLM call sites
spread across three flavors:

- **GREEN** (high static priors): structured output APIs, `temperature: 0`,
  templated prompts. Strong tier-1 candidates.
- **YELLOW** (mixed priors): some structured-output discipline but missing
  one or two signals.
- **RED** (low priors): free-form generation, no schema, no temp control.
  Goes straight to the negative Vault.

This is what `compile.scan_repo("data/acme-agent")` walks during the demo.
The fake Acme corpus (ICP doc, pricing) lives next to it; the Nia Document
Agent reads those for synthetic input generation.
