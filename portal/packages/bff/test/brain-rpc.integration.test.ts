import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  BRAIN_RPC_CONTRACT_VERSION,
  LANYARD_WEB_PLATFORM,
  type BrainRpcRequestFrame,
  type CapabilityDescriptor,
} from "@lanyard/shared";
import { VAULT_LIST_PAGE_LIMIT } from "@lanyard/backend-runtime";

import { ChatDeliveryHub } from "../../relay/src/chat-delivery-hub.js";
import { makeUpgradeToken } from "../../relay/src/auth.js";
import { RelaySessionServerImpl } from "../../relay/src/relay-session-server.js";
import { createRelayServer } from "../../relay/src/server.js";
import { InMemorySecretStore } from "../../relay/src/secret-store.js";
import { createApp as createControlPlaneApp } from "../../control-plane/src/app.js";
import { ControlPlaneStore } from "../../control-plane/src/store.js";
import { createTestStore } from "../../control-plane/test/pg-test-store.js";
import { createApp } from "../src/app.js";
import { ChatThreadStore } from "../src/chat-store.js";
import { ControlPlaneAuthClient } from "../src/control-plane-client.js";
import { RelayClient } from "../src/relay-client.js";
import { SessionStore } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import {
  cookieHeader,
  createTestBindings,
  parseSetCookie,
} from "./test-helpers.js";

const INTERNAL_TOKEN = "bff-brain-rpc-internal-token";
const GATEWAY_ID = "gw-bff-brain-rpc";

type JsonBody = Record<string, unknown>;

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  init: RequestInit & {
    host?: string;
    cookies?: Record<string, string>;
    csrf?: boolean;
  } = {},
): Promise<{
  status: number;
  body: JsonBody;
  cookies: Record<string, string>;
}> {
  const headers = new Headers(init.headers);
  if (init.host) {
    headers.set("host", init.host);
  }
  if (init.cookies && Object.keys(init.cookies).length > 0) {
    headers.set("cookie", cookieHeader(init.cookies));
  }
  if (init.csrf && init.cookies?.lanyard_csrf) {
    headers.set("x-csrf-token", init.cookies.lanyard_csrf);
  }

  const response = await app.request(path, { ...init, headers });
  const body = (await response.json()) as JsonBody;
  const cookies = {
    ...init.cookies,
    ...parseSetCookie(response.headers.get("set-cookie")),
  };

  return { status: response.status, body, cookies };
}

interface MockGatewayClient {
  ws: WebSocket;
  lastBrainRpcRequest: BrainRpcRequestFrame | null;
  waitForDescriptor(): Promise<CapabilityDescriptor>;
  close(): Promise<void>;
}

