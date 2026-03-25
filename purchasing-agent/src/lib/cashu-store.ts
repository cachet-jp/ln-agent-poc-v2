/**
 * Cashu proof persistence — encrypted file-based storage.
 *
 * Cashu proofs are bearer instruments: whoever holds them can spend them.
 * We encrypt at rest with AES-256-GCM.
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash, hkdfSync } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import type { Proof } from "@cashu/cashu-ts";
import { getCashuConfig } from "./cashu-config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../../data");
const STORE_FILE = resolve(DATA_DIR, "cashu-proofs.enc.json");

// ---------------------------------------------------------------------------
// Encryption helpers
// ---------------------------------------------------------------------------

function deriveKey(): Buffer {
  const cfg = getCashuConfig();

  if (cfg.CASHU_STORE_KEY) {
    // Use explicit key (must be 32 bytes hex = 64 chars)
    const key = Buffer.from(cfg.CASHU_STORE_KEY, "hex");
    if (key.length !== 32) {
      throw new Error("CASHU_STORE_KEY must be 64 hex characters (32 bytes)");
    }
    return key;
  }

  // Derive from CLW_SESSION_TOKEN via HKDF
  const sessionToken = process.env.CLW_SESSION_TOKEN;
  if (!sessionToken) {
    throw new Error(
      "No CASHU_STORE_KEY or CLW_SESSION_TOKEN available for proof encryption. " +
        "Set CASHU_STORE_KEY (64 hex chars) in .env.",
    );
  }

  const ikm = Buffer.from(sessionToken, "utf-8");
  const salt = Buffer.from("cashu-proof-store-v1", "utf-8");
  const info = Buffer.from("aes-256-gcm", "utf-8");
  return Buffer.from(hkdfSync("sha256", ikm, salt, info, 32));
}

interface EncryptedPayload {
  version: 1;
  iv: string; // hex
  tag: string; // hex
  data: string; // hex
}

function encrypt(plaintext: string): EncryptedPayload {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: 1,
    iv: iv.toString("hex"),
    tag: tag.toString("hex"),
    data: encrypted.toString("hex"),
  };
}

function decrypt(payload: EncryptedPayload): string {
  if (payload.version !== 1) {
    throw new Error(`Unknown store encryption version: ${payload.version}`);
  }
  const key = deriveKey();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(payload.iv, "hex"),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payload.data, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf-8");
}

// ---------------------------------------------------------------------------
// Store data model
// ---------------------------------------------------------------------------

interface StoreData {
  mintUrl: string;
  proofs: Proof[];
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function ensureDataDir(): Promise<void> {
  if (!existsSync(DATA_DIR)) {
    await mkdir(DATA_DIR, { recursive: true });
  }
}

async function readStore(): Promise<StoreData[]> {
  try {
    const raw = await readFile(STORE_FILE, "utf-8");
    const payload: EncryptedPayload = JSON.parse(raw);
    const decrypted = decrypt(payload);
    return JSON.parse(decrypted) as StoreData[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
}

async function writeStore(data: StoreData[]): Promise<void> {
  await ensureDataDir();
  const plaintext = JSON.stringify(data, null, 2);
  const payload = encrypt(plaintext);
  await writeFile(STORE_FILE, JSON.stringify(payload), { mode: 0o600 });
}

function findOrCreate(data: StoreData[], mintUrl: string): StoreData {
  let entry = data.find((d) => d.mintUrl === mintUrl);
  if (!entry) {
    entry = { mintUrl, proofs: [], updatedAt: new Date().toISOString() };
    data.push(entry);
  }
  return entry;
}

/** Load all proofs for a given mint. */
export async function loadProofs(mintUrl: string): Promise<Proof[]> {
  const data = await readStore();
  const entry = data.find((d) => d.mintUrl === mintUrl);
  return entry?.proofs ?? [];
}

/** Replace all proofs for a given mint. */
export async function saveProofs(mintUrl: string, proofs: Proof[]): Promise<void> {
  const data = await readStore();
  const entry = findOrCreate(data, mintUrl);
  entry.proofs = proofs;
  entry.updatedAt = new Date().toISOString();
  await writeStore(data);
}

/** Add new proofs to existing ones. */
export async function addProofs(mintUrl: string, newProofs: Proof[]): Promise<void> {
  const data = await readStore();
  const entry = findOrCreate(data, mintUrl);
  entry.proofs.push(...newProofs);
  entry.updatedAt = new Date().toISOString();
  await writeStore(data);
}

/** Remove spent proofs by their secret. */
export async function removeProofs(mintUrl: string, spentSecrets: string[]): Promise<void> {
  const data = await readStore();
  const entry = data.find((d) => d.mintUrl === mintUrl);
  if (entry) {
    const secretSet = new Set(spentSecrets);
    entry.proofs = entry.proofs.filter((p) => !secretSet.has(typeof p.secret === "string" ? p.secret : JSON.stringify(p.secret)));
    entry.updatedAt = new Date().toISOString();
    await writeStore(data);
  }
}

/** Get total balance (sum of proof amounts) for a mint. */
export async function getTotalBalance(mintUrl: string): Promise<number> {
  const proofs = await loadProofs(mintUrl);
  return proofs.reduce((sum, p) => sum + p.amount, 0);
}
