import type { BackendCapabilitySet, BackendKind } from "./types.js";

/** Required Brain RPC methods for contract.brain_rpc: 1. */
export const REQUIRED_BRAIN_RPC_METHODS = [
  "brain.ping",
  "brain.health",
  "vault.list",
  "vault.stat",
  "vault.read",
  "settings.snapshot",
  "projects.list",
] as const;

/**
 * Static default capability set for Hermes-Lanyard reference behavior.
 * Used when live brain.capabilities is unavailable (method_not_found) or
 * for offline fakes / scaffolding.
 */
export function defaultHermesLanyardCapabilities(
  overrides?: Partial<BackendCapabilitySet>,
): BackendCapabilitySet {
  return {
    schema_version: 1,
    source: "static_default",
    kind: "hermes_lanyard",
    contract: {
      runtime_layout: 1,
      relay: 1,
      brain_rpc: 1,
    },
    profiles: ["admin", "contributor"],
    brain_rpc_methods: [...REQUIRED_BRAIN_RPC_METHODS],
    features: {
      chat: true,
      health: true,
      capabilities_discovery: false,
      vault_read: true,
      vault_write: false,
      history_read: false,
      heads_read: false,
      settings_snapshot: true,
      settings_patch: false,
      projects_list: true,
      projects_create: true,
      projects_delete: true,
      models: false,
      cron: false,
    },
    ui_affordances: {
      chat_panel: "supported",
      vault_browser: "supported",
      vault_editor: "unsupported",
      settings_page: "supported",
      settings_editor: "degraded",
      project_picker: "supported",
      project_create: "supported",
      model_selector: "unsupported",
      cron_manager: "unsupported",
      host_health: "supported",
    },
    limits: {
      vault_read_default_max_bytes: 1_048_576,
      vault_read_hard_max_bytes: 4_194_304,
      vault_list_max_entries: 500,
    },
    ...overrides,
  };
}

export function defaultCapabilitiesForKind(
  kind: BackendKind,
): BackendCapabilitySet {
  if (kind === "hermes_lanyard" || kind === "hermes_upstream") {
    return defaultHermesLanyardCapabilities({ kind });
  }
  return defaultHermesLanyardCapabilities({
    kind: "lanyard_agent",
    notes:
      "Static scaffold defaults; replace with live brain.capabilities or pin claim.",
    features: {
      chat: true,
      health: true,
      capabilities_discovery: true,
      vault_read: true,
      vault_write: false,
      history_read: false,
      heads_read: false,
      settings_snapshot: true,
      settings_patch: false,
      projects_list: true,
      projects_create: false,
      projects_delete: false,
      models: false,
      cron: false,
    },
  });
}
