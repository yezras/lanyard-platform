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
import { ControlPlaneAuthClient } from "../src/control-plane-client.js";
import { RelayClient } from "../src/relay-client.js";
import { SessionStore } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import { cookieHeader, createTestBindings, parseSetCookie } from "./test-helpers.js";

const INTERNAL_TOKEN = "bff-chat-internal-token";
const GATEWAY_ID = "gw-bff-chat";
const SECRET = "bff-chat-secret";

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
  sendOutbound(
    action: Record<string, unknown>,
  ): Promise<OutboundResultFrame["result"]>;
  waitForInbound(): Promise<InboundFrame>;
  waitForInterruptInbound(): Promise<Record<string, unknown>>;
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
    const interruptWaiters: Array<(f: Record<string, unknown>) => void> = [];
    const outboundWaiters = new Map<
      string,
      (r: OutboundResultFrame["result"]) => void
    >();

    ws.on("error", reject);

    ws.on("open", () => {
      resolve({
        ws,
        waitForDescriptor: () =>
          new Promise((res) => {
            descriptorWaiters.push(res);
          }),
        sendOutbound: (action) =>
          new Promise((res, rej) => {
            const requestId = crypto.randomUUID().replace(/-/g, "");
            outboundWaiters.set(requestId, res);
            ws.send(
              JSON.stringify({
                type: "outbound",
                requestId,
                action,
              }) + "\n",
            );
            setTimeout(() => {
              if (outboundWaiters.has(requestId)) {
                outboundWaiters.delete(requestId);
                rej(new Error("outbound timed out"));
              }
            }, 3000);
          }),
        waitForInbound: () =>
          new Promise((res) => {
            inboundWaiters.push(res);
          }),
        waitForInterruptInbound: () =>
          new Promise((res) => {
            interruptWaiters.push(res);
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
        } else if (frame.type === "outbound_result") {
          const waiter = outboundWaiters.get(frame.requestId);
          if (waiter) {
            outboundWaiters.delete(frame.requestId);
            waiter(frame.result);
          }
        } else if (frame.type === "inbound") {
          inboundWaiters.shift()?.(frame as InboundFrame);
        } else if (frame.type === "interrupt_inbound") {
          interruptWaiters.shift()?.(frame as Record<string, unknown>);
        }
      }
    });
  });
}

