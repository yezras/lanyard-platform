/**
 * Pure mappers: settings.snapshot + capabilities + config.schema categories
 * → UI control descriptors for Portal web settings.
 *
 * Bead: `lp-k7g.8.6` — update web settings UI to use backend schema.
 */

import {
  CONFIG_CATEGORY_CATALOG,
  SECTION_LABELS,
  SETTINGS_SECTION_ORDER,
  catalogEntryForSection,
} from "./catalog.js";
import {
  gateForCategory,
  sectionIsVisible,
  settingsViewIsSupported,
} from "./capabilities.js";
import {
  disabledReasonMessage,
  reasonFromSnapshotError,
} from "./reasons.js";
import type {
  BuildSettingsUiSchemaInput,
  ConfigSchemaCategory,
  ControlAvailability,
  SettingsControlDescriptor,
  SettingsCronLike,
  SettingsMcpServerLike,
  SettingsModelLike,
  SettingsPageDescriptor,
  SettingsSectionDescriptor,
  SettingsSectionId,
  SettingsSkillLike,
  SettingsSnapshotLike,
  SettingsUiSchema,
} from "./types.js";
import { CONFIG_SCHEMA_CATEGORIES } from "./types.js";

function backendHomeOf(snapshot: SettingsSnapshotLike): string | null {
  if (snapshot.backend_home != null && snapshot.backend_home !== "") {
    return snapshot.backend_home;
  }
  if (snapshot.hermes_home != null && snapshot.hermes_home !== "") {
    return snapshot.hermes_home;
  }
  return null;
}

function emptyAvailability(reason?: string): ControlAvailability {
  return {
    interactive: false,
    visible: true,
    unavailableCode: "empty_section",
    disabledReason: reason ?? disabledReasonMessage("empty_section"),
  };
}

function buildSkillControls(
  skills: SettingsSkillLike[],
  edit: ControlAvailability,
): SettingsControlDescriptor[] {
  if (skills.length === 0) {
    return [
      {
        id: "skills:empty",
        section: "skills",
        configCategory: "skills",
        kind: "empty_state",
        label: "Skills",
        availability: emptyAvailability("No skills in this snapshot."),
      },
    ];
  }
  return skills.map((skill) => {
    const availability: ControlAvailability = edit.interactive
      ? { interactive: true, visible: true }
      : {
          interactive: false,
          visible: true,
          unavailableCode: edit.unavailableCode ?? "skill_edit_unsupported",
          disabledReason:
            edit.disabledReason ??
            disabledReasonMessage("skill_edit_unsupported"),
        };
    return {
      id: `skill:${skill.id}`,
      section: "skills" as const,
      configCategory: "skills" as const,
      kind: "skill_toggle" as const,
      label: skill.name || skill.id,
      description: skill.path,
      availability,
      patchOp: "skill.set_enabled" as const,
      skill,
    };
  });
}

function buildCronControls(
  crons: SettingsCronLike[],
  edit: ControlAvailability,
): SettingsControlDescriptor[] {
  if (crons.length === 0) {
    return [
      {
        id: "crons:empty",
        section: "crons",
        configCategory: "cron",
        kind: "empty_state",
        label: "Scheduled tasks",
        availability: emptyAvailability("No scheduled tasks in this snapshot."),
      },
    ];
  }
  return crons.map((cron) => {
    const availability: ControlAvailability = edit.interactive
      ? { interactive: true, visible: true }
      : {
          interactive: false,
          visible: true,
          unavailableCode: edit.unavailableCode ?? "cron_manager_unsupported",
          disabledReason:
            edit.disabledReason ??
            disabledReasonMessage("cron_manager_unsupported"),
        };
    return {
      id: `cron:${cron.id}`,
      section: "crons" as const,
      configCategory: "cron" as const,
      kind: "cron_toggle" as const,
      label: cron.name || cron.id,
      description: cron.schedule,
      availability,
      patchOp: "cron.set_enabled" as const,
      cron,
    };
  });
}

function buildMcpControls(
  servers: SettingsMcpServerLike[],
  edit: ControlAvailability,
): SettingsControlDescriptor[] {
  if (servers.length === 0) {
    return [
      {
        id: "mcp:empty",
        section: "mcp",
        configCategory: "mcp_servers",
        kind: "empty_state",
        label: "MCP servers",
        availability: emptyAvailability("No MCP servers in this snapshot."),
      },
    ];
  }
  return servers.map((mcp) => {
    const availability: ControlAvailability = edit.interactive
      ? { interactive: true, visible: true }
      : {
          interactive: false,
          visible: true,
          unavailableCode: edit.unavailableCode ?? "mcp_edit_unsupported",
          disabledReason:
            edit.disabledReason ??
            disabledReasonMessage("mcp_edit_unsupported"),
        };
    return {
      id: `mcp:${mcp.name}`,
      section: "mcp" as const,
      configCategory: "mcp_servers" as const,
      kind: "mcp_toggle" as const,
      label: mcp.name,
      description: mcp.transport ?? mcp.command,
      availability,
      patchOp: "mcp.set_enabled" as const,
      mcp,
    };
  });
}

