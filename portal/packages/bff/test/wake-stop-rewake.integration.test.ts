/**
 * lp-cbv — BFF deliver hooks over a full wake / idle-stop / re-wake cycle.
 *
 * Fake CP only (no live Daytona / network). Complements control-plane
 * `wake-stop-rewake.integration.test.ts` which drives real harness (via harness-local.ts).
 *
 * Covers BFF-side acceptance slices of lp-cbv:
 *   - deliver (chat ensure_online before deliver-inbound) on cold offline
 *   - online deliver skips wake
 *   - after simulated idle stop (presence offline), next deliver re-wakes
 *   - activity signal on message (deliver) without requiring Daytona round-trip
 *
 * @see docs/plans/0008-daytona-agent-sandboxes/daytona-wake-stop-rewake.md
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { ChatThreadStore } from "../src/chat-store.js";
import {
  type EnsureOnlineResponse,
  type InstancePresenceResponse,
  type InstancePresenceState,
} from "../src/control-plane-client.js";
import {
  ensureOnlineBeforeChatDeliver,
  type EnsureOnlineChatClient,
} from "../src/ensure-online-chat.js";
import { SessionStore } from "../src/session.js";
import {
  resetSignalActivityDebounceStateForTests,
  signalActivityIfNeeded,
  type SignalActivityHookClient,
} from "../src/signal-activity.js";
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

/**
 * Stateful fake CP: tracks presence/sandbox like a mini orchestrator so
 * deliver → idle stop → re-wake can be exercised without HTTP.
 */
function createStatefulFakeCp() {
  let state: InstancePresenceState = "offline";
  let sandboxId: string | null = null;
  let wakeSeq = 0;
  let ensureCalls = 0;
  let signalCalls = 0;

  const client: EnsureOnlineChatClient &
    SignalActivityHookClient & {
      getInstancePresence: ReturnType<typeof vi.fn>;
      ensureOnline: ReturnType<typeof vi.fn>;
      signalActivity: ReturnType<typeof vi.fn>;
      /** Simulate idle reaper / explicit stop. */
      simulateIdleStop: () => void;
      stats: () => {
        ensureCalls: number;
        signalCalls: number;
        wakeSeq: number;
        presence: InstancePresenceState;
        sandbox_id: string | null;
      };
    } = {
    getInstancePresence: vi.fn(async () =>
      presence({
        presence: state,
        sandbox_id: sandboxId,
        runtime_kind: "daytona",
      }),
    ),
    ensureOnline: vi.fn(async () => {
      ensureCalls += 1;
      if (state === "online" && sandboxId) {
        return ensureResponse({
          presence: "online",
          already_online: true,
          sandbox_id: sandboxId,
        });
      }
      wakeSeq += 1;
      sandboxId = `sbx-wake-${wakeSeq}`;
      state = "online";
      return ensureResponse({
        presence: "online",
        already_online: false,
        sandbox_id: sandboxId,
      });
    }),
    signalActivity: vi.fn(async () => {
      signalCalls += 1;
      return {
        instance_id: INSTANCE_ID,
        tenant_id: "t1",
        presence: state,
        last_activity_at: new Date().toISOString(),
        mid_turn: true,
        mid_turn_until: null,
      };
    }),
    simulateIdleStop() {
      state = "offline";
      sandboxId = null;
    },
    stats: () => ({
      ensureCalls,
      signalCalls,
      wakeSeq,
      presence: state,
      sandbox_id: sandboxId,
    }),
  };

  return client;
}

beforeEach(() => {
  resetSignalActivityDebounceStateForTests();
});

