/**
 * @lanyard/backend-runtime
 *
 * Portal BFF boundary for swappable backend agents (backend-runtime-v1).
 * Pre-import monorepo scaffolding — package path is portal/packages/backend-runtime
 * so it coexists with the future Portal pnpm workspace import.
 */

export type { BackendRuntimeService } from "./service.js";
export {
  BACKEND_RUNTIME_SERVICE_METHODS,
  BACKEND_RUNTIME_SERVICE_OPTIONAL_METHODS,
  isBackendRuntimeService,
} from "./service.js";

export type {
  BackendCapabilitySet,
  BackendHealthChecks,
  BackendHealthResult,
  BackendHealthStatus,
  BackendHealthVersions,
  BackendKind,
  BackendProfileRef,
  BackendProject,
  BackendProjectFolder,
  BackendRuntimeContext,
  BackendRuntimeErrorCode,
  BackendRuntimeErrorDetails,
  CreateProjectInput,
  DeleteProjectInput,
  DeleteProjectResult,
  ListProjectsParams,
  ProjectsListResult,
  SettingsCron,
  SettingsCronSchedule,
  SettingsIntegration,
  SettingsMcpServer,
  SettingsModel,
  SettingsPatchInput,
  SettingsPatchOp,
  SettingsPatchResult,
  SettingsSkill,
  SettingsSnapshot,
  SettingsSnapshotParams,
  SettingsSnapshotSection,
  UiAffordanceState,
  DocumentRevision,
  DocumentRevisionKind,
  VaultEntry,
  VaultEntryKind,
  VaultListParams,
  VaultListResult,
  VaultReadParams,
  VaultReadResult,
  VaultStatParams,
  VaultWriteContentRef,
  VaultWriteCommitKind,
  VaultWriteCommitMetadata,
  VaultWriteKind,
  VaultWriteMode,
  VaultWriteParams,
  VaultWriteResult,
  HistoryListParams,
  HistoryListResult,
  HeadsArtifactParams,
  HeadsArtifactResult,
  HeadsWorkspaceParams,
  HeadsWorkspaceResult,
} from "./types.js";

export {
  BackendRuntimeError,
  backendRuntimeErrorToHttpStatus,
} from "./errors.js";

export {
  REQUIRED_BRAIN_RPC_METHODS,
  defaultCapabilitiesForKind,
  defaultHermesLanyardCapabilities,
} from "./capability-defaults.js";

export type {
  BrainRpcInvoker,
  HermesBackendRuntimeServiceOptions,
  HermesHealthPort,
  HermesProjectsPort,
  HermesSettingsPort,
  HermesVaultPort,
} from "./hermes-adapter.js";
export {
  HermesBackendRuntimeService,
  createHermesBackendRuntimeService,
  createProductionHermesBackendRuntimeService,
} from "./hermes-adapter.js";

export type {
  FakeBackendRuntimeOptions,
  FakeVaultFile,
  LanyardAgentFakeBackendOptions,
} from "./fake-backend.js";
export {
  FakeBackendRuntimeService,
  LANYARD_AGENT_FIXTURE_BACKEND_HOME,
  LANYARD_AGENT_FIXTURE_CRONS,
  createFakeBackendRuntimeService,
  createLanyardAgentFakeBackendRuntimeService,
} from "./fake-backend.js";

export type {
  FakeRuntimeLedgerOptions,
  LedgerCommitInput,
  LedgerCommitResult,
  LedgerMutationKind,
  LedgerRejectInput,
} from "./fake-runtime-ledger.js";
export {
  FakeRuntimeLedger,
  FakeRuntimeLedgerError,
  bodyHashFromContent,
  bodyHashFromUtf8,
  computeWorkspaceTreeRootHash,
  revisionFromUtf8,
} from "./fake-runtime-ledger.js";

// ---------------------------------------------------------------------------
// Host durable ledger + signing (lp-ye4.12 / phase 7)
// ---------------------------------------------------------------------------

export type {
  DurableLedgerMeta,
  DurableRuntimeLedgerOptions,
} from "./durable-runtime-ledger.js";
export {
  DURABLE_LEDGER_DIR_NAME,
  DURABLE_LEDGER_FILES,
  DurableRuntimeLedger,
  DurableRuntimeLedgerError,
  durableLedgerStateDir,
} from "./durable-runtime-ledger.js";