function buildModelControls(
  models: SettingsModelLike[],
  edit: ControlAvailability,
): SettingsControlDescriptor[] {
  if (models.length === 0) {
    return [
      {
        id: "models:empty",
        section: "models",
        configCategory: "model",
        kind: "empty_state",
        label: "Models",
        availability: emptyAvailability("No models in this snapshot."),
      },
    ];
  }
  return models.map((model, index) => {
    const key = `${model.provider}::${model.model}`;
    const availability: ControlAvailability = edit.interactive
      ? { interactive: true, visible: true }
      : {
          interactive: false,
          visible: true,
          unavailableCode: edit.unavailableCode ?? "model_selector_unsupported",
          disabledReason:
            edit.disabledReason ??
            disabledReasonMessage("model_selector_unsupported"),
        };
    return {
      id: `model:${key}:${index}`,
      section: "models" as const,
      configCategory: "model" as const,
      kind: "model_activate" as const,
      label: model.model,
      description: model.provider,
      availability,
      patchOp: "model.set_active" as const,
      model,
    };
  });
}

function buildIntegrationsControls(
  snapshot: SettingsSnapshotLike | null | undefined,
): SettingsControlDescriptor[] {
  const integrations = snapshot?.integrations ?? [];
  if (integrations.length === 0) {
    return [
      {
        id: "integrations:empty",
        section: "integrations",
        kind: "empty_state",
        label: "Integrations",
        availability: emptyAvailability("No integrations in this snapshot."),
      },
    ];
  }
  return integrations.map((item) => ({
    id: `integration:${item.id}`,
    section: "integrations" as const,
    kind: "readonly_field" as const,
    label: item.name || item.id,
    description: item.type ?? item.bin ?? item.path,
    availability: { interactive: false, visible: true },
    value: item.id,
  }));
}

function buildWorkflowsControls(
  snapshot: SettingsSnapshotLike | null | undefined,
): SettingsControlDescriptor[] {
  const workflows = snapshot?.workflows ?? [];
  if (workflows.length === 0) {
    return [
      {
        id: "workflows:empty",
        section: "workflows",
        kind: "empty_state",
        label: "Workflows",
        availability: emptyAvailability("No workflows in this snapshot."),
      },
    ];
  }
  return workflows.map((item) => ({
    id: `workflow:${item.id}`,
    section: "workflows" as const,
    kind: "readonly_field" as const,
    label: item.name || item.id,
    description: item.path ?? item.description,
    availability: { interactive: false, visible: true },
    value: item.id,
  }));
}

function sectionFromCategory(
  category: ConfigSchemaCategory,
  snapshot: SettingsSnapshotLike | null | undefined,
  edit: ControlAvailability,
  pageOk: boolean,
): SettingsSectionDescriptor {
  const entry = CONFIG_CATEGORY_CATALOG[category];
  const section = entry.section;

  // Page-level failure → section banner, no entity controls.
  if (!pageOk || !snapshot) {
    const banner: SettingsControlDescriptor = {
      id: `${section}:unavailable`,
      section,
      configCategory: category,
      kind: "unavailable_banner",
      label: entry.label,
      availability: {
        interactive: false,
        visible: true,
        unavailableCode: edit.unavailableCode ?? "settings_snapshot_missing",
        disabledReason:
          edit.disabledReason ??
          disabledReasonMessage("settings_snapshot_missing"),
      },
    };
    return {
      id: section,
      label: entry.label,
      configCategory: category,
      description: entry.description,
      schemaPath: entry.schemaPath,
      availability: {
        interactive: false,
        visible: true,
        unavailableCode: banner.availability.unavailableCode,
        disabledReason: banner.availability.disabledReason,
      },
      controls: [banner],
      entityCount: 0,
    };
  }

  let controls: SettingsControlDescriptor[];
  let entityCount: number;
  switch (category) {
    case "skills": {
      const skills = snapshot.skills ?? [];
      entityCount = skills.length;
      controls = buildSkillControls(skills, edit);
      break;
    }
    case "cron": {
      const crons = snapshot.crons ?? [];
      entityCount = crons.length;
      controls = buildCronControls(crons, edit);
      break;
    }
    case "mcp_servers": {
      const servers = snapshot.mcp_servers ?? [];
      entityCount = servers.length;
      controls = buildMcpControls(servers, edit);
      break;
    }
    case "model": {
      const models = snapshot.models ?? [];
      entityCount = models.length;
      controls = buildModelControls(models, edit);
      break;
    }
  }

  // Section-level availability: interactive only if at least one control is.
  const anyInteractive = controls.some((c) => c.availability.interactive);
  const sectionAvailability: ControlAvailability = anyInteractive
    ? { interactive: true, visible: true }
    : {
        interactive: false,
        visible: true,
        unavailableCode: edit.unavailableCode,
        disabledReason: edit.disabledReason,
      };

  // If the only issue is empty entities, use empty-section reason at section level.
  if (entityCount === 0 && !edit.unavailableCode) {
    sectionAvailability.unavailableCode = "empty_section";
    sectionAvailability.disabledReason = disabledReasonMessage("empty_section");
  }

  // When edit is blocked, ensure section carries the disabled reason even if
  // entities exist (controls already do; section banner for UI headers).
  if (!edit.interactive && entityCount > 0) {
    const banner: SettingsControlDescriptor = {
      id: `${section}:edit_disabled`,
      section,
      configCategory: category,
      kind: "section_banner",
      label: `${entry.label} (read-only)`,
      description: edit.disabledReason,
      availability: {
        interactive: false,
        visible: true,
        unavailableCode: edit.unavailableCode,
        disabledReason: edit.disabledReason,
      },
    };
    controls = [banner, ...controls];
  }

  return {
    id: section,
    label: entry.label,
    configCategory: category,
    description: entry.description,
    schemaPath: entry.schemaPath,
    availability: sectionAvailability,
    controls,
    entityCount,
  };
}

