/**
 * Interactive test script for Amazon account creation flow.
 *
 * Usage:
 *   HEADLESS=false npx tsx test-account-flow.ts
 *
 * This script drives the same code paths as the MCP tools but
 * runs in a single process so the persistent session is preserved
 * across steps.  Screenshots are saved to /tmp/amazon-*.png for
 * inspection.
 */

import { createSession, setCredentials, setStep, getSession, closeSession } from "./src/lib/session.js";
import { detectPageState, takeScreenshot, captureCaptchaImage, extractErrorMessage, waitForPuzzleLoad } from "./src/lib/page-state.js";
import { generatePassword } from "./src/lib/password.js";
import { humanDelay } from "./src/lib/browser.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as readline from "node:readline";

const AMAZON_BASE = "https://www.amazon.co.jp";

// ── helpers ──────────────────────────────────────────────────

function saveScreenshot(base64: string, label: string): string {
  const dir = "/tmp/amazon-test";
  mkdirSync(dir, { recursive: true });
  const ts = Date.now();
  const path = join(dir, `${label}-${ts}.png`);
  writeFileSync(path, Buffer.from(base64, "base64"));
  return path;
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// ── main ─────────────────────────────────────────────────────

async function main() {
  const email = "bitmart@keemail.me";
  const name = "John Doe";
  const password = generatePassword();

  console.log("=== Amazon Account Creation Test ===");
  console.log(`  Name:     ${name}`);
  console.log(`  Email:    ${email}`);
  console.log(`  Password: ${password}`);
  console.log("");

  // Step 1: Create session
  console.log("[1/5] Creating browser session...");
  const session = await createSession();
  setCredentials(email, password);
  const { page } = session;

  try {
    // Step 2: Navigate to homepage
    console.log("[2/5] Navigating to Amazon.co.jp...");
    await page.goto(`${AMAZON_BASE}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await humanDelay(1500, 3000);

    // Step 3: Click sign-in
    console.log("[3/5] Clicking sign-in link...");
    const accountLink = page.locator("#nav-link-accountList").first();
    await accountLink.waitFor({ timeout: 10000 });
    await accountLink.click();
    await page.waitForLoadState("domcontentloaded");
    await humanDelay(1500, 3000);

    // Step 4: Enter email
    console.log("[4/5] Entering email...");
    const emailField = page.locator('#ap_email, input[type="email"], input[name="email"]').first();
    await emailField.waitFor({ timeout: 10000 });
    await emailField.fill(email);
    await humanDelay(300, 600);

    const continueBtn = page.locator("#continue, input[id='continue']").first();
    await continueBtn.click();
    await page.waitForLoadState("domcontentloaded");
    await humanDelay(2000, 4000);

    // Step 5: Handle intent confirmation page
    console.log("[5/5] Handling intent confirmation...");
    const createBtn = page.locator(
      'span:has-text("アカウントの作成に進む"), button:has-text("アカウントの作成"), a:has-text("アカウントの作成")',
    ).first();
    if (await createBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await createBtn.click();
      await page.waitForLoadState("domcontentloaded");
      await humanDelay(2000, 4000);
    }

    // Step 6: Fill registration form
    console.log("[6] Filling registration form...");
    const nameInput = page.locator('#ap_customer_name, input[name="customerName"]').first();
    if (await nameInput.isVisible({ timeout: 10000 }).catch(() => false)) {
      await nameInput.fill(name);
      await humanDelay(300, 600);
    } else {
      console.log("  ⚠ Name field not found, taking screenshot...");
      const ss = await takeScreenshot(page);
      const p = saveScreenshot(ss, "no-name-field");
      console.log(`  Screenshot: ${p}`);
      console.log(`  URL: ${page.url()}`);
      console.log(`  Title: ${await page.title()}`);
    }

    // Re-fill email if empty
    const regEmailInput = page.locator("#ap_email").first();
    const emailValue = await regEmailInput.inputValue().catch(() => "");
    if (!emailValue) {
      await regEmailInput.fill(email);
      await humanDelay(300, 600);
    }

    // Fill password
    const passwordInput = page.locator("#ap_password").first();
    if (await passwordInput.isVisible().catch(() => false)) {
      await passwordInput.fill(password);
      await humanDelay(300, 600);
    }

    // Fill password confirmation
    const passwordCheckInput = page.locator("#ap_password_check").first();
    if (await passwordCheckInput.isVisible().catch(() => false)) {
      await passwordCheckInput.fill(password);
      await humanDelay(300, 600);
    }

    // Submit
    console.log("[7] Submitting registration form...");
    const submitBtn = page.locator('#continue, input[type="submit"], #auth-create-account-link').first();
    if (await submitBtn.isVisible().catch(() => false)) {
      await submitBtn.click();
      await humanDelay(2000, 4000);
    }

    // Detect state
    let state = await detectPageState(page);
    setStep(state);
    console.log(`\n=== Detected state: ${state} ===`);
    console.log(`URL: ${page.url()}`);

    // Take a screenshot regardless
    const ss = await takeScreenshot(page);
    const ssPath = saveScreenshot(ss, `state-${state}`);
    console.log(`Screenshot saved: ${ssPath}`);

    // Interactive loop for CAPTCHA / OTP
    while (state !== "success" && state !== "error") {
      if (state === "captcha") {
        const captchaImg = await captureCaptchaImage(page);
        const captchaPath = saveScreenshot(captchaImg, "captcha");
        console.log(`\nCAPTCHA detected! Image saved: ${captchaPath}`);
        console.log("Open the image and enter the text below.");
        const answer = await prompt("CAPTCHA text> ");

        const captchaInput = page.locator("#captchacharacters, #auth-captcha-guess").first();
        await captchaInput.fill(answer);
        await humanDelay(300, 600);
        const btn = page.locator('button[type="submit"], .a-button-input, input[type="submit"]').first();
        await btn.click();
        await humanDelay(2000, 4000);

      } else if (state === "email_otp" || state === "sms_otp") {
        const otpType = state === "email_otp" ? "Email" : "SMS";
        console.log(`\n${otpType} OTP required!`);
        const code = await prompt(`Enter ${otpType} verification code> `);

        const otpInput = page.locator("#cvf-input-code, #auth-mfa-otpcode, input[name='code']").first();
        await otpInput.fill(code);
        await humanDelay(300, 600);
        const btn = page.locator("#cvf-submit-otp-button, button[type='submit'], .a-button-input, input[type='submit']").first();
        await btn.click();
        await humanDelay(2000, 4000);

      } else if (state === "puzzle") {
        const isHeadless = process.env.HEADLESS !== "false";
        console.log("\n⚠ Arkose Labs FunCAPTCHA (interactive puzzle) detected!");
        if (isHeadless) {
          console.log("Cannot solve in headless mode.");
          console.log("Re-run with: HEADLESS=false npx tsx test-account-flow.ts");
          break;
        }
        // In headed mode, wait for user to solve manually
        console.log("Please solve the puzzle in the browser window.");
        console.log("Waiting for puzzle completion (checking every 5s)...");
        // Poll until state changes (user solved the puzzle)
        let attempts = 0;
        const maxAttempts = 60; // 5 min max
        while (attempts < maxAttempts) {
          await page.waitForTimeout(5000);
          attempts++;
          const currentState = await detectPageState(page);
          if (currentState !== "puzzle") {
            console.log(`Puzzle resolved! New state: ${currentState}`);
            state = currentState;
            setStep(state);
            break;
          }
          console.log(`  Still on puzzle page... (${attempts * 5}s elapsed)`);
        }
        if (attempts >= maxAttempts) {
          console.log("Timed out waiting for puzzle resolution.");
          break;
        }
        continue; // Re-enter the loop with the new state

      } else if (state === "unknown") {
        console.log("\nUnknown page state.");
        const answer = await prompt("Enter any input to try, or 'quit' to exit> ");
        if (answer === "quit") break;

        const anyInput = page.locator("input[type='text'], input[type='tel']").first();
        if (await anyInput.isVisible().catch(() => false)) {
          await anyInput.fill(answer);
          await humanDelay(300, 600);
          const btn = page.locator("button[type='submit'], .a-button-input, input[type='submit']").first();
          if (await btn.isVisible().catch(() => false)) {
            await btn.click();
            await humanDelay(2000, 4000);
          }
        }
      } else {
        // registration_form or other states that shouldn't loop
        break;
      }

      // Re-detect
      state = await detectPageState(page);
      setStep(state);
      console.log(`\n=== Detected state: ${state} ===`);
      console.log(`URL: ${page.url()}`);

      const newSs = await takeScreenshot(page);
      const newPath = saveScreenshot(newSs, `state-${state}`);
      console.log(`Screenshot saved: ${newPath}`);
    }

    // Final result
    if (state === "success") {
      const storageDir = join(process.cwd(), "storage-state");
      mkdirSync(storageDir, { recursive: true });
      await session.context.storageState({ path: join(storageDir, "amazon.json") });
      console.log("\n✅ Account created successfully!");
      console.log(`  Email:    ${email}`);
      console.log(`  Password: ${password}`);
      console.log(`  Session saved to: storage-state/amazon.json`);
    } else if (state === "error") {
      const errorMsg = await extractErrorMessage(page);
      console.log(`\n❌ Error: ${errorMsg ?? "Unknown error"}`);
    } else {
      console.log(`\n⚠ Flow ended in state: ${state}`);
    }

  } catch (err) {
    console.error("Fatal error:", (err as Error).message);
    const ss = await takeScreenshot(page).catch(() => "");
    if (ss) {
      const p = saveScreenshot(ss, "error");
      console.log(`Error screenshot: ${p}`);
    }
  } finally {
    await closeSession();
    console.log("\nSession closed.");
    process.exit(0);
  }
}

main();
