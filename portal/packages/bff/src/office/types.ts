/**
 * Server-owned Office document session model (lp-5q6.21).
 *
 * Maps an opaque session id to authorized vault path, revision, and secrets
 * used by ONLYOFFICE download/callback. Never put raw vault paths or
 * permissions in client-controlled Document Server callback parameters.
 *
 * Domain source: docs/architecture/portal-document-session-domain-model.md §2.5
 */

/** Host-owned identity of specific bytes at a path (CAS base). */
export type DocumentRevision = {
  /** Opaque token; compared with constant-time equality on host. */
  token: string;
  /** How the token was produced (debug / migration only). */
  kind: "etag" | "content_hash" | "host_revision" | "mtime_size_fallback";
  size_bytes?: number;
  /** ISO timestamp for UI only — never sole CAS key. */
  modified_at?: string;
};

export type OfficeSessionMode = "view" | "edit";

export type OfficeSessionLifecycle =
  | "active"
  | "saving"
  | "saved"
  | "conflict"
  | "expired"
  | "closed"
  | "superseded_base";

/**
 * BFF projection of active Office ownership for agent write gating (lp-5q6.32).
 * Compatible with shared `ActivePathOwnership`.
 */
export type ActiveOfficePathOwnership = {
  path: string;
  tenant_id: string;
  /** True when dirty edit owns the path (blocks agent overwrite). */
  dirty: boolean;
  mode: OfficeSessionMode | null;
  session_id?: string;
  base_revision_token?: string;
  user_id?: string;
};

/**
 * Last save outcome projection for the session record (acceptance: last_save status).
 * Distinct from full SaveCallback; download/callback beads refine this further.
 */
export type OfficeLastSaveStatus =
  | "none"
  | "pending"
  | "saved"
  | "conflict"
  | "failed"
  | "forbidden"
  | "expired";

/**
 * Office-family type bound at open. Stored so download/callback can fail closed
 * on type mismatch without re-deriving from path alone.
 */
export type OfficeFileType = "docx" | "xlsx" | "pptx" | "pdf" | "doc" | "xls" | "ppt" | "odt" | "ods" | "odp";

/**
 * Server-owned session. Primary key is opaque `session_id`.
 * Web and Document Server see the id (and editor config), never the full record.
 */
export type OfficeDocumentSession = {
  /** Opaque id (cryptographically random). Primary key. */
  session_id: string;

  tenant_id: string;
  user_id: string;

  /** Canonical path this session may download / writeback. */
  path: string;

  /** Revision frozen at open (CAS base for save). Alias: base_revision in domain doc. */
  revision: DocumentRevision;

  mode: OfficeSessionMode;

  /** File type bound at open (docx/xlsx/…). */
  file_type: OfficeFileType;

  /**
   * ONLYOFFICE document.key minted at open via mintDocumentKey (lp-5q6.24).
   * SHA-256 hex of v1|{tenant}|{normalized_path}|{revision.token}|{mode}.
   * Policy: docs/architecture/portal-document-key-invalidation.md
   */
  document_key: string;

  /**
   * SHA-256 (hex) of the single-purpose download token.
   * Raw token is never stored; only compared via hash (lp-5q6.22).
   */
  download_token_hash: string;

  /**
   * ISO-8601 absolute expiry for the download token capability.
   * Shorter than (or equal to) `expires_at`. Document Server GETs must fail
   * closed after this time even if the Office session is still open for UI.
   * Default mint window: {@link DEFAULT_OFFICE_DOWNLOAD_TTL_SECONDS}.
   */
  download_expires_at: string;

  /**
   * Single-use or rotating nonce bound into callback URL / JWT claims.
   * Callback without matching nonce fails closed.
   */
  callback_nonce: string;

  lifecycle: OfficeSessionLifecycle;

  /** Conservative dirty: true once edit mode is active until clean close/save. */
  dirty: boolean;

  /** ISO-8601. */
  created_at: string;
  /** ISO-8601. Absolute expiry — expired sessions cannot download or write. */
  expires_at: string;

  /** Last save outcome (none until first callback write attempt). */
  last_save_status: OfficeLastSaveStatus;

  /**
   * Optional caller idempotency key. Same (tenant, user, caller_key) with
   * matching path+revision+mode returns the same session while active.
   */
  caller_key?: string;

  last_callback_at?: string;
  saved_revision?: DocumentRevision;
};

