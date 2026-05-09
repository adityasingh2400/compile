/**
 * @compile/mcp — the MCP server agents install via:
 *   claude mcp add compile -- npx @compile/mcp
 *
 * Exposes 7 tools (see DESIGN.md). All handlers are stubs at scaffold time;
 * Lane A wires them to identification + routing + synthesis pipelines.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MCP_TOOLS, type McpToolName } from "@compile/schemas";

const server = new Server(
  { name: "compile", version: "0.0.0" },
  { capabilities: { tools: {} } },
);

const TOOL_DESCRIPTIONS: Record<McpToolName, string> = {
  "compile.observe_call": "Log an LLM call receipt to the identification pipeline.",
  "compile.find_function":
    "Three-state lookup against Nia Vault: positive hit / negative hit / unknown.",
  "compile.run_codified": "Execute a codified function (Tier 1 or Tier 2).",
  "compile.list_codify_candidates":
    "Ranked clusters that passed 3-axis scoring; powers the 48h report.",
  "compile.request_synthesis":
    "Returns a synthesis spec. The CALLING agent runs codegen on its own LLM keys.",
  "compile.submit_synthesis":
    "Agent submits emitted code; Compile validates against private holdout, gates ≥98%.",
  "compile.estimate_savings":
    "Projected $ savings per tier with break-even formula.",
};

// TODO(lane-A): replace stub handlers with real pipeline calls.
for (const name of Object.keys(MCP_TOOLS) as McpToolName[]) {
  void name;
  void TOOL_DESCRIPTIONS;
}

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[compile-mcp] fatal:", err);
  process.exit(1);
});