/**
 * Build the full settings UI schema from snapshot + capabilities.
 *
 * Pure: no I/O, no React. Web maps descriptors to tables/toggles.
 */
export function buildSettingsUiSchema(
  input: BuildSettingsUiSchemaInput = {},
): SettingsUiSchema {
  const { snapshot, capabilities, ui, snapshotError } = input;

  const viewOk = settingsViewIsSupported(ui, capabilities);
  const hasSnapshot = Boolean(snapshot && snapshot.exported_at);
  const hasExplicitSnapshotError = Boolean(
    snapshotError?.unavailable ||
      (snapshotError &&
        (snapshotError.error || snapshotError.message || snapshotError.code)),
  );

  let page: SettingsPageDescriptor;
  // Priority: explicit snapshot/RPC error → settings page unsupported →
  // missing snapshot → interactive page.
  if (hasExplicitSnapshotError && !hasSnapshot) {
    page = {
      title: "Settings",
      interactive: false,
      visible: true,
      unavailableCode: "settings_snapshot_unavailable",
      disabledReason: reasonFromSnapshotError(
        snapshotError,
        "settings_snapshot_unavailable",
      ),
      source: snapshot?.source,
      exportedAt: snapshot?.exported_at,
      backendHome: snapshot ? backendHomeOf(snapshot) : null,
    };
  } else if (!viewOk) {
    page = {
      title: "Settings",
      interactive: false,
      visible: true,
      unavailableCode: "settings_page_unsupported",
      disabledReason: disabledReasonMessage("settings_page_unsupported"),
      source: snapshot?.source,
      exportedAt: snapshot?.exported_at,
      backendHome: snapshot ? backendHomeOf(snapshot) : null,
    };
  } else if (!hasSnapshot) {
    page = {
      title: "Settings",
      interactive: false,
      visible: true,
      unavailableCode: "settings_snapshot_missing",
      disabledReason: disabledReasonMessage("settings_snapshot_missing"),
    };
  } else {
    page = {
      title: "Settings",
      interactive: true,
      visible: true,
      source: snapshot!.source,
      exportedAt: snapshot!.exported_at,
      backendHome: backendHomeOf(snapshot!),
    };
  }

  const pageOk = page.interactive && hasSnapshot;

  // Per-category edit gates (model / skills / cron / mcp).
  const gates = {
    model: gateForCategory("model", ui, capabilities),
    skills: gateForCategory("skills", ui, capabilities),
    cron: gateForCategory("cron", ui, capabilities),
    mcp_servers: gateForCategory("mcp_servers", ui, capabilities),
  };

  // When page itself is not ok, force non-interactive edit availability
  // with page-level reason so controls explain why.
  const pageBlockedAvailability = (base: ControlAvailability): ControlAvailability => {
    if (pageOk) return base;
    return {
      interactive: false,
      visible: true,
      unavailableCode: page.unavailableCode ?? "settings_snapshot_missing",
      disabledReason:
        page.disabledReason ??
        disabledReasonMessage("settings_snapshot_missing"),
    };
  };

  const sections: SettingsSectionDescriptor[] = [];

  for (const sectionId of SETTINGS_SECTION_ORDER) {
    // Grill Q10: hide sections the host does not support (no nav clutter).
    const visible = sectionIsVisible(sectionId, ui, capabilities, snapshot);

    if (sectionId === "connectors") {
      sections.push({
        id: "connectors",
        label: SECTION_LABELS.connectors,
        description:
          "SaaS connectors and unbound host tools on this brain. Models stay on their own rail.",
        availability: {
          interactive: true,
          visible,
        },
        controls: [],
        entityCount: 0,
      });
      continue;
    }

    if (sectionId === "integrations") {
      const controls = buildIntegrationsControls(snapshot);
      sections.push({
        id: "integrations",
        label: SECTION_LABELS.integrations,
        description:
          "Discovered integrations (snapshot-only; not a config.schema settings patch surface).",
        availability: {
          interactive: false,
          visible,
        },
        controls: visible ? controls : [],
        entityCount: snapshot?.integrations?.length ?? 0,
      });
      continue;
    }

    if (sectionId === "workflows") {
      const controls = buildWorkflowsControls(snapshot);
      sections.push({
        id: "workflows",
        label: SECTION_LABELS.workflows,
        description:
          "User-created workflow definitions (settings.snapshot.workflows; not a config.schema patch surface).",
        availability: {
          interactive: false,
          visible,
        },
        controls: visible ? controls : [],
        entityCount: snapshot?.workflows?.length ?? 0,
      });
      continue;
    }

    const entry = catalogEntryForSection(sectionId);
    if (!entry) continue;
    const gate = gates[entry.category];
    const edit = pageBlockedAvailability(gate.availability);
    const section = sectionFromCategory(entry.category, snapshot, edit, pageOk);
    // Override section visibility from Q10 gate (entity controls stay for
    // visible sections; hidden sections keep empty controls for tests).
    sections.push({
      ...section,
      availability: {
        ...section.availability,
        visible,
      },
      controls: visible ? section.controls : [],
    });
  }

  const controls = sections.flatMap((s) => s.controls);

  return { page, sections, controls };
}

