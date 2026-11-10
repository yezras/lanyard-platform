import { describe, expect, it } from "vitest";

import { bffAdminAuthMeUrl, bffAuthMeUrl } from "./bff-session.js";

describe("bffAuthMeUrl", () => {
  it("uses the first path segment as tenant slug", () => {
    expect(
      bffAuthMeUrl({
        bffUrl: "http://127.0.0.1:4000",
        refererPath: "/mocklab/chat",
      }),
    ).toBe("http://127.0.0.1:4000/mocklab/api/auth/me");
  });

  it("falls back to DEV_TENANT_SLUG when the path is not a tenant", () => {
    expect(
      bffAuthMeUrl({
        bffUrl: "http://127.0.0.1:4000/",
        refererPath: "/login",
        devTenantSlug: "mocklab",
      }),
    ).toBe("http://127.0.0.1:4000/mocklab/api/auth/me");
  });

  it("uses unprefixed /api/auth/me when no slug is available", () => {
    expect(
      bffAuthMeUrl({
        bffUrl: "http://127.0.0.1:4000",
        refererPath: "/login",
      }),
    ).toBe("http://127.0.0.1:4000/api/auth/me");
  });

  it("ops me is always bare /api/admin/auth/me", () => {
    expect(bffAdminAuthMeUrl("http://127.0.0.1:4000")).toBe(
      "http://127.0.0.1:4000/api/admin/auth/me",
    );
    expect(bffAdminAuthMeUrl("http://127.0.0.1:4000/")).toBe(
      "http://127.0.0.1:4000/api/admin/auth/me",
    );
  });

  it("does not treat tenant SPA routes as slugs", () => {
    expect(
      bffAuthMeUrl({
        bffUrl: "http://127.0.0.1:4000",
        refererPath: "/chat",
        devTenantSlug: "mocklab",
      }),
    ).toBe("http://127.0.0.1:4000/mocklab/api/auth/me");
  });
});
