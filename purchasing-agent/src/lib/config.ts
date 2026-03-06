import { z } from "zod";
import { config as dotenvConfig } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Load .env from the purchasing-agent package root (not CWD)
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, "../../.env") });

const configSchema = z.object({
  // Amazon
  AMAZON_EMAIL: z.string().min(1).optional(),
  AMAZON_PASSWORD: z.string().min(1).optional(),

  // clw.cash / Ark
  CLW_API_BASE_URL: z.string().url().default("https://api.clw.cash"),
  CLW_SESSION_TOKEN: z.string().min(1).optional(),
  CLW_IDENTITY_ID: z.string().uuid().optional(),
  CLW_PUBLIC_KEY: z.string().min(1).optional(),
  CLW_ARK_SERVER_URL: z.string().url().optional(),

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
