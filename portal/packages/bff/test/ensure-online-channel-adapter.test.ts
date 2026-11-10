/**
 * lp-e23 — Channel adapters: ensure_online before deliver (Slack/email).
 *
 * Proves:
 * - Adapter path calls ensure_online (then relay deliver-inbound)
 * - No per-channel gateway identity (slack + email share primary instance_id)
 * - Flag off / ec2 skip wake; failures surface
 *
 * Fake CP + fake relay only — no network / Daytona / AWS.
 */
import { describe, expect, it, vi } from "vitest";
import type { MessageEvent } from "@lanyard/shared";

import {
  channelAdapterPlatform,
  deliverChannelAdapterInbound,
  resolveChannelAdapterInstanceId,
  type ChannelAdapterDeliverAuthClient,
} from "../src/channel-adapter-deliver.js";
import {
  ControlPlaneRequestError,
  type EnsureOnlineResponse,
  type InstancePresenceResponse,
} from "../src/control-plane-client.js";
import {
  ensureOnlineBeforeChannelInbound,
  type ChannelAdapterKind,
} from "../src/ensure-online-channel-adapter.js";
import { loadConfig, parseEnvFlag } from "../src/config.js";

const PRIMARY_INSTANCE_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const TENANT_ID = "tenant-channel-eo";

function presence(
  overrides: Partial<InstancePresenceResponse> = {},
): InstancePresenceResponse {
  return {
    instance_id: PRIMARY_INSTANCE_ID,
    tenant_id: TENANT_ID,
    presence: "offline",
    sandbox_id: null,
    runtime_kind: "daytona",
    agent_snapshot_id: "snap-1",
    s3_vault_prefix: `tenants/${TENANT_ID}/vault/`,
    last_activity_at: null,
    revoked_at: null,
    ...overrides,
  };
}

function ensureResponse(
  overrides: Partial<EnsureOnlineResponse> = {},
): EnsureOnlineResponse {
  return {
    instance_id: PRIMARY_INSTANCE_ID,
    tenant_id: TENANT_ID,
    presence: "online",
    sandbox_id: "sbx-channel-1",
    runtime_kind: "daytona",
    already_online: false,
    wake_joined: false,
    ...overrides,
  };
}

function sampleEvent(
  adapter: ChannelAdapterKind,
  text = "hello from channel",
): MessageEvent {
  return {
    text,
    message_type: "text",
    source: {
      platform: channelAdapterPlatform(adapter),
      chat_id: adapter === "email" ? "user@example.com" : "C0123CHANNEL",
      chat_type: adapter === "email" ? "dm" : "channel",
      chat_name: adapter === "email" ? "Inbox" : "#general",
      user_id: "U_CHANNEL",
      user_name: "channel-user",
      thread_id: null,
      chat_topic: null,
    },
  };
}

function fakeAuth(opts: {
  presence?: InstancePresenceResponse;
  ensure?: EnsureOnlineResponse;
  presenceError?: Error;
  ensureError?: Error;
  primaryInstanceId?: string;
  primaryError?: Error;
}): ChannelAdapterDeliverAuthClient & {
  getInstancePresence: ReturnType<typeof vi.fn>;
  ensureOnline: ReturnType<typeof vi.fn>;
  getPrimaryGatewayInstance: ReturnType<typeof vi.fn>;
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
    getPrimaryGatewayInstance: vi.fn(async () => {
      if (opts.primaryError) throw opts.primaryError;
      return {
        instance_id: opts.primaryInstanceId ?? PRIMARY_INSTANCE_ID,
      };
    }),
  };
}

describe("ENSURE_ONLINE_ON_CHANNEL_ADAPTER flag (lp-e23)", () => {
  it("defaults fail-closed (false) when unset", () => {
    expect(parseEnvFlag(undefined)).toBe(false);
    const config = loadConfig({ CONTROL_PLANE_URL: "http://cp.test" });
    expect(config.ensureOnlineOnChannelAdapter).toBe(false);
  });

  it("accepts truthy env forms", () => {
    expect(
      loadConfig({
        CONTROL_PLANE_URL: "http://cp.test",
        ENSURE_ONLINE_ON_CHANNEL_ADAPTER: "1",
      }).ensureOnlineOnChannelAdapter,
    ).toBe(true);
    expect(
      loadConfig({
        CONTROL_PLANE_URL: "http://cp.test",
        ENSURE_ONLINE_ON_CHANNEL_ADAPTER: "true",
      }).ensureOnlineOnChannelAdapter,
    ).toBe(true);
  });
});

