export type AuthUser = {
  user_id: string;
  tenant_id: string;
  email: string;
};

export type RegisteredUser = AuthUser & {
  has_password: boolean;
  has_google: boolean;
  created_at: string;
};

export type UserRbac = {
  user_id: string;
  tenant_id: string;
  hermes_profile: string;
  allowed_path_prefixes: string[];
  role_names: string[];
};

export type TenantRole = {
  role_id: string;
  tenant_id: string;
  name: string;
  hermes_profile: string;
  path_prefixes: string[];
  created_at: string;
};

export type Project = {
  project_id: string;
  tenant_id: string;
  parent_project_id: string | null;
  name: string;
  vault_path: string;
  created_at: string;
  updated_at: string;
};

export type SessionShareMode = "read" | "collaborate";

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

/** Closed v1 connector ids (portal-connectors.md). */
export const CONNECTOR_IDS = ["google", "hubspot", "whatsapp", "github"] as const;
export type ConnectorId = (typeof CONNECTOR_IDS)[number];

export const CONNECTION_STATUSES = [
  "not_connected",
  "pairing",
  "connected",
  "needs_reauth",
] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export type ConnectorSticky = Partial<Record<string, true>>;

export type TenantConnectorEntitlement = {
  tenant_id: string;
  connector_id: string;
  enabled: boolean;
  hubspot_portal_id: string | null;
  surfaces?: string[];
  created_at?: string;
  updated_at?: string;
};

export type ConnectorStatusCounts = {
  connected: number;
  pairing: number;
  needs_reauth: number;
};

export type ConnectorCatalogEntry = {
  connector_id: ConnectorId;
  enabled: boolean;
  status_counts: ConnectorStatusCounts;
};

export type ConnectorCatalogTenant = {
  tenant_id: string;
  tenant_slug: string;
  display_name: string;
  connectors: ConnectorCatalogEntry[];
};

export type ConnectorCatalogTotals = Record<
  ConnectorId,
  ConnectorStatusCounts & { entitled_tenants: number }
>;

export type ConnectorCatalog = {
  tenants: ConnectorCatalogTenant[];
  totals: ConnectorCatalogTotals;
};

export type RoleConnectorGrant = {
  tenant_id: string;
  role_id: string;
  connector_id: ConnectorId;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
};

/** Class B ops secret statuses (lp-2qs.4). Shape mirrors CP + shared types. */
export type ProviderSecretStatus = {
  tenant_id: string;
  slot: { kind: "env_key"; env_name: string } | { kind: "oauth_slot"; provider_id: string };
  present: boolean;
  fingerprint: string | null;
  rotated_at: string | null;
};

/** Class C tenant-principal registry secret statuses. Value is never on this object. */
export type ClassCSurfaceId = "mcp" | "api" | "cli";

export type ClassCSecretStatus = {
  tenant_id: string;
  connector_id: string;
  surface_id: ClassCSurfaceId;
  present: boolean;
  fingerprint: string | null;
  rotated_at: string | null;
};

export type ClassCSecretList = {
  tenant_id: string;
  connector_id: string;
  surfaces: ClassCSecretStatus[];
};

/** Public connection DTO from CP. Ciphertext is never on this object. */
export type ConnectorConnectionPublic = {
  tenant_id: string;
  user_id: string;
  connector_id: ConnectorId;
  status: ConnectionStatus;
  account_label: string | null;
  hubspot_portal_id: string | null;
  sticky: ConnectorSticky;
  created_at: string;
  updated_at: string;
};

export type ConnectorSecrets = {
  oauth_access: string | null;
  oauth_refresh: string | null;
  oauth_expiry: string | null;
  oauth_scopes: string[];
  whatsapp_session_db: string | null;
};

export type ConnectorAccess = {
  tenant_id: string;
  user_id: string;
  connector_id: ConnectorId;
  entitled: boolean;
  role_granted: boolean;
  connection: ConnectorConnectionPublic | null;
};

/** Portal list row: onboarded ∧ person-granted. Live ids are canonical slugs. */
export type GrantedConnectorAccess = {
  tenant_id: string;
  user_id: string;
  connector_id: string;
  label: string;
  entitled: boolean;
  role_granted: boolean;
  connection: ConnectorConnectionPublic | null;
};

export const CONNECTOR_API_PATHS = {
  catalog: "/internal/connector-catalog",
  entitlements: (tenantId: string) =>
    `/internal/tenants/${tenantId}/connector-entitlements`,
  entitlement: (tenantId: string, connectorId: string) =>
    `/internal/tenants/${tenantId}/connector-entitlements/${connectorId}`,
  roleGrants: (tenantId: string, roleId: string) =>
    `/internal/tenants/${tenantId}/roles/${roleId}/connector-grants`,
  roleGrant: (tenantId: string, roleId: string, connectorId: ConnectorId) =>
    `/internal/tenants/${tenantId}/roles/${roleId}/connector-grants/${connectorId}`,
  connections: (tenantId: string, userId: string) =>
    `/internal/tenants/${tenantId}/users/${userId}/connectors`,
  connection: (tenantId: string, userId: string, connectorId: ConnectorId) =>
    `/internal/tenants/${tenantId}/users/${userId}/connectors/${connectorId}`,
  connectionSecrets: (
    tenantId: string,
    userId: string,
    connectorId: ConnectorId,
  ) =>
    `/internal/tenants/${tenantId}/users/${userId}/connectors/${connectorId}/secrets`,
  connectionAccess: (
    tenantId: string,
    userId: string,
    connectorId: ConnectorId,
  ) =>
    `/internal/tenants/${tenantId}/users/${userId}/connectors/${connectorId}/access`,
  grantedConnectors: (tenantId: string, userId: string) =>
    `/internal/tenants/${tenantId}/users/${userId}/granted-connectors`,
  connectionInject: (
    tenantId: string,
    userId: string,
    connectorId: ConnectorId,
  ) =>
    `/internal/tenants/${tenantId}/users/${userId}/connectors/${connectorId}/inject`,
  connectionOAuthComplete: (
    tenantId: string,
    userId: string,
    connectorId: ConnectorId,
  ) =>
    `/internal/tenants/${tenantId}/users/${userId}/connectors/${connectorId}/oauth/complete`,
  connectionRefresh: (
    tenantId: string,
    userId: string,
    connectorId: ConnectorId,
  ) =>
    `/internal/tenants/${tenantId}/users/${userId}/connectors/${connectorId}/refresh`,
  providerSecrets: (tenantId: string) =>
    `/internal/tenants/${tenantId}/provider-secrets`,
  providerSecret: (tenantId: string, slotId: string) =>
    `/internal/tenants/${tenantId}/provider-secrets/${slotId}`,
  classCSecrets: (tenantId: string, connectorId: string) =>
    `/internal/tenants/${tenantId}/connectors/${connectorId}/class-c-secrets`,
  classCSecret: (tenantId: string, connectorId: string, surfaceId: string) =>
    `/internal/tenants/${tenantId}/connectors/${connectorId}/class-c-secrets/${surfaceId}`,
  canonicalConnectors: "/internal/canonical-connectors",
  canonicalConnector: (id: string) => `/internal/canonical-connectors/${id}`,
} as const;

