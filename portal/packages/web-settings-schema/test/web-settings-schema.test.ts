import { describe, expect, it } from "vitest";

import {
  CONFIG_CATEGORY_CATALOG,
  CONFIG_SCHEMA_CATEGORIES,
  buildCategoryControls,
  buildSettingsUiSchema,
  catalogEntryForCategory,
  catalogEntryForSection,
  cronEditIsSupported,
  cronSectionIsVisible,
  disabledControlsWithReason,
  disabledReasonMessage,
  gateForCategory,
  interactiveControls,
  modelEditIsSupported,
  sectionById,
  sectionIsVisible,
  settingsEditIsSupported,
  settingsViewIsSupported,
  visibleSections,
  type CapabilityInput,
  type PortalUiStateLike,
  type SettingsSnapshotLike,
  type SettingsUiSchema,
} from "../src/index.js";

const fullSnapshot: SettingsSnapshotLike = {
  exported_at: "2026-07-12T00:00:00.000Z",
  source: "brain_rpc",
  backend_home: "/var/lib/backend",
  hermes_home: "/var/lib/backend",
  skills: [
    { id: "summarize", name: "Summarize", enabled: true, path: "skills/summarize" },
    { id: "search", name: "Search", enabled: false },
  ],
  crons: [
    {
      id: "nightly",
      name: "Nightly",
      schedule: "0 6 * * *",
      enabled: true,
    },
  ],
  mcp_servers: [
    { name: "filesystem", transport: "stdio", enabled: true },
  ],
  models: [
    { provider: "openai", model: "gpt-4.1", is_active: true, connected: true },
    { provider: "anthropic", model: "claude-sonnet", is_active: false },
  ],
  integrations: [{ id: "cli", name: "CLI", type: "bin" }],
  workflows: [
    {
      id: "fizzbuzz-algorithm-test-report",
      name: "FizzBuzz algorithm test report",
      path: ".lanyard/workflows/fizzbuzz-algorithm-test-report.yaml",
    },
  ],
};

/** Hermes-Lanyard-like full capability set. */
const fullCaps: CapabilityInput = {
  features: {
    settings_snapshot: true,
    settings_patch: true,
    models: true,
    cron: true,
  },
  brain_rpc_methods: [
    "settings.snapshot",
    "settings.patch",
    "models.set_active",
    "cron.patch",
  ],
  ui_affordances: {
    settings_page: "supported",
    settings_editor: "supported",
    model_selector: "supported",
    cron_manager: "supported",
  },
};

const fullUi: PortalUiStateLike = {
  affordances: {
    settings_page: "supported",
    settings_editor: "supported",
    model_selector: "supported",
    cron_manager: "supported",
  },
  can: {
    settings_view: true,
    settings_edit: true,
    model_select: true,
    cron_manage: true,
  },
};

function kinds(schema: SettingsUiSchema): string[] {
  return schema.controls.map((c) => c.kind);
}

describe("CONFIG_CATEGORY_CATALOG (backend schema)", () => {
  it("covers model, skills, cron, mcp_servers from config.schema.json", () => {
    expect([...CONFIG_SCHEMA_CATEGORIES].sort()).toEqual(
      ["cron", "mcp_servers", "model", "skills"].sort(),
    );
    for (const cat of CONFIG_SCHEMA_CATEGORIES) {
      const entry = catalogEntryForCategory(cat);
      expect(entry.category).toBe(cat);
      expect(entry.schemaPath).toMatch(/^properties\./);
      expect(entry.patchOps.length).toBeGreaterThan(0);
    }
  });

  it("maps categories to SettingsView section ids", () => {
    expect(CONFIG_CATEGORY_CATALOG.model.section).toBe("models");
    expect(CONFIG_CATEGORY_CATALOG.skills.section).toBe("skills");
    expect(CONFIG_CATEGORY_CATALOG.cron.section).toBe("crons");
    expect(CONFIG_CATEGORY_CATALOG.mcp_servers.section).toBe("mcp");
    expect(catalogEntryForSection("models")?.category).toBe("model");
    expect(catalogEntryForSection("skills")?.category).toBe("skills");
  });

  it("documents modelSettings / skillsSettings / cronSettings surfaces", () => {
    expect(CONFIG_CATEGORY_CATALOG.model.schemaDef).toBe("modelSettings");
    expect(CONFIG_CATEGORY_CATALOG.skills.schemaDef).toBe("skillsSettings");
    expect(CONFIG_CATEGORY_CATALOG.cron.schemaDef).toBe("cronSettings");
    expect(CONFIG_CATEGORY_CATALOG.skills.patchOps).toContain("skill.set_enabled");
    expect(CONFIG_CATEGORY_CATALOG.model.patchOps).toContain("model.set_active");
    expect(CONFIG_CATEGORY_CATALOG.cron.patchOps).toContain("cron.set_enabled");
  });
});

