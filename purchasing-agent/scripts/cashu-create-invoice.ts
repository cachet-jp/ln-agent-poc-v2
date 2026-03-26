#!/usr/bin/env npx tsx
/**
 * Create a Lightning invoice for Cashu wallet top-up.
 * Usage: npx tsx scripts/cashu-create-invoice.ts [amount_sats]
 */
import "dotenv/config";
import { createMintInvoice } from "../src/lib/cashu-client.js";

const amount = parseInt(process.argv[2] || "2000", 10);
console.log(`Creating Lightning invoice for ${amount} sats...`);

const result = await createMintInvoice(amount);
console.log(`\nQuote ID: ${result.quoteId}`);
console.log(`Amount: ${result.amount} sats`);
console.log(`Expiry: ${new Date(result.expiry * 1000).toISOString()}`);
console.log(`\nBOLT11 invoice:\n${result.bolt11}`);
console.log(`\nPay this invoice from any Lightning wallet, then run:`);
console.log(`  npx tsx scripts/cashu-claim-invoice.ts ${result.quoteId}`);
