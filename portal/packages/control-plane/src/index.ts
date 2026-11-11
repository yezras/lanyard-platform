export {
  createApp,
  INTERNAL_OPS_TOKEN_HEADER,
  type ControlPlaneAppOptions,
} from "./app.js";
export {
  isPublicUnauthenticatedPath,
  isUserAuthPath,
  resolveAuthMode,
  type ControlPlaneAuthMode,
} from "./auth-mode.js";
export {
  assertProductionServiceToken,
  CONTROL_PLANE_SERVICE_TOKEN_HEADER,
  DEV_CONTROL_PLANE_SERVICE_TOKEN,
  isDevServiceToken,
  requireServiceToken,
  resolveServiceToken,
  serviceTokenMatches,
} from "./service-auth.js";
export {
  AGENT_SNAPSHOT_ID_MAX_LENGTH,
  assertDaytonaConfigReady,
  DAYTONA_DOMAIN_ALLOWLIST_ENTRY_MAX_LENGTH,
  DAYTONA_ENV,
  DAYTONA_WEB_SEARCH_DOMAIN_ALLOWLIST,
  DEFAULT_DAYTONA_AUTO_STOP_INTERVAL_MINUTES,
  daytonaConfigLogSummary,
  daytonaConfigMissingKeys,
  DaytonaConfigError,
  formatDaytonaDomainAllowList,
  isDaytonaConfigReady,
  isDaytonaFailClosedEnv,
  isOfflineAgentSnapshotPlaceholder,
  isTenantOnDaytonaAllowlist,
  isValidAgentSnapshotPinShape,
  isValidDaytonaDomainAllowListEntry,
  loadDaytonaConfig,
  mergeDaytonaWebSearchDomainAllowList,
  OFFLINE_AGENT_SNAPSHOT_PLACEHOLDER,
  parseDaytonaDomainAllowList,
  parseEnvFlag,
  parseNonNegativeIntEnv,
  parseRetainSandboxOnStopEnv,
  resolveAgentSnapshotId,
  resolveDaytonaAutoStopIntervalMinutes,
  resolveWarmPoolSize,
  type DaytonaConfig,
  type DaytonaConfigLogSummary,
} from "./daytona-config.js";
/** Daytona managed client interface + fake (lp-7v5). No live SDK offline. */
export {
  DAYTONA_SANDBOX_STATES,
  DaytonaClientError,
  DaytonaSandboxNotFoundError,
  DaytonaSandboxStateError,
  isDaytonaClient,
  type CreateSandboxParams,
  type DaytonaClient,
  type DaytonaMountSpec,
  type DaytonaSandbox,
  type DaytonaSandboxState,
  type ListSandboxesFilter,
} from "./daytona-client.js";
/** In-process warm pool claim + replenish (lp-vqr0.10 / T2). RealDaytona in tests. */
export {
  clampWarmPoolSize,
  createInMemoryWarmPool,
  DEFAULT_WARM_POOL_SIZE,
  MAX_WARM_POOL_SIZE,
  replenishWarmPool,
  scheduleWarmPoolReplenishOffStack,
  WARM_POOL_LABEL_KEY,
  WARM_POOL_LABEL_VALUE,
  type WarmPool,
  type WarmPoolClaimResult,
  type WarmPoolEntry,
  type WarmPoolReplenishResult,
} from "./warm-pool.js";
/** Real managed-Daytona HTTP client (lp-012). Injectable fetch for unit tests. */
export {
  createDaytonaSdkClient,
  DAYTONA_AUTH_HEADER,
  DAYTONA_ORG_HEADER,
  DEFAULT_DAYTONA_API_BASE_URL,
  DEFAULT_DAYTONA_REQUEST_TIMEOUT_MS,
  DaytonaHttpError,
  DaytonaSdkClient,
  DaytonaTimeoutError,
  type DaytonaSdkClientOptions,
  type DaytonaSdkLogEvent,
} from "./daytona-sdk-client.js";
/** Daytona toolbox process/execute client + argv log redaction (lp-oop.24). */
export {
  createDaytonaToolboxClient,
  DEFAULT_DAYTONA_TOOLBOX_BASE_URL,
  DEFAULT_DAYTONA_TOOLBOX_HTTP_SLACK_MS,
  DaytonaToolboxClient,
  joinToolboxArgv,
  type DaytonaToolboxClientOptions,
  type DaytonaToolboxLogEvent,
} from "./daytona-toolbox-client.js";
/**
 * Daytona toolbox process-session client (lp-oop.38.19).
 * Vault stdio MCP JSON-RPC. Never process/execute.
 */
export {
  createDaytonaToolboxSessionClient,
  DEFAULT_DAYTONA_SESSION_HTTP_TIMEOUT_MS,
  DaytonaToolboxSessionClient,
  type DaytonaToolboxSessionClientOptions,
  type DaytonaToolboxSessionLogEvent,
} from "./daytona-toolbox-session-client.js";
/**
 * Short-stack tool-only create-env denylist (lp-oop.28 / lp-oop.38.12 / lp-oop.38.17).
 * Guest must not receive provider keys, GATEWAY_RELAY_SECRET, harness HTTP
 * search keys (TAVILY / BRAVE / FIRECRAWL / X_BEARER_TOKEN), or MCP secrets.
 */
export {
  DEFAULT_SANDBOX_CREATE_PROFILE,
  SANDBOX_CREATE_PROFILES,
  SHORT_STACK_CREATE_ENV_DENYLIST,
  SHORT_STACK_CREATE_ENV_HTTP_KEYS,
  ShortStackCreateEnvError,
  applyShortStackCreateEnvInvariants,
  assertShortStackCreateEnv,
  isMcpSecretCreateEnvKey,
  isSandboxCreateProfile,
  isShortStackDeniedCreateEnvKey,
  listShortStackDeniedCreateEnvKeys,
  parseSandboxCreateProfile,
  stripShortStackDeniedCreateEnv,
  type SandboxCreateProfile,
  type ShortStackDeniedCreateEnvKey,
} from "./short-stack-create-env.js";
/** Daytona create/GET env redaction for logs (lp-pec.1). Pure; for lp-012 parse path. */
export {
  DAYTONA_ENV_REDACTED,
  DAYTONA_KNOWN_SECRET_ENV_KEYS,
  daytonaEnvLogSummary,
  fingerprintSecretValue,
  isDaytonaSecretEnvKey,
  parseDaytonaSandboxApiBody,
  redactDaytonaApiResponseForLog,
  redactDaytonaEnvMap,
  withDaytonaResponseRedaction,
  type DaytonaEnvLogSummary,
  type DaytonaEnvMap,
  type DaytonaSecretEnvLogEntry,
  type ParsedDaytonaSandboxApiBody,
} from "./daytona-env-redact.js";
export {
  createInMemoryOrchestratorInstanceStore,
  createInstanceOrchestrator,
  DEFAULT_ENSURE_ONLINE_WAIT_TIMEOUT_MS,
  DEFAULT_IDLE_GRACE_MS,
  DEFAULT_SPINE_HOT_WINDOW_MS,
  DEFAULT_MID_TURN_MAX_HOLD_MS,
  DEFAULT_VAULT_ENV_MAX_AGE_MS,
  DEFAULT_VAULT_MOUNT_PATH,
  EnsureBoundStoppedSandboxError,
  EnsureOnlineTimeoutError,
  EnsureOnlineWakeError,
  isMidTurnLockActive,
  OrchestratorInstanceNotFoundError,
  type OrchestratorComputeWakePath,
  OrchestratorInstanceRevokedError,
  resolveMidTurnPatch,
  resolveSpineHotWindowPatch,
  type IdleReaperResult,
  type InstanceOrchestrator,
  type InstanceOrchestratorDeps,
  type OrchestratorInstancePatch,
  type OrchestratorInstanceRecord,
  type OrchestratorInstanceStore,
  type ReapIdleOptions,
  type SetMidTurnOptions,
  type SetMidTurnResult,
  type WaitVaultWritableRequest,
  type WaitVaultWritableResult,
} from "./instance-orchestrator.js";
/**
 * Pure tenant+user → instance_id resolver (lp-oop.18 / plan 0015 phase 5).
 * Does not wake. HTTP POST …/users/:userId/ensure-online is lp-oop.19.
 */
