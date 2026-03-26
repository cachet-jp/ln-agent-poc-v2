#!/usr/bin/env npx tsx
/**
 * Check Cashu wallet balance.
 * Usage: npx tsx scripts/check-cashu-balance.ts
 */
import "dotenv/config";
import { getCashuBalance } from "../src/lib/cashu-client.js";

const bal = await getCashuBalance();
console.log(JSON.stringify(bal, null, 2));
