/**
 * Tenant-scoped authorization (G1a.1 / G1a.2).
 *
 * Every control-plane path that touches tenant data is keyed by tenant_id.
 * Optional actor headers enable portal admin/contributor permission checks
 * without requiring secrets in git. Trusted service callers (BFF without
 * portal-role headers, INTERNAL_OPS_TOKEN operators) remain allowed for
 * backward compatibility; data access is still filtered by path tenant_id.
 *
 * Portal role → CP permission mapping aligns with hermes-profile-rbac:
 *   admin       — full tenant administration + user-scoped data
 *   contributor — user-scoped data only (no role/instance admin)
 *   member      — demo/legacy alias of contributor
 *
 * Headers (optional, defense-in-depth when BFF/client presents them):
 *   x-lanyard-tenant-id    — must match path tenant_id
 *   x-lanyard-user-id      — acting portal user (audit / future ACL)
 *   x-lanyard-portal-role  — admin | contributor | member
 */

import { HTTPException } from "hono/http-exception";

export const TENANT_ID_HEADER = "x-lanyard-tenant-id";
export const USER_ID_HEADER = "x-lanyard-user-id";
export const PORTAL_ROLE_HEADER = "x-lanyard-portal-role";

/** Canonical portal roles (Hermes profile matrix). */
export const CANONICAL_PORTAL_ROLES = ["admin", "contributor"] as const;
export type CanonicalPortalRole = (typeof CANONICAL_PORTAL_ROLES)[number];

/**
 * Accepted role labels on the wire. `member` is the demo seed role and maps
 * to contributor permissions.
 */
export type PortalRoleLabel = CanonicalPortalRole | "member";

export type PortalPermission =
  | "tenant.read"
  | "roles.read"
  | "roles.manage"
  | "instances.read"
  | "instances.manage"
  | "users.register"
  | "users.read"
  | "users.manage"
  | "projects.read"
  | "projects.manage"
  | "session_shares.read"
  | "session_shares.manage"
  | "connectors.read"
  | "connectors.manage"
  | "rbac.read";

/** Human-readable mapping for docs / G1a.2 acceptance. */
export const PORTAL_ROLE_PERMISSION_MATRIX: Record<
  CanonicalPortalRole,
  readonly PortalPermission[]
> = {
  admin: [
    "tenant.read",
    "roles.read",
    "roles.manage",
    "instances.read",
    "instances.manage",
    "users.register",
    "users.read",
    "users.manage",
    "projects.read",
    "projects.manage",
    "session_shares.read",
    "session_shares.manage",
    "connectors.read",
    "connectors.manage",
    "rbac.read",
  ],
  contributor: [
    "tenant.read",
    "roles.read",
    "instances.read",
    "users.read",
    "projects.read",
    "projects.manage",
    "session_shares.read",
    "session_shares.manage",
    "connectors.read",
    "connectors.manage",
    "rbac.read",
  ],
} as const;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Paths that carry a tenant UUID as the first segment after /tenants/. */
const TENANT_SCOPED_PATH_RE =
  /^\/(?:internal\/)?tenants\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/.*)?$/i;

/**
 * Extract tenant_id from a control-plane request path when present.
 * Returns null for platform routes (health, auth, create-tenant, by-slug, validate).
 */
export function extractTenantIdFromPath(path: string): string | null {
  const pathname = path.split("?")[0] ?? path;
  const match = pathname.match(TENANT_SCOPED_PATH_RE);
  if (!match) {
    return null;
  }
  return match[1] ?? null;
}

/** Normalize wire role label to a canonical portal role. */
export function normalizePortalRole(
  raw: string | undefined | null,
): CanonicalPortalRole | null {
  if (!raw) {
    return null;
  }
  const value = raw.trim().toLowerCase();
  if (value === "admin") {
    return "admin";
  }
  if (value === "contributor" || value === "member") {
    return "contributor";
  }
  return null;
}

/**
 * Derive portal role from CP RBAC role_names / hermes_profile.
 * Prefers admin if any assigned role implies admin.
 */
