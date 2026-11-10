import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp as createControlPlaneApp } from "../../control-plane/src/app.js";
import { ControlPlaneStore } from "../../control-plane/src/store.js";
import { createTestStore } from "../../control-plane/test/pg-test-store.js";
import { createApp } from "../src/app.js";
import { ControlPlaneAuthClient } from "../src/control-plane-client.js";
import { SessionStore } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import {
  cookieHeader,
  createTestBindings,
  parseSetCookie,
} from "./test-helpers.js";

type JsonBody = Record<string, unknown>;

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  init: RequestInit & {
    host?: string;
    cookies?: Record<string, string>;
    csrf?: boolean;
  } = {},
): Promise<{ status: number; body: JsonBody; cookies: Record<string, string> }> {
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
  const body = (await response.json()) as JsonBody;
  const cookies = {
    ...init.cookies,
    ...parseSetCookie(response.headers.get("set-cookie")),
  };
  return { status: response.status, body, cookies };
}

describe("bff RBAC vault isolation", () => {
  let store: ControlPlaneStore;
  let controlPlaneApp: ReturnType<typeof createControlPlaneApp>;
  let bffApp: ReturnType<typeof createApp>;
  let tenant: TenantContext;
  let roleAId: string;
  let roleBId: string;

  beforeEach(async () => {
    store = await createTestStore();
    controlPlaneApp = createControlPlaneApp(store, { devOpen: true });

    const created = await store.createTenant({
      slug: "isolation",
      display_name: "Isolation",
    });
    tenant = {
      tenant_id: created.tenant_id,
      tenant_slug: created.tenant_slug,
      display_name: created.display_name,
      host: created.host,
    };

    const roleA = await store.createRole({
      tenant_id: tenant.tenant_id,
      name: "team-a",
      hermes_profile: "profile-a",
      path_prefixes: ["/Projects/A"],
    });
    const roleB = await store.createRole({
      tenant_id: tenant.tenant_id,
      name: "team-b",
      hermes_profile: "profile-b",
      path_prefixes: ["/Projects/B"],
    });
    roleAId = roleA.role_id;
    roleBId = roleB.role_id;

    const authClient = new ControlPlaneAuthClient(
      "http://control-plane.test",
      (input, init) => {
        const url = new URL(input);
        return controlPlaneApp.request(url.pathname + url.search, init);
      },
    );

    bffApp = createApp(
      createTestBindings(
        { isolation: tenant },
        { authClient, sessions: new SessionStore() },
      ),
    );
  });

  afterEach(async () => {
    await store.close();
  });

  async function registerAndAssignRole(
    email: string,
    roleId: string,
  ): Promise<Record<string, string>> {
    const csrf = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: tenant.host,
    });
    const register = await jsonRequest(bffApp, "/api/auth/register", {
      method: "POST",
      host: tenant.host,
      cookies: csrf.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password: "password123" }),
    });
    expect(register.status).toBe(201);

    await store.setUserRoles({
      tenant_id: tenant.tenant_id,
      user_id: register.body.user_id as string,
      role_ids: [roleId],
    });

    return register.cookies;
  }

  it("allows each user only their role path prefixes", async () => {
    const cookiesA = await registerAndAssignRole("a@example.com", roleAId);
    const cookiesB = await registerAndAssignRole("b@example.com", roleBId);

    const allowedA = await jsonRequest(
      bffApp,
      "/api/vault/access-check?path=/Projects/A/note.md",
      { host: tenant.host, cookies: cookiesA },
    );
    expect(allowedA.status).toBe(200);
    expect(allowedA.body.allowed).toBe(true);
    expect(allowedA.body.hermes_profile).toBe("profile-a");

    const deniedA = await jsonRequest(
      bffApp,
      "/api/vault/access-check?path=/Projects/B/secret.md",
      { host: tenant.host, cookies: cookiesA },
    );
    expect(deniedA.status).toBe(403);

    const allowedB = await jsonRequest(
      bffApp,
      "/api/vault/access-check?path=/Projects/B/plan.md",
      { host: tenant.host, cookies: cookiesB },
    );
    expect(allowedB.status).toBe(200);
    expect(allowedB.body.hermes_profile).toBe("profile-b");

    const deniedB = await jsonRequest(
      bffApp,
      "/api/vault/access-check?path=/Projects/A/note.md",
      { host: tenant.host, cookies: cookiesB },
    );
    expect(deniedB.status).toBe(403);
  });
});