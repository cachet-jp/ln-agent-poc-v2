import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { generatePassword } from "../lib/password.js";
import { checkAttemptRisk } from "../lib/attempt-tracker.js";
import { setCredentials, closeSession } from "../lib/session.js";
import { checkDisposableEmail } from "../lib/email-validation.js";
import { checkSavedSession } from "../lib/amazon-session-checker.js";
import {
  runPlaywrightRegistration,
  continueFlow,
  runManualLoginAndSave,
  getSessionScreenshot,
} from "../lib/amazon-playwright-flow.js";
import { join } from "node:path";

const STORAGE_STATE_DIR = join(process.cwd(), "storage-state");
const STORAGE_STATE_PATH = join(STORAGE_STATE_DIR, "amazon.json");

export function registerAmazonSetupTools(server: McpServer): void {
  // ======================================================
  // amazon_create_account — Start account creation flow
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
      const disposableWarning = checkDisposableEmail(email);
      if (disposableWarning) {
        return {
          content: [{ type: "text" as const, text: disposableWarning.message }],
        };
      }

      // --- IP reputation risk check ---
      const riskWarning = checkAttemptRisk();
      if (riskWarning) {
        return {
          content: [{ type: "text" as const, text: riskWarning }],
        };
      }

      if (useScrapling) {
        // === Scrapling backend (stealth, recommended) ===
        try {
          const { scraplingCreateAccount } = await import(
            "../lib/scrapling.js"
          );
          const result = await scraplingCreateAccount(email, name, password);

          const content: Array<{ type: "text"; text: string }> = [];

          if (result.state === "email_otp") {
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

      // === Playwright backend ===
      return runPlaywrightRegistration(
        { name, email, password },
        STORAGE_STATE_PATH,
      );
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
      return continueFlow(input, STORAGE_STATE_PATH);
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
      return getSessionScreenshot();
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
      return runManualLoginAndSave(STORAGE_STATE_PATH);
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
      try {
        const result = await checkSavedSession(STORAGE_STATE_PATH);
        return {
          content: [{ type: "text" as const, text: result.message }],
        };
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
