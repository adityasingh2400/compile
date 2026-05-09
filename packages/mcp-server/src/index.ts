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
import { createNiaClient } from "@compile/nia";
import { MemoryReceiptStore } from "@compile/identifier";
import {
  ConvexBootstrapStream,
  MemoryBootstrapStream,
  NoopBootstrapStream,
  convexAdapterFromEnv,
  type IBootstrapStream,
} from "@compile/stream";
import {
  LocalFakeTensorlakeClient,
  RealTensorlakeClient,
  TensorlakeWithLocalFallback,
  type ITensorlakeClient,
} from "@compile/runtime";
import {
  AnthropicOracleClient,
  BudgetedOracleClient,
  OracleWithLocalFallback,
  StubOracleClient,
  type IOracleClient,
} from "@compile/synth-loader";
import { MemoryRequestStore } from "./store.js";
import {
  buildHandlers,
  TOOLS,
  TOOL_DESCRIPTIONS,
  MemoryBootstrapStore,
} from "./handlers.js";
import { ensureDaemon } from "./daemon-supervisor.js";
import type { McpToolName } from "@compile/schemas";

// Nia (D2). createNiaClient picks RealNiaClient when NIA_API_KEY +
// NIA_VAULT_ID are both set; otherwise StubNiaClient. The factory keeps
// offline dev / CI working without keys.
const nia = createNiaClient();
const store = new MemoryRequestStore();
const receipts = new MemoryReceiptStore();
const bootstrap = new MemoryBootstrapStore();
// Stream selection:
//   - CONVEX_URL set (default for installed users) → ConvexBootstrapStream
//     publishes phase/cell/cluster/vault events to the deployed Convex so
//     the always-on daemon and dashboard see live MCP traffic.
//   - COMPILE_STREAM=memory → in-process capture for local rehearsal.
//   - COMPILE_STREAM=noop or no CONVEX_URL → silent (offline dev).
const stream: IBootstrapStream = (() => {
  const mode = process.env.COMPILE_STREAM;
  if (mode === "memory") return new MemoryBootstrapStream();
  if (mode === "noop") return new NoopBootstrapStream();
  if (process.env.CONVEX_URL) {
    try {
      return new ConvexBootstrapStream({ client: convexAdapterFromEnv() });
    } catch (err) {
      console.error(
        `[compile-mcp] CONVEX_URL set but adapter failed (${(err as Error).message}); falling back to noop stream`,
      );
      return new NoopBootstrapStream();
    }
  }
  return new NoopBootstrapStream();
})();
// Tensorlake (D1, D6). Default LocalFake when no creds — keeps demos
// running offline. With TENSORLAKE_API_KEY set we wrap the real client
// with the local-fallback shim so a sandbox outage drops to in-process
// execution per failure mode #2 instead of crashing the gate / Tier-2.
const tensorlake: ITensorlakeClient = (() => {
  const fallback = new LocalFakeTensorlakeClient();
  if (process.env.TENSORLAKE_API_KEY) {
    const real = new RealTensorlakeClient({
      apiKey: process.env.TENSORLAKE_API_KEY,
      endpoint: process.env.TENSORLAKE_ENDPOINT,
      phiImage: process.env.COMPILE_PHI_IMAGE ?? "compile-phi-mini",
      phiModel: process.env.COMPILE_PHI_MODEL ?? "phi3:mini",
    });
    return new TensorlakeWithLocalFallback(real, fallback);
  }
  return fallback;
})();
// Frontier oracle (D9, D10). Default Stub when no creds — keeps demos
// running offline + makes oracle_agreement deterministic across rehearsals.
// With ANTHROPIC_API_KEY set we wrap AnthropicOracleClient in:
//   1. BudgetedOracleClient (cost cap; default $5/run)
//   2. OracleWithLocalFallback (retry-once + per-input fallback to Stub)
// so a flaky API or budget trip degrades gracefully into stubbed oracle
// samples for the remainder of the run instead of crashing Stage-2.
const oracle: IOracleClient = (() => {
  const stub = new StubOracleClient();
  if (!process.env.ANTHROPIC_API_KEY) return stub;
  const real = new AnthropicOracleClient({
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.COMPILE_ORACLE_MODEL ?? "claude-sonnet-4-6",
  });
  const budgetUsd = parseFloat(process.env.COMPILE_ORACLE_BUDGET_USD ?? "5");
  const budgeted = new BudgetedOracleClient(real, {
    budgetUsd,
    onTrip: (spent, cap) =>
      console.error(
        `[oracle] budget tripped at $${spent.toFixed(4)} of $${cap.toFixed(2)} cap; remaining calls fall back to stub`,
      ),
  });
  return new OracleWithLocalFallback(budgeted, stub);
})();
const handlers = buildHandlers({
  nia,
  store,
  receipts,
  bootstrap,
  stream,
  tensorlake,
  oracle,
});

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
  // Auto-fork the always-on daemon. Best-effort: any failure logs and lets
  // the MCP server keep running in lookup-only mode.
  try {
    const sup = ensureDaemon();
    if (sup.status === "spawned") {
      console.error(`[compile-mcp] daemon spawned pid=${sup.pid} log=${sup.logFile}`);
    } else if (sup.status === "already-running") {
      console.error(`[compile-mcp] daemon already running pid=${sup.pid}`);
    } else {
      console.error(`[compile-mcp] daemon not started: ${sup.reason}`);
    }
  } catch (err) {
    console.error(`[compile-mcp] daemon supervisor error: ${(err as Error).message}`);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[compile-mcp] listening on stdio · stream=${stream.constructor.name}${
      process.env.CONVEX_URL ? ` · convex=${process.env.CONVEX_URL}` : ""
    }`,
  );
}

main().catch((err) => {
  console.error("[compile-mcp] fatal:", err);
  process.exit(1);
});
