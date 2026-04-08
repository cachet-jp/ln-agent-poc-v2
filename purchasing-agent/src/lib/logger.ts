/**
 * Lightweight structured logger that writes JSON to stderr.
 * MCP uses stdout for protocol messages — all logs MUST go to stderr.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel: LogLevel = (() => {
  const env = process.env.LOG_LEVEL?.toLowerCase();
  if (env && env in LEVELS) return env as LogLevel;
  return "info";
})();

interface LogEntry {
  level: LogLevel;
  ts: string;
  msg: string;
  module?: string;
  [key: string]: unknown;
}

function shouldLog(level: LogLevel): boolean {
  return LEVELS[level] >= LEVELS[currentLevel];
}

function emit(entry: LogEntry): void {
  process.stderr.write(JSON.stringify(entry) + "\n");
}

function log(level: LogLevel, msg: string, extra?: Record<string, unknown>, module?: string): void {
  if (!shouldLog(level)) return;
  const entry: LogEntry = {
    level,
    ts: new Date().toISOString(),
    msg,
    ...(module ? { module } : {}),
    ...extra,
  };
  emit(entry);
}

export interface Logger {
  debug(msg: string, extra?: Record<string, unknown>): void;
  info(msg: string, extra?: Record<string, unknown>): void;
  warn(msg: string, extra?: Record<string, unknown>): void;
  error(msg: string, extra?: Record<string, unknown>): void;
  child(module: string): Logger;
}

function createLogger(module?: string): Logger {
  return {
    debug: (msg, extra) => log("debug", msg, extra, module),
    info: (msg, extra) => log("info", msg, extra, module),
    warn: (msg, extra) => log("warn", msg, extra, module),
    error: (msg, extra) => log("error", msg, extra, module),
    child: (childModule) => createLogger(module ? `${module}.${childModule}` : childModule),
  };
}

export const logger = createLogger();
