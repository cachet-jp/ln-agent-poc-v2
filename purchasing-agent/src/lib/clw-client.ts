/**
 * clw.cash SDK integration — wraps ArkadeBitcoinSkill + ArkadeLightningSkill
 *
 * Uses @clw-cash/skills linked from the claw-cash submodule.
 * Run with `tsx` (not plain `node`) since linked packages export TypeScript.
 */

import { getConfig } from "./config.js";
import {
  createClwBitcoinSkill,
  createClwLightningSkill,
  type ClwSkillConfig,
} from "@clw-cash/skills";
import type { ArkadeBitcoinSkill } from "@clw-cash/skills";

// Re-export types for consumers
export type { ClwSkillConfig };

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

let _bitcoinSkill: Awaited<ReturnType<typeof createClwBitcoinSkill>> | null = null;
let _lightningSkill: Awaited<ReturnType<typeof createClwLightningSkill>> | null = null;

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

export async function getBitcoinSkill() {
  if (!_bitcoinSkill) {
    _bitcoinSkill = await createClwBitcoinSkill(getClwConfig());
  }
  return _bitcoinSkill;
}

export async function getLightningSkill() {
  if (!_lightningSkill) {
    _lightningSkill = await createClwLightningSkill({
      ...getClwConfig(),
      network: "bitcoin", // mainnet
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

export async function payLightningInvoice(bolt11: string): Promise<PaymentResult> {
  const skill = await getLightningSkill();
  return skill.payInvoice({ bolt11 });
}