export function derivePortalRoleFromRbac(input: {
  role_names?: string[] | null;
  hermes_profile?: string | null;
}): CanonicalPortalRole | null {
  const names = (input.role_names ?? []).map((n) => n.trim().toLowerCase());
  const profile = input.hermes_profile?.trim().toLowerCase() ?? "";

  if (names.includes("admin") || profile === "admin") {
    return "admin";
  }
  if (
    names.includes("contributor") ||
    names.includes("member") ||
    profile === "contributor" ||
    profile === "default"
  ) {
    return "contributor";
  }
  // Unknown custom roles: treat as contributor (least privilege for admin ops).
  if (names.length > 0 || profile) {
    return "contributor";
  }
  return null;
}

export function portalRoleHasPermission(
  role: CanonicalPortalRole,
  permission: PortalPermission,
): boolean {
  return PORTAL_ROLE_PERMISSION_MATRIX[role].includes(permission);
}

/**
 * Map HTTP method + path to a portal permission when the route is
 * tenant-scoped and role-gated. Returns null for routes that do not
 * require a portal role (platform ops, public auth, or unmapped).
 */
export function permissionForTenantRoute(
  method: string,
  path: string,
): PortalPermission | null {
  const pathname = path.split("?")[0] ?? path;
  const match = pathname.match(TENANT_SCOPED_PATH_RE);
  if (!match) {
    return null;
  }
  const rest = match[2] ?? "";
  const m = method.toUpperCase();

  if (rest === "" || rest === "/") {
    return m === "GET" ? "tenant.read" : null;
  }

  if (rest === "/roles") {
    if (m === "POST") return "roles.manage";
    if (m === "GET") return "roles.read";
    return null;
  }

  if (/^\/users\/[^/]+\/roles$/.test(rest) && m === "PUT") {
    return "roles.manage";
  }

  if (rest === "/users/register" && m === "POST") {
    return "users.register";
  }

  // Exact list directory (not /users/:userId/...)
  if (rest === "/users") {
    if (m === "GET") return "users.read";
    if (m === "POST") return "users.manage";
    return null;
  }

  if (/^\/users\/[^/]+$/.test(rest)) {
    if (m === "GET") return "users.read";
    if (m === "PATCH" || m === "DELETE") return "users.manage";
    return null;
  }

  if (/^\/connectors\/[^/]+\/users$/.test(rest) && m === "GET") {
    return "connectors.read";
  }
  if (/^\/connectors\/[^/]+\/users\/[^/]+$/.test(rest) && m === "PUT") {
    return "connectors.manage";
  }

  if (
    rest === "/instances/register" ||
    rest === "/instances/provision" ||
    // lp-zoh.3 / plan 0010: idempotent ensure — same manage gate as register.
    rest === "/instances/ensure-tenant-primary"
  ) {
    return m === "POST" ? "instances.manage" : null;
  }

  if (/^\/instances\/[^/]+\/(rotate|revoke)$/.test(rest) && m === "POST") {
    return "instances.manage";
  }

  if (rest === "/deprovision" && m === "POST") {
    return "instances.manage";
  }

  if (rest === "/gateway-instances" && m === "GET") {
    return "instances.read";
  }

  // cbd-mta.3.3 deployment / resource registry
  if (rest === "/deployment") {
    if (m === "GET") return "instances.read";
    if (m === "PUT") return "instances.manage";
    return null;
  }

  if (rest === "/resources") {
    if (m === "GET") return "instances.read";
    if (m === "PUT") return "instances.manage";
    return null;
  }

  if (/^\/resources\/[^/]+$/.test(rest) && m === "DELETE") {
    return "instances.manage";
  }

  if (/^\/instances\/[^/]+\/registry$/.test(rest) && m === "PATCH") {
    return "instances.manage";
  }

  if (rest === "/audit" && m === "GET") {
    return "instances.read";
  }

  // /internal/tenants/:id/users/:userId/...
  if (/^\/users\/[^/]+\/rbac$/.test(rest) && m === "GET") {
    return "rbac.read";
  }

  // lp-oop.19: internal service/ops wake — same as primary-instance (no portal role)
  if (/^\/users\/[^/]+\/ensure-online$/.test(rest) && m === "POST") {
    return null;
  }

  // lp-zoh.3 / plan 0010: internal ensure-user provision — ops/service, no portal role
  if (/^\/users\/[^/]+\/instances\/ensure-user$/.test(rest) && m === "POST") {
    return null;
  }

  // lp-oop.9: internal vault list/stat/get — tenant.read when a portal role is presented
  if (/^\/vault\/(list|stat|get)$/.test(rest) && m === "GET") {
    return "tenant.read";
  }
  // lp-zuh.12.7: vault put/CAS — same tenant.read gate (service token has no portal role)
  if (/^\/vault\/put$/.test(rest) && m === "PUT") {
    return "tenant.read";
  }

  if (/^\/users\/[^/]+\/projects(?:\/[^/]+)?$/.test(rest)) {
    if (m === "GET") return "projects.read";
    if (m === "POST" || m === "PUT" || m === "DELETE") return "projects.manage";
    return null;
  }

  if (/session-shares/.test(rest)) {
    if (m === "GET") return "session_shares.read";
    if (m === "POST" || m === "DELETE") return "session_shares.manage";
    return null;
  }

  if (/^\/connector-entitlements(?:\/[^/]+)?$/.test(rest)) {
    if (m === "GET") return "roles.read";
    if (m === "PUT") return "roles.manage";
    return null;
  }

  if (/^\/roles\/[^/]+\/connector-grants(?:\/[^/]+)?$/.test(rest)) {
    if (m === "GET") return "roles.read";
    if (m === "PUT") return "roles.manage";
    return null;
  }

  if (/^\/users\/[^/]+\/granted-connectors$/.test(rest) && m === "GET") {
    return "connectors.read";
  }

  if (
    /^\/users\/[^/]+\/connectors(?:\/[^/]+(?:\/(secrets|access|inject|refresh))?)?$/.test(
      rest,
    )
  ) {
    if (m === "GET") return "connectors.read";
    if (m === "PUT" || m === "PATCH" || m === "DELETE" || m === "POST") {
      return "connectors.manage";
    }
    return null;
  }

  if (
    /^\/connectors\/[^/]+\/class-c-secrets(?:\/[^/]+(?:\/attach)?)?$/.test(rest)
  ) {
    if (m === "GET") return "connectors.read";
    if (m === "PUT" || m === "DELETE") return "connectors.manage";
    return null;
  }

  // primary-instance, retention, relay-tier — ops/service; no portal role gate
  return null;
}

