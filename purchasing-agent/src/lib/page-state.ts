import type { Page } from "playwright";
import type { AmazonPageState } from "../types.js";

/**
 * Detect the current Amazon page state by inspecting DOM elements.
 *
 * Check order (first match wins):
 *   1. success   — logged-in indicator present
 *   2. puzzle    — interactive challenge page (/ap/cvf/request)
 *   3. captcha   — traditional text CAPTCHA input or image visible
 *   4. email_otp — email verification code input
 *   5. sms_otp   — SMS/MFA code input
 *   6. error     — error alert banner
 *   7. registration_form — registration form fields
 *   8. unknown   — fallback
 */
export async function detectPageState(page: Page): Promise<AmazonPageState> {
  // 1. Success: user is logged in
  const loggedIn = await page
    .locator("#nav-link-accountList, #nav-item-signout")
    .first()
    .isVisible()
    .catch(() => false);
  if (loggedIn) return "success";

  // 2. Interactive puzzle / quiz challenge (Amazon CVF)
  // URL pattern: /ap/cvf/request or page contains "クイズを解いて"
  const isCvfUrl = page.url().includes("/ap/cvf/");
  if (isCvfUrl) {
    // Wait for the puzzle to load (spinner → actual challenge)
    await page
      .waitForSelector("iframe, #captchacharacters, #cvf-input-code", {
        timeout: 10000,
      })
      .catch(() => null);

    // After waiting, check if it's actually a text CAPTCHA
    const hasCaptchaInput = await page
      .locator("#captchacharacters, #auth-captcha-guess")
      .first()
      .isVisible()
      .catch(() => false);
    if (hasCaptchaInput) return "captcha";

    // Check for OTP code input
    const hasOtpInput = await page
      .locator("#cvf-input-code, #auth-mfa-otpcode")
      .first()
      .isVisible()
      .catch(() => false);
    if (hasOtpInput) {
      const pageText = await page.textContent("body").catch(() => "");
      if (
        pageText &&
        (pageText.includes("電話番号") ||
          pageText.includes("テキストメッセージ") ||
          pageText.includes("SMS"))
      ) {
        return "sms_otp";
      }
      return "email_otp";
    }

    // It's an interactive puzzle (iframe-based challenge or JS quiz)
    return "puzzle";
  }

  // Also detect puzzle by page text content (fallback for non-CVF URLs)
  const pageText = await page.textContent("body").catch(() => "");
  if (pageText && pageText.includes("クイズを解いて")) {
    return "puzzle";
  }

  // 3. Traditional text CAPTCHA challenge
  const captcha = await page
    .locator('#captchacharacters, img[src*="captcha"], #auth-captcha-image')
    .first()
    .isVisible()
    .catch(() => false);
  if (captcha) return "captcha";

  // 4. Email OTP verification
  const emailOtp = await page
    .locator("#cvf-input-code, #auth-mfa-otpcode")
    .first()
    .isVisible()
    .catch(() => false);
  if (emailOtp) {
    // Distinguish email vs SMS by checking surrounding text
    if (
      pageText &&
      (pageText.includes("電話番号") ||
        pageText.includes("テキストメッセージ") ||
        pageText.includes("SMS"))
    ) {
      return "sms_otp";
    }
    return "email_otp";
  }

  // 5. Error alert
  const error = await page
    .locator(
      ".a-alert-error, #auth-error-message-box, .a-box-inner .a-alert-content",
    )
    .first()
    .isVisible()
    .catch(() => false);
  if (error) return "error";

  // 6. Registration form
  const regForm = await page
    .locator('#ap_customer_name, input[name="customerName"]')
    .first()
    .isVisible()
    .catch(() => false);
  const isRegUrl = page.url().includes("/ap/register");
  if (regForm || isRegUrl) return "registration_form";

  return "unknown";
}

/**
 * Wait for the CVF puzzle page to fully load.
 *
 * Amazon's verification uses Arkose Labs FunCAPTCHA, which loads inside
 * nested iframes:
 *   #cvf-aamation-challenge-iframe → aacb-arkose-frame → game-core-frame
 *
 * Returns true if the puzzle infrastructure was detected, false if timed out.
 */
export async function waitForPuzzleLoad(page: Page): Promise<boolean> {
  // Wait for the Arkose Labs iframe to appear
  const result = await page
    .waitForSelector(
      "#cvf-aamation-challenge-iframe, iframe[name='aacb-arkose-frame']",
      { timeout: 15000 },
    )
    .catch(() => null);

  if (result) {
    // Give extra time for the puzzle UI to render inside the iframe
    await page.waitForTimeout(5000);
  }

  return result !== null;
}

/**
 * Extract error message text from the page, if any.
 */
export async function extractErrorMessage(page: Page): Promise<string | null> {
  const errorEl = page
    .locator(
      ".a-alert-error .a-alert-content, #auth-error-message-box .a-list-item",
    )
    .first();
  const visible = await errorEl.isVisible().catch(() => false);
  if (!visible) return null;
  const text = await errorEl.textContent().catch(() => null);
  return text?.trim() || null;
}

/**
 * Take a screenshot of the current page and return it as a base64 PNG.
 */
export async function takeScreenshot(page: Page): Promise<string> {
  const buffer = await page.screenshot({ type: "png" });
  return buffer.toString("base64");
}

/**
 * Capture a screenshot of just the CAPTCHA image element.
 * Falls back to full page screenshot if the element is not found.
 */
export async function captureCaptchaImage(page: Page): Promise<string> {
  const captchaImg = page
    .locator('#auth-captcha-image, img[src*="captcha"]')
    .first();
  const visible = await captchaImg.isVisible().catch(() => false);
  if (visible) {
    const buffer = await captchaImg.screenshot({ type: "png" });
    return buffer.toString("base64");
  }
  // Fallback: full page screenshot
  return takeScreenshot(page);
}
