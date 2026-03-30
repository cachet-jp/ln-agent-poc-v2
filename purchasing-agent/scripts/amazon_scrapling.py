#!/usr/bin/env python3
"""
Amazon automation using Scrapling's StealthyFetcher.
Called from TypeScript MCP tools via subprocess.

Usage:
    python amazon_scrapling.py <command> [--arg value ...]

Commands:
    create_account  --email <email> --name <name> --password <pw>
    save_session    (opens headed browser for manual login, saves cookies)
    check_session   (validates saved session cookies)
    navigate        --url <url> [--screenshot /path/to/file.png]

Output: JSON on stdout
    { "success": bool, "state": str, "message": str, "data": {...} }
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

# Resolve paths relative to purchasing-agent root
AGENT_ROOT = Path(__file__).resolve().parent.parent
STORAGE_STATE_DIR = AGENT_ROOT / "storage-state"
STORAGE_STATE_PATH = STORAGE_STATE_DIR / "amazon.json"
SCREENSHOT_DIR = AGENT_ROOT / "screenshots"

AMAZON_BASE = "https://www.amazon.co.jp"

# Centralized Chrome UA — read from env var (set by TypeScript bridge) or fallback
CHROME_USER_AGENT = os.environ.get(
    "CHROME_USER_AGENT",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/134.0.0.0 Safari/537.36",
)

# Known disposable email domains that Amazon immediately bans
KNOWN_DISPOSABLE_DOMAINS = {
    "keemail.me", "guerrillamail.com", "guerrillamail.de",
    "tempmail.com", "mailinator.com", "throwaway.email",
    "yopmail.com", "sharklasers.com", "grr.la", "guerrillamail.info",
    "temp-mail.org", "fakeinbox.com", "dispostable.com",
    "maildrop.cc", "trashmail.com", "10minutemail.com",
}

# Comprehensive stealth init script matching src/lib/stealth.ts
STEALTH_INIT_SCRIPT = """
Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

