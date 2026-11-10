/**
 * Path-based MVP: UI + API live under /<tenantSlug>/…
 * Legacy subdomain tenants keep root /api.
 */

import { PLATFORM_ADMIN_PATH_SEGMENT } from "@lanyard/shared";

const RESERVED = new Set([
  "api",
  "health",
  "assets",
  "static",
  "public",
  "src",
  "chat",
  "vault",
  "settings",
  "stories",
  "favicon.ico",
  "robots.txt",
  PLATFORM_ADMIN_PATH_SEGMENT,
]);

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export type TenantBaseLocation = {
  hostname: string;
  pathname: string;
};

/** True when the path first segment is reserved (not a tenant slug). */
export function isReservedPathSegment(segment: string): boolean {
  return RESERVED.has(segment.toLowerCase());
}

/**
 * Whether a request path should be proxied to the BFF as path-tenant API
 * (`/<tenant>/api/...`). Reserved first segments (e.g. `src`) must not proxy
 * so Vite can serve modules under `/src/api/*`.
 */
export function shouldProxyTenantApiPath(pathname: string): boolean {
  const pathOnly = pathname.split("?")[0] ?? pathname;
  const parts = pathOnly.split("/").filter(Boolean);
  if (parts.length < 2 || parts[1]!.toLowerCase() !== "api") {
    return false;
  }
  return parseTenantSlugFromPathname(`/${parts[0]}`) !== null;
}

/** Parse tenant slug from a browser pathname (first segment). */
export function parseTenantSlugFromPathname(pathname: string): string | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  const candidate = parts[0]!.toLowerCase();
  if (isReservedPathSegment(candidate) || !SLUG_RE.test(candidate)) {
    return null;
  }
  return candidate;
}

/**
 * True when Host is a path-based app apex (UI/API under `/<slug>/…`),
 * not a legacy `{slug}.withlanyard.com` / `{slug}.localhost` host.
 *
 * Includes production apex, localhost, CloudFront staging edges, and other
 * non-legacy hosts. BFF still gates tenancy via APP_HOSTS; the SPA only needs
 * to know whether the first path segment is the tenant slug for fetch URLs.
 */
export function isPathBasedAppHost(hostname: string): boolean {
  if (!hostname) {
    return false;
  }
  const host = hostname.toLowerCase().split(":")[0] ?? hostname;
  // Legacy subdomain hosts: acme.withlanyard.com / demo.localhost
  if (
    host.endsWith(".withlanyard.com") &&
    host !== "withlanyard.com" &&
    host !== "app.withlanyard.com"
  ) {
    return false;
  }
  if (
    host.endsWith(".localhost") &&
    host !== "localhost" &&
    host !== "app.localhost"
  ) {
    return false;
  }
  // Apex, localhost, CloudFront (*.cloudfront.net), custom staging domains.
  return true;
}

/**
 * API prefix for fetch paths.
 * - Path tenant: `/acme/api`
 * - Subdomain / no slug: `/api`
 */
export function apiPrefix(loc: TenantBaseLocation = currentLocation()): string {
  if (!isPathBasedAppHost(loc.hostname)) {
    return "/api";
  }
  const slug = parseTenantSlugFromPathname(loc.pathname);
  if (!slug) {
    return "/api";
  }
  return `/${slug}/api`;
}

/** Prefix a path that starts with `/api` for the current tenant base. */
export function withApiBase(
  path: string,
  loc: TenantBaseLocation = currentLocation(),
): string {
  if (!path.startsWith("/api")) {
    return path;
  }
  const prefix = apiPrefix(loc);
  if (prefix === "/api") {
    return path;
  }
  return `${prefix}${path.slice("/api".length)}`;
}

/** UI base path (`/acme` or ``). */
export function uiBasePath(loc: TenantBaseLocation = currentLocation()): string {
  if (!isPathBasedAppHost(loc.hostname)) {
    return "";
  }
  const slug = parseTenantSlugFromPathname(loc.pathname);
  return slug ? `/${slug}` : "";
}

/**
 * Bidirectional location rewrite for path-tenant UI (`/mocklab/chat` ↔ `/chat`).
 *
 * TanStack Start's `hydrateStart` always resets `router.basepath` to
 * `process.env.TSS_ROUTER_BASEPATH` (empty for the static portal-web pack).
 * That clobbers `createRouter({ basepath: uiBasePath() })` and leaves
 * `/<tenant>/*` unmatched → client "Not Found" + React hydration #418.
 *
 * `rewrite` survives that update, so path tenants must use this instead of
 * the `basepath` option. See lp-zuh.12.6.
 */
export function tenantUiLocationRewrite(): {
  input: (args: { url: URL }) => URL | undefined;
  output: (args: { url: URL }) => URL | undefined;
} {
  return {
    input: ({ url }) => {
      const base = uiBasePath({
        hostname: url.hostname,
        pathname: url.pathname,
      });
      if (!base) {
        return undefined;
      }
      const pathname = url.pathname;
      if (pathname === base || pathname === `${base}/`) {
        url.pathname = "/";
        return url;
      }
      if (pathname.startsWith(`${base}/`)) {
        url.pathname = pathname.slice(base.length) || "/";
        return url;
      }
      return undefined;
    },
    output: ({ url }) => {
      // Internal routes are `/chat`-style; tenant prefix comes from the
      // browser location (still under `/<slug>/…` while navigating).
      const base = uiBasePath(currentLocation());
      if (!base) {
        return undefined;
      }
      if (url.pathname === base || url.pathname.startsWith(`${base}/`)) {
        return undefined;
      }
      url.pathname = `${base}${url.pathname === "/" ? "" : url.pathname}`;
      return url;
    },
  };
}

function currentLocation(): TenantBaseLocation {
  if (typeof window === "undefined") {
    return { hostname: "localhost", pathname: "/" };
  }
  return {
    hostname: window.location.hostname,
    pathname: window.location.pathname,
  };
}
