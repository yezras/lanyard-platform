/**
 * lp-oop.38.19 — Daytona process-session HTTP client.
 * Offline: injectable fake fetch only. No live network.
 */
import { describe, expect, it } from "vitest";

import {
  bindVaultMcpStdioSession,
  isToolboxProcessExecutePath,
  isToolboxProcessSessionClient,
  vaultMcpSessionId,
} from "@lanyard/shared";

import { type DaytonaConfig } from "../src/daytona-config.js";
import {
  DAYTONA_AUTH_HEADER,
  DAYTONA_ORG_HEADER,
} from "../src/daytona-sdk-client.js";
import { DEFAULT_DAYTONA_TOOLBOX_BASE_URL } from "../src/daytona-toolbox-client.js";
import {
  createDaytonaToolboxSessionClient,
  type DaytonaToolboxSessionLogEvent,
} from "../src/daytona-toolbox-session-client.js";

const THROW_AWAY_API_KEY = "test-throwaway-daytona-api-key-not-for-prod";

function readyConfig(overrides: Partial<DaytonaConfig> = {}): DaytonaConfig {
  return {
    enabled: true,
    apiKey: THROW_AWAY_API_KEY,
    orgId: "org-test-oop38-19",
    region: "us",
    defaultSnapshotId: "offline:agent-default",
    tenantAllowlist: ["tenant-a"],
    domainAllowList: [],
    autoStopIntervalMinutes: 90,
    warmPoolEnabled: false,
    warmPoolTenantAllowlist: [],
    warmPoolSize: 2,
    archiveRestoreOnWake: false,
    retainSandboxOnStop: true,
    ...overrides,
  };
}

type FakeRoute = {
  method: string;
  path: string | RegExp;
  status?: number;
  body?: unknown;
  onRequest?: (req: {
    method: string;
    url: string;
    path: string;
    headers: Headers;
    bodyText: string | null;
  }) => void;
};