export {
  INSTANCE_SCOPES,
  InvalidSandboxKeyError,
  isInstanceScope,
  NoResolvableInstanceError,
  parseSandboxKey,
  requireInstanceIdForUser,
  resolveInstanceIdForUser,
  tenantPrimaryRecord,
  userScopeRecord,
  type InstanceScope,
  type ResolveInstanceIdErr,
  type ResolveInstanceIdOk,
  type ResolveInstanceIdResult,
  type ResolveInstanceSource,
  type SandboxKey,
  type ScopedInstanceRecord,
} from "./resolve-instance.js";
/** Provider / model API keys for Daytona cold-create inject (Bucket C). */
export {
  PROVIDER_WAKE_ENV_KEYS,
  applyProviderWakeEnvToCreateParams,
  buildProviderWakeEnv,
  type ProviderWakeEnvKey,
} from "./provider-wake-env.js";
/** Class B tenant provider secrets for the ops console (lp-2qs.4). */
export {
  parseProviderSecretSlotOrThrow,
  type TenantProviderSecretStatus,
} from "./provider-secrets.js";
export type { TenantProviderSecretSource } from "./instance-orchestrator.js";
/** Class C tenant-principal registry secrets; harness attach, never guest (lp-hdzm.24). */
export {
  CLASS_C_AUTH_KINDS,
  CLASS_C_FORBIDDEN_FIRST_CLASS_IDS,
  CONNECTOR_SURFACE_IDS,
  ClassCFirstClassConnectorError,
  ClassCKmsNotConfiguredError,
  ClassCSecretNotFoundError,
  InvalidClassCAuthKindError,
  InvalidClassCSecretValueError,
  InvalidConnectorSurfaceError,
  isConnectorSurfaceId,
  parseClassCAuthKind,
  parseClassCConnectorId,
  parseClassCSecretPayload,
  parseConnectorSurfaceId,
  type ClassCAuthKind,
  type ClassCSecretPayload,
  type ClassCSecretStatus,
  type ConnectorSurfaceId,
} from "./class-c-secrets.js";
export {
  CLASS_C_AUTHORIZATION_HEADER,
  CLASS_C_GUEST_TOKEN_PATHS,
  ClassCGuestInjectError,
  ClassCWakeEnvError,
  applyClassCHarnessHttp,
  assertClassCNotInProviderWakeEnv,
  assertClassCNotOnGuestFs,
  attachClassCAuthorization,
  authorizationValueFor,
  buildClassCHttpAttach,
  classCTokenFromAttach,
  redactClassCHeaders,
  redactClassCHttpRequest,
  refuseClassCGuestInject,
  sendClassCHttp,
  stripSecretFieldsFromToolSchema,
  toolSchemaHasSecretFields,
  type ClassCFetch,
  type ClassCHttpAttach,
  type ClassCHttpRequest,
  type ClassCHttpResponse,
} from "./class-c-attach.js";
/** OpenAPI fromSpec adapter (lp-hdzm.25). */
export {
  ARG_LOCATIONS,
  InvalidOpenApiCallError,
  InvalidOpenApiSpecError,
  NATIVE_TOOL_CAP,
  OPENAPI_SKIP_REASONS,
  SUPPORTED_HTTP_METHODS,
  buildOpenApiRequest,
  callOpenApiTool,
  fromCompiledSurface,
  fromSpec,
  type ArgLocation,
  type FromSpecExposed,
  type FromSpecRefusedOverCap,
  type FromSpecResult,
  type JsonSchemaObject,
  type OpenApiSkipReason,
  type OpenApiTool,
  type SkippedOperation,
  type SupportedHttpMethod,
} from "./openapi-adapter.js";
/** Remote MCP streamable-http adapter (lp-hdzm.26). SSE-only refused. */
export {
  connectRemoteMcp,
  defaultRemoteMcpFetch,
  isRemoteMcpTransport,
  isSseOnlyRemoteMcpTransport,
  MCP_TOOL_NAMESPACE_SEP,
  namespaceRemoteMcpTool,
  REMOTE_MCP_OAUTH_NOT_IMPLEMENTED,
  REMOTE_MCP_PROTOCOL_VERSION,
  REMOTE_MCP_TRANSPORT,
  remoteMcpToolTree,
  RemoteMcpNeedsAuthError,
  InvalidRemoteMcpToolNameError,
  SSE_ONLY_REMOTE_MCP_TRANSPORTS,
  unnamespaceRemoteMcpTool,
  type RemoteMcpConnectResult,
  type RemoteMcpSession,
  type RemoteMcpSurface,
  type RemoteMcpTool,
  type RemoteMcpToolTree,
  type RemoteMcpTransport,
  type SseOnlyRemoteMcpTransport,
} from "./remote-mcp-adapter.js";
/** Member subset omit + fail-closed harness dispatch (lp-hdzm.27). */
export {
  FIRST_CLASS_CLI_BINS,
  FIRST_CLASS_CLI_CONNECTOR,
  FIRST_CLASS_CLI_FOR_CONNECTOR,
  HARNESS_TOOL_DENY_REASONS,
  HarnessToolForbiddenError,
  assertHarnessToolAllowed,
  authorizeHarnessToolCall,
  dispatchHarnessFirstClassCli,
  dispatchHarnessOpenApiTool,
  filterHarnessExposedTools,
  harnessToolCallerFrom,
  isFirstClassCliBin,
  listHarnessExposedTools,
  parseHarnessConnectorId,
  parseHarnessToolRef,
  type FirstClassCliBin,
  type HarnessExposedTool,
  type HarnessToolAuthorizeDenied,
  type HarnessToolAuthorizeOk,
  type HarnessToolAuthorizeResult,
  type HarnessToolCaller,
  type HarnessToolDenyReason,
  type HarnessToolRef,
} from "./harness-tool-dispatch.js";
/** Mock Lab Stripe 6-tuple residual (lp-hdzm.31). */
export {
  MOCK_LAB_STRIPE_CONNECTOR_ID,
  MOCK_LAB_STRIPE_DOMAIN,
  MOCK_LAB_STRIPE_MCP_TOOL,
  MOCK_LAB_STRIPE_OPENAPI_SIX_TUPLE,
  MOCK_LAB_STRIPE_OPENAPI_SPEC,
  MOCK_LAB_STRIPE_OPENAPI_TOOL,
  MOCK_LAB_STRIPE_PASTE,
  MOCK_LAB_STRIPE_PRINCIPAL,
  MOCK_LAB_TENANT_SLUG,
  MockLabStripeSixTupleError,
  assertOneRemoteSurface,
  mockLabStripeConnectorId,
  mockLabStripeOpenApiSnapshot,
  parseMockLabStripeSixTuple,
  parseMockLabStripeSurface,
  publicSixTuple,
  surfaceIdForTuple,
  type MockLabStripeMcpSurface,
  type MockLabStripeOpenApiSurface,
  type MockLabStripeSixTuple,
  type MockLabStripeSurface,
} from "./mocklab-stripe-six-tuple.js";
export {
  MOCK_LAB_STRIPE_RESIDUAL_BEAD,
  proveMockLabStripeResidual,
  stripeResidualPassed,
  type MockLabStripeResidualChecks,
  type MockLabStripeResidualEvidence,
  type MockLabStripeResidualInput,
} from "./mocklab-stripe-residual.js";
/** Orchestrator wake latency / failures / concurrent sandboxes (lp-77d). */
export {
  buildOrchestratorSafeLogFields,
  classifyOrchestratorFailure,
  ORCHESTRATOR_FORBIDDEN_LOG_KEYS,
  ORCHESTRATOR_LATENCY_BUCKETS,
  OrchestratorMetrics,
  orchestratorLatencyBucket,
  orchestratorMetrics,
  scrubOrchestratorLogFields,
  type OrchestratorFailureReason,
  type OrchestratorLatencyBucket,
  type OrchestratorMetricEvent,
  type OrchestratorMetricsSnapshot,
  type OrchestratorSafeLogFields,
  type OrchestratorWakeOutcome,
  type OrchestratorWakePath,
  type RecordStopInput,
  type RecordWakeInput,
} from "./orchestrator-metrics.js";
/**
 * Frozen 0017 RealDaytona SLO harness (lp-vqr0.5 / T9).
 * Fake clock only. Changing buckets requires updating
 * docs/plans/0017-sandbox-first-chat-speed/testing.md.
 */