const pluginData = [
  { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
  { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
  { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
  { name: 'Chromium PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
  { name: 'Chromium PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
];
const pluginArray = pluginData.map(p => {
  const mimeType = { type: 'application/pdf', suffixes: 'pdf', description: p.description, enabledPlugin: null };
  return { name: p.name, filename: p.filename, description: p.description, length: 1, 0: mimeType,
    item: (i) => (i === 0 ? mimeType : null), namedItem: (name) => (name === 'application/pdf' ? mimeType : null),
    [Symbol.iterator]: function* () { yield mimeType; } };
});
Object.defineProperty(navigator, 'plugins', {
  get: () => { const arr = pluginArray; arr.item = (i) => arr[i] || null; arr.namedItem = (name) => arr.find(p => p.name === name) || null; arr.refresh = () => {}; return arr; },
});
Object.defineProperty(navigator, 'mimeTypes', {
  get: () => { const mt = { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: pluginArray[0] }; const arr = [mt]; arr.item = (i) => arr[i] || null; arr.namedItem = (name) => (name === 'application/pdf' ? mt : null); return arr; },
});
Object.defineProperty(navigator, 'languages', { get: () => ['ja', 'ja-JP', 'en-US', 'en'] });
Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
if (!window.chrome) { window.chrome = {}; }
if (!window.chrome.runtime) {
  window.chrome.runtime = { connect: () => {}, sendMessage: () => {}, onMessage: { addListener: () => {}, removeListener: () => {}, hasListeners: () => false }, id: undefined };
}
const getParameterOrig = WebGLRenderingContext.prototype.getParameter;
WebGLRenderingContext.prototype.getParameter = function(param) {
  if (param === 0x9245) return 'Google Inc. (Apple)';
  if (param === 0x9246) return 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)';
  return getParameterOrig.call(this, param);
};
if (typeof WebGL2RenderingContext !== 'undefined') {
  const gp2 = WebGL2RenderingContext.prototype.getParameter;
  WebGL2RenderingContext.prototype.getParameter = function(param) {
    if (param === 0x9245) return 'Google Inc. (Apple)';
    if (param === 0x9246) return 'ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)';
    return gp2.call(this, param);
  };
}
const origQuery = navigator.permissions.query.bind(navigator.permissions);
navigator.permissions.query = (params) => {
  if (params.name === 'notifications') { return Promise.resolve({ state: 'prompt', onchange: null, addEventListener: () => {}, removeEventListener: () => {} }); }
  return origQuery(params);
};
const nativeToString = Function.prototype.toString;
const patchedFns = new Set();
Function.prototype.toString = function() { if (patchedFns.has(this)) { return 'function () { [native code] }'; } return nativeToString.call(this); };
patchedFns.add(Function.prototype.toString);
"""


def output(success: bool, state: str = "", message: str = "", **data):
    """Print JSON result and exit."""
    result = {"success": success, "state": state, "message": message, **data}
    print(json.dumps(result, ensure_ascii=False))
    sys.exit(0 if success else 1)


def screenshot_path(name: str) -> str:
    SCREENSHOT_DIR.mkdir(parents=True, exist_ok=True)
    return str(SCREENSHOT_DIR / f"{name}.png")


def human_type(page, selector: str, text: str):
    """Type text char-by-char with human-like delays."""
    import random
    el = page.locator(selector).first
    el.click()
    time.sleep(random.uniform(0.2, 0.5))
    el.press_sequentially(text, delay=random.uniform(50, 150))


def safe_screenshot(page, name: str, timeout_ms: int = 10000) -> str | None:
    """Take a screenshot with a timeout. Returns path or None on failure."""
    path = screenshot_path(name)
    try:
        page.screenshot(path=path, timeout=timeout_ms)
        return path
    except Exception as e:
        sys.stderr.write(f"[WARN] Screenshot '{name}' failed: {e}\n")
        sys.stderr.flush()
        return None


def save_cookies_from_context(context):
    """Save browser context cookies to storage state file."""
    STORAGE_STATE_DIR.mkdir(parents=True, exist_ok=True)
    context.storage_state(path=str(STORAGE_STATE_PATH))


# ======================================================================
# Helpers: page state detection & puzzle waiting
# ======================================================================
def detect_page_state(page) -> dict:
    """Inspect current page and return state dict."""
    current_url = page.url
    body_text = page.locator("body").inner_text()

    if "captcha" in body_text.lower() or page.locator("#captchacharacters").count() > 0:
        return {"state": "captcha", "message": "CAPTCHA detected", "url": current_url}
    if "クイズ" in body_text or page.locator("#cvf-aamation-challenge-iframe").count() > 0:
        return {"state": "puzzle", "message": "Arkose Labs puzzle detected", "url": current_url}
    if page.locator("#cvf-input-code, input[name='code']").count() > 0:
        return {"state": "email_otp", "message": "Email OTP verification required", "url": current_url}
    if "/ap/cvf/" in current_url:
        return {"state": "email_otp", "message": "Verification required", "url": current_url}

    nav = page.locator("#nav-link-accountList")
    if nav.count() > 0 and nav.first.is_visible():
        try:
            nav_text = nav.first.locator(".nav-line-1").inner_text()
            if "ログイン" not in nav_text and "サインイン" not in nav_text:
                return {"state": "success", "message": "Logged in successfully", "url": current_url, "account_name": nav_text.strip()}
        except Exception:
            pass

    if page.locator(".a-alert-error").count() > 0:
        err_text = page.locator(".a-alert-error").first.inner_text()[:200]
        return {"state": "error", "message": f"Error: {err_text}", "url": current_url}

    return {"state": "unknown", "message": f"Unknown state. URL: {current_url}", "url": current_url}


def wait_for_puzzle_solved(page, max_wait=300, interval=3) -> dict:
    """Poll until the puzzle/captcha page is gone (headed mode only).

    Returns the new page state after the puzzle disappears.
    """
    sys.stderr.write(f"[WAITING] Puzzle detected — please solve it in the browser window (max {max_wait}s)\n")
    sys.stderr.flush()
    elapsed = 0

    while elapsed < max_wait:
        time.sleep(interval)
        elapsed += interval

        try:
            state = detect_page_state(page)
            if state["state"] not in ("puzzle", "captcha"):
                sys.stderr.write(f"[OK] Puzzle cleared after {elapsed}s — new state: {state['state']}\n")
                sys.stderr.flush()
                return state
        except Exception:
            continue

        if elapsed % 30 == 0:
            sys.stderr.write(f"[WAITING] Still waiting... ({elapsed}s elapsed)\n")
            sys.stderr.flush()

    return {"state": "timeout", "message": f"Puzzle not solved within {max_wait}s"}


# ======================================================================
# Command: create_account
# ======================================================================
def cmd_create_account(args):
    """Full automated account creation flow using Scrapling stealth.

    With --headed, opens a visible browser and waits for manual puzzle solving.
    """
    from scrapling.fetchers import StealthyFetcher

    headed = getattr(args, "headed", False)
    result_state = {"state": "unknown", "screenshots": []}

    def flow(page):
        nonlocal result_state

        # Step 1: Homepage
        page.wait_for_load_state("domcontentloaded")
        ss = safe_screenshot(page, "01-homepage")
        if ss:
            result_state["screenshots"].append(ss)

        # Step 2: Click sign-in
        signin = page.locator("#nav-link-accountList").first
        if not signin.is_visible():
            result_state["state"] = "error"
            result_state["message"] = "Sign-in link not found on homepage"
            return
        signin.click()
        time.sleep(3)
        page.wait_for_load_state("domcontentloaded")

        # Step 3: Enter email
        email_input = page.locator("#ap_email, input[name='email']").first
        if not email_input.is_visible():
            result_state["state"] = "error"
            result_state["message"] = "Email input not found on sign-in page"
            ss = safe_screenshot(page, "02-signin-error")
            if ss:
                result_state["screenshots"].append(ss)
            return

        email_input.fill(args.email)
        time.sleep(0.5)
        page.locator("#continue, input#continue").first.click()
        time.sleep(4)
        page.wait_for_load_state("domcontentloaded")

        ss = safe_screenshot(page, "03-after-email")
        if ss:
            result_state["screenshots"].append(ss)

        # Check for bot detection
        state = detect_page_state(page)
        if state["state"] in ("captcha", "puzzle"):
            if headed:
                state = wait_for_puzzle_solved(page)
                if state["state"] in ("captcha", "puzzle", "timeout"):
                    result_state.update(state)
                    return
            else:
                result_state.update(state)
                return

        # Step 4: Click "Create account" button
        create_selectors = [
            "span:has-text('アカウントの作成に進む')",
            "input[type='submit']:has-text('アカウントの作成')",
            "button:has-text('アカウントの作成')",
            "a:has-text('アカウントの作成に進む')",
            "#auth-create-account-link",
            "#createAccountSubmit",
        ]

        clicked = False
        for selector in create_selectors:
            try:
                btn = page.locator(selector).first
                if btn.is_visible():
                    btn.click()
                    time.sleep(4)
                    page.wait_for_load_state("domcontentloaded")
                    clicked = True
                    break
            except Exception:
                continue

        if not clicked:
            # Maybe already on registration form
            pass

        ss = safe_screenshot(page, "04-registration-page")
        if ss:
            result_state["screenshots"].append(ss)

        # Step 5: Check & fill registration form
        name_input = page.locator("#ap_customer_name, input[name='customerName']")
        pw_input = page.locator("#ap_password, input[name='password']")
        pw_check = page.locator("#ap_password_check, input[name='passwordCheck']")

        has_name = name_input.count() > 0 and name_input.first.is_visible()
        has_pw = pw_input.count() > 0 and pw_input.first.is_visible()

        if not has_name:
            result_state["state"] = "error"
            result_state["message"] = "Registration form not found"
            return

        # Fill form
        name_input.first.fill(args.name)
        time.sleep(0.3)

        if has_pw:
            pw_input.first.fill(args.password)
            time.sleep(0.3)

        if pw_check.count() > 0 and pw_check.first.is_visible():
            pw_check.first.fill(args.password)
            time.sleep(0.3)

        ss = safe_screenshot(page, "05-form-filled")
        if ss:
            result_state["screenshots"].append(ss)

        # Step 6: Submit form
        submit_btn = page.locator(
            "#continue, "
            "input[type='submit']:has-text('メールアドレスを確認する'), "
            "input[type='submit']:has-text('アカウントを作成'), "
            ".a-button-primary input[type='submit']"
        )
        try:
            if submit_btn.first.is_visible():
                submit_btn.first.click()
                time.sleep(5)
                try:
                    page.wait_for_load_state("domcontentloaded", timeout=15000)
                except Exception:
                    pass  # Page may not finish loading (e.g. puzzle iframe)
        except Exception:
            pass

        ss = safe_screenshot(page, "06-after-submit")
        if ss:
            result_state["screenshots"].append(ss)

        # Step 7: Detect post-submit state
        state = detect_page_state(page)

        if state["state"] in ("captcha", "puzzle") and headed:
            # In headed mode, wait for user to solve it
            state = wait_for_puzzle_solved(page)

        if state["state"] == "success":
            save_cookies_from_context(page.context)

        result_state.update(state)

        # If email OTP and headed mode, wait for user to enter code
        if state["state"] == "email_otp" and headed:
            sys.stderr.write("[WAITING] Email OTP detected — please check your email and enter the code in the browser\n")
            sys.stderr.flush()
            otp_state = _wait_for_otp_completion(page)
            if otp_state["state"] == "success":
                save_cookies_from_context(page.context)
            result_state.update(otp_state)

    try:
        timeout = 600000 if headed else 60000  # 10 min headed, 1 min headless
        StealthyFetcher.fetch(
            f"{AMAZON_BASE}/",
            headless=not headed,
            network_idle=True,
            page_action=flow,
            timeout=timeout,
            wait=3000,
            locale="ja-JP",
        )

        output(
            success=result_state.get("state") in ("success", "email_otp"),
            state=result_state.get("state", "unknown"),
            message=result_state.get("message", ""),
            screenshots=result_state.get("screenshots", []),
            credentials={"email": args.email, "password": args.password} if result_state.get("state") == "success" else None,
        )
    except Exception as e:
        output(success=False, state="error", message=str(e))


def _wait_for_otp_completion(page, max_wait=300, interval=3) -> dict:
    """Wait for the OTP page to transition after user enters the code."""
    elapsed = 0
    while elapsed < max_wait:
        time.sleep(interval)
        elapsed += interval

        try:
            state = detect_page_state(page)
            if state["state"] != "email_otp":
                safe_screenshot(page, "07-after-otp")
                return state
        except Exception:
            continue

        if elapsed % 30 == 0:
            sys.stderr.write(f"[WAITING] OTP page still active... ({elapsed}s elapsed)\n")
            sys.stderr.flush()

    return {"state": "timeout", "message": f"OTP not completed within {max_wait}s"}


# ======================================================================
# Command: create_account_manual (plain Playwright headed — puzzle renders)
# ======================================================================
def cmd_create_account_manual(args):
    """Account creation using plain Playwright (not Patchright/Scrapling).

    Arkose Labs puzzle renders properly in standard Chromium.
    Opens a headed browser, automates form filling, then waits for user
    to solve the puzzle and enter OTP.
    """
    from playwright.sync_api import sync_playwright

    # Warn about disposable email domains
    email_domain = args.email.rsplit("@", 1)[-1].lower()
    if email_domain in KNOWN_DISPOSABLE_DOMAINS:
        output(
            success=False,
            state="disposable_email",
            message=f'使い捨てメールドメイン "{email_domain}" が検出されました。Amazon はこれらのドメインからの登録を即座にBANする可能性が高いです。Gmail, Yahoo, iCloud, Outlook 等の正規プロバイダを推奨します。',
        )

    result_state = {"state": "unknown", "screenshots": []}

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=False,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-first-run",
                "--no-default-browser-check",
            ],
        )
        context = browser.new_context(
            locale="ja-JP",
            timezone_id="Asia/Tokyo",
            viewport={"width": 1280, "height": 800},
            user_agent=CHROME_USER_AGENT,
        )
        # Comprehensive anti-fingerprint patches
        context.add_init_script(STEALTH_INIT_SCRIPT)
        page = context.new_page()

        try:
            # Step 1: Navigate to Amazon
            page.goto(f"{AMAZON_BASE}/", wait_until="domcontentloaded")
            time.sleep(2)
            ss = safe_screenshot(page, "manual-01-homepage")
            if ss:
                result_state["screenshots"].append(ss)

            # Step 2: Click sign-in
            signin = page.locator("#nav-link-accountList").first
            if not signin.is_visible():
                output(success=False, state="error", message="Sign-in link not found")
            signin.click()
            time.sleep(3)
            page.wait_for_load_state("domcontentloaded")

            # Step 3: Enter email (human-like typing)
            email_input = page.locator("#ap_email, input[name='email']").first
            if not email_input.is_visible():
                output(success=False, state="error", message="Email input not found")

            human_type(page, "#ap_email, input[name='email']", args.email)
            time.sleep(0.5)
            page.locator("#continue, input#continue").first.click()
            time.sleep(4)

            ss = safe_screenshot(page, "manual-02-after-email")
            if ss:
                result_state["screenshots"].append(ss)

            # Step 4: Click "Create account" button if present
            create_selectors = [
                "span:has-text('アカウントの作成に進む')",
                "a:has-text('アカウントの作成に進む')",
                "#auth-create-account-link",
                "#createAccountSubmit",
            ]
            for selector in create_selectors:
                try:
                    btn = page.locator(selector).first
                    if btn.is_visible():
                        btn.click()
                        time.sleep(4)
                        break
                except Exception:
                    continue

            # Step 5: Fill registration form
            name_input = page.locator("#ap_customer_name, input[name='customerName']")
            pw_input = page.locator("#ap_password, input[name='password']")
            pw_check = page.locator("#ap_password_check, input[name='passwordCheck']")

            if name_input.count() > 0 and name_input.first.is_visible():
                human_type(page, "#ap_customer_name, input[name='customerName']", args.name)
                time.sleep(0.3)

            if pw_input.count() > 0 and pw_input.first.is_visible():
                human_type(page, "#ap_password, input[name='password']", args.password)
                time.sleep(0.3)

            if pw_check.count() > 0 and pw_check.first.is_visible():
                human_type(page, "#ap_password_check, input[name='passwordCheck']", args.password)
                time.sleep(0.3)

            ss = safe_screenshot(page, "manual-03-form-filled")
            if ss:
                result_state["screenshots"].append(ss)

            # Step 6: Submit form
            submit_btn = page.locator(
                "#continue, "
                "input[type='submit']:has-text('メールアドレスを確認する'), "
                "input[type='submit']:has-text('アカウントを作成'), "
                ".a-button-primary input[type='submit']"
            )
            try:
                if submit_btn.first.is_visible():
                    submit_btn.first.click()
                    time.sleep(5)
            except Exception:
                pass

            ss = safe_screenshot(page, "manual-04-after-submit")
            if ss:
                result_state["screenshots"].append(ss)

            sys.stderr.write("[INFO] Form submitted. Waiting for puzzle/OTP/success...\n")
            sys.stderr.write("[INFO] If a puzzle appears, solve it in the browser.\n")
            sys.stderr.write("[INFO] If an OTP email arrives, enter the code in the browser.\n")
            sys.stderr.flush()

            # Step 7: Poll for completion (max 10 min)
            max_wait = 600
            elapsed = 0
            interval = 3

            while elapsed < max_wait:
                time.sleep(interval)
                elapsed += interval

                try:
                    state = detect_page_state(page)

                    if state["state"] == "success":
                        save_cookies_from_context(context)
                        result_state.update(state)
                        ss = safe_screenshot(page, "manual-05-success")
                        if ss:
                            result_state["screenshots"].append(ss)
                        break

                    if state["state"] == "error":
                        result_state.update(state)
                        ss = safe_screenshot(page, "manual-05-error")
                        if ss:
                            result_state["screenshots"].append(ss)
                        break
                except Exception:
                    continue

                if elapsed % 60 == 0:
                    sys.stderr.write(f"[WAITING] {elapsed}s elapsed — still monitoring...\n")
                    sys.stderr.flush()
            else:
                result_state["state"] = "timeout"
                result_state["message"] = f"Not completed within {max_wait}s"

        except Exception as e:
            result_state["state"] = "error"
            result_state["message"] = str(e)
        finally:
            # Give a moment to save state
            time.sleep(1)
            browser.close()

    output(
        success=result_state.get("state") == "success",
        state=result_state.get("state", "unknown"),
        message=result_state.get("message", ""),
        screenshots=result_state.get("screenshots", []),
        credentials={"email": args.email, "password": args.password} if result_state.get("state") == "success" else None,
    )


# ======================================================================
# Command: save_session (manual login in headed mode)
# ======================================================================
def cmd_save_session(args):
    """Open headed browser for manual login, poll for success, save cookies."""
    from scrapling.fetchers import StealthyFetcher

    result_state = {"state": "unknown"}

    def flow(page):
        nonlocal result_state

        # Navigate to sign-in
        page.locator("#nav-link-accountList").first.click()
        time.sleep(2)
        page.wait_for_load_state("domcontentloaded")

        # Poll for login (max 10 min)
        max_wait = 600  # seconds
        elapsed = 0
        interval = 3

        while elapsed < max_wait:
            time.sleep(interval)
            elapsed += interval

            try:
                # Check if logged in
                url = page.url
                is_signin_page = "/ap/signin" in url or "/ap/register" in url or "/ap/cvf/" in url

                if not is_signin_page:
                    nav = page.locator("#nav-link-accountList")
                    if nav.count() > 0 and nav.first.is_visible():
                        nav_text = nav.first.locator(".nav-line-1").inner_text()
                        if "ログイン" not in nav_text and "サインイン" not in nav_text:
                            # Success!
                            save_cookies_from_context(page.context)
                            result_state["state"] = "success"
                            result_state["message"] = f"Session saved to {STORAGE_STATE_PATH}"
                            return
            except Exception:
                continue

        result_state["state"] = "timeout"
        result_state["message"] = "Login not completed within 10 minutes"

    try:
        StealthyFetcher.fetch(
            f"{AMAZON_BASE}/",
            headless=False,  # Headed for manual login
            network_idle=True,
            page_action=flow,
            timeout=660000,  # 11 min total
            wait=2000,
            locale="ja-JP",
        )

        output(
            success=result_state["state"] == "success",
            **result_state,
        )
    except Exception as e:
        output(success=False, state="error", message=str(e))


# ======================================================================
# Command: check_session
# ======================================================================
def cmd_check_session(args):
    """Validate saved session cookies."""
    if not STORAGE_STATE_PATH.exists():
        output(success=False, state="no_session", message="No saved session found")

    from scrapling.fetchers import StealthyFetcher

    result_state = {"state": "unknown"}

    # Load cookies from file
    with open(STORAGE_STATE_PATH) as f:
        storage = json.load(f)

    cookies = storage.get("cookies", [])

    def flow(page):
        nonlocal result_state

        # Add saved cookies
        page.context.add_cookies(cookies)

        # Reload with cookies
        page.goto(f"{AMAZON_BASE}/", wait_until="domcontentloaded")
        time.sleep(3)

        nav = page.locator("#nav-link-accountList")
        if nav.count() > 0 and nav.first.is_visible():
            nav_text = nav.first.locator(".nav-line-1").inner_text()
            if "ログイン" not in nav_text and "サインイン" not in nav_text:
                result_state["state"] = "valid"
                result_state["message"] = f"Session is valid. Account: {nav_text.strip()}"
                result_state["account_name"] = nav_text.strip()
            else:
                result_state["state"] = "expired"
                result_state["message"] = "Session expired or invalid"
        else:
            result_state["state"] = "expired"
            result_state["message"] = "Could not verify session"

    try:
        StealthyFetcher.fetch(
            f"{AMAZON_BASE}/",
            headless=True,
            network_idle=True,
            page_action=flow,
            timeout=30000,
            wait=2000,
            locale="ja-JP",
            cookies=cookies,
        )

        output(
            success=result_state["state"] == "valid",
            **result_state,
        )
    except Exception as e:
        output(success=False, state="error", message=str(e))


# ======================================================================
# Command: continue_flow (handle OTP/CAPTCHA input)
# ======================================================================
def cmd_continue_flow(args):
    """Continue a flow that requires user input (OTP code, CAPTCHA text)."""
    from scrapling.fetchers import StealthyFetcher

    result_state = {"state": "unknown"}

    def flow(page):
        nonlocal result_state

        # Navigate to where we left off (Amazon should remember via cookies)
        time.sleep(2)

        if args.input_value:
            # Try to find an input field and enter the value
            selectors = [
                "#cvf-input-code",
                "input[name='code']",
                "#captchacharacters",
                "#ap_password",
                "input[type='text']:visible",
                "input[type='tel']:visible",
            ]

            entered = False
            for selector in selectors:
                try:
                    el = page.locator(selector).first
                    if el.is_visible():
                        el.fill(args.input_value)
                        time.sleep(0.5)
                        entered = True
                        break
                except Exception:
                    continue

            if not entered:
                result_state["state"] = "error"
                result_state["message"] = "Could not find input field"
                return

            # Click submit/continue
            submit_selectors = [
                "#cvf-submit-code-button",
                "input[type='submit']",
                "button[type='submit']",
                "#continue",
            ]

            for selector in submit_selectors:
                try:
                    btn = page.locator(selector).first
                    if btn.is_visible():
                        btn.click()
                        time.sleep(5)
                        page.wait_for_load_state("domcontentloaded")
                        break
                except Exception:
                    continue

        # Detect current state
        ss = safe_screenshot(page, "continue-result")

        body_text = page.locator("body").inner_text()
        url = page.url

        if page.locator("#captchacharacters").count() > 0:
            result_state["state"] = "captcha"
        elif page.locator("#cvf-input-code").count() > 0:
            result_state["state"] = "email_otp"
        elif "クイズ" in body_text:
            result_state["state"] = "puzzle"
        elif page.locator("#nav-link-accountList").count() > 0:
            nav_text = page.locator("#nav-link-accountList .nav-line-1").inner_text()
            if "ログイン" not in nav_text:
                result_state["state"] = "success"
                save_cookies_from_context(page.context)
        else:
            result_state["state"] = "unknown"

        result_state["screenshots"] = [ss] if ss else []
        result_state["url"] = url
        result_state["message"] = f"State: {result_state['state']}, URL: {url}"

    try:
        # Use saved cookies if available
        cookies = []
        if STORAGE_STATE_PATH.exists():
            with open(STORAGE_STATE_PATH) as f:
                cookies = json.load(f).get("cookies", [])

        StealthyFetcher.fetch(
            f"{AMAZON_BASE}/",
            headless=True,
            network_idle=True,
            page_action=flow,
            timeout=60000,
            wait=3000,
            locale="ja-JP",
            cookies=cookies,
        )

        output(success=result_state["state"] == "success", **result_state)
    except Exception as e:
        output(success=False, state="error", message=str(e))


# ======================================================================
# Main
# ======================================================================
def main():
    parser = argparse.ArgumentParser(description="Amazon automation via Scrapling")
    sub = parser.add_subparsers(dest="command", required=True)

    # create_account
    p_create = sub.add_parser("create_account")
    p_create.add_argument("--email", required=True)
    p_create.add_argument("--name", required=True)
    p_create.add_argument("--password", required=True)
    p_create.add_argument("--headed", action="store_true", help="Open visible browser; wait for manual puzzle/OTP solving")

    # create_account_manual (plain Playwright, headed, puzzle renders)
    p_manual = sub.add_parser("create_account_manual")
    p_manual.add_argument("--email", required=True)
    p_manual.add_argument("--name", required=True)
    p_manual.add_argument("--password", required=True)

    # save_session
    sub.add_parser("save_session")

    # check_session
    sub.add_parser("check_session")

    # continue_flow
    p_continue = sub.add_parser("continue_flow")
    p_continue.add_argument("--input-value", default="")

    args = parser.parse_args()

    commands = {
        "create_account": cmd_create_account,
        "create_account_manual": cmd_create_account_manual,
        "save_session": cmd_save_session,
        "check_session": cmd_check_session,
        "continue_flow": cmd_continue_flow,
    }

    commands[args.command](args)


if __name__ == "__main__":
    main()
