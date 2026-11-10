/**
 * Gateway WS upgrade auth — mirrors gateway/relay/auth.py (Hermes) and G2a ADR.
 *
 * Dual-accept claim shapes (lp-t7q.9):
 *
 * Legacy (v1):  base64url(`${gatewayId}:${exp}:${sig}`)
 *               sig = HMAC_SHA256(`${gatewayId}:${exp}`, secret).hex
 *
 * With jti (v1j): base64url(`${gatewayId}:${exp}:${jti}:${sig}`)
 *                 sig = HMAC_SHA256(`${gatewayId}:${exp}:${jti}`, secret).hex
 *                 jti = base64url(≥16 random bytes)
 *
 * Stock Hermes-Lanyard pins (v0.1.0-g7h3+) mint v1j by default. Relay always
 * verifies jti when present; legacy is gated by policy.requireJti (off in
 * development / when RELAY_ALLOW_LEGACY_UPGRADE_TOKEN=1).
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Default mint TTL (seconds). ADR recommends 60s for production mint. */
export const DEFAULT_UPGRADE_TTL_SECONDS = 60;

/** Maximum remaining TTL the relay will accept (seconds). */
export const MAX_UPGRADE_TTL_SECONDS = 300;

/** Extra seconds to retain a used jti past exp (clock skew). */
export const JTI_SKEW_SECONDS = 30;

/** Minimum jti entropy: 16 bytes → base64url length ≥ 22. */
export const MIN_JTI_BYTES = 16;

const JTI_SHAPE = /^[A-Za-z0-9_-]{20,}$/;

function hmacHex(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  try {
    const ab = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ab.length !== bb.length || ab.length === 0) return false;
    return timingSafeEqual(ab, bb);
  } catch {
    return false;
  }
}

export function generateJti(bytes = MIN_JTI_BYTES): string {
  const n = Math.max(bytes, MIN_JTI_BYTES);
  return randomBytes(n).toString("base64url");
}

export function isJtiShape(value: string): boolean {
  return JTI_SHAPE.test(value);
}

