/**
 * Vault main-pane document host (lp-5q6.29 / lp-xcu.2 / lp-swt.2).
 *
 * Office-only open: when flag + ui.can.vault_edit + supported type pass,
 * OnlyOffice mounts immediately as the sole body renderer — no Edit button,
 * no Back to preview, no "Editing in Office" mode chrome.
 *
 * Non-office / flag-off / no vault_edit stay on lightweight VaultReader.
 * Dirty/save-issue banners remain as functional save status (not mode marketing).
 *
 * Edit mode reuses OnlyOfficeEditorHost + useOfficeEditorSession from the
 * chat document pane — one Office integration, not a second stack.
 *
 * Affordance is gated by resolveVaultEditAffordance (type + flag +
 * ui.can.vault_edit). Dirty/save chrome is UX-only and never claims vault
 * persistence before the BFF callback path completes.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type CSSProperties,
  type ComponentProps,
} from "react";

import { Banner } from "@astryxdesign/core/Banner";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";

import type { VaultFileContent } from "../../api/types.js";
import type { mintOfficeSession } from "../../api/office.js";
import {
  artifactPanelReducer,
  createInitialArtifactPanelState,
} from "../chat/documentPane/artifactPanelReducer.js";
import { OnlyOfficeEditorHost } from "../chat/documentPane/OnlyOfficeEditorHost.js";
import type { OfficeEditorHostError } from "../chat/documentPane/onlyOfficeTypes.js";
import { useOfficeEditorSession } from "../chat/documentPane/useOfficeEditorSession.js";

import { VaultReader } from "./VaultReader.js";
import { resolveVaultEditAffordance } from "./vaultEditGating.js";
import {
  vaultEditorBodyStyle,
  vaultPreviewBodyStyle,
  vaultReaderFillStyle,
} from "./vaultLayout.js";

export type VaultDocumentHostProps = {
  content: VaultFileContent | null;
  isLoading: boolean;
  error: string | null;
  /**
   * ui.can.vault_edit. `null` while loading/unknown → fail closed (no Office).
   */
  canVaultEdit: boolean | null;
  /** Override ONLYOFFICE feature flag (tests). */
  editorEnabled?: boolean;
  /** Override Document Server URL (tests / story). */
  documentServerUrl?: string;
  /** Inject mint (tests). */
  mint?: typeof mintOfficeSession;
  /** Inject DocsAPI loader (tests). */
  loadDocsApi?: ComponentProps<typeof OnlyOfficeEditorHost>["loadDocsApi"];
};

type SaveChromeState =
  | { kind: "idle" }
  | { kind: "dirty" }
  | { kind: "save_issue"; error: OfficeEditorHostError };

/** Optional strip above OO iframe — not frame margin (lp-75r.2). */
const saveChromeStripStyle: CSSProperties = {
  marginBottom: "var(--spacing-2, 0.5rem)",
  flexShrink: 0,
  paddingInline: "var(--spacing-4, 1rem)",
  paddingBlockStart: "var(--spacing-3, 0.75rem)",
};

/**
 * Vault reader / editor host.
 * Office open mounts OnlyOffice when gates pass (lp-swt.2 office-only);
 * VaultReader for non-office / flag-off / no vault_edit.
 */
