import { STAGING_UPLOADS_ROOT } from "@lanyard/shared";
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

async function multipartUpload(
  app: ReturnType<typeof createApp>,
  init: {
    host: string;
    cookies: Record<string, string>;
    filename: string;
    content: string;
    projectVaultPath?: string;
  },
): Promise<{ status: number; body: JsonBody }> {
  const form = new FormData();
  form.append("file", new Blob([init.content], { type: "text/plain" }), init.filename);
  if (init.projectVaultPath) {
    form.append("project_vault_path", init.projectVaultPath);
  }

  const headers = new Headers();
  headers.set("host", init.host);
  headers.set("cookie", cookieHeader(init.cookies));
  if (init.cookies.lanyard_csrf) {
    headers.set("x-csrf-token", init.cookies.lanyard_csrf);
  }

  const response = await app.request("/api/staging/upload", {
    method: "POST",
    headers,
    body: form,
  });
  const body = (await response.json()) as JsonBody;
  return { status: response.status, body };
}

describe("bff staging upload (#14)", () => {
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
      slug: "staging",
      display_name: "Staging",
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
        { staging: tenant },
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

  it("uploads to project-scoped staging path and lists it", async () => {
    const cookies = await registerAndAssignRole("a@example.com", roleAId);

    const upload = await multipartUpload(bffApp, {
      host: tenant.host,
      cookies,
      filename: "brief.txt",
      content: "ingest me",
      projectVaultPath: "/Projects/A",
    });
    expect(upload.status).toBe(201);
    expect(upload.body.path).toBe(`${STAGING_UPLOADS_ROOT}/Projects/A/brief.txt`);
    expect(upload.body.ingest_note).toMatch(/vault-writer/i);

    const listing = await jsonRequest(bffApp, "/api/staging/uploads", {
      host: tenant.host,
      cookies,
    });
    expect(listing.status).toBe(200);
    const files = listing.body.files as Array<{ path: string }>;
    expect(files.map((file) => file.path)).toContain(
      `${STAGING_UPLOADS_ROOT}/Projects/A/brief.txt`,
    );
  });

  it("returns 403 when upload targets another team's project path", async () => {
    const cookies = await registerAndAssignRole("a@example.com", roleAId);

    const upload = await multipartUpload(bffApp, {
      host: tenant.host,
      cookies,
      filename: "secret.txt",
      content: "nope",
      projectVaultPath: "/Projects/B",
    });
    expect(upload.status).toBe(403);
    expect(String(upload.body.error)).toMatch(/not permitted/i);
  });

  it("returns 413 when upload exceeds configured size limit", async () => {
    const cookies = await registerAndAssignRole("b@example.com", roleBId);
    const big = "x".repeat(2 * 1024 * 1024);

    const upload = await multipartUpload(bffApp, {
      host: tenant.host,
      cookies,
      filename: "big.bin",
      content: big,
      projectVaultPath: "/Projects/B",
    });
    expect(upload.status).toBe(413);
    expect(String(upload.body.error)).toMatch(/max size/i);
  });

  it("listing omits files outside ACL prefix", async () => {
    const cookiesA = await registerAndAssignRole("a@example.com", roleAId);
    const cookiesB = await registerAndAssignRole("b@example.com", roleBId);

    await multipartUpload(bffApp, {
      host: tenant.host,
      cookies: cookiesA,
      filename: "team-a.txt",
      content: "a",
      projectVaultPath: "/Projects/A",
    });
    await multipartUpload(bffApp, {
      host: tenant.host,
      cookies: cookiesB,
      filename: "team-b.txt",
      content: "b",
      projectVaultPath: "/Projects/B",
    });

    const listingA = await jsonRequest(bffApp, "/api/staging/uploads", {
      host: tenant.host,
      cookies: cookiesA,
    });
    const pathsA = (listingA.body.files as Array<{ path: string }>).map(
      (file) => file.path,
    );
    expect(pathsA).toContain(`${STAGING_UPLOADS_ROOT}/Projects/A/team-a.txt`);
    expect(pathsA).not.toContain(`${STAGING_UPLOADS_ROOT}/Projects/B/team-b.txt`);
  });
});