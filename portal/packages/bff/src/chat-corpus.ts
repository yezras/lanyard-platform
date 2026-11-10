/**
 * L10 chat corpus enablement gate (plan 0011 / lp-gkh.6).
 *
 * BFF reads `chat_corpus_enabled` from the control-plane tenant retention API
 * (`GET /internal/tenants/:id/retention`) — the same path Relay uses for L5.
 * Fail closed: default false when CP is missing, unreachable, or flag is off.
 *
 * Capture tee (lp-gkh.5): {@link ./chat-corpus-capture.js} buffers user input
 * after POST …/messages and writes via CorpusWriter when assistant outbound is
 * known on the SSE path. It must call `shouldWriteChatCorpus` before full-body
 * S3 puts. Chat request path fails open on write failure (separate from this
 * enablement gate). Metric on failure: `chat_corpus_write_failed`.
 */

export type ChatCorpusGateOptions = {
  controlPlaneUrl?: string;
  /**
   * Ops token for retention route (`x-internal-ops-token`).
   * Retention endpoints require INTERNAL_OPS_TOKEN (not service token alone).
   */
  internalOpsToken?: string;
  /**
   * Fallback when control plane is unreachable or not configured.
   * Must stay false in production (fail closed).
   */
  defaultEnabled?: boolean;
};

export type TenantChatCorpusSnapshot = {
  tenant_id: string;
  interaction_export_enabled?: boolean;
  retention_mode?: string;
  chat_corpus_enabled: boolean;
  chat_corpus_retention_days: number | null;
};

/** Policy default when L10 is enabled and retention_days is null. */
export const DEFAULT_CHAT_CORPUS_RETENTION_DAYS = 90;

function resolveDefaultEnabled(options?: ChatCorpusGateOptions): boolean {
  if (options?.defaultEnabled !== undefined) {
    return options.defaultEnabled;
  }
  // Env override is for lab only; production must leave unset / false.
  return process.env.BFF_CHAT_CORPUS_DEFAULT === "true";
}

/**
 * Fetch tenant retention snapshot (L5 + L10 fields) from control plane.
 * Returns null when CP URL is missing or the request fails.
 */
export async function fetchTenantChatCorpusPolicy(
  tenantId: string,
  options: ChatCorpusGateOptions = {},
): Promise<TenantChatCorpusSnapshot | null> {
  const baseUrl = (
    options.controlPlaneUrl ?? process.env.CONTROL_PLANE_URL
  )?.replace(/\/$/, "");
  if (!baseUrl) {
    return null;
  }

  const token =
    options.internalOpsToken ??
    process.env.CONTROL_PLANE_INTERNAL_TOKEN ??
    process.env.INTERNAL_OPS_TOKEN;
  const headers: Record<string, string> = {};
  if (token) {
    headers["x-internal-ops-token"] = token;
  }

  const response = await fetch(
    `${baseUrl}/internal/tenants/${encodeURIComponent(tenantId)}/retention`,
    { headers },
  );
  if (!response.ok) {
    return null;
  }

  const body = (await response.json()) as Partial<TenantChatCorpusSnapshot> & {
    tenant_id?: string;
  };

  return {
    tenant_id: body.tenant_id ?? tenantId,
    interaction_export_enabled: body.interaction_export_enabled,
    retention_mode: body.retention_mode,
    chat_corpus_enabled: body.chat_corpus_enabled === true,
    chat_corpus_retention_days:
      body.chat_corpus_retention_days === undefined ||
      body.chat_corpus_retention_days === null
        ? null
        : Number(body.chat_corpus_retention_days),
  };
}

/**
 * Returns true only when ops has set `chat_corpus_enabled` for the tenant.
 * Safe default: false (no full-body corpus writes).
 *
 * Enabling L5 interaction_export does **not** enable L10 corpus.
 */
export async function shouldWriteChatCorpus(
  tenantId: string,
  options: ChatCorpusGateOptions = {},
): Promise<boolean> {
  try {
    const policy = await fetchTenantChatCorpusPolicy(tenantId, options);
    if (!policy) {
      return resolveDefaultEnabled(options);
    }
    return policy.chat_corpus_enabled === true;
  } catch {
    return resolveDefaultEnabled(options);
  }
}

/**
 * Effective retention days for lifecycle / export tooling.
 * Null override → {@link DEFAULT_CHAT_CORPUS_RETENTION_DAYS} when enabled.
 * Returns null when corpus is disabled (writes must not run).
 */
export function effectiveChatCorpusRetentionDays(
  policy: Pick<
    TenantChatCorpusSnapshot,
    "chat_corpus_enabled" | "chat_corpus_retention_days"
  >,
): number | null {
  if (!policy.chat_corpus_enabled) {
    return null;
  }
  if (
    policy.chat_corpus_retention_days === null ||
    policy.chat_corpus_retention_days === undefined ||
    !Number.isFinite(policy.chat_corpus_retention_days)
  ) {
    return DEFAULT_CHAT_CORPUS_RETENTION_DAYS;
  }
  return policy.chat_corpus_retention_days;
}
