import { meltTokens } from "./cashu-client.js";
import { decodeBolt11Sats } from "./bolt11-amount.js";

export type PaymentMethod = "cashu";

export interface PayBolt11Result {
  preimage: string;
  amount: number;
  txid: string;
  method: PaymentMethod;
  fee?: number;
}

/**
 * Pay a BOLT11 Lightning invoice via the Cashu mint (melt).
 *
 * `expectedSats`: when provided, decode the invoice's HRP and refuse to pay
 * if the encoded sats don't match exactly. Vendor-supplied invoices MUST pass
 * this — without it, a compromised vendor or MITM can return an inflated
 * invoice and have it paid silently. User-paste flows (where the user IS the
 * source of truth for the invoice) may omit it.
 */
export async function payBolt11(
  bolt11: string,
  _method: PaymentMethod = "cashu",
  expectedSats?: number,
): Promise<PayBolt11Result> {
  if (expectedSats !== undefined) {
    const encoded = decodeBolt11Sats(bolt11);
    if (encoded !== expectedSats) {
      throw new Error(
        `bolt11 amount mismatch: expected ${expectedSats} sats, invoice encodes ${encoded} sats — refusing to pay`,
      );
    }
  }

  const result = await meltTokens(bolt11);
  if (!result.paid) {
    throw new Error("Cashu melt failed — mint could not pay the Lightning invoice");
  }
  return {
    preimage: result.preimage ?? "",
    amount: result.amount,
    txid: "",
    method: "cashu",
    fee: result.fee,
  };
}
