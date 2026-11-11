/**
 * Best-effort push of gateway credentials to Relay after CP register/rotate
 * (lp-3a1.3). Multi-tenant Daytona cannot rely on solo RELAY_GATEWAY_ID seed.
 *
 * POST {base}/internal/instances/:id/credentials with x-relay-internal-token.
 * Never log secret values.
 */

export const RELAY_INTERNAL_TOKEN_HEADER = "x-relay-internal-token";

export type RelayCredentialsUpsertInput = {
  instanceId: string;
  /** Presented to Relay as gateway id; production uses permanent instance_id. */
  gatewayId: string;
  /** Primary (+ optional previous for dual-accept grace). Never log. */
  secrets: string[];
  tenantId?: string;
};

export type RelayCredentialsUpsertResult = {
  ok: boolean;
  /** HTTP status when a response was received. */
  status?: number;
  /** Safe error message (no secrets). */
  error?: string;
};

/**
 * Port: push credentials into Relay InMemorySecretStore (or future SoT).
 * Implementations must not log secret values.
 */
export type RelayCredentialsNotifier = {
  upsert(
    input: RelayCredentialsUpsertInput,
  ): Promise<RelayCredentialsUpsertResult>;
};

export type HttpRelayCredentialsOptions = {
  /** Relay HTTP base URL (not WSS), e.g. http://relay:8787 */
  baseUrl: string;
  /** Value for x-relay-internal-token. */
  internalToken: string;
  /** Injectable fetch (tests). @default global fetch */
  fetchFn?: typeof fetch;
  /** Request timeout ms. @default 5_000 */
  requestTimeoutMs?: number;
};

/**
 * Live Relay credentials push via POST /internal/instances/:id/credentials.
 * Token is only sent as header; body secrets are never logged here.
 */
export function createHttpRelayCredentialsNotifier(
  options: HttpRelayCredentialsOptions,
): RelayCredentialsNotifier {
  const base = options.baseUrl.replace(/\/$/, "");
  const token = options.internalToken;
  const fetchFn = options.fetchFn ?? fetch;
  const requestTimeoutMs =
    options.requestTimeoutMs !== undefined && options.requestTimeoutMs > 0
      ? options.requestTimeoutMs
      : 5_000;

  return {
    async upsert(
      input: RelayCredentialsUpsertInput,
    ): Promise<RelayCredentialsUpsertResult> {
      const instanceId = input.instanceId?.trim() ?? "";
      const gatewayId = (input.gatewayId?.trim() || instanceId).trim();
      const secrets = (input.secrets ?? []).filter(
        (s) => typeof s === "string" && s.length > 0,
      );
      if (!instanceId || !gatewayId || secrets.length === 0) {
        return {
          ok: false,
          error: "instanceId, gatewayId, and secrets are required",
        };
      }

      const url = `${base}/internal/instances/${encodeURIComponent(instanceId)}/credentials`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const res = await fetchFn(url, {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
            [RELAY_INTERNAL_TOKEN_HEADER]: token,
          },
          body: JSON.stringify({
            gateway_id: gatewayId,
            secrets,
            tenant_id: input.tenantId?.trim() || undefined,
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          let error = `relay credentials upsert failed (${res.status})`;
          try {
            const body = (await res.json()) as { error?: string };
            if (body?.error && typeof body.error === "string") {
              // Relay error messages are operator-safe (no secrets echoed).
              error = body.error;
            }
          } catch {
            // ignore parse failures
          }
          return { ok: false, status: res.status, error };
        }
        return { ok: true, status: res.status };
      } catch (err) {
        const aborted =
          err instanceof Error &&
          (err.name === "AbortError" || /aborted/i.test(err.message));
        return {
          ok: false,
          error: aborted
            ? "relay credentials upsert timed out"
            : err instanceof Error
              ? err.message
              : "relay credentials upsert failed",
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** Type guard for injected ports. */
export function isRelayCredentialsNotifier(
  value: unknown,
): value is RelayCredentialsNotifier {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as RelayCredentialsNotifier).upsert === "function"
  );
}

/**
 * Resolve Relay HTTP base for internal calls (presence + credentials).
 * Prefer RELAY_INTERNAL_URL; fall back to RELAY_URL (may be WSS — caller should
 * only use when both URL and token are set for HTTP).
 */
export function resolveRelayInternalBaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return (
    env.RELAY_INTERNAL_URL?.trim() ||
    env.RELAY_URL?.trim() ||
    ""
  );
}
