/**
 * Check new identity's balance and boarding address.
 * Reads from .env directly (not MCP server).
 */
import dotenv from "dotenv";
dotenv.config();

import { getBalance, getReceiveAddresses } from "../src/lib/clw-client.js";

async function main() {
  console.log("Identity:", process.env.CLW_IDENTITY_ID);
  console.log("Public key:", process.env.CLW_PUBLIC_KEY);
  console.log();

  // Get addresses
  const addresses = await getReceiveAddresses();
  console.log("Addresses:");
  for (const addr of addresses) {
    console.log(`  ${addr.type}: ${addr.address}`);
  }

  // Get balance
  const balance = await getBalance();
  console.log("\nBalance:", JSON.stringify(balance, null, 2));
}

main().catch(console.error);
