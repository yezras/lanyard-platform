/**
 * lp-y3j — BFF chat ensure_online before deliver-inbound (fake CP only).
 * Builds on offline piping flag hook (lp-kng.2.8).
 */
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { ChatThreadStore } from "../src/chat-store.js";
import { loadConfig, parseEnvFlag } from "../src/config.js";
import {
  ControlPlaneRequestError,
  type EnsureOnlineResponse,
  type InstancePresenceResponse,
  type InstancePresenceState,
} from "../src/control-plane-client.js";
import {
  ensureOnlineBeforeChatDeliver,
  ensureOnlineBeforeChatDeliverKickoff,
  type EnsureOnlineChatClient,
} from "../src/ensure-online-chat.js";
import { raceImmediate } from "../src/ensure-online-hook.js";
import { AGENT_STARTING_MESSAGE } from "../src/agent-starting-events.js";
import { SessionStore } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import { cookieHeader, createTestBindings } from "./test-helpers.js";

const INSTANCE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function presence(
  overrides: Partial<InstancePresenceResponse> = {},
): InstancePresenceResponse {
  return {
    instance_id: INSTANCE_ID,
    tenant_id: "t1",
    presence: "offline",
    sandbox_id: null,
    runtime_kind: "daytona",
    agent_snapshot_id: "snap-1",
    s3_vault_prefix: "tenants/t1/vault/",
    last_activity_at: null,
    revoked_at: null,
    ...overrides,
  };
}

function ensureResponse(
  overrides: Partial<EnsureOnlineResponse> = {},
): EnsureOnlineResponse {
  return {
    instance_id: INSTANCE_ID,
    tenant_id: "t1",
    presence: "online",
    sandbox_id: "sbx-1",
    runtime_kind: "daytona",
    already_online: false,
    wake_joined: false,
    ...overrides,
  };
}

function fakeClient(opts: {
  presence?: InstancePresenceResponse;
  ensure?: EnsureOnlineResponse;
  presenceError?: Error;
  ensureError?: Error;
}): EnsureOnlineChatClient & {
  getInstancePresence: ReturnType<typeof vi.fn>;
  ensureOnline: ReturnType<typeof vi.fn>;
} {
  return {
    getInstancePresence: vi.fn(async () => {
      if (opts.presenceError) throw opts.presenceError;
      return opts.presence ?? presence();
    }),
    ensureOnline: vi.fn(async () => {
      if (opts.ensureError) throw opts.ensureError;
      return opts.ensure ?? ensureResponse();
    }),
  };
}

describe("ENSURE_ONLINE_ON_CHAT flag (lp-y3j / lp-kng.2.8)", () => {
  it("defaults fail-closed (false) when unset", () => {
    expect(parseEnvFlag(undefined)).toBe(false);
    const config = loadConfig({ CONTROL_PLANE_URL: "http://cp.test" });
    expect(config.ensureOnlineOnChat).toBe(false);
    expect(config.brainRpcEnabled).toBe(false);
  });

  it("accepts truthy ENSURE_ONLINE_ON_CHAT env forms", () => {
    expect(
      loadConfig({
        CONTROL_PLANE_URL: "http://cp.test",
        ENSURE_ONLINE_ON_CHAT: "1",
      }).ensureOnlineOnChat,
    ).toBe(true);
    expect(
      loadConfig({
        CONTROL_PLANE_URL: "http://cp.test",
        ENSURE_ONLINE_ON_CHAT: "true",
      }).ensureOnlineOnChat,
    ).toBe(true);
    expect(
      loadConfig({
        CONTROL_PLANE_URL: "http://cp.test",
        ENSURE_ONLINE_ON_CHAT: "0",
      }).ensureOnlineOnChat,
    ).toBe(false);
  });
});

