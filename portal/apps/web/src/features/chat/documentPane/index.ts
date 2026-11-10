/**
 * Chat document pane: state machine, path resolution (lp-5q6.12),
 * preview shell host (lp-5q6.13), citation/tool-target routing (lp-5q6.14),
 * responsive / accessible chrome (lp-5q6.15), agent progress + checkpoints
 * (lp-5q6.16), pane metrics (lp-5q6.33), document key / revision
 * invalidation policy (lp-5q6.24), flag-gated ONLYOFFICE editor host
 * (lp-5q6.27), preview vs ONLYOFFICE renderer selection (lp-5q6.30),
 * and currentness / signed-operation history UX (lp-ye4.11).
 */

export {
  artifactPanelReducer,
  createInitialArtifactPanelState,
  samePanelProgress,
} from "./artifactPanelReducer.js";

export {
  normalizePaneVaultPath,
  resolvePaneArtifactRef,
  sameDocumentRevision,
  samePaneArtifactPath,
  type PanePathResolveFailure,
  type PanePathResolveOptions,
  type PanePathResolveResult,
  type PanePathResolveSuccess,
} from "./pathResolution.js";

export {
  detectChatOpenDocumentIntent,
  extractOfficeBasenameFromText,
  extractOfficePathOrBasenameFromText,
  extractOfficeVaultPathFromText,
  isOfficeBasenameToken,
  openDocumentIntentFromUserMessage,
  openDocumentPathAction,
  openToolTargetAction,
  panelActionsFromChatEvent,
  type ChatOpenDocumentIntent,
  type OpenDocumentPathOptions,
  type PanelActionsFromChatOptions,
} from "./chatArtifactRouting.js";

export {
  mapArtifactWireToPanelEvent,
  type ArtifactWireSource,
} from "./mapArtifactWire.js";

export {
  DocumentPaneShell,
  isDocumentPaneVisible,
  type DocumentPaneCurrentnessChrome,
  type DocumentPaneEditControls,
  type DocumentPaneLayoutMode,
  type DocumentPaneOfficeEditorSlot,
  type DocumentPaneShellProps,
} from "./DocumentPaneShell.js";

export {
  currentnessFromArtifactHead,
  evaluateStaleHead,
  filterHistoryEventsByAcl,
  formatCurrentnessActor,
  formatHistoryEventSummary,
  threadAccessGrantsVaultWrite,
  vaultAuthorityFromThreadAccess,
  type ArtifactHeadView,
  type CurrentnessActor,
  type CurrentnessDisplay,
  type HistoryEventView,
  type HistoryListView,
  type StaleHeadAction,
  type StaleHeadDecision,
  type ThreadAccessMode,
  type VaultAuthorityFromThread,
} from "./currentness.js";

export {
  useDocumentPaneCurrentness,
  type DocumentPaneCurrentness,
} from "./useDocumentPaneCurrentness.js";

export {
  ArtifactHistoryPanel,
  type ArtifactHistoryPanelProps,
} from "./ArtifactHistoryPanel.js";

export {
  resolveChatDocumentRenderer,
  type ChatDocumentRenderer,
  type ChatDocumentRendererDecision,
  type ChatDocumentRendererInput,
} from "./chatDocumentRenderer.js";

export {
  DocumentPaneHost,
  type DocumentPaneHostProps,
} from "./DocumentPaneHost.js";

export { DocumentPaneStory } from "./DocumentPaneStory.js";

export {
  OnlyOfficeEditorHost,
  type OnlyOfficeEditorHostProps,
} from "./OnlyOfficeEditorHost.js";

export {
  isOnlyOfficeEditorEnabled,
  getOnlyOfficeDocumentServerUrl,
  getTrustedDocumentServerAllowlist,
  validateOnlyOfficeDocumentServerUrl,
  parseDocumentServerOrigin,
  isLoopbackHostname,
  onlyOfficeApiScriptUrl,
  onlyOfficeScriptSrcCspSources,
  buildOnlyOfficeScriptSrcCsp,
  setOnlyOfficeProductionModeForTests,
  ONLYOFFICE_EDITOR_FLAG_NAME,
  type LanyardFeatureFlagsWindow,
  type DocumentServerUrlValidation,
} from "./onlyOfficeFeatureFlag.js";

