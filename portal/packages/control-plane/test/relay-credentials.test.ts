import { describe, expect, it, vi } from "vitest";

import {
  createHttpRelayCredentialsNotifier,
  RELAY_INTERNAL_TOKEN_HEADER,
  resolveRelayInternalBaseUrl,
} from "../src/relay-credentials.js";
import { createApp } from "../src/app.js";
import {
  createInMemoryInstanceSecretMaterialStore,
} from "../src/gateway-relay-env.js";
import { createTestStore } from "./pg-test-store.js";

const INTERNAL_TOKEN = "test-relay-internal-token";
const INSTANCE_ID = "11111111-1111-4111-8111-111111111111";

const hasDatabase = Boolean(
  process.env.CONTROL_PLANE_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim(),
);

describe("createHttpRelayCredentialsNotifier (lp-3a1.3)", () => {
  it("POSTs credentials with internal token and never requires Redis", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const notifier = createHttpRelayCredentialsNotifier({
      baseUrl: "http://relay.test/",
      internalToken: INTERNAL_TOKEN,
      fetchFn,
    });

    const result = await notifier.upsert({
      instanceId: INSTANCE_ID,
      gatewayId: INSTANCE_ID,
      secrets: ["new-secret", "old-secret"],
      tenantId: "tenant-1",
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      `http://relay.test/internal/instances/${INSTANCE_ID}/credentials`,
    );
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers[RELAY_INTERNAL_TOKEN_HEADER]).toBe(INTERNAL_TOKEN);
    const body = JSON.parse(String(calls[0]!.init.body)) as {
      gateway_id: string;
      secrets: string[];
      tenant_id: string;
    };
    expect(body.gateway_id).toBe(INSTANCE_ID);
    expect(body.secrets).toEqual(["new-secret", "old-secret"]);
    expect(body.tenant_id).toBe("tenant-1");
  });

  it("returns ok:false on non-2xx without throwing", async () => {
    const notifier = createHttpRelayCredentialsNotifier({
      baseUrl: "http://relay.test",
      internalToken: INTERNAL_TOKEN,
      fetchFn: async () =>
        new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
        }),
    });
    const result = await notifier.upsert({
      instanceId: INSTANCE_ID,
      gatewayId: INSTANCE_ID,
      secrets: ["s"],
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.error).toMatch(/Unauthorized/i);
  });

  it("returns ok:false on network error without throwing", async () => {
    const notifier = createHttpRelayCredentialsNotifier({
      baseUrl: "http://relay.test",
      internalToken: INTERNAL_TOKEN,
      fetchFn: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const result = await notifier.upsert({
      instanceId: INSTANCE_ID,
      gatewayId: INSTANCE_ID,
      secrets: ["s"],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ECONNREFUSED/);
  });
});

describe("resolveRelayInternalBaseUrl", () => {
  it("prefers RELAY_INTERNAL_URL over RELAY_URL", () => {
    expect(
      resolveRelayInternalBaseUrl({
        RELAY_INTERNAL_URL: "http://relay-internal:8787",
        RELAY_URL: "wss://relay.example/relay",
      } as NodeJS.ProcessEnv),
    ).toBe("http://relay-internal:8787");
  });

  it("falls back to RELAY_URL", () => {
    expect(
      resolveRelayInternalBaseUrl({
        RELAY_URL: "http://relay:8787",
      } as NodeJS.ProcessEnv),
    ).toBe("http://relay:8787");
  });
});

describe.skipIf(!hasDatabase)(
  "CP register/rotate notifies Relay (lp-3a1.3)",
  () => {
    it("register and rotate call relayCredentials.upsert best-effort", async () => {
      const secretMaterial = createInMemoryInstanceSecretMaterialStore();
      const store = await createTestStore({
        sharedRelayWssUrl: "wss://relay.example.test/relay",
        secretMaterial,
      });
      const tenant = await store.createTenant({
        slug: `notify-lab-${Date.now().toString(36)}`,
        display_name: "Notify Lab",
      });

      const upsert = vi.fn(async () => ({ ok: true as const, status: 200 }));
      const app = createApp(store, {
        serviceToken: "test-service-token",
        authMode: "development",
        devOpen: true,
        secretMaterial,
        relayCredentials: { upsert },
      });

      const registerRes = await app.request(
        `/tenants/${tenant.tenant_id}/instances/register`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-lanyard-actor": "test",
            "x-control-plane-service-token": "test-service-token",
          },
          body: JSON.stringify({ runtime_kind: "daytona" }),
        },
      );
      expect(registerRes.status).toBe(201);
      const registered = (await registerRes.json()) as {
        instance_id: string;
        secret: string;
        tenant_id: string;
      };
      expect(upsert).toHaveBeenCalledTimes(1);
      expect(upsert.mock.calls[0]![0]).toMatchObject({
        instanceId: registered.instance_id,
        gatewayId: registered.instance_id,
        tenantId: registered.tenant_id,
        secrets: [registered.secret],
      });

      const rotateRes = await app.request(
        `/tenants/${tenant.tenant_id}/instances/${registered.instance_id}/rotate`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-lanyard-actor": "test",
            "x-control-plane-service-token": "test-service-token",
          },
          body: JSON.stringify({ grace_period_seconds: 900 }),
        },
      );
      expect(rotateRes.status).toBe(200);
      const rotated = (await rotateRes.json()) as {
        secret: string;
        grace_period_seconds: number;
        previous_secret?: string;
      };
      expect(rotated.grace_period_seconds).toBe(900);
      expect(upsert).toHaveBeenCalledTimes(2);
      const rotateCall = upsert.mock.calls[1]![0] as {
        secrets: string[];
        instanceId: string;
      };
      // New secret first; previous secret dual-accepted during grace.
      expect(rotateCall.secrets[0]).toBe(rotated.secret);
      expect(rotateCall.secrets).toContain(registered.secret);
      expect(rotateCall.secrets).toHaveLength(2);
      // API body never re-exposes previous secret plaintext.
      expect(rotated.previous_secret).toBeUndefined();
    });

    it("register still succeeds when Relay notify fails", async () => {
      const store = await createTestStore({
        sharedRelayWssUrl: "wss://relay.example.test/relay",
      });
      const tenant = await store.createTenant({
        slug: `notify-fail-${Date.now().toString(36)}`,
        display_name: "Notify Fail",
      });

      const upsert = vi.fn(async () => ({
        ok: false as const,
        status: 503,
        error: "relay down",
      }));
      const app = createApp(store, {
        serviceToken: "test-service-token",
        authMode: "development",
        devOpen: true,
        relayCredentials: { upsert },
      });

      const res = await app.request(
        `/tenants/${tenant.tenant_id}/instances/register`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-control-plane-service-token": "test-service-token",
          },
          body: "{}",
        },
      );
      expect(res.status).toBe(201);
      const body = (await res.json()) as {
        secret: string;
        instance_id: string;
      };
      expect(body.secret).toBeTruthy();
      expect(body.instance_id).toBeTruthy();
      expect(upsert).toHaveBeenCalled();
    });
  },
);
