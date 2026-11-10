import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { createApp as createControlPlaneApp } from "../../control-plane/src/app.js";
import { ControlPlaneStore } from "../../control-plane/src/store.js";
import { createTestStore } from "../../control-plane/test/pg-test-store.js";
import { createApp } from "../src/app.js";
import { FakeCognitoPasswordAuth } from "../src/cognito-fake.js";
import { ControlPlaneAuthClient } from "../src/control-plane-client.js";
import { SessionStore } from "../src/session.js";
import { clearFixtureSettingsOverrides } from "../src/settings-snapshot.js";
import { discoverSettingsFromHermes } from "../src/settings-discover.js";
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

async function makeTempHermes(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "hermes-settings-bff-"));
  await mkdir(path.join(root, "skills", "crm", "post-meeting-triage"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "skills", "crm", "post-meeting-triage", "SKILL.md"),
    `---
name: post-meeting-triage
description: demo
---
# Skill
`,
    "utf8",
  );
  await mkdir(path.join(root, "cron"), { recursive: true });
  await writeFile(
    path.join(root, "cron", "jobs.json"),
    JSON.stringify({
      jobs: [
        {
          id: "job-1",
          name: "Vault index",
          schedule_display: "0 3 * * *",
          enabled: true,
        },
      ],
      updated_at: "2026-07-01T00:00:00.000Z",
    }),
    "utf8",
  );
  await writeFile(
    path.join(root, "config.yaml"),
    `
model:
  provider: xai-oauth
  default: grok-4.5
providers:
  ollama:
    model: local-model
mcp_servers:
  granola:
    url: https://mcp.example.com/mcp
    enabled: true
skills:
  disabled: []
`,
    "utf8",
  );
  return root;
}