describe("capability gates", () => {
  it("settings view supported from ui.can or features/methods", () => {
    expect(settingsViewIsSupported(fullUi, fullCaps)).toBe(true);
    expect(
      settingsViewIsSupported(null, {
        features: { settings_snapshot: true },
        brain_rpc_methods: ["settings.snapshot"],
      }),
    ).toBe(true);
    expect(
      settingsViewIsSupported(null, {
        features: {},
        brain_rpc_methods: [],
      }),
    ).toBe(false);
  });

  it("settings edit requires settings_patch / settings.patch", () => {
    expect(settingsEditIsSupported(fullUi, fullCaps)).toBe(true);
    expect(
      settingsEditIsSupported(null, {
        features: { settings_snapshot: true },
        brain_rpc_methods: ["settings.snapshot"],
      }),
    ).toBe(false);
    expect(
      settingsEditIsSupported(null, {
        features: { settings_patch: true },
      }),
    ).toBe(true);
  });

  it("model edit accepts models feature or models.set_active without settings_patch", () => {
    expect(
      modelEditIsSupported(null, {
        features: { models: true },
        brain_rpc_methods: ["models.set_active"],
      }),
    ).toBe(true);
    expect(
      modelEditIsSupported(null, {
        features: {},
        brain_rpc_methods: [],
      }),
    ).toBe(false);
  });

  it("cron edit accepts cron feature or cron.patch without settings_patch", () => {
    expect(
      cronEditIsSupported(null, {
        features: { cron: true },
        brain_rpc_methods: ["cron.patch"],
      }),
    ).toBe(true);
    expect(
      cronEditIsSupported(null, {
        features: {},
        brain_rpc_methods: [],
      }),
    ).toBe(false);
  });

  it("LA pin: settings_patch enables cron toggles while features.cron stays false (lp-uxy.3)", () => {
    // Honest LA baseline: no dedicated cron.list/cron.patch yet
    const laCaps: CapabilityInput = {
      features: {
        settings_snapshot: true,
        settings_patch: true,
        cron: false,
      },
      brain_rpc_methods: ["settings.snapshot", "settings.patch"],
      ui_affordances: {
        settings_page: "supported",
        settings_editor: "supported",
        cron_manager: "unsupported",
      },
    };
    const laUi: PortalUiStateLike = {
      affordances: {
        settings_page: "supported",
        settings_editor: "supported",
        cron_manager: "unsupported",
      },
      can: {
        settings_view: true,
        settings_edit: true,
        cron_manage: false,
      },
    };
    const laSnapshot: SettingsSnapshotLike = {
      exported_at: "2026-08-04T12:00:00.000Z",
      source: "lanyard_agent",
      backend_home: "/var/lib/lanyard-agent",
      hermes_home: "/var/lib/lanyard-agent",
      crons: [
        {
          id: "la-vault-index",
          name: "LA vault index refresh",
          schedule: "Daily at 3:00 AM",
          enabled: true,
          path: "cron/jobs.json",
        },
      ],
    };

    expect(cronSectionIsVisible(laUi, laCaps, laSnapshot)).toBe(true);
    expect(cronEditIsSupported(laUi, laCaps)).toBe(true);

    const schema = buildSettingsUiSchema({
      snapshot: laSnapshot,
      capabilities: laCaps,
      ui: laUi,
    });
    expect(schema.page.backendHome).toBe("/var/lib/lanyard-agent");
    expect(schema.page.backendHome).not.toMatch(/\.hermes/);
    const crons = sectionById(schema, "crons");
    expect(crons?.availability.visible).toBe(true);
    expect(crons?.entityCount).toBe(1);
    const toggle = crons?.controls.find((c) => c.kind === "cron_toggle");
    expect(toggle?.availability.interactive).toBe(true);
    expect(toggle?.patchOp).toBe("cron.set_enabled");
  });

  it("lp-su0: LA empty crons still show Settings section when patch path works", () => {
    const laCaps: CapabilityInput = {
      features: {
        settings_snapshot: true,
        settings_patch: true,
        cron: false,
      },
      brain_rpc_methods: ["settings.snapshot", "settings.patch"],
      ui_affordances: {
        settings_page: "supported",
        settings_editor: "supported",
        cron_manager: "unsupported",
      },
    };
    const laUi: PortalUiStateLike = {
      affordances: {
        settings_page: "supported",
        settings_editor: "supported",
        cron_manager: "unsupported",
      },
      can: {
        settings_view: true,
        settings_edit: true,
        cron_manage: false,
      },
    };
    const emptyLa: SettingsSnapshotLike = {
      exported_at: "2026-08-04T12:00:00.000Z",
      source: "lanyard_agent",
      backend_home: "/var/lib/lanyard-agent",
      hermes_home: "/var/lib/lanyard-agent",
      crons: [],
    };

    expect(cronSectionIsVisible(laUi, laCaps, emptyLa)).toBe(true);
    expect(cronEditIsSupported(laUi, laCaps)).toBe(true);

    // Q10 partial hosts with empty crons + generic source still hide.
    const genericEmpty: SettingsSnapshotLike = {
      ...emptyLa,
      source: "brain_rpc",
    };
    expect(cronSectionIsVisible(laUi, laCaps, genericEmpty)).toBe(false);
  });

  it("lp-su0: features.cron honest empty inventory stays visible", () => {
    const caps: CapabilityInput = {
      features: { cron: true, settings_snapshot: true },
      brain_rpc_methods: ["settings.snapshot", "cron.list", "cron.patch"],
      ui_affordances: { cron_manager: "supported" },
    };
    const ui: PortalUiStateLike = {
      affordances: { cron_manager: "supported" },
      can: { cron_manage: true },
    };
    const empty: SettingsSnapshotLike = {
      exported_at: "2026-08-04T12:00:00.000Z",
      source: "lanyard_agent",
      crons: [],
    };
    expect(cronSectionIsVisible(ui, caps, empty)).toBe(true);
  });

  it("gateForCategory returns disabled reasons when unsupported", () => {
    const gate = gateForCategory("model", null, {
      features: { settings_snapshot: true },
      brain_rpc_methods: ["settings.snapshot"],
    });
    expect(gate.supported).toBe(false);
    expect(gate.availability.interactive).toBe(false);
    expect(gate.availability.disabledReason).toMatch(
      /Model selection is not available|Models are not supported/i,
    );
    expect(gate.availability.unavailableCode).toBe("model_selector_unsupported");
  });
});

