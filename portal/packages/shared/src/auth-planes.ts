/**
 * Dual credential planes for tenant Portal vs Lanyard ops (`/admin`).
 * Cookie names and path constants are the SoT. BFF re-exports the cookies.
 */

import { PLATFORM_ADMIN_PATH_SEGMENT } from "./tenant/host.js";

/** Tenant Portal session. Bound to one tenant_id. */
export const TENANT_SESSION_COOKIE = "lanyard_session";

/** Lanyard ops console session. Never a tenant Portal session. */
export const OPS_SESSION_COOKIE = "lanyard_ops_session";

export const PLATFORM_ADMIN_UI_BASE = `/${PLATFORM_ADMIN_PATH_SEGMENT}`;

/** Bare BFF prefix. Matches CloudFront /api/* rather than path-first /{slug}/api/*. */
export const PLATFORM_ADMIN_API_PREFIX = "/api/admin";

/**
 * S3 vault marker under `tenants/{id}/_platform/`.
 * Not a product URL and not a CloudFront SPA path.
 */
export const S3_VAULT_PLATFORM_PREFIX = "_platform";

export type AuthPlane = "tenant" | "ops";

export type TenantSessionPlane = {
  plane: "tenant";
  cookie: typeof TENANT_SESSION_COOKIE;
  tenantId: string;
  userId: string;
};

export type OpsSessionPlane = {
  plane: "ops";
  cookie: typeof OPS_SESSION_COOKIE;
  operatorId: string;
  email: string;
};

export type CredentialPlane = TenantSessionPlane | OpsSessionPlane;

export type OpsSecretKind = "env_key" | "oauth_slot";

export type OpsSecretSlot =
  | { kind: "env_key"; env_name: string }
  | { kind: "oauth_slot"; provider_id: string };

export type OpsSecretStatus = {
  tenant_id: string;
  slot: OpsSecretSlot;
  present: boolean;
  fingerprint: string | null;
  rotated_at: string | null;
};

export function authPlaneForPathname(pathname: string): AuthPlane {
  const parts = pathname.split("/").filter(Boolean);
  const first = parts[0]?.toLowerCase();
  return first === PLATFORM_ADMIN_PATH_SEGMENT ? "ops" : "tenant";
}

export function isOpsConsolePath(pathname: string): boolean {
  return authPlaneForPathname(pathname) === "ops";
}

/** Bare BFF admin API (`/api/admin` or `/api/admin/…`). Not a tenant slug path. */
export function isPlatformAdminApiPath(pathname: string): boolean {
  const path = (pathname.split("?")[0] ?? pathname).replace(/\/+$/, "") || "/";
  return (
    path === PLATFORM_ADMIN_API_PREFIX ||
    path.startsWith(`${PLATFORM_ADMIN_API_PREFIX}/`)
  );
}
