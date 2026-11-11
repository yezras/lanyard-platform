/**
 * Remote MCP adapter (lp-hdzm.26 / 0018.26).
 *
 * Harness client for a compiled snapshot MCP surface. Transport is
 * streamable-http only. Tools are namespaced `connectorId.toolName`.
 * SSE-only is refused. Registry MCP OAuth (`needs_auth`) is not this
 * epic: fail closed, do not start an OAuth flow.
 */

import {
  applyClassCHarnessHttp,
  stripSecretFieldsFromToolSchema,
  type ClassCFetch,
  type ClassCHttpAttach,
  type ClassCHttpRequest,
  type ClassCHttpResponse,
} from "./class-c-attach.js";
import type { GuestConnectorStore } from "./connector-user-sandbox.js";
import type { ConnectorId } from "./connectors.js";
import type { CompiledSurface } from "./connector-registry.js";

export const REMOTE_MCP_TRANSPORT = "streamable-http" as const;
export type RemoteMcpTransport = typeof REMOTE_MCP_TRANSPORT;

export const SSE_ONLY_REMOTE_MCP_TRANSPORTS = [
  "sse",
  "sse-only",
  "http+sse",
] as const;
export type SseOnlyRemoteMcpTransport =
  (typeof SSE_ONLY_REMOTE_MCP_TRANSPORTS)[number];

export const MCP_TOOL_NAMESPACE_SEP = "." as const;

export const REMOTE_MCP_PROTOCOL_VERSION = "2025-03-26" as const;

export const REMOTE_MCP_OAUTH_NOT_IMPLEMENTED =
  "mcp_oauth_not_implemented" as const;

const JSON_RPC = "2.0" as const;
const MAX_BODY_BYTES = 1_048_576;
const AUTH_HINT =
  /oauth|unauthorized|unauthorised|needs_auth|authentication required|invalid_token|www-authenticate/i;

export type RemoteMcpSurface = Pick<
  CompiledSurface,
  "kind" | "initialize_url" | "transport" | "runnability" | "auth_kind"
>;

export type RemoteMcpTool = {
  connector_id: ConnectorId;
  tool_name: string;
  namespaced_name: string;
  description?: string;
  input_schema: Record<string, unknown>;
};

/** Phase-8 tool tree: Record<connectorId, Record<toolName, Tool>>. */
export type RemoteMcpToolTree = Record<
  string,
  Record<string, RemoteMcpTool>
>;

export type RemoteMcpSession = {
  connector_id: ConnectorId;
  session_id: string | null;
  tools: RemoteMcpTool[];
  tree: RemoteMcpToolTree;
  call: (
    namespacedName: string,
    args?: Record<string, unknown>,
  ) => Promise<unknown>;
  close: () => Promise<void>;
};

export type RemoteMcpConnectResult =
  | { status: "connected"; session: RemoteMcpSession }
  | {
      status: "needs_auth";
      reason: typeof REMOTE_MCP_OAUTH_NOT_IMPLEMENTED;
    }
  | { status: "refused"; reason: "sse_only" }
  | { status: "failed"; reason: string };

export class InvalidRemoteMcpToolNameError extends Error {
  readonly code = "INVALID_REMOTE_MCP_TOOL_NAME" as const;

  constructor(value: string) {
    super(`Remote MCP tool name is not namespaced for this connector: ${value}`);
    this.name = "InvalidRemoteMcpToolNameError";
  }
}

export function isSseOnlyRemoteMcpTransport(
  value: string,
): value is SseOnlyRemoteMcpTransport {
  const normalized = value.trim().toLowerCase();
  return (SSE_ONLY_REMOTE_MCP_TRANSPORTS as readonly string[]).includes(
    normalized,
  );
}

export function isRemoteMcpTransport(
  value: string,
): value is RemoteMcpTransport {
  return value.trim().toLowerCase() === REMOTE_MCP_TRANSPORT;
}

export function namespaceRemoteMcpTool(
  connectorId: ConnectorId,
  toolName: string,
): string {
  const name = toolName.trim();
  if (!name) {
    throw new InvalidRemoteMcpToolNameError(toolName);
  }
  return `${connectorId}${MCP_TOOL_NAMESPACE_SEP}${name}`;
}

export function unnamespaceRemoteMcpTool(
  connectorId: ConnectorId,
  namespacedName: string,
): string {
  const prefix = `${connectorId}${MCP_TOOL_NAMESPACE_SEP}`;
  if (!namespacedName.startsWith(prefix) || namespacedName.length === prefix.length) {
    throw new InvalidRemoteMcpToolNameError(namespacedName);
  }
  return namespacedName.slice(prefix.length);
}

