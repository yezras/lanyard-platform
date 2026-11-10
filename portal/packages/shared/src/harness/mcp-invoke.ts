/**
 * Harness MCP placement + lab_echo invoke (lp-oop.38.17).
 *
 * Discriminated placement at the config boundary. the real harness and kitchen-sink hop use this so a use_tool/lab_echo turn is a real stdio
 * JSON-RPC tools/call, not `echo: <prompt>`. Vault-required stdio stays
 * fail-closed. Toolbox process/execute is never called.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

import type { TurnEvent, TurnId, TurnRequest } from "./turn.js";

export const LAB_ECHO_MCP_NAME = "lab_echo";
export const LAB_ECHO_QUALIFIED_TOOL = "mcp__lab_echo__lab_echo";
export const SEARCH_TOOL_NAME = "search_tool";
export const USE_TOOL_NAME = "use_tool";

export const DEFAULT_LAB_ECHO_IMAGE_PATH =
  "/opt/lanyard/lab-mcp/lab_echo_server.py";

export const HARNESS_MCP_VAULT_SESSION_FAIL_CLOSED =
  "MCP stdio that must see /mnt/vault is out of v1: JSON-RPC needs a Daytona process session, not toolbox process/execute";

export const HARNESS_MCP_UNSUPPORTED =
  "MCP server transport is not bound on this harness runner";

const VAULT_HINT = /\/mnt\/vault|\$\{?VAULT_ROOT\}?/;
const MCP_INVOKE_PROMPT =
  /\b(mcp|search_tool|use_tool|mcp__|lab_echo)\b/i;

const DEFAULT_RPC_TIMEOUT_MS = 8_000;

export type HarnessMcpTransport = "stdio" | "http" | "sse" | string;

export type HarnessMcpServerSpec = {
  name: string;
  enabled: boolean;
  transport: HarnessMcpTransport;
  command?: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  requires_vault: boolean;
};

export type McpPlacement =
  | { placement: "disabled"; spec: HarnessMcpServerSpec }
  | { placement: "harness_stdio"; spec: HarnessMcpServerSpec }
  | { placement: "harness_http"; spec: HarnessMcpServerSpec }
  | { placement: "vault_session"; spec: HarnessMcpServerSpec; reason: string }
  | { placement: "unsupported"; spec: HarnessMcpServerSpec; reason: string };

export type McpSearchHit = {
  name: string;
  score: number;
  placement: McpPlacement["placement"];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function parseHarnessMcpServerSpec(
  name: string,
  raw: unknown,
): HarnessMcpServerSpec {
  const e = isRecord(raw) ? raw : {};
  const transport = asString(e.transport) ?? asString(e.type) ?? "stdio";
  const command = asString(e.command);
  const cwd = asString(e.cwd);
  const url = asString(e.url);
  const env = asStringRecord(e.env);
  const headers = asStringRecord(e.headers);
  return {
    name,
    enabled: e.enabled === undefined ? true : Boolean(e.enabled),
    transport,
    args: asStringArray(e.args),
    requires_vault: e.requires_vault === true,
    ...(command !== undefined ? { command } : {}),
    ...(cwd !== undefined ? { cwd } : {}),
    ...(url !== undefined ? { url } : {}),
    ...(env !== undefined ? { env } : {}),
    ...(headers !== undefined ? { headers } : {}),
  };
}

export function specTouchesVault(spec: HarnessMcpServerSpec): boolean {
  if (spec.requires_vault) return true;
  const hay = [
    spec.cwd ?? "",
    spec.command ?? "",
    ...spec.args,
    ...Object.values(spec.env ?? {}),
  ].join("\n");
  return VAULT_HINT.test(hay);
}

export function classifyMcpPlacement(spec: HarnessMcpServerSpec): McpPlacement {
  if (!spec.enabled) {
    return { placement: "disabled", spec };
  }
  const transport = spec.transport.trim().toLowerCase() || "stdio";
  if (transport === "http" || transport === "sse") {
    if (!spec.url) {
      return {
        placement: "unsupported",
        spec,
        reason: `MCP ${transport} server ${spec.name} is missing url`,
      };
    }
    return { placement: "harness_http", spec };
  }
  if (transport !== "stdio") {
    return {
      placement: "unsupported",
      spec,
      reason: `MCP transport ${transport} is not bound on this harness runner`,
    };
  }
  if (specTouchesVault(spec)) {
    return {
      placement: "vault_session",
      spec,
      reason: HARNESS_MCP_VAULT_SESSION_FAIL_CLOSED,
    };
  }
  if (!spec.command) {
    return {
      placement: "unsupported",
      spec,
      reason: `MCP stdio server ${spec.name} is missing command`,
    };
  }
  return { placement: "harness_stdio", spec };
}

export function wantsHarnessMcpInvoke(message: string): boolean {
  return MCP_INVOKE_PROMPT.test(message);
}

export function snapshotHasEnabledLabEcho(
  snapshot: Record<string, unknown> | null | undefined,
): boolean {
  if (!snapshot) return false;
  const servers = snapshot.mcp_servers;
  if (!Array.isArray(servers)) return false;
  return servers.some((row) => {
    if (!isRecord(row)) return false;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    if (name !== LAB_ECHO_MCP_NAME) return false;
    return row.enabled !== false;
  });
}

export function resolveLabEchoServerPath(
  override?: string,
): string | undefined {
  const candidates = [
    override?.trim(),
    process.env.LANYARD_LAB_MCP_SERVER?.trim(),
    DEFAULT_LAB_ECHO_IMAGE_PATH,
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../../../deploy/daytona/agent-gateway/lab-mcp/lab_echo_server.py",
    ),
  ];
  for (const path of candidates) {
    if (path && existsSync(path)) return path;
  }
  return undefined;
}

function formatCallResult(result: unknown): string {
  if (isRecord(result)) {
    const content = result.content;
    if (Array.isArray(content)) {
      const texts: string[] = [];
      for (const block of content) {
        if (
          isRecord(block) &&
          block.type === "text" &&
          typeof block.text === "string"
        ) {
          texts.push(block.text);
        }
      }
      if (texts.length > 0) return texts.join("\n");
    }
    if (result.isError === true) {
      return typeof content === "string" ? content : JSON.stringify(result);
    }
  }
  if (typeof result === "string") return result;
  return JSON.stringify(result ?? null, null, 2);
}

function buildToolProgressEvent(input: {
  chatId: string;
  messageId: string;
  toolCallId: string;
  toolName: string;
  status: "running" | "completed" | "error";
  toolLabel?: string;
  result?: string;
  duration?: string;
}): TurnEvent {
  const metadata: Record<string, unknown> = {
    portal_event: "tool_progress",
    tool_name: input.toolName,
    tool_call_id: input.toolCallId,
    status: input.status,
  };
  if (input.toolLabel) metadata.tool_label = input.toolLabel;
  if (input.result !== undefined) metadata.result = input.result;
  if (input.duration) metadata.duration = input.duration;
  const event: TurnEvent = {
    type: "tool_progress",
    chat_id: input.chatId,
    message_id: input.messageId,
    tool_name: input.toolName,
    tool_call_id: input.toolCallId,
    tool_status: input.status,
    metadata,
  };
  if (input.toolLabel) event.tool_label = input.toolLabel;
  if (input.result !== undefined) event.result = input.result;
  if (input.duration) event.duration = input.duration;
  return event;
}

function spawnStdio(command: string, args: string[]) {
  return spawn(command, args, {
    stdio: ["pipe", "pipe", "pipe"],
  });
}

export async function invokeLabEchoStdio(options: {
  text: string;
  serverPath: string;
  command?: string;
  timeoutMs?: number;
}): Promise<string> {
  const command = options.command?.trim() || "python3";
  const timeoutMs = options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
  const child = spawnStdio(command, [options.serverPath]);
  const rl = createInterface({ input: child.stdout });
  type Pending = {
    resolve: (value: unknown) => void;
    reject: (err: Error) => void;
  };
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let closed = false;
  let workDone = false;

  const closeChild = () => {
    if (closed) return;
    closed = true;
    try {
      rl.close();
    } catch {
      // ignore
    }
    try {
      child.stdin.end();
    } catch {
      // ignore
    }
    try {
      child.kill("SIGTERM");
    } catch {
      // ignore
    }
  };

  const rejectAll = (err: Error) => {
    for (const row of pending.values()) row.reject(err);
    pending.clear();
  };

  const lineLoop = (async () => {
    for await (const line of rl) {
      const trimmed = String(line).trim();
      if (!trimmed) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (!isRecord(parsed) || parsed.jsonrpc !== "2.0") continue;
      const id = parsed.id;
      if (typeof id !== "number") continue;
      const waiter = pending.get(id);
      if (!waiter) continue;
      pending.delete(id);
      if (parsed.error) {
        const message = isRecord(parsed.error)
          ? String(parsed.error.message ?? "MCP error")
          : "MCP error";
        waiter.reject(new Error(message));
        continue;
      }
      waiter.resolve(parsed.result);
    }
  })();

  child.on("error", (err) => {
    rejectAll(err instanceof Error ? err : new Error(String(err)));
    closeChild();
  });
  child.on("exit", () => {
    if (!workDone) {
      rejectAll(new Error("lab_echo stdio exited before tools/call completed"));
    }
    closeChild();
  });

  const call = async (
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> => {
    const id = nextId;
    nextId += 1;
    const result = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    const payload: Record<string, unknown> = {
      jsonrpc: "2.0",
      id,
      method,
    };
    if (params) payload.params = params;
    child.stdin.write(`${JSON.stringify(payload)}\n`);
    return result;
  };

  const notify = (method: string, params?: Record<string, unknown>) => {
    const payload: Record<string, unknown> = { jsonrpc: "2.0", method };
    if (params) payload.params = params;
    child.stdin.write(`${JSON.stringify(payload)}\n`);
  };

  const work = (async () => {
    await call("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "lanyard-local-harness", version: "lp-oop.38.17" },
    });
    notify("notifications/initialized");
    const listed = await call("tools/list");
    const tools =
      isRecord(listed) && Array.isArray(listed.tools) ? listed.tools : [];
    const hasEcho = tools.some(
      (row) => isRecord(row) && row.name === LAB_ECHO_MCP_NAME,
    );
    if (!hasEcho) {
      throw new Error("lab_echo tools/list did not advertise lab_echo");
    }
    const called = await call("tools/call", {
      name: LAB_ECHO_MCP_NAME,
      arguments: { text: options.text },
    });
    return formatCallResult(called);
  })();

  const timeout = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error("lab_echo JSON-RPC timed out")),
      timeoutMs,
    );
  });

  try {
    const text = await Promise.race([work, timeout]);
    workDone = true;
    return text;
  } finally {
    closeChild();
    await Promise.race([
      lineLoop.catch(() => undefined),
      new Promise((resolve) => {
        setTimeout(() => resolve(undefined), 50);
      }),
    ]);
  }
}

export async function invokeVaultRequiredStdioMcp(): Promise<string> {
  return HARNESS_MCP_VAULT_SESSION_FAIL_CLOSED;
}

function durationMs(started: number): string {
  return `${Math.max(1, Date.now() - started)}ms`;
}

export async function runHarnessMcpLabEchoTurn(input: {
  request: TurnRequest;
  turnId: TurnId;
  serverPath?: string;
  command?: string;
  model?: string;
}): Promise<TurnEvent[]> {
  const chatId = input.request.thread_id;
  const searchId = `call_search_${input.turnId}`;
  const useId = `call_use_${input.turnId}`;
  const events: TurnEvent[] = [
    buildToolProgressEvent({
      chatId,
      messageId: `tool_${input.turnId}_search_tool`,
      toolCallId: searchId,
      toolName: SEARCH_TOOL_NAME,
      toolLabel: SEARCH_TOOL_NAME,
      status: "running",
    }),
  ];

  const searchHits: McpSearchHit[] = [
    {
      name: LAB_ECHO_QUALIFIED_TOOL,
      score: 1,
      placement: "harness_stdio",
    },
  ];
  const searchStarted = Date.now();
  events.push(
    buildToolProgressEvent({
      chatId,
      messageId: `tool_${input.turnId}_search_tool`,
      toolCallId: searchId,
      toolName: SEARCH_TOOL_NAME,
      toolLabel: SEARCH_TOOL_NAME,
      status: "completed",
      result: JSON.stringify({ tools: searchHits }),
      duration: durationMs(searchStarted),
    }),
  );

  events.push(
    buildToolProgressEvent({
      chatId,
      messageId: `tool_${input.turnId}_use_tool`,
      toolCallId: useId,
      toolName: USE_TOOL_NAME,
      toolLabel: LAB_ECHO_MCP_NAME,
      status: "running",
    }),
  );

  const path = resolveLabEchoServerPath(input.serverPath);
  const useStarted = Date.now();
  let result: string;
  let status: "completed" | "error" = "completed";
  try {
    if (!path) {
      throw new Error("lab_echo stdio binary is missing");
    }
    result = await invokeLabEchoStdio({
      text: input.request.message,
      serverPath: path,
      command: input.command,
    });
  } catch (err) {
    status = "error";
    result = err instanceof Error ? err.message : String(err);
  }

  events.push(
    buildToolProgressEvent({
      chatId,
      messageId: `tool_${input.turnId}_use_tool`,
      toolCallId: useId,
      toolName: USE_TOOL_NAME,
      toolLabel: LAB_ECHO_MCP_NAME,
      status,
      result,
      duration: durationMs(useStarted),
    }),
  );

  const content =
    status === "completed"
      ? [
          `Called ${SEARCH_TOOL_NAME} → ${USE_TOOL_NAME} on ${LAB_ECHO_QUALIFIED_TOOL} (${LAB_ECHO_MCP_NAME}).`,
          result,
        ].join("\n")
      : `MCP invoke failed: ${result}`;

  const send: TurnEvent = {
    type: "message_send",
    chat_id: chatId,
    message_id: `msg_${input.turnId}`,
    content,
  };
  if (input.model) {
    send.model = input.model;
    send.metadata = { model: input.model };
  }
  events.push(send);
  return events;
}