describe("buildSettingsUiSchema — full backend support", () => {
  it("renders model, skills, and cron controls as interactive", () => {
    const schema = buildSettingsUiSchema({
      snapshot: fullSnapshot,
      capabilities: fullCaps,
      ui: fullUi,
    });

    expect(schema.page.interactive).toBe(true);
    expect(schema.page.backendHome).toBe("/var/lib/backend");
    expect(schema.page.source).toBe("brain_rpc");

    const models = sectionById(schema, "models");
    expect(models?.configCategory).toBe("model");
    expect(models?.schemaPath).toBe("properties.model");
    expect(models?.entityCount).toBe(2);
    expect(models?.availability.interactive).toBe(true);
    expect(
      models?.controls.filter((c) => c.kind === "model_activate"),
    ).toHaveLength(2);
    expect(
      models?.controls.every((c) =>
        c.kind === "model_activate" ? c.availability.interactive : true,
      ),
    ).toBe(true);

    const skills = sectionById(schema, "skills");
    expect(skills?.configCategory).toBe("skills");
    expect(skills?.entityCount).toBe(2);
    expect(
      skills?.controls.filter((c) => c.kind === "skill_toggle" && c.availability.interactive),
    ).toHaveLength(2);
    expect(skills?.controls[0]?.patchOp).toBe("skill.set_enabled");

    const crons = sectionById(schema, "crons");
    expect(crons?.configCategory).toBe("cron");
    expect(crons?.entityCount).toBe(1);
    expect(crons?.controls[0]?.kind).toBe("cron_toggle");
    expect(crons?.controls[0]?.availability.interactive).toBe(true);
    expect(crons?.controls[0]?.patchOp).toBe("cron.set_enabled");

    const interactive = interactiveControls(schema);
    expect(interactive.some((c) => c.kind === "model_activate")).toBe(true);
    expect(interactive.some((c) => c.kind === "skill_toggle")).toBe(true);
    expect(interactive.some((c) => c.kind === "cron_toggle")).toBe(true);
    expect(interactive.some((c) => c.kind === "mcp_toggle")).toBe(true);
  });

  it("exposes skill entity payload and enabled state from snapshot", () => {
    const schema = buildSettingsUiSchema({
      snapshot: fullSnapshot,
      ui: fullUi,
    });
    const summarize = schema.controls.find((c) => c.id === "skill:summarize");
    expect(summarize?.skill?.enabled).toBe(true);
    expect(summarize?.skill?.path).toBe("skills/summarize");
    const search = schema.controls.find((c) => c.id === "skill:search");
    expect(search?.skill?.enabled).toBe(false);
  });

  it("exposes active model from snapshot through model schema category", () => {
    const models = buildCategoryControls("model", {
      snapshot: fullSnapshot,
      ui: fullUi,
    });
    const active = models.controls.find((c) => c.model?.is_active);
    expect(active?.model).toEqual(
      expect.objectContaining({
        provider: "openai",
        model: "gpt-4.1",
        is_active: true,
      }),
    );
    expect(active?.patchOp).toBe("model.set_active");
  });
});

