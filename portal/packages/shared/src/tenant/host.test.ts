import { describe, expect, it } from "vitest";

import {
  APP_HOST,
  PLATFORM_ADMIN_PATH_SEGMENT,
  defaultAppHosts,
  mergeAppHosts,
  parseTenantSlugFromHost,
  parseTenantSlugFromPath,
  resolveTenantSlug,
  tenantHost,
  tenantPortalUrl,
  tenantSubdomainHost,
} from "./host.js";

describe("tenantHost / portal URL", () => {
  it("tenantHost returns subdomain host for Host-header identity", () => {
    expect(tenantHost("acme")).toBe("acme.withlanyard.com");
  });

  it("tenantPortalUrl is path-based", () => {
    expect(tenantPortalUrl("acme")).toBe("https://app.withlanyard.com/acme");
  });

  it("tenantSubdomainHost matches tenantHost", () => {
    expect(tenantSubdomainHost("acme")).toBe(tenantHost("acme"));
  });
});

describe("parseTenantSlugFromHost", () => {
  it("parses production subdomain", () => {
    expect(parseTenantSlugFromHost("acme.withlanyard.com")).toBe("acme");
    expect(parseTenantSlugFromHost("Acme.WithLanyard.com:443")).toBe("acme");
  });

  it("parses *.localhost", () => {
    expect(parseTenantSlugFromHost("demo.localhost:4000")).toBe("demo");
  });

  it("uses devTenantSlug on bare localhost", () => {
    expect(
      parseTenantSlugFromHost("localhost:4000", { devTenantSlug: "demo" }),
    ).toBe("demo");
    expect(parseTenantSlugFromHost("127.0.0.1", { devTenantSlug: "demo" })).toBe(
      "demo",
    );
  });

  it("rejects apex and multi-label hosts", () => {
    expect(parseTenantSlugFromHost("withlanyard.com")).toBeNull();
    expect(parseTenantSlugFromHost("localhost")).toBeNull();
    expect(parseTenantSlugFromHost("foo.bar.withlanyard.com")).toBeNull();
  });

  it("does not treat app.withlanyard.com as a tenant subdomain", () => {
    expect(parseTenantSlugFromHost("app.withlanyard.com")).toBeNull();
    expect(parseTenantSlugFromHost("www.withlanyard.com")).toBeNull();
    expect(parseTenantSlugFromHost("relay.withlanyard.com")).toBeNull();
  });
});

describe("parseTenantSlugFromPath", () => {
  it("reads first segment", () => {
    expect(parseTenantSlugFromPath("/acme")).toBe("acme");
    expect(parseTenantSlugFromPath("/acme/")).toBe("acme");
    expect(parseTenantSlugFromPath("/acme/api/context")).toBe("acme");
  });

  it("rejects reserved and invalid segments", () => {
    expect(parseTenantSlugFromPath("/api/context")).toBeNull();
    expect(parseTenantSlugFromPath("/health")).toBeNull();
    expect(parseTenantSlugFromPath("/login")).toBeNull();
    expect(parseTenantSlugFromPath("/chat")).toBeNull();
    expect(parseTenantSlugFromPath("/vault")).toBeNull();
    expect(parseTenantSlugFromPath("/settings")).toBeNull();
    expect(PLATFORM_ADMIN_PATH_SEGMENT).toBe("admin");
    expect(parseTenantSlugFromPath("/admin")).toBeNull();
    expect(parseTenantSlugFromPath("/admin/api/connectors")).toBeNull();
    expect(parseTenantSlugFromPath("/")).toBeNull();
    expect(parseTenantSlugFromPath("/Acme_Corp")).toBeNull();
  });
});

describe("resolveTenantSlug", () => {
  it("prefers subdomain when present", () => {
    expect(
      resolveTenantSlug({
        hostHeader: "demo.withlanyard.com",
        pathname: "/other/api",
      }),
    ).toBe("demo");
  });

  it("uses path on app host", () => {
    expect(
      resolveTenantSlug({
        hostHeader: "app.withlanyard.com",
        pathname: "/acme/api/context",
      }),
    ).toBe("acme");
  });

  it("uses path on localhost app host", () => {
    expect(
      resolveTenantSlug({
        hostHeader: "localhost:4000",
        pathname: "/acme/api/context",
      }),
    ).toBe("acme");
  });

  it("falls back to devTenantSlug on bare localhost without path slug", () => {
    expect(
      resolveTenantSlug({
        hostHeader: "localhost:4000",
        pathname: "/api/context",
        devTenantSlug: "demo",
      }),
    ).toBe("demo");
  });

  it("returns null when neither host nor path yields a slug", () => {
    expect(
      resolveTenantSlug({
        hostHeader: "app.withlanyard.com",
        pathname: "/api/context",
      }),
    ).toBeNull();
  });

  it("uses path slug on staging CloudFront when listed in appHosts", () => {
    expect(
      resolveTenantSlug({
        hostHeader: "d1watnzk551glk.cloudfront.net",
        pathname: "/mocklab/api/context",
        appHosts: mergeAppHosts(["d1watnzk551glk.cloudfront.net"]),
      }),
    ).toBe("mocklab");
  });

  it("uses path slug on example.cloudfront.net when listed in appHosts", () => {
    expect(
      resolveTenantSlug({
        hostHeader: "example.cloudfront.net",
        pathname: "/mocklab/api/context",
        appHosts: ["example.cloudfront.net"],
      }),
    ).toBe("mocklab");
  });

  it("does not path-resolve CloudFront host when not in appHosts", () => {
    expect(
      resolveTenantSlug({
        hostHeader: "d1watnzk551glk.cloudfront.net",
        pathname: "/mocklab/api/context",
      }),
    ).toBeNull();
    expect(
      resolveTenantSlug({
        hostHeader: "example.cloudfront.net",
        pathname: "/mocklab/api/context",
      }),
    ).toBeNull();
  });
});

describe("defaultAppHosts / mergeAppHosts", () => {
  it("includes production app host and localhost variants", () => {
    expect(defaultAppHosts()).toEqual([
      APP_HOST,
      "app.localhost",
      "localhost",
      "127.0.0.1",
      "::1",
    ]);
  });

  it("merges extras without dropping defaults", () => {
    const merged = mergeAppHosts(["d1watnzk551glk.cloudfront.net", APP_HOST]);
    expect(merged).toContain(APP_HOST);
    expect(merged).toContain("localhost");
    expect(merged).toContain("d1watnzk551glk.cloudfront.net");
    expect(merged.filter((h) => h === APP_HOST)).toHaveLength(1);
  });
});
