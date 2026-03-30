import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { humanDelay, humanType } from "../lib/browser.js";
import { generatePassword } from "../lib/password.js";
import { CHROME_USER_AGENT } from "../lib/user-agent.js";
import { STEALTH_INIT_SCRIPT } from "../lib/stealth.js";
import { recordAttempt, checkAttemptRisk } from "../lib/attempt-tracker.js";
import {
  createSession,
  requireSession,
  getSession,
  setStep,
  setCredentials,
  closeSession,
} from "../lib/session.js";
import {
  detectPageState,
  extractErrorMessage,
  takeScreenshot,
  captureCaptchaImage,
  waitForPuzzleLoad,
} from "../lib/page-state.js";
import type { AmazonPageState } from "../types.js";

const AMAZON_BASE = "https://www.amazon.co.jp";
const STORAGE_STATE_DIR = join(process.cwd(), "storage-state");
const STORAGE_STATE_PATH = join(STORAGE_STATE_DIR, "amazon.json");

/**
 * Build an MCP response based on the detected page state.
 * Returns both image and text content as appropriate.
 */
async function buildStateResponse(
  page: import("playwright").Page,
  state: AmazonPageState,
  credentials?: { email: string; password: string },
) {
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  > = [];

  switch (state) {
    case "captcha": {
      const imgData = await captureCaptchaImage(page);
      content.push({
        type: "image" as const,
        data: imgData,
        mimeType: "image/png",
      });
      content.push({
        type: "text" as const,
        text: [
          "CAPTCHAが表示されています。画像の文字を読み取って amazon_continue ツールで入力してください。",
          "",
          '使い方: amazon_continue({ input: "表示されている文字" })',
        ].join("\n"),
      });
      break;
    }

    case "puzzle": {
      // Wait for the Arkose Labs puzzle to fully load before screenshotting
      await waitForPuzzleLoad(page);
      const screenshot = await takeScreenshot(page);
      content.push({
        type: "image" as const,
        data: screenshot,
        mimeType: "image/png",
      });
      content.push({
        type: "text" as const,
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
        type: "text" as const,
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
        type: "text" as const,
        text: [
          "SMS に送信された確認コードを入力してください。",
          "携帯電話のメッセージを確認し、コードを amazon_continue ツールで入力してください。",
          "",
          '使い方: amazon_continue({ input: "123456" })',
        ].join("\n"),
      });
      break;

    case "success": {
      // Save session state for subsequent amazon_login/purchase tools
      mkdirSync(STORAGE_STATE_DIR, { recursive: true });
      const session = getSession();
      if (session) {
        await session.context.storageState({ path: STORAGE_STATE_PATH });
      }

      const credInfo = credentials
        ? `\n  Email: ${credentials.email}\n  Password: ${credentials.password}`
        : "";

      content.push({
        type: "text" as const,
        text: [
          "Amazon アカウントの作成に成功しました！",
          credInfo,
          "",
          `セッションを ${STORAGE_STATE_PATH} に保存しました。`,
          "amazon_charge_vpreca / amazon_purchase ツールがそのまま使えます。",
        ].join("\n"),
      });
      break;
    }

    case "error": {
      const errorMsg = await extractErrorMessage(page);
      const screenshot = await takeScreenshot(page);
      content.push({
        type: "image" as const,
        data: screenshot,
        mimeType: "image/png",
      });
      content.push({
        type: "text" as const,
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
      content.push({
        type: "image" as const,
        data: screenshot,
        mimeType: "image/png",
      });
      content.push({
        type: "text" as const,
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
      content.push({
        type: "text" as const,
        text: `現在のステップ: ${state}`,
      });
  }

  return { content };
}

export function registerAmazonSetupTools(server: McpServer): void {
  // ======================================================
  // amazon_create_account — Start account creation flow
  // Uses Scrapling (stealth) by default, Playwright as fallback
  // ======================================================
  server.tool(
    "amazon_create_account",
    "Amazon.co.jp アカウント作成を開始します。" +
      "Scrapling (ステルスブラウザ) でボット検出を回避してフォームを送信します。" +
      "CAPTCHA やメール認証が出たら状態を返します。password を省略するとランダム生成します。" +
      'backend="playwright" で従来の Playwright バックエンドも使えます。',
    {
      name: z.string().describe("アカウント名 (氏名)"),
      email: z.string().email().describe("メールアドレス"),
      password: z
        .string()
        .min(6)
        .optional()
        .describe("パスワード (省略時は自動生成)"),
      backend: z
        .enum(["scrapling", "playwright"])
        .default("scrapling")
        .optional()
        .describe("ブラウザバックエンド (デフォルト: scrapling)"),
    },
    async ({ name, email, password: rawPassword, backend }) => {
      const password = rawPassword ?? generatePassword();
      const useScrapling = backend !== "playwright";

      // --- Disposable email domain warning ---
      const KNOWN_DISPOSABLE_DOMAINS = [
        "keemail.me", "guerrillamail.com", "guerrillamail.de",
        "tempmail.com", "mailinator.com", "throwaway.email",
        "yopmail.com", "sharklasers.com", "grr.la", "guerrillamail.info",
        "temp-mail.org", "fakeinbox.com", "dispostable.com",
        "maildrop.cc", "trashmail.com", "10minutemail.com",
      ];
      const emailDomain = email.split("@")[1]?.toLowerCase() ?? "";
      if (KNOWN_DISPOSABLE_DOMAINS.includes(emailDomain)) {
        return {
          content: [
            {
              type: "text" as const,
              text: [
                `⚠️ 使い捨てメールドメイン "${emailDomain}" が検出されました。`,
                "Amazon はこれらのドメインからの登録を即座にBANする可能性が高いです。",
                "",
                "推奨: Gmail, Yahoo, iCloud, Outlook 等の正規プロバイダを使用してください。",
                "",
                "このまま続行する場合は、別のメールアドレスで再度呼び出してください。",
              ].join("\n"),
            },
          ],
        };
      }

      // --- IP reputation risk check ---
      const riskWarning = checkAttemptRisk();
      if (riskWarning) {
        return {
          content: [
            {
              type: "text" as const,
              text: riskWarning,
            },
          ],
        };
      }

      if (useScrapling) {
        // === Scrapling backend (stealth, recommended) ===
        try {
          const { scraplingCreateAccount } = await import("../lib/scrapling.js");
          const result = await scraplingCreateAccount(email, name, password);

          const content: Array<{ type: "text"; text: string }> = [];

          if (result.state === "email_otp") {
            // Store credentials for later use
            setCredentials(email, password);
            content.push({
              type: "text" as const,
              text: [
                "📧 メール OTP 認証が必要です。",
                `メールアドレス ${email} に送信された確認コードを確認してください。`,
                "",
                'amazon_continue({ input: "確認コード" }) で入力してください。',
                "",
                `パスワード: ${password}`,
              ].join("\n"),
            });
          } else if (result.state === "captcha") {
            setCredentials(email, password);
            content.push({
              type: "text" as const,
              text: [
                "🔒 CAPTCHA が表示されました。",
                result.message,
                "",
                'amazon_continue({ input: "CAPTCHA文字" }) で入力してください。',
              ].join("\n"),
            });
          } else if (result.state === "success") {
            content.push({
              type: "text" as const,
              text: [
                "✅ Amazon アカウントが作成されました！",
                `メール: ${email}`,
                `パスワード: ${password}`,
                "",
                `セッションを ${STORAGE_STATE_PATH} に保存しました。`,
              ].join("\n"),
            });
          } else if (result.state === "puzzle") {
            setCredentials(email, password);
            content.push({
              type: "text" as const,
              text: [
                "🧩 パズル認証が表示されました (Scrapling でも回避できませんでした)。",
                result.message,
                "",
                'backend="playwright" + HEADLESS=false で手動操作を試してください。',
              ].join("\n"),
            });
          } else {
            setCredentials(email, password);
            content.push({
              type: "text" as const,
              text: [
                `状態: ${result.state}`,
                result.message,
                "",
                `パスワード: ${password}`,
              ].join("\n"),
            });
          }

          // Add screenshot paths if available
          if (result.screenshots && result.screenshots.length > 0) {
            content.push({
              type: "text" as const,
              text: `スクリーンショット: ${result.screenshots.join(", ")}`,
            });
          }

          return { content };
        } catch (err) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Scrapling でのアカウント作成失敗: ${(err as Error).message}\n\nbackend="playwright" で再試行できます。`,
              },
            ],
            isError: true,
          };
        }
      }

      // === Playwright backend (original, may trigger bot detection) ===
      try {
        // Create a persistent session
        const session = await createSession();
        setCredentials(email, password);

        const { page } = session;

        // === New unified Amazon sign-in/register flow ===
        // Step 1: Go to homepage first (direct /ap/register no longer works)
        await page.goto(`${AMAZON_BASE}/`, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });
        await humanDelay(1500, 3000);

        // Step 2: Click sign-in link on the nav bar
        const accountLink = page
          .locator("#nav-link-accountList")
          .first();
        await accountLink.waitFor({ timeout: 10000 });
        await accountLink.click();
        await page.waitForLoadState("domcontentloaded");
        await humanDelay(1500, 3000);

        // Step 3: Enter email in the unified sign-in field (human-like typing)
        await page
          .locator('#ap_email, input[type="email"], input[name="email"]')
          .first()
          .waitFor({ timeout: 10000 });
        await humanType(page, '#ap_email, input[type="email"], input[name="email"]', email);
        await humanDelay(300, 600);

        // Click "次に進む" (Continue)
        const continueBtn = page
          .locator("#continue, input[id='continue']")
          .first();
        await continueBtn.click();
        await page.waitForLoadState("domcontentloaded");
        await humanDelay(2000, 4000);

        // Step 4: Handle the intent confirmation page
        // "Amazonを初めてご利用のようです" → Click "アカウントの作成に進む"
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

        // Step 5: Fill the registration form (human-like typing)
        await page
          .locator('#ap_customer_name, input[name="customerName"]')
          .first()
          .waitFor({ timeout: 10000 });
        await humanType(page, '#ap_customer_name, input[name="customerName"]', name);
        await humanDelay(300, 600);

        // Email may be pre-filled; re-fill if empty
        const emailValue = await page.locator("#ap_email").first()
          .inputValue()
          .catch(() => "");
        if (!emailValue) {
          await humanType(page, "#ap_email", email);
          await humanDelay(300, 600);
        }

        // Fill password (human-like)
        await humanType(page, "#ap_password", password);
        await humanDelay(300, 600);

        // Fill password confirmation (if visible)
        const passwordCheckInput = page.locator("#ap_password_check").first();
        if (await passwordCheckInput.isVisible().catch(() => false)) {
          await humanType(page, "#ap_password_check", password);
          await humanDelay(300, 600);
        }

        // Submit the registration form
        const submitBtn = page
          .locator(
            '#continue, input[type="submit"], #auth-create-account-link',
          )
          .first();
        if (await submitBtn.isVisible().catch(() => false)) {
          await submitBtn.click();
          await humanDelay(2000, 4000);
        }

        // Detect new page state
        const state = await detectPageState(page);
        setStep(state);
        recordAttempt(email, state);

        return buildStateResponse(page, state, { email, password });
      } catch (err) {
        recordAttempt(email, "error");
        return {
          content: [
            {
              type: "text" as const,
              text: `Amazon アカウント作成失敗: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ======================================================
  // amazon_continue — Continue the flow (CAPTCHA / OTP)
  // ======================================================
  server.tool(
    "amazon_continue",
    "アカウント作成フローの次のステップに進みます。" +
      "CAPTCHA の回答や OTP コードを入力して送信します。",
    {
      input: z
        .string()
        .describe("CAPTCHA の文字、またはメール/SMS の確認コード"),
    },
    async ({ input }) => {
      try {
        const session = requireSession();
        const { page, step } = session;

        switch (step) {
          case "captcha": {
            // Fill CAPTCHA input
            const captchaInput = page
              .locator("#captchacharacters, #auth-captcha-guess")
              .first();
            await captchaInput.waitFor({ timeout: 5000 });
            await captchaInput.fill(input);
            await humanDelay(300, 600);

            // Submit
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
            // Fill OTP code
            const otpInput = page
              .locator(
                "#cvf-input-code, #auth-mfa-otpcode, input[name='code']",
              )
              .first();
            await otpInput.waitFor({ timeout: 5000 });
            await otpInput.fill(input);
            await humanDelay(300, 600);

            // Submit
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
            // For puzzle state, user solved it in the browser (HEADLESS=false)
            // or we just re-detect the current state.
            // "done" means user has solved the puzzle manually.
            if (input.toLowerCase() !== "done") {
              // Try to find any visible input and enter the value
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
            // Wait a moment for page transition after puzzle completion
            await humanDelay(2000, 4000);
            break;
          }

          default: {
            // For unknown/error states, try to find any visible input and submit
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

        // Detect new state
        const newState = await detectPageState(page);
        setStep(newState);

        return buildStateResponse(page, newState, session.credentials);
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `フロー継続失敗: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ======================================================
  // amazon_session_screenshot — Debug: get current page
  // ======================================================
  server.tool(
    "amazon_session_screenshot",
    "現在のブラウザセッションのスクリーンショットを返します（デバッグ用）。",
    {},
    async () => {
      try {
        const session = requireSession();
        const screenshot = await takeScreenshot(session.page);
        const state = await detectPageState(session.page);

        return {
          content: [
            {
              type: "image" as const,
              data: screenshot,
              mimeType: "image/png",
            },
            {
              type: "text" as const,
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
              type: "text" as const,
              text: `スクリーンショット取得失敗: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ======================================================
  // amazon_session_close — Clean up the session
  // ======================================================
  server.tool(
    "amazon_session_close",
    "現在のブラウザセッションを終了してリソースを解放します。",
    {},
    async () => {
      await closeSession();
      return {
        content: [
          {
            type: "text" as const,
            text: "ブラウザセッションを終了しました。",
          },
        ],
      };
    },
  );

  // ======================================================
  // amazon_save_session — Manual login + cookie save
  // ======================================================
  server.tool(
    "amazon_save_session",
    "ブラウザを開いて Amazon.co.jp に手動でログインし、セッションクッキーを保存します。" +
      "HEADLESS=false で実行してください。ログインが完了するまで待機します。",
    {},
    async () => {
      try {
        const session = await createSession();
        const { page } = session;

        // Navigate to Amazon sign-in page
        await page.goto(`${AMAZON_BASE}/ap/signin?openid.return_to=https%3A%2F%2Fwww.amazon.co.jp%2F`, {
          waitUntil: "domcontentloaded",
          timeout: 30000,
        });

        // Poll for login success (check every 3s, max 10 min)
        const maxAttempts = 200;
        let attempts = 0;
        let loggedIn = false;

        while (attempts < maxAttempts) {
          await page.waitForTimeout(3000);
          attempts++;

          // Check if user is now logged in (nav bar shows account info)
          loggedIn = await page
            .locator("#nav-link-accountList")
            .isVisible()
            .catch(() => false);

          if (loggedIn) {
            // Additional check: ensure the page is on amazon.co.jp (not still on sign-in)
            const url = page.url();
            const isSignInPage = url.includes("/ap/signin") || url.includes("/ap/register") || url.includes("/ap/cvf/");
            if (!isSignInPage) break;
          }

          // Also check if we're on the homepage after login
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
                type: "text" as const,
                text: "タイムアウト: 10分以内にログインが完了しませんでした。再度 amazon_save_session を呼び出してください。",
              },
            ],
            isError: true,
          };
        }

        // Save session cookies
        mkdirSync(STORAGE_STATE_DIR, { recursive: true });
        await session.context.storageState({ path: STORAGE_STATE_PATH });

        await closeSession();

        return {
          content: [
            {
              type: "text" as const,
              text: [
                "✅ Amazon セッションを保存しました。",
                `保存先: ${STORAGE_STATE_PATH}`,
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
              type: "text" as const,
              text: `セッション保存失敗: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  // ======================================================
  // amazon_check_session — Validate saved session cookies
  // ======================================================
  server.tool(
    "amazon_check_session",
    "保存済みのセッションクッキーが有効かどうか確認します。",
    {},
    async () => {
      const { existsSync } = await import("node:fs");

      if (!existsSync(STORAGE_STATE_PATH)) {
        return {
          content: [
            {
              type: "text" as const,
              text: [
                "セッションファイルが見つかりません。",
                "amazon_save_session でログインしてセッションを保存してください。",
              ].join("\n"),
            },
          ],
        };
      }

      try {
        const session = await createSession();
        const { page, context } = session;

        // Load saved cookies into a new context
        const { getBrowser } = await import("../lib/browser.js");
        const browser = await getBrowser();

        // Close the blank session, create one with saved state
        await closeSession();

        const savedContext = await browser.newContext({
          storageState: STORAGE_STATE_PATH,
          locale: "ja-JP",
          timezoneId: "Asia/Tokyo",
          viewport: { width: 1280, height: 800 },
          userAgent: CHROME_USER_AGENT,
        });

        // Apply anti-fingerprint patches to the session-check context too
        await savedContext.addInitScript(STEALTH_INIT_SCRIPT);

        const savedPage = await savedContext.newPage();

        try {
          // Navigate to Amazon to check if session is still valid
          await savedPage.goto(`${AMAZON_BASE}/`, {
            waitUntil: "domcontentloaded",
            timeout: 30000,
          });
          await humanDelay(2000, 4000);

          // Check if logged in
          const loggedIn = await savedPage
            .locator("#nav-link-accountList")
            .isVisible()
            .catch(() => false);

          // Try to get the account name
          let accountName = "";
          if (loggedIn) {
            accountName =
              (await savedPage
                .locator("#nav-link-accountList .nav-line-1")
                .textContent()
                .catch(() => "")) ?? "";
          }

          await savedContext.close();

          if (loggedIn && !accountName.includes("ログイン") && !accountName.includes("サインイン")) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: [
                    "✅ セッションは有効です。",
                    accountName ? `アカウント: ${accountName.trim()}` : "",
                    "",
                    "amazon_charge_vpreca / amazon_purchase が使用可能です。",
                  ]
                    .filter(Boolean)
                    .join("\n"),
                },
              ],
            };
          } else {
            return {
              content: [
                {
                  type: "text" as const,
                  text: [
                    "❌ セッションが無効または期限切れです。",
                    "amazon_save_session で再度ログインしてください。",
                  ].join("\n"),
                },
              ],
            };
          }
        } catch (err) {
          await savedContext.close().catch(() => {});
          throw err;
        }
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: `セッション確認失敗: ${(err as Error).message}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
