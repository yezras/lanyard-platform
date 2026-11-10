/**
 * lp-gkh.5 — BFF capture: tee user message + assistant output into CorpusWriter.
 *
 * Acceptance:
 * - Simulated turn → one corpus write when enabled
 * - Zero writes when disabled
 * - Chat HTTP 200 if writer throws
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import {
  FakeCorpusWriter,
  type CorpusWriteResult,
  type CorpusWriter,
} from "@lanyard/chat-corpus";
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
import {
  CHAT_CORPUS_WRITE_FAILED_METRIC,
  ChatCorpusCapture,
  isNonFinalAssistantOutbound,
  modelRefFromOutbound,
} from "../src/chat-corpus-capture.js";
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

const INTERNAL_TOKEN = "bff-corpus-capture-internal";
const GATEWAY_ID = "gw-bff-corpus-capture";

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
        }
      }
    });
  });
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
  intervalMs = 20,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

describe("ChatCorpusCapture unit helpers (lp-gkh.5)", () => {
  it("modelRefFromOutbound parses provider/name and metadata objects", () => {
    expect(modelRefFromOutbound("poolside/laguna-s-2.1")).toEqual({
      provider: "poolside",
      name: "laguna-s-2.1",
    });
    expect(
      modelRefFromOutbound(undefined, {
        model: { provider: "xai", name: "grok-3", api_id: "g3" },
      }),
    ).toEqual({ provider: "xai", name: "grok-3", api_id: "g3" });
    expect(modelRefFromOutbound()).toEqual({
      provider: "unknown",
      name: "unknown",
    });
  });

  it("isNonFinalAssistantOutbound matches progressive stream semantics", () => {
    expect(
      isNonFinalAssistantOutbound({
        type: "message_edit",
        content: "partial",
      }),
    ).toBe(true);
    expect(
      isNonFinalAssistantOutbound({
        type: "message_send",
        content: "final",
      }),
    ).toBe(false);
    expect(
      isNonFinalAssistantOutbound({
        type: "message_send",
        content: "stream",
        metadata: { streaming: true },
      }),
    ).toBe(true);
  });

  it("buffers then writes one turn when enabled; zero when disabled", async () => {
    const enabledWriter = new FakeCorpusWriter();
    const enabled = new ChatCorpusCapture({
      writer: enabledWriter,
      isEnabled: async () => true,
    });
    enabled.bufferUserTurn({
      turn_id: "turn-1",
      tenant_id: "tenant-1",
      user_id: "user-1",
      instance_id: "instance-1",
      thread_id: "thread-1",
      created_at: "2026-08-07T15:00:00.000Z",
      content: "hello corpus",
    });
    expect(enabled.pendingCount("thread-1")).toBe(1);

    enabled.onDurableOutbound("thread-1", {
      type: "message_send",
      content: "assistant reply",
      model: "poolside/laguna-s-2.1",
    });

    await waitFor(() => enabledWriter.size() === 1);
    expect(enabledWriter.getWriteCount()).toBe(1);
    const record = enabledWriter.getByTurnId("turn-1");
    expect(record).toBeDefined();
    expect(record?.tenant_id).toBe("tenant-1");
    expect(record?.user_id).toBe("user-1");
    expect(record?.instance_id).toBe("instance-1");
    expect(record?.thread_id).toBe("thread-1");
    expect(record?.input.content).toBe("hello corpus");
    expect(record?.output.content).toBe("assistant reply");
    expect(record?.model).toEqual({
      provider: "poolside",
      name: "laguna-s-2.1",
    });
    expect(enabled.metricsSnapshot().write_ok).toBe(1);

    const disabledWriter = new FakeCorpusWriter();
    const disabled = new ChatCorpusCapture({
      writer: disabledWriter,
      isEnabled: async () => false,
    });
    disabled.bufferUserTurn({
      turn_id: "turn-2",
      tenant_id: "tenant-1",
      user_id: "user-1",
      instance_id: "instance-1",
      thread_id: "thread-2",
      created_at: "2026-08-07T15:00:00.000Z",
      content: "should not write",
    });
    disabled.onDurableOutbound("thread-2", {
      type: "message_send",
      content: "nope",
    });
    await waitFor(() => disabled.metricsSnapshot().write_skipped_disabled >= 1);
    expect(disabledWriter.size()).toBe(0);
    expect(disabledWriter.getWriteCount()).toBe(0);
  });

  it("records chat_corpus_write_failed when writer throws; does not rethrow", async () => {
    const metrics: string[] = [];
    const throwingWriter: CorpusWriter = {
      async writeTurn(): Promise<CorpusWriteResult> {
        throw new Error("simulated writer boom");
      },
    };
    const capture = new ChatCorpusCapture({
      writer: throwingWriter,
      isEnabled: () => true,
      onMetric: (name) => metrics.push(name),
    });
    capture.bufferUserTurn({
      turn_id: "turn-throw",
      tenant_id: "tenant-1",
      user_id: "user-1",
      instance_id: "instance-1",
      thread_id: "thread-throw",
      created_at: "2026-08-07T15:00:00.000Z",
      content: "user",
    });
    capture.onDurableOutbound("thread-throw", {
      type: "message_send",
      content: "assistant",
    });
    await waitFor(() => capture.metricsSnapshot().write_failed >= 1);
    expect(metrics).toContain(CHAT_CORPUS_WRITE_FAILED_METRIC);
    // Public API must not throw even when called again after failure.
    expect(() =>
      capture.onDurableOutbound("thread-throw", {
        type: "message_send",
        content: "orphan",
      }),
    ).not.toThrow();
  });

  it("does not finalize on progressive message_edit; finalizes on message_send", async () => {
    const writer = new FakeCorpusWriter();
    const capture = new ChatCorpusCapture({
      writer,
      isEnabled: () => true,
    });
    capture.bufferUserTurn({
      turn_id: "turn-stream",
      tenant_id: "t",
      user_id: "u",
      instance_id: "i",
      thread_id: "thread-stream",
      created_at: "2026-08-07T15:00:00.000Z",
      content: "q",
    });
    capture.onDurableOutbound("thread-stream", {
      type: "message_edit",
      content: "Hel",
    });
    expect(writer.size()).toBe(0);
    expect(capture.pendingCount("thread-stream")).toBe(1);
    capture.onDurableOutbound("thread-stream", {
      type: "message_send",
      content: "Hello final",
    });
    await waitFor(() => writer.size() === 1);
    expect(writer.getByTurnId("turn-stream")?.output.content).toBe(
      "Hello final",
    );
  });
});

describe("BFF chat corpus capture integration (lp-gkh.5)", () => {
  let store: ControlPlaneStore;
  let controlPlaneApp: ReturnType<typeof createControlPlaneApp>;
  let relayServer: Awaited<ReturnType<typeof createRelayServer>>;
  let gateway: MockGatewayClient;
  let chatHub: ChatDeliveryHub;
  let chatThreads: ChatThreadStore;
  let sessions: SessionStore;
  let tenant: TenantContext;
  let instanceId: string;
  let cookies: Record<string, string> = {};
  let userId: string;

  async function buildApp(opts: {
    corpusEnabled: boolean;
    writer: CorpusWriter;
  }): Promise<ReturnType<typeof createApp>> {
    const authClient = new ControlPlaneAuthClient(
      "http://control-plane.test",
      (input, init) => {
        const url = new URL(input);
        return controlPlaneApp.request(url.pathname + url.search, init);
      },
    );

    return createApp(
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
          corpusWriter: opts.writer,
          chatCorpusIsEnabled: async () => opts.corpusEnabled,
          config: {
            sessionSecret: "test-session-secret",
            secureCookies: false,
            googleClientId: undefined,
            googleRedirectPath: "/api/auth/google/callback",
            relayUrl: `http://127.0.0.1:${relayServer.port}`,
            relayInternalToken: INTERNAL_TOKEN,
            stagingMaxUploadBytes: 1024 * 1024,
          },
        },
      ),
    );
  }

  async function runSimulatedTurn(
    bffApp: ReturnType<typeof createApp>,
    text: string,
    assistant: string,
  ): Promise<{ messageStatus: number }> {
    const threadRes = await jsonRequest(bffApp, "/api/chat/threads", {
      method: "POST",
      host: tenant.host,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Corpus turn" }),
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
    await new Promise((r) => setTimeout(r, 50));

    const messageRes = await jsonRequest(
      bffApp,
      `/api/chat/threads/${threadId}/messages`,
      {
        method: "POST",
        host: tenant.host,
        cookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      },
    );
    expect(messageRes.status).toBe(200);
    await inboundPromise;

    const replyPromise = gateway.sendOutbound({
      op: "send",
      chat_id: threadId,
      content: assistant,
      metadata: { model: "poolside/laguna-s-2.1" },
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
        if (buffer.includes(assistant)) {
          sawReply = true;
        }
      }
    };
    await Promise.all([replyPromise, readSse()]);
    expect(sawReply).toBe(true);

    sseAbort.abort();
    reader?.releaseLock();
    return { messageStatus: messageRes.status };
  }

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

    // Auth against a temporary app without corpus writer.
    const bootstrapApp = await buildApp({
      corpusEnabled: false,
      writer: new FakeCorpusWriter(),
    });
    const csrf = await jsonRequest(bootstrapApp, "/api/auth/csrf", {
      host: tenant.host,
    });
    cookies = csrf.cookies;
    const register = await jsonRequest(bootstrapApp, "/api/auth/register", {
      method: "POST",
      host: tenant.host,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "corpus@example.com",
        password: "password123",
      }),
    });
    expect(register.status).toBe(201);
    cookies = register.cookies;
    userId = register.body.user_id as string;
    const role = await store.createRole({
      tenant_id: tenant.tenant_id,
      name: "corpus-user",
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

  it("simulated turn produces one corpus write when enabled", async () => {
    const writer = new FakeCorpusWriter();
    const bffApp = await buildApp({ corpusEnabled: true, writer });

    await runSimulatedTurn(bffApp, "archive this turn", "Corpus assistant ok");

    await waitFor(() => writer.size() === 1);
    expect(writer.getWriteCount()).toBe(1);
    const keys = writer.keys();
    expect(keys).toHaveLength(1);
    const record = writer.getByKey(keys[0]!);
    expect(record).toBeDefined();
    expect(record!.tenant_id).toBe(tenant.tenant_id);
    expect(record!.user_id).toBe(userId);
    expect(record!.instance_id).toBe(instanceId);
    expect(record!.thread_id).toBeTruthy();
    expect(record!.input.content).toBe("archive this turn");
    expect(record!.output.content).toBe("Corpus assistant ok");
    expect(record!.input.role).toBe("user");
    expect(record!.output.role).toBe("assistant");
    expect(record!.meta.client).toBe("portal_web");
  });

  it("simulated turn produces zero corpus writes when disabled", async () => {
    const writer = new FakeCorpusWriter();
    const bffApp = await buildApp({ corpusEnabled: false, writer });

    await runSimulatedTurn(bffApp, "do not archive", "Should not land");

    // Allow async fire-and-forget to settle.
    await new Promise((r) => setTimeout(r, 150));
    expect(writer.size()).toBe(0);
    expect(writer.getWriteCount()).toBe(0);
  });

  it("chat POST returns 200 even if CorpusWriter throws", async () => {
    const throwingWriter: CorpusWriter = {
      async writeTurn(): Promise<CorpusWriteResult> {
        throw new Error("S3 is on fire");
      },
    };
    const bffApp = await buildApp({
      corpusEnabled: true,
      writer: throwingWriter,
    });

    const result = await runSimulatedTurn(
      bffApp,
      "still deliver me",
      "reply despite corpus fail",
    );
    expect(result.messageStatus).toBe(200);

    // History still has user + assistant (UI hydrate independent of corpus).
    const threads = await jsonRequest(bffApp, "/api/chat/threads", {
      host: tenant.host,
      cookies,
    });
    expect(threads.status).toBe(200);
    const list = threads.body.threads as Array<{ thread_id: string }>;
    expect(list.length).toBeGreaterThan(0);
    const threadId = list[0]!.thread_id;
    const historyRes = await jsonRequest(
      bffApp,
      `/api/chat/threads/${threadId}/history`,
      { host: tenant.host, cookies },
    );
    expect(historyRes.status).toBe(200);
    const events = historyRes.body.events as Array<Record<string, unknown>>;
    expect(
      events.some(
        (e) => e.type === "user_message" && e.content === "still deliver me",
      ),
    ).toBe(true);
    expect(
      events.some(
        (e) =>
          e.type === "message_send" &&
          e.content === "reply despite corpus fail",
      ),
    ).toBe(true);
  });
});
