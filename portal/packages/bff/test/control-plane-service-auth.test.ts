import { describe, expect, it, vi } from "vitest";

import { APP_HOST, defaultAppHosts } from "@lanyard/shared";

import {
  DEV_CONTROL_PLANE_SERVICE_TOKEN,
  DEV_RELAY_INTERNAL_TOKEN,
  DEV_SESSION_SECRET,
  loadAppHosts,
  loadConfig,
  loadControlPlaneServiceToken,
  loadRelayInternalToken,
  loadSessionSecret,
} from "../src/config.js";
import {
  CONTROL_PLANE_SERVICE_TOKEN_HEADER,
  ControlPlaneAuthClient,
  ControlPlaneRequestError,
  ORCHESTRATOR_API_PATHS,
} from "../src/control-plane-client.js";

describe("BFF APP_HOSTS (path-first app hosts)", () => {
  it("defaults to shared app hosts when APP_HOSTS is unset", () => {
    expect(loadAppHosts({})).toEqual(defaultAppHosts());
    const config = loadConfig({ CONTROL_PLANE_URL: "http://cp.test" });
    expect(config.appHosts).toEqual(defaultAppHosts());
    expect(config.appHosts).toContain(APP_HOST);
  });

  it("merges comma-separated APP_HOSTS with defaults", () => {
    const hosts = loadAppHosts({
      APP_HOSTS: " d1watnzk551glk.cloudfront.net, example.cloudfront.net ",
    });
    expect(hosts).toContain(APP_HOST);
    expect(hosts).toContain("localhost");
    expect(hosts).toContain("d1watnzk551glk.cloudfront.net");
    expect(hosts).toContain("example.cloudfront.net");
  });
});