describe("ensureOnlineBeforeChatDeliver (lp-y3j)", () => {
  it("flag off: pure no-op — never calls presence or ensureOnline", async () => {
    const client = fakeClient({});
    const result = await ensureOnlineBeforeChatDeliver({
      enabled: false,
      authClient: client,
      instanceId: INSTANCE_ID,
    });
    expect(result).toEqual({ action: "skipped", reason: "flag_off" });
    expect(client.getInstancePresence).not.toHaveBeenCalled();
    expect(client.ensureOnline).not.toHaveBeenCalled();
  });

  it("flag on + runtime_kind=ec2: no-op without ensureOnline (no Daytona wake)", async () => {
    const client = fakeClient({
      presence: presence({ runtime_kind: "ec2", presence: "online" }),
    });
    const result = await ensureOnlineBeforeChatDeliver({
      enabled: true,
      authClient: client,
      instanceId: INSTANCE_ID,
    });
    expect(result).toEqual({
      action: "skipped",
      reason: "runtime_kind_not_daytona",
      runtime_kind: "ec2",
      presence: "online",
    });
    expect(client.getInstancePresence).toHaveBeenCalledOnce();
    expect(client.getInstancePresence).toHaveBeenCalledWith(INSTANCE_ID);
    expect(client.ensureOnline).not.toHaveBeenCalled();
  });

  it("offline instance triggers wake (POST ensure-online)", async () => {
    const ensured = ensureResponse({
      presence: "online",
      already_online: false,
      wake_joined: false,
      sandbox_id: "sbx-wake-1",
    });
    const client = fakeClient({
      presence: presence({ presence: "offline", runtime_kind: "daytona" }),
      ensure: ensured,
    });
    const result = await ensureOnlineBeforeChatDeliver({
      enabled: true,
      authClient: client,
      instanceId: INSTANCE_ID,
      waitTimeoutMs: 12_000,
    });
    expect(result).toEqual({ action: "ensured", response: ensured });
    expect(client.getInstancePresence).toHaveBeenCalledOnce();
    expect(client.ensureOnline).toHaveBeenCalledOnce();
    expect(client.ensureOnline).toHaveBeenCalledWith(INSTANCE_ID, {
      wait_timeout_ms: 12_000,
    });
  });

  it("online skips wake (no ensure-online POST)", async () => {
    const client = fakeClient({
      presence: presence({
        presence: "online",
        runtime_kind: "daytona",
        sandbox_id: "sbx-warm",
      }),
    });
    const result = await ensureOnlineBeforeChatDeliver({
      enabled: true,
      authClient: client,
      instanceId: INSTANCE_ID,
    });
    expect(result).toEqual({
      action: "skipped",
      reason: "already_online",
      runtime_kind: "daytona",
      presence: "online",
      sandbox_id: "sbx-warm",
    });
    expect(client.getInstancePresence).toHaveBeenCalledOnce();
    expect(client.ensureOnline).not.toHaveBeenCalled();
  });

  it("waking still POSTs ensure-online (join singleflight / wait)", async () => {
    const ensured = ensureResponse({
      already_online: false,
      wake_joined: true,
      presence: "online",
    });
    const client = fakeClient({
      presence: presence({ presence: "waking", runtime_kind: "daytona" }),
      ensure: ensured,
    });
    const result = await ensureOnlineBeforeChatDeliver({
      enabled: true,
      authClient: client,
      instanceId: INSTANCE_ID,
    });
    expect(result).toEqual({ action: "ensured", response: ensured });
    expect(client.ensureOnline).toHaveBeenCalledWith(INSTANCE_ID, {});
  });

  it("error presence triggers wake retry via ensure-online", async () => {
    const ensured = ensureResponse({ already_online: false });
    const client = fakeClient({
      presence: presence({ presence: "error", runtime_kind: "daytona" }),
      ensure: ensured,
    });
    const result = await ensureOnlineBeforeChatDeliver({
      enabled: true,
      authClient: client,
      instanceId: INSTANCE_ID,
    });
    expect(result.action).toBe("ensured");
    expect(client.ensureOnline).toHaveBeenCalledOnce();
  });

  it("propagates ControlPlaneRequestError from ensureOnline (caller maps HTTP)", async () => {
    const client = fakeClient({
      presence: presence({ runtime_kind: "daytona", presence: "offline" }),
      ensureError: new ControlPlaneRequestError(501, "not_implemented"),
    });
    await expect(
      ensureOnlineBeforeChatDeliver({
        enabled: true,
        authClient: client,
        instanceId: INSTANCE_ID,
      }),
    ).rejects.toMatchObject({ status: 501, message: "not_implemented" });
  });

  it("propagates ControlPlaneRequestError from getInstancePresence", async () => {
    const client = fakeClient({
      presenceError: new ControlPlaneRequestError(404, "Instance not found"),
    });
    await expect(
      ensureOnlineBeforeChatDeliver({
        enabled: true,
        authClient: client,
        instanceId: INSTANCE_ID,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(client.ensureOnline).not.toHaveBeenCalled();
  });
});

describe("raceImmediate + chat kickoff (lp-vqr0.8 / T4)", () => {
  it("raceImmediate returns resolved for an already-settled promise", async () => {
    const raced = await raceImmediate(Promise.resolve(7));
    expect(raced).toEqual({ status: "resolved", value: 7 });
  });

  it("raceImmediate returns pending when the promise is still delayed", async () => {
    let resolveFlight: (value: string) => void = () => {};
    const flight = new Promise<string>((resolve) => {
      resolveFlight = resolve;
    });
    const raced = await raceImmediate(flight);
    expect(raced.status).toBe("pending");
    resolveFlight("done");
    await expect(flight).resolves.toBe("done");
  });

  it("kickoff: delayed CP wake returns waking without waiting wait_timeout_ms", async () => {
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ensured = ensureResponse();
    const client = fakeClient({
      presence: presence({ presence: "offline", runtime_kind: "daytona" }),
    });
    client.ensureOnline = vi.fn(async () => {
      await hold;
      return ensured;
    });
    const started = Date.now();
    const result = await ensureOnlineBeforeChatDeliverKickoff({
      enabled: true,
      authClient: client,
      instanceId: INSTANCE_ID,
      waitTimeoutMs: 30_000,
    });
    const wallMs = Date.now() - started;
    expect(wallMs).toBeLessThan(15_000);
    expect(result.action).toBe("waking");
    if (result.action !== "waking") throw new Error("expected waking");
    expect(result.presence).toBe("offline");
    expect(client.ensureOnline).toHaveBeenCalledWith(INSTANCE_ID, {
      wait_timeout_ms: 30_000,
    });
    release();
    await expect(result.flight).resolves.toEqual(ensured);
  });

  it("kickoff: instant ensure still returns ensured (warm path unchanged)", async () => {
    const ensured = ensureResponse();
    const client = fakeClient({
      presence: presence({ presence: "offline" }),
      ensure: ensured,
    });
    const result = await ensureOnlineBeforeChatDeliverKickoff({
      enabled: true,
      authClient: client,
      instanceId: INSTANCE_ID,
    });
    expect(result).toEqual({ action: "ensured", response: ensured });
  });
});

/**
 * App-level call-site: chat send path invokes the hook before deliver-inbound.
 * Fully faked auth + relay — no network / Daytona / AWS.
 */
describe("chat send path ensure_online call site (lp-y3j)", () => {
  const tenant: TenantContext = {
    tenant_id: "tenant-chat-eo",
    tenant_slug: "demo",
    display_name: "Demo",
    host: "demo.withlanyard.com",
  };
  const userId = "user-chat-eo";
  const instanceId = INSTANCE_ID;

  async function bootChatSend(options: {
    ensureOnlineOnChat: boolean;
    runtimeKind: "ec2" | "daytona";
    /** Initial presence when runtimeKind=daytona (default offline). */
    daytonaPresence?: InstancePresenceState;
    deliverInbound?: () => Promise<{ ok: true } | { ok: false; status: number; error: string }>;
  }) {
    const callOrder: string[] = [];
    let wakeCount = 0;
    const chatThreads = new ChatThreadStore();
    const thread = chatThreads.create({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      title: "EO hook",
    });

    const sessions = new SessionStore();
    const session = await sessions.create({
      userId,
      tenantId: tenant.tenant_id,
      email: "eo@example.com",
    });

    const initialPresence: InstancePresenceState =
      options.runtimeKind === "daytona"
        ? (options.daytonaPresence ?? "offline")
        : "online";

    const getInstancePresence = vi.fn(async () => {
      callOrder.push("getInstancePresence");
      return presence({
        runtime_kind: options.runtimeKind,
        presence: initialPresence,
        sandbox_id: initialPresence === "online" ? "sbx-warm" : null,
      });
    });
    const ensureOnline = vi.fn(async () => {
      callOrder.push("ensureOnline");
      wakeCount += 1;
      return ensureResponse({
        presence: "online",
        already_online: false,
        wake_joined: false,
        sandbox_id: "sbx-woke",
      });
    });
    const deliverInbound = vi.fn(async () => {
      callOrder.push("deliverInbound");
      if (options.deliverInbound) {
        return options.deliverInbound();
      }
      return { ok: true as const };
    });

    const authClient = {
      getUserRbac: async () => ({
        user_id: userId,
        tenant_id: tenant.tenant_id,
        hermes_profile: "default",
        allowed_path_prefixes: ["/"],
        role_names: ["member"],
      }),
      getPrimaryGatewayInstance: async () => ({ instance_id: instanceId }),
      getInstancePresence,
      ensureOnline,
      getActiveSessionShare: async () => null,
    };

    const app = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          sessions,
          chatThreads,
          ensureOnlineOnChat: options.ensureOnlineOnChat,
          authClient: authClient as never,
          relayClient: { deliverInbound } as never,
        },
      ),
    );

    const cookies = {
      lanyard_session: session.sessionId,
      lanyard_csrf: "test-csrf-eo",
    };

    return {
      app,
      cookies,
      threadId: thread.thread_id,
      chatThreads,
      callOrder,
      getWakeCount: () => wakeCount,
      getInstancePresence,
      ensureOnline,
      deliverInbound,
    };
  }

  async function postMessage(
    app: ReturnType<typeof createApp>,
    threadId: string,
    cookies: Record<string, string>,
  ) {
    return app.request(`/api/chat/threads/${threadId}/messages`, {
      method: "POST",
      headers: {
        host: tenant.host,
        "content-type": "application/json",
        cookie: cookieHeader(cookies),
        "x-csrf-token": cookies.lanyard_csrf,
      },
      body: JSON.stringify({ text: "wake then deliver" }),
    });
  }

  it("flag default off: deliverInbound runs; ensureOnline never called", async () => {
    const ctx = await bootChatSend({
      ensureOnlineOnChat: false,
      runtimeKind: "daytona",
    });
    const res = await postMessage(ctx.app, ctx.threadId, ctx.cookies);
    expect(res.status).toBe(200);
    expect(ctx.deliverInbound).toHaveBeenCalledOnce();
    expect(ctx.getInstancePresence).not.toHaveBeenCalled();
    expect(ctx.ensureOnline).not.toHaveBeenCalled();
    expect(ctx.callOrder).toEqual(["deliverInbound"]);
    expect(ctx.getWakeCount()).toBe(0);
  });

  it("offline instance triggers wake then deliver-inbound", async () => {
    const ctx = await bootChatSend({
      ensureOnlineOnChat: true,
      runtimeKind: "daytona",
      daytonaPresence: "offline",
    });
    const res = await postMessage(ctx.app, ctx.threadId, ctx.cookies);
    expect(res.status).toBe(200);
    expect(ctx.callOrder).toEqual([
      "getInstancePresence",
      "ensureOnline",
      "deliverInbound",
    ]);
    expect(ctx.ensureOnline).toHaveBeenCalledWith(instanceId, {});
    expect(ctx.getWakeCount()).toBe(1);
  });

  it("online skips wake then still delivers", async () => {
    const ctx = await bootChatSend({
      ensureOnlineOnChat: true,
      runtimeKind: "daytona",
      daytonaPresence: "online",
    });
    const res = await postMessage(ctx.app, ctx.threadId, ctx.cookies);
    expect(res.status).toBe(200);
    expect(ctx.callOrder).toEqual(["getInstancePresence", "deliverInbound"]);
    expect(ctx.ensureOnline).not.toHaveBeenCalled();
    expect(ctx.getWakeCount()).toBe(0);
    expect(ctx.deliverInbound).toHaveBeenCalledOnce();
  });

  it("flag on + ec2: presence only; no ensureOnline; still delivers", async () => {
    const ctx = await bootChatSend({
      ensureOnlineOnChat: true,
      runtimeKind: "ec2",
    });
    const res = await postMessage(ctx.app, ctx.threadId, ctx.cookies);
    expect(res.status).toBe(200);
    expect(ctx.callOrder).toEqual(["getInstancePresence", "deliverInbound"]);
    expect(ctx.ensureOnline).not.toHaveBeenCalled();
  });

  it("flag off + handshake 502: POST 202 in <15s; deliver after gateway", async () => {
    let connected = false;
    const ctx = await bootChatSend({
      ensureOnlineOnChat: false,
      runtimeKind: "ec2",
      deliverInbound: async () => {
        if (!connected) {
          return {
            ok: false,
            status: 502,
            error: "Gateway not connected or handshake incomplete",
          };
        }
        return { ok: true };
      },
    });
    const started = Date.now();
    const res = await postMessage(ctx.app, ctx.threadId, ctx.cookies);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({
      ok: true,
      status: "agent_starting",
      thread_id: ctx.threadId,
    });
    expect(ctx.ensureOnline).not.toHaveBeenCalled();
    expect(ctx.chatThreads.listHistory(ctx.threadId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "user_message",
          content: "wake then deliver",
        }),
      ]),
    );

    connected = true;
    await vi.waitFor(() => {
      expect(ctx.chatThreads.listHistory(ctx.threadId)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "user_message",
            content: "wake then deliver",
          }),
        ]),
      );
    });
  });

  it("flag on + stale online + handshake 502: 202 not 502", async () => {
    let connected = false;
    const ctx = await bootChatSend({
      ensureOnlineOnChat: true,
      runtimeKind: "daytona",
      daytonaPresence: "online",
      deliverInbound: async () => {
        if (!connected) {
          return {
            ok: false,
            status: 502,
            error: "Gateway not connected or handshake incomplete",
          };
        }
        return { ok: true };
      },
    });
    const started = Date.now();
    const res = await postMessage(ctx.app, ctx.threadId, ctx.cookies);
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({
      status: "agent_starting",
    });
    expect(ctx.ensureOnline).not.toHaveBeenCalled();
    connected = true;
    await vi.waitFor(() => {
      expect(ctx.deliverInbound.mock.calls.length).toBeGreaterThan(1);
    });
  });

  it("generic relay 502 is still a hard Send failure", async () => {
    const ctx = await bootChatSend({
      ensureOnlineOnChat: false,
      runtimeKind: "ec2",
      deliverInbound: async () => ({
        ok: false,
        status: 502,
        error: "Relay down",
      }),
    });
    const res = await postMessage(ctx.app, ctx.threadId, ctx.cookies);
    expect(res.status).toBe(502);
    expect(ctx.deliverInbound).toHaveBeenCalledOnce();
    expect(ctx.chatThreads.listHistory(ctx.threadId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "user_message",
          content: "wake then deliver",
        }),
      ]),
    );
  });
});

