/**
 * lp-kng.2.9 / lp-7bk — Brain RPC ensure_online before invoke + failure surface
 * to API clients (fake CP only; no network / Daytona / AWS).
 */
import { describe, expect, it, vi } from "vitest";

import { BackendRuntimeError } from "@lanyard/backend-runtime";

import { createApp } from "../src/app.js";
import {
  controlPlaneEnsureOnlineToBackendError,
  createRelayBrainRpcInvoker,
  createProductionBackendRuntimeService,
} from "../src/backend-runtime-compose.js";
import { loadConfig, parseEnvFlag } from "../src/config.js";
import {
  ControlPlaneRequestError,
  type EnsureOnlineResponse,
  type InstancePresenceResponse,
} from "../src/control-plane-client.js";
import {
  ensureOnlineBeforeBrainRpc,
  type EnsureOnlineBrainRpcClient,
} from "../src/ensure-online-brain-rpc.js";
import {
  ensureOnlineBeforeChannelInbound,
  type EnsureOnlineChannelAdapterClient,
} from "../src/ensure-online-channel-adapter.js";
import { SessionStore } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import { cookieHeader, createTestBindings } from "./test-helpers.js";

const INSTANCE_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

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
}): EnsureOnlineBrainRpcClient &
  EnsureOnlineChannelAdapterClient & {
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

describe("ENSURE_ONLINE_ON_BRAIN_RPC / CHANNEL_ADAPTER flags (lp-kng.2.9)", () => {
  it("defaults fail-closed (false) when unset", () => {
    expect(parseEnvFlag(undefined)).toBe(false);
    const config = loadConfig({ CONTROL_PLANE_URL: "http://cp.test" });
    expect(config.ensureOnlineOnBrainRpc).toBe(false);
    expect(config.ensureOnlineOnChannelAdapter).toBe(false);
    expect(config.ensureOnlineOnChat).toBe(false);
  });

  it("accepts truthy ENSURE_ONLINE_ON_BRAIN_RPC env forms", () => {
    expect(
      loadConfig({
        CONTROL_PLANE_URL: "http://cp.test",
        ENSURE_ONLINE_ON_BRAIN_RPC: "1",
      }).ensureOnlineOnBrainRpc,
    ).toBe(true);
    expect(
      loadConfig({
        CONTROL_PLANE_URL: "http://cp.test",
        ENSURE_ONLINE_ON_BRAIN_RPC: "true",
      }).ensureOnlineOnBrainRpc,
    ).toBe(true);
    expect(
      loadConfig({
        CONTROL_PLANE_URL: "http://cp.test",
        ENSURE_ONLINE_ON_BRAIN_RPC: "0",
      }).ensureOnlineOnBrainRpc,
    ).toBe(false);
  });

  it("accepts truthy ENSURE_ONLINE_ON_CHANNEL_ADAPTER env forms", () => {
    expect(
      loadConfig({
        CONTROL_PLANE_URL: "http://cp.test",
        ENSURE_ONLINE_ON_CHANNEL_ADAPTER: "yes",
      }).ensureOnlineOnChannelAdapter,
    ).toBe(true);
    expect(
      loadConfig({
        CONTROL_PLANE_URL: "http://cp.test",
        ENSURE_ONLINE_ON_CHANNEL_ADAPTER: "on",
      }).ensureOnlineOnChannelAdapter,
    ).toBe(true);
    expect(
      loadConfig({
        CONTROL_PLANE_URL: "http://cp.test",
        ENSURE_ONLINE_ON_CHANNEL_ADAPTER: "false",
      }).ensureOnlineOnChannelAdapter,
    ).toBe(false);
  });
});

describe("ensureOnlineBeforeBrainRpc (lp-kng.2.9 / lp-7bk)", () => {
  it("flag off: pure no-op — never calls presence or ensureOnline", async () => {
    const client = fakeClient({});
    const result = await ensureOnlineBeforeBrainRpc({
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
    const result = await ensureOnlineBeforeBrainRpc({
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
    expect(client.ensureOnline).not.toHaveBeenCalled();
  });

  it("flag on + runtime_kind=daytona: ensureOnline then returns ensured", async () => {
    const ensured = ensureResponse({ sandbox_id: "sbx-brain-1" });
    const client = fakeClient({
      presence: presence({ presence: "offline", runtime_kind: "daytona" }),
      ensure: ensured,
    });
    const result = await ensureOnlineBeforeBrainRpc({
      enabled: true,
      authClient: client,
      instanceId: INSTANCE_ID,
      waitTimeoutMs: 8_000,
    });
    expect(result).toEqual({ action: "ensured", response: ensured });
    expect(client.ensureOnline).toHaveBeenCalledWith(INSTANCE_ID, {
      wait_timeout_ms: 8_000,
    });
  });

  it("propagates ControlPlaneRequestError from ensureOnline (caller maps HTTP)", async () => {
    const client = fakeClient({
      presence: presence({ runtime_kind: "daytona" }),
      ensureError: new ControlPlaneRequestError(504, "ensure_online timed out"),
    });
    await expect(
      ensureOnlineBeforeBrainRpc({
        enabled: true,
        authClient: client,
        instanceId: INSTANCE_ID,
      }),
    ).rejects.toMatchObject({ status: 504, message: "ensure_online timed out" });
  });

  it("propagates ControlPlaneRequestError from getInstancePresence", async () => {
    const client = fakeClient({
      presenceError: new ControlPlaneRequestError(404, "Instance not found"),
    });
    await expect(
      ensureOnlineBeforeBrainRpc({
        enabled: true,
        authClient: client,
        instanceId: INSTANCE_ID,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(client.ensureOnline).not.toHaveBeenCalled();
  });
});

describe("controlPlaneEnsureOnlineToBackendError (lp-7bk / lp-mrh)", () => {
  it("maps 504 → timeout, 502 → unavailable, 403 → forbidden, 404 → not_found", () => {
    expect(
      controlPlaneEnsureOnlineToBackendError(
        new ControlPlaneRequestError(504, "timed out"),
        "settings.snapshot",
      ),
    ).toMatchObject({
      code: "timeout",
      details: {
        method: "settings.snapshot",
        ensure_online: true,
        status: 504,
        wake_code: "wake_timeout",
      },
    });
    expect(
      controlPlaneEnsureOnlineToBackendError(
        new ControlPlaneRequestError(502, "wake failed"),
        "vault.list",
      ),
    ).toMatchObject({
      code: "unavailable",
      details: {
        status: 502,
        ensure_online: true,
        wake_code: "wake_failed",
      },
    });
    expect(
      controlPlaneEnsureOnlineToBackendError(
        new ControlPlaneRequestError(403, "gated", "DAYTONA_PATH_GATED"),
        "projects.list",
      ),
    ).toMatchObject({
      code: "forbidden",
      details: { status: 403, wake_code: "daytona_path_gated" },
    });
    expect(
      controlPlaneEnsureOnlineToBackendError(
        new ControlPlaneRequestError(404, "missing"),
        "vault.read",
      ),
    ).toMatchObject({
      code: "not_found",
      details: { status: 404, wake_code: "not_found" },
    });
  });
});

describe("ensureOnlineBeforeChannelInbound (lp-kng.2.9 slack stub)", () => {
  it("flag off: pure no-op — never calls CP (no live Daytona)", async () => {
    const client = fakeClient({});
    const result = await ensureOnlineBeforeChannelInbound({
      enabled: false,
      authClient: client,
      instanceId: INSTANCE_ID,
      adapter: "slack",
    });
    expect(result).toEqual({ action: "skipped", reason: "flag_off" });
    expect(client.getInstancePresence).not.toHaveBeenCalled();
    expect(client.ensureOnline).not.toHaveBeenCalled();
  });

  it("flag on + ec2: presence only; no ensureOnline", async () => {
    const client = fakeClient({
      presence: presence({ runtime_kind: "ec2", presence: "online" }),
    });
    const result = await ensureOnlineBeforeChannelInbound({
      enabled: true,
      authClient: client,
      instanceId: INSTANCE_ID,
      adapter: "slack",
    });
    expect(result.action).toBe("skipped");
    if (result.action === "skipped") {
      expect(result.reason).toBe("runtime_kind_not_daytona");
    }
    expect(client.ensureOnline).not.toHaveBeenCalled();
  });

  it("flag on + daytona: ensureOnline before inbound handoff", async () => {
    const client = fakeClient({
      presence: presence({ runtime_kind: "daytona", presence: "offline" }),
      ensure: ensureResponse({ already_online: false }),
    });
    const result = await ensureOnlineBeforeChannelInbound({
      enabled: true,
      authClient: client,
      instanceId: INSTANCE_ID,
      adapter: "slack",
    });
    expect(result.action).toBe("ensured");
    expect(client.ensureOnline).toHaveBeenCalledOnce();
  });

  it("propagates ControlPlaneRequestError from ensureOnline", async () => {
    const client = fakeClient({
      presence: presence({ runtime_kind: "daytona" }),
      ensureError: new ControlPlaneRequestError(501, "not_implemented"),
    });
    await expect(
      ensureOnlineBeforeChannelInbound({
        enabled: true,
        authClient: client,
        instanceId: INSTANCE_ID,
        adapter: "telegram",
      }),
    ).rejects.toMatchObject({ status: 501, message: "not_implemented" });
  });
});

describe("createRelayBrainRpcInvoker ensure_online gate (lp-kng.2.9)", () => {
  const ctx = {
    tenantId: "t1",
    instanceId: INSTANCE_ID,
    userId: "u1",
    sessionId: "s1",
    profile: { name: "default", pathPrefixes: ["/"], hermesProfileAlias: "default" },
    roles: ["member"],
    timeoutMs: 5_000,
  };

  it("flag off: invokeBrainRpc without presence/ensureOnline", async () => {
    const callOrder: string[] = [];
    const client = fakeClient({});
    const invokeBrainRpc = vi.fn(async () => {
      callOrder.push("invokeBrainRpc");
      return {
        ok: true as const,
        result: {
          type: "brain_rpc_result" as const,
          contract_version: 1,
          request_id: "r1",
          ok: true as const,
          result: { pong: true },
          error: null,
        },
      };
    });
    const invoker = createRelayBrainRpcInvoker(
      { invokeBrainRpc } as never,
      { ensureOnlineEnabled: false, authClient: client },
    );
    await invoker({ method: "brain.ping", params: {}, ctx: ctx as never });
    expect(callOrder).toEqual(["invokeBrainRpc"]);
    expect(client.getInstancePresence).not.toHaveBeenCalled();
    expect(client.ensureOnline).not.toHaveBeenCalled();
  });

  it("flag on + daytona: ensureOnline before invokeBrainRpc", async () => {
    const callOrder: string[] = [];
    const client = fakeClient({
      presence: presence({ runtime_kind: "daytona" }),
    });
    client.getInstancePresence = vi.fn(async () => {
      callOrder.push("getInstancePresence");
      return presence({ runtime_kind: "daytona" });
    });
    client.ensureOnline = vi.fn(async () => {
      callOrder.push("ensureOnline");
      return ensureResponse();
    });
    const invokeBrainRpc = vi.fn(async () => {
      callOrder.push("invokeBrainRpc");
      return {
        ok: true as const,
        result: {
          type: "brain_rpc_result" as const,
          contract_version: 1,
          request_id: "r1",
          ok: true as const,
          result: { pong: true },
          error: null,
        },
      };
    });
    const invoker = createRelayBrainRpcInvoker(
      { invokeBrainRpc } as never,
      { ensureOnlineEnabled: true, authClient: client },
    );
    await invoker({ method: "brain.ping", params: {}, ctx: ctx as never });
    expect(callOrder).toEqual([
      "getInstancePresence",
      "ensureOnline",
      "invokeBrainRpc",
    ]);
  });

  it("flag on + ec2: no ensureOnline; still invokes Brain RPC", async () => {
    const client = fakeClient({
      presence: presence({ runtime_kind: "ec2", presence: "online" }),
    });
    const invokeBrainRpc = vi.fn(async () => ({
      ok: true as const,
      result: {
        type: "brain_rpc_result" as const,
        contract_version: 1,
        request_id: "r1",
        ok: true as const,
        result: {},
        error: null,
      },
    }));
    const invoker = createRelayBrainRpcInvoker(
      { invokeBrainRpc } as never,
      { ensureOnlineEnabled: true, authClient: client },
    );
    await invoker({ method: "brain.health", params: {}, ctx: ctx as never });
    expect(client.getInstancePresence).toHaveBeenCalledOnce();
    expect(client.ensureOnline).not.toHaveBeenCalled();
    expect(invokeBrainRpc).toHaveBeenCalledOnce();
  });

  it("lp-7bk: ensureOnline 504 surfaces as BackendRuntimeError timeout; never invokes", async () => {
    const client = fakeClient({
      presence: presence({ runtime_kind: "daytona" }),
      ensureError: new ControlPlaneRequestError(504, "ensure_online timed out"),
    });
    const invokeBrainRpc = vi.fn();
    const invoker = createRelayBrainRpcInvoker(
      { invokeBrainRpc } as never,
      { ensureOnlineEnabled: true, authClient: client },
    );
    await expect(
      invoker({ method: "settings.snapshot", params: {}, ctx: ctx as never }),
    ).rejects.toBeInstanceOf(BackendRuntimeError);
    await expect(
      invoker({ method: "settings.snapshot", params: {}, ctx: ctx as never }),
    ).rejects.toMatchObject({
      code: "timeout",
      details: {
        method: "settings.snapshot",
        ensure_online: true,
        status: 504,
        wake_code: "wake_timeout",
      },
    });
    expect(invokeBrainRpc).not.toHaveBeenCalled();
  });

  it("lp-7bk: ensureOnline 502 surfaces as unavailable; never invokes", async () => {
    const client = fakeClient({
      presence: presence({ runtime_kind: "daytona" }),
      ensureError: new ControlPlaneRequestError(502, "wake failed"),
    });
    const invokeBrainRpc = vi.fn();
    const invoker = createRelayBrainRpcInvoker(
      { invokeBrainRpc } as never,
      { ensureOnlineEnabled: true, authClient: client },
    );
    await expect(
      invoker({ method: "vault.list", params: { path: "/" }, ctx: ctx as never }),
    ).rejects.toMatchObject({
      code: "unavailable",
      details: {
        ensure_online: true,
        status: 502,
        wake_code: "wake_failed",
      },
    });
    expect(invokeBrainRpc).not.toHaveBeenCalled();
  });

  it("lp-7bk: production settings path surfaces ensure_online failure (no silent empty)", async () => {
    const client = fakeClient({
      presence: presence({ runtime_kind: "daytona" }),
      ensureError: new ControlPlaneRequestError(504, "ensure_online timed out"),
    });
    const invokeBrainRpc = vi.fn();
    const service = createProductionBackendRuntimeService(
      { invokeBrainRpc } as never,
      { ensureOnlineEnabled: true, authClient: client },
    );
    await expect(
      service.settingsSnapshot(ctx as never),
    ).rejects.toMatchObject({
      code: "timeout",
      details: {
        ensure_online: true,
        status: 504,
        wake_code: "wake_timeout",
      },
    });
    expect(invokeBrainRpc).not.toHaveBeenCalled();
  });

  it("createProductionBackendRuntimeService accepts ensure options", () => {
    const service = createProductionBackendRuntimeService(
      { invokeBrainRpc: vi.fn() } as never,
      { ensureOnlineEnabled: false, authClient: fakeClient({}) },
    );
    expect(service).toBeDefined();
  });
});

/**
 * App-level call-site: /api/brain/ping invokes ensure_online before invokeBrainRpc.
 * Fully faked auth + relay — no network / Daytona / AWS.
 */
describe("brain/ping ensure_online call site (lp-kng.2.9 / lp-7bk)", () => {
  const tenant: TenantContext = {
    tenant_id: "tenant-brain-eo",
    tenant_slug: "demo",
    display_name: "Demo",
    host: "demo.withlanyard.com",
  };
  const userId = "user-brain-eo";
  const instanceId = INSTANCE_ID;

  async function bootBrainPing(options: {
    ensureOnlineOnBrainRpc: boolean;
    runtimeKind: "ec2" | "daytona";
    ensureError?: Error;
  }) {
    const callOrder: string[] = [];
    const sessions = new SessionStore();
    const session = await sessions.create({
      userId,
      tenantId: tenant.tenant_id,
      email: "brain-eo@example.com",
    });

    const getInstancePresence = vi.fn(async () => {
      callOrder.push("getInstancePresence");
      return presence({
        runtime_kind: options.runtimeKind,
        presence: options.runtimeKind === "daytona" ? "offline" : "online",
      });
    });
    const ensureOnline = vi.fn(async () => {
      callOrder.push("ensureOnline");
      if (options.ensureError) throw options.ensureError;
      return ensureResponse({ presence: "online" });
    });
    const invokeBrainRpc = vi.fn(async () => {
      callOrder.push("invokeBrainRpc");
      return {
        ok: true as const,
        result: {
          type: "brain_rpc_result" as const,
          contract_version: 1,
          request_id: "req-ping-1",
          ok: true as const,
          result: { pong: true },
          error: null,
        },
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
          brainRpcEnabled: true,
          ensureOnlineOnBrainRpc: options.ensureOnlineOnBrainRpc,
          authClient: authClient as never,
          relayClient: { invokeBrainRpc, deliverInbound: vi.fn() } as never,
        },
      ),
    );

    const cookies = {
      lanyard_session: session.sessionId,
      lanyard_csrf: "test-csrf-brain-eo",
    };

    return {
      app,
      cookies,
      callOrder,
      getInstancePresence,
      ensureOnline,
      invokeBrainRpc,
    };
  }

  async function getPing(
    app: ReturnType<typeof createApp>,
    cookies: Record<string, string>,
  ) {
    return app.request("/api/brain/ping", {
      method: "GET",
      headers: {
        host: tenant.host,
        cookie: cookieHeader(cookies),
        "x-csrf-token": cookies.lanyard_csrf,
      },
    });
  }

  it("flag default off: invokeBrainRpc runs; ensureOnline never called", async () => {
    const ctx = await bootBrainPing({
      ensureOnlineOnBrainRpc: false,
      runtimeKind: "daytona",
    });
    const res = await getPing(ctx.app, ctx.cookies);
    expect(res.status).toBe(200);
    expect(ctx.invokeBrainRpc).toHaveBeenCalledOnce();
    expect(ctx.getInstancePresence).not.toHaveBeenCalled();
    expect(ctx.ensureOnline).not.toHaveBeenCalled();
    expect(ctx.callOrder).toEqual(["invokeBrainRpc"]);
  });

  it("flag on + daytona: ensureOnline before invokeBrainRpc", async () => {
    const ctx = await bootBrainPing({
      ensureOnlineOnBrainRpc: true,
      runtimeKind: "daytona",
    });
    const res = await getPing(ctx.app, ctx.cookies);
    expect(res.status).toBe(200);
    expect(ctx.callOrder).toEqual([
      "getInstancePresence",
      "ensureOnline",
      "invokeBrainRpc",
    ]);
    expect(ctx.ensureOnline).toHaveBeenCalledWith(instanceId, {});
  });

  it("flag on + ec2: presence only; no ensureOnline; still pings", async () => {
    const ctx = await bootBrainPing({
      ensureOnlineOnBrainRpc: true,
      runtimeKind: "ec2",
    });
    const res = await getPing(ctx.app, ctx.cookies);
    expect(res.status).toBe(200);
    expect(ctx.callOrder).toEqual(["getInstancePresence", "invokeBrainRpc"]);
    expect(ctx.ensureOnline).not.toHaveBeenCalled();
  });

  it("lp-7bk: ensureOnline 504 surfaces HTTP 504 to API client; no invoke", async () => {
    const ctx = await bootBrainPing({
      ensureOnlineOnBrainRpc: true,
      runtimeKind: "daytona",
      ensureError: new ControlPlaneRequestError(504, "ensure_online timed out"),
    });
    const res = await getPing(ctx.app, ctx.cookies);
    expect(res.status).toBe(504);
    expect(ctx.invokeBrainRpc).not.toHaveBeenCalled();
    expect(ctx.ensureOnline).toHaveBeenCalledOnce();
  });

  it("lp-7bk: ensureOnline 502 surfaces HTTP 502 to API client; no invoke", async () => {
    const ctx = await bootBrainPing({
      ensureOnlineOnBrainRpc: true,
      runtimeKind: "daytona",
      ensureError: new ControlPlaneRequestError(502, "wake failed"),
    });
    const res = await getPing(ctx.app, ctx.cookies);
    expect(res.status).toBe(502);
    expect(ctx.invokeBrainRpc).not.toHaveBeenCalled();
  });
});
