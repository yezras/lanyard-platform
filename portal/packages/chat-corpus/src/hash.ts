import { createHash } from "node:crypto";

/** Lowercase hex SHA-256 of UTF-8 bytes (no `sha256:` prefix). */
export const SHA256_HEX_RE = /^[a-f0-9]{64}$/;

/**
 * Integrity digest for chat turn message bodies.
 * Matches contracts/chat-corpus-v1 content_sha256 (UTF-8 SHA-256 hex).
 */
export function contentSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function isSha256Hex(value: string): boolean {
  return SHA256_HEX_RE.test(value);
}

/**
 * Verify that content_sha256 matches the UTF-8 body.
 * Returns true when equal; false when mismatch or invalid hex.
 */
export function sha256Matches(content: string, digest: string): boolean {
  if (!isSha256Hex(digest)) return false;
  return contentSha256(content) === digest;
}
