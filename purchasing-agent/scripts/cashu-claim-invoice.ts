#!/usr/bin/env npx tsx
/**
 * Claim a paid Lightning invoice and add ecash proofs to wallet.
 * Usage: npx tsx scripts/cashu-claim-invoice.ts <quoteId>
 */
import "dotenv/config";
import { claimMintInvoice, getCashuBalance } from "../src/lib/cashu-client.js";

const quoteId = process.argv[2];
const amountSats = parseInt(process.argv[3] || "0", 10);
if (!quoteId || !amountSats) {
  console.error("Usage: npx tsx scripts/cashu-claim-invoice.ts <quoteId> <amountSats>");
  process.exit(1);
}

console.log(`Claiming invoice ${quoteId} (${amountSats} sats)...`);
const result = await claimMintInvoice(quoteId, amountSats);
console.log(`State: ${result.state}`);
console.log(`Claimed: ${result.claimed}`);
console.log(`Amount: ${result.amount} sats`);

const balance = await getCashuBalance();
console.log(`\nNew Cashu balance: ${balance.total} sats (${balance.proofCount} proofs)`);
