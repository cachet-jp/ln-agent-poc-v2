/**
 * Payment strategy abstraction — pay a BOLT11 invoice via Ark or Cashu.
 *
 * "auto" mode: Cashu if balance is sufficient → Ark direct as fallback.
 * Replaces direct `payLightningInvoice(bolt11)` calls in usebitcoin.ts during Phase 3.
 */

import { isCashuEnabled, getCashuConfig } from "./cashu-config.js";
import { meltTokens } from "./cashu-client.js";
import { decodeBolt11Sats } from "./bolt11-amount.js";

export type PaymentMethod = "ark" | "cashu" | "auto";

export interface PaymentResult {
  preimage: string;
  amount: number;
  txid: string;
}

export interface PayBolt11Result extends PaymentResult {
  /** Which payment method was actually used */
  method: PaymentMethod;
  /** Fee paid (if Cashu, includes mint fee) */
  fee?: number;
}

/**
 * Pay a BOLT11 Lightning invoice using the specified method.
 *
 * - "cashu": Pay via Cashu melt (mint pays the invoice on your behalf)
 * - "ark": Pay via Ark wallet directly (Boltz submarine swap)
 * - "auto": Try Cashu first if enabled and funded, fall back to Ark
 *
 * `expectedSats`: when provided, decode the invoice's HRP and refuse to pay
 * if the encoded sats don't match exactly. Vendor-supplied invoices MUST pass
 * this — without it, a compromised vendor or MITM can return an inflated
 * invoice and have it paid silently. User-paste flows (where the user IS the
 * source of truth for the invoice) may omit it.
 */
export async function payBolt11(
  bolt11: string,
  method: PaymentMethod = "auto",
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

  if (method === "ark") {
    return payViaArk(bolt11);
  }

  if (method === "cashu") {
    return payViaCashu(bolt11);
  }

  // "auto" mode
  if (!isCashuEnabled()) {
    return payViaArk(bolt11);
  }

  const cfg = getCashuConfig();
  if (!cfg.CASHU_PREFERRED) {
    return payViaArk(bolt11);
  }

  // Try Cashu first — meltTokens() validates balance internally,
  // so we skip the redundant pre-check that would decrypt the proof store twice
  try {
    return await payViaCashu(bolt11);
  } catch {
    // Cashu failed (insufficient balance or mint error) — fall through to Ark
  }

  // Fallback to Ark
  return payViaArk(bolt11);
}

async function payViaArk(bolt11: string): Promise<PayBolt11Result> {
  // Lazy import — clw-client depends on claw-cash submodule
  const { payLightningInvoice } = await import("./clw-client.js");
  const result = await payLightningInvoice(bolt11);
  return {
    ...result,
    method: "ark",
  };
}

async function payViaCashu(bolt11: string): Promise<PayBolt11Result> {
  const result = await meltTokens(bolt11);
  if (!result.paid) {
    throw new Error("Cashu melt failed — mint could not pay the Lightning invoice");
  }
  return {
    preimage: result.preimage ?? "",
    amount: result.amount,
    txid: "", // Cashu melts don't have a txid
    method: "cashu",
    fee: result.fee,
  };
}
