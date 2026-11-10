import { describe, expect, it, vi } from "vitest";

import {
  BackendRuntimeError,
  FakeBackendRuntimeService,
  HermesBackendRuntimeService,
  PROJECTS_CREATE_METHOD,
  PROJECTS_DELETE_METHOD,
  PROJECTS_LIST_METHOD,
  agentProjectsErrorToHttp,
  backendContextFromSession,
  createAgentProject,
  createAgentProjectsHandlers,
  createFakeBackendRuntimeService,
  createProductionHermesBackendRuntimeService,
  deleteAgentProject,
  listAgentProjects,
  parseProjectsCreateInput,
  projectsCreateIsAdvertised,
  type BackendRuntimeContext,
} from "../src/index.js";

function testContext(
  overrides?: Partial<BackendRuntimeContext>,
): BackendRuntimeContext {
  return {
    ...backendContextFromSession({
      tenantId: "tenant_demo",
      instanceId: "inst_1",
      userId: "user_1",
      sessionId: "sess_1",
      profileName: "contributor",
      pathPrefixes: ["/Projects"],
      roles: ["contributor"],
    }),
    ...overrides,
  };
}

describe("parseProjectsCreateInput (projects.create contract)", () => {
  it("accepts name + folders", () => {
    expect(
      parseProjectsCreateInput({ name: " Legal ", folders: [" /Projects/Legal "] }),
    ).toEqual({ name: "Legal", folders: ["/Projects/Legal"] });
  });

  it("accepts vault_path as single-folder migration alias", () => {
    expect(
      parseProjectsCreateInput({ name: "Ops", vault_path: "~/ops" }),
    ).toEqual({ name: "Ops", folders: ["~/ops"] });
  });

  it("rejects missing/empty name", () => {
    expect(() => parseProjectsCreateInput({})).toThrow(BackendRuntimeError);
    expect(() => parseProjectsCreateInput({ name: "  " })).toThrow(
      /non-empty name/,
    );
  });

  it("rejects non-object body", () => {
    expect(() => parseProjectsCreateInput(null)).toThrow(/JSON object/);
    expect(() => parseProjectsCreateInput("x")).toThrow(/JSON object/);
  });

  it("rejects invalid folders", () => {
    expect(() =>
      parseProjectsCreateInput({ name: "A", folders: "nope" }),
    ).toThrow(/folders must be an array/);
    expect(() =>
      parseProjectsCreateInput({ name: "A", folders: [""] }),
    ).toThrow(/folders\[0]/);
  });

  it("rejects oversized name", () => {
    expect(() =>
      parseProjectsCreateInput({ name: "x".repeat(201) }),
    ).toThrow(/200 characters/);
  });
});

describe("projectsCreateIsAdvertised", () => {
  it("true when features.projects_create", () => {
    expect(
      projectsCreateIsAdvertised({ features: { projects_create: true } }),
    ).toBe(true);
  });

  it("true when method listed", () => {
    expect(
      projectsCreateIsAdvertised({
        features: { projects_create: false },
        brain_rpc_methods: [PROJECTS_CREATE_METHOD],
      }),
    ).toBe(true);
  });

  it("false when neither advertised", () => {
    expect(
      projectsCreateIsAdvertised({
        features: { projects_list: true },
        brain_rpc_methods: [PROJECTS_LIST_METHOD],
      }),
    ).toBe(false);
  });
});

