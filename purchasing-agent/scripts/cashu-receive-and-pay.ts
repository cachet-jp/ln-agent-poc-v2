#!/usr/bin/env npx tsx
/**
 * Receive a pasted Cashu token, then melt it to pay a BOLT11 Lightning invoice.
 *
 * Designed to be driven as a subprocess by the ln-agent-poc-v3 Nostr bot's
 * Cashu rail: the bot creates a UseBitcoin BOLT11, asks the buyer to DM a Cashu
 * token, and pipes {token, bolt11} here. The mint pays the invoice; the bot then
 * polls the UseBitcoin order and delivers the gift code.
 *
 * I/O contract (machine-readable, single-purpose):
 *   - INPUT  : a JSON object on stdin: { "token": "cashuB…", "bolt11": "lnbc…" }
 *              (token is a bearer secret — passed via stdin, never argv, to keep
 *               it out of the process list)
 *   - OUTPUT : exactly one JSON line on stdout.
 *              success → {"ok":true,"received":N,"paid":bool,"amount":N,"fee":N,"preimage":"…","change":N}
 *              failure → {"ok":false,"error":"…"}  (exit code 1)
 *
 * Reuses the hardened wallet logic in src/lib/cashu-client.ts (same-mint check,
 * DLEQ verification, encrypted proof store). No new crypto here.
 */
import "dotenv/config";
import {
  receiveTokens,
  meltTokens,
} from "../src/lib/cashu-client.js";
import { assertStoreReady } from "../src/lib/cashu-store.js";

interface Request {
  token: string;
  bolt11: string;
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

function emit(obj: Record<string, unknown>): void {
  // Single JSON line on stdout — the Go side parses the last stdout line.
  process.stdout.write(JSON.stringify(obj) + "\n");
}

async function main(): Promise<void> {
  const raw = (await readStdin()).trim();
  if (!raw) {
    throw new Error("empty stdin: expected JSON {token, bolt11}");
  }
  let req: Request;
  try {
    req = JSON.parse(raw) as Request;
  } catch {
    throw new Error("invalid JSON on stdin");
  }
  if (!req.token || !req.bolt11) {
    throw new Error("missing token or bolt11 in request");
  }

  // Fail fast: confirm the encrypted proof store is writable and the key is
  // present BEFORE any mint-side operation. The mint commits state on
  // receive/melt; if persistence later fails, the proofs vanish and funds burn.
  await assertStoreReady();

  // 1. Receive: same-mint check + DLEQ verify + swap to fresh proofs (stored).
  const recv = await receiveTokens(req.token);

  // 2. Melt: the mint pays the UseBitcoin BOLT11; change (if any) stays stored.
  const melt = await meltTokens(req.bolt11);

  emit({
    ok: true,
    received: recv.amount,
    paid: melt.paid,
    amount: melt.amount,
    fee: melt.fee,
    preimage: melt.preimage,
    change: melt.change.reduce((sum, p) => sum + p.amount, 0),
  });
}

main().catch((err: unknown) => {
  emit({ ok: false, error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
