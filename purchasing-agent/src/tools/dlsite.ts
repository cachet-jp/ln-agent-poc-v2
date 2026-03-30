import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { newPage, humanDelay } from "../lib/browser.js";
import { getConfig } from "../lib/config.js";
import type { DlsitePurchaseResult } from "../types.js";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const DLSITE_BASE = "https://www.dlsite.com";
const DLSITE_LOGIN = "https://login.dlsite.com";
const STORAGE_STATE_PATH = join(process.cwd(), "storage-state", "dlsite.json");

export function registerDlsiteTools(server: McpServer): void {
  // ---- dlsite_create_account ----
  server.tool(
    "dlsite_create_account",
    "Create a DLsite account (semi-automated). Fills email/password on signup page. " +
      "Human must solve reCAPTCHA and verify email. Call this once, then use dlsite_login.",
    {},
    async () => {
      const config = getConfig();
      if (!config.DLSITE_EMAIL || !config.DLSITE_PASSWORD) {
        return {
          content: [
            { type: "text" as const, text: "Error: DLSITE_EMAIL and DLSITE_PASSWORD must be set in .env" },
          ],
          isError: true,
        };
      }

      let page;
      try {
        page = await newPage();
        await page.goto(`${DLSITE_LOGIN}/signup`, {
          waitUntil: "domcontentloaded",
        });
        await humanDelay();

        // Fill email
        const emailInput = page.locator('input[name="email"], input[type="email"]').first();
        await emailInput.waitFor({ timeout: 10000 });
        await emailInput.fill(config.DLSITE_EMAIL);
        await humanDelay(300, 800);

        // Fill password
        const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
        await passwordInput.fill(config.DLSITE_PASSWORD);
        await humanDelay(300, 800);

        // Note: reCAPTCHA + email verification must be completed by human
        // Wait for redirect to DLsite after successful registration
        await page.waitForURL(/dlsite\.com(?!.*signup)/, { timeout: 300000 }); // 5 min
        await humanDelay(2000, 3000);

        // Save session
        mkdirSync(join(process.cwd(), "storage-state"), { recursive: true });
        await page.context().storageState({ path: STORAGE_STATE_PATH });
        await page.context().close();

        return {
          content: [
            { type: "text" as const, text: "DLsite account created and session saved. Use dlsite_login for future sessions." },
          ],
        };
      } catch (err) {
        if (page) {
          try { await page.context().close(); } catch { /* ignore */ }
        }
        return {
          content: [
            { type: "text" as const, text: `DLsite account creation failed: ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  );

  // ---- dlsite_login ----
  server.tool(
    "dlsite_login",
    "Log in to DLsite.com with email and password. Saves session cookies for subsequent calls.",
    {},
    async () => {
      const config = getConfig();
      if (!config.DLSITE_EMAIL || !config.DLSITE_PASSWORD) {
        return {
          content: [
            { type: "text" as const, text: "Error: DLSITE_EMAIL and DLSITE_PASSWORD must be set in .env" },
          ],
          isError: true,
        };
      }

      let page;
      try {
        // Reuse existing session if available
        const storagePath = existsSync(STORAGE_STATE_PATH) ? STORAGE_STATE_PATH : undefined;
        page = await newPage(storagePath);

        // Check if already logged in
        await page.goto(`${DLSITE_BASE}/`, { waitUntil: "domcontentloaded" });
        await humanDelay();

        const alreadyLoggedIn = await page
          .locator('a[href*="logout"], .header_mypage, a:has-text("マイページ")')
          .isVisible()
          .catch(() => false);

        if (alreadyLoggedIn) {
          await page.context().storageState({ path: STORAGE_STATE_PATH });
          await page.context().close();
          return {
            content: [
              { type: "text" as const, text: "Already logged in to DLsite.com (session reused)." },
            ],
          };
        }

        // Navigate to login page
        await page.goto(`${DLSITE_LOGIN}/login`, {
          waitUntil: "domcontentloaded",
        });
        await humanDelay();

        // Fill email
        const emailInput = page.locator('input[name="email"], input[name="login_id"], input[type="email"]').first();
        await emailInput.waitFor({ timeout: 10000 });
        await emailInput.fill(config.DLSITE_EMAIL);
        await humanDelay(300, 800);

        // Fill password
        const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
        await passwordInput.fill(config.DLSITE_PASSWORD);
        await humanDelay(300, 800);

        // Click login button
        const loginBtn = page.locator('button[type="submit"], input[type="submit"], button:has-text("ログイン")').first();
        await loginBtn.click();
        await humanDelay(2000, 4000);

        // Wait for redirect to DLsite
        await page.waitForURL(/dlsite\.com(?!.*login)/, { timeout: 15000 }).catch(() => null);
        await humanDelay();

        // Save session
        mkdirSync(join(process.cwd(), "storage-state"), { recursive: true });
        await page.context().storageState({ path: STORAGE_STATE_PATH });
        await page.context().close();

        return {
          content: [
            { type: "text" as const, text: "Successfully logged in to DLsite.com. Session saved." },
          ],
        };
      } catch (err) {
        if (page) {
          try { await page.context().close(); } catch { /* ignore */ }
        }
        return {
          content: [
            { type: "text" as const, text: `DLsite login failed: ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  );

  // ---- dlsite_purchase ----
  server.tool(
    "dlsite_purchase",
    "Purchase digital content on DLsite using BitCash payment. Must be logged in first (call dlsite_login). " +
      "Provide the product URL and BitCash hiragana ID.",
    {
      itemUrl: z.string().url().describe("DLsite product page URL"),
      bitcashId: z.string().min(8).describe("BitCash hiragana ID (from UseBitcoin purchase)"),
    },
    async ({ itemUrl, bitcashId }) => {
      if (!existsSync(STORAGE_STATE_PATH)) {
        return {
          content: [
            { type: "text" as const, text: "Error: Not logged in. Call dlsite_login first." },
          ],
          isError: true,
        };
      }

      let page;
      try {
        page = await newPage(STORAGE_STATE_PATH);

        // 1. Go to product page
        await page.goto(itemUrl, { waitUntil: "domcontentloaded" });
        await humanDelay();

        // Get title
        const title = (await page.locator("h1").first().textContent())?.trim() ?? "Unknown title";

        // Get price
        const priceText = (await page.locator('.work_buy_content .price, .work_buy .price, .btn_buy .price').first().textContent().catch(() => null)) ?? "";

        // 2. Click buy/add to cart button
        const buyBtn = page.locator(
          'a:has-text("買い物カゴに入れる"), a:has-text("カートに入れる"), ' +
            'button:has-text("購入"), a.btn_buy, a[href*="cart"]',
        ).first();

        if (!(await buyBtn.isVisible().catch(() => false))) {
          await page.context().close();
          return {
            content: [
              { type: "text" as const, text: `Cannot find purchase button for "${title}". Item may be unavailable.` },
            ],
            isError: true,
          };
        }
        await buyBtn.click();
        await humanDelay(2000, 3000);

        // 3. Go to cart / proceed to checkout
        // DLsite may redirect to cart or show a confirmation
        const cartUrl = `${DLSITE_BASE}/cart`;
        if (!page.url().includes("cart")) {
          await page.goto(cartUrl, { waitUntil: "domcontentloaded" });
          await humanDelay();
        }

        // Click checkout/proceed button
        const checkoutBtn = page.locator(
          'a:has-text("購入手続き"), a:has-text("レジへ進む"), button:has-text("購入"), ' +
            'a.btn_checkout, input[type="submit"]',
        ).first();
        if (await checkoutBtn.isVisible().catch(() => false)) {
          await checkoutBtn.click();
          await humanDelay(2000, 3000);
        }

        // 4. Select BitCash as payment method
        const bitcashOption = page.locator(
          'input[value*="bitcash"], label:has-text("BitCash"), label:has-text("ビットキャッシュ"), ' +
            'a:has-text("BitCash"), a:has-text("ビットキャッシュ")',
        ).first();
        if (await bitcashOption.isVisible().catch(() => false)) {
          await bitcashOption.click();
          await humanDelay(500, 1000);
        }

        // Click next/proceed after selecting payment method
        const nextBtn = page.locator(
          'button:has-text("次へ"), button:has-text("決済"), button[type="submit"], ' +
            'a:has-text("次へ"), input[type="submit"]',
        ).first();
        if (await nextBtn.isVisible().catch(() => false)) {
          await nextBtn.click();
          await humanDelay(2000, 3000);
        }

        // 5. Enter BitCash hiragana ID on the BitCash payment page
        // BitCash payment may redirect to bitcash.jp or show an inline form
        const bitcashInput = page.locator(
          'input[name*="bitcash"], input[name*="hiragana"], input[name*="id"], ' +
            'input[placeholder*="ひらがな"], input[type="text"]',
        ).first();
        await bitcashInput.waitFor({ timeout: 15000 });
        await bitcashInput.fill(bitcashId);
        await humanDelay(300, 800);

        // Submit BitCash payment
        const payBtn = page.locator(
          'button:has-text("決済"), button:has-text("支払"), button[type="submit"], ' +
            'input[type="submit"], input[value*="決済"]',
        ).first();
        await payBtn.click();
        await humanDelay(3000, 5000);

        // 6. Confirm if there's a confirmation step
        const confirmBtn = page.locator(
          'button:has-text("確認"), button:has-text("OK"), button:has-text("完了")',
        ).first();
        if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await confirmBtn.click();
          await humanDelay(2000, 3000);
        }

        // 7. Check for success
        const bodyText = (await page.textContent("body")) ?? "";
        const isSuccess = /購入完了|ご購入.*ありがとう|決済完了|purchase.*complet/i.test(bodyText);

        await page.context().storageState({ path: STORAGE_STATE_PATH });
        await page.context().close();

        const result: DlsitePurchaseResult = {
          title,
          paymentMethod: "BitCash",
          totalAmount: priceText.trim(),
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: isSuccess, ...result },
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
            { type: "text" as const, text: `DLsite purchase failed: ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  );
}
