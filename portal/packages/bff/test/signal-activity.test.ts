/**
 * lp-96v — BFF activity signals: message, tool_progress, brain_rpc (fake CP).
 *
 * Acceptance:
 * - Listed events call signal-activity
 * - Does not require Daytona round-trip per token
 * - Tests with fakes
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { createApp } from "../src/app.js";
import {
  createRelayBrainRpcInvoker,
} from "../src/backend-runtime-compose.js";
import { ChatThreadStore } from "../src/chat-store.js";
import { loadConfig, parseEnvFlag } from "../src/config.js";
import type {
  SignalActivityRequest,
  SignalActivityResponse,
} from "../src/control-plane-client.js";
import { SessionStore } from "../src/session.js";
import {
  buildSignalActivityBody,
  midTurnForSource,
  resetSignalActivityDebounceStateForTests,
  signalActivityIfNeeded,
  type SignalActivityHookClient,
} from "../src/signal-activity.js";
import type { TenantContext } from "../src/types.js";
import { cookieHeader, createTestBindings } from "./test-helpers.js";

const INSTANCE_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function signalResponse(
  overrides: Partial<SignalActivityResponse> = {},
): SignalActivityResponse {
  return {
    instance_id: INSTANCE_ID,
    tenant_id: "t1",
    presence: "online",
    last_activity_at: "2026-08-05T00:00:00.000Z",
    mid_turn: false,
    mid_turn_until: null,
    ...overrides,
  };
}

function fakeSignalClient(opts: {
  response?: SignalActivityResponse;
  error?: Error;
  calls?: SignalActivityRequest[];
}): SignalActivityHookClient & {
  signalActivity: ReturnType<typeof vi.fn>;
} {
  const calls = opts.calls ?? [];
  return {
    signalActivity: vi.fn(async (_id: string, body: SignalActivityRequest = {}) => {
      calls.push(body);
      if (opts.error) throw opts.error;
      return opts.response ?? signalResponse();
    }),
  };
}

beforeEach(() => {
  resetSignalActivityDebounceStateForTests();
});

describe("SIGNAL_ACTIVITY_ENABLED flag (lp-96v)", () => {
  it("defaults fail-closed (false) when unset", () => {
    expect(parseEnvFlag(undefined)).toBe(false);
    const config = loadConfig({ CONTROL_PLANE_URL: "http://cp.test" });
    expect(config.signalActivityEnabled).toBe(false);
  });

  it("accepts truthy SIGNAL_ACTIVITY_ENABLED env forms", () => {
    expect(
      loadConfig({
        CONTROL_PLANE_URL: "http://cp.test",
        SIGNAL_ACTIVITY_ENABLED: "1",
      }).signalActivityEnabled,
    ).toBe(true);
    expect(
      loadConfig({
        CONTROL_PLANE_URL: "http://cp.test",
        SIGNAL_ACTIVITY_ENABLED: "true",
      }).signalActivityEnabled,
    ).toBe(true);
    expect(
      loadConfig({
        CONTROL_PLANE_URL: "http://cp.test",
        SIGNAL_ACTIVITY_ENABLED: "0",
      }).signalActivityEnabled,
    ).toBe(false);
  });
});

describe("midTurnForSource / buildSignalActivityBody (lp-96v)", () => {
  it("message, toolbox, and tool_progress arm mid_turn; brain_rpc omits", () => {
    expect(midTurnForSource("message")).toBe(true);
    expect(midTurnForSource("toolbox")).toBe(true);
    expect(midTurnForSource("tool_progress")).toBe(true);
    expect(midTurnForSource("brain_rpc")).toBeUndefined();
    expect(buildSignalActivityBody("message")).toEqual({ mid_turn: true });
    expect(buildSignalActivityBody("toolbox")).toEqual({ mid_turn: true });
    expect(buildSignalActivityBody("tool_progress")).toEqual({
      mid_turn: true,
    });
    expect(buildSignalActivityBody("brain_rpc")).toEqual({});
  });

  it("explicit override wins; null omits mid_turn", () => {
    expect(buildSignalActivityBody("message", false)).toEqual({
      mid_turn: false,
    });
    expect(buildSignalActivityBody("brain_rpc", true)).toEqual({
      mid_turn: true,
    });
    expect(buildSignalActivityBody("message", null)).toEqual({});
  });
});

describe("signalActivityIfNeeded (lp-96v)", () => {
  it("flag off: message still signals (lp-v62i.8 — sends must arm mid_turn)", async () => {
    const client = fakeSignalClient({});
    const result = await signalActivityIfNeeded({
      enabled: false,
      authClient: client,
      instanceId: INSTANCE_ID,
      source: "message",
    });
    expect(result.action).toBe("signaled");
    expect(client.signalActivity).toHaveBeenCalledOnce();
    expect(client.signalActivity).toHaveBeenCalledWith(INSTANCE_ID, {
      mid_turn: true,
    });
  });

  it("flag off: toolbox source still POSTs mid_turn true (lp-k5c4.7)", async () => {
    const client = fakeSignalClient({});
    const result = await signalActivityIfNeeded({
      enabled: false,
      authClient: client,
      instanceId: INSTANCE_ID,
      source: "toolbox",
    });
    expect(result.action).toBe("signaled");
    expect(client.signalActivity).toHaveBeenCalledOnce();
    expect(client.signalActivity).toHaveBeenCalledWith(INSTANCE_ID, {
      mid_turn: true,
    });
  });

  it("flag off: ambient sources stay pure no-op — never call signalActivity", async () => {
    for (const source of ["tool_progress", "brain_rpc"] as const) {
      const client = fakeSignalClient({});
      const result = await signalActivityIfNeeded({
        enabled: false,
        authClient: client,
        instanceId: INSTANCE_ID,
        source,
      });
      expect(result).toEqual({ action: "skipped", reason: "flag_off" });
      expect(client.signalActivity).not.toHaveBeenCalled();
    }
  });

  it("message source calls signal-activity with mid_turn true", async () => {
    const client = fakeSignalClient({});
    const result = await signalActivityIfNeeded({
      enabled: true,
      authClient: client,
      instanceId: INSTANCE_ID,
      source: "message",
    });
    expect(result.action).toBe("signaled");
    expect(client.signalActivity).toHaveBeenCalledOnce();
    expect(client.signalActivity).toHaveBeenCalledWith(INSTANCE_ID, {
      mid_turn: true,
    });
  });

  it("brain_rpc source calls signal-activity without mid_turn", async () => {
    const client = fakeSignalClient({});
    const result = await signalActivityIfNeeded({
      enabled: true,
      authClient: client,
      instanceId: INSTANCE_ID,
      source: "brain_rpc",
    });
    expect(result.action).toBe("signaled");
    expect(client.signalActivity).toHaveBeenCalledWith(INSTANCE_ID, {});
  });

  it("tool_progress debounces — second call within interval is skipped", async () => {
    const client = fakeSignalClient({});
    const lastSignaledAt = new Map<string, number>();
    let now = 1_000_000;

    const first = await signalActivityIfNeeded({
      enabled: true,
      authClient: client,
      instanceId: INSTANCE_ID,
      source: "tool_progress",
      minIntervalMs: 30_000,
      lastSignaledAt,
      nowMs: () => now,
    });
    expect(first.action).toBe("signaled");

    now += 5_000; // still within 30s
    const second = await signalActivityIfNeeded({
      enabled: true,
      authClient: client,
      instanceId: INSTANCE_ID,
      source: "tool_progress",
      minIntervalMs: 30_000,
      lastSignaledAt,
      nowMs: () => now,
    });
    expect(second).toEqual({
      action: "skipped",
      reason: "debounced",
      source: "tool_progress",
    });
    expect(client.signalActivity).toHaveBeenCalledOnce();

    now += 30_000; // past debounce
    const third = await signalActivityIfNeeded({
      enabled: true,
      authClient: client,
      instanceId: INSTANCE_ID,
      source: "tool_progress",
      minIntervalMs: 30_000,
      lastSignaledAt,
      nowMs: () => now,
    });
    expect(third.action).toBe("signaled");
    expect(client.signalActivity).toHaveBeenCalledTimes(2);
  });

  it("message is not debounced (always posts when flag on)", async () => {
    const client = fakeSignalClient({});
    const lastSignaledAt = new Map<string, number>();
    const nowMs = () => 1_000_000;
    await signalActivityIfNeeded({
      enabled: true,
      authClient: client,
      instanceId: INSTANCE_ID,
      source: "message",
      lastSignaledAt,
      nowMs,
    });
    await signalActivityIfNeeded({
      enabled: true,
      authClient: client,
      instanceId: INSTANCE_ID,
      source: "message",
      lastSignaledAt,
      nowMs,
    });
    expect(client.signalActivity).toHaveBeenCalledTimes(2);
  });

  it("CP failure is best-effort (failed result, no throw)", async () => {
    const client = fakeSignalClient({
      error: new Error("cp down"),
    });
    const result = await signalActivityIfNeeded({
      enabled: true,
      authClient: client,
      instanceId: INSTANCE_ID,
      source: "message",
    });
    expect(result.action).toBe("failed");
    if (result.action === "failed") {
      expect(result.error).toBeInstanceOf(Error);
    }
  });
});

/**
 * App-level: chat message path signals activity after deliver (fake CP + relay).
 */
