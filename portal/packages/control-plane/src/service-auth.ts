/**
 * BFF ↔ control-plane service authentication (G1.2).
 *
 * Shared service secret presented as `x-control-plane-service-token`.
 * Distinct from `INTERNAL_OPS_TOKEN` (Lanyard ops for retention/relay-tier).
 *
 * Secrets live in env / GitHub Actions secrets / SSM — never in git.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { HTTPException } from "hono/http-exception";

export const CONTROL_PLANE_SERVICE_TOKEN_HEADER =
  "x-control-plane-service-token";

/** Local/dev placeholder only — rejected when NODE_ENV or auth mode is production. */
export const DEV_CONTROL_PLANE_SERVICE_TOKEN =
  "placeholder-control-plane-service-token";

/**
 * GitHub Actions / deploy secret names (document only — values never in repo):
 * - CONTROL_PLANE_SERVICE_TOKEN  — CP accepts this value
 * - Same name on BFF task/env    — BFF presents it on every CP call
 *
 * Rotation: mint a new random secret (≥32 bytes base64url), dual-write to BFF
 * and CP task definitions / SSM SecureString, redeploy CP then BFF (or both),
 * retire the old value. See package README "Service credential rotation".
 */

export function isDevServiceToken(token: string | undefined): boolean {
  return !token || token === DEV_CONTROL_PLANE_SERVICE_TOKEN;
}

/**
 * Resolve the configured service token from options or env.
 * Empty/whitespace → undefined (development open mode when not production).
 */
export function resolveServiceToken(
  env: NodeJS.ProcessEnv = process.env,
  explicit?: string,
): string | undefined {
  const fromExplicit = explicit?.trim();
  if (fromExplicit) {
    return fromExplicit;
  }
  const fromEnv = env.CONTROL_PLANE_SERVICE_TOKEN?.trim();
  return fromEnv || undefined;
}

/**
 * Production fail-closed: service token must be present and not the dev placeholder.
 * Call at process startup (server) and when building the production gate.
 */
export function assertProductionServiceToken(
  token: string | undefined,
  context = "CONTROL_PLANE_SERVICE_TOKEN",
): asserts token is string {
  if (isDevServiceToken(token)) {
    throw new Error(
      `${context} must be configured to a non-development value in production`,
    );
  }
}

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

/** Constant-time compare of two token strings (via SHA-256 digests). */
export function serviceTokenMatches(
  expected: string,
  presented: string,
): boolean {
  try {
    return timingSafeEqual(hashToken(expected), hashToken(presented));
  } catch {
    return false;
  }
}

/**
 * Require a valid service token. If `expected` is undefined, allow (dev open).
 * Throws HTTP 401 on mismatch; 503 if production expected a token but none configured.
 */
export function requireServiceToken(
  expected: string | undefined,
  presented: string | undefined,
  options: { required?: boolean } = {},
): void {
  if (!expected) {
    if (options.required) {
      throw new HTTPException(503, {
        message: "Control-plane service token not configured",
      });
    }
    return;
  }
  if (!presented || !serviceTokenMatches(expected, presented)) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }
}
