import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp as createControlPlaneApp } from "../../control-plane/src/app.js";
import { ControlPlaneStore } from "../../control-plane/src/store.js";
import { createTestStore } from "../../control-plane/test/pg-test-store.js";
import { FIXTURE_INDEX_LAST_INDEXED_AT } from "../src/vault/fixture-index.js";
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

describe("bff vault browser (#12)", () => {
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
      // "vault" is a reserved path segment and is rejected as a tenant slug.
      slug: "vaultlab",
      display_name: "Vault",
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
        { [tenant.tenant_slug]: tenant },
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

  it("returns 403 for denied vault content path", async () => {
    const cookiesA = await registerAndAssignRole("a@example.com", roleAId);

    const denied = await jsonRequest(
      bffApp,
      "/api/vault/content?path=/Projects/B/secret.md",
      { host: tenant.host, cookies: cookiesA },
    );
    expect(denied.status).toBe(403);
    expect(denied.body.error).toMatch(/not permitted/i);
  });

  it("returns allowed markdown content for permitted path", async () => {
    const cookiesA = await registerAndAssignRole("a@example.com", roleAId);

    const allowed = await jsonRequest(
      bffApp,
      "/api/vault/content?path=/Projects/A/notes.md",
      { host: tenant.host, cookies: cookiesA },
    );
    expect(allowed.status).toBe(200);
    expect(allowed.body.path).toBe("/Projects/A/notes.md");
    expect(allowed.body.mime_type).toBe("text/markdown");
    expect(allowed.body.encoding).toBe("utf-8");
    expect(String(allowed.body.content)).toContain("vault browser (#12)");
  });

  it("tree exposes only ACL-scoped roots", async () => {
    const cookiesA = await registerAndAssignRole("a@example.com", roleAId);
    const cookiesB = await registerAndAssignRole("b@example.com", roleBId);

    const treeA = await jsonRequest(bffApp, "/api/vault/tree", {
      host: tenant.host,
      cookies: cookiesA,
    });
    expect(treeA.status).toBe(200);
    const rootsA = treeA.body.roots as Array<{ path: string }>;
    expect(rootsA).toHaveLength(1);
    expect(rootsA[0]?.path).toBe("/Projects/A");

    const treeB = await jsonRequest(bffApp, "/api/vault/tree", {
      host: tenant.host,
      cookies: cookiesB,
    });
    const rootsB = treeB.body.roots as Array<{ path: string }>;
    expect(rootsB).toHaveLength(1);
    expect(rootsB[0]?.path).toBe("/Projects/B");
  });

  it("entries listing omits paths outside role prefix", async () => {
    const cookiesA = await registerAndAssignRole("a@example.com", roleAId);

    const listing = await jsonRequest(
      bffApp,
      "/api/vault/entries?path=/Projects/A",
      { host: tenant.host, cookies: cookiesA },
    );
    expect(listing.status).toBe(200);
    expect(listing.body.truncated).toBe(false);
    expect(listing.body.next_cursor).toBeNull();
    const entries = listing.body.entries as Array<{ path: string }>;
    const paths = entries.map((entry) => entry.path);
    expect(paths).toContain("/Projects/A/README.md");
    expect(paths).not.toContain("/Projects/B/secret.md");
  });
});

describe("bff vault search (#13)", () => {
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
      slug: "vault-search",
      display_name: "Vault Search",
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
        { "vault-search": tenant },
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

  it("returns fixture index hit with last_indexed_at", async () => {
    const cookiesA = await registerAndAssignRole("a@example.com", roleAId);

    const search = await jsonRequest(
      bffApp,
      "/api/vault/search?q=kickoff",
      { host: tenant.host, cookies: cookiesA },
    );
    expect(search.status).toBe(200);
    expect(search.body.query).toBe("kickoff");
    expect(search.body.last_indexed_at).toBe(FIXTURE_INDEX_LAST_INDEXED_AT);

    const results = search.body.results as Array<{ path: string; snippet: string }>;
    expect(results.length).toBeGreaterThan(0);
    expect(results.some((hit) => hit.path === "/Projects/A/notes.md")).toBe(true);
    expect(results.every((hit) => hit.path.startsWith("/Projects/A"))).toBe(true);
  });

  it("filters search results by ACL prefix", async () => {
    const cookiesA = await registerAndAssignRole("a@example.com", roleAId);
    const cookiesB = await registerAndAssignRole("b@example.com", roleBId);

    const searchA = await jsonRequest(
      bffApp,
      "/api/vault/search?q=roadmap",
      { host: tenant.host, cookies: cookiesA },
    );
    const searchB = await jsonRequest(
      bffApp,
      "/api/vault/search?q=roadmap",
      { host: tenant.host, cookies: cookiesB },
    );

    expect(searchA.status).toBe(200);
    expect(searchB.status).toBe(200);

    const pathsA = (searchA.body.results as Array<{ path: string }>).map(
      (hit) => hit.path,
    );
    const pathsB = (searchB.body.results as Array<{ path: string }>).map(
      (hit) => hit.path,
    );

    expect(pathsA).not.toContain("/Projects/B/plan.md");
    expect(pathsB).toContain("/Projects/B/plan.md");
    expect(pathsB).not.toContain("/Projects/A/notes.md");
  });

  it("requires q query parameter", async () => {
    const cookiesA = await registerAndAssignRole("a@example.com", roleAId);

    const search = await jsonRequest(bffApp, "/api/vault/search", {
      host: tenant.host,
      cookies: cookiesA,
    });
    expect(search.status).toBe(400);
  });
});
