/**
 * lp-v62i.11 — Relay persist-after-deliver swallowed Taste's #test-group send.
 *
 * Harness already persists before startTurn (lp-j39s). Relay used to persist
 * only after successful deliverInbound, so a slow/failed wake or deliver
 * cleared the composer with no durable bubble.
 *
 * Do not flip MAX_WAKES / SIGNAL_ACTIVITY / CHAT_DELIVERY.
 */
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { ChatThreadStore } from "../src/chat-store.js";
import { ControlPlaneRequestError } from "../src/control-plane-client.js";
import { SessionStore } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import { cookieHeader, createTestBindings } from "./test-helpers.js";

const tenant: TenantContext = {
  tenant_id: "tenant-v62i11",
  tenant_slug: "demo",
  display_name: "Demo",
  host: "demo.withlanyard.com",
};
const userId = "user-v62i11";
const instanceId = "452b1348-v62i11-instance";
const BOUND_SANDBOX = "sbx-v62i11-bound";

function userBubble(chatThreads: ChatThreadStore, threadId: string, text: string) {
  return chatThreads.listHistory(threadId).some(
    (event) => event.type === "user_message" && event.content === text,
  );
}

async function boot(options: {
  ensureOnlineOnChat?: boolean;
  daytonaPresence?: "online" | "offline";
  getInstancePresence?: () => Promise<unknown>;
  ensureOnline?: () => Promise<unknown>;
  deliverInbound?: () => Promise<{ ok: true } | { ok: false; status: number; error: string }>;
}) {
  const callOrder: string[] = [];
  let createCount = 0;
  let startCount = 0;
  const chatThreads = new ChatThreadStore();
  const thread = chatThreads.create({
    tenant_id: tenant.tenant_id,
    user_id: userId,
    title: "test-group",
  });
  const sessions = new SessionStore();
  const session = await sessions.create({
    userId,
    tenantId: tenant.tenant_id,
    email: "v62i11@example.com",
  });

  const getInstancePresence = vi.fn(async () => {
    callOrder.push("getInstancePresence");
    if (options.getInstancePresence) {
      return options.getInstancePresence();
    }
    const presence = options.daytonaPresence ?? "online";
    return {
      instance_id: instanceId,
      tenant_id: tenant.tenant_id,
      presence,
      sandbox_id: BOUND_SANDBOX,
      runtime_kind: "daytona" as const,
      agent_snapshot_id: null,
      s3_vault_prefix: null,
      last_activity_at: null,
      revoked_at: null,
    };
  });
  const ensureOnline = vi.fn(async () => {
    callOrder.push("ensureOnline");
    startCount += 1;
    if (options.ensureOnline) {
      return options.ensureOnline();
    }
    return {
      instance_id: instanceId,
      tenant_id: tenant.tenant_id,
      presence: "online" as const,
      sandbox_id: BOUND_SANDBOX,
      runtime_kind: "daytona" as const,
      already_online: false,
      wake_joined: false,
    };
  });
  const deliverInbound = vi.fn(async () => {
    expect(userBubble(chatThreads, thread.thread_id, "hi")).toBe(true);
    callOrder.push("deliverInbound");
    if (options.deliverInbound) {
      return options.deliverInbound();
    }
    return { ok: true as const };
  });

  const app = createApp(
    createTestBindings(
      { [tenant.tenant_slug]: tenant },
      {
        sessions,
        chatThreads,
        // Default chatDelivery is relay. Do not set CHAT_DELIVERY=harness.
        ensureOnlineOnChat: options.ensureOnlineOnChat ?? false,
        authClient: {
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
        } as never,
        relayClient: { deliverInbound } as never,
      },
    ),
  );

  return {
    app,
    chatThreads,
    threadId: thread.thread_id,
    cookies: {
      lanyard_session: session.sessionId,
      lanyard_csrf: "test-csrf-v62i11",
    },
    callOrder,
    deliverInbound,
    ensureOnline,
    getInstancePresence,
    getCreateCount: () => createCount,
    getStartCount: () => startCount,
  };
}

