import { describe, expect, it, vi } from "vitest";

import {
  BackendRuntimeError,
  FakeBackendRuntimeService,
  HermesBackendRuntimeService,
  SETTINGS_PATCH_METHOD,
  SETTINGS_SNAPSHOT_METHOD,
  applySettingsPatch,
  backendContextFromSession,
  createFakeBackendRuntimeService,
  createProductionHermesBackendRuntimeService,
  createSettingsHandlers,
  getSettingsSnapshot,
  parseSettingsPatchInput,
  patchSettingsActiveModel,
  patchSettingsSkill,
  settingsErrorToHttp,
  settingsPatchIsAdvertised,
  validateSettingsPatchAgainstConfigSchema,
  type BackendRuntimeContext,
  type SettingsSnapshot,
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
      profileName: "admin",
      pathPrefixes: [],
      roles: ["admin"],
    }),
    ...overrides,
  };
}

const seedSettings: SettingsSnapshot = {
  exported_at: "2026-07-12T00:00:00.000Z",
  source: "fake",
  backend_home: "/tmp/fake",
  hermes_home: "/tmp/fake",
  skills: [
    { id: "summarize", name: "summarize", enabled: true, path: "skills/summarize" },
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

describe("parseSettingsPatchInput + config.schema validation", () => {
  it("accepts skill.set_enabled wire body", () => {
    expect(
      parseSettingsPatchInput({
        op: "skill.set_enabled",
        skill_id: " summarize ",
        enabled: false,
      }),
    ).toEqual({
      op: "skill.set_enabled",
      skillId: "summarize",
      enabled: false,
    });
  });

  it("accepts model.set_active with provider + model (modelSettings)", () => {
    expect(
      parseSettingsPatchInput({
        op: "model.set_active",
        provider: "openai",
        model: "gpt-4.1",
      }),
    ).toEqual({
      op: "model.set_active",
      provider: "openai",
      model: "gpt-4.1",
    });
  });

  it("accepts cron.create with structured schedule + instructions alias", () => {
    expect(
      parseSettingsPatchInput({
        op: "cron.create",
        name: "Weekly digest",
        instructions: "Do the digest",
        enabled: true,
        schedule: {
          kind: "cron",
          expr: "0 9 * * 1-5",
          display: "Weekdays at 9:00 AM (America/New_York)",
          timezone: "America/New_York",
        },
      }),
    ).toEqual({
      op: "cron.create",
      name: "Weekly digest",
      prompt: "Do the digest",
      enabled: true,
      schedule: {
        kind: "cron",
        expr: "0 9 * * 1-5",
        display: "Weekdays at 9:00 AM (America/New_York)",
        timezone: "America/New_York",
      },
    });
  });

  it("accepts cron.create skills[] skill ids (lp-jzl.9.2)", () => {
    expect(
      parseSettingsPatchInput({
        op: "cron.create",
        name: "Skill-bound",
        prompt: "Use inventory skill",
        schedule: {
          kind: "cron",
          expr: "0 9 * * 1",
          timezone: "UTC",
        },
        skills: ["post-meeting-triage"],
      }),
    ).toEqual({
      op: "cron.create",
      name: "Skill-bound",
      prompt: "Use inventory skill",
      schedule: {
        kind: "cron",
        expr: "0 9 * * 1",
        timezone: "UTC",
      },
      skills: ["post-meeting-triage"],
    });
  });

  it("accepts cron.update partial fields", () => {
    expect(
      parseSettingsPatchInput({
        op: "cron.update",
        cron_id: "job-1",
        enabled: false,
      }),
    ).toEqual({
      op: "cron.update",
      cronId: "job-1",
      enabled: false,
    });
  });

  it("rejects cron.create without schedule", () => {
    expect(() =>
      parseSettingsPatchInput({
        op: "cron.create",
        name: "x",
        prompt: "y",
      }),
    ).toThrow(/schedule/);
  });

  it("rejects secret-shaped keys", () => {
    expect(() =>
      parseSettingsPatchInput({
        op: "skill.set_enabled",
        skill_id: "x",
        enabled: true,
        api_key: "secret",
      }),
    ).toThrow(/secret-shaped/);
  });

  it("rejects missing/invalid op", () => {
    expect(() => parseSettingsPatchInput({})).toThrow(/op one of/);
    expect(() => parseSettingsPatchInput({ op: "nope" })).toThrow(/op one of/);
  });

  it("rejects invalid skill enabled body", () => {
    expect(() =>
      parseSettingsPatchInput({
        op: "skill.set_enabled",
        skill_id: "x",
        enabled: "yes",
      }),
    ).toThrow(/boolean enabled/);
  });

  it("validateSettingsPatchAgainstConfigSchema accepts skill disabled fragment", () => {
    expect(() =>
      validateSettingsPatchAgainstConfigSchema({
        op: "skill.set_enabled",
        skillId: "summarize",
        enabled: false,
      }),
    ).not.toThrow();
  });
});

describe("settingsPatchIsAdvertised", () => {
  it("true when features.settings_patch", () => {
    expect(
      settingsPatchIsAdvertised({ features: { settings_patch: true } }),
    ).toBe(true);
  });

  it("true when method listed", () => {
    expect(
      settingsPatchIsAdvertised({
        features: { settings_patch: false },
        brain_rpc_methods: [SETTINGS_PATCH_METHOD],
      }),
    ).toBe(true);
  });

  it("false when neither advertised", () => {
    expect(
      settingsPatchIsAdvertised({
        features: { settings_snapshot: true },
        brain_rpc_methods: [SETTINGS_SNAPSHOT_METHOD],
      }),
    ).toBe(false);
  });
});

describe("getSettingsSnapshot (BFF → BackendRuntimeService → Brain RPC)", () => {
  it("powers settings page via service.settingsSnapshot (fake is test-only)", async () => {
    const service = createFakeBackendRuntimeService({ settings: seedSettings });
    const body = await getSettingsSnapshot(service, testContext());
    expect(body.skills?.[0]?.id).toBe("summarize");
    expect(body.source).toBe("fake");
    expect(body.exported_at).toBeTruthy();
  });

  it("production Hermes path uses Brain RPC settings.snapshot only", async () => {
    const invoke = vi.fn(async ({ method }: { method: string }) => {
      if (method === "settings.snapshot") {
        return {
          exported_at: "2026-07-12T00:00:00.000Z",
          source: "hermes_lanyard",
          backend_home: "/home/hermes/.hermes",
          hermes_home: "/home/hermes/.hermes",
          skills: [{ id: "rpc", name: "rpc", enabled: true }],
        };
      }
      throw new BackendRuntimeError("method_not_found", method);
    });

    const service = createProductionHermesBackendRuntimeService({
      invokeBrainRpc: invoke,
      // Local port would be wrong in production — must be ignored.
      settings: {
        settingsSnapshot: () => ({
          exported_at: "2020-01-01T00:00:00.000Z",
          source: "hermes",
          skills: [{ id: "local", name: "ShouldNotSee" }],
        }),
      },
    });

    const body = await getSettingsSnapshot(service, testContext());
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        method: SETTINGS_SNAPSHOT_METHOD,
      }),
    );
    expect(body.skills?.[0]?.id).toBe("rpc");
    expect(body.source).toBe("hermes_lanyard");
  });

  it("production without invoker fails closed (no silent config.yaml)", async () => {
    const service = new HermesBackendRuntimeService({
      settingsRequireBrainRpc: true,
      settings: {
        settingsSnapshot: () => ({
          exported_at: "2020-01-01T00:00:00.000Z",
          source: "hermes",
          skills: [{ id: "leak", name: "Leak" }],
        }),
      },
    });
    await expect(getSettingsSnapshot(service, testContext())).rejects.toMatchObject(
      { code: "unavailable" },
    );
  });

  it("handlers.snapshot delegates to service", async () => {
    const service = createFakeBackendRuntimeService({ settings: seedSettings });
    const handlers = createSettingsHandlers(service);
    const body = await handlers.snapshot(testContext());
    expect(body.skills?.[0]?.id).toBe("summarize");
  });
});

