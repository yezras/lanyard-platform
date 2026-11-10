import { describe, expect, it } from "vitest";

import {
  BACKEND_RUNTIME_SERVICE_METHODS,
  BackendRuntimeError,
  FakeBackendRuntimeService,
  HermesBackendRuntimeService,
  backendRuntimeErrorToHttpStatus,
  createFakeBackendRuntimeService,
  createHermesBackendRuntimeService,
  defaultHermesLanyardCapabilities,
  isBackendRuntimeService,
  type BackendRuntimeContext,
  type BackendRuntimeService,
  type SettingsSnapshot,
} from "../src/index.js";

function testContext(
  overrides?: Partial<BackendRuntimeContext>,
): BackendRuntimeContext {
  return {
    tenantId: "tenant_demo",
    instanceId: "inst_1",
    userId: "user_1",
    sessionId: "sess_1",
    profile: {
      name: "contributor",
      pathPrefixes: ["/Projects"],
      hermesProfileAlias: "contributor",
    },
    roles: ["contributor"],
    ...overrides,
  };
}

/**
 * Contract suite: every BackendRuntimeService implementor must satisfy these
 * behaviors. Tests target the interface (via fake), not Hermes modules.
 */
function runInterfaceContract(name: string, factory: () => BackendRuntimeService) {
  describe(`BackendRuntimeService contract (${name})`, () => {
    it("implements the required interface surface", () => {
      const svc = factory();
      expect(isBackendRuntimeService(svc)).toBe(true);
      for (const method of BACKEND_RUNTIME_SERVICE_METHODS) {
        expect(typeof svc[method]).toBe("function");
      }
    });

    it("health returns status, checks, and versions", async () => {
      const svc = factory();
      const result = await svc.health(testContext());
      expect(["ok", "degraded", "unavailable"]).toContain(result.status);
      expect(result.checks).toBeTypeOf("object");
      expect(result.versions).toBeTypeOf("object");
    });

    it("listProjects returns projects array and source", async () => {
      const svc = factory();
      const result = await svc.listProjects(testContext());
      expect(Array.isArray(result.projects)).toBe(true);
      expect(typeof result.source).toBe("string");
      expect(result.source.length).toBeGreaterThan(0);
    });

    it("settingsSnapshot is redacted-shaped (exported_at + source)", async () => {
      const svc = factory();
      const result = await svc.settingsSnapshot(testContext());
      expect(result.exported_at).toBeTruthy();
      expect(result.source).toBeTruthy();
    });

    it("listVault returns path, entries, truncated", async () => {
      const svc = factory();
      const result = await svc.listVault(testContext(), { path: "/Projects" });
      expect(result.path).toBe("/Projects");
      expect(Array.isArray(result.entries)).toBe(true);
      expect(typeof result.truncated).toBe("boolean");
    });

    it("statVault and readVault work for seeded files", async () => {
      const svc = factory();
      const entry = await svc.statVault(testContext(), {
        path: "/Projects/Legal/memo.md",
      });
      expect(entry.kind).toBe("file");
      expect(entry.path).toBe("/Projects/Legal/memo.md");

      const body = await svc.readVault(testContext(), {
        path: "/Projects/Legal/memo.md",
      });
      expect(body.kind).toBe("file");
      expect(body.encoding).toMatch(/utf-8|base64/);
      expect(body.content.length).toBeGreaterThan(0);
      expect(body.size_bytes).toBeGreaterThan(0);
    });

    it("capabilities exposes brain_rpc_methods and features", async () => {
      const svc = factory();
      const caps = await svc.capabilities(testContext());
      expect(caps.schema_version).toBe(1);
      expect(Array.isArray(caps.brain_rpc_methods)).toBe(true);
      expect(caps.brain_rpc_methods.length).toBeGreaterThan(0);
      expect(caps.features).toBeTypeOf("object");
      expect(caps.features.vault_read).toBe(true);
      expect(caps.features.projects_list).toBe(true);
      expect(caps.features.settings_snapshot).toBe(true);
      expect(caps.features.health).toBe(true);
    });
  });
}

const seededFake = () =>
  createFakeBackendRuntimeService({
    projects: [
      {
        id: "proj_legal",
        slug: "legal",
        name: "Legal",
        primary_path: "/Projects/Legal",
        folders: [
          { path: "/Projects/Legal", label: null, is_primary: true },
        ],
      },
    ],
    settings: {
      exported_at: "2026-07-12T00:00:00.000Z",
      source: "fake",
      backend_home: "/tmp/fake",
      skills: [{ id: "summarize", name: "summarize", enabled: true }],
      crons: [],
      mcp_servers: [],
      models: [{ provider: "openai", model: "gpt-4.1", is_active: true }],
      integrations: [],
    },
    files: [
      {
        path: "/Projects/Legal/memo.md",
        content: "# Memo\n\nFake vault body.\n",
        mime_type: "text/markdown",
      },
      {
        path: "/Projects/Legal/exhibits/a.txt",
        content: "exhibit",
        mime_type: "text/plain",
      },
    ],
  });