describe("BFF control-plane service credentials (G1.2)", () => {
  it("defaults to the dev service token outside production", () => {
    const token = loadControlPlaneServiceToken({});
    expect(token).toBe(DEV_CONTROL_PLANE_SERVICE_TOKEN);

    const config = loadConfig({
      CONTROL_PLANE_URL: "http://cp.test",
    });
    expect(config.controlPlaneServiceToken).toBe(
      DEV_CONTROL_PLANE_SERVICE_TOKEN,
    );
  });

  it("rejects missing or placeholder service token in production", () => {
    expect(() =>
      loadControlPlaneServiceToken({ NODE_ENV: "production" }),
    ).toThrow(/CONTROL_PLANE_SERVICE_TOKEN/);

    expect(() =>
      loadControlPlaneServiceToken({
        NODE_ENV: "production",
        CONTROL_PLANE_SERVICE_TOKEN: DEV_CONTROL_PLANE_SERVICE_TOKEN,
      }),
    ).toThrow(/non-development/);

    expect(
      loadControlPlaneServiceToken({
        NODE_ENV: "production",
        CONTROL_PLANE_SERVICE_TOKEN: "prod-bff-cp-secret",
      }),
    ).toBe("prod-bff-cp-secret");
  });

  it("rejects missing or placeholder relayInternalToken and sessionSecret in production", () => {
    expect(() => loadRelayInternalToken({ NODE_ENV: "production" })).toThrow(
      /RELAY_INTERNAL_TOKEN/,
    );
    expect(() =>
      loadRelayInternalToken({
        NODE_ENV: "production",
        RELAY_INTERNAL_TOKEN: DEV_RELAY_INTERNAL_TOKEN,
      }),
    ).toThrow(/non-development/);
    expect(
      loadRelayInternalToken({
        NODE_ENV: "production",
        RELAY_INTERNAL_TOKEN: "prod-relay-secret",
      }),
    ).toBe("prod-relay-secret");

    expect(() => loadSessionSecret({ NODE_ENV: "production" })).toThrow(
      /SESSION_SECRET/,
    );
    expect(() =>
      loadSessionSecret({
        NODE_ENV: "production",
        SESSION_SECRET: DEV_SESSION_SECRET,
      }),
    ).toThrow(/non-development/);
    expect(
      loadSessionSecret({
        NODE_ENV: "production",
        SESSION_SECRET: "prod-session-secret-value",
      }),
    ).toBe("prod-session-secret-value");

    expect(() =>
      loadConfig({
        NODE_ENV: "production",
        CONTROL_PLANE_SERVICE_TOKEN: "prod-bff-cp-secret",
        // missing RELAY_INTERNAL_TOKEN + SESSION_SECRET
      }),
    ).toThrow(/RELAY_INTERNAL_TOKEN|SESSION_SECRET/);

    const ok = loadConfig({
      NODE_ENV: "production",
      CONTROL_PLANE_SERVICE_TOKEN: "prod-bff-cp-secret",
      RELAY_INTERNAL_TOKEN: "prod-relay-secret",
      SESSION_SECRET: "prod-session-secret-value",
    });
    expect(ok.relayInternalToken).toBe("prod-relay-secret");
    expect(ok.sessionSecret).toBe("prod-session-secret-value");
  });

  it("allows dev placeholders outside production", () => {
    const config = loadConfig({ CONTROL_PLANE_URL: "http://cp.test" });
    expect(config.relayInternalToken).toBe(DEV_RELAY_INTERNAL_TOKEN);
    expect(config.sessionSecret).toBe(DEV_SESSION_SECRET);
  });

  it("attaches the service token header on every CP request", async () => {
    const requestFn = vi.fn(async () =>
      Response.json(
        {
          user_id: "u1",
          tenant_id: "t1",
          email: "a@example.com",
        },
        { status: 200 },
      ),
    );

    const client = new ControlPlaneAuthClient("http://cp.test", requestFn, {
      serviceToken: "bff-service-secret",
    });

    await client.login({
      tenantId: "t1",
      email: "a@example.com",
      password: "password123",
    });

    expect(requestFn).toHaveBeenCalledTimes(1);
    const [, init] = requestFn.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(headers.get(CONTROL_PLANE_SERVICE_TOKEN_HEADER)).toBe(
      "bff-service-secret",
    );
  });

  it("cannot call CP successfully without credentials when CP enforces service auth", async () => {
    // Simulate a production CP: reject requests missing the service header.
    const requestFn = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const token = headers.get(CONTROL_PLANE_SERVICE_TOKEN_HEADER);
      if (token !== "expected-service-token") {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      }
      return Response.json(
        {
          user_id: "u1",
          tenant_id: "t1",
          email: "a@example.com",
        },
        { status: 200 },
      );
    });

    const anonymous = new ControlPlaneAuthClient(
      "http://cp.test",
      requestFn,
    );
    await expect(
      anonymous.login({
        tenantId: "t1",
        email: "a@example.com",
        password: "password123",
      }),
    ).rejects.toMatchObject({ status: 401 });

    const spoofed = new ControlPlaneAuthClient("http://cp.test", requestFn, {
      serviceToken: "wrong",
    });
    await expect(
      spoofed.login({
        tenantId: "t1",
        email: "a@example.com",
        password: "password123",
      }),
    ).rejects.toMatchObject({ status: 401 });

    const allowed = new ControlPlaneAuthClient("http://cp.test", requestFn, {
      serviceToken: "expected-service-token",
    });
    const user = await allowed.login({
      tenantId: "t1",
      email: "a@example.com",
      password: "password123",
    });
    expect(user.email).toBe("a@example.com");
  });
});

