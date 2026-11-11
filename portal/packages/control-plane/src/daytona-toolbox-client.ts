/**
 * Daytona toolbox process/execute client (plan 0015 / lp-oop.24).
 *
 * Wraps `POST {toolboxBase}/toolbox/{sandbox_id}/process/execute`.
 * Domain input is {@link ToolboxExec} (argv, not a raw shell string).
 * Log callbacks receive redacted argv only — never command lines.
 *
 * Proven wire (Phase 0 spikes):
 *   POST https://proxy.app.daytona.io/toolbox/{id}/process/execute
 *   { command, timeout, cwd? } → { exitCode, result }
 *
 * Injectable `fetch` for offline unit tests. No live Daytona in CI.
 */

import {
  redactToolboxExecForLog,
  redactToolboxExecResultForLog,
  redactToolboxLogFields,
  type ToolboxClient,
  type ToolboxExec,
  type ToolboxExecResult,
  parseToolboxExec,
} from "@lanyard/shared";

import {
  DaytonaClientError,
  DaytonaSandboxNotFoundError,
} from "./daytona-client.js";
import {
  assertDaytonaConfigReady,
  type DaytonaConfig,
} from "./daytona-config.js";
import {
  DAYTONA_AUTH_HEADER,
  DAYTONA_ORG_HEADER,
  DaytonaHttpError,
  DaytonaTimeoutError,
} from "./daytona-sdk-client.js";

/** Default toolbox proxy host from Phase 0 spikes (not app.daytona.io/api). */
export const DEFAULT_DAYTONA_TOOLBOX_BASE_URL =
  "https://proxy.app.daytona.io";

/** Extra HTTP budget on top of ToolboxExec.timeout_ms. */
export const DEFAULT_DAYTONA_TOOLBOX_HTTP_SLACK_MS = 5_000;

export type DaytonaToolboxLogEvent = {
  op: "execute";
  method: "POST";
  path: string;
  sandbox_id: string;
  argv_count: number;
  cwd: string;
  timeout_ms: number;
  /** Always redacted — never raw argv / command. */
  argv: string;
  status?: number;
  exit_code?: number;
  stdout_bytes?: number;
  stderr_bytes?: number;
  error_code?: string;
  error_message?: string;
  duration_ms?: number;
};

export type DaytonaToolboxClientOptions = {
  /**
   * Platform Daytona config. `apiKey` is secret — used only for Authorization.
   * Must be ready (`assertDaytonaConfigReady`) when constructing.
   */
  config: DaytonaConfig;
  /**
   * Toolbox proxy base (trailing slash stripped).
   * Default {@link DEFAULT_DAYTONA_TOOLBOX_BASE_URL}.
   */
  toolboxBaseUrl?: string;
  /** Extra HTTP slack ms added to exec timeout. */
  httpSlackMs?: number;
  /** Injectable fetch (unit tests). Defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
  /**
   * Optional safe log sink. Receives redacted argv only; never apiKey
   * or command-line tokens.
   */
  logSafe?: (event: DaytonaToolboxLogEvent) => void;
};

/**
 * Join argv into a POSIX-quoted command for Daytona's `command` field.
 * Result must not be logged — call {@link redactToolboxExecForLog} instead.
 */
export function joinToolboxArgv(argv: readonly string[]): string {
  return argv.map(posixQuote).join(" ");
}

/**
 * HTTP client for Daytona toolbox process/execute.
 * Construct via {@link createDaytonaToolboxClient}.
 */
export class DaytonaToolboxClient implements ToolboxClient {
  private readonly apiKey: string;
  private readonly orgId: string;
  private readonly toolboxBaseUrl: string;
  private readonly httpSlackMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly logSafe: ((event: DaytonaToolboxLogEvent) => void) | null;