export {
  isOfficeEditorFileType,
  isOfficeEditorPath,
  officeFileTypeFromPath,
  OFFICE_EDITOR_FILE_TYPES,
} from "./isOfficeEditorFile.js";

export {
  loadOnlyOfficeDocsApi,
  resetOnlyOfficeApiLoaderForTests,
} from "./onlyOfficeApiLoader.js";

export {
  officeEditorError,
  mapMintFailureToEditorError,
  mapSaveFailureToEditorError,
} from "./onlyOfficeEditorErrors.js";

export {
  mapOfficeSaveFailureToUserError,
  type OfficeSaveUserError,
  type OfficeSaveUserErrorCode,
} from "./officeSaveUserErrors.js";

export {
  officeEditorMetrics,
  OfficeEditorMetrics,
  type OfficeEditorLoadOutcome,
  type OfficeEditorMetricsSnapshot,
} from "./onlyOfficeEditorMetrics.js";

export {
  useOfficeEditorSession,
  type OfficeEditorSessionState,
  type UseOfficeEditorSessionOptions,
} from "./useOfficeEditorSession.js";

export type {
  DocsApiConstructor,
  DocsApiDocEditor,
  DocsApiGlobal,
  DocumentRevisionWire,
  OfficeEditorErrorCode,
  OfficeEditorHostError,
  OfficeEditorHostLifecycle,
  OfficeEditorSessionConfig,
  OfficeFileType,
  OfficeSessionMode,
  OnlyOfficeDocumentConfig,
  OnlyOfficeDocumentType,
  OnlyOfficeEditorConfig,
  OnlyOfficeEditorConfigInner,
  OnlyOfficePermissions,
} from "./onlyOfficeTypes.js";

export {
  clampDocumentPaneWidth,
  DOCUMENT_PANE_DEFAULT_WIDTH_PX,
  DOCUMENT_PANE_MAX_WIDTH_PX,
  DOCUMENT_PANE_MIN_WIDTH_PX,
  DOCUMENT_PANE_MOBILE_MAX_WIDTH_PX,
  DOCUMENT_PANE_RESIZE_AUTO_SAVE_ID,
  documentPaneBodyStyle,
  documentPaneDrawerStyle,
  documentPaneEditorBodyStyle,
  documentPaneStyle,
  documentPaneWidthVar,
  isDocumentPaneNarrow,
} from "./documentPaneLayout.js";

export {
  DOCUMENT_PANE_NARROW_MEDIA_QUERY,
  useDocumentPaneNarrow,
  type DocumentPaneLayoutPreference,
} from "./useDocumentPaneNarrow.js";

export { mapVaultPreviewError } from "./mapPreviewError.js";

export {
  paneMetrics,
  PaneMetrics,
  type PaneMetricKind,
  type PaneMetricsSnapshot,
} from "./paneMetrics.js";

export {
  buildSupersededBaseConflict,
  evaluateDocumentKeyInvalidation,
  shouldAutoRefreshOnRevisionAdvance,
  type DocumentKeyInvalidationAction,
  type DocumentKeyInvalidationDecision,
  type EvaluateDocumentKeyInvalidationInput,
} from "./documentKeyInvalidation.js";

export {
  useDocumentPanePreview,
  type DocumentPanePreview,
} from "./useDocumentPanePreview.js";

export {
  DOCUMENT_REOPEN_CHIP_MAX,
  documentReopenChipFromRef,
  shouldRecordDocumentReopenChip,
  upsertDocumentReopenChip,
  type DocumentReopenChip,
} from "./documentReopenChips.js";

export {
  DocumentReopenChipBar,
  type DocumentReopenChipBarProps,
} from "./DocumentReopenChipBar.js";

export type {
  ArtifactCloseEvent,
  ArtifactErrorCode,
  ArtifactErrorEvent,
  ArtifactEvent,
  ArtifactOpenEvent,
  ArtifactPanelAction,
  ArtifactPanelError,
  ArtifactPanelProgress,
  ArtifactPanelState,
  ArtifactPanelStatus,
  ArtifactProgressEvent,
  ArtifactUpdatedEvent,
  CheckpointOffer,
  ConflictOfferedAction,
  ConflictReason,
  ConflictState,
  DocumentRevision,
  PanelMode,
  VaultArtifactRef,
  VaultPath,
} from "./types.js";
