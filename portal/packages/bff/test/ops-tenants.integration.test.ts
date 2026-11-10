import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { APP_HOST } from "@lanyard/shared";

import { createApp as createControlPlaneApp } from "../../control-plane/src/app.js";
import { FakeS3ObjectStore } from "../../control-plane/src/fake-s3-object-store.js";
import { ControlPlaneStore } from "../../control-plane/src/store.js";
import { createTestStore } from "../../control-plane/test/pg-test-store.js";
import { createApp } from "../src/app.js";
import { ControlPlaneAuthClient } from "../src/control-plane-client.js";
import { MemoryOperatorDirectory } from "../src/operator-directory.js";
import { MemoryOpsSessionStore } from "../src/ops-session.js";
import { OPS_SESSION_COOKIE, SESSION_COOKIE } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import {
  cookieHeader,
  createTestBindings,
  parseSetCookie,
} from "./test-helpers.js";

type JsonBody = Record<string, unknown>;

const INSTANCE_SECRET_MARKER = "instance-secret-material";

const operator = {
  operatorId: "op-ops@lanyard.example",
  email: "ops@lanyard.example",
};

const VAULT_ONLY_TENANT_ID = "7d451eb7-c4c6-4a9d-a361-c6391622d036";
const VAULT_BUCKET = "lanyard-ops-vault-test";

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
  const body = JSON.parse(raw || "{}") as JsonBody;
  const cookies = {
    ...init.cookies,
    ...parseSetCookie(response.headers.get("set-cookie")),
  };
  return { status: response.status, body, raw, cookies };
}

