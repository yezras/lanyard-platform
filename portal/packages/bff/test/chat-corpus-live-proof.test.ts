/**
 * lp-gkh.9 — Live proof: MockLab chat produces corpus objects with full I/O.
 *
 * Acceptance:
 * - Enable corpus for mocklab tenant
 * - Simulated chat → durable object with user + assistant content
 * - BFF restart independence (new process/store instance still has object)
 * - Evidence under artifacts/mocklab/lp-gkh.9/ (object key + redacted shape)
 *
 * Topology: in-process mocklab (CP + relay + mock gateway + BFF) with durable
 * FsCorpusObjectStore — same key layout as S3; no AWS apply required for lab.
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import {
  FsCorpusObjectStore,
  S3CorpusWriter,
  type ChatTurnRecord,
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
import type { ControlPlaneStore } from "../../control-plane/src/store.js";
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

const INTERNAL_TOKEN = "bff-corpus-live-proof-internal";
const GATEWAY_ID = "gw-bff-corpus-live-proof";
const CORPUS_BUCKET = "lanyard-chat-corpus-lab";
/** Fixed probe strings — safe to record in redacted evidence. */
const USER_PROBE = "lp-gkh.9 mocklab corpus live proof user";
const ASSISTANT_PROBE = "lp-gkh.9 mocklab corpus live proof assistant";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const EVIDENCE_DIR = path.join(REPO_ROOT, "artifacts/mocklab/lp-gkh.9");

type JsonBody = Record<string, unknown>;

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  pathName: string,
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

  const response = await app.request(pathName, { ...init, headers });
  const body = (await response.json()) as JsonBody;
  const cookies = {
    ...init.cookies,
    ...parseSetCookie(response.headers.get("set-cookie")),
  };

  return { status: response.status, body, cookies };
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 5_000,
  intervalMs = 25,
): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
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
/** Redact full bodies for evidence; keep roles + length + sha presence. */
function redactRecordShape(record: ChatTurnRecord): Record<string, unknown> {
  return {
    schema_version: record.schema_version,
    record_type: record.record_type,
    tenant_id: record.tenant_id,
    user_id: record.user_id,
    instance_id: record.instance_id,
    thread_id: record.thread_id,
    turn_id: record.turn_id,
    created_at: record.created_at,
    model: record.model,
    input: {
      role: record.input.role,
      content_redacted: true,
      content_length: record.input.content.length,
      content_sha256_present: Boolean(record.input.content_sha256),
      content_probe_match: record.input.content === USER_PROBE,
    },
    output: {
      role: record.output.role,
      content_redacted: true,
      content_length: record.output.content.length,
      content_sha256_present: Boolean(record.output.content_sha256),
      content_probe_match: record.output.content === ASSISTANT_PROBE,
      finish_reason: record.output.finish_reason ?? null,
    },
    tool_events_count: record.tool_events?.length ?? 0,
    meta: {
      client: record.meta?.client ?? null,
      request_id_present: Boolean(record.meta?.request_id),
    },
  };
}

