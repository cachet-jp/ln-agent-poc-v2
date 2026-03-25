import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { newPage, humanDelay } from "../lib/browser.js";
import { payBolt11 } from "../lib/payment-strategy.js";
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
        await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
        await humanDelay();

        // 2. Select quantity = 1 (default), accept terms, and proceed
        //    UseBitcoin uses React Aria components (role-based selectors)

        // Accept terms checkbox — uses custom React Aria styling
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

        // 3. Click "購入へ進む" (proceed to purchase) button
        //    This navigates to the payment page showing QR code + Lightning invoice
        const proceedButton = page
          .getByRole("button", { name: /購入へ進む|購入|proceed/i })
          .first();
        await proceedButton.waitFor({ timeout: 10000 });
        await proceedButton.click();

        // 4. Wait for payment page to load (shows invoice + QR code)
        await page.waitForSelector('text=/インボイスをコピー|sats/i', {
          timeout: 30000,
        });
        await humanDelay(2000, 3000);

        // 5. Extract bolt11 invoice from payment page DOM
        const bolt11 = await extractLightningInvoiceFromPage(page);
        if (!bolt11) {
          throw new Error(
            "Could not extract Lightning invoice from payment page.",
          );
        }

        // 6. Pay the Lightning invoice via Ark wallet
        const payResult = await payBolt11(bolt11);
        if (!payResult.preimage) {
          throw new Error("Lightning payment failed — no preimage received");
        }

        // 7. Wait for payment confirmation
        //    UseBitcoin uses SSE for status updates.
        //    On success, the page redirects to /orders/{orderId} or shows fulfillment.
        await Promise.race([
          page.waitForURL(/\/orders\//, { timeout: 120000 }),
          page
            .waitForSelector('text=/完了|fulfilled|success|paid/i', {
              timeout: 120000,
            })
            .catch(() => null),
        ]);
        await humanDelay(2000, 4000);

        // 8. Extract the V-Preca code from the order result page
        const vprecaCode = await extractVPrecaCode(page, amount);

        // Extract order ID from URL if possible
        const orderMatch = page.url().match(/\/orders\/([^/?]+)/);
        const orderId = orderMatch?.[1] ?? "unknown";

        await page.context().close();

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  voucherCode: vprecaCode.voucherCode,
                  cardLast4: vprecaCode.cardLast4,
                  amount: vprecaCode.amount,
                  expiryDate: vprecaCode.expiryDate ?? "not provided",
                  orderId,
                  paymentPreimage: payResult.preimage,
                  // deprecated fields for backward compat
                  cardNumber: vprecaCode.cardNumber,
                  securityCode: vprecaCode.securityCode,
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
 * Extract bolt11 Lightning invoice from the payment page DOM.
 * Uses multiple strategies to find the invoice string.
 */
async function extractLightningInvoiceFromPage(
  page: import("playwright").Page,
): Promise<string | null> {
  // Strategy 1: Check for a copy button with invoice data attribute
  const copyBtn = page
    .getByRole("button", { name: /インボイスをコピー|コピー|copy/i })
    .first();
  if (await copyBtn.isVisible().catch(() => false)) {
    const dataInvoice = await copyBtn.getAttribute("data-clipboard-text");
    if (dataInvoice && dataInvoice.startsWith("lnbc")) return dataInvoice;
  }

  // Strategy 2: Find text starting with lnbc in page body text
  const allText = await page.textContent("body");
  if (allText) {
    const match = allText.match(/\b(lnbc[a-z0-9]+)\b/i);
    if (match) return match[1];
  }

  // Strategy 3: Search DOM innerHTML for hidden invoice data
  const invoice = await page.evaluate(() => {
    // Check data attributes
    const els = document.querySelectorAll("[data-invoice], [data-bolt11], [data-value]");
    for (const el of els) {
      for (const attr of ["data-invoice", "data-bolt11", "data-value"]) {
        const val = el.getAttribute(attr);
        if (val && val.startsWith("lnbc")) return val;
      }
    }
    // Search full innerHTML for lnbc pattern
    const all = document.body.innerHTML;
    const match = all.match(/(lnbc[a-z0-9]{50,})/i);
    return match ? match[1] : null;
  });
  if (invoice) return invoice;

  return null;
}

/**
 * Extract V-Preca voucher code and card last-4 from the order result page.
 *
 * UseBitcoin order page shows:
 *   コード 1/1
 *   [voucher code]  (alphanumeric, ~15 chars)
 *   [card last 4]   (4 digits)
 *
 * The two values appear as separate input/text fields after "コード".
 */
async function extractVPrecaCode(
  page: import("playwright").Page,
  expectedAmount: number,
): Promise<VPrecaCode> {
  // Wait for code content to render
  await humanDelay(1000, 2000);

  // Strategy 1: Find input fields (UseBitcoin renders codes in readonly inputs)
  const inputs = await page.locator("input[readonly], input[disabled]").all();
  if (inputs.length >= 2) {
    const voucherCode = await inputs[0].inputValue().catch(() => "");
    const cardLast4 = await inputs[1].inputValue().catch(() => "");
    if (voucherCode && cardLast4) {
      return {
        voucherCode,
        cardLast4,
        cardNumber: voucherCode,
        securityCode: cardLast4,
        amount: expectedAmount,
      };
    }
  }

  // Strategy 2: Parse from body text — "コード 1/1{code}{4digits}"
  const bodyText = (await page.textContent("body")) ?? "";
  const codeMatch = bodyText.match(/コード\s*\d+\/\d+\s*([A-Za-z0-9]{10,20})\s*(\d{4})/);
  if (codeMatch) {
    return {
      voucherCode: codeMatch[1],
      cardLast4: codeMatch[2],
      cardNumber: codeMatch[1],
      securityCode: codeMatch[2],
      amount: expectedAmount,
    };
  }

  // Strategy 3: Look for any alphanumeric code + 4-digit pattern
  const fallbackMatch = bodyText.match(/([A-Za-z][A-Za-z0-9]{9,19})\s*(\d{4})/);
  if (fallbackMatch) {
    return {
      voucherCode: fallbackMatch[1],
      cardLast4: fallbackMatch[2],
      cardNumber: fallbackMatch[1],
      securityCode: fallbackMatch[2],
      amount: expectedAmount,
    };
  }

  throw new Error(
    "Could not extract V-Preca voucher code from the order page. " +
      "The page structure may have changed.",
  );
}
