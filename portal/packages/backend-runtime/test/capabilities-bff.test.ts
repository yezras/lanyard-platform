import { describe, expect, it, vi } from "vitest";

import {
  BackendRuntimeError,
  BRAIN_CAPABILITIES_METHOD,
  FakeBackendRuntimeService,
  HermesBackendRuntimeService,
  UI_AFFORDANCE_NAMES,
  backendContextFromSession,
  contextErrorToHttp,
  createContextHandlers,
  createFakeBackendRuntimeService,
  createProductionHermesBackendRuntimeService,
  defaultHermesLanyardCapabilities,
  deriveUiAffordanceState,
  deriveUiAffordances,
  getPortalContext,
  isAffordanceSupported,
  isAffordanceUnsupported,
  normalizeCapabilityDescriptor,
  uiStateFromCapabilities,
  withDerivedUiAffordances,
  type BackendCapabilitySet,
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
      profileName: "admin",
      pathPrefixes: [],
      roles: ["admin"],
    }),
    ...overrides,
  };
}

describe("deriveUiAffordances (schema catalog rules)", () => {
  it("marks required v1 surfaces supported when methods + features match", () => {
    const caps = defaultHermesLanyardCapabilities();
    const affordances = deriveUiAffordances(caps);
    expect(affordances.settings_page).toBe("supported");
    expect(affordances.project_picker).toBe("supported");
    expect(affordances.vault_browser).toBe("supported");
    expect(affordances.host_health).toBe("supported");
    expect(affordances.chat_panel).toBe("supported");
  });

  it("marks expansion surfaces unsupported without methods", () => {
    const caps = defaultHermesLanyardCapabilities({
      features: {
        chat: true,
        health: true,
        capabilities_discovery: false,
        vault_read: true,
        vault_write: false,
        settings_snapshot: true,
        settings_patch: false,
        projects_list: true,
        projects_create: false,
        models: true, // flag true but methods missing → unsupported
        cron: true,
      },
      ui_affordances: undefined,
      brain_rpc_methods: [
        "brain.ping",
        "brain.health",
        "vault.list",
        "vault.stat",
        "vault.read",
        "settings.snapshot",
        "projects.list",
      ],
    });
    // Clear explicit affordances so derivation runs.
    const { ui_affordances: _drop, ...rest } = caps;
    void _drop;
    const affordances = deriveUiAffordances({
      ...rest,
      ui_affordances: undefined,
    });
    expect(affordances.model_selector).toBe("unsupported");
    expect(affordances.cron_manager).toBe("unsupported");
    expect(affordances.settings_editor).toBe("unsupported");
    expect(affordances.project_create).toBe("unsupported");
    expect(affordances.vault_editor).toBe("unsupported");
  });

  it("honors host-asserted degraded without inventing it from methods", () => {
    const state = deriveUiAffordanceState("settings_editor", {
      features: { settings_patch: true },
      brain_rpc_methods: ["settings.patch"],
    });
    expect(state).toBe("supported");

    const withDegraded = deriveUiAffordances({
      features: { settings_patch: true },
      brain_rpc_methods: ["settings.patch"],
      ui_affordances: { settings_editor: "degraded" },
    });
    expect(withDegraded.settings_editor).toBe("degraded");
  });

  it("requires any_of methods for model_selector", () => {
    expect(
      deriveUiAffordanceState("model_selector", {
        features: { models: true },
        brain_rpc_methods: ["settings.snapshot"],
      }),
    ).toBe("unsupported");
    expect(
      deriveUiAffordanceState("model_selector", {
        features: { models: true },
        brain_rpc_methods: ["models.list"],
      }),
    ).toBe("supported");
  });
});