describe("buildSettingsUiSchema — disabled controls explain unavailable support", () => {
  it("disables skill/mcp toggles when settings_patch missing and explains why", () => {
    const schema = buildSettingsUiSchema({
      snapshot: fullSnapshot,
      capabilities: {
        features: {
          settings_snapshot: true,
          models: true,
          cron: true,
        },
        brain_rpc_methods: [
          "settings.snapshot",
          "models.set_active",
          "cron.patch",
        ],
        ui_affordances: {
          settings_page: "supported",
          settings_editor: "unsupported",
          model_selector: "supported",
          cron_manager: "supported",
        },
      },
      ui: {
        can: {
          settings_view: true,
          settings_edit: false,
          model_select: true,
          cron_manage: true,
        },
        affordances: {
          settings_page: "supported",
          settings_editor: "unsupported",
          model_selector: "supported",
          cron_manager: "supported",
        },
      },
    });

    const skills = sectionById(schema, "skills")!;
    expect(skills.availability.interactive).toBe(false);
    const skillToggle = skills.controls.find((c) => c.kind === "skill_toggle")!;
    expect(skillToggle.availability.interactive).toBe(false);
    expect(skillToggle.availability.disabledReason).toMatch(/read-only|settings\.patch/i);
    expect(skillToggle.availability.unavailableCode).toBe("skill_edit_unsupported");

    const banner = skills.controls.find((c) => c.kind === "section_banner");
    expect(banner?.availability.disabledReason).toBeTruthy();

    // Model still interactive via models expansion
    const models = sectionById(schema, "models")!;
    expect(
      models.controls.some(
        (c) => c.kind === "model_activate" && c.availability.interactive,
      ),
    ).toBe(true);

    // Cron still interactive via cron expansion
    const crons = sectionById(schema, "crons")!;
    expect(
      crons.controls.some(
        (c) => c.kind === "cron_toggle" && c.availability.interactive,
      ),
    ).toBe(true);
  });

  it("disables model controls when model_selector unsupported and explains why", () => {
    const schema = buildSettingsUiSchema({
      snapshot: fullSnapshot,
      capabilities: {
        features: {
          settings_snapshot: true,
          settings_patch: true,
        },
        brain_rpc_methods: ["settings.snapshot", "settings.patch"],
        ui_affordances: {
          settings_page: "supported",
          settings_editor: "supported",
          model_selector: "unsupported",
          cron_manager: "unsupported",
        },
      },
      ui: {
        can: {
          settings_view: true,
          settings_edit: true,
          model_select: false,
          cron_manage: false,
        },
        affordances: {
          model_selector: "unsupported",
          cron_manager: "unsupported",
          settings_editor: "supported",
          settings_page: "supported",
        },
      },
    });

    // When settings_edit is true, modelEditIsSupported also returns true
    // because settings.patch covers model.set_active. Force caps-only path:
    const schemaCapsOnly = buildSettingsUiSchema({
      snapshot: fullSnapshot,
      capabilities: {
        features: { settings_snapshot: true },
        brain_rpc_methods: ["settings.snapshot"],
        ui_affordances: {
          settings_page: "supported",
          settings_editor: "unsupported",
          model_selector: "unsupported",
          cron_manager: "unsupported",
        },
      },
    });

    const models = sectionById(schemaCapsOnly, "models")!;
    const modelControl = models.controls.find((c) => c.kind === "model_activate")!;
    expect(modelControl.availability.interactive).toBe(false);
    expect(modelControl.availability.disabledReason).toMatch(
      /Model selection is not available|Models are not supported/i,
    );
    expect(modelControl.availability.unavailableCode).toBe(
      "model_selector_unsupported",
    );

    const crons = sectionById(schemaCapsOnly, "crons")!;
    const cronControl = crons.controls.find((c) => c.kind === "cron_toggle")!;
    expect(cronControl.availability.interactive).toBe(false);
    expect(cronControl.availability.disabledReason).toMatch(
      /Scheduled task management is not fully advertised|not supported/i,
    );

    // Original schema with settings_patch still allows model via patch path
    // (settings.patch advertises model.set_active) — document that behavior:
    const modelsWithPatch = sectionById(schema, "models")!;
    // settings_edit true ⇒ model edit supported via settings.patch
    expect(
      modelsWithPatch.controls.some(
        (c) => c.kind === "model_activate" && c.availability.interactive,
      ),
    ).toBe(true);
  });

  it("disables cron when only snapshot is available", () => {
    const schema = buildSettingsUiSchema({
      snapshot: fullSnapshot,
      capabilities: {
        features: { settings_snapshot: true },
        brain_rpc_methods: ["settings.snapshot"],
      },
    });
    const disabled = disabledControlsWithReason(schema);
    expect(disabled.some((c) => c.kind === "cron_toggle")).toBe(true);
    expect(disabled.some((c) => c.kind === "skill_toggle")).toBe(true);
    expect(disabled.some((c) => c.kind === "model_activate")).toBe(true);
    for (const c of disabled.filter((x) => x.kind.endsWith("_toggle") || x.kind === "model_activate")) {
      expect(c.availability.disabledReason?.length).toBeGreaterThan(10);
    }
  });

  it("shows unavailable page banner when snapshot error is unavailable", () => {
    const schema = buildSettingsUiSchema({
      snapshot: null,
      snapshotError: {
        unavailable: true,
        code: "method_not_found",
        error: "settings.snapshot is not implemented on this host",
      },
      ui: fullUi,
    });
    expect(schema.page.interactive).toBe(false);
    expect(schema.page.disabledReason).toMatch(/not implemented/i);
    expect(schema.page.unavailableCode).toBe("settings_snapshot_unavailable");
    expect(schema.sections.some((s) => (s.id as string) === "overview")).toBe(false);
    const skills = sectionById(schema, "skills")!;
    expect(skills.controls[0]?.kind).toBe("unavailable_banner");
    expect(skills.controls[0]?.availability.disabledReason).toBeTruthy();
  });

  it("marks page non-interactive when settings_page unsupported", () => {
    const schema = buildSettingsUiSchema({
      capabilities: {
        features: {},
        brain_rpc_methods: [],
        ui_affordances: { settings_page: "unsupported" },
      },
      ui: {
        can: { settings_view: false },
        affordances: { settings_page: "unsupported" },
      },
    });
    expect(schema.page.interactive).toBe(false);
    expect(schema.page.disabledReason).toMatch(/settings\.snapshot/i);
  });

  it("uses degraded reason when settings_editor is degraded", () => {
    const schema = buildSettingsUiSchema({
      snapshot: fullSnapshot,
      ui: {
        can: { settings_view: true, settings_edit: false },
        affordances: {
          settings_page: "supported",
          settings_editor: "degraded",
          model_selector: "degraded",
          cron_manager: "degraded",
        },
      },
    });
    const skill = schema.controls.find((c) => c.kind === "skill_toggle")!;
    expect(skill.availability.interactive).toBe(false);
    expect(skill.availability.unavailableCode).toBe("settings_edit_degraded");
    expect(skill.availability.disabledReason).toMatch(/degraded/i);

    const model = schema.controls.find((c) => c.kind === "model_activate")!;
    expect(model.availability.unavailableCode).toBe("model_selector_degraded");
  });
});

