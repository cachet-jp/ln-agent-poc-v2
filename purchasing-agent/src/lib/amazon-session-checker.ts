/**
 * Browser-based Amazon session / cookie verification logic.
 *
 * Validates whether a saved Playwright storage-state file still represents a
 * valid, logged-in Amazon.co.jp session.
 */

import { existsSync } from "node:fs";
import { getBrowser, humanDelay } from "./browser.js";
import { CHROME_USER_AGENT } from "./user-agent.js";
import { STEALTH_INIT_SCRIPT } from "./stealth.js";

const AMAZON_BASE = "https://www.amazon.co.jp";

export interface SessionCheckResult {
  valid: boolean;
  accountName?: string;
  message: string;
}

/**
 * Check whether the session stored at `storageStatePath` is still valid by
 * opening a headless browser, loading the cookies, and navigating to Amazon.
 */
export async function checkSavedSession(
  storageStatePath: string,
): Promise<SessionCheckResult> {
  if (!existsSync(storageStatePath)) {
    return {
      valid: false,
      message: [
        "セッションファイルが見つかりません。",
        "amazon_save_session でログインしてセッションを保存してください。",
      ].join("\n"),
    };
  }

  const browser = await getBrowser();
  const savedContext = await browser.newContext({
    storageState: storageStatePath,
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    viewport: { width: 1280, height: 800 },
    userAgent: CHROME_USER_AGENT,
  });

  await savedContext.addInitScript(STEALTH_INIT_SCRIPT);
  const savedPage = await savedContext.newPage();

  try {
    await savedPage.goto(`${AMAZON_BASE}/`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await humanDelay(2000, 4000);

    const loggedIn = await savedPage
      .locator("#nav-link-accountList")
      .isVisible()
      .catch(() => false);

    let accountName = "";
    if (loggedIn) {
      accountName =
        (await savedPage
          .locator("#nav-link-accountList .nav-line-1")
          .textContent()
          .catch(() => "")) ?? "";
    }

    await savedContext.close();

    if (
      loggedIn &&
      !accountName.includes("ログイン") &&
      !accountName.includes("サインイン")
    ) {
      return {
        valid: true,
        accountName: accountName.trim() || undefined,
        message: [
          "✅ セッションは有効です。",
          accountName ? `アカウント: ${accountName.trim()}` : "",
          "",
          "amazon_charge_vpreca / amazon_purchase が使用可能です。",
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }

    return {
      valid: false,
      message: [
        "❌ セッションが無効または期限切れです。",
        "amazon_save_session で再度ログインしてください。",
      ].join("\n"),
    };
  } catch (err) {
    await savedContext.close().catch(() => {});
    throw err;
  }
}
