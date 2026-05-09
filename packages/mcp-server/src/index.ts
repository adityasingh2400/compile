/**
 * @compile/mcp — the MCP server agents install via:
 *   claude mcp add compile -- npx @compile/mcp
 *
 * Lane A1: request_synthesis + submit_synthesis are wired end-to-end.
 * Other 5 tools validate input via Zod and return "not implemented".
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { StubNiaClient } from "@compile/nia";
import { MemoryReceiptStore } from "@compile/identifier";
import { MemoryRequestStore } from "./store.js";
import {
  buildHandlers,
  TOOLS,
  TOOL_DESCRIPTIONS,
  MemoryBootstrapStore,
} from "./handlers.js";
import type { McpToolName } from "@compile/schemas";

const nia = new StubNiaClient();
const store = new MemoryRequestStore();
const receipts = new MemoryReceiptStore();
const bootstrap = new MemoryBootstrapStore();
const handlers = buildHandlers({ nia, store, receipts, bootstrap });

const server = new Server(
  { name: "compile", version: "0.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: (Object.keys(TOOLS) as McpToolName[]).map((name) => ({
    name,
    description: TOOL_DESCRIPTIONS[name],
    inputSchema: zodToJsonSchema(TOOLS[name].input, { target: "openApi3" }) as Record<
      string,
      unknown
    >,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name as McpToolName;
  const handler = handlers[name];
  if (!handler) {
    return {
      isError: true,
      content: [{ type: "text", text: `unknown tool: ${String(name)}` }],
    };
  }
  try {
    const result = await handler(req.params.arguments ?? {});
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: (err as Error).message }],
    };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[compile-mcp] listening on stdio");
}

main().catch((err) => {
  console.error("[compile-mcp] fatal:", err);
  process.exit(1);
});
