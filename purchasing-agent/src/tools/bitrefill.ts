import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  searchProducts,
  getProductDetail,
  getCategories,
  createInvoice,
  waitForInvoicePaid,
  getAccountBalance,
  getOrder,
  hasBitrefillCredentials,
} from "../lib/bitrefill-client.js";
import { payBolt11 } from "../lib/payment-strategy.js";
import { withErrorHandler } from "../lib/tool-helpers.js";
import type { BitrefillPurchaseResult } from "../types.js";

/**
 * Register Bitrefill MCP tools on the server.
 *
 * Requires one of:
 *   - BITREFILL_API_KEY (recommended — single key from bitrefill.com/account/developers)
 *   - BITREFILL_API_ID (backward compat)
 *   - BITREFILL_API_SECRET (backward compat)
 *
 * Internally wraps @bitrefill/cli which uses the Bitrefill MCP API.
 */
export function registerBitrefillTools(server: McpServer): void {
  if (!hasBitrefillCredentials()) {
    return; // No credentials — skip all Bitrefill tools
  }

  // ---- Search ----
  server.tool(
    "bitrefill_search",
    "Search Bitrefill for gift cards, eSIMs, mobile topups, and more. " +
      "Use query '*' to browse all products. Returns product IDs for use with bitrefill_product_detail.",
    {
      query: z.string().describe("Search query (e.g. 'Amazon', 'Netflix', '*' for all)"),
      country: z.string().optional().describe("ISO country code (e.g. 'JP', 'US')"),
      limit: z.number().int().positive().default(10).describe("Max results (default 10)"),
      category: z.string().optional().describe("Filter by category"),
    },
    async ({ query, country, limit, category }) =>
      withErrorHandler(async () => {
        const products = await searchProducts(query, { country, limit, category });
        return {
          count: products.length,
          products: products.map((p) => ({
            id: p.id,
            name: p.name,
            country: p.country,
            currency: p.currency,
            category: p.category,
            range: p.range ?? null,
            packages: p.packages ?? null,
          })),
        };
      }),
  );

  // ---- Product detail (no auth required) ----
  server.tool(
    "bitrefill_product_detail",
    "Get detailed information about a Bitrefill product including denominations, description, and redemption instructions.",
    {
      productId: z.string().describe("Bitrefill product ID (from search results)"),
    },
    async ({ productId }) =>
      withErrorHandler(async () => {
        return await getProductDetail(productId);
      }),
  );

  // ---- Categories (no auth required) ----
  server.tool(
    "bitrefill_categories",
    "Get the full product type/categories map from Bitrefill.",
    {},
    async () =>
      withErrorHandler(async () => {
        return await getCategories();
      }),
  );

  // ---- Purchase tool (Cashu/Ark wallet pays Lightning) ----
  server.tool(
      "bitrefill_buy",
      "Purchase a Bitrefill product using Bitcoin Lightning (Cashu ecash or Ark wallet). " +
        "Creates a Lightning invoice via Bitrefill API, pays it with your wallet, then retrieves the gift card code.",
      {
        productId: z.string().describe("Bitrefill product ID"),
        value: z.number().optional().describe("Value/denomination for variable-price products"),
        packageId: z.string().optional().describe("Package ID for fixed-denomination products"),
        quantity: z.number().int().positive().default(1).describe("Quantity (default 1)"),
        email: z.string().email().optional().describe("Email for delivery (some products require it)"),
      },
      async ({ productId, value, packageId, quantity, email }) =>
        withErrorHandler(async () => {
          // 1. Create invoice with Lightning payment method
          const invoiceProduct: Record<string, unknown> = {
            product_id: productId,
            quantity,
          };
          if (value !== undefined) invoiceProduct.value = value;
          if (packageId) invoiceProduct.package_id = packageId;
          if (email) invoiceProduct.email = email;

          const invoice = await createInvoice({
            products: [invoiceProduct as any],
            payment_method: "lightning",
          });

          if (!invoice.lightningInvoice) {
            throw new Error("Bitrefill did not return a Lightning invoice");
          }

          // 2. Pay the Lightning invoice via Cashu → Ark fallback
          const payResult = await payBolt11(invoice.lightningInvoice);
          if (!payResult.preimage) {
            throw new Error("Lightning payment failed — no preimage received");
          }

          // 3. Wait for Bitrefill to acknowledge payment & fetch order in one pass
          const { order } = await waitForInvoicePaid(invoice.id);
          const orderId = order.id ?? invoice.orderId ?? "unknown";
          const firstItem = order.items?.[0];

          const result: BitrefillPurchaseResult = {
            provider: "bitrefill",
            productId,
            productName: firstItem?.productName ?? productId,
            code: firstItem?.code ?? "",
            pin: firstItem?.pin,
            orderId,
            preimage: payResult.preimage,
            paymentMethod: payResult.method as "cashu" | "ark",
            satsPaid: invoice.satoshiPrice,
            fee: payResult.fee,
          };

          return { success: true, ...result };
        }),
    );

    // ---- Order status (requires auth) ----
    server.tool(
      "bitrefill_order_status",
      "Check the status of a Bitrefill order and reveal codes if available.",
      {
        orderId: z.string().describe("Bitrefill order ID"),
      },
      async ({ orderId }) =>
        withErrorHandler(async () => {
          return await getOrder(orderId);
        }),
    );

    // ---- Account balance (requires auth) ----
    server.tool(
      "bitrefill_account_balance",
      "Check your Bitrefill account balance.",
      {},
      async () =>
        withErrorHandler(async () => {
          return await getAccountBalance();
        }),
    );
}