/** Legacy token builder (no jti). Prefer {@link makeUpgradeToken} for WS upgrade. */
export function makeToken(
  payload: string,
  secret: string,
  ttlSeconds = 0,
): string {
  const exp =
    ttlSeconds > 0 ? Math.floor(Date.now() / 1000) + ttlSeconds : 0;
  const signed = `${payload}:${exp}`;
  const sig = hmacHex(signed, secret);
  const raw = `${signed}:${sig}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

export type MakeUpgradeTokenOptions = {
  /** TTL seconds; 0 means non-expiring (rejected by relay in production). */
  ttlSeconds?: number;
  /** Fixed jti for tests; random ≥128-bit when omitted. */
  jti?: string;
  /**
   * When true, mint legacy `gatewayId:exp:sig` (no jti).
   * Default false — G2a tokens always carry a jti.
   */
  legacy?: boolean;
};

/**
 * Mint a WS-upgrade bearer. Default is v1j (with jti) and 60s TTL.
 */
export function makeUpgradeToken(
  gatewayId: string,
  secret: string,
  ttlSecondsOrOptions: number | MakeUpgradeTokenOptions = DEFAULT_UPGRADE_TTL_SECONDS,
): string {
  const options: MakeUpgradeTokenOptions =
    typeof ttlSecondsOrOptions === "number"
      ? { ttlSeconds: ttlSecondsOrOptions }
      : ttlSecondsOrOptions;

  const ttlSeconds = options.ttlSeconds ?? DEFAULT_UPGRADE_TTL_SECONDS;
  const exp =
    ttlSeconds > 0 ? Math.floor(Date.now() / 1000) + ttlSeconds : 0;

  if (options.legacy) {
    return makeToken(gatewayId, secret, ttlSeconds);
  }

  const jti = options.jti ?? generateJti();
  const signed = `${gatewayId}:${exp}:${jti}`;
  const sig = hmacHex(signed, secret);
  const raw = `${signed}:${sig}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

export type UpgradeTokenFormat = "jti" | "legacy";

export type ParsedUpgradeToken = {
  gatewayId: string;
  exp: number;
  jti?: string;
  format: UpgradeTokenFormat;
  /** Material that was HMAC'd (excluding sig). */
  signed: string;
  sigHex: string;
};

/**
 * Decode and structure an upgrade token without verifying the HMAC.
 * Distinguishes jti vs legacy by jti shape (≥20 base64url chars).
 */
export function parseUpgradeToken(token: string): ParsedUpgradeToken | null {
  let decoded: string;
  try {
    const padded = token + "=".repeat((4 - (token.length % 4)) % 4);
    decoded = Buffer.from(padded, "base64url").toString("utf8");
  } catch {
    return null;
  }

  const lastColon = decoded.lastIndexOf(":");
  if (lastColon <= 0) return null;

  const sigHex = decoded.slice(lastColon + 1);
  if (!sigHex || !/^[0-9a-fA-F]+$/.test(sigHex)) return null;

  const signed = decoded.slice(0, lastColon);
  if (!signed) return null;

  // Try jti form: gatewayId:exp:jti
  const jtiSep = signed.lastIndexOf(":");
  if (jtiSep > 0) {
    const jti = signed.slice(jtiSep + 1);
    const beforeJti = signed.slice(0, jtiSep);
    const expSep = beforeJti.lastIndexOf(":");
    if (expSep > 0 && isJtiShape(jti)) {
      const exp = Number.parseInt(beforeJti.slice(expSep + 1), 10);
      const gatewayId = beforeJti.slice(0, expSep);
      if (gatewayId && Number.isFinite(exp)) {
        return {
          gatewayId,
          exp,
          jti,
          format: "jti",
          signed,
          sigHex,
        };
      }
    }
  }

  // Legacy: gatewayId:exp (payload may contain colons)
  const expSep = signed.lastIndexOf(":");
  if (expSep <= 0) return null;
  const exp = Number.parseInt(signed.slice(expSep + 1), 10);
  const gatewayId = signed.slice(0, expSep);
  if (!gatewayId || !Number.isFinite(exp)) return null;

  return {
    gatewayId,
    exp,
    format: "legacy",
    signed,
    sigHex,
  };
}

/** Peek gatewayId without verifying — for secret lookup. */
export function peekGatewayId(token: string): string | null {
  return parseUpgradeToken(token)?.gatewayId ?? null;
}

export type VerifyUpgradeOptions = {
  /** Reject exp === 0 (production fail-closed). */
  rejectNonExpiring?: boolean;
  /** Reject remaining TTL above this (default MAX_UPGRADE_TTL_SECONDS). */
  maxTtlSeconds?: number;
  /** Reject legacy (no-jti) tokens. */
  requireJti?: boolean;
  /** Clock override for tests (unix seconds). */
  nowSeconds?: number;
};

export type VerifiedUpgrade = {
  gatewayId: string;
  exp: number;
  jti?: string;
  format: UpgradeTokenFormat;
};

/**
 * Verify upgrade bearer against a secret list with G2a production rules.
 *
 * Accepts **both** claim shapes when `requireJti` is false (dual-accept):
 * v1j (jti) and v1 legacy. When `requireJti` is true (production default),
 * only v1j succeeds — stock Hermes pins connect without a host legacy patch.
 *
 * Does **not** consume jti — caller must call JtiStore.consume after success.
 */
export function verifyUpgradeToken(
  token: string,
  secrets: readonly string[],
  options: VerifyUpgradeOptions = {},
): VerifiedUpgrade | null {
  const parsed = parseUpgradeToken(token);
  if (!parsed) return null;

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxTtl = options.maxTtlSeconds ?? MAX_UPGRADE_TTL_SECONDS;

  // Fail closed on legacy when policy requires jti (prod default).
  if (options.requireJti && parsed.format !== "jti") {
    return null;
  }

  if (parsed.exp === 0) {
    if (options.rejectNonExpiring) return null;
  } else {
    if (parsed.exp < now) return null;
    const remaining = parsed.exp - now;
    if (remaining > maxTtl) return null;
  }

  let matched = false;
  for (const secret of secrets) {
    if (!secret) continue;
    const expected = hmacHex(parsed.signed, secret);
    if (safeEqualHex(parsed.sigHex, expected)) {
      matched = true;
      break;
    }
  }
  if (!matched) return null;

  return {
    gatewayId: parsed.gatewayId,
    exp: parsed.exp,
    jti: parsed.jti,
    format: parsed.format,
  };
}

/**
 * Legacy verify API: returns payload (gatewayId) or null.
 * Applies expiry only; does not enforce jti / max TTL / non-expiring reject.
 * Prefer {@link verifyUpgradeToken} on the upgrade path.
 */
export function verifyToken(
  token: string,
  secrets: readonly string[],
): string | null {
  const verified = verifyUpgradeToken(token, secrets, {
    rejectNonExpiring: false,
    requireJti: false,
    // Preserve historical behavior: no max-TTL clamp on the low-level helper.
    maxTtlSeconds: Number.POSITIVE_INFINITY,
  });
  return verified?.gatewayId ?? null;
}

export function extractBearerToken(
  authorizationHeader: string | undefined,
): string | null {
  if (!authorizationHeader) return null;
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? null;
}