export function VaultDocumentHost({
  content,
  isLoading,
  error,
  canVaultEdit,
  editorEnabled,
  documentServerUrl,
  mint,
  loadDocsApi,
}: VaultDocumentHostProps) {
  const path = content?.path ?? null;

  const affordance = useMemo(
    () =>
      resolveVaultEditAffordance({
        path,
        canVaultEdit,
        editorEnabled,
      }),
    [path, canVaultEdit, editorEnabled],
  );

  // Office-only: gates + settled content → OnlyOffice is the sole body.
  // No previewPreferred / dual-mode toggle (lp-swt.2).
  const officeActive =
    Boolean(path) &&
    affordance.showEdit &&
    content != null &&
    !isLoading &&
    !error;

  const [saveChrome, setSaveChrome] = useState<SaveChromeState>({
    kind: "idle",
  });
  const [panelState, dispatchPanel] = useReducer(
    artifactPanelReducer,
    undefined,
    createInitialArtifactPanelState,
  );

  // Reset save chrome when leaving office or changing path.
  useEffect(() => {
    if (!officeActive) {
      setSaveChrome({ kind: "idle" });
      dispatchPanel({ type: "PANEL_CLOSE", reason: "user" });
    }
  }, [officeActive, path]);

  // Bind panel open to current path while OnlyOffice is active.
  useEffect(() => {
    if (!officeActive || !path) {
      return;
    }
    dispatchPanel({
      type: "PANEL_OPEN",
      ref: {
        path,
        title: path.split("/").filter(Boolean).at(-1) ?? path,
        source: "vault_browser",
      },
      mode: "edit",
    });
  }, [officeActive, path]);

  const office = useOfficeEditorSession({
    state: panelState,
    dispatch: dispatchPanel,
    enabled: officeActive ? editorEnabled ?? true : false,
    documentServerUrl,
    mint,
  });

  const handleDirtyChange = useCallback((dirty: boolean) => {
    dispatchPanel({ type: "PANEL_SET_DIRTY", dirty });
    setSaveChrome((prev) => {
      if (dirty) return { kind: "dirty" };
      // Leaving dirty without a save-issue: local buffer clean only —
      // do not claim vault persistence (callback may still be in flight).
      if (prev.kind === "save_issue") return prev;
      return { kind: "idle" };
    });
  }, []);

  const handleSaveIssue = useCallback((err: OfficeEditorHostError) => {
    setSaveChrome({ kind: "save_issue", error: err });
  }, []);

  // openMode is edit when OnlyOffice is mounted; preview when gates fail.
  const openMode = officeActive ? "edit" : "preview";

  return (
    <div
      style={vaultReaderFillStyle}
      data-testid="vault-document-host"
      data-open-mode={openMode}
      data-editing={officeActive ? "true" : "false"}
      data-show-edit="false"
      data-can-vault-edit={canVaultEdit === true ? "true" : "false"}
      data-file-supported={affordance.fileSupported ? "true" : "false"}
    >
      {officeActive && saveChrome.kind === "dirty" ? (
        <div
          style={saveChromeStripStyle}
          data-testid="vault-editor-dirty-banner"
          role="status"
        >
          <Banner
            status="info"
            title="Unsaved local changes"
            description="Edits are local until Document Server finishes the vault save callback. This is not yet a confirmed vault write."
          />
        </div>
      ) : null}

      {officeActive && saveChrome.kind === "save_issue" ? (
        <div
          style={saveChromeStripStyle}
          data-testid="vault-editor-save-issue"
          role="alert"
        >
          <Banner
            status="error"
            title="Save problem"
            description={
              saveChrome.error.detail
                ? `${saveChrome.error.message} (${saveChrome.error.detail})`
                : saveChrome.error.message
            }
          />
        </div>
      ) : null}

      <div
        style={officeActive ? vaultEditorBodyStyle : vaultPreviewBodyStyle}
        data-testid="vault-document-body"
        data-body-pad={officeActive ? "0" : "preview"}
      >
        {officeActive ? (
          // Mount OnlyOfficeEditorHost only once mint produced a session or
          // error — avoids config_missing flash and placeholder races while
          // the panel opens (same host component as the chat document pane).
          office.session || office.error ? (
            <OnlyOfficeEditorHost
              session={office.session}
              error={office.error}
              isLoading={office.isLoading}
              loadDocsApi={loadDocsApi}
              onDirtyChange={handleDirtyChange}
              onSaveIssue={handleSaveIssue}
            />
          ) : (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "var(--spacing-3, 0.75rem)",
                flex: 1,
                minHeight: 280,
              }}
              data-testid="vault-editor-opening"
              role="status"
              aria-busy="true"
            >
              <Spinner size="md" />
              <Text type="supporting" color="secondary">
                Opening Office editor…
              </Text>
            </div>
          )
        ) : (
          <VaultReader
            content={content}
            isLoading={isLoading}
            error={error}
          />
        )}
      </div>
    </div>
  );
}

/** Test helper: re-export affordance for host-level matrix tests. */
export { resolveVaultEditAffordance };
