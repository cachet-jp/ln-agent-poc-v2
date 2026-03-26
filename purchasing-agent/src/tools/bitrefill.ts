import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  searchProducts,
  getProductDetail,
  getCategories,
  createInvoice,
  waitForInvoicePaid,
  unsealOrder,
  getAccountBalance,
  getOrder,
} from "../lib/bitrefill-client.js";
import { payBolt11 } from "../lib/payment-strategy.js";
import { getConfig } from "../lib/config.js";
import type { BitrefillPurchaseResult } from "../types.js";

/**
 * Register Bitrefill MCP tools on the server.
 * All tools require BITREFILL_API_ID + BITREFILL_API_SECRET (Bitrefill API requires auth for all endpoints).
 */
export function registerBitrefillTools(server: McpServer): void {
  const config = getConfig();
  const hasCredentials = !!(config.BITREFILL_API_ID && config.BITREFILL_API_SECRET);

  if (!hasCredentials) {
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
    async ({ query, country, limit, category }) => {
      try {
        const products = await searchProducts(query, { country, limit, category });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
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
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Search failed: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ---- Product detail (no auth required) ----
  server.tool(
    "bitrefill_product_detail",
    "Get detailed information about a Bitrefill product including denominations, description, and redemption instructions.",
    {
      productId: z.string().describe("Bitrefill product ID (from search results)"),
    },
    async ({ productId }) => {
      try {
        const detail = await getProductDetail(productId);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(detail, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Detail fetch failed: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  );

  // ---- Categories (no auth required) ----
  server.tool(
    "bitrefill_categories",
    "Get the full product type/categories map from Bitrefill.",
    {},
    async () => {
      try {
        const categories = await getCategories();
        return {
          content: [{ type: "text" as const, text: JSON.stringify(categories, null, 2) }],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `Categories fetch failed: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
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
      async ({ productId, value, packageId, quantity, email }) => {
        try {
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

          // 3. Wait for Bitrefill to acknowledge payment
          const paidInvoice = await waitForInvoicePaid(invoice.id);

          // 4. Get order and unseal to reveal codes
          const orderId = paidInvoice.orderId ?? invoice.orderId;
          if (!orderId) {
            throw new Error("No order ID returned from Bitrefill invoice");
          }

          const order = await unsealOrder(orderId);
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

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: true,
                    ...result,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Bitrefill purchase failed: ${(err as Error).message}`,
              },
            ],
            isError: true,
          };
        }
      },
    );

    // ---- Order status (requires auth) ----
    server.tool(
      "bitrefill_order_status",
      "Check the status of a Bitrefill order and reveal codes if available.",
      {
        orderId: z.string().describe("Bitrefill order ID"),
      },
      async ({ orderId }) => {
        try {
          const order = await getOrder(orderId);
          return {
            content: [{ type: "text" as const, text: JSON.stringify(order, null, 2) }],
          };
        } catch (err) {
          return {
            content: [
              { type: "text" as const, text: `Order status failed: ${(err as Error).message}` },
            ],
            isError: true,
          };
        }
      },
    );

    // ---- Account balance (requires auth) ----
    server.tool(
      "bitrefill_account_balance",
      "Check your Bitrefill account balance.",
      {},
      async () => {
        try {
          const balance = await getAccountBalance();
          return {
            content: [{ type: "text" as const, text: JSON.stringify(balance, null, 2) }],
          };
        } catch (err) {
          return {
            content: [
              { type: "text" as const, text: `Balance check failed: ${(err as Error).message}` },
            ],
            isError: true,
          };
        }
      },
    );
}
