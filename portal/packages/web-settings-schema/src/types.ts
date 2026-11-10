/**
 * Domain types for web settings UI descriptors.
 *
 * Shapes align with:
 * - settings.snapshot (brain-rpc / backend-runtime types)
 * - BackendCapabilitySet + PortalUiState (capabilities-bff)
 * - config.schema.json categories used by Portal settings
 *
 * This package is browser-safe and has **no** dependency on
 * `@lanyard/backend-runtime` so it can land in `packages/web` without
 * pulling Node BFF code. Types are structural (duck-typed) mirrors.
 */

// ---------------------------------------------------------------------------
// Snapshot entities (mirror backend-runtime Settings* types)
// ---------------------------------------------------------------------------

export type SettingsSkillLike = {
  id: string;
  name: string;
  enabled?: boolean;
  path?: string;
  source?: string;
};

export type SettingsCronLike = {
  id: string;
  name: string;
  schedule?: string;
  enabled?: boolean;
  path?: string;
  last_run_at?: string | null;
  next_run_at?: string | null;
  /**
   * Host job state when provided (e.g. scheduled | running | paused | completed).
   * Optional; Settings shows a Status indicator when present (lp-su0).
   */
  state?: string | null;
  /** Last run outcome when host provides it (ok | error | …). */
  last_status?: string | null;
};

export type SettingsMcpServerLike = {
  name: string;
  transport?: string;
  command?: string;
  enabled?: boolean;
};

export type SettingsModelLike = {
  provider: string;
  model: string;
  is_active?: boolean;
  connected?: boolean;
};

export type SettingsIntegrationLike = {
  id: string;
  name: string;
  type?: string;
  bin?: string;
  path?: string;
};

/** User-created workflow definition (settings.snapshot.workflows). */
export type SettingsWorkflowLike = {
  id: string;
  name: string;
  path?: string;
  description?: string;
  enabled?: boolean;
  updated_at?: string | null;
};

/** Redacted settings.snapshot body (structural). */
export type SettingsSnapshotLike = {
  exported_at: string;
  source: string;
  backend_home?: string | null;
  hermes_home?: string | null;
  skills?: SettingsSkillLike[];
  crons?: SettingsCronLike[];
  mcp_servers?: SettingsMcpServerLike[];
  models?: SettingsModelLike[];
  integrations?: SettingsIntegrationLike[];
  /** User-created workflow defs (additive; host may omit until advertised). */
  workflows?: SettingsWorkflowLike[];
};

// ---------------------------------------------------------------------------
// Capabilities / UI state (structural mirrors of capabilities-bff)
// ---------------------------------------------------------------------------

export type UiAffordanceState = "supported" | "unsupported" | "degraded";

/**
 * Subset of BackendCapabilitySet needed for settings gating.
 * Web should pass `context.backend_capabilities` from GET /api/context.
 */
export type CapabilityInput = {
  features?: Record<string, boolean>;
  brain_rpc_methods?: string[];
  ui_affordances?: Record<string, UiAffordanceState | string>;
};

/**
 * Pre-derived portal UI state from capabilities-bff (`context.ui`).
 * When provided, preferred over re-deriving from raw capabilities.
 */
export type PortalUiStateLike = {
  affordances?: Record<string, UiAffordanceState | string>;
  can?: {
    settings_view?: boolean;
    settings_edit?: boolean;
    model_select?: boolean;
    cron_manage?: boolean;
    [key: string]: boolean | undefined;
  };
  degraded?: string[];
  unsupported?: string[];
};

/** Optional snapshot load error (settingsErrorToHttp body). */
export type SettingsSnapshotErrorLike = {
  error?: string;
  code?: string;
  unavailable?: boolean;
  method?: string;
  message?: string;
};

// ---------------------------------------------------------------------------
// Config schema categories → settings sections
// ---------------------------------------------------------------------------

/**
 * Top-level config.schema.json keys that back Portal settings sections.
 * See contracts/backend-runtime-v1/config.schema.json.
 */
export const CONFIG_SCHEMA_CATEGORIES = [
  "model",
  "skills",
  "cron",
  "mcp_servers",
] as const;

export type ConfigSchemaCategory = (typeof CONFIG_SCHEMA_CATEGORIES)[number];

/**
 * Settings page section ids (match current SettingsView rail).
 * `connectors` / `integrations` / `workflows` are portal chrome (or snapshot
 * inventory), not config.schema categories with settings.patch ops.
 * Overview was removed from the rail (lp-fn5.1.4). Skills/MCP/Integrations
 * remain schema ids for control maps; the Connectors rail hides them
 * (lp-xhf4.4).
 */