export type CanonicalConnector = {
  id: string;
  domain: string | null;
  label: string;
  archived: boolean;
  seeded: boolean;
  source: string;
  source_entry_id: string | null;
  snapshot: Record<string, unknown>;
  onboarded_tenant_count: number;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Instance Orchestrator API stubs (lp-biq) — shapes mirror CP contract:
// docs/plans/0008-daytona-agent-sandboxes/cp-internal-orchestrator-api.md
// Paths must stay in sync with ORCHESTRATOR_API_PATHS in control-plane.
// ---------------------------------------------------------------------------

export type InstancePresenceState =
  | "offline"
  | "waking"
  | "online"
  | "error";

export type RuntimeKind = "ec2" | "daytona";

/** Cold-create env profile (lp-oop.28). Default guest_gateway on CP. */
export type SandboxCreateProfile = "guest_gateway" | "tool_only";

export type EnsureOnlineRequest = {
  wait_timeout_ms?: number;
  sandbox_create_profile?: SandboxCreateProfile;
};

/** Wake strategy on ensure_online (plan 0019 D4 / lp-k5c4.5). */
export type EnsureOnlineWakePath =
  | "cold_create"
  | "cold_create_env_expired"
  | "start_from_stopped"
  | "archive_restore"
  | "warm_pool"
  | "already_online"
  | "joined"
  | "ec2_short_circuit"
  | "unknown";

export type EnsureOnlineResponse = {
  instance_id: string;
  tenant_id: string;
  presence: InstancePresenceState;
  sandbox_id: string | null;
  runtime_kind: RuntimeKind;
  already_online: boolean;
  wake_joined: boolean;
  /**
   * How compute was obtained. Spine toolbox enqueue observes `warm_pool`
   * on unbound first bind and `start_from_stopped` when sandbox_id is bound.
   */
  path?: EnsureOnlineWakePath;
};

/** Who the CP user resolver picked (lp-oop.18 / lp-oop.19). */
export type ResolveInstanceSource = "user" | "tenant_primary";

/** POST ensure-online-by-user payload — wake plus resolver metadata. */
export type EnsureOnlineByUserResponse = EnsureOnlineResponse & {
  user_id: string;
  source: ResolveInstanceSource;
};

export type InstancePresenceResponse = {
  instance_id: string;
  tenant_id: string;
  presence: InstancePresenceState;
  sandbox_id: string | null;
  runtime_kind: RuntimeKind;
  agent_snapshot_id: string | null;
  s3_vault_prefix: string | null;
  last_activity_at: string | null;
  revoked_at: string | null;
};

export type SignalActivityRequest = {
  at?: string;
  /** Arm/clear mid-turn lock (lp-053); omit to leave lock unchanged. */
  mid_turn?: boolean;
  /** Toolbox enqueue: clear stop_after (lp-k5c4.4). */
  spine_work_arrived?: boolean;
  /** Toolbox room drained: arm stop_after = at + 45s (lp-k5c4.4). */
  spine_lease_empty?: boolean;
};

export type SignalActivityResponse = {
  instance_id: string;
  tenant_id: string;
  presence: InstancePresenceState;
  last_activity_at: string;
  mid_turn?: boolean;
  mid_turn_until?: string | null;
  stop_after?: string | null;
};

export type StopInstanceRequest = {
  reason?: "explicit_stop" | "idle_stop";
};

export type StopInstanceResponse = {
  instance_id: string;
  tenant_id: string;
  presence: InstancePresenceState;
  sandbox_id: string | null;
  stopped: boolean;
};

/** Concrete path builders (must match CP ORCHESTRATOR_API_PATHS). */
export const ORCHESTRATOR_API_PATHS = {
  ensureOnline: (instanceId: string) =>
    `/internal/instances/${instanceId}/ensure-online`,
  presence: (instanceId: string) =>
    `/internal/instances/${instanceId}/presence`,
  signalActivity: (instanceId: string) =>
    `/internal/instances/${instanceId}/signal-activity`,
  stop: (instanceId: string) => `/internal/instances/${instanceId}/stop`,
  /** lp-oop.19 — resolve tenant+user then wake the chosen instance. */
  ensureOnlineByUser: (tenantId: string, userId: string) =>
    `/internal/tenants/${tenantId}/users/${userId}/ensure-online`,
} as const;

/** Safe same-tenant directory entry for share picker (no secrets). */
export type TenantMember = {
  user_id: string;
  email: string;
};

export const OPS_TENANT_USER_ROLES = ["tenant_admin", "member"] as const;
export type OpsTenantUserRole = (typeof OPS_TENANT_USER_ROLES)[number];

export type OpsTenantUser = {
  user_id: string;
  display_name: string;
  email: string;
  role: OpsTenantUserRole;
  connectors: string[];
  last_active_at: string | null;
};

export type OpsConnectorUser = {
  user_id: string;
  display_name: string;
  email: string;
  role_label: string;
  granted: boolean;
};

export type PersonConnectorGrant = {
  tenant_id: string;
  user_id: string;
  connector_id: string;
  granted: boolean;
};

export const MEMBER_SUBSET_GROUPS = ["read", "write"] as const;
export type MemberSubsetGroup = (typeof MEMBER_SUBSET_GROUPS)[number];

export const MEMBER_SUBSET_KINDS = ["allowlist", "grant_only"] as const;
export type MemberSubsetKind = (typeof MEMBER_SUBSET_KINDS)[number];

export type MemberSubsetTool = {
  name: string;
  group: MemberSubsetGroup;
};

export type ConnectorMemberSubset = {
  tenant_id: string;
  connector_id: string;
  kind: MemberSubsetKind;
  tools: MemberSubsetTool[];
  allowed_tools: string[];
};

/**
 * Tenant retention snapshot from `GET /internal/tenants/:id/retention`.
 * L5 (interaction export) + L10 (chat corpus) flags — metadata only.
 */
export type TenantRetentionSnapshot = {
  tenant_id: string;
  interaction_export_enabled: boolean;
  retention_mode: string;
  chat_corpus_enabled: boolean;
  chat_corpus_retention_days: number | null;
};

/**
 * Public gateway instance row from CP `GET /tenants/:id/gateway-instances`.
 * Mirrors CP GatewayInstancePublic — no secret hashes or salt.
 */
export type GatewayInstancePublic = {
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
  runtime_kind: string;
  sandbox_id: string | null;
  presence: InstancePresenceState;
  agent_snapshot_id: string | null;
  s3_vault_prefix: string | null;
  last_activity_at: string | null;
  chat_delivery: string | null;
};

/** Audit outcome enum mirrored from CP AUDIT_RESULTS. */
export type AuditResult = "success" | "failure" | "denied" | "partial";

/** Durable audit row from CP `GET /tenants/:id/audit`. Metadata only. */
export type AuditEntry = {
  audit_id: string;
  tenant_id: string | null;
  action: string;
  actor: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  instance_id: string | null;
  result: AuditResult;
  request_id: string | null;
};

export const CONTROL_PLANE_SERVICE_TOKEN_HEADER =
  "x-control-plane-service-token";

export type ControlPlaneRequestFn = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export class ControlPlaneRequestError extends Error {
  readonly status: number;
  /**
   * Optional CP wire `code` (e.g. `ENSURE_ONLINE_TIMEOUT`, `ENSURE_ONLINE_WAKE_FAILED`).
   * Used by wake failure mapping (lp-mrh) for user-visible errors + retries.
   */
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ControlPlaneRequestError";
    this.status = status;
    if (code) {
      this.code = code;
    }
  }
}

