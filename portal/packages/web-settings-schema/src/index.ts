/**
 * @lanyard/web-settings-schema
 *
 * Pure UI control descriptors for Portal web settings driven by:
 * - settings.snapshot (Brain RPC / BFF)
 * - backend capabilities / PortalUiState (GET /api/context)
 * - config.schema.json categories (model, skills, cron, mcp_servers)
 *
 * Bead: `lp-k7g.8.6` — update web settings UI to use backend schema.
 *
 * No React, no I/O. Wire into packages/web after Portal import.
 */

export type {
  BuildSettingsUiSchemaInput,
  CapabilityInput,
  ConfigSchemaCategory,
  ControlAvailability,
  PortalUiStateLike,
  SettingsControlDescriptor,
  SettingsControlKind,
  SettingsCronLike,
  SettingsIntegrationLike,
  SettingsMcpServerLike,
  SettingsModelLike,
  SettingsPageDescriptor,
  SettingsPatchOp,
  SettingsSectionDescriptor,
  SettingsSectionId,
  SettingsSkillLike,
  SettingsSnapshotErrorLike,
  SettingsSnapshotLike,
  SettingsUiSchema,
  SettingsWorkflowLike,
  UiAffordanceState,
  UnavailableCode,
} from "./types.js";

export {
  CONFIG_SCHEMA_CATEGORIES,
  SETTINGS_SECTION_IDS,
} from "./types.js";

export type {
  ConfigCategoryCatalogEntry,
  SettingsAffordanceName,
} from "./catalog.js";

export {
  CONFIG_CATEGORY_CATALOG,
  SCHEMA_BACKED_SECTION_ORDER,
  SECTION_LABELS,
  SETTINGS_SECTION_ORDER,
  catalogEntryForCategory,
  catalogEntryForSection,
} from "./catalog.js";

export type { SettingsGateKind, SettingsGateResult } from "./capabilities.js";

export {
  allCategoryGates,
  categoryEditIsAdvertised,
  connectorsSectionIsVisible,
  cronEditIsDegraded,
  cronEditIsSupported,
  cronSectionIsVisible,
  gateForCategory,
  integrationsSectionIsVisible,
  mcpSectionIsVisible,
  modelEditIsDegraded,
  modelEditIsSupported,
  modelSectionIsVisible,
  sectionIsVisible,
  settingsEditIsDegraded,
  settingsEditIsSupported,
  settingsViewIsSupported,
  skillsSectionIsVisible,
  workflowsSectionIsVisible,
} from "./capabilities.js";

export {
  buildCategoryControls,
  buildSettingsUiSchema,
  disabledControlsWithReason,
  interactiveControls,
  schemaBackedCategories,
  sectionById,
  visibleSections,
} from "./map-controls.js";

export {
  disabledReasonMessage,
  reasonFromSnapshotError,
} from "./reasons.js";