/**
 * lp-mrh — wake failures: structured errors, no silent drop of user message.
 */
describe("chat send wake failure mapping (lp-mrh)", () => {
  const tenant: TenantContext = {
    tenant_id: "tenant-chat-mrh",
    tenant_slug: "demo",
    display_name: "Demo",
    host: "demo.withlanyard.com",
  };
  const userId = "user-chat-mrh";
  const instanceId = INSTANCE_ID;

  async function bootWithEnsureError(ensureError: ControlPlaneRequestError) {
    const chatThreads = new ChatThreadStore();
    const thread = chatThreads.create({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      title: "MRH fail",
    });

    const sessions = new SessionStore();
    const session = await sessions.create({
      userId,
      tenantId: tenant.tenant_id,
      email: "mrh@example.com",
    });

    const getInstancePresence = vi.fn(async () =>
      presence({ runtime_kind: "daytona", presence: "offline" }),
    );
    const ensureOnline = vi.fn(async () => {
      throw ensureError;
    });
    const deliverInbound = vi.fn(async () => ({ ok: true as const }));

    const authClient = {
      getUserRbac: async () => ({
        user_id: userId,
        tenant_id: tenant.tenant_id,
        hermes_profile: "default",
        allowed_path_prefixes: ["/"],
        role_names: ["member"],
      }),
      getPrimaryGatewayInstance: async () => ({ instance_id: instanceId }),
      getInstancePresence,
      ensureOnline,
      getActiveSessionShare: async () => null,
    };

    const app = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          sessions,
          chatThreads,
          ensureOnlineOnChat: true,
          authClient: authClient as never,
          relayClient: { deliverInbound } as never,
        },
      ),
    );

    return {
      app,
      cookies: {
        lanyard_session: session.sessionId,
        lanyard_csrf: "test-csrf-mrh",
      },
      threadId: thread.thread_id,
      chatThreads,
      deliverInbound,
      ensureOnline,
    };
  }

  async function postMessage(
    app: ReturnType<typeof createApp>,
    threadId: string,
    cookies: Record<string, string>,
    text = "please do not drop me",
  ) {
    return app.request(`/api/chat/threads/${threadId}/messages`, {
      method: "POST",
      headers: {
        host: tenant.host,
        "content-type": "application/json",
        cookie: cookieHeader(cookies),
        "x-csrf-token": cookies.lanyard_csrf,
      },
      body: JSON.stringify({ text }),
    });
  }

  it("timeout → 504 wake_timeout + retryable; no deliver; bubble already persisted", async () => {
    const ctx = await bootWithEnsureError(
      new ControlPlaneRequestError(
        504,
        "ensure_online timed out",
        "ENSURE_ONLINE_TIMEOUT",
      ),
    );
    const res = await postMessage(ctx.app, ctx.threadId, ctx.cookies);
    expect(res.status).toBe(504);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      code: "wake_timeout",
      error: "wake_timeout",
      retryable: true,
      phase: "ensure_online",
      cp_code: "ENSURE_ONLINE_TIMEOUT",
    });
    expect(typeof body.message).toBe("string");
    expect(typeof body.retry_guidance).toBe("string");
    expect(String(body.message)).toMatch(/not delivered/i);

    // Wake fail still does not deliver. lp-v62i.11: bubble is already durable.
    expect(ctx.deliverInbound).not.toHaveBeenCalled();
    expect(ctx.ensureOnline).toHaveBeenCalledOnce();
    expect(ctx.chatThreads.listHistory(ctx.threadId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "user_message",
          content: "please do not drop me",
        }),
      ]),
    );
  });

  it("Daytona down → 502 daytona_unavailable retryable; no deliver", async () => {
    const ctx = await bootWithEnsureError(
      new ControlPlaneRequestError(
        502,
        "Daytona API down",
        "ENSURE_ONLINE_WAKE_FAILED",
      ),
    );
    const res = await postMessage(ctx.app, ctx.threadId, ctx.cookies);
    expect(res.status).toBe(502);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("daytona_unavailable");
    expect(body.retryable).toBe(true);
    expect(ctx.deliverInbound).not.toHaveBeenCalled();
    expect(ctx.chatThreads.listHistory(ctx.threadId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "user_message",
          content: "please do not drop me",
        }),
      ]),
    );
  });

  it("vault mount fail → 502 vault_mount_failed not retryable; no deliver", async () => {
    const ctx = await bootWithEnsureError(
      new ControlPlaneRequestError(
        502,
        "s3_vault_prefix is required for vault mount",
        "ENSURE_ONLINE_WAKE_FAILED",
      ),
    );
    const res = await postMessage(ctx.app, ctx.threadId, ctx.cookies);
    expect(res.status).toBe(502);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("vault_mount_failed");
    expect(body.retryable).toBe(false);
    expect(ctx.deliverInbound).not.toHaveBeenCalled();
    expect(ctx.chatThreads.listHistory(ctx.threadId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "user_message",
          content: "please do not drop me",
        }),
      ]),
    );
  });
});

