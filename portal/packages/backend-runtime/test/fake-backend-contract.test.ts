/**
 * Fake backend contract harness (lp-k7g.8.8).
 *
 * Proves Portal BFF behavior against backend-runtime-v1 via an offline fake:
 * - required Brain RPC methods (wire invoker)
 * - settings / projects / vault BFF paths
 * - capability → UI state derivation
 *
 * No network, no Hermes process.
 */

import { describe, expect, it } from "vitest";

import {
  BackendRuntimeError,
  REQUIRED_BRAIN_RPC_METHODS,
  assertRequiredBrainRpcMethods,
  backendContextFromSession,
  createAgentProjectsHandlers,
  createContextHandlers,
  createFakeBackendRuntimeService,
  createFakeBrainRpcInvoker,
  createProductionHermesBackendRuntimeService,
  createSettingsHandlers,
  getPortalContext,
  getSettingsSnapshot,
  listAgentProjects,
  type BackendRuntimeContext,
  type SettingsSnapshot,
} from "../src/index.js";

function testContext(
  overrides?: Partial<BackendRuntimeContext>,
): BackendRuntimeContext {
  return {
    ...backendContextFromSession({
      tenantId: "tenant_demo",
      instanceId: "inst_fake",
      userId: "user_1",
      sessionId: "sess_1",
      profileName: "contributor",
      pathPrefixes: ["/Projects"],
      roles: ["contributor"],
    }),
    ...overrides,
  };
}

const seedSettings: SettingsSnapshot = {
  exported_at: "2026-07-12T00:00:00.000Z",
  source: "fake",
  backend_home: "/tmp/fake-backend-home",
  hermes_home: "/tmp/fake-backend-home",
  skills: [
    {
      id: "summarize",
      name: "summarize",
      enabled: true,
      path: "skills/summarize",
    },
  ],
  crons: [
    { id: "nightly", name: "Nightly", schedule: "0 6 * * *", enabled: true },
  ],
  mcp_servers: [{ name: "filesystem", transport: "stdio", enabled: true }],
  models: [
    { provider: "openai", model: "gpt-4.1", is_active: true, connected: true },
    { provider: "anthropic", model: "claude-sonnet", is_active: false },
  ],
  integrations: [],
};

function seededFakeOptions() {
  return {
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
    settings: seedSettings,
    files: [
      {
        path: "/Projects/Legal/memo.md",
        content: "# Memo\n\nContract test body.\n",
        mime_type: "text/markdown",
      },
      {
        path: "/Projects/Legal/exhibits/a.txt",
        content: "exhibit-a",
        mime_type: "text/plain",
      },
    ],
    supportCreateProject: true,
    supportPatchSettings: true,
  } as const;
}

// ---------------------------------------------------------------------------
// 1) Fake backend supports required Brain RPC methods
// ---------------------------------------------------------------------------

