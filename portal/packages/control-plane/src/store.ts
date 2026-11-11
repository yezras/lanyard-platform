import { randomUUID } from "node:crypto";
import {
  redactAuditMetadata,
  type OpsSecretSlot,
} from "@lanyard/shared";

import {
  isUniqueViolation,
  openDatabase,
  resolveDatabaseUrl,
  type SqlClient,
} from "./db.js";
import {
  generateInstanceSecret,
  hashInstanceSecret,
  hashPassword,
  verifyInstanceSecret,
  verifyPassword,
} from "./crypto.js";
import { migrateControlPlaneSchema } from "./migrate.js";
import {
  createProject as createProjectRecord,
  deleteProject as deleteProjectRecord,
  getProject as getProjectRecord,
  listProjects as listTenantProjects,
  updateProject as updateProjectRecord,
} from "./projects.js";
import {
  createRole as createRoleRecord,
  getUserRbac as resolveUserRbac,
  listRoles as listTenantRoles,
  setUserRoles as setUserRoleAssignments,
  UserEmailConflictError,
  UserNotFoundError,
} from "./rbac.js";
export { UserEmailConflictError } from "./rbac.js";
import {
  createSessionShareGrant as createSessionShareGrantRecord,
  getActiveSessionShareGrant as getActiveSessionShareGrantRecord,
  getUserByEmail as getTenantUserByEmail,
  listSessionShareGrantsForGrantee as listSessionShareGrantsForGranteeRecord,
  listSessionShareGrantsForThread as listSessionShareGrantsForThreadRecord,
  revokeSessionShareGrant as revokeSessionShareGrantRecord,
} from "./session-shares.js";
import {
  getTenantDeployment as getTenantDeploymentRecord,
  listTenantResourceRefs as listTenantResourceRefsRecord,
  offboardTenantRegistry,
  retireTenantResourceRef as retireTenantResourceRefRecord,
  updateInstanceRegistry as updateInstanceRegistryRecord,
  upsertTenantDeployment as upsertTenantDeploymentRecord,
  upsertTenantResourceRef as upsertTenantResourceRefRecord,
} from "./deployment-registry.js";
export {
  CrossTenantResourceRefError,
  InvalidDeploymentInputError,
  ResourceRefNotFoundError,
} from "./deployment-registry.js";
import {
  buildDaytonaProvisionFields,
  buildGatewayInstanceProvisionFields,
  InvalidProvisionInputError,
} from "./provision-daytona.js";
export { InvalidProvisionInputError } from "./provision-daytona.js";
// lp-zoh.2 / plan 0010: dual vault prefix builders + exact-shape asserters.
import {
  assertS3PersonalVaultPrefixBoundToTenantUser,
  assertS3SharedVaultPrefixBoundToTenant,
  buildPersonalVaultPrefix,
  buildSharedVaultPrefix,
  VaultPrefixError,
} from "./vault-prefix.js";
import {
  materialFromIssued,
  type InstanceSecretMaterialStore,
} from "./gateway-relay-env.js";
import type { ConnectorKms } from "./connector-kms.js";
import {
  deleteConnectionsForConnector as deleteConnectionsForConnectorRecord,
  deleteUserConnectorConnection as deleteUserConnectorConnectionRecord,
  getTenantConnectorEntitlement as getTenantConnectorEntitlementRecord,
  getUserConnectorAccess as getUserConnectorAccessRecord,
  listUserGrantedConnectors as listUserGrantedConnectorsRecord,
  getUserConnectorConnection as getUserConnectorConnectionRecord,
  getUserConnectorSecrets as getUserConnectorSecretsRecord,
  listConnectorCatalog as listConnectorCatalogRecord,
  listRoleConnectorGrants as listRoleConnectorGrantsRecord,
  listTenantConnectorConnections as listTenantConnectorConnectionsRecord,
  listTenantConnectorEntitlements as listTenantConnectorEntitlementsRecord,
  listUserConnectorConnections as listUserConnectorConnectionsRecord,
  listUserIdsLosingRoleConnectorGrant as listUserIdsLosingRoleConnectorGrantRecord,
  parseConnectorId as parseConnectorIdRecord,
  putUserConnectorSecrets as putUserConnectorSecretsRecord,
  upsertRoleConnectorGrant as upsertRoleConnectorGrantRecord,
  upsertTenantConnectorEntitlement as upsertTenantConnectorEntitlementRecord,
  upsertUserConnectorConnection as upsertUserConnectorConnectionRecord,
  type ConnectorAccess,
  type UserGrantedConnector,
  type ConnectorCatalog,
  type ConnectorConnectionPublic,
  type ConnectorId,
  type ConnectorSecrets,
  type ConnectorSticky,
  type ConnectionStatus,
  type RoleConnectorGrant,
  type OnboardSurfaceId,
  type TenantConnectorEntitlement,
} from "./connectors.js";
import {
  deleteOpsTenantUser as deleteOpsTenantUserRecord,
  getOpsTenantUser as getOpsTenantUserRecord,
  listOpsConnectorUsers as listOpsConnectorUsersRecord,
  listOpsTenantUsers as listOpsTenantUsersRecord,
  provisionOpsTenantUser as provisionOpsTenantUserRecord,
  setPersonConnectorGrant as setPersonConnectorGrantRecord,
  updateOpsTenantUser as updateOpsTenantUserRecord,
  displayNameFromEmail,
} from "./ops-users.js";
export {
  InvalidTenantRoleError,
  LastTenantAdminError,
} from "./ops-users.js";
import {
  getConnectorMemberSubset as getConnectorMemberSubsetRecord,
  setConnectorMemberSubset as setConnectorMemberSubsetRecord,
  type ConnectorMemberSubset,
  type MemberSubsetKind,
} from "./member-subset.js";
export {
  InvalidMemberSubsetError,
} from "./member-subset.js";
import {
  authorizeHarnessToolCall as authorizeHarnessToolCallGate,
  filterHarnessExposedTools,
  harnessToolCallerFrom,
  listHarnessExposedTools,
  parseHarnessConnectorId,
  parseHarnessToolRef,
  type HarnessExposedTool,
  type HarnessToolAuthorizeResult,
} from "./harness-tool-dispatch.js";
export {
  HarnessToolForbiddenError,
} from "./harness-tool-dispatch.js";
import {
  archiveCanonicalConnector as archiveCanonicalConnectorRecord,
  getCanonicalConnector as getCanonicalConnectorRecord,
  insertCanonicalConnector as insertCanonicalConnectorRecord,
  listCanonicalConnectors as listCanonicalConnectorsRecord,
  lookupCanonicalAlias as lookupCanonicalAliasRecord,
  type CanonicalConnector,
  type InsertCanonicalConnectorInput,
} from "./connector-registry.js";
import {
  deleteTenantProviderSecret,
  getTenantProviderWakeEnvValues,
  listTenantProviderSecretStatuses,
  upsertTenantProviderSecret,
  type TenantProviderSecretStatus,
} from "./provider-secrets.js";
export {
  InvalidProviderSecretSlotError,
  InvalidProviderSecretValueError,
  ProviderSecretKmsNotConfiguredError,
} from "./provider-secrets.js";
import {
  deleteClassCSecret,
  getClassCSecretPayload,
  listClassCSecretStatuses,
  parseClassCConnectorId,
  parseConnectorSurfaceId,
  upsertClassCSecret,
  type ClassCSecretPayload,
  type ClassCSecretStatus,
  type ConnectorSurfaceId,
} from "./class-c-secrets.js";
export {
  ClassCFirstClassConnectorError,
  ClassCKmsNotConfiguredError,
  ClassCSecretNotFoundError,
  InvalidClassCAuthKindError,
  InvalidClassCSecretValueError,
  InvalidConnectorSurfaceError,
} from "./class-c-secrets.js";
import {
  DEFAULT_SHARED_RELAY_WSS_URL,
  resolveTenantRelayWssUrl,
} from "./relay-tier.js";
import type {
  AuditAction,
  AuditEntry,
  AuditResult,
  AuthUser,
  ChatDelivery,
  EnsuredInstance,
  EnsuredUserInstance,
  GatewayInstance,
  GatewayInstancePublic,
  Project,
  ProvisionedInstance,
  RelayTier,
  RetentionMode,
  Role,
  RotatedInstance,
  SessionShareGrant,
  SessionShareMode,
  Tenant,
  TenantDeployment,
  TenantMember,
  TenantRelayPolicy,
  TenantResourceRef,
  TenantRetentionPolicy,
  OpsConnectorUser,
  OpsTenantUser,
  OpsTenantUserRole,
  User,
  UserRbac,
  ValidateInstanceSecretResult,
} from "./types.js";
import {
  CHAT_DELIVERIES,
  DEFAULT_ROTATION_GRACE_PERIOD_SECONDS,
  INSTANCE_HEALTH_STATUSES,
  INSTANCE_PRESENCE_STATES,
  INSTANCE_SCOPES,
  MAX_ROTATION_GRACE_PERIOD_SECONDS,
  RELAY_TIERS,
  RETENTION_MODES,
  RUNTIME_KINDS,
  tenantHost,
  type InstanceHealthStatus,
  type InstancePresence,
  type InstanceScope,
  type RuntimeKind,
} from "./types.js";
import {
  tenantPrimaryRecord,
  userScopeRecord,
  type ScopedInstanceRecord,
} from "./resolve-instance.js";
import { createSqlOrchestratorInstanceStore } from "./presence-store.js";
import type { OrchestratorInstanceStore } from "./instance-orchestrator.js";
import { parseVaultWritable } from "./readiness.js";

