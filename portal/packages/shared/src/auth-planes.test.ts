import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  OPS_SESSION_COOKIE,
  PLATFORM_ADMIN_API_PREFIX,
  PLATFORM_ADMIN_UI_BASE,
  S3_VAULT_PLATFORM_PREFIX,
  TENANT_SESSION_COOKIE,
  authPlaneForPathname,
  isOpsConsolePath,
  isPlatformAdminApiPath,
} from "./auth-planes.js";
import {
  PLATFORM_ADMIN_PATH_SEGMENT,
  RESERVED_TENANT_PATH_SEGMENTS,
  isValidTenantSlug,
  parseTenantSlugFromPath,
} from "./tenant/host.js";

describe("credential plane constants", () => {
  it("names distinct cookies and the reserved admin slug", () => {
    expect(TENANT_SESSION_COOKIE).toBe("lanyard_session");
    expect(OPS_SESSION_COOKIE).toBe("lanyard_ops_session");
    expect(TENANT_SESSION_COOKIE).not.toBe(OPS_SESSION_COOKIE);
    expect(PLATFORM_ADMIN_PATH_SEGMENT).toBe("admin");
    expect(PLATFORM_ADMIN_UI_BASE).toBe("/admin");
    expect(PLATFORM_ADMIN_API_PREFIX).toBe("/api/admin");
    expect(S3_VAULT_PLATFORM_PREFIX).toBe("_platform");
  });

  it("keeps BFF cookie literals in lockstep with the shared plane names", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const bffSession = readFileSync(
      join(here, "../../bff/src/session.ts"),
      "utf8",
    );
    expect(bffSession).toContain(
      `SESSION_COOKIE = "${TENANT_SESSION_COOKIE}"`,
    );
    expect(bffSession).toContain(
      `OPS_SESSION_COOKIE = "${OPS_SESSION_COOKIE}"`,
    );
  });

  it("forbids tenant slug admin", () => {
    expect(RESERVED_TENANT_PATH_SEGMENTS.has(PLATFORM_ADMIN_PATH_SEGMENT)).toBe(
      true,
    );
    expect(isValidTenantSlug("admin")).toBe(false);
    expect(parseTenantSlugFromPath("/admin")).toBeNull();
    expect(parseTenantSlugFromPath("/admin/api/connectors")).toBeNull();
  });

  it("does not treat _platform as a tenant slug or ops UI path", () => {
    expect(isValidTenantSlug(S3_VAULT_PLATFORM_PREFIX)).toBe(false);
    expect(isOpsConsolePath("/_platform")).toBe(false);
    expect(authPlaneForPathname("/_platform")).toBe("tenant");
  });
});

describe("authPlaneForPathname", () => {
  it("classifies /admin as ops and tenant paths as tenant", () => {
    expect(authPlaneForPathname("/admin")).toBe("ops");
    expect(authPlaneForPathname("/admin/secrets")).toBe("ops");
    expect(authPlaneForPathname("/Admin/tenants")).toBe("ops");
    expect(isOpsConsolePath("/admin")).toBe(true);
    expect(authPlaneForPathname("/demo")).toBe("tenant");
    expect(authPlaneForPathname("/demo/settings")).toBe("tenant");
    expect(authPlaneForPathname("/api/admin/tenants")).toBe("tenant");
    expect(isOpsConsolePath("/api/admin/tenants")).toBe(false);
    expect(isOpsConsolePath("/demo")).toBe(false);
  });
});

describe("isPlatformAdminApiPath", () => {
  it("matches bare /api/admin and nested admin APIs only", () => {
    expect(isPlatformAdminApiPath("/api/admin")).toBe(true);
    expect(isPlatformAdminApiPath("/api/admin/")).toBe(true);
    expect(isPlatformAdminApiPath("/api/admin/auth/me")).toBe(true);
    expect(isPlatformAdminApiPath("/api/admin/auth/me?x=1")).toBe(true);
    expect(isPlatformAdminApiPath("/api/auth/me")).toBe(false);
    expect(isPlatformAdminApiPath("/admin")).toBe(false);
    expect(isPlatformAdminApiPath("/demo/api/admin/auth/me")).toBe(false);
  });
});