export type {
  CreateEd25519HostLedgerSignerOptions,
  GenerateHostLedgerKeyOptions,
  HostLedgerKeyPair,
  HostLedgerKeyRing,
  HostLedgerSigner,
  LedgerSignedField,
} from "./ledger-signing.js";
export {
  DEFAULT_LEDGER_SIGNED_FIELDS,
  LedgerSigningError,
  canonicalizeJson,
  canonicalizeSignedOperationEvent,
  createEd25519HostLedgerSigner,
  createHostLedgerKeyRing,
  createNoneHostLedgerSigner,
  exportHostLedgerKeyPairDer,
  generateHostLedgerKeyPair,
  hostSignObservedEvent,
  importHostLedgerPrivateKey,
  importHostLedgerPublicKey,
  rotateHostLedgerActiveKey,
  unsignedLedgerEnvelope,
} from "./ledger-signing.js";

export type {
  FakeBrainRpcInvoker,
  FakeBrainRpcOptions,
} from "./fake-brain-rpc.js";
export {
  FAKE_BRAIN_RPC_EXPANSION_METHODS,
  assertRequiredBrainRpcMethods,
  createFakeBrainRpcInvoker,
} from "./fake-brain-rpc.js";

export type {
  AgentProjectCreateHttpBody,
  AgentProjectsListHttpBody,
  CreateAgentProjectOptions,
  ListAgentProjectsOptions,
  ProjectsCreateWireInput,
} from "./projects-bff.js";
export {
  PROJECTS_CREATE_METHOD,
  PROJECTS_CREATE_NAME_MAX,
  PROJECTS_DELETE_METHOD,
  PROJECTS_LIST_METHOD,
  agentProjectsErrorToHttp,
  backendContextFromSession,
  createAgentProject,
  createAgentProjectsHandlers,
  deleteAgentProject,
  listAgentProjects,
  parseProjectsCreateInput,
  projectsCreateIsAdvertised,
  toAgentProjectsListHttpBody,
} from "./projects-bff.js";

export type {
  GetSettingsSnapshotOptions,
  PatchSettingsOptions,
  SettingsCronCreateHttpBody,
  SettingsCronPatchHttpBody,
  SettingsHttpErrorBody,
  SettingsMcpPatchHttpBody,
  SettingsModelPatchHttpBody,
  SettingsSkillPatchHttpBody,
  SettingsSnapshotHttpBody,
} from "./settings-bff.js";
export {
  CRON_CREATE_METHOD,
  CRON_LIST_METHOD,
  CRON_PATCH_METHOD,
  CRON_UPDATE_METHOD,
  MODELS_SET_ACTIVE_METHOD,
  SETTINGS_PATCH_ID_MAX,
  SETTINGS_PATCH_METHOD,
  SETTINGS_PATCH_MODEL_MAX,
  SETTINGS_PATCH_PROMPT_MAX,
  SETTINGS_SNAPSHOT_METHOD,
  applySettingsPatch,
  assertNoSettingsSecrets,
  createSettingsCron,
  createSettingsHandlers,
  cronCreateUpdateIsAdvertised,
  cronPatchIsAdvertised,
  getSettingsSnapshot,
  isSettingsSecretField,
  modelPatchIsAdvertised,
  parseCronScheduleInput,
  parseSettingsPatchInput,
  patchSettingsActiveModel,
  patchSettingsCron,
  patchSettingsMcp,
  patchSettingsSkill,
  settingsErrorToHttp,
  settingsPatchInputToWireParams,
  settingsPatchIsAdvertised,
  toSettingsSnapshotHttpBody,
  validateSettingsPatchAgainstConfigSchema,
} from "./settings-bff.js";

export type {
  ContextHttpErrorBody,
  FeatureFlagName,
  GetPortalContextOptions,
  PortalContextHttpBody,
  PortalUiCanFlags,
  PortalUiState,
  UiAffordanceName,
  UiAffordanceRequirement,
} from "./capabilities-bff.js";
export {
  BRAIN_CAPABILITIES_METHOD,
  FEATURE_FLAG_NAMES,
  UI_AFFORDANCE_CATALOG,
  UI_AFFORDANCE_NAMES,
  contextErrorToHttp,
  createContextHandlers,
  deriveUiAffordanceState,
  deriveUiAffordances,
  getBackendCapabilities,
  getPortalContext,
  isAffordanceSupported,
  isAffordanceUnsupported,
  normalizeCapabilityDescriptor,
  uiStateFromAffordances,
  uiStateFromCapabilities,
  withDerivedUiAffordances,
} from "./capabilities-bff.js";

