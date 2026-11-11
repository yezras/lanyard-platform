export const RETENTION_MODES = ["none", "metadata_only", "interaction_export"] as const;

export type RetentionMode = (typeof RETENTION_MODES)[number];

/**
 * Effective L10 chat-corpus retention when the tenant flag is on and
 * `chat_corpus_retention_days` is null (bucket lifecycle default).
 * Policy: docs/plans/0011-tenant-chat-corpus/decision-l10-chat-corpus-policy.md
 */
export const DEFAULT_CHAT_CORPUS_RETENTION_DAYS = 90;

/** Floor when ops sets an explicit chat_corpus_retention_days (policy min TTL). */
export const MIN_CHAT_CORPUS_RETENTION_DAYS = 30;

/** Soft upper bound for explicit tenant override (indefinite needs written client acceptance). */
export const MAX_CHAT_CORPUS_RETENTION_DAYS = 3650;

export const RELAY_TIERS = ["shared", "dedicated"] as const;

export type RelayTier = (typeof RELAY_TIERS)[number];

/**
 * Dual-run chat path (lp-oop.29 / plan 0015). Default unset inherits env
 * `CHAT_DELIVERY` (BFF default `relay`). Persist `harness` on one tenant
 * or instance so MockLab can flip without a global cutover or snapshot rewrite.
 */
export const CHAT_DELIVERIES = ["relay", "harness"] as const;

export type ChatDelivery = (typeof CHAT_DELIVERIES)[number];

export const DEFAULT_CHAT_DELIVERY: ChatDelivery = "relay";

/**
 * Tenant retention / export gates (L5 interaction export + L10 chat corpus).
 * Metadata-only on this surface — never message bodies.
 */
export type TenantRetentionPolicy = {
  /** L5: metadata-only interaction export. Default false. */
  interaction_export_enabled: boolean;
  retention_mode: RetentionMode;
  /**
   * L10: durable full-body chat corpus (S3). Default false (fail closed).
   * Independent of interaction_export_enabled.
   */
  chat_corpus_enabled: boolean;
  /**
   * Optional TTL in days when L10 is enabled. Null → platform default
   * {@link DEFAULT_CHAT_CORPUS_RETENTION_DAYS} (ignored when disabled).
   */
  chat_corpus_retention_days: number | null;
};

export type TenantRelayPolicy = {
  relay_tier: RelayTier;
  /** Ops override for Tier 3; null uses relay-{tenant_slug}.withlanyard.com convention. */
  dedicated_relay_wss_url: string | null;
  /** Resolved relay base URL for customer Terraform (shared pool or dedicated host). */
  relay_wss_url: string;
};

export type Tenant = {
  tenant_id: string;
  tenant_slug: string;
  display_name: string;
  host: string;
  created_at: string;
  retention: TenantRetentionPolicy;
  relay: TenantRelayPolicy;
  /**
   * Persisted chat path. Null inherits BFF `CHAT_DELIVERY` (default relay).
   * Instance `chat_delivery` overrides this when set.
   */
  chat_delivery: ChatDelivery | null;
};

export const INSTANCE_HEALTH_STATUSES = [
  "unknown",
  "healthy",
  "degraded",
  "unreachable",
  "revoked",
] as const;

export type InstanceHealthStatus = (typeof INSTANCE_HEALTH_STATUSES)[number];

/**
 * Compute runtime for a gateway instance (lp-nye / plan §2.3).
 * Default remains `ec2` until dual-run / provision paths flip tenants to daytona.
 */
export const RUNTIME_KINDS = ["ec2", "daytona"] as const;

export type RuntimeKind = (typeof RUNTIME_KINDS)[number];

/**
 * Presence field values for on-demand sandboxes (lp-nye field catalog).
 * Transition graph, reason helpers, and illegal-edge rejection: `presence.ts`
 * (lp-eya). Design: docs/plans/0008-daytona-agent-sandboxes/presence-state-machine.md
 */