describe("uiStateFromCapabilities", () => {
  it("builds can flags and unsupported lists from affordances", () => {
    // Drop explicit ui_affordances so derivation drives the lists.
    // Include projects.create in methods so project_create derives supported.
    const base = defaultHermesLanyardCapabilities({
      brain_rpc_methods: [
        ...defaultHermesLanyardCapabilities().brain_rpc_methods,
        "projects.create",
      ],
      features: {
        chat: true,
        health: true,
        capabilities_discovery: false,
        vault_read: true,
        vault_write: false,
        settings_snapshot: true,
        settings_patch: false,
        projects_list: true,
        projects_create: true,
        models: false,
        cron: false,
      },
    });
    const { ui_affordances: _omit, ...caps } = base;
    void _omit;
    const ui = uiStateFromCapabilities({
      ...caps,
      ui_affordances: undefined,
    });
    expect(ui.can.settings_view).toBe(true);
    expect(ui.can.settings_edit).toBe(false);
    expect(ui.can.project_create).toBe(true);
    expect(ui.can.model_select).toBe(false);
    expect(ui.unsupported).toContain("settings_editor");
    expect(ui.unsupported).toContain("model_selector");
    expect(isAffordanceSupported(ui, "settings_page")).toBe(true);
    expect(isAffordanceUnsupported(ui, "vault_editor")).toBe(true);
  });

  it("covers every catalogued affordance name", () => {
    const ui = uiStateFromCapabilities(defaultHermesLanyardCapabilities());
    for (const name of UI_AFFORDANCE_NAMES) {
      expect(ui.affordances[name]).toMatch(/^(supported|unsupported|degraded)$/);
    }
  });
});

describe("normalizeCapabilityDescriptor", () => {
  it("repairs missing features and methods from fallback", () => {
    const { capabilities, repaired, notes } = normalizeCapabilityDescriptor({});
    expect(repaired).toBe(true);
    expect(notes).toBeTruthy();
    expect(capabilities.schema_version).toBe(1);
    expect(capabilities.brain_rpc_methods.length).toBeGreaterThan(0);
    expect(typeof capabilities.features.vault_read).toBe("boolean");
  });

  it("infers feature flags from method list when omitted", () => {
    const { capabilities } = normalizeCapabilityDescriptor({
      schema_version: 1,
      brain_rpc_methods: [
        "brain.ping",
        "brain.health",
        "vault.list",
        "vault.stat",
        "vault.read",
        "settings.snapshot",
        "projects.list",
        "projects.create",
      ],
      features: {},
    });
    expect(capabilities.features.vault_read).toBe(true);
    expect(capabilities.features.settings_snapshot).toBe(true);
    expect(capabilities.features.projects_list).toBe(true);
    expect(capabilities.features.projects_create).toBe(true);
    expect(capabilities.features.settings_patch).toBe(false);
  });

  it("accepts a full live brain.capabilities-shaped payload", () => {
    const live: BackendCapabilitySet = {
      schema_version: 1,
      source: "brain_rpc",
      kind: "hermes_lanyard",
      brain_rpc_methods: [
        "brain.ping",
        "brain.health",
        "brain.capabilities",
        "vault.list",
        "vault.stat",
        "vault.read",
        "settings.snapshot",
        "settings.patch",
        "projects.list",
      ],
      features: {
        chat: true,
        health: true,
        capabilities_discovery: true,
        vault_read: true,
        vault_write: false,
        settings_snapshot: true,
        settings_patch: true,
        projects_list: true,
        projects_create: false,
        models: false,
        cron: false,
        history_read: false,
        heads_read: false,
      },
      ui_affordances: {
        settings_editor: "supported",
      },
    };
    const { capabilities, repaired } = normalizeCapabilityDescriptor(live);
    expect(repaired).toBe(false);
    expect(capabilities.source).toBe("brain_rpc");
    expect(capabilities.features.settings_patch).toBe(true);
  });
});