describe("listAgentProjects (BFF → BackendRuntimeService → Brain RPC)", () => {
  it("lists via service.listProjects (fake fixture is test-only)", async () => {
    const service = createFakeBackendRuntimeService({
      projects: [
        {
          id: "proj_legal",
          name: "Legal",
          slug: "legal",
          primary_path: "/Projects/Legal",
          folders: [{ path: "/Projects/Legal", is_primary: true }],
        },
      ],
    });
    const body = await listAgentProjects(service, testContext());
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0]?.name).toBe("Legal");
    expect(body.source).toBe("fake");
  });

  it("production Hermes path uses Brain RPC projects.list only", async () => {
    const invoke = vi.fn(async ({ method }: { method: string }) => {
      if (method === "projects.list") {
        return {
          projects: [
            {
              id: "proj_rpc",
              name: "FromRpc",
              slug: "from-rpc",
              primary_path: "/Projects/Rpc",
              folders: [],
            },
          ],
          source: "hermes_projects_db",
        };
      }
      throw new BackendRuntimeError("method_not_found", method);
    });

    const service = createProductionHermesBackendRuntimeService({
      invokeBrainRpc: invoke,
      // Local port would be wrong in production — must be ignored.
      projects: {
        listProjects: () => ({
          projects: [{ id: "local", name: "ShouldNotSee", folders: [] }],
          source: "hermes_projects_db",
        }),
      },
    });

    const body = await listAgentProjects(service, testContext());
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        method: PROJECTS_LIST_METHOD,
        params: { include_archived: false },
      }),
    );
    expect(body.projects[0]?.name).toBe("FromRpc");
    expect(body.source).toBe("hermes_projects_db");
  });

  it("production without invoker fails closed (no silent projects.db)", async () => {
    // projectsRequireBrainRpc true but no invoker path: construct with flag only
    const service = new HermesBackendRuntimeService({
      projectsRequireBrainRpc: true,
      projects: {
        listProjects: () => ({
          projects: [{ id: "leak", name: "Leak", folders: [] }],
          source: "hermes_projects_db",
        }),
      },
    });
    await expect(listAgentProjects(service, testContext())).rejects.toMatchObject(
      { code: "unavailable" },
    );
  });

  it("handlers.list delegates to service", async () => {
    const service = createFakeBackendRuntimeService({
      projects: [{ id: "p1", name: "One", folders: [] }],
    });
    const handlers = createAgentProjectsHandlers(service);
    const body = await handlers.list(testContext());
    expect(body.projects[0]?.id).toBe("p1");
  });
});

describe("createAgentProject (contract gated before UI)", () => {
  it("creates when capability advertised (fake supports create)", async () => {
    const service = new FakeBackendRuntimeService({ supportCreateProject: true });
    const created = await createAgentProject(service, testContext(), {
      name: "Ops",
      folders: ["/Projects/Ops"],
    });
    expect(created.name).toBe("Ops");
    expect(created.id).toMatch(/^proj_fake_/);
  });

  it("refuses create when capability not advertised", async () => {
    const service = createFakeBackendRuntimeService({
      supportCreateProject: false,
      capabilities: {
        schema_version: 1,
        brain_rpc_methods: [PROJECTS_LIST_METHOD],
        features: {
          projects_list: true,
          projects_create: false,
          chat: true,
          health: true,
          capabilities_discovery: false,
          vault_read: true,
          vault_write: false,
          settings_snapshot: true,
          settings_patch: false,
          models: false,
          cron: false,
        },
      },
    });
    await expect(
      createAgentProject(service, testContext(), { name: "X" }),
    ).rejects.toMatchObject({ code: "method_not_found" });
  });

  it("production create goes through Brain RPC projects.create", async () => {
    const invoke = vi.fn(async ({ method, params }: { method: string; params: Record<string, unknown> }) => {
      if (method === "brain.capabilities") {
        return {
          schema_version: 1,
          brain_rpc_methods: [PROJECTS_LIST_METHOD, PROJECTS_CREATE_METHOD],
          features: { projects_list: true, projects_create: true },
        };
      }
      if (method === "projects.create") {
        return {
          id: "proj_new",
          name: params.name,
          slug: "new",
          primary_path: (params.folders as string[])?.[0] ?? null,
          folders: [],
        };
      }
      throw new BackendRuntimeError("method_not_found", method);
    });

    const service = createProductionHermesBackendRuntimeService({
      invokeBrainRpc: invoke,
    });
    const created = await createAgentProject(service, testContext(), {
      name: "New",
      folders: ["/Projects/New"],
    });
    expect(created.id).toBe("proj_new");
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ method: PROJECTS_CREATE_METHOD }),
    );
  });

  it("handlers.create validates body then creates", async () => {
    const service = new FakeBackendRuntimeService({ supportCreateProject: true });
    const handlers = createAgentProjectsHandlers(service);
    await expect(handlers.create(testContext(), { name: "" })).rejects.toThrow(
      BackendRuntimeError,
    );
    const ok = await handlers.create(testContext(), { name: "Ok" });
    expect(ok.name).toBe("Ok");
  });
});

