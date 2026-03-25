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
import { getConfig } from "./lib/config.js";

const server = new McpServer({
  name: "purchasing-agent",
  version: "0.1.0",
});

// Core tools — always available
registerArkTools(server);
registerUseBitcoinTools(server);

// Cashu tools — available when CASHU_MINT_URL is configured
const config = getConfig();
if (config.CASHU_MINT_URL) {
  const { registerCashuTools } = await import("./tools/cashu-wallet.js");
  registerCashuTools(server);
}

// Amazon tools — only registered when credentials are configured (Phase 1+)
if (config.AMAZON_EMAIL && config.AMAZON_PASSWORD) {
  const { registerAmazonTools } = await import("./tools/amazon.js");
  const { registerAmazonSetupTools } = await import("./tools/amazon-setup.js");
  registerAmazonTools(server);
  registerAmazonSetupTools(server);
}

// Start server with stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
