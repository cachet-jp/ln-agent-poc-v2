/**
 * Bitrefill CLI wrapper client.
 *
 * Bitrefill's API is MCP-based (api.bitrefill.com/mcp), not REST.
 * This module wraps the `@bitrefill/cli` commands for programmatic use.
 * Auth: BITREFILL_API_KEY env var or OAuth.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getConfig } from "./config.js";
import type {
  BitrefillProduct,
  BitrefillProductDetail,
  BitrefillInvoice,
  BitrefillOrder,
} from "../types.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getApiKey(): string {
  const config = getConfig();
  const apiKey = config.BITREFILL_API_ID || config.BITREFILL_API_SECRET;
  if (!apiKey) {
    throw new Error(
      "Bitrefill API key not configured. Set BITREFILL_API_ID in .env.",
    );
  }
  return apiKey;
}

/**
 * Run a bitrefill CLI command and return parsed output.
 */
async function runCli(args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync("bitrefill", args, {
    env: { ...process.env, BITREFILL_API_KEY: getApiKey() },
    timeout: 60_000,
  });
  if (stderr && !stdout) {
    throw new Error(`Bitrefill CLI error: ${stderr}`);
  }
  return stdout;
}

/**
 * Parse CLI YAML-like output into a rough JSON structure.
 * For buy-products, output is JSON — try JSON first.
 */
function parseCliOutput(output: string): any {
  try {
    return JSON.parse(output);
  } catch {
    // CLI uses YAML-ish format for search/detail — return raw text
    return { raw: output };
  }
}

// ---------------------------------------------------------------------------
// Public functions (CLI wrappers)
// ---------------------------------------------------------------------------

export interface SearchOptions {
  country?: string;
  category?: string;
}

/**
 * Search for products on Bitrefill via CLI.
 */
export async function searchProducts(
  query: string,
  options: SearchOptions = {},
): Promise<BitrefillProduct[]> {
  const args = ["search-products", "--query", query];
  if (options.country) args.push("--country", options.country);
  if (options.category) args.push("--category", options.category);

  const output = await runCli(args);
  // CLI outputs YAML-like format; parse product lines
  const parsed = parseCliOutput(output);
  if (parsed.raw) {
    // Return raw output wrapped as a single product for display
    return [{ id: "raw", name: parsed.raw, country: "", currency: "", category: "" }];
  }
  return parsed.products ?? [];
}

/**
 * Get detailed product information via CLI.
 */
export async function getProductDetail(
  productId: string,
): Promise<BitrefillProductDetail> {
  const output = await runCli(["get-product-details", "--product_id", productId]);
  const parsed = parseCliOutput(output);
  return parsed as BitrefillProductDetail;
}

/**
 * Get the product categories (returns raw CLI output).
 */
export async function getCategories(): Promise<unknown> {
  const output = await runCli(["search-products", "--query", "*"]);
  return parseCliOutput(output);
}

export interface BuyOptions {
  productId: string;
  packageId: string | number;
  paymentMethod?: string;
}

/**
 * Buy a product and get the Lightning invoice.
 * Returns the parsed JSON response with invoice_id and payment_info.
 */
export async function buyProduct(options: BuyOptions): Promise<any> {
  const cartItem = JSON.stringify([{
    product_id: options.productId,
    package_id: options.packageId,
  }]);
  const args = [
    "buy-products",
    "--cart_items", cartItem,
    "--payment_method", options.paymentMethod ?? "lightning",
  ];
  const output = await runCli(args);
  return parseCliOutput(output);
}

/**
 * Get invoice status by ID via CLI.
 */
export async function getInvoice(invoiceId: string): Promise<BitrefillInvoice> {
  const output = await runCli(["get-invoice-by-id", "--invoice_id", invoiceId]);
  const parsed = parseCliOutput(output);
  // Map CLI output fields to our type
  return {
    id: parsed.invoice_id ?? invoiceId,
    orderId: parsed.orders?.[0]?.order_id,
    lightningInvoice: parsed.payment_info?.lightningInvoice,
    satoshiPrice: parsed.payment_info?.satoshiPrice ?? 0,
    status: parsed.invoice_status ?? parsed.status ?? "unknown",
    paymentMethod: parsed.payment_info?.method ?? "lightning",
  };
}

/**
 * List orders with redemption info via CLI.
 */
export async function getOrders(): Promise<BitrefillOrder[]> {
  const output = await runCli(["list-orders", "--include_redemption_info", "true"]);
  const parsed = parseCliOutput(output);
  return parsed.orders ?? [];
}

/**
 * Get order details by ID. Maps CLI output to our BitrefillOrder type.
 */
export async function getOrder(orderId: string): Promise<BitrefillOrder> {
  const output = await runCli(["get-invoice-by-id", "--invoice_id", orderId]);
  const parsed = parseCliOutput(output);
  const order = parsed.orders?.[0];
  return {
    id: order?.order_id ?? orderId,
    status: order?.status ?? "unknown",
    items: order ? [{
      productId: order.product?.id,
      productName: order.product?.name,
      code: order.redemption_info?.pin,
      pin: order.redemption_info?.pin,
      value: order.product?.value ? parseInt(order.product.value) : undefined,
      currency: order.product?.currency,
    }] : [],
  };
}

/**
 * Unseal an order to reveal redemption codes.
 * With CLI, this is the same as list-orders with include_redemption_info.
 */
export async function unsealOrder(orderId: string): Promise<BitrefillOrder> {
  return getOrder(orderId);
}

/**
 * Check Bitrefill account balance (not directly supported by CLI).
 */
export async function getAccountBalance(): Promise<{ balance: number }> {
  // CLI doesn't expose balance directly; return 0
  return { balance: 0 };
}

/**
 * Ping Bitrefill (try a simple search).
 */
export async function ping(): Promise<boolean> {
  try {
    await runCli(["search-products", "--query", "test"]);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Polling helper
// ---------------------------------------------------------------------------

/**
 * Poll invoice status until it reaches a terminal state.
 */
export async function waitForInvoicePaid(
  invoiceId: string,
  { intervalMs = 2000, timeoutMs = 60000 } = {},
): Promise<BitrefillInvoice> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const invoice = await getInvoice(invoiceId);
    if (
      invoice.status === "complete" ||
      invoice.status === "completed" ||
      invoice.status === "paid"
    ) {
      return invoice;
    }
    if (invoice.status === "expired" || invoice.status === "failed") {
      throw new Error(`Bitrefill invoice ${invoiceId} ${invoice.status}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `Bitrefill invoice ${invoiceId} did not complete within ${timeoutMs / 1000}s`,
  );
}

// Legacy exports for backward compatibility
export type CreateInvoiceProduct = BuyOptions;
export type CreateInvoiceOptions = {
  products: { product_id: string; value?: number; package_id?: string }[];
  payment_method: string;
};
export async function createInvoice(options: CreateInvoiceOptions): Promise<BitrefillInvoice> {
  const product = options.products[0];
  const result = await buyProduct({
    productId: product.product_id,
    packageId: product.value ?? product.package_id ?? 0,
    paymentMethod: options.payment_method,
  });
  const response = result.response ?? result;
  return {
    id: response.invoice_id ?? "",
    orderId: response.orders?.[0]?.order_id,
    lightningInvoice: response.payment_info?.lightningInvoice,
    satoshiPrice: response.payment_info?.satoshiPrice ?? 0,
    status: "pending",
    paymentMethod: options.payment_method,
  };
}
