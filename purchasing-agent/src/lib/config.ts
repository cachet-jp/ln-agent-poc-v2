import { z } from "zod";
import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Load .env from the purchasing-agent package root (not CWD)
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, "../../.env"), override: true });

// Treat empty strings as undefined (Claude Desktop passes "" for unset env vars)
const optStr = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().min(1).optional(),
);
const optUrl = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().url().optional(),
);
const optUuid = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().uuid().optional(),
);

const configSchema = z.object({
  // Amazon
  AMAZON_EMAIL: optStr,
  AMAZON_PASSWORD: optStr,

  // clw.cash / Ark
  CLW_API_BASE_URL: z.string().url().default("https://api.clw.cash"),
  CLW_SESSION_TOKEN: optStr,
  CLW_IDENTITY_ID: optUuid,
  CLW_PUBLIC_KEY: optStr,
  CLW_ARK_SERVER_URL: optUrl,

  // Guardrails
  MAX_SPEND_JPY: z.coerce.number().positive().default(5000),

  // Browser
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
