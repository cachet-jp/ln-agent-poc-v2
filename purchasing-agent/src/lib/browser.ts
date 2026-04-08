import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { getConfig } from "./config.js";

let _browser: Browser | null = null;

/** Launch or reuse a Playwright browser instance */
export async function getBrowser(): Promise<Browser> {
  if (!_browser || !_browser.isConnected()) {
    const { HEADLESS } = getConfig();
    _browser = await chromium.launch({
      headless: HEADLESS,
      args: [
        "--disable-blink-features=AutomationControlled",
        "--no-first-run",
        "--no-default-browser-check",
      ],
    });
  }
  return _browser;
}

/** Create a fresh browser context (isolated cookies/storage) */
export async function newContext(
  storageStatePath?: string,
): Promise<BrowserContext> {
  const browser = await getBrowser();
  const options = storageStatePath
    ? { storageState: storageStatePath }
    : undefined;
  return browser.newContext(options);
}

/** Create a new page in a fresh context */
export async function newPage(storageStatePath?: string): Promise<Page> {
  const ctx = await newContext(storageStatePath);
  return ctx.newPage();
}

/** Run a callback with a fresh page, closing the context afterwards */
export async function withPage<T>(
  fn: (page: Page) => Promise<T>,
  storageStatePath?: string,
): Promise<T> {
  const page = await newPage(storageStatePath);
  try {
    return await fn(page);
  } finally {
    try { await page.context().close(); } catch { /* ignore cleanup errors */ }
  }
}

/** Close the browser (cleanup) */
export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close();
    _browser = null;
  }
}

/** Wait with a human-like random delay (anti-bot) */
export async function humanDelay(
  minMs = 500,
  maxMs = 2000,
): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs) + minMs);
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Type text into a field with human-like timing.
 * Clicks the element first, waits briefly, then types char-by-char
 * with a randomized per-keystroke delay (50-150ms).
 */
export async function humanType(
  page: Page,
  selector: string,
  text: string,
): Promise<void> {
  const el = page.locator(selector).first();
  await el.click();
  await humanDelay(200, 500);
  await el.pressSequentially(text, { delay: 50 + Math.random() * 100 });
}
