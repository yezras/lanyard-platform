/**
 * Signed Office download for Document Server (lp-5q6.22).
 *
 * Route: GET /api/office/sessions/:id/content?token=…
 * Auth: capability token only (no Portal cookie). Fail closed on expiry,
 * tenant mismatch, wrong session/token, unsupported type, size, missing file.
 *
 * Never log the raw token or file body.
 */

import { authorizeOfficeSession } from "./authorize.js";
import { verifyDownloadToken } from "./tokens.js";
import type {
  OfficeDocumentSession,
  OfficeFileType,
  OfficeSessionMode,
} from "./types.js";
import {
  DEFAULT_OFFICE_FILE_MAX_BYTES,
  HARD_OFFICE_FILE_MAX_BYTES,
  OFFICE_DOWNLOAD_FILE_TYPES,
} from "./types.js";

/** Reasons a signed download is denied (safe to log / return as code). */
export type OfficeDownloadDenyReason =
  | "missing_token"
  | "invalid_token"
  | "not_found"
  | "expired"
  | "closed"
  | "tenant_mismatch"
  | "lifecycle"
  | "mode"
  | "revision_mismatch"
  | "unsupported_file_type"
  | "path_type_mismatch"
  | "missing_file"
  | "oversized"
  | "payload_too_large";

export type OfficeDownloadAuthzResult =
  | { ok: true; session: OfficeDocumentSession }
  | { ok: false; reason: OfficeDownloadDenyReason; status: number };

/**
 * MIME types for Office-family downloads Document Server expects.
 * Prefer session.file_type over path sniffing (session is authoritative).
 */
export function mimeForOfficeFileType(fileType: OfficeFileType): string {
  switch (fileType) {
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "pdf":
      return "application/pdf";
    case "doc":
      return "application/msword";
    case "xls":
      return "application/vnd.ms-excel";
    case "ppt":
      return "application/vnd.ms-powerpoint";
    case "odt":
      return "application/vnd.oasis.opendocument.text";
    case "ods":
      return "application/vnd.oasis.opendocument.spreadsheet";
    case "odp":
      return "application/vnd.oasis.opendocument.presentation";
    default: {
      const _exhaustive: never = fileType;
      return _exhaustive;
    }
  }
}

export function isSupportedOfficeDownloadFileType(
  fileType: string,
): fileType is OfficeFileType {
  return OFFICE_DOWNLOAD_FILE_TYPES.has(fileType as OfficeFileType);
}

/** Path extension must match the session-bound Office file type. */
export function pathMatchesOfficeFileType(
  path: string,
  fileType: OfficeFileType,
): boolean {
  const lower = path.toLowerCase();
  const expected = `.${fileType}`;
  return lower.endsWith(expected);
}

export function isValidOfficeSessionMode(
  mode: string,
): mode is OfficeSessionMode {
  return mode === "view" || mode === "edit";
}

/**
 * Extract the single-purpose download token from query or Authorization header.
 * Prefer `?token=` (Document Server document.url style); Bearer also accepted.
 */
export function extractOfficeDownloadToken(input: {
  queryToken?: string | null;
  authorizationHeader?: string | null;
}): string | null {
  const fromQuery = input.queryToken?.trim();
  if (fromQuery) {
    return fromQuery;
  }
  const auth = input.authorizationHeader?.trim();
  if (!auth) {
    return null;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(auth);
  return match?.[1] ?? null;
}

/**
 * Build the Document Server–fetchable URL for an Office session.
 * `publicBaseUrl` is the BFF origin DS can reach on the lab/prod network
 * (e.g. http://bff:3001, http://host.docker.internal:3001).
 * Token is placed in the query string; never log the result with token redacted only.
 */
export function buildOfficeDownloadUrl(input: {
  publicBaseUrl: string;
  sessionId: string;
  downloadToken: string;
  /**
   * Optional tenant path-first prefix (`/{slug}`) when BFF is mounted as
   * `/:tenantSlug/api`. Subdomain routing uses empty string.
   */
  tenantPathPrefix?: string;
}): string {
  const base = input.publicBaseUrl.replace(/\/+$/, "");
  const prefix = (input.tenantPathPrefix ?? "").replace(/\/+$/, "");
  const path = `${prefix}/api/office/sessions/${encodeURIComponent(input.sessionId)}/content`;
  const url = new URL(path.startsWith("http") ? path : `${base}${path}`);
  url.searchParams.set("token", input.downloadToken);
  return url.toString();
}

/**
 * Redact a download URL for logs: keeps path/session id, strips token.
 * Safe to put in metrics/audit.
 */
export function redactOfficeDownloadUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("token")) {
      parsed.searchParams.set("token", "[redacted]");
    }
    return parsed.toString();
  } catch {
    return "[invalid-url]";
  }
}