function createFakeFetch(routes: FakeRoute[]): {
  fetch: typeof fetch;
  paths: string[];
} {
  const paths: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const bodyText =
      typeof init?.body === "string"
        ? init.body
        : init?.body == null
          ? null
          : String(init.body);
    const path = new URL(url).pathname;
    paths.push(`${method} ${path}`);

    for (const route of routes) {
      if (route.method.toUpperCase() !== method) continue;
      const match =
        typeof route.path === "string"
          ? path === route.path
          : route.path.test(path);
      if (!match) continue;
      route.onRequest?.({ method, url, path, headers, bodyText });
      return new Response(
        route.body === undefined ? "" : JSON.stringify(route.body),
        {
          status: route.status ?? 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
    return new Response(
      JSON.stringify({ message: `no route for ${method} ${path}` }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  };
  return { fetch: fetchImpl, paths };
}

describe("DaytonaToolboxSessionClient (lp-oop.38.19)", () => {
  it("implements the session port and never calls process/execute", async () => {
    const live = createLiveSessionFetch();
    const logs: DaytonaToolboxSessionLogEvent[] = [];
    const client = createDaytonaToolboxSessionClient({
      config: readyConfig(),
      fetch: live.fetch,
      logSafe: (event) => logs.push(event),
    });
    expect(isToolboxProcessSessionClient(client)).toBe(true);
    expect(client.toolboxUrl).toBe(DEFAULT_DAYTONA_TOOLBOX_BASE_URL);

    const bound = await bindVaultMcpStdioSession({
      client,
      sandbox_id: "sb-1",
      server_name: "vault_fs",
      argv: ["python3", "/mnt/vault/mcp/server.py"],
      cwd: "/mnt/vault",
      sleep: async () => undefined,
    });
    const tools = await bound.listTools();
    expect(tools.map((t) => t.name)).toEqual(["vault_read"]);
    const result = await bound.callTool("vault_read", {});
    expect(result).toEqual({
      content: [{ type: "text", text: "vault-ok" }],
    });
    await bound.close();

    expect(live.paths.some((p) => isToolboxProcessExecutePath(p))).toBe(false);
    expect(live.paths.every((p) => p.includes("/process/session"))).toBe(true);
    expect(live.headers.get(DAYTONA_AUTH_HEADER)).toBe(
      `Bearer ${THROW_AWAY_API_KEY}`,
    );
    expect(live.headers.get(DAYTONA_ORG_HEADER)).toBe("org-test-oop38-19");
    expect(JSON.stringify(logs)).not.toMatch(/python3/);
    expect(JSON.stringify(logs)).not.toMatch(/vault-ok/);
    expect(JSON.stringify(logs)).not.toMatch(THROW_AWAY_API_KEY);
    expect(live.paths.some((p) => p.includes("/process/session"))).toBe(true);
  });

  it("attach reuses a running command_id", async () => {
    const sessionId = vaultMcpSessionId("vault_fs");
    const { fetch, paths } = createFakeFetch([
      {
        method: "GET",
        path: `/toolbox/sb-1/process/session/${sessionId}`,
        body: {
          sessionId,
          commands: [{ id: "cmd-live", command: "python3", exitCode: null }],
        },
      },
    ]);
    const client = createDaytonaToolboxSessionClient({
      config: readyConfig(),
      fetch,
    });
    const ref = await client.attach({
      sandbox_id: "sb-1",
      session_id: sessionId,
    });
    expect(ref.command_id).toBe("cmd-live");
    expect(paths.some((p) => p.startsWith("POST"))).toBe(false);
    expect(paths.some((p) => p.includes("/process/execute"))).toBe(false);
  });
});

function createLiveSessionFetch(): {
  fetch: typeof fetch;
  paths: string[];
  headers: Headers;
} {
  const sessionId = vaultMcpSessionId("vault_fs");
  let stdout = "";
  const paths: string[] = [];
  const headers = new Headers();
  const fetchImpl: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const path = new URL(url).pathname;
    paths.push(`${method} ${path}`);
    const next = new Headers(init?.headers);
    next.forEach((value, key) => {
      headers.set(key, value);
    });
    const bodyText =
      typeof init?.body === "string" ? init.body : init?.body == null ? null : String(init.body);

    if (method === "GET" && path === `/toolbox/sb-1/process/session/${sessionId}`) {
      return json(404, { message: "not found" });
    }
    if (method === "POST" && path === "/toolbox/sb-1/process/session") {
      return json(201, { sessionId });
    }
    if (method === "POST" && path === `/toolbox/sb-1/process/session/${sessionId}/exec`) {
      const body = JSON.parse(bodyText ?? "{}") as { runAsync?: boolean };
      expect(body.runAsync).toBe(true);
      return json(200, { cmdId: "cmd-9" });
    }
    if (
      method === "POST" &&
      path === `/toolbox/sb-1/process/session/${sessionId}/command/cmd-9/input`
    ) {
      const body = JSON.parse(bodyText ?? "{}") as { data?: string };
      const frame = JSON.parse(String(body.data ?? "{}")) as {
        id?: number;
        method?: string;
      };
      if (frame.method === "initialize") {
        stdout += `{"jsonrpc":"2.0","id":${frame.id},"result":{}}\n`;
      } else if (frame.method === "tools/list") {
        stdout += `{"jsonrpc":"2.0","id":${frame.id},"result":{"tools":[{"name":"vault_read","inputSchema":{"type":"object"}}]}}\n`;
      } else if (frame.method === "tools/call") {
        stdout += `{"jsonrpc":"2.0","id":${frame.id},"result":{"content":[{"type":"text","text":"vault-ok"}]}}\n`;
      }
      return json(200, {});
    }
    if (
      method === "GET" &&
      path === `/toolbox/sb-1/process/session/${sessionId}/command/cmd-9/logs`
    ) {
      return json(200, { stdout, stderr: "" });
    }
    if (method === "DELETE" && path === `/toolbox/sb-1/process/session/${sessionId}`) {
      return json(200, {});
    }
    return json(404, { message: `no route for ${method} ${path}` });
  };
  return { fetch: fetchImpl, paths, headers };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
