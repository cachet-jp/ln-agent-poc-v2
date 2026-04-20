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
// Lazy import — clw-client depends on claw-cash submodule which may not be available.
// Only mintTokens() needs it (to pay the mint's Lightning invoice via Ark).
async function getPayLightningInvoice() {
  const { payLightningInvoice } = await import("./clw-client.js");
  return payLightningInvoice;
}

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

export interface MintInvoiceResult {
  /** Mint quote ID — needed to check status and claim proofs */
  quoteId: string;
  /** BOLT11 Lightning invoice to pay */
  bolt11: string;
  /** Amount in sats */
  amount: number;
  /** QR code as PNG base64 data URL (data:image/png;base64,...) */
  qrDataUrl: string;
  /** Quote expiry (unix timestamp) */
  expiry: number;
}

export interface MintInvoiceCheckResult {
  /** Quote ID */
  quoteId: string;
  /** Current state: UNPAID, PAID, ISSUED */
  state: string;
  /** Whether proofs have been claimed and added to wallet */
  claimed: boolean;
  /** Amount of proofs claimed (0 if not yet claimed) */
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
  const payLightningInvoice = await getPayLightningInvoice();
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

  // Swap with mint for fresh proofs. requireDleq asks the mint for DLEQ
  // proofs alongside blind signatures and rejects the token if any are
  // missing or invalid — catches tampered / malformed tokens before they
  // enter our store.
  const newProofs = await wallet.receive(encodedToken, { requireDleq: true });

  // Store fresh proofs
  await addProofs(mintUrl, newProofs);

  return {
    proofs: newProofs,
    amount: newProofs.reduce((sum, p) => sum + p.amount, 0),
  };
}

/**
 * Create a Cashu token string to send to someone.
 *
 * Self-swap verification: after wallet.send() produces the send proofs,
 * we round-trip them through the mint via wallet.receive() to confirm
 * the blind signatures are valid. Without this, a malformed proof is
 * only detected by the recipient at spend time — and by then our
 * original inputs are already burned at the mint. See the tender-elgamal
 * 2026-04-02 incident: 1,573 sats were lost to exactly this path.
 *
 * Trade-off: one extra mint round-trip and a potential extra swap fee
 * (typically 0-few sats). Cheap insurance against proof loss.
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
  const { send: sendProofs, keep: keepProofs } = await wallet.send(
    amountSats,
    allProofs,
    { includeFees: true },
  );

  // Self-swap: re-spend sendProofs against the mint to get verified replacement
  // proofs. If any blind signature is malformed, this throws here (before
  // the token reaches the recipient).
  const unverifiedToken = getEncodedToken({ mint: mintUrl, proofs: sendProofs });
  let verifiedProofs: Proof[];
  try {
    verifiedProofs = await wallet.receive(unverifiedToken);
  } catch (err) {
    // sendProofs are broken. Persist keepProofs so we don't compound the
    // loss by also dropping the change.
    await saveProofs(mintUrl, keepProofs);
    const burnedAmount = sendProofs.reduce((sum, p) => sum + p.amount, 0);
    throw new Error(
      `Cashu send failed self-swap verification: ${(err as Error).message}. ` +
        `${burnedAmount} sats may be stranded at the mint.`,
    );
  }

  const token = getEncodedToken({ mint: mintUrl, proofs: verifiedProofs });

  // Update store: keep only the remaining proofs (sendProofs are SPENT at
  // the mint; verifiedProofs leave with the recipient).
  await saveProofs(mintUrl, keepProofs);

  return {
    token,
    amount: verifiedProofs.reduce((sum, p) => sum + p.amount, 0),
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

// ---------------------------------------------------------------------------
// Mint invoice (Lightning → Cashu top-up)
// ---------------------------------------------------------------------------

/**
 * Create a Lightning invoice via Cashu mint for topping up the ecash wallet.
 *
 * Anyone can pay this invoice (from any Lightning wallet).
 * After payment, call `claimMintInvoice(quoteId)` to claim the ecash proofs.
 */
export async function createMintInvoice(amountSats: number): Promise<MintInvoiceResult> {
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

  // Request mint quote — mint returns a Lightning invoice
  const mintQuote = await wallet.createMintQuoteBolt11(amountSats);

  // Generate QR code from bolt11 invoice
  const QRCode = await import("qrcode");
  const qrDataUrl = await QRCode.toDataURL(mintQuote.request.toUpperCase(), {
    type: "image/png",
    width: 400,
    margin: 2,
    errorCorrectionLevel: "M",
  });

  return {
    quoteId: mintQuote.quote,
    bolt11: mintQuote.request,
    amount: amountSats,
    qrDataUrl,
    expiry: mintQuote.expiry,
  };
}

/**
 * Check if a mint invoice has been paid and claim the ecash proofs.
 *
 * Call this after `createMintInvoice()` once the Lightning invoice is paid.
 * Can be called multiple times safely — only claims once.
 */
export async function claimMintInvoice(quoteId: string, amountSats: number): Promise<MintInvoiceCheckResult> {
  const mintUrl = getMintUrl();
  const wallet = await getCashuWallet();

  // Check quote status
  const quote = await wallet.checkMintQuoteBolt11(quoteId);

  if (quote.state === "UNPAID") {
    return { quoteId, state: "UNPAID", claimed: false, amount: 0 };
  }

  if (quote.state === "ISSUED") {
    // Already claimed in a previous call
    return { quoteId, state: "ISSUED", claimed: true, amount: amountSats };
  }

  if (quote.state === "PAID") {
    // Payment confirmed — claim proofs from mint
    const proofs = await wallet.mintProofsBolt11(amountSats, quoteId);
    await addProofs(mintUrl, proofs);

    const claimedAmount = proofs.reduce((sum, p) => sum + p.amount, 0);
    return { quoteId, state: "ISSUED", claimed: true, amount: claimedAmount };
  }

  return { quoteId, state: quote.state, claimed: false, amount: 0 };
}

/** Get information about the configured Cashu mint. */
export async function getMintInfo(): Promise<Record<string, unknown>> {
  const wallet = await getCashuWallet();
  const info = wallet.getMintInfo();
  // MintInfo wraps the raw data in _mintInfo
  const raw = (info as any)._mintInfo ?? info;
  return {
    name: raw.name,
    version: raw.version,
    description: raw.description,
    description_long: raw.description_long,
    contact: raw.contact,
    motd: raw.motd,
    nuts: raw.nuts,
    mintUrl: getMintUrl(),
  };
}
