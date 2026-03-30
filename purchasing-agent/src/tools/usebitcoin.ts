import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { newPage, humanDelay } from "../lib/browser.js";
import { payBolt11 } from "../lib/payment-strategy.js";
import { getConfig } from "../lib/config.js";
import type {
  VPrecaCode,
  UseBitcoinProduct,
  ProductCatalog,
  GiftCardResult,
} from "../types.js";

const USEBITCOIN_BASE = "https://usebitcoin.jp";

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

// ---------------------------------------------------------------------------
// Generic purchase function
// ---------------------------------------------------------------------------

/**
 * Buy a gift card on UseBitcoin.jp.
 * Works for any product in PRODUCT_CATALOG.
 */
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

  const productUrl = `${USEBITCOIN_BASE}/ja/products/${catalog.slug}/${catalog.skuPrefix}-${amount}`;
  let page;

  try {
    page = await newPage();

    // 1. Navigate to product page
    await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await humanDelay();

    // 2. Accept terms checkbox (React Aria custom component)
    const termsLabel = page.getByText("利用規約に同意します");
    if (await termsLabel.isVisible({ timeout: 5000 }).catch(() => false)) {
      await termsLabel.click();
      await humanDelay(300, 600);
    } else {
      const termsCheckbox = page.getByRole("checkbox").first();
      if (await termsCheckbox.isVisible({ timeout: 3000 }).catch(() => false)) {
        await termsCheckbox.click({ force: true });
        await humanDelay(300, 600);
      }
    }

    // 3. Proceed to purchase
    const proceedButton = page
      .getByRole("button", { name: /購入へ進む|購入|proceed/i })
      .first();
    await proceedButton.waitFor({ timeout: 10000 });
    await proceedButton.click();

    // 4. Wait for payment page (Lightning invoice)
    await page.waitForSelector('text=/インボイスをコピー|sats|lightning/i', {
      timeout: 30000,
    });
    await humanDelay(2000, 3000);

    // 5. Extract BOLT11 invoice
    const bolt11 = await extractLightningInvoiceFromPage(page);
    if (!bolt11) {
      throw new Error("Could not extract Lightning invoice from payment page.");
    }

    // 6. Pay via payment strategy (auto: Cashu first → Ark fallback)
    const payResult = await payBolt11(bolt11);
    if (!payResult.preimage) {
      throw new Error("Lightning payment failed — no preimage received");
    }

    // 7. Wait for payment confirmation (SSE → redirect or status text)
    await Promise.race([
      page.waitForURL(/\/orders\//, { timeout: 120000 }),
      page
        .waitForSelector('text=/完了|fulfilled|success|paid/i', {
          timeout: 120000,
        })
        .catch(() => null),
    ]);
    await humanDelay(2000, 4000);

    // 8. Extract gift code(s)
    const giftData = await extractGiftCodeGeneric(page, product);

    // Extract order ID
    const orderMatch = page.url().match(/\/orders\/([^/?]+)/);
    const orderId = orderMatch?.[1] ?? "unknown";

    await page.context().close();

    return {
      product,
      code: giftData.code,
      secondaryCode: giftData.secondaryCode,
      amount,
      orderId,
      preimage: payResult.preimage,
      paymentMethod: payResult.method as "cashu" | "ark",
      satsPaid: payResult.amount,
      fee: payResult.fee,
    };
  } catch (err) {
    if (page) {
      try {
        await page.context().close();
      } catch {
        // ignore cleanup errors
      }
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// MCP Tool Registration
// ---------------------------------------------------------------------------

/**
 * Register the generic `usebitcoin_buy_gift_card` tool + legacy `usebitcoin_buy_vpreca`.
 */
export function registerUseBitcoinTools(server: McpServer): void {
  // ---- Generic multi-product tool ----
  server.tool(
    "usebitcoin_buy_gift_card",
    "Buy a gift card on UseBitcoin.jp using Bitcoin Lightning payment (via Cashu ecash or Ark wallet). " +
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

  // ---- Legacy V-Preca tool (backward compatible) ----
  const VPRECA_AMOUNTS = PRODUCT_CATALOG.vpreca.amounts;
  server.tool(
    "usebitcoin_buy_vpreca",
    "Buy a V-Preca gift card on UseBitcoin.jp using Lightning payment. " +
      "Returns card number and security code. " +
      `Valid amounts (JPY): ${VPRECA_AMOUNTS.join(", ")}`,
    {
      amount: z
        .number()
        .int()
        .refine((v) => VPRECA_AMOUNTS.includes(v), {
          message: `Amount must be one of: ${VPRECA_AMOUNTS.join(", ")}`,
        })
        .describe(`V-Preca amount in JPY. Valid: ${VPRECA_AMOUNTS.join(", ")}`),
    },
    async ({ amount }) => {
      try {
        const result = await buyGiftCard("vpreca", amount);
        // Legacy response format
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  voucherCode: result.code,
                  cardLast4: result.secondaryCode ?? "",
                  amount: result.amount,
                  expiryDate: result.expiryDate ?? "not provided",
                  orderId: result.orderId,
                  paymentPreimage: result.preimage,
                  // deprecated fields for backward compat
                  cardNumber: result.code,
                  securityCode: result.secondaryCode ?? "",
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
            { type: "text" as const, text: `V-Preca purchase failed: ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  );

  // ---- Legacy DMM tool (backward compatible) ----
  const DMM_AMOUNTS = PRODUCT_CATALOG.dmm.amounts;
  server.tool(
    "usebitcoin_buy_dmm_points",
    "Buy a DMM point code on UseBitcoin.jp using Lightning payment (8% discount). " +
      "Returns the point code string to charge on DMM.com. " +
      `Valid amounts (JPY): ${DMM_AMOUNTS.join(", ")}`,
    {
      amount: z
        .number()
        .int()
        .refine((v) => DMM_AMOUNTS.includes(v), {
          message: `Amount must be one of: ${DMM_AMOUNTS.join(", ")}`,
        })
        .describe(`DMM point code amount in JPY. Valid: ${DMM_AMOUNTS.join(", ")}`),
    },
    async ({ amount }) => {
      try {
        const result = await buyGiftCard("dmm", amount);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, code: result.code, amount: result.amount, orderId: result.orderId },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `DMM point code purchase failed: ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  );

  // ---- Legacy BitCash tool (backward compatible) ----
  const BITCASH_AMOUNTS = PRODUCT_CATALOG.bitcash.amounts;
  server.tool(
    "usebitcoin_buy_bitcash",
    "Buy a BitCash code on UseBitcoin.jp using Lightning payment. " +
      "Returns the BitCash hiragana ID for use on DLsite, Niconico, etc. " +
      `Valid amounts (JPY): ${BITCASH_AMOUNTS.join(", ")}`,
    {
      amount: z
        .number()
        .int()
        .refine((v) => BITCASH_AMOUNTS.includes(v), {
          message: `Amount must be one of: ${BITCASH_AMOUNTS.join(", ")}`,
        })
        .describe(`BitCash amount in JPY. Valid: ${BITCASH_AMOUNTS.join(", ")}`),
    },
    async ({ amount }) => {
      try {
        const result = await buyGiftCard("bitcash", amount);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, hiraganaId: result.code, amount: result.amount, orderId: result.orderId },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: `BitCash purchase failed: ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Helpers — Lightning invoice extraction
// ---------------------------------------------------------------------------

async function extractLightningInvoiceFromPage(
  page: import("playwright").Page,
): Promise<string | null> {
  // Strategy 1: Copy button with data attribute
  const copyBtn = page
    .getByRole("button", { name: /インボイスをコピー|コピー|copy/i })
    .first();
  if (await copyBtn.isVisible().catch(() => false)) {
    const dataInvoice = await copyBtn.getAttribute("data-clipboard-text");
    if (dataInvoice && dataInvoice.startsWith("lnbc")) return dataInvoice;
  }

  // Strategy 2: Find lnbc in page text
  const allText = await page.textContent("body");
  if (allText) {
    const match = allText.match(/\b(lnbc[a-z0-9]+)\b/i);
    if (match) return match[1];
  }

  // Strategy 3: Search DOM for hidden invoice data
  const invoice = await page.evaluate(() => {
    const els = document.querySelectorAll("[data-invoice], [data-bolt11], [data-value]");
    for (const el of els) {
      for (const attr of ["data-invoice", "data-bolt11", "data-value"]) {
        const val = el.getAttribute(attr);
        if (val && val.startsWith("lnbc")) return val;
      }
    }
    const all = document.body.innerHTML;
    const match = all.match(/(lnbc[a-z0-9]{50,})/i);
    return match ? match[1] : null;
  });
  if (invoice) return invoice;

  return null;
}

/**
 * Extract gift code from the order result page.
 * Generic version supporting all product types.
 */
async function extractGiftCodeGeneric(
  page: import("playwright").Page,
  product: UseBitcoinProduct,
): Promise<{ code: string; secondaryCode?: string }> {
  await humanDelay(1000, 2000);

  // Strategy 1: Readonly input fields (UseBitcoin renders codes in readonly inputs)
  const inputs = await page.locator("input[readonly], input[disabled]").all();
  if (inputs.length >= 1) {
    const code = await inputs[0].inputValue().catch(() => "");
    const secondary =
      inputs.length >= 2
        ? await inputs[1].inputValue().catch(() => "")
        : undefined;
    if (code) {
      return { code, secondaryCode: secondary || undefined };
    }
  }

  // Strategy 2: "コード N/N" pattern in body text
  const bodyText = (await page.textContent("body")) ?? "";

  // V-Preca pattern: "コード 1/1 {alphanumeric} {4digits}"
  if (product === "vpreca") {
    const match = bodyText.match(
      /コード\s*\d+\/\d+\s*([A-Za-z0-9]{10,20})\s*(\d{4})/,
    );
    if (match) return { code: match[1], secondaryCode: match[2] };
  }

  // BitCash pattern: hiragana ID
  if (product === "bitcash") {
    const hiraganaMatch = bodyText.match(/コード\s*\d*\/?\d*\s*([\u3040-\u309F]{8,20})/);
    if (hiraganaMatch) return { code: hiraganaMatch[1] };
    const fallbackHiragana = bodyText.match(/([\u3040-\u309F]{8,20})/);
    if (fallbackHiragana) return { code: fallbackHiragana[1] };
  }

  // DMM pattern: hyphenated code (e.g. "XXXX-XXXX-XXXX-XXXX")
  if (product === "dmm") {
    const hyphenatedMatch = bodyText.match(
      /コード\s*\d*\/?\d*\s*([A-Za-z0-9]{4,6}(?:-[A-Za-z0-9]{4,6}){2,4})/,
    );
    if (hyphenatedMatch) return { code: hyphenatedMatch[1] };
  }

  // Generic: "コード" followed by an alphanumeric string
  const genericMatch = bodyText.match(
    /コード\s*\d*\/?[\d]*\s*([A-Za-z0-9]{6,30})/,
  );
  if (genericMatch) return { code: genericMatch[1] };

  // Strategy 3: Alphanumeric pattern fallback
  const fallback = bodyText.match(/([A-Za-z][A-Za-z0-9]{9,29})/);
  if (fallback) return { code: fallback[1] };

  throw new Error(
    `Could not extract gift code for ${PRODUCT_CATALOG[product]?.name ?? product} from the order page. ` +
      "The page structure may have changed.",
  );
}

// ---------------------------------------------------------------------------
// Legacy helper (re-exported for backward compat if needed)
// ---------------------------------------------------------------------------

/**
 * @deprecated Use buyGiftCard("vpreca", amount) instead.
 */
export async function extractVPrecaCode(
  page: import("playwright").Page,
  expectedAmount: number,
): Promise<VPrecaCode> {
  const result = await extractGiftCodeGeneric(page, "vpreca");
  return {
    voucherCode: result.code,
    cardLast4: result.secondaryCode ?? "",
    cardNumber: result.code,
    securityCode: result.secondaryCode ?? "",
    amount: expectedAmount,
  };
}