describe("resolveChannelAdapterInstanceId — no per-channel identity (lp-e23)", () => {
  it("uses tenant primary gateway instance_id", async () => {
    const auth = fakeAuth({ primaryInstanceId: PRIMARY_INSTANCE_ID });
    const id = await resolveChannelAdapterInstanceId(auth, {
      tenantId: TENANT_ID,
    });
    expect(id).toBe(PRIMARY_INSTANCE_ID);
    expect(auth.getPrimaryGatewayInstance).toHaveBeenCalledWith(TENANT_ID);
  });

  it("slack and email resolve to the same primary instance_id", async () => {
    const auth = fakeAuth({});
    const slackId = await resolveChannelAdapterInstanceId(auth, {
      tenantId: TENANT_ID,
    });
    const emailId = await resolveChannelAdapterInstanceId(auth, {
      tenantId: TENANT_ID,
    });
    expect(slackId).toBe(emailId);
    expect(slackId).toBe(PRIMARY_INSTANCE_ID);
    // Two resolves → two primary lookups; never a channel-scoped id.
    expect(auth.getPrimaryGatewayInstance).toHaveBeenCalledTimes(2);
  });

  it("explicit instanceId skips primary lookup (test override only)", async () => {
    const auth = fakeAuth({});
    const override = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const id = await resolveChannelAdapterInstanceId(auth, {
      tenantId: TENANT_ID,
      instanceId: override,
    });
    expect(id).toBe(override);
    expect(auth.getPrimaryGatewayInstance).not.toHaveBeenCalled();
  });
});

describe("ensureOnlineBeforeChannelInbound (lp-e23 slack/email)", () => {
  it("flag off: pure no-op", async () => {
    const auth = fakeAuth({});
    const result = await ensureOnlineBeforeChannelInbound({
      enabled: false,
      authClient: auth,
      instanceId: PRIMARY_INSTANCE_ID,
      adapter: "slack",
    });
    expect(result).toEqual({ action: "skipped", reason: "flag_off" });
    expect(auth.ensureOnline).not.toHaveBeenCalled();
  });

  it("flag on + daytona: ensureOnline for email adapter", async () => {
    const auth = fakeAuth({
      presence: presence({ runtime_kind: "daytona", presence: "offline" }),
    });
    const result = await ensureOnlineBeforeChannelInbound({
      enabled: true,
      authClient: auth,
      instanceId: PRIMARY_INSTANCE_ID,
      adapter: "email",
      waitTimeoutMs: 12_000,
    });
    expect(result.action).toBe("ensured");
    expect(auth.ensureOnline).toHaveBeenCalledWith(PRIMARY_INSTANCE_ID, {
      wait_timeout_ms: 12_000,
    });
  });
});

