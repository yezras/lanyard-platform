/**
 * Structured logger for Portal BFF / relay / control-plane (G2b.2).
 *
 * - Default level: info (LOG_LEVEL)
 * - Payload fields redacted unless PORTAL_DEBUG_PAYLOADS / LOG_DEBUG_PAYLOADS
 * - Secrets always redacted
 * - Emits JSON lines to stdout/stderr for container log drivers
 */

import {
  isDebugPayloadsEnabled,
  redactForLog,
  type EnvMap,
  type RedactOptions,
} from "./redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function readProcessEnv(): EnvMap {
  try {
    const p = (globalThis as { process?: { env?: EnvMap } }).process;
    return p?.env ?? {};
  } catch {
    return {};
  }
}

function defaultStdout(line: string): void {
  const c = (globalThis as { console?: { log?: (s: string) => void } }).console;
  c?.log?.(line);
}

function defaultStderr(line: string): void {
  const c = (globalThis as {
    console?: { error?: (s: string) => void };
  }).console;
  c?.error?.(line);
}

export type LoggerOptions = {
  service: string;
  /** Override min level. Default from LOG_LEVEL env or "info". */
  level?: LogLevel;
  /**
   * Allow body/payload fields in fields. Default from
   * `isDebugPayloadsEnabled()`. Secrets always redacted.
   */
  debugPayloads?: boolean;
  /** Extra static fields on every line. */
  defaultFields?: Record<string, unknown>;
  /** Injectable writers (tests). */
  stdout?: (line: string) => void;
  stderr?: (line: string) => void;
  /** Clock (tests). */
  now?: () => Date;
  env?: EnvMap;
};

export type LogFields = Record<string, unknown>;

export type Logger = {
  readonly service: string;
  readonly level: LogLevel;
  readonly debugPayloads: boolean;
  debug: (message: string, fields?: LogFields) => void;
  info: (message: string, fields?: LogFields) => void;
  warn: (message: string, fields?: LogFields) => void;
  error: (message: string, fields?: LogFields) => void;
  /** Child logger with merged default fields. */
  child: (fields: LogFields) => Logger;
};

function parseLogLevel(
  raw: string | undefined,
  fallback: LogLevel = "info",
): LogLevel {
  if (!raw) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === "debug" || v === "info" || v === "warn" || v === "error") {
    return v;
  }
  return fallback;
}

export function resolveLogLevel(
  env: EnvMap = readProcessEnv(),
  fallback: LogLevel = "info",
): LogLevel {
  return parseLogLevel(env.LOG_LEVEL, fallback);
}

export function createLogger(options: LoggerOptions): Logger {
  const env = options.env ?? readProcessEnv();
  const level = options.level ?? resolveLogLevel(env);
  const debugPayloads =
    options.debugPayloads ?? isDebugPayloadsEnabled(env);
  const stdout = options.stdout ?? defaultStdout;
  const stderr = options.stderr ?? defaultStderr;
  const now = options.now ?? (() => new Date());
  const baseFields = options.defaultFields ?? {};

  const redactOpts: RedactOptions = {
    allowPayloads: debugPayloads,
  };

  function emit(
    logLevel: LogLevel,
    message: string,
    fields?: LogFields,
  ): void {
    if (LEVEL_ORDER[logLevel] < LEVEL_ORDER[level]) return;

    // Use `msg` (not `message`) so chat/message body keys stay redacted.
    const merged: Record<string, unknown> = {
      timestamp: now().toISOString(),
      level: logLevel,
      service: options.service,
      msg: message,
      ...baseFields,
      ...(fields ?? {}),
    };

    // Never let callers force secrets through via nested objects.
    const safe = redactForLog(merged, redactOpts);
    const line = JSON.stringify(safe);

    if (logLevel === "error" || logLevel === "warn") {
      stderr(line);
    } else {
      stdout(line);
    }
  }

  const logger: Logger = {
    service: options.service,
    level,
    debugPayloads,
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields),
    child(fields) {
      return createLogger({
        ...options,
        level,
        debugPayloads,
        defaultFields: { ...baseFields, ...fields },
        stdout,
        stderr,
        now,
        env,
      });
    },
  };

  return logger;
}
