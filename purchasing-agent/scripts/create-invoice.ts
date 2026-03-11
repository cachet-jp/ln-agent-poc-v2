/**
 * Create a Lightning invoice for the new identity using the SDK.
 */
import dotenv from "dotenv";
dotenv.config();

import { createLightningInvoice } from "../src/lib/clw-client.js";

async function main() {
  console.log("Identity:", process.env.CLW_IDENTITY_ID);
  console.log();

  // Create invoice for 10,000 sats
  const amount = 10000;
  console.log(`Creating Lightning invoice for ${amount} sats...`);

  try {
    const invoice = await createLightningInvoice(amount, "Fund purchasing agent");
    console.log("\n✅ Invoice created!");
    console.log("Invoice:", invoice.bolt11);
    console.log("Amount:", amount, "sats");
    console.log("\n⚡ Pay this invoice from any Lightning wallet to fund the agent.");
  } catch (err: any) {
    console.error("❌ Failed:", err.message);
    if (err.stack) console.error(err.stack);
  }
}

main().catch(console.error);
