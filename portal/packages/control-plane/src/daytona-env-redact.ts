/**
 * Daytona create/GET response env redaction (lp-pec.1).
 *
 * Managed Daytona POST /sandbox (create) and some GET responses echo the full
 * process `env` map, including `GATEWAY_RELAY_SECRET` and other Bucket C inject
 * secrets (spike-4l5 §6). Instance Orchestrator HTTP clients and structured
 * logs **must** run responses through this module before any log/CI dump.
 *
 * ## Logging policy (normative for pilot)
 *
 * | Allowed in logs / structured events | Forbidden |
 * |-------------------------------------|-----------|
 * | Env **key names** present           | Raw secret values |
 * | Secret **length**                   | Authorization / Bearer material |
 * | Optional **fingerprint** (`sha256:` + 12 hex) | Full create/GET env dumps |
 * | Non-secret env values (ids, URLs, paths) when intentionally summarized | Pasting SM / prod secrets into fixtures |
 *
 * Defense-in-depth: `@lanyard/shared` `redactForLog` still redacts the top-level
 * `env` key when whole bodies hit shared sinks; this module is the **intentional**
 * path for env-aware summaries and for the real SDK parse wrapper (`lp-012`).
 *
 * Design anchors:
 *   docs/plans/0008-daytona-agent-sandboxes/spike-4l5-gateway-secret-inject.md §6
 *   docs/plans/0008-daytona-agent-sandboxes/spike-ctu-go-no-go.md (condition 3)
 *   docs/plans/0008-daytona-agent-sandboxes/daytona-response-redaction.md
 *   docs/plans/0008-daytona-agent-sandboxes/gateway-env-contract.md
 *
 * Pure / side-effect free (except optional structured log callback). No network.
 */

import { createHash } from "node:crypto";

import { REDACTED, isSecretKey } from "@lanyard/shared";

/** Marker written in place of secret values (shared with G2b.2). */
export const DAYTONA_ENV_REDACTED = REDACTED;

/**
 * Explicit guest-inject / cloud secret names that must never appear raw.
 * Includes gateway-env-contract Relay secret + common provider/AWS shapes.
 */
export const DAYTONA_KNOWN_SECRET_ENV_KEYS = [
  "GATEWAY_RELAY_SECRET",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_ACCESS_KEY_ID", // treat as secret material in env dumps
  "DAYTONA_API_KEY", // must never be guest-injected; still redact if echoed
] as const;

/**
 * Suffix / name patterns for secret-shaped env keys
 * (`OPENAI_API_KEY`, `XAI_API_KEY`, `*_TOKEN`, `*_SECRET`, …).
 */
const SECRET_ENV_NAME_PATTERN =
  /(^|_)(SECRET|TOKEN|PASSWORD|PASSWD|PASS|API[_-]?KEY|PRIVATE[_-]?KEY|CREDENTIALS?)(_|$)/i;

export type DaytonaEnvMap = Readonly<Record<string, string>>;

export type DaytonaSecretEnvLogEntry = {
  /** Env key name (safe to log). */
  key: string;
  /** True when a non-empty value was present. */
  present: boolean;
  /** UTF-8 string length of the value (0 when missing/empty). */
  length: number;
  /**
   * `sha256:` + first 12 hex of SHA-256(value), or null when empty.
   * Matches guest proof scripts in spike-4l5 (correlation without raw secret).
   */
  fingerprint: string | null;
};

/**
 * Safe structured summary for create/GET env — keys + secret metadata only.
 * Never includes raw secret values.
 */
export type DaytonaEnvLogSummary = {
  keys: string[];
  key_count: number;
  /** Entries for keys classified as secret (present or not). */
  secrets: DaytonaSecretEnvLogEntry[];
};

/**
 * Result of the parse-path wrapper used by the real SDK client (`lp-012`).
 * Keep `env` in memory for wake/debug asserts only; log `envSummary` / `bodyForLog`.
 */
export type ParsedDaytonaSandboxApiBody = {
  /** Env as returned by the API (in-memory only — do not log). */
  env: DaytonaEnvMap | undefined;
  /** Env with secret values replaced by {@link DAYTONA_ENV_REDACTED}. */
  envForLog: Record<string, string> | undefined;
  /** Preferred structured-event payload for env. */
  envSummary: DaytonaEnvLogSummary;
  /** Full response body with secret env values redacted (dump-safe). */
  bodyForLog: unknown;
};

/**
 * True when an env **key** must not have its raw value logged.
 *
 * Covers:
 * - Explicit catalog ({@link DAYTONA_KNOWN_SECRET_ENV_KEYS})
 * - Shared G2b.2 `isSecretKey` (password, token, …)
 * - Suffix / segment patterns (`*_SECRET`, `*_API_KEY`, …)
 */
export function isDaytonaSecretEnvKey(key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed) return false;
  const upper = trimmed.toUpperCase();
  for (const known of DAYTONA_KNOWN_SECRET_ENV_KEYS) {
    if (upper === known) return true;
  }
  if (isSecretKey(trimmed)) return true;
  return SECRET_ENV_NAME_PATTERN.test(trimmed);
}

/** SHA-256 fingerprint prefix for correlation without exposing the secret. */
export function fingerprintSecretValue(value: string): string {
  const hex = createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);
  return `sha256:${hex}`;
}

