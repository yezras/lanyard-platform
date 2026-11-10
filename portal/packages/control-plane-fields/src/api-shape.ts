/**
 * API request/response mappers that expose backend-neutral names while
 * dual-emitting hermes_* aliases during the migration window.
 *
 * Wire into control-plane app.ts after Portal import:
 *   - upsert deployment body → parseDeploymentUpsertInput
 *   - GET/PUT deployment → toDeploymentApiResponse
 *   - create role body → parseRoleCreateInput
 *   - role / UserRbac responses → toRoleApiResponse / toUserRbacApiResponse
 */

import {
  dualWriteBackendProfile,
  dualWriteBackendVersion,
  normalizeBackendCapabilities,
  parseBackendKind,
  resolveBackendProfile,
  resolveBackendVersion,
} from "./aliases.js";
import type {
  BackendCapabilitiesSnapshot,
  BackendKind,
  RoleWithBackendProfile,
  TenantDeploymentWithBackend,
  UserRbacWithBackendProfile,
} from "./types.js";

// ---------------------------------------------------------------------------
// Deployment upsert (PUT /tenants/:id/deployment)
// ---------------------------------------------------------------------------

export type DeploymentUpsertInput = {
  hosting_track: string;
  isolation_mode: string;
  aws_account_id?: string | null;
  aws_region?: string | null;
  project_name?: string | null;
  status?: string;
  client_core_version?: string | null;
  /** Preferred. */
  backend_kind?: BackendKind | string | null;
  backend_version?: string | null;
  backend_capabilities?: BackendCapabilitiesSnapshot | null;
  /** Legacy aliases (accepted). */
  hermes_version?: string | null;
  primary_instance_id?: string | null;
};

export type ResolvedDeploymentUpsert = {
  backend_kind: BackendKind | null;
  backend_version: string | null;
  hermes_version: string | null;
  backend_capabilities: BackendCapabilitiesSnapshot | null;
};

/**
 * Parse deployment upsert body: accept preferred + legacy version fields,
 * dual-write both version columns, parse kind + capabilities.
 */
export function parseDeploymentUpsertInput(
  body: DeploymentUpsertInput,
): ResolvedDeploymentUpsert {
  const versions = dualWriteBackendVersion({
    backend_version: body.backend_version,
    hermes_version: body.hermes_version,
  });
  return {
    backend_kind: parseBackendKind(
      body.backend_kind === undefined || body.backend_kind === null
        ? null
        : String(body.backend_kind),
    ),
    backend_version: versions.backend_version,
    hermes_version: versions.hermes_version,
    backend_capabilities: normalizeBackendCapabilities(
      body.backend_capabilities ?? null,
    ),
  };
}

// ---------------------------------------------------------------------------
// Deployment API response
// ---------------------------------------------------------------------------

export type DeploymentApiResponse = {
  tenant_id: string;
  hosting_track: string;
  isolation_mode: string;
  aws_account_id: string | null;
  aws_region: string | null;
  project_name: string | null;
  status: string;
  client_core_version: string | null;
  /** Preferred backend pin fields. */
  backend_kind: BackendKind | null;
  backend_version: string | null;
  backend_capabilities: BackendCapabilitiesSnapshot | null;
  /**
   * Temporary alias of backend_version (migration window).
   * Clients should migrate to backend_version.
   */
  hermes_version: string | null;
  primary_instance_id: string | null;
  created_at: string;
  updated_at: string;
  retired_at: string | null;
};

/**
 * Map a DB/domain deployment row to the public API shape.
 * Always dual-emits hermes_version = effective backend_version.
 */
export function toDeploymentApiResponse(
  row: {
    tenant_id: string;
    hosting_track: string;
    isolation_mode: string;
    aws_account_id: string | null;
    aws_region: string | null;
    project_name: string | null;
    status: string;
    client_core_version: string | null;
    backend_kind?: BackendKind | string | null;
    backend_version?: string | null;
    hermes_version?: string | null;
    backend_capabilities?: BackendCapabilitiesSnapshot | string | null;
    primary_instance_id: string | null;
    created_at: string;
    updated_at: string;
    retired_at: string | null;
  },
): DeploymentApiResponse {
  const version = resolveBackendVersion({
    backend_version: row.backend_version,
    hermes_version: row.hermes_version,
  });
  let capabilities: BackendCapabilitiesSnapshot | null = null;
  if (typeof row.backend_capabilities === "string") {
    capabilities = row.backend_capabilities
      ? (JSON.parse(row.backend_capabilities) as BackendCapabilitiesSnapshot)
      : null;
  } else {
    capabilities = row.backend_capabilities ?? null;
  }
  const kind =
    row.backend_kind === undefined || row.backend_kind === null
      ? null
      : parseBackendKind(String(row.backend_kind));

  return {
    tenant_id: row.tenant_id,
    hosting_track: row.hosting_track,
    isolation_mode: row.isolation_mode,
    aws_account_id: row.aws_account_id,
    aws_region: row.aws_region,
    project_name: row.project_name,
    status: row.status,
    client_core_version: row.client_core_version,
    backend_kind: kind,
    backend_version: version,
    backend_capabilities: capabilities,
    hermes_version: version,
    primary_instance_id: row.primary_instance_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    retired_at: row.retired_at,
  };
}

