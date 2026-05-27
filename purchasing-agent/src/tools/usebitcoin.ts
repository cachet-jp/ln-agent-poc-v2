import { z } from "zod";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { payBolt11 } from "../lib/payment-strategy.js";
import { getConfig } from "../lib/config.js";
import { renderBolt11Qr } from "../lib/qr.js";
import {
  createInvoice,
  listProducts,
  pollOrderUntilComplete,
  extractCodesFromOrder,
} from "../lib/usebitcoin-api.js";
import type {
  UseBitcoinProduct,
  ProductCatalog,
  GiftCardResult,
} from "../types.js";

// ---------------------------------------------------------------------------
// Product catalog
// ---------------------------------------------------------------------------

export const PRODUCT_CATALOG: Record<UseBitcoinProduct, ProductCatalog> = {
  vpreca: {
    name: "V-Preca ギフト",
    slug: "vpricagift",
    skuPrefix: "vpreca",
    amounts: [500, 1000, 2000, 3000, 5000, 10000, 20000, 30000, 50000, 100000],
    description: "Visa プリペイドカード（ネット決済用）",
  },
  kyash: {
    name: "Kyash ギフトコード",
    slug: "kyash",
    skuPrefix: "kyash",
    amounts: [500, 1000, 5000, 10000, 50000],
    description: "Kyash アプリにチャージして Visa プリペイドとして利用",
  },
  quocard: {
    name: "QUO カード Pay",
    slug: "quocard",
    skuPrefix: "quocard",
    amounts: [500, 1000, 3000, 5000, 10000],
    description: "コンビニ・書店等で使えるデジタルギフト",
  },
  aupay: {
    name: "au PAY ギフトカード",
    slug: "aupay",
    skuPrefix: "aupay",
    amounts: [1000, 3000, 5000, 10000, 50000],
    description: "au PAY 残高にチャージして全国の加盟店で利用",
  },
  dmm: {
    name: "DMM ポイントコード",
    slug: "dmm",
    skuPrefix: "dmm",
    amounts: [2000, 5000, 10000, 50000, 100000],
    description: "DMM.com のサービスで利用可能（8%割引あり）",
  },
  bitcash: {
    name: "ビットキャッシュ",
    slug: "bitcash",
    skuPrefix: "bitcash",
    amounts: [1500, 3000, 5000, 10000, 50000],
    description: "オンラインゲーム・電子書籍等で利用",
  },
};

const ALL_PRODUCT_NAMES = Object.keys(PRODUCT_CATALOG) as UseBitcoinProduct[];

export async function buyGiftCard(
  product: UseBitcoinProduct,
  amount: number,
): Promise<GiftCardResult> {
  const catalog = PRODUCT_CATALOG[product];
  if (!catalog) throw new Error(`Unknown product: ${product}`);
  if (!catalog.amounts.includes(amount)) {
    throw new Error(
      `Invalid amount ${amount} for ${catalog.name}. Valid: ${catalog.amounts.join(", ")}`,
    );
  }

  const config = getConfig();
  if (amount > config.MAX_SPEND_JPY) {
    throw new Error(
      `Amount ${amount} JPY exceeds MAX_SPEND_JPY (${config.MAX_SPEND_JPY}).`,
    );
  }

  const sku = `${catalog.skuPrefix}-${amount}`;

  // Look up the vendor-quoted sats price for this SKU before requesting an
  // invoice — passed to payBolt11 so a mutated bolt11 (different amount than
  // the catalog quote) is rejected before any payment goes out.
  const productsResp = await listProducts();
  const variant = productsResp.products
    .flatMap((p) => p.variants)
    .find((v) => v.sku === sku);
  if (!variant) {
    throw new Error(`UseBitcoin SKU ${sku} is not in the live product catalog`);
  }
  const expectedSats = variant.price_sats;

  const invoice = await createInvoice(sku, 1);

  const payResult = await payBolt11(invoice.bolt11, "cashu", expectedSats);
  if (!payResult.preimage) {
    throw new Error("Lightning payment failed — no preimage received");
  }

  const order = await pollOrderUntilComplete(invoice.order_id);
  if (order.status !== "fulfilled") {
    throw new Error(
      `UseBitcoin order ${invoice.order_id} ended with status "${order.status}" (expected "fulfilled").`,
    );
  }

  const { code, secondaryCode } = extractCodesFromOrder(order);

  return {
    product,
    code,
    secondaryCode,
    amount,
    orderId: invoice.order_id,
    preimage: payResult.preimage,
    paymentMethod: payResult.method,
    satsPaid: payResult.amount,
    fee: payResult.fee,
  };
}

// ---------------------------------------------------------------------------
// MCP Tool Registration
// ---------------------------------------------------------------------------

/**
 * Register the generic `usebitcoin_buy_gift_card` tool + legacy per-product tools.
 */
