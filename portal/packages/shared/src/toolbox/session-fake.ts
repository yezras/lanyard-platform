/**
 * In-memory process session (lp-oop.38.19).
 *
 * Records create/attach/exec/input/logs/teardown. No network, no Daytona.
 * JSON-RPC handler optionally answers stdin lines onto stdout.
 */

import {
  parseToolboxProcessSessionCreate,
  parseToolboxProcessSessionExec,
  parseToolboxProcessSessionInput,
  type ToolboxJsonRpcRequest,
  type ToolboxJsonRpcResponse,
  type ToolboxProcessSessionClient,
  type ToolboxProcessSessionCreate,
  type ToolboxProcessSessionExec,
  type ToolboxProcessSessionInput,
  type ToolboxProcessSessionLogs,
  type ToolboxProcessSessionRef,
} from "./session.js";

export type FakeSessionOp =
  | { op: "create"; req: ToolboxProcessSessionCreate }
  | { op: "attach"; req: ToolboxProcessSessionCreate }
  | { op: "exec"; req: ToolboxProcessSessionExec; command_id: string }
  | { op: "input"; req: ToolboxProcessSessionInput }
  | { op: "logs"; session_id: string; command_id: string }
  | { op: "teardown"; req: ToolboxProcessSessionCreate };

export type FakeSessionJsonRpcHandler = (
  req: ToolboxJsonRpcRequest,
) => ToolboxJsonRpcResponse | Promise<ToolboxJsonRpcResponse>;

type CommandState = {
  command_id: string;
  argv: readonly string[];
  cwd: string;
  stdin: string;
  stdout: string;
  stderr: string;
  running: boolean;
};

type SessionState = {
  session_id: string;
  commands: CommandState[];
};

export type FakeToolboxProcessSessionOptions = {
  jsonRpcHandler?: FakeSessionJsonRpcHandler;
};

function copyRef(ref: ToolboxProcessSessionRef): ToolboxProcessSessionRef {
  return {
    sandbox_id: ref.sandbox_id,
    session_id: ref.session_id,
    ...(ref.command_id !== undefined ? { command_id: ref.command_id } : {}),
  };
}

function runningCommand(session: SessionState): CommandState | undefined {
  for (let i = session.commands.length - 1; i >= 0; i -= 1) {
    const command = session.commands[i];
    if (command.running) return command;
  }
  return undefined;
}

function asRequest(data: string): ToolboxJsonRpcRequest | null {
  try {
    const raw = JSON.parse(data) as unknown;
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return null;
    }
    const rec = raw as Record<string, unknown>;
    if (typeof rec.method !== "string") return null;
    if (typeof rec.id !== "number" || !Number.isFinite(rec.id)) return null;
    const req: ToolboxJsonRpcRequest = {
      jsonrpc: "2.0",
      id: rec.id,
      method: rec.method,
    };
    if ("params" in rec) req.params = rec.params;
    return req;
  } catch {
    return null;
  }
}

/**
 * Pure in-memory session port. Tests inspect {@link FakeToolboxProcessSession.ops}.
 */
export class FakeToolboxProcessSession implements ToolboxProcessSessionClient {
  readonly ops: FakeSessionOp[] = [];
  private readonly sessions = new Map<string, SessionState>();
  private nextCommand = 1;
  private jsonRpcHandler: FakeSessionJsonRpcHandler | null;

  constructor(options: FakeToolboxProcessSessionOptions = {}) {
    this.jsonRpcHandler = options.jsonRpcHandler ?? null;
  }

  setJsonRpcHandler(handler: FakeSessionJsonRpcHandler | null): this {
    this.jsonRpcHandler = handler;
    return this;
  }

  reset(): this {
    this.ops.length = 0;
    this.sessions.clear();
    this.nextCommand = 1;
    return this;
  }

  async create(req: ToolboxProcessSessionCreate): Promise<ToolboxProcessSessionRef> {
    const parsed = parseToolboxProcessSessionCreate(req);
    this.ops.push({ op: "create", req: parsed });
    if (!this.sessions.has(parsed.session_id)) {
      this.sessions.set(parsed.session_id, {
        session_id: parsed.session_id,
        commands: [],
      });
    }
    return copyRef(parsed);
  }