describe("applySettingsPatch (contract gated + config validated)", () => {
  it("patches skill when capability advertised (fake supports patch)", async () => {
    const service = new FakeBackendRuntimeService({
      supportPatchSettings: true,
      settings: seedSettings,
    });
    const result = await applySettingsPatch(service, testContext(), {
      op: "skill.set_enabled",
      skillId: "summarize",
      enabled: false,
    });
    expect(result.skill?.enabled).toBe(false);
    expect(result.source).toBe("fake");
  });

  it("refuses patch when capability not advertised (clear unavailable)", async () => {
    const service = createFakeBackendRuntimeService({
      supportPatchSettings: false,
      settings: seedSettings,
      capabilities: {
        schema_version: 1,
        brain_rpc_methods: [SETTINGS_SNAPSHOT_METHOD],
        features: {
          settings_snapshot: true,
          settings_patch: false,
          chat: true,
          health: true,
          capabilities_discovery: false,
          vault_read: true,
          vault_write: false,
          projects_list: true,
          projects_create: false,
          models: false,
          cron: false,
        },
      },
    });
    await expect(
      applySettingsPatch(service, testContext(), {
        op: "skill.set_enabled",
        skillId: "summarize",
        enabled: false,
      }),
    ).rejects.toMatchObject({ code: "method_not_found" });
  });

  it("production patch goes through Brain RPC settings.patch", async () => {
    const invoke = vi.fn(
      async ({
        method,
        params,
      }: {
        method: string;
        params: Record<string, unknown>;
      }) => {
        if (method === "brain.capabilities") {
          return {
            schema_version: 1,
            brain_rpc_methods: [
              SETTINGS_SNAPSHOT_METHOD,
              SETTINGS_PATCH_METHOD,
            ],
            features: { settings_snapshot: true, settings_patch: true },
          };
        }
        if (method === "settings.patch") {
          return {
            op: params.op,
            source: "hermes",
            skill: {
              id: params.skill_id,
              name: params.skill_id,
              enabled: params.enabled,
            },
          };
        }
        throw new BackendRuntimeError("method_not_found", method);
      },
    );

    const service = createProductionHermesBackendRuntimeService({
      invokeBrainRpc: invoke,
    });
    const result = await applySettingsPatch(service, testContext(), {
      op: "skill.set_enabled",
      skillId: "summarize",
      enabled: false,
    });
    expect(result.skill?.enabled).toBe(false);
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ method: SETTINGS_PATCH_METHOD }),
    );
  });

  it("handlers.patchSkill validates body then patches", async () => {
    const service = new FakeBackendRuntimeService({
      supportPatchSettings: true,
      settings: seedSettings,
    });
    const handlers = createSettingsHandlers(service);
    await expect(
      handlers.patchSkill(testContext(), "summarize", { enabled: "nope" }),
    ).rejects.toThrow(BackendRuntimeError);
    const ok = await handlers.patchSkill(testContext(), "summarize", {
      enabled: false,
    });
    expect(ok.skill.enabled).toBe(false);
  });

  it("patchSettingsActiveModel validates modelSettings-shaped input", async () => {
    const service = new FakeBackendRuntimeService({
      supportPatchSettings: true,
      settings: seedSettings,
    });
    const body = await patchSettingsActiveModel(service, testContext(), {
      provider: "anthropic",
      model: "claude-sonnet",
    });
    expect(body.model.is_active).toBe(true);
    expect(body.model.provider).toBe("anthropic");
  });

  it("patchSettingsSkill not_found when skill missing", async () => {
    const service = new FakeBackendRuntimeService({
      supportPatchSettings: true,
      settings: seedSettings,
    });
    await expect(
      patchSettingsSkill(service, testContext(), "missing", { enabled: true }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("settingsErrorToHttp (clear unavailable states)", () => {
  it("marks method_not_found as unavailable for UI", () => {
    const mapped = settingsErrorToHttp(
      new BackendRuntimeError(
        "method_not_found",
        "settings.patch is not advertised",
        { details: { method: SETTINGS_PATCH_METHOD } },
      ),
    );
    expect(mapped.status).toBe(404);
    expect(mapped.body.unavailable).toBe(true);
    expect(mapped.body.method).toBe(SETTINGS_PATCH_METHOD);
    expect(mapped.body.code).toBe("method_not_found");
  });

  it("marks unavailable host as unavailable for UI", () => {
    const mapped = settingsErrorToHttp(
      new BackendRuntimeError(
        "unavailable",
        "settings.snapshot requires Brain RPC",
        { details: { method: SETTINGS_SNAPSHOT_METHOD } },
      ),
    );
    expect(mapped.status).toBe(503);
    expect(mapped.body.unavailable).toBe(true);
  });

  it("does not mark forbidden as unavailable", () => {
    const mapped = settingsErrorToHttp(
      new BackendRuntimeError("forbidden", "nope"),
    );
    expect(mapped.status).toBe(403);
    expect(mapped.body.unavailable).toBeUndefined();
  });

  it("maps unknown errors to 500", () => {
    const mapped = settingsErrorToHttp(new Error("boom"));
    expect(mapped.status).toBe(500);
    expect(mapped.body.code).toBe("internal");
  });
});

describe("Hermes adapter settingsRequireBrainRpc", () => {
  it("allows local settings port only when not requiring Brain RPC (tests)", async () => {
    const service = new HermesBackendRuntimeService({
      settingsRequireBrainRpc: false,
      settings: {
        settingsSnapshot: () => ({
          exported_at: "2026-07-12T00:00:00.000Z",
          source: "fixture",
          skills: [],
        }),
      },
    });
    const snap = await service.settingsSnapshot(testContext());
    expect(snap.source).toBe("fixture");
  });

  it("normalizes incomplete Brain RPC snapshot payloads", async () => {
    const service = new HermesBackendRuntimeService({
      invokeBrainRpc: async () => ({
        exported_at: "2026-07-12T00:00:00.000Z",
        // missing source → default brain_rpc
        skills: [{ id: "a", name: "A" }],
      }),
    });
    const snap = await service.settingsSnapshot(testContext());
    expect(snap.source).toBe("brain_rpc");
    expect(snap.skills?.[0]?.id).toBe("a");
  });

  it("patchSettings fails closed when settingsRequireBrainRpc without invoker", async () => {
    const service = new HermesBackendRuntimeService({
      settingsRequireBrainRpc: true,
      settings: {
        settingsSnapshot: () => seedSettings,
        patchSettings: async () => ({
          op: "skill.set_enabled" as const,
          source: "hermes",
          skill: { id: "x", name: "x", enabled: false },
        }),
      },
    });
    await expect(
      service.patchSettings!(testContext(), {
        op: "skill.set_enabled",
        skillId: "summarize",
        enabled: false,
      }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});