function postHi(
  app: ReturnType<typeof createApp>,
  threadId: string,
  cookies: Record<string, string>,
  text = "hi",
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

describe("lp-v62i.11: relay persist before deliver / ensure-online", () => {
  it("persists bubble before deliverInbound", async () => {
    const ctx = await boot({});
    const res = await postHi(ctx.app, ctx.threadId, ctx.cookies);
    expect(res.status).toBe(200);
    expect(userBubble(ctx.chatThreads, ctx.threadId, "hi")).toBe(true);
    expect(ctx.deliverInbound).toHaveBeenCalledOnce();
    expect(ctx.callOrder).toEqual(["deliverInbound"]);
    expect(ctx.ensureOnline).not.toHaveBeenCalled();
  });

  it("persists even if deliverInbound hangs, then still delivers", async () => {
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ctx = await boot({
      deliverInbound: async () => {
        await hold;
        return { ok: true as const };
      },
    });
    const pending = postHi(ctx.app, ctx.threadId, ctx.cookies);
    await vi.waitFor(() => {
      expect(userBubble(ctx.chatThreads, ctx.threadId, "hi")).toBe(true);
    });
    expect(ctx.deliverInbound).toHaveBeenCalledOnce();
    release();
    const res = await pending;
    expect(res.status).toBe(200);
  });

  it("persists even if deliverInbound returns 502; still called deliver", async () => {
    const ctx = await boot({
      deliverInbound: async () => ({
        ok: false,
        status: 502,
        error: "Relay down",
      }),
    });
    const res = await postHi(ctx.app, ctx.threadId, ctx.cookies);
    expect(res.status).toBe(502);
    expect(ctx.deliverInbound).toHaveBeenCalledOnce();
    expect(userBubble(ctx.chatThreads, ctx.threadId, "hi")).toBe(true);
  });

  it("persists on delayed ensure_online 202 before deliver runs", async () => {
    let releaseWake!: () => void;
    const holdWake = new Promise<void>((resolve) => {
      releaseWake = resolve;
    });
    const ctx = await boot({
      ensureOnlineOnChat: true,
      daytonaPresence: "offline",
      ensureOnline: async () => {
        await holdWake;
        return {
          instance_id: instanceId,
          tenant_id: tenant.tenant_id,
          presence: "online" as const,
          sandbox_id: BOUND_SANDBOX,
          runtime_kind: "daytona" as const,
          already_online: false,
          wake_joined: false,
        };
      },
    });
    const res = await postHi(ctx.app, ctx.threadId, ctx.cookies);
    expect(res.status).toBe(202);
    expect(ctx.deliverInbound).not.toHaveBeenCalled();
    expect(userBubble(ctx.chatThreads, ctx.threadId, "hi")).toBe(true);

    releaseWake();
    await vi.waitFor(() => {
      expect(ctx.deliverInbound).toHaveBeenCalledOnce();
    });
    expect(ctx.getStartCount()).toBe(1);
    expect(ctx.getCreateCount()).toBe(0);
  });

  it("persists on ensure_online timeout; does not deliver", async () => {
    const ctx = await boot({
      ensureOnlineOnChat: true,
      daytonaPresence: "offline",
      ensureOnline: async () => {
        throw new ControlPlaneRequestError(
          504,
          "ensure_online timed out",
          "ENSURE_ONLINE_TIMEOUT",
        );
      },
    });
    const res = await postHi(ctx.app, ctx.threadId, ctx.cookies);
    expect(res.status).toBe(504);
    expect(ctx.deliverInbound).not.toHaveBeenCalled();
    expect(userBubble(ctx.chatThreads, ctx.threadId, "hi")).toBe(true);
  });

  it("persists before a hanging presence probe (kickoff never reaches commitSend)", async () => {
    let releasePresence!: () => void;
    const holdPresence = new Promise<void>((resolve) => {
      releasePresence = resolve;
    });
    const ctx = await boot({
      ensureOnlineOnChat: true,
      getInstancePresence: async () => {
        await holdPresence;
        return {
          instance_id: instanceId,
          tenant_id: tenant.tenant_id,
          presence: "online" as const,
          sandbox_id: BOUND_SANDBOX,
          runtime_kind: "daytona" as const,
          agent_snapshot_id: null,
          s3_vault_prefix: null,
          last_activity_at: null,
          revoked_at: null,
        };
      },
    });
    const pending = postHi(ctx.app, ctx.threadId, ctx.cookies);
    await vi.waitFor(() => {
      expect(userBubble(ctx.chatThreads, ctx.threadId, "hi")).toBe(true);
    });
    expect(ctx.deliverInbound).not.toHaveBeenCalled();
    releasePresence();
    const res = await pending;
    expect(res.status).toBe(200);
    expect(ctx.deliverInbound).toHaveBeenCalledOnce();
  });

  it("stopped box: persist, start-from-stopped reuse, createCount=0, still delivers", async () => {
    const ctx = await boot({
      ensureOnlineOnChat: true,
      daytonaPresence: "offline",
    });
    const res = await postHi(ctx.app, ctx.threadId, ctx.cookies);
    expect(res.status).toBe(200);
    expect(userBubble(ctx.chatThreads, ctx.threadId, "hi")).toBe(true);
    expect(ctx.ensureOnline).toHaveBeenCalledOnce();
    expect(ctx.getStartCount()).toBe(1);
    expect(ctx.getCreateCount()).toBe(0);
    expect(ctx.deliverInbound).toHaveBeenCalledOnce();
    expect(ctx.deliverInbound).toHaveBeenCalledWith(
      expect.objectContaining({ instanceId }),
    );
  });
});