export {
  FakeClock,
  formatSloHistogram,
  isSloWakePath,
  runSloHarness,
  SLO_FAKE_COSTS_MS,
  SLO_HARNESS_SAMPLES_PER_PATH,
  SLO_LATENCY_BUCKETS,
  SLO_START_FROM_STOPPED_BUDGET_MS,
  SLO_WAKE_PATHS,
  summarizeSloSamples,
  type SloHarnessReport,
  type SloLatencyBucket,
  type SloPathHistogram,
  type SloSample,
  type SloWakePath,
} from "./slo-harness.js";
/** ensure_online wake rate limits / abuse controls (lp-rq1). */
export {
  createWakeRateLimiter,
  DEFAULT_WAKE_RATE_LIMIT_WINDOW_MS,
  ENSURE_ONLINE_RATE_LIMIT_ENV,
  EnsureOnlineRateLimitedError,
  isWakeRateLimitConfigEnabled,
  normalizeWakeRateLimitConfig,
  resolveWakeRateLimitConfig,
  type WakeRateLimitConfig,
  type WakeRateLimitDecision,
  type WakeRateLimiter,
  type WakeRateLimiterOptions,
  type WakeRateLimitScope,
} from "./wake-rate-limit.js";
/** Relay presence port + fake + HTTP adapter (lp-rr5). */
export {
  createHttpRelayPresence,
  DEFAULT_RELAY_CONNECT_POLL_INTERVAL_MS,
  DEFAULT_RELAY_CONNECT_TIMEOUT_MS,
  FakeRelayPresence,
  isRelayPresence,
  RELAY_CONNECT_RECREATE_ATTEMPTS,
  waitForRelayConnected,
  type FakeRelayPresenceOptions,
  type HttpRelayPresenceOptions,
  type RelayConnectedStatus,
  type RelayPresence,
  type WaitForRelayConnectedOptions,
} from "./relay-presence.js";
/** Relay credentials push after register/rotate (lp-3a1.3). */
export {
  createHttpRelayCredentialsNotifier,
  isRelayCredentialsNotifier,
  RELAY_INTERNAL_TOKEN_HEADER as RELAY_CREDENTIALS_INTERNAL_TOKEN_HEADER,
  resolveRelayInternalBaseUrl,
  type HttpRelayCredentialsOptions,
  type RelayCredentialsNotifier,
  type RelayCredentialsUpsertInput,
  type RelayCredentialsUpsertResult,
} from "./relay-credentials.js";
/** Idle reaper job/loop: stop sandboxes past 30 min grace (lp-0y3). */
export {
  createIdleReaperJob,
  DEFAULT_IDLE_REAPER_INTERVAL_MS,
  IDLE_REAPER_GRACE_ENV,
  IDLE_REAPER_INTERVAL_ENV,
  parsePositiveMsEnv,
  resolveIdleReaperEnv,
  type IdleReaperJob,
  type IdleReaperJobDeps,
  type IdleReaperLogEvent,
  type IdleReaperTimers,
} from "./idle-reaper.js";
/**
 * Platform scheduled-task fire path (lp-jzl.7): ensure_online → mid_turn →
 * agent job run → clear mid_turn; durable job registry survives idle stop.
 * Schedule evaluator (lp-jzl.10.2) calls fireScheduledTask.
 */
export {
  createInMemoryScheduledTaskJobRegistry,
  fireScheduledTask,
  isPortalThreadDeliver,
  PORTAL_THREAD_DELIVER,
  ScheduledTaskInstanceMismatchError,
  ScheduledTaskJobDisabledError,
  ScheduledTaskJobNotFoundError,
  type AgentJobRunResult,
  type AgentJobRunner,
  type FireScheduledTaskDeps,
  type FireScheduledTaskInput,
  type FireScheduledTaskResult,
  type JobStreamBinding,
  type ScheduledTaskCronSchedule,
  type ScheduledTaskFireOrchestrator,
  type ScheduledTaskJobDefinition,
  type ScheduledTaskJobPatch,
  type ScheduledTaskJobRegistry,
  type ScheduledTaskOnceSchedule,
  type ScheduledTaskSchedule,
} from "./scheduled-task-fire.js";
/**
 * Short-stack scheduled-task fire via harness HTTP turn (lp-oop.38.8).
 * Vault jobs.json is the durable SoT; guest cron ticker is not required.
 */
