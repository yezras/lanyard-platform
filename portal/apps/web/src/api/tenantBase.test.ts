import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  apiPrefix,
  isPathBasedAppHost,
  isReservedPathSegment,
  parseTenantSlugFromPathname,
  shouldProxyTenantApiPath,
  tenantUiLocationRewrite,
  uiBasePath,
  withApiBase,
} from "./tenantBase.js";

describe("parseTenantSlugFromPathname", () => {
  it("reads first segment", () => {
    expect(parseTenantSlugFromPathname("/acme")).toBe("acme");
    expect(parseTenantSlugFromPathname("/acme/chat")).toBe("acme");
  });

  it("rejects reserved", () => {
    expect(parseTenantSlugFromPathname("/api/auth")).toBeNull();
    expect(parseTenantSlugFromPathname("/src/api/client.ts")).toBeNull();
    expect(parseTenantSlugFromPathname("/admin")).toBeNull();
    expect(parseTenantSlugFromPathname("/admin/secrets")).toBeNull();
    expect(parseTenantSlugFromPathname("/")).toBeNull();
  });
});

describe("isReservedPathSegment", () => {
  it("flags vite and app segments", () => {
    expect(isReservedPathSegment("src")).toBe(true);
    expect(isReservedPathSegment("chat")).toBe(true);
    expect(isReservedPathSegment("vault")).toBe(true);
    expect(isReservedPathSegment("settings")).toBe(true);
    expect(isReservedPathSegment("stories")).toBe(true);
    expect(isReservedPathSegment("API")).toBe(true);
    expect(isReservedPathSegment("assets")).toBe(true);
    expect(isReservedPathSegment("static")).toBe(true);
    expect(isReservedPathSegment("public")).toBe(true);
    expect(isReservedPathSegment("health")).toBe(true);
    expect(isReservedPathSegment("admin")).toBe(true);
    expect(isReservedPathSegment("demo")).toBe(false);
    expect(isReservedPathSegment("acme")).toBe(false);
  });
});

describe("shouldProxyTenantApiPath", () => {
  it("proxies real tenant API paths", () => {
    expect(shouldProxyTenantApiPath("/demo/api/auth/csrf")).toBe(true);
    expect(shouldProxyTenantApiPath("/demo/api/health")).toBe(true);
    expect(shouldProxyTenantApiPath("/acme/api/projects")).toBe(true);
  });

  it("does not proxy reserved first segments (Vite modules)", () => {
    expect(shouldProxyTenantApiPath("/src/api/client.ts")).toBe(false);
    expect(shouldProxyTenantApiPath("/src/api/auth.ts")).toBe(false);
    expect(shouldProxyTenantApiPath("/src/api/tenantBase.ts")).toBe(false);
    expect(shouldProxyTenantApiPath("/assets/api/x")).toBe(false);
    expect(shouldProxyTenantApiPath("/public/api/x")).toBe(false);
    expect(shouldProxyTenantApiPath("/static/api/x")).toBe(false);
    expect(shouldProxyTenantApiPath("/health/api/x")).toBe(false);
  });

  it("ignores non-api second segments and root /api", () => {
    expect(shouldProxyTenantApiPath("/demo/chat")).toBe(false);
    // Root /api is handled by a separate Vite proxy rule ("/api"), not this helper.
    expect(shouldProxyTenantApiPath("/api/auth")).toBe(false);
  });

  it("rejects empty, invalid, and incomplete paths", () => {
    expect(shouldProxyTenantApiPath("")).toBe(false);
    expect(shouldProxyTenantApiPath("/")).toBe(false);
    expect(shouldProxyTenantApiPath("/api")).toBe(false);
    expect(shouldProxyTenantApiPath("/demo")).toBe(false);
    expect(shouldProxyTenantApiPath("/demo/")).toBe(false);
    // Invalid slug shape (uppercase / underscore) must not proxy.
    expect(shouldProxyTenantApiPath("/Bad_Slug/api/x")).toBe(false);
    expect(shouldProxyTenantApiPath("/-bad/api/x")).toBe(false);
  });

  it("strips query string before matching", () => {
    expect(shouldProxyTenantApiPath("/demo/api/health?x=1")).toBe(true);
    expect(shouldProxyTenantApiPath("/src/api/client.ts?v=1")).toBe(false);
  });
});

