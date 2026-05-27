#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getConfig } from "./lib/config.js";

const server = new McpServer({
  name: "purchasing-agent",
  version: "0.1.0",
});

const config = getConfig();

if (config.CASHU_MINT_URL) {
  const { registerCashuTools } = await import("./tools/cashu-wallet.js");
  registerCashuTools(server);
}

{
  const { registerUseBitcoinTools } = await import("./tools/usebitcoin.js");
  registerUseBitcoinTools(server);
}

{
  const { registerVPrecaInquiryTools } = await import("./tools/vpreca-inquiry.js");
  registerVPrecaInquiryTools(server);
}

{
  const { registerBitrefillTools } = await import("./tools/bitrefill.js");
  registerBitrefillTools(server);
}

const transport = new StdioServerTransport();
await server.connect(transport);
