/**
 * Refresh CLW session token via challenge/verify flow.
 *
 * Usage: npx tsx scripts/refresh-token.ts
 *
 * This script:
 * 1. Requests a challenge from the CLW API
 * 2. Displays a QR code + deep_link for Telegram confirmation
 * 3. Polls until the challenge is confirmed
 * 4. Prints the new session token (for .env update)
 * 5. Optionally auto-updates .env with --write flag
 */
import dotenv from "dotenv";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, "../.env");

const API_BASE_URL = process.env.CLW_API_BASE_URL || "https://api.clw.cash";
const IDENTITY_ID = process.env.CLW_IDENTITY_ID;
const PUBLIC_KEY = process.env.CLW_PUBLIC_KEY;

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 180_000; // 3 minutes (was 2 min, extended for QR scan time)

const AUTO_WRITE = process.argv.includes("--write");

// Load qrcode-terminal (CJS module)
let generateQR: (url: string, opts: Record<string, unknown>, cb: (qr: string) => void) => void;
try {
  const require2 = createRequire(import.meta.url);
  const qrt = require2("qrcode-terminal");
  generateQR = qrt.generate.bind(qrt);
} catch {
  // Fallback: no QR code display
  generateQR = (_url, _opts, cb) => cb("[QR code unavailable - install qrcode-terminal]");
}

function displayQR(url: string): Promise<void> {
  return new Promise((resolve) => {
    generateQR(url, { small: true }, (qr: string) => {
      console.log("\n" + qr);
      resolve();
    });
  });
}

function updateEnvToken(newToken: string): boolean {
  try {
    let envContent = "";
    try {
      envContent = readFileSync(ENV_PATH, "utf-8");
    } catch {
      // .env doesn't exist, create it
      envContent = "";
    }

    if (envContent.includes("CLW_SESSION_TOKEN=")) {
      envContent = envContent.replace(
        /CLW_SESSION_TOKEN=.*/,
        `CLW_SESSION_TOKEN=${newToken}`
      );
    } else {
      envContent += `\nCLW_SESSION_TOKEN=${newToken}\n`;
    }

    writeFileSync(ENV_PATH, envContent);
    return true;
  } catch (err) {
    console.error("Failed to update .env:", err);
    return false;
  }
}

async function main() {
  console.log(`API: ${API_BASE_URL}`);
  console.log(`Identity: ${IDENTITY_ID}`);
  if (AUTO_WRITE) {
    console.log(`Auto-write: will update ${ENV_PATH}`);
  }

  // Step 1: Request challenge
  console.log("\n=== Step 1: Requesting auth challenge ===");
  const challengeRes = await fetch(`${API_BASE_URL}/v1/auth/challenge`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });

  if (!challengeRes.ok) {
    const text = await challengeRes.text();
    console.error("Challenge failed:", text);
    process.exit(1);
  }

  const challenge = (await challengeRes.json()) as {
    challenge_id: string;
    expires_at: string;
    deep_link: string | null;
  };

  console.log("Challenge ID:", challenge.challenge_id);
  if (challenge.deep_link) {
    console.log("\n📱 Scan this QR code with your phone camera to open Telegram:");
    await displayQR(challenge.deep_link);
    console.log(`\n🔗 Or open this link directly:\n   ${challenge.deep_link}\n`);
  }
  console.log("⏳ Waiting for confirmation (3 min timeout)...\n");

  // Step 2: Poll verify
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let dots = 0;
  while (Date.now() < deadline) {
    const verifyRes = await fetch(`${API_BASE_URL}/v1/auth/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ challenge_id: challenge.challenge_id }),
    });

    if (verifyRes.status === 202) {
      dots++;
      if (dots % 5 === 0) {
        const remaining = Math.round((deadline - Date.now()) / 1000);
        process.stderr.write(`  ...still waiting (${remaining}s remaining)\n`);
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }

    if (verifyRes.ok) {
      const session = (await verifyRes.json()) as {
        token: string;
        expires_in: number;
        user: { id: string; telegram_user_id: string; status: string };
      };

      console.log("\n✅ Login successful!");
      console.log(`User ID: ${session.user.id}`);
      console.log(`Expires in: ${session.expires_in} seconds`);

      if (AUTO_WRITE) {
        if (updateEnvToken(session.token)) {
          console.log(`\n📝 .env updated with new CLW_SESSION_TOKEN`);
        }
      } else {
        console.log(`\nNew token:\n\nCLW_SESSION_TOKEN=${session.token}\n`);
        console.log("💡 Tip: Run with --write to auto-update .env");
      }

      // Restore identity if we have one
      if (IDENTITY_ID && PUBLIC_KEY) {
        console.log("\nRestoring identity...");
        const restoreRes = await fetch(
          `${API_BASE_URL}/v1/identities/${IDENTITY_ID}/restore`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${session.token}`,
            },
            body: JSON.stringify({ public_key: PUBLIC_KEY }),
          }
        );
        if (restoreRes.ok) {
          console.log("✅ Identity restored successfully.");
        } else {
          console.error("Identity restore failed:", await restoreRes.text());
        }
      }

      return;
    }

    const text = await verifyRes.text();
    console.error("Verify failed:", text);
    process.exit(1);
  }

  console.error("Login timed out after 3 minutes.");
  process.exit(1);
}

main().catch(console.error);
