import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Opaque session id (32 bytes → base64url). */
export function generateOfficeSessionId(): string {
  return randomBytes(32).toString("base64url");
}

/** Opaque download token or callback nonce (24 bytes → base64url). */
export function generateOfficeSecret(): string {
  return randomBytes(24).toString("base64url");
}

/** SHA-256 hex digest of a download token (never store the raw token). */
export function hashDownloadToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Constant-time compare of a raw token against a stored SHA-256 hex hash.
 * Returns false on length/format mismatch (fail closed).
 */
export function verifyDownloadToken(
  token: string,
  expectedHashHex: string,
): boolean {
  if (!token || !expectedHashHex || expectedHashHex.length !== 64) {
    return false;
  }
  const actual = Buffer.from(hashDownloadToken(token), "utf8");
  const expected = Buffer.from(expectedHashHex.toLowerCase(), "utf8");
  if (actual.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(actual, expected);
}

/**
 * Idempotency index material: tenant-scoped, bound to user + caller key +
 * path + revision + mode so a reused caller_key for a different document
 * does not silently retarget.
 */
export function officeIdempotencyMaterial(input: {
  tenant_id: string;
  user_id: string;
  caller_key: string;
  path: string;
  revision_token: string;
  mode: string;
}): string {
  return [
    input.tenant_id,
    input.user_id,
    input.caller_key,
    input.path,
    input.revision_token,
    input.mode,
  ].join("\0");
}

export function hashIdempotencyKey(material: string): string {
  return createHash("sha256").update(material, "utf8").digest("hex");
}