function hostResultForMethod(
  frame: BrainRpcRequestFrame,
  options: {
    supportProjectsCreate?: boolean;
    supportSettingsPatch?: boolean;
  } = {},
): unknown {
  switch (frame.method) {
    case "brain.health":
      return {
        status: "ok",
        checks: {
          vault_root_readable: true,
          hermes_home_present: true,
          profiles_present: true,
          projects_db_present: false,
        },
        versions: {
          brain_rpc: BRAIN_RPC_CONTRACT_VERSION,
        },
        profile: frame.auth?.subject?.hermes_profile ?? "contributor",
      };
    case "projects.list":
      return {
        projects: [
          {
            id: "p_brain",
            name: "Brain Legal",
            slug: "brain-legal",
            primary_path: "/Projects/Legal",
            folders: [
              {
                path: "/Projects/Legal",
                label: null,
                is_primary: true,
              },
            ],
          },
        ],
        source: "brain_rpc",
      };
    case "projects.create": {
      if (!options.supportProjectsCreate) {
        return null;
      }
      const name =
        typeof frame.params?.name === "string" ? frame.params.name : "Untitled";
      const folders = Array.isArray(frame.params?.folders)
        ? (frame.params.folders as string[])
        : [];
      return {
        id: "p_created",
        name,
        slug: name.toLowerCase().replace(/\s+/g, "-"),
        primary_path: folders[0] ?? null,
        folders: folders.map((path, index) => ({
          path,
          label: null,
          is_primary: index === 0,
        })),
      };
    }
    case "settings.snapshot":
      return {
        exported_at: "2026-07-21T12:00:00.000Z",
        source: "brain_rpc",
        hermes_home: null,
        skills: [
          {
            id: "host-skill",
            name: "Host Skill",
            enabled: true,
          },
        ],
        crons: [],
        mcp_servers: [],
        models: [
          {
            provider: "openai",
            model: "gpt-4o",
            is_active: true,
          },
        ],
        integrations: [
          {
            id: "gws",
            name: "Google Workspace",
            type: "cli",
          },
        ],
      };
    case "settings.patch": {
      if (!options.supportSettingsPatch) {
        return null;
      }
      const op = frame.params?.op;
      if (op === "skill.set_enabled") {
        const skillId =
          typeof frame.params?.skill_id === "string"
            ? frame.params.skill_id
            : "host-skill";
        return {
          op,
          source: "brain_rpc",
          skill: {
            id: skillId,
            name: skillId,
            enabled: Boolean(frame.params?.enabled),
          },
        };
      }
      if (op === "cron.set_enabled") {
        const cronId =
          typeof frame.params?.cron_id === "string"
            ? frame.params.cron_id
            : "nightly";
        return {
          op,
          source: "brain_rpc",
          cron: {
            id: cronId,
            name: cronId,
            schedule: "0 0 * * *",
            enabled: Boolean(frame.params?.enabled),
          },
        };
      }
      if (op === "mcp.set_enabled") {
        const mcpName =
          typeof frame.params?.mcp_name === "string"
            ? frame.params.mcp_name
            : "filesystem";
        return {
          op,
          source: "brain_rpc",
          mcp: {
            name: mcpName,
            enabled: Boolean(frame.params?.enabled),
          },
        };
      }
      if (op === "model.set_active") {
        return {
          op,
          source: "brain_rpc",
          model: {
            provider: String(frame.params?.provider ?? "openai"),
            model: String(frame.params?.model ?? "gpt-4o"),
            is_active: true,
          },
        };
      }
      return { op, source: "brain_rpc" };
    }
    case "brain.capabilities":
      return {
        schema_version: 1,
        source: "brain_rpc",
        kind: "hermes_lanyard",
        contract: { runtime_layout: 1, relay: 1, brain_rpc: 1 },
        profiles: ["contributor"],
        brain_rpc_methods: [
          "brain.ping",
          "brain.health",
          "projects.list",
          ...(options.supportProjectsCreate
            ? (["projects.create"] as const)
            : []),
          "settings.snapshot",
          ...(options.supportSettingsPatch
            ? (["settings.patch"] as const)
            : []),
          "vault.list",
          "vault.stat",
          "vault.read",
        ],
        features: {
          projects_list: true,
          projects_create: Boolean(options.supportProjectsCreate),
          settings_snapshot: true,
          settings_patch: Boolean(options.supportSettingsPatch),
          vault_read: true,
        },
      };
    case "vault.list": {
      const path =
        typeof frame.params?.path === "string" ? frame.params.path : "/";
      const cursor =
        typeof frame.params?.cursor === "string" ? frame.params.cursor : null;
      if (path === "/Projects/Legal" && cursor === "page-2") {
        return {
          path: "/Projects/Legal",
          entries: [
            {
              name: "page-two.md",
              path: "/Projects/Legal/page-two.md",
              kind: "file",
              mime_type: "text/markdown",
              size_bytes: 32,
              mtime: null,
            },
          ],
          truncated: true,
          next_cursor: "page-3",
        };
      }
      if (path === "/Projects/Legal" || path === "/Projects/Legal/") {
        return {
          path: "/Projects/Legal",
          entries: [
            {
              name: "memo.md",
              path: "/Projects/Legal/memo.md",
              kind: "file",
              mime_type: "text/markdown",
              size_bytes: 24,
              mtime: null,
            },
            {
              name: "Briefs",
              path: "/Projects/Legal/Briefs",
              kind: "directory",
              mime_type: null,
              size_bytes: null,
              mtime: null,
            },
          ],
          truncated: false,
          next_cursor: null,
        };
      }
      if (path === "/Projects/Legal/Briefs") {
        return {
          path: "/Projects/Legal/Briefs",
          entries: [
            {
              name: "brief.md",
              path: "/Projects/Legal/Briefs/brief.md",
              kind: "file",
              mime_type: "text/markdown",
              size_bytes: 12,
              mtime: null,
            },
          ],
          truncated: false,
          next_cursor: null,
        };
      }
      if (path === "/" || path === "/Projects") {
        return {
          path,
          entries: [
            {
              name: path === "/" ? "Projects" : "Legal",
              path: path === "/" ? "/Projects" : "/Projects/Legal",
              kind: "directory",
              mime_type: null,
              size_bytes: null,
              mtime: null,
            },
          ],
          truncated: false,
          next_cursor: null,
        };
      }
      return {
        path,
        entries: [],
        truncated: false,
        next_cursor: null,
      };
    }
    case "vault.stat": {
      const path =
        typeof frame.params?.path === "string" ? frame.params.path : "/";
      if (path === "/Projects/Legal") {
        return {
          name: "Legal",
          path: "/Projects/Legal",
          kind: "directory",
          mime_type: null,
          size_bytes: null,
          mtime: null,
        };
      }
      if (path === "/Projects/Legal/memo.md") {
        return {
          name: "memo.md",
          path: "/Projects/Legal/memo.md",
          kind: "file",
          mime_type: "text/markdown",
          size_bytes: 24,
          mtime: null,
        };
      }
      return {
        name: path.split("/").filter(Boolean).at(-1) ?? path,
        path,
        kind: "directory",
        mime_type: null,
        size_bytes: null,
        mtime: null,
      };
    }
    case "vault.read": {
      const path =
        typeof frame.params?.path === "string" ? frame.params.path : "";
      if (path === "/Projects/Legal/memo.md") {
        return {
          path: "/Projects/Legal/memo.md",
          kind: "file",
          mime_type: "text/markdown",
          encoding: "utf-8",
          content: "# Host vault memo\n",
          size_bytes: 18,
        };
      }
      return {
        path,
        kind: "file",
        mime_type: "text/plain",
        encoding: "utf-8",
        content: "",
        size_bytes: 0,
      };
    }
    default:
      // brain.ping and unknown methods
      return {
        pong: true,
        echo: frame.params?.echo,
        instance_id: frame.auth?.instance_id,
        contract_version: BRAIN_RPC_CONTRACT_VERSION,
      };
  }
}