describe("deliverChannelAdapterInbound (lp-e23)", () => {
  it("flag on + daytona + slack: ensureOnline before deliverInbound", async () => {
    const callOrder: string[] = [];
    const auth = fakeAuth({
      presence: presence({ runtime_kind: "daytona", presence: "offline" }),
    });
    auth.getPrimaryGatewayInstance = vi.fn(async () => {
      callOrder.push("getPrimaryGatewayInstance");
      return { instance_id: PRIMARY_INSTANCE_ID };
    });
    auth.getInstancePresence = vi.fn(async () => {
      callOrder.push("getInstancePresence");
      return presence({ runtime_kind: "daytona", presence: "offline" });
    });
    auth.ensureOnline = vi.fn(async () => {
      callOrder.push("ensureOnline");
      return ensureResponse();
    });
    const deliverInbound = vi.fn(async (input) => {
      callOrder.push("deliverInbound");
      expect(input.instanceId).toBe(PRIMARY_INSTANCE_ID);
      expect(input.tenantId).toBe(TENANT_ID);
      return { ok: true as const };
    });

    const result = await deliverChannelAdapterInbound(
      {
        ensureOnlineEnabled: true,
        authClient: auth,
        relayClient: { deliverInbound },
      },
      {
        tenantId: TENANT_ID,
        adapter: "slack",
        event: sampleEvent("slack"),
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.instanceId).toBe(PRIMARY_INSTANCE_ID);
      expect(result.ensure.action).toBe("ensured");
    }
    expect(callOrder).toEqual([
      "getPrimaryGatewayInstance",
      "getInstancePresence",
      "ensureOnline",
      "deliverInbound",
    ]);
  });

  it("flag on + daytona + email: ensureOnline before deliverInbound", async () => {
    const auth = fakeAuth({
      presence: presence({ runtime_kind: "daytona" }),
    });
    const deliverInbound = vi.fn(async () => ({ ok: true as const }));

    const result = await deliverChannelAdapterInbound(
      {
        ensureOnlineEnabled: true,
        authClient: auth,
        relayClient: { deliverInbound },
      },
      {
        tenantId: TENANT_ID,
        adapter: "email",
        event: sampleEvent("email", "invoice question"),
      },
    );

    expect(result.ok).toBe(true);
    expect(auth.ensureOnline).toHaveBeenCalledOnce();
    expect(deliverInbound).toHaveBeenCalledOnce();
    expect(deliverInbound.mock.calls[0]![0].instanceId).toBe(
      PRIMARY_INSTANCE_ID,
    );
    expect(deliverInbound.mock.calls[0]![0].event.source.platform).toBe(
      "email",
    );
  });

  it("slack and email deliver to the same primary instance_id", async () => {
    const auth = fakeAuth({});
    const deliverInbound = vi.fn(async () => ({ ok: true as const }));
    const deps = {
      ensureOnlineEnabled: true,
      authClient: auth,
      relayClient: { deliverInbound },
    };

    const slack = await deliverChannelAdapterInbound(deps, {
      tenantId: TENANT_ID,
      adapter: "slack",
      event: sampleEvent("slack"),
    });
    const email = await deliverChannelAdapterInbound(deps, {
      tenantId: TENANT_ID,
      adapter: "email",
      event: sampleEvent("email"),
    });

    expect(slack.ok && email.ok).toBe(true);
    if (slack.ok && email.ok) {
      expect(slack.instanceId).toBe(email.instanceId);
      expect(slack.instanceId).toBe(PRIMARY_INSTANCE_ID);
    }
    const deliveredIds = deliverInbound.mock.calls.map(
      (c) => c[0]!.instanceId as string,
    );
    expect(deliveredIds).toEqual([PRIMARY_INSTANCE_ID, PRIMARY_INSTANCE_ID]);
  });

  it("flag off: deliver without presence/ensureOnline", async () => {
    const callOrder: string[] = [];
    const auth = fakeAuth({});
    auth.getPrimaryGatewayInstance = vi.fn(async () => {
      callOrder.push("getPrimaryGatewayInstance");
      return { instance_id: PRIMARY_INSTANCE_ID };
    });
    const deliverInbound = vi.fn(async () => {
      callOrder.push("deliverInbound");
      return { ok: true as const };
    });

    const result = await deliverChannelAdapterInbound(
      {
        ensureOnlineEnabled: false,
        authClient: auth,
        relayClient: { deliverInbound },
      },
      {
        tenantId: TENANT_ID,
        adapter: "slack",
        event: sampleEvent("slack"),
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ensure).toEqual({ action: "skipped", reason: "flag_off" });
    }
    expect(auth.getInstancePresence).not.toHaveBeenCalled();
    expect(auth.ensureOnline).not.toHaveBeenCalled();
    expect(callOrder).toEqual([
      "getPrimaryGatewayInstance",
      "deliverInbound",
    ]);
  });

  it("flag on + ec2: presence only; no ensureOnline; still delivers", async () => {
    const auth = fakeAuth({
      presence: presence({ runtime_kind: "ec2", presence: "online" }),
    });
    const deliverInbound = vi.fn(async () => ({ ok: true as const }));

    const result = await deliverChannelAdapterInbound(
      {
        ensureOnlineEnabled: true,
        authClient: auth,
        relayClient: { deliverInbound },
      },
      {
        tenantId: TENANT_ID,
        adapter: "email",
        event: sampleEvent("email"),
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ensure.action).toBe("skipped");
      if (result.ensure.action === "skipped") {
        expect(result.ensure.reason).toBe("runtime_kind_not_daytona");
      }
    }
    expect(auth.ensureOnline).not.toHaveBeenCalled();
    expect(deliverInbound).toHaveBeenCalledOnce();
  });

  it("already online: skips ensureOnline POST; deliver proceeds", async () => {
    // Shared ensureOnlineIfNeeded gate (lp-y3j Phase 5): already-online
    // short-circuits — no ensure-online POST (Online skips wake). Presence
    // probe still runs; deliver proceeds without a redundant wake.
    const auth = fakeAuth({
      presence: presence({ runtime_kind: "daytona", presence: "online" }),
      ensure: ensureResponse({
        already_online: true,
        presence: "online",
        sandbox_id: "sbx-warm",
      }),
    });
    const deliverInbound = vi.fn(async () => ({ ok: true as const }));

    const result = await deliverChannelAdapterInbound(
      {
        ensureOnlineEnabled: true,
        authClient: auth,
        relayClient: { deliverInbound },
      },
      {
        tenantId: TENANT_ID,
        adapter: "slack",
        event: sampleEvent("slack"),
      },
    );

    expect(result.ok).toBe(true);
    expect(auth.getInstancePresence).toHaveBeenCalledOnce();
    expect(auth.ensureOnline).not.toHaveBeenCalled();
    expect(deliverInbound).toHaveBeenCalledOnce();
  });

  it("ensure_online failure surfaces phase ensure_online (no deliver)", async () => {
    const auth = fakeAuth({
      presence: presence({ runtime_kind: "daytona" }),
      ensureError: new ControlPlaneRequestError(
        504,
        "ensure_online timed out",
        "ENSURE_ONLINE_TIMEOUT",
      ),
    });
    const deliverInbound = vi.fn(async () => ({ ok: true as const }));

    const result = await deliverChannelAdapterInbound(
      {
        ensureOnlineEnabled: true,
        authClient: auth,
        relayClient: { deliverInbound },
      },
      {
        tenantId: TENANT_ID,
        adapter: "slack",
        event: sampleEvent("slack"),
      },
    );

    // lp-mrh: mapped code + retry guidance (no silent drop / deliver)
    expect(result).toMatchObject({
      ok: false,
      status: 504,
      error: "wake_timeout",
      code: "wake_timeout",
      retryable: true,
      phase: "ensure_online",
      instanceId: PRIMARY_INSTANCE_ID,
    });
    expect(typeof (result as { retry_guidance?: string }).retry_guidance).toBe(
      "string",
    );
    expect(deliverInbound).not.toHaveBeenCalled();
  });

  it("lp-mrh: vault mount fail maps to vault_mount_failed (no deliver)", async () => {
    const auth = fakeAuth({
      presence: presence({ runtime_kind: "daytona" }),
      ensureError: new ControlPlaneRequestError(
        502,
        "s3_vault_prefix is required for vault mount",
        "ENSURE_ONLINE_WAKE_FAILED",
      ),
    });
    const deliverInbound = vi.fn(async () => ({ ok: true as const }));

    const result = await deliverChannelAdapterInbound(
      {
        ensureOnlineEnabled: true,
        authClient: auth,
        relayClient: { deliverInbound },
      },
      {
        tenantId: TENANT_ID,
        adapter: "email",
        event: sampleEvent("email"),
      },
    );

    expect(result).toMatchObject({
      ok: false,
      status: 502,
      code: "vault_mount_failed",
      retryable: false,
      phase: "ensure_online",
    });
    expect(deliverInbound).not.toHaveBeenCalled();
  });

  it("primary instance resolve failure surfaces phase resolve_instance", async () => {
    const auth = fakeAuth({
      primaryError: new ControlPlaneRequestError(
        404,
        "No gateway instance available",
      ),
    });
    const deliverInbound = vi.fn(async () => ({ ok: true as const }));

    const result = await deliverChannelAdapterInbound(
      {
        ensureOnlineEnabled: true,
        authClient: auth,
        relayClient: { deliverInbound },
      },
      {
        tenantId: TENANT_ID,
        adapter: "email",
        event: sampleEvent("email"),
      },
    );

    expect(result).toMatchObject({
      ok: false,
      status: 404,
      phase: "resolve_instance",
    });
    expect(auth.ensureOnline).not.toHaveBeenCalled();
    expect(deliverInbound).not.toHaveBeenCalled();
  });

  it("relay deliver failure surfaces phase deliver after ensure", async () => {
    const auth = fakeAuth({
      presence: presence({ runtime_kind: "daytona" }),
    });
    const deliverInbound = vi.fn(async () => ({
      ok: false as const,
      status: 502,
      error: "Relay deliver-inbound failed",
    }));

    const result = await deliverChannelAdapterInbound(
      {
        ensureOnlineEnabled: true,
        authClient: auth,
        relayClient: { deliverInbound },
      },
      {
        tenantId: TENANT_ID,
        adapter: "slack",
        event: sampleEvent("slack"),
      },
    );

    expect(result).toMatchObject({
      ok: false,
      status: 502,
      phase: "deliver",
      instanceId: PRIMARY_INSTANCE_ID,
    });
    expect(auth.ensureOnline).toHaveBeenCalledOnce();
  });
});
