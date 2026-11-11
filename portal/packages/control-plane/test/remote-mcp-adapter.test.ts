/**
 * lp-hdzm.26 — remote MCP streamable-http adapter against fixture servers.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  applyClassCHarnessHttp,
  buildClassCHttpAttach,
  CLASS_C_AUTHORIZATION_HEADER,
  type ClassCHttpRequest,
} from "../src/class-c-attach.js";
import { createInMemoryGuestConnectorStore } from "../src/connector-user-sandbox.js";
import type { ConnectorId } from "../src/connectors.js";
import {
  connectRemoteMcp,
  InvalidRemoteMcpToolNameError,
  isSseOnlyRemoteMcpTransport,
  namespaceRemoteMcpTool,
  REMOTE_MCP_OAUTH_NOT_IMPLEMENTED,
  REMOTE_MCP_TRANSPORT,
  unnamespaceRemoteMcpTool,
} from "../src/remote-mcp-adapter.js";
import type { ClassCSecretPayload } from "../src/class-c-secrets.js";
import {
  FIXTURE_ACCOUNT_ID,
  FIXTURE_TOKEN,
  FIXTURE_TOOL_NAME,
  startRemoteMcpFixture,
  type RemoteMcpFixtureServer,
} from "./remote-mcp-fixture.js";

const CONNECTOR_ID = "stripe" as ConnectorId;
const NAMESPACED = namespaceRemoteMcpTool(CONNECTOR_ID, FIXTURE_TOOL_NAME);

const payload: ClassCSecretPayload = {
  auth_kind: "bearer",
  value: FIXTURE_TOKEN,
};

function attach() {
  return buildClassCHttpAttach({
    tenant_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
    connector_id: CONNECTOR_ID,
    surface_id: "mcp",
    payload,
  });
}

const fixtures: RemoteMcpFixtureServer[] = [];

afterEach(async () => {
  while (fixtures.length > 0) {
    const server = fixtures.pop();
    await server?.close();
  }
});

async function boot(
  mode: RemoteMcpFixtureServer["mode"],
): Promise<RemoteMcpFixtureServer> {
  const server = await startRemoteMcpFixture(mode);
  fixtures.push(server);
  return server;
}

describe("remote MCP transport", () => {
  it("treats sse / sse-only / http+sse as SSE-only", () => {
    expect(isSseOnlyRemoteMcpTransport("sse")).toBe(true);
    expect(isSseOnlyRemoteMcpTransport("SSE-only")).toBe(true);
    expect(isSseOnlyRemoteMcpTransport("http+sse")).toBe(true);
    expect(isSseOnlyRemoteMcpTransport(REMOTE_MCP_TRANSPORT)).toBe(false);
  });

  it("namespaces tools as connectorId.toolName", () => {
    expect(NAMESPACED).toBe("stripe.get_account_info");
    expect(unnamespaceRemoteMcpTool(CONNECTOR_ID, NAMESPACED)).toBe(
      FIXTURE_TOOL_NAME,
    );
    expect(() => unnamespaceRemoteMcpTool(CONNECTOR_ID, FIXTURE_TOOL_NAME)).toThrow(
      InvalidRemoteMcpToolNameError,
    );
  });
});

describe("connectRemoteMcp streamable-http fixture", () => {
  it("lists namespaced tools and calls through Class C Authorization", async () => {
    const server = await boot("streamable-http");
    const seen: ClassCHttpRequest[] = [];
    const guest = createInMemoryGuestConnectorStore();
    const result = await connectRemoteMcp({
      connector_id: CONNECTOR_ID,
      surface: {
        kind: "mcp",
        initialize_url: server.url,
        transport: REMOTE_MCP_TRANSPORT,
        runnability: "runnable",
      },
      attach: attach(),
      guest,
      sandbox_id: "sbx-remote-mcp",
      fetch: async (req) => {
        seen.push(req);
        const res = await fetch(req.url, {
          method: req.method ?? "POST",
          headers: req.headers,
          body: req.body,
        });
        const headers: Record<string, string> = {};
        res.headers.forEach((value, key) => {
          headers[key] = value;
        });
        return { status: res.status, headers, body: await res.text() };
      },
    });
    expect(result.status).toBe("connected");
    if (result.status !== "connected") {
      return;
    }
    expect(result.session.tools).toEqual([
      expect.objectContaining({
        connector_id: CONNECTOR_ID,
        tool_name: FIXTURE_TOOL_NAME,
        namespaced_name: NAMESPACED,
      }),
    ]);
    expect(result.session.tree).toEqual({
      [CONNECTOR_ID]: {
        [FIXTURE_TOOL_NAME]: expect.objectContaining({
          namespaced_name: NAMESPACED,
        }),
      },
    });
    const schema = result.session.tools[0]?.input_schema as {
      properties?: Record<string, unknown>;
    };
    expect(schema.properties).toEqual({ limit: { type: "integer" } });
    expect(JSON.stringify(result.session.tools)).not.toMatch(/api_key/i);

    const called = await result.session.call(NAMESPACED, { limit: 1 });
    expect(JSON.stringify(called)).toContain(FIXTURE_ACCOUNT_ID);

    expect(seen.length).toBeGreaterThan(0);
    for (const req of seen.filter((row) => row.method !== "DELETE")) {
      expect(req.headers?.[CLASS_C_AUTHORIZATION_HEADER]).toBe(
        `Bearer ${FIXTURE_TOKEN}`,
      );
    }
    expect(server.posts.some((row) => row.method === "initialize")).toBe(true);
    expect(server.posts.some((row) => row.method === "tools/list")).toBe(true);
    expect(server.posts.some((row) => row.method === "tools/call")).toBe(true);
    expect(guest.listFiles("sbx-remote-mcp")).toEqual([]);
    expect(guest.printenv("sbx-remote-mcp")).toEqual({});
    await result.session.close();
  });

  it("refuses SSE-only without touching the network", async () => {
    let fetched = 0;
    const result = await connectRemoteMcp({
      connector_id: CONNECTOR_ID,
      surface: {
        kind: "mcp",
        initialize_url: "http://127.0.0.1:1/sse",
        transport: "sse",
      },
      fetch: async () => {
        fetched += 1;
        throw new Error("SSE-only must not fetch");
      },
    });
    expect(result).toEqual({ status: "refused", reason: "sse_only" });
    expect(fetched).toBe(0);

    const sseOnly = await connectRemoteMcp({
      connector_id: CONNECTOR_ID,
      surface: {
        kind: "mcp",
        initialize_url: "http://127.0.0.1:1/sse",
        transport: "sse-only",
      },
      fetch: async () => {
        fetched += 1;
        throw new Error("SSE-only must not fetch");
      },
    });
    expect(sseOnly).toEqual({ status: "refused", reason: "sse_only" });
    expect(fetched).toBe(0);
  });

  it("does not treat an SSE-only fixture as streamable-http", async () => {
    const server = await boot("sse-only");
    const result = await connectRemoteMcp({
      connector_id: CONNECTOR_ID,
      surface: {
        kind: "mcp",
        initialize_url: server.url,
        transport: REMOTE_MCP_TRANSPORT,
      },
      attach: attach(),
    });
    expect(result.status).toBe("failed");
  });

  it("fail-closes MCP OAuth needs_auth without listing tools", async () => {
    const server = await boot("oauth");
    const result = await connectRemoteMcp({
      connector_id: CONNECTOR_ID,
      surface: {
        kind: "mcp",
        initialize_url: server.url,
        transport: REMOTE_MCP_TRANSPORT,
      },
      attach: attach(),
    });
    expect(result).toEqual({
      status: "needs_auth",
      reason: REMOTE_MCP_OAUTH_NOT_IMPLEMENTED,
    });
  });

  it("fail-closes when Class C is absent and the fixture requires auth", async () => {
    const server = await boot("streamable-http");
    const result = await connectRemoteMcp({
      connector_id: CONNECTOR_ID,
      surface: {
        kind: "mcp",
        initialize_url: server.url,
        transport: REMOTE_MCP_TRANSPORT,
      },
    });
    expect(result.status).toBe("needs_auth");
    if (result.status === "needs_auth") {
      expect(result.reason).toBe(REMOTE_MCP_OAUTH_NOT_IMPLEMENTED);
    }
  });
});

describe("Class C attach on fixture HTTP", () => {
  it("puts Authorization on the client and keeps it off the guest", async () => {
    const server = await boot("streamable-http");
    const guest = createInMemoryGuestConnectorStore();
    const seen: ClassCHttpRequest[] = [];
    const result = await applyClassCHarnessHttp({
      attach: attach(),
      request: {
        url: server.url,
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "probe", version: "1" },
          },
        }),
      },
      fetch: async (req) => {
        seen.push(req);
        const res = await fetch(req.url, {
          method: req.method ?? "POST",
          headers: req.headers,
          body: req.body,
        });
        return {
          status: res.status,
          headers: { "content-type": res.headers.get("content-type") ?? "" },
          body: await res.text(),
        };
      },
      guest,
      sandbox_id: "sbx-class-c-mcp",
    });
    expect(result.response.status).toBe(200);
    expect(seen[0]?.headers?.[CLASS_C_AUTHORIZATION_HEADER]).toBe(
      `Bearer ${FIXTURE_TOKEN}`,
    );
    expect(guest.listFiles("sbx-class-c-mcp")).toEqual([]);
  });
});
