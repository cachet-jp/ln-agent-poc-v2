/**
 * Playwright-based Amazon account registration flow.
 *
 * Implements the multi-step form filling, page navigation, CAPTCHA handling,
 * and manual login + session-save sequences using Playwright.
 */

import { mkdirSync } from "node:fs";
import type { Page, BrowserContext } from "playwright";
import { humanDelay, humanType } from "./browser.js";
import {
  detectPageState,
  extractErrorMessage,
  takeScreenshot,
  captureCaptchaImage,
  waitForPuzzleLoad,
} from "./page-state.js";
import {
  createSession,
  requireSession,
  getSession,
  setStep,
  setCredentials,
  closeSession,
} from "./session.js";
import { recordAttempt } from "./attempt-tracker.js";
import type { AmazonPageState } from "../types.js";

const AMAZON_BASE = "https://www.amazon.co.jp";

// ---------------------------------------------------------------------------
// MCP content helpers
// ---------------------------------------------------------------------------

/** Standard MCP content item types used across responses. */
export type McpContentItem =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface McpResponse {
  content: McpContentItem[];
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// buildStateResponse — Shared by multiple tools
// ---------------------------------------------------------------------------

/**
 * Build an MCP response for a given Amazon page state. Returns image + text
 * content as appropriate (CAPTCHA image, screenshot, status messages, etc.).
 */
export async function buildStateResponse(
  page: Page,
  state: AmazonPageState,
  credentials?: { email: string; password: string },
  storageStatePath?: string,
): Promise<McpResponse> {
  const content: McpContentItem[] = [];

  switch (state) {
    case "captcha": {
      const imgData = await captureCaptchaImage(page);
      content.push({ type: "image", data: imgData, mimeType: "image/png" });
      content.push({
        type: "text",
        text: [
          "CAPTCHAが表示されています。画像の文字を読み取って amazon_continue ツールで入力してください。",
          "",
          '使い方: amazon_continue({ input: "表示されている文字" })',
        ].join("\n"),
      });
      break;
    }

    case "puzzle": {
      await waitForPuzzleLoad(page);
      const screenshot = await takeScreenshot(page);
      content.push({ type: "image", data: screenshot, mimeType: "image/png" });
      content.push({
        type: "text",
        text: [
          "Amazon の Arkose Labs パズル認証 (FunCAPTCHA) が表示されています。",
          "これはインタラクティブなパズルで、自動解決はできません。",
          `URL: ${page.url()}`,
          "",
          "対処方法:",
          "1. HEADLESS=false 環境変数でサーバーを再起動してください",
          "2. amazon_create_account を再度呼び出すと、ブラウザが表示されます",
          "3. ブラウザ画面でパズルを手動で解いてください",
          "4. 解決後、amazon_continue({ input: \"done\" }) で次のステップに進みます",
          "",
          "または amazon_session_close でセッションを終了してください。",
        ].join("\n"),
      });
      break;
    }

    case "email_otp":
      content.push({
        type: "text",
        text: [
          "メールに送信された確認コード (OTP) を入力してください。",
          "登録メールアドレスの受信箱を確認し、コードを amazon_continue ツールで入力してください。",
          "",
          '使い方: amazon_continue({ input: "123456" })',
        ].join("\n"),
      });
      break;

    case "sms_otp":
      content.push({
        type: "text",
        text: [
          "SMS に送信された確認コードを入力してください。",
          "携帯電話のメッセージを確認し、コードを amazon_continue ツールで入力してください。",
          "",
          '使い方: amazon_continue({ input: "123456" })',
        ].join("\n"),
      });
      break;

    case "success": {
      if (storageStatePath) {
        const storageDir = storageStatePath.replace(/\/[^/]+$/, "");
        mkdirSync(storageDir, { recursive: true });
        const session = getSession();
        if (session) {
          await session.context.storageState({ path: storageStatePath });
        }
      }

      const credInfo = credentials
        ? `\n  Email: ${credentials.email}\n  Password: ${credentials.password}`
        : "";

      content.push({
        type: "text",
        text: [
          "Amazon アカウントの作成に成功しました！",
          credInfo,
          "",
          storageStatePath
            ? `セッションを ${storageStatePath} に保存しました。`
            : "",
          "amazon_charge_vpreca / amazon_purchase ツールがそのまま使えます。",
        ]
          .filter(Boolean)
          .join("\n"),
      });
      break;
    }

    case "error": {
      const errorMsg = await extractErrorMessage(page);
      const screenshot = await takeScreenshot(page);
      content.push({ type: "image", data: screenshot, mimeType: "image/png" });
      content.push({
        type: "text",
        text: [
          "エラーが発生しました。",
          errorMsg
            ? `エラーメッセージ: ${errorMsg}`
            : "エラー内容はスクリーンショットを確認してください。",
          "",
          "amazon_session_screenshot で現在の画面を確認するか、amazon_session_close でセッションを終了してください。",
        ].join("\n"),
      });
      break;
    }

    case "unknown": {
      const screenshot = await takeScreenshot(page);
      content.push({ type: "image", data: screenshot, mimeType: "image/png" });
      content.push({
        type: "text",
        text: [
          "予期しないページ状態です。スクリーンショットを確認してください。",
          `URL: ${page.url()}`,
          `タイトル: ${await page.title()}`,
          "",
          "必要に応じて amazon_continue で入力を続けるか、amazon_session_close でセッションを終了してください。",
        ].join("\n"),
      });
      break;
    }

    default:
      content.push({ type: "text", text: `現在のステップ: ${state}` });
  }

  return { content };
}

// ---------------------------------------------------------------------------
// Playwright registration flow
// ---------------------------------------------------------------------------

export interface RegistrationParams {
  name: string;
  email: string;
  password: string;
}

/**
 * Execute the Playwright-based Amazon account registration flow.
 *
 * 1. Opens Amazon.co.jp homepage
 * 2. Clicks the sign-in link
 * 3. Enters email in the unified sign-in field
 * 4. Handles the "new account" intent confirmation
 * 5. Fills out the registration form
 *
 * Returns an MCP response with the resulting page state.
 */
export async function runPlaywrightRegistration(
  params: RegistrationParams,
  storageStatePath: string,
): Promise<McpResponse> {
  const { name, email, password } = params;

  try {
    const session = await createSession();
    setCredentials(email, password);
    const { page } = session;

    // Step 1: Homepage
    await page.goto(`${AMAZON_BASE}/`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await humanDelay(1500, 3000);

    // Step 2: Click sign-in
    const accountLink = page.locator("#nav-link-accountList").first();
    await accountLink.waitFor({ timeout: 10000 });
    await accountLink.click();
    await page.waitForLoadState("domcontentloaded");
    await humanDelay(1500, 3000);

    // Step 3: Enter email
    await page
      .locator('#ap_email, input[type="email"], input[name="email"]')
      .first()
      .waitFor({ timeout: 10000 });
    await humanType(
      page,
      '#ap_email, input[type="email"], input[name="email"]',
      email,
    );
    await humanDelay(300, 600);

    // Click continue
    const continueBtn = page
      .locator("#continue, input[id='continue']")
      .first();
    await continueBtn.click();
    await page.waitForLoadState("domcontentloaded");
    await humanDelay(2000, 4000);

    // Step 4: Handle intent confirmation
    const createBtn = page
      .locator(
        'span:has-text("アカウントの作成に進む"), ' +
          'button:has-text("アカウントの作成"), ' +
          'a:has-text("アカウントの作成")',
      )
      .first();
    if (await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await createBtn.click();
      await page.waitForLoadState("domcontentloaded");
      await humanDelay(2000, 4000);
    }

    // Step 5: Fill registration form
    await page
      .locator('#ap_customer_name, input[name="customerName"]')
      .first()
      .waitFor({ timeout: 10000 });
    await humanType(
      page,
      '#ap_customer_name, input[name="customerName"]',
      name,
    );
    await humanDelay(300, 600);

    // Email may be pre-filled
    const emailValue = await page
      .locator("#ap_email")
      .first()
      .inputValue()
      .catch(() => "");
    if (!emailValue) {
      await humanType(page, "#ap_email", email);
      await humanDelay(300, 600);
    }

    // Password
    await humanType(page, "#ap_password", password);
    await humanDelay(300, 600);

    // Password confirmation (if visible)
    const passwordCheckInput = page.locator("#ap_password_check").first();
    if (await passwordCheckInput.isVisible().catch(() => false)) {
      await humanType(page, "#ap_password_check", password);
      await humanDelay(300, 600);
    }

    // Submit
    const submitBtn = page
      .locator('#continue, input[type="submit"], #auth-create-account-link')
      .first();
    if (await submitBtn.isVisible().catch(() => false)) {
      await submitBtn.click();
      await humanDelay(2000, 4000);
    }

    // Detect resulting state
    const state = await detectPageState(page);
    setStep(state);
    recordAttempt(email, state);

    return buildStateResponse(page, state, { email, password }, storageStatePath);
  } catch (err) {
    recordAttempt(email, "error");
    return {
      content: [
        {
          type: "text",
          text: `Amazon アカウント作成失敗: ${(err as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Continue flow (CAPTCHA / OTP / puzzle)
// ---------------------------------------------------------------------------

/**
 * Continue the account-creation flow by submitting user input for the current
 * step (CAPTCHA answer, OTP code, or puzzle-done signal).
 */
export async function continueFlow(
  input: string,
  storageStatePath: string,
): Promise<McpResponse> {
  try {
    const session = requireSession();
    const { page, step } = session;

    switch (step) {
      case "captcha": {
        const captchaInput = page
          .locator("#captchacharacters, #auth-captcha-guess")
          .first();
        await captchaInput.waitFor({ timeout: 5000 });
        await captchaInput.fill(input);
        await humanDelay(300, 600);

        const submitBtn = page
          .locator(
            'button[type="submit"], .a-button-input, input[type="submit"]',
          )
          .first();
        await submitBtn.click();
        await humanDelay(2000, 4000);
        break;
      }

      case "email_otp":
      case "sms_otp": {
        const otpInput = page
          .locator(
            "#cvf-input-code, #auth-mfa-otpcode, input[name='code']",
          )
          .first();
        await otpInput.waitFor({ timeout: 5000 });
        await otpInput.fill(input);
        await humanDelay(300, 600);

        const submitBtn = page
          .locator(
            "#cvf-submit-otp-button, button[type='submit'], .a-button-input, input[type='submit']",
          )
          .first();
        await submitBtn.click();
        await humanDelay(2000, 4000);
        break;
      }

      case "puzzle": {
        if (input.toLowerCase() !== "done") {
          const anyInput = page
            .locator("input[type='text'], input[type='tel']")
            .first();
          if (await anyInput.isVisible().catch(() => false)) {
            await anyInput.fill(input);
            await humanDelay(300, 600);
            const btn = page
              .locator(
                "button[type='submit'], .a-button-input, input[type='submit']",
              )
              .first();
            if (await btn.isVisible().catch(() => false)) {
              await btn.click();
              await humanDelay(2000, 4000);
            }
          }
        }
        await humanDelay(2000, 4000);
        break;
      }

      default: {
        const anyInput = page
          .locator("input[type='text'], input[type='tel']")
          .first();
        if (await anyInput.isVisible().catch(() => false)) {
          await anyInput.fill(input);
          await humanDelay(300, 600);

          const submitBtn = page
            .locator(
              "button[type='submit'], .a-button-input, input[type='submit']",
            )
            .first();
          if (await submitBtn.isVisible().catch(() => false)) {
            await submitBtn.click();
            await humanDelay(2000, 4000);
          }
        }
      }
    }

    const newState = await detectPageState(page);
    setStep(newState);

    return buildStateResponse(page, newState, session.credentials, storageStatePath);
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `フロー継続失敗: ${(err as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Manual login + session save flow
// ---------------------------------------------------------------------------

/**
 * Open a browser for manual Amazon login. Polls until the user has logged in
 * (up to 10 minutes), then saves the session cookies.
 */
export async function runManualLoginAndSave(
  storageStatePath: string,
): Promise<McpResponse> {
  try {
    const session = await createSession();
    const { page } = session;

    await page.goto(
      `${AMAZON_BASE}/ap/signin?openid.return_to=https%3A%2F%2Fwww.amazon.co.jp%2F`,
      { waitUntil: "domcontentloaded", timeout: 30000 },
    );

    const maxAttempts = 200;
    let attempts = 0;
    let loggedIn = false;

    while (attempts < maxAttempts) {
      await page.waitForTimeout(3000);
      attempts++;

      loggedIn = await page
        .locator("#nav-link-accountList")
        .isVisible()
        .catch(() => false);

      if (loggedIn) {
        const url = page.url();
        const isSignInPage =
          url.includes("/ap/signin") ||
          url.includes("/ap/register") ||
          url.includes("/ap/cvf/");
        if (!isSignInPage) break;
      }

      const onHomepage =
        page.url().includes("amazon.co.jp") &&
        !page.url().includes("/ap/") &&
        (await page
          .locator("#nav-link-accountList")
          .isVisible()
          .catch(() => false));
      if (onHomepage) {
        loggedIn = true;
        break;
      }
    }

    if (!loggedIn) {
      await closeSession();
      return {
        content: [
          {
            type: "text",
            text: "タイムアウト: 10分以内にログインが完了しませんでした。再度 amazon_save_session を呼び出してください。",
          },
        ],
        isError: true,
      };
    }

    const storageDir = storageStatePath.replace(/\/[^/]+$/, "");
    mkdirSync(storageDir, { recursive: true });
    await session.context.storageState({ path: storageStatePath });
    await closeSession();

    return {
      content: [
        {
          type: "text",
          text: [
            "✅ Amazon セッションを保存しました。",
            `保存先: ${storageStatePath}`,
            "",
            "以下のツールがセッションクッキーで利用可能です:",
            "  - amazon_charge_vpreca: V-Preca カードを支払い方法に追加",
            "  - amazon_purchase: 商品を購入",
            "  - amazon_check_session: セッションの有効性を確認",
          ].join("\n"),
        },
      ],
    };
  } catch (err) {
    await closeSession().catch(() => {});
    return {
      content: [
        {
          type: "text",
          text: `セッション保存失敗: ${(err as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Screenshot helper
// ---------------------------------------------------------------------------

/**
 * Take a screenshot of the current session page and detect its state.
 */
export async function getSessionScreenshot(): Promise<McpResponse> {
  try {
    const session = requireSession();
    const screenshot = await takeScreenshot(session.page);
    const state = await detectPageState(session.page);

    return {
      content: [
        { type: "image", data: screenshot, mimeType: "image/png" },
        {
          type: "text",
          text: [
            `検出ステップ: ${state}`,
            `URL: ${session.page.url()}`,
            `タイトル: ${await session.page.title()}`,
          ].join("\n"),
        },
      ],
    };
  } catch (err) {
    return {
      content: [
        {
          type: "text",
          text: `スクリーンショット取得失敗: ${(err as Error).message}`,
        },
      ],
      isError: true,
    };
  }
}
