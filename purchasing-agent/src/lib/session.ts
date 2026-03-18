import type { BrowserContext, Page } from "playwright";
import { getBrowser } from "./browser.js";
import { CHROME_USER_AGENT } from "./user-agent.js";
import { STEALTH_INIT_SCRIPT } from "./stealth.js";
import { createHumanCursor, type CursorHolder } from "./mouse.js";
import type { AmazonPageState } from "../types.js";

/**
 * A persistent browser session that survives across MCP tool calls.
 * Holds a reference to a Page so that multi-step flows (account creation,
 * CAPTCHA solving, OTP entry) can share the same browser tab.
 */
export interface ActiveSession {
  page: Page;
  context: BrowserContext;
  step: AmazonPageState;
  credentials?: { email: string; password: string };
  /** Human-like cursor for anti-bot mouse movements */
  cursor: CursorHolder;
}

const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

let _session: ActiveSession | null = null;
let _timeoutHandle: ReturnType<typeof setTimeout> | null = null;

/** Reset the inactivity timer. Called on every session access. */
function resetTimer(): void {
  if (_timeoutHandle) clearTimeout(_timeoutHandle);
  _timeoutHandle = setTimeout(() => {
    void closeSession();
  }, SESSION_TIMEOUT_MS);
}

/**
 * Create a new persistent session with anti-detection context options.
 * Closes any existing session first.
 */
export async function createSession(): Promise<ActiveSession> {
  // Clean up previous session if any
  await closeSession();

  const browser = await getBrowser();
  const context = await browser.newContext({
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    viewport: { width: 1280, height: 800 },
    userAgent: CHROME_USER_AGENT,
  });

  // Comprehensive anti-fingerprint patches (webdriver, plugins, WebGL, etc.)
  await context.addInitScript(STEALTH_INIT_SCRIPT);

  const page = await context.newPage();

  // Initialize human-like cursor (falls back to NullCursor on failure)
  const cursor = await createHumanCursor(page);

  _session = {
    page,
    context,
    step: "registration_form",
    cursor,
  };
  resetTimer();
  return _session;
}

/** Get the current session (or null if none). */
export function getSession(): ActiveSession | null {
  if (_session) resetTimer();
  return _session;
}

/** Get the current session or throw if none exists. */
export function requireSession(): ActiveSession {
  const session = getSession();
  if (!session) {
    throw new Error(
      "No active session. Call amazon_create_account first to start a session.",
    );
  }
  return session;
}

/** Update the current step of the session. */
export function setStep(step: AmazonPageState): void {
  if (_session) {
    _session.step = step;
    resetTimer();
  }
}

/** Store credentials in the current session. */
export function setCredentials(email: string, password: string): void {
  if (_session) {
    _session.credentials = { email, password };
  }
}

/** Close the session and clean up browser resources. */
export async function closeSession(): Promise<void> {
  if (_timeoutHandle) {
    clearTimeout(_timeoutHandle);
    _timeoutHandle = null;
  }
  if (_session) {
    try {
      await _session.context.close();
    } catch {
      // context may already be closed
    }
    _session = null;
  }
}