// Regression: Vite's path-tenant proxy regex ^/[a-z0-9][a-z0-9-]*/api
// also matches /src/api/*. Without the reserved-segment bypass, the BFF
// returns text/plain 404 for source modules and the browser MIME-errors.
// These cases must stay green so the collision cannot return silently.
describe("regression: vite path-tenant proxy must not steal /src/api", () => {
  it("must not proxy /src/api/* module paths", () => {
    expect(shouldProxyTenantApiPath("/src/api/client.ts")).toBe(false);
    expect(shouldProxyTenantApiPath("/src/api/auth.ts")).toBe(false);
    expect(shouldProxyTenantApiPath("/src/api/tenantBase.ts")).toBe(false);
  });

  it("must proxy real path-tenant API under /demo/api/*", () => {
    expect(shouldProxyTenantApiPath("/demo/api/health")).toBe(true);
    expect(shouldProxyTenantApiPath("/demo/api/auth/csrf")).toBe(true);
  });

  it("path-tenant helper does not own absolute /api (separate Vite rule)", () => {
    // shouldProxyTenantApiPath only decides /<tenant>/api/* bypass.
    // Absolute /api/* is proxied by vite.config's dedicated "/api" entry.
    expect(shouldProxyTenantApiPath("/api/auth/me")).toBe(false);
    expect(shouldProxyTenantApiPath("/api/auth/csrf")).toBe(false);
  });

  it("must not proxy other reserved segments that match /{seg}/api/...", () => {
    for (const seg of ["assets", "static", "public", "health", "api", "admin"]) {
      expect(shouldProxyTenantApiPath(`/${seg}/api/anything`)).toBe(false);
    }
  });
});

describe("vite.config wires shouldProxyTenantApiPath", () => {
  it("imports the shared helper (static guard, no live server)", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const viteConfig = readFileSync(join(here, "../../vite.config.ts"), "utf8");
    expect(viteConfig).toContain("shouldProxyTenantApiPath");
    expect(viteConfig).toMatch(
      /import\s*\{\s*shouldProxyTenantApiPath\s*\}\s*from\s*["']\.\/src\/api\/tenantBase["']/,
    );
  });
});

describe("isPathBasedAppHost", () => {
  it("detects app apex and localhost", () => {
    expect(isPathBasedAppHost("app.withlanyard.com")).toBe(true);
    expect(isPathBasedAppHost("localhost")).toBe(true);
  });

  it("detects staging CloudFront edge hosts as path-first", () => {
    expect(isPathBasedAppHost("d1watnzk551glk.cloudfront.net")).toBe(true);
    expect(isPathBasedAppHost("example.cloudfront.net")).toBe(true);
  });

  it("detects legacy subdomain hosts", () => {
    expect(isPathBasedAppHost("acme.withlanyard.com")).toBe(false);
    expect(isPathBasedAppHost("demo.localhost")).toBe(false);
  });
});

describe("apiPrefix / withApiBase", () => {
  it("prefixes path tenants", () => {
    const loc = { hostname: "app.withlanyard.com", pathname: "/acme/settings" };
    expect(apiPrefix(loc)).toBe("/acme/api");
    expect(withApiBase("/api/auth/csrf", loc)).toBe("/acme/api/auth/csrf");
    expect(uiBasePath(loc)).toBe("/acme");
  });

  it("prefixes path tenants on CloudFront staging host", () => {
    const loc = {
      hostname: "d1watnzk551glk.cloudfront.net",
      pathname: "/mocklab/",
    };
    expect(apiPrefix(loc)).toBe("/mocklab/api");
    expect(withApiBase("/api/auth/google", loc)).toBe(
      "/mocklab/api/auth/google",
    );
    expect(withApiBase("/api/context", loc)).toBe("/mocklab/api/context");
  });

  it("keeps root /api for subdomain", () => {
    const loc = { hostname: "acme.withlanyard.com", pathname: "/" };
    expect(apiPrefix(loc)).toBe("/api");
    expect(withApiBase("/api/projects", loc)).toBe("/api/projects");
    expect(uiBasePath(loc)).toBe("");
  });

  it("keeps root /api on localhost without path slug", () => {
    const loc = { hostname: "localhost", pathname: "/" };
    expect(apiPrefix(loc)).toBe("/api");
  });

  it("keeps root /api on the ops console so fetches hit /api/admin/*", () => {
    const loc = { hostname: "app.withlanyard.com", pathname: "/admin/secrets" };
    expect(apiPrefix(loc)).toBe("/api");
    expect(withApiBase("/api/admin/tenants", loc)).toBe("/api/admin/tenants");
    expect(uiBasePath(loc)).toBe("");
  });
});

