/**
 * Read-only retention gate for future interaction export jobs (slice 17 / Core#19).
 * Default: do not persist message bodies to long-term Lanyard stores.
 */

export type ShouldPersistInteractionOptions = {
  controlPlaneUrl?: string;
  internalOpsToken?: string;
  /** Fallback when control plane is unreachable or not configured. */
  defaultEnabled?: boolean;
};

export type TenantRetentionSnapshot = {
  tenant_id: string;
  interaction_export_enabled: boolean;
  retention_mode: string;
  /** L10 chat corpus (lp-gkh.6); optional for older CP responses. */
  chat_corpus_enabled?: boolean;
  chat_corpus_retention_days?: number | null;
};

function resolveDefaultEnabled(
  options?: ShouldPersistInteractionOptions,
): boolean {
  if (options?.defaultEnabled !== undefined) {
    return options.defaultEnabled;
  }
  return process.env.RELAY_INTERACTION_EXPORT_DEFAULT === "true";
}

export async function fetchTenantRetention(
  tenantId: string,
  options: ShouldPersistInteractionOptions = {},
): Promise<TenantRetentionSnapshot | null> {
  const baseUrl = (
    options.controlPlaneUrl ?? process.env.CONTROL_PLANE_URL
  )?.replace(/\/$/, "");
  if (!baseUrl) {
    return null;
  }

  const token = options.internalOpsToken ?? process.env.INTERNAL_OPS_TOKEN;
  const headers: Record<string, string> = {};
  if (token) {
    headers["x-internal-ops-token"] = token;
  }

  const response = await fetch(
    `${baseUrl}/internal/tenants/${tenantId}/retention`,
    { headers },
  );
  if (!response.ok) {
    return null;
  }

  return (await response.json()) as TenantRetentionSnapshot;
}

/**
 * Returns true only when Lanyard ops has enabled interaction export for the tenant.
 * Safe default: false (no export / no long-term storage).
 */
export async function shouldPersistInteraction(
  tenantId: string,
  options: ShouldPersistInteractionOptions = {},
): Promise<boolean> {
  try {
    const policy = await fetchTenantRetention(tenantId, options);
    if (!policy) {
      return resolveDefaultEnabled(options);
    }
    return policy.interaction_export_enabled === true;
  } catch {
    return resolveDefaultEnabled(options);
  }
}