export function remoteMcpToolTree(
  connectorId: ConnectorId,
  tools: readonly RemoteMcpTool[],
): RemoteMcpToolTree {
  const inner: Record<string, RemoteMcpTool> = {};
  for (const tool of tools) {
    inner[tool.tool_name] = tool;
  }
  return { [connectorId]: inner };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function header(
  headers: Readonly<Record<string, string>> | undefined,
  name: string,
): string | undefined {
  if (!headers) {
    return undefined;
  }
  const want = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === want) {
      return value;
    }
  }
  return undefined;
}

function rpcErrorMessage(error: unknown): string {
  const rec = asRecord(error);
  if (!rec) {
    return String(error ?? "MCP error");
  }
  if (typeof rec.message === "string" && rec.message.trim()) {
    return rec.message;
  }
  return "MCP error";
}

function isAuthRequired(
  response: ClassCHttpResponse,
  rpcError?: unknown,
): boolean {
  if (response.status === 401) {
    return true;
  }
  if (header(response.headers, "www-authenticate")) {
    return true;
  }
  if (rpcError && AUTH_HINT.test(rpcErrorMessage(rpcError))) {
    return true;
  }
  return false;
}

function parseJsonRpcBody(body: string, contentType: string | undefined): unknown {
  const trimmed = body.trim();
  if (!trimmed) {
    return null;
  }
  if (contentType && contentType.toLowerCase().includes("text/event-stream")) {
    for (const line of trimmed.split(/\r?\n/)) {
      const prefix = line.startsWith("data:") ? line.slice(5).trim() : "";
      if (!prefix) {
        continue;
      }
      try {
        return JSON.parse(prefix) as unknown;
      } catch {
        continue;
      }
    }
    return null;
  }
  return JSON.parse(trimmed) as unknown;
}

export async function defaultRemoteMcpFetch(
  request: ClassCHttpRequest,
): Promise<ClassCHttpResponse> {
  const res = await fetch(request.url, {
    method: request.method ?? "POST",
    headers: request.headers,
    body: request.body,
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key] = value;
  });
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_BODY_BYTES) {
    throw new Error("Remote MCP response exceeded size cap");
  }
  return {
    status: res.status,
    headers,
    body: buf.toString("utf8"),
  };
}

async function postJsonRpc(input: {
  url: string;
  method: string;
  params?: Record<string, unknown>;
  id?: number | null;
  sessionId: string | null;
  attach?: ClassCHttpAttach;
  fetch: ClassCFetch;
  guest?: Pick<GuestConnectorStore, "listFiles" | "printenv">;
  sandbox_id?: string;
}): Promise<{
  response: ClassCHttpResponse;
  rpc: Record<string, unknown> | null;
}> {
  const payload: Record<string, unknown> = {
    jsonrpc: JSON_RPC,
    method: input.method,
  };
  if (input.id !== null && input.id !== undefined) {
    payload.id = input.id;
  }
  if (input.params) {
    payload.params = input.params;
  }
  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    "MCP-Protocol-Version": REMOTE_MCP_PROTOCOL_VERSION,
  };
  if (input.sessionId) {
    headers["Mcp-Session-Id"] = input.sessionId;
  }
  const request: ClassCHttpRequest = {
    url: input.url,
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  };
  const response = input.attach
    ? (
        await applyClassCHarnessHttp({
          fetch: input.fetch,
          request,
          attach: input.attach,
          guest: input.guest,
          sandbox_id: input.sandbox_id,
        })
      ).response
    : await input.fetch(request);
  let rpc: Record<string, unknown> | null = null;
  try {
    const parsed = parseJsonRpcBody(
      response.body,
      header(response.headers, "content-type"),
    );
    rpc = asRecord(parsed);
  } catch {
    rpc = null;
  }
  return { response, rpc };
}

function mapListedTool(
  connectorId: ConnectorId,
  raw: unknown,
): RemoteMcpTool | null {
  const rec = asRecord(raw);
  if (!rec || typeof rec.name !== "string" || !rec.name.trim()) {
    return null;
  }
  const tool_name = rec.name.trim();
  const schemaRaw = rec.inputSchema ?? rec.input_schema ?? { type: "object" };
  const stripped = stripSecretFieldsFromToolSchema(schemaRaw);
  const input_schema = asRecord(stripped) ?? { type: "object" };
  const tool: RemoteMcpTool = {
    connector_id: connectorId,
    tool_name,
    namespaced_name: namespaceRemoteMcpTool(connectorId, tool_name),
    input_schema,
  };
  if (typeof rec.description === "string" && rec.description) {
    tool.description = rec.description;
  }
  return tool;
}

