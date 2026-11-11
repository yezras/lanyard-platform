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

  /**
   * Put show-once secret into the platform material store (lp-9my).
   * Best-effort only when a store is wired; never writes secret to Postgres
   * or audit metadata. Failures surface so operators do not lose the secret
   * silently after a successful register response path.
   */
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
        interaction_export_enabled: Boolean(
          row.interaction_export_enabled ?? 0,
        ),
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
      // lp-k5c4.13 Phase 10 — column dropped; fallback without chat_delivery
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

    if (!row) {
      return null;
    }

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

    if (!row) {
      return null;
    }

    return this.mapTenantRow(row);
  }

  async getTenantRetention(
    tenant_id: string,
  ): Promise<TenantRetentionPolicy | null> {
    const tenant = await this.getTenantById(tenant_id);
    return tenant?.retention ?? null;
  }

  async updateTenantRetention(input: {
    tenant_id: string;
    interaction_export_enabled?: boolean;
    retention_mode?: RetentionMode;
    chat_corpus_enabled?: boolean;
    /** Pass null to clear the override (platform default applies when enabled). */
    chat_corpus_retention_days?: number | null;
    actor?: string;
  }): Promise<TenantRetentionPolicy> {
    const tenant = await this.getTenantById(input.tenant_id);
    if (!tenant) {
      throw new TenantNotFoundError(input.tenant_id);
    }

    const next: TenantRetentionPolicy = {
      interaction_export_enabled:
        input.interaction_export_enabled ??
        tenant.retention.interaction_export_enabled,
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
    /** Pass null to inherit BFF `CHAT_DELIVERY` (default relay). */
    chat_delivery: ChatDelivery | null;
    actor?: string;
  }): Promise<ChatDelivery | null> {
    const tenant = await this.getTenantById(input.tenant_id);
    if (!tenant) {
      throw new TenantNotFoundError(input.tenant_id);
    }

    const next = parseOptionalChatDelivery(input.chat_delivery);
    try {
      await this.db.run(
        `UPDATE tenants SET chat_delivery = ? WHERE tenant_id = ?`,
        [next, input.tenant_id],
      );
    } catch (error) {
      // lp-k5c4.13 Phase 10 — column dropped; keep audit but no DB write
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
      metadata: {
        tenant_slug: tenant.tenant_slug,
        chat_delivery: next,
      },
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
    if (!tenant) {
      throw new TenantNotFoundError(input.tenant_id);
    }

    const dedicated_relay_wss_url =
      input.relay_tier === "shared"
        ? null
        : (input.dedicated_relay_wss_url?.trim() ||
            tenant.relay.dedicated_relay_wss_url);

    await this.db.run(
      `UPDATE tenants
       SET relay_tier = ?, dedicated_relay_wss_url = ?
       WHERE tenant_id = ?`,
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

  /**
   * Register a gateway instance (identity + one-time secret).
   *
   * Default `runtime_kind=ec2` preserves existing deploy tooling.
   * Pass `runtime_kind=daytona` for the §4.11 CP-first path (lp-6jx):
   * assigns durable `s3_vault_prefix`, leaves `sandbox_id` null, no EC2.
   * Does **not** call Daytona create/start or Terraform.
   *
   * lp-zoh.2 / plan 0010: assigns dual vault prefixes (shared always;
   * personal only for scope=user), validates overrides fail-closed, and
   * marks tenant-scope rows primary — newest registered wins, prior active
   * primaries are demoted before INSERT.
   */
  async provisionInstance(input: {
    tenant_id: string;
    actor?: string;
    /** Default `ec2`. Use `daytona` for on-demand sandbox tenants. */
    runtime_kind?: RuntimeKind | string | null;
    /** Optional agent snapshot pin; null inherits platform default at wake. */
    agent_snapshot_id?: string | null;
    /**
     * Optional s3_vault_prefix override (daytona only). When omitted for
     * daytona, assigns `tenants/{tenant_id}/vault/`.
     */
    s3_vault_prefix?: string | null;
    /** Default tenant. User-principal connectors pass `user`. */
    scope?: InstanceScope | string | null;
    /** Required when scope=user. */
    owner_user_id?: string | null;
    /**
     * lp-zoh.2 / plan 0010: optional shared vault prefix override. When
     * omitted, assigns `tenants/{tenant_id}/vault/shared/`. Overrides are
     * bound to tenant_id exactly or rejected.
     */
    s3_shared_vault_prefix?: string | null;
    /**
     * lp-zoh.2 / plan 0010: optional personal vault prefix override
     * (scope=user only). When omitted for user scope, assigns
     * `tenants/{tenant_id}/users/{owner_user_id}/vault/`; rejected outright
     * for tenant scope.
     */
    s3_personal_vault_prefix?: string | null;
  }): Promise<ProvisionedInstance> {
    const tenant = await this.getTenantById(input.tenant_id);
    if (!tenant) {
      throw new TenantNotFoundError(input.tenant_id);
    }

    const scope = parseInstanceScope(input.scope);
    const owner_user_id = parseOwnerUserId(scope, input.owner_user_id);

    // lp-zoh.2 / plan 0010: dual vault prefixes — validate overrides
    // fail-closed, then auto-assign normative shapes when omitted.
    const shared_override = parseS3SharedVaultPrefixOverride(
      input.s3_shared_vault_prefix,
      input.tenant_id,
    );
    const personal_override = parseS3PersonalVaultPrefixOverride(
      scope,
      input.s3_personal_vault_prefix,
      input.tenant_id,
      owner_user_id,
    );
    const s3_shared_vault_prefix =
      shared_override ?? buildSharedVaultPrefix(input.tenant_id);
    // parseOwnerUserId guarantees owner_user_id is set for scope=user.
    const s3_personal_vault_prefix =
      scope === "user"
        ? (personal_override ??
          buildPersonalVaultPrefix(input.tenant_id, owner_user_id ?? ""))
        : null;

    if (scope === "user") {
      const owner = await this.db.get<{ user_id: string }>(
        `SELECT user_id FROM users WHERE tenant_id = ? AND user_id = ?`,
        [input.tenant_id, owner_user_id],
      );
      if (!owner) {
        throw new UserNotFoundError(owner_user_id ?? "");
      }
    }

    const fields = buildGatewayInstanceProvisionFields({
      tenantId: input.tenant_id,
      runtimeKind: input.runtime_kind,
      agentSnapshotId: input.agent_snapshot_id,
      s3VaultPrefix: input.s3_vault_prefix,
    });

    const instance_id = randomUUID();
    const secret = generateInstanceSecret();
    const { secret_hash, secret_salt } = hashInstanceSecret(secret);
    const created_at = new Date().toISOString();

    // lp-zoh.2 / plan 0010: keep exactly one active tenant primary per tenant
    // (unique partial index invariant). Latest registration wins; scope=user
    // is never primary.
    const is_primary = scope === "tenant";
    if (is_primary) {
      await this.db.run(
        `UPDATE gateway_instances
         SET is_primary = FALSE
         WHERE tenant_id = ? AND scope = 'tenant'
           AND is_primary = TRUE AND revoked_at IS NULL`,
        [input.tenant_id],
      );
    }

    await this.db.run(
      `INSERT INTO gateway_instances
       (instance_id, tenant_id, secret_hash, secret_salt, created_at, revoked_at,
        label, last_seen_at, health_status, credential_rotated_at,
        secret_param_arn, ec2_instance_id, aws_region,
        runtime_kind, sandbox_id, presence, agent_snapshot_id, s3_vault_prefix,
        last_activity_at, scope, owner_user_id,
        is_primary, s3_shared_vault_prefix, s3_personal_vault_prefix)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, 'unknown', NULL, NULL, NULL, NULL,
        ?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      [
        instance_id,
        input.tenant_id,
        secret_hash,
        secret_salt,
        created_at,
        fields.runtime_kind,
        fields.presence,
        fields.agent_snapshot_id,
        fields.s3_vault_prefix,
        scope,
        owner_user_id,
        is_primary,
        s3_shared_vault_prefix,
        s3_personal_vault_prefix,
      ],
    );

    await this.recordAudit({
      tenant_id: input.tenant_id,
      action: "instance.provisioned",
      actor: input.actor ?? null,
      instance_id,
      result: "success",
      metadata: {
        instance_id,
        tenant_slug: tenant.tenant_slug,
        relay_tier: tenant.relay.relay_tier,
        relay_wss_url: tenant.relay.relay_wss_url,
        runtime_kind: fields.runtime_kind,
        sandbox_id: fields.sandbox_id,
        presence: fields.presence,
        s3_vault_prefix: fields.s3_vault_prefix,
        agent_snapshot_id: fields.agent_snapshot_id,
        ec2_instance_id: fields.ec2_instance_id,
        scope,
        owner_user_id,
        is_primary,
        s3_shared_vault_prefix,
        s3_personal_vault_prefix,
      },
    });

    // lp-9my: platform material for orchestrator inject (not Postgres plaintext).
    await this.putSecretMaterial({
      instance_id,
      tenant_id: input.tenant_id,
      secret,
      relay_wss_url: tenant.relay.relay_wss_url,
      relay_tier: tenant.relay.relay_tier,
      issued_at: created_at,
    });

    return {
      instance_id,
      tenant_id: input.tenant_id,
      secret,
      relay_tier: tenant.relay.relay_tier,
      relay_wss_url: tenant.relay.relay_wss_url,
      runtime_kind: fields.runtime_kind,
      sandbox_id: fields.sandbox_id,
      presence: fields.presence,
      s3_vault_prefix: fields.s3_vault_prefix,
      agent_snapshot_id: fields.agent_snapshot_id,
      ec2_instance_id: fields.ec2_instance_id,
      scope,
      owner_user_id,
      is_primary,
      s3_shared_vault_prefix,
      s3_personal_vault_prefix,
    };
  }

  /**
   * Dedicated Daytona provision path (lp-6jx / plan §4.11).
   *
   * Forces `runtime_kind=daytona`, assigns `s3_vault_prefix`, leaves
   * `sandbox_id` null and `ec2_instance_id` null. Does not create a Daytona
   * sandbox or require EC2 / Terraform.
   */
  async provisionDaytonaInstance(input: {
    tenant_id: string;
    actor?: string;
    agent_snapshot_id?: string | null;
    s3_vault_prefix?: string | null;
  }): Promise<ProvisionedInstance> {
    // Validate daytona fields early (throws InvalidProvisionInputError).
    buildDaytonaProvisionFields({
      tenantId: input.tenant_id,
      agentSnapshotId: input.agent_snapshot_id,
      s3VaultPrefix: input.s3_vault_prefix,
    });
    return this.provisionInstance({
      tenant_id: input.tenant_id,
      actor: input.actor,
      runtime_kind: "daytona",
      agent_snapshot_id: input.agent_snapshot_id,
      s3_vault_prefix: input.s3_vault_prefix,
    });
  }

  /**
   * lp-zoh.3 / plan 0010: idempotent ensure of the tenant primary instance.
   *
   * Returns the active tenant primary when present (created:false); otherwise
   * provisions one via {@link provisionInstance} with scope=tenant — which
   * stamps the dual vault prefixes and marks the row primary (lp-zoh.2).
   * Race-safe: a concurrent creator wins idx_gateway_instances_tenant_primary;
   * the loser catches the unique violation, re-fetches, and returns the winner
   * with created:false. No Daytona create — presence stays offline and
   * sandbox_id stays null (wake is ensure_online). No secret in the result.
   */
  async ensureTenantPrimaryInstance(input: {
    tenant_id: string;
    actor?: string | null;
    /** Default `ec2`. Pass `daytona` for on-demand sandbox tenants. */
    runtime_kind?: RuntimeKind | string | null;
    /** Optional agent snapshot pin; null inherits platform default at wake. */
    agent_snapshot_id?: string | null;
  }): Promise<EnsuredInstance> {
    if (!(await this.getTenantById(input.tenant_id))) {
      throw new TenantNotFoundError(input.tenant_id);
    }

    const existingId = (
      await this.getPrimaryActiveInstance(input.tenant_id)
    )?.instance_id;
    if (existingId) {
      return this.ensuredInstanceFromInstanceId(existingId, false);
    }

    try {
      const provisioned = await this.provisionInstance({
        tenant_id: input.tenant_id,
        actor: input.actor ?? undefined,
        runtime_kind: input.runtime_kind,
        agent_snapshot_id: input.agent_snapshot_id,
        scope: "tenant",
      });
      return {
        instance_id: provisioned.instance_id,
        tenant_id: provisioned.tenant_id,
        runtime_kind: provisioned.runtime_kind,
        agent_snapshot_id: provisioned.agent_snapshot_id,
        s3_vault_prefix: provisioned.s3_vault_prefix,
        s3_shared_vault_prefix: provisioned.s3_shared_vault_prefix ?? null,
        s3_personal_vault_prefix: provisioned.s3_personal_vault_prefix ?? null,
        is_primary: provisioned.is_primary ?? true,
        presence: provisioned.presence,
        sandbox_id: provisioned.sandbox_id,
        scope: provisioned.scope ?? "tenant",
        owner_user_id: provisioned.owner_user_id ?? null,
        created: true,
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        // lp-zoh.3 / plan 0010: concurrent ensure won the tenant-primary
        // unique index — re-fetch and return the winner idempotently.
        const racedId = (
          await this.getPrimaryActiveInstance(input.tenant_id)
        )?.instance_id;
        if (racedId) {
          return this.ensuredInstanceFromInstanceId(racedId, false);
        }
      }
      throw error;
    }
  }

  /**
   * lp-zoh.3 / plan 0010: full public shape for an ensured instance row.
   * Fails closed when the row vanished between ensure and read.
   */
  private async ensuredInstanceFromInstanceId(
    instance_id: string,
    created: boolean,
  ): Promise<EnsuredInstance> {
    const row = await this.getInstance(instance_id);
    if (!row) {
      throw new InstanceNotFoundError(instance_id);
    }
    return {
      instance_id: row.instance_id,
      tenant_id: row.tenant_id,
      runtime_kind: row.runtime_kind,
      agent_snapshot_id: row.agent_snapshot_id,
      s3_vault_prefix: row.s3_vault_prefix,
      // GatewayInstance carries lp-zoh.2 columns as optional; normalize.
      s3_shared_vault_prefix: row.s3_shared_vault_prefix ?? null,
      s3_personal_vault_prefix: row.s3_personal_vault_prefix ?? null,
      is_primary: row.is_primary ?? false,
      presence: row.presence,
      sandbox_id: row.sandbox_id,
      scope: parseInstanceScope(row.scope),
      owner_user_id: row.owner_user_id ?? null,
      created,
    };
  }

  /**
   * lp-zoh.3 / plan 0010: user-shaped variant — narrows scope to "user" and
   * carries the caller's owner_user_id key. Fails closed on scope mismatch.
   */
  private async ensuredUserInstanceFromInstanceId(
    instance_id: string,
    owner_user_id: string,
    created: boolean,
  ): Promise<EnsuredUserInstance> {
    const base = await this.ensuredInstanceFromInstanceId(instance_id, created);
    if (base.scope !== "user") {
      throw new InstanceNotFoundError(instance_id);
    }
    return { ...base, scope: "user", owner_user_id };
  }

  /**
   * Issue a new instance secret (shown once). Default design: short dual-accept
   * window — previous scrypt material remains valid until
   * `previous_secret_accepted_until` so operators can overwrite SSM SecureString
   * and restart the gateway without a hard cutover. Pass
   * `grace_period_seconds: 0` for immediate invalidation of the old secret.
   */
  async rotateInstance(input: {
    tenant_id: string;
    instance_id: string;
    grace_period_seconds?: number;
    actor?: string;
  }): Promise<RotatedInstance> {
    const tenant = await this.getTenantById(input.tenant_id);
    if (!tenant) {
      throw new TenantNotFoundError(input.tenant_id);
    }

    const instance = await this.getInstance(input.instance_id);
    if (!instance || instance.tenant_id !== input.tenant_id) {
      throw new InstanceNotFoundError(input.instance_id);
    }
    if (instance.revoked_at) {
      throw new InstanceRevokedError(input.instance_id);
    }

    const grace_period_seconds = normalizeGracePeriodSeconds(
      input.grace_period_seconds,
    );

    const secret = generateInstanceSecret();
    const { secret_hash, secret_salt } = hashInstanceSecret(secret);
    const rotated_at = new Date();
    const previous_secret_accepted_until =
      grace_period_seconds > 0
        ? new Date(
            rotated_at.getTime() + grace_period_seconds * 1000,
          ).toISOString()
        : null;

    const credential_rotated_at = rotated_at.toISOString();
    await this.db.run(
      `UPDATE gateway_instances
       SET secret_hash = ?,
           secret_salt = ?,
           previous_secret_hash = ?,
           previous_secret_salt = ?,
           previous_secret_expires_at = ?,
           credential_rotated_at = ?
       WHERE instance_id = ? AND tenant_id = ? AND revoked_at IS NULL`,
      [
        secret_hash,
        secret_salt,
        previous_secret_accepted_until ? instance.secret_hash : null,
        previous_secret_accepted_until ? instance.secret_salt : null,
        previous_secret_accepted_until,
        credential_rotated_at,
        input.instance_id,
        input.tenant_id,
      ],
    );

    await this.recordAudit({
      tenant_id: input.tenant_id,
      action: "instance.rotated",
      actor: input.actor ?? null,
      instance_id: input.instance_id,
      result: "success",
      metadata: {
        instance_id: input.instance_id,
        tenant_slug: tenant.tenant_slug,
        grace_period_seconds,
        previous_secret_accepted_until,
        credential_rotated_at,
      },
    });

    // lp-9my: overwrite material so next cold wake injects the new secret.
    await this.putSecretMaterial({
      instance_id: input.instance_id,
      tenant_id: input.tenant_id,
      secret,
      relay_wss_url: tenant.relay.relay_wss_url,
      relay_tier: tenant.relay.relay_tier,
      issued_at: credential_rotated_at,
    });

    return {
      instance_id: input.instance_id,
      tenant_id: input.tenant_id,
      secret,
      previous_secret_accepted_until,
      grace_period_seconds,
      relay_tier: tenant.relay.relay_tier,
      relay_wss_url: tenant.relay.relay_wss_url,
    };
  }

  async deprovisionTenant(input: {
    tenant_id: string;
    actor?: string;
  }): Promise<{
    tenant_id: string;
    revoked_instance_count: number;
    revoked_instance_ids: string[];
  }> {
    const tenant = await this.getTenantById(input.tenant_id);
    if (!tenant) {
      throw new TenantNotFoundError(input.tenant_id);
    }

    const active = await this.listActiveInstances(input.tenant_id);
    const revoked_instance_ids = active.map((row) => row.instance_id);

    const revoked_at = new Date().toISOString();
    // lp-e96: revoke secrets + soft state; clear sandbox_id / presence offline.
    // Vault S3 retain by default (lp-zmg) — no S3 delete here.
    const result = await this.db.run(
      `UPDATE gateway_instances
       SET revoked_at = ?,
           health_status = 'revoked',
           sandbox_id = NULL,
           presence = 'offline'
       WHERE tenant_id = ? AND revoked_at IS NULL`,
      [revoked_at, input.tenant_id],
    );

    const offboard = await offboardTenantRegistry(
      this.db,
      (audit) => this.recordAudit(audit),
      {
        tenant_id: input.tenant_id,
        actor: input.actor ?? null,
      },
    );

    await this.recordAudit({
      tenant_id: input.tenant_id,
      action: "tenant.deprovisioned",
      actor: input.actor ?? null,
      result: "success",
      metadata: {
        tenant_slug: tenant.tenant_slug,
        revoked_instance_count: result.changes,
        revoked_instance_ids,
        retired_resource_count: offboard.retired_resource_count,
      },
    });

    // Drop wake-inject material for revoked instances (lp-9my).
    for (const id of revoked_instance_ids) {
      await this.deleteSecretMaterial(id);
    }

    return {
      tenant_id: input.tenant_id,
      revoked_instance_count: result.changes,
      revoked_instance_ids,
    };
  }

  /**
   * Revoke a single gateway instance secret (G2.3). Idempotent if already revoked.
   * Control plane does not push to relay — operators must call
   * `POST {RELAY}/internal/instances/:id/revoke` to drop live sessions.
   */
  async revokeInstance(input: {
    tenant_id: string;
    instance_id: string;
    actor?: string;
  }): Promise<{
    tenant_id: string;
    instance_id: string;
    already_revoked: boolean;
    revoked_at: string;
  }> {
    const tenant = await this.getTenantById(input.tenant_id);
    if (!tenant) {
      throw new TenantNotFoundError(input.tenant_id);
    }

    const instance = await this.getInstance(input.instance_id);
    if (!instance || instance.tenant_id !== input.tenant_id) {
      throw new InstanceNotFoundError(input.instance_id);
    }

    if (instance.revoked_at) {
      // lp-e96: re-entry still clears leftover sandbox_id / presence and material.
      if (instance.sandbox_id != null || instance.presence !== "offline") {
        await this.db.run(
          `UPDATE gateway_instances
           SET sandbox_id = NULL, presence = 'offline'
           WHERE instance_id = ?`,
          [input.instance_id],
        );
      }
      await this.deleteSecretMaterial(input.instance_id);
      return {
        tenant_id: input.tenant_id,
        instance_id: input.instance_id,
        already_revoked: true,
        revoked_at: instance.revoked_at,
      };
    }

    const revoked_at = new Date().toISOString();
    // lp-e96: credential revoke + clear ephemeral sandbox binding / presence.
    // Durable s3_vault_prefix is retained (pilot default; vault GC is separate).
    await this.db.run(
      `UPDATE gateway_instances
       SET revoked_at = ?,
           health_status = 'revoked',
           sandbox_id = NULL,
           presence = 'offline'
       WHERE instance_id = ? AND revoked_at IS NULL`,
      [revoked_at, input.instance_id],
    );

    await this.recordAudit({
      tenant_id: input.tenant_id,
      action: "instance.revoked",
      actor: input.actor ?? null,
      instance_id: input.instance_id,
      result: "success",
      metadata: {
        instance_id: input.instance_id,
        tenant_slug: tenant.tenant_slug,
        sandbox_id_cleared: true,
        presence: "offline",
      },
    });

    // lp-9my: revoke clears platform material so wake cannot re-inject.
    await this.deleteSecretMaterial(input.instance_id);

    return {
      tenant_id: input.tenant_id,
      instance_id: input.instance_id,
      already_revoked: false,
      revoked_at,
    };
  }

  async getPrimaryActiveInstance(
    tenant_id: string,
  ): Promise<{ instance_id: string } | null> {
    const row = await this.db.get<{ instance_id: string }>(
      `SELECT instance_id
       FROM gateway_instances
       WHERE tenant_id = ? AND revoked_at IS NULL
         AND COALESCE(scope, 'tenant') = 'tenant'
       ORDER BY created_at DESC
       LIMIT 1`,
      [tenant_id],
    );

    return row ?? null;
  }

  async getUserSandboxInstance(
    tenant_id: string,
    owner_user_id: string,
  ): Promise<ScopedInstanceRecord | null> {
    const row = await this.db.get<{
      instance_id: string;
      tenant_id: string;
      owner_user_id: string;
      revoked_at: string | null;
    }>(
      `SELECT instance_id, tenant_id, owner_user_id, revoked_at
       FROM gateway_instances
       WHERE tenant_id = ? AND owner_user_id = ? AND scope = 'user'
         AND revoked_at IS NULL
       ORDER BY created_at ASC
       LIMIT 1`,
      [tenant_id, owner_user_id],
    );
    if (!row) return null;
    return userScopeRecord({
      instance_id: row.instance_id,
      tenant_id: row.tenant_id,
      owner_user_id: row.owner_user_id,
      revoked_at: row.revoked_at,
    });
  }

  /**
   * 0010-shaped rows for ensure-online-by-user. User-scope wins in the
   * resolver; tenant primary is the fallback.
   */
  async listScopedInstanceRecords(
    tenant_id: string,
  ): Promise<ScopedInstanceRecord[]> {
    const rows = await this.db.all<{
      instance_id: string;
      tenant_id: string;
      scope: string | null;
      owner_user_id: string | null;
      is_primary: boolean | null;
      revoked_at: string | null;
    }>(
      `SELECT instance_id, tenant_id, scope, owner_user_id, is_primary, revoked_at
       FROM gateway_instances
       WHERE tenant_id = ? AND revoked_at IS NULL
       ORDER BY created_at ASC`,
      [tenant_id],
    );
    const records: ScopedInstanceRecord[] = [];
    for (const row of rows) {
      const scope = parseInstanceScope(row.scope);
      if (scope === "user" && row.owner_user_id) {
        records.push(
          userScopeRecord({
            instance_id: row.instance_id,
            tenant_id: row.tenant_id,
            owner_user_id: row.owner_user_id,
            revoked_at: row.revoked_at,
            // lp-zoh.2: real flag from the row (user scope is never primary).
            is_primary: row.is_primary ?? false,
          }),
        );
      } else if (scope === "tenant") {
        records.push(
          tenantPrimaryRecord({
            instance_id: row.instance_id,
            tenant_id: row.tenant_id,
            revoked_at: row.revoked_at,
            // lp-zoh.2: real flag from the row instead of a fixture hardcode.
            is_primary: row.is_primary ?? false,
          }),
        );
      }
    }
    return records;
  }

  /**
   * First user-principal connect: bind scope=user instance if missing.
   * Does not create or wake a Daytona sandbox.
   *
   * lp-zoh.3 / plan 0010: returns the full ensured shape — newly-created rows
   * carry the lp-zoh.2 dual vault prefixes (stamped by provisionInstance) and
   * is_primary=false; existing/raced rows are returned as stored, with
   * presence/sandbox_id read from the durable row.
   */
  async ensureUserSandboxInstance(input: {
    tenant_id: string;
    owner_user_id: string;
    actor?: string | null;
    runtime_kind?: RuntimeKind | string | null;
    agent_snapshot_id?: string | null;
    s3_vault_prefix?: string | null;
  }): Promise<EnsuredUserInstance> {
    if (!(await this.getTenantById(input.tenant_id))) {
      throw new TenantNotFoundError(input.tenant_id);
    }
    const owner_user_id = input.owner_user_id.trim();
    if (!owner_user_id) {
      throw new UserNotFoundError(input.owner_user_id);
    }

    const existing = await this.getUserSandboxInstance(
      input.tenant_id,
      owner_user_id,
    );
    if (existing) {
      return this.ensuredUserInstanceFromInstanceId(
        existing.instance_id,
        owner_user_id,
        false,
      );
    }

    const primary = await this.getPrimaryActiveInstance(input.tenant_id);
    const primaryRow = primary
      ? await this.getInstance(primary.instance_id)
      : null;
    const runtime_kind =
      input.runtime_kind ?? primaryRow?.runtime_kind ?? "daytona";
    const agent_snapshot_id =
      input.agent_snapshot_id !== undefined
        ? input.agent_snapshot_id
        : (primaryRow?.agent_snapshot_id ?? null);
    const s3_vault_prefix =
      input.s3_vault_prefix !== undefined
        ? input.s3_vault_prefix
        : (primaryRow?.s3_vault_prefix ?? null);

    try {
      const provisioned = await this.provisionInstance({
        tenant_id: input.tenant_id,
        actor: input.actor ?? undefined,
        runtime_kind,
        agent_snapshot_id,
        s3_vault_prefix:
          runtime_kind === "daytona" ? s3_vault_prefix : null,
        scope: "user",
        owner_user_id,
      });
      await this.recordAudit({
        tenant_id: input.tenant_id,
        action: "instance.user_sandbox_provisioned",
        actor: input.actor ?? null,
        instance_id: provisioned.instance_id,
        result: "success",
        metadata: {
          instance_id: provisioned.instance_id,
          owner_user_id,
          scope: "user",
        },
      });
      return {
        instance_id: provisioned.instance_id,
        tenant_id: provisioned.tenant_id,
        runtime_kind: provisioned.runtime_kind,
        agent_snapshot_id: provisioned.agent_snapshot_id,
        s3_vault_prefix: provisioned.s3_vault_prefix,
        s3_shared_vault_prefix: provisioned.s3_shared_vault_prefix ?? null,
        s3_personal_vault_prefix: provisioned.s3_personal_vault_prefix ?? null,
        is_primary: provisioned.is_primary ?? false,
        presence: provisioned.presence,
        sandbox_id: provisioned.sandbox_id,
        scope: "user",
        owner_user_id,
        created: true,
      };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced = await this.getUserSandboxInstance(
          input.tenant_id,
          owner_user_id,
        );
        if (raced) {
          return this.ensuredUserInstanceFromInstanceId(
            raced.instance_id,
            owner_user_id,
            false,
          );
        }
      }
      throw error;
    }
  }

  async listActiveInstances(
    tenant_id: string,
  ): Promise<GatewayInstancePublic[]> {
    let rows: Array<{
      instance_id: string;
      created_at: string;
      label: string | null;
      last_seen_at: string | null;
      health_status: string;
      credential_rotated_at: string | null;
      secret_param_arn: string | null;
      ec2_instance_id: string | null;
      aws_region: string | null;
      revoked_at: string | null;
      runtime_kind: string | null;
      sandbox_id: string | null;
      presence: string | null;
      agent_snapshot_id: string | null;
      s3_vault_prefix: string | null;
      last_activity_at: string | null;
      chat_delivery?: string | null;
    }>;
    try {
      rows = await this.db.all<{
        instance_id: string;
        created_at: string;
        label: string | null;
        last_seen_at: string | null;
        health_status: string;
        credential_rotated_at: string | null;
        secret_param_arn: string | null;
        ec2_instance_id: string | null;
        aws_region: string | null;
        revoked_at: string | null;
        runtime_kind: string | null;
        sandbox_id: string | null;
        presence: string | null;
        agent_snapshot_id: string | null;
        s3_vault_prefix: string | null;
        last_activity_at: string | null;
        chat_delivery: string | null;
      }>(
        `SELECT instance_id, created_at, label, last_seen_at, health_status,
                credential_rotated_at, secret_param_arn, ec2_instance_id,
                aws_region, revoked_at,
                runtime_kind, sandbox_id, presence, agent_snapshot_id, s3_vault_prefix,
                last_activity_at, chat_delivery
         FROM gateway_instances
         WHERE tenant_id = ? AND revoked_at IS NULL
         ORDER BY created_at DESC`,
        [tenant_id],
      );
    } catch (error) {
      // lp-k5c4.13 Phase 10 — column dropped
      if (/column.*chat_delivery/i.test(String(error))) {
        const fallback = await this.db.all<{
          instance_id: string;
          created_at: string;
          label: string | null;
          last_seen_at: string | null;
          health_status: string;
          credential_rotated_at: string | null;
          secret_param_arn: string | null;
          ec2_instance_id: string | null;
          aws_region: string | null;
          revoked_at: string | null;
          runtime_kind: string | null;
          sandbox_id: string | null;
          presence: string | null;
          agent_snapshot_id: string | null;
          s3_vault_prefix: string | null;
          last_activity_at: string | null;
        }>(
          `SELECT instance_id, created_at, label, last_seen_at, health_status,
                  credential_rotated_at, secret_param_arn, ec2_instance_id,
                  aws_region, revoked_at,
                  runtime_kind, sandbox_id, presence, agent_snapshot_id, s3_vault_prefix,
                  last_activity_at
           FROM gateway_instances
           WHERE tenant_id = ? AND revoked_at IS NULL
           ORDER BY created_at DESC`,
          [tenant_id],
        );
        return fallback.map((row) => ({
          instance_id: row.instance_id,
          created_at: row.created_at,
          label: row.label,
          last_seen_at: row.last_seen_at,
          health_status: parseHealthStatus(row.health_status),
          credential_rotated_at: row.credential_rotated_at,
          secret_param_arn: row.secret_param_arn,
          ec2_instance_id: row.ec2_instance_id,
          aws_region: row.aws_region,
          revoked_at: row.revoked_at,
          runtime_kind: parseRuntimeKind(row.runtime_kind),
          sandbox_id: row.sandbox_id ?? null,
          presence: parseInstancePresence(row.presence),
          agent_snapshot_id: row.agent_snapshot_id ?? null,
          s3_vault_prefix: row.s3_vault_prefix ?? null,
          last_activity_at: row.last_activity_at ?? null,
          chat_delivery: null,
        }));
      }
      throw error;
    }
    return rows.map((row) => ({
      instance_id: row.instance_id,
      created_at: row.created_at,
      label: row.label,
      last_seen_at: row.last_seen_at,
      health_status: parseHealthStatus(row.health_status),
      credential_rotated_at: row.credential_rotated_at,
      secret_param_arn: row.secret_param_arn,
      ec2_instance_id: row.ec2_instance_id,
      aws_region: row.aws_region,
      revoked_at: row.revoked_at,
      runtime_kind: parseRuntimeKind(row.runtime_kind),
      sandbox_id: row.sandbox_id ?? null,
      presence: parseInstancePresence(row.presence),
      agent_snapshot_id: row.agent_snapshot_id ?? null,
      s3_vault_prefix: row.s3_vault_prefix ?? null,
      last_activity_at: row.last_activity_at ?? null,
      chat_delivery: parseOptionalChatDelivery(row.chat_delivery),
    }));
  }

  async getInstance(instance_id: string): Promise<GatewayInstance | null> {
    let row: {
      instance_id: string;
      tenant_id: string;
      secret_hash: string;
      secret_salt: string;
      previous_secret_hash: string | null;
      previous_secret_salt: string | null;
      previous_secret_expires_at: string | null;
      created_at: string;
      revoked_at: string | null;
      label: string | null;
      last_seen_at: string | null;
      health_status: string;
      credential_rotated_at: string | null;
      secret_param_arn: string | null;
      ec2_instance_id: string | null;
      aws_region: string | null;
      runtime_kind: string | null;
      sandbox_id: string | null;
      presence: string | null;
      agent_snapshot_id: string | null;
      s3_vault_prefix: string | null;
      last_activity_at: string | null;
      chat_delivery?: string | null;
      scope: string | null;
      owner_user_id: string | null;
      is_primary: boolean | null;
      s3_shared_vault_prefix: string | null;
      s3_personal_vault_prefix: string | null;
      vault_writable: boolean | number | string | null;
    } | undefined;
    try {
      row = await this.db.get<{
        instance_id: string;
        tenant_id: string;
        secret_hash: string;
        secret_salt: string;
        previous_secret_hash: string | null;
        previous_secret_salt: string | null;
        previous_secret_expires_at: string | null;
        created_at: string;
        revoked_at: string | null;
        label: string | null;
        last_seen_at: string | null;
        health_status: string;
        credential_rotated_at: string | null;
        secret_param_arn: string | null;
        ec2_instance_id: string | null;
        aws_region: string | null;
        runtime_kind: string | null;
        sandbox_id: string | null;
        presence: string | null;
        agent_snapshot_id: string | null;
        s3_vault_prefix: string | null;
        last_activity_at: string | null;
        chat_delivery: string | null;
        scope: string | null;
        owner_user_id: string | null;
        is_primary: boolean | null;
        s3_shared_vault_prefix: string | null;
        s3_personal_vault_prefix: string | null;
        vault_writable: boolean | number | string | null;
      }>(
        `SELECT instance_id, tenant_id, secret_hash, secret_salt,
                previous_secret_hash, previous_secret_salt, previous_secret_expires_at,
                created_at, revoked_at,
                label, last_seen_at, health_status, credential_rotated_at,
                secret_param_arn, ec2_instance_id, aws_region,
                runtime_kind, sandbox_id, presence, agent_snapshot_id, s3_vault_prefix,
                last_activity_at, chat_delivery, scope, owner_user_id,
                is_primary, s3_shared_vault_prefix, s3_personal_vault_prefix,
                vault_writable
         FROM gateway_instances WHERE instance_id = ?`,
        [instance_id],
      );
    } catch (error) {
      if (/column.*chat_delivery/i.test(String(error))) {
        const fallback = await this.db.get<{
          instance_id: string;
          tenant_id: string;
          secret_hash: string;
          secret_salt: string;
          previous_secret_hash: string | null;
          previous_secret_salt: string | null;
          previous_secret_expires_at: string | null;
          created_at: string;
          revoked_at: string | null;
          label: string | null;
          last_seen_at: string | null;
          health_status: string;
          credential_rotated_at: string | null;
          secret_param_arn: string | null;
          ec2_instance_id: string | null;
          aws_region: string | null;
          runtime_kind: string | null;
          sandbox_id: string | null;
          presence: string | null;
          agent_snapshot_id: string | null;
          s3_vault_prefix: string | null;
          last_activity_at: string | null;
          scope: string | null;
          owner_user_id: string | null;
          is_primary: boolean | null;
          s3_shared_vault_prefix: string | null;
          s3_personal_vault_prefix: string | null;
          vault_writable: boolean | number | string | null;
        }>(
          `SELECT instance_id, tenant_id, secret_hash, secret_salt,
                  previous_secret_hash, previous_secret_salt, previous_secret_expires_at,
                  created_at, revoked_at,
                  label, last_seen_at, health_status, credential_rotated_at,
                  secret_param_arn, ec2_instance_id, aws_region,
                  runtime_kind, sandbox_id, presence, agent_snapshot_id, s3_vault_prefix,
                  last_activity_at, scope, owner_user_id,
                  is_primary, s3_shared_vault_prefix, s3_personal_vault_prefix,
                  vault_writable
           FROM gateway_instances WHERE instance_id = ?`,
          [instance_id],
        );
        if (!fallback) return null;
        row = { ...fallback, chat_delivery: null } as typeof row;
      } else {
        throw error;
      }
    }

    if (!row) {
      return null;
    }

    return {
      instance_id: row.instance_id,
      tenant_id: row.tenant_id,
      secret_hash: row.secret_hash,
      secret_salt: row.secret_salt,
      previous_secret_hash: row.previous_secret_hash ?? null,
      previous_secret_salt: row.previous_secret_salt ?? null,
      previous_secret_expires_at: row.previous_secret_expires_at ?? null,
      created_at: row.created_at,
      revoked_at: row.revoked_at,
      label: row.label ?? null,
      last_seen_at: row.last_seen_at ?? null,
      health_status: parseHealthStatus(row.health_status),
      credential_rotated_at: row.credential_rotated_at ?? null,
      secret_param_arn: row.secret_param_arn ?? null,
      ec2_instance_id: row.ec2_instance_id ?? null,
      aws_region: row.aws_region ?? null,
      runtime_kind: parseRuntimeKind(row.runtime_kind),
      sandbox_id: row.sandbox_id ?? null,
      presence: parseInstancePresence(row.presence),
      agent_snapshot_id: row.agent_snapshot_id ?? null,
      s3_vault_prefix: row.s3_vault_prefix ?? null,
      last_activity_at: row.last_activity_at ?? null,
      chat_delivery: parseOptionalChatDelivery(row.chat_delivery),
      scope: parseInstanceScope(row.scope),
      owner_user_id: row.owner_user_id ?? null,
      is_primary: row.is_primary ?? false,
      s3_shared_vault_prefix: row.s3_shared_vault_prefix ?? null,
      s3_personal_vault_prefix: row.s3_personal_vault_prefix ?? null,
      vault_writable: parseVaultWritable(row.vault_writable),
    };
  }

  /**
   * Postgres-backed presence store for InstanceOrchestrator (lp-omt).
   * Read/write presence, sandbox_id, last_activity_at by instance_id.
   */
  asOrchestratorInstanceStore(): OrchestratorInstanceStore {
    return createSqlOrchestratorInstanceStore(this.db);
  }

  // --- Deployment / resource registry (cbd-mta.3.3) ---

  async getTenantDeployment(
    tenant_id: string,
  ): Promise<TenantDeployment | null> {
    return getTenantDeploymentRecord(this.db, tenant_id);
  }

  async upsertTenantDeployment(input: {
    tenant_id: string;
    hosting_track: string;
    isolation_mode: string;
    aws_account_id?: string | null;
    aws_region?: string | null;
    project_name?: string | null;
    status?: string;
    client_core_version?: string | null;
    hermes_version?: string | null;
    primary_instance_id?: string | null;
    actor?: string | null;
    request_id?: string | null;
  }): Promise<TenantDeployment> {
    const tenant = await this.getTenantById(input.tenant_id);
    if (!tenant) {
      throw new TenantNotFoundError(input.tenant_id);
    }
    return upsertTenantDeploymentRecord(
      this.db,
      (audit) => this.recordAudit(audit),
      input,
    );
  }

  async listTenantResourceRefs(
    tenant_id: string,
    options: { include_retired?: boolean } = {},
  ): Promise<TenantResourceRef[]> {
    return listTenantResourceRefsRecord(this.db, tenant_id, options);
  }

  async upsertTenantResourceRef(input: {
    tenant_id: string;
    resource_kind: string;
    name: string;
    aws_id?: string | null;
    arn?: string | null;
    secret_arn?: string | null;
    aws_region?: string | null;
    status?: string;
    last_seen_at?: string | null;
    metadata?: Record<string, unknown>;
    actor?: string | null;
    request_id?: string | null;
  }): Promise<TenantResourceRef> {
    const tenant = await this.getTenantById(input.tenant_id);
    if (!tenant) {
      throw new TenantNotFoundError(input.tenant_id);
    }
    return upsertTenantResourceRefRecord(
      this.db,
      (audit) => this.recordAudit(audit),
      input,
    );
  }

  async retireTenantResourceRef(input: {
    tenant_id: string;
    resource_ref_id: string;
    actor?: string | null;
    request_id?: string | null;
  }): Promise<TenantResourceRef> {
    const tenant = await this.getTenantById(input.tenant_id);
    if (!tenant) {
      throw new TenantNotFoundError(input.tenant_id);
    }
    return retireTenantResourceRefRecord(
      this.db,
      (audit) => this.recordAudit(audit),
      input,
    );
  }

  async updateInstanceRegistry(input: {
    tenant_id: string;
    instance_id: string;
    label?: string | null;
    last_seen_at?: string | null;
    health_status?: string;
    secret_param_arn?: string | null;
    ec2_instance_id?: string | null;
    aws_region?: string | null;
    runtime_kind?: string | null;
    sandbox_id?: string | null;
    presence?: string | null;
    agent_snapshot_id?: string | null;
    s3_vault_prefix?: string | null;
    last_activity_at?: string | null;
    chat_delivery?: string | null;
    actor?: string | null;
    request_id?: string | null;
  }) {
    const tenant = await this.getTenantById(input.tenant_id);
    if (!tenant) {
      throw new TenantNotFoundError(input.tenant_id);
    }
    return updateInstanceRegistryRecord(
      this.db,
      (audit) => this.recordAudit(audit),
      input,
    );
  }

  async registerUser(input: {
    tenant_id: string;
    email: string;
    password: string;
    actor?: string;
  }): Promise<User> {
    const tenant = await this.getTenantById(input.tenant_id);
    if (!tenant) {
      throw new TenantNotFoundError(input.tenant_id);
    }

    const email = input.email.trim().toLowerCase();
    const user_id = randomUUID();
    const created_at = new Date().toISOString();
    const { password_hash, password_salt } = hashPassword(input.password);

    try {
      await this.db.run(
        `INSERT INTO users
         (user_id, tenant_id, email, password_hash, password_salt, google_sub,
          display_name, tenant_role, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, 'member', ?)`,
        [
          user_id,
          input.tenant_id,
          email,
          password_hash,
          password_salt,
          displayNameFromEmail(email),
          created_at,
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new UserEmailConflictError(email, input.tenant_id);
      }
      throw error;
    }

    await this.recordAudit({
      tenant_id: input.tenant_id,
      action: "user.registered",
      actor: input.actor ?? null,
      metadata: { user_id, email },
    });

    return {
      user_id,
      tenant_id: input.tenant_id,
      email,
      has_password: true,
      has_google: false,
      created_at,
    };
  }

  async loginUser(input: {
    tenant_id: string;
    email: string;
    password: string;
    actor?: string;
  }): Promise<AuthUser> {
    const email = input.email.trim().toLowerCase();
    const row = await this.db.get<{
      user_id: string;
      tenant_id: string;
      email: string;
      password_hash: string | null;
      password_salt: string | null;
    }>(
      `SELECT user_id, tenant_id, email, password_hash, password_salt
       FROM users
       WHERE tenant_id = ? AND email = ?`,
      [input.tenant_id, email],
    );

    if (!row?.password_hash || !row.password_salt) {
      throw new InvalidCredentialsError();
    }

    const valid = verifyPassword(
      input.password,
      row.password_hash,
      row.password_salt,
    );
    if (!valid) {
      throw new InvalidCredentialsError();
    }

    await this.recordAudit({
      tenant_id: input.tenant_id,
      action: "user.login",
      actor: input.actor ?? null,
      metadata: { user_id: row.user_id, email, method: "password" },
    });

    return {
      user_id: row.user_id,
      tenant_id: row.tenant_id,
      email: row.email,
    };
  }

  async upsertGoogleUser(input: {
    tenant_id: string;
    google_sub: string;
    email: string;
    actor?: string;
  }): Promise<AuthUser> {
    const tenant = await this.getTenantById(input.tenant_id);
    if (!tenant) {
      throw new TenantNotFoundError(input.tenant_id);
    }

    const email = input.email.trim().toLowerCase();
    const google_sub = input.google_sub.trim();
    const existingByGoogle = await this.db.get<AuthUser>(
      `SELECT user_id, tenant_id, email
       FROM users
       WHERE tenant_id = ? AND google_sub = ?`,
      [input.tenant_id, google_sub],
    );

    if (existingByGoogle) {
      await this.recordAudit({
        tenant_id: input.tenant_id,
        action: "user.login",
        actor: input.actor ?? null,
        metadata: {
          user_id: existingByGoogle.user_id,
          email: existingByGoogle.email,
          method: "google",
        },
      });
      return existingByGoogle;
    }

    const existingByEmail = await this.db.get<{
      user_id: string;
      tenant_id: string;
      email: string;
      google_sub: string | null;
    }>(
      `SELECT user_id, tenant_id, email, google_sub
       FROM users
       WHERE tenant_id = ? AND email = ?`,
      [input.tenant_id, email],
    );

    if (existingByEmail) {
      if (
        existingByEmail.google_sub &&
        existingByEmail.google_sub !== google_sub
      ) {
        throw new GoogleAccountConflictError(email);
      }

      await this.db.run(`UPDATE users SET google_sub = ? WHERE user_id = ?`, [
        google_sub,
        existingByEmail.user_id,
      ]);

      await this.recordAudit({
        tenant_id: input.tenant_id,
        action: "user.google_linked",
        actor: input.actor ?? null,
        metadata: { user_id: existingByEmail.user_id, email },
      });
      await this.recordAudit({
        tenant_id: input.tenant_id,
        action: "user.login",
        actor: input.actor ?? null,
        metadata: {
          user_id: existingByEmail.user_id,
          email,
          method: "google",
        },
      });

      return {
        user_id: existingByEmail.user_id,
        tenant_id: existingByEmail.tenant_id,
        email: existingByEmail.email,
      };
    }

    const user_id = randomUUID();
    const created_at = new Date().toISOString();

    try {
      await this.db.run(
        `INSERT INTO users
         (user_id, tenant_id, email, password_hash, password_salt, google_sub,
          display_name, tenant_role, created_at)
         VALUES (?, ?, ?, NULL, NULL, ?, ?, 'member', ?)`,
        [
          user_id,
          input.tenant_id,
          email,
          google_sub,
          displayNameFromEmail(email),
          created_at,
        ],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new GoogleAccountConflictError(email);
      }
      throw error;
    }

    await this.recordAudit({
      tenant_id: input.tenant_id,
      action: "user.registered",
      actor: input.actor ?? null,
      metadata: { user_id, email, method: "google" },
    });
    await this.recordAudit({
      tenant_id: input.tenant_id,
      action: "user.login",
      actor: input.actor ?? null,
      metadata: { user_id, email, method: "google" },
    });

    return { user_id, tenant_id: input.tenant_id, email };
  }

  async createRole(input: {
    tenant_id: string;
    name: string;
    hermes_profile: string;
    path_prefixes: string[];
    actor?: string;
  }): Promise<Role> {
    if (!(await this.getTenantById(input.tenant_id))) {
      throw new TenantNotFoundError(input.tenant_id);
    }

    return createRoleRecord(
      this.db,
      (audit) => this.recordAudit(audit),
      input,
    );
  }

  async setUserRoles(input: {
    tenant_id: string;
    user_id: string;
    role_ids: string[];
    actor?: string;
  }): Promise<UserRbac> {
    if (!(await this.getTenantById(input.tenant_id))) {
      throw new TenantNotFoundError(input.tenant_id);
    }

    return setUserRoleAssignments(
      this.db,
      (audit) => this.recordAudit(audit),
      input,
    );
  }

  async getUserRbac(
    tenant_id: string,
    user_id: string,
  ): Promise<UserRbac | null> {
    return resolveUserRbac(this.db, tenant_id, user_id);
  }

  async listRoles(tenant_id: string): Promise<Role[]> {
    if (!(await this.getTenantById(tenant_id))) {
      throw new TenantNotFoundError(tenant_id);
    }
    return listTenantRoles(this.db, tenant_id);
  }

  async createProject(input: {
    tenant_id: string;
    user_id: string;
    name: string;
    vault_path: string;
    parent_project_id?: string | null;
    actor?: string;
  }): Promise<Project> {
    if (!(await this.getTenantById(input.tenant_id))) {
      throw new TenantNotFoundError(input.tenant_id);
    }

    return createProjectRecord(
      this.db,
      (audit) => this.recordAudit(audit),
      input,
    );
  }

  async listProjects(tenant_id: string, user_id: string): Promise<Project[]> {
    if (!(await this.getTenantById(tenant_id))) {
      throw new TenantNotFoundError(tenant_id);
    }
    return listTenantProjects(this.db, tenant_id, user_id);
  }

  async getProject(
    tenant_id: string,
    user_id: string,
    project_id: string,
  ): Promise<Project | null> {
    if (!(await this.getTenantById(tenant_id))) {
      throw new TenantNotFoundError(tenant_id);
    }
    return getProjectRecord(this.db, tenant_id, user_id, project_id);
  }

  async updateProject(input: {
    tenant_id: string;
    user_id: string;
    project_id: string;
    name?: string;
    vault_path?: string;
    actor?: string;
  }): Promise<Project> {
    if (!(await this.getTenantById(input.tenant_id))) {
      throw new TenantNotFoundError(input.tenant_id);
    }
    return updateProjectRecord(
      this.db,
      (audit) => this.recordAudit(audit),
      input,
    );
  }

  async deleteProject(input: {
    tenant_id: string;
    user_id: string;
    project_id: string;
    actor?: string;
  }): Promise<void> {
    if (!(await this.getTenantById(input.tenant_id))) {
      throw new TenantNotFoundError(input.tenant_id);
    }
    await deleteProjectRecord(
      this.db,
      (audit) => this.recordAudit(audit),
      input,
    );
  }

  async getUserByEmail(
    tenant_id: string,
    email: string,
  ): Promise<{ user_id: string; email: string } | null> {
    if (!(await this.getTenantById(tenant_id))) {
      throw new TenantNotFoundError(tenant_id);
    }
    return getTenantUserByEmail(this.db, tenant_id, email);
  }

  async parseConnectorId(value: string): Promise<ConnectorId> {
    return parseConnectorIdRecord(this.db, value);
  }

  async listCanonicalConnectors(options?: {
    includeArchived?: boolean;
  }): Promise<CanonicalConnector[]> {
    return listCanonicalConnectorsRecord(this.db, options);
  }

  async getCanonicalConnector(
    id: string,
    options?: { includeArchived?: boolean },
  ): Promise<CanonicalConnector | null> {
    return getCanonicalConnectorRecord(this.db, id, options);
  }

  async lookupCanonicalAlias(domain: string): Promise<{
    alias: string;
    connector_id: ConnectorId;
  } | null> {
    return lookupCanonicalAliasRecord(this.db, domain);
  }

  async insertCanonicalConnector(
    input: InsertCanonicalConnectorInput,
  ): Promise<CanonicalConnector> {
    return insertCanonicalConnectorRecord(
      this.db,
      (audit) => this.recordAudit(audit),
      input,
    );
  }

  async archiveCanonicalConnector(input: {
    id: string;
    actor?: string | null;
  }): Promise<CanonicalConnector> {
    return archiveCanonicalConnectorRecord(
      this.db,
      (audit) => this.recordAudit(audit),
      input,
    );
  }

  async listConnectorCatalog(): Promise<ConnectorCatalog> {
    return listConnectorCatalogRecord(this.db);
  }

  async listTenantConnectorEntitlements(
    tenant_id: string,
  ): Promise<TenantConnectorEntitlement[]> {
    if (!(await this.getTenantById(tenant_id))) {
      throw new TenantNotFoundError(tenant_id);
    }
    return listTenantConnectorEntitlementsRecord(this.db, tenant_id);
  }

  async getTenantConnectorEntitlement(
    tenant_id: string,
    connector_id: ConnectorId,
  ): Promise<TenantConnectorEntitlement | null> {
    if (!(await this.getTenantById(tenant_id))) {
      throw new TenantNotFoundError(tenant_id);
    }
    return getTenantConnectorEntitlementRecord(this.db, tenant_id, connector_id);
  }

  async upsertTenantConnectorEntitlement(input: {
    tenant_id: string;
    connector_id: ConnectorId;
    enabled: boolean;
    hubspot_portal_id?: string | null;
    surfaces?: OnboardSurfaceId[];
    actor?: string | null;
  }): Promise<TenantConnectorEntitlement> {
    if (!(await this.getTenantById(input.tenant_id))) {
      throw new TenantNotFoundError(input.tenant_id);
    }
    return upsertTenantConnectorEntitlementRecord(
      this.db,
      (audit) => this.recordAudit(audit),
      input,
    );
  }

  async listTenantProviderSecretStatuses(
    tenant_id: string,
  ): Promise<TenantProviderSecretStatus[]> {
    if (!(await this.getTenantById(tenant_id))) {
      throw new TenantNotFoundError(tenant_id);
    }
    return listTenantProviderSecretStatuses(this.db, tenant_id);
  }

  async upsertTenantProviderSecret(input: {
    tenant_id: string;
    slot: OpsSecretSlot;
    value: string;
    actor?: string | null;
  }): Promise<TenantProviderSecretStatus> {
    if (!(await this.getTenantById(input.tenant_id))) {
      throw new TenantNotFoundError(input.tenant_id);
    }
    return upsertTenantProviderSecret(
      this.db,
      this.connectorKms,
      (audit) => this.recordAudit(audit),
      input,
    );
  }

  async deleteTenantProviderSecret(input: {
    tenant_id: string;
    slot: OpsSecretSlot;
    actor?: string | null;
  }): Promise<boolean> {
    if (!(await this.getTenantById(input.tenant_id))) {
      throw new TenantNotFoundError(input.tenant_id);
    }
    return deleteTenantProviderSecret(
      this.db,
      (audit) => this.recordAudit(audit),
      input,
    );
  }

  /**
   * Decrypt env-kind provider slots for wake inject (`lp-2qs.4`). CP rows win
   * over process env at the orchestrator merge site.
   */
  async getTenantProviderWakeEnvValues(
    tenant_id: string,
  ): Promise<Record<string, string>> {
    if (!(await this.getTenantById(tenant_id))) {
      throw new TenantNotFoundError(tenant_id);
    }
    return getTenantProviderWakeEnvValues(
      this.db,
      this.connectorKms,
      tenant_id,
    );
  }

  async listClassCSecretStatuses(
    tenant_id: string,
    connector_id: ConnectorId,
  ): Promise<ClassCSecretStatus[]> {
    if (!(await this.getTenantById(tenant_id))) {
      throw new TenantNotFoundError(tenant_id);
    }
    const id = await parseClassCConnectorId(this.db, connector_id);
    return listClassCSecretStatuses(this.db, tenant_id, id);
  }

  async upsertClassCSecret(input: {
    tenant_id: string;
    connector_id: ConnectorId;
    surface_id: ConnectorSurfaceId;
    payload: ClassCSecretPayload;
    actor?: string | null;
  }): Promise<ClassCSecretStatus> {
    if (!(await this.getTenantById(input.tenant_id))) {
      throw new TenantNotFoundError(input.tenant_id);
    }
    return upsertClassCSecret(
      this.db,
      this.connectorKms,
      (audit) => this.recordAudit(audit),
      input,
    );
  }

  async deleteClassCSecret(input: {
    tenant_id: string;
    connector_id: ConnectorId;
    surface_id: ConnectorSurfaceId;
    actor?: string | null;
  }): Promise<boolean> {
    if (!(await this.getTenantById(input.tenant_id))) {
      throw new TenantNotFoundError(input.tenant_id);
    }
    return deleteClassCSecret(this.db, (audit) => this.recordAudit(audit), input);
  }

  async getClassCSecretPayload(
    tenant_id: string,
    connector_id: ConnectorId,
    surface_id: ConnectorSurfaceId,
  ): Promise<ClassCSecretPayload> {
    if (!(await this.getTenantById(tenant_id))) {
      throw new TenantNotFoundError(tenant_id);
    }
    return getClassCSecretPayload(
      this.db,
      this.connectorKms,
      tenant_id,
      connector_id,
      parseConnectorSurfaceId(surface_id),
    );
  }

  async listRoleConnectorGrants(
    tenant_id: string,
    role_id: string,
  ): Promise<RoleConnectorGrant[]> {
    if (!(await this.getTenantById(tenant_id))) {
      throw new TenantNotFoundError(tenant_id);
    }
    return listRoleConnectorGrantsRecord(this.db, tenant_id, role_id);
  }

  async upsertRoleConnectorGrant(input: {
    tenant_id: string;
    role_id: string;
    connector_id: ConnectorId;
    enabled: boolean;
    actor?: string | null;
  }): Promise<RoleConnectorGrant> {
    if (!(await this.getTenantById(input.tenant_id))) {
      throw new TenantNotFoundError(input.tenant_id);
    }
    return upsertRoleConnectorGrantRecord(
      this.db,
      (audit) => this.recordAudit(audit),
      input,
    );
  }

  async listUserConnectorConnections(
    tenant_id: string,
    user_id: string,
  ): Promise<ConnectorConnectionPublic[]> {
    if (!(await this.getTenantById(tenant_id))) {
      throw new TenantNotFoundError(tenant_id);
    }
    return listUserConnectorConnectionsRecord(this.db, tenant_id, user_id);
  }

  async getUserConnectorConnection(
    tenant_id: string,
    user_id: string,
    connector_id: ConnectorId,
  ): Promise<ConnectorConnectionPublic | null> {
    if (!(await this.getTenantById(tenant_id))) {
      throw new TenantNotFoundError(tenant_id);
    }
    return getUserConnectorConnectionRecord(
      this.db,
      tenant_id,
      user_id,
      connector_id,
    );
  }

  async upsertUserConnectorConnection(input: {
    tenant_id: string;
    user_id: string;
    connector_id: ConnectorId;
    status?: ConnectionStatus;
    account_label?: string | null;
    sticky?: ConnectorSticky;
    secrets?: Partial<ConnectorSecrets>;
    replace_secrets?: boolean;
    actor?: string | null;
  }): Promise<ConnectorConnectionPublic> {
    if (!(await this.getTenantById(input.tenant_id))) {
      throw new TenantNotFoundError(input.tenant_id);
    }
    return upsertUserConnectorConnectionRecord(
      this.db,
      (audit) => this.recordAudit(audit),
      this.connectorKms,
      input,
    );
  }

  async deleteUserConnectorConnection(input: {
    tenant_id: string;
    user_id: string;
    connector_id: ConnectorId;
    actor?: string | null;
    reason?: string | null;
    missing?: "throw" | "ignore";
  }): Promise<boolean> {
    if (!(await this.getTenantById(input.tenant_id))) {
      throw new TenantNotFoundError(input.tenant_id);
    }
    return deleteUserConnectorConnectionRecord(
      this.db,
      (audit) => this.recordAudit(audit),
      input,
    );
  }

  async deleteConnectionsForConnector(input: {
    tenant_id: string;
    connector_id: ConnectorId;
    actor?: string | null;
    reason?: string | null;
  }): Promise<{ deleted: number }> {
    if (!(await this.getTenantById(input.tenant_id))) {
      throw new TenantNotFoundError(input.tenant_id);
    }
    return deleteConnectionsForConnectorRecord(
      this.db,
      (audit) => this.recordAudit(audit),
      input,
    );
  }

  async listTenantConnectorConnections(
    tenant_id: string,
    connector_id: ConnectorId,
  ): Promise<Array<{ user_id: string; connector_id: ConnectorId }>> {
    if (!(await this.getTenantById(tenant_id))) {
      throw new TenantNotFoundError(tenant_id);
    }
    return listTenantConnectorConnectionsRecord(this.db, tenant_id, connector_id);
  }

  async listUserIdsLosingRoleConnectorGrant(
    tenant_id: string,
    role_id: string,
    connector_id: ConnectorId,
  ): Promise<string[]> {
    if (!(await this.getTenantById(tenant_id))) {
      throw new TenantNotFoundError(tenant_id);
    }
    return listUserIdsLosingRoleConnectorGrantRecord(
      this.db,
      tenant_id,
      role_id,
      connector_id,
    );
  }

  async getUserConnectorSecrets(
    tenant_id: string,
    user_id: string,
    connector_id: ConnectorId,
  ): Promise<ConnectorSecrets> {
    if (!(await this.getTenantById(tenant_id))) {
      throw new TenantNotFoundError(tenant_id);
    }
    return getUserConnectorSecretsRecord(
      this.db,
      this.connectorKms,
      tenant_id,
      user_id,
      connector_id,
    );
  }

  async putUserConnectorSecrets(input: {
    tenant_id: string;
    user_id: string;
    connector_id: ConnectorId;
    secrets: Partial<ConnectorSecrets>;
    replace?: boolean;
    actor?: string | null;
  }): Promise<ConnectorSecrets> {
    if (!(await this.getTenantById(input.tenant_id))) {
      throw new TenantNotFoundError(input.tenant_id);
    }
    return putUserConnectorSecretsRecord(
      this.db,
      (audit) => this.recordAudit(audit),
      this.connectorKms,
      input,
    );
  }

  async getUserConnectorAccess(
    tenant_id: string,
    user_id: string,
    connector_id: ConnectorId,
  ): Promise<ConnectorAccess> {
    if (!(await this.getTenantById(tenant_id))) {
      throw new TenantNotFoundError(tenant_id);
    }
    return getUserConnectorAccessRecord(
      this.db,
      tenant_id,
      user_id,
      connector_id,
    );
  }

  async listUserGrantedConnectors(
    tenant_id: string,
    user_id: string,
  ): Promise<UserGrantedConnector[]> {
    if (!(await this.getTenantById(tenant_id))) {
      throw new TenantNotFoundError(tenant_id);
    }
    return listUserGrantedConnectorsRecord(this.db, tenant_id, user_id);
  }

  /**
   * List same-tenant users for directory/share picker.
   * Returns safe fields only (user_id, email) — never password hashes/secrets.
   */
  async listTenantUsers(
    tenant_id: string,
    options: { q?: string } = {},
  ): Promise<TenantMember[]> {
    if (!(await this.getTenantById(tenant_id))) {
      throw new TenantNotFoundError(tenant_id);
    }

    const q = options.q?.trim().toLowerCase();
    if (q) {
      // Escape LIKE wildcards so user input is treated as a literal substring.
      const escaped = q.replace(/[\\%_]/g, (ch) => `\\${ch}`);
      const rows = await this.db.all<TenantMember>(
        `SELECT user_id, email
         FROM users
         WHERE tenant_id = ?
           AND email LIKE ? ESCAPE '\\'
         ORDER BY email ASC`,
        [tenant_id, `%${escaped}%`],
      );
      return rows;
    }

    const rows = await this.db.all<TenantMember>(
      `SELECT user_id, email
       FROM users
       WHERE tenant_id = ?
       ORDER BY email ASC`,
      [tenant_id],
    );
    return rows;
  }

  async listOpsTenantUsers(tenant_id: string): Promise<OpsTenantUser[]> {
    if (!(await this.getTenantById(tenant_id))) {
      throw new TenantNotFoundError(tenant_id);
    }
    return listOpsTenantUsersRecord(this.db, tenant_id);
  }

  async getOpsTenantUser(
    tenant_id: string,
    user_id: string,
  ): Promise<OpsTenantUser> {
    if (!(await this.getTenantById(tenant_id))) {
      throw new TenantNotFoundError(tenant_id);
    }
    return getOpsTenantUserRecord(this.db, tenant_id, user_id);
  }

  async provisionOpsTenantUser(input: {
    tenant_id: string;
    display_name: string;
    email: string;
    role: OpsTenantUserRole;
    actor?: string | null;
  }): Promise<OpsTenantUser> {
    if (!(await this.getTenantById(input.tenant_id))) {
      throw new TenantNotFoundError(input.tenant_id);
    }
    return provisionOpsTenantUserRecord(
      this.db,
      (audit) => this.recordAudit(audit),
      input,
    );
  }

  async updateOpsTenantUser(input: {
    tenant_id: string;
    user_id: string;
    display_name?: string;
    role?: OpsTenantUserRole;
    actor?: string | null;
  }): Promise<OpsTenantUser> {
    if (!(await this.getTenantById(input.tenant_id))) {
      throw new TenantNotFoundError(input.tenant_id);
    }
    return updateOpsTenantUserRecord(
      this.db,
      (audit) => this.recordAudit(audit),
      input,
    );
  }

  async deleteOpsTenantUser(input: {
    tenant_id: string;
    user_id: string;
    actor?: string | null;
  }): Promise<void> {
    if (!(await this.getTenantById(input.tenant_id))) {
      throw new TenantNotFoundError(input.tenant_id);
    }
    return deleteOpsTenantUserRecord(
      this.db,
      (audit) => this.recordAudit(audit),
      input,
    );
  }

  async listOpsConnectorUsers(
    tenant_id: string,
    connector_id: ConnectorId,
  ): Promise<OpsConnectorUser[]> {
    if (!(await this.getTenantById(tenant_id))) {
      throw new TenantNotFoundError(tenant_id);
    }
    return listOpsConnectorUsersRecord(this.db, tenant_id, connector_id);
  }

  async setPersonConnectorGrant(input: {
    tenant_id: string;
    user_id: string;
    connector_id: string;
    granted: boolean;
    actor?: string | null;
  }): Promise<{
    tenant_id: string;
    user_id: string;
    connector_id: ConnectorId;
    granted: boolean;
  }> {
    if (!(await this.getTenantById(input.tenant_id))) {
      throw new TenantNotFoundError(input.tenant_id);
    }
    return setPersonConnectorGrantRecord(
      this.db,
      (audit) => this.recordAudit(audit),
      input,
    );
  }

  async getConnectorMemberSubset(
    tenant_id: string,
    connector_id: string,
  ): Promise<ConnectorMemberSubset> {
    if (!(await this.getTenantById(tenant_id))) {
      throw new TenantNotFoundError(tenant_id);
    }
    const id = await parseConnectorIdRecord(this.db, connector_id);
    const canonical = await getCanonicalConnectorRecord(this.db, id);
    return getConnectorMemberSubsetRecord(
      this.db,
      tenant_id,
      id,
      canonical?.snapshot ?? {},
    );
  }

  async setConnectorMemberSubset(input: {
    tenant_id: string;
    connector_id: string;
    allowed_tools: unknown;
    actor?: string | null;
  }): Promise<ConnectorMemberSubset> {
    if (!(await this.getTenantById(input.tenant_id))) {
      throw new TenantNotFoundError(input.tenant_id);
    }
    const id = await parseConnectorIdRecord(this.db, input.connector_id);
    const canonical = await getCanonicalConnectorRecord(this.db, id);
    return setConnectorMemberSubsetRecord(
      this.db,
      (audit) => this.recordAudit(audit),
      {
        tenant_id: input.tenant_id,
        connector_id: id,
        allowed_tools: input.allowed_tools,
        snapshot: canonical?.snapshot ?? {},
        actor: input.actor,
      },
    );
  }

  async authorizeHarnessToolCall(input: {
    tenant_id: string;
    user_id: string;
    connector_id: string;
    tool_name: string;
  }): Promise<HarnessToolAuthorizeResult> {
    if (!(await this.getTenantById(input.tenant_id))) {
      throw new TenantNotFoundError(input.tenant_id);
    }
    const ref = parseHarnessToolRef({
      connector_id: input.connector_id,
      tool_name: input.tool_name,
    });
    const connector_id = await parseConnectorIdRecord(this.db, ref.connector_id);
    const user = await getOpsTenantUserRecord(
      this.db,
      input.tenant_id,
      input.user_id,
    );
    const entitlement = await getTenantConnectorEntitlementRecord(
      this.db,
      input.tenant_id,
      connector_id,
    );
    const canonical = await getCanonicalConnectorRecord(this.db, connector_id);
    const subset = await getConnectorMemberSubsetRecord(
      this.db,
      input.tenant_id,
      connector_id,
      canonical?.snapshot ?? {},
    );
    return authorizeHarnessToolCallGate({
      caller: harnessToolCallerFrom({
        entitlement,
        granted: user.connectors.includes(connector_id),
        role: user.role,
        subsetKind: subset.kind,
        allowlist: subset.allowed_tools,
      }),
      connector_id,
      tool_name: ref.tool_name,
    });
  }

  async listHarnessToolsForPerson(input: {
    tenant_id: string;
    user_id: string;
    connector_id: string;
  }): Promise<{
    tenant_id: string;
    user_id: string;
    connector_id: ConnectorId;
    kind: MemberSubsetKind;
    tools: HarnessExposedTool[];
  }> {
    if (!(await this.getTenantById(input.tenant_id))) {
      throw new TenantNotFoundError(input.tenant_id);
    }
    const connector_id = await parseConnectorIdRecord(
      this.db,
      parseHarnessConnectorId(input.connector_id),
    );
    const user = await getOpsTenantUserRecord(
      this.db,
      input.tenant_id,
      input.user_id,
    );
    const entitlement = await getTenantConnectorEntitlementRecord(
      this.db,
      input.tenant_id,
      connector_id,
    );
    const canonical = await getCanonicalConnectorRecord(this.db, connector_id);
    const subset = await getConnectorMemberSubsetRecord(
      this.db,
      input.tenant_id,
      connector_id,
      canonical?.snapshot ?? {},
    );
    const caller = harnessToolCallerFrom({
      entitlement,
      granted: user.connectors.includes(connector_id),
      role: user.role,
      subsetKind: subset.kind,
      allowlist: subset.allowed_tools,
    });
    const tools = filterHarnessExposedTools(
      caller,
      listHarnessExposedTools({
        connector_id,
        snapshot: canonical?.snapshot ?? {},
      }),
    );
    return {
      tenant_id: input.tenant_id,
      user_id: input.user_id,
      connector_id,
      kind: subset.kind,
      tools,
    };
  }

  async createSessionShareGrant(input: {
    tenant_id: string;
    owner_user_id: string;
    thread_id: string;
    grantee_email: string;
    mode: SessionShareMode;
    actor?: string;
  }): Promise<SessionShareGrant> {
    if (!(await this.getTenantById(input.tenant_id))) {
      throw new TenantNotFoundError(input.tenant_id);
    }
    return createSessionShareGrantRecord(
      this.db,
      (audit) => this.recordAudit(audit),
      input,
    );
  }

  async listSessionShareGrantsForGrantee(
    tenant_id: string,
    grantee_user_id: string,
  ): Promise<SessionShareGrant[]> {
    if (!(await this.getTenantById(tenant_id))) {
      throw new TenantNotFoundError(tenant_id);
    }
    return listSessionShareGrantsForGranteeRecord(
      this.db,
      tenant_id,
      grantee_user_id,
    );
  }

  async listSessionShareGrantsForThread(
    tenant_id: string,
    owner_user_id: string,
    thread_id: string,
  ): Promise<SessionShareGrant[]> {
    if (!(await this.getTenantById(tenant_id))) {
      throw new TenantNotFoundError(tenant_id);
    }
    return listSessionShareGrantsForThreadRecord(
      this.db,
      tenant_id,
      owner_user_id,
      thread_id,
    );
  }

  async getActiveSessionShareGrant(
    tenant_id: string,
    thread_id: string,
    grantee_user_id: string,
  ): Promise<SessionShareGrant | null> {
    if (!(await this.getTenantById(tenant_id))) {
      throw new TenantNotFoundError(tenant_id);
    }
    return getActiveSessionShareGrantRecord(
      this.db,
      tenant_id,
      thread_id,
      grantee_user_id,
    );
  }

  async revokeSessionShareGrant(input: {
    tenant_id: string;
    owner_user_id: string;
    thread_id: string;
    grantee_user_id: string;
    actor?: string;
  }): Promise<SessionShareGrant> {
    if (!(await this.getTenantById(input.tenant_id))) {
      throw new TenantNotFoundError(input.tenant_id);
    }
    return revokeSessionShareGrantRecord(
      this.db,
      (audit) => this.recordAudit(audit),
      input,
    );
  }

  async listAuditEntries(tenant_id?: string): Promise<AuditEntry[]> {
    const rows = tenant_id
      ? await this.db.all<{
          audit_id: string;
          tenant_id: string | null;
          action: string;
          actor: string | null;
          metadata_json: string;
          created_at: string;
          instance_id: string | null;
          result: string;
          request_id: string | null;
        }>(
          `SELECT audit_id, tenant_id, action, actor, metadata_json, created_at,
                  instance_id, result, request_id
           FROM audit_log WHERE tenant_id = ?
           ORDER BY created_at ASC`,
          [tenant_id],
        )
      : await this.db.all<{
          audit_id: string;
          tenant_id: string | null;
          action: string;
          actor: string | null;
          metadata_json: string;
          created_at: string;
          instance_id: string | null;
          result: string;
          request_id: string | null;
        }>(
          `SELECT audit_id, tenant_id, action, actor, metadata_json, created_at,
                  instance_id, result, request_id
           FROM audit_log ORDER BY created_at ASC`,
        );

    return rows.map((row) => ({
      audit_id: row.audit_id,
      tenant_id: row.tenant_id,
      action: row.action as AuditAction,
      actor: row.actor,
      metadata: JSON.parse(row.metadata_json) as Record<string, unknown>,
      created_at: row.created_at,
      instance_id: row.instance_id ?? null,
      result: (row.result as AuditResult) || "success",
      request_id: row.request_id ?? null,
    }));
  }

  async recordAudit(input: {
    tenant_id: string | null;
    action: AuditAction;
    actor: string | null;
    metadata: Record<string, unknown>;
    instance_id?: string | null;
    result?: AuditResult;
    request_id?: string | null;
  }): Promise<void> {
    // G2b.2 + cbd-mta.3.3: audit_log is L2 durable — never store secrets,
    // vault bodies, or Terraform state. First-class fields: actor, tenant,
    // instance, action, result, request_id.
    const safeMetadata = redactAuditMetadata(input.metadata);
    const instanceFromMeta =
      typeof input.metadata.instance_id === "string"
        ? input.metadata.instance_id
        : null;
    await this.db.run(
      `INSERT INTO audit_log
       (audit_id, tenant_id, action, actor, metadata_json, created_at,
        instance_id, result, request_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        input.tenant_id,
        input.action,
        input.actor,
        JSON.stringify(safeMetadata),
        new Date().toISOString(),
        input.instance_id ?? instanceFromMeta,
        input.result ?? "success",
        input.request_id ?? null,
      ],
    );
  }
}

export async function validateInstanceSecret(
  store: ControlPlaneStore,
  instance_id: string,
  secret: string,
  options: { audit?: boolean } = {},
): Promise<ValidateInstanceSecretResult> {
  const instance = await store.getInstance(instance_id);
  if (!instance) {
    return { valid: false, reason: "not_found", instance_id };
  }

  if (instance.revoked_at) {
    if (options.audit) {
      await store.recordAudit({
        tenant_id: instance.tenant_id,
        action: "instance.secret_rejected",
        actor: "relay",
        instance_id,
        result: "denied",
        metadata: {
          instance_id,
          reason: "revoked",
        },
      });
    }
    return {
      valid: false,
      reason: "revoked",
      tenant_id: instance.tenant_id,
      instance_id,
    };
  }

  const matchesPrimary = verifyInstanceSecret(
    secret,
    instance.secret_hash,
    instance.secret_salt,
  );

  const matchesPrevious =
    !matchesPrimary &&
    instance.previous_secret_hash &&
    instance.previous_secret_salt &&
    instance.previous_secret_expires_at &&
    Date.parse(instance.previous_secret_expires_at) > Date.now() &&
    verifyInstanceSecret(
      secret,
      instance.previous_secret_hash,
      instance.previous_secret_salt,
    );

  if (!matchesPrimary && !matchesPrevious) {
    if (options.audit) {
      await store.recordAudit({
        tenant_id: instance.tenant_id,
        action: "instance.secret_rejected",
        actor: "relay",
        instance_id,
        result: "denied",
        metadata: {
          instance_id,
          reason: "invalid_secret",
        },
      });
    }
    return {
      valid: false,
      reason: "invalid_secret",
      tenant_id: instance.tenant_id,
      instance_id,
    };
  }

  if (options.audit) {
    await store.recordAudit({
      tenant_id: instance.tenant_id,
      action: "instance.secret_validated",
      actor: "relay",
      instance_id,
      result: "success",
      metadata: {
        instance_id,
        ...(matchesPrevious ? { via: "previous_secret" } : {}),
      },
    });
  }

  return {
    valid: true,
    tenant_id: instance.tenant_id,
    instance_id,
    revoked: false,
  };
}

function normalizeGracePeriodSeconds(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) {
    return DEFAULT_ROTATION_GRACE_PERIOD_SECONDS;
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new InvalidRotationGracePeriodError(value);
  }
  const floored = Math.floor(value);
  if (floored > MAX_ROTATION_GRACE_PERIOD_SECONDS) {
    throw new InvalidRotationGracePeriodError(value);
  }
  return floored;
}

export class TenantNotFoundError extends Error {
  readonly code = "TENANT_NOT_FOUND";

  constructor(tenant_id: string) {
    super(`Tenant not found: ${tenant_id}`);
    this.name = "TenantNotFoundError";
  }
}

export class InstanceNotFoundError extends Error {
  readonly code = "INSTANCE_NOT_FOUND";

  constructor(instance_id: string) {
    super(`Gateway instance not found: ${instance_id}`);
    this.name = "InstanceNotFoundError";
  }
}

export class InstanceRevokedError extends Error {
  readonly code = "INSTANCE_REVOKED";

  constructor(instance_id: string) {
    super(`Gateway instance is revoked and cannot be rotated: ${instance_id}`);
    this.name = "InstanceRevokedError";
  }
}

export class InvalidRotationGracePeriodError extends Error {
  readonly code = "INVALID_ROTATION_GRACE_PERIOD";

  constructor(value: number) {
    super(
      `grace_period_seconds must be an integer between 0 and ${MAX_ROTATION_GRACE_PERIOD_SECONDS} (got ${value})`,
    );
    this.name = "InvalidRotationGracePeriodError";
  }
}

function parseRetentionMode(value: string | undefined): RetentionMode {
  if (value && (RETENTION_MODES as readonly string[]).includes(value)) {
    return value as RetentionMode;
  }
  return "none";
}

function parseRelayTier(value: string | undefined): RelayTier {
  if (value && (RELAY_TIERS as readonly string[]).includes(value)) {
    return value as RelayTier;
  }
  return "shared";
}

function parseHealthStatus(value: string | undefined | null): InstanceHealthStatus {
  if (value && (INSTANCE_HEALTH_STATUSES as readonly string[]).includes(value)) {
    return value as InstanceHealthStatus;
  }
  return "unknown";
}

/** Coerce DB / optional input to RuntimeKind; unknown → ec2 (safe default). */
function parseInstanceScope(value: string | undefined | null): InstanceScope {
  if (value && (INSTANCE_SCOPES as readonly string[]).includes(value)) {
    return value as InstanceScope;
  }
  return "tenant";
}

function parseOwnerUserId(
  scope: InstanceScope,
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim() ?? "";
  if (scope === "user") {
    if (!trimmed) {
      throw new InvalidProvisionInputError(
        "owner_user_id is required when scope=user",
      );
    }
    return trimmed;
  }
  if (trimmed) {
    throw new InvalidProvisionInputError(
      "owner_user_id must be null when scope=tenant",
    );
  }
  return null;
}

/**
 * lp-zoh.2 / plan 0010: optional s3_shared_vault_prefix override.
 * Empty/undefined → null (provision auto-assigns the normative shape).
 * Overrides must match `tenants/{tenant_id}/vault/shared/` exactly —
 * fail closed on foreign tenants, legacy shapes, missing trailing slash.
 */
function parseS3SharedVaultPrefixOverride(
  value: string | null | undefined,
  tenantId: string,
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return assertS3SharedVaultPrefixBoundToTenant(trimmed, tenantId);
  } catch (error) {
    if (error instanceof VaultPrefixError) {
      throw new InvalidProvisionInputError(
        `s3_shared_vault_prefix: ${error.message}`,
      );
    }
    throw error;
  }
}