/**
 * When the client presents x-lanyard-tenant-id, it must match the path tenant.
 * Mismatch is always 403 (cross-tenant probe).
 */
export function assertTenantHeaderMatchesPath(
  pathTenantId: string,
  headerTenantId: string | undefined,
): void {
  if (!headerTenantId) {
    return;
  }
  if (headerTenantId.trim() !== pathTenantId) {
    throw new HTTPException(403, {
      message: "Cross-tenant access denied",
    });
  }
}

/**
 * When the client presents x-lanyard-portal-role, enforce the permission matrix.
 * Unknown role labels → 403. Missing role → allow (trusted service / ops).
 */
export function assertPortalPermission(
  rawRole: string | undefined,
  permission: PortalPermission | null,
): void {
  if (!permission) {
    return;
  }
  if (!rawRole) {
    return;
  }
  const role = normalizePortalRole(rawRole);
  if (!role) {
    throw new HTTPException(403, {
      message: `Unknown portal role: ${rawRole}`,
    });
  }
  if (!portalRoleHasPermission(role, permission)) {
    throw new HTTPException(403, {
      message: `Portal role '${role}' lacks permission '${permission}'`,
    });
  }
}

/** Validate a string looks like a tenant UUID (path param sanity). */
export function isTenantIdShape(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Enforce tenant-scoped authorization for a request.
 * Call from middleware after path resolution.
 */
export function enforceTenantScopedAuthz(input: {
  method: string;
  path: string;
  tenantIdHeader?: string;
  portalRoleHeader?: string;
}): { tenantId: string | null } {
  const tenantId = extractTenantIdFromPath(input.path);
  if (!tenantId) {
    return { tenantId: null };
  }

  assertTenantHeaderMatchesPath(tenantId, input.tenantIdHeader);

  const permission = permissionForTenantRoute(input.method, input.path);
  assertPortalPermission(input.portalRoleHeader, permission);

  return { tenantId };
}