describe("empty sections", () => {
  it("emits empty_state controls when snapshot lists are empty", () => {
    const schema = buildSettingsUiSchema({
      snapshot: {
        exported_at: "2026-07-12T00:00:00.000Z",
        source: "none",
        skills: [],
        crons: [],
        mcp_servers: [],
        models: [],
        integrations: [],
      },
      ui: fullUi,
    });
    expect(kinds(schema).filter((k) => k === "empty_state").length).toBeGreaterThanOrEqual(4);
    const skills = sectionById(schema, "skills")!;
    expect(skills.entityCount).toBe(0);
    expect(skills.controls[0]?.kind).toBe("empty_state");
    expect(skills.controls[0]?.availability.disabledReason).toMatch(/No skills/i);
  });
});

describe("section visibility (grill Q10 hide unsupported)", () => {
  const skillsOnlySnapshot: SettingsSnapshotLike = {
    exported_at: "2026-07-12T00:00:00.000Z",
    source: "brain_rpc",
    skills: [
      { id: "summarize", name: "Summarize", enabled: true },
    ],
    crons: [],
    mcp_servers: [],
    models: [],
    integrations: [],
  };

  const skillsOnlyUi: PortalUiStateLike = {
    affordances: {
      settings_page: "supported",
      settings_editor: "supported",
      model_selector: "unsupported",
      cron_manager: "unsupported",
      host_health: "unsupported",
    },
    can: {
      settings_view: true,
      settings_edit: true,
      model_select: false,
      cron_manage: false,
      host_health: false,
    },
  };

  const skillsOnlyCaps: CapabilityInput = {
    features: {
      settings_snapshot: true,
      settings_patch: true,
      models: false,
      cron: false,
      health: false,
    },
    brain_rpc_methods: ["settings.snapshot", "settings.patch"],
    ui_affordances: {
      settings_page: "supported",
      settings_editor: "supported",
      model_selector: "unsupported",
      cron_manager: "unsupported",
      host_health: "unsupported",
    },
  };

  it("shows Tools inventory sections when no capability context (offline fixture)", () => {
    const schema = buildSettingsUiSchema({ snapshot: fullSnapshot });
    const ids = visibleSections(schema).map((s) => s.id);
    // lp-xhf4.4: Connectors catalog + Models/Workflows. Skills/MCP/Integrations
    // are nested on the catalog, not rail tabs. lp-lv9.6: no crons.
    expect(ids).toEqual(["connectors", "workflows", "models"]);
    expect(ids).not.toContain("overview");
    expect(ids).not.toContain("crons");
    expect(ids).not.toContain("skills");
    expect(ids).not.toContain("mcp");
    expect(ids).not.toContain("integrations");
    // Schema still emits crons for Agents / control maps.
    expect(sectionById(schema, "crons")).toBeTruthy();
  });

  it("HL full capabilities still show Tools inventory (no crons nav)", () => {
    const schema = buildSettingsUiSchema({
      snapshot: fullSnapshot,
      capabilities: fullCaps,
      ui: fullUi,
    });
    const ids = visibleSections(schema).map((s) => s.id);
    expect(ids).not.toContain("overview");
    expect(ids).toContain("connectors");
    expect(ids).toContain("workflows");
    expect(ids).not.toContain("crons"); // lp-lv9.6
    expect(ids).not.toContain("skills");
    expect(ids).not.toContain("mcp");
    expect(ids).toContain("models");
    expect(ids).not.toContain("integrations");
    for (const id of ids) {
      expect(sectionById(schema, id)?.availability.visible).toBe(true);
    }
    // Cron section still present for Agents consumers.
    expect(sectionById(schema, "crons")?.availability.visible).toBe(true);
  });

  it("partial skills-only capabilities hide models, crons, integrations", () => {
    const schema = buildSettingsUiSchema({
      snapshot: skillsOnlySnapshot,
      capabilities: skillsOnlyCaps,
      ui: skillsOnlyUi,
    });
    const ids = visibleSections(schema).map((s) => s.id);
    expect(ids).not.toContain("overview");
    expect(ids).toContain("connectors");
    expect(ids).not.toContain("skills");
    expect(ids).toContain("workflows"); // settings_page / empty array surface
    expect(ids).not.toContain("mcp");
    expect(ids).not.toContain("models");
    expect(ids).not.toContain("crons");
    expect(ids).not.toContain("integrations");
    expect(sectionById(schema, "models")?.availability.visible).toBe(false);
    expect(sectionById(schema, "crons")?.availability.visible).toBe(false);
    expect(sectionById(schema, "models")?.controls).toHaveLength(0);
  });

  it("visibleSections never includes crons even when cron section is capability-visible (lp-lv9.6)", () => {
    const schema = buildSettingsUiSchema({
      snapshot: fullSnapshot,
      capabilities: fullCaps,
      ui: fullUi,
    });
    expect(sectionIsVisible("crons", fullUi, fullCaps, fullSnapshot)).toBe(true);
    expect(sectionById(schema, "crons")?.availability.visible).toBe(true);
    expect(visibleSections(schema).map((s) => s.id)).not.toContain("crons");
  });

  it("workflows section lists snapshot defs and empty state (lp-vnz.5)", () => {
    const withDefs = buildSettingsUiSchema({
      snapshot: fullSnapshot,
      capabilities: fullCaps,
      ui: fullUi,
    });
    const workflows = sectionById(withDefs, "workflows");
    expect(workflows?.entityCount).toBe(1);
    expect(workflows?.controls.some((c) => c.id === "workflow:fizzbuzz-algorithm-test-report")).toBe(
      true,
    );

    const empty = buildSettingsUiSchema({
      snapshot: { ...fullSnapshot, workflows: [] },
      capabilities: fullCaps,
      ui: fullUi,
    });
    expect(sectionById(empty, "workflows")?.controls[0]?.kind).toBe("empty_state");
    expect(sectionIsVisible("workflows", fullUi, fullCaps, { ...fullSnapshot, workflows: [] })).toBe(
      true,
    );
  });

  it("shows models/crons when snapshot has data even if affordance unsupported", () => {
    expect(
      sectionIsVisible("models", skillsOnlyUi, skillsOnlyCaps, fullSnapshot),
    ).toBe(true);
    expect(
      sectionIsVisible("crons", skillsOnlyUi, skillsOnlyCaps, fullSnapshot),
    ).toBe(true);
  });
});

