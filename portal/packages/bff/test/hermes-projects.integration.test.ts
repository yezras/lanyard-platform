import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp as createControlPlaneApp } from "../../control-plane/src/app.js";
import { ControlPlaneStore } from "../../control-plane/src/store.js";
import { createTestStore } from "../../control-plane/test/pg-test-store.js";
import { createApp } from "../src/app.js";
import {
  createMemoryHermesProjectsStore,
  type HermesProject,
} from "../src/hermes-projects.js";
import { ControlPlaneAuthClient } from "../src/control-plane-client.js";
import { ChatThreadStore } from "../src/chat-store.js";
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
): Promise<{
  status: number;
  body: JsonBody;
  cookies: Record<string, string>;
  headers: Headers;
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
  const body = (await response.json()) as JsonBody;
  const cookies = {
    ...init.cookies,
    ...parseSetCookie(response.headers.get("set-cookie")),
  };

  return {
    status: response.status,
    body,
    cookies,
    headers: response.headers,
  };
}

describe("BFF Hermes projects API", () => {
  let store: ControlPlaneStore;
  let bffApp: ReturnType<typeof createApp>;
  let tenant: TenantContext;
  let cookies: Record<string, string>;
  let hermesStore: ReturnType<typeof createMemoryHermesProjectsStore>;

  beforeEach(async () => {
    store = await createTestStore();
    const controlPlaneApp = createControlPlaneApp(store, { devOpen: true });

    const created = await store.createTenant({
      slug: "demo",
      display_name: "Demo",
    });
    tenant = {
      tenant_id: created.tenant_id,
      tenant_slug: created.tenant_slug,
      display_name: created.display_name,
      host: created.host,
    };

    const role = await store.createRole({
      tenant_id: tenant.tenant_id,
      name: "member",
      hermes_profile: "default",
      path_prefixes: ["/"],
    });

    hermesStore = createMemoryHermesProjectsStore([
      {
        id: "p_demo",
        slug: "demo",
        name: "Demo",
        primary_path: "/home/operator/Demo",
        folders: [
          {
            path: "/home/operator/Demo",
            label: null,
            is_primary: true,
          },
        ],
      },
    ]);

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
        {
          authClient,
          chatThreads: new ChatThreadStore(),
          sessions: new SessionStore(),
          hermesProjects: {
            listProjects: () => hermesStore.listProjects(),
            getProject: (id) => hermesStore.getProject(id),
            createProject: async (input) => {
              const folders = (input.folders ?? []).map((folderPath, index) => ({
                path: folderPath.startsWith("/")
                  ? folderPath
                  : `/resolved/${folderPath}`,
                label: null as string | null,
                is_primary: index === 0,
              }));
              const project: HermesProject = {
                id: `p_new_${hermesStore.projects.length}`,
                slug: input.name.toLowerCase().replace(/\s+/g, "-"),
                name: input.name,
                primary_path: folders[0]?.path ?? null,
                folders,
              };
              hermesStore.upsert(project);
              return project;
            },
          },
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
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "hermes@example.com",
        password: "password123",
      }),
    });
    expect(register.status).toBe(201);
    cookies = register.cookies;

    await store.setUserRoles({
      tenant_id: tenant.tenant_id,
      user_id: register.body.user_id as string,
      role_ids: [role.role_id],
    });
  });

  afterEach(async () => {
    await store.close();
  });

  it("lists agent projects on preferred /api/agent/projects", async () => {
    const listed = await jsonRequest(bffApp, "/api/agent/projects", {
      host: tenant.host,
      cookies,
    });
    expect(listed.status).toBe(200);
    expect(listed.headers.get("Deprecation")).toBeNull();
    const projects = listed.body.projects as HermesProject[];
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      id: "p_demo",
      slug: "demo",
      name: "Demo",
      primary_path: "/home/operator/Demo",
    });
    expect(projects[0]!.folders[0]?.is_primary).toBe(true);
  });

  it("dual-mounts legacy /api/hermes/projects with deprecation headers", async () => {
    const listed = await jsonRequest(bffApp, "/api/hermes/projects", {
      host: tenant.host,
      cookies,
    });
    expect(listed.status).toBe(200);
    expect(listed.headers.get("Deprecation")).toBe("true");
    expect(listed.headers.get("Link")).toContain("/api/agent/projects");
    expect(listed.headers.get("X-Lanyard-Deprecation-Note")).toMatch(
      /Deprecated/i,
    );
    const projects = listed.body.projects as HermesProject[];
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      id: "p_demo",
      name: "Demo",
      primary_path: "/home/operator/Demo",
    });
  });

  it("creates an agent project via preferred POST /api/agent/projects", async () => {
    const created = await jsonRequest(bffApp, "/api/agent/projects", {
      method: "POST",
      host: tenant.host,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Beta",
        folders: ["/home/operator/Beta"],
      }),
    });
    expect(created.status).toBe(201);
    expect(created.headers.get("Deprecation")).toBeNull();
    expect(created.body).toMatchObject({
      name: "Beta",
      primary_path: "/home/operator/Beta",
    });

    const listed = await jsonRequest(bffApp, "/api/agent/projects", {
      host: tenant.host,
      cookies,
    });
    expect((listed.body.projects as HermesProject[]).length).toBe(2);
  });

  it("binds new chat threads to Hermes primary_path", async () => {
    const threadRes = await jsonRequest(bffApp, "/api/chat/threads", {
      method: "POST",
      host: tenant.host,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project_id: "p_demo" }),
    });
    expect(threadRes.status).toBe(201);
    expect(threadRes.body).toMatchObject({
      title: "Demo",
      project_id: "p_demo",
      project_vault_path: "/home/operator/Demo",
    });
  });

  it("returns 404 for unknown Hermes project on thread create", async () => {
    const threadRes = await jsonRequest(bffApp, "/api/chat/threads", {
      method: "POST",
      host: tenant.host,
      cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project_id: "p_missing" }),
    });
    expect(threadRes.status).toBe(404);
  });
});
