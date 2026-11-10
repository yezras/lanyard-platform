/**
 * Chat right-side document pane shell.
 *
 * Reuses VaultReader for markdown, text, image, PDF, DOCX, XLSX, PPTX.
 * ONLYOFFICE editor host is an optional body renderer behind a feature flag
 * (lp-5q6.27) — not a special branch in ChatView / VaultView.
 *
 * Beads: lp-5q6.13 (shell), lp-5q6.15 (responsive / a11y chrome),
 * lp-5q6.16 (agent progress strip + checkpoint offer),
 * lp-5q6.24 (conflict / reload banner when dirty edit meets external revision
 * so document.key is not auto-swapped under unsaved human work),
 * lp-5q6.27 (flagged OnlyOfficeEditorHost body),
 * lp-5q6.30 (preview vs ONLYOFFICE from type/capability/flag/mode + edit toggle),
 * lp-dpr.1 (body always loads: generation-safe preview + Office mint fallback),
 * lp-ye4.11 (currentness strip + signed-operation history panel).
 */

import {
  useEffect,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import {
  ArrowDownTrayIcon,
  ArrowLeftIcon,
  ArrowPathIcon,
  ClockIcon,
  DocumentTextIcon,
  FolderOpenIcon,
  PencilSquareIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Icon } from "@astryxdesign/core/Icon";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { Toolbar } from "@astryxdesign/core/Toolbar";
import { VStack } from "@astryxdesign/core/VStack";

import type { VaultFileContent } from "../../../api/types.js";
import { VaultReader } from "../../vault/VaultReader.js";

import { ArtifactHistoryPanel } from "./ArtifactHistoryPanel.js";
import type {
  CurrentnessDisplay,
  HistoryEventView,
  StaleHeadDecision,
} from "./currentness.js";
import {
  documentPaneBodyStyle,
  documentPaneDrawerStyle,
  documentPaneEditorBodyStyle,
  documentPaneStyle,
  documentPaneWidthVar,
} from "./documentPaneLayout.js";
import {
  OnlyOfficeEditorHost,
  type OnlyOfficeEditorHostProps,
} from "./OnlyOfficeEditorHost.js";
import type { ArtifactPanelState } from "./types.js";

export type DocumentPaneLayoutMode = "split" | "drawer";

/**
 * Optional ONLYOFFICE body slot (lp-5q6.27 / lp-5q6.30).
 * When `active`, the shell renders OnlyOfficeEditorHost instead of VaultReader.
 * Flag-off / preview-mode callers omit this (or pass active:false) so previews stay.
 */
export type DocumentPaneOfficeEditorSlot = Pick<
  OnlyOfficeEditorHostProps,
  | "session"
  | "error"
  | "isLoading"
  | "loadDocsApi"
  | "onReady"
  | "onDocumentReady"
  | "onError"
  | "onDirtyChange"
  | "onSaveIssue"
  | "onRequestClose"
> & {
  active: boolean;
};

/**
 * View-only ↔ edit affordance (lp-5q6.30). Omitted when gates fail.
 * Shell does not know mint/config details — only the toggle.
 */
export type DocumentPaneEditControls = {
  showEdit: boolean;
  showExitEdit: boolean;
  onRequestEdit: () => void;
  onExitEdit: () => void;
};

/**
 * Currentness + history chrome from BFF heads/history APIs (lp-ye4.11).
 * Optional so stories / offline panes still render without ledger hosts.
 */
export type DocumentPaneCurrentnessChrome = {
  currentness: CurrentnessDisplay | null;
  staleDecision?: StaleHeadDecision | null;
  historyOpen: boolean;
  onToggleHistory: () => void;
  historyEvents: HistoryEventView[];
  historyLoading: boolean;
  historyError: string | null;
  historyUnavailable: boolean;
  historyTruncated?: boolean;
};

export type DocumentPaneShellProps = {
  state: ArtifactPanelState;
  content: VaultFileContent | null;
  isLoading: boolean;
  onClose: () => void;
  /**
   * Reload current document. When the pane is in conflict (dirty + external
   * revision), callers should discard local dirty / Office session so the
   * next open mints a new document.key (lp-5q6.24).
   */
  onReload: () => void;
  onOpenInVault: (path: string) => void;
  onDownload: (path: string) => void;
  /** Open agent checkpoint path (conflict alternateRef or soft offer). */
  onOpenCheckpoint?: () => void;
  /** Dismiss soft checkpoint offer without changing the open document. */
  onDismissCheckpoint?: () => void;
  /** Discard local dirty buffer and reload (conflict action). */
  onDiscardLocal?: () => void;
  /** Override default width (px or CSS length). Ignored in drawer mode. */
  width?: number | string;
  /**
   * `split` — desktop side column (default).
   * `drawer` — full-screen host (mobile Dialog); fills available space.
   */
  layout?: DocumentPaneLayoutMode;
  /**
   * When true (default), move focus into the pane on open.
   * Desktop: focus the pane region. Mobile Dialog may also autofocus.
   */
  autoFocus?: boolean;
  /**
   * Flag-gated ONLYOFFICE renderer. Default omitted → VaultReader previews only.
   */
  officeEditor?: DocumentPaneOfficeEditorSlot | null;
  /**
   * Edit / back-to-preview controls when type + flag + capability allow.
   */
  editControls?: DocumentPaneEditControls | null;
  /**
   * Authoritative current-head + history panel (lp-ye4.11).
   * Omitted when heads/history are not loaded.
   */
  currentnessChrome?: DocumentPaneCurrentnessChrome | null;
};

function basename(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? path;
}

/** True when the pane should occupy the right column / drawer. */
export function isDocumentPaneVisible(state: ArtifactPanelState): boolean {
  return state.status !== "closed" && state.ref != null;
}

function progressLabel(state: ArtifactPanelState): string {
  const p = state.progress;
  if (!p) return "Agent working on this document…";
  if (p.message?.trim()) return p.message.trim();
  if (p.phase?.trim()) return p.phase.trim();
  return "Agent working on this document…";
}

const stripStyle: CSSProperties = {
  padding: "var(--spacing-2, 0.5rem) var(--spacing-3, 0.75rem)",
  borderBottom: "1px solid var(--border-primary, rgba(0,0,0,0.08))",
  flexShrink: 0,
};

const progressBarTrackStyle: CSSProperties = {
  height: 4,
  borderRadius: 2,
  background: "var(--bg-secondary, rgba(0,0,0,0.08))",
  overflow: "hidden",
  marginTop: 6,
};

function progressBarFillStyle(percent: number): CSSProperties {
  return {
    height: "100%",
    width: `${Math.max(0, Math.min(100, percent))}%`,
    background: "var(--fg-accent, var(--color-accent, #3b82f6))",
    transition: "width 150ms ease-out",
  };
}

export function DocumentPaneShell({
  state,
  content,
  isLoading,
  onClose,
  onReload,
  onOpenInVault,
  onDownload,
  onOpenCheckpoint,
  onDismissCheckpoint,
  onDiscardLocal,
  width,
  layout = "split",
  autoFocus = true,
  officeEditor = null,
  editControls = null,
  currentnessChrome = null,
}: DocumentPaneShellProps) {
  const paneRef = useRef<HTMLElement>(null);
  const visible = isDocumentPaneVisible(state) && state.ref != null;
  const openGeneration = state.openGeneration;

  // Move keyboard focus into the pane when it opens or switches document.
  useEffect(() => {
    if (!visible || !autoFocus) {
      return;
    }
    // Defer so Dialog / layout paint first; still restores on next tick.
    const id = window.requestAnimationFrame(() => {
      paneRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(id);
  }, [visible, openGeneration, autoFocus, layout]);

  if (!visible || !state.ref) {
    return null;
  }

  const path = state.ref.path;
  const title = state.ref.title?.trim() || basename(path);
  const officeActive = Boolean(officeEditor?.active);
  /**
   * OnlyOffice body when the host is active and either loading or has a
   * session. Settled mint/config failure (no session) falls back to
   * VaultReader so the pane never shows toolbar chrome with an empty body
   * (lp-dpr.1).
   */
  const officeHasSession = Boolean(officeEditor?.session);
  const officeLoading = Boolean(officeEditor?.isLoading);
  const officeHardError =
    officeActive && !officeLoading && !officeHasSession;
  const useOfficeBody =
    officeActive && !officeHardError && (officeLoading || officeHasSession);

  // Progress shows a strip above the body — spinner only when we lack bytes
  // and are not mounting OnlyOffice. Never hide already-fetched content
  // behind status === "opening" (generation race / PREVIEW_READY lag).
  const readerLoading =
    !useOfficeBody &&
    content == null &&
    (isLoading ||
      state.status === "opening" ||
      (state.status === "progress" && !officeActive));
  // Prefer vault preview bytes on Office mint failure; only surface the
  // Office error when there is no preview body to fall back to.
  const readerError =
    state.status === "error" && state.error
      ? state.error.message
      : officeHardError && content == null && officeEditor?.error
        ? officeEditor.error.message
        : null;

  const showProgress = state.progress != null;
  const percent =
    typeof state.progress?.percent === "number"
      ? state.progress.percent
      : null;
  const showCheckpointOffer =
    state.checkpointOffer != null && state.status !== "conflict";
  const showConflict = state.status === "conflict" && state.conflict != null;
  const canOpenCheckpoint =
    Boolean(state.conflict?.alternateRef) || Boolean(state.checkpointOffer);
  // Progress is a chrome strip, never an overlay over the editor frame.
  const progressCoexistsWithEditor = showProgress && useOfficeBody;
  const currentness = currentnessChrome?.currentness ?? null;
  const showStaleReload =
    currentnessChrome?.staleDecision?.action === "reload" &&
    state.status !== "conflict";
  const historyOpen = currentnessChrome?.historyOpen === true;

  const isDrawer = layout === "drawer";
  const shellStyle: CSSProperties = isDrawer
    ? documentPaneDrawerStyle
    : {
        ...documentPaneStyle,
        ...documentPaneWidthVar(width),
      };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      event.preventDefault();
      onClose();
    }
  };

  return (
    <aside
      ref={paneRef}
      className={
        isDrawer
          ? "chat-document-pane chat-document-pane--drawer"
          : "chat-document-pane chat-document-pane--split"
      }
      data-testid="chat-document-pane"
      data-layout={layout}
      data-status={state.status}
      data-mode={state.mode}
      data-renderer={useOfficeBody ? "onlyoffice" : "preview"}
      data-progress-with-editor={
        progressCoexistsWithEditor ? "true" : "false"
      }
      data-office-fallback={officeHardError ? "preview" : undefined}
      aria-label="Document pane"
      role="complementary"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      style={shellStyle}
    >
      <Toolbar
        label="Document pane actions"
        dividers={["bottom"]}
        startContent={
          <HStack gap={3} vAlign="center" style={{ minWidth: 0, flex: 1 }}>
            <Icon icon={DocumentTextIcon} size="sm" color="secondary" />
            <VStack gap={0} style={{ minWidth: 0, flex: 1 }}>
              <Text type="label" weight="semibold" maxLines={1}>
                {title}
              </Text>
              <Text type="supporting" color="secondary" maxLines={1}>
                {path}
              </Text>
            </VStack>
          </HStack>
        }
        endContent={
          <HStack gap={1} vAlign="center" style={{ flexShrink: 0 }}>
            {editControls?.showEdit ? (
              <span data-testid="chat-document-pane-edit">
                <Button
                  label="Edit document"
                  tooltip="Edit"
                  variant="secondary"
                  size="sm"
                  icon={<Icon icon={PencilSquareIcon} size="sm" />}
                  onClick={editControls.onRequestEdit}
                />
              </span>
            ) : null}
            {editControls?.showExitEdit ? (
              <span data-testid="chat-document-pane-exit-edit">
                <Button
                  label="Back to preview"
                  tooltip="Back to preview"
                  variant="ghost"
                  size="sm"
                  icon={<Icon icon={ArrowLeftIcon} size="sm" />}
                  onClick={editControls.onExitEdit}
                />
              </span>
            ) : null}
            <Button
              label="Reload document"
              tooltip="Reload"
              variant="ghost"
              size="sm"
              isIconOnly
              icon={<Icon icon={ArrowPathIcon} size="sm" />}
              onClick={onReload}
            />
            {currentnessChrome ? (
              <span data-testid="chat-document-pane-history-toggle">
                <Button
                  label={historyOpen ? "Hide history" : "Show history"}
                  tooltip={historyOpen ? "Hide history" : "History"}
                  variant={historyOpen ? "secondary" : "ghost"}
                  size="sm"
                  isIconOnly
                  icon={<Icon icon={ClockIcon} size="sm" />}
                  onClick={currentnessChrome.onToggleHistory}
                />
              </span>
            ) : null}
            <Button
              label="Open in Vault"
              tooltip="Open in Vault"
              variant="ghost"
              size="sm"
              isIconOnly
              icon={<Icon icon={FolderOpenIcon} size="sm" />}
              onClick={() => onOpenInVault(path)}
            />
            <Button
              label="Download document"
              tooltip="Download"
              variant="ghost"
              size="sm"
              isIconOnly
              icon={<Icon icon={ArrowDownTrayIcon} size="sm" />}
              onClick={() => onDownload(path)}
            />
            <Button
              label="Close document pane"
              tooltip="Close"
              variant="ghost"
              size="sm"
              isIconOnly
              icon={<Icon icon={XMarkIcon} size="sm" />}
              onClick={onClose}
            />
          </HStack>
        }
      />

      {currentness ? (
        <div
          className="chat-document-pane-currentness"
          data-testid="chat-document-pane-currentness"
          data-head-kind={currentness.headKind}
          data-operation-id={currentness.operationId}
          data-revision-token={currentness.revisionToken}
          data-actor-kind={currentness.actorKind ?? ""}
          style={stripStyle}
          role="status"
          aria-label="Document currentness"
        >
          <HStack gap={2} vAlign="center" style={{ flexWrap: "wrap" }}>
            <Text type="supporting" weight="semibold">
              {currentness.headKindLabel}
            </Text>
            <Text type="supporting" color="secondary" maxLines={1}>
              rev {currentness.revisionToken}
            </Text>
            <Text type="supporting" color="secondary" maxLines={1}>
              {currentness.operationId}
            </Text>
            <Text type="supporting" color="secondary" maxLines={1}>
              {currentness.actorLabel}
            </Text>
          </HStack>
          {currentness.isCheckpoint && currentness.sourcePath ? (
            <Text type="supporting" color="secondary" maxLines={1}>
              Checkpoint of {currentness.sourcePath}
            </Text>
          ) : null}
        </div>
      ) : null}

      {showStaleReload ? (
        <div
          className="chat-document-pane-stale"
          data-testid="chat-document-pane-stale"
          style={stripStyle}
          role="status"
        >
          <Banner
            status="info"
            title="Document updated"
            description="A newer revision is on the vault. Reload to see the current head."
          />
          <HStack gap={2} style={{ marginTop: 8 }}>
            <Button
              label="Reload to current head"
              variant="secondary"
              size="sm"
              onClick={onReload}
            />
          </HStack>
        </div>
      ) : null}

      {historyOpen && currentnessChrome ? (
        <ArtifactHistoryPanel
          path={path}
          events={currentnessChrome.historyEvents}
          isLoading={currentnessChrome.historyLoading}
          error={currentnessChrome.historyError}
          unavailable={currentnessChrome.historyUnavailable}
          truncated={currentnessChrome.historyTruncated}
        />
      ) : null}

      {showProgress ? (
        <div
          className="chat-document-pane-progress"
          data-testid="chat-document-pane-progress"
          data-coexist-editor={progressCoexistsWithEditor ? "true" : "false"}
          role="status"
          aria-live="polite"
          aria-busy="true"
          style={{
            ...stripStyle,
            // Never cover ONLYOFFICE chrome: strip stays in document flow above body.
            position: "relative",
            zIndex: 0,
          }}
        >
          <HStack gap={2} vAlign="center">
            <Spinner size="sm" aria-hidden />
            <VStack gap={0} style={{ minWidth: 0, flex: 1 }}>
              <Text type="supporting" maxLines={2}>
                {progressLabel(state)}
              </Text>
              {percent != null ? (
                <Text type="supporting" color="secondary">
                  {Math.round(percent)}%
                </Text>
              ) : null}
            </VStack>
          </HStack>
          {percent != null ? (
            <div
              style={progressBarTrackStyle}
              data-testid="chat-document-pane-progress-bar"
              aria-hidden
            >
              <div style={progressBarFillStyle(percent)} />
            </div>
          ) : null}
        </div>
      ) : null}

      {showCheckpointOffer && state.checkpointOffer ? (
        <div
          className="chat-document-pane-checkpoint"
          data-testid="chat-document-pane-checkpoint"
          style={stripStyle}
        >
          <Banner
            status="info"
            title="Agent checkpoint"
            description={state.checkpointOffer.message}
            isDismissable={Boolean(onDismissCheckpoint)}
            onDismiss={onDismissCheckpoint}
          />
          <HStack gap={2} style={{ marginTop: 8 }}>
            <Button
              label="Open agent checkpoint"
              variant="secondary"
              size="sm"
              onClick={onOpenCheckpoint}
              isDisabled={!onOpenCheckpoint}
            />
            <Text type="supporting" color="secondary" maxLines={1}>
              {state.checkpointOffer.ref.path}
            </Text>
          </HStack>
        </div>
      ) : null}

      {showConflict && state.conflict ? (
        <div
          className="chat-document-pane-conflict"
          data-testid="chat-document-pane-conflict"
          role="alert"
          data-conflict-reason={state.conflict.reason}
          style={stripStyle}
        >
          {/* Alias test id for document-key invalidation policy (lp-5q6.24). */}
          <div data-testid="document-pane-conflict-banner">
            <Banner
              status="warning"
              title={
                state.conflict.reason === "superseded_base"
                  ? "Document changed outside the editor"
                  : "Document conflict"
              }
              description={state.conflict.message}
            />
          </div>
          <HStack gap={2} style={{ marginTop: 8, flexWrap: "wrap" }}>
            {state.conflict.offeredActions.includes("open_checkpoint") &&
            canOpenCheckpoint ? (
              <Button
                label="Open agent checkpoint"
                variant="secondary"
                size="sm"
                onClick={onOpenCheckpoint}
                isDisabled={!onOpenCheckpoint}
              />
            ) : null}
            {state.conflict.offeredActions.includes("reload") ||
            state.conflict.offeredActions.includes("discard_local") ? (
              <span data-testid="document-pane-conflict-reload">
                <Button
                  label={
                    state.conflict.offeredActions.includes("discard_local")
                      ? "Discard local and reload"
                      : "Reload document"
                  }
                  variant="ghost"
                  size="sm"
                  onClick={
                    state.conflict.offeredActions.includes("discard_local")
                      ? (onDiscardLocal ?? onReload)
                      : onReload
                  }
                />
              </span>
            ) : null}
          </HStack>
        </div>
      ) : null}

      <div
        className="chat-document-pane-body"
        data-testid="chat-document-pane-body"
        data-renderer={useOfficeBody ? "onlyoffice" : "preview"}
        style={
          useOfficeBody ? documentPaneEditorBodyStyle : documentPaneBodyStyle
        }
      >
        {useOfficeBody && officeEditor ? (
          <OnlyOfficeEditorHost
            session={officeEditor.session}
            error={officeEditor.error}
            isLoading={officeEditor.isLoading}
            loadDocsApi={officeEditor.loadDocsApi}
            onReady={officeEditor.onReady}
            onDocumentReady={officeEditor.onDocumentReady}
            onError={officeEditor.onError}
            onDirtyChange={officeEditor.onDirtyChange}
            onSaveIssue={officeEditor.onSaveIssue}
            onRequestClose={
              officeEditor.onRequestClose ??
              editControls?.onExitEdit ??
              onClose
            }
          />
        ) : (
          <VaultReader
            content={content}
            isLoading={readerLoading}
            error={readerError}
          />
        )}
      </div>
    </aside>
  );
}