/** Reasons an authorize/get-for-use call fails closed. */
export type OfficeSessionDenyReason =
  | "not_found"
  | "expired"
  | "closed"
  | "tenant_mismatch"
  | "user_mismatch"
  | "lifecycle"
  | "mode";

export type OfficeSessionAuthzResult =
  | { ok: true; session: OfficeDocumentSession }
  | { ok: false; reason: OfficeSessionDenyReason };

/** Purpose gates for authorize(). */
export type OfficeSessionPurpose = "download" | "write" | "owner_read";

export type CreateOfficeDocumentSessionInput = {
  tenant_id: string;
  user_id: string;
  path: string;
  revision: DocumentRevision;
  mode: OfficeSessionMode;
  file_type: OfficeFileType;
  /** Pre-minted ONLYOFFICE document.key from mintDocumentKey (lp-5q6.24). */
  document_key: string;
  /**
   * Raw download token. Store hashes only.
   * If omitted, a random token is generated and its hash stored;
   * the raw token is returned once in CreateOfficeDocumentSessionResult.
   */
  download_token?: string;
  /** Optional callback nonce; random if omitted. */
  callback_nonce?: string;
  /** Caller idempotency key (web request id / client open id). */
  caller_key?: string;
  /** TTL from now in seconds (default DEFAULT_OFFICE_SESSION_TTL_SECONDS). */
  ttl_seconds?: number;
  /**
   * Download token TTL from now in seconds (default
   * DEFAULT_OFFICE_DOWNLOAD_TTL_SECONDS, capped by session TTL and hard max).
   */
  download_ttl_seconds?: number;
  /** Inject clock for tests. */
  now?: Date;
};

export type CreateOfficeDocumentSessionResult = {
  session: OfficeDocumentSession;
  /**
   * Raw download token, only when the store generated it (or caller passed one).
   * Callers that passed `download_token` already know it; value is always the
   * plaintext that hashes to `session.download_token_hash`.
   */
  download_token: string;
  /** True when an existing active session was returned for the same caller_key. */
  idempotent_replay: boolean;
};

/** Redis / memory key prefixes (G5-style namespacing). */
export const OFFICE_SESSION_REDIS_KEY_PREFIX = "bff:v1:office:sess:";
export const OFFICE_SESSION_IDEM_REDIS_KEY_PREFIX = "bff:v1:office:idem:";

/** Default Office session TTL: 1 hour (shorter than browser sessions). */
export const DEFAULT_OFFICE_SESSION_TTL_SECONDS = 3_600;

/**
 * Default download-token TTL: 2 minutes (threat notes: prefer 60–120s;
 * hard max {@link MAX_OFFICE_DOWNLOAD_TTL_SECONDS} = 5 minutes).
 */
export const DEFAULT_OFFICE_DOWNLOAD_TTL_SECONDS = 120;

/** Hard max download-token TTL (threat notes: ≤ 5 minutes wall clock). */
export const MAX_OFFICE_DOWNLOAD_TTL_SECONDS = 300;

/**
 * Default max Office file size for signed download / callback (50 MiB).
 * Aligns with contracts/backend-runtime-v1 brain-rpc vault.write limits.
 */
export const DEFAULT_OFFICE_FILE_MAX_BYTES = 52_428_800;

/** Hard max Office file size (100 MiB). */
export const HARD_OFFICE_FILE_MAX_BYTES = 104_857_600;

/** Lifecycle values that still allow Document Server download of base bytes. */
export const DOWNLOADABLE_LIFECYCLES: ReadonlySet<OfficeSessionLifecycle> =
  new Set(["active", "saving", "saved", "conflict"]);

/** Lifecycle values that allow writeback (callback save). */
export const WRITABLE_LIFECYCLES: ReadonlySet<OfficeSessionLifecycle> = new Set(
  ["active", "saving"],
);

/** Office-family extensions Document Server may download via signed URL. */
export const OFFICE_DOWNLOAD_FILE_TYPES: ReadonlySet<OfficeFileType> = new Set([
  "docx",
  "xlsx",
  "pptx",
  "pdf",
  "doc",
  "xls",
  "ppt",
  "odt",
  "ods",
  "odp",
]);
