import { CONTROL_PLANE_SERVICE_TOKEN_HEADER } from "./control-plane-client.js";
import { parseOptionalChatDelivery } from "./config.js";
import type { TenantContext, TenantResolver } from "./types.js";

type ControlPlaneTenant = {
  tenant_id: string;
  tenant_slug: string;
  display_name: string;
  host: string;
  chat_delivery?: string | null;
};

export type HttpTenantResolverOptions = {
  /** G1.2 service credential — preferred for all BFF → CP calls. */
  serviceToken?: string;
  /** Optional ops token (elevated routes / legacy). */
  internalToken?: string;
};

export function createHttpTenantResolver(
  controlPlaneUrl: string,
  options: HttpTenantResolverOptions = {},
): TenantResolver {
  const baseUrl = controlPlaneUrl.replace(/\/$/, "");
  const serviceToken = options.serviceToken?.trim() || undefined;
  const internalToken = options.internalToken?.trim() || undefined;

  return {
    async resolveBySlug(slug: string): Promise<TenantContext | null> {
      const url = `${baseUrl}/internal/tenants/by-slug/${encodeURIComponent(slug)}`;
      const headers: Record<string, string> = { accept: "application/json" };
      if (serviceToken) {
        headers[CONTROL_PLANE_SERVICE_TOKEN_HEADER] = serviceToken;
      }
      if (internalToken) {
        headers["x-internal-ops-token"] = internalToken;
      }
      const response = await fetch(url, {
        headers,
      });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new Error(
          `Control plane tenant lookup failed (${response.status}) for slug "${slug}"`,
        );
      }

      const tenant = (await response.json()) as ControlPlaneTenant;
      return {
        tenant_id: tenant.tenant_id,
        tenant_slug: tenant.tenant_slug,
        display_name: tenant.display_name,
        host: tenant.host,
        // lp-k5c4.13: deprecated — request path ignores this; kept for rollback/honesty
        chat_delivery: parseOptionalChatDelivery(tenant.chat_delivery),
      };
    },
    async resolveById(id: string): Promise<TenantContext | null> {
      const url = `${baseUrl}/internal/tenants/by-id/${encodeURIComponent(id)}`;
      const headers: Record<string, string> = { accept: "application/json" };
      if (serviceToken) {
        headers[CONTROL_PLANE_SERVICE_TOKEN_HEADER] = serviceToken;
      }
      if (internalToken) {
        headers["x-internal-ops-token"] = internalToken;
      }
      const response = await fetch(url, {
        headers,
      });

      if (response.status === 404) {
        return null;
      }

      if (!response.ok) {
        throw new Error(
          `Control plane tenant lookup failed (${response.status}) for id "${id}"`,
        );
      }

      const tenant = (await response.json()) as ControlPlaneTenant;
      return {
        tenant_id: tenant.tenant_id,
        tenant_slug: tenant.tenant_slug,
        display_name: tenant.display_name,
        host: tenant.host,
        // lp-k5c4.13: deprecated — request path ignores this; kept for rollback/honesty
        chat_delivery: parseOptionalChatDelivery(tenant.chat_delivery),
      };
    },
  };
}