/**
 * lp-vqr0.8 / T4 — chat POST must not hold CloudFront for wait_timeout_ms.
 * Fake CP delays the wake; handler wall is well under 15s; body/SSE carry
 * agent_starting; deliver runs after the flight settles.
 */
describe("chat POST detaches from delayed ensure_online (lp-vqr0.8 T4)", () => {
  const tenant: TenantContext = {
    tenant_id: "tenant-chat-t4",
    tenant_slug: "demo",
    display_name: "Demo",
    host: "demo.withlanyard.com",
  };
  const userId = "user-chat-t4";
  const instanceId = INSTANCE_ID;

  async function bootDelayedWake() {
    let releaseWake: () => void = () => {};
    const holdWake = new Promise<void>((resolve) => {
      releaseWake = resolve;
    });
    const chatThreads = new ChatThreadStore();
    const thread = chatThreads.create({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      title: "T4 detach",
    });
    const sessions = new SessionStore();
    const session = await sessions.create({
      userId,
      tenantId: tenant.tenant_id,
      email: "t4@example.com",
    });
    const ensureOnline = vi.fn(async () => {
      await holdWake;
      return ensureResponse({
        presence: "online",
        already_online: false,
        wake_joined: false,
        sandbox_id: "sbx-t4",
      });
    });
    const deliverInbound = vi.fn(async () => ({ ok: true as const }));
    const app = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          sessions,
          chatThreads,
          ensureOnlineOnChat: true,
          authClient: {
            getUserRbac: async () => ({
              user_id: userId,
              tenant_id: tenant.tenant_id,
              hermes_profile: "default",
              allowed_path_prefixes: ["/"],
              role_names: ["member"],
            }),
            getPrimaryGatewayInstance: async () => ({ instance_id: instanceId }),
            getInstancePresence: vi.fn(async () =>
              presence({ runtime_kind: "daytona", presence: "offline" }),
            ),
            ensureOnline,
            getActiveSessionShare: async () => null,
          } as never,
          relayClient: { deliverInbound } as never,
        },
      ),
    );
    return {
      app,
      cookies: {
        lanyard_session: session.sessionId,
        lanyard_csrf: "test-csrf-t4",
      },
      threadId: thread.thread_id,
      chatThreads,
      ensureOnline,
      deliverInbound,
      releaseWake,
    };
  }

  it("delayed wake: POST 202 agent_starting in <15s; deliver after flight", async () => {
    const ctx = await bootDelayedWake();
    const started = Date.now();
    const res = await ctx.app.request(
      `/api/chat/threads/${ctx.threadId}/messages`,
      {
        method: "POST",
        headers: {
          host: tenant.host,
          "content-type": "application/json",
          cookie: cookieHeader(ctx.cookies),
          "x-csrf-token": ctx.cookies.lanyard_csrf,
        },
        body: JSON.stringify({ text: "do not hold CloudFront" }),
      },
    );
    const wallMs = Date.now() - started;
    expect(wallMs).toBeLessThan(15_000);
    expect(res.status).toBe(202);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      status: "agent_starting",
      thread_id: ctx.threadId,
      instance_id: instanceId,
      presence: "offline",
      message: AGENT_STARTING_MESSAGE,
    });
    expect(ctx.ensureOnline).toHaveBeenCalledOnce();
    expect(ctx.deliverInbound).not.toHaveBeenCalled();
    expect(ctx.chatThreads.listHistory(ctx.threadId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "user_message",
          content: "do not hold CloudFront",
        }),
      ]),
    );

    ctx.releaseWake();
    await vi.waitFor(() => {
      expect(ctx.deliverInbound).toHaveBeenCalledOnce();
    });
    expect(ctx.chatThreads.listHistory(ctx.threadId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "user_message",
          content: "do not hold CloudFront",
        }),
      ]),
    );
  });
});