describe("disabledReasonMessage catalog", () => {
  it("has copy for all settings unavailable codes used by gates", () => {
    for (const code of [
      "settings_page_unsupported",
      "settings_snapshot_unavailable",
      "settings_edit_unsupported",
      "model_selector_unsupported",
      "cron_manager_unsupported",
      "skill_edit_unsupported",
      "mcp_edit_unsupported",
    ] as const) {
      const msg = disabledReasonMessage(code);
      expect(msg.length).toBeGreaterThan(20);
      expect(msg.toLowerCase()).not.toMatch(/hermes_home\/config/);
    }
  });
});

describe("page.backendHome prefers backend_home", () => {
  it("falls back to hermes_home when backend_home missing", () => {
    const schema = buildSettingsUiSchema({
      snapshot: {
        exported_at: "2026-07-12T00:00:00.000Z",
        source: "hermes",
        hermes_home: "/legacy/hermes",
      },
      ui: fullUi,
    });
    expect(schema.page.backendHome).toBe("/legacy/hermes");
    // Overview section removed (lp-fn5.1.4); home lives only on page descriptor.
    expect(schema.controls.find((c) => c.id === "overview:backend_home")).toBeUndefined();
    expect(schema.sections.some((s) => (s.id as string) === "overview")).toBe(false);
  });
});