describe("chat message path signal-activity call site (lp-96v)", () => {
  const tenant: TenantContext = {
    tenant_id: "tenant-act-msg",
    tenant_slug: "demo",
    display_name: "Demo",
    host: "demo.withlanyard.com",
  };
  const userId = "user-act-msg";

  async function boot(options: { signalActivityEnabled: boolean }) {
    const callOrder: string[] = [];
    const chatThreads = new ChatThreadStore();
    const thread = chatThreads.create({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      title: "Activity",
    });
    const sessions = new SessionStore();
    const session = await sessions.create({
      userId,
      tenantId: tenant.tenant_id,
      email: "act@example.com",
    });

    const signalActivity = vi.fn(async () => {
      callOrder.push("signalActivity");
      return signalResponse({ mid_turn: true });
    });
    const deliverInbound = vi.fn(async () => {
      callOrder.push("deliverInbound");
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
      getPrimaryGatewayInstance: async () => ({ instance_id: INSTANCE_ID }),
      signalActivity,
      getActiveSessionShare: async () => null,
    };

    const app = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          sessions,
          chatThreads,
          signalActivityEnabled: options.signalActivityEnabled,
          authClient: authClient as never,
          relayClient: { deliverInbound } as never,
        },
      ),
    );

    return {
      app,
      threadId: thread.thread_id,
      cookies: {
        lanyard_session: session.sessionId,
        lanyard_csrf: "test-csrf-act",
      },
      callOrder,
      signalActivity,
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
      body: JSON.stringify({ text: "hello activity" }),
    });
  }

  it("flag off: deliver runs; message signalActivity still arms mid_turn (lp-v62i.8)", async () => {
    const ctx = await boot({ signalActivityEnabled: false });
    const res = await postMessage(ctx.app, ctx.threadId, ctx.cookies);
    expect(res.status).toBe(200);
    expect(ctx.deliverInbound).toHaveBeenCalledOnce();
    // lp-v62i.8: user sends are not flag-gated — idle-reap protection holds
    // even when SIGNAL_ACTIVITY_ENABLED is unset on the BFF (live :50).
    expect(ctx.signalActivity).toHaveBeenCalledOnce();
    expect(ctx.signalActivity).toHaveBeenCalledWith(INSTANCE_ID, {
      mid_turn: true,
    });
  });

  it("flag on: message calls signal-activity after deliver", async () => {
    const ctx = await boot({ signalActivityEnabled: true });
    const res = await postMessage(ctx.app, ctx.threadId, ctx.cookies);
    expect(res.status).toBe(200);
    // deliver then signal (best-effort after success)
    expect(ctx.callOrder).toEqual(["deliverInbound", "signalActivity"]);
    expect(ctx.signalActivity).toHaveBeenCalledWith(INSTANCE_ID, {
      mid_turn: true,
    });
  });

  it("signalActivity failure does not fail the chat response", async () => {
    const chatThreads = new ChatThreadStore();
    const thread = chatThreads.create({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      title: "Activity fail",
    });
    const sessions = new SessionStore();
    const session = await sessions.create({
      userId,
      tenantId: tenant.tenant_id,
      email: "act@example.com",
    });
    const signalActivity = vi.fn(async () => {
      throw new Error("cp unavailable");
    });
    const app = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          sessions,
          chatThreads,
          signalActivityEnabled: true,
          authClient: {
            getUserRbac: async () => ({
              user_id: userId,
              tenant_id: tenant.tenant_id,
              hermes_profile: "default",
              allowed_path_prefixes: ["/"],
              role_names: ["member"],
            }),
            getPrimaryGatewayInstance: async () => ({
              instance_id: INSTANCE_ID,
            }),
            signalActivity,
            getActiveSessionShare: async () => null,
          } as never,
          relayClient: {
            deliverInbound: async () => ({ ok: true as const }),
          } as never,
        },
      ),
    );
    const cookies = {
      lanyard_session: session.sessionId,
      lanyard_csrf: "test-csrf-act-fail",
    };
    const res = await postMessage(app, thread.thread_id, cookies);
    expect(res.status).toBe(200);
    // best-effort is fire-and-forget; give microtask a tick
    await Promise.resolve();
    await Promise.resolve();
    expect(signalActivity).toHaveBeenCalled();
  });
});