export const INSTANCE_PRESENCE_STATES = [
  "offline",
  "waking",
  "online",
  "error",
] as const;

export type InstancePresence = (typeof INSTANCE_PRESENCE_STATES)[number];

/**
 * 0010 instance scope (lp-xhf4.6). Default tenant. User-principal connectors
 * bind a scope=user row with owner_user_id.
 */
export const INSTANCE_SCOPES = ["tenant", "user"] as const;

export type InstanceScope = (typeof INSTANCE_SCOPES)[number];

export type GatewayInstance = {
  instance_id: string;
  tenant_id: string;
  secret_hash: string;
  secret_salt: string;
  /** Prior secret hash retained only during rotation grace; null when none. */
  previous_secret_hash: string | null;
  previous_secret_salt: string | null;
  /** ISO timestamp; previous secret accepted strictly before this instant. */
  previous_secret_expires_at: string | null;
  created_at: string;
  revoked_at: string | null;
  /** Optional operator label (registry metadata). */
  label: string | null;
  /** Last health / presence observation (ISO). */
  last_seen_at: string | null;
  health_status: InstanceHealthStatus;
  /** Last successful credential rotation (ISO); null if never rotated. */
  credential_rotated_at: string | null;
  /** ARN of SSM/Secrets Manager parameter holding the secret — never the value. */
  secret_param_arn: string | null;
  /** Optional EC2 instance id metadata (i-…); not auth. Null on daytona path. */
  ec2_instance_id: string | null;
  aws_region: string | null;
  /**
   * Compute path: always-on EC2 host vs on-demand Daytona sandbox.
   * Default `ec2` preserves existing tenants.
   */
  runtime_kind: RuntimeKind;
  /**
   * Ephemeral Daytona sandbox handle for the current wake cycle.
   * Null when offline/unknown; never used as Relay identity (plan §2.3).
   */
  sandbox_id: string | null;
  /**
   * Orchestrator presence for ensure_online / idle stop.
   * Default `offline` (no live compute assumed).
   */
  presence: InstancePresence;
  /**
   * Pinned agent image/snapshot id for daytona create-from-snapshot.
   * May inherit org/platform default when null (lp-kng.2.7).
   */
  agent_snapshot_id: string | null;
  /**
   * Durable S3 vault root ref (Mountpoint path prefix). Survives stop/recreate.
   * Null on pure EC2 host-disk vault path. Layout detail: lp-kng.2.4.
   */
  s3_vault_prefix: string | null;
  /**
   * Last activity ISO timestamp for idle reaper grace (lp-omt).
   * Bumped by signal-activity; seeded on successful ensure_online wake.
   * Null until first activity or wake.
   */
  last_activity_at: string | null;
  /**
   * Mountpoint accepted a write (lp-vqr0.4). Independent of `presence`.
   * Default false. Presence `online` is agent_ready, not this flag.
   */
  vault_writable?: boolean;
  /**
   * Dual-run chat path override (lp-oop.29). Null inherits tenant then env.
   * Default unset keeps today's Relay path.
   */
  chat_delivery: ChatDelivery | null;
  /**
   * Compute scope (lp-xhf4.6 / plan 0010). Omitted/tenant = team primary.
   * User-principal connector inject is legal only on scope=user.
   */
  scope?: InstanceScope;
  /** Required when scope=user; null when scope=tenant. */
  owner_user_id?: string | null;
  /**
   * lp-zoh.2 / plan 0010: tenant primary for routing fallback. Exactly one
   * active tenant-scope instance per tenant carries is_primary=true.
   */
  is_primary?: boolean;
  /**
   * lp-zoh.2 / plan 0010: shared (team) vault prefix.
   * `tenants/{tenant_id}/vault/shared/`.
   */
  s3_shared_vault_prefix?: string | null;
  /**
   * lp-zoh.2 / plan 0010: personal vault prefix, scope=user only
   * (`tenants/{tid}/users/{uid}/vault/`); null for tenant scope.
   */
  s3_personal_vault_prefix?: string | null;
};

