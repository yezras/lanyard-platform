import { createLogger, InvalidVaultPathError } from "@lanyard/shared";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import {
  isPublicUnauthenticatedPath,
  resolveAuthMode,
  resolveDevOpenMode,
  type ControlPlaneAuthMode,
} from "./auth-mode.js";
import {
  exchangeGoogleCode,
  exchangeGoogleWorkspaceCode,
  type GoogleAuthConfig,
  verifyGoogleIdToken,
} from "./google-auth.js";
import {
  completeGoogleConnectorOAuth,
  GoogleWorkspaceGrantError,
  InsufficientGoogleScopesError,
} from "./google-workspace-oauth.js";
import {
  HubSpotAuthError,
  HubSpotConnectorDeniedError,
  HubSpotGrantError,
  HubSpotPortalPinMismatchError,
  InsufficientHubSpotScopesError,
  completeHubSpotConnectorOAuth,
  exchangeHubSpotCode,
  type HubSpotAuthConfig,
} from "./hubspot-oauth.js";
import {
  CONTROL_PLANE_SERVICE_TOKEN_HEADER,
  resolveServiceToken,
  serviceTokenMatches,
} from "./service-auth.js";
import {
  ProjectNotFoundError,
  ProjectParentNotFoundError,
  SubprojectVaultPathError,
  VaultPathAccessDeniedError,
} from "./projects.js";
import {
  RoleNameConflictError,
  RoleNotFoundError,
  UserEmailConflictError,
  UserNotFoundError,
} from "./rbac.js";
import {
  InvalidTenantRoleError,
  LastTenantAdminError,
} from "./ops-users.js";
import { InvalidMemberSubsetError } from "./member-subset.js";
import { HarnessToolForbiddenError } from "./harness-tool-dispatch.js";
import {
  SessionShareConflictError,
  SessionShareGranteeNotFoundError,
  SessionShareNotFoundError,
  SessionShareOwnerNotFoundError,
  SessionShareSelfGrantError,
} from "./session-shares.js";
import {
  CONNECTION_STATUSES,
  ConnectorConnectionNotFoundError,
  InvalidConnectorIdError,
  InvalidConnectionStatusError,
  InvalidConnectorSecretsError,
  InvalidConnectorStickyError,
  InvalidHubSpotPinError,
  parseConnectorSecrets,
  parseSticky,
  assertPublicConnectorJson,
} from "./connectors.js";
import {
  CanonicalConnectorNotFoundError,
  ConnectorOnboardedError,
  ConnectorRegistryConflictError,
  InvalidRegistrySnapshotError,
  parseCompiledSnapshot,
} from "./connector-registry.js";
import {
  assertOnboardSurfacesAllowed,
  availableOnboardSurfaces,
  ConnectorNotOnboardableError,
  droppedOnboardSurfaces,
} from "./connector-onboard.js";
import {
  createInMemoryGuestConnectorStore,
  injectUserConnector,
  shouldProvisionUserSandbox,
  TenantSandboxConnectorInjectError,
  InvalidConnectorInjectTargetError,
  type GuestConnectorStore,
} from "./connector-user-sandbox.js";
import {
  applyConnectorLifecycle,
  ConnectorOauthNotConfiguredError,
  ConnectorRefreshError,
  createDefaultConnectorOauthProvider,
  type ConnectorLifecyclePorts,
  type ConnectorOauthProviderConfig,
} from "./connector-lifecycle.js";
import {
  ConnectorKmsError,
  ConnectorKmsNotConfiguredError,
} from "./connector-kms.js";
import {
  InvalidProviderSecretSlotError,
  InvalidProviderSecretValueError,
  parseProviderSecretSlotOrThrow,
} from "./provider-secrets.js";
import {
  ClassCFirstClassConnectorError,
  ClassCSecretNotFoundError,
  InvalidClassCAuthKindError,
  InvalidClassCSecretValueError,
  InvalidConnectorSurfaceError,
  parseClassCAuthKind,
  parseClassCSecretPayload,
  parseConnectorSurfaceId,
} from "./class-c-secrets.js";
import { buildClassCHttpAttach } from "./class-c-attach.js";
import {
  ControlPlaneStore,
  CrossTenantResourceRefError,
  GoogleAccountConflictError,
  InstanceNotFoundError,
  InstanceRevokedError,
  InvalidCredentialsError,
  InvalidDeploymentInputError,
  InvalidProvisionInputError,
  InvalidRotationGracePeriodError,
  ResourceRefNotFoundError,
  TenantNotFoundError,
  TenantSlugConflictError,
  validateInstanceSecret,
} from "./store.js";
import {
  enforceTenantScopedAuthz,
  PORTAL_ROLE_HEADER,
  TENANT_ID_HEADER,
} from "./tenant-authz.js";
import {
  DAYTONA_WEBHOOK_PATH,
  DAYTONA_WEBHOOK_SECRET_ENV,
  DAYTONA_WEBHOOK_SIGNATURE_HEADER,
  handleDaytonaWebhookRequest,
} from "./daytona-webhook.js";
import {
  EnsureBoundStoppedSandboxError,
  EnsureOnlineTimeoutError,
  EnsureOnlineWakeError,
  OrchestratorInstanceNotFoundError,
  OrchestratorInstanceRevokedError,
  resolveMidTurnPatch,
  resolveSpineHotWindowPatch,
  type InstanceOrchestrator,
  type OrchestratorInstanceStore,
} from "./instance-orchestrator.js";
import { EnsureOnlineRateLimitedError } from "./wake-rate-limit.js";
import {
  ENSURE_ONLINE_BY_USER_ROUTE_TEMPLATE,
  ensureOnlineRequestSchema,
  ORCHESTRATOR_ROUTE_TEMPLATES,
  orchestratorNotImplementedBody,
  signalActivityRequestSchema,
  stopInstanceRequestSchema,
  type EnsureOnlineByUserResponse,
  type EnsureOnlineRequest,
  type InstancePresenceResponse,
  type SignalActivityResponse,
  type StopInstanceRequest,
} from "./orchestrator-api.js";
import { instanceReadiness } from "./readiness.js";
import {
  parseSandboxKey,
  resolveInstanceIdForUser,
  tenantPrimaryRecord,
  type ScopedInstanceRecord,
} from "./resolve-instance.js";
import { DaytonaPathGatedError } from "./runtime-path.js";
import type { DaytonaClient } from "./daytona-client.js";
import {
  DEFAULT_VAULT_DEPROVISION_GC_MODE,
  deprovisionDaytonaInstance,
  deprovisionDaytonaTenant,
  resolveVaultDeprovisionGcMode,
  type SecretMaterialDeleter,
  type VaultDeprovisionGcMode,
  type VaultGcObjectStore,
} from "./deprovision-daytona.js";
import type { InstanceSecretMaterialStore } from "./gateway-relay-env.js";
import type { RelayCredentialsNotifier } from "./relay-credentials.js";
import type { VaultObjectStore } from "./vault-prefix.js";
import {
  getTenantVault,
  listTenantVault,
  putTenantVault,
  requireVaultHttpDeps,
  statTenantVault,
  VAULT_HTTP_ROUTE_TEMPLATES,
  VaultHttpError,
  vaultHttpListQuerySchema,
  vaultHttpPathQuerySchema,
  vaultHttpPutBodySchema,
} from "./vault-http.js";
import {
  listVaultTenantIds,
  VAULT_TENANT_PREFIXES_ROUTE,
} from "./vault-tenant-prefixes.js";
import {
  DEPLOYMENT_STATUSES,
  HOSTING_TRACKS,
  INSTANCE_HEALTH_STATUSES,
  INSTANCE_PRESENCE_STATES,
  ISOLATION_MODES,
  MAX_CHAT_CORPUS_RETENTION_DAYS,
  MAX_ROTATION_GRACE_PERIOD_SECONDS,
  MIN_CHAT_CORPUS_RETENTION_DAYS,
  RELAY_TIERS,
  RESOURCE_KINDS,
  RESOURCE_REF_STATUSES,
  RETENTION_MODES,
  RUNTIME_KINDS,
  SESSION_SHARE_MODES,
  CHAT_DELIVERIES,
  OPS_TENANT_USER_ROLES,
} from "./types.js";

const createTenantSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(63)
    .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i, "Invalid tenant slug"),
  display_name: z.string().min(1).max(200),
});

const validateSecretSchema = z.object({
  instance_id: z.string().uuid(),
  secret: z.string().min(1),
});

const rotateInstanceSchema = z
  .object({
    grace_period_seconds: z
      .number()
      .int()
      .min(0)
      .max(MAX_ROTATION_GRACE_PERIOD_SECONDS)
      .optional(),
  })
  .default({});

const upsertDeploymentSchema = z.object({
  hosting_track: z.enum(HOSTING_TRACKS),
  isolation_mode: z.enum(ISOLATION_MODES),
  aws_account_id: z
    .string()
    .regex(/^\d{12}$/)
    .nullable()
    .optional(),
  aws_region: z.string().min(1).max(32).nullable().optional(),
  project_name: z.string().min(1).max(128).nullable().optional(),
  status: z.enum(DEPLOYMENT_STATUSES).optional(),
  client_core_version: z.string().min(1).max(64).nullable().optional(),
  hermes_version: z.string().min(1).max(64).nullable().optional(),
  primary_instance_id: z.string().uuid().nullable().optional(),
});

const upsertResourceSchema = z.object({
  resource_kind: z.enum(RESOURCE_KINDS),
  name: z.string().min(1).max(128),
  aws_id: z.string().min(1).max(256).nullable().optional(),
  arn: z.string().min(1).max(512).nullable().optional(),
  secret_arn: z.string().min(1).max(512).nullable().optional(),
  aws_region: z.string().min(1).max(32).nullable().optional(),
  status: z.enum(RESOURCE_REF_STATUSES).optional(),
  last_seen_at: z.string().datetime().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const instanceRegistrySchema = z.object({
  label: z.string().min(1).max(128).nullable().optional(),
  last_seen_at: z.string().datetime().nullable().optional(),
  health_status: z.enum(INSTANCE_HEALTH_STATUSES).optional(),
  secret_param_arn: z.string().min(1).max(512).nullable().optional(),
  ec2_instance_id: z
    .string()
    .regex(/^i-[0-9a-f]{8,17}$/i)
    .nullable()
    .optional(),
  aws_region: z.string().min(1).max(32).nullable().optional(),
  /** lp-nye: dual-run / Daytona registry fields (orchestrator may set later). */
  runtime_kind: z.enum(RUNTIME_KINDS).optional(),
  sandbox_id: z.string().min(1).max(256).nullable().optional(),
  presence: z.enum(INSTANCE_PRESENCE_STATES).optional(),
  agent_snapshot_id: z.string().min(1).max(256).nullable().optional(),
  s3_vault_prefix: z.string().min(1).max(1024).nullable().optional(),
  /** lp-oop.29: dual-run chat path. Null inherits tenant then env (default relay). */
  chat_delivery: z.enum(CHAT_DELIVERIES).nullable().optional(),
});

/**
 * Register / provision body (lp-6jx). Empty body keeps default runtime_kind=ec2.
 * `runtime_kind=daytona` is CP-first: no EC2, no sandbox create at provision.
 */
const registerInstanceSchema = z.object({
  runtime_kind: z.enum(RUNTIME_KINDS).optional(),
  agent_snapshot_id: z.string().min(1).max(256).nullable().optional(),
  /** Optional override; daytona default is tenants/{tenant_id}/vault/. */
  s3_vault_prefix: z.string().min(1).max(1024).nullable().optional(),
});

/**
 * lp-zoh.3 / plan 0010: ensure-provision body. Register schema minus the
 * secret-bearing / vault-override surface — vault prefixes are auto-assigned
 * by scope so callers cannot steer them through ensure.
 */
const ensureInstanceSchema = z.object({
  runtime_kind: z.enum(RUNTIME_KINDS).optional(),
  agent_snapshot_id: z.string().min(1).max(256).nullable().optional(),
});

const log = createLogger({ service: "control-plane" });

const registerUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

const provisionOpsUserSchema = z.object({
  display_name: z.string().min(1).max(200),
  email: z.string().email(),
  role: z.enum(OPS_TENANT_USER_ROLES),
});

const patchOpsUserSchema = z
  .object({
    display_name: z.string().min(1).max(200).optional(),
    role: z.enum(OPS_TENANT_USER_ROLES).optional(),
  })
  .refine((value) => value.display_name !== undefined || value.role !== undefined, {
    message: "display_name or role required",
  });

const putPersonGrantSchema = z.object({
  granted: z.boolean(),
});

const putMemberSubsetSchema = z.object({
  allowed_tools: z.array(z.string().min(1).max(128)).max(64),
});

const loginSchema = z.object({
  tenant_id: z.string().uuid(),
  email: z.string().email(),
  password: z.string().min(1).max(128),
});

const googleCallbackSchema = z
  .object({
    tenant_id: z.string().uuid(),
    code: z.string().min(1).optional(),
    redirect_uri: z.string().url().optional(),
    id_token: z.string().min(1).optional(),
    google_sub: z.string().min(1).optional(),
    email: z.string().email().optional(),
  })
  .refine(
    (value) =>
      Boolean(value.code) ||
      Boolean(value.id_token) ||
      (Boolean(value.google_sub) && Boolean(value.email)),
    {
      message:
        "Provide OAuth code, id_token, or google_sub+email stub credentials",
    },
  );

const createRoleSchema = z.object({
  name: z.string().min(1).max(64),
  hermes_profile: z.string().min(1).max(128),
  path_prefixes: z.array(z.string().min(1)).min(1),
});

const setUserRolesSchema = z.object({
  role_ids: z.array(z.string().uuid()).min(1),
});

const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  vault_path: z.string().min(1),
  parent_project_id: z.string().uuid().nullable().optional(),
});

const updateProjectSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    vault_path: z.string().min(1).optional(),
  })
  .refine((body) => body.name !== undefined || body.vault_path !== undefined, {
    message: "At least one of name or vault_path must be provided",
  });

const updateChatDeliverySchema = z.object({
  /** Null clears the persist so BFF env (default relay) applies. */
  chat_delivery: z.enum(CHAT_DELIVERIES).nullable(),
});

const updateRetentionSchema = z
  .object({
    interaction_export_enabled: z.boolean().optional(),
    retention_mode: z.enum(RETENTION_MODES).optional(),
    /** L10 chat corpus enablement (plan 0011 / lp-gkh.6). Default off. */
    chat_corpus_enabled: z.boolean().optional(),
    /**
     * Optional retention override in days when L10 is enabled.
     * Null clears the override (platform default 90d applies).
     * Min 30 / max 3650 when set (policy floor / soft upper bound).
     */
    chat_corpus_retention_days: z
      .number()
      .int()
      .min(MIN_CHAT_CORPUS_RETENTION_DAYS)
      .max(MAX_CHAT_CORPUS_RETENTION_DAYS)
      .nullable()
      .optional(),
  })
  .refine(
    (body) =>
      body.interaction_export_enabled !== undefined ||
      body.retention_mode !== undefined ||
      body.chat_corpus_enabled !== undefined ||
      body.chat_corpus_retention_days !== undefined,
    { message: "At least one retention field must be provided" },
  );

