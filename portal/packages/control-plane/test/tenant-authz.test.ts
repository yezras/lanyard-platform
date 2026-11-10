import { describe, expect, it } from "vitest";
import { HTTPException } from "hono/http-exception";

import {
  derivePortalRoleFromRbac,
  enforceTenantScopedAuthz,
  extractTenantIdFromPath,
  normalizePortalRole,
  permissionForTenantRoute,
  portalRoleHasPermission,
  PORTAL_ROLE_PERMISSION_MATRIX,
} from "../src/tenant-authz.js";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

describe("tenant-authz pure helpers", () => {
  it("extracts tenant UUID from tenant-scoped paths", () => {
    expect(extractTenantIdFromPath(`/tenants/${TENANT_A}`)).toBe(TENANT_A);
    expect(
      extractTenantIdFromPath(`/tenants/${TENANT_A}/roles`),
    ).toBe(TENANT_A);
    expect(
      extractTenantIdFromPath(
        `/internal/tenants/${TENANT_A}/users/${TENANT_B}/rbac`,
      ),
    ).toBe(TENANT_A);
    expect(extractTenantIdFromPath("/tenants/by-slug/demo")).toBeNull();
    expect(extractTenantIdFromPath("/internal/tenants/by-slug/demo")).toBeNull();
    expect(extractTenantIdFromPath("/health")).toBeNull();
    expect(extractTenantIdFromPath("/auth/login")).toBeNull();
    expect(extractTenantIdFromPath("/tenants")).toBeNull();
    expect(extractTenantIdFromPath("/internal/instances/validate")).toBeNull();
  });

  it("normalizes portal roles including demo member alias", () => {
    expect(normalizePortalRole("admin")).toBe("admin");
    expect(normalizePortalRole("Admin")).toBe("admin");
    expect(normalizePortalRole("contributor")).toBe("contributor");
    expect(normalizePortalRole("member")).toBe("contributor");
    expect(normalizePortalRole("unknown")).toBeNull();
    expect(normalizePortalRole(undefined)).toBeNull();
  });

  it("maps hermes admin/contributor to permission matrix", () => {
    expect(portalRoleHasPermission("admin", "roles.manage")).toBe(true);
    expect(portalRoleHasPermission("admin", "instances.manage")).toBe(true);
    expect(portalRoleHasPermission("contributor", "roles.manage")).toBe(false);
    expect(portalRoleHasPermission("contributor", "instances.manage")).toBe(
      false,
    );
    expect(portalRoleHasPermission("contributor", "projects.manage")).toBe(
      true,
    );
    expect(portalRoleHasPermission("contributor", "rbac.read")).toBe(true);
    expect(PORTAL_ROLE_PERMISSION_MATRIX.admin).toContain("roles.manage");
    expect(PORTAL_ROLE_PERMISSION_MATRIX.contributor).not.toContain(
      "roles.manage",
    );
  });

  it("derives portal role from RBAC payloads", () => {
    expect(
      derivePortalRoleFromRbac({
        role_names: ["admin"],
        hermes_profile: "admin",
      }),
    ).toBe("admin");
    expect(
      derivePortalRoleFromRbac({
        role_names: ["member"],
        hermes_profile: "default",
      }),
    ).toBe("contributor");
    expect(
      derivePortalRoleFromRbac({
        role_names: ["team-a"],
        hermes_profile: "team-a",
      }),
    ).toBe("contributor");
    expect(derivePortalRoleFromRbac({})).toBeNull();
  });

  it("maps routes to portal permissions", () => {
    expect(
      permissionForTenantRoute("POST", `/tenants/${TENANT_A}/roles`),
    ).toBe("roles.manage");
    expect(
      permissionForTenantRoute("GET", `/tenants/${TENANT_A}/roles`),
    ).toBe("roles.read");
    expect(
      permissionForTenantRoute(
        "PUT",
        `/tenants/${TENANT_A}/users/${TENANT_B}/roles`,
      ),
    ).toBe("roles.manage");
    expect(
      permissionForTenantRoute(
        "POST",
        `/tenants/${TENANT_A}/instances/provision`,
      ),
    ).toBe("instances.manage");
    expect(
      permissionForTenantRoute(
        "POST",
        `/tenants/${TENANT_A}/instances/${TENANT_B}/rotate`,
      ),
    ).toBe("instances.manage");
    expect(
      permissionForTenantRoute("GET", `/tenants/${TENANT_A}/gateway-instances`),
    ).toBe("instances.read");
    expect(
      permissionForTenantRoute(
        "GET",
        `/internal/tenants/${TENANT_A}/users/${TENANT_B}/projects`,
      ),
    ).toBe("projects.read");
    expect(
      permissionForTenantRoute(
        "POST",
        `/internal/tenants/${TENANT_A}/users/${TENANT_B}/session-shares`,
      ),
    ).toBe("session_shares.manage");
    expect(
      permissionForTenantRoute(
        "GET",
        `/internal/tenants/${TENANT_A}/users`,
      ),
    ).toBe("users.read");
    expect(portalRoleHasPermission("contributor", "users.read")).toBe(true);
    expect(portalRoleHasPermission("admin", "users.read")).toBe(true);
    expect(portalRoleHasPermission("admin", "users.manage")).toBe(true);
    expect(portalRoleHasPermission("contributor", "users.manage")).toBe(false);
    expect(
      permissionForTenantRoute("POST", `/tenants/${TENANT_A}/users`),
    ).toBe("users.manage");
    expect(
      permissionForTenantRoute(
        "DELETE",
        `/tenants/${TENANT_A}/users/${TENANT_B}`,
      ),
    ).toBe("users.manage");
    expect(
      permissionForTenantRoute(
        "GET",
        `/tenants/${TENANT_A}/connectors/hubspot/users`,
      ),
    ).toBe("connectors.read");
    expect(
      permissionForTenantRoute(
        "PUT",
        `/tenants/${TENANT_A}/connectors/hubspot/users/${TENANT_B}`,
      ),
    ).toBe("connectors.manage");
    expect(
      permissionForTenantRoute(
        "GET",
        `/internal/tenants/${TENANT_A}/primary-instance`,
      ),
    ).toBeNull();
    expect(
      permissionForTenantRoute(
        "POST",
        `/internal/tenants/${TENANT_A}/users/${TENANT_B}/ensure-online`,
      ),
    ).toBeNull();
    expect(
      permissionForTenantRoute(
        "GET",
        `/internal/tenants/${TENANT_A}/vault/list`,
      ),
    ).toBe("tenant.read");
    expect(
      permissionForTenantRoute(
        "GET",
        `/internal/tenants/${TENANT_A}/vault/stat`,
      ),
    ).toBe("tenant.read");
    expect(
      permissionForTenantRoute(
        "GET",
        `/internal/tenants/${TENANT_A}/vault/get`,
      ),
    ).toBe("tenant.read");
    expect(
      permissionForTenantRoute(
        "PUT",
        `/internal/tenants/${TENANT_A}/vault/put`,
      ),
    ).toBe("tenant.read");
    expect(
      permissionForTenantRoute(
        "GET",
        `/internal/tenants/${TENANT_A}/connector-entitlements`,
      ),
    ).toBe("roles.read");
    expect(
      permissionForTenantRoute(
        "PUT",
        `/internal/tenants/${TENANT_A}/connector-entitlements/google`,
      ),
    ).toBe("roles.manage");
    expect(
      permissionForTenantRoute(
        "PUT",
        `/internal/tenants/${TENANT_A}/roles/${TENANT_B}/connector-grants/hubspot`,
      ),
    ).toBe("roles.manage");
    expect(
      permissionForTenantRoute(
        "GET",
        `/internal/tenants/${TENANT_A}/users/${TENANT_B}/connectors`,
      ),
    ).toBe("connectors.read");
    expect(
      permissionForTenantRoute(
        "GET",
        `/internal/tenants/${TENANT_A}/users/${TENANT_B}/granted-connectors`,
      ),
    ).toBe("connectors.read");
    expect(
      permissionForTenantRoute(
        "PUT",
        `/internal/tenants/${TENANT_A}/users/${TENANT_B}/connectors/google/secrets`,
      ),
    ).toBe("connectors.manage");
    expect(
      permissionForTenantRoute(
        "POST",
        `/internal/tenants/${TENANT_A}/users/${TENANT_B}/connectors/google/refresh`,
      ),
    ).toBe("connectors.manage");
    expect(
      permissionForTenantRoute(
        "DELETE",
        `/internal/tenants/${TENANT_A}/users/${TENANT_B}/connectors`,
      ),
    ).toBe("connectors.manage");
    expect(
      permissionForTenantRoute(
        "GET",
        `/internal/tenants/${TENANT_A}/connectors/stripe/class-c-secrets`,
      ),
    ).toBe("connectors.read");
    expect(
      permissionForTenantRoute(
        "GET",
        `/internal/tenants/${TENANT_A}/connectors/stripe/class-c-secrets/api/attach`,
      ),
    ).toBe("connectors.read");
    expect(
      permissionForTenantRoute(
        "PUT",
        `/internal/tenants/${TENANT_A}/connectors/stripe/class-c-secrets/api`,
      ),
    ).toBe("connectors.manage");
    expect(portalRoleHasPermission("contributor", "connectors.manage")).toBe(
      true,
    );
    expect(portalRoleHasPermission("contributor", "roles.manage")).toBe(false);
  });

  it("rejects cross-tenant header mismatch with 403", () => {
    try {
      enforceTenantScopedAuthz({
        method: "GET",
        path: `/tenants/${TENANT_A}`,
        tenantIdHeader: TENANT_B,
      });
      expect.unreachable("should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HTTPException);
      expect((error as HTTPException).status).toBe(403);
      expect((error as HTTPException).message).toContain("Cross-tenant");
    }
  });

  it("rejects contributor elevation into roles.manage", () => {
    try {
      enforceTenantScopedAuthz({
        method: "POST",
        path: `/tenants/${TENANT_A}/roles`,
        tenantIdHeader: TENANT_A,
        portalRoleHeader: "contributor",
      });
      expect.unreachable("should throw");
    } catch (error) {
      expect(error).toBeInstanceOf(HTTPException);
      expect((error as HTTPException).status).toBe(403);
      expect((error as HTTPException).message).toContain("roles.manage");
    }
  });

  it("allows admin roles.manage and trusted callers without role header", () => {
    expect(
      enforceTenantScopedAuthz({
        method: "POST",
        path: `/tenants/${TENANT_A}/roles`,
        tenantIdHeader: TENANT_A,
        portalRoleHeader: "admin",
      }).tenantId,
    ).toBe(TENANT_A);

    expect(
      enforceTenantScopedAuthz({
        method: "POST",
        path: `/tenants/${TENANT_A}/roles`,
      }).tenantId,
    ).toBe(TENANT_A);
  });
});
