import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { APP_HOST, PROVIDER_WAKE_ENV_KEYS } from "@lanyard/shared";

import { createApp as createControlPlaneApp } from "../../control-plane/src/app.js";
import { fingerprintSecretValue } from "../../control-plane/src/daytona-env-redact.js";
import { ControlPlaneStore } from "../../control-plane/src/store.js";
import { createTestStore } from "../../control-plane/test/pg-test-store.js";
import { createApp } from "../src/app.js";
import { ControlPlaneAuthClient } from "../src/control-plane-client.js";
import { MemoryOperatorDirectory } from "../src/operator-directory.js";
import { MemoryOpsSessionStore } from "../src/ops-session.js";
import { OPS_SESSION_COOKIE } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import {
  cookieHeader,
  createTestBindings,
  parseSetCookie,
} from "./test-helpers.js";

type JsonBody = Record<string, unknown>;

const PLAIN_XAI = "xai-live-key-plain-value";

const operator = {
  operatorId: "op-ops@lanyard.example",
  email: "ops@lanyard.example",
};

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  init: RequestInit & {
    host?: string;
    cookies?: Record<string, string>;
    csrf?: boolean;
  } = {},
): Promise<{
  status: number;
  body: JsonBody;
  raw: string;
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

  const response = await app.request(path, { ...init, headers });
  const raw = await response.text();
  const body = JSON.parse(raw) as JsonBody;
  const cookies = {
    ...init.cookies,
    ...parseSetCookie(response.headers.get("set-cookie")),
  };
  return { status: response.status, body, raw, cookies };
}

describe("ops provider secrets routes (lp-2qs.4)", () => {
  let store: ControlPlaneStore;
  let bffApp: ReturnType<typeof createApp>;
  let tenantDemo: TenantContext;
  let memberCookies: Record<string, string> = {};

  beforeEach(async () => {
    store = await createTestStore();
    const controlPlaneApp = createControlPlaneApp(store, { devOpen: true });

    const createdDemo = await store.createTenant({
      slug: "demo",
      display_name: "Demo",
    });
    tenantDemo = {
      tenant_id: createdDemo.tenant_id,
      tenant_slug: createdDemo.tenant_slug,
      display_name: createdDemo.display_name,
      host: createdDemo.host,
    };

    const authClient = new ControlPlaneAuthClient(
      "http://control-plane.test",
      (input, init) => {
        const url = new URL(input);
        return controlPlaneApp.request(url.pathname + url.search, init);
      },
    );

    bffApp = createApp(
      createTestBindings(
        { demo: tenantDemo },
        {
          authClient,
          opsSessions: new MemoryOpsSessionStore(),
          operatorDirectory: new MemoryOperatorDirectory([operator]),
          devTenantSlug: "demo",
        },
      ),
    );

    const csrfDemo = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: tenantDemo.host,
    });
    const memberReg = await jsonRequest(bffApp, "/api/auth/register", {
      method: "POST",
      host: tenantDemo.host,
      cookies: csrfDemo.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "alice@demo.test",
        password: "password123",
      }),
    });
    expect(memberReg.status).toBe(201);
    memberCookies = memberReg.cookies;
  });

  afterEach(async () => {
    await store.close();
  });

  async function opsLogin(): Promise<Record<string, string>> {
    const csrf = await jsonRequest(bffApp, "/api/admin/auth/csrf", {
      host: APP_HOST,
    });
    const stub = await jsonRequest(bffApp, "/api/admin/auth/google/stub", {
      method: "POST",
      host: APP_HOST,
      cookies: csrf.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: operator.email }),
    });
    expect(stub.status).toBe(200);
    expect(stub.cookies[OPS_SESSION_COOKIE]).toBeTruthy();
    return stub.cookies;
  }

  it("rejects a tenant cookie on the secrets list and write", async () => {
    const list = await jsonRequest(
      bffApp,
      `/api/admin/tenants/${tenantDemo.tenant_id}/secrets`,
      { host: APP_HOST, cookies: memberCookies },
    );
    expect(list.status).toBe(401);

    const csrf = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: tenantDemo.host,
      cookies: memberCookies,
    });
    const put = await jsonRequest(
      bffApp,
      `/api/admin/tenants/${tenantDemo.tenant_id}/secrets/XAI_API_KEY`,
      {
        method: "PUT",
        host: APP_HOST,
        cookies: csrf.cookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: PLAIN_XAI }),
      },
    );
    expect(put.status).toBe(401);
    const statuses = await store.listTenantProviderSecretStatuses(
      tenantDemo.tenant_id,
    );
    expect(statuses.every((row) => row.present === false)).toBe(true);
  });

  it("requires CSRF on the secret write", async () => {
    const opsCookies = await opsLogin();
    const noCsrf = await jsonRequest(
      bffApp,
      `/api/admin/tenants/${tenantDemo.tenant_id}/secrets/XAI_API_KEY`,
      {
        method: "PUT",
        host: APP_HOST,
        cookies: opsCookies,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: PLAIN_XAI }),
      },
    );
    expect(noCsrf.status).toBe(403);
  });

  it("sets a key, lists status without the value, then deletes it", async () => {
    const opsCookies = await opsLogin();

    const emptyList = await jsonRequest(
      bffApp,
      `/api/admin/tenants/${tenantDemo.tenant_id}/secrets`,
      { host: APP_HOST, cookies: opsCookies },
    );
    expect(emptyList.status).toBe(200);
    const emptySlots = emptyList.body.slots as Array<{ slot: unknown; present: boolean }>;
    expect(emptySlots).toHaveLength(
      PROVIDER_WAKE_ENV_KEYS.length + 3,
    );
    expect(emptySlots.every((row) => row.present === false)).toBe(true);

    const put = await jsonRequest(
      bffApp,
      `/api/admin/tenants/${tenantDemo.tenant_id}/secrets/XAI_API_KEY`,
      {
        method: "PUT",
        host: APP_HOST,
        cookies: opsCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: PLAIN_XAI }),
      },
    );
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({
      tenant_id: tenantDemo.tenant_id,
      present: true,
      fingerprint: fingerprintSecretValue(PLAIN_XAI),
    });
    // Value never echoed back through the admin API.
    expect(put.raw).not.toContain(PLAIN_XAI);

    // Cold-wake inject path sees the decrypted value.
    const wakeEnv = await store.getTenantProviderWakeEnvValues(
      tenantDemo.tenant_id,
    );
    expect(wakeEnv.XAI_API_KEY).toBe(PLAIN_XAI);

    const del = await jsonRequest(
      bffApp,
      `/api/admin/tenants/${tenantDemo.tenant_id}/secrets/XAI_API_KEY`,
      {
        method: "DELETE",
        host: APP_HOST,
        cookies: opsCookies,
        csrf: true,
      },
    );
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ ok: true, deleted: true });
    const after = await store.getTenantProviderWakeEnvValues(
      tenantDemo.tenant_id,
    );
    expect(after.XAI_API_KEY).toBeUndefined();
  });

  it("rejects unknown slots with 400 before CP is called", async () => {
    const opsCookies = await opsLogin();
    const badSlot = await jsonRequest(
      bffApp,
      `/api/admin/tenants/${tenantDemo.tenant_id}/secrets/TOTALLY_REAL_KEY`,
      {
        method: "PUT",
        host: APP_HOST,
        cookies: opsCookies,
        csrf: true,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "v" }),
      },
    );
    expect(badSlot.status).toBe(400);
  });
});