/**
 * Sections the Connectors / Settings rail should render.
 *
 * Filters `availability.visible !== false` and omits:
 * - `crons`: scheduled ops live under Agents (lp-lv9.6)
 * - `skills`, `mcp`, `integrations`: nested on the Connectors catalog
 *   (lp-xhf4.4), not top-level tabs
 *
 * Full schema still emits those section descriptors for control maps /
 * sectionById.
 */
const RAIL_HIDDEN_SECTIONS = new Set<SettingsSectionId>([
  "crons",
  "skills",
  "mcp",
  "integrations",
]);

export function visibleSections(
  schema: SettingsUiSchema,
): SettingsSectionDescriptor[] {
  return schema.sections.filter(
    (s) =>
      s.availability.visible !== false && !RAIL_HIDDEN_SECTIONS.has(s.id),
  );
}

/**
 * Controls for a single schema-backed category (model / skills / cron / mcp).
 * Useful when a settings panel only re-renders one section.
 */
export function buildCategoryControls(
  category: ConfigSchemaCategory,
  input: BuildSettingsUiSchemaInput = {},
): SettingsSectionDescriptor {
  const full = buildSettingsUiSchema(input);
  const entry = CONFIG_CATEGORY_CATALOG[category];
  const found = full.sections.find((s) => s.id === entry.section);
  if (found) return found;
  // Should not happen — build always emits schema-backed sections.
  return {
    id: entry.section,
    label: entry.label,
    configCategory: category,
    description: entry.description,
    schemaPath: entry.schemaPath,
    availability: {
      interactive: false,
      visible: true,
      unavailableCode: "settings_snapshot_missing",
      disabledReason: disabledReasonMessage("settings_snapshot_missing"),
    },
    controls: [],
    entityCount: 0,
  };
}

/**
 * List interactive controls only (patchable toggles / model activate).
 */
export function interactiveControls(
  schema: SettingsUiSchema,
): SettingsControlDescriptor[] {
  return schema.controls.filter((c) => c.availability.interactive);
}

/**
 * List controls that are visible but non-interactive with a disabled reason.
 */
export function disabledControlsWithReason(
  schema: SettingsUiSchema,
): SettingsControlDescriptor[] {
  return schema.controls.filter(
    (c) =>
      c.availability.visible &&
      !c.availability.interactive &&
      Boolean(c.availability.disabledReason),
  );
}

/**
 * Find a section by id.
 */
export function sectionById(
  schema: SettingsUiSchema,
  id: SettingsSectionId,
): SettingsSectionDescriptor | undefined {
  return schema.sections.find((s) => s.id === id);
}

/** Categories this package maps from config.schema.json. */
export function schemaBackedCategories(): readonly ConfigSchemaCategory[] {
  return CONFIG_SCHEMA_CATEGORIES;
}