/**
 * lp-zoh.2 / plan 0010: optional s3_personal_vault_prefix override.
 * Personal prefixes are scope=user only — any override on tenant scope is
 * rejected. Overrides must match `tenants/{tenant_id}/users/{owner_user_id}/vault/`
 * exactly (fail closed on wrong user/tenant binding or shape).
 */
function parseS3PersonalVaultPrefixOverride(
  scope: InstanceScope,
  value: string | null | undefined,
  tenantId: string,
  ownerUserId: string | null,
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const trimmed = value.trim();
  if (scope === "tenant") {
    throw new InvalidProvisionInputError(
      "s3_personal_vault_prefix is only valid when scope=user",
    );
  }
  if (!trimmed) {
    return null;
  }
  try {
    return assertS3PersonalVaultPrefixBoundToTenantUser(
      trimmed,
      tenantId,
      ownerUserId ?? "",
    );
  } catch (error) {
    if (error instanceof VaultPrefixError) {
      throw new InvalidProvisionInputError(
        `s3_personal_vault_prefix: ${error.message}`,
      );
    }
    throw error;
  }
}

function parseRuntimeKind(value: string | undefined | null): RuntimeKind {
  if (value && (RUNTIME_KINDS as readonly string[]).includes(value)) {
    return value as RuntimeKind;
  }
  return "ec2";
}