/** Convenience: wrap full TenantDeploymentWithBackend. */
export function tenantDeploymentToApi(
  row: TenantDeploymentWithBackend,
): DeploymentApiResponse {
  return toDeploymentApiResponse(row);
}

// ---------------------------------------------------------------------------
// Role create (POST /tenants/:id/roles)
// ---------------------------------------------------------------------------

export type RoleCreateInput = {
  name: string;
  /** Preferred. */
  backend_profile?: string;
  /** Legacy alias (accepted). At least one of backend_profile | hermes_profile required. */
  hermes_profile?: string;
  path_prefixes: string[];
};

export type ResolvedRoleCreate = {
  name: string;
  backend_profile: string;
  hermes_profile: string;
  path_prefixes: string[];
};

export class MissingBackendProfileError extends Error {
  readonly code = "MISSING_BACKEND_PROFILE";

  constructor() {
    super("backend_profile (or alias hermes_profile) is required");
    this.name = "MissingBackendProfileError";
  }
}

export function parseRoleCreateInput(body: RoleCreateInput): ResolvedRoleCreate {
  const profiles = dualWriteBackendProfile({
    backend_profile: body.backend_profile,
    hermes_profile: body.hermes_profile,
  });
  if (!profiles.backend_profile) {
    throw new MissingBackendProfileError();
  }
  return {
    name: body.name.trim(),
    backend_profile: profiles.backend_profile,
    hermes_profile: profiles.hermes_profile!,
    path_prefixes: body.path_prefixes,
  };
}

// ---------------------------------------------------------------------------
// Role / UserRbac API responses
// ---------------------------------------------------------------------------

export type RoleApiResponse = {
  role_id: string;
  tenant_id: string;
  name: string;
  /** Preferred. */
  backend_profile: string;
  /** Temporary alias of backend_profile. */
  hermes_profile: string;
  path_prefixes: string[];
  created_at: string;
};

export function toRoleApiResponse(row: {
  role_id: string;
  tenant_id: string;
  name: string;
  backend_profile?: string | null;
  hermes_profile?: string | null;
  path_prefixes: string[];
  created_at: string;
}): RoleApiResponse {
  const profile = resolveBackendProfile({
    backend_profile: row.backend_profile,
    hermes_profile: row.hermes_profile,
  });
  if (!profile) {
    throw new MissingBackendProfileError();
  }
  return {
    role_id: row.role_id,
    tenant_id: row.tenant_id,
    name: row.name,
    backend_profile: profile,
    hermes_profile: profile,
    path_prefixes: row.path_prefixes,
    created_at: row.created_at,
  };
}

export function roleWithBackendToApi(
  row: RoleWithBackendProfile,
): RoleApiResponse {
  return toRoleApiResponse(row);
}

export type UserRbacApiResponse = {
  user_id: string;
  tenant_id: string;
  /** Preferred. */
  backend_profile: string;
  /** Temporary alias of backend_profile. */
  hermes_profile: string;
  allowed_path_prefixes: string[];
  role_names: string[];
};

export function toUserRbacApiResponse(row: {
  user_id: string;
  tenant_id: string;
  backend_profile?: string | null;
  hermes_profile?: string | null;
  allowed_path_prefixes: string[];
  role_names: string[];
}): UserRbacApiResponse {
  const profile = resolveBackendProfile({
    backend_profile: row.backend_profile,
    hermes_profile: row.hermes_profile,
  });
  if (!profile) {
    throw new MissingBackendProfileError();
  }
  return {
    user_id: row.user_id,
    tenant_id: row.tenant_id,
    backend_profile: profile,
    hermes_profile: profile,
    allowed_path_prefixes: row.allowed_path_prefixes,
    role_names: row.role_names,
  };
}

export function userRbacWithBackendToApi(
  row: UserRbacWithBackendProfile,
): UserRbacApiResponse {
  return toUserRbacApiResponse(row);
}
