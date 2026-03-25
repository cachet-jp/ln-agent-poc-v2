/**
 * Cashu ecash wallet client — wraps @cashu/cashu-ts Wallet.
 *
 * Follows the same lazy-singleton pattern as clw-client.ts.
 * Provides high-level mint/melt/send/receive operations.
 */

import {
  Wallet,
  Mint,
  getEncodedToken,
  getDecodedToken,
  CheckStateEnum,
  type Proof,
  type MintQuoteBolt11Response,
  type MeltQuoteBolt11Response,
  type MeltProofsResponse,
  type ProofState,
} from "@cashu/cashu-ts";
import { getCashuConfig } from "./cashu-config.js";
import {
  loadProofs,
  addProofs,
  saveProofs,
  removeProofs,
  getTotalBalance,
} from "./cashu-store.js";
import { payLightningInvoice } from "./clw-client.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CashuBalanceInfo {
  /** Total ecash balance in sats */
  total: number;
  /** Number of proofs held */
  proofCount: number;
  /** Mint URL */
  mintUrl: string;
}

export interface MintResult {
  /** Proofs received from the mint */
  proofs: Proof[];
  /** Total amount minted in sats */
  amount: number;
  /** Mint quote ID */
  quoteId: string;
}

export interface MeltResult {
  /** Whether the payment was successful */
  paid: boolean;
  /** Payment preimage (proof of payment) */
  preimage: string | null;
  /** Amount paid in sats */
  amount: number;
  /** Fee paid in sats */
  fee: number;
  /** Change proofs returned from overpaid fees */
  change: Proof[];
}

export interface ReceiveResult {
  /** New proofs after swapping with mint */
  proofs: Proof[];
  /** Total amount received in sats */
  amount: number;
}

export interface SendResult {
  /** Encoded Cashu token string */
  token: string;
  /** Amount in sats */
  amount: number;
}

export interface ProofStateResult {
  secret: string;
  state: string;
  amount: number;
}

// ---------------------------------------------------------------------------
// Lazy singleton
// ---------------------------------------------------------------------------

let _wallet: Wallet | null = null;

function getMintUrl(): string {
  const cfg = getCashuConfig();
  if (!cfg.CASHU_MINT_URL) {
    throw new Error("CASHU_MINT_URL not configured. Set it in .env to use Cashu.");
  }
  return cfg.CASHU_MINT_URL;
}

export async function getCashuWallet(): Promise<Wallet> {
  if (!_wallet) {
    const mintUrl = getMintUrl();
    _wallet = new Wallet(mintUrl, { unit: "sat" });
    await _wallet.loadMint();
  }
  return _wallet;
}

// ---------------------------------------------------------------------------
// High-level operations
// ---------------------------------------------------------------------------

/** Get current Cashu ecash balance. */
export async function getCashuBalance(): Promise<CashuBalanceInfo> {
  const mintUrl = getMintUrl();
  const proofs = await loadProofs(mintUrl);
  const total = proofs.reduce((sum, p) => sum + p.amount, 0);
  return {
    total,
    proofCount: proofs.length,
    mintUrl,
  };
}

/**
 * Mint new Cashu tokens by paying a Lightning invoice from Ark wallet.
 *
 * Flow:
 * 1. Request mint quote (Mint returns a Lightning invoice)
 * 2. Pay that invoice via Ark wallet (Boltz submarine swap)
 * 3. Wait for payment confirmation
 * 4. Get proofs from mint
 * 5. Store proofs locally
 */
export async function mintTokens(amountSats: number): Promise<MintResult> {
  const cfg = getCashuConfig();
  const mintUrl = getMintUrl();

  // Check balance limit
  const currentBalance = await getTotalBalance(mintUrl);
  if (currentBalance + amountSats > cfg.CASHU_MAX_BALANCE_SATS) {
    throw new Error(
      `Minting ${amountSats} sats would exceed CASHU_MAX_BALANCE_SATS (${cfg.CASHU_MAX_BALANCE_SATS}). ` +
        `Current balance: ${currentBalance} sats.`,
    );
  }

  const wallet = await getCashuWallet();

  // 1. Request mint quote — mint returns a Lightning invoice
  const mintQuote = await wallet.createMintQuoteBolt11(amountSats);

  // 2. Pay the Lightning invoice via Ark wallet
  const payResult = await payLightningInvoice(mintQuote.request);
  if (!payResult.preimage) {
    throw new Error("Failed to pay mint's Lightning invoice via Ark wallet");
  }

  // 3. Poll until quote is paid (mint needs to see the payment)
  let quote: MintQuoteBolt11Response;
  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    quote = await wallet.checkMintQuoteBolt11(mintQuote.quote);
    if (quote.state === "PAID" || quote.state === "ISSUED") break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  // 4. Get proofs from mint
  const proofs = await wallet.mintProofsBolt11(amountSats, mintQuote.quote);

  // 5. Store proofs
  await addProofs(mintUrl, proofs);

  return {
    proofs,
    amount: proofs.reduce((sum, p) => sum + p.amount, 0),
    quoteId: mintQuote.quote,
  };
}

