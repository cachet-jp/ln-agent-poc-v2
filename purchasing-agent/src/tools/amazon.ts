import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { newPage, humanDelay } from "../lib/browser.js";
import { getConfig } from "../lib/config.js";
import type { AmazonPurchaseResult } from "../types.js";
import { existsSync } from "node:fs";
import { join } from "node:path";

const AMAZON_BASE = "https://www.amazon.co.jp";
const STORAGE_STATE_PATH = join(process.cwd(), "storage-state", "amazon.json");

export function registerAmazonTools(server: McpServer): void {
  // ---- amazon_login ----
  server.tool(
    "amazon_login",
    "Log in to Amazon.co.jp with email and password. Saves session cookies for subsequent calls.",
    {},
    async () => {
      const config = getConfig();
      if (!config.AMAZON_EMAIL || !config.AMAZON_PASSWORD) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: AMAZON_EMAIL and AMAZON_PASSWORD must be set in .env",
            },
          ],
          isError: true,
        };
      }

      let page;
      try {
        page = await newPage();
        await page.goto(`${AMAZON_BASE}/ap/signin`, { waitUntil: "networkidle" });
        await humanDelay();

        // Enter email
        const emailInput = page.locator('#ap_email, input[name="email"]').first();
        await emailInput.fill(config.AMAZON_EMAIL);
        await humanDelay(300, 800);

        // Click continue
        const continueBtn = page.locator('#continue, input[id="continue"]').first();
        if (await continueBtn.isVisible()) {
          await continueBtn.click();
          await humanDelay();
        }

        // Enter password
        const passwordInput = page.locator('#ap_password, input[name="password"]').first();
        await passwordInput.waitFor({ timeout: 10000 });
        await passwordInput.fill(config.AMAZON_PASSWORD);
        await humanDelay(300, 800);

        // Click sign in
        const signInBtn = page.locator('#signInSubmit, input[name="signIn"]').first();
        await signInBtn.click();
        await humanDelay(2000, 4000);

        // Check for 2FA / captcha
        const page2FA = page.locator('#auth-mfa-otpcode, #captchacharacters');
        if (await page2FA.isVisible().catch(() => false)) {
          await page.context().close();
          return {
            content: [
              {
                type: "text" as const,
                text: "Login requires 2FA or CAPTCHA. Please use a test account without 2FA, or complete verification manually.",
              },
            ],
            isError: true,
          };
        }

        // Verify login success
        const loggedIn = await page
          .locator('#nav-link-accountList, #nav-item-signout')
          .isVisible()
          .catch(() => false);

        if (!loggedIn) {
          await page.context().close();
          return {
            content: [
              {
                type: "text" as const,
                text: "Login may have failed — could not verify logged-in state. Check credentials.",
              },
            ],
            isError: true,
          };
        }

        // Save session
        const { mkdirSync } = await import("node:fs");
        mkdirSync(join(process.cwd(), "storage-state"), { recursive: true });
        await page.context().storageState({ path: STORAGE_STATE_PATH });
        await page.context().close();

        return {
          content: [
            { type: "text" as const, text: "Successfully logged in to Amazon.co.jp. Session saved." },
          ],
        };
      } catch (err) {
        if (page) {
          try { await page.context().close(); } catch { /* ignore */ }
        }
        return {
          content: [
            { type: "text" as const, text: `Amazon login failed: ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  );

  // ---- amazon_charge_vpreca ----
  server.tool(
    "amazon_charge_vpreca",
    "Add a V-Preca card as payment method on Amazon.co.jp. Must be logged in first (call amazon_login).",
    {
      cardNumber: z.string().length(16).describe("V-Preca 16-digit card number"),
      securityCode: z.string().length(3).describe("V-Preca 3-digit security code"),
      cardholderName: z.string().default("VPRECA HOLDER").describe("Name on card (default: VPRECA HOLDER)"),
    },
    async ({ cardNumber, securityCode, cardholderName }) => {
      if (!existsSync(STORAGE_STATE_PATH)) {
        return {
          content: [
            { type: "text" as const, text: "Error: Not logged in. Call amazon_login first." },
          ],
          isError: true,
        };
      }

      let page;
      try {
        page = await newPage(STORAGE_STATE_PATH);

        // Navigate to payment methods
        await page.goto(`${AMAZON_BASE}/cpe/managepaymentmethods`, {
          waitUntil: "networkidle",
        });
        await humanDelay();

        // Click "Add a payment method" / "お支払い方法を追加"
        const addBtn = page.locator(
          'a:has-text("追加"), a:has-text("Add"), [data-action="add-payment-method"]',
        ).first();
        if (await addBtn.isVisible()) {
          await addBtn.click();
          await humanDelay();
        }

        // Select credit/debit card option
        const cardOption = page.locator(
          'a:has-text("クレジットまたはデビットカード"), a:has-text("Credit or debit card")',
        ).first();
        if (await cardOption.isVisible()) {
          await cardOption.click();
          await humanDelay();
        }

        // Fill card details
        const cardInput = page.locator(
          'input[name*="cardNumber"], input[name*="addCreditCardNumber"], #addCreditCardNumber',
        ).first();
        await cardInput.waitFor({ timeout: 10000 });
        await cardInput.fill(cardNumber);
        await humanDelay(200, 500);

        // Cardholder name
        const nameInput = page.locator(
          'input[name*="cardholderName"], input[name*="accountHolderName"]',
        ).first();
        if (await nameInput.isVisible()) {
          await nameInput.fill(cardholderName);
          await humanDelay(200, 500);
        }

        // Security code
        const cvvInput = page.locator(
          'input[name*="securityCode"], input[name*="verificationNumber"]',
        ).first();
        if (await cvvInput.isVisible()) {
          await cvvInput.fill(securityCode);
          await humanDelay(200, 500);
        }

        // Submit
        const submitBtn = page.locator(
          'input[name*="addCreditCard"], button:has-text("追加"), button:has-text("Add")',
        ).first();
        await submitBtn.click();
        await humanDelay(2000, 4000);

        // Save updated session
        await page.context().storageState({ path: STORAGE_STATE_PATH });
        await page.context().close();

        return {
          content: [
            {
              type: "text" as const,
              text: `V-Preca card ending in ${cardNumber.slice(-4)} added as payment method on Amazon.`,
            },
          ],
        };
      } catch (err) {
        if (page) {
          try { await page.context().close(); } catch { /* ignore */ }
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to add V-Preca to Amazon: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ---- amazon_purchase ----
  server.tool(
    "amazon_purchase",
    "Purchase an item on Amazon.co.jp. Must be logged in and have a payment method. " +
      "Provide the product URL. Returns order ID on success.",
    {
      itemUrl: z.string().url().describe("Amazon.co.jp product page URL"),
    },
    async ({ itemUrl }) => {
      if (!existsSync(STORAGE_STATE_PATH)) {
        return {
          content: [
            { type: "text" as const, text: "Error: Not logged in. Call amazon_login first." },
          ],
          isError: true,
        };
      }

      let page;
      try {
        page = await newPage(STORAGE_STATE_PATH);

        // 1. Go to product page
        await page.goto(itemUrl, { waitUntil: "networkidle" });
        await humanDelay();

        // Get item name for the result
        const itemName =
          (await page.locator("#productTitle").textContent())?.trim() ?? "Unknown item";

        // Get price
        const priceText =
          (await page
            .locator('.a-price .a-offscreen, #priceblock_ourprice, #priceblock_dealprice')
            .first()
            .textContent()
            .catch(() => null)) ?? "Unknown price";

        // 2. Add to cart
        const addToCartBtn = page.locator("#add-to-cart-button").first();
        if (!(await addToCartBtn.isVisible())) {
          await page.context().close();
          return {
            content: [
              {
                type: "text" as const,
                text: `Cannot add "${itemName}" to cart — button not found. Item may be out of stock.`,
              },
            ],
            isError: true,
          };
        }
        await addToCartBtn.click();
        await humanDelay(1500, 3000);

        // 3. Go to cart
        await page.goto(`${AMAZON_BASE}/gp/cart/view.html`, { waitUntil: "networkidle" });
        await humanDelay();

        // 4. Proceed to checkout
        const checkoutBtn = page.locator(
          '#sc-buy-box-ptc-button input, [name="proceedToRetailCheckout"]',
        ).first();
        await checkoutBtn.click();
        await humanDelay(2000, 4000);

        // 5. Place order (the final "Place your order" button)
        // IMPORTANT: This is the irreversible step
        const placeOrderBtn = page.locator(
          '#submitOrderButtonId input, #placeYourOrder input, [name="placeYourOrder1"]',
        ).first();
        await placeOrderBtn.waitFor({ timeout: 15000 });
        await placeOrderBtn.click();
        await humanDelay(3000, 6000);

        // 6. Extract order ID from confirmation page
        const orderIdText = await page.textContent("body");
        const orderMatch = orderIdText?.match(
          /(?:注文番号|order\s*(?:number|id))[:\s]*([0-9-]+)/i,
        );
        const orderId = orderMatch?.[1] ?? "unknown";

        await page.context().storageState({ path: STORAGE_STATE_PATH });
        await page.context().close();

        const result: AmazonPurchaseResult = {
          orderId,
          itemName,
          totalAmount: priceText.trim(),
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, ...result },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        if (page) {
          try { await page.context().close(); } catch { /* ignore */ }
        }
        return {
          content: [
            {
              type: "text" as const,
              text: `Amazon purchase failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
