import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { newPage, humanDelay } from "../lib/browser.js";

const AMAZON_BASE = "https://www.amazon.co.jp";

export function registerAmazonSetupTools(server: McpServer): void {
  server.tool(
    "amazon_create_account",
    "Semi-automated Amazon.co.jp account creation. " +
      "Auto-fills name/email/password, then pauses for human to complete CAPTCHA and email verification. " +
      "Browser window will remain open (set HEADLESS=false in .env).",
    {
      name: z.string().describe("Full name for the Amazon account"),
      email: z.string().email().describe("Email address for the account"),
      password: z
        .string()
        .min(6)
        .describe("Password (min 6 chars)"),
    },
    async ({ name, email, password }) => {
      let page;
      try {
        // Force non-headless for this tool (user needs to interact)
        const { chromium } = await import("playwright");
        const browser = await chromium.launch({ headless: false });
        const context = await browser.newContext();
        page = await context.newPage();

        // 1. Navigate to registration page
        await page.goto(`${AMAZON_BASE}/ap/register`, {
          waitUntil: "networkidle",
        });
        await humanDelay();

        // 2. Fill name
        const nameInput = page.locator(
          '#ap_customer_name, input[name="customerName"]',
        ).first();
        await nameInput.waitFor({ timeout: 10000 });
        await nameInput.fill(name);
        await humanDelay(300, 600);

        // 3. Fill email
        const emailInput = page.locator(
          '#ap_email, input[name="email"]',
        ).first();
        await emailInput.fill(email);
        await humanDelay(300, 600);

        // 4. Fill password
        const passwordInput = page.locator(
          '#ap_password, input[name="password"]',
        ).first();
        await passwordInput.fill(password);
        await humanDelay(300, 600);

        // 5. Fill password confirmation
        const passwordCheckInput = page.locator(
          '#ap_password_check, input[name="passwordCheck"]',
        ).first();
        if (await passwordCheckInput.isVisible().catch(() => false)) {
          await passwordCheckInput.fill(password);
          await humanDelay(300, 600);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: [
                "Amazon account registration form has been auto-filled:",
                `  Name: ${name}`,
                `  Email: ${email}`,
                "",
                "The browser window is now open. Please complete these steps manually:",
                "  1. Solve any CAPTCHA if shown",
                '  2. Click the "Create Account" / "アカウントを作成" button',
                "  3. Enter the verification code sent to your email",
                "  4. Complete any additional verification steps",
                "",
                "After account creation is complete, you can close the browser.",
                "Then update AMAZON_EMAIL and AMAZON_PASSWORD in your .env file.",
              ].join("\n"),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Amazon account setup failed: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
