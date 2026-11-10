/**
 * Capability gates for settings UI controls.
 *
 * Prefer pre-derived `PortalUiState` from GET /api/context. When only a raw
 * capability descriptor is available, derive the same gates from features +
 * brain_rpc_methods (mirrors settings-bff + capabilities-bff rules).
 *
 * Never branch on backend_kind.
 */

import type { ConfigCategoryCatalogEntry } from "./catalog.js";
import { CONFIG_CATEGORY_CATALOG } from "./catalog.js";
import { disabledReasonMessage } from "./reasons.js";
import type {
  CapabilityInput,
  ConfigSchemaCategory,
  ControlAvailability,
  PortalUiStateLike,
  SettingsSectionId,
  SettingsSnapshotLike,
  UiAffordanceState,
  UnavailableCode,
} from "./types.js";

const SETTINGS_SNAPSHOT_METHOD = "settings.snapshot";
const SETTINGS_PATCH_METHOD = "settings.patch";

export type SettingsGateKind =
  | "settings_view"
  | "settings_edit"
  | "model_edit"
  | "cron_edit"
  | "skill_edit"
  | "mcp_edit";

export type SettingsGateResult = {
  /** Full interactive support. */
  supported: boolean;
  /** Present but limited — show read-only / caution. */
  degraded: boolean;
  /** Not available at all. */
  unsupported: boolean;
  availability: ControlAvailability;
};

function affordanceOf(
  ui: PortalUiStateLike | null | undefined,
  caps: CapabilityInput | null | undefined,
  name: string,
): UiAffordanceState | undefined {
  const fromUi = ui?.affordances?.[name];
  if (fromUi === "supported" || fromUi === "unsupported" || fromUi === "degraded") {
    return fromUi;
  }
  const fromCaps = caps?.ui_affordances?.[name];
  if (
    fromCaps === "supported" ||
    fromCaps === "unsupported" ||
    fromCaps === "degraded"
  ) {
    return fromCaps;
  }
  return undefined;
}

function featureTrue(
  caps: CapabilityInput | null | undefined,
  name: string,
): boolean {
  return caps?.features?.[name] === true;
}

function methodListed(
  caps: CapabilityInput | null | undefined,
  name: string,
): boolean {
  return (caps?.brain_rpc_methods ?? []).includes(name);
}

function anyFeature(
  caps: CapabilityInput | null | undefined,
  names: readonly string[],
): boolean {
  return names.some((n) => featureTrue(caps, n));
}

function anyMethod(
  caps: CapabilityInput | null | undefined,
  names: readonly string[],
): boolean {
  return names.some((n) => methodListed(caps, n));
}

/**
 * Whether settings.snapshot / settings page can be shown.
 */
export function settingsViewIsSupported(
  ui?: PortalUiStateLike | null,
  caps?: CapabilityInput | null,
): boolean {
  if (ui?.can?.settings_view === true) return true;
  if (ui?.can?.settings_view === false) return false;
  const aff = affordanceOf(ui, caps, "settings_page");
  if (aff === "supported") return true;
  if (aff === "unsupported") return false;
  if (featureTrue(caps, "settings_snapshot")) return true;
  if (methodListed(caps, SETTINGS_SNAPSHOT_METHOD)) return true;
  // No capability data → optimistic view (snapshot fetch is the real gate).
  if (!ui && !caps) return true;
  // Caps present but neither feature nor method → unsupported.
  if (caps && !featureTrue(caps, "settings_snapshot") && !methodListed(caps, SETTINGS_SNAPSHOT_METHOD)) {
    return false;
  }
  return true;
}

/**
 * Whether skill/mcp enable patches are available (settings.patch).
 */
export function settingsEditIsSupported(
  ui?: PortalUiStateLike | null,
  caps?: CapabilityInput | null,
): boolean {
  if (ui?.can?.settings_edit === true) return true;
  if (ui?.can?.settings_edit === false) {
    // can=false still allows degraded path via affordances
    const aff = affordanceOf(ui, caps, "settings_editor");
    return aff === "supported";
  }
  const aff = affordanceOf(ui, caps, "settings_editor");
  if (aff === "supported") return true;
  if (aff === "degraded" || aff === "unsupported") return false;
  if (featureTrue(caps, "settings_patch")) return true;
  if (methodListed(caps, SETTINGS_PATCH_METHOD)) return true;
  return false;
}