/**
 * Copy an env map with secret values replaced by the redaction marker.
 * Non-secret values are preserved (ids, URLs, paths are useful for ops).
 * Pure; returns undefined when input is nullish.
 */
export function redactDaytonaEnvMap(
  env: DaytonaEnvMap | null | undefined,
  options: { marker?: string } = {},
): Record<string, string> | undefined {
  if (env == null) return undefined;
  const marker = options.marker ?? DAYTONA_ENV_REDACTED;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    out[key] = isDaytonaSecretEnvKey(key) ? marker : value;
  }
  return out;
}

/**
 * Build a log-safe summary: key names, and for secret keys length + fingerprint.
 * Never embeds raw secret material.
 */
export function daytonaEnvLogSummary(
  env: DaytonaEnvMap | null | undefined,
): DaytonaEnvLogSummary {
  if (env == null) {
    return { keys: [], key_count: 0, secrets: [] };
  }
  const keys = Object.keys(env).sort();
  const secrets: DaytonaSecretEnvLogEntry[] = [];
  for (const key of keys) {
    if (!isDaytonaSecretEnvKey(key)) continue;
    const value = env[key] ?? "";
    const present = value.length > 0;
    secrets.push({
      key,
      present,
      length: value.length,
      fingerprint: present ? fingerprintSecretValue(value) : null,
    });
  }
  return { keys, key_count: keys.length, secrets };
}

/**
 * Deep-clone a create/GET JSON body, redacting secret values under any `env`
 * object (and object keys that are themselves secret-shaped).
 *
 * Use before structured logs, CI dumps, or error reporters that serialize
 * the raw Daytona HTTP body.
 */
export function redactDaytonaApiResponseForLog(
  body: unknown,
  options: { marker?: string; maxDepth?: number } = {},
): unknown {
  const marker = options.marker ?? DAYTONA_ENV_REDACTED;
  const maxDepth = options.maxDepth ?? 12;
  return redactValue(body, marker, maxDepth, 0, new WeakSet<object>(), false);
}

/**
 * Parse-path wrapper for create/GET responses.
 *
 * Real SDK (`lp-012`) should call this immediately after JSON parse and before
 * any log line. Returns:
 * - `env` — original values (memory only; never log)
 * - `envForLog` / `envSummary` / `bodyForLog` — safe for structured events
 *
 * Does not map into {@link import("./daytona-client.js").DaytonaSandbox};
 * that mapping stays in the client. This helper only sanitizes the env echo.
 */
export function parseDaytonaSandboxApiBody(
  raw: unknown,
): ParsedDaytonaSandboxApiBody {
  const env = extractEnvMap(raw);
  return {
    env,
    envForLog: redactDaytonaEnvMap(env),
    envSummary: daytonaEnvLogSummary(env),
    bodyForLog: redactDaytonaApiResponseForLog(raw),
  };
}

/**
 * Optional logging middleware: run a parser, emit only redacted body/summary,
 * return the parser result. Keeps raw env out of the log callback.
 */
export function withDaytonaResponseRedaction<T>(
  parse: (raw: unknown) => T,
  logSafe?: (safe: {
    bodyForLog: unknown;
    envSummary: DaytonaEnvLogSummary;
  }) => void,
): (raw: unknown) => T {
  return (raw: unknown) => {
    const parsed = parseDaytonaSandboxApiBody(raw);
    if (logSafe) {
      logSafe({
        bodyForLog: parsed.bodyForLog,
        envSummary: parsed.envSummary,
      });
    }
    return parse(raw);
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function extractEnvMap(raw: unknown): DaytonaEnvMap | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return undefined;
  }
  const env = (raw as Record<string, unknown>).env;
  if (env === null || env === undefined) return undefined;
  if (typeof env !== "object" || Array.isArray(env)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env as Record<string, unknown>)) {
    if (typeof v === "string") {
      out[k] = v;
    } else if (v === null || v === undefined) {
      out[k] = "";
    } else if (
      typeof v === "number" ||
      typeof v === "boolean" ||
      typeof v === "bigint"
    ) {
      out[k] = String(v);
    } else {
      // Non-primitive: do not stringify (could embed secrets); mark opaque.
      out[k] = DAYTONA_ENV_REDACTED;
    }
  }
  return Object.freeze(out);
}

function redactValue(
  value: unknown,
  marker: string,
  maxDepth: number,
  depth: number,
  seen: WeakSet<object>,
  /** When true, we are inside an `env` map — redact secret keys' values. */
  inEnvMap: boolean,
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
      redactValue(item, marker, maxDepth, depth + 1, seen, false),
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
      if (inEnvMap && isDaytonaSecretEnvKey(key)) {
        out[key] = marker;
        continue;
      }
      // Secret-shaped keys at any level (apiKey, password, …)
      if (!inEnvMap && isDaytonaSecretEnvKey(key) && typeof child === "string") {
        out[key] = marker;
        continue;
      }
      const childInEnv =
        key === "env" &&
        child !== null &&
        typeof child === "object" &&
        !Array.isArray(child);
      out[key] = redactValue(
        child,
        marker,
        maxDepth,
        depth + 1,
        seen,
        childInEnv,
      );
    }
    return out;
  }
  return marker;
}
