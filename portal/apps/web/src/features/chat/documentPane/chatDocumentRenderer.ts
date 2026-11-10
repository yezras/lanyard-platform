/**
 * Choose chat document pane body renderer (lp-5q6.30 / lp-swt.2).
 *
 * Office-only open: when type + feature flag + ui.can.vault_edit all pass,
 * OnlyOffice is the sole body renderer — no preview dual-mode, no Edit /
 * Back-to-preview affordances. Chat pane does not mint/config ONLYOFFICE
 * itself — it only chooses the renderer slot; useOfficeEditorSession +
 * OnlyOfficeEditorHost own config.
 *
 * When gates fail (flag off, unsupported type, or no vault_edit), fall back
 * to VaultReader preview with no dead Edit button.
 */

import { resolveVaultEditAffordance } from "../../vault/vaultEditGating.js";

import type { PanelMode } from "./types.js";

export type ChatDocumentRenderer = "preview" | "onlyoffice";

export type ChatDocumentRendererInput = {
  /** Absolute vault path of the open file (or null when none). */
  path: string | null | undefined;
  /**
   * Pane mode from ArtifactPanelState.
   * Kept for API compatibility; office-only open ignores dual-mode toggles
   * (gates alone decide OnlyOffice vs preview).
   */
  mode: PanelMode;
  /**
   * ui.can.vault_edit. `null` / `undefined` → fail closed (no edit / no Office).
   */
  canVaultEdit: boolean | null | undefined;
  /** Override ONLYOFFICE feature flag (tests). */
  editorEnabled?: boolean;
};

export type ChatDocumentRendererDecision = {
  /** Body renderer for DocumentPaneShell. */
  renderer: ChatDocumentRenderer;
  /** Office session mode when renderer is onlyoffice; null for preview. */
  officeMode: "view" | "edit" | null;
  /** File type is supported by the ONLYOFFICE host. */
  fileSupported: boolean;
  /** Feature flag allows the editor host. */
  editorEnabled: boolean;
  /** ui.can.vault_edit is true. */
  canVaultEdit: boolean;
  /**
   * Show the Edit control (preview → edit). Always false under office-only
   * policy (lp-swt.2) — dual-mode chrome is removed.
   */
  showEdit: boolean;
  /**
   * Show "Back to preview" while editing. Always false under office-only
   * policy (lp-swt.2).
   */
  showExitEdit: boolean;
  /**
   * True when useOfficeEditorSession should mint / mount OnlyOfficeEditorHost.
   * Equivalent to `renderer === "onlyoffice"`.
   */
  officeActive: boolean;
};

/**
 * Pure gate for chat document pane preview vs ONLYOFFICE.
 *
 * - Office type + flag + vault_edit → ONLYOFFICE edit as sole renderer
 * - Otherwise → VaultReader preview (no Edit affordance)
 */
export function resolveChatDocumentRenderer(
  input: ChatDocumentRendererInput,
): ChatDocumentRendererDecision {
  const affordance = resolveVaultEditAffordance({
    path: input.path,
    canVaultEdit: input.canVaultEdit,
    editorEnabled: input.editorEnabled,
  });

  // Office-only (lp-swt.2): gates alone activate OnlyOffice — panel "preview"
  // mode no longer delays the editor behind an Edit click.
  const officeActive =
    affordance.fileSupported &&
    affordance.editorEnabled &&
    affordance.canVaultEdit;

  return {
    renderer: officeActive ? "onlyoffice" : "preview",
    officeMode: officeActive ? "edit" : null,
    fileSupported: affordance.fileSupported,
    editorEnabled: affordance.editorEnabled,
    canVaultEdit: affordance.canVaultEdit,
    // Dual-mode chrome removed for all paths under office-only product policy.
    showEdit: false,
    showExitEdit: false,
    officeActive,
  };
}
