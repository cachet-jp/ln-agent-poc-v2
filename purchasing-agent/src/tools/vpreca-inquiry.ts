import { z } from "zod";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { withPage, humanDelay, humanType } from "../lib/browser.js";
import { withErrorHandler } from "../lib/tool-helpers.js";
import { VPRECA_TERMS_URL, VPRECA_TERMS_NOTICE } from "../lib/vpreca-constants.js";
import type { VPrecaCardDetails } from "../types.js";

const VPRECA_INQUIRY_URL = VPRECA_TERMS_URL;

const execFileAsync = promisify(execFile);

// Open the inquiry page in the user's default browser so they read the terms
// and enter their own gift code — the consent-preserving path. Best-effort: on
// a headless/CI host (no opener, no display) we fall back to returning the URL.
async function openInquiryPageInBrowser(): Promise<boolean> {
  const [cmd, args]: [string, string[]] =
    process.platform === "darwin"
      ? ["open", [VPRECA_INQUIRY_URL]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", VPRECA_INQUIRY_URL]]
        : ["xdg-open", [VPRECA_INQUIRY_URL]];
  try {
    await execFileAsync(cmd, args, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Core inquiry function
// ---------------------------------------------------------------------------

export async function inquireVPrecaCard(
  giftCode: string,
  cardLast4: string,
): Promise<VPrecaCardDetails> {
  return withPage(async (page) => {
    // 1. Navigate to terms agreement page
    await page.goto(VPRECA_INQUIRY_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await humanDelay();

    // 2. Click the terms link to enable the checkbox (js-confirmed-agree-activation)
    const termsLink = page.locator(".js-confirmed-agree-activation__trigger").first();
    if (await termsLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      const [popup] = await Promise.all([
        page.context().waitForEvent("page", { timeout: 10000 }).catch(() => null),
        termsLink.click(),
      ]);
      await humanDelay(1000, 2000);
      if (popup) {
        await popup.close();
        await humanDelay(500, 1000);
      }
    }

    // 3. Enable checkbox, set checked, and enable the submit button via JS
    await page.evaluate(() => {
      const cb = document.querySelector("#termsAgreementFlg1") as HTMLInputElement;
      if (cb) {
        cb.disabled = false;
        cb.checked = true;
        cb.dispatchEvent(new Event("change", { bubbles: true }));
        cb.dispatchEvent(new Event("click", { bubbles: true }));
      }
      const btn = document.querySelector(".js-confirmed-agree-activation__target");
      if (btn) btn.classList.remove("is-disabled");
    });
    await humanDelay(300, 600);

    // 4. Submit via form submission to ensure proper POST with CSRF token
    await Promise.all([
      page.waitForNavigation({ timeout: 30000 }),
      page.locator(".js-confirmed-agree-activation__target").first().click(),
    ]);
    await humanDelay(1000, 2000);

    // 5. Wait for inquiry form to appear
    await page.waitForSelector("#certificationNumber", { timeout: 15000 });
    await humanDelay();

    // 6. Fill in gift code and card last 4 digits
    await humanType(page, "#certificationNumber", giftCode);
    await humanDelay(300, 600);
    await humanType(page, "#cardEndNumber", cardLast4);
    await humanDelay(300, 600);

    // 7. Submit — click "カード情報を見る"
    await Promise.all([
      page.waitForNavigation({ timeout: 30000 }),
      page.locator('button:has-text("カード情報を見る")').first().click(),
    ]);
    await humanDelay(2000, 3000);

    // 8. Extract card details
    return extractCardDetails(page);
  });
}

// ---------------------------------------------------------------------------
// MCP Tool Registration
// ---------------------------------------------------------------------------

export function registerVPrecaInquiryTools(server: McpServer): void {
  server.tool(
    "vpreca_open_inquiry_page",
    "V-Preca 照会ページ（利用規約同意ページ）をユーザーの既定ブラウザで開く。" +
      "アカウントレスでカード番号を発行する際の既定（推奨）手段で、ユーザー本人が規約を確認し、" +
      "購入したギフトコードとカード番号下4桁を入力する。" +
      "ブラウザを開けない環境（headless/CI 等）では opened:false を返すので、その場合は url を案内すること。",
    {},
    async () =>
      withErrorHandler(async () => {
        const opened = await openInquiryPageInBrowser();
        return {
          success: true,
          opened,
          url: VPRECA_INQUIRY_URL,
          notice: opened
            ? "ブラウザで V-Preca の利用規約を確認し、購入したギフトコードとカード番号下4桁を入力してください。"
            : "ブラウザを自動で開けませんでした。次の URL を手動で開いて、ギフトコードとカード番号下4桁を入力してください: " +
              VPRECA_INQUIRY_URL,
        };
      }),
  );

  server.tool(
    "vpreca_inquiry",
    "[opt-in] V-Preca ギフト照会をエージェントが代行する: ギフトコードとカード番号下4桁を入力して、" +
      "フルカード情報（カード番号、有効期限、セキュリティコード、残高）を取得する。" +
      "このツールはエージェントが利用規約に自動同意してカード情報を取得するため、" +
      "既定はユーザー主導の vpreca_open_inquiry_page を使い、本ツールはユーザーが明示的に代行を希望した場合にのみ使用すること。" +
      "レスポンスには V-Preca 利用規約ページの URL (`terms_url`) が含まれるので、カード番号を提示する前にユーザーへ案内すること。",
    {
      giftCode: z
        .string()
        .describe("V-Preca ギフトコード（UseBitcoin購入時に取得）"),
      cardLast4: z
        .string()
        .describe("カード番号下4桁（UseBitcoin購入時に取得、数字4桁）"),
    },
    async ({ giftCode, cardLast4 }) =>
      withErrorHandler(async () => {
        const result = await inquireVPrecaCard(giftCode, cardLast4);
        return {
          success: true,
          cardNumber: result.cardNumber,
          expiryDate: result.expiryDate,
          securityCode: result.securityCode,
          balance: result.balance,
          cardName: result.cardName ?? null,
          terms_url: VPRECA_TERMS_URL,
          notice: VPRECA_TERMS_NOTICE,
        };
      }),
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function extractCardDetails(
  page: import("playwright").Page,
): Promise<VPrecaCardDetails> {
  return page.evaluate(() => {
    // Card number: 4 spans with class cmn-form-credit-card__label containing 4 digits each
    const cardSpans = document.querySelectorAll("span.cmn-form-credit-card__label");
    const cardDigits = Array.from(cardSpans)
      .map((s) => s.textContent?.trim() ?? "")
      .filter((s) => /^\d{4}$/.test(s));
    const cardNumber = cardDigits.join("");

    // Expiry, CVV, Card name: p.js-card-copy elements (skip card number which is all digits)
    const copyEls = document.querySelectorAll("p.js-card-copy");
    const copyTexts = Array.from(copyEls)
      .map((el) => el.textContent?.trim() ?? "")
      .filter((t) => !/^\d+$/.test(t) || t.length === 3);

    // Order on page: [0] expiry (e.g. "12 / 30"), [1] CVV (e.g. "000"), [2] card name (e.g. "VPRECA")
    const expiryDate = copyTexts[0] ?? "";
    const securityCode = copyTexts[1] ?? "";
    const cardName = copyTexts[2] || undefined;

    // Balance: dd element after dt "現在残高"
    let balance = 0;
    const dts = document.querySelectorAll("dt");
    for (const dt of dts) {
      if (dt.textContent?.includes("残高")) {
        const dd = dt.nextElementSibling;
        const balanceText = dd?.textContent?.replace(/[^\d]/g, "") ?? "0";
        balance = parseInt(balanceText, 10) || 0;
        break;
      }
    }

    return { cardNumber, expiryDate, securityCode, balance, cardName };
  }).then((result) => {
    if (!result.cardNumber || result.cardNumber.length !== 16) {
      throw new Error(
        "カード番号を取得できませんでした。ページ構造が変更された可能性があります。",
      );
    }
    return result;
  });
}
