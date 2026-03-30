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
import { getConfig } from "./lib/config.js";

const server = new McpServer({
  name: "purchasing-agent",
  version: "0.1.0",
});

const config = getConfig();

// Cashu tools — available when CASHU_MINT_URL is configured (no claw-cash dependency)
if (config.CASHU_MINT_URL) {
  const { registerCashuTools } = await import("./tools/cashu-wallet.js");
  registerCashuTools(server);
}

// UseBitcoin tools — work with Cashu-only (no Ark required) or Ark+Cashu
// Payment strategy auto-selects: Cashu melt if funded, Ark fallback otherwise.
{
  const { registerUseBitcoinTools } = await import("./tools/usebitcoin.js");
  registerUseBitcoinTools(server);
}

// V-Preca inquiry — retrieve full card details from gift code + card last 4 digits
{
  const { registerVPrecaInquiryTools } = await import("./tools/vpreca-inquiry.js");
  registerVPrecaInquiryTools(server);
}

// Ark wallet tools — depend on claw-cash submodule; skip if unavailable
try {
  const { registerArkTools } = await import("./tools/ark-wallet.js");
  registerArkTools(server);
} catch (err) {
  console.error(`[purchasing-agent] Ark tools unavailable (Cashu-only mode): ${(err as Error).message}`);
}

// Bitrefill tools — search/detail always available; purchase tools require API credentials
{
  const { registerBitrefillTools } = await import("./tools/bitrefill.js");
  registerBitrefillTools(server);
}

// Amazon tools — only registered when credentials are configured (Phase 1+)
if (config.AMAZON_EMAIL && config.AMAZON_PASSWORD) {
  try {
    const { registerAmazonTools } = await import("./tools/amazon.js");
    const { registerAmazonSetupTools } = await import("./tools/amazon-setup.js");
    registerAmazonTools(server);
    registerAmazonSetupTools(server);
  } catch (err) {
    console.error(`[purchasing-agent] Amazon tools unavailable: ${(err as Error).message}`);
  }
}

// DMM tools — only registered when credentials are configured
if (config.DMM_EMAIL && config.DMM_PASSWORD) {
  try {
    const { registerDmmTools } = await import("./tools/dmm.js");
    registerDmmTools(server);
  } catch (err) {
    console.error(`[purchasing-agent] DMM tools unavailable: ${(err as Error).message}`);
  }
}

// DLsite tools — only registered when credentials are configured
if (config.DLSITE_EMAIL && config.DLSITE_PASSWORD) {
  try {
    const { registerDlsiteTools } = await import("./tools/dlsite.js");
    registerDlsiteTools(server);
  } catch (err) {
    console.error(`[purchasing-agent] DLsite tools unavailable: ${(err as Error).message}`);
  }
}

// Start server with stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