describe("lp-cbv BFF deliver hooks: wake → deliver → idle stop → re-wake", () => {
  it("cold deliver wakes; online deliver skips; post-idle deliver re-wakes", async () => {
    const cp = createStatefulFakeCp();

    // ── Cold wake on first deliver ─────────────────────────────────────
    const first = await ensureOnlineBeforeChatDeliver({
      enabled: true,
      authClient: cp,
      instanceId: INSTANCE_ID,
      waitTimeoutMs: 15_000,
    });
    expect(first.action).toBe("ensured");
    if (first.action === "ensured") {
      expect(first.response.already_online).toBe(false);
      expect(first.response.sandbox_id).toBe("sbx-wake-1");
    }
    expect(cp.ensureOnline).toHaveBeenCalledTimes(1);
    expect(cp.stats().presence).toBe("online");

    // Activity signal on message deliver (no Daytona round-trip required).
    await signalActivityIfNeeded({
      enabled: true,
      authClient: cp,
      instanceId: INSTANCE_ID,
      source: "message",
    });
    expect(cp.stats().signalCalls).toBe(1);

    // ── Second deliver while online → skip wake ────────────────────────
    const second = await ensureOnlineBeforeChatDeliver({
      enabled: true,
      authClient: cp,
      instanceId: INSTANCE_ID,
    });
    expect(second).toEqual({
      action: "skipped",
      reason: "already_online",
      runtime_kind: "daytona",
      presence: "online",
      sandbox_id: "sbx-wake-1",
    });
    expect(cp.ensureOnline).toHaveBeenCalledTimes(1); // no second wake

    // ── Simulated idle stop (CP reaper / LocalDaytona stop) ──────────────
    cp.simulateIdleStop();
    expect(cp.stats().presence).toBe("offline");
    expect(cp.stats().sandbox_id).toBeNull();

    // ── Re-wake on next deliver ────────────────────────────────────────
    const rewake = await ensureOnlineBeforeChatDeliver({
      enabled: true,
      authClient: cp,
      instanceId: INSTANCE_ID,
    });
    expect(rewake.action).toBe("ensured");
    if (rewake.action === "ensured") {
      expect(rewake.response.already_online).toBe(false);
      expect(rewake.response.sandbox_id).toBe("sbx-wake-2");
    }
    expect(cp.ensureOnline).toHaveBeenCalledTimes(2);
    expect(cp.stats().wakeSeq).toBe(2);
    expect(cp.stats().presence).toBe("online");

    // Deliver activity after re-wake
    await signalActivityIfNeeded({
      enabled: true,
      authClient: cp,
      instanceId: INSTANCE_ID,
      source: "message",
    });
    expect(cp.stats().signalCalls).toBe(2);
  });

  it("chat send path: offline wake → deliver; after idle stop, next message re-wakes", async () => {
    const tenant: TenantContext = {
      tenant_id: "tenant-lp-cbv",
      tenant_slug: "demo",
      display_name: "Demo",
      host: "demo.withlanyard.com",
    };
    const userId = "user-lp-cbv";

    let presenceState: InstancePresenceState = "offline";
    let sandboxId: string | null = null;
    let wakeSeq = 0;
    const callOrder: string[] = [];

    const chatThreads = new ChatThreadStore();
    const thread = chatThreads.create({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      title: "lp-cbv cycle",
    });
    const sessions = new SessionStore();
    const session = await sessions.create({
      userId,
      tenantId: tenant.tenant_id,
      email: "cbv@example.com",
    });

    const getInstancePresence = vi.fn(async () => {
      callOrder.push("getInstancePresence");
      return presence({
        runtime_kind: "daytona",
        presence: presenceState,
        sandbox_id: sandboxId,
      });
    });
    const ensureOnline = vi.fn(async () => {
      callOrder.push("ensureOnline");
      wakeSeq += 1;
      sandboxId = `sbx-app-${wakeSeq}`;
      presenceState = "online";
      return ensureResponse({
        presence: "online",
        already_online: false,
        sandbox_id: sandboxId,
      });
    });
    const deliverInbound = vi.fn(async () => {
      callOrder.push("deliverInbound");
      return { ok: true as const };
    });
    const signalActivity = vi.fn(async () => {
      callOrder.push("signalActivity");
      return {
        instance_id: INSTANCE_ID,
        tenant_id: tenant.tenant_id,
        presence: presenceState,
        last_activity_at: new Date().toISOString(),
        mid_turn: true,
        mid_turn_until: null,
      };
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
      getInstancePresence,
      ensureOnline,
      signalActivity,
      getActiveSessionShare: async () => null,
    };

    const app = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          sessions,
          chatThreads,
          ensureOnlineOnChat: true,
          signalActivityEnabled: true,
          authClient: authClient as never,
          relayClient: {
            deliverInbound,
          } as never,
        },
      ),
    );

    const cookies = {
      lanyard_session: session.sessionId,
      lanyard_csrf: "test-csrf-lp-cbv",
    };

    async function postMessage(text: string) {
      return app.request(`/api/chat/threads/${thread.thread_id}/messages`, {
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

    // Message 1: cold wake then deliver
    const r1 = await postMessage("hello after cold start");
    expect(r1.status).toBe(200);
    expect(ensureOnline).toHaveBeenCalledTimes(1);
    expect(deliverInbound).toHaveBeenCalled();
    // ensure before deliver
    const firstEnsureIdx = callOrder.indexOf("ensureOnline");
    const firstDeliverIdx = callOrder.indexOf("deliverInbound");
    expect(firstEnsureIdx).toBeGreaterThanOrEqual(0);
    expect(firstDeliverIdx).toBeGreaterThan(firstEnsureIdx);

    // Idle stop simulation
    presenceState = "offline";
    sandboxId = null;
    callOrder.length = 0;

    // Message 2: re-wake then deliver
    const r2 = await postMessage("hello after idle stop");
    expect(r2.status).toBe(200);
    expect(ensureOnline).toHaveBeenCalledTimes(2);
    expect(wakeSeq).toBe(2);
    const reEnsureIdx = callOrder.indexOf("ensureOnline");
    const reDeliverIdx = callOrder.indexOf("deliverInbound");
    expect(reEnsureIdx).toBeGreaterThanOrEqual(0);
    expect(reDeliverIdx).toBeGreaterThan(reEnsureIdx);
  });
});