describe("lp-gkh.9 MockLab chat corpus live proof", () => {
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
  let corpusRoot: string;

  async function buildApp(writer: CorpusWriter, corpusEnabled: boolean) {
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
          corpusWriter: writer,
          chatCorpusIsEnabled: async () => corpusEnabled,
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
  ): Promise<{ messageStatus: number; threadId: string }> {
    const threadRes = await jsonRequest(bffApp, "/api/chat/threads", {
      method: "POST",
      host: tenant.host,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "lp-gkh.9 live proof" }),
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
    return { messageStatus: messageRes.status, threadId };
  }

  beforeEach(async () => {
    store = await createTestStore();
    controlPlaneApp = createControlPlaneApp(store, {
      devOpen: true,
      internalOpsToken: "live-proof-ops-token",
    });

    const createdTenant = await store.createTenant({
      slug: "mocklab",
      display_name: "MockLab",
    });
    // Enable L10 for mocklab tenant (ops enablement).
    await store.updateTenantRetention({
      tenant_id: createdTenant.tenant_id,
      chat_corpus_enabled: true,
      chat_corpus_retention_days: 90,
      actor: "lp-gkh.9-live-proof",
    });
    const retention = await store.getTenantRetention(createdTenant.tenant_id);
    expect(retention?.chat_corpus_enabled).toBe(true);

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

    corpusRoot = path.join(
      REPO_ROOT,
      "artifacts/mocklab/lp-gkh.9/.corpus-store",
    );
    await mkdir(corpusRoot, { recursive: true });

    const bootstrapWriter = new S3CorpusWriter({
      bucket: CORPUS_BUCKET,
      store: new FsCorpusObjectStore({ rootDir: corpusRoot }),
    });
    const bootstrapApp = await buildApp(bootstrapWriter, false);
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
        email: "corpus-live@example.com",
        password: "password123",
      }),
    });
    expect(register.status).toBe(201);
    cookies = register.cookies;
    userId = register.body.user_id as string;
    const role = await store.createRole({
      tenant_id: tenant.tenant_id,
      name: "corpus-live-user",
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
    try {
      await gateway?.close();
    } catch {
      /* ignore */
    }
    try {
      await relayServer?.close();
    } catch {
      /* ignore */
    }
    try {
      await store?.close();
    } catch {
      /* ignore */
    }
  });

  it("enable → chat → object with full I/O → restart independence", async () => {
    // BFF process A: writer over durable FS store
    const storeA = new FsCorpusObjectStore({ rootDir: corpusRoot });
    const writerA = new S3CorpusWriter({ bucket: CORPUS_BUCKET, store: storeA });
    const bffA = await buildApp(writerA, true);

    const turn = await runSimulatedTurn(bffA, USER_PROBE, ASSISTANT_PROBE);

    // Wait for fire-and-forget corpus write
    await waitFor(async () => {
      const listed = await storeA.listObjects!({
        bucket: CORPUS_BUCKET,
        prefix: `tenants/${tenant.tenant_id}/chat-corpus/`,
      });
      return listed.objects.length > 0;
    });

    const listedAfter = await storeA.listObjects!({
      bucket: CORPUS_BUCKET,
      prefix: `tenants/${tenant.tenant_id}/chat-corpus/`,
    });
    expect(listedAfter.objects.length).toBeGreaterThanOrEqual(1);
    const writtenKey = listedAfter.objects[0]!.key;
    const writtenBody = await storeA.getObject({
      bucket: CORPUS_BUCKET,
      key: writtenKey,
    });
    expect(writtenBody).toBeTruthy();
    const record = JSON.parse(writtenBody!) as ChatTurnRecord;
    expect(record.input.role).toBe("user");
    expect(record.output.role).toBe("assistant");
    expect(record.input.content).toBe(USER_PROBE);
    expect(record.output.content).toBe(ASSISTANT_PROBE);
    expect(record.tenant_id).toBe(tenant.tenant_id);
    expect(record.user_id).toBe(userId);
    expect(record.instance_id).toBe(instanceId);
    expect(record.thread_id).toBe(turn.threadId);
    expect(writtenKey!).toContain(
      `tenants/${tenant.tenant_id}/chat-corpus/v1/`,
    );
    expect(writtenKey!).toContain(`thread=${turn.threadId}`);
    expect(writtenKey!).toMatch(/turn=.+\.json$/);
    // --- BFF restart independence ---
    // Drop process A bindings (new ChatThreadStore / sessions / writer).
    // In-memory sessions/UI hydrate are gone; durable corpus must remain.
    chatThreads = new ChatThreadStore();
    sessions = new SessionStore();
    const storeB = new FsCorpusObjectStore({ rootDir: corpusRoot });
    const writerB = new S3CorpusWriter({ bucket: CORPUS_BUCKET, store: storeB });
    // New BFF process (same corpus FS root) — cookies from A are invalid by design.
    const bffB = await buildApp(writerB, true);
    expect(bffB).toBeTruthy();

    const bodyAfterRestart = await storeB.getObject({
      bucket: CORPUS_BUCKET,
      key: writtenKey,
    });
    expect(bodyAfterRestart).toBeTruthy();
    expect(bodyAfterRestart).toBe(writtenBody);
    const recordAfter = JSON.parse(bodyAfterRestart!) as ChatTurnRecord;
    expect(recordAfter.input.content).toBe(USER_PROBE);
    expect(recordAfter.output.content).toBe(ASSISTANT_PROBE);

    const listedB = await storeB.listObjects!({
      bucket: CORPUS_BUCKET,
      prefix: `tenants/${tenant.tenant_id}/chat-corpus/`,
    });
    expect(listedB.objects.map((o) => o.key)).toContain(writtenKey);

    // Write evidence (redacted bodies)
    const stampCompact = new Date()
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");
    await mkdir(EVIDENCE_DIR, { recursive: true });

    const evidence = {
      bead_id: "lp-gkh.9",
      title: "0011.9 Live proof: MockLab chat produces corpus objects with full I/O",
      timestamp_utc: new Date().toISOString(),
      stamp: stampCompact,
      environment: "mocklab_inprocess_fs_corpus",
      topology: {
        name: "inprocess_mocklab_cp_relay_bff_mock_gateway",
        tenant_slug: "mocklab",
        corpus_backend: "FsCorpusObjectStore",
        corpus_bucket: CORPUS_BUCKET,
        note: "Durable FS store uses the same key layout as S3; AWS corpus bucket apply is follow-on ops (lp-gkh.3 module ready, not required for lab proof).",
      },
      enablement: {
        chat_corpus_enabled: true,
        chat_corpus_retention_days: 90,
        fail_closed_default: true,
      },
      checks: {
        "enablement.chat_corpus_enabled": true,
        "chat.user_message_accepted": turn.messageStatus === 200,
        "corpus.object_exists": true,
        "corpus.user_content_present": true,
        "corpus.assistant_content_present": true,
        "corpus.key_layout_v1": writtenKey.includes("/chat-corpus/v1/"),
        "bff_restart.object_still_present": true,
        "bff_restart.body_unchanged": true,
      },
      object_key: writtenKey,
      record_shape_redacted: redactRecordShape(record),
      bff_restart: {
        simulated: true,
        method:
          "New ChatThreadStore + SessionStore + FsCorpusObjectStore + S3CorpusWriter sharing the same CHAT_CORPUS_FS_ROOT; object read after restart",
        object_present: true,
        body_byte_equal: bodyAfterRestart === writtenBody,
      },
      result: "PASS",
      needs_ui_qa: true,
      ui_qa_note:
        "Browser chat on hosted mocklab remains optional UIQA when CHAT_CORPUS_FS_ROOT (or S3) is wired on the live BFF; this bead proves capture+durability on the chat path with mocklab tenant enablement.",
    };

    const evidencePath = path.join(
      EVIDENCE_DIR,
      `live-proof-evidence-${stampCompact}.json`,
    );
    const latestPath = path.join(
      EVIDENCE_DIR,
      "live-proof-evidence-latest.json",
    );
    const json = `${JSON.stringify(evidence, null, 2)}\n`;
    await writeFile(evidencePath, json, "utf8");
    await writeFile(latestPath, json, "utf8");

    // sanity: evidence file asserts pass
    expect(evidence.result).toBe("PASS");
    expect(evidence.object_key).toBeTruthy();
  });
});
