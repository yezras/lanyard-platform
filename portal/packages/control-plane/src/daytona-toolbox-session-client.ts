/**
 * Daytona toolbox process-session client (lp-oop.38.19).
 *
 * Long-lived JSON-RPC for vault stdio MCP. Never POST process/execute.
 * Injectable fetch for offline unit tests. No live Daytona in CI.
 */

import {
  assertToolboxProcessSessionPath,
  isToolboxProcessSessionClient,
  parseToolboxProcessSessionCreate,
  parseToolboxProcessSessionExec,
  parseToolboxProcessSessionInput,
  parseToolboxProcessSessionLogs,
  redactToolboxLogFields,
  type ToolboxProcessSessionClient,
  type ToolboxProcessSessionCreate,
  type ToolboxProcessSessionExec,
  type ToolboxProcessSessionInput,
  type ToolboxProcessSessionLogs,
  type ToolboxProcessSessionRef,
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
import {
  DEFAULT_DAYTONA_TOOLBOX_BASE_URL,
  joinToolboxArgv,
} from "./daytona-toolbox-client.js";

export const DEFAULT_DAYTONA_SESSION_HTTP_TIMEOUT_MS = 30_000;

export type DaytonaToolboxSessionLogEvent = {
  op: "create" | "attach" | "exec" | "input" | "logs" | "teardown";
  method: string;
  path: string;
  sandbox_id: string;
  session_id: string;
  command_id?: string;
  argv_count?: number;
  cwd?: string;
  status?: number;
  stdout_bytes?: number;
  stderr_bytes?: number;
  error_code?: string;
  error_message?: string;
  duration_ms?: number;
};

export type DaytonaToolboxSessionClientOptions = {
  config: DaytonaConfig;
  toolboxBaseUrl?: string;
  httpTimeoutMs?: number;
  fetch?: typeof globalThis.fetch;
  logSafe?: (event: DaytonaToolboxSessionLogEvent) => void;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function pickString(o: JsonRecord, keys: string[]): string | null {
  for (const key of keys) {
    const v = o[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function pickNumber(o: JsonRecord, keys: string[]): number | null {
  for (const key of keys) {
    const v = o[key];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) {
      return Number(v);
    }
  }
  return null;
}

function commandIdFrom(raw: unknown): string | undefined {
  if (!isRecord(raw)) return undefined;
  const nested = isRecord(raw.command) ? raw.command : raw;
  return (
    pickString(nested, ["cmdId", "commandId", "command_id", "id"]) ?? undefined
  );
}

function runningCommandId(raw: unknown): string | undefined {
  if (!isRecord(raw)) return undefined;
  const commands = raw.commands;
  if (!Array.isArray(commands)) return undefined;
  for (let i = commands.length - 1; i >= 0; i -= 1) {
    const row = commands[i];
    if (!isRecord(row)) continue;
    const exit = pickNumber(row, ["exitCode", "exit_code"]);
    if (exit !== null) continue;
    const id = pickString(row, ["id", "cmdId", "commandId", "command_id"]);
    if (id) return id;
  }
  return undefined;
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

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/dtn_[A-Za-z0-9_-]+/g, "[REDACTED_KEY]")
    .slice(0, 400);
}

function truncateSnippet(text: string, max = 200): string | null {
  const t = text.trim();
  if (!t) return null;
  const scrubbed = t
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(
      /("?(?:GATEWAY_RELAY_SECRET|DAYTONA_API_KEY|password|token|secret|command|argv|data)"?\s*:\s*)"[^"]*"/gi,
      '$1"[REDACTED]"',
    );
  return scrubbed.length > max ? `${scrubbed.slice(0, max)}…` : scrubbed;
}

function extractApiErrorMessage(text: string): string | null {
  if (!text.trim()) return null;
  try {
    const j = JSON.parse(text) as JsonRecord;
    for (const key of ["message", "error", "detail", "title"]) {
      const v = j[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  } catch {
    // plain text
  }
  return text.trim().slice(0, 240);
}

/**
 * HTTP client for Daytona process/session. Construct via
 * {@link createDaytonaToolboxSessionClient}.
 */
export class DaytonaToolboxSessionClient implements ToolboxProcessSessionClient {
  private readonly apiKey: string;
  private readonly orgId: string;
  private readonly toolboxBaseUrl: string;
  private readonly httpTimeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly logSafe: ((event: DaytonaToolboxSessionLogEvent) => void) | null;

  constructor(options: DaytonaToolboxSessionClientOptions) {
    assertDaytonaConfigReady(options.config);
    this.apiKey = options.config.apiKey;
    this.orgId = options.config.orgId;
    this.toolboxBaseUrl = normalizeBaseUrl(
      options.toolboxBaseUrl?.trim() || DEFAULT_DAYTONA_TOOLBOX_BASE_URL,
    );
    this.httpTimeoutMs = Math.max(
      1,
      options.httpTimeoutMs ?? DEFAULT_DAYTONA_SESSION_HTTP_TIMEOUT_MS,
    );
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.logSafe = options.logSafe ?? null;
  }

  get toolboxUrl(): string {
    return this.toolboxBaseUrl;
  }

  async create(req: ToolboxProcessSessionCreate): Promise<ToolboxProcessSessionRef> {
    const parsed = parseToolboxProcessSessionCreate(req);
    const path = `/toolbox/${encodeURIComponent(parsed.sandbox_id)}/process/session`;
    await this.request({
      op: "create",
      method: "POST",
      path,
      sandbox_id: parsed.sandbox_id,
      session_id: parsed.session_id,
      ok: [200, 201, 204, 409],
      body: { sessionId: parsed.session_id },
    });
    return { sandbox_id: parsed.sandbox_id, session_id: parsed.session_id };
  }

  async attach(req: ToolboxProcessSessionCreate): Promise<ToolboxProcessSessionRef> {
    const parsed = parseToolboxProcessSessionCreate(req);
    const path = `/toolbox/${encodeURIComponent(parsed.sandbox_id)}/process/session/${encodeURIComponent(parsed.session_id)}`;
    const got = await this.request({
      op: "attach",
      method: "GET",
      path,
      sandbox_id: parsed.sandbox_id,
      session_id: parsed.session_id,
      ok: [200, 404],
    });
    if (got.status === 404) {
      await this.create(parsed);
      return { sandbox_id: parsed.sandbox_id, session_id: parsed.session_id };
    }
    const commandId = runningCommandId(got.json);
    return {
      sandbox_id: parsed.sandbox_id,
      session_id: parsed.session_id,
      ...(commandId !== undefined ? { command_id: commandId } : {}),
    };
  }

  async exec(req: ToolboxProcessSessionExec): Promise<ToolboxProcessSessionRef> {
    const parsed = parseToolboxProcessSessionExec(req);
    const path = `/toolbox/${encodeURIComponent(parsed.sandbox_id)}/process/session/${encodeURIComponent(parsed.session_id)}/exec`;
    const command = joinToolboxArgv(parsed.argv);
    const got = await this.request({
      op: "exec",
      method: "POST",
      path,
      sandbox_id: parsed.sandbox_id,
      session_id: parsed.session_id,
      argv_count: parsed.argv.length,
      cwd: parsed.cwd,
      ok: [200, 201],
      body: {
        command,
        cwd: parsed.cwd,
        runAsync: true,
      },
    });
    const commandId = commandIdFrom(got.json);
    if (!commandId) {
      throw new DaytonaClientError(
        "DAYTONA_INVALID_RESPONSE",
        "Daytona session exec response missing cmdId",
        { sandboxId: parsed.sandbox_id },
      );
    }
    return {
      sandbox_id: parsed.sandbox_id,
      session_id: parsed.session_id,
      command_id: commandId,
    };
  }

  async sendInput(req: ToolboxProcessSessionInput): Promise<void> {
    const parsed = parseToolboxProcessSessionInput(req);
    const path = `/toolbox/${encodeURIComponent(parsed.sandbox_id)}/process/session/${encodeURIComponent(parsed.session_id)}/command/${encodeURIComponent(parsed.command_id)}/input`;
    await this.request({
      op: "input",
      method: "POST",
      path,
      sandbox_id: parsed.sandbox_id,
      session_id: parsed.session_id,
      command_id: parsed.command_id,
      ok: [200, 201, 204],
      body: { data: parsed.data },
    });
  }

  async getLogs(ref: {
    sandbox_id: string;
    session_id: string;
    command_id: string;
  }): Promise<ToolboxProcessSessionLogs> {
    const sandbox_id = ref.sandbox_id.trim();
    const session_id = ref.session_id.trim();
    const command_id = ref.command_id.trim();
    const path = `/toolbox/${encodeURIComponent(sandbox_id)}/process/session/${encodeURIComponent(session_id)}/command/${encodeURIComponent(command_id)}/logs`;
    const got = await this.request({
      op: "logs",
      method: "GET",
      path,
      sandbox_id,
      session_id,
      command_id,
      ok: [200],
    });
    return parseToolboxProcessSessionLogs(got.json ?? {});
  }

  async teardown(req: ToolboxProcessSessionCreate): Promise<void> {
    const parsed = parseToolboxProcessSessionCreate(req);
    const path = `/toolbox/${encodeURIComponent(parsed.sandbox_id)}/process/session/${encodeURIComponent(parsed.session_id)}`;
    await this.request({
      op: "teardown",
      method: "DELETE",
      path,
      sandbox_id: parsed.sandbox_id,
      session_id: parsed.session_id,
      ok: [200, 204, 404],
    });
  }

  private async request(args: {
    op: DaytonaToolboxSessionLogEvent["op"];
    method: string;
    path: string;
    sandbox_id: string;
    session_id: string;
    command_id?: string;
    argv_count?: number;
    cwd?: string;
    ok: number[];
    body?: unknown;
  }): Promise<{ status: number; json: unknown }> {
    assertToolboxProcessSessionPath(args.path);
    const started = Date.now();
    const url = `${this.toolboxBaseUrl}${args.path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.httpTimeoutMs);
    const headers: Record<string, string> = {
      Accept: "application/json",
      [DAYTONA_AUTH_HEADER]: `Bearer ${this.apiKey}`,
      [DAYTONA_ORG_HEADER]: this.orgId,
    };
    if (args.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: args.method,
        headers,
        body: args.body === undefined ? undefined : JSON.stringify(args.body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (isAbortError(err)) {
        const timeoutErr = new DaytonaTimeoutError(args.op, this.httpTimeoutMs, {
          sandboxId: args.sandbox_id,
        });
        this.emitLog({
          op: args.op,
          method: args.method,
          path: args.path,
          sandbox_id: args.sandbox_id,
          session_id: args.session_id,
          error_code: timeoutErr.code,
          error_message: timeoutErr.message,
          duration_ms: Date.now() - started,
        });
        throw timeoutErr;
      }
      const message =
        err instanceof Error ? err.message : "Daytona session request failed";
      const netErr = new DaytonaClientError(
        "DAYTONA_NETWORK_ERROR",
        `Daytona session ${args.op} network error: ${sanitizeErrorMessage(message)}`,
        { sandboxId: args.sandbox_id },
      );
      this.emitLog({
        op: args.op,
        method: args.method,
        path: args.path,
        sandbox_id: args.sandbox_id,
        session_id: args.session_id,
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

    if (status === 404 && !args.ok.includes(404)) {
      const notFound = new DaytonaSandboxNotFoundError(args.sandbox_id);
      this.emitLog({
        op: args.op,
        method: args.method,
        path: args.path,
        sandbox_id: args.sandbox_id,
        session_id: args.session_id,
        status,
        error_code: notFound.code,
        error_message: notFound.message,
        duration_ms: durationMs,
      });
      throw notFound;
    }

    if (!args.ok.includes(status)) {
      const snippet = truncateSnippet(text);
      const apiMessage = extractApiErrorMessage(text) ?? `HTTP ${status}`;
      const httpErr = new DaytonaHttpError(
        args.op,
        status,
        `Daytona session ${args.op} failed: ${sanitizeErrorMessage(apiMessage)}`,
        {
          sandboxId: args.sandbox_id,
          bodySnippet: snippet,
        },
      );
      this.emitLog({
        op: args.op,
        method: args.method,
        path: args.path,
        sandbox_id: args.sandbox_id,
        session_id: args.session_id,
        status,
        error_code: httpErr.code,
        error_message: httpErr.message,
        duration_ms: durationMs,
      });
      throw httpErr;
    }

    let parsed: unknown = {};
    if (text.trim()) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        if (status !== 204) {
          throw new DaytonaHttpError(
            args.op,
            status,
            "Daytona session returned non-JSON body",
            {
              sandboxId: args.sandbox_id,
              bodySnippet: truncateSnippet(text),
            },
          );
        }
      }
    }

    this.emitLog({
      op: args.op,
      method: args.method,
      path: args.path,
      sandbox_id: args.sandbox_id,
      session_id: args.session_id,
      ...(args.command_id !== undefined ? { command_id: args.command_id } : {}),
      ...(args.argv_count !== undefined ? { argv_count: args.argv_count } : {}),
      ...(args.cwd !== undefined ? { cwd: args.cwd } : {}),
      status,
      duration_ms: durationMs,
    });
    return { status, json: parsed };
  }

  private emitLog(event: DaytonaToolboxSessionLogEvent): void {
    if (!this.logSafe) return;
    try {
      this.logSafe(
        redactToolboxLogFields(event) as DaytonaToolboxSessionLogEvent,
      );
    } catch {
      // Logging must never break the session.
    }
  }
}

export function createDaytonaToolboxSessionClient(
  options: DaytonaToolboxSessionClientOptions,
): DaytonaToolboxSessionClient {
  const client = new DaytonaToolboxSessionClient(options);
  if (!isToolboxProcessSessionClient(client)) {
    throw new TypeError("DaytonaToolboxSessionClient failed port check");
  }
  return client;
}