/** Optional G1a tenant/actor headers for CP defense-in-depth. */
export type ControlPlaneTenantContext = {
  tenantId?: string;
  userId?: string;
  /** admin | contributor | member — omit for trusted service ops */
  portalRole?: string;
};

export type ControlPlaneAuthClientOptions = {
  /**
   * Service credential (`CONTROL_PLANE_SERVICE_TOKEN`). Sent as
   * `x-control-plane-service-token` on every CP request (G1.2).
   */
  serviceToken?: string;
  /**
   * Optional ops token. Sent as `x-internal-ops-token` when set.
   * Prefer the service token for normal BFF traffic.
   */
  internalToken?: string;
};

export class ControlPlaneAuthClient {
  private readonly serviceToken?: string;
  private readonly internalToken?: string;

  constructor(
    private readonly baseUrl: string,
    private readonly requestFn: ControlPlaneRequestFn = fetch,
    /**
     * Service token string, or options bag with serviceToken / internalToken.
     * Positional string is treated as the G1.2 service token.
     */
    serviceTokenOrOptions?: string | ControlPlaneAuthClientOptions,
  ) {
    if (typeof serviceTokenOrOptions === "string") {
      this.serviceToken = serviceTokenOrOptions;
    } else if (serviceTokenOrOptions) {
      this.serviceToken = serviceTokenOrOptions.serviceToken;
      this.internalToken = serviceTokenOrOptions.internalToken;
    }
  }

  private async request(
    path: string,
    init?: RequestInit,
    tenantContext?: ControlPlaneTenantContext,
  ): Promise<Response> {
    const headers = new Headers(init?.headers);
    if (this.serviceToken) {
      headers.set(CONTROL_PLANE_SERVICE_TOKEN_HEADER, this.serviceToken);
    }
    if (this.internalToken) {
      headers.set("x-internal-ops-token", this.internalToken);
    }
    // G1a.1: always stamp tenant_id when known so CP can reject cross-tenant probes.
    if (tenantContext?.tenantId) {
      headers.set("x-lanyard-tenant-id", tenantContext.tenantId);
    }
    if (tenantContext?.userId) {
      headers.set("x-lanyard-user-id", tenantContext.userId);
    }
    if (tenantContext?.portalRole) {
      headers.set("x-lanyard-portal-role", tenantContext.portalRole);
    }
    return this.requestFn(`${this.baseUrl}${path}`, {
      ...init,
      headers,
    });
  }

