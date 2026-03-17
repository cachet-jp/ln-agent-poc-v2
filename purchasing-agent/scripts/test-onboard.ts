/**
 * Test onboarding boarding UTXOs into offchain vTXOs.
 * This tests the full flow: init → getBalance → onboard → getBalance
 */

// Polyfill EventSource for Node.js (Ark SDK uses SSE for round events)
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { EventSource } = require("eventsource");
(globalThis as any).EventSource = EventSource;

import dotenv from "dotenv";
dotenv.config();

import { getBalance, onboardBoardingUtxos } from "../src/lib/clw-client.js";

async function main() {
  console.log("=== Step 1: Check balance before onboard ===");
  const balanceBefore = await getBalance();
  console.log("Balance before:", JSON.stringify(balanceBefore, null, 2));

  if (balanceBefore.onchain.confirmed === 0 && balanceBefore.onchain.unconfirmed === 0) {
    console.log("No onchain balance to onboard. Send BTC to boarding address first.");
    return;
  }

  console.log("\n=== Step 2: Onboard boarding UTXOs ===");
  console.log("This will participate in an Ark round to convert onchain → offchain...");
  try {
    const result = await onboardBoardingUtxos();
    console.log("Onboard result:", JSON.stringify(result, null, 2));
  } catch (err: any) {
    console.error("Onboard error:", err.message);
    if (err.stack) console.error("Stack:", err.stack);
    return;
  }

  console.log("\n=== Step 3: Check balance after onboard ===");
  const balanceAfter = await getBalance();
  console.log("Balance after:", JSON.stringify(balanceAfter, null, 2));
}

main().catch(console.error);
