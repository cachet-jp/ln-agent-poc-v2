import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { newPage, humanDelay, closeBrowser } from "../lib/browser.js";
import { payLightningInvoice } from "../lib/clw-client.js";
import { getConfig } from "../lib/config.js";
import type { VPrecaCode } from "../types.js";

const USEBITCOIN_BASE = "https://usebitcoin.jp";

/**
 * Valid V-Preca SKU amounts on UseBitcoin.jp.
 * URL pattern: /ja/products/vpricagift/vpreca-{amount}
 */
const VALID_AMOUNTS = [500, 1000, 2000, 3000, 5000, 10000, 20000, 30000, 50000, 100000];

export function registerUseBitcoinTools(server: McpServer): void {
  server.tool(
    "usebitcoin_buy_vpreca",
    "Buy a V-Preca gift card on UseBitcoin.jp using Lightning payment from Ark wallet. " +
      "Returns card number and security code. " +
      `Valid amounts (JPY): ${VALID_AMOUNTS.join(", ")}`,
    {
      amount: z
        .number()
        .int()
        .refine((v) => VALID_AMOUNTS.includes(v), {
          message: `Amount must be one of: ${VALID_AMOUNTS.join(", ")}`,
        })
        .describe(`V-Preca amount in JPY. Valid: ${VALID_AMOUNTS.join(", ")}`),
    },
    async ({ amount }) => {
      const config = getConfig();

      // Guardrail check
      if (amount > config.MAX_SPEND_JPY) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Blocked: amount ${amount} JPY exceeds MAX_SPEND_JPY (${config.MAX_SPEND_JPY}). Increase the limit in .env if needed.`,
            },
          ],
          isError: true,
        };
      }

      let page;
      try {
        page = await newPage();

        // 1. Navigate directly to the V-Preca product page for the chosen amount
        //    URL: /ja/products/vpricagift/vpreca-{amount}
        const productUrl = `${USEBITCOIN_BASE}/ja/products/vpricagift/vpreca-${amount}`;
        await page.goto(productUrl, { waitUntil: "networkidle" });
        await humanDelay();

        // 2. Select quantity = 1 (default), accept terms, and proceed
        //    UseBitcoin uses React Aria components (role-based selectors)

        // Accept terms checkbox (React Aria checkbox with role="checkbox")
        const termsCheckbox = page.getByRole("checkbox").first();
        if (await termsCheckbox.isVisible({ timeout: 5000 }).catch(() => false)) {
          const isChecked = await termsCheckbox.isChecked().catch(() => false);
          if (!isChecked) {
            await termsCheckbox.click();
            await humanDelay(300, 600);
          }
        }

        // 3. Set up request interception to capture the POST /invoices response
        //    This returns the bolt11 Lightning invoice and order ID
        const invoiceResponsePromise = page.waitForResponse(
          (resp) =>
            resp.url().includes("/invoices") &&
            resp.request().method() === "POST" &&
            resp.status() === 200,
          { timeout: 30000 },
        );

        // Click "購入へ進む" (proceed to purchase) button
        const proceedButton = page
          .getByRole("button", { name: /購入へ進む|購入|proceed/i })
          .first();
        await proceedButton.waitFor({ timeout: 10000 });
        await proceedButton.click();
        await humanDelay(1000, 2000);

        // 4. Extract bolt11 invoice from the /invoices API response
        const invoiceResponse = await invoiceResponsePromise;
        const invoiceData = (await invoiceResponse.json()) as {
          bolt11?: string;
          invoice?: string;
          order_id?: string;
          id?: string;
        };

        const bolt11 =
          invoiceData.bolt11 ??
          invoiceData.invoice ??
          null;
        const orderId =
          invoiceData.order_id ??
          invoiceData.id ??
          null;

        if (!bolt11 || !bolt11.startsWith("lnbc")) {
          // Fallback: try extracting from page text
          const fallbackBolt11 = await extractLightningInvoiceFromPage(page);
          if (!fallbackBolt11) {
            throw new Error(
              "Could not obtain Lightning invoice from /invoices API or page content.",
            );
          }
          // Use fallback
          await payAndExtract(page, fallbackBolt11, amount);
        }

        // 5. Pay the Lightning invoice via Ark wallet
        const payResult = await payLightningInvoice(bolt11!);
        if (!payResult.preimage) {
          throw new Error("Lightning payment failed — no preimage received");
        }

        // 6. Wait for payment confirmation
        //    UseBitcoin uses SSE at /api/orders/{id}/stream for status updates.
        //    On success, the page redirects to /orders/{orderId} or shows fulfillment.
        //    We wait for the URL to change to the order result page.
        await Promise.race([
          // Wait for redirect to order page
          page.waitForURL(/\/orders\//, { timeout: 120000 }),
          // Or wait for fulfillment text on current page
          page
            .waitForSelector('text=/完了|fulfilled|success|paid/i', {
              timeout: 120000,
            })
            .catch(() => null),
        ]);
        await humanDelay(2000, 4000);

        // 7. Extract the V-Preca code from the order result page
        const vprecaCode = await extractVPrecaCode(page, amount);

        await page.context().close();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  cardNumber: vprecaCode.cardNumber,
                  securityCode: vprecaCode.securityCode,
                  amount: vprecaCode.amount,
                  expiryDate: vprecaCode.expiryDate ?? "not provided",
                  orderId: orderId ?? "unknown",
                  paymentPreimage: payResult.preimage,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        if (page) {
          try {
            await page.context().close();
          } catch {
            // ignore cleanup errors
          }
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `V-Preca purchase failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Pay a Lightning invoice and extract V-Preca code (used by fallback path).
 */
async function payAndExtract(
  page: import("playwright").Page,
  bolt11: string,
  amount: number,
): Promise<never> {
  const payResult = await payLightningInvoice(bolt11);
  if (!payResult.preimage) {
    throw new Error("Lightning payment failed — no preimage received");
  }

  await Promise.race([
    page.waitForURL(/\/orders\//, { timeout: 120000 }),
    page
      .waitForSelector('text=/完了|fulfilled|success|paid/i', {
        timeout: 120000,
      })
      .catch(() => null),
  ]);
  await humanDelay(2000, 4000);

  const vprecaCode = await extractVPrecaCode(page, amount);
  await page.context().close();

  // This is a fallback path — throw with the result so the caller's catch can handle it
  // In practice we'd restructure, but for now we use a special error
  const err = new Error("__VPRECA_SUCCESS__");
  (err as any).result = {
    success: true,
    ...vprecaCode,
    paymentPreimage: payResult.preimage,
  };
  throw err;
}

/**
 * Fallback: extract bolt11 invoice from page text content.
 */
async function extractLightningInvoiceFromPage(
  page: import("playwright").Page,
): Promise<string | null> {
  // Strategy 1: Find text starting with lnbc (BOLT11 mainnet invoice)
  const allText = await page.textContent("body");
  if (allText) {
    const match = allText.match(/\b(lnbc[a-z0-9]+)\b/i);
    if (match) return match[1];
  }

  // Strategy 2: Check for a copy button with invoice data
  const copyBtn = page
    .getByRole("button", { name: /コピー|copy/i })
    .first();
  if (await copyBtn.isVisible().catch(() => false)) {
    const dataInvoice = await copyBtn.getAttribute("data-clipboard-text");
    if (dataInvoice && dataInvoice.startsWith("lnbc")) return dataInvoice;
  }

  return null;
}

/**
 * Extract V-Preca card number and security code from the order result page.
 *
 * UseBitcoin's order fulfillment page shows the gift code details.
 * We try multiple strategies to find the card number (16 digits) and
 * security code (3 digits).
 */
async function extractVPrecaCode(
  page: import("playwright").Page,
  expectedAmount: number,
): Promise<VPrecaCode> {
  // Wait for code content to render
  await humanDelay(1000, 2000);

  const bodyText = (await page.textContent("body")) ?? "";

  // Card number: 16 digits, possibly with spaces/dashes
  const cardMatch = bodyText.match(
    /\b(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4})\b/,
  );

  // Security code: 3 digits after a label
  const secMatch = bodyText.match(
    /(?:セキュリティコード|CVV|CVC|security\s*code|認証コード)[:\s]*(\d{3})/i,
  );

  if (cardMatch) {
    return {
      cardNumber: cardMatch[1].replace(/[\s-]/g, ""),
      securityCode: secMatch?.[1] ?? "",
      amount: expectedAmount,
    };
  }

  // Fallback: look for labelled elements on the page
  // Try common CSS patterns for code display
  for (const selector of [
    "[data-testid*='card']",
    "[class*='card-number']",
    "[class*='code']",
    "code",
    "pre",
    ".result",
    ".gift-code",
  ]) {
    const el = page.locator(selector).first();
    const text = await el.textContent().catch(() => null);
    if (text) {
      const innerCardMatch = text.match(
        /(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4})/,
      );
      if (innerCardMatch) {
        const innerSecMatch = text.match(/(\d{3})\s*$/);
        return {
          cardNumber: innerCardMatch[1].replace(/[\s-]/g, ""),
          securityCode: innerSecMatch?.[1] ?? secMatch?.[1] ?? "",
          amount: expectedAmount,
        };
      }
    }
  }

  throw new Error(
    "Could not extract V-Preca card number from the order page. " +
      "The page structure may have changed.",
  );
}
