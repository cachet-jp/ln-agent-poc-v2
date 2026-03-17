#!/usr/bin/env node

// Polyfill EventSource for Node.js (Ark SDK uses SSE for Ark round events)
import { createRequire } from "node:module";
const _require = createRequire(import.meta.url);
const { EventSource: _EventSource } = _require("eventsource");
if (!("EventSource" in globalThis)) {
  (globalThis as any).EventSource = _EventSource;
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerArkTools } from "./tools/ark-wallet.js";
import { registerUseBitcoinTools } from "./tools/usebitcoin.js";

const server = new McpServer({
  name: "purchasing-agent",
  version: "0.1.0",
});

// Core tools — always available
registerArkTools(server);
registerUseBitcoinTools(server);

// Amazon setup tools — always available (account creation, session save, etc.)
const { registerAmazonSetupTools } = await import("./tools/amazon-setup.js");
registerAmazonSetupTools(server);

// Amazon operational tools — always available
// Each tool checks internally for saved session cookies (storage-state/amazon.json).
// amazon_login can work with credentials from .env OR with saved session cookies.
const { registerAmazonTools } = await import("./tools/amazon.js");
registerAmazonTools(server);

// Start server with stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
