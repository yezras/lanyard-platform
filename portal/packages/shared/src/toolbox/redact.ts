/**
 * Toolbox log redaction (plan 0015 / lp-oop.24).
 *
 * Command lines (`argv` / Daytona `command`) must never reach L1 sinks.
 * Spike-4l5: toolbox execute that embeds secret text is unsafe to log.
 * Redaction is at the log boundary — callers keep raw argv in memory only.
 */

import { REDACTED } from "../logging/redact.js";

import type { ToolboxExec, ToolboxExecResult } from "./exec.js";

/** Marker written in place of argv / command (shared G2b.2). */
export const TOOLBOX_ARGV_REDACTED = REDACTED;

/**
 * Keys that are command-line shaped and must never appear raw in logs.
 * Includes Daytona wire `command` and domain `argv`.
 */
const COMMAND_LINE_KEY_PATTERN =
  /^(argv|args|command|cmd|cmdline|command[_-]?line)$/i;

export type ToolboxExecLogSummary = {
  sandbox_id: string;
  /** Length of argv only — never the tokens. */
  argv_count: number;
  /** Always the redaction marker. */
  argv: string;
  cwd: string;
  timeout_ms: number;
};

export type ToolboxExecResultLogSummary = {
  exit_code: number;
  stdout_bytes: number;
  stderr_bytes: number;
};

export function isToolboxCommandLineKey(key: string): boolean {
  return COMMAND_LINE_KEY_PATTERN.test(key.trim());
}

/** Replace argv tokens with the redaction marker (same length). */
export function redactToolboxArgv(
  argv: readonly string[],
  options: { marker?: string } = {},
): string[] {
  const marker = options.marker ?? TOOLBOX_ARGV_REDACTED;
  return argv.map(() => marker);
}

/**
 * Log-safe view of a ToolboxExec. Raw argv is dropped; only argc + cwd + ids.
 */
export function redactToolboxExecForLog(
  exec: ToolboxExec,
  options: { marker?: string } = {},
): ToolboxExecLogSummary {
  const marker = options.marker ?? TOOLBOX_ARGV_REDACTED;
  return {
    sandbox_id: exec.sandbox_id,
    argv_count: exec.argv.length,
    argv: marker,
    cwd: exec.cwd,
    timeout_ms: exec.timeout_ms,
  };
}

/** Log-safe view of a result — lengths only, never stdout/stderr bodies. */
export function redactToolboxExecResultForLog(
  result: ToolboxExecResult,
): ToolboxExecResultLogSummary {
  return {
    exit_code: result.exit_code,
    stdout_bytes: byteLength(result.stdout),
    stderr_bytes: byteLength(result.stderr),
  };
}

/**
 * Deep-clone a log payload, replacing command-line fields with the marker.
 * Use before any structured event that might include a Daytona request body.
 */
export function redactToolboxLogFields(
  value: unknown,
  options: { marker?: string; maxDepth?: number } = {},
): unknown {
  const marker = options.marker ?? TOOLBOX_ARGV_REDACTED;
  const maxDepth = options.maxDepth ?? 12;
  return redactValue(value, marker, maxDepth, 0, new WeakSet<object>());
}

function byteLength(text: string): number {
  // UTF-8 length without depending on DOM TextEncoder in @lanyard/shared.
  let n = 0;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    if (c <= 0x7f) n += 1;
    else if (c <= 0x7ff) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i += 1;
    } else n += 3;
  }
  return n;
}

function redactValue(
  value: unknown,
  marker: string,
  maxDepth: number,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (value === null || value === undefined) return value;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return value;
  }
  if (typeof value === "function" || typeof value === "symbol") {
    return marker;
  }
  if (Array.isArray(value)) {
    if (depth >= maxDepth) return marker;
    return value.map((item) =>
      redactValue(item, marker, maxDepth, depth + 1, seen),
    );
  }
  if (typeof value === "object") {
    if (seen.has(value as object)) return marker;
    if (depth >= maxDepth) return marker;
    seen.add(value as object);
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (isToolboxCommandLineKey(key)) {
        out[key] = marker;
        if (
          (key === "argv" || key === "args") &&
          Array.isArray(child) &&
          out.argv_count === undefined
        ) {
          out.argv_count = child.length;
        }
        continue;
      }
      out[key] = redactValue(child, marker, maxDepth, depth + 1, seen);
    }
    return out;
  }
  return marker;
}
