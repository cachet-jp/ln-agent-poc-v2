import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { getConfig } from "./config.js";

let _browser: Browser | null = null;

/** Launch or reuse a Playwright browser instance */
export async function getBrowser(): Promise<Browser> {
  if (!_browser || !_browser.isConnected()) {
    const { HEADLESS } = getConfig();
    _browser = await chromium.launch({ headless: HEADLESS });
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