export {
  buildHarnessScheduledTaskTurn,
  createHarnessScheduledTaskRunner,
  fireScheduledTaskHarnessTurn,
  HARNESS_SCHEDULED_TASK_CREATE_PROFILE,
  HARNESS_SCHEDULED_TASK_DELIVER,
  resolveHarnessScheduledTaskIdentity,
  type FireScheduledTaskHarnessDeps,
  type FireScheduledTaskHarnessResult,
  type HarnessScheduledTaskIdentity,
  type HarnessScheduledTaskTurn,
  type StartHarnessScheduledTaskTurn,
} from "./scheduled-task-harness-fire.js";
/**
 * User-principal connectors on scheduled tasks (lp-xhf4.13).
 * Tenant cron cannot hold Gmail/HubSpot/WhatsApp.
 */
export {
  USER_PRINCIPAL_CONNECTOR_IDS,
  TenantCronUserConnectorError,
  bindScheduledTaskConnectorNeed,
  createScheduledTaskConnectorFireHooks,
  detectUserPrincipalConnectors,
  injectScheduledTaskConnectors,
  isDraftOnlyGwsJob,
  resolveScheduledTaskFireTarget,
  scheduledTaskConnectorNeedFromJob,
  stampScheduledTaskConnectorBinding,
  type ScheduledTaskConnectorFireHooks,
  type ScheduledTaskConnectorFirePorts,
  type ScheduledTaskConnectorHints,
  type ScheduledTaskConnectorJob,
  type ScheduledTaskConnectorNeed,
  type ScheduledTaskFireTarget,
  type UserPrincipalConnectorId,
} from "./scheduled-task-connectors.js";
/** Durable scheduled jobs under the tenant S3 vault (lp-oop.38.8). */
export {
  createScheduledJobRegistryFromVaultStore,
  createVaultScheduledJobStore,
  VAULT_SCHEDULED_JOBS_RELATIVE_PATH,
  vaultScheduledJobsObjectKey,
  type CreateVaultScheduledJobStoreOptions,
  type VaultScheduledJobRegistryBindings,
  type VaultScheduledJobStore,
} from "./vault-scheduled-job-store.js";
/**
 * Chat `scheduled_task` create → the same vault jobs.json fire reads
 * (lp-oop.38.16). No guest ticker.
 */
export {
  createVaultJobFromHarnessScheduledTaskTool,
  HARNESS_SCHEDULED_TASK_TOOL_NAME,
  HarnessScheduledTaskCreateError,
  newHarnessScheduledTaskJobId,
  parseHarnessScheduledTaskSchedule,
  putHarnessScheduledTaskCreate,
  type HarnessScheduledTaskCreateInput,
  type ParseHarnessScheduledTaskScheduleOptions,
} from "./harness-scheduled-task-create.js";
/**
 * Platform schedule evaluator + fire trigger (lp-jzl.10.2).
 * Scans durable registry for due jobs (fake clock); fires via fireScheduledTask
 * so offline instances get ensure_online. Not guest-only ticker.
 */
export {
  computeNextRunAt,
  createFireJobRegistryFromPlatformSoT,
  createScheduleEvaluatorJob,
  DEFAULT_SCHEDULE_EVALUATOR_INTERVAL_MS,
  evaluateDueScheduledJobs,
  isScheduledJobDue,
  nextCronOccurrenceUtc,
  parseScheduleEvaluatorEnabledEnv,
  parseScheduleEvaluatorIntervalEnv,
  resolveScheduleEvaluatorEnv,
  SCHEDULE_EVALUATOR_ENABLED_ENV,
  SCHEDULE_EVALUATOR_INTERVAL_ENV,
  toScheduledTaskJobDefinition,
  type EvaluateDueScheduledJobsDeps,
  type ScheduleEvaluatorJob,
  type ScheduleEvaluatorJobDeps,
  type ScheduleEvaluatorLogEvent,
  type ScheduleEvaluatorPassResult,
  type ScheduleEvaluatorTimers,
} from "./schedule-evaluator.js";
/**
 * Orchestrator S3 vault mount create/start params (lp-hjo).
 * Maps s3_vault_prefix → VAULT_ROOT; path matches gateway entrypoint default.
 */
export {
  applyVaultMountToCreateParams,
  buildDaytonaCreateVolumes,
  buildSandboxVaultMountParams,
  DEFAULT_DAYTONA_VAULT_ROOT,
  GATEWAY_ENV_LANYARD_VAULT_BUCKET,
  GATEWAY_ENV_S3_VAULT_PREFIX,
  GATEWAY_ENV_VAULT_ROOT,
  mountsToDaytonaCreateVolumes,
  normalizeS3VaultPrefix,
  resolveDaytonaVaultRoot,
  SandboxVaultMountError,
  vaultRootMatchesMount,
  type BuildSandboxVaultMountInput,
  type DaytonaCreateVolumeMount,
  type SandboxVaultMountParams,
} from "./sandbox-vault-mount.js";
/**
 * Short-lived STS AWS_* mount creds for Daytona wake inject (lp-zuh.9.2).
 * AssumeRole + tenant session policy; never log secret values.
 */
export {
  applySandboxVaultMountStsEnvToCreateParams,
  buildSandboxVaultMountRoleSessionName,
  buildSandboxVaultMountSessionPolicy,
  buildSandboxVaultMountStsEnv,
  clampSandboxVaultMountDurationSeconds,
  createAwsSdkSandboxVaultMountStsIssuer,
  createFakeSandboxVaultMountStsIssuer,
  DEFAULT_SANDBOX_VAULT_MOUNT_AWS_REGION,
  DEFAULT_SANDBOX_VAULT_MOUNT_DURATION_SECONDS,
  GATEWAY_ENV_AWS_ACCESS_KEY_ID,
  GATEWAY_ENV_AWS_DEFAULT_REGION,
  GATEWAY_ENV_AWS_REGION,
  GATEWAY_ENV_AWS_SECRET_ACCESS_KEY,
  GATEWAY_ENV_AWS_SESSION_TOKEN,
  hasSandboxVaultMountStsEnv,
  MAX_SANDBOX_VAULT_MOUNT_DURATION_SECONDS,
  MIN_SANDBOX_VAULT_MOUNT_DURATION_SECONDS,
  resolveSandboxVaultMountStsFromEnv,
  SANDBOX_VAULT_MOUNT_DURATION_SECONDS_ENV,
  SANDBOX_VAULT_MOUNT_EXTERNAL_ID_ENV,
  SANDBOX_VAULT_MOUNT_ROLE_ARN_ENV,
  SANDBOX_VAULT_MOUNT_STS_ENV_KEYS,
  SANDBOX_VAULT_MOUNT_STS_SECRET_ENV_KEYS,
  SandboxVaultMountStsError,
  summarizeSandboxVaultMountStsEnvForLog,
  type AwsSdkSandboxVaultMountStsIssuerOptions,
  type BuildSandboxVaultMountStsEnvInput,
  type FakeSandboxVaultMountStsIssuer,
  type MintSandboxVaultMountStsInput,
  type ResolvedSandboxVaultMountSts,
  type SandboxVaultMountStsCredentials,
  type SandboxVaultMountStsIssuer,
} from "./sandbox-vault-mount-sts.js";
/**
 * Gateway Relay credentials for Daytona wake inject (lp-9my / spike-4l5).
 * Register/rotate put show-once secret into material store; orchestrator
 * merges GATEWAY_RELAY_* into create env. Never log secret values.
 */