describe("getPortalContext (GET /api/context equivalent)", () => {
  it("returns capability set + ui state from fake backend", async () => {
    const service = createFakeBackendRuntimeService({
      supportCreateProject: true,
    });
    const body = await getPortalContext(service, testContext());
    expect(body.backend_capabilities.schema_version).toBe(1);
    expect(body.backend_capabilities.brain_rpc_methods).toContain(
      "projects.list",
    );
    expect(body.ui.can.project_list).toBe(true);
    expect(body.ui.can.settings_view).toBe(true);
    expect(body.capabilities_source).toBeTruthy();
    // Fake uses static_default / static source → degraded is allowed true
    expect(typeof body.capabilities_degraded).toBe("boolean");
    for (const name of UI_AFFORDANCE_NAMES) {
      expect(body.backend_capabilities.ui_affordances?.[name]).toMatch(
        /^(supported|unsupported|degraded)$/,
      );
    }
  });

  it("derives UI from live Brain RPC capabilities", async () => {
    const invoke = vi.fn(async ({ method }: { method: string }) => {
      if (method === BRAIN_CAPABILITIES_METHOD) {
        return {
          schema_version: 1,
          source: "brain_rpc",
          kind: "hermes_lanyard",
          brain_rpc_methods: [
            "brain.ping",
            "brain.health",
            "brain.capabilities",
            "vault.list",
            "vault.stat",
            "vault.read",
            "settings.snapshot",
            "settings.patch",
            "projects.list",
            "projects.create",
          ],
          features: {
            chat: true,
            health: true,
            capabilities_discovery: true,
            vault_read: true,
            vault_write: false,
            settings_snapshot: true,
            settings_patch: true,
            projects_list: true,
            projects_create: true,
            models: false,
            cron: false,
            history_read: false,
            heads_read: false,
          },
          ui_affordances: {
            chat_panel: "supported",
            vault_browser: "supported",
            vault_editor: "unsupported",
            settings_page: "supported",
            settings_editor: "supported",
            project_picker: "supported",
            project_create: "supported",
            model_selector: "unsupported",
            cron_manager: "unsupported",
            host_health: "supported",
          },
        };
      }
      throw new BackendRuntimeError("method_not_found", `unexpected ${method}`);
    });

    const service = createProductionHermesBackendRuntimeService({
      invokeBrainRpc: invoke,
    });
    const body = await getPortalContext(service, testContext());
    expect(body.capabilities_source).toBe("brain_rpc");
    expect(body.capabilities_degraded).toBe(false);
    expect(body.ui.can.settings_edit).toBe(true);
    expect(body.ui.can.project_create).toBe(true);
    expect(body.ui.can.model_select).toBe(false);
    expect(invoke).toHaveBeenCalledWith(
      expect.objectContaining({ method: BRAIN_CAPABILITIES_METHOD }),
    );
  });

  it("does not crash when brain.capabilities is method_not_found (manifest fallback)", async () => {
    const service = new HermesBackendRuntimeService({
      invokeBrainRpc: async ({ method }) => {
        if (method === BRAIN_CAPABILITIES_METHOD) {
          throw new BackendRuntimeError(
            "method_not_found",
            "brain.capabilities not implemented",
            { retryable: false, details: { method: BRAIN_CAPABILITIES_METHOD } },
          );
        }
        throw new BackendRuntimeError("method_not_found", method);
      },
      brainRpcPreferred: true,
      staticCapabilities: defaultHermesLanyardCapabilities({
        notes: "pin fallback",
      }),
    });

    const body = await getPortalContext(service, testContext());
    expect(body.backend_capabilities.brain_rpc_methods).toContain(
      "settings.snapshot",
    );
    expect(body.ui.can.settings_view).toBe(true);
    expect(body.capabilities_degraded).toBe(true);
    expect(body.capabilities_source).toBe("artifact_manifest");
  });

  it("does not crash when service.capabilities throws unavailable", async () => {
    const service = {
      capabilities: async () => {
        throw new BackendRuntimeError(
          "unavailable",
          "relay down",
          { retryable: true, details: { method: BRAIN_CAPABILITIES_METHOD } },
        );
      },
    } as unknown as FakeBackendRuntimeService;

    const body = await getPortalContext(service, testContext());
    expect(body.capabilities_degraded).toBe(true);
    expect(body.capabilities_source).toBe("static_default");
    expect(body.ui.affordances.settings_page).toMatch(
      /^(supported|unsupported|degraded)$/,
    );
    expect(body.capabilities_notes).toMatch(/unavailable|failed/i);
  });

  it("does not crash on malformed capability payload", async () => {
    const service = {
      capabilities: async () => "not-an-object",
    } as unknown as FakeBackendRuntimeService;

    const body = await getPortalContext(service, testContext());
    expect(body.capabilities_degraded).toBe(true);
    expect(body.backend_capabilities.schema_version).toBe(1);
    expect(Array.isArray(body.backend_capabilities.brain_rpc_methods)).toBe(
      true,
    );
  });

  it("fills missing ui_affordances so UI state is always complete", async () => {
    const service = createFakeBackendRuntimeService({
      capabilities: {
        schema_version: 1,
        source: "brain_rpc",
        brain_rpc_methods: [
          "brain.ping",
          "brain.health",
          "vault.list",
          "vault.stat",
          "vault.read",
          "settings.snapshot",
          "projects.list",
        ],
        features: {
          chat: true,
          health: true,
          capabilities_discovery: false,
          vault_read: true,
          vault_write: false,
          settings_snapshot: true,
          settings_patch: false,
          projects_list: true,
          projects_create: false,
          models: false,
          cron: false,
        },
        // intentionally omit ui_affordances
      },
    });
    const body = await getPortalContext(service, testContext());
    for (const name of UI_AFFORDANCE_NAMES) {
      expect(body.ui.affordances[name]).toBeDefined();
    }
    expect(body.ui.can.settings_view).toBe(true);
    expect(body.ui.can.settings_edit).toBe(false);
  });
});