runInterfaceContract("FakeBackendRuntimeService", seededFake);

describe("FakeBackendRuntimeService behaviors", () => {
  it("createProject appends a project when supported", async () => {
    const svc = new FakeBackendRuntimeService({ supportCreateProject: true });
    const created = await svc.createProject!(testContext(), {
      name: "Ops",
      folders: ["/Projects/Ops"],
    });
    expect(created.name).toBe("Ops");
    expect(created.id).toMatch(/^proj_fake_/);
    const listed = await svc.listProjects(testContext());
    expect(listed.projects.some((p) => p.id === created.id)).toBe(true);
  });

  it("filters settings sections via include", async () => {
    const svc = seededFake();
    const snap = await svc.settingsSnapshot(testContext(), {
      include: ["skills"],
    });
    expect(snap.skills?.length).toBe(1);
    expect(snap.models).toBeUndefined();
  });

  it("denies vault paths outside ACL prefixes", async () => {
    const svc = seededFake();
    await expect(
      svc.readVault(testContext(), { path: "/Secrets/key.txt" }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("returns not_found for missing vault files", async () => {
    const svc = seededFake();
    await expect(
      svc.statVault(testContext(), { path: "/Projects/Missing" }),
    ).rejects.toBeInstanceOf(BackendRuntimeError);
    await expect(
      svc.statVault(testContext(), { path: "/Projects/Missing" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects directory reads with invalid_argument", async () => {
    const svc = seededFake();
    await expect(
      svc.readVault(testContext(), { path: "/Projects/Legal" }),
    ).rejects.toMatchObject({ code: "invalid_argument" });
  });
});

describe("HermesBackendRuntimeService adapter", () => {
  it("is a BackendRuntimeService", () => {
    const svc = createHermesBackendRuntimeService();
    expect(isBackendRuntimeService(svc)).toBe(true);
  });

  it("listProjects returns empty when no projects port (contract empty state)", async () => {
    const svc = new HermesBackendRuntimeService();
    const result = await svc.listProjects(testContext());
    expect(result).toEqual({ projects: [], source: "none" });
  });

  it("health degrades without ports or RPC (scaffold default)", async () => {
    const svc = new HermesBackendRuntimeService({ backendVersion: "v0.0.0-scaffold" });
    const result = await svc.health(testContext());
    expect(result.status).toBe("degraded");
    expect(result.versions.backend_artifact).toBe("v0.0.0-scaffold");
    expect(result.versions.hermes_artifact).toBe("v0.0.0-scaffold");
    expect(result.profile).toBe("contributor");
  });

  it("capabilities falls back to static Hermes-Lanyard defaults", async () => {
    const svc = new HermesBackendRuntimeService();
    const caps = await svc.capabilities(testContext());
    expect(caps.kind).toBe("hermes_lanyard");
    expect(caps.brain_rpc_methods).toContain("projects.list");
    expect(caps.brain_rpc_methods).toContain("settings.snapshot");
    expect(caps.brain_rpc_methods).toContain("vault.read");
    expect(caps.features.projects_list).toBe(true);
  });

  it("wraps injected projects port (current hermes-projects behavior)", async () => {
    const svc = new HermesBackendRuntimeService({
      projects: {
        listProjects: () => ({
          projects: [
            {
              id: "p1",
              name: "FromHermesDb",
              slug: "from-hermes-db",
              primary_path: "/Projects/X",
              folders: [],
            },
          ],
          source: "hermes_projects_db",
        }),
        createProject: async (input) => ({
          id: "p_new",
          name: input.name,
          slug: "new",
          primary_path: input.folders?.[0] ?? null,
          folders: [],
        }),
      },
    });
    const listed = await svc.listProjects(testContext());
    expect(listed.source).toBe("hermes_projects_db");
    expect(listed.projects[0]?.name).toBe("FromHermesDb");
    const created = await svc.createProject!(testContext(), { name: "N" });
    expect(created.id).toBe("p_new");
  });

  it("wraps injected settings port (current settings-snapshot behavior)", async () => {
    const snapshot: SettingsSnapshot = {
      exported_at: "2026-07-12T00:00:00.000Z",
      source: "hermes",
      hermes_home: "/home/hermes/.hermes",
      backend_home: "/home/hermes/.hermes",
      skills: [],
      crons: [],
      mcp_servers: [],
      models: [],
      integrations: [],
    };
    const svc = new HermesBackendRuntimeService({
      settings: { settingsSnapshot: () => snapshot },
    });
    const result = await svc.settingsSnapshot(testContext());
    expect(result.source).toBe("hermes");
    expect(result.hermes_home).toBe("/home/hermes/.hermes");
  });

  it("wraps injected vault port (current VaultService behavior)", async () => {
    const svc = new HermesBackendRuntimeService({
      vault: {
        listVault: async () => ({
          path: "/",
          entries: [
            {
              name: "readme.md",
              path: "/readme.md",
              kind: "file",
              mime_type: "text/markdown",
            },
          ],
          truncated: false,
          next_cursor: null,
        }),
        statVault: async ({ path }) => ({
          name: "readme.md",
          path,
          kind: "file",
          mime_type: "text/markdown",
          size_bytes: 3,
        }),
        readVault: async ({ path }) => ({
          path,
          kind: "file",
          mime_type: "text/markdown",
          encoding: "utf-8",
          content: "hi\n",
          size_bytes: 3,
        }),
      },
    });
    const list = await svc.listVault(testContext(), { path: "/" });
    expect(list.entries).toHaveLength(1);
    const body = await svc.readVault(testContext(), { path: "/readme.md" });
    expect(body.content).toBe("hi\n");
  });

  it("prefers Brain RPC invoker when brainRpcPreferred", async () => {
    const calls: string[] = [];
    const svc = new HermesBackendRuntimeService({
      brainRpcPreferred: true,
      invokeBrainRpc: async ({ method }) => {
        calls.push(method);
        if (method === "brain.health") {
          return {
            status: "ok",
            checks: { vault_root_readable: true },
            versions: { brain_rpc: 1 },
          };
        }
        if (method === "projects.list") {
          return { projects: [], source: "brain_rpc" };
        }
        if (method === "settings.snapshot") {
          return {
            exported_at: "2026-07-12T00:00:00.000Z",
            source: "hermes_lanyard",
          };
        }
        if (method === "vault.list") {
          return { path: "/", entries: [], truncated: false, next_cursor: null };
        }
        if (method === "brain.capabilities") {
          return defaultHermesLanyardCapabilities({
            source: "brain_rpc",
            features: {
              chat: true,
              health: true,
              capabilities_discovery: true,
              vault_read: true,
              vault_write: true,
              settings_snapshot: true,
              settings_patch: false,
              projects_list: true,
              projects_create: false,
              models: false,
              cron: false,
            },
          });
        }
        throw new BackendRuntimeError("method_not_found", method);
      },
    });

    await svc.health(testContext());
    await svc.listProjects(testContext());
    await svc.settingsSnapshot(testContext());
    await svc.listVault(testContext());
    const caps = await svc.capabilities(testContext());

    expect(calls).toEqual([
      "brain.health",
      "projects.list",
      "settings.snapshot",
      "vault.list",
      "brain.capabilities",
    ]);
    expect(caps.source).toBe("brain_rpc");
    expect(caps.features.capabilities_discovery).toBe(true);
  });

  it("capabilities falls back when brain.capabilities is method_not_found", async () => {
    const svc = new HermesBackendRuntimeService({
      invokeBrainRpc: async ({ method }) => {
        if (method === "brain.capabilities") {
          throw new BackendRuntimeError(
            "method_not_found",
            "brain.capabilities not implemented",
            { retryable: false, details: { method } },
          );
        }
        return {};
      },
    });
    const caps = await svc.capabilities(testContext());
    expect(caps.source).toBe("artifact_manifest");
    expect(caps.brain_rpc_methods).toContain("vault.read");
  });

  it("throws not_implemented when settings/vault not wired and no RPC", async () => {
    const svc = new HermesBackendRuntimeService();
    await expect(svc.settingsSnapshot(testContext())).rejects.toMatchObject({
      code: "not_implemented",
    });
    await expect(svc.listVault(testContext())).rejects.toMatchObject({
      code: "not_implemented",
    });
  });
});

describe("error mapping", () => {
  it("maps known codes to HTTP statuses", () => {
    expect(backendRuntimeErrorToHttpStatus("unauthenticated")).toBe(401);
    expect(backendRuntimeErrorToHttpStatus("forbidden")).toBe(403);
    expect(backendRuntimeErrorToHttpStatus("not_found")).toBe(404);
    expect(backendRuntimeErrorToHttpStatus("method_not_found")).toBe(404);
    expect(backendRuntimeErrorToHttpStatus("invalid_argument")).toBe(400);
    expect(backendRuntimeErrorToHttpStatus("not_implemented")).toBe(400);
    expect(backendRuntimeErrorToHttpStatus("payload_too_large")).toBe(413);
    expect(backendRuntimeErrorToHttpStatus("timeout")).toBe(504);
    expect(backendRuntimeErrorToHttpStatus("unavailable")).toBe(503);
    expect(backendRuntimeErrorToHttpStatus("rate_limited")).toBe(429);
    expect(backendRuntimeErrorToHttpStatus("internal")).toBe(500);
  });
});