export {
  applyGatewayRelayEnvToCreateParams,
  buildGatewayRelayEnv,
  createEncryptedFileInstanceSecretMaterialStore,
  createInMemoryInstanceSecretMaterialStore,
  createSecretsManagerInstanceSecretMaterialStore,
  GATEWAY_ENV_RELAY_ID,
  GATEWAY_ENV_RELAY_INSTANCE_ID,
  GATEWAY_ENV_RELAY_SECRET,
  GATEWAY_ENV_RELAY_URL,
  GATEWAY_RELAY_ENV_KEYS,
  GatewayRelayEnvError,
  INSTANCE_SECRET_MATERIAL_KEY_ENV,
  INSTANCE_SECRET_MATERIAL_PATH_ENV,
  INSTANCE_SECRET_MATERIAL_SM_SECRET_ID_ENV,
  isEphemeralInstanceSecretMaterialPath,
  materialFromIssued,
  MissingInstanceSecretMaterialError,
  parseInstanceSecretMaterialKey,
  resolveInstanceSecretMaterialStore,
  summarizeInstanceSecretMaterialStoreForLog,
  type BuildGatewayRelayEnvInput,
  type CreateSecretsManagerInstanceSecretMaterialStoreOptions,
  type EncryptedFileInstanceSecretMaterialStoreOptions,
  type GatewayRelayEnvKey,
  type InstanceSecretMaterial,
  type InstanceSecretMaterialSecretsManagerSdk,
  type InstanceSecretMaterialStore,
  type InstanceSecretMaterialStoreKind,
  type ResolvedInstanceSecretMaterialStore,
} from "./gateway-relay-env.js";
/** Durable presence store over gateway_instances (lp-omt). */
export { createSqlOrchestratorInstanceStore } from "./presence-store.js";
/**
 * Durable scheduled-job registry (platform SoT) + guest rematerialize (lp-jzl.10.1).
 * Survives Daytona stop/re-wake; injects `$BACKEND_HOME/cron/jobs.json` on ensure_online.
 */
export {
  createFileScheduledJobRegistry,
  createInMemoryGuestCronMaterializer,
  createInMemoryScheduledJobRegistry,
  DEFAULT_GUEST_BACKEND_HOME,
  GUEST_CRON_JOBS_RELATIVE_PATH,
  guestCronJobsAbsolutePath,
  normalizeScheduledJobsDocument,
  parseScheduledJobsDocument,
  rematerializeScheduledJobsOnWake,
  resolveScheduledJobRegistry,
  SCHEDULED_JOB_REGISTRY_PATH_ENV,
  serializeScheduledJobsDocument,
  ScheduledJobRegistryError,
  type GuestCronMaterializer,
  type MaterializeScheduledJobsInput,
  type MaterializeScheduledJobsResult,
  type ScheduledJob,
  type ScheduledJobRegistry,
  type ScheduledJobSchedule,
  type ScheduledJobsDocument,
} from "./scheduled-job-registry.js";
/** Daytona webhook receiver: parse + HMAC + presence map + HTTP (lp-04r / lp-kng.2.3). */
export {
  applySandboxStateUpdatedToStore,
  assertDaytonaWebhookHmac,
  DAYTONA_WEBHOOK_EVENT_SANDBOX_STATE_UPDATED,
  DAYTONA_WEBHOOK_PATH,
  DAYTONA_WEBHOOK_SECRET_ENV,
  DAYTONA_WEBHOOK_SIGNATURE_HEADER,
  DaytonaWebhookParseError,
  DaytonaWebhookSignatureError,
  findInstancesBySandboxId,
  formatDaytonaWebhookSignatureHeader,
  handleDaytonaWebhookRequest,
  mapSandboxStateToPresenceIntent,
  normalizeDaytonaWebhookState,
  parseDaytonaWebhookSignatureHeader,
  parseSandboxStateUpdatedPayload,
  processSandboxStateUpdatedWebhook,
  signDaytonaWebhookBody,
  verifyDaytonaWebhookHmac,
  type ApplySandboxStateWebhookResult,
  type DaytonaSandboxStateUpdatedPayload,
  type DaytonaWebhookHttpBody,
  type DaytonaWebhookHttpResult,
  type SandboxWebhookPresenceIntent,
} from "./daytona-webhook.js";
/** runtime_kind dual-path plumbing (lp-kng.2.11) — ec2 unchanged, daytona offline. */
export {
  assertRuntimeKindUnchanged,
  DaytonaPathGatedError,
  decideEnsureOnlinePath,
  decideStopPath,
  isAlwaysOnCompute,
  isDaytonaRuntimePath,
  isEc2RuntimePath,
  resolveRuntimePath,
  usesDaytonaCompute,
  type EnsureOnlinePathDecision,
  type RuntimePath,
  type StopPathDecision,
} from "./runtime-path.js";
/** Bound sandbox wake decision (lp-vqr0.6 / T1) + one-box create guard (lp-vqr0.15). */
export {
  decideBoundSandboxWake,
  decideSandboxCreateGuard,
  pickReusableLabeledSandbox,
  type BoundSandboxWakeDecision,
  type BoundSandboxWakeInput,
  type SandboxCreateGuard,
  type SandboxCreateGuardInput,
  type SandboxReuseCandidate,
} from "./sandbox-wake-path.js";
/** Create-ahead bind stopped sandbox before Send (lp-vqr0.7). */
export {
  decideCreateAhead,
  type CreateAheadDecision,
  type CreateAheadInput,
  type EnsureBoundStoppedSandboxResponse,
} from "./sandbox-create-ahead.js";
/**
 * Idempotent tenant S3 vault prefix ensure at provision (lp-jt5).
 * Fake store for unit tests; live S3 is S3VaultObjectStore (lp-oop.37.1).
 * Port includes listPrefix + getObject (lp-oop.4); FakeS3 implements both
 * on the in-memory map (lp-oop.6). HTTP list/stat/get is lp-oop.9.
 * Missing keys are a typed miss.
 */
