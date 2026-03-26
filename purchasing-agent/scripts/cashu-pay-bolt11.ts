#!/usr/bin/env npx tsx
/**
 * Pay a BOLT11 Lightning invoice using Cashu ecash (melt).
 * Usage: npx tsx scripts/cashu-pay-bolt11.ts <bolt11>
 */
import "dotenv/config";
import { meltTokens, getCashuBalance } from "../src/lib/cashu-client.js";

const bolt11 = process.argv[2];
if (!bolt11) {
  console.error("Usage: npx tsx scripts/cashu-pay-bolt11.ts <bolt11>");
  process.exit(1);
}

console.log("Paying Lightning invoice via Cashu melt...");
const before = await getCashuBalance();
console.log(`Balance before: ${before.total} sats`);

const result = await meltTokens(bolt11);
console.log(`\nPayment result:`);
console.log(`  Paid: ${result.paid}`);
console.log(`  Amount: ${result.amount} sats`);
console.log(`  Fee: ${result.fee} sats`);
console.log(`  Preimage: ${result.preimage}`);

const after = await getCashuBalance();
console.log(`\nBalance after: ${after.total} sats`);