export function settingsEditIsDegraded(
  ui?: PortalUiStateLike | null,
  caps?: CapabilityInput | null,
): boolean {
  return affordanceOf(ui, caps, "settings_editor") === "degraded";
}

/**
 * Whether model.set_active is available (settings.patch or models expansion).
 * Mirrors settings-bff `modelPatchIsAdvertised` + model_selector affordance.
 */
export function modelEditIsSupported(
  ui?: PortalUiStateLike | null,
  caps?: CapabilityInput | null,
): boolean {
  if (ui?.can?.model_select === true) return true;
  const aff = affordanceOf(ui, caps, "model_selector");
  if (aff === "supported") return true;
  if (aff === "degraded") return false;
  if (settingsEditIsSupported(ui, caps)) return true;
  if (featureTrue(caps, "models")) return true;
  if (anyMethod(caps, ["models.set_active", "models.list"])) return true;
  return false;
}

export function modelEditIsDegraded(
  ui?: PortalUiStateLike | null,
  caps?: CapabilityInput | null,
): boolean {
  return affordanceOf(ui, caps, "model_selector") === "degraded";
}

/**
 * Whether cron enable patches are available.
 * Mirrors settings-bff `cronPatchIsAdvertised` + cron_manager affordance.
 */
export function cronEditIsSupported(
  ui?: PortalUiStateLike | null,
  caps?: CapabilityInput | null,
): boolean {
  if (ui?.can?.cron_manage === true) return true;
  const aff = affordanceOf(ui, caps, "cron_manager");
  if (aff === "supported") return true;
  if (aff === "degraded") return false;
  if (settingsEditIsSupported(ui, caps)) return true;
  if (featureTrue(caps, "cron")) return true;
  if (anyMethod(caps, ["cron.patch", "cron.list"])) return true;
  return false;
}

export function cronEditIsDegraded(
  ui?: PortalUiStateLike | null,
  caps?: CapabilityInput | null,
): boolean {
  return affordanceOf(ui, caps, "cron_manager") === "degraded";
}

function gateResult(
  supported: boolean,
  degraded: boolean,
  codes: {
    unsupported: UnavailableCode;
    degraded: UnavailableCode;
  },
): SettingsGateResult {
  if (supported) {
    return {
      supported: true,
      degraded: false,
      unsupported: false,
      availability: { interactive: true, visible: true },
    };
  }
  if (degraded) {
    return {
      supported: false,
      degraded: true,
      unsupported: false,
      availability: {
        interactive: false,
        visible: true,
        unavailableCode: codes.degraded,
        disabledReason: disabledReasonMessage(codes.degraded),
      },
    };
  }
  return {
    supported: false,
    degraded: false,
    unsupported: true,
    availability: {
      interactive: false,
      visible: true,
      unavailableCode: codes.unsupported,
      disabledReason: disabledReasonMessage(codes.unsupported),
    },
  };
}

/**
 * Resolve edit gate for a schema-backed category.
 */
export function gateForCategory(
  category: ConfigSchemaCategory,
  ui?: PortalUiStateLike | null,
  caps?: CapabilityInput | null,
): SettingsGateResult {
  switch (category) {
    case "model":
      return gateResult(modelEditIsSupported(ui, caps), modelEditIsDegraded(ui, caps), {
        unsupported: "model_selector_unsupported",
        degraded: "model_selector_degraded",
      });
    case "cron":
      return gateResult(cronEditIsSupported(ui, caps), cronEditIsDegraded(ui, caps), {
        unsupported: "cron_manager_unsupported",
        degraded: "cron_manager_degraded",
      });
    case "skills":
      return gateResult(
        settingsEditIsSupported(ui, caps),
        settingsEditIsDegraded(ui, caps),
        {
          unsupported: "skill_edit_unsupported",
          degraded: "settings_edit_degraded",
        },
      );
    case "mcp_servers":
      return gateResult(
        settingsEditIsSupported(ui, caps),
        settingsEditIsDegraded(ui, caps),
        {
          unsupported: "mcp_edit_unsupported",
          degraded: "settings_edit_degraded",
        },
      );
  }
}

/**
 * Whether a catalog entry's edit surface is advertised by raw caps
 * (feature or method OR). Useful for tests without full ui state.
 */