describe("fake backend supports required Brain RPC methods", () => {
  it("REQUIRED_BRAIN_RPC_METHODS is the seven v1 methods", () => {
    expect([...REQUIRED_BRAIN_RPC_METHODS].sort()).toEqual(
      [
        "brain.health",
        "brain.ping",
        "projects.list",
        "settings.snapshot",
        "vault.list",
        "vault.read",
        "vault.stat",
      ].sort(),
    );
  });

  it("FakeBrainRpcInvoker.supportedMethods includes all required methods", () => {
    const invoke = createFakeBrainRpcInvoker();
    assertRequiredBrainRpcMethods(invoke.supportedMethods());
    for (const method of REQUIRED_BRAIN_RPC_METHODS) {
      expect(invoke.supportedMethods()).toContain(method);
    }
  });

  it("FakeBackendRuntimeService capabilities advertise required methods", async () => {
    const svc = createFakeBackendRuntimeService();
    const caps = await svc.capabilities(testContext());
    assertRequiredBrainRpcMethods(caps.brain_rpc_methods);
    expect(caps.features.health).toBe(true);
    expect(caps.features.vault_read).toBe(true);
    expect(caps.features.settings_snapshot).toBe(true);
    expect(caps.features.projects_list).toBe(true);
  });

  it("invokes each required Brain RPC method with contract-shaped results", async () => {
    const invoke = createFakeBrainRpcInvoker(seededFakeOptions());
    const ctx = testContext();

    // brain.ping
    const ping = (await invoke({
      method: "brain.ping",
      params: { echo: "hello" },
      ctx,
    })) as Record<string, unknown>;
    expect(ping.pong).toBe(true);
    expect(ping.echo).toBe("hello");
    expect(ping.instance_id).toBe("inst_fake");
    expect(ping.contract_version).toBe(1);

    // brain.health
    const health = (await invoke({
      method: "brain.health",
      params: {},
      ctx,
    })) as Record<string, unknown>;
    expect(["ok", "degraded", "unavailable"]).toContain(health.status);
    expect(health.checks).toBeTypeOf("object");
    expect(health.versions).toBeTypeOf("object");
    expect(health.profile).toBe("contributor");

    // projects.list
    const projects = (await invoke({
      method: "projects.list",
      params: { include_archived: false },
      ctx,
    })) as { projects: unknown[]; source: string };
    expect(Array.isArray(projects.projects)).toBe(true);
    expect(projects.projects).toHaveLength(1);
    expect(projects.source).toBe("fake");

    // settings.snapshot
    const snap = (await invoke({
      method: "settings.snapshot",
      params: {},
      ctx,
    })) as SettingsSnapshot;
    expect(snap.exported_at).toBeTruthy();
    expect(snap.source).toBe("fake");
    expect(snap.skills?.[0]?.id).toBe("summarize");
    expect(snap.backend_home).toBe("/tmp/fake-backend-home");

    // vault.list
    const listed = (await invoke({
      method: "vault.list",
      params: { path: "/Projects/Legal" },
      ctx,
    })) as { path: string; entries: { name: string; kind: string }[]; truncated: boolean };
    expect(listed.path).toBe("/Projects/Legal");
    expect(listed.truncated).toBe(false);
    expect(listed.entries.some((e) => e.name === "memo.md")).toBe(true);
    expect(listed.entries.some((e) => e.name === "exhibits")).toBe(true);

    // vault.stat
    const stat = (await invoke({
      method: "vault.stat",
      params: { path: "/Projects/Legal/memo.md" },
      ctx,
    })) as { kind: string; path: string; name: string };
    expect(stat.kind).toBe("file");
    expect(stat.path).toBe("/Projects/Legal/memo.md");
    expect(stat.name).toBe("memo.md");

    // vault.read
    const body = (await invoke({
      method: "vault.read",
      params: { path: "/Projects/Legal/memo.md", max_bytes: 1_048_576 },
      ctx,
    })) as { kind: string; encoding: string; content: string; size_bytes: number };
    expect(body.kind).toBe("file");
    expect(body.encoding).toMatch(/utf-8|base64/);
    expect(body.content).toContain("Contract test body");
    expect(body.size_bytes).toBeGreaterThan(0);
  });

  it("returns method_not_found for unimplemented methods", async () => {
    const invoke = createFakeBrainRpcInvoker();
    await expect(
      invoke({
        method: "vault.write",
        params: { path: "/x", content: "y" },
        ctx: testContext(),
      }),
    ).rejects.toMatchObject({ code: "method_not_found" });
  });

  it("enforces vault path ACL on wire methods", async () => {
    const invoke = createFakeBrainRpcInvoker(seededFakeOptions());
    await expect(
      invoke({
        method: "vault.read",
        params: { path: "/Secrets/key.txt" },
        ctx: testContext(),
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

// ---------------------------------------------------------------------------
// 2) BFF tests cover settings / projects / vault behavior
// ---------------------------------------------------------------------------

describe("BFF integration via FakeBrainRpcInvoker (production composition)", () => {
  function productionFromFake() {
    const invoke = createFakeBrainRpcInvoker(seededFakeOptions());
    const backend = createProductionHermesBackendRuntimeService({
      invokeBrainRpc: invoke,
    });
    return { invoke, backend };
  }

  describe("settings", () => {
    it("getSettingsSnapshot loads redacted snapshot through Brain RPC", async () => {
      const { backend } = productionFromFake();
      const body = await getSettingsSnapshot(backend, testContext());
      expect(body.exported_at).toBeTruthy();
      // Host origin tag preserved through Brain RPC path (fake → adapter).
      expect(body.source).toBe("fake");
      expect(body.skills?.[0]?.id).toBe("summarize");
      expect(body.backend_home).toBe("/tmp/fake-backend-home");
      // No secret-shaped keys
      expect(JSON.stringify(body)).not.toMatch(/api_key|password|secret/i);
    });

    it("settings handlers snapshot + skill patch via fake host", async () => {
      const { backend, invoke } = productionFromFake();
      const handlers = createSettingsHandlers(backend);
      const ctx = testContext({
        profile: {
          name: "admin",
          pathPrefixes: ["/"],
        },
        roles: ["admin"],
      });

      const snap = await handlers.snapshot(ctx);
      expect(snap.skills).toHaveLength(1);

      const patched = await handlers.patchSkill(ctx, "summarize", {
        enabled: false,
      });
      expect(patched.skill.enabled).toBe(false);
      expect(patched.source).toBe("fake");

      // Host state mutated
      const after = await invoke.backend.settingsSnapshot(ctx);
      expect(after.skills?.[0]?.enabled).toBe(false);
    });

    it("settings unavailable surfaces map cleanly when snapshot fails", async () => {
      const invoke = createFakeBrainRpcInvoker({
        // no settings seed — still returns empty-shaped snapshot from defaults
      });
      // Override invoker to fail settings.snapshot (production Brain RPC path)
      const failing = async (input: {
        method: string;
        params: Record<string, unknown>;
        ctx: BackendRuntimeContext;
      }) => {
        if (input.method === "settings.snapshot") {
          throw new BackendRuntimeError(
            "method_not_found",
            "settings.snapshot not on host",
            { retryable: false, details: { method: "settings.snapshot" } },
          );
        }
        return invoke(input);
      };

      const backend = createProductionHermesBackendRuntimeService({
        invokeBrainRpc: failing,
      });
      const handlers = createSettingsHandlers(backend);
      await expect(handlers.snapshot(testContext())).rejects.toMatchObject({
        code: "method_not_found",
      });
    });
  });

  describe("projects", () => {
    it("listAgentProjects returns Brain RPC projects", async () => {
      const { backend } = productionFromFake();
      const body = await listAgentProjects(backend, testContext());
      expect(body.projects).toHaveLength(1);
      expect(body.projects[0]?.name).toBe("Legal");
      // Host origin tag from fake projects store (via Brain RPC wire).
      expect(body.source).toBe("fake");
    });

    it("agent project handlers list + create through fake host", async () => {
      const { backend, invoke } = productionFromFake();
      const handlers = createAgentProjectsHandlers(backend);
      const listed = await handlers.list(testContext());
      expect(listed.projects[0]?.id).toBe("proj_legal");

      const created = await handlers.create(testContext(), {
        name: "Ops",
        folders: ["/Projects/Ops"],
      });
      expect(created.name).toBe("Ops");
      expect(created.id).toMatch(/^proj_fake_/);

      const hostListed = await invoke.backend.listProjects(testContext());
      expect(hostListed.projects.some((p) => p.id === created.id)).toBe(true);
    });

    it("create is refused when projects_create not advertised", async () => {
      const invoke = createFakeBrainRpcInvoker({
        supportCreateProject: false,
        projects: [],
      });
      const backend = createProductionHermesBackendRuntimeService({
        invokeBrainRpc: invoke,
      });
      const handlers = createAgentProjectsHandlers(backend);
      await expect(
        handlers.create(testContext(), { name: "X" }),
      ).rejects.toMatchObject({ code: "method_not_found" });
    });
  });

  describe("vault", () => {
    it("list / stat / read through production Brain RPC path", async () => {
      const { backend } = productionFromFake();
      const ctx = testContext();

      const listed = await backend.listVault(ctx, { path: "/Projects/Legal" });
      expect(listed.entries.some((e) => e.name === "memo.md")).toBe(true);

      const entry = await backend.statVault(ctx, {
        path: "/Projects/Legal/memo.md",
      });
      expect(entry.kind).toBe("file");

      const body = await backend.readVault(ctx, {
        path: "/Projects/Legal/memo.md",
      });
      expect(body.content).toContain("Contract test body");
    });

    it("directory read is invalid_argument; missing path is not_found", async () => {
      const { backend } = productionFromFake();
      const ctx = testContext();
      await expect(
        backend.readVault(ctx, { path: "/Projects/Legal" }),
      ).rejects.toMatchObject({ code: "invalid_argument" });
      await expect(
        backend.statVault(ctx, { path: "/Projects/Missing" }),
      ).rejects.toMatchObject({ code: "not_found" });
    });

    it("ACL denial is forbidden", async () => {
      const { backend } = productionFromFake();
      await expect(
        backend.readVault(testContext(), { path: "/Secrets/x" }),
      ).rejects.toMatchObject({ code: "forbidden" });
    });

    it("admin pathPrefixes=/ can read any seeded path", async () => {
      const { backend } = productionFromFake();
      const admin = testContext({
        profile: { name: "admin", pathPrefixes: ["/"] },
        roles: ["admin"],
      });
      // Still only files under /Projects are seeded; root list works
      const root = await backend.listVault(admin, { path: "/" });
      expect(root.path).toBe("/");
      expect(root.entries.some((e) => e.name === "Projects")).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// 3) Capability-driven UI states (BFF context → web gates)
// ---------------------------------------------------------------------------

describe("capability-driven UI states (context BFF)", () => {
  it("full fake host → settings/projects/vault UI can flags true", async () => {
    const invoke = createFakeBrainRpcInvoker({
      ...seededFakeOptions(),
      supportPatchSettings: true,
      supportCreateProject: true,
    });
    const backend = createProductionHermesBackendRuntimeService({
      invokeBrainRpc: invoke,
    });
    const body = await getPortalContext(backend, testContext());

    expect(body.backend_capabilities.schema_version).toBe(1);
    assertRequiredBrainRpcMethods(
      body.backend_capabilities.brain_rpc_methods,
    );
    expect(body.ui.can.settings_view).toBe(true);
    expect(body.ui.can.settings_edit).toBe(true);
    expect(body.ui.can.project_list).toBe(true);
    expect(body.ui.can.project_create).toBe(true);
    expect(body.ui.can.vault_browse).toBe(true);
    expect(body.ui.can.host_health).toBe(true);
    expect(body.ui.affordances.settings_page).toBe("supported");
    expect(body.ui.affordances.vault_browser).toBe("supported");
  });

  it("minimal (no patch / no create) → edit affordances unsupported", async () => {
    const invoke = createFakeBrainRpcInvoker({
      supportPatchSettings: false,
      supportCreateProject: false,
      capabilities: {
        schema_version: 1,
        source: "brain_rpc",
        kind: "lanyard_agent",
        contract: { runtime_layout: 1, relay: 1, brain_rpc: 1 },
        brain_rpc_methods: [...REQUIRED_BRAIN_RPC_METHODS],
        features: {
          chat: true,
          health: true,
          capabilities_discovery: true,
          vault_read: true,
          vault_write: false,
          settings_snapshot: true,
          settings_patch: false,
          projects_list: true,
          projects_create: false,
          models: false,
          cron: false,
        },
        ui_affordances: {
          chat_panel: "supported",
          vault_browser: "supported",
          vault_editor: "unsupported",
          settings_page: "supported",
          settings_editor: "unsupported",
          project_picker: "supported",
          project_create: "unsupported",
          model_selector: "unsupported",
          cron_manager: "unsupported",
          host_health: "supported",
        },
      },
    });
    const backend = createProductionHermesBackendRuntimeService({
      invokeBrainRpc: invoke,
    });
    const handlers = createContextHandlers(backend);
    const body = await handlers.get(testContext());

    expect(body.ui.can.settings_view).toBe(true);
    expect(body.ui.can.settings_edit).toBe(false);
    expect(body.ui.can.project_list).toBe(true);
    expect(body.ui.can.project_create).toBe(false);
    expect(body.ui.can.model_select).toBe(false);
    expect(body.ui.can.cron_manage).toBe(false);
    expect(body.ui.affordances.settings_editor).toBe("unsupported");
    expect(body.ui.affordances.project_create).toBe("unsupported");
    expect(body.ui.affordances.model_selector).toBe("unsupported");
  });

  it("context always returns complete affordance map for UI gating", async () => {
    const invoke = createFakeBrainRpcInvoker(seededFakeOptions());
    const backend = createProductionHermesBackendRuntimeService({
      invokeBrainRpc: invoke,
    });
    const body = await getPortalContext(backend, testContext());
    const names = [
      "chat_panel",
      "vault_browser",
      "vault_editor",
      "settings_page",
      "settings_editor",
      "project_picker",
      "project_create",
      "model_selector",
      "cron_manager",
      "host_health",
    ] as const;
    for (const name of names) {
      expect(body.ui.affordances[name]).toMatch(
        /^(supported|unsupported|degraded)$/,
      );
      expect(body.backend_capabilities.ui_affordances?.[name]).toMatch(
        /^(supported|unsupported|degraded)$/,
      );
    }
  });
});
