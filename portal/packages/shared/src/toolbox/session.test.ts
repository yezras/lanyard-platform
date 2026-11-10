/**
 * lp-oop.38.19 — process-session types, JSON-RPC framing, vault MCP bind.
 * Offline. Fake session only. Never process/execute.
 */
import { describe, expect, it } from "vitest";

import { FakeToolbox } from "./fake.js";
import {
  FakeToolboxProcessSession,
  fakeVaultMcpJsonRpcHandler,
} from "./session-fake.js";
import { bindVaultMcpStdioSession } from "./session-rpc.js";
import {
  assertToolboxProcessSessionPath,
  encodeJsonRpcNotification,
  encodeJsonRpcRequest,
  findJsonRpcResponse,
  isToolboxProcessExecutePath,
  isToolboxProcessSessionClient,
  isToolboxProcessSessionPath,
  nextJsonRpcId,
  parseJsonRpcLine,
  parseToolboxProcessSessionCreate,
  parseToolboxProcessSessionExec,
  parseToolboxProcessSessionInput,
  vaultMcpSessionId,
} from "./session.js";

describe("ToolboxProcessSession types (lp-oop.38.19)", () => {
  it("parses create/exec/input at the boundary", () => {
    expect(
      parseToolboxProcessSessionCreate({
        sandbox_id: " sb-1 ",
        session_id: " lanyard-mcp-vault ",
      }),
    ).toEqual({ sandbox_id: "sb-1", session_id: "lanyard-mcp-vault" });
    expect(
      parseToolboxProcessSessionExec({
        sandbox_id: "sb-1",
        session_id: "lanyard-mcp-vault",
        argv: ["python3", "/mnt/vault/mcp/server.py"],
        cwd: " /mnt/vault ",
      }),
    ).toEqual({
      sandbox_id: "sb-1",
      session_id: "lanyard-mcp-vault",
      argv: ["python3", "/mnt/vault/mcp/server.py"],
      cwd: "/mnt/vault",
    });
    expect(
      parseToolboxProcessSessionInput({
        sandbox_id: "sb-1",
        session_id: "lanyard-mcp-vault",
        command_id: "cmd-1",
        data: '{"jsonrpc":"2.0","id":1,"method":"initialize"}\n',
      }).command_id,
    ).toBe("cmd-1");
  });

  it("rejects empty ids and empty argv", () => {
    expect(() =>
      parseToolboxProcessSessionCreate({ sandbox_id: "", session_id: "s" }),
    ).toThrow(/sandbox_id/);
    expect(() =>
      parseToolboxProcessSessionExec({
        sandbox_id: "sb-1",
        session_id: "s",
        argv: [],
        cwd: "/mnt/vault",
      }),
    ).toThrow(/argv/);
  });

  it("brands vault MCP session ids from server names", () => {
    expect(vaultMcpSessionId("vault_fs")).toBe("lanyard-mcp-vault-fs");
    expect(vaultMcpSessionId("  Filesystem MCP  ")).toBe(
      "lanyard-mcp-filesystem-mcp",
    );
  });

  it("distinguishes session paths from process/execute", () => {
    expect(
      isToolboxProcessExecutePath("/toolbox/sb/process/execute"),
    ).toBe(true);
    expect(
      isToolboxProcessSessionPath("/toolbox/sb/process/session/lanyard-mcp-x"),
    ).toBe(true);
    expect(() =>
      assertToolboxProcessSessionPath("/toolbox/sb/process/execute"),
    ).toThrow(/must not call toolbox process\/execute/);
    expect(() =>
      assertToolboxProcessSessionPath("/toolbox/sb/process/session"),
    ).not.toThrow();
  });
});

describe("JSON-RPC framing", () => {
  it("encodes newline-delimited requests and finds matching responses", () => {
    const line = encodeJsonRpcRequest(2, "tools/call", { name: "read" });
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toMatchObject({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
    });
    const notify = encodeJsonRpcNotification("notifications/initialized", {});
    expect(JSON.parse(notify)).toEqual({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    });
    const stdout = [
      '{"jsonrpc":"2.0","id":1,"result":{"ok":true}}',
      '{"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"hi"}]}}',
      "not-json",
      "",
    ].join("\n");
    expect(findJsonRpcResponse(stdout, 2)?.result).toEqual({
      content: [{ type: "text", text: "hi" }],
    });
    expect(parseJsonRpcLine("garbage")).toBeNull();
    expect(nextJsonRpcId(stdout)).toBe(3);
    expect(nextJsonRpcId("")).toBe(1);
  });
});

describe("bindVaultMcpStdioSession", () => {
  it("create/attach/RPC/teardown never touches ToolboxClient.execute", async () => {
    const execute = new FakeToolbox();
    const session = new FakeToolboxProcessSession({
      jsonRpcHandler: fakeVaultMcpJsonRpcHandler({
        toolName: "vault_read",
        callResult: {
          content: [{ type: "text", text: "from-/mnt/vault" }],
        },
      }),
    });
    expect(isToolboxProcessSessionClient(session)).toBe(true);

    const bound = await bindVaultMcpStdioSession({
      client: session,
      sandbox_id: "sb-vault",
      server_name: "vault_fs",
      argv: ["python3", "/mnt/vault/mcp/server.py"],
      cwd: "/mnt/vault",
      sleep: async () => undefined,
    });

    try {
      const tools = await bound.listTools();
      expect(tools.map((t) => t.name)).toEqual(["vault_read"]);
      const result = await bound.callTool("vault_read", { path: "/mnt/vault/x" });
      expect(result).toEqual({
        content: [{ type: "text", text: "from-/mnt/vault" }],
      });
    } finally {
      await bound.close();
    }

    expect(execute.execCount()).toBe(0);
    expect(session.ops.map((op) => op.op)).toEqual([
      "attach",
      "exec",
      "input",
      "logs",
      "input",
      "input",
      "logs",
      "input",
      "logs",
      "teardown",
    ]);
    const execOp = session.ops.find((op) => op.op === "exec");
    expect(execOp).toMatchObject({
      op: "exec",
      req: {
        sandbox_id: "sb-vault",
        session_id: "lanyard-mcp-vault-fs",
        argv: ["python3", "/mnt/vault/mcp/server.py"],
        cwd: "/mnt/vault",
      },
    });
    expect(
      session.ops.some((op) => JSON.stringify(op).includes("process/execute")),
    ).toBe(false);
  });

  it("reattaches a running command instead of exec again", async () => {
    const session = new FakeToolboxProcessSession({
      jsonRpcHandler: fakeVaultMcpJsonRpcHandler({
        toolName: "ping",
        callResult: { content: [{ type: "text", text: "pong" }] },
      }),
    });
    const first = await bindVaultMcpStdioSession({
      client: session,
      sandbox_id: "sb-vault",
      server_name: "vault_fs",
      argv: ["python3", "server.py"],
      cwd: "/mnt/vault",
      sleep: async () => undefined,
    });
    const commandId = first.command_id;
    const second = await bindVaultMcpStdioSession({
      client: session,
      sandbox_id: "sb-vault",
      server_name: "vault_fs",
      argv: ["python3", "server.py"],
      cwd: "/mnt/vault",
      sleep: async () => undefined,
    });
    expect(second.command_id).toBe(commandId);
    expect(session.ops.filter((op) => op.op === "exec")).toHaveLength(1);
    const tools = await second.listTools();
    expect(tools.map((t) => t.name)).toEqual(["ping"]);
    const pong = await second.callTool("ping", {});
    expect(pong).toEqual({ content: [{ type: "text", text: "pong" }] });
    await first.close();
  });
});
