import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { newPage, humanDelay } from "../lib/browser.js";
import { getConfig } from "../lib/config.js";
import type { DmmPurchaseResult } from "../types.js";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const DMM_BASE = "https://www.dmm.com";
const DMM_ACCOUNTS = "https://accounts.dmm.com";
const STORAGE_STATE_PATH = join(process.cwd(), "storage-state", "dmm.json");

export function registerDmmTools(server: McpServer): void {
  // ---- dmm_create_account ----
  server.tool(
    "dmm_create_account",
    "Create a DMM account (semi-automated). Navigates to signup page and fills email/password. " +
      "Human must solve reCAPTCHA and verify email. Call this once, then use dmm_login.",
    {},
    async () => {
      const config = getConfig();
      if (!config.DMM_EMAIL || !config.DMM_PASSWORD) {
        return {
          content: [
            { type: "text" as const, text: "Error: DMM_EMAIL and DMM_PASSWORD must be set in .env" },
          ],
          isError: true,
        };
      }

      let page;
      try {
        page = await newPage();
        await page.goto(`${DMM_ACCOUNTS}/welcome/signup/email/`, {
          waitUntil: "domcontentloaded",
        });
        await humanDelay();

        // Fill email
        const emailInput = page.locator('input[name="email"], input[type="email"]').first();
        await emailInput.waitFor({ timeout: 10000 });
        await emailInput.fill(config.DMM_EMAIL);
        await humanDelay(300, 800);

        // Fill password
        const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
        await passwordInput.fill(config.DMM_PASSWORD);
        await humanDelay(300, 800);

        // Note: reCAPTCHA must be solved by human
        // Wait for human to complete reCAPTCHA + click submit + verify email
        // The page should eventually redirect to a logged-in state
        await page.waitForURL(/dmm\.com(?!.*signup)/, { timeout: 300000 }); // 5 min timeout
        await humanDelay(2000, 3000);

        // Save session
        mkdirSync(join(process.cwd(), "storage-state"), { recursive: true });
        await page.context().storageState({ path: STORAGE_STATE_PATH });
        await page.context().close();

        return {
          content: [
            { type: "text" as const, text: "DMM account created and session saved. You can now use dmm_login for future sessions." },
          ],
        };
      } catch (err) {
        if (page) {
          try { await page.context().close(); } catch { /* ignore */ }
        }
        return {
          content: [
            { type: "text" as const, text: `DMM account creation failed: ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  );

  // ---- dmm_login ----
  server.tool(
    "dmm_login",
    "Log in to DMM.com with email and password. Saves session cookies for subsequent calls.",
    {},
    async () => {
      const config = getConfig();
      if (!config.DMM_EMAIL || !config.DMM_PASSWORD) {
        return {
          content: [
            { type: "text" as const, text: "Error: DMM_EMAIL and DMM_PASSWORD must be set in .env" },
          ],
          isError: true,
        };
      }

      let page;
      try {
        // Reuse existing session if available
        const storagePath = existsSync(STORAGE_STATE_PATH) ? STORAGE_STATE_PATH : undefined;
        page = await newPage(storagePath);

        // Check if already logged in by visiting top page
        await page.goto(`${DMM_BASE}/`, { waitUntil: "domcontentloaded" });
        await humanDelay();

        const alreadyLoggedIn = await page
          .locator('a[href*="logout"], .naviAccountLink')
          .isVisible()
          .catch(() => false);

        if (alreadyLoggedIn) {
          await page.context().storageState({ path: STORAGE_STATE_PATH });
          await page.context().close();
          return {
            content: [
              { type: "text" as const, text: "Already logged in to DMM.com (session reused)." },
            ],
          };
        }

        // Navigate to login page
        await page.goto(`${DMM_ACCOUNTS}/service/login/password/`, {
          waitUntil: "domcontentloaded",
        });
        await humanDelay();

        // Fill email
        const emailInput = page.locator('input[name="login_id"], input[name="email"], input[type="email"]').first();
        await emailInput.waitFor({ timeout: 10000 });
        await emailInput.fill(config.DMM_EMAIL);
        await humanDelay(300, 800);

        // Fill password
        const passwordInput = page.locator('input[name="password"], input[type="password"]').first();
        await passwordInput.fill(config.DMM_PASSWORD);
        await humanDelay(300, 800);

        // Click login button
        const loginBtn = page.locator('button[type="submit"], input[type="submit"]').first();
        await loginBtn.click();
        await humanDelay(2000, 4000);

        // Check for 2FA
        const has2FA = await page
          .locator('input[name="otp"], input[name="totp"]')
          .isVisible()
          .catch(() => false);
        if (has2FA) {
          await page.context().close();
          return {
            content: [
              { type: "text" as const, text: "Login requires 2FA. Please complete verification manually or disable 2FA on the DMM account." },
            ],
            isError: true,
          };
        }

        // Verify login by checking redirect
        await page.waitForURL(/dmm\.com(?!.*login)/, { timeout: 15000 }).catch(() => null);
        await humanDelay();

        // Save session
        mkdirSync(join(process.cwd(), "storage-state"), { recursive: true });
        await page.context().storageState({ path: STORAGE_STATE_PATH });
        await page.context().close();

        return {
          content: [
            { type: "text" as const, text: "Successfully logged in to DMM.com. Session saved." },
          ],
        };
      } catch (err) {
        if (page) {
          try { await page.context().close(); } catch { /* ignore */ }
        }
        return {
          content: [
            { type: "text" as const, text: `DMM login failed: ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  );

  // ---- dmm_charge_points ----
  server.tool(
    "dmm_charge_points",
    "Charge DMM points using a point code purchased from UseBitcoin. Must be logged in first (call dmm_login).",
    {
      pointCode: z.string().min(8).describe("DMM point code string (from UseBitcoin purchase)"),
    },
    async ({ pointCode }) => {
      if (!existsSync(STORAGE_STATE_PATH)) {
        return {
          content: [
            { type: "text" as const, text: "Error: Not logged in. Call dmm_login first." },
          ],
          isError: true,
        };
      }

      let page;
      try {
        page = await newPage(STORAGE_STATE_PATH);

        // Navigate to point charge page
        await page.goto(`${DMM_BASE}/my/-/point/`, {
          waitUntil: "domcontentloaded",
        });
        await humanDelay();

        // Look for point code input section
        // DMM point charge page has a section for "ポイントコードを使う"
        const codeLink = page.locator('a:has-text("ポイントコード"), a:has-text("コード入力")').first();
        if (await codeLink.isVisible().catch(() => false)) {
          await codeLink.click();
          await humanDelay();
        }

        // Try navigating directly to the code redemption page
        await page.goto(`${DMM_BASE}/my/-/point/code/`, {
          waitUntil: "domcontentloaded",
        });
        await humanDelay();

        // Enter the point code
        const codeInput = page.locator(
          'input[name*="code"], input[name*="point_code"], input[placeholder*="コード"], input[type="text"]',
        ).first();
        await codeInput.waitFor({ timeout: 10000 });
        await codeInput.fill(pointCode);
        await humanDelay(300, 800);

        // Click submit/charge button
        const chargeBtn = page.locator(
          'button:has-text("チャージ"), button:has-text("交換"), button:has-text("送信"), button[type="submit"], input[type="submit"]',
        ).first();
        await chargeBtn.click();
        await humanDelay(2000, 4000);

        // Confirm if there's a confirmation dialog
        const confirmBtn = page.locator(
          'button:has-text("確認"), button:has-text("OK"), button:has-text("はい")',
        ).first();
        if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await confirmBtn.click();
          await humanDelay(2000, 3000);
        }

        // Check for success message
        const bodyText = (await page.textContent("body")) ?? "";
        const isSuccess = /チャージ完了|ポイント.*追加|成功|completed/.test(bodyText);

        // Try to extract current point balance
        const balanceMatch = bodyText.match(/(?:残高|ポイント)[:\s]*([0-9,]+)/);
        const balance = balanceMatch ? balanceMatch[1] : "unknown";

        // Save updated session
        await page.context().storageState({ path: STORAGE_STATE_PATH });
        await page.context().close();

        if (isSuccess) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { success: true, message: "DMM points charged successfully", currentBalance: balance },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Point code submitted but could not confirm success. Current balance: ${balance}. Please verify manually.`,
            },
          ],
        };
      } catch (err) {
        if (page) {
          try { await page.context().close(); } catch { /* ignore */ }
        }
        return {
          content: [
            { type: "text" as const, text: `DMM point charge failed: ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  );

  // ---- dmm_purchase ----
  server.tool(
    "dmm_purchase",
    "Purchase digital content on DMM.com using points. Must be logged in and have sufficient points. " +
      "Provide the product URL (DMM Books, games, etc.).",
    {
      itemUrl: z.string().url().describe("DMM product page URL"),
    },
    async ({ itemUrl }) => {
      if (!existsSync(STORAGE_STATE_PATH)) {
        return {
          content: [
            { type: "text" as const, text: "Error: Not logged in. Call dmm_login first." },
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

        // 2. Click purchase/buy button
        const buyBtn = page.locator(
          'a:has-text("購入する"), button:has-text("購入"), a:has-text("今すぐ購入"), ' +
            'a:has-text("ポイントで購入"), button:has-text("カートに入れる")',
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
        await humanDelay(2000, 4000);

        // 3. On purchase confirmation page, select point payment
        const pointPayment = page.locator(
          'input[value*="point"], label:has-text("ポイント"), a:has-text("ポイントで支払")',
        ).first();
        if (await pointPayment.isVisible().catch(() => false)) {
          await pointPayment.click();
          await humanDelay(500, 1000);
        }

        // 4. Confirm purchase
        const confirmBtn = page.locator(
          'button:has-text("購入を確定"), button:has-text("注文を確定"), button:has-text("購入する"), ' +
            'input[value*="購入"], a:has-text("購入を確定")',
        ).first();
        if (await confirmBtn.isVisible().catch(() => false)) {
          await confirmBtn.click();
          await humanDelay(3000, 5000);
        }

        // 5. Check for success
        const bodyText = (await page.textContent("body")) ?? "";
        const isSuccess = /購入完了|ご購入|ありがとう|purchase.*complet/i.test(bodyText);

        // Extract points used
        const pointsMatch = bodyText.match(/(\d+)\s*(?:pt|ポイント).*(?:利用|使用)/);
        const pointsUsed = pointsMatch ? parseInt(pointsMatch[1], 10) : 0;

        // Extract remaining points
        const remainingMatch = bodyText.match(/(?:残高|残り)[:\s]*(\d+)/);
        const remainingPoints = remainingMatch ? parseInt(remainingMatch[1], 10) : 0;

        await page.context().storageState({ path: STORAGE_STATE_PATH });
        await page.context().close();

        const result: DmmPurchaseResult = { title, pointsUsed, remainingPoints };

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
            { type: "text" as const, text: `DMM purchase failed: ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    },
  );
}