/** Persist/read chat_delivery. Empty/unknown → null (inherit env default relay). */
function parseOptionalChatDelivery(
  value: string | null | undefined,
): ChatDelivery | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if ((CHAT_DELIVERIES as readonly string[]).includes(v)) {
    return v as ChatDelivery;
  }
  return null;
}

/** Coerce DB / optional input to InstancePresence; unknown → offline. */
function parseInstancePresence(
  value: string | undefined | null,
): InstancePresence {
  if (value && (INSTANCE_PRESENCE_STATES as readonly string[]).includes(value)) {
    return value as InstancePresence;
  }
  return "offline";
}

export class TenantSlugConflictError extends Error {
  readonly code = "TENANT_SLUG_CONFLICT";

  constructor(slug: string) {
    super(`Tenant slug already exists: ${slug}`);
    this.name = "TenantSlugConflictError";
  }
}

export class InvalidCredentialsError extends Error {
  readonly code = "INVALID_CREDENTIALS";

  constructor() {
    super("Invalid email or password");
    this.name = "InvalidCredentialsError";
  }
}

export class GoogleAccountConflictError extends Error {
  readonly code = "GOOGLE_ACCOUNT_CONFLICT";

  constructor(email: string) {
    super(`Google account conflict for email: ${email}`);
    this.name = "GoogleAccountConflictError";
  }
}