/**
 * Mock Hermes gateway: completes hello/descriptor and auto-answers brain.ping
 * / brain.health / projects.list / settings.snapshot / vault.* with
 * contract-shaped frames.
 */
function createMockGateway(
  port: number,
  relayPath: string,
  token: string,
  options: {
    /** When true, ignore brain_rpc_request (host silent → relay timeout). */
    dropBrainRpc?: boolean;
    /** Override ok/error for host result. */
    hostOk?: boolean;
    hostErrorCode?: string;
    /** Advertise + implement Brain RPC projects.create (lp-bih). */
    supportProjectsCreate?: boolean;
    /** Advertise + implement Brain RPC settings.patch (lp-rt5.4). */
    supportSettingsPatch?: boolean;
  } = {},
): Promise<MockGatewayClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${relayPath}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    let buffer = "";
    const descriptorWaiters: Array<(d: CapabilityDescriptor) => void> = [];
    const client: MockGatewayClient = {
      ws,
      lastBrainRpcRequest: null,
      waitForDescriptor: () =>
        new Promise((res) => {
          descriptorWaiters.push(res);
        }),
      close: () =>
        new Promise((res) => {
          ws.once("close", () => res());
          ws.close();
        }),
    };

    ws.on("error", reject);

    ws.on("open", () => {
      resolve(client);
    });

    ws.on("message", (data) => {
      const chunk = data.toString();
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        const frame = JSON.parse(line);

        if (frame.type === "descriptor") {
          descriptorWaiters.shift()?.(frame.descriptor);
        } else if (frame.type === "brain_rpc_request") {
          client.lastBrainRpcRequest = frame as BrainRpcRequestFrame;
          if (options.dropBrainRpc) {
            continue;
          }

          const hostOk = options.hostOk ?? true;
          const method = (frame as BrainRpcRequestFrame).method;
          const createUnsupported =
            method === "projects.create" && !options.supportProjectsCreate;
          const patchUnsupported =
            method === "settings.patch" && !options.supportSettingsPatch;
          const methodUnsupported = createUnsupported || patchUnsupported;
          const resultFrame =
            hostOk && !methodUnsupported
              ? {
                  type: "brain_rpc_result",
                  contract_version: BRAIN_RPC_CONTRACT_VERSION,
                  request_id: frame.request_id,
                  ok: true,
                  result: hostResultForMethod(frame as BrainRpcRequestFrame, {
                    supportProjectsCreate: options.supportProjectsCreate,
                    supportSettingsPatch: options.supportSettingsPatch,
                  }),
                  error: null,
                  meta: {
                    duration_ms: 1,
                    hermes_profile: frame.auth?.subject?.hermes_profile,
                    host_time: new Date().toISOString(),
                  },
                }
              : {
                  type: "brain_rpc_result",
                  contract_version: BRAIN_RPC_CONTRACT_VERSION,
                  request_id: frame.request_id,
                  ok: false,
                  result: null,
                  error: {
                    code: methodUnsupported
                      ? "method_not_found"
                      : (options.hostErrorCode ?? "unavailable"),
                    message: createUnsupported
                      ? "projects.create is not implemented on this host"
                      : patchUnsupported
                        ? "settings.patch is not implemented on this host"
                        : "host unavailable for test",
                    retryable: !methodUnsupported,
                    details: {},
                  },
                  meta: { duration_ms: 1 },
                };

          ws.send(JSON.stringify(resultFrame) + "\n");
        }
      }
    });
  });
}

