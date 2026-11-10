/**
 * Relay upgrade auth policy (G2a fail-closed production defaults).
 *
 * Production (`NODE_ENV=production` or `RELAY_AUTH_MODE=production`):
 * - accept jti (v1j) tokens — stock Hermes-Lanyard pins (g7h3+) mint jti
 * - reject non-expiring (exp=0)
 * - reject remaining TTL > max (300s)
 * - legacy (no-jti) tokens only if RELAY_ALLOW_LEGACY_UPGRADE_TOKEN is
 *   explicitly set (migration dual-accept / rollback window)
 *
 * Development / test (default):
 * - dual-accept jti + legacy claim shapes for Hermes rollout
 * - still enforce single-use when jti is present
 * - allow exp=0 for lab vectors
 *
 * Staging residual (lp-t7q.9): host venv `legacy=True` hot-patches are
 * ephemeral; durable path is this dual-accept + stock jti mint. See
 * docs/runbooks/relay-jti-dual-accept.md.
 */

import {
  MAX_UPGRADE_TTL_SECONDS,
  type VerifyUpgradeOptions,
} from "./auth.js";

export type RelayAuthMode = "development" | "production";

export type RelayAuthPolicy = {
  mode: RelayAuthMode;
  /** When true, tokens without jti are rejected. */
  requireJti: boolean;
  /** When true, exp === 0 is rejected. */
  rejectNonExpiring: boolean;
  maxTtlSeconds: number;
  /** Lab-only: accept ?token= on WS upgrade. */
  allowQueryToken: boolean;
};

function envTruthy(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function envFalsy(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return v === "0" || v === "false" || v === "no" || v === "off";
}

export function resolveRelayAuthMode(
  env: NodeJS.ProcessEnv = process.env,
  explicit?: RelayAuthMode,
): RelayAuthMode {
  if (explicit === "production" || explicit === "development") {
    return explicit;
  }

  const raw = env.RELAY_AUTH_MODE?.trim().toLowerCase();
  if (raw === "production" || raw === "development") {
    return raw;
  }

  // Safe default for real deploys (Docker sets NODE_ENV=production).
  if (env.NODE_ENV === "production") {
    return "production";
  }

  return "development";
}

/**
 * Build the active upgrade auth policy from environment.
 *
 * Env knobs:
 * - RELAY_AUTH_MODE=production|development
 * - RELAY_ALLOW_LEGACY_UPGRADE_TOKEN=1|0 (default: on in dev, off in prod)
 * - RELAY_REQUIRE_UPGRADE_JTI=1 (force jti even in dev)
 * - RELAY_ALLOW_QUERY_TOKEN=true (lab only)
 * - RELAY_MAX_UPGRADE_TTL_SECONDS (default 300)
 */
export function resolveRelayAuthPolicy(
  env: NodeJS.ProcessEnv = process.env,
  overrides?: Partial<RelayAuthPolicy> & { mode?: RelayAuthMode },
): RelayAuthPolicy {
  const mode = resolveRelayAuthMode(env, overrides?.mode);

  const maxTtlRaw = env.RELAY_MAX_UPGRADE_TTL_SECONDS?.trim();
  const maxTtlParsed = maxTtlRaw ? Number.parseInt(maxTtlRaw, 10) : NaN;
  const maxTtlSeconds =
    overrides?.maxTtlSeconds ??
    (Number.isFinite(maxTtlParsed) && maxTtlParsed > 0
      ? maxTtlParsed
      : MAX_UPGRADE_TTL_SECONDS);

  // Legacy dual-accept: default ON in development, OFF in production.
  let allowLegacy: boolean;
  if (env.RELAY_ALLOW_LEGACY_UPGRADE_TOKEN !== undefined) {
    allowLegacy = envTruthy(env.RELAY_ALLOW_LEGACY_UPGRADE_TOKEN);
  } else {
    allowLegacy = mode !== "production";
  }

  let requireJti: boolean;
  if (overrides?.requireJti !== undefined) {
    requireJti = overrides.requireJti;
  } else if (envTruthy(env.RELAY_REQUIRE_UPGRADE_JTI)) {
    requireJti = true;
  } else if (envFalsy(env.RELAY_REQUIRE_UPGRADE_JTI)) {
    requireJti = false;
  } else {
    requireJti = !allowLegacy;
  }

  const rejectNonExpiring =
    overrides?.rejectNonExpiring ?? mode === "production";

  const allowQueryToken =
    overrides?.allowQueryToken ?? envTruthy(env.RELAY_ALLOW_QUERY_TOKEN);

  return {
    mode,
    requireJti,
    rejectNonExpiring,
    maxTtlSeconds,
    allowQueryToken,
  };
}

export function policyToVerifyOptions(
  policy: RelayAuthPolicy,
): VerifyUpgradeOptions {
  return {
    requireJti: policy.requireJti,
    rejectNonExpiring: policy.rejectNonExpiring,
    maxTtlSeconds: policy.maxTtlSeconds,
  };
}
