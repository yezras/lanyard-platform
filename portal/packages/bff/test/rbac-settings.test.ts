import { describe, expect, it } from "vitest";
import { HTTPException } from "hono/http-exception";

import type { UserRbac } from "../src/control-plane-client.js";
import {
  assertSettingsPermission,
  hasSettingsManagePermission,
  isTenantAdmin,
} from "../src/rbac.js";
import type { SessionUser } from "../src/session.js";

function rbac(partial: Partial<UserRbac> & Pick<UserRbac, "hermes_profile">): UserRbac {
  return {
    user_id: partial.user_id ?? "user-1",
    tenant_id: partial.tenant_id ?? "tenant-1",
    hermes_profile: partial.hermes_profile,
    allowed_path_prefixes: partial.allowed_path_prefixes ?? ["/"],
    role_names: partial.role_names ?? [],
  };
}

const user: SessionUser = {
  user_id: "user-1",
  tenant_id: "tenant-1",
  email: "u@example.com",
};

describe("isTenantAdmin", () => {
  it("grants admin role name or hermes_profile only", () => {
    expect(isTenantAdmin(null)).toBe(false);
    expect(
      isTenantAdmin(rbac({ hermes_profile: "contributor", role_names: ["member"] })),
    ).toBe(false);
    expect(
      isTenantAdmin(
        rbac({ hermes_profile: "contributor", role_names: ["settings-admin"] }),
      ),
    ).toBe(false);
    expect(
      isTenantAdmin(rbac({ hermes_profile: "contributor", role_names: ["admin"] })),
    ).toBe(true);
    expect(
      isTenantAdmin(rbac({ hermes_profile: "admin", role_names: ["ops"] })),
    ).toBe(true);
  });
});

describe("settings RBAC helpers (lp-p37.7)", () => {
  describe("hasSettingsManagePermission", () => {
    it("denies null / empty rbac", () => {
      expect(hasSettingsManagePermission(null)).toBe(false);
    });

    it("grants admin role name or hermes_profile", () => {
      expect(
        hasSettingsManagePermission(
          rbac({ hermes_profile: "contributor", role_names: ["admin"] }),
        ),
      ).toBe(true);
      expect(
        hasSettingsManagePermission(
          rbac({ hermes_profile: "admin", role_names: ["ops"] }),
        ),
      ).toBe(true);
    });

    it("grants explicit settings-manager labels", () => {
      expect(
        hasSettingsManagePermission(
          rbac({
            hermes_profile: "contributor",
            role_names: ["settings-admin"],
          }),
        ),
      ).toBe(true);
      expect(
        hasSettingsManagePermission(
          rbac({ hermes_profile: "settings.manage", role_names: ["custom"] }),
        ),
      ).toBe(true);
    });

    it("denies contributor / member / default", () => {
      expect(
        hasSettingsManagePermission(
          rbac({ hermes_profile: "contributor", role_names: ["contributor"] }),
        ),
      ).toBe(false);
      expect(
        hasSettingsManagePermission(
          rbac({ hermes_profile: "default", role_names: ["member"] }),
        ),
      ).toBe(false);
    });
  });

  describe("assertSettingsPermission", () => {
    it("settings.read requires authentication only", () => {
      expect(() =>
        assertSettingsPermission("settings.read", { user: null, rbac: null }),
      ).toThrow(HTTPException);

      try {
        assertSettingsPermission("settings.read", { user: null, rbac: null });
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPException);
        expect((error as HTTPException).status).toBe(401);
      }

      expect(() =>
        assertSettingsPermission("settings.read", {
          user,
          rbac: null,
        }),
      ).not.toThrow();

      expect(() =>
        assertSettingsPermission("settings.read", {
          user,
          rbac: rbac({
            hermes_profile: "contributor",
            role_names: ["member"],
          }),
        }),
      ).not.toThrow();
    });

    it("settings.manage requires admin or explicit settings permission", () => {
      try {
        assertSettingsPermission("settings.manage", {
          user,
          rbac: rbac({
            hermes_profile: "contributor",
            role_names: ["member"],
          }),
        });
        expect.unreachable("expected 403");
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPException);
        expect((error as HTTPException).status).toBe(403);
      }

      expect(() =>
        assertSettingsPermission("settings.manage", {
          user,
          rbac: rbac({ hermes_profile: "admin", role_names: ["admin"] }),
        }),
      ).not.toThrow();
    });
  });
});