describe("bff brain RPC vertical slice (G3.3)", () => {
  let store: ControlPlaneStore;
  let controlPlaneApp: ReturnType<typeof createControlPlaneApp>;
  let relayServer: Awaited<ReturnType<typeof createRelayServer>>;
  let gateway: MockGatewayClient;
  let bffApp: ReturnType<typeof createApp>;
  let chatHub: ChatDeliveryHub;
  let sessions: SessionStore;
  let tenant: TenantContext;
  let instanceId: string;
  let cookies: Record<string, string> = {};
  let provisionedSecret: string;

  async function boot(options: {
    brainRpcEnabled: boolean;
    connectGateway?: boolean;
    dropBrainRpc?: boolean;
    hostOk?: boolean;
    hostErrorCode?: string;
    supportProjectsCreate?: boolean;
    supportSettingsPatch?: boolean;
    /** Portal role for the registered user (default contributor). */
    portalRole?: "admin" | "contributor";
  }) {
    store = await createTestStore();
    controlPlaneApp = createControlPlaneApp(store, { devOpen: true });

    const createdTenant = await store.createTenant({
      slug: "brain",
      display_name: "Brain",
    });
    const provisioned = await store.provisionInstance({
      tenant_id: createdTenant.tenant_id,
    });
    instanceId = provisioned.instance_id;
    provisionedSecret = provisioned.secret;

    const portalRole = options.portalRole ?? "contributor";
    const role = await store.createRole({
      tenant_id: createdTenant.tenant_id,
      name: portalRole,
      hermes_profile: portalRole,
      path_prefixes:
        portalRole === "admin" ? ["/"] : ["/Projects/Legal"],
    });

    tenant = {
      tenant_id: createdTenant.tenant_id,
      tenant_slug: createdTenant.tenant_slug,
      display_name: createdTenant.display_name,
      host: createdTenant.host,
    };

    const secretStore = new InMemorySecretStore();
    chatHub = new ChatDeliveryHub();
    sessions = new SessionStore();
    secretStore.register({
      gatewayId: GATEWAY_ID,
      instanceId,
      secrets: [provisioned.secret],
      tenantId: tenant.tenant_id,
    });

    const sessionServer = new RelaySessionServerImpl({
      secretStore,
      chatHub,
      allowQueryToken: true,
    });

    relayServer = await createRelayServer({
      host: "127.0.0.1",
      port: 0,
      relayPath: "/relay",
      sessionServer,
      chatHub,
      secretStore,
      internalToken: INTERNAL_TOKEN,
    });

    if (options.connectGateway !== false) {
      const token = makeUpgradeToken(GATEWAY_ID, provisioned.secret);
      gateway = await createMockGateway(
        relayServer.port,
        relayServer.relayPath,
        token,
        {
          dropBrainRpc: options.dropBrainRpc,
          hostOk: options.hostOk,
          hostErrorCode: options.hostErrorCode,
          supportProjectsCreate: options.supportProjectsCreate,
          supportSettingsPatch: options.supportSettingsPatch,
        },
      );
      gateway.ws.send(
        JSON.stringify({
          type: "hello",
          platform: LANYARD_WEB_PLATFORM,
          botId: "lanyard-web",
        }) + "\n",
      );
      await gateway.waitForDescriptor();
    }

    const authClient = new ControlPlaneAuthClient(
      "http://control-plane.test",
      (input, init) => {
        const url = new URL(input);
        return controlPlaneApp.request(url.pathname + url.search, init);
      },
    );

    bffApp = createApp(
      createTestBindings(
        { brain: tenant },
        {
          authClient,
          sessions,
          chatThreads: new ChatThreadStore(),
          relayClient: new RelayClient(
            `http://127.0.0.1:${relayServer.port}`,
            INTERNAL_TOKEN,
          ),
          brainRpcEnabled: options.brainRpcEnabled,
        },
      ),
    );

    const csrf = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: tenant.host,
    });
    cookies = csrf.cookies;

    const register = await jsonRequest(bffApp, "/api/auth/register", {
      method: "POST",
      host: tenant.host,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "brain@example.com",
        password: "password123",
      }),
    });
    expect(register.status).toBe(201);
    cookies = register.cookies;

    await store.setUserRoles({
      tenant_id: tenant.tenant_id,
      user_id: register.body.user_id as string,
      role_ids: [role.role_id],
    });
  }

  afterEach(async () => {
    if (gateway?.ws && gateway.ws.readyState === WebSocket.OPEN) {
      await gateway.close();
    }
    if (relayServer) {
      await relayServer.close();
    }
    cookies = {};
  });

  it("exposes brain_rpc_enabled=false on /api/context when flag is off", async () => {
    await boot({ brainRpcEnabled: false, connectGateway: false });
    const ctx = await jsonRequest(bffApp, "/api/context", {
      host: tenant.host,
      cookies,
    });
    expect(ctx.status).toBe(200);
    expect(ctx.body.brain_rpc_enabled).toBe(false);
    expect(ctx.body.chat_delivery).toBe("relay");
    expect(ctx.body.vault_plane).toBe("fs");
    // lp-5q6.29: ui.can.vault_edit fail-closed by default (Office edit gate).
    expect(ctx.body.ui?.can?.vault_edit).toBe(false);
  });

  it("fail-closed: /api/brain/ping returns 503 when BRAIN_RPC_ENABLED is off", async () => {
    await boot({ brainRpcEnabled: false });
    const res = await jsonRequest(bffApp, "/api/brain/ping", {
      host: tenant.host,
      cookies,
    });
    expect(res.status).toBe(503);
    expect(String(res.body.error ?? res.body.message ?? "")).toMatch(
      /The agent is not available for this action/,
    );
  });

  it("fail-closed: /api/brain/ping returns 503 when gateway is not connected", async () => {
    await boot({ brainRpcEnabled: true, connectGateway: false });
    const res = await jsonRequest(bffApp, "/api/brain/ping", {
      host: tenant.host,
      cookies,
    });
    expect(res.status).toBe(503);
  });

  it("invokes brain.ping end-to-end via relay mock gateway", async () => {
    await boot({ brainRpcEnabled: true });

    const res = await jsonRequest(bffApp, "/api/brain/ping?echo=slice", {
      host: tenant.host,
      cookies,
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.method).toBe("brain.ping");
    expect(res.body.instance_id).toBe(instanceId);
    expect((res.body.result as { pong?: boolean }).pong).toBe(true);
    expect((res.body.result as { echo?: string }).echo).toBe("slice");

    // BFF stamped L3 subject from control-plane RBAC (not browser-supplied).
    expect(gateway.lastBrainRpcRequest).not.toBeNull();
    const req = gateway.lastBrainRpcRequest!;
    expect(req.type).toBe("brain_rpc_request");
    expect(req.method).toBe("brain.ping");
    expect(req.auth.tenant_id).toBe(tenant.tenant_id);
    expect(req.auth.instance_id).toBe(instanceId);
    expect(req.auth.subject.hermes_profile).toBe("contributor");
    expect(req.auth.subject.path_prefixes).toEqual(["/Projects/Legal"]);
    expect(req.auth.subject.portal_user_id).toBeTruthy();
  });

  it("invokes brain.health readiness method", async () => {
    await boot({ brainRpcEnabled: true });

    const ctx = await jsonRequest(bffApp, "/api/context", {
      host: tenant.host,
      cookies,
    });
    expect(ctx.body.brain_rpc_enabled).toBe(true);

    const res = await jsonRequest(bffApp, "/api/brain/health", {
      host: tenant.host,
      cookies,
    });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.method).toBe("brain.health");
    expect((res.body.result as { status?: string }).status).toBe("ok");
  });

  it("maps host error codes to HTTP (unavailable → 503)", async () => {
    await boot({
      brainRpcEnabled: true,
      hostOk: false,
      hostErrorCode: "unavailable",
    });

    const res = await jsonRequest(bffApp, "/api/brain/ping", {
      host: tenant.host,
      cookies,
    });
    expect(res.status).toBe(503);
  });

  it("requires authentication", async () => {
    await boot({ brainRpcEnabled: true });
    const res = await jsonRequest(bffApp, "/api/brain/ping", {
      host: tenant.host,
      // no session cookies
    });
    expect(res.status).toBe(401);
    // provisionedSecret kept for future gateway-token edge cases
    expect(provisionedSecret).toBeTruthy();
  });

  it("GET /api/hermes/projects uses Brain RPC projects.list when enabled (lp-t7q.1)", async () => {
    await boot({ brainRpcEnabled: true });

    const res = await jsonRequest(bffApp, "/api/hermes/projects", {
      host: tenant.host,
      cookies,
    });

    expect(res.status).toBe(200);
    const projects = res.body.projects as Array<Record<string, unknown>>;
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      id: "p_brain",
      name: "Brain Legal",
      primary_path: "/Projects/Legal",
    });
    expect(res.body.source).toBe("brain_rpc");

    expect(gateway.lastBrainRpcRequest).not.toBeNull();
    expect(gateway.lastBrainRpcRequest!.method).toBe("projects.list");
    expect(gateway.lastBrainRpcRequest!.auth.subject.hermes_profile).toBe(
      "contributor",
    );
  });

  it("POST /api/chat/threads resolves project via Brain RPC and pins primary_path (lp-b8x)", async () => {
    await boot({ brainRpcEnabled: true });

    const res = await jsonRequest(bffApp, "/api/chat/threads", {
      method: "POST",
      host: tenant.host,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project_id: "p_brain" }),
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      project_id: "p_brain",
      title: "Brain Legal",
      project_vault_path: "/Projects/Legal",
    });
    expect(gateway.lastBrainRpcRequest).not.toBeNull();
    expect(gateway.lastBrainRpcRequest!.method).toBe("projects.list");
  });

  it("POST /api/chat/threads returns 404 for unknown Brain RPC project_id (lp-b8x)", async () => {
    await boot({ brainRpcEnabled: true });

    const res = await jsonRequest(bffApp, "/api/chat/threads", {
      method: "POST",
      host: tenant.host,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project_id: "p_missing" }),
    });

    expect(res.status).toBe(404);
  });

  it("POST /api/hermes/projects creates via Brain RPC when host advertises create (lp-bih)", async () => {
    await boot({ brainRpcEnabled: true, supportProjectsCreate: true });

    const res = await jsonRequest(bffApp, "/api/hermes/projects", {
      method: "POST",
      host: tenant.host,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Test",
        folders: ["/home/portal/Test"],
      }),
    });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      id: "p_created",
      name: "Test",
      primary_path: "/home/portal/Test",
    });
    expect(String(res.body.error ?? "")).not.toMatch(/hermes CLI not found/i);
    expect(gateway.lastBrainRpcRequest).not.toBeNull();
    expect(gateway.lastBrainRpcRequest!.method).toBe("projects.create");
    expect(gateway.lastBrainRpcRequest!.params).toMatchObject({
      name: "Test",
      folders: ["/home/portal/Test"],
    });
  });

  it("POST /api/hermes/projects fails closed without CLI install hint when create not advertised (lp-bih)", async () => {
    // Default mock host: projects.list only (matches current hermes Brain RPC).
    await boot({ brainRpcEnabled: true, supportProjectsCreate: false });

    const res = await jsonRequest(bffApp, "/api/hermes/projects", {
      method: "POST",
      host: tenant.host,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Test",
        folders: ["/home/portal/Test"],
      }),
    });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("method_not_found");
    const blob = JSON.stringify(res.body);
    expect(blob).not.toMatch(/hermes CLI not found/i);
    expect(blob).not.toMatch(/Install Hermes or run/i);
    expect(blob).toMatch(/projects\.create/i);
  });

  it("GET /api/settings/snapshot uses Brain RPC settings.snapshot when enabled (lp-t7q.1)", async () => {
    await boot({ brainRpcEnabled: true });

    const res = await jsonRequest(bffApp, "/api/settings/snapshot", {
      host: tenant.host,
      cookies,
    });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("brain_rpc");
    expect(res.body.exported_at).toBe("2026-07-21T12:00:00.000Z");
    const skills = res.body.skills as Array<Record<string, unknown>>;
    expect(skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "host-skill", enabled: true }),
      ]),
    );
    expect(JSON.stringify(res.body)).not.toContain("api_key");

    expect(gateway.lastBrainRpcRequest).not.toBeNull();
    expect(gateway.lastBrainRpcRequest!.method).toBe("settings.snapshot");
  });

  it("PATCH /api/settings/skills uses Brain RPC settings.patch when enabled (lp-rt5.4)", async () => {
    // settings.manage requires admin (or explicit settings role) before Brain RPC.
    await boot({
      brainRpcEnabled: true,
      supportSettingsPatch: true,
      portalRole: "admin",
    });

    const res = await jsonRequest(
      bffApp,
      "/api/settings/skills/host-skill",
      {
        method: "PATCH",
        host: tenant.host,
        cookies,
        csrf: true,
        body: JSON.stringify({ enabled: false }),
      },
    );

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("brain_rpc");
    expect(res.body.skill).toEqual(
      expect.objectContaining({ id: "host-skill", enabled: false }),
    );
    expect(gateway.lastBrainRpcRequest).not.toBeNull();
    expect(gateway.lastBrainRpcRequest!.method).toBe("settings.patch");
    expect(gateway.lastBrainRpcRequest!.params).toEqual(
      expect.objectContaining({
        op: "skill.set_enabled",
        skill_id: "host-skill",
        enabled: false,
      }),
    );
  });

  it("PATCH /api/settings/skills is 403 for contributor before Brain RPC (lp-p37.7)", async () => {
    await boot({
      brainRpcEnabled: true,
      supportSettingsPatch: true,
      portalRole: "contributor",
    });

    const res = await jsonRequest(
      bffApp,
      "/api/settings/skills/host-skill",
      {
        method: "PATCH",
        host: tenant.host,
        cookies,
        csrf: true,
        body: JSON.stringify({ enabled: false }),
      },
    );

    expect(res.status).toBe(403);
    // Must not have delegated to host when portal authz denied.
    expect(gateway.lastBrainRpcRequest?.method).not.toBe("settings.patch");
  });

  it("PATCH /api/settings/skills fails closed when settings.patch not advertised (lp-rt5.4)", async () => {
    // Admin so we pass portal settings.manage and exercise the host capability gate.
    await boot({
      brainRpcEnabled: true,
      supportSettingsPatch: false,
      portalRole: "admin",
    });

    const res = await jsonRequest(
      bffApp,
      "/api/settings/skills/host-skill",
      {
        method: "PATCH",
        host: tenant.host,
        cookies,
        csrf: true,
        body: JSON.stringify({ enabled: false }),
      },
    );

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.code === "method_not_found" || res.body.unavailable).toBeTruthy();
    expect(JSON.stringify(res.body)).toMatch(/settings\.patch|not advertised|not implemented/i);
  });

  it("GET /api/context includes backend_capabilities when Brain RPC is on (lp-rt5.4)", async () => {
    await boot({ brainRpcEnabled: true, supportSettingsPatch: true });

    const res = await jsonRequest(bffApp, "/api/context", {
      host: tenant.host,
      cookies,
    });

    expect(res.status).toBe(200);
    expect(res.body.brain_rpc_enabled).toBe(true);
    expect(res.body.chat_delivery).toBe("relay");
    expect(res.body.vault_plane).toBe("brain_rpc");
    expect(res.body.backend_capabilities).toBeTruthy();
    expect(res.body.backend_capabilities.features?.settings_snapshot).toBe(true);
    expect(res.body.ui?.can?.settings_view).toBe(true);
    // Office vault_edit gate still present (fail-closed merge).
    expect(typeof res.body.ui?.can?.vault_edit).toBe("boolean");
  });

  it("projects list fails closed (no fixture fallback) when host is unavailable", async () => {
    await boot({
      brainRpcEnabled: true,
      hostOk: false,
      hostErrorCode: "unavailable",
    });

    const res = await jsonRequest(bffApp, "/api/hermes/projects", {
      host: tenant.host,
      cookies,
    });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("unavailable");
  });

  it("GET /api/vault/tree uses Brain RPC vault.list/stat when enabled (lp-t7q.2)", async () => {
    await boot({ brainRpcEnabled: true });

    const res = await jsonRequest(bffApp, "/api/vault/tree", {
      host: tenant.host,
      cookies,
    });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe("brain_rpc");
    const roots = res.body.roots as Array<{ path: string; kind: string }>;
    expect(roots.length).toBeGreaterThanOrEqual(1);
    expect(roots[0]?.path).toBe("/Projects/Legal");
    // Must not return fixture Team A / Team B sample tree.
    const blob = JSON.stringify(res.body);
    expect(blob).not.toContain("/Projects/A");
    expect(blob).not.toContain("Team A");
  });

  it("GET /api/vault/entries + content use Brain RPC vault.list/read (lp-t7q.2)", async () => {
    await boot({ brainRpcEnabled: true });

    const listing = await jsonRequest(
      bffApp,
      "/api/vault/entries?path=/Projects/Legal",
      { host: tenant.host, cookies },
    );
    expect(listing.status).toBe(200);
    expect(listing.body.source).toBe("brain_rpc");
    const entries = listing.body.entries as Array<{ path: string }>;
    expect(entries.map((e) => e.path)).toContain("/Projects/Legal/memo.md");

    expect(gateway.lastBrainRpcRequest).not.toBeNull();
    expect(gateway.lastBrainRpcRequest!.method).toBe("vault.list");
    expect(gateway.lastBrainRpcRequest!.params).toMatchObject({
      path: "/Projects/Legal",
      limit: VAULT_LIST_PAGE_LIMIT,
    });
    expect(gateway.lastBrainRpcRequest!.auth.subject.path_prefixes).toEqual([
      "/Projects/Legal",
    ]);

    const content = await jsonRequest(
      bffApp,
      "/api/vault/content?path=/Projects/Legal/memo.md",
      { host: tenant.host, cookies },
    );
    expect(content.status).toBe(200);
    expect(content.body.source).toBe("brain_rpc");
    expect(String(content.body.content)).toContain("Host vault memo");
    // Fixture-only sample content must not leak when RPC is on.
    expect(String(content.body.content)).not.toContain("vault browser (#12)");

    expect(gateway.lastBrainRpcRequest).not.toBeNull();
    expect(gateway.lastBrainRpcRequest!.method).toBe("vault.read");
    expect(gateway.lastBrainRpcRequest!.auth.subject.path_prefixes).toEqual([
      "/Projects/Legal",
    ]);
  });

  it("GET /api/vault/entries forwards cursor through Brain RPC vault.list", async () => {
    await boot({ brainRpcEnabled: true });

    const listing = await jsonRequest(
      bffApp,
      "/api/vault/entries?path=/Projects/Legal&cursor=page-2",
      { host: tenant.host, cookies },
    );

    expect(listing.status).toBe(200);
    expect(listing.body.source).toBe("brain_rpc");
    expect(listing.body.truncated).toBe(true);
    expect(listing.body.next_cursor).toBe("page-3");
    const entries = listing.body.entries as Array<{ path: string }>;
    expect(entries.map((e) => e.path)).toEqual([
      "/Projects/Legal/page-two.md",
    ]);
    expect(gateway.lastBrainRpcRequest).not.toBeNull();
    expect(gateway.lastBrainRpcRequest!.method).toBe("vault.list");
    expect(gateway.lastBrainRpcRequest!.params).toMatchObject({
      path: "/Projects/Legal",
      cursor: "page-2",
      limit: VAULT_LIST_PAGE_LIMIT,
    });
    expect(gateway.lastBrainRpcRequest!.auth.subject.path_prefixes).toEqual([
      "/Projects/Legal",
    ]);
  });

  it("vault content fails closed (no fixture) when host is unavailable", async () => {
    await boot({
      brainRpcEnabled: true,
      hostOk: false,
      hostErrorCode: "unavailable",
    });

    const listing = await jsonRequest(
      bffApp,
      "/api/vault/entries?path=/Projects/Legal&cursor=page-2",
      { host: tenant.host, cookies },
    );
    expect(listing.status).toBe(503);
    expect(listing.body.code).toBe("unavailable");
    expect(JSON.stringify(listing.body)).not.toContain("/Projects/A");

    const content = await jsonRequest(
      bffApp,
      "/api/vault/content?path=/Projects/Legal/memo.md",
      { host: tenant.host, cookies },
    );
    expect(content.status).toBe(503);
    expect(content.body.code).toBe("unavailable");
    expect(String(content.body.content ?? "")).not.toContain("Team A");

    const tree = await jsonRequest(bffApp, "/api/vault/tree", {
      host: tenant.host,
      cookies,
    });
    // Soft-empty fail-closed: empty roots, not fixture sample tree.
    expect(tree.status).toBe(200);
    expect(tree.body.source).toBe("brain_rpc");
    expect(tree.body.roots).toEqual([]);
    expect(tree.body.unavailable).toBe(true);
    expect(JSON.stringify(tree.body)).not.toContain("/Projects/A");
  });

  it("vault browser uses fixture/local provider when BRAIN_RPC_ENABLED is off", async () => {
    await boot({ brainRpcEnabled: false, connectGateway: false });

    // Re-bind role prefixes to fixture ACL for Team A path.
    // Contributor on this tenant has /Projects/Legal — fixture has no such path
    // so tree roots may be empty placeholder. Register with path that fixtures have:
    // boot already created contributor with /Projects/Legal. Fixture ACL roots
    // for that prefix yield empty/placeholder root (no full fixture tree under Legal).
    const tree = await jsonRequest(bffApp, "/api/vault/tree", {
      host: tenant.host,
      cookies,
    });
    expect(tree.status).toBe(200);
    // Flag off → not brain_rpc source (fixture/local path has no source field).
    expect(tree.body.source).not.toBe("brain_rpc");
  });
});
