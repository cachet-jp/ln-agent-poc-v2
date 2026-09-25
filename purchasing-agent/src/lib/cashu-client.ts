import {
  Wallet,
  getEncodedToken,
  getTokenMetadata,
  type Token as CashuToken,
  CheckStateEnum,
  type Proof,
  type MeltQuoteBolt11Response,
  type MeltProofsResponse,
  type ProofState,
} from "@cashu/cashu-ts";
import { getCashuConfig } from "./cashu-config.js";
import { normalizeCashuTokenEncoding } from "./cashu-token-normalize.js";
import { getConfig } from "./config.js";
import { renderBolt11Qr } from "./qr.js";
import {
  loadProofs,
  addProofs,
  saveProofs,
  removeProofs,
  getTotalBalance,
  getMintBalances,
  type MintBalance,
  assertStoreReady,
} from "./cashu-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CashuBalanceInfo {
  /** Total ecash balance in sats */
  total: number;
  /** Number of proofs held (across all mints) */
  proofCount: number;
  /** Primary mint URL (configured home mint, or the first held mint) */
  mintUrl: string;
  /** Per-mint balance breakdown */
  mints: MintBalance[];
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
  /** Mint the token (and the received proofs) belong to */
  mintUrl: string;
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

// One wallet per mint URL. Cashu proofs are mint-specific, so received ecash
// from any sender's mint gets its own wallet and is immediately spendable.
const _wallets = new Map<string, Wallet>();

/** The configured "home" mint (used for top-ups), or undefined if unset. */
function getConfiguredMintUrl(): string | undefined {
  return getCashuConfig().CASHU_MINT_URL;
}

function getMintUrl(): string {
  const url = getConfiguredMintUrl();
  if (!url) {
    throw new Error("CASHU_MINT_URL not configured. Set it in .env to use Cashu.");
  }
  return url;
}

export async function getCashuWallet(mintUrl: string = getMintUrl()): Promise<Wallet> {
  let wallet = _wallets.get(mintUrl);
  if (!wallet) {
    wallet = new Wallet(mintUrl, { unit: "sat" });
    await wallet.loadMint();
    _wallets.set(mintUrl, wallet);
  }
  return wallet;
}

/**
 * Order candidate mints for spending: the configured home mint first, then by
 * balance descending. A single Cashu payment can only draw from one mint, so
 * spends pick the first mint that can cover the amount.
 */
function orderMintsForSpend(balances: MintBalance[]): MintBalance[] {
  const configured = getConfiguredMintUrl();
  return [...balances].sort((a, b) => {
    if (a.mintUrl === configured) return -1;
    if (b.mintUrl === configured) return 1;
    return b.balance - a.balance;
  });
}

// ---------------------------------------------------------------------------
// High-level operations
// ---------------------------------------------------------------------------

/** Get current Cashu ecash balance, aggregated across every held mint. */
export async function getCashuBalance(): Promise<CashuBalanceInfo> {
  const mints = await getMintBalances();
  const total = mints.reduce((sum, m) => sum + m.balance, 0);
  const proofCount = mints.reduce((sum, m) => sum + m.proofCount, 0);
  const primary = getConfiguredMintUrl() ?? mints[0]?.mintUrl ?? "";
  return { total, proofCount, mintUrl: primary, mints };
}

/**
 * Melt Cashu tokens to pay a Lightning invoice.
 *
 * A single Cashu payment can only draw from one mint, so we try mints in spend
 * order (home mint first, then by balance) and pay from the first that can
 * cover the invoice — making ecash received from any mint immediately usable.
 *
 * Per mint:
 * 1. Request melt quote (amount + fee estimate)
 * 2. Select proofs to cover amount + fee_reserve
 * 3. Melt proofs (mint pays the Lightning invoice)
 * 4. Update stored proofs (remove spent, add change)
 */