/**
 * Capability-driven UI states (lp-k7g.8.8).
 * Proves web settings descriptors react to backend capability profiles
 * (full Hermes-Lanyard-like vs minimal required-only / Lanyard Agent-like)
 * without Hermes-specific conditionals.
 */
describe("capability-driven UI states (backend profiles)", () => {
  /** Full host: required methods + settings_patch + models + cron. */
  const fullProfileCaps: CapabilityInput = {
    features: {
      settings_snapshot: true,
      settings_patch: true,
      models: true,
      cron: true,
      vault_read: true,
      projects_list: true,
    },
    brain_rpc_methods: [
      "brain.ping",
      "brain.health",
      "vault.list",
      "vault.stat",
      "vault.read",
      "settings.snapshot",
      "settings.patch",
      "projects.list",
    ],
    ui_affordances: {
      settings_page: "supported",
      settings_editor: "supported",
      model_selector: "supported",
      cron_manager: "supported",
    },
  };

  const fullProfileUi: PortalUiStateLike = {
    affordances: {
      settings_page: "supported",
      settings_editor: "supported",
      model_selector: "supported",
      cron_manager: "supported",
    },
    can: {
      settings_view: true,
      settings_edit: true,
      model_select: true,
      cron_manage: true,
    },
  };

  /** Minimal host: required methods only (no patch / models / cron). */
  const minimalProfileCaps: CapabilityInput = {
    features: {
      settings_snapshot: true,
      settings_patch: false,
      models: false,
      cron: false,
      vault_read: true,
      projects_list: true,
    },
    brain_rpc_methods: [
      "brain.ping",
      "brain.health",
      "vault.list",
      "vault.stat",
      "vault.read",
      "settings.snapshot",
      "projects.list",
    ],
    ui_affordances: {
      settings_page: "supported",
      settings_editor: "unsupported",
      model_selector: "unsupported",
      cron_manager: "unsupported",
    },
  };

  const minimalProfileUi: PortalUiStateLike = {
    affordances: {
      settings_page: "supported",
      settings_editor: "unsupported",
      model_selector: "unsupported",
      cron_manager: "unsupported",
    },
    can: {
      settings_view: true,
      settings_edit: false,
      model_select: false,
      cron_manage: false,
    },
  };

  it("full profile: model/skills/cron controls are interactive", () => {
    const schema = buildSettingsUiSchema({
      snapshot: fullSnapshot,
      capabilities: fullProfileCaps,
      ui: fullProfileUi,
    });
    expect(schema.page.interactive).toBe(true);
    expect(settingsViewIsSupported(fullProfileUi, fullProfileCaps)).toBe(true);
    expect(settingsEditIsSupported(fullProfileUi, fullProfileCaps)).toBe(true);
    expect(modelEditIsSupported(fullProfileUi, fullProfileCaps)).toBe(true);
    expect(cronEditIsSupported(fullProfileUi, fullProfileCaps)).toBe(true);

    const interactive = interactiveControls(schema);
    expect(interactive.some((c) => c.kind === "model_activate")).toBe(true);
    expect(interactive.some((c) => c.kind === "skill_toggle")).toBe(true);
    expect(interactive.some((c) => c.kind === "cron_toggle")).toBe(true);
    expect(disabledControlsWithReason(schema).filter((c) =>
      c.kind === "model_activate" ||
      c.kind === "skill_toggle" ||
      c.kind === "cron_toggle"
    )).toHaveLength(0);
  });

  it("minimal profile: page readable but all edit controls disabled with reasons", () => {
    const schema = buildSettingsUiSchema({
      snapshot: fullSnapshot,
      capabilities: minimalProfileCaps,
      ui: minimalProfileUi,
    });
    expect(schema.page.interactive).toBe(true); // view still works
    expect(settingsViewIsSupported(minimalProfileUi, minimalProfileCaps)).toBe(
      true,
    );
    expect(settingsEditIsSupported(minimalProfileUi, minimalProfileCaps)).toBe(
      false,
    );
    expect(modelEditIsSupported(minimalProfileUi, minimalProfileCaps)).toBe(
      false,
    );
    expect(cronEditIsSupported(minimalProfileUi, minimalProfileCaps)).toBe(
      false,
    );

    const disabled = disabledControlsWithReason(schema);
    expect(disabled.some((c) => c.kind === "skill_toggle")).toBe(true);
    expect(disabled.some((c) => c.kind === "model_activate")).toBe(true);
    expect(disabled.some((c) => c.kind === "cron_toggle")).toBe(true);
    expect(disabled.some((c) => c.kind === "mcp_toggle")).toBe(true);

    for (const c of disabled.filter(
      (x) =>
        x.kind === "skill_toggle" ||
        x.kind === "model_activate" ||
        x.kind === "cron_toggle" ||
        x.kind === "mcp_toggle",
    )) {
      expect(c.availability.interactive).toBe(false);
      expect(c.availability.disabledReason?.length).toBeGreaterThan(10);
      expect(c.availability.unavailableCode).toBeTruthy();
    }

    // Snapshot entities still present for display (read-only)
    expect(sectionById(schema, "skills")?.entityCount).toBe(2);
    expect(sectionById(schema, "models")?.entityCount).toBe(2);
  });

  it("switches interactive → disabled when capability profile drops settings_patch", () => {
    const withPatch = buildSettingsUiSchema({
      snapshot: fullSnapshot,
      capabilities: fullProfileCaps,
      ui: fullProfileUi,
    });
    const withoutPatch = buildSettingsUiSchema({
      snapshot: fullSnapshot,
      capabilities: minimalProfileCaps,
      ui: minimalProfileUi,
    });

    expect(
      interactiveControls(withPatch).some((c) => c.kind === "skill_toggle"),
    ).toBe(true);
    expect(
      interactiveControls(withoutPatch).some((c) => c.kind === "skill_toggle"),
    ).toBe(false);
    expect(
      disabledControlsWithReason(withoutPatch).some(
        (c) => c.kind === "skill_toggle",
      ),
    ).toBe(true);
  });

  it("does not branch on backend_kind — only capabilities/ui drive state", () => {
    // CapabilityInput has no kind field; gates use features/methods/ui only.
    // Two hosts with identical capability surfaces must render the same UI.
    const hostA = buildSettingsUiSchema({
      snapshot: fullSnapshot,
      capabilities: minimalProfileCaps,
      ui: minimalProfileUi,
    });
    const hostB = buildSettingsUiSchema({
      snapshot: fullSnapshot,
      capabilities: { ...minimalProfileCaps },
      ui: { ...minimalProfileUi },
    });

    const skillsA = sectionById(hostA, "skills")!;
    const skillsB = sectionById(hostB, "skills")!;
    expect(skillsA.availability.interactive).toBe(
      skillsB.availability.interactive,
    );
    expect(
      skillsA.controls.find((c) => c.kind === "skill_toggle")
        ?.availability.unavailableCode,
    ).toBe(
      skillsB.controls.find((c) => c.kind === "skill_toggle")
        ?.availability.unavailableCode,
    );
    // Neither host invents Hermes-specific copy in disabled reasons
    const reason = skillsA.controls.find((c) => c.kind === "skill_toggle")
      ?.availability.disabledReason;
    expect(reason?.toLowerCase()).not.toMatch(/hermes_home\/config/);
  });
});
