/**
 * clw.cash SDK integration — wraps ArkadeBitcoinSkill + ArkadeLightningSkill
 *
 * Uses @clw-cash/skills linked from the claw-cash submodule.
 * Run with `tsx` (not plain `node`) since linked packages export TypeScript.
 */

import { getConfig } from "./config.js";
// Import directly from sub-modules to avoid pulling in @lendasat/lendaswap-sdk-pure
// (which has broken ESM exports) via the @clw-cash/skills barrel index.
// Uses relative paths because the link package's exports field only exposes ".".
import { Wallet } from "@arkade-os/sdk";
import { ArkadeBitcoinSkill } from "../../claw-cash/skills/src/skills/arkadeBitcoin.js";
import {
  ArkadeLightningSkill,
  type ArkadeLightningSkillConfig,
} from "../../claw-cash/skills/src/skills/lightning.js";
import { RemoteSignerIdentity } from "@clw-cash/sdk";

export interface ClwSkillConfig {
  apiBaseUrl: string;
  sessionToken: string;
  identityId: string;
  publicKey: string;
  arkServerUrl: string;
}

export interface BalanceInfo {
  total: number;
  offchain: {
    settled: number;
    preconfirmed: number;
    available: number;
    recoverable: number;
  };
  onchain: {
    confirmed: number;
    unconfirmed: number;
    total: number;
  };
}

export interface BitcoinAddress {
  address: string;
  type: "ark" | "boarding" | "onchain";
  description: string;
}

export interface PaymentResult {
  preimage: string;
  amount: number;
  txid: string;
}

// ---------------------------------------------------------------------------
// Lazy singleton — initialized on first use
// ---------------------------------------------------------------------------

let _bitcoinSkill: ArkadeBitcoinSkill | null = null;
let _lightningSkill: ArkadeLightningSkill | null = null;

function getClwConfig(): ClwSkillConfig {
  const cfg = getConfig();
  if (!cfg.CLW_SESSION_TOKEN || !cfg.CLW_IDENTITY_ID || !cfg.CLW_PUBLIC_KEY || !cfg.CLW_ARK_SERVER_URL) {
    throw new Error(
      "Missing clw.cash config. Set CLW_SESSION_TOKEN, CLW_IDENTITY_ID, CLW_PUBLIC_KEY, CLW_ARK_SERVER_URL in .env",
    );
  }
  return {
    apiBaseUrl: cfg.CLW_API_BASE_URL,
    sessionToken: cfg.CLW_SESSION_TOKEN,
    identityId: cfg.CLW_IDENTITY_ID,
    publicKey: cfg.CLW_PUBLIC_KEY,
    arkServerUrl: cfg.CLW_ARK_SERVER_URL,
  };
}

async function createWallet(config: ClwSkillConfig): Promise<Wallet> {
  const identity = new RemoteSignerIdentity({
    apiBaseUrl: config.apiBaseUrl,
    identityId: config.identityId,
    sessionToken: config.sessionToken,
    compressedPublicKey: config.publicKey,
  });
  return Wallet.create({ identity, arkServerUrl: config.arkServerUrl });
}

export async function getBitcoinSkill() {
  if (!_bitcoinSkill) {
    const wallet = await createWallet(getClwConfig());
    _bitcoinSkill = new ArkadeBitcoinSkill(wallet);
  }
  return _bitcoinSkill;
}

export async function getLightningSkill() {
  if (!_lightningSkill) {
    const config = getClwConfig();
    const wallet = await createWallet(config);
    _lightningSkill = new ArkadeLightningSkill({
      wallet,
      network: "bitcoin", // mainnet
      enableSwapManager: true,
    });
  }
  return _lightningSkill;
}

// ---------------------------------------------------------------------------
// High-level operations used by MCP tools
// ---------------------------------------------------------------------------

export async function getBalance(): Promise<BalanceInfo> {
  const skill = await getBitcoinSkill();
  return skill.getBalance();
}

export async function getReceiveAddresses(): Promise<BitcoinAddress[]> {
  const skill = await getBitcoinSkill();
  return skill.getReceiveAddresses();
}

export interface LightningInvoice {
  bolt11: string;
  paymentHash: string;
  amount: number;
  description?: string;
  expirySeconds: number;
  createdAt: Date;
  preimage?: string;
}

export async function createLightningInvoice(
  amount: number,
  description?: string,
): Promise<LightningInvoice> {
  const skill = await getLightningSkill();
  return skill.createInvoice({ amount, description });
}

export async function payLightningInvoice(bolt11: string): Promise<PaymentResult> {
  const skill = await getLightningSkill();
  return skill.payInvoice({ bolt11 });
}

// ---------------------------------------------------------------------------
// Onboarding: convert boarding UTXOs to offchain vTXOs
// ---------------------------------------------------------------------------

export interface OnboardResult {
  commitmentTxid: string;
  amount: number;
}

/**
 * Onboard boarding UTXOs into Ark offchain vTXOs.
 * Fetches current fee info from the Ark server and settles all boarding UTXOs.
 */
export async function onboardBoardingUtxos(): Promise<OnboardResult> {
  // Ensure TreeSignerSession is loaded (required for settle/onboard)
  await RemoteSignerIdentity.init();

  const skill = await getBitcoinSkill();
  const wallet = skill.getWallet();

  // Get current fee info from the Ark server
  const info = await wallet.arkProvider.getInfo();
  const feeInfo = info.fees;

  const result = await skill.onboard({ feeInfo });
  return {
    commitmentTxid: result.commitmentTxid,
    amount: Number(result.amount),
  };
}