export async function meltTokens(bolt11: string): Promise<MeltResult> {
  await assertStoreReady();
  const { MAX_SPEND_SATS } = getConfig();

  const candidates = orderMintsForSpend(await getMintBalances());
  if (candidates.length === 0) {
    throw new Error("No Cashu balance available to pay this invoice.");
  }

  let amountChecked = false;
  let shortfall = "";
  for (const cand of candidates) {
    const wallet = await getCashuWallet(cand.mintUrl);

    // 1. Get melt quote (amount + fee estimate). The amount is the invoice's,
    //    identical across mints; only fee_reserve differs.
    const meltQuote = await wallet.createMeltQuoteBolt11(bolt11);

    // Absolute spend ceiling: the mint-decoded quote amount is the real number
    // of sats leaving the wallet. Gate it against MAX_SPEND_SATS — the single
    // money-exit point — before paying. Check once (amount is mint-independent).
    if (!amountChecked) {
      if (meltQuote.amount > MAX_SPEND_SATS) {
        throw new Error(
          `Payment of ${meltQuote.amount} sats exceeds MAX_SPEND_SATS (${MAX_SPEND_SATS}) — refusing to pay. ` +
            `Raise MAX_SPEND_SATS to authorize larger single payments.`,
        );
      }
      amountChecked = true;
    }

    const totalNeeded = meltQuote.amount + meltQuote.fee_reserve;

    // 2. Load and select proofs for this mint
    const allProofs = await loadProofs(cand.mintUrl);
    const totalAvailable = allProofs.reduce((sum, p) => sum + p.amount, 0);
    if (totalAvailable < totalNeeded) {
      shortfall = `mint ${cand.mintUrl}: need ${totalNeeded} sats, have ${totalAvailable}`;
      continue; // try the next mint
    }

    const { send: proofsToSend, keep: proofsToKeep } = wallet.selectProofsToSend(
      allProofs,
      totalNeeded,
      true, // includeFees
    );

    // 3. Melt proofs — mint pays the Lightning invoice
    const meltResult: MeltProofsResponse<MeltQuoteBolt11Response> =
      await wallet.meltProofsBolt11(meltQuote, proofsToSend);

    // 4. Update stored proofs: keep unselected proofs + change from overpaid fees
    const remainingProofs = [...proofsToKeep, ...meltResult.change];
    await saveProofs(cand.mintUrl, remainingProofs);

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

  const total = candidates.reduce((sum, m) => sum + m.balance, 0);
  throw new Error(
    `No single mint can cover this invoice — Cashu can't combine balances across mints in one payment ` +
      `(total held: ${total} sats across ${candidates.length} mint(s); ${shortfall}). ` +
      `Consolidate funds into one mint first.`,
  );
}

/**
 * Receive external Cashu tokens (swap with mint for fresh proofs).
 *
 * The token's own mint is used and auto-associated: ecash from any sender's
 * mint is accepted and stored under that mint, so it's immediately spendable
 * without pre-configuring the mint. (You implicitly trust whatever mint the
 * sender's ecash is held against — inherent to Cashu's bearer model.)
 */
export async function receiveTokens(encodedToken: string): Promise<ReceiveResult> {
  await assertStoreReady();

  // Some wallets (Minibits) emit cashuB tokens as indefinite-length CBOR,
  // which cashu-ts 3.x rejects ("Unsupported length: 31") — re-frame first.
  encodedToken = normalizeCashuTokenEncoding(encodedToken);

  // Use getTokenMetadata to safely extract mint info without needing keysets.
  // This handles both v1 (long keyset IDs) and v2 (short keyset IDs) tokens.
  const meta = getTokenMetadata(encodedToken);
  const mintUrl = meta.mint;
  if (!mintUrl) {
    throw new Error("Cashu token does not specify a mint — cannot receive.");
  }
  // The mint URL is attacker-controlled (it comes from the token), and receiving
  // fetches the mint's keys from it. Require https to avoid an http/internal-host
  // SSRF on receive and to keep mint traffic encrypted.
  if (!/^https:\/\//i.test(mintUrl)) {
    throw new Error(`Refusing to receive: the token's mint URL is not https (${mintUrl}).`);
  }

  const wallet = await getCashuWallet(mintUrl);

  // DLEQ (NUT-12) is optional — many wallets (e.g. Minibits) send tokens
  // without it. Enforce it only when the token carries DLEQ data, so present
  // ones are verified but bare tokens still work; either way the mint swap
  // below rejects forged proofs before they enter our store.
  const allHaveDleq =
    meta.incompleteProofs.length > 0 && meta.incompleteProofs.every((p) => p.dleq);
  const newProofs = await wallet.receive(encodedToken, { requireDleq: allHaveDleq });

  // Store fresh proofs under the token's mint.
  await addProofs(mintUrl, newProofs);

  return {
    proofs: newProofs,
    amount: newProofs.reduce((sum, p) => sum + p.amount, 0),
    mintUrl,
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
  await assertStoreReady();

  // A token is mint-specific, so send from one mint that can cover the amount
  // (home mint first, then largest balance).
  const candidates = orderMintsForSpend(await getMintBalances());
  const chosen = candidates.find((m) => m.balance >= amountSats);
  if (!chosen) {
    const total = candidates.reduce((sum, m) => sum + m.balance, 0);
    const largest = candidates[0]?.balance ?? 0;
    throw new Error(
      `Insufficient balance in any single mint. Need ${amountSats} sats; largest mint holds ${largest} ` +
        `(total ${total} across ${candidates.length} mint(s)). Cashu tokens can't span mints.`,
    );
  }
  const mintUrl = chosen.mintUrl;
  const wallet = await getCashuWallet(mintUrl);

  const allProofs = await loadProofs(mintUrl);

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
 * Check the state of stored proofs (unspent/spent/pending) across every held
 * mint. Removes any spent proofs from each mint's store.
 */
export async function checkProofStates(): Promise<ProofStateResult[]> {
  const mints = await getMintBalances();
  const results: ProofStateResult[] = [];

  for (const mint of mints) {
    const wallet = await getCashuWallet(mint.mintUrl);
    const allProofs = await loadProofs(mint.mintUrl);
    if (allProofs.length === 0) {
      continue;
    }

    const states: ProofState[] = await wallet.checkProofsStates(allProofs);

    const mintResults: ProofStateResult[] = states.map((s, i) => ({
      secret: typeof allProofs[i].secret === "string"
        ? allProofs[i].secret as string
        : JSON.stringify(allProofs[i].secret),
      state: s.state,
      amount: allProofs[i].amount,
    }));
    results.push(...mintResults);

    // Remove this mint's spent proofs
    const spentSecrets = mintResults
      .filter((r) => r.state === CheckStateEnum.SPENT)
      .map((r) => r.secret);
    if (spentSecrets.length > 0) {
      await removeProofs(mint.mintUrl, spentSecrets);
    }
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

  const { dataUrl: qrDataUrl } = await renderBolt11Qr(mintQuote.request, { width: 400 });

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
  await assertStoreReady();
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