export function categoryEditIsAdvertised(
  entry: ConfigCategoryCatalogEntry,
  caps: CapabilityInput | null | undefined,
): boolean {
  if (anyFeature(caps, entry.editFeaturesAnyOf)) return true;
  if (anyMethod(caps, entry.editMethodsAnyOf)) return true;
  return false;
}

/**
 * Convenience: all category gates for diagnostics.
 */
export function allCategoryGates(
  ui?: PortalUiStateLike | null,
  caps?: CapabilityInput | null,
): Record<ConfigSchemaCategory, SettingsGateResult> {
  return {
    model: gateForCategory("model", ui, caps),
    skills: gateForCategory("skills", ui, caps),
    cron: gateForCategory("cron", ui, caps),
    mcp_servers: gateForCategory("mcp_servers", ui, caps),
  };
}

/**
 * Whether capability / UI inputs are present for section visibility decisions.
 * When neither is provided (offline fixture), sections stay visible (optimistic).
 */
function hasCapabilityContext(
  ui?: PortalUiStateLike | null,
  caps?: CapabilityInput | null,
): boolean {
  return Boolean(ui || caps);
}

function affordanceIsUnsupported(
  ui?: PortalUiStateLike | null,
  caps?: CapabilityInput | null,
  name?: string,
): boolean {
  if (!name) return false;
  return affordanceOf(ui, caps, name) === "unsupported";
}

/**
 * Models section is viewable when model_selector is not explicitly unsupported,
 * or models features/methods are advertised, or snapshot carries models.
 * Grill Q10: hide when the host does not support the surface.
 */
export function modelSectionIsVisible(
  ui?: PortalUiStateLike | null,
  caps?: CapabilityInput | null,
  snapshot?: SettingsSnapshotLike | null,
): boolean {
  if (!hasCapabilityContext(ui, caps)) return true;
  // Snapshot include list / host data wins (honest presence).
  if ((snapshot?.models?.length ?? 0) > 0) return true;
  if (ui?.can?.model_select === true) return true;
  const aff = affordanceOf(ui, caps, "model_selector");
  if (aff === "supported" || aff === "degraded") return true;
  if (featureTrue(caps, "models")) return true;
  if (anyMethod(caps, ["models.set_active", "models.list"])) return true;
  // Explicitly unsupported and no models data → hide (Q10).
  if (aff === "unsupported") return false;
  // Caps present but nothing advertises models → hide empty unsupported section.
  return false;
}

/**
 * Product host sources that own a cron/jobs store and return
 * settings.snapshot.crons (possibly empty). Used so LA empty inventory still
 * surfaces Settings → Scheduled tasks when the enable path is advertised (lp-su0).
 * Fixture / generic brain_rpc partial hosts stay hidden under Q10.
 */
function isCronProductHostSource(source?: string | null): boolean {
  if (typeof source !== "string") return false;
  const s = source.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!s) return false;
  return (
    s === "lanyard_agent" ||
    s === "hermes_lanyard" ||
    s === "hermes" ||
    s.startsWith("lanyard_agent") ||
    s.startsWith("hermes_lanyard")
  );
}

/**
 * Cron section visibility (hide when cron_manager unsupported and no data).
 *
 * Show when:
 * - snapshot has cron rows
 * - cron_manager / features.cron / cron.* methods advertised (honest)
 * - LA/HL product host returned crons inventory (even empty) and cron enable
 *   path is available via settings.patch (lp-su0 Settings UI path)
 */
export function cronSectionIsVisible(
  ui?: PortalUiStateLike | null,
  caps?: CapabilityInput | null,
  snapshot?: SettingsSnapshotLike | null,
): boolean {
  if (!hasCapabilityContext(ui, caps)) return true;
  if ((snapshot?.crons?.length ?? 0) > 0) return true;
  if (ui?.can?.cron_manage === true) return true;
  const aff = affordanceOf(ui, caps, "cron_manager");
  if (aff === "supported" || aff === "degraded") return true;
  if (featureTrue(caps, "cron")) return true;
  if (anyMethod(caps, ["cron.patch", "cron.list"])) return true;
  // LA/HL product: empty jobs.json still lists under Settings when patch works.
  if (
    Array.isArray(snapshot?.crons) &&
    isCronProductHostSource(snapshot?.source) &&
    cronEditIsSupported(ui, caps)
  ) {
    return true;
  }
  if (aff === "unsupported") return false;
  return false;
}

