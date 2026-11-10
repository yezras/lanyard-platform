/**
 * lp-oop.20 / lp-vqr0.11 T6 — harness no-tool skips ensure-online;
 * toolbox still wakes; relay stays primary.
 */
import { describe, expect, it, vi } from "vitest";

import { ControlPlaneRequestError } from "../src/control-plane-client.js";
import {
  isHarnessWakeInFlight,
  resolveChatSendInstance,
  resolveChatSendInstanceKickoff,
} from "../src/chat-instance-resolve.js";

const TENANT = "tenant-resolve";
const USER = "user-resolve";
const PRIMARY = "inst-primary";
const USER_INST = "inst-user";

function userWake(overrides: Record<string, unknown> = {}) {
  return {
    instance_id: USER_INST,
    tenant_id: TENANT,
    user_id: USER,
    presence: "online" as const,
    sandbox_id: "sbx-user",
    runtime_kind: "daytona" as const,
    already_online: true,
    wake_joined: false,
    source: "user" as const,
    ...overrides,
  };
}

describe("resolveChatSendInstance (lp-oop.20 / lp-vqr0.11 T6)", () => {
  it("harness no-tool: primary lookup only — never POSTs ensure-online", async () => {
    const ensureOnlineByUser = vi.fn(async () => userWake());
    const getPrimaryGatewayInstance = vi.fn(async () => ({
      instance_id: PRIMARY,
    }));

    const result = await resolveChatSendInstance({
      chatDelivery: "harness",
      sandboxNeed: "none",
      authClient: { ensureOnlineByUser, getPrimaryGatewayInstance },
      tenantId: TENANT,
      userId: USER,
    });

    expect(result).toEqual({
      instanceId: PRIMARY,
      path: "harness",
      source: "primary",
      sandboxNeed: "none",
    });
    expect(getPrimaryGatewayInstance).toHaveBeenCalledOnce();
    expect(getPrimaryGatewayInstance).toHaveBeenCalledWith(TENANT);
    expect(ensureOnlineByUser).not.toHaveBeenCalled();
  });

  it("harness toolbox: POSTs ensure-online by user and uses the resolved instance_id", async () => {
    const ensureOnlineByUser = vi.fn(async () => userWake());
    const getPrimaryGatewayInstance = vi.fn(async () => ({
      instance_id: PRIMARY,
    }));

    const result = await resolveChatSendInstance({
      chatDelivery: "harness",
      sandboxNeed: "toolbox",
      authClient: { ensureOnlineByUser, getPrimaryGatewayInstance },
      tenantId: TENANT,
      userId: USER,
    });

    expect(result).toEqual({
      instanceId: USER_INST,
      path: "harness",
      source: "user",
      sandboxNeed: "toolbox",
      response: userWake(),
    });
    expect(ensureOnlineByUser).toHaveBeenCalledOnce();
    expect(ensureOnlineByUser).toHaveBeenCalledWith(TENANT, USER, {
      sandbox_create_profile: "tool_only",
    });
    expect(getPrimaryGatewayInstance).not.toHaveBeenCalled();
  });

  it("harness toolbox: tenant-primary fallback still comes from the user route", async () => {
    const ensureOnlineByUser = vi.fn(async () =>
      userWake({ instance_id: PRIMARY, source: "tenant_primary" }),
    );
    const getPrimaryGatewayInstance = vi.fn(async () => ({
      instance_id: "should-not-use",
    }));

    const result = await resolveChatSendInstance({
      chatDelivery: "harness",
      sandboxNeed: "toolbox",
      authClient: { ensureOnlineByUser, getPrimaryGatewayInstance },
      tenantId: TENANT,
      userId: USER,
    });

    expect(result.instanceId).toBe(PRIMARY);
    expect(result.path).toBe("harness");
    expect(result.source).toBe("tenant_primary");
    expect(getPrimaryGatewayInstance).not.toHaveBeenCalled();
  });

  it("harness toolbox: forwards wait_timeout_ms on the user route", async () => {
    const ensureOnlineByUser = vi.fn(async () => userWake());
    await resolveChatSendInstance({
      chatDelivery: "harness",
      sandboxNeed: "toolbox",
      authClient: {
        ensureOnlineByUser,
        getPrimaryGatewayInstance: vi.fn(),
      },
      tenantId: TENANT,
      userId: USER,
      waitTimeoutMs: 15_000,
    });
    expect(ensureOnlineByUser).toHaveBeenCalledWith(TENANT, USER, {
      sandbox_create_profile: "tool_only",
      wait_timeout_ms: 15_000,
    });
  });

  it("channel-equivalent primary and 1:1 relay resolve to the same instance_id", async () => {
    const ensureOnlineByUser = vi.fn(async () => userWake());
    const getPrimaryGatewayInstance = vi.fn(async () => ({
      instance_id: PRIMARY,
    }));
    const authClient = { ensureOnlineByUser, getPrimaryGatewayInstance };

    const oneToOne = await resolveChatSendInstance({
      chatDelivery: "relay",
      authClient,
      tenantId: TENANT,
      userId: USER,
    });
    const channelPrimary = await authClient.getPrimaryGatewayInstance(TENANT);

    expect(oneToOne.instanceId).toBe(PRIMARY);
    expect(channelPrimary.instance_id).toBe(PRIMARY);
    expect(oneToOne.instanceId).toBe(channelPrimary.instance_id);
    expect(ensureOnlineByUser).not.toHaveBeenCalled();
  });

  it("relay: getPrimaryGatewayInstance only — never hits the user route", async () => {
    const ensureOnlineByUser = vi.fn(async () => userWake());
    const getPrimaryGatewayInstance = vi.fn(async () => ({
      instance_id: PRIMARY,
    }));

    const result = await resolveChatSendInstance({
      chatDelivery: "relay",
      authClient: { ensureOnlineByUser, getPrimaryGatewayInstance },
      tenantId: TENANT,
      userId: USER,
    });

    expect(result).toEqual({
      instanceId: PRIMARY,
      path: "relay",
      source: "primary",
    });
    expect(getPrimaryGatewayInstance).toHaveBeenCalledOnce();
    expect(getPrimaryGatewayInstance).toHaveBeenCalledWith(TENANT);
    expect(ensureOnlineByUser).not.toHaveBeenCalled();
  });

  it("harness toolbox: propagates ControlPlaneRequestError from the user route", async () => {
    await expect(
      resolveChatSendInstance({
        chatDelivery: "harness",
        sandboxNeed: "toolbox",
        authClient: {
          ensureOnlineByUser: async () => {
            throw new ControlPlaneRequestError(
              404,
              "No user instance or tenant primary",
            );
          },
          getPrimaryGatewayInstance: vi.fn(),
        },
        tenantId: TENANT,
        userId: USER,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("resolveChatSendInstanceKickoff (lp-vqr0.8 / lp-vqr0.11)", () => {
  it("no-tool: delayed ensure-online is never started", async () => {
    const ensureOnlineByUser = vi.fn(async () => {
      await new Promise(() => {});
      return userWake();
    });
    const started = Date.now();
    const result = await resolveChatSendInstanceKickoff({
      chatDelivery: "harness",
      sandboxNeed: "none",
      authClient: {
        ensureOnlineByUser,
        getPrimaryGatewayInstance: vi.fn(async () => ({
          instance_id: PRIMARY,
        })),
      },
      tenantId: TENANT,
      userId: USER,
      detachWake: true,
    });
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(isHarnessWakeInFlight(result)).toBe(false);
    expect(result).toMatchObject({
      instanceId: PRIMARY,
      path: "harness",
      sandboxNeed: "none",
    });
    expect(ensureOnlineByUser).not.toHaveBeenCalled();
  });

  it("toolbox detach: delayed harness wake returns waking without waiting", async () => {
    let release: () => void = () => {};
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ensureOnlineByUser = vi.fn(async () => {
      await hold;
      return userWake({ already_online: false });
    });
    const started = Date.now();
    const result = await resolveChatSendInstanceKickoff({
      chatDelivery: "harness",
      sandboxNeed: "toolbox",
      authClient: {
        ensureOnlineByUser,
        getPrimaryGatewayInstance: vi.fn(),
      },
      tenantId: TENANT,
      userId: USER,
      detachWake: true,
    });
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(isHarnessWakeInFlight(result)).toBe(true);
    if (!isHarnessWakeInFlight(result)) throw new Error("expected waking");
    release();
    await expect(result.flight).resolves.toMatchObject({
      instance_id: USER_INST,
    });
  });

  it("toolbox detach: instant harness wake still resolves", async () => {
    const result = await resolveChatSendInstanceKickoff({
      chatDelivery: "harness",
      sandboxNeed: "toolbox",
      authClient: {
        ensureOnlineByUser: vi.fn(async () => userWake()),
        getPrimaryGatewayInstance: vi.fn(),
      },
      tenantId: TENANT,
      userId: USER,
      detachWake: true,
    });
    expect(isHarnessWakeInFlight(result)).toBe(false);
    expect(result).toMatchObject({
      instanceId: USER_INST,
      path: "harness",
      sandboxNeed: "toolbox",
    });
  });
});
