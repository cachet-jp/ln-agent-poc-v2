/**
 * Track Amazon registration attempts to detect IP reputation risk.
 * Persists to storage-state/registration-attempts.json.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const STORAGE_DIR = join(process.cwd(), "storage-state");
const ATTEMPTS_PATH = join(STORAGE_DIR, "registration-attempts.json");

interface RegistrationAttempt {
  timestamp: string;
  email: string;
  result: string;
}

interface AttemptsData {
  attempts: RegistrationAttempt[];
}

function loadAttempts(): AttemptsData {
  try {
    const raw = readFileSync(ATTEMPTS_PATH, "utf-8");
    return JSON.parse(raw) as AttemptsData;
  } catch {
    return { attempts: [] };
  }
}

function saveAttempts(data: AttemptsData): void {
  mkdirSync(STORAGE_DIR, { recursive: true });
  writeFileSync(ATTEMPTS_PATH, JSON.stringify(data, null, 2));
}

/** Record a registration attempt. */
export function recordAttempt(email: string, result: string): void {
  const data = loadAttempts();
  data.attempts.push({
    timestamp: new Date().toISOString(),
    email,
    result,
  });
  // Keep only the last 50 attempts
  if (data.attempts.length > 50) {
    data.attempts = data.attempts.slice(-50);
  }
  saveAttempts(data);
}

/**
 * Check recent failure count and return a warning message if risky.
 * Returns null if safe to proceed.
 */
export function checkAttemptRisk(): string | null {
  const data = loadAttempts();
  const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;

  const recentFailures = data.attempts.filter((a) => {
    const ts = new Date(a.timestamp).getTime();
    return ts > twentyFourHoursAgo && a.result !== "success";
  });

  if (recentFailures.length >= 2) {
    return [
      `⚠️ 過去24時間に ${recentFailures.length} 件の失敗した登録試行があります。`,
      "同一IPから連続で失敗すると、Amazon にフラグされる可能性があります。",
      "",
      "推奨: 24-48時間待つか、別のネットワーク (テザリング等) を使用してください。",
    ].join("\n");
  }

  return null;
}