export async function connectRemoteMcp(input: {
  connector_id: ConnectorId;
  surface: RemoteMcpSurface;
  attach?: ClassCHttpAttach;
  fetch?: ClassCFetch;
  guest?: Pick<GuestConnectorStore, "listFiles" | "printenv">;
  sandbox_id?: string;
}): Promise<RemoteMcpConnectResult> {
  if (input.surface.kind !== "mcp") {
    return { status: "failed", reason: "surface_not_mcp" };
  }
  const transport = input.surface.transport ?? "";
  if (isSseOnlyRemoteMcpTransport(transport)) {
    return { status: "refused", reason: "sse_only" };
  }
  if (!isRemoteMcpTransport(transport)) {
    return { status: "failed", reason: "mcp_requires_streamable_http" };
  }
  const url = input.surface.initialize_url?.trim() ?? "";
  if (!url) {
    return { status: "failed", reason: "mcp_initialize_url_missing" };
  }
  if (input.attach && input.attach.connector_id !== input.connector_id) {
    return { status: "failed", reason: "class_c_connector_mismatch" };
  }

  const fetchImpl = input.fetch ?? defaultRemoteMcpFetch;
  let nextId = 1;
  let sessionId: string | null = null;

  const rpc = async (
    method: string,
    params?: Record<string, unknown>,
    id?: number | null,
  ) =>
    postJsonRpc({
      url,
      method,
      params,
      id: id === undefined ? nextId++ : id,
      sessionId,
      attach: input.attach,
      fetch: fetchImpl,
      guest: input.guest,
      sandbox_id: input.sandbox_id,
    });

  const initialized = await rpc("initialize", {
    protocolVersion: REMOTE_MCP_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "lanyard-remote-mcp", version: "lp-hdzm.26" },
  });
  if (isAuthRequired(initialized.response, initialized.rpc?.error)) {
    return {
      status: "needs_auth",
      reason: REMOTE_MCP_OAUTH_NOT_IMPLEMENTED,
    };
  }
  if (initialized.response.status >= 400 || initialized.rpc?.error) {
    return {
      status: "failed",
      reason: rpcErrorMessage(
        initialized.rpc?.error ?? `http_${initialized.response.status}`,
      ),
    };
  }
  const initResult = asRecord(initialized.rpc?.result);
  if (!initResult) {
    return { status: "failed", reason: "mcp_initialize_failed" };
  }
  sessionId =
    header(initialized.response.headers, "mcp-session-id")?.trim() || null;

  const notified = await rpc("notifications/initialized", undefined, null);
  if (isAuthRequired(notified.response, notified.rpc?.error)) {
    return {
      status: "needs_auth",
      reason: REMOTE_MCP_OAUTH_NOT_IMPLEMENTED,
    };
  }

  const listed = await rpc("tools/list", {});
  if (isAuthRequired(listed.response, listed.rpc?.error)) {
    return {
      status: "needs_auth",
      reason: REMOTE_MCP_OAUTH_NOT_IMPLEMENTED,
    };
  }
  if (listed.response.status >= 400 || listed.rpc?.error) {
    return {
      status: "failed",
      reason: rpcErrorMessage(
        listed.rpc?.error ?? `http_${listed.response.status}`,
      ),
    };
  }
  const listResult = asRecord(listed.rpc?.result);
  const rawTools = Array.isArray(listResult?.tools) ? listResult.tools : [];
  const tools: RemoteMcpTool[] = [];
  for (const row of rawTools) {
    const tool = mapListedTool(input.connector_id, row);
    if (tool) {
      tools.push(tool);
    }
  }
  const tree = remoteMcpToolTree(input.connector_id, tools);

  const session: RemoteMcpSession = {
    connector_id: input.connector_id,
    session_id: sessionId,
    tools,
    tree,
    call: async (namespacedName, args) => {
      const toolName = unnamespaceRemoteMcpTool(
        input.connector_id,
        namespacedName,
      );
      if (!tree[input.connector_id]?.[toolName]) {
        throw new InvalidRemoteMcpToolNameError(namespacedName);
      }
      const called = await rpc("tools/call", {
        name: toolName,
        arguments: args ?? {},
      });
      if (isAuthRequired(called.response, called.rpc?.error)) {
        throw new RemoteMcpNeedsAuthError();
      }
      if (called.response.status >= 400 || called.rpc?.error) {
        throw new Error(
          rpcErrorMessage(called.rpc?.error ?? `http_${called.response.status}`),
        );
      }
      return called.rpc?.result ?? null;
    },
    close: async () => {
      if (!sessionId) {
        return;
      }
      await fetchImpl({
        url,
        method: "DELETE",
        headers: {
          "Mcp-Session-Id": sessionId,
          "MCP-Protocol-Version": REMOTE_MCP_PROTOCOL_VERSION,
        },
      }).catch(() => undefined);
    },
  };
  return { status: "connected", session };
}

export class RemoteMcpNeedsAuthError extends Error {
  readonly code = "MCP_OAUTH_NOT_IMPLEMENTED" as const;
  readonly reason = REMOTE_MCP_OAUTH_NOT_IMPLEMENTED;

  constructor() {
    super("MCP OAuth needs_auth is not implemented");
    this.name = "RemoteMcpNeedsAuthError";
  }
}
