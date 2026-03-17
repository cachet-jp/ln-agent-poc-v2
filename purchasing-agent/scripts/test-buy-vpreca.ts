/**
 * Test V-Preca purchase flow directly (without MCP server).
 * Includes EventSource polyfill for Node.js.
 */

// Polyfill EventSource
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { EventSource } = require("eventsource");
(globalThis as any).EventSource = EventSource;

import dotenv from "dotenv";
dotenv.config();

import { newPage, humanDelay, closeBrowser } from "../src/lib/browser.js";
import { payLightningInvoice, getBalance } from "../src/lib/clw-client.js";

const AMOUNT = 500;
const USEBITCOIN_BASE = "https://usebitcoin.jp";

async function main() {
  // Check balance first
  console.log("=== Check balance ===");
  const balance = await getBalance();
  console.log("Offchain available:", balance.offchain.available, "sats");
  if (balance.offchain.available === 0) {
    console.log("❌ No offchain balance. Onboard first.");
    return;
  }

  console.log("\n=== Navigating to V-Preca page ===");
  const page = await newPage();
  const productUrl = `${USEBITCOIN_BASE}/ja/products/vpricagift/vpreca-${AMOUNT}`;

  try {
    await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    console.log("Page loaded:", page.url());
    await humanDelay(2000, 3000);

    // Screenshot for debugging
    await page.screenshot({ path: "/tmp/vpreca-page.png" });
    console.log("Screenshot saved to /tmp/vpreca-page.png");

    // Accept terms checkbox — uses custom React Aria styling, so click the label text
    console.log("\n=== Accept terms ===");
    const termsLabel = page.getByText("利用規約に同意します");
    if (await termsLabel.isVisible({ timeout: 5000 }).catch(() => false)) {
      await termsLabel.click();
      console.log("Terms label clicked");
      await humanDelay(300, 600);
    } else {
      // Fallback: force-click the checkbox input
      const termsCheckbox = page.getByRole("checkbox").first();
      if (await termsCheckbox.isVisible({ timeout: 3000 }).catch(() => false)) {
        await termsCheckbox.click({ force: true });
        console.log("Terms checkbox force-clicked");
        await humanDelay(300, 600);
      } else {
        console.log("No terms checkbox found");
      }
    }

    // Click proceed button — this navigates to the payment page with QR/invoice
    console.log("\n=== Proceeding to payment ===");
    const proceedButton = page
      .getByRole("button", { name: /購入へ進む|購入|proceed/i })
      .first();
    await proceedButton.waitFor({ timeout: 10000 });
    console.log("Clicking proceed button...");
    await proceedButton.click();

    // Wait for the payment page to load (it shows QR code + invoice)
    await page.waitForSelector('text=/インボイスをコピー|sats/i', { timeout: 30000 });
    await humanDelay(2000, 3000);
    console.log("Payment page loaded:", page.url());

    // Extract bolt11 from "インボイスをコピー" button's clipboard data or page text
    let bolt11: string | null = null;

    // Strategy 1: Click "インボイスをコピー" and read clipboard
    const copyBtn = page.getByRole("button", { name: /インボイスをコピー|copy/i }).first();
    if (await copyBtn.isVisible().catch(() => false)) {
      // Try data-clipboard-text attribute
      const clipData = await copyBtn.getAttribute("data-clipboard-text").catch(() => null);
      if (clipData && clipData.startsWith("lnbc")) {
        bolt11 = clipData;
        console.log("Got invoice from clipboard data attribute");
      }
    }

    // Strategy 2: Search page text for lnbc... pattern
    if (!bolt11) {
      const allText = await page.textContent("body");
      if (allText) {
        const match = allText.match(/\b(lnbc[a-z0-9]+)\b/i);
        if (match) {
          bolt11 = match[1];
          console.log("Got invoice from page text");
        }
      }
    }

    // Strategy 3: Check for hidden input or data attributes
    if (!bolt11) {
      const invoice = await page.evaluate(() => {
        // Look for elements with invoice data
        const els = document.querySelectorAll("[data-invoice], [data-bolt11], [data-value]");
        for (const el of els) {
          for (const attr of ["data-invoice", "data-bolt11", "data-value"]) {
            const val = el.getAttribute(attr);
            if (val && val.startsWith("lnbc")) return val;
          }
        }
        // Look for any element containing lnbc
        const all = document.body.innerHTML;
        const match = all.match(/(lnbc[a-z0-9]{50,})/i);
        return match ? match[1] : null;
      });
      if (invoice) {
        bolt11 = invoice;
        console.log("Got invoice from DOM search");
      }
    }

    if (!bolt11 || !bolt11.startsWith("lnbc")) {
      // Save page for debugging
      const html = await page.content();
      const fs = await import("node:fs");
      fs.writeFileSync("/tmp/vpreca-payment-page.html", html);
      console.log("Page HTML saved to /tmp/vpreca-payment-page.html");
      throw new Error("Could not extract bolt11 invoice from payment page");
    }

    console.log("bolt11:", bolt11.substring(0, 60) + "...");
    console.log("bolt11 length:", bolt11.length);

    // Pay Lightning invoice
    console.log("\n=== Paying Lightning invoice ===");
    const payResult = await payLightningInvoice(bolt11);
    console.log("Payment result:", JSON.stringify(payResult, null, 2));

    if (!payResult.preimage) {
      throw new Error("Payment failed - no preimage");
    }

    // Wait for confirmation
    console.log("\n=== Waiting for order fulfillment ===");
    await Promise.race([
      page.waitForURL(/\/orders\//, { timeout: 120000 }),
      page
        .waitForSelector('text=/完了|fulfilled|success|paid/i', { timeout: 120000 })
        .catch(() => null),
    ]);
    await humanDelay(2000, 4000);

    // Screenshot result
    await page.screenshot({ path: "/tmp/vpreca-result.png" });
    console.log("Result screenshot: /tmp/vpreca-result.png");

    // Extract card details
    const bodyText = (await page.textContent("body")) ?? "";
    const cardMatch = bodyText.match(/\b(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4})\b/);
    const secMatch = bodyText.match(
      /(?:セキュリティコード|CVV|CVC|security\s*code|認証コード)[:\s]*(\d{3})/i,
    );

    if (cardMatch) {
      console.log("\n🎉 V-Preca purchased successfully!");
      console.log("Card Number:", cardMatch[1]);
      console.log("Security Code:", secMatch?.[1] ?? "N/A");
      console.log("Amount:", AMOUNT, "JPY");
    } else {
      console.log("\n⚠️  Could not extract card details from page.");
      console.log("Page URL:", page.url());
      // Save full body for debugging
      const fs = await import("node:fs");
      fs.writeFileSync("/tmp/vpreca-body.txt", bodyText);
      console.log("Page body saved to /tmp/vpreca-body.txt");
    }
  } catch (err: any) {
    console.error("❌ Error:", err.message);
    await page.screenshot({ path: "/tmp/vpreca-error.png" }).catch(() => {});
    console.log("Error screenshot: /tmp/vpreca-error.png");
  } finally {
    await page.context().close().catch(() => {});
    await closeBrowser().catch(() => {});
  }
}

main().catch(console.error);