/**
 * Skills section: part of settings.snapshot; hide only when settings page
 * itself is unsupported.
 */
export function skillsSectionIsVisible(
  ui?: PortalUiStateLike | null,
  caps?: CapabilityInput | null,
  snapshot?: SettingsSnapshotLike | null,
): boolean {
  if (!hasCapabilityContext(ui, caps)) return true;
  if ((snapshot?.skills?.length ?? 0) > 0) return true;
  return settingsViewIsSupported(ui, caps);
}

/**
 * Workflows section: user-created workflow defs from settings.snapshot.
 * Same posture as Skills: show when host has inventory, when a workflows
 * feature/method is advertised, or when settings page is supported (empty
 * state). Hide only when settings view is unsupported and inventory is empty.
 *
 * Residual: dedicated workflows.list Brain RPC / agent API may replace
 * snapshot field later; visibility stays additive.
 */
export function workflowsSectionIsVisible(
  ui?: PortalUiStateLike | null,
  caps?: CapabilityInput | null,
  snapshot?: SettingsSnapshotLike | null,
): boolean {
  if (!hasCapabilityContext(ui, caps)) return true;
  if ((snapshot?.workflows?.length ?? 0) > 0) return true;
  if (featureTrue(caps, "workflows")) return true;
  if (anyMethod(caps, ["workflows.list", "workflow.list", "workflows.snapshot"])) {
    return true;
  }
  return settingsViewIsSupported(ui, caps);
}

/**
 * MCP section: schema-backed settings.snapshot surface. Visible when the
 * settings page is supported or snapshot includes MCP servers.
 * Partial “skills only” hosts that omit settings_page still hide MCP when
 * empty and settings view is unsupported.
 */
export function mcpSectionIsVisible(
  ui?: PortalUiStateLike | null,
  caps?: CapabilityInput | null,
  snapshot?: SettingsSnapshotLike | null,
): boolean {
  if (!hasCapabilityContext(ui, caps)) return true;
  if ((snapshot?.mcp_servers?.length ?? 0) > 0) return true;
  return settingsViewIsSupported(ui, caps);
}

/**
 * Integrations / health: only when host_health is advertised or snapshot
 * lists integrations (grill Q10).
 */
export function integrationsSectionIsVisible(
  ui?: PortalUiStateLike | null,
  caps?: CapabilityInput | null,
  snapshot?: SettingsSnapshotLike | null,
): boolean {
  if (!hasCapabilityContext(ui, caps)) return true;
  if ((snapshot?.integrations?.length ?? 0) > 0) return true;
  if (ui?.can?.host_health === true) return true;
  const aff = affordanceOf(ui, caps, "host_health");
  if (aff === "supported" || aff === "degraded") return true;
  if (featureTrue(caps, "health")) return true;
  if (methodListed(caps, "brain.health")) return true;
  if (affordanceIsUnsupported(ui, caps, "host_health")) return false;
  return false;
}

/**
 * Whether a Settings rail section should be shown (grill Q10: hide unsupported).
 */
/**
 * Connectors catalog is Portal chrome (lp-xhf4.4). Always on the renamed
 * Tools rail; per-row entitlement lives on GET /api/connectors.
 */
export function connectorsSectionIsVisible(): boolean {
  return true;
}

export function sectionIsVisible(
  section: SettingsSectionId,
  ui?: PortalUiStateLike | null,
  caps?: CapabilityInput | null,
  snapshot?: SettingsSnapshotLike | null,
): boolean {
  switch (section) {
    case "connectors":
      return connectorsSectionIsVisible();
    case "skills":
      return skillsSectionIsVisible(ui, caps, snapshot);
    case "workflows":
      return workflowsSectionIsVisible(ui, caps, snapshot);
    case "crons":
      return cronSectionIsVisible(ui, caps, snapshot);
    case "mcp":
      return mcpSectionIsVisible(ui, caps, snapshot);
    case "models":
      return modelSectionIsVisible(ui, caps, snapshot);
    case "integrations":
      return integrationsSectionIsVisible(ui, caps, snapshot);
    default: {
      const _exhaustive: never = section;
      return _exhaustive === section;
    }
  }
}

/** Re-export catalog for callers that only import capabilities. */
export { CONFIG_CATEGORY_CATALOG };
