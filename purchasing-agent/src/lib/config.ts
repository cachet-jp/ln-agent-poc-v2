import { z } from "zod";
import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, "../../.env") });

const optStr = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().min(1).optional(),
);
const optUrl = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().url().optional(),
);

const optHexKey = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "CASHU_STORE_KEY must be 64 hex characters (32 bytes), e.g. `openssl rand -hex 32`")
    .optional(),
);
const optAbsPath = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z
    .string()
    .refine((p) => p.startsWith("/"), "must be an absolute path")
    .optional(),
);

const configSchema = z.object({
  // Cashu ecash
  CASHU_MINT_URL: optUrl,
  CASHU_STORE_KEY: optHexKey,
  CASHU_MAX_BALANCE_SATS: z.coerce.number().positive().default(1_000_000),
  CASHU_PREFERRED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),

  // Bitrefill
  // BITREFILL_API_KEY: single API key for CLI (primary, from bitrefill.com/account/developers)
  // BITREFILL_API_ID / BITREFILL_API_SECRET: used by official bitrefill-mcp-server (backward compat)
  BITREFILL_API_KEY: optStr,
  BITREFILL_API_ID: optStr,
  BITREFILL_API_SECRET: optStr,
  // Optional absolute path to the @bitrefill/cli binary. When set, the agent
  // runs exactly this binary instead of resolving `bitrefill` from PATH —
  // prevents a PATH-hijack from handing BITREFILL_API_KEY to a rogue binary.
  BITREFILL_CLI_PATH: optAbsPath,

  // UseBitcoin.jp REST API
  USEBITCOIN_API_KEY: optStr,
  USEBITCOIN_API_BASE_URL: z
    .string()
    .url()
    // Enforce https: the bearer API key is sent on every request, so a
    // cleartext http:// override would leak it and an http target is the usual
    // SSRF-to-internal-metadata vector. Self-hosted test servers must use https.
    .refine((u) => {
      try {
        return new URL(u).protocol === "https:";
      } catch {
        return false;
      }
    }, "USEBITCOIN_API_BASE_URL must use https://")
    .default("https://usebitcoin.jp/api/v1"),

  // Guardrails
  MAX_SPEND_JPY: z.coerce.number().positive().default(5000),
  // Absolute per-payment ceiling in sats, enforced at the melt chokepoint
  // independent of any vendor-quoted price. Backstops every payment path
  // (UseBitcoin, Bitrefill, user-paste melt) against an inflated invoice from
  // a compromised/MITM'd vendor or a runaway agent loop. Tune to your wallet.
  MAX_SPEND_SATS: z.coerce.number().int().positive().default(100_000),

  // Browser (V-Preca inquiry uses Playwright against Lifecard)
  HEADLESS: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
});

export type Config = z.infer<typeof configSchema>;

let _config: Config | null = null;

export function getConfig(): Config {
  if (!_config) {
    _config = configSchema.parse(process.env);
  }
  return _config;
}