describe("deleteAgentProject (soft-archive only, lp-uxy.5)", () => {
  it("soft-archives via fake: leaves list, keeps vault files", async () => {
    const service = createFakeBackendRuntimeService({
      projects: [
        {
          id: "proj_ops",
          name: "Ops",
          slug: "ops",
          primary_path: "/Projects/Ops",
          folders: [{ path: "/Projects/Ops", is_primary: true }],
        },
      ],
      files: [
        { path: "/Projects/Ops/notes.md", content: "keep me" },
      ],
    });

    const result = await deleteAgentProject(
      service,
      testContext(),
      "proj_ops",
    );
    expect(result).toEqual({ id: "proj_ops", archived: true });

    const listed = await listAgentProjects(service, testContext());
    expect(listed.projects).toHaveLength(0);

    const withArchived = await service.listProjects(testContext(), {
      includeArchived: true,
    });
    expect(withArchived.projects.map((p) => p.id)).toContain("proj_ops");

    // Soft-archive must not purge vault bodies.
    const vault = await service.readVault(testContext(), {
      path: "/Projects/Ops/notes.md",
    });
    expect(vault.content).toBe("keep me");
  });

  it("production path uses Brain RPC projects.delete with {id} → {id, archived:true}", async () => {
    const invoke = vi.fn(
      async ({
        method,
        params,
      }: {
        method: string;
        params: Record<string, unknown>;
      }) => {
        if (method === "projects.delete") {
          expect(params).toEqual({ id: "proj_rpc" });
          return { id: "proj_rpc", archived: true };
        }
        throw new BackendRuntimeError("method_not_found", method);
      },
    );

    const service = createProductionHermesBackendRuntimeService({
      invokeBrainRpc: invoke,
    });
    const result = await deleteAgentProject(
      service,
      testContext(),
      "proj_rpc",
    );
    expect(result).toEqual({ id: "proj_rpc", archived: true });
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        method: PROJECTS_DELETE_METHOD,
        params: { id: "proj_rpc" },
      }),
    );
  });

  it("handlers.delete rejects empty id", async () => {
    const service = createFakeBackendRuntimeService({
      projects: [{ id: "p1", name: "One", folders: [] }],
    });
    const handlers = createAgentProjectsHandlers(service);
    await expect(handlers.delete(testContext(), "  ")).rejects.toMatchObject({
      code: "invalid_argument",
    });
  });
});

describe("agentProjectsErrorToHttp", () => {
  it("maps BackendRuntimeError codes", () => {
    const mapped = agentProjectsErrorToHttp(
      new BackendRuntimeError("forbidden", "nope"),
    );
    expect(mapped.status).toBe(403);
    expect(mapped.body.code).toBe("forbidden");
  });

  it("maps unknown errors to 500", () => {
    const mapped = agentProjectsErrorToHttp(new Error("boom"));
    expect(mapped.status).toBe(500);
    expect(mapped.body.code).toBe("internal");
  });
});

describe("Hermes adapter projectsRequireBrainRpc", () => {
  it("allows local projects port only when not requiring Brain RPC (tests)", async () => {
    const service = new HermesBackendRuntimeService({
      projectsRequireBrainRpc: false,
      projects: {
        listProjects: () => ({
          projects: [{ id: "t", name: "TestOnly", folders: [] }],
          source: "fixture",
        }),
      },
    });
    const listed = await service.listProjects(testContext());
    expect(listed.projects[0]?.name).toBe("TestOnly");
    expect(listed.source).toBe("fixture");
  });

  it("normalizes incomplete Brain RPC list payloads", async () => {
    const service = new HermesBackendRuntimeService({
      invokeBrainRpc: async () => ({
        projects: [{ id: "a", name: "A" }],
        // missing source → default brain_rpc
      }),
    });
    const listed = await service.listProjects(testContext());
    expect(listed.source).toBe("brain_rpc");
    expect(listed.projects[0]?.id).toBe("a");
  });
});
