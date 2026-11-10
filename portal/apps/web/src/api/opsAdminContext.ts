/**
 * Admin shell role context (lp-2qs.8.1).
 *
 * One shell, two roles. `/api/admin/context` is the only source of tenant
 * scope. Parsing is fail-closed: a well-formed `tenant_admin` payload is
 * required to render tenant-scoped UI; anything malformed throws rather than
 * guessing. If the context endpoint itself is unreachable, an authenticated
 * ops session still proves superadmin — that is the pre-existing surface.
 */

import type { OpsTenantSummary } from "./opsAdmin.js";
import { opsAdminApiPath } from "./opsAuth.js";
import { withApiBase } from "./tenantBase.js";

export type OpsAdminContext =
  | { role: "superadmin" }
  | { role: "tenant_admin"; tenant: OpsTenantSummary };

type ApiErrorBody = { error?: string; message?: string };

function parseTenantSummary(value: unknown): OpsTenantSummary | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const rec = value as Record<string, unknown>;
  if (
    typeof rec.tenant_id !== "string" ||
    !rec.tenant_id ||
    typeof rec.tenant_slug !== "string" ||
    !rec.tenant_slug ||
    typeof rec.display_name !== "string" ||
    !rec.display_name
  ) {
    return null;
  }
  return {
    tenant_id: rec.tenant_id,
    tenant_slug: rec.tenant_slug,
    display_name: rec.display_name,
  };
}

export function parseOpsAdminContext(body: unknown): OpsAdminContext {
  const rec =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  if (rec.role === "superadmin") {
    return { role: "superadmin" };
  }
  if (rec.role === "tenant_admin") {
    const tenant = parseTenantSummary(rec.tenant);
    if (!tenant) {
      throw new Error("Invalid admin context: tenant scope is malformed");
    }
    return { role: "tenant_admin", tenant };
  }
  throw new Error("Invalid admin context");
}

/**
 * Never throws for transport failures: an ops session that passed
 * `/auth/me` is superadmin even if the context endpoint is missing (older
 * BFF). Throws only on a malformed tenant_admin claim — that must not
 * silently downgrade to a wider role.
 */
export async function fetchOpsAdminContext(): Promise<OpsAdminContext> {
  let res: Response;
  try {
    res = await fetch(withApiBase(opsAdminApiPath("/context")), {
      credentials: "include",
    });
  } catch {
    return { role: "superadmin" };
  }
  if (!res.ok) {
    return { role: "superadmin" };
  }
  const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
  if (body === null) {
    return { role: "superadmin" };
  }
  return parseOpsAdminContext(body);
}
