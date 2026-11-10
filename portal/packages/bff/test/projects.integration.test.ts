import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  LANYARD_WEB_PLATFORM,
  type CapabilityDescriptor,
  type InboundFrame,
  type OutboundResultFrame,
} from "@lanyard/shared";

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
import { FakeCognitoPasswordAuth } from "../src/cognito-fake.js";
import { ControlPlaneAuthClient } from "../src/control-plane-client.js";
import { RelayClient } from "../src/relay-client.js";
import { SessionStore } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import { cookieHeader, createTestBindings, parseSetCookie } from "./test-helpers.js";

const INTERNAL_TOKEN = "bff-projects-internal-token";
const GATEWAY_ID = "gw-bff-projects";
const VAULT_PATH = "/Projects/A";

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
  waitForDescriptor(): Promise<CapabilityDescriptor>;
  waitForInbound(): Promise<InboundFrame>;
  close(): Promise<void>;
}

function createMockGateway(
  port: number,
  relayPath: string,
  token: string,
): Promise<MockGatewayClient> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${relayPath}`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    let buffer = "";
    const descriptorWaiters: Array<(d: CapabilityDescriptor) => void> = [];
    const inboundWaiters: Array<(f: InboundFrame) => void> = [];

    ws.on("error", reject);

    ws.on("open", () => {
      resolve({
        ws,
        waitForDescriptor: () =>
          new Promise((res) => {
            descriptorWaiters.push(res);
          }),
        waitForInbound: () =>
          new Promise((res) => {
            inboundWaiters.push(res);
          }),
        close: () =>
          new Promise((res) => {
            ws.once("close", () => res());
            ws.close();
          }),
      });
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
        } else if (frame.type === "inbound") {
          inboundWaiters.shift()?.(frame as InboundFrame);
        }
      }
    });
  });
}

describe("bff projects integration", () => {
  let store: ControlPlaneStore;
  let controlPlaneApp: ReturnType<typeof createControlPlaneApp>;
  let relayServer: Awaited<ReturnType<typeof createRelayServer>>;
  let gateway: MockGatewayClient;
  let bffApp: ReturnType<typeof createApp>;
  let tenant: TenantContext;
  let cookies: Record<string, string> = {};
  let cognito: FakeCognitoPasswordAuth;

  beforeEach(async () => {
    store = await createTestStore();
    controlPlaneApp = createControlPlaneApp(store, { devOpen: true });

    const createdTenant = await store.createTenant({
      slug: "demo",
      display_name: "Demo",
    });
    const provisioned = await store.provisionInstance({
      tenant_id: createdTenant.tenant_id,
    });

    tenant = {
      tenant_id: createdTenant.tenant_id,
      tenant_slug: createdTenant.tenant_slug,
      display_name: createdTenant.display_name,
      host: createdTenant.host,
    };

    const secretStore = new InMemorySecretStore();
    const chatHub = new ChatDeliveryHub();
    secretStore.register({
      gatewayId: GATEWAY_ID,
      instanceId: provisioned.instance_id,
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

    const token = makeUpgradeToken(GATEWAY_ID, provisioned.secret);
    gateway = await createMockGateway(
      relayServer.port,
      relayServer.relayPath,
      token,
    );
    gateway.ws.send(
      JSON.stringify({
        type: "hello",
        platform: LANYARD_WEB_PLATFORM,
        botId: "lanyard-web",
      }) + "\n",
    );
    await gateway.waitForDescriptor();

    const authClient = new ControlPlaneAuthClient(
      "http://control-plane.test",
      (input, init) => {
        const url = new URL(input);
        return controlPlaneApp.request(url.pathname + url.search, init);
      },
    );

    // One FakeCognito across rebuilt apps so re-login after a fresh SessionStore works.
    cognito = new FakeCognitoPasswordAuth();

    bffApp = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          authClient,
          cognito,
          relayClient: new RelayClient(
            `http://127.0.0.1:${relayServer.port}`,
            INTERNAL_TOKEN,
          ),
          chatThreads: new ChatThreadStore(),
          sessions: new SessionStore(),
          config: {
            sessionSecret: "test-session-secret",
            secureCookies: false,
            googleClientId: undefined,
            googleRedirectPath: "/api/auth/google/callback",
            relayUrl: `http://127.0.0.1:${relayServer.port}`,
            relayInternalToken: INTERNAL_TOKEN,
          },
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
        email: "projects@example.com",
        password: "password123",
      }),
    });
    expect(register.status).toBe(201);
    cookies = register.cookies;

    const role = await store.createRole({
      tenant_id: tenant.tenant_id,
      name: "team-a",
      hermes_profile: "team-a-profile",
      path_prefixes: [VAULT_PATH],
    });
    await store.setUserRoles({
      tenant_id: tenant.tenant_id,
      user_id: register.body.user_id as string,
      role_ids: [role.role_id],
    });
  });

  afterEach(async () => {
    await gateway?.close();
    await relayServer?.close();
    await store.close();
  });

  it("CRUDs projects via /api/projects with ACL enforcement", async () => {
    const created = await jsonRequest(bffApp, "/api/projects", {
      method: "POST",
      host: tenant.host,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Alpha",
        vault_path: VAULT_PATH,
      }),
    });
    expect(created.status).toBe(201);
    expect(created.body.vault_path).toBe(VAULT_PATH);

    const denied = await jsonRequest(bffApp, "/api/projects", {
      method: "POST",
      host: tenant.host,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Forbidden",
        vault_path: "/Projects/B",
      }),
    });
    expect(denied.status).toBe(403);

    const listed = await jsonRequest(bffApp, "/api/projects", {
      host: tenant.host,
      cookies,
    });
    expect(listed.status).toBe(200);
    expect((listed.body.projects as JsonBody[]).length).toBe(1);

    const projectId = created.body.project_id as string;
    const updated = await jsonRequest(bffApp, `/api/projects/${projectId}`, {
      method: "PUT",
      host: tenant.host,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Alpha Renamed" }),
    });
    expect(updated.status).toBe(200);
    expect(updated.body.name).toBe("Alpha Renamed");

    const deleted = await jsonRequest(bffApp, `/api/projects/${projectId}`, {
      method: "DELETE",
      host: tenant.host,
      cookies,
      csrf: true,
    });
    expect(deleted.status).toBe(200);
  });

  it("injects Hermes project primary_path into relay inbound SessionSource.chat_topic", async () => {
    const hermesPrimary = "/home/agent/Demo";
    // Rebuild BFF with a Hermes projects store (SoT for agent cwd).
    const authClient = new ControlPlaneAuthClient(
      "http://control-plane.test",
      (input, init) => {
        const url = new URL(input);
        return controlPlaneApp.request(url.pathname + url.search, init);
      },
    );
    bffApp = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          authClient,
          cognito,
          relayClient: new RelayClient(
            `http://127.0.0.1:${relayServer.port}`,
            INTERNAL_TOKEN,
          ),
          chatThreads: new ChatThreadStore(),
          sessions: new SessionStore(),
          hermesProjects: {
            listProjects: () => [
              {
                id: "p_demo",
                slug: "demo",
                name: "Demo",
                primary_path: hermesPrimary,
                folders: [
                  {
                    path: hermesPrimary,
                    label: null,
                    is_primary: true,
                  },
                ],
              },
            ],
            getProject: (id) =>
              id === "p_demo"
                ? {
                    id: "p_demo",
                    slug: "demo",
                    name: "Demo",
                    primary_path: hermesPrimary,
                    folders: [
                      {
                        path: hermesPrimary,
                        label: null,
                        is_primary: true,
                      },
                    ],
                  }
                : null,
            createProject: async () => {
              throw new Error("not used");
            },
          },
          config: {
            sessionSecret: "test-session-secret",
            secureCookies: false,
            googleClientId: undefined,
            googleRedirectPath: "/api/auth/google/callback",
            relayUrl: `http://127.0.0.1:${relayServer.port}`,
            relayInternalToken: INTERNAL_TOKEN,
          },
        },
      ),
    );

    // Re-login against the new app instance (fresh session store).
    const csrf = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: tenant.host,
    });
    cookies = csrf.cookies;
    const login = await jsonRequest(bffApp, "/api/auth/login", {
      method: "POST",
      host: tenant.host,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "projects@example.com",
        password: "password123",
      }),
    });
    expect(login.status).toBe(200);
    cookies = login.cookies;

    const threadRes = await jsonRequest(bffApp, "/api/chat/threads", {
      method: "POST",
      host: tenant.host,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project_id: "p_demo" }),
    });
    expect(threadRes.status).toBe(201);
    expect(threadRes.body.title).toBe("Demo");
    expect(threadRes.body.project_vault_path).toBe(hermesPrimary);

    const threadId = threadRes.body.thread_id as string;
    const inboundPromise = gateway.waitForInbound();

    const messageRes = await jsonRequest(
      bffApp,
      `/api/chat/threads/${threadId}/messages`,
      {
        method: "POST",
        host: tenant.host,
        cookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "context check" }),
      },
    );
    expect(messageRes.status).toBe(200);

    const inbound = await inboundPromise;
    expect(inbound.event.source.chat_id).toBe(threadId);
    expect(inbound.event.source.chat_name).toBe("Demo");
    expect(inbound.event.source.chat_topic).toBe(hermesPrimary);
    expect(inbound.event.source.profile).toBe("team-a-profile");
    expect(inbound.event.metadata).toMatchObject({
      working_directory: hermesPrimary,
      project_vault_path: hermesPrimary,
    });
  });

  it("selecting project B stamps working_directory to B.primary_path (lp-rt5.5)", async () => {
    const pathA = "/Projects/A";
    const pathB = "/Projects/B";
    const hermesProjects = {
      listProjects: () => [
        {
          id: "p_a",
          slug: "alpha",
          name: "Alpha",
          primary_path: pathA,
          folders: [{ path: pathA, label: null, is_primary: true }],
        },
        {
          id: "p_b",
          slug: "beta",
          name: "Beta",
          primary_path: pathB,
          folders: [{ path: pathB, label: null, is_primary: true }],
        },
      ],
      getProject: (id: string) => {
        if (id === "p_a") {
          return {
            id: "p_a",
            slug: "alpha",
            name: "Alpha",
            primary_path: pathA,
            folders: [{ path: pathA, label: null, is_primary: true }],
          };
        }
        if (id === "p_b") {
          return {
            id: "p_b",
            slug: "beta",
            name: "Beta",
            primary_path: pathB,
            folders: [{ path: pathB, label: null, is_primary: true }],
          };
        }
        return null;
      },
      createProject: async () => {
        throw new Error("not used");
      },
    };

    const authClient = new ControlPlaneAuthClient(
      "http://control-plane.test",
      (input, init) => {
        const url = new URL(input);
        return controlPlaneApp.request(url.pathname + url.search, init);
      },
    );
    bffApp = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          authClient,
          cognito,
          relayClient: new RelayClient(
            `http://127.0.0.1:${relayServer.port}`,
            INTERNAL_TOKEN,
          ),
          chatThreads: new ChatThreadStore(),
          sessions: new SessionStore(),
          hermesProjects,
          config: {
            sessionSecret: "test-session-secret",
            secureCookies: false,
            googleClientId: undefined,
            googleRedirectPath: "/api/auth/google/callback",
            relayUrl: `http://127.0.0.1:${relayServer.port}`,
            relayInternalToken: INTERNAL_TOKEN,
          },
        },
      ),
    );

    const csrf = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: tenant.host,
    });
    cookies = csrf.cookies;
    const login = await jsonRequest(bffApp, "/api/auth/login", {
      method: "POST",
      host: tenant.host,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "projects@example.com",
        password: "password123",
      }),
    });
    expect(login.status).toBe(200);
    cookies = login.cookies;

    // Select project B (not A) → thread bound to B.primary_path
    const threadRes = await jsonRequest(bffApp, "/api/chat/threads", {
      method: "POST",
      host: tenant.host,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project_id: "p_b" }),
    });
    expect(threadRes.status).toBe(201);
    expect(threadRes.body).toMatchObject({
      project_id: "p_b",
      title: "Beta",
      project_vault_path: pathB,
    });
    expect(threadRes.body.project_vault_path).not.toBe(pathA);

    const threadId = threadRes.body.thread_id as string;
    const inboundPromise = gateway.waitForInbound();
    const messageRes = await jsonRequest(
      bffApp,
      `/api/chat/threads/${threadId}/messages`,
      {
        method: "POST",
        host: tenant.host,
        cookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "work in B" }),
      },
    );
    expect(messageRes.status).toBe(200);

    const inbound = await inboundPromise;
    expect(inbound.event.source.chat_topic).toBe(pathB);
    expect(inbound.event.metadata).toEqual({
      working_directory: pathB,
      project_vault_path: pathB,
    });
    // Must not stamp project A when B was selected.
    expect(inbound.event.source.chat_topic).not.toBe(pathA);
    expect(inbound.event.metadata?.working_directory).not.toBe(pathA);
  });
});