describe("bff chat integration", () => {
  let store: ControlPlaneStore;
  let controlPlaneApp: ReturnType<typeof createControlPlaneApp>;
  let relayServer: Awaited<ReturnType<typeof createRelayServer>>;
  let gateway: MockGatewayClient;
  let bffApp: ReturnType<typeof createApp>;
  let chatHub: ChatDeliveryHub;
  let chatThreads: ChatThreadStore;
  let sessions: SessionStore;
  let tenant: TenantContext;
  let instanceId: string;
  let cookies: Record<string, string> = {};

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
    instanceId = provisioned.instance_id;

    tenant = {
      tenant_id: createdTenant.tenant_id,
      tenant_slug: createdTenant.tenant_slug,
      display_name: createdTenant.display_name,
      host: createdTenant.host,
    };

    const secretStore = new InMemorySecretStore();
    chatHub = new ChatDeliveryHub();
    chatThreads = new ChatThreadStore();
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

    bffApp = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          authClient,
          relayClient: new RelayClient(
            `http://127.0.0.1:${relayServer.port}`,
            INTERNAL_TOKEN,
          ),
          chatThreads,
          sessions,
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
        email: "chat@example.com",
        password: "password123",
      }),
    });
    expect(register.status).toBe(201);
    cookies = register.cookies;

    const userId = register.body.user_id as string;
    const role = await store.createRole({
      tenant_id: tenant.tenant_id,
      name: "chat-user",
      hermes_profile: "default",
      path_prefixes: ["/"],
    });
    await store.setUserRoles({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      role_ids: [role.role_id],
    });
  });

  afterEach(async () => {
    await gateway?.close();
    await relayServer?.close();
    await store.close();
  });

  it("completes round trip: thread → message → gateway inbound → SSE reply", async () => {
    const threadRes = await jsonRequest(bffApp, "/api/chat/threads", {
      method: "POST",
      host: tenant.host,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Hello brain" }),
    });
    expect(threadRes.status).toBe(201);
    const threadId = threadRes.body.thread_id as string;

    const inboundPromise = gateway.waitForInbound();

    const sseAbort = new AbortController();
    const sseFetch = bffApp.request(`/api/chat/threads/${threadId}/events`, {
      headers: {
        host: tenant.host,
        cookie: cookieHeader(cookies),
      },
      signal: sseAbort.signal,
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    const messageRes = await jsonRequest(
      bffApp,
      `/api/chat/threads/${threadId}/messages`,
      {
        method: "POST",
        host: tenant.host,
        cookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "hello brain" }),
      },
    );
    expect(messageRes.status).toBe(200);

    const inbound = await inboundPromise;
    expect(inbound.event.text).toBe("hello brain");
    expect(inbound.event.source.chat_id).toBe(threadId);
    expect(inbound.event.source.profile).toBe("default");

    const replyPromise = gateway.sendOutbound({
      op: "send",
      chat_id: threadId,
      content: "Hello from **Hermes**",
    });

    const sseResponse = await sseFetch;
    expect(sseResponse.status).toBe(200);

    const reader = sseResponse.body?.getReader();
    expect(reader).toBeTruthy();

    const decoder = new TextDecoder();
    let buffer = "";
    let sawReply = false;

    const readSse = async () => {
      while (!sawReply) {
        const { done, value } = await reader!.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.includes("Hello from **Hermes**")) {
          sawReply = true;
        }
      }
    };

    await Promise.all([replyPromise, readSse()]);
    expect(sawReply).toBe(true);

    // Durable history for reload hydrate (portal-wak.1).
    const historyRes = await jsonRequest(
      bffApp,
      `/api/chat/threads/${threadId}/history`,
      {
        method: "GET",
        host: tenant.host,
        cookies,
      },
    );
    expect(historyRes.status).toBe(200);
    const events = historyRes.body.events as Array<Record<string, unknown>>;
    expect(Array.isArray(events)).toBe(true);
    expect(
      events.some(
        (e) => e.type === "user_message" && e.content === "hello brain",
      ),
    ).toBe(true);
    expect(
      events.some(
        (e) =>
          e.type === "message_send" &&
          typeof e.content === "string" &&
          e.content.includes("Hello from **Hermes**"),
      ),
    ).toBe(true);

    sseAbort.abort();
    reader?.releaseLock();
  });

  /**
   * portal-lnc.2: cancel must use Hermes active-session key
   * (agent:main:relay:dm:<threadId>), not wire platform lanyard_web.
   */
  it("cancel delivers interrupt_inbound with Hermes relay session_key", async () => {
    const threadRes = await jsonRequest(bffApp, "/api/chat/threads", {
      method: "POST",
      host: tenant.host,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Cancel me" }),
    });
    expect(threadRes.status).toBe(201);
    const threadId = threadRes.body.thread_id as string;

    const interruptPromise = gateway.waitForInterruptInbound();

    const cancelRes = await jsonRequest(
      bffApp,
      `/api/chat/threads/${threadId}/cancel`,
      {
        method: "POST",
        host: tenant.host,
        cookies,
        csrf: true,
        headers: { "content-type": "application/json" },
      },
    );
    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body).toEqual({ ok: true, thread_id: threadId });

    const interrupt = await interruptPromise;
    expect(interrupt).toEqual({
      type: "interrupt_inbound",
      session_key: `agent:main:relay:dm:${threadId}`,
      chat_id: threadId,
    });
  });

  /**
   * portal-c0q.2: SSE tee path — outbound survives even when relay history is empty.
   */
  it("returns teed outbound from BFF store when relay history is empty", async () => {
    const threadRes = await jsonRequest(bffApp, "/api/chat/threads", {
      method: "POST",
      host: tenant.host,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Tee history" }),
    });
    expect(threadRes.status).toBe(201);
    const threadId = threadRes.body.thread_id as string;

    const inboundPromise = gateway.waitForInbound();
    const sseAbort = new AbortController();
    const sseFetch = bffApp.request(`/api/chat/threads/${threadId}/events`, {
      headers: {
        host: tenant.host,
        cookie: cookieHeader(cookies),
      },
      signal: sseAbort.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const messageRes = await jsonRequest(
      bffApp,
      `/api/chat/threads/${threadId}/messages`,
      {
        method: "POST",
        host: tenant.host,
        cookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "please reply" }),
      },
    );
    expect(messageRes.status).toBe(200);
    await inboundPromise;

    const replyPromise = gateway.sendOutbound({
      op: "send",
      chat_id: threadId,
      content: "Teed assistant reply",
    });

    const sseResponse = await sseFetch;
    expect(sseResponse.status).toBe(200);
    const reader = sseResponse.body?.getReader();
    expect(reader).toBeTruthy();
    const decoder = new TextDecoder();
    let buffer = "";
    let sawReply = false;
    const readSse = async () => {
      while (!sawReply) {
        const { done, value } = await reader!.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.includes("Teed assistant reply")) {
          sawReply = true;
        }
      }
    };
    await Promise.all([replyPromise, readSse()]);
    expect(sawReply).toBe(true);

    // Simulate relay ring buffer empty / stubbed (BFF tee must still serve outbound).
    chatHub.clearHistory(threadId);
    expect(chatHub.listHistory(threadId)).toHaveLength(0);

    const historyRes = await jsonRequest(
      bffApp,
      `/api/chat/threads/${threadId}/history`,
      {
        method: "GET",
        host: tenant.host,
        cookies,
      },
    );
    expect(historyRes.status).toBe(200);
    expect(historyRes.body.outbound_incomplete).toBeUndefined();
    const events = historyRes.body.events as Array<Record<string, unknown>>;
    expect(
      events.some(
        (e) => e.type === "user_message" && e.content === "please reply",
      ),
    ).toBe(true);
    expect(
      events.some(
        (e) =>
          e.type === "message_send" && e.content === "Teed assistant reply",
      ),
    ).toBe(true);

    sseAbort.abort();
    reader?.releaseLock();
  });

  /**
   * portal-c0q.2: relay fetchChatHistory !ok still returns full transcript from BFF tee.
   */
  it("returns full transcript from BFF store when relay history fetch fails", async () => {
    const threadRes = await jsonRequest(bffApp, "/api/chat/threads", {
      method: "POST",
      host: tenant.host,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Relay down" }),
    });
    expect(threadRes.status).toBe(201);
    const threadId = threadRes.body.thread_id as string;

    const inboundPromise = gateway.waitForInbound();
    const sseAbort = new AbortController();
    const sseFetch = bffApp.request(`/api/chat/threads/${threadId}/events`, {
      headers: {
        host: tenant.host,
        cookie: cookieHeader(cookies),
      },
      signal: sseAbort.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const messageRes = await jsonRequest(
      bffApp,
      `/api/chat/threads/${threadId}/messages`,
      {
        method: "POST",
        host: tenant.host,
        cookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "user while relay will fail" }),
      },
    );
    expect(messageRes.status).toBe(200);
    await inboundPromise;

    const replyPromise = gateway.sendOutbound({
      op: "send",
      chat_id: threadId,
      content: "Survives relay history outage",
    });

    const sseResponse = await sseFetch;
    const reader = sseResponse.body?.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let sawReply = false;
    const readSse = async () => {
      while (!sawReply) {
        const { done, value } = await reader!.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.includes("Survives relay history outage")) {
          sawReply = true;
        }
      }
    };
    await Promise.all([replyPromise, readSse()]);
    expect(sawReply).toBe(true);

    // Rebuild app with a relay client that fails history but keeps deliver/SSE optional.
    const failingHistoryClient = new RelayClient(
      `http://127.0.0.1:${relayServer.port}`,
      INTERNAL_TOKEN,
    );
    const originalFetch = failingHistoryClient.fetchChatHistory.bind(
      failingHistoryClient,
    );
    failingHistoryClient.fetchChatHistory = async () => ({
      ok: false as const,
      status: 503,
      error: "simulated relay history outage",
    });
    void originalFetch;

    const authClient = new ControlPlaneAuthClient(
      "http://control-plane.test",
      (input, init) => {
        const url = new URL(input);
        return controlPlaneApp.request(url.pathname + url.search, init);
      },
    );

    const appWithFailingHistory = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          authClient,
          relayClient: failingHistoryClient,
          // Same in-memory store that received the SSE tee.
          chatThreads,
          sessions,
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

    const historyRes = await jsonRequest(
      appWithFailingHistory,
      `/api/chat/threads/${threadId}/history`,
      {
        method: "GET",
        host: tenant.host,
        cookies,
      },
    );
    expect(historyRes.status).toBe(200);
    // Tee populated outbound — not incomplete.
    expect(historyRes.body.outbound_incomplete).toBeUndefined();
    const events = historyRes.body.events as Array<Record<string, unknown>>;
    expect(
      events.some(
        (e) =>
          e.type === "user_message" &&
          e.content === "user while relay will fail",
      ),
    ).toBe(true);
    expect(
      events.some(
        (e) =>
          e.type === "message_send" &&
          e.content === "Survives relay history outage",
      ),
    ).toBe(true);

    sseAbort.abort();
    reader?.releaseLock();
  });

  /**
   * portal-c0q.2: relay history fail + no BFF outbound → surface outbound_incomplete.
   */
  it("sets outbound_incomplete when relay history fails and BFF has no outbound", async () => {
    const threadRes = await jsonRequest(bffApp, "/api/chat/threads", {
      method: "POST",
      host: tenant.host,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Incomplete" }),
    });
    expect(threadRes.status).toBe(201);
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
        body: JSON.stringify({ text: "only user so far" }),
      },
    );
    expect(messageRes.status).toBe(200);
    await inboundPromise;

    const failingHistoryClient = new RelayClient(
      `http://127.0.0.1:${relayServer.port}`,
      INTERNAL_TOKEN,
    );
    failingHistoryClient.fetchChatHistory = async () => ({
      ok: false as const,
      status: 502,
      error: "relay unavailable",
    });

    const authClient = new ControlPlaneAuthClient(
      "http://control-plane.test",
      (input, init) => {
        const url = new URL(input);
        return controlPlaneApp.request(url.pathname + url.search, init);
      },
    );

    const appWithFailingHistory = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          authClient,
          relayClient: failingHistoryClient,
          chatThreads,
          sessions,
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

    const historyRes = await jsonRequest(
      appWithFailingHistory,
      `/api/chat/threads/${threadId}/history`,
      {
        method: "GET",
        host: tenant.host,
        cookies,
      },
    );
    expect(historyRes.status).toBe(200);
    expect(historyRes.body.outbound_incomplete).toBe(true);
    const events = historyRes.body.events as Array<Record<string, unknown>>;
    expect(
      events.some(
        (e) => e.type === "user_message" && e.content === "only user so far",
      ),
    ).toBe(true);
    expect(events.some((e) => e.type === "message_send")).toBe(false);
  });

  /**
   * lp-8sh4.6: with the gateway/relay process DOWN (the MockLab QA condition),
   * a REAL RelayClient (unmocked) must not turn history into an unhandled
   * `TypeError: fetch failed` → 500. History stays 200 from the BFF store and
   * the send POST surfaces a structured 503 instead of "Internal server error".
   */
  it("survives a dead relay: history stays 200 and send returns 202 agent_starting", async () => {
    // Seed a thread + user message through the live-relay app first.
    const threadRes = await jsonRequest(bffApp, "/api/chat/threads", {
      method: "POST",
      host: tenant.host,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Dead relay" }),
    });
    expect(threadRes.status).toBe(201);
    const threadId = threadRes.body.thread_id as string;

    const inboundPromise = gateway.waitForInbound();
    await jsonRequest(bffApp, `/api/chat/threads/${threadId}/messages`, {
      method: "POST",
      host: tenant.host,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "sent while relay was up" }),
    });
    await inboundPromise;

    // Real client class, but the gateway socket is gone entirely.
    const deadRelayClient = new RelayClient(
      "http://127.0.0.1:1",
      INTERNAL_TOKEN,
    );

    const authClient = new ControlPlaneAuthClient(
      "http://control-plane.test",
      (input, init) => {
        const url = new URL(input);
        return controlPlaneApp.request(url.pathname + url.search, init);
      },
    );

    const appWithDeadRelay = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          authClient,
          relayClient: deadRelayClient,
          chatThreads,
          sessions,
          config: {
            sessionSecret: "test-session-secret",
            secureCookies: false,
            googleClientId: undefined,
            googleRedirectPath: "/api/auth/google/callback",
            relayUrl: "http://127.0.0.1:1",
            relayInternalToken: INTERNAL_TOKEN,
          },
        },
      ),
    );

    const historyRes = await jsonRequest(
      appWithDeadRelay,
      `/api/chat/threads/${threadId}/history`,
      {
        method: "GET",
        host: tenant.host,
        cookies,
      },
    );
    expect(historyRes.status).toBe(200);
    const events = historyRes.body.events as Array<Record<string, unknown>>;
    expect(
      events.some(
        (e) =>
          e.type === "user_message" && e.content === "sent while relay was up",
      ),
    ).toBe(true);

    const sendRes = await jsonRequest(
      appWithDeadRelay,
      `/api/chat/threads/${threadId}/messages`,
      {
        method: "POST",
        host: tenant.host,
        cookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: "send while relay is down" }),
      },
    );
    // lp-vqr0.8: gateway-not-ready is agent_starting (202), not a hard 503.
    expect(sendRes.status).toBe(202);
    expect(sendRes.body.ok).toBe(true);
    expect(sendRes.body.status).toBe("agent_starting");
    expect(String(sendRes.body.message ?? "")).toMatch(/Agent starting/);
    expect(sendRes.body.thread_id).toBe(threadId);

    // The failed send must not be silently dropped into durable history.
    const historyAfterSend = await jsonRequest(
      appWithDeadRelay,
      `/api/chat/threads/${threadId}/history`,
      {
        method: "GET",
        host: tenant.host,
        cookies,
      },
    );
    expect(historyAfterSend.status).toBe(200);
    const eventsAfter = historyAfterSend.body
      .events as Array<Record<string, unknown>>;
    expect(
      eventsAfter.some((e) => e.content === "send while relay is down"),
    ).toBe(false);
  });

  it("delivers normalized mcq_selection inbound when user taps a choice", async () => {
    const threadRes = await jsonRequest(bffApp, "/api/chat/threads", {
      method: "POST",
      host: tenant.host,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "MCQ thread" }),
    });
    expect(threadRes.status).toBe(201);
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
        body: JSON.stringify({
          mcq_selection: {
            mcq_id: "lane-pick-001",
            choice_id: "safe",
            label: "Safe lane",
            prompt_message_id: "msg-prompt-1",
          },
        }),
      },
    );
    expect(messageRes.status).toBe(200);

    const inbound = await inboundPromise;
    expect(inbound.event.text).toBe("Safe lane");
    expect(inbound.event.message_type).toBe("mcq_selection");
    expect(inbound.event.reply_to_message_id).toBe("msg-prompt-1");
    expect(inbound.event.metadata).toEqual({
      portal_inbound: "mcq_selection",
      mcq_id: "lane-pick-001",
      choice_id: "safe",
      choice_label: "Safe lane",
    });
  });

  it("deletes an owned thread via DELETE /api/chat/threads/:threadId", async () => {
    const threadRes = await jsonRequest(bffApp, "/api/chat/threads", {
      method: "POST",
      host: tenant.host,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "To delete" }),
    });
    expect(threadRes.status).toBe(201);
    const threadId = threadRes.body.thread_id as string;

    const deleted = await jsonRequest(
      bffApp,
      `/api/chat/threads/${threadId}`,
      {
        method: "DELETE",
        host: tenant.host,
        cookies,
        csrf: true,
      },
    );
    expect(deleted.status).toBe(200);
    expect(deleted.body.ok).toBe(true);

    const listed = await jsonRequest(bffApp, "/api/chat/threads", {
      host: tenant.host,
      cookies,
    });
    expect(listed.status).toBe(200);
    const threads = listed.body.threads as Array<{ thread_id: string }>;
    expect(threads.some((t) => t.thread_id === threadId)).toBe(false);

    const missing = await jsonRequest(
      bffApp,
      `/api/chat/threads/${threadId}`,
      {
        method: "DELETE",
        host: tenant.host,
        cookies,
        csrf: true,
      },
    );
    expect(missing.status).toBe(404);
  });
});