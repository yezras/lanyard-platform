/**
 * Operator- and user-facing disabled-reason copy for settings controls.
 *
 * Never blame Hermes-specific filesystem paths; explain backend capability
 * gaps so the UI works for any backend-runtime-v1 host.
 */

import type { UnavailableCode } from "./types.js";

const REASONS: Record<UnavailableCode, string> = {
  settings_page_unsupported:
    "Backend settings are unavailable on this host (settings.snapshot is not advertised).",
  settings_snapshot_unavailable:
    "Settings snapshot could not be loaded from the backend. Controls are disabled.",
  settings_snapshot_missing:
    "No settings snapshot is loaded yet. Controls are disabled until snapshot data is available.",
  settings_edit_unsupported:
    "Settings are read-only on this backend (settings.patch is not advertised). Display only.",
  settings_edit_degraded:
    "Settings editing is limited (backend reports degraded settings editor support).",
  model_selector_unsupported:
    "Model selection is not available on this host (models.list / models.set_active not advertised). The snapshot may still list the host’s active model as read-only.",
  model_selector_degraded:
    "Model selection is limited (backend reports degraded model support).",
  cron_manager_unsupported:
    "Scheduled task management is not fully advertised on this backend. Enable/disable may still work when jobs exist and settings can be patched. New tasks are created by asking the agent when the host supports it — Settings has no Create form.",
  cron_manager_degraded:
    "Scheduled task management is limited (backend reports degraded support).",
  mcp_edit_unsupported:
    "MCP server toggles are read-only (settings.patch is not advertised).",
  skill_edit_unsupported:
    "Skill toggles are read-only (settings.patch is not advertised).",
  empty_section: "No items in this snapshot.",
};

/**
 * Resolve a human-readable disabled reason from a machine code.
 */
export function disabledReasonMessage(code: UnavailableCode): string {
  return REASONS[code];
}

/**
 * Prefer an explicit API/error message when present; otherwise catalog copy.
 */
export function reasonFromSnapshotError(
  error: {
    error?: string;
    message?: string;
    code?: string;
    unavailable?: boolean;
  } | null | undefined,
  fallback: UnavailableCode = "settings_snapshot_unavailable",
): string {
  const explicit =
    (typeof error?.error === "string" && error.error.trim()) ||
    (typeof error?.message === "string" && error.message.trim()) ||
    "";
  if (explicit) return explicit;
  return disabledReasonMessage(fallback);
}
