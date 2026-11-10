/**
 * Control-plane backend field types (backend-neutral).
 *
 * Source of truth for current Portal control-plane (not yet imported):
 *   packages/control-plane/src/types.ts
 *   packages/control-plane/src/migrate.ts
 *   packages/control-plane/src/deployment-registry.ts
 *   packages/control-plane/src/rbac.ts
 *
 * Preferred names match contracts/backend-runtime-v1 and
 * @lanyard/backend-runtime. Legacy hermes_* names remain wire/DB aliases
 * during the migration window (lp-k7g.8.2 / lp-k7g.8.7).
 */

/** Backend product family when known (artifact kind). */
export type BackendKind =
  | "hermes_upstream"
  | "hermes_lanyard"
  | "lanyard_agent";

export const BACKEND_KINDS = [
  "hermes_upstream",
  "hermes_lanyard",
  "lanyard_agent",
] as const satisfies readonly BackendKind[];

/**
 * Cached capability claim stored on tenant_deployments for registry/UI.
 * Aligns with capabilities.schema.json #/$defs/capabilityDescriptor and
 * BackendCapabilitySet from @lanyard/backend-runtime — kept structural
 * (no hard dependency) so this package stays standalone pre-import.
 */
export type BackendCapabilitiesSnapshot = {
  schema_version: 1;
  source?: "brain_rpc" | "artifact_manifest" | "combined" | "static_default" | "control_plane_pin";
  kind?: BackendKind;
  version?: string;
  contract?: {
    runtime_layout: number;
    relay: number;
    brain_rpc: number;
  };
  profiles?: string[];
  brain_rpc_methods?: string[];
  features?: Record<string, boolean>;
  ui_affordances?: Record<string, "supported" | "unsupported" | "degraded">;
  limits?: Record<string, number | undefined>;
  notes?: string;
  /** ISO timestamp when control-plane last refreshed this snapshot. */
  captured_at?: string;
};

// ---------------------------------------------------------------------------
// tenant_deployments — version / kind / capabilities
// ---------------------------------------------------------------------------

/**
 * Preferred backend pin fields on TenantDeployment.
 * Replaces sole reliance on hermes_version.
 */
export type TenantDeploymentBackendFields = {
  /** Artifact product family (from pin / bootstrap). */
  backend_kind: BackendKind | null;
  /**
   * Preferred installed backend artifact version.
   * Dual-writes hermes_version during migration.
   */
  backend_version: string | null;
  /**
   * Last-known capability descriptor (JSON), not live Brain RPC.
   * Live discovery stays on BackendRuntimeService.capabilities().
   */
  backend_capabilities: BackendCapabilitiesSnapshot | null;
};

/**
 * Legacy columns still present on tenant_deployments during migration.
 * Application code should prefer TenantDeploymentBackendFields.
 */
export type TenantDeploymentLegacyAliases = {
  /** @deprecated Alias of backend_version. Accept on write; dual-emit on read. */
  hermes_version: string | null;
};

/**
 * Full deployment row shape after migration (subset of TenantDeployment).
 * Matches current control-plane TenantDeployment + new columns.
 */
export type TenantDeploymentWithBackend = TenantDeploymentBackendFields &
  TenantDeploymentLegacyAliases & {
    tenant_id: string;
    hosting_track: string;
    isolation_mode: string;
    aws_account_id: string | null;
    aws_region: string | null;
    project_name: string | null;
    status: string;
    client_core_version: string | null;
    primary_instance_id: string | null;
    created_at: string;
    updated_at: string;
    retired_at: string | null;
  };

// ---------------------------------------------------------------------------
// roles / UserRbac — profile
// ---------------------------------------------------------------------------

/**
 * Preferred profile field on Role and UserRbac.
 * Maps to Brain RPC auth.subject.backend_profile.
 */
export type RoleBackendFields = {
  /**
   * Backend profile name (admin, contributor, …).
   * Dual-writes hermes_profile during migration.
   */
  backend_profile: string;
};

export type RoleLegacyAliases = {
  /** @deprecated Alias of backend_profile. Accept on write; dual-emit on read. */
  hermes_profile: string;
};

/** Role API/domain shape after migration. */
export type RoleWithBackendProfile = RoleBackendFields &
  RoleLegacyAliases & {
    role_id: string;
    tenant_id: string;
    name: string;
    path_prefixes: string[];
    created_at: string;
  };

/** Effective RBAC for a portal user after migration. */
export type UserRbacWithBackendProfile = RoleBackendFields &
  RoleLegacyAliases & {
    user_id: string;
    tenant_id: string;
    allowed_path_prefixes: string[];
    role_names: string[];
  };

// ---------------------------------------------------------------------------
// Field name catalog (docs + validators)
// ---------------------------------------------------------------------------

/** Preferred JSON / TypeScript field names for control-plane APIs. */
export const PREFERRED_BACKEND_FIELDS = {
  kind: "backend_kind",
  version: "backend_version",
  profile: "backend_profile",
  capabilities: "backend_capabilities",
} as const;

/** Legacy Hermes field names accepted as aliases during migration. */
export const LEGACY_HERMES_ALIASES = {
  version: "hermes_version",
  profile: "hermes_profile",
} as const;

/**
 * Map preferred → legacy (where an alias exists).
 * backend_kind and backend_capabilities are new; no hermes_* column.
 */
export const PREFERRED_TO_LEGACY_ALIAS: Readonly<
  Partial<Record<(typeof PREFERRED_BACKEND_FIELDS)[keyof typeof PREFERRED_BACKEND_FIELDS], string>>
> = {
  backend_version: "hermes_version",
  backend_profile: "hermes_profile",
};