/**
 * App-level SSE: tool_progress signals; message_send tokens do not (lp-96v).
 */
describe("SSE tool_progress signal-activity (lp-96v; not per token)", () => {
  const tenant: TenantContext = {
    tenant_id: "tenant-act-sse",
    tenant_slug: "demo",
    display_name: "Demo",
    host: "demo.withlanyard.com",
  };
  const userId = "user-act-sse";

  async function bootSse(streamBody: string) {
    const chatThreads = new ChatThreadStore();
    const thread = chatThreads.create({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      title: "SSE activity",
    });
    const sessions = new SessionStore();
    const session = await sessions.create({
      userId,
      tenantId: tenant.tenant_id,
      email: "sse@example.com",
    });

    const signalActivity = vi.fn(async () => signalResponse({ mid_turn: true }));

    const encoder = new TextEncoder();
    const openChatEventStream = vi.fn(async () => ({
      ok: true as const,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(streamBody));
          controller.close();
        },
      }),
    }));

    const app = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          sessions,
          chatThreads,
          signalActivityEnabled: true,
          authClient: {
            getUserRbac: async () => ({
              user_id: userId,
              tenant_id: tenant.tenant_id,
              hermes_profile: "default",
              allowed_path_prefixes: ["/"],
              role_names: ["member"],
            }),
            getPrimaryGatewayInstance: async () => ({
              instance_id: INSTANCE_ID,
            }),
            signalActivity,
            getActiveSessionShare: async () => null,
          } as never,
          relayClient: { openChatEventStream } as never,
        },
      ),
    );

    return {
      app,
      threadId: thread.thread_id,
      cookies: {
        lanyard_session: session.sessionId,
        lanyard_csrf: "test-csrf-sse",
      },
      signalActivity,
    };
  }

  it("tool_progress event calls signal-activity", async () => {
    resetSignalActivityDebounceStateForTests();
    const line =
      `data: ${JSON.stringify({
        type: "tool_progress",
        chat_id: "c1",
        tool_name: "bash",
        tool_status: "running",
      })}\n`;
    const ctx = await bootSse(line);
    const res = await ctx.app.request(
      `/api/chat/threads/${ctx.threadId}/events`,
      {
        headers: {
          host: tenant.host,
          cookie: cookieHeader(ctx.cookies),
        },
      },
    );
    expect(res.status).toBe(200);
    // consume stream
    await res.text();
    // allow best-effort microtasks
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.signalActivity).toHaveBeenCalled();
    expect(ctx.signalActivity).toHaveBeenCalledWith(INSTANCE_ID, {
      mid_turn: true,
    });
  });

  it("message_send stream tokens do NOT call signal-activity", async () => {
    resetSignalActivityDebounceStateForTests();
    const tokens = ["Hello", " world", "!"];
    const body = tokens
      .map(
        (content) =>
          `data: ${JSON.stringify({
            type: "message_send",
            chat_id: "c1",
            message_id: "m1",
            content,
          })}\n`,
      )
      .join("");
    const ctx = await bootSse(body);
    const res = await ctx.app.request(
      `/api/chat/threads/${ctx.threadId}/events`,
      {
        headers: {
          host: tenant.host,
          cookie: cookieHeader(ctx.cookies),
        },
      },
    );
    expect(res.status).toBe(200);
    await res.text();
    await Promise.resolve();
    await Promise.resolve();
    expect(ctx.signalActivity).not.toHaveBeenCalled();
  });
});

