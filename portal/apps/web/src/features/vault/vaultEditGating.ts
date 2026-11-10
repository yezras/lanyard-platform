/**
 * Vault Office edit affordance gates (lp-5q6.29).
 *
 * Edit entrypoint is shown only when:
 * - ONLYOFFICE feature flag is on
 * - path is an Office/PDF type the host supports
 * - ui.can.vault_edit is true
 *
 * Users without vault_edit stay on lightweight VaultReader previews
 * (or may open view-only ONLYOFFICE elsewhere). Edit mode reuses the
 * chat document host (OnlyOfficeEditorHost), not a second integration.
 */

import { isOfficeEditorPath } from "../chat/documentPane/isOfficeEditorFile.js";
import { isOnlyOfficeEditorEnabled } from "../chat/documentPane/onlyOfficeFeatureFlag.js";

export type VaultEditAffordanceInput = {
  /** Absolute vault path of the open file (or null when none). */
  path: string | null | undefined;
  /**
   * ui.can.vault_edit from GET /api/context (or BFF office gate).
   * `null` / `undefined` means unknown — treat as false (fail closed).
   */
  canVaultEdit: boolean | null | undefined;
  /**
   * Override ONLYOFFICE feature flag (tests). When omitted, uses runtime flag.
   */
  editorEnabled?: boolean;
};

export type VaultEditAffordance = {
  /** File type is supported by the ONLYOFFICE host. */
  fileSupported: boolean;
  /** Feature flag allows the editor host. */
  editorEnabled: boolean;
  /** ui.can.vault_edit is true. */
  canVaultEdit: boolean;
  /**
   * Show the Edit control. True only when all three gates pass.
   */
  showEdit: boolean;
};

/**
 * Pure gate for the Vault reader Edit affordance.
 * Fail-closed: missing capability or flag → no edit button.
 */
export function resolveVaultEditAffordance(
  input: VaultEditAffordanceInput,
): VaultEditAffordance {
  const fileSupported = isOfficeEditorPath(input.path);
  const editorEnabled = isOnlyOfficeEditorEnabled(input.editorEnabled);
  const canVaultEdit = input.canVaultEdit === true;
  return {
    fileSupported,
    editorEnabled,
    canVaultEdit,
    showEdit: fileSupported && editorEnabled && canVaultEdit,
  };
}

/**
 * Read ui.can.vault_edit from a Portal context-shaped object.
 * Accepts partial / legacy payloads that omit `ui`.
 */
export function canVaultEditFromPortalContext(ctx: {
  ui?: {
    can?: {
      vault_edit?: boolean;
    };
  };
  /** Flat fallback used by some lab bindings / tests. */
  can_vault_edit?: boolean;
} | null | undefined): boolean {
  if (!ctx) return false;
  if (ctx.ui?.can?.vault_edit === true) return true;
  if (ctx.can_vault_edit === true) return true;
  return false;
}