/** Public instance list row — no hashes or secrets. */
export type GatewayInstancePublic = {
  instance_id: string;
  created_at: string;
  label: string | null;
  last_seen_at: string | null;
  health_status: InstanceHealthStatus;
  credential_rotated_at: string | null;
  secret_param_arn: string | null;
  ec2_instance_id: string | null;
  aws_region: string | null;
  revoked_at: string | null;
  runtime_kind: RuntimeKind;
  sandbox_id: string | null;
  presence: InstancePresence;
  agent_snapshot_id: string | null;
  s3_vault_prefix: string | null;
  /** Idle grace clock; null until activity/wake (lp-omt). */
  last_activity_at: string | null;
  /** Dual-run chat path override; null inherits tenant then env (lp-oop.29). */
  chat_delivery: ChatDelivery | null;
};

export const HOSTING_TRACKS = ["lanyard_hosted", "customer_account"] as const;
export type HostingTrack = (typeof HOSTING_TRACKS)[number];

export const ISOLATION_MODES = [
  "account",
  "vpc_interim",
  "customer_account",
] as const;
export type IsolationMode = (typeof ISOLATION_MODES)[number];

export const DEPLOYMENT_STATUSES = [
  "registered",
  "provisioning",
  "active",
  "degraded",
  "offboarding",
  "retired",
] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

/**
 * Current tenant deployment / hosting metadata in the control plane.
 * Explicitly **not** Terraform state — no keys, tfstate, or resource graphs.
 */
export type TenantDeployment = {
  tenant_id: string;
  hosting_track: HostingTrack;
  isolation_mode: IsolationMode;
  aws_account_id: string | null;
  aws_region: string | null;
  project_name: string | null;
  status: DeploymentStatus;
  client_core_version: string | null;
  hermes_version: string | null;
  primary_instance_id: string | null;
  created_at: string;
  updated_at: string;
  retired_at: string | null;
};

