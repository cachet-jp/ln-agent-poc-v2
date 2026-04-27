/**
 * Extract the amount in satoshis encoded in a BOLT11 Lightning invoice's HRP.
 *
 * Format (BOLT 11): `ln{prefix}{amount?}{multiplier?}1{data}`
 *   - prefix:     `bc` mainnet, `tb` testnet, `tbs` signet, `bcrt` regtest
 *   - amount:     positive integer (no leading zero), optional for any-amount invoices
 *   - multiplier: m=10⁻³ BTC, u=10⁻⁶, n=10⁻⁹, p=10⁻¹² (BTC base unit if absent)
 *   - separator:  the **last** `1` in the string (bech32 charset omits `1`).
 *
 * We only need the amount, so signature/payload decoding is intentionally not
 * performed here — keeps the audit surface to ~30 lines of integer arithmetic.
 */

const SUPPORTED_PREFIXES = ["lnbcrt", "lntbs", "lnbc", "lntb"] as const;

const MULTIPLIER_SATS: Record<string, number> = {
  m: 100_000, // 10⁻³ BTC = 100k sats
  u: 100, //     10⁻⁶ BTC = 100 sats
  n: 0.1, //     10⁻⁹ BTC = 0.1 sats (must combine to whole sats)
  p: 0.0001, //  10⁻¹² BTC = 0.0001 sats (must combine to whole sats)
};

const SATS_PER_BTC = 100_000_000;

export function decodeBolt11Sats(bolt11: string): number {
  if (typeof bolt11 !== "string" || bolt11.length === 0) {
    throw new Error("bolt11 invoice is empty");
  }
  const lower = bolt11.toLowerCase();
  const sepIdx = lower.lastIndexOf("1");
  if (sepIdx <= 0) {
    throw new Error("bolt11 invoice missing bech32 separator");
  }
  const hrp = lower.substring(0, sepIdx);

  const prefix = SUPPORTED_PREFIXES.find((p) => hrp.startsWith(p));
  if (!prefix) {
    throw new Error(`bolt11 invoice has unrecognized prefix: ${hrp}`);
  }
  const amountPart = hrp.substring(prefix.length);
  if (amountPart === "") {
    throw new Error("bolt11 invoice has no amount (any-amount invoice not allowed for vendor payment)");
  }

  const lastChar = amountPart[amountPart.length - 1];
  let amountStr: string;
  let unitSats: number;
  if (lastChar in MULTIPLIER_SATS) {
    amountStr = amountPart.slice(0, -1);
    unitSats = MULTIPLIER_SATS[lastChar];
  } else {
    amountStr = amountPart;
    unitSats = SATS_PER_BTC;
  }

  if (!/^[1-9][0-9]*$/.test(amountStr)) {
    throw new Error(`bolt11 invoice has invalid amount field: ${amountPart}`);
  }
  const amount = Number(amountStr);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`bolt11 invoice has invalid amount value: ${amountPart}`);
  }

  const sats = amount * unitSats;
  if (!Number.isInteger(sats)) {
    throw new Error(`bolt11 invoice encodes sub-satoshi amount (${sats} sats) — refusing to pay`);
  }
  return sats;
}