/**
 * Brain RPC invoker call site (production compose) signals brain_rpc source.
 */
describe("brain_rpc invoker signal-activity call site (lp-96v)", () => {
  const ctx = {
    tenantId: "t1",
    instanceId: INSTANCE_ID,
    userId: "u1",
    sessionId: "s1",
    profile: {
      name: "default",
      pathPrefixes: ["/"],
      hermesProfileAlias: "default",
    },
    roles: ["member"],
    timeoutMs: 5_000,
  };

  function okResult() {
    return {
      ok: true as const,
      result: {
        type: "brain_rpc_result" as const,
        contract_version: 1,
        request_id: "req-1",
        ok: true as const,
        result: { pong: true },
        error: null,
      },
    };
  }

  it("flag on: signals before invokeBrainRpc; no Daytona in path", async () => {
    const callOrder: string[] = [];
    const signalActivity = vi.fn(async () => {
      callOrder.push("signalActivity");
      return signalResponse();
    });
    const invokeBrainRpc = vi.fn(async () => {
      callOrder.push("invokeBrainRpc");
      return okResult();
    });

    const invoker = createRelayBrainRpcInvoker(
      { invokeBrainRpc } as never,
      {
        signalActivityEnabled: true,
        authClient: { signalActivity } as never,
      },
    );

    await invoker({ method: "brain.ping", params: {}, ctx: ctx as never });

    expect(callOrder).toEqual(["signalActivity", "invokeBrainRpc"]);
    expect(signalActivity).toHaveBeenCalledWith(INSTANCE_ID, {});
  });

  it("flag off: no signalActivity call", async () => {
    const signalActivity = vi.fn(async () => signalResponse());
    const invokeBrainRpc = vi.fn(async () => okResult());

    const invoker = createRelayBrainRpcInvoker(
      { invokeBrainRpc } as never,
      {
        signalActivityEnabled: false,
        authClient: { signalActivity } as never,
      },
    );

    await invoker({ method: "brain.health", params: {}, ctx: ctx as never });

    expect(signalActivity).not.toHaveBeenCalled();
    expect(invokeBrainRpc).toHaveBeenCalledOnce();
  });
});