const relayWssUrlSchema = z
  .string()
  .refine(
    (value) =>
      value.startsWith("http://") ||
      value.startsWith("https://") ||
      value.startsWith("ws://") ||
      value.startsWith("wss://"),
    "URL must start with http://, https://, ws://, or wss://",
  );

const updateRelayTierSchema = z.object({
  relay_tier: z.enum(RELAY_TIERS),
  dedicated_relay_wss_url: relayWssUrlSchema.nullable().optional(),
});

const createSessionShareSchema = z.object({
  thread_id: z.string().uuid(),
  grantee_email: z.string().email(),
  mode: z.enum(SESSION_SHARE_MODES),
});

const upsertConnectorEntitlementSchema = z
  .object({
    enabled: z.boolean().optional(),
    surfaces: z.array(z.enum(["mcp", "api", "cli"])).optional(),
    hubspot_portal_id: z.string().min(1).max(128).nullable().optional(),
  })
  .refine(
    (body) => body.enabled !== undefined || body.surfaces !== undefined,
    { message: "enabled or surfaces is required" },
  );

const insertCanonicalConnectorSchema = z.object({
  id: z.string().min(1).max(64),
  domain: z.string().min(1).max(253).nullable().optional(),
  label: z.string().min(1).max(128),
  source: z.enum(["integrations.sh", "custom"]),
  source_entry_id: z.string().min(1).max(256).nullable().optional(),
  snapshot: z.unknown(),
});

/** lp-2qs.4 — value is plaintext at the CP boundary only; never logged. */
const putProviderSecretSchema = z.object({
  value: z.string().min(1).max(8_192),
});

const putClassCSecretSchema = z.object({
  value: z.string().min(1).max(8_192),
  auth_kind: z.enum(["bearer", "api_key"]).optional(),
});

const upsertRoleConnectorGrantSchema = z.object({
  enabled: z.boolean(),
});

const upsertConnectorConnectionSchema = z.object({
  status: z.enum(CONNECTION_STATUSES).optional(),
  account_label: z.string().min(1).max(256).nullable().optional(),
  sticky: z.record(z.boolean()).optional(),
  secrets: z.record(z.unknown()).optional(),
});

const putConnectorSecretsSchema = z.object({
  secrets: z.record(z.unknown()),
  replace: z.boolean().optional(),
});

const connectorOAuthCompleteSchema = z.object({
  code: z.string().min(1).max(4096),
  redirect_uri: z.string().min(1).max(2048),
  code_verifier: z.string().min(1).max(256),
});

export const INTERNAL_OPS_TOKEN_HEADER = "x-internal-ops-token";
export { CONTROL_PLANE_SERVICE_TOKEN_HEADER };

export type ControlPlaneAppOptions = {
  /**
   * Lanyard ops secret (`INTERNAL_OPS_TOKEN`) for elevated ops routes
   * (retention, relay-tier). Also accepted as an alternative credential for
   * non-health routes in production (operator tooling).
   */
  internalOpsToken?: string;
  /**
   * BFF ↔ CP service secret (`CONTROL_PLANE_SERVICE_TOKEN`). Required for
   * non-health routes when authMode is production (G1.2). When set in
   * development, the same gate applies so local stacks mirror production.
   */
  serviceToken?: string;
  /**
   * development | production. Defaults from CONTROL_PLANE_AUTH_MODE,
   * then NODE_ENV=production → production, else development.
   */
  authMode?: ControlPlaneAuthMode;
  /**
   * Explicit local-dev open mode (CONTROL_PLANE_DEV_OPEN). When true and
   * authMode is development with no service token, non-health routes are
   * left open for unit/integration convenience. Default is fail-closed.
   */
  devOpen?: boolean;
  /** Google OIDC client config + optional JWT verifier override (tests). */
  googleAuth?: GoogleAuthConfig;
  /** HubSpot OAuth client + optional code exchange override (tests). */
  hubspotAuth?: HubSpotAuthConfig;
  /**
   * Shared secret for Daytona webhook HMAC (`DAYTONA_WEBHOOK_SECRET`, lp-04r).
   * When omitted, falls back to env; empty → webhook route returns 503.
   * Never log the value.
   */
  daytonaWebhookSecret?: string;
  /**
   * Presence / sandbox_id store for webhook application (lp-04r).
   * Defaults to `store.asOrchestratorInstanceStore()` when available.
   * Unit tests inject an in-memory store without Postgres.
   */
  orchestratorInstances?: OrchestratorInstanceStore;
  /**
   * Instance Orchestrator for ensure_online wake (lp-nus) and stop (lp-cbv).
   * When omitted, POST ensure-online / ensure-bound-stopped / stop return 501.
   * Live server injects Fake-or-SDK-backed createInstanceOrchestrator when
   * Daytona is enabled+ready; unit tests inject real harness-backed orch.
   */
  instanceOrchestrator?:
    | (Pick<InstanceOrchestrator, "ensureOnline" | "stop"> &
        Partial<Pick<InstanceOrchestrator, "ensureBoundStoppedSandbox">>)
    | null;
  /**
   * Extra 0010-shaped instance fixtures for ensure-online-by-user (lp-oop.19).
   * Merged with durable user-scope rows from the store when present.
   * User-scope rows win in the resolver.
   */
  scopedInstanceRecords?: readonly ScopedInstanceRecord[];
  /**
   * Guest disk for lazy connector inject (lp-xhf4.6). Tests use the in-memory
   * store. Omit → process-local memory (no Daytona create-env dump).
   */
  guestConnectorStore?: GuestConnectorStore;
  /**
   * Google/HubSpot revoke + refresh. Tests inject fakes. Omit → live HTTP
   * using GOOGLE_* / HUBSPOT_* env (best-effort revoke never blocks delete).
   */
  connectorOauth?: Pick<ConnectorLifecyclePorts, "revokeOauth" | "refreshOauth">;
  connectorOauthConfig?: ConnectorOauthProviderConfig;
  /** WhatsApp `wacli auth logout` when the user sandbox is up. Default no-op. */
  whatsappLogout?: ConnectorLifecyclePorts["logoutWhatsApp"];
  /**
   * Daytona client for deprovision archive (lp-e96). When set, instance revoke
   * and tenant deprovision destroy bound sandboxes before clearing sandbox_id.
   * Null/omit → secret revoke + CP soft state only (EC2-only boots).
   */
  daytonaClient?: DaytonaClient | null;
  /**
   * Optional plaintext material store delete on revoke (lp-9my port).
   * When omit, material cleanup is skipped (store may still clear when wired).
   * Also used on rotate to dual-accept previous secret when pushing to Relay
   * (lp-3a1.3) — prefer full store with get when available.
   */
  secretMaterial?:
    | (SecretMaterialDeleter &
        Partial<Pick<InstanceSecretMaterialStore, "get">>)
    | null;
  /**
   * Best-effort push of show-once secrets into Relay after register/rotate
   * (lp-3a1.3). Multi-instance Daytona cannot rely on solo RELAY_GATEWAY_ID.
   * Failures are logged without secret material; API still returns 201/200.
   */
  relayCredentials?: RelayCredentialsNotifier | null;
  /**
   * Optional vault GC store. Happy-path revoke/deprovision never deletes S3
   * (pilot default retain — lp-zmg / lp-e96). Kept for future purge endpoints.
   */
  vaultGcStore?: VaultGcObjectStore | null;
  vaultBucket?: string | null;
  /**
   * Injected vault object store for internal list/stat/get (lp-oop.9).
   * Tests use InMemoryS3. Live: S3VaultObjectStore when S3_VAULT_BUCKET is set
   * (lp-oop.37.1). Omit → vault HTTP returns 501. Never an AWS SDK in BFF.
   */
  vaultObjectStore?: VaultObjectStore | null;
  /** Override vault GC mode (default retain / env VAULT_DEPROVISION_GC_MODE). */
  vaultGcMode?: VaultDeprovisionGcMode;
};

export type ControlPlaneBindings = {
  store: ControlPlaneStore;
};

function requireInternalOpsToken(
  token: string | undefined,
  presented: string | undefined,
): void {
  if (!token) {
    throw new HTTPException(503, {
      message: "Internal ops token not configured",
    });
  }
  if (!presented || !serviceTokenMatches(token, presented)) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
}

/**
 * G1.2 production / configured-service gate:
 * accept either a valid service token (BFF) or a valid ops token (operators).
 * Anonymous and spoofed callers are rejected.
 */
function requireServiceOrOpsCredential(input: {
  serviceToken: string | undefined;
  opsToken: string | undefined;
  presentedService: string | undefined;
  presentedOps: string | undefined;
  /** When true (production), at least one credential must be configured. */
  required: boolean;
}): void {
  const {
    serviceToken,
    opsToken,
    presentedService,
    presentedOps,
    required,
  } = input;

  if (serviceToken && presentedService && serviceTokenMatches(serviceToken, presentedService)) {
    return;
  }
  if (opsToken && presentedOps && serviceTokenMatches(opsToken, presentedOps)) {
    return;
  }

  if (!serviceToken && !opsToken) {
    if (required) {
      throw new HTTPException(503, {
        message: "Control-plane service credentials not configured",
      });
    }
    return;
  }

  throw new HTTPException(401, { message: "Unauthorized" });
}

function throwConnectorHttpError(error: unknown): never {
  if (error instanceof HTTPException) {
    throw error;
  }
  if (error instanceof TenantNotFoundError) {
    throw new HTTPException(404, { message: error.message });
  }
  if (error instanceof UserNotFoundError) {
    throw new HTTPException(404, { message: error.message });
  }
  if (error instanceof RoleNotFoundError) {
    throw new HTTPException(404, { message: error.message });
  }
  if (error instanceof ConnectorConnectionNotFoundError) {
    throw new HTTPException(404, { message: error.message });
  }
  if (error instanceof ClassCSecretNotFoundError) {
    throw new HTTPException(404, { message: error.message });
  }
  if (error instanceof ClassCFirstClassConnectorError) {
    throw new HTTPException(400, { message: error.message });
  }
  if (error instanceof ConnectorNotOnboardableError) {
    throw new HTTPException(400, { message: error.message });
  }
  if (
    error instanceof InvalidConnectorIdError ||
    error instanceof InvalidConnectionStatusError ||
    error instanceof InvalidConnectorStickyError ||
    error instanceof InvalidConnectorSecretsError ||
    error instanceof InvalidProviderSecretSlotError ||
    error instanceof InvalidProviderSecretValueError ||
    error instanceof InvalidClassCAuthKindError ||
    error instanceof InvalidClassCSecretValueError ||
    error instanceof InvalidConnectorSurfaceError ||
    error instanceof InvalidHubSpotPinError ||
    error instanceof InsufficientGoogleScopesError ||
    error instanceof GoogleWorkspaceGrantError ||
    error instanceof InsufficientHubSpotScopesError ||
    error instanceof HubSpotGrantError
  ) {
    throw new HTTPException(400, { message: error.message });
  }
  if (error instanceof LastTenantAdminError) {
    throw new HTTPException(409, { message: error.message });
  }
  if (error instanceof UserEmailConflictError) {
    throw new HTTPException(409, { message: error.message });
  }
  if (error instanceof InvalidTenantRoleError) {
    throw new HTTPException(400, { message: error.message });
  }
  if (error instanceof InvalidMemberSubsetError) {
    throw new HTTPException(400, { message: error.message });
  }
  if (error instanceof HubSpotPortalPinMismatchError) {
    throw new HTTPException(409, { message: error.message });
  }
  if (error instanceof ConnectorRegistryConflictError) {
    throw new HTTPException(409, { message: error.message });
  }
  if (error instanceof ConnectorOnboardedError) {
    throw new HTTPException(409, { message: error.message });
  }
  if (error instanceof CanonicalConnectorNotFoundError) {
    throw new HTTPException(404, { message: error.message });
  }
  if (error instanceof InvalidRegistrySnapshotError) {
    throw new HTTPException(400, { message: error.message });
  }
  if (error instanceof HubSpotConnectorDeniedError) {
    throw new HTTPException(403, { message: error.message });
  }
  if (error instanceof HarnessToolForbiddenError) {
    throw new HTTPException(403, { message: error.message });
  }
  if (error instanceof HubSpotAuthError) {
    throw new HTTPException(401, { message: error.message });
  }
  if (error instanceof ConnectorOauthNotConfiguredError) {
    throw new HTTPException(503, { message: error.message });
  }
  if (error instanceof ConnectorRefreshError) {
    throw new HTTPException(409, { message: error.message });
  }
  if (error instanceof ConnectorKmsNotConfiguredError) {
    throw new HTTPException(503, { message: error.message });
  }
  if (error instanceof ConnectorKmsError) {
    throw new HTTPException(500, { message: error.message });
  }
  if (
    error instanceof TenantSandboxConnectorInjectError ||
    error instanceof InvalidConnectorInjectTargetError
  ) {
    throw new HTTPException(409, { message: error.message });
  }
  throw error;
}

type EnsureOnlineOrchestrator = NonNullable<
  ControlPlaneAppOptions["instanceOrchestrator"]
>;

/**
 * Map ensureOnline failures to the same HTTP statuses as the instance-id
 * route. Returns a Response; unknown errors are rethrown.
 */
function respondEnsureOnlineFailure(
  c: { json: (body: unknown, status: 403 | 429 | 502 | 504) => Response },
  err: unknown,
): Response {
  if (err instanceof OrchestratorInstanceNotFoundError) {
    throw new HTTPException(404, { message: "Instance not found" });
  }
  if (err instanceof OrchestratorInstanceRevokedError) {
    throw new HTTPException(403, { message: "Instance is revoked" });
  }
  if (err instanceof DaytonaPathGatedError) {
    return c.json(
      {
        error: "daytona_path_gated",
        code: err.code,
        reason: err.reason,
        instance_id: err.instanceId,
        tenant_id: err.tenantId,
        message: err.message,
      },
      403,
    );
  }
  if (err instanceof EnsureOnlineTimeoutError) {
    return c.json(
      {
        error: "ensure_online_timeout",
        code: err.code,
        instance_id: err.instanceId,
        wait_timeout_ms: err.waitTimeoutMs,
        message: err.message,
      },
      504,
    );
  }
  if (err instanceof EnsureOnlineWakeError) {
    return c.json(
      {
        error: "ensure_online_wake_failed",
        code: err.code,
        instance_id: err.instanceId,
        message: err.message,
      },
      502,
    );
  }
  if (err instanceof EnsureOnlineRateLimitedError) {
    return c.json(err.toBody(), 429);
  }
  throw err;
}

