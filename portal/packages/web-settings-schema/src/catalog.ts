/**
 * Config.schema.json category catalog for Portal settings sections.
 *
 * Maps backend config surfaces → UI sections → patch ops → affordances.
 * Source of truth for "display through backend schema" (not Hermes labels).
 */

import type {
  ConfigSchemaCategory,
  SettingsPatchOp,
  SettingsSectionId,
} from "./types.js";
import { CONFIG_SCHEMA_CATEGORIES } from "./types.js";

/** Affordance names from capabilities.schema.json x-lanyard-ui-affordance-catalog. */
export type SettingsAffordanceName =
  | "settings_page"
  | "settings_editor"
  | "model_selector"
  | "cron_manager";

export type ConfigCategoryCatalogEntry = {
  /** config.schema.json property key. */
  category: ConfigSchemaCategory;
  /** SettingsView section id. */
  section: SettingsSectionId;
  /** Nav / heading label (backend-neutral). */
  label: string;
  /** Short description aligned with config.schema.json. */
  description: string;
  /** JSON Schema path for docs / debug. */
  schemaPath: string;
  /** $defs name when applicable. */
  schemaDef?: string;
  /** settings.snapshot field that lists entities for this category. */
  snapshotField: "models" | "skills" | "crons" | "mcp_servers";
  /** settings.patch ops that mutate this surface. */
  patchOps: readonly SettingsPatchOp[];
  /**
   * Primary UI affordance that gates **view** of interactive editors.
   * skills/mcp use settings_editor; model/cron have dedicated affordances
   * that may be satisfied via settings.patch or expansion methods.
   */
  editAffordance: SettingsAffordanceName;
  /** Feature flag(s) that also enable edit (OR with settings_patch). */
  editFeaturesAnyOf: readonly string[];
  /** Brain RPC methods that also enable edit (OR). */
  editMethodsAnyOf: readonly string[];
};

/**
 * Normative mapping for schema-backed settings sections.
 * integrations are portal chrome and are not listed here.
 */
export const CONFIG_CATEGORY_CATALOG: Record<
  ConfigSchemaCategory,
  ConfigCategoryCatalogEntry
> = {
  model: {
    category: "model",
    section: "models",
    label: "Models",
    description:
      "Active chat model (config.model / modelSettings: provider + default).",
    schemaPath: "properties.model",
    schemaDef: "modelSettings",
    snapshotField: "models",
    patchOps: ["model.set_active"],
    editAffordance: "model_selector",
    editFeaturesAnyOf: ["settings_patch", "models"],
    editMethodsAnyOf: ["settings.patch", "models.set_active"],
  },
  skills: {
    category: "skills",
    section: "skills",
    label: "Skills",
    description:
      "Skill packages and disabled list (config.skills / skillsSettings.disabled).",
    schemaPath: "properties.skills",
    schemaDef: "skillsSettings",
    snapshotField: "skills",
    patchOps: ["skill.set_enabled"],
    editAffordance: "settings_editor",
    editFeaturesAnyOf: ["settings_patch"],
    editMethodsAnyOf: ["settings.patch"],
  },
  cron: {
    category: "cron",
    section: "crons",
    // User-facing label (lp-jzl.4 / D1): Scheduled tasks — not "Crons".
    label: "Scheduled tasks",
    description:
      "Scheduled tasks (product store under BACKEND_HOME). List/toggle via settings.patch; full create/update when features.cron or cron.patch is advertised (lp-jzl.3).",
    schemaPath: "properties.cron",
    schemaDef: "cronSettings",
    snapshotField: "crons",
    patchOps: ["cron.set_enabled", "cron.create", "cron.update"],
    editAffordance: "cron_manager",
    editFeaturesAnyOf: ["settings_patch", "cron"],
    editMethodsAnyOf: ["settings.patch", "cron.patch"],
  },
  mcp_servers: {
    category: "mcp_servers",
    section: "mcp",
    label: "MCP servers",
    description:
      "MCP server definitions (config.mcp_servers[name].enabled).",
    schemaPath: "properties.mcp_servers",
    snapshotField: "mcp_servers",
    patchOps: ["mcp.set_enabled"],
    editAffordance: "settings_editor",
    editFeaturesAnyOf: ["settings_patch"],
    editMethodsAnyOf: ["settings.patch"],
  },
};

/** Ordered list of schema-backed sections for nav / render. */
export const SCHEMA_BACKED_SECTION_ORDER: readonly ConfigSchemaCategory[] =
  CONFIG_SCHEMA_CATEGORIES;

/** Full settings rail order including portal chrome (no Overview — lp-fn5.1.4). */
export const SETTINGS_SECTION_ORDER: readonly SettingsSectionId[] = [
  "connectors",
  "workflows",
  "crons",
  "models",
  "skills",
  "mcp",
  "integrations",
] as const;

export const SECTION_LABELS: Record<SettingsSectionId, string> = {
  connectors: "Connectors",
  skills: CONFIG_CATEGORY_CATALOG.skills.label,
  workflows: "Workflows",
  crons: CONFIG_CATEGORY_CATALOG.cron.label,
  mcp: CONFIG_CATEGORY_CATALOG.mcp_servers.label,
  models: CONFIG_CATEGORY_CATALOG.model.label,
  integrations: "Integrations",
};

/**
 * Resolve catalog entry for a settings section id (if schema-backed).
 */
export function catalogEntryForSection(
  section: SettingsSectionId,
): ConfigCategoryCatalogEntry | undefined {
  for (const cat of CONFIG_SCHEMA_CATEGORIES) {
    const entry = CONFIG_CATEGORY_CATALOG[cat];
    if (entry.section === section) return entry;
  }
  return undefined;
}

/**
 * Resolve catalog entry for a config.schema category key.
 */
export function catalogEntryForCategory(
  category: ConfigSchemaCategory,
): ConfigCategoryCatalogEntry {
  return CONFIG_CATEGORY_CATALOG[category];
}