function statusForDenyReason(reason: OfficeDownloadDenyReason): number {
  switch (reason) {
    case "missing_token":
    case "invalid_token":
      return 401;
    case "not_found":
    case "missing_file":
      return 404;
    case "expired":
    case "closed":
    case "tenant_mismatch":
    case "lifecycle":
    case "mode":
    case "revision_mismatch":
    case "unsupported_file_type":
    case "path_type_mismatch":
      return 403;
    case "oversized":
    case "payload_too_large":
      return 413;
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

/**
 * Authorize a Document Server download attempt.
 *
 * Validates (fail closed):
 * - token present + matches session download_token_hash
 * - session exists, tenant matches request host tenant
 * - session not expired / closed / non-downloadable lifecycle
 * - download_expires_at not passed (short-lived capability)
 * - mode is view|edit
 * - file_type supported and path extension matches
 * - optional revision claim matches session.revision.token
 */
export function authorizeOfficeDownload(input: {
  session: OfficeDocumentSession | null;
  tenant_id: string;
  token: string | null;
  /** Optional revision claim (query); when set must match session. */
  revision_token?: string | null;
  now?: Date;
}): OfficeDownloadAuthzResult {
  const now = input.now ?? new Date();

  if (!input.token) {
    return {
      ok: false,
      reason: "missing_token",
      status: statusForDenyReason("missing_token"),
    };
  }

  const authz = authorizeOfficeSession({
    session: input.session,
    tenant_id: input.tenant_id,
    purpose: "download",
    now,
  });

  if (!authz.ok) {
    const reason = authz.reason as OfficeDownloadDenyReason;
    return { ok: false, reason, status: statusForDenyReason(reason) };
  }

  const session = authz.session;

  if (!verifyDownloadToken(input.token, session.download_token_hash)) {
    return {
      ok: false,
      reason: "invalid_token",
      status: statusForDenyReason("invalid_token"),
    };
  }

  const downloadExpMs = Date.parse(session.download_expires_at);
  if (!Number.isFinite(downloadExpMs) || now.getTime() >= downloadExpMs) {
    return {
      ok: false,
      reason: "expired",
      status: statusForDenyReason("expired"),
    };
  }

  if (!isValidOfficeSessionMode(session.mode)) {
    return {
      ok: false,
      reason: "mode",
      status: statusForDenyReason("mode"),
    };
  }

  if (!isSupportedOfficeDownloadFileType(session.file_type)) {
    return {
      ok: false,
      reason: "unsupported_file_type",
      status: statusForDenyReason("unsupported_file_type"),
    };
  }

  if (!pathMatchesOfficeFileType(session.path, session.file_type)) {
    return {
      ok: false,
      reason: "path_type_mismatch",
      status: statusForDenyReason("path_type_mismatch"),
    };
  }

  if (
    input.revision_token !== undefined &&
    input.revision_token !== null &&
    input.revision_token !== "" &&
    input.revision_token !== session.revision.token
  ) {
    return {
      ok: false,
      reason: "revision_mismatch",
      status: statusForDenyReason("revision_mismatch"),
    };
  }

  return { ok: true, session };
}

export function resolveOfficeDownloadMaxBytes(maxBytes?: number): number {
  if (maxBytes === undefined) {
    return DEFAULT_OFFICE_FILE_MAX_BYTES;
  }
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    return DEFAULT_OFFICE_FILE_MAX_BYTES;
  }
  return Math.min(maxBytes, HARD_OFFICE_FILE_MAX_BYTES);
}

/**
 * Enforce size policy before streaming. Prefer declared size when known
 * (session.revision.size_bytes or provider metadata) so we fail before buffering.
 */
export function assertOfficeDownloadSize(
  sizeBytes: number,
  maxBytes: number = DEFAULT_OFFICE_FILE_MAX_BYTES,
): { ok: true } | { ok: false; reason: "oversized"; status: number } {
  const cap = resolveOfficeDownloadMaxBytes(maxBytes);
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return {
      ok: false,
      reason: "oversized",
      status: statusForDenyReason("oversized"),
    };
  }
  if (sizeBytes > cap) {
    return {
      ok: false,
      reason: "oversized",
      status: statusForDenyReason("oversized"),
    };
  }
  return { ok: true };
}

/** Decode vault fixture/FS content encoding to raw bytes for DS streaming. */
export function vaultContentToBytes(content: {
  encoding: "utf-8" | "base64";
  content: string;
}): Uint8Array {
  if (content.encoding === "utf-8") {
    return new TextEncoder().encode(content.content);
  }
  return new Uint8Array(Buffer.from(content.content, "base64"));
}

/**
 * Structured deny body for Document Server / operators.
 * Never includes path secrets beyond opaque codes, never token/body.
 */
export function officeDownloadErrorBody(
  reason: OfficeDownloadDenyReason,
): { error: string; code: OfficeDownloadDenyReason } {
  const messages: Record<OfficeDownloadDenyReason, string> = {
    missing_token: "Download token required",
    invalid_token: "Invalid download token",
    not_found: "Office session not found",
    expired: "Download token or session expired",
    closed: "Office session closed",
    tenant_mismatch: "Tenant mismatch",
    lifecycle: "Office session not downloadable",
    mode: "Invalid session mode",
    revision_mismatch: "Revision mismatch",
    unsupported_file_type: "Unsupported Office file type",
    path_type_mismatch: "Path does not match session file type",
    missing_file: "Vault file not found",
    oversized: "File exceeds Office download size limit",
    payload_too_large: "File exceeds Office download size limit",
  };
  return { error: messages[reason], code: reason };
}
