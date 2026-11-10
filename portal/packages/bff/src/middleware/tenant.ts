import { isPlatformAdminApiPath, resolveTenantSlug } from "@lanyard/shared";
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

import {
  CONNECTOR_OAUTH_DEFERRED_TENANT,
  OFFICE_DS_DEFERRED_TENANT,
  type BffBindings,
  type BffVariables,
} from "../types.js";

/**
 * Document Server hits these BFF paths with capability tokens (download token
 * or callback nonce), not browser cookies. DS typically uses
 * BFF_OFFICE_PUBLIC_BASE_URL (e.g. http://host.docker.internal:4000) and does
 * not send a tenant Host header. Tenant must come from the session after
 * token/nonce verification — not from Host middleware (lp-xcu.1).
 *
 * Matches both `/api/office/...` and `/{slug}/api/office/...`.
 */
export function isOfficeDocumentServerPath(pathname: string): boolean {
  const path = (pathname.split("?")[0] ?? pathname).replace(/\/+$/, "") || "/";
  if (/(?:^|\/)api\/office\/callback$/.test(path)) {
    return true;
  }
  if (/(?:^|\/)api\/office\/sessions\/[^/]+\/content$/.test(path)) {
    return true;
  }
  return false;
}

export function isConnectorOAuthCallbackPath(pathname: string): boolean {
  const path = (pathname.split("?")[0] ?? pathname).replace(/\/+$/, "") || "/";
  return /(?:^|\/)api\/connectors\/[^/]+\/oauth\/callback$/.test(path);
}

export function createTenantMiddleware(
  bindings: BffBindings,
): MiddlewareHandler<{ Variables: BffVariables }> {
  return async (c, next) => {
    const host = c.req.header("host");
    // Full path (includes /:tenantSlug/api/... when path-mounted)
    let pathname = c.req.path;
    try {
      pathname = new URL(c.req.url).pathname;
    } catch {
      // keep c.req.path
    }

    if (isPlatformAdminApiPath(pathname)) {
      throw new HTTPException(404, { message: "Not found" });
    }

    const slug = resolveTenantSlug({
      hostHeader: host,
      pathname,
      devTenantSlug: bindings.devTenantSlug,
      appHosts: bindings.appHosts,
    });

    if (!slug) {
      // lp-xcu.1: DS download/callback authenticate via session token/nonce.
      // Defer tenant attachment; handlers resolve tenant_id from the session.
      if (isOfficeDocumentServerPath(pathname)) {
        c.set("tenant", OFFICE_DS_DEFERRED_TENANT);
        c.set("officeTenantDeferred", true);
        c.set("connectorOAuthTenantDeferred", false);
        await next();
        return;
      }
      // lp-xhf4.18: bare APP_HOST OAuth callback with signed state.
      if (isConnectorOAuthCallbackPath(pathname)) {
        c.set("tenant", CONNECTOR_OAUTH_DEFERRED_TENANT);
        c.set("officeTenantDeferred", false);
        c.set("connectorOAuthTenantDeferred", true);
        await next();
        return;
      }
      throw new HTTPException(404, {
        message:
          "Unknown tenant. Use https://app.withlanyard.com/<tenant>/…, legacy https://<tenant>.withlanyard.com, or set DEV_TENANT_SLUG for localhost.",
      });
    }

    const tenant = await bindings.tenantResolver.resolveBySlug(slug);
    if (!tenant) {
      throw new HTTPException(404, {
        message: `Unknown tenant: ${slug}`,
      });
    }

    c.set("tenant", tenant);
    c.set("officeTenantDeferred", false);
    c.set("connectorOAuthTenantDeferred", false);
    await next();
  };
}
