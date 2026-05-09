# @compile/mcp

MCP server that compiles repeat LLM work out of the agent loop.

## Install

Claude Code:

```bash
claude mcp add compile -- npx @compile/mcp
```

Cursor (`cursor.json`):

```json
{ "mcpServers": { "compile": { "command": "npx", "args": ["@compile/mcp"] } } }
```

## What it does

Plug Compile into an agent's traffic. It:

1. Logs every LLM call as a receipt (`compile.observe_call`).
2. Templates and clusters the receipts; scores each cluster on three axes
   (schema stability, determinism, economic value) and surfaces ranked
   codify candidates (`compile.list_codify_candidates`).
3. When the agent calls `compile.find_function`, returns a three-state
   lookup: positive (run the codified function), negative (uncodifiable —
   stay on the frontier model), or unknown (queue for synthesis).
4. For unknowns, the agent can call `compile.request_synthesis` to receive
   a synthesis spec and run codegen on its **own** LLM keys, then
   `compile.submit_synthesis` to validate and write to Vault.

The codegen never runs on Compile's API key. Customer prompts and traces
never leave the customer's trust boundary.

## Tools

- `compile.observe_call`
- `compile.find_function`
- `compile.run_codified`
- `compile.list_codify_candidates`
- `compile.request_synthesis`
- `compile.submit_synthesis`
- `compile.estimate_savings`

## License

MIT
