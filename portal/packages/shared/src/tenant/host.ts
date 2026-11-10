/** Production apex for path-based MVP: `app.withlanyard.com/<slug>`. */
export const APP_HOST = "app.withlanyard.com";

/** Legacy / still-supported tenant host suffix: `{slug}.withlanyard.com` */
export const TENANT_HOST_SUFFIX = "withlanyard.com";

/** First path segment for the Lanyard ops console. Never a tenant slug. */
export const PLATFORM_ADMIN_PATH_SEGMENT = "admin";

/** Path segments that must never be treated as tenant slugs. */
export const RESERVED_TENANT_PATH_SEGMENTS = new Set([
  "api",
  "health",
  "assets",
  "static",
  "public",
  "favicon.ico",
  "robots.txt",
  "_next",
  "src",
  "node_modules",
  // Tenant SPA and ops console routes. Never tenant slugs.
  "login",
  "chat",
  "vault",
  "settings",
  PLATFORM_ADMIN_PATH_SEGMENT,
]);

const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** Canonical portal entry URL (path-based MVP). */
export function tenantPortalUrl(slug: string): string {
  return `https://${APP_HOST}/${slug}`;
}

/**
 * Host header identity for a tenant (`{slug}.withlanyard.com`).
 * Used by BFF Host-based routing and API `host` field.
 * Product entry URL is path-based — see `tenantPortalUrl`.
 */
export function tenantHost(slug: string): string {
  return `${slug}.${TENANT_HOST_SUFFIX}`;
}

/** Same as tenantHost (subdomain form). */
export function tenantSubdomainHost(slug: string): string {
  return tenantHost(slug);
}

/** Strip a port from a Host header value (supports bracketed IPv6). */
export function stripHostPort(host: string): string {
  const trimmed = host.trim();
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    return end >= 0 ? trimmed.slice(1, end) : trimmed;
  }
  const colon = trimmed.lastIndexOf(":");
  if (colon > 0 && trimmed.indexOf(":") === colon) {
    return trimmed.slice(0, colon);
  }
  return trimmed;
}

export function isValidTenantSlug(slug: string): boolean {
  const s = slug.trim().toLowerCase();
  if (!s || RESERVED_TENANT_PATH_SEGMENTS.has(s)) {
    return false;
  }
  return SLUG_RE.test(s);
}

export type ParseTenantSlugOptions = {
  /** When Host is localhost/127.0.0.1, use this slug (BFF `DEV_TENANT_SLUG`). */
  devTenantSlug?: string;
  /**
   * Hostnames that serve path-based multi-tenant UI/API
   * (default: app.withlanyard.com, plus localhost variants).
   */
  appHosts?: string[];
};

/**
 * Hostnames that serve path-based multi-tenant UI/API by default.
 * Staging CloudFront (etc.) is added via BFF `APP_HOSTS` / `appHosts`.
 */
export function defaultAppHosts(): string[] {
  return [APP_HOST, "app.localhost", "localhost", "127.0.0.1", "::1"];
}

/**
 * Merge extra app-host names with {@link defaultAppHosts} (case-insensitive,
 * port-stripped, de-duplicated). Empty/undefined extras → defaults only.
 */
export function mergeAppHosts(extra?: readonly string[] | null): string[] {
  const base = defaultAppHosts();
  if (!extra?.length) {
    return base;
  }
  const seen = new Set(base.map((h) => h.toLowerCase()));
  const out = [...base];
  for (const raw of extra) {
    const host = stripHostPort(raw.trim()).toLowerCase();
    if (!host || seen.has(host)) {
      continue;
    }
    seen.add(host);
    out.push(host);
  }
  return out;
}

/**
 * Extract tenant slug from a URL path for path-based routing.
 *
 * Supported:
 * - `/<slug>`
 * - `/<slug>/...`
 * - `/<slug>/api/...` (BFF under path prefix)
 */
export function parseTenantSlugFromPath(pathname: string): string | null {
  if (!pathname) {
    return null;
  }
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  const candidate = parts[0].toLowerCase();
  if (!isValidTenantSlug(candidate)) {
    return null;
  }
  return candidate;
}

/**
 * Extract tenant slug from the HTTP Host header (legacy subdomain + local).
 *
 * Supported patterns:
 * - `{slug}.withlanyard.com` (legacy production)
 * - `{slug}.localhost` (hosts-file / local proxy)
 * - `localhost` / `127.0.0.1` with `devTenantSlug` (local bypass)
 */
export function parseTenantSlugFromHost(
  hostHeader: string | undefined,
  options: ParseTenantSlugOptions = {},
): string | null {
  if (!hostHeader) {
    return null;
  }

  const host = stripHostPort(hostHeader).toLowerCase();

  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    const slug = options.devTenantSlug?.trim().toLowerCase();
    return slug && isValidTenantSlug(slug) ? slug : null;
  }

  if (host.endsWith(".localhost")) {
    const slug = host.slice(0, -".localhost".length);
    return isValidTenantSlug(slug) ? slug : null;
  }

  const suffix = `.${TENANT_HOST_SUFFIX}`;
  if (host.endsWith(suffix)) {
    const slug = host.slice(0, -suffix.length);
    if (!slug || slug.includes(".")) {
      return null;
    }
    // app.withlanyard.com is the path-based apex — not a tenant subdomain
    if (slug === "app" || slug === "www" || slug === "relay") {
      return null;
    }
    return isValidTenantSlug(slug) ? slug : null;
  }

  return null;
}

export type ResolveTenantSlugInput = {
  hostHeader?: string;
  pathname?: string;
  devTenantSlug?: string;
  appHosts?: string[];
};

/**
 * Resolve tenant slug with path-first MVP on app hosts, subdomain fallback.
 *
 * Order:
 * 1. Subdomain slug when Host is `{slug}.withlanyard.com` (legacy)
 * 2. First path segment when Host is an app host (`app.withlanyard.com`, localhost, …)
 * 3. `devTenantSlug` on bare localhost
 */
export function resolveTenantSlug(input: ResolveTenantSlugInput): string | null {
  const hostSlug = parseTenantSlugFromHost(input.hostHeader, {
    devTenantSlug: undefined, // path/dev handled below
  });
  if (hostSlug) {
    return hostSlug;
  }

  const host = input.hostHeader
    ? stripHostPort(input.hostHeader).toLowerCase()
    : "";
  const appHosts = (input.appHosts ?? defaultAppHosts()).map((h) =>
    h.toLowerCase(),
  );
  const onAppHost = appHosts.includes(host);

  if (onAppHost && input.pathname) {
    const pathSlug = parseTenantSlugFromPath(input.pathname);
    if (pathSlug) {
      return pathSlug;
    }
  }

  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    const slug = input.devTenantSlug?.trim().toLowerCase();
    return slug && isValidTenantSlug(slug) ? slug : null;
  }

  return null;
}
