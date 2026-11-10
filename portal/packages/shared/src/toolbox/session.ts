/**
 * Daytona toolbox process-session contract (lp-oop.38.19).
 *
 * Vault stdio MCP is a JSON-RPC session, not one argv. One-shot
 * `process/execute` is a different port ({@link ToolboxClient}).
 *
 * Wire (Daytona toolbox proxy):
 *   POST   /toolbox/{sandbox_id}/process/session
 *   GET    /toolbox/{sandbox_id}/process/session/{session_id}
 *   POST   /toolbox/{sandbox_id}/process/session/{session_id}/exec
 *   POST   /toolbox/{sandbox_id}/process/session/{session_id}/command/{command_id}/input
 *   GET    /toolbox/{sandbox_id}/process/session/{session_id}/command/{command_id}/logs
 *   DELETE /toolbox/{sandbox_id}/process/session/{session_id}
 */

export type ToolboxProcessSessionRef = {
  sandbox_id: string;
  session_id: string;
  command_id?: string;
};

export type ToolboxProcessSessionCreate = {
  sandbox_id: string;
  session_id: string;
};

export type ToolboxProcessSessionExec = {
  sandbox_id: string;
  session_id: string;
  argv: readonly string[];
  cwd: string;
};

export type ToolboxProcessSessionInput = {
  sandbox_id: string;
  session_id: string;
  command_id: string;
  data: string;
};

export type ToolboxProcessSessionLogs = {
  stdout: string;
  stderr: string;
};

export type ToolboxJsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
};

export type ToolboxJsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
};

export type ToolboxJsonRpcError = {
  code?: number;
  message?: string;
  data?: unknown;
};

export type ToolboxJsonRpcResponse = {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: ToolboxJsonRpcError;
};

/**
 * Long-lived process session. MCP stdio uses this, never {@link ToolboxClient.execute}.
 */
export interface ToolboxProcessSessionClient {
  create(req: ToolboxProcessSessionCreate): Promise<ToolboxProcessSessionRef>;
  attach(req: ToolboxProcessSessionCreate): Promise<ToolboxProcessSessionRef>;
  exec(req: ToolboxProcessSessionExec): Promise<ToolboxProcessSessionRef>;
  sendInput(req: ToolboxProcessSessionInput): Promise<void>;
  getLogs(
    ref: Required<
      Pick<ToolboxProcessSessionRef, "sandbox_id" | "session_id" | "command_id">
    >,
  ): Promise<ToolboxProcessSessionLogs>;
  teardown(req: ToolboxProcessSessionCreate): Promise<void>;
}

