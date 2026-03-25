/**
 * Cashu ecash configuration — thin wrapper over main config.
 */

import { getConfig } from "./config.js";

export interface CashuConfig {
  CASHU_MINT_URL?: string;
  CASHU_STORE_KEY?: string;
  CASHU_MAX_BALANCE_SATS: number;
  CASHU_PREFERRED: boolean;
}

export function getCashuConfig(): CashuConfig {
  const cfg = getConfig();
  return {
    CASHU_MINT_URL: cfg.CASHU_MINT_URL,
    CASHU_STORE_KEY: cfg.CASHU_STORE_KEY,
    CASHU_MAX_BALANCE_SATS: cfg.CASHU_MAX_BALANCE_SATS,
    CASHU_PREFERRED: cfg.CASHU_PREFERRED,
  };
}

/** Check whether Cashu is configured (mint URL is set). */
export function isCashuEnabled(): boolean {
  return !!getCashuConfig().CASHU_MINT_URL;
}