async function parseEnsureOnlineBody(c: {
  req: { header: (name: string) => string | undefined; text: () => Promise<string> };
}): Promise<EnsureOnlineRequest> {
  let raw: unknown = {};
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const text = await c.req.text();
    if (text.trim()) {
      raw = JSON.parse(text) as unknown;
    }
  }
  return ensureOnlineRequestSchema.parse(raw) as EnsureOnlineRequest;
}

async function loadScopedInstancesForTenant(
  tenantId: string,
  store: ControlPlaneStore,
  extras: readonly ScopedInstanceRecord[] | undefined,
): Promise<ScopedInstanceRecord[]> {
  const records: ScopedInstanceRecord[] = [];
  if (extras) {
    for (const row of extras) {
      if (row.tenant_id === tenantId) {
        records.push(row);
      }
    }
  }
  const lister = (
    store as Partial<Pick<ControlPlaneStore, "listScopedInstanceRecords">>
  ).listScopedInstanceRecords;
  if (typeof lister === "function") {
    records.push(...(await lister.call(store, tenantId)));
    return records;
  }
  const getter = (
    store as Partial<Pick<ControlPlaneStore, "getPrimaryActiveInstance">>
  ).getPrimaryActiveInstance;
  if (typeof getter === "function") {
    const primary = await getter.call(store, tenantId);
    if (primary?.instance_id) {
      records.push(
        tenantPrimaryRecord({
          instance_id: primary.instance_id,
          tenant_id: tenantId,
        }),
      );
    }
  }
  return records;
}