describe("createContextHandlers", () => {
  it("exposes get + capabilities handlers", async () => {
    const service = createFakeBackendRuntimeService();
    const handlers = createContextHandlers(service);
    const ctx = testContext();
    const body = await handlers.get(ctx);
    const caps = await handlers.capabilities(ctx);
    expect(body.backend_capabilities.brain_rpc_methods).toEqual(
      caps.brain_rpc_methods,
    );
    expect(body.ui.can.vault_browse).toBe(
      caps.ui_affordances?.vault_browser === "supported",
    );
  });
});

describe("withDerivedUiAffordances + contextErrorToHttp", () => {
  it("materializes complete ui_affordances on a partial descriptor", () => {
    const caps = withDerivedUiAffordances({
      schema_version: 1,
      brain_rpc_methods: ["brain.health", "settings.snapshot", "projects.list"],
      features: {
        chat: false,
        health: true,
        capabilities_discovery: false,
        vault_read: false,
        vault_write: false,
        settings_snapshot: true,
        settings_patch: false,
        projects_list: true,
        projects_create: false,
        models: false,
        cron: false,
      },
    });
    expect(caps.ui_affordances?.host_health).toBe("supported");
    expect(caps.ui_affordances?.settings_page).toBe("supported");
    expect(caps.ui_affordances?.vault_browser).toBe("unsupported");
  });

  it("maps BackendRuntimeError to HTTP body (rare path)", () => {
    const err = new BackendRuntimeError(
      "unauthenticated",
      "no session",
      { retryable: false },
    );
    const { status, body } = contextErrorToHttp(err);
    expect(status).toBe(401);
    expect(body.code).toBe("unauthenticated");
  });

  it("marks method_not_found as unavailable in error body", () => {
    const err = new BackendRuntimeError(
      "method_not_found",
      "missing",
      { retryable: false, details: { method: BRAIN_CAPABILITIES_METHOD } },
    );
    const { body } = contextErrorToHttp(err);
    expect(body.unavailable).toBe(true);
    expect(body.method).toBe(BRAIN_CAPABILITIES_METHOD);
  });
});
