/**
 * Canonical OAuth redirect origin (lp-p37.8).
 *
 * Never trust the raw Host header alone for Google OAuth redirect_uri —
 * an attacker-controlled Host can mint a state payload / redirect_uri that
 * points off our allowlist. Origin is accepted only when the request host
 * matches the tenant/app host allowlist; otherwise we fall back to the
 * control-plane tenant host (or reject when that is also unusable).
 */

import { APP_HOST, stripHostPort, tenantHost } from "@lanyard/shared";

export type ResolveOAuthRedirectOriginInput = {
  /** Raw Host header (may include port). */
  hostHeader?: string;
  /** Control-plane tenant host (e.g. alpha.withlanyard.com or app.withlanyard.com). */
  tenantHost: string;
  tenantSlug: string;
  /** Path-first app hosts (APP_HOSTS + defaults). */
  appHosts: readonly string[];
  /** When true, use https; otherwise http (local / non-secureCookies). */
  secureCookies: boolean;
};

export type ResolveOAuthRedirectOriginResult =
  | { ok: true; origin: string; host: string }
  | { ok: false; reason: "host_not_allowlisted" | "no_canonical_host" };

function normalizeHost(value: string): string {
  return stripHostPort(value).toLowerCase();
}

/**
 * True when `host` (no port) is an allowed OAuth redirect host for this tenant.
 *
 * Structural allowlist only — never "whatever tenant.host says" unless that
 * value itself matches a known portal pattern (app host, `{slug}.withlanyard.com`,
 * `{slug}.localhost`, or APP_HOST).
 */
export function isOAuthRedirectHostAllowed(
  hostNoPort: string,
  input: Pick<
    ResolveOAuthRedirectOriginInput,
    "tenantHost" | "tenantSlug" | "appHosts"
  >,
): boolean {
  const host = hostNoPort.toLowerCase();
  if (!host) {
    return false;
  }

  const appHosts = input.appHosts.map((h) => normalizeHost(h));
  if (appHosts.includes(host)) {
    return true;
  }

  // Production path-first apex always allowed even if appHosts was overridden empty.
  if (host === APP_HOST) {
    return true;
  }

  const slug = input.tenantSlug.trim().toLowerCase();
  if (slug) {
    // Legacy subdomain production host.
    if (host === tenantHost(slug)) {
      return true;
    }
    // Local hosts-file / proxy form.
    if (host === `${slug}.localhost`) {
      return true;
    }
  }

  // tenant.host is only accepted when it is itself a known pattern (above).
  // Do not treat arbitrary control-plane host strings as allowlisted.
  return false;
}

/**
 * Resolve the scheme+host origin used for Google OAuth redirect_uri.
 *
 * - If Host is on the allowlist, use it (preserving port for local :4000).
 * - If Host is missing or spoofed, fall back to tenant.host (no port).
 * - Reject only when neither Host nor tenant.host is allowlisted.
 */
export function resolveOAuthRedirectOrigin(
  input: ResolveOAuthRedirectOriginInput,
): ResolveOAuthRedirectOriginResult {
  const protocol = input.secureCookies ? "https" : "http";
  const rawHost = input.hostHeader?.trim();

  if (rawHost) {
    const hostNoPort = normalizeHost(rawHost);
    if (isOAuthRedirectHostAllowed(hostNoPort, input)) {
      // Preserve port for local dev (localhost:4000) when present.
      const hostForUri = rawHost.trim().toLowerCase().startsWith("[")
        ? rawHost.trim()
        : rawHost.trim();
      // Normalize hostname case but keep port as sent.
      const portSep = hostForUri.lastIndexOf(":");
      let hostOut = hostForUri;
      if (
        portSep > 0 &&
        !hostForUri.startsWith("[") &&
        hostForUri.indexOf(":") === portSep
      ) {
        const name = hostForUri.slice(0, portSep).toLowerCase();
        const port = hostForUri.slice(portSep + 1);
        hostOut = `${name}:${port}`;
      } else if (!hostForUri.startsWith("[")) {
        hostOut = hostForUri.toLowerCase();
      }
      return {
        ok: true,
        host: hostOut,
        origin: `${protocol}://${hostOut}`,
      };
    }
    // Spoofed Host — do not use it. Fall through to tenant host.
  }

  const fallback = normalizeHost(input.tenantHost);
  if (fallback && isOAuthRedirectHostAllowed(fallback, input)) {
    return {
      ok: true,
      host: fallback,
      origin: `${protocol}://${fallback}`,
    };
  }

  if (rawHost) {
    return { ok: false, reason: "host_not_allowlisted" };
  }
  return { ok: false, reason: "no_canonical_host" };
}