describe("bff settings launchpad", () => {
  let store: ControlPlaneStore;
  let controlPlaneApp: ReturnType<typeof createControlPlaneApp>;
  let bffApp: ReturnType<typeof createApp>;
  let tenant: TenantContext;
  let cookies: Record<string, string>;
  let userId: string;
  let cognito: FakeCognitoPasswordAuth;

  beforeEach(async () => {
    clearFixtureSettingsOverrides();
    store = await createTestStore();
    controlPlaneApp = createControlPlaneApp(store, { devOpen: true });

    const created = await store.createTenant({
      // "settings" is a reserved path segment and is rejected as a tenant slug.
      slug: "settingslab",
      display_name: "Settings Demo",
    });
    tenant = {
      tenant_id: created.tenant_id,
      tenant_slug: created.tenant_slug,
      display_name: created.display_name,
      host: created.host,
    };

    const authClient = new ControlPlaneAuthClient(
      "http://control-plane.test",
      (input, init) => {
        const url = new URL(input);
        return controlPlaneApp.request(url.pathname + url.search, init);
      },
    );

    cognito = new FakeCognitoPasswordAuth();
    bffApp = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          authClient,
          cognito,
          sessions: new SessionStore(),
        },
      ),
    );

    const csrf = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: tenant.host,
    });
    cookies = csrf.cookies;

    const register = await jsonRequest(bffApp, "/api/auth/register", {
      method: "POST",
      host: tenant.host,
      cookies,
      csrf: true,
      body: JSON.stringify({
        email: "settings@example.com",
        password: "password12345",
      }),
    });
    cookies = register.cookies;
    userId = register.body.user_id as string;
  });

  async function assignRole(input: {
    name: string;
    hermes_profile: string;
    path_prefixes?: string[];
  }): Promise<void> {
    const role = await store.createRole({
      tenant_id: tenant.tenant_id,
      name: input.name,
      hermes_profile: input.hermes_profile,
      path_prefixes: input.path_prefixes ?? ["/"],
    });
    await store.setUserRoles({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      role_ids: [role.role_id],
    });
  }

  it("GET /api/settings/snapshot returns redacted lists (settings.read)", async () => {
    const res = await jsonRequest(bffApp, "/api/settings/snapshot", {
      host: tenant.host,
      cookies,
    });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.skills)).toBe(true);
    expect(Array.isArray(res.body.crons)).toBe(true);
    expect(Array.isArray(res.body.mcp_servers)).toBe(true);
    expect(Array.isArray(res.body.models)).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain("api_key");
    expect(JSON.stringify(res.body)).not.toContain("xoxb");
  });

  it("POST /api/settings/health-check returns mock integration status", async () => {
    const res = await jsonRequest(bffApp, "/api/settings/health-check", {
      method: "POST",
      host: tenant.host,
      cookies,
      csrf: true,
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    const integrations = res.body.integrations as Array<{
      id: string;
      status: string;
    }>;
    expect(integrations.length).toBeGreaterThan(0);
    expect(integrations.some((item) => item.status === "healthy")).toBe(true);
    expect(integrations.some((item) => item.status === "unhealthy")).toBe(true);
  });

  it("rejects unauthenticated settings snapshot (settings.read requires session)", async () => {
    const res = await jsonRequest(bffApp, "/api/settings/snapshot", {
      host: tenant.host,
    });
    expect(res.status).toBe(401);
  });

  it("PATCH skills/crons/mcp/models require admin or settings permission", async () => {
    // No role → 403, no fixture mutation
    const deniedNoRole = await jsonRequest(
      bffApp,
      "/api/settings/skills/post-meeting-triage",
      {
        method: "PATCH",
        host: tenant.host,
        cookies,
        csrf: true,
        body: JSON.stringify({ enabled: false }),
      },
    );
    expect(deniedNoRole.status).toBe(403);

    await assignRole({
      name: "member",
      hermes_profile: "contributor",
    });

    for (const route of [
      "/api/settings/skills/post-meeting-triage",
      "/api/settings/crons/vault-index",
      "/api/settings/mcp/granola",
      "/api/settings/models/active",
    ]) {
      const denied = await jsonRequest(bffApp, route, {
        method: "PATCH",
        host: tenant.host,
        cookies,
        csrf: true,
        body: JSON.stringify(
          route.endsWith("/active")
            ? { provider: "xai-oauth", model: "grok-3" }
            : { enabled: false },
        ),
      });
      expect(denied.status).toBe(403);
    }

    // Contributor must not have mutated fixture overrides
    const snap = await jsonRequest(bffApp, "/api/settings/snapshot", {
      host: tenant.host,
      cookies,
    });
    const skills = snap.body.skills as Array<{ id: string; enabled: boolean }>;
    expect(skills.find((s) => s.id === "post-meeting-triage")?.enabled).toBe(
      true,
    );
  });

  it("PATCH /api/settings/skills/:id toggles enabled for admin (fixture mode)", async () => {
    await assignRole({ name: "admin", hermes_profile: "admin" });

    const res = await jsonRequest(bffApp, "/api/settings/skills/post-meeting-triage", {
      method: "PATCH",
      host: tenant.host,
      cookies,
      csrf: true,
      body: JSON.stringify({ enabled: false }),
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      source: "fixture",
      skill: { id: "post-meeting-triage", enabled: false },
    });

    const snap = await jsonRequest(bffApp, "/api/settings/snapshot", {
      host: tenant.host,
      cookies,
    });
    const skills = snap.body.skills as Array<{ id: string; enabled: boolean }>;
    expect(skills.find((s) => s.id === "post-meeting-triage")?.enabled).toBe(false);
  });

  it("PATCH /api/settings/crons/:id toggles enabled for admin (fixture mode)", async () => {
    await assignRole({ name: "admin", hermes_profile: "admin" });

    const res = await jsonRequest(bffApp, "/api/settings/crons/vault-index", {
      method: "PATCH",
      host: tenant.host,
      cookies,
      csrf: true,
      body: JSON.stringify({ enabled: false }),
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      source: "fixture",
      cron: { id: "vault-index", enabled: false },
    });
  });

  it("explicit settings-admin role may mutate skills (fixture mode)", async () => {
    await assignRole({
      name: "settings-admin",
      hermes_profile: "contributor",
    });

    const res = await jsonRequest(bffApp, "/api/settings/skills/post-meeting-triage", {
      method: "PATCH",
      host: tenant.host,
      cookies,
      csrf: true,
      body: JSON.stringify({ enabled: false }),
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      source: "fixture",
      skill: { id: "post-meeting-triage", enabled: false },
    });
  });

  it("fixture snapshot includes last/next and model active/connected", async () => {
    const res = await jsonRequest(bffApp, "/api/settings/snapshot", {
      host: tenant.host,
      cookies,
    });
    expect(res.status).toBe(200);
    const crons = res.body.crons as Array<{
      id: string;
      last_run_at?: string;
      next_run_at?: string;
      schedule: string;
    }>;
    const vault = crons.find((c) => c.id === "vault-index");
    expect(vault?.last_run_at).toBeTruthy();
    expect(vault?.next_run_at).toBeTruthy();
    expect(vault?.schedule).not.toMatch(/^\d/);

    const models = res.body.models as Array<{
      provider: string;
      model: string;
      is_active?: boolean;
      connected?: boolean;
    }>;
    expect(models.some((m) => m.is_active)).toBe(true);
    expect(models.some((m) => m.connected === true)).toBe(true);
  });

  it("admin can mutate live Hermes-home skills; contributor cannot", async () => {
    const hermesHome = await makeTempHermes();
    const before = await discoverSettingsFromHermes({ hermesHome });
    expect(
      before.skills.find((s) => s.name === "post-meeting-triage")?.enabled,
    ).toBe(true);

    const authClient = new ControlPlaneAuthClient(
      "http://control-plane.test",
      (input, init) => {
        const url = new URL(input);
        return controlPlaneApp.request(url.pathname + url.search, init);
      },
    );

    const liveApp = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          authClient,
          cognito,
          sessions: new SessionStore(),
          settingsPreferFixture: false,
          settingsHermesHome: hermesHome,
          hermesHome,
        },
      ),
    );

    // Fresh session on the live-home app
    const csrf = await jsonRequest(liveApp, "/api/auth/csrf", {
      host: tenant.host,
    });
    let liveCookies = csrf.cookies;
    const login = await jsonRequest(liveApp, "/api/auth/login", {
      method: "POST",
      host: tenant.host,
      cookies: liveCookies,
      csrf: true,
      body: JSON.stringify({
        email: "settings@example.com",
        password: "password12345",
      }),
    });
    expect(login.status).toBe(200);
    liveCookies = login.cookies;

    await assignRole({
      name: "contributor",
      hermes_profile: "contributor",
    });

    const denied = await jsonRequest(
      liveApp,
      "/api/settings/skills/post-meeting-triage",
      {
        method: "PATCH",
        host: tenant.host,
        cookies: liveCookies,
        csrf: true,
        body: JSON.stringify({ enabled: false }),
      },
    );
    expect(denied.status).toBe(403);

    const afterDenied = await discoverSettingsFromHermes({ hermesHome });
    expect(
      afterDenied.skills.find((s) => s.name === "post-meeting-triage")?.enabled,
    ).toBe(true);
    // config.yaml must be unchanged on disk
    const configAfterDenied = await readFile(
      path.join(hermesHome, "config.yaml"),
      "utf8",
    );
    expect(configAfterDenied).not.toMatch(/disabled:\s*\n\s*-\s*post-meeting-triage/);

    // Promote to admin — mutation succeeds and writes Hermes home
    await assignRole({ name: "admin", hermes_profile: "admin" });

    const allowed = await jsonRequest(
      liveApp,
      "/api/settings/skills/post-meeting-triage",
      {
        method: "PATCH",
        host: tenant.host,
        cookies: liveCookies,
        csrf: true,
        body: JSON.stringify({ enabled: false }),
      },
    );
    expect(allowed.status).toBe(200);
    expect(allowed.body).toMatchObject({
      source: "hermes",
      skill: { id: "post-meeting-triage", enabled: false },
    });

    const afterAllowed = await discoverSettingsFromHermes({ hermesHome });
    expect(
      afterAllowed.skills.find((s) => s.name === "post-meeting-triage")?.enabled,
    ).toBe(false);

    // Snapshot via BFF reflects hermes source
    const snap = await jsonRequest(liveApp, "/api/settings/snapshot", {
      host: tenant.host,
      cookies: liveCookies,
    });
    expect(snap.status).toBe(200);
    expect(snap.body.source).toBe("hermes");
  });
});