export {
  assertS3PersonalVaultPrefixBoundToTenantUser,
  assertS3SharedVaultPrefixBoundToTenant,
  assertS3VaultPrefixBoundToTenant,
  assignS3VaultPrefixForProvision,
  assertValidTenantIdForVaultPrefix,
  buildPersonalVaultPrefix,
  buildSharedVaultPrefix,
  buildS3VaultPrefix,
  buildS3VaultPrefixForInstance,
  buildVaultPrefixMarkerKey,
  ensureTenantVaultPrefix,
  ensureVaultPrefixForDaytonaProvision,
  extractRelativeS3VaultPrefix,
  InvalidS3VaultPrefixError,
  InvalidTenantIdForVaultPrefixError,
  VAULT_PREFIX_MARKER_VERSION,
  VAULT_PREFIX_PLATFORM_MARKER_REL,
  VaultObjectStoreNotImplementedError,
  VaultPrefixError,
  VaultPrefixRuntimeKindError,
  type EnsureTenantVaultPrefixInput,
  type EnsureTenantVaultPrefixResult,
  type EnsureVaultPrefixForDaytonaProvisionInput,
  type VaultObjectGetHit,
  type VaultObjectGetMiss,
  type VaultObjectGetResult,
  type VaultObjectListEntry,
  type VaultObjectListInput,
  type VaultObjectListPage,
  type VaultObjectStore,
} from "./vault-prefix.js";
/**
 * lp-2qs.7 — vault tenant id listing for /admin union (common_prefixes under tenants/).
 * CP is the only S3 caller; BFF unions via GET /internal/vault/tenant-prefixes.
 */
export {
  listVaultTenantIds,
  tenantIdFromVaultCommonPrefix,
  VAULT_TENANT_PREFIXES_API_PATH,
  VAULT_TENANT_PREFIXES_ROUTE,
} from "./vault-tenant-prefixes.js";
/**
 * Internal CP HTTP vault list/stat/get (lp-oop.9) + put/CAS (lp-zuh.12.7).
 * ACL from stamped tenant prefix. Inject VaultObjectStore (FakeS3 in tests).
 */
export {
  getTenantVault,
  joinTenantVaultKey,
  listTenantVault,
  putTenantVault,
  requireVaultHttpDeps,
  resolveTenantVaultPrefix,
  statTenantVault,
  vaultObjectCasTokens,
  VAULT_HTTP_API_PATHS,
  VAULT_HTTP_LIST_MAX_KEYS,
  VAULT_HTTP_PUT_HARD_MAX_BYTES,
  VAULT_HTTP_ROUTE_TEMPLATES,
  VaultHttpError,
  vaultHttpListQuerySchema,
  vaultHttpPathQuerySchema,
  vaultHttpPutBodySchema,
  type VaultHttpEntry,
  type VaultHttpEntryKind,
  type VaultHttpErrorCode,
  type VaultHttpGetResponse,
  type VaultHttpListQuery,
  type VaultHttpListResponse,
  type VaultHttpPathQuery,
  type VaultHttpPutBody,
  type VaultHttpPutMode,
  type VaultHttpPutQuery,
  type VaultHttpPutResponse,
  type VaultHttpStatResponse,
} from "./vault-http.js";
/**
 * Daytona CP-first provision fields (lp-6jx / plan §4.11).
 * Pure helpers — no Daytona create, no EC2 TF, no network.
 */
export {
  buildDaytonaProvisionFields,
  buildGatewayInstanceProvisionFields,
  isLazyDaytonaProvision,
  InvalidProvisionInputError,
  parseProvisionRuntimeKind,
  type BuildProvisionFieldsInput,
  type GatewayInstanceProvisionFields,
} from "./provision-daytona.js";
/**
 * Daytona deprovision teardown (lp-e96): revoke secret, archive sandbox,
 * presence offline, vault retain by default (optional gated GC).
 */
export {
  assertSafeVaultGcPrefix,
  DEFAULT_VAULT_DEPROVISION_GC_MODE,
  deprovisionDaytonaInstance,
  deprovisionDaytonaTenant,
  InvalidVaultDeprovisionGcModeError,
  parseVaultDeprovisionGcMode,
  purgeVaultPrefix,
  resolveVaultDeprovisionGcMode,
  VAULT_DEPROVISION_GC_MODE_ENV,
  VAULT_DEPROVISION_GC_MODES,
  type DeprovisionCredentialStore,
  type DeprovisionDaytonaDeps,
  type DeprovisionDaytonaInstanceInput,
  type DeprovisionDaytonaInstanceResult,
  type DeprovisionDaytonaTenantInput,
  type DeprovisionDaytonaTenantResult,
  type DeprovisionInstanceSnapshot,
  type PurgeVaultPrefixInput,
  type PurgeVaultPrefixResult,
  type SecretMaterialDeleter,
  type VaultDeprovisionGcMode,
  type VaultGcObjectStore,
} from "./deprovision-daytona.js";
/**
 * Optional client-core seed into tenant vault prefix (lp-9o6).
 * Empty vault (no seed pack) is valid; seed is non-destructive and optional.
 */
export {
  bootstrapTenantVaultSeed,
  bootstrapVaultForDaytonaProvision,
  buildVaultSeedAgentsMdKey,
  buildVaultSeedBootstrapMarkerKey,
  buildVaultSeedObjectKey,
  minimalClientCoreSeedFixture,
  mockLabVaultSeedPack,
  MOCKLAB_KITCHEN_SINK_CONFIG_YAML,
  VAULT_SEED_BOOTSTRAP_MARKER_REL,
  VAULT_SEED_BOOTSTRAP_VERSION,
  VAULT_SEED_GATE_REL,
  VAULT_SEED_PROVENANCE_REL,
  VaultSeedError,
  type BootstrapTenantVaultSeedInput,
  type BootstrapTenantVaultSeedResult,
  type BootstrapTenantVaultSeedSkippedReason,
  type BootstrapVaultForDaytonaProvisionInput,
  type BootstrapVaultForDaytonaProvisionResult,
  type VaultSeedObject,
} from "./vault-seed.js";
export {
  FakeS3ObjectStore,
  type FakeS3ObjectRecord,
  type FakeS3ObjectStoreOptions,
} from "./fake-s3-object-store.js";
/**
 * Live S3 VaultObjectStore (lp-oop.37.1). Inject when S3_VAULT_BUCKET is set.
 * Assumes SANDBOX_VAULT_MOUNT_ROLE_ARN. No @aws-sdk in BFF.
 */