describe("BFF ControlPlaneAuthClient orchestrator stubs (lp-biq)", () => {
  const instanceId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  it("exports path builders matching CP contract", () => {
    expect(ORCHESTRATOR_API_PATHS.ensureOnline(instanceId)).toBe(
      `/internal/instances/${instanceId}/ensure-online`,
    );
    expect(ORCHESTRATOR_API_PATHS.presence(instanceId)).toBe(
      `/internal/instances/${instanceId}/presence`,
    );
    expect(ORCHESTRATOR_API_PATHS.signalActivity(instanceId)).toBe(
      `/internal/instances/${instanceId}/signal-activity`,
    );
    expect(ORCHESTRATOR_API_PATHS.stop(instanceId)).toBe(
      `/internal/instances/${instanceId}/stop`,
    );
    expect(ORCHESTRATOR_API_PATHS.ensureOnlineByUser("t1", "u1")).toBe(
      "/internal/tenants/t1/users/u1/ensure-online",
    );
  });

  it("ensureOnline posts to the stub path and surfaces 501", async () => {
    const requestFn = vi.fn(async (url: string) => {
      expect(url).toBe(
        `http://cp.test${ORCHESTRATOR_API_PATHS.ensureOnline(instanceId)}`,
      );
      return Response.json(
        {
          error: "not_implemented",
          code: "ORCHESTRATOR_NOT_IMPLEMENTED",
          operation: "ensure_online",
          instance_id: instanceId,
        },
        { status: 501 },
      );
    });

    const client = new ControlPlaneAuthClient("http://cp.test", requestFn, {
      serviceToken: "tok",
    });

    await expect(
      client.ensureOnline(instanceId, { wait_timeout_ms: 1000 }),
    ).rejects.toBeInstanceOf(ControlPlaneRequestError);

    try {
      await client.ensureOnline(instanceId);
    } catch (err) {
      expect(err).toMatchObject({ status: 501 });
    }
  });

  it("ensureOnlineByUser posts to the user route with tenant+user headers", async () => {
    const tenantId = "t1";
    const userId = "u1";
    const requestFn = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(
        `http://cp.test${ORCHESTRATOR_API_PATHS.ensureOnlineByUser(tenantId, userId)}`,
      );
      expect(init?.method).toBe("POST");
      const headers = new Headers(init?.headers);
      expect(headers.get("x-lanyard-tenant-id")).toBe(tenantId);
      expect(headers.get("x-lanyard-user-id")).toBe(userId);
      return Response.json(
        {
          instance_id: instanceId,
          tenant_id: tenantId,
          user_id: userId,
          presence: "online",
          sandbox_id: "sbx-1",
          runtime_kind: "daytona",
          already_online: true,
          wake_joined: false,
          source: "user",
        },
        { status: 200 },
      );
    });

    const client = new ControlPlaneAuthClient("http://cp.test", requestFn, {
      serviceToken: "tok",
    });
    const result = await client.ensureOnlineByUser(tenantId, userId, {});
    expect(result.instance_id).toBe(instanceId);
    expect(result.source).toBe("user");
    expect(result.user_id).toBe(userId);
  });

  it("getInstancePresence types a successful presence response", async () => {
    const requestFn = vi.fn(async () =>
      Response.json(
        {
          instance_id: instanceId,
          tenant_id: "t1",
          presence: "offline",
          sandbox_id: null,
          runtime_kind: "daytona",
          agent_snapshot_id: "snap-1",
          s3_vault_prefix: "tenants/t1/vault/",
          last_activity_at: null,
          revoked_at: null,
        },
        { status: 200 },
      ),
    );

    const client = new ControlPlaneAuthClient("http://cp.test", requestFn, {
      serviceToken: "tok",
    });
    const presence = await client.getInstancePresence(instanceId);
    expect(presence.presence).toBe("offline");
    expect(presence.runtime_kind).toBe("daytona");
    expect(presence.s3_vault_prefix).toBe("tenants/t1/vault/");
  });

  it("signalActivity and stopInstance call the declared paths", async () => {
    const seen: string[] = [];
    const requestFn = vi.fn(async (url: string) => {
      seen.push(url);
      return Response.json(
        { error: "not_implemented", operation: "stub" },
        { status: 501 },
      );
    });

    const client = new ControlPlaneAuthClient("http://cp.test", requestFn, {
      serviceToken: "tok",
    });

    await expect(client.signalActivity(instanceId)).rejects.toMatchObject({
      status: 501,
    });
    await expect(
      client.stopInstance(instanceId, { reason: "idle_stop" }),
    ).rejects.toMatchObject({ status: 501 });

    expect(seen).toEqual([
      `http://cp.test${ORCHESTRATOR_API_PATHS.signalActivity(instanceId)}`,
      `http://cp.test${ORCHESTRATOR_API_PATHS.stop(instanceId)}`,
    ]);
  });
});
