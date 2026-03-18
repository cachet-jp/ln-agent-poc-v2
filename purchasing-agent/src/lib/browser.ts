import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { getConfig } from "./config.js";
import { createHumanCursor, humanTypeV2, type CursorHolder } from "./mouse.js";

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
 * When a CursorHolder is provided, uses Bezier-curve mouse movement
 * before typing. Otherwise falls back to synthetic click + type.
 */
export async function humanType(
  page: Page,
  selector: string,
  text: string,
  cursor?: CursorHolder,
): Promise<void> {
  if (cursor) {
    await humanTypeV2(cursor, selector, text);
    return;
  }
  // Legacy fallback (no cursor)
  const el = page.locator(selector).first();
  await el.click();
  await humanDelay(200, 500);
  await el.pressSequentially(text, { delay: 50 + Math.random() * 100 });
}

/** Create a new page with an attached human-like cursor */
export async function newPageWithCursor(
  storageStatePath?: string,
): Promise<{ page: Page; cursor: CursorHolder }> {
  const page = await newPage(storageStatePath);
  const cursor = await createHumanCursor(page);
  return { page, cursor };
}