export {
  CP_VAULT_OBJECT_STORE_ROLE_SESSION_NAME,
  createS3VaultObjectStore,
  createVaultMountAssumedRoleCredentials,
  resolveS3VaultObjectStoreFromEnv,
  S3_VAULT_BUCKET_ENV,
  S3VaultObjectStore,
  S3VaultObjectStoreError,
  summarizeS3VaultObjectStoreForLog,
  type CreateS3VaultObjectStoreOptions,
  type ResolvedS3VaultObjectStore,
  type S3VaultSdk,
  type VaultMountCredentialProvider,
} from "./s3-vault-object-store.js";
export {
  exchangeGoogleCode,
  exchangeGoogleWorkspaceCode,
  GOOGLE_OIDC_ISSUERS,
  GoogleAuthError,
  profileFromGooglePayload,
  verifyGoogleIdToken,
  verifyJwtWithGoogleJwks,
  type GoogleAuthConfig,
  type GoogleIdTokenJwtVerifier,
  type GoogleJwtPayload,
  type GoogleProfile,
  type GoogleWorkspaceCodeExchange,
} from "./google-auth.js";
export {
  GOOGLE_DRIVE_FILE_SCOPE,
  GOOGLE_DRIVE_SCOPE,
  GOOGLE_OAUTH_AUTHORIZE_URL,
  GOOGLE_WORKSPACE_OAUTH_SCOPES,
  GoogleWorkspaceGrantError,
  InsufficientGoogleScopesError,
  assertGoogleConsentCoversWorkspace,
  completeGoogleConnectorOAuth,
  connectorSecretsFromGoogleGrant,
  googleConsentCoversWorkspace,
  googleWorkspaceScopeParam,
  gwsAccessTokenEnv,
  parseGoogleWorkspaceTokenResponse,
  parseGrantedGoogleScopes,
  type GoogleWorkspaceTokenGrant,
} from "./google-workspace-oauth.js";
export {
  HUBSPOT_CRM_OBJECTS,
  HUBSPOT_OAUTH_AUTHORIZE_URL,
  HUBSPOT_OAUTH_SCOPES,
  HUBSPOT_OAUTH_TOKEN_INFO_URL,
  HUBSPOT_OAUTH_TOKEN_URL,
  HubSpotAuthError,
  HubSpotConnectorDeniedError,
  HubSpotGrantError,
  HubSpotPortalPinMismatchError,
  InsufficientHubSpotScopesError,
  applyHubSpotPortalPin,
  assertHubSpotConsentCoversCrm,
  clearHubSpotPortalPin,
  completeHubSpotConnectorOAuth,
  connectorSecretsFromHubSpotGrant,
  decideHubSpotPortalPin,
  exchangeHubSpotCode,
  hubspotAccessTokenEnv,
  hubspotAccountLabel,
  hubspotConsentCoversCrm,
  hubspotOauthScopeParam,
  hubspotWriteIsEveryCall,
  parseGrantedHubSpotScopes,
  parseHubSpotTokenAndInfo,
  type HubSpotAuthConfig,
  type HubSpotCodeExchange,
  type HubSpotPinDecision,
  type HubSpotTokenGrant,
} from "./hubspot-oauth.js";
export {
  openDatabase,
  resolveDatabaseUrl,
  isUniqueViolation,
  toPgPlaceholders,
} from "./db.js";
export type { SqlClient, OpenDatabaseOptions } from "./db.js";
export { migrateControlPlaneSchema } from "./migrate.js";
export {
  ControlPlaneStore,
  GoogleAccountConflictError,
  InstanceNotFoundError,
  InstanceRevokedError,
  InvalidCredentialsError,
  InvalidRotationGracePeriodError,
  TenantNotFoundError,
  TenantSlugConflictError,
  UserEmailConflictError,
  LastTenantAdminError,
  validateInstanceSecret,
} from "./store.js";
export type { ControlPlaneStoreOptions } from "./store.js";
export {
  generateInstanceSecret,
  hashInstanceSecret,
  hashPassword,
  verifyInstanceSecret,
  verifyPassword,
} from "./crypto.js";
/** Portal connectors: entitlements, role grants, KMS ciphertext (lp-xhf4.2). */
export {
  ACTION_CLASSES,
  CONNECTOR_IDS,
  CONNECTOR_ID_PATTERN,
  CONNECTOR_PUBLIC_FORBIDDEN_KEYS,
  FIRST_CLASS_CONNECTOR_IDS,
  ONBOARD_SURFACE_IDS,
  CONNECTION_STATUSES,
  EVERY_CALL_ACTION_CLASSES,
  ConnectorConnectionNotFoundError,
  ConnectorEntitlementNotFoundError,
  InvalidConnectorIdError,
  InvalidConnectionStatusError,
  InvalidConnectorSecretsError,
  InvalidConnectorStickyError,
  InvalidHubSpotPinError,
  assertPublicConnectorJson,
  buildConnectorCatalog,
  emptyConnectorCatalogTotals,
  emptyConnectorSecrets,
  emptyConnectorStatusCounts,
  connectorIdFromRow,
  isActionClass,
  isConnectionStatus,
  isConnectorId,
  isFirstClassConnectorId,
  parseConnectorId,
  parseConnectionStatus,
  parseConnectorSecrets,
  listUserGrantedConnectors,
  listUserIdsLosingRoleConnectorGrant,
  parseSticky,
  type ActionClass,
  type ConnectorAccess,
  type ConnectorCatalog,
  type ConnectorCatalogEntry,
  type ConnectorCatalogTenant,
  type ConnectorCatalogTotals,
  type ConnectorConnectionPublic,
  type ConnectorId,
  type ConnectorSecrets,
  type ConnectorStatusCounts,
  type ConnectorSticky,
  type ConnectionStatus,
  type FirstClassConnectorId,
  type OnboardSurfaceId,
  type RoleConnectorGrant,
  type TenantConnectorEntitlement,
  type UserGrantedConnector,
} from "./connectors.js";
export {
  FIRST_CLASS_ONBOARD_SURFACES,
  ConnectorNotOnboardableError,
  assertOnboardSurfacesAllowed,
  availableOnboardSurfaces,
  compiledKindToSurfaceId,
  connectorIsOnboarded,
  droppedOnboardSurfaces,
  parseOnboardSurfaces,
} from "./connector-onboard.js";
export {
  CanonicalConnectorNotFoundError,
  ConnectorOnboardedError,
  ConnectorRegistryConflictError,
  InvalidRegistrySnapshotError,
  RESERVED_CONNECTOR_IDS,
  archiveCanonicalConnector,
  domainMatchesAlias,
  getCanonicalConnector,
  insertCanonicalConnector,
  isReservedConnectorId,
  listCanonicalConnectors,
  lookupCanonicalAlias,
  parseCompiledSnapshot,
  type CanonicalConnector,
  type CompiledSnapshot,
  type CompiledSurface,
  type InsertCanonicalConnectorInput,
  type RegistrySource,
} from "./connector-registry.js";
export {
  CONNECTOR_KMS_KEY_ID_ENV,
  CONNECTOR_KMS_LOCAL_KEY_ENV,
  ConnectorKmsError,
  ConnectorKmsNotConfiguredError,
  createAwsConnectorKms,
  createLocalConnectorKms,
  decryptUtf8Envelope,
  encryptUtf8Envelope,
  isConnectorKmsEnvelope,
  parseConnectorKmsLocalKey,
  resolveConnectorKmsFromEnv,
  type ConnectorKms,
  type ConnectorKmsEnvelope,
  type ConnectorKmsSdk,
  type ResolvedConnectorKms,
} from "./connector-kms.js";
/** User sandbox + lazy connector inject (lp-xhf4.6). */
export {
  CONNECTOR_GUEST_ENV_KEYS,
  CONNECTOR_GUEST_HOME,
  CONNECTOR_GUEST_PATHS,
  USER_SANDBOX_PROVISION_STATUSES,
  WACLI_STORE_DIR,
  WACLI_SYNC_ARGV,
  InvalidConnectorInjectTargetError,
  TenantSandboxConnectorInjectError,
  assertNoConnectorSecretsOnTenantEnv,
  assertUserSandboxInjectAllowed,
  buildConnectorInjectPlan,
  createInMemoryGuestConnectorStore,
  decideConnectorRestore,
  exportWhatsAppSessionFromGuest,
  injectUserConnector,
  shouldProvisionUserSandbox,
  whatsappPostInjectCommands,
  whatsappSyncOutcome,
  type ConnectorInjectPlan,
  type ConnectorInjectTarget,
  type ConnectorPostCommand,
  type GuestConnectorStore,
  type InjectUserConnectorResult,
  type UserSandboxBinding,
} from "./connector-user-sandbox.js";
/** Connector lifecycle: disconnect, refresh, entitlement-off (lp-xhf4.12). */
export {
  CONNECTOR_LIFECYCLE_EVENTS,
  CONNECTOR_LIFECYCLE_TABLE,
  ConnectorOauthNotConfiguredError,
  ConnectorRefreshError,
  applyConnectorLifecycle,
  createDefaultConnectorOauthProvider,
  planForLifecycleEvent,
  providerActionFor,
  type ConnectorLifecycleEvent,
  type ConnectorLifecycleEventKind,
  type ConnectorLifecyclePlan,
  type ConnectorLifecyclePorts,
  type ConnectorLifecycleResult,
} from "./connector-lifecycle.js";
export {
  DEFAULT_SHARED_RELAY_WSS_URL,
  dedicatedRelayWssUrlForSlug,
  resolveTenantRelayWssUrl,
} from "./relay-tier.js";
export type {
  AuditAction,
  AuditEntry,
  AuthUser,
  EnsuredInstance,
  EnsuredUserInstance,
  GatewayInstance,
  GatewayInstancePublic,
  InstanceHealthStatus,
  InstancePresence,
  ProvisionedInstance,
  RelayTier,
  RetentionMode,
  RotatedInstance,
  RuntimeKind,
  SessionShareGrant,
  SessionShareMode,
  Tenant,
  TenantMember,
  TenantRelayPolicy,
  TenantRetentionPolicy,
  OpsConnectorUser,
  OpsTenantUser,
  OpsTenantUserRole,
  User,
  ValidateInstanceSecretResult,
} from "./types.js";
export {
  DEFAULT_CHAT_CORPUS_RETENTION_DAYS,
  DEFAULT_ROTATION_GRACE_PERIOD_SECONDS,
  INSTANCE_HEALTH_STATUSES,
  INSTANCE_PRESENCE_STATES,
  MAX_CHAT_CORPUS_RETENTION_DAYS,
  MAX_ROTATION_GRACE_PERIOD_SECONDS,
  MIN_CHAT_CORPUS_RETENTION_DAYS,
  RELAY_TIERS,
  RETENTION_MODES,
  RUNTIME_KINDS,
  SESSION_SHARE_MODES,
  OPS_TENANT_USER_ROLES,
  TENANT_HOST_SUFFIX,
  tenantHost,
} from "./types.js";
/** Presence state machine (lp-eya) — legal transitions + reason helpers for CP/BFF. */
export {
  allowedPresenceTargets,
  applyPresenceReason,
  assertLegalPresenceTransition,
  IllegalPresenceReasonError,
  IllegalPresenceTransitionError,
  isInstancePresence,
  isLegalPresenceTransition,
  nextPresenceForReason,
  parseInstancePresence,
  PRESENCE_TRANSITION_EDGES,
  PRESENCE_TRANSITION_REASONS,
  transitionPresence,
  type PresenceTransitionEdge,
  type PresenceTransitionReason,
} from "./presence.js";
/**
 * agent_ready vs vault_writable (lp-vqr0.4 / T3). Presence online is
 * agent_ready. File tools wait on vault_writable.
 */