/**
 * Melt Cashu tokens to pay a Lightning invoice.
 *
 * Flow:
 * 1. Request melt quote (get fee estimate)
 * 2. Select proofs to cover amount + fee_reserve
 * 3. Melt proofs (mint pays the Lightning invoice)
 * 4. Update stored proofs (remove spent, add change)
 */
export async function meltTokens(bolt11: string): Promise<MeltResult> {
  const mintUrl = getMintUrl();
  const wallet = await getCashuWallet();

  // 1. Get melt quote (amount + fee estimate)
  const meltQuote = await wallet.createMeltQuoteBolt11(bolt11);
  const totalNeeded = meltQuote.amount + meltQuote.fee_reserve;

  // 2. Load and select proofs
  const allProofs = await loadProofs(mintUrl);
  const totalAvailable = allProofs.reduce((sum, p) => sum + p.amount, 0);
  if (totalAvailable < totalNeeded) {
    throw new Error(
      `Insufficient Cashu balance. Need ${totalNeeded} sats (${meltQuote.amount} + ${meltQuote.fee_reserve} fee), ` +
        `have ${totalAvailable} sats.`,
    );
  }

  // Use wallet's proof selection
  const { send: proofsToSend, keep: proofsToKeep } = wallet.selectProofsToSend(
    allProofs,
    totalNeeded,
    true, // includeFees
  );

  // 3. Melt proofs — mint pays the Lightning invoice
  const meltResult: MeltProofsResponse<MeltQuoteBolt11Response> =
    await wallet.meltProofsBolt11(meltQuote, proofsToSend);

  // 4. Update stored proofs
  // Keep unselected proofs + change from overpaid fees
  const remainingProofs = [...proofsToKeep, ...meltResult.change];
  await saveProofs(mintUrl, remainingProofs);

  const actualFee = meltQuote.fee_reserve -
    meltResult.change.reduce((sum, p) => sum + p.amount, 0);

  return {
    paid: meltResult.quote.state === "PAID",
    preimage: meltResult.quote.payment_preimage,
    amount: meltQuote.amount,
    fee: actualFee,
    change: meltResult.change,
  };
}

/**
 * Receive external Cashu tokens (swap with mint for fresh proofs).
 */
export async function receiveTokens(encodedToken: string): Promise<ReceiveResult> {
  const mintUrl = getMintUrl();
  const wallet = await getCashuWallet();

  // Decode to validate
  const decoded = getDecodedToken(encodedToken);
  if (decoded.mint !== mintUrl) {
    throw new Error(
      `Token is from mint ${decoded.mint}, but wallet is configured for ${mintUrl}. ` +
        "Cross-mint receive is not supported.",
    );
  }

  // Swap with mint for fresh proofs
  const newProofs = await wallet.receive(encodedToken);

  // Store fresh proofs
  await addProofs(mintUrl, newProofs);

  return {
    proofs: newProofs,
    amount: newProofs.reduce((sum, p) => sum + p.amount, 0),
  };
}

/**
 * Create a Cashu token string to send to someone.
 */
export async function sendTokens(amountSats: number): Promise<SendResult> {
  const mintUrl = getMintUrl();
  const wallet = await getCashuWallet();

  const allProofs = await loadProofs(mintUrl);
  const totalAvailable = allProofs.reduce((sum, p) => sum + p.amount, 0);
  if (totalAvailable < amountSats) {
    throw new Error(
      `Insufficient balance. Need ${amountSats} sats, have ${totalAvailable} sats.`,
    );
  }

  // Split proofs: keep + send
  const { send: sendProofs, keep: keepProofs } = await wallet.send(amountSats, allProofs, {
    includeFees: true,
  });

  // Encode send proofs as a Cashu token string
  const token = getEncodedToken({ mint: mintUrl, proofs: sendProofs });

  // Update store: keep only the remaining proofs
  await saveProofs(mintUrl, keepProofs);

  return {
    token,
    amount: sendProofs.reduce((sum, p) => sum + p.amount, 0),
  };
}

/**
 * Check the state of stored proofs (unspent/spent/pending).
 * Removes any spent proofs from the store.
 */
export async function checkProofStates(): Promise<ProofStateResult[]> {
  const mintUrl = getMintUrl();
  const wallet = await getCashuWallet();
  const allProofs = await loadProofs(mintUrl);

  if (allProofs.length === 0) {
    return [];
  }

  const states: ProofState[] = await wallet.checkProofsStates(allProofs);

  // Build results
  const results: ProofStateResult[] = states.map((s, i) => ({
    secret: typeof allProofs[i].secret === "string"
      ? allProofs[i].secret as string
      : JSON.stringify(allProofs[i].secret),
    state: s.state,
    amount: allProofs[i].amount,
  }));

  // Remove spent proofs from store
  const spentSecrets = results
    .filter((r) => r.state === CheckStateEnum.SPENT)
    .map((r) => r.secret);

  if (spentSecrets.length > 0) {
    await removeProofs(mintUrl, spentSecrets);
  }

  return results;
}

/** Get information about the configured Cashu mint. */
export async function getMintInfo(): Promise<Record<string, unknown>> {
  const wallet = await getCashuWallet();
  const info = wallet.getMintInfo();
  return info as unknown as Record<string, unknown>;
}
