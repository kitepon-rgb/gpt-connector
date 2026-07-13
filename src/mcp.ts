#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createGptConnectorMcpServer, LazyConnectorHost } from "./mcp-server.js";

const host = new LazyConnectorHost(
  process.env.GPT_CONNECTOR_CDP_ENDPOINT ?? "http://127.0.0.1:9223",
  process.env.GPT_CONNECTOR_STATE_DIR,
);
const server = createGptConnectorMcpServer(host);

async function shutdown(): Promise<void> {
  await host.shutdown();
}

process.once("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

const transport = new StdioServerTransport();
await server.connect(transport);