export {
  agentReadyFromPresence,
  DEFAULT_VAULT_WRITABLE_POLL_INTERVAL_MS,
  DEFAULT_VAULT_WRITABLE_TIMEOUT_MS,
  FakeVaultWritableProbe,
  instanceReadiness,
  isVaultWritableProbe,
  parseVaultWritable,
  waitUntilVaultWritable,
  type FakeVaultWritableProbeOptions,
  type InstanceReadiness,
  type VaultWritableProbe,
  type WaitUntilVaultWritableOptions,
} from "./readiness.js";
/** Instance Orchestrator internal API stubs (lp-biq) — ensure-online / presence / activity / stop. */
export {
  createNotImplementedOrchestrator,
  ENSURE_ONLINE_BY_USER_ROUTE_TEMPLATE,
  ENSURE_ONLINE_WAKE_PATHS,
  ensureOnlineRequestSchema,
  ORCHESTRATOR_API_PATHS,
  ORCHESTRATOR_OPERATIONS,
  ORCHESTRATOR_PRESENCE_STATES,
  ORCHESTRATOR_ROUTE_TEMPLATES,
  ORCHESTRATOR_RUNTIME_KINDS,
  OrchestratorNotImplementedError,
  orchestratorNotImplementedBody,
  signalActivityRequestSchema,
  stopInstanceRequestSchema,
  type EnsureOnlineByUserResponse,
  type EnsureOnlineRequest,
  type EnsureOnlineResponse,
  type EnsureOnlineWakePath,
  type InstanceOrchestratorService,
  type InstancePresenceResponse,
  type OrchestratorNotImplementedBody,
  type OrchestratorOperation,
  type SignalActivityRequest,
  type SignalActivityResponse,
  type StopInstanceRequest,
  type StopInstanceResponse,
} from "./orchestrator-api.js";
export {
  CANONICAL_PORTAL_ROLES,
  derivePortalRoleFromRbac,
  enforceTenantScopedAuthz,
  extractTenantIdFromPath,
  normalizePortalRole,
  permissionForTenantRoute,
  portalRoleHasPermission,
  PORTAL_ROLE_HEADER,
  PORTAL_ROLE_PERMISSION_MATRIX,
  TENANT_ID_HEADER,
  USER_ID_HEADER,
  type CanonicalPortalRole,
  type PortalPermission,
  type PortalRoleLabel,
} from "./tenant-authz.js";