export function createApp(
  store: ControlPlaneStore,
  options: ControlPlaneAppOptions = {},
): Hono {
  const app = new Hono();
  const internalOpsToken =
    options.internalOpsToken ?? process.env.INTERNAL_OPS_TOKEN;
  const serviceToken = resolveServiceToken(
    process.env,
    options.serviceToken,
  );
  const authMode = resolveAuthMode(process.env, options.authMode);
  const devOpen =
    authMode === "development" &&
    resolveDevOpenMode(process.env, options.devOpen);
  const googleAuth = options.googleAuth ?? {};
  const hubspotAuth = options.hubspotAuth ?? {};
  // Explicit option (including "") wins so unit tests can force 503 without env.
  const daytonaWebhookSecret =
    options.daytonaWebhookSecret !== undefined
      ? options.daytonaWebhookSecret.trim()
      : process.env[DAYTONA_WEBHOOK_SECRET_ENV]?.trim() || "";
  const resolveOrchestratorInstances = (): OrchestratorInstanceStore | null => {
    if (options.orchestratorInstances) {
      return options.orchestratorInstances;
    }
    if (
      typeof (store as ControlPlaneStore).asOrchestratorInstanceStore ===
      "function"
    ) {
      return store.asOrchestratorInstanceStore();
    }
    return null;
  };
  const guestConnectorStore =
    options.guestConnectorStore ?? createInMemoryGuestConnectorStore();
  const connectorOauth =
    options.connectorOauth ??
    createDefaultConnectorOauthProvider(options.connectorOauthConfig ?? {});
  const whatsappLogout =
    options.whatsappLogout ??
    (async () => {
      /* Guest cache drop is the durable logout when wacli is not wired. */
    });

  const connectorLifecyclePorts: ConnectorLifecyclePorts = {
    getConnection: (tenant_id, user_id, connector_id) =>
      store.getUserConnectorConnection(tenant_id, user_id, connector_id),
    getSecrets: (tenant_id, user_id, connector_id) =>
      store.getUserConnectorSecrets(tenant_id, user_id, connector_id),
    deleteConnection: (input) => store.deleteUserConnectorConnection(input),
    upsertConnection: (input) => store.upsertUserConnectorConnection(input),
    listConnectionsForConnector: (tenant_id, connector_id) =>
      store.listTenantConnectorConnections(tenant_id, connector_id),
    listConnectionsForUser: async (tenant_id, user_id) => {
      const rows = await store.listUserConnectorConnections(tenant_id, user_id);
      return rows.map((row) => ({
        user_id: row.user_id,
        connector_id: row.connector_id,
      }));
    },
    listUsersLosingRoleGrant: (tenant_id, role_id, connector_id) =>
      store.listUserIdsLosingRoleConnectorGrant(
        tenant_id,
        role_id,
        connector_id,
      ),
    dropGuestCache: async ({ tenant_id, user_id, connector_id }) => {
      const binding = await store.getUserSandboxInstance(tenant_id, user_id);
      if (!binding) return false;
      const instance = await store.getInstance(binding.instance_id);
      const sandbox_id = instance?.sandbox_id?.trim() ?? "";
      if (!sandbox_id) return false;
      await guestConnectorStore.wipeConnector(sandbox_id, connector_id);
      return true;
    },
    revokeOauth: (input) => connectorOauth.revokeOauth(input),
    refreshOauth: (input) => connectorOauth.refreshOauth(input),
    logoutWhatsApp: (input) => whatsappLogout(input),
  };

  // G1.1 + G1.2 fail-closed:
  // - production: every non-health route needs service token OR ops token
  // - development with CONTROL_PLANE_SERVICE_TOKEN set: same gate (local parity)
  // - development without service token: open ONLY when CONTROL_PLANE_DEV_OPEN
  //   (or createApp `{ devOpen: true }`) is set — otherwise fail closed
  app.use("*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (isPublicUnauthenticatedPath(c.req.method, path)) {
      return next();
    }

    // Open only when explicitly opted in and no service token is configured.
    const openUnauthenticated = devOpen && !serviceToken;
    if (openUnauthenticated) {
      return next();
    }

    requireServiceOrOpsCredential({
      serviceToken,
      opsToken: internalOpsToken,
      presentedService: c.req.header(CONTROL_PLANE_SERVICE_TOKEN_HEADER),
      presentedOps: c.req.header(INTERNAL_OPS_TOKEN_HEADER),
      // Fail closed whenever we are not in explicit open mode.
      required: true,
    });
    return next();
  });

  // G1a.1: tenant-scoped authorization on every path that embeds a tenant UUID.
  // - Path tenant_id is the source of truth for data access.
  // - Optional x-lanyard-tenant-id must match path (cross-tenant probe → 403).
  // - Optional x-lanyard-portal-role enforces admin/contributor permission matrix.
  app.use("*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    enforceTenantScopedAuthz({
      method: c.req.method,
      path,
      tenantIdHeader: c.req.header(TENANT_ID_HEADER),
      portalRoleHeader: c.req.header(PORTAL_ROLE_HEADER),
    });
    return next();
  });

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      service: "control-plane",
      auth_mode: authMode,
      service_auth: serviceToken
        ? "configured"
        : devOpen
          ? "open"
          : "required",
      dev_open: devOpen,
    }),
  );

  /**
   * POST /webhooks/daytona — Daytona sandbox.state.updated receiver (lp-04r).
   * Public at the service-token layer; HMAC (`x-daytona-signature`) is required.
   * Rejects bad signatures (401). Applies presence updates when sandbox_id
   * matches a known instance. Replay-safe (idempotent ACK on re-delivery).
   */
  app.post(DAYTONA_WEBHOOK_PATH, async (c) => {
    const rawBody = await c.req.text();
    const signatureHeader = c.req.header(DAYTONA_WEBHOOK_SIGNATURE_HEADER);
    const instances = resolveOrchestratorInstances();
    if (!instances) {
      return c.json(
        {
          ok: false,
          outcome: "not_configured",
          applied: false,
          note: "orchestrator instance store is not available",
        },
        503,
      );
    }

    const result = await handleDaytonaWebhookRequest({
      rawBody,
      signatureHeader,
      secret: daytonaWebhookSecret,
      store: instances,
    });
    return c.json(result.body, result.status);
  });

  app.post("/tenants", async (c) => {
    const body = createTenantSchema.parse(await c.req.json());
    try {
      const tenant = await store.createTenant({
        slug: body.slug,
        display_name: body.display_name,
        actor: c.req.header("x-lanyard-actor") ?? "api",
      });
      return c.json(tenant, 201);
    } catch (error) {
      if (error instanceof TenantSlugConflictError) {
        throw new HTTPException(409, { message: error.message });
      }
      throw error;
    }
  });

  app.get("/tenants/:id", async (c) => {
    const tenant = await store.getTenantById(c.req.param("id"));
    if (!tenant) {
      throw new HTTPException(404, { message: "Tenant not found" });
    }
    return c.json(tenant);
  });

  /**
   * Register a gateway relay instance (identity + one-time secret material).
   * Shared by POST .../register (canonical) and .../provision (compat alias).
   *
   * Body (optional, lp-6jx):
   * - runtime_kind: `ec2` (default) | `daytona`
   * - agent_snapshot_id: optional pin for daytona wake
   * - s3_vault_prefix: optional override (daytona only; else default layout)
   *
   * Daytona path is CP-first (§4.11): assigns s3_vault_prefix, sandbox_id=null,
   * no EC2 resource, no Daytona create at provision (lazy on ensure_online).
   */
  /**
   * Push credentials to Relay after register/rotate (lp-3a1.3).
   * Best-effort: never throws; never logs secret values.
   */
  const notifyRelayCredentials = async (input: {
    instanceId: string;
    tenantId: string;
    secrets: string[];
    reason: "register" | "rotate";
  }): Promise<void> => {
    const notifier = options.relayCredentials;
    if (!notifier) return;
    const secrets = input.secrets.filter((s) => typeof s === "string" && s.length > 0);
    if (secrets.length === 0) return;
    try {
      const result = await notifier.upsert({
        instanceId: input.instanceId,
        // Production: GATEWAY_RELAY_ID === permanent instance_id.
        gatewayId: input.instanceId,
        secrets,
        tenantId: input.tenantId,
      });
      if (!result.ok) {
        log.warn("relay_credentials_notify_failed", {
          reason: input.reason,
          instance_id: input.instanceId,
          tenant_id: input.tenantId,
          status: result.status ?? null,
          error: result.error ?? "unknown",
          secrets_count: secrets.length,
        });
      } else {
        log.info("relay_credentials_notify_ok", {
          reason: input.reason,
          instance_id: input.instanceId,
          tenant_id: input.tenantId,
          secrets_count: secrets.length,
        });
      }
    } catch (err) {
      log.warn("relay_credentials_notify_failed", {
        reason: input.reason,
        instance_id: input.instanceId,
        tenant_id: input.tenantId,
        error: err instanceof Error ? err.message : "unknown",
        secrets_count: secrets.length,
      });
    }
  };

  const registerGatewayInstance = async (
    tenantId: string,
    actor: string,
    body: z.infer<typeof registerInstanceSchema> = {},
  ) => {
    const registered = await store.provisionInstance({
      tenant_id: tenantId,
      actor,
      runtime_kind: body.runtime_kind,
      agent_snapshot_id: body.agent_snapshot_id,
      s3_vault_prefix: body.s3_vault_prefix,
    });
    // Seed Relay secret store so multi-instance gateways can dial without
    // re-seeding solo RELAY_GATEWAY_ID / RELAY_DEV_SECRETS (lp-3a1.3).
    await notifyRelayCredentials({
      instanceId: registered.instance_id,
      tenantId: registered.tenant_id,
      secrets: [registered.secret],
      reason: "register",
    });
    return {
      instance_id: registered.instance_id,
      tenant_id: registered.tenant_id,
      secret: registered.secret,
      relay_tier: registered.relay_tier,
      relay_wss_url: registered.relay_wss_url,
      relay_close_code_on_revoke: 4401 as const,
      runtime_kind: registered.runtime_kind,
      sandbox_id: registered.sandbox_id,
      presence: registered.presence,
      s3_vault_prefix: registered.s3_vault_prefix,
      agent_snapshot_id: registered.agent_snapshot_id,
      ec2_instance_id: registered.ec2_instance_id,
    };
  };

  const parseRegisterBody = async (c: {
    req: { json: () => Promise<unknown> };
  }): Promise<z.infer<typeof registerInstanceSchema>> => {
    // Empty / missing body is valid (default runtime_kind=ec2).
    const raw = await c.req.json().catch(() => ({}));
    return registerInstanceSchema.parse(raw ?? {});
  };

  // Canonical register path (G2.1). Prefer this in new deploy tooling.
  app.post("/tenants/:id/instances/register", async (c) => {
    try {
      const body = await parseRegisterBody(c);
      return c.json(
        await registerGatewayInstance(
          c.req.param("id"),
          c.req.header("x-lanyard-actor") ?? "api",
          body,
        ),
        201,
      );
    } catch (error) {
      if (error instanceof TenantNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      if (error instanceof InvalidProvisionInputError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }
  });

  // Backward-compatible alias — same handler and response contract.
  app.post("/tenants/:id/instances/provision", async (c) => {
    try {
      const body = await parseRegisterBody(c);
      return c.json(
        await registerGatewayInstance(
          c.req.param("id"),
          c.req.header("x-lanyard-actor") ?? "api",
          body,
        ),
        201,
      );
    } catch (error) {
      if (error instanceof TenantNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      if (error instanceof InvalidProvisionInputError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }
  });

  // -------------------------------------------------------------------------
  // lp-zoh.3 / plan 0010: idempotent ensure-provision APIs.
  // Same service/ops-token gate as register (global middleware); no Daytona
  // create at provision — responses are presence=offline, sandbox_id=null.
  // Vault prefixes are assigned by the store (dual-prefix lp-zoh.2 shapes).
  // -------------------------------------------------------------------------

  /** Empty / missing body is valid (defaults inherit like register). */
  const parseEnsureInstanceBody = async (c: {
    req: { json: () => Promise<unknown> };
  }): Promise<z.infer<typeof ensureInstanceSchema>> => {
    const raw = await c.req.json().catch(() => ({}));
    return ensureInstanceSchema.parse(raw ?? {});
  };

  /**
   * POST ensure-tenant-primary — idempotent tenant primary ensure (lp-zoh.3).
   * Returns the active primary when present (created:false); else provisions
   * scope=tenant with is_primary=true and dual vault prefixes. Flat response
   * envelope matching register/provision; no secret material returned.
   */
  app.post("/tenants/:id/instances/ensure-tenant-primary", async (c) => {
    try {
      const body = await parseEnsureInstanceBody(c);
      const ensured = await store.ensureTenantPrimaryInstance({
        tenant_id: c.req.param("id"),
        actor: c.req.header("x-lanyard-actor") ?? "api",
        runtime_kind: body.runtime_kind,
        agent_snapshot_id: body.agent_snapshot_id,
      });
      return c.json({
        instance_id: ensured.instance_id,
        tenant_id: ensured.tenant_id,
        scope: ensured.scope,
        owner_user_id: ensured.owner_user_id,
        is_primary: ensured.is_primary,
        runtime_kind: ensured.runtime_kind,
        s3_vault_prefix: ensured.s3_vault_prefix,
        s3_shared_vault_prefix: ensured.s3_shared_vault_prefix,
        s3_personal_vault_prefix: ensured.s3_personal_vault_prefix,
        presence: ensured.presence,
        sandbox_id: ensured.sandbox_id,
        created: ensured.created,
      });
    } catch (error) {
      if (error instanceof TenantNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      if (error instanceof InvalidProvisionInputError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }
  });

  /**
   * POST ensure-user instance — idempotent user-scope ensure (lp-zoh.3).
   * BFF-facing internal path: returns the active scope=user row for
   * (tenant, user) or provisions one with both vault prefixes and
   * owner_user_id set. Unknown tenant or user → 404.
   */
  app.post(
    "/internal/tenants/:tenantId/users/:userId/instances/ensure-user",
    async (c) => {
      try {
        const body = await parseEnsureInstanceBody(c);
        const ensured = await store.ensureUserSandboxInstance({
          tenant_id: c.req.param("tenantId"),
          owner_user_id: c.req.param("userId"),
          actor: c.req.header("x-lanyard-actor") ?? "api",
          runtime_kind: body.runtime_kind,
          agent_snapshot_id: body.agent_snapshot_id,
        });
        return c.json({
          instance_id: ensured.instance_id,
          tenant_id: ensured.tenant_id,
          scope: ensured.scope,
          owner_user_id: ensured.owner_user_id,
          is_primary: ensured.is_primary,
          runtime_kind: ensured.runtime_kind,
          s3_vault_prefix: ensured.s3_vault_prefix,
          s3_shared_vault_prefix: ensured.s3_shared_vault_prefix,
          s3_personal_vault_prefix: ensured.s3_personal_vault_prefix,
          presence: ensured.presence,
          sandbox_id: ensured.sandbox_id,
          created: ensured.created,
        });
      } catch (error) {
        if (
          error instanceof TenantNotFoundError ||
          error instanceof UserNotFoundError
        ) {
          throw new HTTPException(404, { message: error.message });
        }
        if (error instanceof InvalidProvisionInputError) {
          throw new HTTPException(400, { message: error.message });
        }
        throw error;
      }
    },
  );

  /**
   * Rotate gateway instance secret (G2.2). Returns a new one-time secret.
   * Default: short dual-accept grace so ops can overwrite SSM SecureString
   * and restart the host before the previous secret expires.
   */
  app.post("/tenants/:id/instances/:instanceId/rotate", async (c) => {
    const rawBody = await c.req.json().catch(() => ({}));
    const body = rotateInstanceSchema.parse(rawBody ?? {});
    const tenantId = c.req.param("id");
    const instanceId = c.req.param("instanceId");

    try {
      // Capture previous plaintext before store overwrites material (dual-accept
      // window on Relay when grace > 0). Never returned in API body.
      let previousSecret: string | undefined;
      if (options.secretMaterial?.get) {
        const held = await options.secretMaterial.get(instanceId);
        if (held?.secret) previousSecret = held.secret;
      }

      const rotated = await store.rotateInstance({
        tenant_id: tenantId,
        instance_id: instanceId,
        grace_period_seconds: body.grace_period_seconds,
        actor: c.req.header("x-lanyard-actor") ?? "api",
      });

      const secrets = [rotated.secret];
      if (
        rotated.grace_period_seconds > 0 &&
        previousSecret &&
        previousSecret !== rotated.secret
      ) {
        secrets.push(previousSecret);
      }
      // Push new (+ optional previous) secret so MockLab/greenfield rotate does
      // not require manual SSM + relay redeploy race (lp-3a1.3).
      await notifyRelayCredentials({
        instanceId: rotated.instance_id,
        tenantId: rotated.tenant_id,
        secrets,
        reason: "rotate",
      });

      return c.json(
        {
          instance_id: rotated.instance_id,
          tenant_id: rotated.tenant_id,
          secret: rotated.secret,
          previous_secret_accepted_until:
            rotated.previous_secret_accepted_until,
          grace_period_seconds: rotated.grace_period_seconds,
          relay_tier: rotated.relay_tier,
          relay_wss_url: rotated.relay_wss_url,
          relay_close_code_on_revoke: 4401 as const,
          rotation_policy:
            rotated.grace_period_seconds > 0
              ? "dual_accept_grace"
              : "immediate_invalidate",
        },
        200,
      );
    } catch (error) {
      if (error instanceof TenantNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      if (error instanceof InstanceNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      if (error instanceof InstanceRevokedError) {
        throw new HTTPException(409, { message: error.message });
      }
      if (error instanceof InvalidRotationGracePeriodError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }
  });

  app.post("/tenants/:id/deprovision", async (c) => {
    try {
      const actor = c.req.header("x-lanyard-actor") ?? "api";
      const tenantId = c.req.param("id");
      // lp-e96: full daytona teardown when client/material wired; vault retain.
      // runVaultGc is never true on this happy path (pilot default retain).
      const teardown = await deprovisionDaytonaTenant(
        {
          store,
          instances: resolveOrchestratorInstances(),
          daytona: options.daytonaClient ?? null,
          secretMaterial: options.secretMaterial ?? null,
          vaultGcStore: options.vaultGcStore ?? null,
          vaultBucket: options.vaultBucket ?? null,
          vaultGcMode:
            options.vaultGcMode ??
            resolveVaultDeprovisionGcMode(process.env),
        },
        { tenantId, actor, runVaultGc: false },
      );
      return c.json({
        tenant_id: teardown.tenant_id,
        revoked_instance_count: teardown.revoked_instance_count,
        revoked_instance_ids: teardown.revoked_instance_ids,
        sandbox_stopped_count: teardown.instances.filter((i) => i.sandbox_stopped)
          .length,
        vault_gc_mode: teardown.vault_gc_mode,
        vault_gc_deleted_count: teardown.vault_gc_deleted_count,
        vault_retained:
          teardown.vault_gc_mode === DEFAULT_VAULT_DEPROVISION_GC_MODE ||
          teardown.vault_gc_deleted_count === 0,
        relay_close_code: 4401 as const,
        relay_behavior:
          "Connected gateways using revoked secrets must be disconnected with WebSocket close code 4401.",
        relay_revoke_hint:
          "Control plane does not push to the relay. For each revoked_instance_id, call POST {RELAY_URL}/internal/instances/:id/revoke with header x-relay-internal-token to close live sessions with 4401.",
      });
    } catch (error) {
      if (error instanceof TenantNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      throw error;
    }
  });

  // G2.3 + lp-e96: single-instance revoke (credential SoT) and daytona teardown.
  // Still requires relay internal revoke to drop already-connected WS sessions.
  app.post("/tenants/:id/instances/:instanceId/revoke", async (c) => {
    try {
      const actor = c.req.header("x-lanyard-actor") ?? "api";
      const result = await deprovisionDaytonaInstance(
        {
          store,
          instances: resolveOrchestratorInstances(),
          daytona: options.daytonaClient ?? null,
          secretMaterial: options.secretMaterial ?? null,
          vaultGcStore: options.vaultGcStore ?? null,
          vaultBucket: options.vaultBucket ?? null,
          vaultGcMode:
            options.vaultGcMode ??
            resolveVaultDeprovisionGcMode(process.env),
        },
        {
          tenantId: c.req.param("id"),
          instanceId: c.req.param("instanceId"),
          actor,
          runVaultGc: false,
        },
      );
      return c.json({
        tenant_id: result.tenant_id,
        instance_id: result.instance_id,
        already_revoked: result.already_revoked,
        revoked_at: result.revoked_at,
        runtime_kind: result.runtime_kind,
        sandbox_id_before: result.sandbox_id_before,
        sandbox_stopped: result.sandbox_stopped,
        presence: result.presence,
        s3_vault_prefix: result.s3_vault_prefix,
        vault_gc_mode: result.vault_gc_mode,
        vault_gc_deleted_count: result.vault_gc_deleted_count,
        vault_retained:
          result.vault_gc_mode === DEFAULT_VAULT_DEPROVISION_GC_MODE ||
          result.vault_gc_deleted_count === 0,
        material_deleted: result.material_deleted,
        relay_close_code: 4401 as const,
        relay_behavior:
          "Connected gateways using this instance secret must be disconnected with WebSocket close code 4401.",
        relay_revoke_path: `/internal/instances/${result.instance_id}/revoke`,
        relay_revoke_hint:
          "After this call, POST {RELAY_URL}/internal/instances/:instance_id/revoke with header x-relay-internal-token to force-close live sessions.",
      });
    } catch (error) {
      if (
        error instanceof TenantNotFoundError ||
        error instanceof InstanceNotFoundError
      ) {
        throw new HTTPException(404, { message: error.message });
      }
      throw error;
    }
  });

  app.get("/tenants/by-slug/:slug", async (c) => {
    const tenant = await store.getTenantBySlug(c.req.param("slug"));
    if (!tenant) {
      throw new HTTPException(404, { message: "Tenant not found" });
    }
    return c.json(tenant);
  });

  app.post("/tenants/:id/users/register", async (c) => {
    const body = registerUserSchema.parse(await c.req.json());
    try {
      const user = await store.registerUser({
        tenant_id: c.req.param("id"),
        email: body.email,
        password: body.password,
        actor: c.req.header("x-lanyard-actor") ?? "api",
      });
      return c.json(user, 201);
    } catch (error) {
      if (error instanceof TenantNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      if (error instanceof UserEmailConflictError) {
        throw new HTTPException(409, { message: error.message });
      }
      throw error;
    }
  });

  app.get("/tenants/:id/users", async (c) => {
    try {
      const users = await store.listOpsTenantUsers(c.req.param("id"));
      return c.json({ tenant_id: c.req.param("id"), users });
    } catch (error) {
      throwConnectorHttpError(error);
    }
  });

  app.post("/tenants/:id/users", async (c) => {
    const body = provisionOpsUserSchema.parse(await c.req.json());
    try {
      const user = await store.provisionOpsTenantUser({
        tenant_id: c.req.param("id"),
        display_name: body.display_name,
        email: body.email,
        role: body.role,
        actor: c.req.header("x-lanyard-actor") ?? "api",
      });
      return c.json(user, 201);
    } catch (error) {
      throwConnectorHttpError(error);
    }
  });

  app.get("/tenants/:id/users/:userId", async (c) => {
    try {
      const user = await store.getOpsTenantUser(
        c.req.param("id"),
        c.req.param("userId"),
      );
      return c.json(user);
    } catch (error) {
      throwConnectorHttpError(error);
    }
  });

  app.patch("/tenants/:id/users/:userId", async (c) => {
    const body = patchOpsUserSchema.parse(await c.req.json());
    try {
      const user = await store.updateOpsTenantUser({
        tenant_id: c.req.param("id"),
        user_id: c.req.param("userId"),
        display_name: body.display_name,
        role: body.role,
        actor: c.req.header("x-lanyard-actor") ?? "api",
      });
      return c.json(user);
    } catch (error) {
      throwConnectorHttpError(error);
    }
  });

  app.delete("/tenants/:id/users/:userId", async (c) => {
    try {
      await store.deleteOpsTenantUser({
        tenant_id: c.req.param("id"),
        user_id: c.req.param("userId"),
        actor: c.req.header("x-lanyard-actor") ?? "api",
      });
      return c.json({ ok: true });
    } catch (error) {
      throwConnectorHttpError(error);
    }
  });

  app.get("/tenants/:id/connectors/:connectorId/users", async (c) => {
    try {
      const connector_id = await store.parseConnectorId(
        c.req.param("connectorId"),
      );
      const users = await store.listOpsConnectorUsers(
        c.req.param("id"),
        connector_id,
      );
      return c.json({
        tenant_id: c.req.param("id"),
        connector_id,
        users,
      });
    } catch (error) {
      throwConnectorHttpError(error);
    }
  });

  app.put("/tenants/:id/connectors/:connectorId/users/:userId", async (c) => {
    const body = putPersonGrantSchema.parse(await c.req.json());
    try {
      const result = await store.setPersonConnectorGrant({
        tenant_id: c.req.param("id"),
        user_id: c.req.param("userId"),
        connector_id: c.req.param("connectorId"),
        granted: body.granted,
        actor: c.req.header("x-lanyard-actor") ?? "api",
      });
      return c.json(result);
    } catch (error) {
      throwConnectorHttpError(error);
    }
  });

  app.get(
    "/tenants/:id/connectors/:connectorId/member-subset",
    async (c) => {
      try {
        const subset = await store.getConnectorMemberSubset(
          c.req.param("id"),
          c.req.param("connectorId"),
        );
        return c.json(subset);
      } catch (error) {
        throwConnectorHttpError(error);
      }
    },
  );

  app.put(
    "/tenants/:id/connectors/:connectorId/member-subset",
    async (c) => {
      const body = putMemberSubsetSchema.parse(await c.req.json());
      try {
        const subset = await store.setConnectorMemberSubset({
          tenant_id: c.req.param("id"),
          connector_id: c.req.param("connectorId"),
          allowed_tools: body.allowed_tools,
          actor: c.req.header("x-lanyard-actor") ?? "api",
        });
        return c.json(subset);
      } catch (error) {
        throwConnectorHttpError(error);
      }
    },
  );

  app.post("/auth/login", async (c) => {
    const body = loginSchema.parse(await c.req.json());
    try {
      const user = await store.loginUser({
        tenant_id: body.tenant_id,
        email: body.email,
        password: body.password,
        actor: c.req.header("x-lanyard-actor") ?? "api",
      });
      return c.json(user);
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        throw new HTTPException(401, { message: error.message });
      }
      throw error;
    }
  });

  app.post("/auth/google/callback", async (c) => {
    const body = googleCallbackSchema.parse(await c.req.json());
    try {
      let google_sub: string;
      let email: string;

      // Dev-only stub: google_sub+email without cryptographic proof.
      // Rejected in production (CONTROL_PLANE_AUTH_MODE=production).
      if (body.google_sub && body.email) {
        if (authMode === "production") {
          throw new HTTPException(401, {
            message:
              "Stub Google credentials are not allowed in production; provide a verified id_token or OAuth code",
          });
        }
        google_sub = body.google_sub;
        email = body.email;
      } else if (body.id_token) {
        const profile = await verifyGoogleIdToken(body.id_token, googleAuth);
        google_sub = profile.sub;
        email = profile.email;
      } else if (body.code && body.redirect_uri) {
        const profile = await exchangeGoogleCode(
          body.code,
          body.redirect_uri,
          googleAuth,
        );
        google_sub = profile.sub;
        email = profile.email;
      } else {
        throw new HTTPException(400, {
          message: "Google OAuth requires code+redirect_uri or id_token",
        });
      }

      const user = await store.upsertGoogleUser({
        tenant_id: body.tenant_id,
        google_sub,
        email,
        actor: c.req.header("x-lanyard-actor") ?? "api",
      });
      return c.json(user);
    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }
      if (error instanceof TenantNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      if (error instanceof GoogleAccountConflictError) {
        throw new HTTPException(409, { message: error.message });
      }
      if (error instanceof Error && error.name === "GoogleAuthError") {
        throw new HTTPException(401, { message: error.message });
      }
      throw error;
    }
  });

  app.get("/tenants/:id/gateway-instances", async (c) => {
    const tenant = await store.getTenantById(c.req.param("id"));
    if (!tenant) {
      throw new HTTPException(404, { message: "Tenant not found" });
    }

    const instances = await store.listActiveInstances(c.req.param("id"));
    return c.json({
      tenant_id: c.req.param("id"),
      instances,
    });
  });

  // --- Deployment / resource registry (cbd-mta.3.3) ---
  // Metadata only: hosting track, account/region, non-secret AWS refs, health.
  // Not Terraform state; not vault bodies (Brain RPC).

  app.get("/tenants/:id/deployment", async (c) => {
    const tenant = await store.getTenantById(c.req.param("id"));
    if (!tenant) {
      throw new HTTPException(404, { message: "Tenant not found" });
    }
    const deployment = await store.getTenantDeployment(c.req.param("id"));
    return c.json({
      tenant_id: c.req.param("id"),
      deployment,
    });
  });

  app.put("/tenants/:id/deployment", async (c) => {
    const body = upsertDeploymentSchema.parse(await c.req.json());
    try {
      const deployment = await store.upsertTenantDeployment({
        tenant_id: c.req.param("id"),
        ...body,
        actor: c.req.header("x-lanyard-actor") ?? "api",
        request_id: c.req.header("x-request-id") ?? null,
      });
      return c.json(deployment);
    } catch (error) {
      if (error instanceof TenantNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      if (error instanceof InvalidDeploymentInputError) {
        throw new HTTPException(400, { message: error.message });
      }
      if (error instanceof CrossTenantResourceRefError) {
        throw new HTTPException(403, { message: error.message });
      }
      throw error;
    }
  });

  app.get("/tenants/:id/resources", async (c) => {
    const tenant = await store.getTenantById(c.req.param("id"));
    if (!tenant) {
      throw new HTTPException(404, { message: "Tenant not found" });
    }
    const includeRetired =
      c.req.query("include_retired") === "1" ||
      c.req.query("include_retired") === "true";
    const resources = await store.listTenantResourceRefs(c.req.param("id"), {
      include_retired: includeRetired,
    });
    return c.json({
      tenant_id: c.req.param("id"),
      resources,
    });
  });

  app.put("/tenants/:id/resources", async (c) => {
    const body = upsertResourceSchema.parse(await c.req.json());
    try {
      const resource = await store.upsertTenantResourceRef({
        tenant_id: c.req.param("id"),
        ...body,
        actor: c.req.header("x-lanyard-actor") ?? "api",
        request_id: c.req.header("x-request-id") ?? null,
      });
      return c.json(resource, 200);
    } catch (error) {
      if (error instanceof TenantNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      if (error instanceof InvalidDeploymentInputError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }
  });

  app.delete("/tenants/:id/resources/:resourceRefId", async (c) => {
    try {
      const resource = await store.retireTenantResourceRef({
        tenant_id: c.req.param("id"),
        resource_ref_id: c.req.param("resourceRefId"),
        actor: c.req.header("x-lanyard-actor") ?? "api",
        request_id: c.req.header("x-request-id") ?? null,
      });
      return c.json(resource);
    } catch (error) {
      if (error instanceof TenantNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      if (error instanceof ResourceRefNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      if (error instanceof CrossTenantResourceRefError) {
        throw new HTTPException(403, { message: error.message });
      }
      throw error;
    }
  });

  app.patch("/tenants/:id/instances/:instanceId/registry", async (c) => {
    const body = instanceRegistrySchema.parse(await c.req.json());
    try {
      const updated = await store.updateInstanceRegistry({
        tenant_id: c.req.param("id"),
        instance_id: c.req.param("instanceId"),
        ...body,
        actor: c.req.header("x-lanyard-actor") ?? "api",
        request_id: c.req.header("x-request-id") ?? null,
      });
      return c.json(updated);
    } catch (error) {
      if (error instanceof TenantNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      if (error instanceof InvalidDeploymentInputError) {
        throw new HTTPException(400, { message: error.message });
      }
      if (error instanceof CrossTenantResourceRefError) {
        throw new HTTPException(404, { message: "Instance not found" });
      }
      throw error;
    }
  });

  app.get("/tenants/:id/audit", async (c) => {
    const tenant = await store.getTenantById(c.req.param("id"));
    if (!tenant) {
      throw new HTTPException(404, { message: "Tenant not found" });
    }
    const entries = await store.listAuditEntries(c.req.param("id"));
    return c.json({
      tenant_id: c.req.param("id"),
      entries,
    });
  });

  app.post("/tenants/:id/roles", async (c) => {
    const body = createRoleSchema.parse(await c.req.json());
    try {
      const role = await store.createRole({
        tenant_id: c.req.param("id"),
        name: body.name,
        hermes_profile: body.hermes_profile,
        path_prefixes: body.path_prefixes,
        actor: c.req.header("x-lanyard-actor") ?? "api",
      });
      return c.json(role, 201);
    } catch (error) {
      if (error instanceof TenantNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      if (error instanceof RoleNameConflictError) {
        throw new HTTPException(409, { message: error.message });
      }
      throw error;
    }
  });

  app.get("/tenants/:id/roles", async (c) => {
    try {
      const roles = await store.listRoles(c.req.param("id"));
      return c.json({ tenant_id: c.req.param("id"), roles });
    } catch (error) {
      if (error instanceof TenantNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      throw error;
    }
  });

  app.put("/tenants/:id/users/:userId/roles", async (c) => {
    const body = setUserRolesSchema.parse(await c.req.json());
    try {
      const rbac = await store.setUserRoles({
        tenant_id: c.req.param("id"),
        user_id: c.req.param("userId"),
        role_ids: body.role_ids,
        actor: c.req.header("x-lanyard-actor") ?? "api",
      });
      return c.json(rbac);
    } catch (error) {
      if (error instanceof TenantNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      if (error instanceof UserNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      if (error instanceof RoleNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      throw error;
    }
  });

  app.post("/internal/tenants/:tenantId/users/:userId/projects", async (c) => {
    const body = createProjectSchema.parse(await c.req.json());
    try {
      const project = await store.createProject({
        tenant_id: c.req.param("tenantId"),
        user_id: c.req.param("userId"),
        name: body.name,
        vault_path: body.vault_path,
        parent_project_id: body.parent_project_id ?? null,
        actor: c.req.header("x-lanyard-actor") ?? "api",
      });
      return c.json(project, 201);
    } catch (error) {
      if (error instanceof TenantNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      if (error instanceof ProjectParentNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      if (error instanceof VaultPathAccessDeniedError) {
        throw new HTTPException(403, { message: error.message });
      }
      if (error instanceof SubprojectVaultPathError) {
        throw new HTTPException(400, { message: error.message });
      }
      if (error instanceof InvalidVaultPathError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }
  });

  app.get("/internal/tenants/:tenantId/users/:userId/projects", async (c) => {
    try {
      const projects = await store.listProjects(
        c.req.param("tenantId"),
        c.req.param("userId"),
      );
      return c.json({
        tenant_id: c.req.param("tenantId"),
        user_id: c.req.param("userId"),
        projects,
      });
    } catch (error) {
      if (error instanceof TenantNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      if (error instanceof VaultPathAccessDeniedError) {
        throw new HTTPException(403, { message: error.message });
      }
      throw error;
    }
  });

  app.get(
    "/internal/tenants/:tenantId/users/:userId/projects/:projectId",
    async (c) => {
      try {
        const project = await store.getProject(
          c.req.param("tenantId"),
          c.req.param("userId"),
          c.req.param("projectId"),
        );
        if (!project) {
          throw new HTTPException(404, { message: "Project not found" });
        }
        return c.json(project);
      } catch (error) {
        if (error instanceof TenantNotFoundError) {
          throw new HTTPException(404, { message: error.message });
        }
        if (error instanceof VaultPathAccessDeniedError) {
          throw new HTTPException(403, { message: error.message });
        }
        throw error;
      }
    },
  );

  app.put(
    "/internal/tenants/:tenantId/users/:userId/projects/:projectId",
    async (c) => {
      const body = updateProjectSchema.parse(await c.req.json());
      try {
        const project = await store.updateProject({
          tenant_id: c.req.param("tenantId"),
          user_id: c.req.param("userId"),
          project_id: c.req.param("projectId"),
          name: body.name,
          vault_path: body.vault_path,
          actor: c.req.header("x-lanyard-actor") ?? "api",
        });
        return c.json(project);
      } catch (error) {
        if (error instanceof TenantNotFoundError) {
          throw new HTTPException(404, { message: error.message });
        }
        if (error instanceof ProjectNotFoundError) {
          throw new HTTPException(404, { message: error.message });
        }
        if (error instanceof VaultPathAccessDeniedError) {
          throw new HTTPException(403, { message: error.message });
        }
        if (error instanceof SubprojectVaultPathError) {
          throw new HTTPException(400, { message: error.message });
        }
        if (error instanceof InvalidVaultPathError) {
          throw new HTTPException(400, { message: error.message });
        }
        throw error;
      }
    },
  );

  app.delete(
    "/internal/tenants/:tenantId/users/:userId/projects/:projectId",
    async (c) => {
      try {
        await store.deleteProject({
          tenant_id: c.req.param("tenantId"),
          user_id: c.req.param("userId"),
          project_id: c.req.param("projectId"),
          actor: c.req.header("x-lanyard-actor") ?? "api",
        });
        return c.json({ ok: true });
      } catch (error) {
        if (error instanceof TenantNotFoundError) {
          throw new HTTPException(404, { message: error.message });
        }
        if (error instanceof ProjectNotFoundError) {
          throw new HTTPException(404, { message: error.message });
        }
        if (error instanceof VaultPathAccessDeniedError) {
          throw new HTTPException(403, { message: error.message });
        }
        throw error;
      }
    },
  );

  app.post(
    "/internal/tenants/:tenantId/users/:userId/session-shares",
    async (c) => {
      const body = createSessionShareSchema.parse(await c.req.json());
      try {
        const grant = await store.createSessionShareGrant({
          tenant_id: c.req.param("tenantId"),
          owner_user_id: c.req.param("userId"),
          thread_id: body.thread_id,
          grantee_email: body.grantee_email,
          mode: body.mode,
          actor: c.req.header("x-lanyard-actor") ?? "api",
        });
        return c.json(grant, 201);
      } catch (error) {
        if (error instanceof TenantNotFoundError) {
          throw new HTTPException(404, { message: error.message });
        }
        if (error instanceof SessionShareGranteeNotFoundError) {
          throw new HTTPException(404, { message: error.message });
        }
        if (error instanceof SessionShareOwnerNotFoundError) {
          throw new HTTPException(404, { message: error.message });
        }
        if (error instanceof SessionShareSelfGrantError) {
          throw new HTTPException(400, { message: error.message });
        }
        if (error instanceof SessionShareConflictError) {
          throw new HTTPException(409, { message: error.message });
        }
        throw error;
      }
    },
  );

  app.get(
    "/internal/tenants/:tenantId/users/:userId/session-shares",
    async (c) => {
      try {
        const grants = await store.listSessionShareGrantsForGrantee(
          c.req.param("tenantId"),
          c.req.param("userId"),
        );
        return c.json({
          tenant_id: c.req.param("tenantId"),
          user_id: c.req.param("userId"),
          grants,
        });
      } catch (error) {
        if (error instanceof TenantNotFoundError) {
          throw new HTTPException(404, { message: error.message });
        }
        throw error;
      }
    },
  );

  app.get(
    "/internal/tenants/:tenantId/users/:userId/threads/:threadId/session-shares",
    async (c) => {
      try {
        const grants = await store.listSessionShareGrantsForThread(
          c.req.param("tenantId"),
          c.req.param("userId"),
          c.req.param("threadId"),
        );
        return c.json({
          tenant_id: c.req.param("tenantId"),
          owner_user_id: c.req.param("userId"),
          thread_id: c.req.param("threadId"),
          grants,
        });
      } catch (error) {
        if (error instanceof TenantNotFoundError) {
          throw new HTTPException(404, { message: error.message });
        }
        throw error;
      }
    },
  );

  app.get(
    "/internal/tenants/:tenantId/users/:userId/threads/:threadId/session-shares/active",
    async (c) => {
      try {
        const grant = await store.getActiveSessionShareGrant(
          c.req.param("tenantId"),
          c.req.param("threadId"),
          c.req.param("userId"),
        );
        return c.json({
          tenant_id: c.req.param("tenantId"),
          user_id: c.req.param("userId"),
          thread_id: c.req.param("threadId"),
          grant,
        });
      } catch (error) {
        if (error instanceof TenantNotFoundError) {
          throw new HTTPException(404, { message: error.message });
        }
        throw error;
      }
    },
  );

  app.delete(
    "/internal/tenants/:tenantId/users/:ownerUserId/threads/:threadId/session-shares/:granteeUserId",
    async (c) => {
      try {
        const grant = await store.revokeSessionShareGrant({
          tenant_id: c.req.param("tenantId"),
          owner_user_id: c.req.param("ownerUserId"),
          thread_id: c.req.param("threadId"),
          grantee_user_id: c.req.param("granteeUserId"),
          actor: c.req.header("x-lanyard-actor") ?? "api",
        });
        return c.json(grant);
      } catch (error) {
        if (error instanceof TenantNotFoundError) {
          throw new HTTPException(404, { message: error.message });
        }
        if (error instanceof SessionShareNotFoundError) {
          throw new HTTPException(404, { message: error.message });
        }
        throw error;
      }
    },
  );

  app.get("/internal/connector-catalog", async (c) => {
    try {
      const catalog = await store.listConnectorCatalog();
      assertPublicConnectorJson(catalog);
      return c.json(catalog);
    } catch (error) {
      throwConnectorHttpError(error);
    }
  });

  app.get("/internal/canonical-connectors", async (c) => {
    try {
      const includeArchived = c.req.query("include_archived") === "1";
      const connectors = await store.listCanonicalConnectors({
        includeArchived,
      });
      const body = { connectors };
      assertPublicConnectorJson(body);
      return c.json(body);
    } catch (error) {
      throwConnectorHttpError(error);
    }
  });

  app.get("/internal/canonical-connectors/:id", async (c) => {
    try {
      const connector = await store.getCanonicalConnector(c.req.param("id"), {
        includeArchived: true,
      });
      if (!connector) {
        throw new CanonicalConnectorNotFoundError(c.req.param("id"));
      }
      assertPublicConnectorJson(connector);
      return c.json(connector);
    } catch (error) {
      throwConnectorHttpError(error);
    }
  });

  app.post("/internal/canonical-connectors", async (c) => {
    const body = insertCanonicalConnectorSchema.parse(await c.req.json());
    try {
      const snapshot = parseCompiledSnapshot(body.snapshot);
      const actor = c.req.header("x-lanyard-actor") ?? "api";
      const connector = await store.insertCanonicalConnector({
        id: body.id,
        domain: body.domain,
        label: body.label,
        source: body.source,
        source_entry_id: body.source_entry_id,
        snapshot,
        actor,
      });
      assertPublicConnectorJson(connector);
      return c.json(connector, 201);
    } catch (error) {
      throwConnectorHttpError(error);
    }
  });

  app.delete("/internal/canonical-connectors/:id", async (c) => {
    try {
      const actor = c.req.header("x-lanyard-actor") ?? "api";
      const connector = await store.archiveCanonicalConnector({
        id: c.req.param("id"),
        actor,
      });
      assertPublicConnectorJson(connector);
      return c.json(connector);
    } catch (error) {
      throwConnectorHttpError(error);
    }
  });

  app.get("/internal/tenants/:tenantId/connector-entitlements", async (c) => {
    try {
      const entitlements = await store.listTenantConnectorEntitlements(
        c.req.param("tenantId"),
      );
      const body = {
        tenant_id: c.req.param("tenantId"),
        entitlements,
      };
      assertPublicConnectorJson(body);
      return c.json(body);
    } catch (error) {
      throwConnectorHttpError(error);
    }
  });

  app.get(
    "/internal/tenants/:tenantId/connector-entitlements/:connectorId",
    async (c) => {
      try {
        const connector_id = await store.parseConnectorId(c.req.param("connectorId"));
        const entitlement = await store.getTenantConnectorEntitlement(
          c.req.param("tenantId"),
          connector_id,
        );
        if (!entitlement) {
          return c.json({
            tenant_id: c.req.param("tenantId"),
            connector_id,
            enabled: false,
            hubspot_portal_id: null,
            surfaces: [],
          });
        }
        assertPublicConnectorJson(entitlement);
        return c.json(entitlement);
      } catch (error) {
        throwConnectorHttpError(error);
      }
    },
  );

  app.put(
    "/internal/tenants/:tenantId/connector-entitlements/:connectorId",
    async (c) => {
      const body = upsertConnectorEntitlementSchema.parse(await c.req.json());
      try {
        const tenant_id = c.req.param("tenantId");
        const connector_id = await store.parseConnectorId(c.req.param("connectorId"));
        const actor = c.req.header("x-lanyard-actor") ?? "api";
        const previous = await store.getTenantConnectorEntitlement(
          tenant_id,
          connector_id,
        );
        const canonical = await store.getCanonicalConnector(connector_id);
        if (!canonical) {
          throw new CanonicalConnectorNotFoundError(connector_id);
        }
        const available = availableOnboardSurfaces({
          id: canonical.id,
          snapshot: canonical.snapshot,
        });
        const wantsOn =
          body.surfaces !== undefined
            ? body.surfaces.length > 0
            : body.enabled === true;
        const requested = wantsOn ? (body.surfaces ?? available) : [];
        if (wantsOn) {
          if (available.length === 0) {
            throw new ConnectorNotOnboardableError(connector_id);
          }
          assertOnboardSurfacesAllowed(connector_id, requested, available);
        }
        const enabled = requested.length > 0;
        const entitlement = await store.upsertTenantConnectorEntitlement({
          tenant_id,
          connector_id,
          enabled,
          surfaces: requested,
          hubspot_portal_id: body.hubspot_portal_id,
          actor,
        });
        const dropped = droppedOnboardSurfaces({
          previous: previous?.surfaces ?? [],
          next: entitlement.enabled ? entitlement.surfaces : [],
        });
        for (const surface_id of dropped) {
          try {
            await store.deleteClassCSecret({
              tenant_id,
              connector_id,
              surface_id,
              actor,
            });
          } catch (error) {
            if (!(error instanceof ClassCFirstClassConnectorError)) {
              throw error;
            }
          }
        }
        if (!entitlement.enabled) {
          await applyConnectorLifecycle(
            {
              kind: "tenant_entitlement_off",
              tenant_id,
              connector_id,
              actor,
            },
            connectorLifecyclePorts,
          );
        } else if (
          connector_id === "hubspot" &&
          previous?.hubspot_portal_id &&
          !entitlement.hubspot_portal_id
        ) {
          await applyConnectorLifecycle(
            { kind: "clear_hubspot_pin", tenant_id, actor },
            connectorLifecyclePorts,
          );
        }
        assertPublicConnectorJson(entitlement);
        return c.json(entitlement);
      } catch (error) {
        throwConnectorHttpError(error);
      }
    },
  );

  /**
   * lp-2qs.4 — Class B tenant provider secrets. Statuses never include the
   * value (fingerprint + rotated_at only); PUT takes plaintext once and
   * stores a KMS envelope. OAuth slots ride along for ops-managed grants.
   */
  app.get("/internal/tenants/:tenantId/provider-secrets", async (c) => {
    try {
      const statuses = await store.listTenantProviderSecretStatuses(
        c.req.param("tenantId"),
      );
      // Key is `slots` (not `secrets`) so assertPublicConnectorJson cannot
      // mistake the status list for a secrets payload.
      const body = { tenant_id: c.req.param("tenantId"), slots: statuses };
      assertPublicConnectorJson(body);
      return c.json(body);
    } catch (error) {
      throwConnectorHttpError(error);
    }
  });

  app.put(
    "/internal/tenants/:tenantId/provider-secrets/:slotId",
    async (c) => {
      const body = putProviderSecretSchema.parse(await c.req.json());
      try {
        const slot = parseProviderSecretSlotOrThrow(c.req.param("slotId"));
        const status = await store.upsertTenantProviderSecret({
          tenant_id: c.req.param("tenantId"),
          slot,
          value: body.value,
          actor: c.req.header("x-lanyard-actor") ?? "api",
        });
        assertPublicConnectorJson(status);
        return c.json(status);
      } catch (error) {
        throwConnectorHttpError(error);
      }
    },
  );

  app.delete(
    "/internal/tenants/:tenantId/provider-secrets/:slotId",
    async (c) => {
      try {
        const slot = parseProviderSecretSlotOrThrow(c.req.param("slotId"));
        const deleted = await store.deleteTenantProviderSecret({
          tenant_id: c.req.param("tenantId"),
          slot,
          actor: c.req.header("x-lanyard-actor") ?? "api",
        });
        return c.json({ ok: true, deleted });
      } catch (error) {
        throwConnectorHttpError(error);
      }
    },
  );

  /**
   * lp-hdzm.24 — Class C tenant-principal registry secrets. Statuses never
   * include the value. Attach decrypts for the harness HTTP client only.
   */
  app.get(
    "/internal/tenants/:tenantId/connectors/:connectorId/class-c-secrets",
    async (c) => {
      try {
        const connector_id = await store.parseConnectorId(
          c.req.param("connectorId"),
        );
        const surfaces = await store.listClassCSecretStatuses(
          c.req.param("tenantId"),
          connector_id,
        );
        const body = {
          tenant_id: c.req.param("tenantId"),
          connector_id,
          surfaces,
        };
        assertPublicConnectorJson(body);
        return c.json(body);
      } catch (error) {
        throwConnectorHttpError(error);
      }
    },
  );

  app.put(
    "/internal/tenants/:tenantId/connectors/:connectorId/class-c-secrets/:surfaceId",
    async (c) => {
      const body = putClassCSecretSchema.parse(await c.req.json());
      try {
        const connector_id = await store.parseConnectorId(
          c.req.param("connectorId"),
        );
        const surface_id = parseConnectorSurfaceId(c.req.param("surfaceId"));
        const status = await store.upsertClassCSecret({
          tenant_id: c.req.param("tenantId"),
          connector_id,
          surface_id,
          payload: parseClassCSecretPayload({
            value: body.value,
            auth_kind: parseClassCAuthKind(body.auth_kind),
          }),
          actor: c.req.header("x-lanyard-actor") ?? "api",
        });
        assertPublicConnectorJson(status);
        return c.json(status);
      } catch (error) {
        throwConnectorHttpError(error);
      }
    },
  );

  app.delete(
    "/internal/tenants/:tenantId/connectors/:connectorId/class-c-secrets/:surfaceId",
    async (c) => {
      try {
        const connector_id = await store.parseConnectorId(
          c.req.param("connectorId"),
        );
        const surface_id = parseConnectorSurfaceId(c.req.param("surfaceId"));
        const deleted = await store.deleteClassCSecret({
          tenant_id: c.req.param("tenantId"),
          connector_id,
          surface_id,
          actor: c.req.header("x-lanyard-actor") ?? "api",
        });
        return c.json({ ok: true, deleted });
      } catch (error) {
        throwConnectorHttpError(error);
      }
    },
  );

  app.get(
    "/internal/tenants/:tenantId/connectors/:connectorId/class-c-secrets/:surfaceId/attach",
    async (c) => {
      try {
        const connector_id = await store.parseConnectorId(
          c.req.param("connectorId"),
        );
        const surface_id = parseConnectorSurfaceId(c.req.param("surfaceId"));
        const payload = await store.getClassCSecretPayload(
          c.req.param("tenantId"),
          connector_id,
          surface_id,
        );
        return c.json(
          buildClassCHttpAttach({
            tenant_id: c.req.param("tenantId"),
            connector_id,
            surface_id,
            payload,
          }),
        );
      } catch (error) {
        throwConnectorHttpError(error);
      }
    },
  );

  /**
   * lp-hdzm.27 — member subset omit + fail-closed on harness tools.
   * First-class CLIs are grant on/off only; this is not a read-only subset.
   */
  app.get(
    "/internal/tenants/:tenantId/users/:userId/connectors/:connectorId/tools",
    async (c) => {
      try {
        const body = await store.listHarnessToolsForPerson({
          tenant_id: c.req.param("tenantId"),
          user_id: c.req.param("userId"),
          connector_id: c.req.param("connectorId"),
        });
        return c.json(body);
      } catch (error) {
        throwConnectorHttpError(error);
      }
    },
  );

  app.post(
    "/internal/tenants/:tenantId/users/:userId/connectors/:connectorId/tools/:toolName",
    async (c) => {
      try {
        const result = await store.authorizeHarnessToolCall({
          tenant_id: c.req.param("tenantId"),
          user_id: c.req.param("userId"),
          connector_id: c.req.param("connectorId"),
          tool_name: c.req.param("toolName"),
        });
        if (result.status === "forbidden") {
          return c.json(
            {
              error: result.message,
              reason: result.reason,
              connector_id: result.connector_id,
              tool_name: result.tool_name,
            },
            403,
          );
        }
        return c.json(result);
      } catch (error) {
        throwConnectorHttpError(error);
      }
    },
  );

  app.get(
    "/internal/tenants/:tenantId/roles/:roleId/connector-grants",
    async (c) => {
      try {
        const grants = await store.listRoleConnectorGrants(
          c.req.param("tenantId"),
          c.req.param("roleId"),
        );
        const body = {
          tenant_id: c.req.param("tenantId"),
          role_id: c.req.param("roleId"),
          grants,
        };
        assertPublicConnectorJson(body);
        return c.json(body);
      } catch (error) {
        throwConnectorHttpError(error);
      }
    },
  );

  app.put(
    "/internal/tenants/:tenantId/roles/:roleId/connector-grants/:connectorId",
    async (c) => {
      const body = upsertRoleConnectorGrantSchema.parse(await c.req.json());
      try {
        const tenant_id = c.req.param("tenantId");
        const role_id = c.req.param("roleId");
        const connector_id = await store.parseConnectorId(c.req.param("connectorId"));
        const actor = c.req.header("x-lanyard-actor") ?? "api";
        const grant = await store.upsertRoleConnectorGrant({
          tenant_id,
          role_id,
          connector_id,
          enabled: body.enabled,
          actor,
        });
        assertPublicConnectorJson(grant);
        return c.json(grant);
      } catch (error) {
        throwConnectorHttpError(error);
      }
    },
  );

  app.get(
    "/internal/tenants/:tenantId/users/:userId/granted-connectors",
    async (c) => {
      try {
        const connectors = await store.listUserGrantedConnectors(
          c.req.param("tenantId"),
          c.req.param("userId"),
        );
        const body = {
          tenant_id: c.req.param("tenantId"),
          user_id: c.req.param("userId"),
          connectors,
        };
        assertPublicConnectorJson(body);
        return c.json(body);
      } catch (error) {
        throwConnectorHttpError(error);
      }
    },
  );

  app.get(
    "/internal/tenants/:tenantId/users/:userId/connectors",
    async (c) => {
      try {
        const connections = await store.listUserConnectorConnections(
          c.req.param("tenantId"),
          c.req.param("userId"),
        );
        const body = {
          tenant_id: c.req.param("tenantId"),
          user_id: c.req.param("userId"),
          connections,
        };
        assertPublicConnectorJson(body);
        return c.json(body);
      } catch (error) {
        throwConnectorHttpError(error);
      }
    },
  );

  app.post(
    "/internal/tenants/:tenantId/users/:userId/connectors/:connectorId/inject",
    async (c) => {
      let force = false;
      let sandbox_destroyed = false;
      const contentType = c.req.header("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const text = await c.req.text();
        if (text.trim()) {
          const raw = JSON.parse(text) as {
            force?: unknown;
            sandbox_destroyed?: unknown;
          };
          force = raw.force === true;
          sandbox_destroyed = raw.sandbox_destroyed === true;
        }
      }
      try {
        const tenant_id = c.req.param("tenantId");
        const user_id = c.req.param("userId");
        const connector_id = await store.parseConnectorId(c.req.param("connectorId"));
        const result = await injectUserConnector({
          tenant_id,
          user_id,
          connector_id,
          force,
          sandbox_destroyed,
          ports: {
            ensureBinding: (input) => store.ensureUserSandboxInstance(input),
            getInstance: async (instance_id) => {
              const row = await store.getInstance(instance_id);
              if (!row) return null;
              return {
                instance_id: row.instance_id,
                tenant_id: row.tenant_id,
                sandbox_id: row.sandbox_id,
                scope: row.scope ?? "tenant",
                owner_user_id: row.owner_user_id ?? null,
              };
            },
            getSecrets: (tid, uid, cid) =>
              store.getUserConnectorSecrets(tid, uid, cid),
            guest: guestConnectorStore,
          },
        });
        if (result.injected) {
          await store.recordAudit({
            tenant_id,
            action: "connector.injected",
            actor: c.req.header("x-lanyard-actor") ?? "api",
            instance_id: result.instance_id,
            result: "success",
            metadata: {
              user_id,
              connector_id,
              sandbox_id: result.sandbox_id,
            },
          });
        }
        return c.json(result);
      } catch (error) {
        throwConnectorHttpError(error);
      }
    },
  );

  app.post(
    "/internal/tenants/:tenantId/users/:userId/connectors/:connectorId/oauth/complete",
    async (c) => {
      const body = connectorOAuthCompleteSchema.parse(await c.req.json());
      try {
        const connector_id = await store.parseConnectorId(
          c.req.param("connectorId"),
        );
        if (connector_id !== "google" && connector_id !== "hubspot") {
          throw new HTTPException(400, {
            message: "OAuth complete is only implemented for google and hubspot",
          });
        }
        const tenant_id = c.req.param("tenantId");
        const user_id = c.req.param("userId");
        const actor = c.req.header("x-lanyard-actor") ?? "api";
        const connection =
          connector_id === "google"
            ? await completeGoogleConnectorOAuth({
                tenant_id,
                user_id,
                code: body.code,
                redirect_uri: body.redirect_uri,
                code_verifier: body.code_verifier,
                actor,
                ports: {
                  exchange: ({ code, redirectUri, codeVerifier }) =>
                    exchangeGoogleWorkspaceCode(
                      code,
                      redirectUri,
                      codeVerifier,
                      googleAuth,
                    ),
                  upsert: (input) => store.upsertUserConnectorConnection(input),
                  ensureUserSandbox: (input) =>
                    store.ensureUserSandboxInstance(input),
                },
              })
            : await completeHubSpotConnectorOAuth({
                tenant_id,
                user_id,
                code: body.code,
                redirect_uri: body.redirect_uri,
                code_verifier: body.code_verifier,
                actor,
                ports: {
                  exchange: ({ code, redirectUri, codeVerifier }) =>
                    exchangeHubSpotCode(
                      code,
                      redirectUri,
                      codeVerifier,
                      hubspotAuth,
                    ),
                  getAccess: ({ tenant_id: tid, user_id: uid }) =>
                    store.getUserConnectorAccess(tid, uid, "hubspot"),
                  getEntitlement: (tid) =>
                    store.getTenantConnectorEntitlement(tid, "hubspot"),
                  upsertEntitlement: (entitlementInput) =>
                    store.upsertTenantConnectorEntitlement(entitlementInput),
                  upsert: (upsertInput) =>
                    store.upsertUserConnectorConnection(upsertInput),
                  ensureUserSandbox: (sandboxInput) =>
                    store.ensureUserSandboxInstance(sandboxInput),
                },
              });
        assertPublicConnectorJson(connection);
        return c.json(connection);
      } catch (error) {
        if (error instanceof Error && error.name === "GoogleAuthError") {
          throw new HTTPException(401, { message: error.message });
        }
        throwConnectorHttpError(error);
      }
    },
  );

  app.get(
    "/internal/tenants/:tenantId/users/:userId/connectors/:connectorId/access",
    async (c) => {
      try {
        const access = await store.getUserConnectorAccess(
          c.req.param("tenantId"),
          c.req.param("userId"),
          await store.parseConnectorId(c.req.param("connectorId")),
        );
        assertPublicConnectorJson(access);
        return c.json(access);
      } catch (error) {
        throwConnectorHttpError(error);
      }
    },
  );

  app.get(
    "/internal/tenants/:tenantId/users/:userId/connectors/:connectorId/secrets",
    async (c) => {
      try {
        const connector_id = await store.parseConnectorId(c.req.param("connectorId"));
        const secrets = await store.getUserConnectorSecrets(
          c.req.param("tenantId"),
          c.req.param("userId"),
          connector_id,
        );
        return c.json({
          tenant_id: c.req.param("tenantId"),
          user_id: c.req.param("userId"),
          connector_id,
          secrets,
        });
      } catch (error) {
        throwConnectorHttpError(error);
      }
    },
  );

  app.put(
    "/internal/tenants/:tenantId/users/:userId/connectors/:connectorId/secrets",
    async (c) => {
      const body = putConnectorSecretsSchema.parse(await c.req.json());
      try {
        const connector_id = await store.parseConnectorId(c.req.param("connectorId"));
        const secrets = await store.putUserConnectorSecrets({
          tenant_id: c.req.param("tenantId"),
          user_id: c.req.param("userId"),
          connector_id,
          secrets: parseConnectorSecrets(body.secrets),
          replace: body.replace,
          actor: c.req.header("x-lanyard-actor") ?? "api",
        });
        return c.json({
          tenant_id: c.req.param("tenantId"),
          user_id: c.req.param("userId"),
          connector_id,
          secrets,
        });
      } catch (error) {
        throwConnectorHttpError(error);
      }
    },
  );

  app.get(
    "/internal/tenants/:tenantId/users/:userId/connectors/:connectorId",
    async (c) => {
      try {
        const connection = await store.getUserConnectorConnection(
          c.req.param("tenantId"),
          c.req.param("userId"),
          await store.parseConnectorId(c.req.param("connectorId")),
        );
        if (!connection) {
          throw new HTTPException(404, {
            message: "Connector connection not found",
          });
        }
        assertPublicConnectorJson(connection);
        return c.json(connection);
      } catch (error) {
        throwConnectorHttpError(error);
      }
    },
  );

  app.put(
    "/internal/tenants/:tenantId/users/:userId/connectors/:connectorId",
    async (c) => {
      const body = upsertConnectorConnectionSchema.parse(await c.req.json());
      try {
        const tenant_id = c.req.param("tenantId");
        const user_id = c.req.param("userId");
        const connector_id = await store.parseConnectorId(c.req.param("connectorId"));
        const connection = await store.upsertUserConnectorConnection({
          tenant_id,
          user_id,
          connector_id,
          status: body.status,
          account_label: body.account_label,
          sticky: body.sticky ? parseSticky(body.sticky) : undefined,
          secrets: body.secrets
            ? parseConnectorSecrets(body.secrets)
            : undefined,
          actor: c.req.header("x-lanyard-actor") ?? "api",
        });
        if (shouldProvisionUserSandbox(connection.status)) {
          await store.ensureUserSandboxInstance({
            tenant_id,
            owner_user_id: user_id,
            actor: c.req.header("x-lanyard-actor") ?? "api",
          });
        }
        assertPublicConnectorJson(connection);
        return c.json(connection);
      } catch (error) {
        throwConnectorHttpError(error);
      }
    },
  );

  app.post(
    "/internal/tenants/:tenantId/users/:userId/connectors/:connectorId/refresh",
    async (c) => {
      try {
        const tenant_id = c.req.param("tenantId");
        const user_id = c.req.param("userId");
        const connector_id = await store.parseConnectorId(c.req.param("connectorId"));
        const result = await applyConnectorLifecycle(
          {
            kind: "refresh",
            tenant_id,
            user_id,
            connector_id,
            actor: c.req.header("x-lanyard-actor") ?? "api",
          },
          connectorLifecyclePorts,
        );
        const refreshed = result.refreshed[0];
        const connection = await store.getUserConnectorConnection(
          tenant_id,
          user_id,
          connector_id,
        );
        const body = {
          tenant_id,
          user_id,
          connector_id,
          status: refreshed?.status ?? connection?.status ?? "needs_reauth",
          account_label: connection?.account_label ?? null,
          wizard: result.wizard,
        };
        assertPublicConnectorJson(body);
        return c.json(body);
      } catch (error) {
        throwConnectorHttpError(error);
      }
    },
  );

  app.delete(
    "/internal/tenants/:tenantId/users/:userId/connectors/:connectorId",
    async (c) => {
      try {
        const tenant_id = c.req.param("tenantId");
        const user_id = c.req.param("userId");
        const connector_id = await store.parseConnectorId(c.req.param("connectorId"));
        const result = await applyConnectorLifecycle(
          {
            kind: "user_disconnect",
            tenant_id,
            user_id,
            connector_id,
            actor: c.req.header("x-lanyard-actor") ?? "api",
          },
          connectorLifecyclePorts,
        );
        const deleted = result.deleted[0];
        return c.json({
          ok: true,
          connector_id,
          revoke_attempted: deleted?.revoke_attempted === true,
          cache_dropped: deleted?.cache_dropped === true,
        });
      } catch (error) {
        throwConnectorHttpError(error);
      }
    },
  );

  app.delete(
    "/internal/tenants/:tenantId/users/:userId/connectors",
    async (c) => {
      try {
        const tenant_id = c.req.param("tenantId");
        const user_id = c.req.param("userId");
        const result = await applyConnectorLifecycle(
          {
            kind: "user_removed",
            tenant_id,
            user_id,
            actor: c.req.header("x-lanyard-actor") ?? "api",
          },
          connectorLifecyclePorts,
        );
        return c.json({
          ok: true,
          user_id,
          deleted: result.deleted.map((row) => row.connector_id),
        });
      } catch (error) {
        throwConnectorHttpError(error);
      }
    },
  );

  /**
   * Same-tenant member directory (share picker). Safe fields only.
   * Optional `q` filters by email substring (case-insensitive).
   */
  app.get("/internal/tenants/:tenantId/users", async (c) => {
    try {
      const q = c.req.query("q") ?? undefined;
      const members = await store.listTenantUsers(c.req.param("tenantId"), {
        q,
      });
      return c.json({
        tenant_id: c.req.param("tenantId"),
        members,
      });
    } catch (error) {
      if (error instanceof TenantNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      throw error;
    }
  });

  app.get("/internal/tenants/:tenantId/users/:userId/rbac", async (c) => {
    const tenant = await store.getTenantById(c.req.param("tenantId"));
    if (!tenant) {
      throw new HTTPException(404, { message: "Tenant not found" });
    }

    const rbac = await store.getUserRbac(
      c.req.param("tenantId"),
      c.req.param("userId"),
    );
    return c.json({
      tenant_id: c.req.param("tenantId"),
      user_id: c.req.param("userId"),
      rbac,
    });
  });

  app.get("/internal/tenants/:id/primary-instance", async (c) => {
    const tenant = await store.getTenantById(c.req.param("id"));
    if (!tenant) {
      throw new HTTPException(404, { message: "Tenant not found" });
    }

    const primary = await store.getPrimaryActiveInstance(c.req.param("id"));
    if (!primary) {
      throw new HTTPException(404, {
        message: "No active gateway instance for tenant",
      });
    }

    return c.json({
      tenant_id: c.req.param("id"),
      instance_id: primary.instance_id,
    });
  });

  app.get("/internal/tenants/by-slug/:slug", async (c) => {
    const tenant = await store.getTenantBySlug(c.req.param("slug"));
    if (!tenant) {
      throw new HTTPException(404, {
        message: `Unknown tenant slug: ${c.req.param("slug")}`,
      });
    }
    return c.json(tenant);
  });

  app.get("/internal/tenants/by-id/:id", async (c) => {
    const tenant = await store.getTenantById(c.req.param("id"));
    if (!tenant) {
      throw new HTTPException(404, {
        message: `Unknown tenant id: ${c.req.param("id")}`,
      });
    }
    return c.json(tenant);
  });

  app.get("/tenants/by-id/:id", async (c) => {
    const tenant = await store.getTenantById(c.req.param("id"));
    if (!tenant) {
      throw new HTTPException(404, { message: "Tenant not found" });
    }
    return c.json(tenant);
  });

  app.post("/internal/instances/validate", async (c) => {
    const body = validateSecretSchema.parse(await c.req.json());
    const result = await validateInstanceSecret(
      store,
      body.instance_id,
      body.secret,
      { audit: true },
    );
    return c.json(result, result.valid ? 200 : 401);
  });

  // -------------------------------------------------------------------------
  // Instance Orchestrator internal API (lp-biq / lp-84f / lp-nus / lp-cbv)
  // Paths: ORCHESTRATOR_API_PATHS — BFF client must match.
  // ensure-online + stop: wired when options.instanceOrchestrator is set
  //   (lp-nus wake; lp-cbv stop); else 501.
  // Presence GET reads field catalog; signal-activity bumps last_activity_at.
  // -------------------------------------------------------------------------

  /**
   * POST ensure-online — wake path for on-demand sandboxes (lp-nus).
   * Singleflight per instance_id via InstanceOrchestrator.ensureOnline.
   * Online short-circuit; offline|error → create/start; timeout → error.
   * When orchestrator not injected → 501 (Daytona not ready / tests without orch).
   */
  app.post(ORCHESTRATOR_ROUTE_TEMPLATES.ensureOnline, async (c) => {
    const instanceId = c.req.param("instanceId");
    const body = await parseEnsureOnlineBody(c);

    const orch = options.instanceOrchestrator;
    if (!orch) {
      // Keep 404 for unknown instances even when orchestrator is unwired so
      // clients cannot probe wiring status via missing ids.
      const instance = await store.getInstance(instanceId);
      if (!instance) {
        throw new HTTPException(404, { message: "Instance not found" });
      }
      return c.json(
        orchestratorNotImplementedBody("ensure_online", instanceId),
        501,
      );
    }

    try {
      const result = await orch.ensureOnline(instanceId, body);
      return c.json(result);
    } catch (err) {
      return respondEnsureOnlineFailure(c, err);
    }
  });

  /**
   * POST ensure-bound-stopped — create-ahead (lp-vqr0.7).
   * Bind a stopped sandbox when sandbox_id is null; no-op if already bound.
   * Does not promote presence online. Subsequent ensure-online is
   * start_from_stopped.
   */
  app.post(ORCHESTRATOR_ROUTE_TEMPLATES.ensureBoundStopped, async (c) => {
    const instanceId = c.req.param("instanceId");
    const orch = options.instanceOrchestrator;
    if (!orch?.ensureBoundStoppedSandbox) {
      const instance = await store.getInstance(instanceId);
      if (!instance) {
        throw new HTTPException(404, { message: "Instance not found" });
      }
      return c.json(
        orchestratorNotImplementedBody("ensure_bound_stopped", instanceId),
        501,
      );
    }

    try {
      const result = await orch.ensureBoundStoppedSandbox(instanceId);
      return c.json(result);
    } catch (err) {
      if (err instanceof OrchestratorInstanceNotFoundError) {
        throw new HTTPException(404, { message: "Instance not found" });
      }
      if (err instanceof OrchestratorInstanceRevokedError) {
        throw new HTTPException(403, { message: "Instance is revoked" });
      }
      if (err instanceof DaytonaPathGatedError) {
        return c.json(
          {
            error: "daytona_path_gated",
            code: err.code,
            reason: err.reason,
            instance_id: err.instanceId,
            tenant_id: err.tenantId,
            message: err.message,
          },
          403,
        );
      }
      if (err instanceof EnsureBoundStoppedSandboxError) {
        return c.json(
          {
            error: "ensure_bound_stopped_failed",
            code: err.code,
            instance_id: err.instanceId,
            message: err.message,
          },
          502,
        );
      }
      throw err;
    }
  });

  /**
   * POST ensure-online by tenant+user (lp-oop.19).
   * Resolver picks user-scope instance else tenant primary; wake stays
   * `ensureOnline(instanceId)`. Fail closed when neither exists.
   */
  app.post(ENSURE_ONLINE_BY_USER_ROUTE_TEMPLATE, async (c) => {
    const key = parseSandboxKey({
      tenant_id: c.req.param("tenantId"),
      user_id: c.req.param("userId"),
    });
    if (!key) {
      throw new HTTPException(400, {
        message: "SandboxKey requires non-empty tenant_id and user_id",
      });
    }

    const records = await loadScopedInstancesForTenant(
      key.tenant_id,
      store,
      options.scopedInstanceRecords,
    );
    const resolved = resolveInstanceIdForUser(key, records);
    if (!resolved.ok) {
      throw new HTTPException(resolved.httpStatus, {
        message: resolved.message,
      });
    }

    const body = await parseEnsureOnlineBody(c);
    const orch: EnsureOnlineOrchestrator | undefined | null =
      options.instanceOrchestrator;
    if (!orch) {
      const instance = await store.getInstance(resolved.instance_id);
      if (!instance) {
        throw new HTTPException(404, { message: "Instance not found" });
      }
      return c.json(
        orchestratorNotImplementedBody("ensure_online", resolved.instance_id),
        501,
      );
    }

    try {
      const result = await orch.ensureOnline(resolved.instance_id, body);
      const payload: EnsureOnlineByUserResponse = {
        ...result,
        user_id: key.user_id,
        source: resolved.source,
      };
      return c.json(payload);
    } catch (err) {
      return respondEnsureOnlineFailure(c, err);
    }
  });

  /**
   * GET presence — current orchestrator presence + dual-run fields (lp-nye).
   * last_activity_at is durable on gateway_instances (lp-omt).
   * agent_ready follows presence `online`; vault_writable is independent
   * (lp-vqr0.4).
   */
  app.get(ORCHESTRATOR_ROUTE_TEMPLATES.presence, async (c) => {
    const instanceId = c.req.param("instanceId");
    const instance = await store.getInstance(instanceId);
    if (!instance) {
      throw new HTTPException(404, { message: "Instance not found" });
    }

    const readiness = instanceReadiness(
      instance.presence,
      instance.vault_writable,
    );
    const body: InstancePresenceResponse = {
      instance_id: instance.instance_id,
      tenant_id: instance.tenant_id,
      presence: instance.presence,
      sandbox_id: instance.sandbox_id,
      runtime_kind: instance.runtime_kind,
      agent_snapshot_id: instance.agent_snapshot_id,
      s3_vault_prefix: instance.s3_vault_prefix,
      last_activity_at: instance.last_activity_at ?? null,
      revoked_at: instance.revoked_at,
      agent_ready: readiness.agent_ready,
      vault_writable: readiness.vault_writable,
    };
    return c.json(body);
  });

  /**
   * POST signal-activity — bump last_activity_at for idle grace (lp-84f)
   * and optionally arm/clear mid-turn lock (lp-053) or spine stop_after
   * (lp-k5c4.4). Auth: same service-token / ops-token gate as other
   * /internal/* routes. Does not call Daytona.
   */
  app.post(ORCHESTRATOR_ROUTE_TEMPLATES.signalActivity, async (c) => {
    const instanceId = c.req.param("instanceId");
    let raw: unknown = {};
    const contentType = c.req.header("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const text = await c.req.text();
      if (text.trim()) {
        raw = JSON.parse(text) as unknown;
      }
    }
    const body = signalActivityRequestSchema.parse(raw);

    const instances = resolveOrchestratorInstances();
    if (!instances) {
      throw new HTTPException(503, {
        message: "Orchestrator instance store is not available",
      });
    }

    const existing = await instances.get(instanceId);
    if (!existing) {
      throw new HTTPException(404, { message: "Instance not found" });
    }
    if (existing.revoked_at) {
      throw new HTTPException(403, { message: "Instance is revoked" });
    }

    let atDate: Date;
    let atIso: string;
    if (body.at !== undefined) {
      // Schema already enforces ISO datetime; normalize to UTC ISO.
      atDate = new Date(body.at);
      atIso = atDate.toISOString();
    } else {
      atDate = new Date();
      atIso = atDate.toISOString();
    }

    const patch: {
      last_activity_at: string;
      mid_turn?: boolean;
      mid_turn_until?: string | null;
      stop_after?: string | null;
    } = {
      last_activity_at: atIso,
    };
    // lp-053: optional mid_turn from BFF/gateway activity signals.
    if (body.mid_turn !== undefined) {
      const mid = resolveMidTurnPatch(body.mid_turn, atDate);
      patch.mid_turn = mid.mid_turn;
      patch.mid_turn_until = mid.mid_turn_until;
    }
    const hotWindow = resolveSpineHotWindowPatch(body, atDate);
    if (hotWindow) {
      patch.stop_after = hotWindow.stop_after;
    }

    const updated = await instances.update(instanceId, patch);

    const response: SignalActivityResponse = {
      instance_id: updated.instance_id,
      tenant_id: updated.tenant_id,
      presence: updated.presence,
      last_activity_at: updated.last_activity_at ?? atIso,
      mid_turn: updated.mid_turn ?? false,
      mid_turn_until: updated.mid_turn_until ?? null,
      stop_after: updated.stop_after ?? null,
    };
    return c.json(response);
  });

  /**
   * POST stop — explicit or idle stop of Daytona sandbox compute (lp-cbv).
   * When instanceOrchestrator is injected, delegates to orch.stop (Fake or live
   * Daytona). Does not clear permanent instance_id / s3_vault_prefix
   * (identity-model). When orchestrator not wired → 501.
   */
  app.post(ORCHESTRATOR_ROUTE_TEMPLATES.stop, async (c) => {
    const instanceId = c.req.param("instanceId");
    let raw: unknown = {};
    const contentType = c.req.header("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const text = await c.req.text();
      if (text.trim()) {
        raw = JSON.parse(text) as unknown;
      }
    }
    const body = stopInstanceRequestSchema.parse(raw) as StopInstanceRequest;

    const orch = options.instanceOrchestrator;
    if (!orch?.stop) {
      // Keep 404 for unknown instances even when orchestrator is unwired.
      const instance = await store.getInstance(instanceId);
      if (!instance) {
        throw new HTTPException(404, { message: "Instance not found" });
      }
      return c.json(orchestratorNotImplementedBody("stop", instanceId), 501);
    }

    try {
      const result = await orch.stop(instanceId, body);
      return c.json(result);
    } catch (err) {
      if (err instanceof OrchestratorInstanceNotFoundError) {
        throw new HTTPException(404, { message: "Instance not found" });
      }
      if (err instanceof OrchestratorInstanceRevokedError) {
        throw new HTTPException(403, { message: "Instance is revoked" });
      }
      throw err;
    }
  });

  // -------------------------------------------------------------------------
  // Vault UI plane (lp-oop.9): list / stat / get under the tenant prefix.
  // Put/CAS (lp-zuh.12.7) for Office callback writeback on VaultPlane=cp_s3.
  // Inject VaultObjectStore (InMemoryS3 in tests). No Daytona wake.
  // -------------------------------------------------------------------------
  const vaultHttpQuery = (c: { req: { query: () => Record<string, string> } }) =>
    c.req.query();

  const respondVaultHttp = (
    c: {
      json: (
        body: unknown,
        status?: 400 | 403 | 404 | 409 | 413 | 501 | 503,
      ) => Response;
    },
    error: unknown,
  ): Response => {
    if (error instanceof VaultHttpError) {
      return c.json(error.toBody(), error.httpStatus);
    }
    if (error instanceof InvalidVaultPathError) {
      throw new HTTPException(400, { message: error.message });
    }
    throw error;
  };

  app.get(VAULT_HTTP_ROUTE_TEMPLATES.list, async (c) => {
    try {
      const wired = requireVaultHttpDeps({
        store: options.vaultObjectStore,
        bucket: options.vaultBucket,
      });
      const query = vaultHttpListQuerySchema.parse(vaultHttpQuery(c));
      const body = await listTenantVault(
        {
          store: wired.store,
          bucket: wired.bucket,
          tenantId: c.req.param("tenantId"),
        },
        query,
      );
      return c.json(body);
    } catch (error) {
      return respondVaultHttp(c, error);
    }
  });

  app.get(VAULT_HTTP_ROUTE_TEMPLATES.stat, async (c) => {
    try {
      const wired = requireVaultHttpDeps({
        store: options.vaultObjectStore,
        bucket: options.vaultBucket,
      });
      const query = vaultHttpPathQuerySchema.parse(vaultHttpQuery(c));
      const body = await statTenantVault(
        {
          store: wired.store,
          bucket: wired.bucket,
          tenantId: c.req.param("tenantId"),
        },
        query,
      );
      return c.json(body);
    } catch (error) {
      return respondVaultHttp(c, error);
    }
  });

  app.get(VAULT_HTTP_ROUTE_TEMPLATES.get, async (c) => {
    try {
      const wired = requireVaultHttpDeps({
        store: options.vaultObjectStore,
        bucket: options.vaultBucket,
      });
      const query = vaultHttpPathQuerySchema.parse(vaultHttpQuery(c));
      const body = await getTenantVault(
        {
          store: wired.store,
          bucket: wired.bucket,
          tenantId: c.req.param("tenantId"),
        },
        query,
      );
      return c.json(body);
    } catch (error) {
      return respondVaultHttp(c, error);
    }
  });

  app.put(VAULT_HTTP_ROUTE_TEMPLATES.put, async (c) => {
    try {
      const wired = requireVaultHttpDeps({
        store: options.vaultObjectStore,
        bucket: options.vaultBucket,
      });
      const raw = await c.req.json();
      const parsed = vaultHttpPutBodySchema.safeParse(raw);
      if (!parsed.success) {
        throw new VaultHttpError(
          "VAULT_INVALID_BODY",
          parsed.error.issues[0]?.message ?? "Invalid vault put body",
          400,
          { tenantId: c.req.param("tenantId") },
        );
      }
      const result = await putTenantVault(
        {
          store: wired.store,
          bucket: wired.bucket,
          tenantId: c.req.param("tenantId"),
        },
        parsed.data,
      );
      return c.json(result, result.created ? 201 : 200);
    } catch (error) {
      return respondVaultHttp(c, error);
    }
  });

  // lp-2qs.7: union source for /admin tenants page. Lists `tenants/` common
  // prefixes and validates each segment through assertValidTenantIdForVaultPrefix.
  // No @aws-sdk in BFF — CP is the only S3 caller. Missing store/bucket returns
  // 200 with empty list so the ops tenants page does not 501 (BFF falls back to CP).
  app.get(VAULT_TENANT_PREFIXES_ROUTE, async (c) => {
    const bucket = options.vaultBucket?.trim() ?? "";
    const store = options.vaultObjectStore ?? null;
    if (!store || !bucket) {
      return c.json({ tenant_ids: [] }, 200);
    }
    const tenant_ids = await listVaultTenantIds({ bucket, store });
    return c.json({ tenant_ids }, 200);
  });

  app.get("/internal/tenants/:id/retention", async (c) => {
    requireInternalOpsToken(
      internalOpsToken,
      c.req.header(INTERNAL_OPS_TOKEN_HEADER),
    );

    const retention = await store.getTenantRetention(c.req.param("id"));
    if (!retention) {
      throw new HTTPException(404, { message: "Tenant not found" });
    }

    return c.json({
      tenant_id: c.req.param("id"),
      ...retention,
    });
  });

  app.get("/internal/tenants/:id/relay-tier", async (c) => {
    requireInternalOpsToken(
      internalOpsToken,
      c.req.header(INTERNAL_OPS_TOKEN_HEADER),
    );

    const tenant = await store.getTenantById(c.req.param("id"));
    if (!tenant) {
      throw new HTTPException(404, { message: "Tenant not found" });
    }

    return c.json({
      tenant_id: c.req.param("id"),
      ...tenant.relay,
    });
  });

  app.patch("/internal/tenants/:id/relay-tier", async (c) => {
    requireInternalOpsToken(
      internalOpsToken,
      c.req.header(INTERNAL_OPS_TOKEN_HEADER),
    );

    const body = updateRelayTierSchema.parse(await c.req.json());

    try {
      const relay = await store.updateTenantRelayTier({
        tenant_id: c.req.param("id"),
        relay_tier: body.relay_tier,
        dedicated_relay_wss_url: body.dedicated_relay_wss_url,
        actor: c.req.header("x-lanyard-actor") ?? "internal-ops",
      });
      return c.json({
        tenant_id: c.req.param("id"),
        ...relay,
      });
    } catch (error) {
      if (error instanceof TenantNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      throw error;
    }
  });

  app.get("/internal/tenants/:id/chat-delivery", async (c) => {
    requireInternalOpsToken(
      internalOpsToken,
      c.req.header(INTERNAL_OPS_TOKEN_HEADER),
    );

    const tenant = await store.getTenantById(c.req.param("id"));
    if (!tenant) {
      throw new HTTPException(404, { message: "Tenant not found" });
    }

    return c.json({
      tenant_id: c.req.param("id"),
      chat_delivery: tenant.chat_delivery,
    });
  });

  app.patch("/internal/tenants/:id/chat-delivery", async (c) => {
    requireInternalOpsToken(
      internalOpsToken,
      c.req.header(INTERNAL_OPS_TOKEN_HEADER),
    );

    const body = updateChatDeliverySchema.parse(await c.req.json());

    try {
      const chat_delivery = await store.updateTenantChatDelivery({
        tenant_id: c.req.param("id"),
        chat_delivery: body.chat_delivery,
        actor: c.req.header("x-lanyard-actor") ?? "internal-ops",
      });
      return c.json({
        tenant_id: c.req.param("id"),
        chat_delivery,
      });
    } catch (error) {
      if (error instanceof TenantNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      throw error;
    }
  });

  app.patch("/internal/tenants/:id/retention", async (c) => {
    requireInternalOpsToken(
      internalOpsToken,
      c.req.header(INTERNAL_OPS_TOKEN_HEADER),
    );

    const body = updateRetentionSchema.parse(await c.req.json());

    try {
      const retention = await store.updateTenantRetention({
        tenant_id: c.req.param("id"),
        interaction_export_enabled: body.interaction_export_enabled,
        retention_mode: body.retention_mode,
        chat_corpus_enabled: body.chat_corpus_enabled,
        chat_corpus_retention_days: body.chat_corpus_retention_days,
        actor: c.req.header("x-lanyard-actor") ?? "internal-ops",
      });
      return c.json({
        tenant_id: c.req.param("id"),
        ...retention,
      });
    } catch (error) {
      if (error instanceof TenantNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      throw error;
    }
  });

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ error: error.message }, error.status);
    }
    if (error instanceof z.ZodError) {
      return c.json(
        { error: "Validation failed", details: error.flatten() },
        400,
      );
    }
    // Structured + redacted (no vault/body dumps on shared sinks — G2b.2).
    log.error("unhandled error", {
      error,
      route: c.req.path,
      method: c.req.method,
    });
    return c.json({ error: "Internal server error" }, 500);
  });

  return app;
}