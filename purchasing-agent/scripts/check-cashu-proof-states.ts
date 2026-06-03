#!/usr/bin/env npx tsx
/**
 * READ-ONLY Cashu proof-state inspector.
 *
 * Queries the mint for the UNSPENT/SPENT/PENDING state of every stored proof
 * via NUT-07 (wallet.checkProofsStates). That call sends only each proof's Y
 * point (hash_to_curve of the secret) — NOT the secret itself — so it CANNOT
 * spend anything. This script is deliberately read-only:
 *   - it does NOT call removeProofs / saveProofs (unlike the library's
 *     checkProofStates(), which prunes SPENT proofs from the store),
 *   - it does NOT swap, send, or melt.
 * So running it leaves the encrypted store byte-for-byte unchanged.
 */
import "dotenv/config";
import { CheckStateEnum, type ProofState } from "@cashu/cashu-ts";
import { getCashuWallet } from "../src/lib/cashu-client.js";
import { loadProofs } from "../src/lib/cashu-store.js";

const mintUrl = process.env.CASHU_MINT_URL;
if (!mintUrl) {
  console.error("CASHU_MINT_URL not set");
  process.exit(1);
}

const proofs = await loadProofs(mintUrl);
if (proofs.length === 0) {
  console.log(JSON.stringify({ total: 0, proofCount: 0, mintUrl }, null, 2));
  process.exit(0);
}

const wallet = await getCashuWallet();
const states: ProofState[] = await wallet.checkProofsStates(proofs);

let unspent = 0,
  spent = 0,
  pending = 0,
  unspentSats = 0,
  spentSats = 0,
  pendingSats = 0;
for (let i = 0; i < proofs.length; i++) {
  const amt = proofs[i].amount;
  switch (states[i].state) {
    case CheckStateEnum.UNSPENT:
      unspent++;
      unspentSats += amt;
      break;
    case CheckStateEnum.SPENT:
      spent++;
      spentSats += amt;
      break;
    case CheckStateEnum.PENDING:
      pending++;
      pendingSats += amt;
      break;
  }
}

console.log(
  JSON.stringify(
    {
      mintUrl,
      proofCount: proofs.length,
      totalSats: proofs.reduce((s, p) => s + p.amount, 0),
      unspent: { proofs: unspent, sats: unspentSats },
      spent: { proofs: spent, sats: spentSats },
      pending: { proofs: pending, sats: pendingSats },
      note: "read-only — store NOT modified",
    },
    null,
    2,
  ),
);
