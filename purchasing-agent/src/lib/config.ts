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

const configSchema = z.object({
  // Cashu ecash
  CASHU_MINT_URL: optUrl,
  CASHU_STORE_KEY: optStr,
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

  // UseBitcoin.jp REST API
  USEBITCOIN_API_KEY: optStr,
  USEBITCOIN_API_BASE_URL: z
    .string()
    .url()
    .default("https://usebitcoin.jp/api/v1"),

  // Guardrails
  MAX_SPEND_JPY: z.coerce.number().positive().default(5000),

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