  async attach(req: ToolboxProcessSessionCreate): Promise<ToolboxProcessSessionRef> {
    const parsed = parseToolboxProcessSessionCreate(req);
    this.ops.push({ op: "attach", req: parsed });
    let session = this.sessions.get(parsed.session_id);
    if (!session) {
      session = { session_id: parsed.session_id, commands: [] };
      this.sessions.set(parsed.session_id, session);
    }
    const command = runningCommand(session);
    return {
      sandbox_id: parsed.sandbox_id,
      session_id: parsed.session_id,
      ...(command !== undefined ? { command_id: command.command_id } : {}),
    };
  }

  async exec(req: ToolboxProcessSessionExec): Promise<ToolboxProcessSessionRef> {
    const parsed = parseToolboxProcessSessionExec(req);
    let session = this.sessions.get(parsed.session_id);
    if (!session) {
      session = { session_id: parsed.session_id, commands: [] };
      this.sessions.set(parsed.session_id, session);
    }
    const command_id = `cmd-${this.nextCommand}`;
    this.nextCommand += 1;
    session.commands.push({
      command_id,
      argv: parsed.argv,
      cwd: parsed.cwd,
      stdin: "",
      stdout: "",
      stderr: "",
      running: true,
    });
    this.ops.push({ op: "exec", req: parsed, command_id });
    return {
      sandbox_id: parsed.sandbox_id,
      session_id: parsed.session_id,
      command_id,
    };
  }

  async sendInput(req: ToolboxProcessSessionInput): Promise<void> {
    const parsed = parseToolboxProcessSessionInput(req);
    this.ops.push({ op: "input", req: parsed });
    const session = this.sessions.get(parsed.session_id);
    const command = session?.commands.find(
      (row) => row.command_id === parsed.command_id,
    );
    if (!command || !command.running) {
      throw new Error(
        `FakeToolboxProcessSession: no running command ${parsed.command_id}`,
      );
    }
    command.stdin += parsed.data;
    if (this.jsonRpcHandler) {
      const rpc = asRequest(parsed.data.trim());
      if (rpc) {
        const response = await this.jsonRpcHandler(rpc);
        const line = `${JSON.stringify(response)}\n`;
        command.stdout += line;
      }
    }
  }

  async getLogs(ref: {
    sandbox_id: string;
    session_id: string;
    command_id: string;
  }): Promise<ToolboxProcessSessionLogs> {
    this.ops.push({
      op: "logs",
      session_id: ref.session_id,
      command_id: ref.command_id,
    });
    const session = this.sessions.get(ref.session_id.trim());
    const command = session?.commands.find(
      (row) => row.command_id === ref.command_id.trim(),
    );
    if (!command) {
      return { stdout: "", stderr: "" };
    }
    return { stdout: command.stdout, stderr: command.stderr };
  }

  async teardown(req: ToolboxProcessSessionCreate): Promise<void> {
    const parsed = parseToolboxProcessSessionCreate(req);
    this.ops.push({ op: "teardown", req: parsed });
    this.sessions.delete(parsed.session_id);
  }
}

/** Scripted MCP server: initialize / tools/list / tools/call. */
export function fakeVaultMcpJsonRpcHandler(options: {
  toolName: string;
  callResult: unknown;
}): FakeSessionJsonRpcHandler {
  return (req) => {
    if (req.method === "initialize") {
      return { jsonrpc: "2.0", id: req.id, result: { protocolVersion: "2024-11-05" } };
    }
    if (req.method === "tools/list") {
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: {
          tools: [
            {
              name: options.toolName,
              description: "vault mcp fixture",
              inputSchema: { type: "object", properties: {} },
            },
          ],
        },
      };
    }
    if (req.method === "tools/call") {
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: options.callResult,
      };
    }
    return {
      jsonrpc: "2.0",
      id: req.id,
      error: { code: -32601, message: `unknown method ${req.method}` },
    };
  };
}