describe("ops tenants/instances/roles/audit lists (lp-2qs.5)", () => {
  let store: ControlPlaneStore;
  let bffApp: ReturnType<typeof createApp>;
  let tenantDemo: TenantContext;
  let memberCookies: Record<string, string> = {};
  let vaultStore: FakeS3ObjectStore;

  beforeEach(async () => {
    store = await createTestStore();
    vaultStore = new FakeS3ObjectStore();
    const controlPlaneApp = createControlPlaneApp(store, {
      devOpen: true,
      vaultObjectStore: vaultStore,
      vaultBucket: VAULT_BUCKET,
    });

    const createdDemo = await store.createTenant({
      slug: "mocklab",
      display_name: "MockLab",
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
        { mocklab: tenantDemo },
        {
          authClient,
          opsSessions: new MemoryOpsSessionStore(),
          operatorDirectory: new MemoryOperatorDirectory([operator]),
          devTenantSlug: "mocklab",
        },
      ),
    );

    const csrf = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: tenantDemo.host,
    });
    const memberReg = await jsonRequest(bffApp, "/api/auth/register", {
      method: "POST",
      host: tenantDemo.host,
      cookies: csrf.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "alice@mocklab.test",
        password: "password123",
      }),
    });
    expect(memberReg.status).toBe(201);
    memberCookies = memberReg.cookies;

    const provisioned = await store.provisionInstance({
      tenant_id: tenantDemo.tenant_id,
      runtime_kind: "daytona",
      agent_snapshot_id: "snap-test",
    });
    // The provisioning secret must never appear on any list surface.
    expect(provisioned.secret).toBeTruthy();
    (globalThis as Record<string, unknown>).__lp2qs5Secret =
      provisioned.secret;

    await store.createRole({
      tenant_id: tenantDemo.tenant_id,
      name: "admin",
      hermes_profile: "workspace",
      path_prefixes: ["/projects"],
      actor: operator.email,
    });

    await store.recordAudit({
      tenant_id: tenantDemo.tenant_id,
      action: "role.created",
      actor: operator.email,
      metadata: { name: "admin" },
    });
  });

  afterEach(async () => {
    delete (globalThis as Record<string, unknown>).__lp2qs5Secret;
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

  it("lists tenants for an ops session", async () => {
    const opsCookies = await opsLogin();
    const list = await jsonRequest(bffApp, "/api/admin/tenants", {
      host: APP_HOST,
      cookies: opsCookies,
    });
    expect(list.status).toBe(200);
    expect(list.body.tenants).toEqual([
      {
        tenant_id: tenantDemo.tenant_id,
        tenant_slug: "mocklab",
        display_name: "MockLab",
      },
    ]);
  });

  it("lists gateway instances without exposing instance secrets", async () => {
    const opsCookies = await opsLogin();
    const secret = (globalThis as Record<string, unknown>)
      .__lp2qs5Secret as string;
    const list = await jsonRequest(bffApp,
      `/api/admin/tenants/${tenantDemo.tenant_id}/instances`,
      { host: APP_HOST, cookies: opsCookies },
    );
    expect(list.status).toBe(200);
    const instances = list.body.instances as Array<{
      instance_id: string;
      runtime_kind: string;
      presence: string;
    }>;
    expect(instances).toHaveLength(1);
    expect(instances[0]).toMatchObject({
      runtime_kind: "daytona",
      presence: "offline",
    });
    expect(list.raw).not.toContain(secret);
    expect(list.raw).not.toContain("secret_hash");
    expect(list.raw).not.toContain("secret_salt");
  });

  it("lists roles and audit entries per tenant", async () => {
    const opsCookies = await opsLogin();

    const roles = await jsonRequest(bffApp,
      `/api/admin/tenants/${tenantDemo.tenant_id}/roles`,
      { host: APP_HOST, cookies: opsCookies },
    );
    expect(roles.status).toBe(200);
    const roleRows = roles.body.roles as Array<{ name: string; path_prefixes: string[] }>;
    expect(roleRows).toHaveLength(1);
    expect(roleRows[0]).toMatchObject({
      name: "admin",
      hermes_profile: "workspace",
      path_prefixes: ["/projects"],
    });

    const audit = await jsonRequest(bffApp,
      `/api/admin/tenants/${tenantDemo.tenant_id}/audit`,
      { host: APP_HOST, cookies: opsCookies },
    );
    expect(audit.status).toBe(200);
    const entries = audit.body.entries as Array<{ action: string; actor: string }>;
    expect(entries.some((row) => row.action === "role.created")).toBe(true);
    expect(
      entries.find((row) => row.action === "role.created")?.actor,
    ).toBe(operator.email);
  });

  it("rejects tenant cookies and anonymous callers on ops list routes", async () => {
    const anon = await jsonRequest(bffApp, "/api/admin/tenants", {
      host: APP_HOST,
    });
    expect(anon.status).toBe(401);

    const tenantCookie = await jsonRequest(bffApp, "/api/admin/tenants", {
      host: APP_HOST,
      cookies: memberCookies,
    });
    expect(tenantCookie.status).toBe(401);

    for (const suffix of ["instances", "roles", "audit"]) {
      const res = await jsonRequest(bffApp,
        `/api/admin/tenants/${tenantDemo.tenant_id}/${suffix}`,
        { host: APP_HOST, cookies: memberCookies },
      );
      expect(res.status).toBe(401);
    }
  });

  it("surfaces CP 404 as HTTP 404 for an unknown tenant", async () => {
    const opsCookies = await opsLogin();
    const res = await jsonRequest(bffApp,
      "/api/admin/tenants/t-does-not-exist/instances",
      { host: APP_HOST, cookies: opsCookies },
    );
    expect(res.status).toBe(404);
  });

  it("lp-2qs.7: unions vault prefixes (MockLab + vault-only 7d451eb7-…)", async () => {
    // Vault-only prefix that is NOT in the CP tenants table. Must appear on /admin.
    vaultStore.seed(
      VAULT_BUCKET,
      `tenants/${VAULT_ONLY_TENANT_ID}/vault/marker.json`,
      "{}",
      "application/json",
    );
    // A non-tenant prefix under tenants/ must NOT leak as a tenant.
    vaultStore.seed(
      VAULT_BUCKET,
      "tenants/_platform/vault-prefix-ensured.json",
      "{}",
      "application/json",
    );

    const opsCookies = await opsLogin();
    const list = await jsonRequest(bffApp, "/api/admin/tenants", {
      host: APP_HOST,
      cookies: opsCookies,
    });
    expect(list.status).toBe(200);
    const tenants = list.body.tenants as Array<{
      tenant_id: string;
      tenant_slug: string;
      display_name: string;
    }>;
    const ids = tenants.map((t) => t.tenant_id);
    expect(ids).toContain(tenantDemo.tenant_id);
    expect(ids).toContain(VAULT_ONLY_TENANT_ID);
    expect(ids).not.toContain("_platform");

    const vaultOnly = tenants.find((t) => t.tenant_id === VAULT_ONLY_TENANT_ID);
    expect(vaultOnly).toEqual({
      tenant_id: VAULT_ONLY_TENANT_ID,
      tenant_slug: VAULT_ONLY_TENANT_ID,
      display_name: VAULT_ONLY_TENANT_ID,
    });

    const mocklab = tenants.find((t) => t.tenant_id === tenantDemo.tenant_id);
    expect(mocklab).toEqual({
      tenant_id: tenantDemo.tenant_id,
      tenant_slug: "mocklab",
      display_name: "MockLab",
    });

    // Stable sort by slug.
    const sorted = [...tenants].sort((a, b) =>
      a.tenant_slug.localeCompare(b.tenant_slug),
    );
    expect(tenants).toEqual(sorted);
  });

  it("lp-2qs.7: still returns CP tenants when vault list fails (no 500)", async () => {
    vaultStore.setError(new Error("vault S3 unavailable for test"));
    const opsCookies = await opsLogin();
    const list = await jsonRequest(bffApp, "/api/admin/tenants", {
      host: APP_HOST,
      cookies: opsCookies,
    });
    expect(list.status).toBe(200);
    const tenants = list.body.tenants as Array<{ tenant_id: string }>;
    expect(tenants.some((t) => t.tenant_id === tenantDemo.tenant_id)).toBe(true);
  });
});
