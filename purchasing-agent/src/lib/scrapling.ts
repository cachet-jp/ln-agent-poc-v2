/**
 * Bridge module to call Python Scrapling scripts from TypeScript.
 *
 * Scrapling's StealthyFetcher uses Patchright (patched Playwright) + Camoufox
 * to bypass bot detection that raw Playwright cannot.
 */

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { CHROME_USER_AGENT } from "./user-agent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENT_ROOT = resolve(__dirname, "../..");
const SCRIPT_PATH = resolve(AGENT_ROOT, "scripts/amazon_scrapling.py");
const VENV_PYTHON = resolve(AGENT_ROOT, ".venv-scrapling/bin/python");

/** Result from the Python Scrapling script */
export interface ScraplingResult {
  success: boolean;
  state: string;
  message: string;
  screenshots?: string[];
  account_name?: string;
  url?: string;
  [key: string]: unknown;
}

/**
 * Find the Python executable for Scrapling.
 * Priority: .venv-scrapling/bin/python > python3 > python
 */
function findPython(): string {
  if (existsSync(VENV_PYTHON)) {
    return VENV_PYTHON;
  }
  // Fallback: assume python3 is in PATH
  return "python3";
}

/**
 * Execute a Scrapling command and return the JSON result.
 */
export async function runScrapling(
  command: string,
  args: Record<string, string> = {},
): Promise<ScraplingResult> {
  const python = findPython();

  const cmdArgs = [SCRIPT_PATH, command];
  for (const [key, value] of Object.entries(args)) {
    if (value === "") {
      // Flag argument (no value), e.g. --headed
      cmdArgs.push(`--${key}`);
    } else {
      cmdArgs.push(`--${key}`, value);
    }
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(python, cmdArgs, {
      cwd: AGENT_ROOT,
      env: {
        ...process.env,
        // Ensure Python doesn't buffer output
        PYTHONUNBUFFERED: "1",
        // Centralized UA for Scrapling/Python to use
        CHROME_USER_AGENT,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      // Parse the last line of stdout as JSON (Scrapling may log to stderr)
      const lines = stdout.trim().split("\n");
      const lastLine = lines[lines.length - 1] || "";

      try {
        const result = JSON.parse(lastLine) as ScraplingResult;
        resolve(result);
      } catch {
        reject(
          new Error(
            `Scrapling command '${command}' failed (exit ${code}). ` +
              `stdout: ${stdout.slice(-500)} | stderr: ${stderr.slice(-500)}`,
          ),
        );
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn Scrapling: ${err.message}`));
    });

    // Close stdin immediately (script reads from args, not stdin)
    proc.stdin.end();
  });
}

/**
 * Create an Amazon account using Scrapling's stealth browser.
 * Set headed=true to open a visible browser and wait for manual puzzle solving.
 */
export async function scraplingCreateAccount(
  email: string,
  name: string,
  password: string,
  headed = false,
): Promise<ScraplingResult> {
  const args: Record<string, string> = { email, name, password };
  if (headed) {
    args.headed = "";  // flag argument (no value)
  }
  return runScrapling("create_account", args);
}

/**
 * Save Amazon session by manual login in headed browser.
 */
export async function scraplingSaveSession(): Promise<ScraplingResult> {
  return runScrapling("save_session");
}

/**
 * Check if saved Amazon session cookies are still valid.
 */
export async function scraplingCheckSession(): Promise<ScraplingResult> {
  return runScrapling("check_session");
}

/**
 * Continue a flow that requires user input (OTP, CAPTCHA).
 */
export async function scraplingContinueFlow(
  inputValue: string,
): Promise<ScraplingResult> {
  return runScrapling("continue_flow", { "input-value": inputValue });
}