export type ControlPlaneStoreOptions = {
  /**
   * Postgres connection URL. Defaults to CONTROL_PLANE_DATABASE_URL or DATABASE_URL.
   * Do not commit secrets — inject via env / GitHub Secrets / SSM.
   */
  databaseUrl?: string;
  /** Optional schema name for test isolation (created on open, dropped on close). */
  schema?: string;
  /** Global relay pool URL returned for shared-tier tenants at provision time. */
  sharedRelayWssUrl?: string;
  /**
   * Platform plaintext material store for Daytona wake inject (lp-9my).
   * Register/rotate put show-once secrets here (never Postgres plaintext).
   * Orchestrator reads on cold create. Omit only when inject is not needed
   * (EC2-only lab, pure unit tests without orchestrator).
   */
  secretMaterial?: InstanceSecretMaterialStore | null;
  /**
   * KMS envelope for connector secrets (lp-xhf4.2). Null → public CRUD still
   * works; encrypt/decrypt of secrets fail closed.
   */
  connectorKms?: ConnectorKms | null;
};

export class ControlPlaneStore {
  private readonly db: SqlClient;
  private readonly sharedRelayWssUrl: string;
  private readonly secretMaterial: InstanceSecretMaterialStore | null;
  private readonly connectorKms: ConnectorKms | null;

  private constructor(
    db: SqlClient,
    sharedRelayWssUrl: string,
    secretMaterial: InstanceSecretMaterialStore | null,
    connectorKms: ConnectorKms | null,
  ) {
    this.db = db;
    this.sharedRelayWssUrl = sharedRelayWssUrl;
    this.secretMaterial = secretMaterial;
    this.connectorKms = connectorKms;
  }

  /**
   * Open a Postgres-backed store and apply schema migrations.
   * Prefer this over the constructor (private) so migrate is always awaited.
   */
  static async create(
    options: ControlPlaneStoreOptions = {},
  ): Promise<ControlPlaneStore> {
    const databaseUrl = resolveDatabaseUrl(options.databaseUrl);
    const sharedRelayWssUrl =
      options.sharedRelayWssUrl?.trim() || DEFAULT_SHARED_RELAY_WSS_URL;
    const db = await openDatabase({
      connectionString: databaseUrl,
      schema: options.schema,
    });
    await migrateControlPlaneSchema(db);
    return new ControlPlaneStore(
      db,
      sharedRelayWssUrl,
      options.secretMaterial ?? null,
      options.connectorKms ?? null,
    );
  }
