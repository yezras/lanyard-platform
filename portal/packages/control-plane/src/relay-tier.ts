import type { RelayTier } from "./types.js";

export const DEFAULT_SHARED_RELAY_WSS_URL = "wss://relay.withlanyard.com";

export type TenantRelayRouting = {
  tenant_slug: string;
  relay_tier: RelayTier;
  dedicated_relay_wss_url: string | null;
};

/**
 * Convention for Tier 3 dedicated relay hosts when ops does not set an override.
 * Example: acme-corp → wss://relay-acme-corp.withlanyard.com
 */
export function dedicatedRelayWssUrlForSlug(
  tenant_slug: string,
  hostSuffix = "withlanyard.com",
): string {
  const slug = tenant_slug.trim().toLowerCase();
  return `wss://relay-${slug}.${hostSuffix}`;
}

export function resolveTenantRelayWssUrl(
  tenant: TenantRelayRouting,
  sharedRelayWssUrl: string = DEFAULT_SHARED_RELAY_WSS_URL,
): string {
  if (tenant.relay_tier === "shared") {
    return sharedRelayWssUrl;
  }

  const override = tenant.dedicated_relay_wss_url?.trim();
  if (override) {
    return override;
  }

  return dedicatedRelayWssUrlForSlug(tenant.tenant_slug);
}