describe("tenantUiLocationRewrite (lp-zuh.12.6)", () => {
  const origin = "https://app.withlanyard.com";

  it("strips path-tenant prefix on input so /mocklab/chat matches /chat", () => {
    const rewrite = tenantUiLocationRewrite();
    const url = new URL("/mocklab/chat", origin);
    const out = rewrite.input({ url });
    expect(out).toBeInstanceOf(URL);
    expect(out!.pathname).toBe("/chat");
  });

  it("maps bare /mocklab to /", () => {
    const rewrite = tenantUiLocationRewrite();
    const url = new URL("/mocklab", origin);
    const out = rewrite.input({ url });
    expect(out!.pathname).toBe("/");
  });

  it("leaves reserved root routes alone on input", () => {
    const rewrite = tenantUiLocationRewrite();
    const url = new URL("/chat", origin);
    expect(rewrite.input({ url })).toBeUndefined();
    expect(url.pathname).toBe("/chat");
  });

  it("leaves /admin and /admin/* as ops paths (not a tenant slug)", () => {
    const rewrite = tenantUiLocationRewrite();
    const admin = new URL("/admin", origin);
    expect(rewrite.input({ url: admin })).toBeUndefined();
    expect(admin.pathname).toBe("/admin");
    const secrets = new URL("/admin/secrets", origin);
    expect(rewrite.input({ url: secrets })).toBeUndefined();
    expect(secrets.pathname).toBe("/admin/secrets");
    const platform = new URL("/_platform", origin);
    expect(rewrite.input({ url: platform })).toBeUndefined();
    expect(platform.pathname).toBe("/_platform");
  });

  it("leaves legacy subdomain hosts alone on input", () => {
    const rewrite = tenantUiLocationRewrite();
    const url = new URL("https://acme.withlanyard.com/chat");
    expect(rewrite.input({ url })).toBeUndefined();
  });

  it("re-adds tenant prefix on output from window location", () => {
    const rewrite = tenantUiLocationRewrite();
    const prev = globalThis.window;
    // jsdom / vitest: stub window location under /mocklab
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          hostname: "app.withlanyard.com",
          pathname: "/mocklab/chat",
        },
      },
    });
    try {
      const url = new URL("/vault", origin);
      const out = rewrite.output({ url });
      expect(out!.pathname).toBe("/mocklab/vault");
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: prev,
      });
    }
  });

  it("does not double-prefix when output path already has tenant", () => {
    const rewrite = tenantUiLocationRewrite();
    const prev = globalThis.window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: {
          hostname: "app.withlanyard.com",
          pathname: "/mocklab/chat",
        },
      },
    });
    try {
      const url = new URL("/mocklab/settings", origin);
      expect(rewrite.output({ url })).toBeUndefined();
    } finally {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: prev,
      });
    }
  });
});

describe("router.tsx uses rewrite not basepath (Start clobber guard)", () => {
  it("wires tenantUiLocationRewrite and avoids basepath option", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const routerSrc = readFileSync(join(here, "../router.tsx"), "utf8");
    expect(routerSrc).toContain("tenantUiLocationRewrite");
    expect(routerSrc).toMatch(/rewrite:\s*tenantUiLocationRewrite\s*\(/);
    // Start hydrateStart overwrites basepath with TSS_ROUTER_BASEPATH.
    expect(routerSrc).not.toMatch(/basepath:\s*uiBasePath/);
  });
});
