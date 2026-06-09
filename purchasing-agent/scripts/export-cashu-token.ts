#!/usr/bin/env npx tsx
/**
 * READ-ONLY export of the stored Cashu balance as scannable `cashuB` tokens,
 * for recovery into a personal wallet.
 *
 * The full balance serializes to a token too large for one QR, so proofs are
 * split into CHUNK-sized groups; each group becomes one standalone token + QR.
 * Import every QR into a Cashu wallet for this mint — the wallet sums them.
 *
 * SAFETY: NO mint operation (no swap / melt / send) and NO store write — it only
 * serializes proofs already in the store via getEncodedToken. Nothing can be
 * burned. Once you claim the tokens in a wallet, the store's copies become
 * SPENT; re-check / clear the store before reusing it.
 */
import "dotenv/config";
import { chmodSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getEncodedToken, CheckStateEnum, type ProofState } from "@cashu/cashu-ts";
import QRCode from "qrcode";
import { getCashuWallet } from "../src/lib/cashu-client.js";
import { loadProofs } from "../src/lib/cashu-store.js";

const CHUNK = 4; // proofs per token — keeps each QR comfortably scannable
// Tokens are bearer credentials, so PNGs must not land in world-readable /tmp
// under the default umask. mkdtemp guarantees 0700 on the dir; we also chmod
// 0600 on each PNG defensively. --print-token additionally echoes the raw
// cashuB string to stdout (off by default to keep it out of scrollback / logs).
const printToken = process.argv.includes("--print-token");

const mintUrl = process.env.CASHU_MINT_URL;
if (!mintUrl) {
  console.error("CASHU_MINT_URL not set");
  process.exit(1);
}

const outDir = mkdtempSync(join(tmpdir(), "cashu-recovery-"));

const stored = await loadProofs(mintUrl);
if (stored.length === 0) {
  console.log("Store is empty — nothing to export.");
  process.exit(0);
}

// Read-only NUT-07 state check (sends only Y points — CANNOT spend, does not
// write the store). Only UNSPENT proofs make valid recovery tokens; encoding an
// already-claimed proof would hand out a worthless QR.
const wallet = await getCashuWallet();
const states: ProofState[] = await wallet.checkProofsStates(stored);
const proofs = stored.filter((_, i) => states[i].state === CheckStateEnum.UNSPENT);
const spentCount = stored.length - proofs.length;
const total = proofs.reduce((s, p) => s + p.amount, 0);
if (spentCount > 0) {
  console.log(`note: ${spentCount}/${stored.length} stored proofs are already SPENT (claimed) — exporting only the ${proofs.length} UNSPENT.`);
}
if (proofs.length === 0 || total === 0) {
  console.log("No UNSPENT ecash left in the store — nothing to recover.");
  process.exit(0);
}

const groups: (typeof proofs)[] = [];
for (let i = 0; i < proofs.length; i += CHUNK) groups.push(proofs.slice(i, i + CHUNK));

console.log(`mint:    ${mintUrl}`);
console.log(`balance: ${total} sats across ${proofs.length} proofs`);
console.log(`export:  ${groups.length} token(s) / QR(s) — import ALL of them`);
console.log(`outDir:  ${outDir}\n`);

for (let g = 0; g < groups.length; g++) {
  const sub = groups[g];
  const subTotal = sub.reduce((s, p) => s + p.amount, 0);
  const token = getEncodedToken({ mint: mintUrl, proofs: sub });
  const pngPath = join(outDir, `${g + 1}of${groups.length}.png`);
  await QRCode.toFile(pngPath, token, { errorCorrectionLevel: "L", width: 700, margin: 2 });
  chmodSync(pngPath, 0o600);
  const terminal = await QRCode.toString(token, { type: "terminal", small: true, errorCorrectionLevel: "L" });

  console.log(`============ QR ${g + 1}/${groups.length}  (${subTotal} sats, ${sub.length} proofs, ${token.length} chars) ============`);
  console.log(terminal);
  console.log(`PNG: ${pngPath}`);
  if (printToken) console.log(`token: ${token}`);
  console.log();
}

console.log(`Done. ${groups.length} QR/token(s) totaling ${total} sats. Import every one.`);
console.log(`PNGs in ${outDir} (mode 0600). Delete them once imported.`);
if (!printToken) console.log(`(pass --print-token to also echo raw cashuB strings to stdout.)`);
