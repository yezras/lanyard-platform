import { describe, expect, it } from "vitest";

import {
  connectorsAfterGrant,
  isLastTenantAdmin,
  parseAddUserDraft,
  tenantAdminCount,
} from "./opsUsers.js";

const admin = {
  user_id: "u1",
  role: "tenant_admin" as const,
};
const otherAdmin = {
  user_id: "u2",
  role: "tenant_admin" as const,
};
const member = {
  user_id: "u3",
  role: "member" as const,
};

describe("opsUsers domain (lp-hdzm.22)", () => {
  it("counts tenant admins and flags the last one", () => {
    expect(tenantAdminCount([admin, member])).toBe(1);
    expect(isLastTenantAdmin([admin, member], "u1")).toBe(true);
    expect(isLastTenantAdmin([admin, member], "u3")).toBe(false);
    expect(isLastTenantAdmin([admin, otherAdmin, member], "u1")).toBe(false);
  });

  it("parses add-user drafts and rejects invited-shaped empty input", () => {
    expect(
      parseAddUserDraft({
        displayName: " Ada Admin ",
        email: "Ada@Ops.Test",
        role: "tenant_admin",
      }),
    ).toEqual({
      displayName: "Ada Admin",
      email: "ada@ops.test",
      role: "tenant_admin",
    });
    expect(
      parseAddUserDraft({
        displayName: "",
        email: "ada@ops.test",
        role: "member",
      }),
    ).toBeNull();
    expect(
      parseAddUserDraft({
        displayName: "Ada",
        email: "not-an-email",
        role: "member",
      }),
    ).toBeNull();
  });

  it("toggles person grants as connector id presence", () => {
    expect(connectorsAfterGrant(["google"], "hubspot", true)).toEqual([
      "google",
      "hubspot",
    ]);
    expect(connectorsAfterGrant(["google", "hubspot"], "hubspot", false)).toEqual([
      "google",
    ]);
    expect(connectorsAfterGrant(["google"], "google", true)).toEqual(["google"]);
  });
});