export const SETTINGS_SECTION_IDS = [
  "connectors",
  "skills",
  "workflows",
  "crons",
  "mcp",
  "models",
  "integrations",
] as const;

export type SettingsSectionId = (typeof SETTINGS_SECTION_IDS)[number];

/** settings.patch op names that web may issue. */
export type SettingsPatchOp =
  | "skill.set_enabled"
  | "cron.set_enabled"
  | "cron.create"
  | "cron.update"
  | "mcp.set_enabled"
  | "model.set_active";

// ---------------------------------------------------------------------------
// Control descriptors
// ---------------------------------------------------------------------------

export type SettingsControlKind =
  | "section_banner"
  | "skill_toggle"
  | "cron_toggle"
  | "mcp_toggle"
  | "model_activate"
  | "readonly_field"
  | "empty_state"
  | "unavailable_banner";

/**
 * Machine-readable reason why a control/section is non-interactive.
 * UI maps these to copy via {@link disabledReasonMessage} or uses
 * `disabledReason` on the descriptor directly.
 */
export type UnavailableCode =
  | "settings_page_unsupported"
  | "settings_snapshot_unavailable"
  | "settings_snapshot_missing"
  | "settings_edit_unsupported"
  | "settings_edit_degraded"
  | "model_selector_unsupported"
  | "model_selector_degraded"
  | "cron_manager_unsupported"
  | "cron_manager_degraded"
  | "mcp_edit_unsupported"
  | "skill_edit_unsupported"
  | "empty_section";

export type ControlAvailability = {
  /**
   * When true, the control may accept user input (toggle / activate).
   * When false, render disabled/read-only and show `disabledReason`.
   */
  interactive: boolean;
  /** Human-readable explanation for disabled / empty / unavailable state. */
  disabledReason?: string;
  /** Machine code for tests and i18n keys. */
  unavailableCode?: UnavailableCode;
  /**
   * Whether the control/section should still be **visible** (read-only
   * or empty-state). False only when the whole surface must hide.
   */
  visible: boolean;
};

export type SettingsControlDescriptor = {
  id: string;
  section: SettingsSectionId;
  /** Backend config.schema.json category when applicable. */
  configCategory?: ConfigSchemaCategory;
  kind: SettingsControlKind;
  label: string;
  description?: string;
  availability: ControlAvailability;
  /** settings.patch op this control would issue when interactive. */
  patchOp?: SettingsPatchOp;
  /** Entity payloads (only one set per control). */
  skill?: SettingsSkillLike;
  cron?: SettingsCronLike;
  mcp?: SettingsMcpServerLike;
  model?: SettingsModelLike;
  /** Readonly display value (e.g. integration fields). */
  value?: string | number | boolean | null;
};

export type SettingsSectionDescriptor = {
  id: SettingsSectionId;
  label: string;
  /** config.schema.json category when this section is schema-backed. */
  configCategory?: ConfigSchemaCategory;
  /** Short description from config schema / catalog. */
  description?: string;
  /** Path into config.schema.json (documentation). */
  schemaPath?: string;
  availability: ControlAvailability;
  controls: SettingsControlDescriptor[];
  entityCount: number;
};

export type SettingsPageDescriptor = ControlAvailability & {
  title: string;
  source?: string;
  exportedAt?: string;
  /** Prefer backend_home; fall back to hermes_home for dual-emit snapshots. */
  backendHome?: string | null;
};

/**
 * Full settings UI schema: page chrome + sections + flat control list.
 * Pure data — React (or other) views map this to components.
 */
export type SettingsUiSchema = {
  page: SettingsPageDescriptor;
  sections: SettingsSectionDescriptor[];
  /** Flattened controls across all sections (handy for tests). */
  controls: SettingsControlDescriptor[];
};

/**
 * Input to {@link buildSettingsUiSchema}.
 * Prefer passing both `snapshot` (from GET /settings/snapshot) and
 * `ui` / `capabilities` (from GET /api/context).
 */
export type BuildSettingsUiSchemaInput = {
  snapshot?: SettingsSnapshotLike | null;
  capabilities?: CapabilityInput | null;
  /** Pre-derived UI state from capabilities-bff; wins over raw caps. */
  ui?: PortalUiStateLike | null;
  /** Snapshot HTTP error (unavailable banner when set). */
  snapshotError?: SettingsSnapshotErrorLike | null;
};