export type {
  GetVaultTreeOptions,
  ListVaultEntriesOptions,
  VaultContentHttpBody,
  VaultEntriesHttpBody,
  VaultHttpErrorBody,
  VaultTreeHttpBody,
  VaultTreeHttpNode,
  VaultWriteHttpBody,
  VaultWriteOrigin,
  WriteVaultOptions,
} from "./vault-bff.js";
export {
  VAULT_LIST_METHOD,
  VAULT_LIST_PAGE_LIMIT,
  VAULT_READ_METHOD,
  VAULT_STAT_METHOD,
  VAULT_TREE_MAX_DEPTH,
  VAULT_TREE_MAX_NODES,
  VAULT_WRITE_IDEMPOTENCY_KEY_MAX,
  VAULT_WRITE_INLINE_DEFAULT_MAX_BYTES,
  VAULT_WRITE_INLINE_HARD_MAX_BYTES,
  VAULT_WRITE_METHOD,
  assertVaultRelativeWritePath,
  createVaultHandlers,
  filterVaultEntriesByAcl,
  filterVaultTreeByAcl,
  getVaultTree,
  isVaultPathAllowedByPrefixes,
  listVaultEntries,
  normalizeVaultWirePath,
  parseAgentVaultWriteBody,
  parseBrowserVaultWriteBody,
  parseCallbackVaultWriteBody,
  readVaultContent,
  resolveAclPrefixes,
  statVaultPath,
  vaultErrorToHttp,
  vaultWriteInputToWireParams,
  vaultWriteIsAdvertised,
  writeVaultContent,
  writeVaultFromBrowser,
  writeVaultFromCallback,
} from "./vault-bff.js";


export type {
  ArtifactHeadHttpBody,
  HistoryHttpErrorBody,
  HistoryListHttpBody,
  ListArtifactHistoryOptions,
  ReadHeadsOptions,
  WorkspaceHeadHttpBody,
} from "./history-bff.js";
export {
  HEADS_ARTIFACT_METHOD,
  HEADS_WORKSPACE_METHOD,
  HISTORY_LIST_DEFAULT_LIMIT,
  HISTORY_LIST_MAX_LIMIT,
  HISTORY_LIST_METHOD,
  clampHistoryLimit,
  createHistoryHandlers,
  getArtifactHeadRead,
  getWorkspaceHeadRead,
  headsArtifactIsAdvertised,
  headsArtifactParamsToWire,
  headsReadIsAdvertised,
  headsWorkspaceIsAdvertised,
  headsWorkspaceParamsToWire,
  historyErrorToHttp,
  historyListIsAdvertised,
  historyListParamsToWire,
  listArtifactHistory,
  normalizeHistoryListWireResult,
} from "./history-bff.js";

// ---------------------------------------------------------------------------
// Signed operation ledger domain (lp-ye4.5 / multiplayer versioning)
// ---------------------------------------------------------------------------

export type {
  ActorKind,
  ArtifactHead,
  ArtifactHeadKind,
  BodyHash,
  OperationActor,
  OperationId,
  OperationKind,
  OperationMeta,
  OperationResult,
  OperationResultReason,
  OperationResultStatus,
  OperationSignature,
  OperationTarget,
  OperationTargetScope,
  SignatureAlgorithm,
  SignedOperationEvent,
  SignedOperationRecord,
  VaultWriteLedgerKind,
  WorkspaceHead,
} from "./signed-operation.js";
export {
  ARTIFACT_HEAD_RECORD_TYPE,
  SIGNED_OPERATION_RECORD_TYPE,
  SIGNED_OPERATION_SCHEMA_VERSION,
  SignedOperationParseError,
  WORKSPACE_HEAD_RECORD_TYPE,
  isArtifactHead,
  isSignedOperationEvent,
  isWorkspaceHead,
  parseSignedOperationEventOnly,
  parseSignedOperationRecord,
  safeParseSignedOperationRecord,
  vaultWriteModeToOperationKind,
} from "./signed-operation.js";

// ---------------------------------------------------------------------------
// Access grants + unknown-agent identity (lp-ye4.9)
// ---------------------------------------------------------------------------

export type {
  AccessGrant,
  AccessGrantDenialReason,
  AccessGrantTrustConfig,
  AccessGrantValidationRequest,
  AccessGrantValidationResult,
  GrantCapability,
  GrantId,
  GrantSignature,
  GrantSignatureAlgorithm,
  GrantSubject,
} from "./access-grant.js";
export {
  ACCESS_GRANT_RECORD_TYPE,
  ACCESS_GRANT_SCHEMA_VERSION,
  AccessGrantParseError,
  actorFromGrant,
  actorFromHumanSession,
  actorFromSystem,
  grantAllowsCapability,
  grantAllowsPath,
  parseAccessGrant,
  safeParseAccessGrant,
  validateAccessGrant,
} from "./access-grant.js";

export {
  FORBIDDEN_CLIENT_AUTHORITY_FIELDS,
  assertNoClientAuthorityFields,
  backendContextFromValidatedGrant,
  createOfflineGrantTrustConfig,
  grantDenialToErrorCode,
  stampContextFromAccessGrant,
  validateAccessGrantAtBoundary,
} from "./access-grant-bff.js";