const SESSION_CREATE_KEYS = ["sandbox_id", "session_id"] as const;
const SESSION_EXEC_KEYS = ["sandbox_id", "session_id", "argv", "cwd"] as const;
const SESSION_INPUT_KEYS = [
  "sandbox_id",
  "session_id",
  "command_id",
  "data",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && Array.isArray(value) === false;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`ToolboxProcessSession.${field} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new TypeError(`ToolboxProcessSession.${field} must be a non-empty string`);
  }
  return trimmed;
}

function requiredArgv(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("ToolboxProcessSessionExec.argv must be a non-empty string array");
  }
  const out: string[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const item = value[i];
    if (typeof item !== "string") {
      throw new TypeError(`ToolboxProcessSessionExec.argv[${i}] must be a string`);
    }
    out.push(item);
  }
  return out;
}

function requireKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  for (const key of keys) {
    if (!(key in value)) {
      throw new TypeError(`ToolboxProcessSession.${key} is required`);
    }
  }
}

export function parseToolboxProcessSessionCreate(
  value: unknown,
): ToolboxProcessSessionCreate {
  if (!isRecord(value)) {
    throw new TypeError("ToolboxProcessSessionCreate must be an object");
  }
  requireKeys(value, SESSION_CREATE_KEYS);
  return {
    sandbox_id: requiredString(value.sandbox_id, "sandbox_id"),
    session_id: requiredString(value.session_id, "session_id"),
  };
}

export function parseToolboxProcessSessionExec(
  value: unknown,
): ToolboxProcessSessionExec {
  if (!isRecord(value)) {
    throw new TypeError("ToolboxProcessSessionExec must be an object");
  }
  requireKeys(value, SESSION_EXEC_KEYS);
  return {
    sandbox_id: requiredString(value.sandbox_id, "sandbox_id"),
    session_id: requiredString(value.session_id, "session_id"),
    argv: requiredArgv(value.argv),
    cwd: requiredString(value.cwd, "cwd"),
  };
}

export function parseToolboxProcessSessionInput(
  value: unknown,
): ToolboxProcessSessionInput {
  if (!isRecord(value)) {
    throw new TypeError("ToolboxProcessSessionInput must be an object");
  }
  requireKeys(value, SESSION_INPUT_KEYS);
  if (typeof value.data !== "string") {
    throw new TypeError("ToolboxProcessSessionInput.data must be a string");
  }
  return {
    sandbox_id: requiredString(value.sandbox_id, "sandbox_id"),
    session_id: requiredString(value.session_id, "session_id"),
    command_id: requiredString(value.command_id, "command_id"),
    data: value.data,
  };
}

export function parseToolboxProcessSessionLogs(
  value: unknown,
): ToolboxProcessSessionLogs {
  if (!isRecord(value)) {
    throw new TypeError("ToolboxProcessSessionLogs must be an object");
  }
  const stdout = typeof value.stdout === "string" ? value.stdout : "";
  const stderr = typeof value.stderr === "string" ? value.stderr : "";
  return { stdout, stderr };
}

export function isToolboxProcessSessionClient(
  value: unknown,
): value is ToolboxProcessSessionClient {
  if (value === null || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.create === "function" &&
    typeof c.attach === "function" &&
    typeof c.exec === "function" &&
    typeof c.sendInput === "function" &&
    typeof c.getLogs === "function" &&
    typeof c.teardown === "function"
  );
}

/** Stable Daytona session id for one vault MCP server on one sandbox. */
export function vaultMcpSessionId(serverName: string): string {
  const raw = serverName.trim().toLowerCase();
  const slug = raw.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const body = slug.length > 0 ? slug.slice(0, 40) : "server";
  return `lanyard-mcp-${body}`;
}

export function encodeJsonRpcRequest(
  id: number,
  method: string,
  params?: unknown,
): string {
  const frame: ToolboxJsonRpcRequest = {
    jsonrpc: "2.0",
    id,
    method,
  };
  if (params !== undefined) {
    frame.params = params;
  }
  return `${JSON.stringify(frame)}\n`;
}

export function encodeJsonRpcNotification(
  method: string,
  params?: unknown,
): string {
  const frame: ToolboxJsonRpcNotification = {
    jsonrpc: "2.0",
    method,
  };
  if (params !== undefined) {
    frame.params = params;
  }
  return `${JSON.stringify(frame)}\n`;
}

export function parseJsonRpcLine(line: string): ToolboxJsonRpcResponse | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (!isRecord(parsed)) return null;
    if (parsed.jsonrpc !== undefined && parsed.jsonrpc !== "2.0") return null;
    if (!("result" in parsed) && !("error" in parsed) && parsed.id === undefined) {
      return null;
    }
    const response: ToolboxJsonRpcResponse = {};
    if (typeof parsed.jsonrpc === "string") response.jsonrpc = parsed.jsonrpc;
    if (
      typeof parsed.id === "number" ||
      typeof parsed.id === "string" ||
      parsed.id === null
    ) {
      response.id = parsed.id;
    }
    if ("result" in parsed) response.result = parsed.result;
    if (isRecord(parsed.error)) {
      response.error = parsed.error as ToolboxJsonRpcError;
    }
    return response;
  } catch {
    return null;
  }
}

export function findJsonRpcResponse(
  stdout: string,
  id: number,
): ToolboxJsonRpcResponse | null {
  const lines = stdout.split(/\r?\n/);
  for (const line of lines) {
    const parsed = parseJsonRpcLine(line);
    if (parsed === null) continue;
    if (parsed.id === id || parsed.id === String(id)) {
      return parsed;
    }
  }
  return null;
}

/**
 * Next JSON-RPC request id for an attached session. Logs are cumulative,
 * so reattach must continue past ids already on stdout.
 */
export function nextJsonRpcId(stdout: string): number {
  let max = 0;
  for (const line of stdout.split(/\r?\n/)) {
    const parsed = parseJsonRpcLine(line);
    if (parsed === null) continue;
    if (typeof parsed.id === "number" && Number.isFinite(parsed.id) && parsed.id > max) {
      max = parsed.id;
    }
  }
  return max + 1;
}

/**
 * Guard used by HTTP adapters and tests. Session bind must never hit
 * one-shot process/execute.
 */
export function isToolboxProcessExecutePath(path: string): boolean {
  return /\/process\/execute(?:\/|$|\?)/.test(path);
}

export function isToolboxProcessSessionPath(path: string): boolean {
  return /\/process\/session(?:\/|$|\?)/.test(path);
}

export function assertToolboxProcessSessionPath(path: string): void {
  if (isToolboxProcessExecutePath(path)) {
    throw new Error(
      "vault MCP session must not call toolbox process/execute",
    );
  }
  if (!isToolboxProcessSessionPath(path)) {
    throw new Error("vault MCP session path must be process/session");
  }
}
