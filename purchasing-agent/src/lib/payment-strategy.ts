/**
 * Payment strategy abstraction — pay a BOLT11 invoice via Ark or Cashu.
 *
 * "auto" mode: Cashu when configured + preferred. Ark is only used (and only
 * available as a fallback) when ARK_ENABLED=true. When Ark is disabled and
 * Cashu fails, the error propagates rather than silently switching wallets.
 */

import { isCashuEnabled, getCashuConfig } from "./cashu-config.js";
import { isArkEnabled } from "./config.js";
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

  const arkAvailable = isArkEnabled();

  if (method === "ark") {
    if (!arkAvailable) {
      throw new Error(
        "Ark payment requested but ARK_ENABLED is false. Set ARK_ENABLED=true in .env to enable claw-cash, or use Cashu instead.",
      );
    }
    return payViaArk(bolt11);
  }

  if (method === "cashu") {
    return payViaCashu(bolt11);
  }

  // "auto" mode
  const cashuConfigured = isCashuEnabled();
  const cashuPreferred = cashuConfigured && getCashuConfig().CASHU_PREFERRED;

  if (cashuPreferred) {
    // Try Cashu first — meltTokens() validates balance internally,
    // so we skip the redundant pre-check that would decrypt the proof store twice
    try {
      return await payViaCashu(bolt11);
    } catch (err) {
      if (!arkAvailable) throw err;
      // Cashu failed (insufficient balance or mint error) — fall through to Ark
    }
    return payViaArk(bolt11);
  }

  // Cashu not preferred (or not configured)
  if (arkAvailable) {
    return payViaArk(bolt11);
  }
  if (cashuConfigured) {
    return payViaCashu(bolt11);
  }
  throw new Error(
    "No payment method available: configure CASHU_MINT_URL or set ARK_ENABLED=true.",
  );
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
