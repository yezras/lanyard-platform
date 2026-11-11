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

  private async putSecretMaterial(input: {
    instance_id: string;
    tenant_id: string;
    secret: string;
    relay_wss_url: string;
    relay_tier: RelayTier;
    issued_at?: string;
  }): Promise<void> {
    if (!this.secretMaterial) return;
    await this.secretMaterial.put(materialFromIssued(input));
  }

  private async deleteSecretMaterial(instanceId: string): Promise<void> {
    if (!this.secretMaterial) return;
    await this.secretMaterial.delete(instanceId);
  }

  async close(): Promise<void> {
    await this.db.close();
  }

  private mapTenantRow(row: {
    tenant_id: string;
    tenant_slug: string;
    display_name: string;
    created_at: string;
    interaction_export_enabled?: number | boolean;
    retention_mode?: string;
    chat_corpus_enabled?: number | boolean;
    chat_corpus_retention_days?: number | null;
    relay_tier?: string;
    dedicated_relay_wss_url?: string | null;
    chat_delivery?: string | null;
  }): Tenant {
    const relay = this.resolveTenantRelayPolicy({
      tenant_slug: row.tenant_slug,
      relay_tier: parseRelayTier(row.relay_tier),
      dedicated_relay_wss_url: row.dedicated_relay_wss_url ?? null,
    });
    const rawRetentionDays = row.chat_corpus_retention_days;
    const chat_corpus_retention_days =
      rawRetentionDays === undefined || rawRetentionDays === null
        ? null
        : Number(rawRetentionDays);
    return {
      tenant_id: row.tenant_id,
      tenant_slug: row.tenant_slug,
      display_name: row.display_name,
      host: tenantHost(row.tenant_slug),
      created_at: row.created_at,
      retention: {
        interaction_export_enabled: Boolean(row.interaction_export_enabled ?? 0),
        retention_mode: parseRetentionMode(row.retention_mode),
        chat_corpus_enabled: Boolean(row.chat_corpus_enabled ?? 0),
        chat_corpus_retention_days: Number.isFinite(chat_corpus_retention_days)
          ? chat_corpus_retention_days
          : null,
      },
      relay,
      chat_delivery: parseOptionalChatDelivery(row.chat_delivery),
    };
  }

  resolveTenantRelayPolicy(input: {
    tenant_slug: string;
    relay_tier: RelayTier;
    dedicated_relay_wss_url: string | null;
  }): TenantRelayPolicy {
    return {
      relay_tier: input.relay_tier,
      dedicated_relay_wss_url: input.dedicated_relay_wss_url,
      relay_wss_url: resolveTenantRelayWssUrl(input, this.sharedRelayWssUrl),
    };
  }

  async createTenant(input: {
    slug: string;
    display_name: string;
    actor?: string;
  }): Promise<Tenant> {
    const tenant_id = randomUUID();
    const created_at = new Date().toISOString();
    const tenant_slug = input.slug.trim().toLowerCase();
    try {
      await this.db.run(
        `INSERT INTO tenants (tenant_id, tenant_slug, display_name, created_at)
         VALUES (?, ?, ?, ?)`,
        [tenant_id, tenant_slug, input.display_name, created_at],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new TenantSlugConflictError(tenant_slug);
      }
      throw error;
    }
    await this.recordAudit({
      tenant_id,
      action: "tenant.created",
      actor: input.actor ?? null,
      metadata: {
        tenant_slug,
        display_name: input.display_name,
        host: tenantHost(tenant_slug),
      },
    });
    return this.mapTenantRow({
      tenant_id,
      tenant_slug,
      display_name: input.display_name,
      created_at,
      interaction_export_enabled: 0,
      retention_mode: "none",
      chat_corpus_enabled: 0,
      chat_corpus_retention_days: null,
      relay_tier: "shared",
      dedicated_relay_wss_url: null,
      chat_delivery: null,
    });
  }

  async getTenantById(tenant_id: string): Promise<Tenant | null> {
    let row: {
      tenant_id: string;
      tenant_slug: string;
      display_name: string;
      created_at: string;
      interaction_export_enabled: number;
      retention_mode: string;
      chat_corpus_enabled: number;
      chat_corpus_retention_days: number | null;
      relay_tier: string;
      dedicated_relay_wss_url: string | null;
      chat_delivery: string | null;
    } | undefined;
    try {
      row = await this.db.get<{
        tenant_id: string;
        tenant_slug: string;
        display_name: string;
        created_at: string;
        interaction_export_enabled: number;
        retention_mode: string;
        chat_corpus_enabled: number;
        chat_corpus_retention_days: number | null;
        relay_tier: string;
        dedicated_relay_wss_url: string | null;
        chat_delivery: string | null;
      }>(
        `SELECT tenant_id, tenant_slug, display_name, created_at,
                interaction_export_enabled, retention_mode,
                chat_corpus_enabled, chat_corpus_retention_days,
                relay_tier, dedicated_relay_wss_url, chat_delivery
         FROM tenants WHERE tenant_id = ?`,
        [tenant_id],
      );
    } catch (error) {
      if (/column.*chat_delivery/i.test(String(error))) {
        const fallback = await this.db.get<{
          tenant_id: string;
          tenant_slug: string;
          display_name: string;
          created_at: string;
          interaction_export_enabled: number;
          retention_mode: string;
          chat_corpus_enabled: number;
          chat_corpus_retention_days: number | null;
          relay_tier: string;
          dedicated_relay_wss_url: string | null;
        }>(
          `SELECT tenant_id, tenant_slug, display_name, created_at,
                  interaction_export_enabled, retention_mode,
                  chat_corpus_enabled, chat_corpus_retention_days,
                  relay_tier, dedicated_relay_wss_url
           FROM tenants WHERE tenant_id = ?`,
          [tenant_id],
        );
        if (!fallback) return null;
        return this.mapTenantRow({ ...fallback, chat_delivery: null });
      }
      throw error;
    }
    if (!row) return null;
    return this.mapTenantRow(row);
  }

  async getTenantBySlug(slug: string): Promise<Tenant | null> {
    const tenant_slug = slug.trim().toLowerCase();
    let row: {
      tenant_id: string;
      tenant_slug: string;
      display_name: string;
      created_at: string;
      interaction_export_enabled: number;
      retention_mode: string;
      chat_corpus_enabled: number;
      chat_corpus_retention_days: number | null;
      relay_tier: string;
      dedicated_relay_wss_url: string | null;
      chat_delivery: string | null;
    } | undefined;
    try {
      row = await this.db.get<{
        tenant_id: string;
        tenant_slug: string;
        display_name: string;
        created_at: string;
        interaction_export_enabled: number;
        retention_mode: string;
        chat_corpus_enabled: number;
        chat_corpus_retention_days: number | null;
        relay_tier: string;
        dedicated_relay_wss_url: string | null;
        chat_delivery: string | null;
      }>(
        `SELECT tenant_id, tenant_slug, display_name, created_at,
                interaction_export_enabled, retention_mode,
                chat_corpus_enabled, chat_corpus_retention_days,
                relay_tier, dedicated_relay_wss_url, chat_delivery
         FROM tenants WHERE tenant_slug = ?`,
        [tenant_slug],
      );
    } catch (error) {
      if (/column.*chat_delivery/i.test(String(error))) {
        const fallback = await this.db.get<{
          tenant_id: string;
          tenant_slug: string;
          display_name: string;
          created_at: string;
          interaction_export_enabled: number;
          retention_mode: string;
          chat_corpus_enabled: number;
          chat_corpus_retention_days: number | null;
          relay_tier: string;
          dedicated_relay_wss_url: string | null;
        }>(
          `SELECT tenant_id, tenant_slug, display_name, created_at,
                  interaction_export_enabled, retention_mode,
                  chat_corpus_enabled, chat_corpus_retention_days,
                  relay_tier, dedicated_relay_wss_url
           FROM tenants WHERE tenant_slug = ?`,
          [tenant_slug],
        );
        if (!fallback) return null;
        return this.mapTenantRow({ ...fallback, chat_delivery: null });
      }
      throw error;
    }
    if (!row) return null;
    return this.mapTenantRow(row);
  }

  async getTenantRetention(tenant_id: string): Promise<TenantRetentionPolicy | null> {
    const tenant = await this.getTenantById(tenant_id);
    return tenant?.retention ?? null;
  }

  async updateTenantRetention(input: {
    tenant_id: string;
    interaction_export_enabled?: boolean;
    retention_mode?: RetentionMode;
    chat_corpus_enabled?: boolean;
    chat_corpus_retention_days?: number | null;
    actor?: string;
  }): Promise<TenantRetentionPolicy> {
    const tenant = await this.getTenantById(input.tenant_id);
    if (!tenant) throw new TenantNotFoundError(input.tenant_id);
    const next: TenantRetentionPolicy = {
      interaction_export_enabled:
        input.interaction_export_enabled ?? tenant.retention.interaction_export_enabled,
      retention_mode: input.retention_mode ?? tenant.retention.retention_mode,
      chat_corpus_enabled:
        input.chat_corpus_enabled ?? tenant.retention.chat_corpus_enabled,
      chat_corpus_retention_days:
        input.chat_corpus_retention_days !== undefined
          ? input.chat_corpus_retention_days
          : tenant.retention.chat_corpus_retention_days,
    };
    await this.db.run(
      `UPDATE tenants
       SET interaction_export_enabled = ?,
           retention_mode = ?,
           chat_corpus_enabled = ?,
           chat_corpus_retention_days = ?
       WHERE tenant_id = ?`,
      [
        next.interaction_export_enabled ? 1 : 0,
        next.retention_mode,
        next.chat_corpus_enabled ? 1 : 0,
        next.chat_corpus_retention_days,
        input.tenant_id,
      ],
    );
    await this.recordAudit({
      tenant_id: input.tenant_id,
      action: "tenant.retention_updated",
      actor: input.actor ?? null,
      metadata: {
        tenant_slug: tenant.tenant_slug,
        interaction_export_enabled: next.interaction_export_enabled,
        retention_mode: next.retention_mode,
        chat_corpus_enabled: next.chat_corpus_enabled,
        chat_corpus_retention_days: next.chat_corpus_retention_days,
      },
    });
    return next;
  }

  async updateTenantChatDelivery(input: {
    tenant_id: string;
    chat_delivery: ChatDelivery | null;
    actor?: string;
  }): Promise<ChatDelivery | null> {
    const tenant = await this.getTenantById(input.tenant_id);
    if (!tenant) throw new TenantNotFoundError(input.tenant_id);
    const next = parseOptionalChatDelivery(input.chat_delivery);
    try {
      await this.db.run(
        `UPDATE tenants SET chat_delivery = ? WHERE tenant_id = ?`,
        [next, input.tenant_id],
      );
    } catch (error) {
      if (/column.*chat_delivery/i.test(String(error))) {
        await this.recordAudit({
          tenant_id: input.tenant_id,
          action: "tenant.chat_delivery_updated",
          actor: input.actor ?? null,
          metadata: {
            tenant_slug: tenant.tenant_slug,
            chat_delivery: next,
            note: "lp-k5c4.13 dropped — no column write",
          },
        });
        return next;
      }
      throw error;
    }
    await this.recordAudit({
      tenant_id: input.tenant_id,
      action: "tenant.chat_delivery_updated",
      actor: input.actor ?? null,
      metadata: { tenant_slug: tenant.tenant_slug, chat_delivery: next },
    });
    return next;
  }

  async updateTenantRelayTier(input: {
    tenant_id: string;
    relay_tier: RelayTier;
    dedicated_relay_wss_url?: string | null;
    actor?: string;
  }): Promise<TenantRelayPolicy> {
    const tenant = await this.getTenantById(input.tenant_id);
    if (!tenant) throw new TenantNotFoundError(input.tenant_id);
    const dedicated_relay_wss_url =
      input.relay_tier === "shared"
        ? null
        : (input.dedicated_relay_wss_url?.trim() || tenant.relay.dedicated_relay_wss_url);
    await this.db.run(
      `UPDATE tenants SET relay_tier = ?, dedicated_relay_wss_url = ? WHERE tenant_id = ?`,
      [input.relay_tier, dedicated_relay_wss_url, input.tenant_id],
    );
    const next = this.resolveTenantRelayPolicy({
      tenant_slug: tenant.tenant_slug,
      relay_tier: input.relay_tier,
      dedicated_relay_wss_url,
    });
    await this.recordAudit({
      tenant_id: input.tenant_id,
      action: "tenant.relay_tier_updated",
      actor: input.actor ?? null,
      metadata: {
        tenant_slug: tenant.tenant_slug,
        relay_tier: next.relay_tier,
        relay_wss_url: next.relay_wss_url,
        dedicated_relay_wss_url: next.dedicated_relay_wss_url,
      },
    });
    return next;
  }