  constructor(options: DaytonaToolboxClientOptions) {
    assertDaytonaConfigReady(options.config);
    this.apiKey = options.config.apiKey;
    this.orgId = options.config.orgId;
    this.toolboxBaseUrl = normalizeBaseUrl(
      options.toolboxBaseUrl?.trim() || DEFAULT_DAYTONA_TOOLBOX_BASE_URL,
    );
    this.httpSlackMs = Math.max(
      0,
      options.httpSlackMs ?? DEFAULT_DAYTONA_TOOLBOX_HTTP_SLACK_MS,
    );
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.logSafe = options.logSafe ?? null;
  }

  get toolboxUrl(): string {
    return this.toolboxBaseUrl;
  }

  async execute(req: ToolboxExec): Promise<ToolboxExecResult> {
    const exec = parseToolboxExec(req);
    const started = Date.now();
    const path = `/toolbox/${encodeURIComponent(exec.sandbox_id)}/process/execute`;
    const url = `${this.toolboxBaseUrl}${path}`;
    const httpTimeoutMs = Math.max(1, Math.ceil(exec.timeout_ms) + this.httpSlackMs);
    const timeoutSec = Math.max(1, Math.ceil(exec.timeout_ms / 1000));
    const command = joinToolboxArgv(exec.argv);
    const summary = redactToolboxExecForLog(exec);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), httpTimeoutMs);

    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
      [DAYTONA_AUTH_HEADER]: `Bearer ${this.apiKey}`,
      [DAYTONA_ORG_HEADER]: this.orgId,
    };
    // Daytona wire uses `command` (string) + timeout in seconds + optional cwd.
    const body = {
      command,
      cwd: exec.cwd,
      timeout: timeoutSec,
    };

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (isAbortError(err)) {
        const timeoutErr = new DaytonaTimeoutError("execute", httpTimeoutMs, {
          sandboxId: exec.sandbox_id,
        });
        this.emitLog({
          ...summary,
          op: "execute",
          method: "POST",
          path,
          error_code: timeoutErr.code,
          error_message: timeoutErr.message,
          duration_ms: Date.now() - started,
        });
        throw timeoutErr;
      }
      const message =
        err instanceof Error ? err.message : "Daytona toolbox request failed";
      const netErr = new DaytonaClientError(
        "DAYTONA_NETWORK_ERROR",
        `Daytona execute network error: ${sanitizeErrorMessage(message)}`,
        { sandboxId: exec.sandbox_id },
      );
      this.emitLog({
        ...summary,
        op: "execute",
        method: "POST",
        path,
        error_code: netErr.code,
        error_message: netErr.message,
        duration_ms: Date.now() - started,
      });
      throw netErr;
    } finally {
      clearTimeout(timer);
    }

    const status = response.status;
    const text = await response.text();
    const durationMs = Date.now() - started;

    if (status === 404) {
      const notFound = new DaytonaSandboxNotFoundError(exec.sandbox_id);
      this.emitLog({
        ...summary,
        op: "execute",
        method: "POST",
        path,
        status,
        error_code: notFound.code,
        error_message: notFound.message,
        duration_ms: durationMs,
      });
      throw notFound;
    }

    if (status < 200 || status >= 300) {
      const snippet = truncateSnippet(text);
      const apiMessage = extractApiErrorMessage(text) ?? `HTTP ${status}`;
      const httpErr = new DaytonaHttpError(
        "execute",
        status,
        `Daytona execute failed: ${sanitizeErrorMessage(apiMessage)}`,
        {
          sandboxId: exec.sandbox_id,
          bodySnippet: snippet,
        },
      );
      this.emitLog({
        ...summary,
        op: "execute",
        method: "POST",
        path,
        status,
        error_code: httpErr.code,
        error_message: httpErr.message,
        duration_ms: durationMs,
      });
      throw httpErr;
    }

    let parsed: unknown;
    try {
      parsed = text.trim() ? (JSON.parse(text) as unknown) : {};
    } catch {
      throw new DaytonaHttpError(
        "execute",
        status,
        "Daytona execute returned non-JSON body",
        {
          sandboxId: exec.sandbox_id,
          bodySnippet: truncateSnippet(text),
        },
      );
    }

    const result = mapExecuteResponse(parsed, exec.sandbox_id);
    const resultSummary = redactToolboxExecResultForLog(result);
    this.emitLog({
      ...summary,
      op: "execute",
      method: "POST",
      path,
      status,
      exit_code: resultSummary.exit_code,
      stdout_bytes: resultSummary.stdout_bytes,
      stderr_bytes: resultSummary.stderr_bytes,
      duration_ms: durationMs,
    });
    return result;
  }

  private emitLog(event: DaytonaToolboxLogEvent): void {
    if (!this.logSafe) return;
    try {
      // Defense-in-depth: never let a caller-supplied field leak argv.
      this.logSafe(
        redactToolboxLogFields(event) as DaytonaToolboxLogEvent,
      );
    } catch {
      // Logging must never break exec.
    }
  }
}