export const RESOURCE_KINDS = [
  "ec2_instance",
  "ebs_volume",
  "kms_key",
  "iam_role",
  "security_group",
  "subnet",
  "vpc",
  "ssm_parameter",
  "secrets_manager_secret",
  "log_group",
  "dlm_policy",
  "s3_artifact_prefix",
  "other",
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export const RESOURCE_REF_STATUSES = ["active", "replaced", "retired"] as const;
export type ResourceRefStatus = (typeof RESOURCE_REF_STATUSES)[number];

/**
 * Minimal non-secret AWS / platform resource reference.
 * Secret fields hold **ARN refs only**, never secret values.
 */
export type TenantResourceRef = {
  resource_ref_id: string;
  tenant_id: string;
  resource_kind: ResourceKind;
  name: string;
  aws_id: string | null;
  arn: string | null;
  secret_arn: string | null;
  aws_region: string | null;
  status: ResourceRefStatus;
  last_seen_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

export type User = {
  user_id: string;
  tenant_id: string;
  email: string;
  has_password: boolean;
  has_google: boolean;
  created_at: string;
};

export type AuthUser = {
  user_id: string;
  tenant_id: string;
  email: string;
};

/** Safe tenant directory entry for share picker / org member lists (no secrets). */
export type TenantMember = {
  user_id: string;
  email: string;
};

/** Ops provision role. Not a Hermes path-prefix role. No invited. */
export const OPS_TENANT_USER_ROLES = ["tenant_admin", "member"] as const;
export type OpsTenantUserRole = (typeof OPS_TENANT_USER_ROLES)[number];

/** Superadmin Users list row. `connectors` are person-grant ids. */
export type OpsTenantUser = {
  user_id: string;
  display_name: string;
  email: string;
  role: OpsTenantUserRole;
  connectors: string[];
  last_active_at: string | null;
};

/** Connector-detail person grant row. Presence of a grant is `granted`. */
export type OpsConnectorUser = {
  user_id: string;
  display_name: string;
  email: string;
  role_label: string;
  granted: boolean;
};

export type Role = {
  role_id: string;
  tenant_id: string;
  name: string;
  hermes_profile: string;
  path_prefixes: string[];
  created_at: string;
};

/** Effective RBAC for a portal user (Hermes profile + vault ACL). */
export type UserRbac = {
  user_id: string;
  tenant_id: string;
  hermes_profile: string;
  allowed_path_prefixes: string[];
  role_names: string[];
};

/** Portal project or subproject bound to a vault folder (#11). */
export type Project = {
  project_id: string;
  tenant_id: string;
  parent_project_id: string | null;
  name: string;
  vault_path: string;
  created_at: string;
  updated_at: string;
};

export const SESSION_SHARE_MODES = ["read", "collaborate"] as const;

export type SessionShareMode = (typeof SESSION_SHARE_MODES)[number];

/** Org session share grant stored in control plane (#17). */
export type SessionShareGrant = {
  grant_id: string;
  tenant_id: string;
  thread_id: string;
  owner_user_id: string;
  grantee_user_id: string;
  mode: SessionShareMode;
  created_at: string;
  revoked_at: string | null;
};

export type AuditAction =
  | "tenant.created"
  | "tenant.relay_tier_updated"
  | "instance.provisioned"
  | "instance.rotated"
  | "tenant.deprovisioned"
  | "instance.revoked"
  | "instance.secret_validated"
  | "instance.secret_rejected"
  | "instance.registry_updated"
  | "tenant.retention_updated"
  | "tenant.chat_delivery_updated"
  | "tenant.deployment_upserted"
  | "tenant.resource_upserted"
  | "tenant.resource_retired"
  | "user.registered"
  | "user.provisioned"
  | "user.removed"
  | "user.role_updated"
  | "user.login"
  | "user.google_linked"
  | "role.created"
  | "user.roles_updated"
  | "project.created"
  | "project.updated"
  | "project.deleted"
  | "session_share.created"
  | "session_share.revoked"
  | "connector.entitlement_upserted"
  | "connector.grant_upserted"
  | "connector.person_grant_set"
  | "connector.member_subset_set"
  | "connector.connection_upserted"
  | "connector.disconnected"
  | "connector.secrets_written"
  | "connector.canonical_upserted"
  | "connector.canonical_archived"
  | "tenant.provider_secret_upserted"
  | "tenant.provider_secret_deleted"
  | "tenant.class_c_secret_upserted"
  | "tenant.class_c_secret_deleted"
  | "instance.user_sandbox_provisioned"
  | "connector.injected";

export const AUDIT_RESULTS = ["success", "failure", "denied", "partial"] as const;
export type AuditResult = (typeof AUDIT_RESULTS)[number];

export type AuditEntry = {
  audit_id: string;
  tenant_id: string | null;
  action: AuditAction;
  actor: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  /** Optional gateway instance this mutation touched. */
  instance_id: string | null;
  /** Outcome of the control-plane mutation. */
  result: AuditResult;
  /** Correlation id (BFF/relay request) — never a vault body. */
  request_id: string | null;
};

export type ProvisionedInstance = {
  instance_id: string;
  tenant_id: string;
  secret: string;
  relay_tier: RelayTier;
  relay_wss_url: string;
  /**
   * Compute path set at register (lp-6jx). Default product path remains `ec2`
   * until operators pass `runtime_kind=daytona`.
   */
  runtime_kind: RuntimeKind;
  /** Always null at provision for daytona (lazy sandbox). */
  sandbox_id: string | null;
  /** offline at provision; wake sets online later. */
  presence: InstancePresence;
  /** Durable S3 vault root for daytona; null on pure EC2. */
  s3_vault_prefix: string | null;
  /** Optional pin; null inherits platform default at ensure_online. */
  agent_snapshot_id: string | null;
  /** Always null at register for daytona (§4.11 — no company-brain EC2). */
  ec2_instance_id: string | null;
  /** Default tenant. User-principal connectors provision `user`. */
  scope?: InstanceScope;
  owner_user_id?: string | null;
  /**
   * lp-zoh.2 / plan 0010: true iff scope=tenant (newest registered primary);
   * always false for scope=user.
   */
  is_primary?: boolean;
  /** lp-zoh.2 / plan 0010: `tenants/{tenant_id}/vault/shared/`. */
  s3_shared_vault_prefix?: string | null;
  /**
   * lp-zoh.2 / plan 0010: `tenants/{tid}/users/{uid}/vault/` for scope=user;
   * null for tenant scope.
   */
  s3_personal_vault_prefix?: string | null;
};

/**
 * lp-zoh.3 / plan 0010: idempotent ensure result for provision APIs.
 *
 * Returned by ControlPlaneStore.ensureTenantPrimaryInstance and
 * ensureUserSandboxInstance. Never carries secret material; instances come
 * back presence=offline with sandbox_id=null (no Daytona create at provision
 * — wake is ensure_online).
 */
export type EnsuredInstance = {
  instance_id: string;
  tenant_id: string;
  runtime_kind: RuntimeKind;
  /** Optional pin; null inherits platform default at wake. */
  agent_snapshot_id: string | null;
  /** Durable legacy S3 vault root; may be null on pure EC2 rows. */
  s3_vault_prefix: string | null;
  /** lp-zoh.2 / plan 0010: `tenants/{tenant_id}/vault/shared/`. */
  s3_shared_vault_prefix: string | null;
  /**
   * lp-zoh.2 / plan 0010: `tenants/{tid}/users/{uid}/vault/` for scope=user;
   * null for tenant scope.
   */
  s3_personal_vault_prefix: string | null;
  /** True iff this row is the active tenant primary (scope=tenant only). */
  is_primary: boolean;
  /** Always offline at ensure — wake is ensure_online (lazy). */
  presence: InstancePresence;
  /** Always null at ensure — no Daytona create at provision. */
  sandbox_id: string | null;
  scope: InstanceScope;
  owner_user_id: string | null;
  /** True when this call inserted the row; false when an active row existed. */
  created: boolean;
};

/** Ensure result for a scope=user instance (owner always set). */
export type EnsuredUserInstance = EnsuredInstance & {
  scope: "user";
  owner_user_id: string;
};

/** Result of rotating an instance secret (plaintext secret shown once). */
export type RotatedInstance = {
  instance_id: string;
  tenant_id: string;
  secret: string;
  /** ISO timestamp until which the previous secret still validates; null if immediate. */
  previous_secret_accepted_until: string | null;
  grace_period_seconds: number;
  relay_tier: RelayTier;
  relay_wss_url: string;
};

/** Default dual-accept window after rotate (15 minutes). */
export const DEFAULT_ROTATION_GRACE_PERIOD_SECONDS = 15 * 60;

/** Upper bound for operator-requested grace (1 hour). */
export const MAX_ROTATION_GRACE_PERIOD_SECONDS = 60 * 60;

export type ValidateInstanceSecretResult =
  | {
      valid: true;
      tenant_id: string;
      instance_id: string;
      revoked: false;
    }
  | {
      valid: false;
      reason: "not_found" | "invalid_secret" | "revoked";
      tenant_id?: string;
      instance_id: string;
    };

export const TENANT_HOST_SUFFIX = "withlanyard.com";
export const APP_HOST = "app.withlanyard.com";

/** Host header identity: `{slug}.withlanyard.com` (BFF Host routing). */
export function tenantHost(slug: string): string {
  return `${slug}.${TENANT_HOST_SUFFIX}`;
}

/** Canonical product entry URL (path-based MVP). */
export function tenantPortalUrl(slug: string): string {
  return `https://${APP_HOST}/${slug}`;
}

/** Same as tenantHost. */
export function tenantSubdomainHost(slug: string): string {
  return tenantHost(slug);
}