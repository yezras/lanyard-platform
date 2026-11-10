/**
 * @lanyard/control-plane-fields
 *
 * Backend-neutral control-plane fields, hermes_* aliases, API mappers,
 * and schema migration stubs (lp-k7g.8.2).
 */

export type {
  BackendCapabilitiesSnapshot,
  BackendKind,
  RoleBackendFields,
  RoleLegacyAliases,
  RoleWithBackendProfile,
  TenantDeploymentBackendFields,
  TenantDeploymentLegacyAliases,
  TenantDeploymentWithBackend,
  UserRbacWithBackendProfile,
} from "./types.js";

export {
  BACKEND_KINDS,
  LEGACY_HERMES_ALIASES,
  PREFERRED_BACKEND_FIELDS,
  PREFERRED_TO_LEGACY_ALIAS,
} from "./types.js";

export {
  AliasConflictError,
  InvalidBackendKindError,
  dualWriteBackendProfile,
  dualWriteBackendVersion,
  dualWriteStringAlias,
  normalizeBackendCapabilities,
  parseBackendCapabilitiesColumn,
  parseBackendKind,
  resolveBackendProfile,
  resolveBackendVersion,
  resolveStringAlias,
  serializeBackendCapabilities,
} from "./aliases.js";

export type {
  DeploymentApiResponse,
  DeploymentUpsertInput,
  ResolvedDeploymentUpsert,
  ResolvedRoleCreate,
  RoleApiResponse,
  RoleCreateInput,
  UserRbacApiResponse,
} from "./api-shape.js";

export {
  MissingBackendProfileError,
  parseDeploymentUpsertInput,
  parseRoleCreateInput,
  roleWithBackendToApi,
  tenantDeploymentToApi,
  toDeploymentApiResponse,
  toRoleApiResponse,
  toUserRbacApiResponse,
  userRbacWithBackendToApi,
} from "./api-shape.js";

export type { MigrationStep } from "./migration.js";

export {
  CONTROL_PLANE_BACKEND_FIELD_MIGRATION,
  ENSURE_OPTIONAL_COLUMN_STATEMENTS,
  FIELD_MIGRATION_MAP,
  GREENFIELD_ROLES_BACKEND_COLUMNS,
  GREENFIELD_TENANT_DEPLOYMENTS_BACKEND_COLUMNS,
  migrationSqlForApply,
} from "./migration.js";