/**
 * lp-vqr0.6 / T5 — ENSURE_ONLINE_ON_CHAT + bound stopped sandbox.
 * Send still POSTs ensure-online (does not skip as already_online) and the
 * fake Daytona spy must not increment create. CP T1 owns the real LocalDaytona
 * client; this call site proves Send does not take an unbound create path.
 */
describe("T5 ENSURE_ONLINE_ON_CHAT bound stopped never creates (lp-vqr0.6)", () => {
  const tenant: TenantContext = {
    tenant_id: "tenant-chat-t5",
    tenant_slug: "demo",
    display_name: "Demo",
    host: "demo.withlanyard.com",
  };
  const userId = "user-chat-t5";
  const instanceId = INSTANCE_ID;
  const BOUND_ID = "sbx-bound-stopped";

  function createLocalDaytonaCp(initialSandboxId: string | null) {
    let presenceState: InstancePresenceState = "offline";
    let sandboxId: string | null = initialSandboxId;
    let createCount = 0;
    let startCount = 0;
    return {
      getInstancePresence: vi.fn(async () =>
        presence({
          runtime_kind: "daytona",
          presence: presenceState,
          sandbox_id: sandboxId,
        }),
      ),
      ensureOnline: vi.fn(async () => {
        if (sandboxId) {
          startCount += 1;
          presenceState = "online";
          return ensureResponse({
            presence: "online",
            already_online: false,
            wake_joined: false,
            sandbox_id: sandboxId,
          });
        }
        createCount += 1;
        sandboxId = "sbx-cold-create";
        presenceState = "online";
        return ensureResponse({
          presence: "online",
          already_online: false,
          wake_joined: false,
          sandbox_id: sandboxId,
        });
      }),
      stats: () => ({ createCount, startCount, sandboxId, presenceState }),
    };
  }

  async function bootSend(cp: ReturnType<typeof createLocalDaytonaCp>) {
    const chatThreads = new ChatThreadStore();
    const thread = chatThreads.create({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      title: "T5 bound",
    });
    const sessions = new SessionStore();
    const session = await sessions.create({
      userId,
      tenantId: tenant.tenant_id,
      email: "t5@example.com",
    });
    const deliverInbound = vi.fn(async () => ({ ok: true as const }));
    const app = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          sessions,
          chatThreads,
          ensureOnlineOnChat: true,
          authClient: {
            getUserRbac: async () => ({
              user_id: userId,
              tenant_id: tenant.tenant_id,
              hermes_profile: "default",
              allowed_path_prefixes: ["/"],
              role_names: ["member"],
            }),
            getPrimaryGatewayInstance: async () => ({ instance_id: instanceId }),
            getInstancePresence: cp.getInstancePresence,
            ensureOnline: cp.ensureOnline,
            getActiveSessionShare: async () => null,
          } as never,
          relayClient: { deliverInbound } as never,
        },
      ),
    );
    return {
      app,
      cookies: {
        lanyard_session: session.sessionId,
        lanyard_csrf: "test-csrf-t5",
      },
      threadId: thread.thread_id,
      deliverInbound,
    };
  }

  async function postMessage(
    app: ReturnType<typeof createApp>,
    threadId: string,
    cookies: Record<string, string>,
  ) {
    return app.request(`/api/chat/threads/${threadId}/messages`, {
      method: "POST",
      headers: {
        host: tenant.host,
        "content-type": "application/json",
        cookie: cookieHeader(cookies),
        "x-csrf-token": cookies.lanyard_csrf,
      },
      body: JSON.stringify({ text: "send on bound stopped" }),
    });
  }

  it("hook: bound stopped still POSTs ensure-online (does not skip)", async () => {
    const ensured = ensureResponse({
      sandbox_id: BOUND_ID,
      already_online: false,
    });
    const client = fakeClient({
      presence: presence({
        presence: "offline",
        runtime_kind: "daytona",
        sandbox_id: BOUND_ID,
      }),
      ensure: ensured,
    });
    const result = await ensureOnlineBeforeChatDeliver({
      enabled: true,
      authClient: client,
      instanceId: INSTANCE_ID,
    });
    expect(result).toEqual({ action: "ensured", response: ensured });
    expect(client.ensureOnline).toHaveBeenCalledOnce();
    expect(client.ensureOnline).toHaveBeenCalledWith(INSTANCE_ID, {});
  });

  it("Send with bound stopped sandbox_id starts; create is not called", async () => {
    const cp = createLocalDaytonaCp(BOUND_ID);
    const ctx = await bootSend(cp);
    const res = await postMessage(ctx.app, ctx.threadId, ctx.cookies);
    expect(res.status).toBe(200);
    expect(cp.ensureOnline).toHaveBeenCalledOnce();
    expect(cp.ensureOnline).toHaveBeenCalledWith(instanceId, {});
    expect(cp.stats().createCount).toBe(0);
    expect(cp.stats().startCount).toBe(1);
    expect(cp.stats().sandboxId).toBe(BOUND_ID);
    expect(ctx.deliverInbound).toHaveBeenCalledOnce();
  });

  it("control: unbound offline Send still creates so the spy is live", async () => {
    const cp = createLocalDaytonaCp(null);
    const ctx = await bootSend(cp);
    const res = await postMessage(ctx.app, ctx.threadId, ctx.cookies);
    expect(res.status).toBe(200);
    expect(cp.stats().createCount).toBe(1);
    expect(cp.stats().startCount).toBe(0);
    expect(ctx.deliverInbound).toHaveBeenCalledOnce();
  });
});