export function registerUseBitcoinTools(server: McpServer): void {
  // ---- Generic multi-product tool ----
  server.tool(
    "usebitcoin_buy_gift_card",
    "Buy a gift card on UseBitcoin.jp using Bitcoin Lightning payment via Cashu ecash. " +
      `Supported products: ${ALL_PRODUCT_NAMES.join(", ")}. ` +
      "Returns the gift card code, order ID, and payment details.",
    {
      product: z
        .enum(ALL_PRODUCT_NAMES as [string, ...string[]])
        .describe(
          `Product type: ${ALL_PRODUCT_NAMES.map((p) => `"${p}" (${PRODUCT_CATALOG[p].name})`).join(", ")}`,
        ),
      amount: z
        .number()
        .int()
        .positive()
        .describe("Amount in JPY. Valid amounts depend on product type."),
    },
    async ({ product, amount }) => {
      try {
        const result = await buyGiftCard(product as UseBitcoinProduct, amount);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  product: result.product,
                  productName: PRODUCT_CATALOG[result.product].name,
                  code: result.code,
                  secondaryCode: result.secondaryCode ?? null,
                  amount: result.amount,
                  orderId: result.orderId,
                  paymentPreimage: result.preimage,
                  paymentMethod: result.paymentMethod,
                  satsPaid: result.satsPaid,
                  fee: result.fee ?? 0,
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
              text: `Gift card purchase failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ---- List available products ----
  server.tool(
    "usebitcoin_list_products",
    "List all gift card products available on UseBitcoin.jp with valid JPY amounts.",
    {},
    async () => {
      const products = Object.entries(PRODUCT_CATALOG).map(([key, cat]) => ({
        product: key,
        name: cat.name,
        description: cat.description,
        amounts: cat.amounts,
      }));
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(products, null, 2),
          },
        ],
      };
    },
  );

  // ---- Create invoice + QR code (manual pay flow) ----
  server.tool(
    "usebitcoin_create_invoice_qr",
    "Request a Lightning invoice for a UseBitcoin.jp gift card and render it as a scannable QR code. " +
      "Use this when the caller wants to pay manually with an external Lightning wallet; " +
      "afterwards call `usebitcoin_wait_for_fulfillment` with the returned order_id to retrieve the code. " +
      `Supported products: ${ALL_PRODUCT_NAMES.join(", ")}.`,
    {
      product: z
        .enum(ALL_PRODUCT_NAMES as [string, ...string[]])
        .describe("Product type (see usebitcoin_list_products)."),
      amount: z
        .number()
        .int()
        .positive()
        .describe("Amount in JPY. Must be a valid denomination for the product."),
    },
    async ({ product, amount }) => {
      try {
        const catalog = PRODUCT_CATALOG[product as UseBitcoinProduct];
        if (!catalog.amounts.includes(amount)) {
          throw new Error(
            `Invalid amount ${amount} for ${catalog.name}. Valid: ${catalog.amounts.join(", ")}`,
          );
        }
        const config = getConfig();
        if (amount > config.MAX_SPEND_JPY) {
          throw new Error(
            `Amount ${amount} JPY exceeds MAX_SPEND_JPY (${config.MAX_SPEND_JPY}).`,
          );
        }

        const sku = `${catalog.skuPrefix}-${amount}`;
        const invoice = await createInvoice(sku, 1);
        const pngPath = join(tmpdir(), `usebitcoin-invoice-${invoice.order_id}.png`);
        const { base64 } = await renderBolt11Qr(invoice.bolt11, { pngPath });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  product,
                  productName: catalog.name,
                  sku,
                  amountJpy: amount,
                  orderId: invoice.order_id,
                  bolt11: invoice.bolt11,
                  expiresAt: invoice.expires_at,
                  qrPath: pngPath,
                  nextStep: `Pay the invoice, then call usebitcoin_wait_for_fulfillment with orderId="${invoice.order_id}".`,
                },
                null,
                2,
              ),
            },
            { type: "image" as const, data: base64, mimeType: "image/png" },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Invoice creation failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ---- Wait for order fulfillment (manual pay flow) ----
  server.tool(
    "usebitcoin_wait_for_fulfillment",
    "Poll a UseBitcoin.jp order until it is fulfilled, then return the purchased code(s). " +
      "Pair with `usebitcoin_create_invoice_qr` for manual-pay flows.",
    {
      orderId: z.string().uuid().describe("The order_id returned by usebitcoin_create_invoice_qr."),
      timeoutMs: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Optional poll deadline in milliseconds (default 180000)."),
    },
    async ({ orderId, timeoutMs }) => {
      try {
        const order = await pollOrderUntilComplete(orderId, timeoutMs ? { timeoutMs } : undefined);
        if (order.status !== "fulfilled") {
          throw new Error(
            `Order ${orderId} ended with status "${order.status}" (expected "fulfilled").`,
          );
        }
        const { code, secondaryCode, redeemUrl, fields } = extractCodesFromOrder(order);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  orderId,
                  code,
                  secondaryCode: secondaryCode ?? null,
                  redeemUrl: redeemUrl ?? null,
                  fields,
                  preimage: order.preimage ?? null,
                  totalSats: order.total_sats ?? null,
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
              text: `Waiting for fulfillment failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

}
