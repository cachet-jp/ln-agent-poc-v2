/**
 * Purchase order log — append-only JSONL breadcrumb trail.
 *
 * Why: a delivered Bitrefill order became unrecoverable from the agent side
 * (2026-09-08) because the invoice/order ids existed only in conversation
 * context, which was compacted away between purchase and delivery. Every
 * money-moving purchase step appends a line here so the ids survive a crash,
 * restart, or context loss, and can be replayed against the provider API.
 *
 * Never store gift codes, PINs, or redeem URLs in this log — ids and statuses
 * only. Codes are re-fetched from the provider using the logged ids.
 */

import { open, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, "../../data");
const LOG_FILE = resolve(DATA_DIR, "order-log.jsonl");

export type OrderLogEvent =
  | "invoice_created"
  | "melt_requested"
  | "payment_sent"
  | "delivered"
  | "delivery_pending";

export interface OrderLogEntry {
  ts: string;
  /** "cashu" = a raw melt of an externally-supplied bolt11 (e.g. an invoice
   * created by the Bitrefill CLI outside this server) — the incident path. */
  provider: "bitrefill" | "usebitcoin" | "cashu";
  event: OrderLogEvent;
  invoiceId?: string;
  orderId?: string;
  /** Full bolt11 for raw melts: it embeds the payment hash and description,
   * which is what lets a lost order be correlated with the provider later.
   * A bolt11 is a payment request, not a secret — the preimage is the receipt. */
  bolt11?: string;
  productId?: string;
  productName?: string;
  satsQuoted?: number;
  satsPaid?: number;
  feeSats?: number;
  paymentMethod?: string;
  preimage?: string;
  status?: string;
  note?: string;
}

/**
 * Append one entry, fsynced before returning.
 *
 * Call this BEFORE paying an invoice and let a failure propagate: if the
 * breadcrumb can't be written, abort while aborting is still free. An
 * untracked payment is exactly the failure mode this log exists to prevent.
 */
export async function appendOrderLog(
  entry: Omit<OrderLogEntry, "ts">,
  filePath: string = LOG_FILE,
): Promise<void> {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  const line = `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`;
  const fh = await open(filePath, "a", 0o600);
  try {
    await fh.writeFile(line);
    await fh.sync();
  } finally {
    await fh.close();
  }
}

/**
 * Best-effort append for steps AFTER money has moved: a log failure must never
 * mask a successful payment or purchase result, so errors go to stderr only
 * (stdout is the MCP stdio protocol stream).
 */
export async function safeAppendOrderLog(
  entry: Omit<OrderLogEntry, "ts">,
  filePath: string = LOG_FILE,
): Promise<void> {
  try {
    await appendOrderLog(entry, filePath);
  } catch (err) {
    console.error(`order-log append failed (continuing): ${(err as Error)?.message}`);
  }
}

/** Read the most recent entries (newest last). Corrupt lines are skipped. */
export async function readOrderLog(
  limit = 20,
  filePath: string = LOG_FILE,
): Promise<OrderLogEntry[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }
  const entries: OrderLogEntry[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as OrderLogEntry);
    } catch {
      // A torn write (crash mid-append) may leave one partial line — skip it
      // rather than making the whole log unreadable.
    }
  }
  return entries.slice(-limit);
}
