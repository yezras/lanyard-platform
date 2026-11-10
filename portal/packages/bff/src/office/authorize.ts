import type {
  OfficeDocumentSession,
  OfficeSessionAuthzResult,
  OfficeSessionPurpose,
} from "./types.js";
import {
  DOWNLOADABLE_LIFECYCLES,
  WRITABLE_LIFECYCLES,
} from "./types.js";

export function isOfficeSessionExpired(
  session: OfficeDocumentSession,
  now: Date = new Date(),
): boolean {
  const expiresMs = Date.parse(session.expires_at);
  if (!Number.isFinite(expiresMs)) {
    // Malformed expiry → fail closed as expired.
    return true;
  }
  return now.getTime() >= expiresMs;
}

/**
 * Authorize use of a loaded session for download, writeback, or owner read.
 * Does not load from storage — caller passes the record (or null).
 *
 * Invariants:
 * - Expired / closed / unknown → fail closed (no download, no write).
 * - tenant_id always required and must match.
 * - user_id required for owner_read; optional for download/write (DS paths
 *   authenticate via download token / callback nonce in later beads).
 */
export function authorizeOfficeSession(input: {
  session: OfficeDocumentSession | null;
  tenant_id: string;
  user_id?: string;
  purpose: OfficeSessionPurpose;
  now?: Date;
}): OfficeSessionAuthzResult {
  const { session, tenant_id, user_id, purpose } = input;
  const now = input.now ?? new Date();

  if (!session) {
    return { ok: false, reason: "not_found" };
  }

  if (session.tenant_id !== tenant_id) {
    return { ok: false, reason: "tenant_mismatch" };
  }

  if (isOfficeSessionExpired(session, now) || session.lifecycle === "expired") {
    return { ok: false, reason: "expired" };
  }

  if (session.lifecycle === "closed") {
    return { ok: false, reason: "closed" };
  }

  if (purpose === "owner_read") {
    if (!user_id || session.user_id !== user_id) {
      return { ok: false, reason: "user_mismatch" };
    }
    return { ok: true, session };
  }

  if (purpose === "download") {
    if (!DOWNLOADABLE_LIFECYCLES.has(session.lifecycle)) {
      return { ok: false, reason: "lifecycle" };
    }
    return { ok: true, session };
  }

  // write
  if (session.mode !== "edit") {
    return { ok: false, reason: "mode" };
  }
  if (!WRITABLE_LIFECYCLES.has(session.lifecycle)) {
    return { ok: false, reason: "lifecycle" };
  }
  return { ok: true, session };
}
