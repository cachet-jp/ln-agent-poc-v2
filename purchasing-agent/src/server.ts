#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerArkTools } from "./tools/ark-wallet.js";
import { registerUseBitcoinTools } from "./tools/usebitcoin.js";
import { registerAmazonTools } from "./tools/amazon.js";
import { registerAmazonSetupTools } from "./tools/amazon-setup.js";

const server = new McpServer({
  name: "purchasing-agent",
  version: "0.1.0",
});

// Register all tool groups
registerArkTools(server);
registerUseBitcoinTools(server);
registerAmazonTools(server);
registerAmazonSetupTools(server);

// Start server with stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