export function createDaytonaToolboxClient(
  options: DaytonaToolboxClientOptions,
): DaytonaToolboxClient {
  return new DaytonaToolboxClient(options);
}

// ---------------------------------------------------------------------------
// Mapping / helpers
// ---------------------------------------------------------------------------

function posixQuote(arg: string): string {
  if (arg.length === 0) return "''";
  if (/^[A-Za-z0-9_./:=+-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  if (name === "AbortError" || name === "TimeoutError") return true;
  const cause = (err as { cause?: unknown }).cause;
  if (cause && typeof cause === "object") {
    const cname = (cause as { name?: string }).name;
    if (cname === "AbortError" || cname === "TimeoutError") return true;
  }
  return false;
}

function mapExecuteResponse(
  raw: unknown,
  sandboxId: string,
): ToolboxExecResult {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DaytonaClientError(
      "DAYTONA_INVALID_RESPONSE",
      "Daytona execute response is not an object",
      { sandboxId },
    );
  }
  const o = raw as Record<string, unknown>;
  const exitCode = pickNumber(o, ["exitCode", "exit_code", "code"]);
  if (exitCode === null) {
    throw new DaytonaClientError(
      "DAYTONA_INVALID_RESPONSE",
      "Daytona execute response missing exitCode",
      { sandboxId },
    );
  }

  let stdout = pickString(o, ["stdout"]);
  let stderr = pickString(o, ["stderr"]);
  const result = o.result;
  if (stdout === null && typeof result === "string") {
    stdout = result;
  }
  if (
    stdout === null &&
    result !== null &&
    typeof result === "object" &&
    !Array.isArray(result)
  ) {
    const nested = result as Record<string, unknown>;
    stdout = pickString(nested, ["stdout", "output", "result"]);
    if (stderr === null) {
      stderr = pickString(nested, ["stderr"]);
    }
  }

  return {
    stdout: stdout ?? "",
    stderr: stderr ?? "",
    exit_code: exitCode,
  };
}

function pickString(
  o: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const v = o[key];
    if (typeof v === "string") return v;
  }
  return null;
}

function pickNumber(
  o: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const v = o[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) {
      return Number(v);
    }
  }
  return null;
}

function extractApiErrorMessage(text: string): string | null {
  if (!text.trim()) return null;
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    for (const key of ["message", "error", "detail", "title"]) {
      const v = j[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  } catch {
    // plain text
  }
  return text.trim().slice(0, 240);
}

function truncateSnippet(text: string, max = 200): string | null {
  const t = text.trim();
  if (!t) return null;
  const scrubbed = t
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(
      /("?(?:GATEWAY_RELAY_SECRET|DAYTONA_API_KEY|password|token|secret|command|argv)"?\s*:\s*)"[^"]*"/gi,
      '$1"[REDACTED]"',
    );
  return scrubbed.length > max ? `${scrubbed.slice(0, max)}…` : scrubbed;
}

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/dtn_[A-Za-z0-9_-]+/g, "[REDACTED_KEY]")
    .slice(0, 400);
}