  async registerUser(input: {
    tenantId: string;
    email: string;
    password: string;
  }): Promise<RegisteredUser> {
    const response = await this.request(
      `/tenants/${input.tenantId}/users/register`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: input.email,
          password: input.password,
        }),
      },
      { tenantId: input.tenantId },
    );

    const body = (await response.json()) as RegisteredUser & { error?: string };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Registration failed",
      );
    }
    return body;
  }

  async login(input: {
    tenantId: string;
    email: string;
    password: string;
  }): Promise<AuthUser> {
    const response = await this.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: input.tenantId,
        email: input.email,
        password: input.password,
      }),
    });

    const body = (await response.json()) as AuthUser & { error?: string };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Login failed",
      );
    }
    return body;
  }

  async getUserByEmail(
    tenantId: string,
    email: string,
  ): Promise<TenantMember | null> {
    const normalized = email.trim().toLowerCase();
    const members = await this.listTenantMembers(tenantId, { q: normalized });
    return members.find((member) => member.email === normalized) ?? null;
  }

  async listOpsTenantUsers(tenantId: string): Promise<OpsTenantUser[]> {
    const response = await this.request(`/tenants/${tenantId}/users`, undefined, {
      tenantId,
    });
    const body = (await response.json()) as {
      users?: OpsTenantUser[];
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to list tenant users",
      );
    }
    return body.users ?? [];
  }

  async provisionOpsTenantUser(input: {
    tenantId: string;
    displayName: string;
    email: string;
    role: OpsTenantUserRole;
    actor?: string | null;
  }): Promise<OpsTenantUser> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (input.actor) {
      headers["x-lanyard-actor"] = input.actor;
    }
    const response = await this.request(
      `/tenants/${input.tenantId}/users`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          display_name: input.displayName,
          email: input.email,
          role: input.role,
        }),
      },
      { tenantId: input.tenantId },
    );
    const body = (await response.json()) as OpsTenantUser & { error?: string };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to add user",
      );
    }
    return body;
  }

  async updateOpsTenantUser(input: {
    tenantId: string;
    userId: string;
    displayName?: string;
    role?: OpsTenantUserRole;
    actor?: string | null;
  }): Promise<OpsTenantUser> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (input.actor) {
      headers["x-lanyard-actor"] = input.actor;
    }
    const response = await this.request(
      `/tenants/${input.tenantId}/users/${input.userId}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          display_name: input.displayName,
          role: input.role,
        }),
      },
      { tenantId: input.tenantId },
    );
    const body = (await response.json()) as OpsTenantUser & { error?: string };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to update user",
      );
    }
    return body;
  }

  async deleteOpsTenantUser(input: {
    tenantId: string;
    userId: string;
    actor?: string | null;
  }): Promise<void> {
    const headers: Record<string, string> = {};
    if (input.actor) {
      headers["x-lanyard-actor"] = input.actor;
    }
    const response = await this.request(
      `/tenants/${input.tenantId}/users/${input.userId}`,
      { method: "DELETE", headers },
      { tenantId: input.tenantId },
    );
    const body = (await response.json()) as { error?: string };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to remove user",
      );
    }
  }

  async listOpsConnectorUsers(
    tenantId: string,
    connectorId: string,
  ): Promise<OpsConnectorUser[]> {
    const response = await this.request(
      `/tenants/${tenantId}/connectors/${encodeURIComponent(connectorId)}/users`,
      undefined,
      { tenantId },
    );
    const body = (await response.json()) as {
      users?: OpsConnectorUser[];
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to list connector users",
      );
    }
    return body.users ?? [];
  }

  async setPersonConnectorGrant(input: {
    tenantId: string;
    connectorId: string;
    userId: string;
    granted: boolean;
    actor?: string | null;
  }): Promise<PersonConnectorGrant> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (input.actor) {
      headers["x-lanyard-actor"] = input.actor;
    }
    const response = await this.request(
      `/tenants/${input.tenantId}/connectors/${encodeURIComponent(input.connectorId)}/users/${input.userId}`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({ granted: input.granted }),
      },
      { tenantId: input.tenantId },
    );
    const body = (await response.json()) as PersonConnectorGrant & {
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to set person grant",
      );
    }
    return body;
  }

  async getConnectorMemberSubset(
    tenantId: string,
    connectorId: string,
  ): Promise<ConnectorMemberSubset> {
    const response = await this.request(
      `/tenants/${tenantId}/connectors/${encodeURIComponent(connectorId)}/member-subset`,
      undefined,
      { tenantId },
    );
    const body = (await response.json()) as ConnectorMemberSubset & {
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to load member subset",
      );
    }
    return body;
  }

  async setConnectorMemberSubset(input: {
    tenantId: string;
    connectorId: string;
    allowedTools: string[];
    actor?: string | null;
  }): Promise<ConnectorMemberSubset> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (input.actor) {
      headers["x-lanyard-actor"] = input.actor;
    }
    const response = await this.request(
      `/tenants/${input.tenantId}/connectors/${encodeURIComponent(input.connectorId)}/member-subset`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({ allowed_tools: input.allowedTools }),
      },
      { tenantId: input.tenantId },
    );
    const body = (await response.json()) as ConnectorMemberSubset & {
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to set member subset",
      );
    }
    return body;
  }

  async listRoles(tenantId: string): Promise<{ roles: TenantRole[] }> {
    const response = await this.request(
      `/tenants/${tenantId}/roles`,
      undefined,
      { tenantId },
    );

    const body = (await response.json()) as {
      roles?: TenantRole[];
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to list roles",
      );
    }
    return { roles: body.roles ?? [] };
  }

  async assignUserRoles(input: {
    tenantId: string;
    userId: string;
    roleIds: string[];
  }): Promise<UserRbac> {
    // Trusted service path: stamp tenant only (no portal-role) so local demo
    // seed / BFF bootstrap can assign roles without impersonating admin.
    const response = await this.request(
      `/tenants/${input.tenantId}/users/${input.userId}/roles`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role_ids: input.roleIds }),
      },
      { tenantId: input.tenantId, userId: input.userId },
    );

    const body = (await response.json()) as UserRbac & { error?: string };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to assign user roles",
      );
    }
    return body;
  }

  async getUserRbac(
    tenantId: string,
    userId: string,
  ): Promise<UserRbac | null> {
    const response = await this.request(
      `/internal/tenants/${tenantId}/users/${userId}/rbac`,
      undefined,
      { tenantId, userId },
    );

    const body = (await response.json()) as {
      rbac?: UserRbac | null;
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to load user RBAC",
      );
    }
    return body.rbac ?? null;
  }

  async getPrimaryGatewayInstance(tenantId: string): Promise<{ instance_id: string }> {
    const response = await this.request(
      `/internal/tenants/${tenantId}/primary-instance`,
      undefined,
      { tenantId },
    );

    const body = (await response.json()) as {
      instance_id?: string;
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "No gateway instance available",
      );
    }
    if (!body.instance_id) {
      throw new ControlPlaneRequestError(502, "Missing instance_id in response");
    }
    return { instance_id: body.instance_id };
  }

  /**
   * L5 + L10 retention gates for a tenant (lp-gkh.6).
   * Requires internal ops token on the BFF client (retention route is ops-gated).
   * Metadata only — never message bodies.
   */
  async getTenantRetention(tenantId: string): Promise<TenantRetentionSnapshot> {
    const response = await this.request(
      `/internal/tenants/${tenantId}/retention`,
      undefined,
      { tenantId },
    );

    const body = (await response.json()) as TenantRetentionSnapshot & {
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to load tenant retention",
      );
    }
    return {
      tenant_id: body.tenant_id ?? tenantId,
      interaction_export_enabled: body.interaction_export_enabled === true,
      retention_mode: body.retention_mode ?? "none",
      chat_corpus_enabled: body.chat_corpus_enabled === true,
      chat_corpus_retention_days:
        body.chat_corpus_retention_days === undefined ||
        body.chat_corpus_retention_days === null
          ? null
          : Number(body.chat_corpus_retention_days),
    };
  }

  /**
   * Active gateway instances for a tenant (CP `GET /tenants/:id/gateway-instances`).
   * Public rows only — CP never returns secret hashes on this shape.
   */
  async listGatewayInstances(tenantId: string): Promise<GatewayInstancePublic[]> {
    const response = await this.request(
      `/tenants/${tenantId}/gateway-instances`,
      undefined,
      { tenantId },
    );
    const body = (await response.json()) as {
      instances?: GatewayInstancePublic[];
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to list gateway instances",
      );
    }
    return body.instances ?? [];
  }

  /** Durable audit entries for a tenant (CP `GET /tenants/:id/audit`). */
  async listAuditEntries(tenantId: string): Promise<AuditEntry[]> {
    const response = await this.request(`/tenants/${tenantId}/audit`, undefined, {
      tenantId,
    });
    const body = (await response.json()) as {
      entries?: AuditEntry[];
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to list audit entries",
      );
    }
    return body.entries ?? [];
  }

  async listProjects(
    tenantId: string,
    userId: string,
  ): Promise<Project[]> {
    const response = await this.request(
      `/internal/tenants/${tenantId}/users/${userId}/projects`,
      undefined,
      { tenantId, userId },
    );

    const body = (await response.json()) as {
      projects?: Project[];
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to list projects",
      );
    }
    return body.projects ?? [];
  }

  async getProject(
    tenantId: string,
    userId: string,
    projectId: string,
  ): Promise<Project | null> {
    const response = await this.request(
      `/internal/tenants/${tenantId}/users/${userId}/projects/${projectId}`,
      undefined,
      { tenantId, userId },
    );

    const body = (await response.json()) as Project & { error?: string };
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to load project",
      );
    }
    return body;
  }

  async createProject(input: {
    tenantId: string;
    userId: string;
    name: string;
    vault_path: string;
    parent_project_id?: string | null;
  }): Promise<Project> {
    const response = await this.request(
      `/internal/tenants/${input.tenantId}/users/${input.userId}/projects`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: input.name,
          vault_path: input.vault_path,
          parent_project_id: input.parent_project_id ?? null,
        }),
      },
      { tenantId: input.tenantId, userId: input.userId },
    );

    const body = (await response.json()) as Project & { error?: string };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to create project",
      );
    }
    return body;
  }

  async updateProject(input: {
    tenantId: string;
    userId: string;
    projectId: string;
    name?: string;
    vault_path?: string;
  }): Promise<Project> {
    const response = await this.request(
      `/internal/tenants/${input.tenantId}/users/${input.userId}/projects/${input.projectId}`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: input.name,
          vault_path: input.vault_path,
        }),
      },
      { tenantId: input.tenantId, userId: input.userId },
    );

    const body = (await response.json()) as Project & { error?: string };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to update project",
      );
    }
    return body;
  }

  async deleteProject(
    tenantId: string,
    userId: string,
    projectId: string,
  ): Promise<void> {
    const response = await this.request(
      `/internal/tenants/${tenantId}/users/${userId}/projects/${projectId}`,
      { method: "DELETE" },
      { tenantId, userId },
    );

    const body = (await response.json()) as { error?: string };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to delete project",
      );
    }
  }

  /**
   * List same-tenant members for the share picker directory.
   * Returns safe fields only; optional `q` filters by email substring.
   */
  async listTenantMembers(
    tenantId: string,
    options: { q?: string } = {},
  ): Promise<TenantMember[]> {
    const params = new URLSearchParams();
    if (options.q?.trim()) {
      params.set("q", options.q.trim());
    }
    const query = params.toString();
    const path = `/internal/tenants/${tenantId}/users${query ? `?${query}` : ""}`;

    const response = await this.request(path, undefined, { tenantId });

    const body = (await response.json()) as {
      members?: TenantMember[];
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to list tenant members",
      );
    }
    return body.members ?? [];
  }

  async createSessionShare(input: {
    tenantId: string;
    ownerUserId: string;
    threadId: string;
    granteeEmail: string;
    mode: SessionShareMode;
  }): Promise<SessionShareGrant> {
    const response = await this.request(
      `/internal/tenants/${input.tenantId}/users/${input.ownerUserId}/session-shares`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          thread_id: input.threadId,
          grantee_email: input.granteeEmail,
          mode: input.mode,
        }),
      },
      { tenantId: input.tenantId, userId: input.ownerUserId },
    );

    const body = (await response.json()) as SessionShareGrant & { error?: string };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to create session share",
      );
    }
    return body;
  }

  async listSessionSharesForGrantee(
    tenantId: string,
    userId: string,
  ): Promise<SessionShareGrant[]> {
    const response = await this.request(
      `/internal/tenants/${tenantId}/users/${userId}/session-shares`,
      undefined,
      { tenantId, userId },
    );

    const body = (await response.json()) as {
      grants?: SessionShareGrant[];
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to list session shares",
      );
    }
    return body.grants ?? [];
  }

  async listSessionSharesForThread(
    tenantId: string,
    ownerUserId: string,
    threadId: string,
  ): Promise<SessionShareGrant[]> {
    const response = await this.request(
      `/internal/tenants/${tenantId}/users/${ownerUserId}/threads/${threadId}/session-shares`,
      undefined,
      { tenantId, userId: ownerUserId },
    );

    const body = (await response.json()) as {
      grants?: SessionShareGrant[];
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to list thread session shares",
      );
    }
    return body.grants ?? [];
  }

  async getActiveSessionShare(
    tenantId: string,
    userId: string,
    threadId: string,
  ): Promise<SessionShareGrant | null> {
    const response = await this.request(
      `/internal/tenants/${tenantId}/users/${userId}/threads/${threadId}/session-shares/active`,
      undefined,
      { tenantId, userId },
    );

    const body = (await response.json()) as {
      grant?: SessionShareGrant | null;
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to load session share grant",
      );
    }
    return body.grant ?? null;
  }

  async revokeSessionShare(input: {
    tenantId: string;
    ownerUserId: string;
    threadId: string;
    granteeUserId: string;
  }): Promise<SessionShareGrant> {
    const response = await this.request(
      `/internal/tenants/${input.tenantId}/users/${input.ownerUserId}/threads/${input.threadId}/session-shares/${input.granteeUserId}`,
      { method: "DELETE" },
      { tenantId: input.tenantId, userId: input.ownerUserId },
    );

    const body = (await response.json()) as SessionShareGrant & { error?: string };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to revoke session share",
      );
    }
    return body;
  }

  async listCanonicalConnectors(options: {
    includeArchived?: boolean;
  } = {}): Promise<CanonicalConnector[]> {
    const query = options.includeArchived ? "?include_archived=1" : "";
    const response = await this.request(
      `${CONNECTOR_API_PATHS.canonicalConnectors}${query}`,
    );
    const body = (await response.json()) as {
      connectors?: CanonicalConnector[];
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to list canonical connectors",
      );
    }
    return body.connectors ?? [];
  }

  async getCanonicalConnector(id: string): Promise<CanonicalConnector> {
    const response = await this.request(
      CONNECTOR_API_PATHS.canonicalConnector(id),
    );
    const body = (await response.json()) as CanonicalConnector & {
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to load canonical connector",
      );
    }
    return body;
  }

  async insertCanonicalConnector(input: {
    id: string;
    domain?: string | null;
    label: string;
    source: "integrations.sh" | "custom";
    source_entry_id?: string | null;
    snapshot: unknown;
    actor?: string | null;
  }): Promise<CanonicalConnector> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (input.actor) {
      headers["x-lanyard-actor"] = input.actor;
    }
    const response = await this.request(CONNECTOR_API_PATHS.canonicalConnectors, {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: input.id,
        domain: input.domain,
        label: input.label,
        source: input.source,
        source_entry_id: input.source_entry_id,
        snapshot: input.snapshot,
      }),
    });
    const body = (await response.json()) as CanonicalConnector & {
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to insert canonical connector",
      );
    }
    return body;
  }

  async archiveCanonicalConnector(input: {
    id: string;
    actor?: string | null;
  }): Promise<CanonicalConnector> {
    const headers: Record<string, string> = {};
    if (input.actor) {
      headers["x-lanyard-actor"] = input.actor;
    }
    const response = await this.request(
      CONNECTOR_API_PATHS.canonicalConnector(input.id),
      { method: "DELETE", headers },
    );
    const body = (await response.json()) as CanonicalConnector & {
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to delete canonical connector",
      );
    }
    return body;
  }

  async listConnectorCatalog(): Promise<ConnectorCatalog> {
    const response = await this.request(CONNECTOR_API_PATHS.catalog);
    const body = (await response.json()) as ConnectorCatalog & {
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to list connector catalog",
      );
    }
    return {
      tenants: body.tenants ?? [],
      totals: body.totals,
    };
  }

  /** lp-2qs.7 — vault-only tenant ids from GET /internal/vault/tenant-prefixes (CP is the only S3 caller). */
  async listVaultTenantPrefixes(): Promise<string[]> {
    const response = await this.request("/internal/vault/tenant-prefixes");
    const body = (await response.json()) as {
      tenant_ids?: string[];
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to list vault tenant prefixes",
      );
    }
    return body.tenant_ids ?? [];
  }

  async listConnectorEntitlements(
    tenantId: string,
  ): Promise<TenantConnectorEntitlement[]> {
    const response = await this.request(
      CONNECTOR_API_PATHS.entitlements(tenantId),
      undefined,
      { tenantId },
    );
    const body = (await response.json()) as {
      entitlements?: TenantConnectorEntitlement[];
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to list connector entitlements",
      );
    }
    return body.entitlements ?? [];
  }

  async upsertConnectorEntitlement(input: {
    tenantId: string;
    connectorId: string;
    enabled?: boolean;
    surfaces?: string[];
    hubspotPortalId?: string | null;
    actor?: string | null;
  }): Promise<TenantConnectorEntitlement> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (input.actor) {
      headers["x-lanyard-actor"] = input.actor;
    }
    const response = await this.request(
      CONNECTOR_API_PATHS.entitlement(input.tenantId, input.connectorId),
      {
        method: "PUT",
        headers,
        body: JSON.stringify({
          enabled: input.enabled,
          surfaces: input.surfaces,
          hubspot_portal_id: input.hubspotPortalId,
        }),
      },
      { tenantId: input.tenantId },
    );
    const body = (await response.json()) as TenantConnectorEntitlement & {
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to upsert connector entitlement",
      );
    }
    return body;
  }

  async listProviderSecrets(tenantId: string): Promise<ProviderSecretStatus[]> {
    const response = await this.request(
      CONNECTOR_API_PATHS.providerSecrets(tenantId),
      undefined,
      { tenantId },
    );
    const body = (await response.json()) as {
      slots?: ProviderSecretStatus[];
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to list provider secrets",
      );
    }
    return body.slots ?? [];
  }

  async putProviderSecret(input: {
    tenantId: string;
    slotId: string;
    value: string;
    actor?: string | null;
  }): Promise<ProviderSecretStatus> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (input.actor) {
      headers["x-lanyard-actor"] = input.actor;
    }
    const response = await this.request(
      CONNECTOR_API_PATHS.providerSecret(input.tenantId, input.slotId),
      {
        method: "PUT",
        headers,
        body: JSON.stringify({ value: input.value }),
      },
      { tenantId: input.tenantId },
    );
    const body = (await response.json()) as ProviderSecretStatus & {
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to store provider secret",
      );
    }
    return body;
  }

  async deleteProviderSecret(input: {
    tenantId: string;
    slotId: string;
    actor?: string | null;
  }): Promise<{ ok: boolean; deleted: boolean }> {
    const headers: Record<string, string> = {};
    if (input.actor) {
      headers["x-lanyard-actor"] = input.actor;
    }
    const response = await this.request(
      CONNECTOR_API_PATHS.providerSecret(input.tenantId, input.slotId),
      { method: "DELETE", headers },
      { tenantId: input.tenantId },
    );
    const body = (await response.json()) as {
      ok?: boolean;
      deleted?: boolean;
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to delete provider secret",
      );
    }
    return { ok: body.ok === true, deleted: body.deleted === true };
  }

  async listClassCSecrets(input: {
    tenantId: string;
    connectorId: string;
  }): Promise<ClassCSecretList> {
    const response = await this.request(
      CONNECTOR_API_PATHS.classCSecrets(input.tenantId, input.connectorId),
      undefined,
      { tenantId: input.tenantId },
    );
    const body = (await response.json()) as ClassCSecretList & {
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to list Class C secrets",
      );
    }
    return {
      tenant_id: body.tenant_id ?? input.tenantId,
      connector_id: body.connector_id ?? input.connectorId,
      surfaces: body.surfaces ?? [],
    };
  }

  async putClassCSecret(input: {
    tenantId: string;
    connectorId: string;
    surfaceId: ClassCSurfaceId;
    value: string;
    authKind?: "bearer" | "api_key";
    actor?: string | null;
  }): Promise<ClassCSecretStatus> {
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (input.actor) {
      headers["x-lanyard-actor"] = input.actor;
    }
    const response = await this.request(
      CONNECTOR_API_PATHS.classCSecret(
        input.tenantId,
        input.connectorId,
        input.surfaceId,
      ),
      {
        method: "PUT",
        headers,
        body: JSON.stringify({
          value: input.value,
          auth_kind: input.authKind,
        }),
      },
      { tenantId: input.tenantId },
    );
    const body = (await response.json()) as ClassCSecretStatus & {
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to store Class C secret",
      );
    }
    return body;
  }

  async deleteClassCSecret(input: {
    tenantId: string;
    connectorId: string;
    surfaceId: ClassCSurfaceId;
    actor?: string | null;
  }): Promise<{ ok: boolean; deleted: boolean }> {
    const headers: Record<string, string> = {};
    if (input.actor) {
      headers["x-lanyard-actor"] = input.actor;
    }
    const response = await this.request(
      CONNECTOR_API_PATHS.classCSecret(
        input.tenantId,
        input.connectorId,
        input.surfaceId,
      ),
      { method: "DELETE", headers },
      { tenantId: input.tenantId },
    );
    const body = (await response.json()) as {
      ok?: boolean;
      deleted?: boolean;
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to delete Class C secret",
      );
    }
    return { ok: body.ok === true, deleted: body.deleted === true };
  }

  async listRoleConnectorGrants(
    tenantId: string,
    roleId: string,
  ): Promise<RoleConnectorGrant[]> {
    const response = await this.request(
      CONNECTOR_API_PATHS.roleGrants(tenantId, roleId),
      undefined,
      { tenantId },
    );
    const body = (await response.json()) as {
      grants?: RoleConnectorGrant[];
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to list role connector grants",
      );
    }
    return body.grants ?? [];
  }

  async upsertRoleConnectorGrant(input: {
    tenantId: string;
    roleId: string;
    connectorId: ConnectorId;
    enabled: boolean;
  }): Promise<RoleConnectorGrant> {
    const response = await this.request(
      CONNECTOR_API_PATHS.roleGrant(input.tenantId, input.roleId, input.connectorId),
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: input.enabled }),
      },
      { tenantId: input.tenantId },
    );
    const body = (await response.json()) as RoleConnectorGrant & { error?: string };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to upsert role connector grant",
      );
    }
    return body;
  }

  async listUserConnectors(
    tenantId: string,
    userId: string,
  ): Promise<ConnectorConnectionPublic[]> {
    const response = await this.request(
      CONNECTOR_API_PATHS.connections(tenantId, userId),
      undefined,
      { tenantId, userId },
    );
    const body = (await response.json()) as {
      connections?: ConnectorConnectionPublic[];
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to list connector connections",
      );
    }
    return body.connections ?? [];
  }

  async upsertUserConnector(input: {
    tenantId: string;
    userId: string;
    connectorId: ConnectorId;
    status?: ConnectionStatus;
    accountLabel?: string | null;
    sticky?: ConnectorSticky;
    secrets?: Partial<ConnectorSecrets>;
  }): Promise<ConnectorConnectionPublic> {
    const response = await this.request(
      CONNECTOR_API_PATHS.connection(input.tenantId, input.userId, input.connectorId),
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: input.status,
          account_label: input.accountLabel,
          sticky: input.sticky,
          secrets: input.secrets,
        }),
      },
      { tenantId: input.tenantId, userId: input.userId },
    );
    const body = (await response.json()) as ConnectorConnectionPublic & {
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to upsert connector connection",
      );
    }
    return body;
  }

  async deleteUserConnector(input: {
    tenantId: string;
    userId: string;
    connectorId: ConnectorId;
  }): Promise<{
    ok: true;
    connector_id: ConnectorId;
    revoke_attempted: boolean;
    cache_dropped: boolean;
  }> {
    const response = await this.request(
      CONNECTOR_API_PATHS.connection(input.tenantId, input.userId, input.connectorId),
      { method: "DELETE" },
      { tenantId: input.tenantId, userId: input.userId },
    );
    const body = (await response.json()) as {
      ok?: boolean;
      connector_id?: ConnectorId;
      revoke_attempted?: boolean;
      cache_dropped?: boolean;
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to disconnect connector",
      );
    }
    return {
      ok: true,
      connector_id: input.connectorId,
      revoke_attempted: body.revoke_attempted === true,
      cache_dropped: body.cache_dropped === true,
    };
  }

  async refreshUserConnector(input: {
    tenantId: string;
    userId: string;
    connectorId: ConnectorId;
  }): Promise<{
    connector_id: ConnectorId;
    status: ConnectionStatus;
    account_label: string | null;
    wizard: boolean;
  }> {
    const response = await this.request(
      CONNECTOR_API_PATHS.connectionRefresh(
        input.tenantId,
        input.userId,
        input.connectorId,
      ),
      { method: "POST" },
      { tenantId: input.tenantId, userId: input.userId },
    );
    const body = (await response.json()) as {
      connector_id?: ConnectorId;
      status?: ConnectionStatus;
      account_label?: string | null;
      wizard?: boolean;
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to refresh connector",
      );
    }
    return {
      connector_id: input.connectorId,
      status: body.status ?? "needs_reauth",
      account_label: body.account_label ?? null,
      wizard: body.wizard === true,
    };
  }

  async deleteAllUserConnectors(input: {
    tenantId: string;
    userId: string;
  }): Promise<{ deleted: ConnectorId[] }> {
    const response = await this.request(
      CONNECTOR_API_PATHS.connections(input.tenantId, input.userId),
      { method: "DELETE" },
      { tenantId: input.tenantId, userId: input.userId },
    );
    const body = (await response.json()) as {
      deleted?: ConnectorId[];
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to delete user connector rows",
      );
    }
    return { deleted: body.deleted ?? [] };
  }

  async getUserConnectorSecrets(input: {
    tenantId: string;
    userId: string;
    connectorId: ConnectorId;
  }): Promise<ConnectorSecrets> {
    const response = await this.request(
      CONNECTOR_API_PATHS.connectionSecrets(
        input.tenantId,
        input.userId,
        input.connectorId,
      ),
      undefined,
      { tenantId: input.tenantId, userId: input.userId },
    );
    const body = (await response.json()) as {
      secrets?: ConnectorSecrets;
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to load connector secrets",
      );
    }
    return (
      body.secrets ?? {
        oauth_access: null,
        oauth_refresh: null,
        oauth_expiry: null,
        oauth_scopes: [],
        whatsapp_session_db: null,
      }
    );
  }

  async listUserGrantedConnectors(input: {
    tenantId: string;
    userId: string;
  }): Promise<GrantedConnectorAccess[]> {
    const response = await this.request(
      CONNECTOR_API_PATHS.grantedConnectors(input.tenantId, input.userId),
      undefined,
      { tenantId: input.tenantId, userId: input.userId },
    );
    const body = (await response.json()) as {
      connectors?: GrantedConnectorAccess[];
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to list granted connectors",
      );
    }
    return body.connectors ?? [];
  }

  async getUserConnectorAccess(input: {
    tenantId: string;
    userId: string;
    connectorId: ConnectorId;
  }): Promise<ConnectorAccess> {
    const response = await this.request(
      CONNECTOR_API_PATHS.connectionAccess(
        input.tenantId,
        input.userId,
        input.connectorId,
      ),
      undefined,
      { tenantId: input.tenantId, userId: input.userId },
    );
    const body = (await response.json()) as ConnectorAccess & { error?: string };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to load connector access",
      );
    }
    return body;
  }

  async injectUserConnector(input: {
    tenantId: string;
    userId: string;
    connectorId: ConnectorId;
    force?: boolean;
    sandboxDestroyed?: boolean;
  }): Promise<{
    instance_id: string;
    owner_user_id: string;
    connector_id: ConnectorId;
    sandbox_id: string | null;
    injected: boolean;
    reason: string;
    skip_oauth: boolean;
    files: string[];
    post_commands: Array<{ argv: string[]; env?: Record<string, string> }>;
  }> {
    const response = await this.request(
      CONNECTOR_API_PATHS.connectionInject(
        input.tenantId,
        input.userId,
        input.connectorId,
      ),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          force: input.force === true,
          sandbox_destroyed: input.sandboxDestroyed === true,
        }),
      },
      { tenantId: input.tenantId, userId: input.userId },
    );
    const body = (await response.json()) as {
      instance_id?: string;
      owner_user_id?: string;
      connector_id?: ConnectorId;
      sandbox_id?: string | null;
      injected?: boolean;
      reason?: string;
      skip_oauth?: boolean;
      files?: string[];
      post_commands?: Array<{ argv: string[]; env?: Record<string, string> }>;
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to inject connector",
      );
    }
    return {
      instance_id: body.instance_id ?? "",
      owner_user_id: body.owner_user_id ?? input.userId,
      connector_id: body.connector_id ?? input.connectorId,
      sandbox_id: body.sandbox_id ?? null,
      injected: body.injected === true,
      reason: body.reason ?? "",
      skip_oauth: body.skip_oauth === true,
      files: body.files ?? [],
      post_commands: body.post_commands ?? [],
    };
  }

  async completeConnectorOAuth(input: {
    tenantId: string;
    userId: string;
    connectorId: ConnectorId;
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<ConnectorConnectionPublic> {
    const response = await this.request(
      CONNECTOR_API_PATHS.connectionOAuthComplete(
        input.tenantId,
        input.userId,
        input.connectorId,
      ),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          code: input.code,
          redirect_uri: input.redirectUri,
          code_verifier: input.codeVerifier,
        }),
      },
      { tenantId: input.tenantId, userId: input.userId },
    );
    const body = (await response.json()) as ConnectorConnectionPublic & {
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Failed to complete connector OAuth",
      );
    }
    return body;
  }

  async googleCallback(input: {
    tenantId: string;
    code?: string;
    redirectUri?: string;
    googleSub?: string;
    email?: string;
  }): Promise<AuthUser> {
    const response = await this.request("/auth/google/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tenant_id: input.tenantId,
        code: input.code,
        redirect_uri: input.redirectUri,
        google_sub: input.googleSub,
        email: input.email,
      }),
    });

    const body = (await response.json()) as AuthUser & { error?: string };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        body.error ?? "Google sign-in failed",
      );
    }
    return body;
  }

  /**
   * Wake / ensure sandbox online for an instance (CP `lp-nus` orchestrator).
   * HTTP: online short-circuit; offline|error create/start; singleflight;
   * timeout → 504; unwired → 501. Call sites stay behind feature flags
   * default off (chat: `lp-y3j` / `ENSURE_ONLINE_ON_CHAT`).
   */
  async ensureOnline(
    instanceId: string,
    body: EnsureOnlineRequest = {},
  ): Promise<EnsureOnlineResponse> {
    const response = await this.request(
      ORCHESTRATOR_API_PATHS.ensureOnline(instanceId),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    const payload = (await response.json()) as EnsureOnlineResponse & {
      error?: string;
      code?: string;
      message?: string;
    };
    if (!response.ok) {
      // Prefer human message; keep short error slug as fallback. Attach CP
      // `code` for wake failure mapping (lp-mrh: timeout / vault / Daytona).
      throw new ControlPlaneRequestError(
        response.status,
        payload.message ?? payload.error ?? "ensure_online failed",
        payload.code,
      );
    }
    return payload;
  }

  /**
   * Resolve tenant+user → instance, then wake (lp-oop.19 / lp-oop.20).
   * User-scope wins; else tenant primary; else CP 404.
   */
  async ensureOnlineByUser(
    tenantId: string,
    userId: string,
    body: EnsureOnlineRequest = {},
  ): Promise<EnsureOnlineByUserResponse> {
    const response = await this.request(
      ORCHESTRATOR_API_PATHS.ensureOnlineByUser(tenantId, userId),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      { tenantId, userId },
    );

    const payload = (await response.json()) as EnsureOnlineByUserResponse & {
      error?: string;
      code?: string;
      message?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        payload.message ?? payload.error ?? "ensure_online failed",
        payload.code,
      );
    }
    return payload;
  }

  /**
   * Read instance presence + dual-run fields (lp-biq / lp-nye).
   */
  async getInstancePresence(
    instanceId: string,
  ): Promise<InstancePresenceResponse> {
    const response = await this.request(
      ORCHESTRATOR_API_PATHS.presence(instanceId),
    );

    const payload = (await response.json()) as InstancePresenceResponse & {
      error?: string;
      code?: string;
      message?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        payload.message ?? payload.error ?? "Failed to load instance presence",
        payload.code,
      );
    }
    return payload;
  }

  /**
   * Bump last_activity_at for idle grace (lp-biq stub → lp-kng.2.2).
   */
  async signalActivity(
    instanceId: string,
    body: SignalActivityRequest = {},
  ): Promise<SignalActivityResponse> {
    const response = await this.request(
      ORCHESTRATOR_API_PATHS.signalActivity(instanceId),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    const payload = (await response.json()) as SignalActivityResponse & {
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        payload.error ?? "signal_activity failed",
      );
    }
    return payload;
  }

  /**
   * Explicit / idle stop of sandbox compute (lp-biq stub).
   * Does not revoke permanent instance_id.
   */
  async stopInstance(
    instanceId: string,
    body: StopInstanceRequest = {},
  ): Promise<StopInstanceResponse> {
    const response = await this.request(
      ORCHESTRATOR_API_PATHS.stop(instanceId),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );

    const payload = (await response.json()) as StopInstanceResponse & {
      error?: string;
    };
    if (!response.ok) {
      throw new ControlPlaneRequestError(
        response.status,
        payload.error ?? "stop instance failed",
      );
    }
    return payload;
  }
}