/**
 * Vault stdio MCP over a Daytona process session (lp-oop.38.19).
 *
 * create → exec (runAsync) → JSON-RPC on stdin (input) / stdout (logs) → teardown.
 * Never calls ToolboxClient.execute / process/execute.
 */

import {
  encodeJsonRpcNotification,
  encodeJsonRpcRequest,
  findJsonRpcResponse,
  isToolboxProcessSessionClient,
  nextJsonRpcId,
  parseToolboxProcessSessionExec,
  vaultMcpSessionId,
  type ToolboxJsonRpcResponse,
  type ToolboxProcessSessionClient,
  type ToolboxProcessSessionRef,
} from "./session.js";

export type VaultMcpToolDescriptor = {
  name: string;
  description?: string;
  inputSchema?: object;
};

export type BindVaultMcpStdioSessionInput = {
  client: ToolboxProcessSessionClient;
  sandbox_id: string;
  server_name: string;
  argv: readonly string[];
  cwd: string;
  requestTimeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type VaultMcpStdioSession = {
  sandbox_id: string;
  session_id: string;
  command_id: string;
  rpc(method: string, params?: unknown): Promise<unknown>;
  listTools(): Promise<VaultMcpToolDescriptor[]>;
  callTool(name: string, args?: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
};

export const DEFAULT_VAULT_MCP_REQUEST_TIMEOUT_MS = 15_000;
export const DEFAULT_VAULT_MCP_POLL_INTERVAL_MS = 10;

function defaultSleep(ms: number): Promise<void> {
  const timeout = (
    globalThis as unknown as {
      setTimeout: (handler: () => void, delay: number) => unknown;
    }
  ).setTimeout;
  return new Promise((resolve) => {
    timeout(resolve, ms);
  });
}

function mapTools(result: unknown): VaultMcpToolDescriptor[] {
  if (result === null || typeof result !== "object" || Array.isArray(result)) {
    return [];
  }
  const tools = (result as { tools?: unknown }).tools;
  if (!Array.isArray(tools)) return [];
  const out: VaultMcpToolDescriptor[] = [];
  for (const row of tools) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) continue;
    const rec = row as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    if (!name) continue;
    const description =
      typeof rec.description === "string" ? rec.description : undefined;
    const inputSchema =
      rec.inputSchema &&
      typeof rec.inputSchema === "object" &&
      Array.isArray(rec.inputSchema) === false
        ? (rec.inputSchema as object)
        : { type: "object", properties: {} };
    out.push({
      name,
      ...(description !== undefined ? { description } : {}),
      inputSchema,
    });
  }
  return out;
}

function unwrapResponse(response: ToolboxJsonRpcResponse): unknown {
  if (response.error) {
    const message =
      typeof response.error.message === "string" && response.error.message.trim()
        ? response.error.message
        : "MCP JSON-RPC error";
    throw new Error(message);
  }
  return response.result;
}

/**
 * Attach (or create) a long-lived Daytona process session, start the MCP
 * stdio argv once, initialize JSON-RPC, then expose list/call/close.
 */
export async function bindVaultMcpStdioSession(
  input: BindVaultMcpStdioSessionInput,
): Promise<VaultMcpStdioSession> {
  if (!isToolboxProcessSessionClient(input.client)) {
    throw new TypeError("bindVaultMcpStdioSession requires a ToolboxProcessSessionClient");
  }
  const exec = parseToolboxProcessSessionExec({
    sandbox_id: input.sandbox_id,
    session_id: vaultMcpSessionId(input.server_name),
    argv: input.argv,
    cwd: input.cwd,
  });
  const timeoutMs = Math.max(
    1,
    input.requestTimeoutMs ?? DEFAULT_VAULT_MCP_REQUEST_TIMEOUT_MS,
  );
  const pollMs = Math.max(
    1,
    input.pollIntervalMs ?? DEFAULT_VAULT_MCP_POLL_INTERVAL_MS,
  );
  const now = input.now ?? Date.now;
  const sleep = input.sleep ?? defaultSleep;

  let attached = await input.client.attach({
    sandbox_id: exec.sandbox_id,
    session_id: exec.session_id,
  });
  const fresh = attached.command_id === undefined;
  if (fresh) {
    attached = await input.client.exec(exec);
  }
  const commandId = attached.command_id?.trim() ?? "";
  if (!commandId) {
    throw new Error("vault MCP session exec returned no command_id");
  }

  const ref: Required<
    Pick<ToolboxProcessSessionRef, "sandbox_id" | "session_id" | "command_id">
  > = {
    sandbox_id: exec.sandbox_id,
    session_id: exec.session_id,
    command_id: commandId,
  };

  let nextId = 1;
  if (!fresh) {
    nextId = nextJsonRpcId((await input.client.getLogs(ref)).stdout);
  }
  let closed = false;

  const rpc = async (method: string, params?: unknown): Promise<unknown> => {
    if (closed) {
      throw new Error(`vault MCP session closed (${input.server_name})`);
    }
    const id = nextId;
    nextId += 1;
    const data = encodeJsonRpcRequest(id, method, params);
    await input.client.sendInput({
      sandbox_id: ref.sandbox_id,
      session_id: ref.session_id,
      command_id: ref.command_id,
      data,
    });
    const deadline = now() + timeoutMs;
    while (now() <= deadline) {
      const logs = await input.client.getLogs(ref);
      const found = findJsonRpcResponse(logs.stdout, id);
      if (found) {
        return unwrapResponse(found);
      }
      if (now() + pollMs > deadline) break;
      await sleep(pollMs);
    }
    throw new Error(
      `vault MCP request timeout (${timeoutMs}ms) ${input.server_name}.${method}`,
    );
  };

  const notify = async (method: string, params?: unknown): Promise<void> => {
    if (closed) return;
    await input.client.sendInput({
      sandbox_id: ref.sandbox_id,
      session_id: ref.session_id,
      command_id: ref.command_id,
      data: encodeJsonRpcNotification(method, params),
    });
  };

  if (fresh) {
    await rpc("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "lanyard-agent", version: "0.0.0" },
    });
    await notify("notifications/initialized", {});
  }

  return {
    sandbox_id: ref.sandbox_id,
    session_id: ref.session_id,
    command_id: ref.command_id,
    rpc,
    async listTools() {
      return mapTools(await rpc("tools/list", {}));
    },
    async callTool(name: string, args: Record<string, unknown> = {}) {
      return rpc("tools/call", { name, arguments: args });
    },
    async close() {
      if (closed) return;
      closed = true;
      await input.client.teardown({
        sandbox_id: ref.sandbox_id,
        session_id: ref.session_id,
      });
    },
  };
}
