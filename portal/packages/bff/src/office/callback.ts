/**
 * ONLYOFFICE Document Server callback writeback (lp-5q6.23 + lp-p37.9).
 *
 * Route: POST /api/office/callback?session_id=…&nonce=…
 * Auth: callback nonce (session-bound) + optional JWT (lp-5q6.26).
 * No Portal cookie / CSRF — Document Server is not a browser origin.
 *
 * Assembled-file fetch (status 2 / 6): stream + hard byte cap, connect/read
 * timeouts, and per-hop allowlist revalidation on redirects (lp-p37.9).
 * Nonce-in-query residual: docs/architecture/portal-office-signed-download-
 * callback-security-review.md §4.1.
 *
 * Threat notes: docs/architecture/portal-office-document-bridge-threat-notes.md §5.2
 * Domain model: docs/architecture/portal-document-session-domain-model.md §1.4, §2.6
 *
 * Status matrix (ONLYOFFICE):
 *   1 — editing (no write)
 *   2 — ready for saving (fetch url → vault.write)
 *   3 — save error (record failed, no write)
 *   4 — closed with no changes (no write)
 *   6 — force save (fetch url → vault.write)
 *   7 — force save error (record failed, no write)
 *
 * Returns { error: 0 } only after accepted handling. Never logs file body or nonce.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

import type {
  DocumentRevision,
  VaultWriteHttpBody,
  VaultWriteParams,
} from "@lanyard/backend-runtime";

import { authorizeOfficeSession } from "./authorize.js";
import { mimeForOfficeFileType, resolveOfficeDownloadMaxBytes } from "./download.js";
import type { OfficeDocumentSessionStore } from "./store.js";
import type {
  OfficeDocumentSession,
  OfficeLastSaveStatus,
  OfficeSessionLifecycle,
} from "./types.js";
import { DEFAULT_OFFICE_FILE_MAX_BYTES } from "./types.js";

/** ONLYOFFICE callback status codes we handle explicitly. */
export const OFFICE_CALLBACK_STATUSES = [1, 2, 3, 4, 6, 7] as const;
export type OfficeCallbackStatus = (typeof OFFICE_CALLBACK_STATUSES)[number];

export type OfficeCallbackAction =
  | "ignore" // status 1, 4 — acknowledge, no write
  | "save" // status 2 — final save
  | "force_save" // status 6 — mid-edit force save
  | "save_error" // status 3, 7 — DS-reported failure
  | "unknown";

/** Safe deny / failure codes (no paths, no secrets). */
export type OfficeCallbackDenyReason =
  | "missing_session_id"
  | "missing_nonce"
  | "invalid_nonce"
  | "not_found"
  | "expired"
  | "closed"
  | "tenant_mismatch"
  | "lifecycle"
  | "mode"
  | "invalid_payload"
  | "unsupported_status"
  | "missing_url"
  | "bad_url"
  | "fetch_failed"
  | "oversized"
  | "write_conflict"
  | "write_forbidden"
  | "write_failed"
  | "write_unavailable";

export type OnlyOfficeCallbackPayload = {
  /** ONLYOFFICE document.key */
  key?: string;
  status: number;
  /** Assembled file URL (status 2 / 6). */
  url?: string;
  /** Optional JWT when Document Server JWT is enabled. */
  token?: string;
  users?: string[];
  actions?: Array<{ type?: number; userid?: string }>;
  changesurl?: string;
  history?: unknown;
  filetype?: string;
};

/** ONLYOFFICE wire response. */
export type OnlyOfficeCallbackResponse = {
  error: number;
  /** Optional safe diagnostic for operators / tests (not required by DS). */
  code?: OfficeCallbackDenyReason | "ok" | "ignored" | "saved" | "force_saved" | "save_error" | "conflict" | "duplicate";
};

export type OfficeCallbackHandleResult = {
  /** HTTP status (auth failures 401/403/404; accepted handling usually 200). */
  httpStatus: number;
  body: OnlyOfficeCallbackResponse;
  /** Internal projection for logs / future web poll (no secrets). */
  save?: {
    status:
      | "ignored"
      | "saved"
      | "conflict"
      | "forbidden"
      | "expired"
      | "upstream_error"
      | "duplicate";
    session_id?: string;
    onlyoffice_status?: number;
    new_revision?: DocumentRevision;
    error_code?: OfficeCallbackDenyReason;
    idempotent_replay?: boolean;
  };
};

/** Fetch assembled document bytes from Document Server (injectable). */
export type OfficeCallbackFetcher = (input: {
  url: string;
  maxBytes: number;
}) => Promise<
  | { ok: true; bytes: Uint8Array; contentType?: string }
  | { ok: false; reason: "fetch_failed" | "oversized" | "bad_url" }
>;

/**
 * Connect / TTFB timeout for Document Server assembled-file GET (lp-p37.9).
 * Separate from body-read budget so a hung socket cannot hold the BFF worker.
 */
export const DEFAULT_OFFICE_CALLBACK_FETCH_TIMEOUT_MS = 15_000;

/**
 * Maximum wall-clock time to stream the response body after headers arrive.
 * Prevents slow-loris style unbounded reads even under the byte cap.
 */
export const DEFAULT_OFFICE_CALLBACK_READ_TIMEOUT_MS = 60_000;

/** Max redirect hops; each Location is re-checked against the host allowlist. */
export const DEFAULT_OFFICE_CALLBACK_MAX_REDIRECTS = 3;

/** Default streaming chunk budget before re-checking the byte cap. */
export const DEFAULT_OFFICE_CALLBACK_STREAM_CHUNK_BYTES = 64 * 1024;

/** Safe, low-cardinality reasons for callback download metrics (lp-p37.9). */
export type OfficeCallbackFetchMetricReason =
  | "success"
  | "oversized"
  | "fetch_failed"
  | "timeout"
  | "bad_url"
  | "redirect_rejected";

export type OfficeCallbackFetchEvent = {
  reason: OfficeCallbackFetchMetricReason;
  /** Bytes accepted into the BFF buffer (0 when aborted before any chunk). */
  bytes_read?: number;
  /** Redirect hops taken before success or failure. */
  redirect_hops?: number;
};

export type OfficeCallbackFetcherOptions = {
  /** Connect / first-byte timeout (default {@link DEFAULT_OFFICE_CALLBACK_FETCH_TIMEOUT_MS}). */
  fetchTimeoutMs?: number;
  /** Max body-read duration (default {@link DEFAULT_OFFICE_CALLBACK_READ_TIMEOUT_MS}). */
  maxReadDurationMs?: number;
  /**
   * Max redirect hops with per-hop allowlist revalidation.
   * Default {@link DEFAULT_OFFICE_CALLBACK_MAX_REDIRECTS}. Set 0 to reject all redirects.
   */
  maxRedirects?: number;
  /** Injectable fetch (tests). Defaults to global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Optional metrics hook — never receives URL secrets or body bytes. */
  onEvent?: (event: OfficeCallbackFetchEvent) => void;
};

/** Persist bytes via vault.write (injectable; production uses writeVaultFromCallback). */
export type OfficeCallbackVaultWriter = (input: {
  session: OfficeDocumentSession;
  params: VaultWriteParams;
}) => Promise<VaultWriteHttpBody>;

export type OfficeCallbackAllowlistConfig = {
  /**
   * Hostname allowlist (exact match, case-insensitive).
   * Example lab: onlyoffice, documentserver, localhost, host.docker.internal
   */
  hosts: readonly string[];
  /** Allowed schemes (default http + https for lab). */
  schemes?: readonly string[];
  /**
   * When true (default), reject literal IP hosts unless they appear on the
   * allowlist. Metadata / link-local ranges are always rejected even if listed.
   */
  rejectPrivateLiteralIps?: boolean;
};

const BLOCKED_LITERAL_IP_PREFIXES = [
  "169.254.", // link-local + AWS metadata 169.254.169.254
  "0.",
] as const;

/**
 * Map ONLYOFFICE numeric status → internal action.
 * Unknown statuses are rejected (unsupported_status).
 */
export function mapOnlyOfficeCallbackStatus(
  status: number,
): OfficeCallbackAction {
  switch (status) {
    case 1:
    case 4:
      return "ignore";
    case 2:
      return "save";
    case 6:
      return "force_save";
    case 3:
    case 7:
      return "save_error";
    default:
      return "unknown";
  }
}

export function isOfficeCallbackStatus(
  status: number,
): status is OfficeCallbackStatus {
  return (OFFICE_CALLBACK_STATUSES as readonly number[]).includes(status);
}

/**
 * Parse raw ONLYOFFICE callback JSON once.
 * Does not authorize or fetch.
 */
export function parseOnlyOfficeCallbackPayload(
  raw: unknown,
):
  | { ok: true; payload: OnlyOfficeCallbackPayload }
  | { ok: false; reason: "invalid_payload" } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "invalid_payload" };
  }
  const r = raw as Record<string, unknown>;
  const status = r.status;
  if (typeof status !== "number" || !Number.isInteger(status)) {
    return { ok: false, reason: "invalid_payload" };
  }
  const payload: OnlyOfficeCallbackPayload = { status };
  if (typeof r.key === "string") payload.key = r.key;
  if (typeof r.url === "string") payload.url = r.url;
  if (typeof r.token === "string") payload.token = r.token;
  if (typeof r.filetype === "string") payload.filetype = r.filetype;
  if (typeof r.changesurl === "string") payload.changesurl = r.changesurl;
  if (Array.isArray(r.users)) {
    payload.users = r.users.filter((u): u is string => typeof u === "string");
  }
  return { ok: true, payload };
}

/** Constant-time callback nonce compare (fail closed on length mismatch). */
export function verifyCallbackNonce(
  provided: string | null | undefined,
  expected: string,
): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

/**
 * Extract session_id + nonce from query / headers / optional body fields.
 * Path authority still comes only from the server-owned session record.
 */
export function extractOfficeCallbackAuth(input: {
  querySessionId?: string | null;
  queryNonce?: string | null;
  headerNonce?: string | null;
  bodyNonce?: string | null;
  bodySessionId?: string | null;
}): { session_id: string | null; nonce: string | null } {
  const session_id =
    input.querySessionId?.trim() ||
    input.bodySessionId?.trim() ||
    null;
  const nonce =
    input.queryNonce?.trim() ||
    input.headerNonce?.trim() ||
    input.bodyNonce?.trim() ||
    null;
  return { session_id, nonce };
}

/**
 * SSRF guard: only fetch Document Server hosts on the environment allowlist.
 * Rejects credentials in URL, unexpected schemes, and blocked literal IPs.
 */
export function assertOfficeCallbackUrlAllowed(
  urlString: string,
  config: OfficeCallbackAllowlistConfig,
): { ok: true; url: URL } | { ok: false; reason: "bad_url" } {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { ok: false, reason: "bad_url" };
  }

  const schemes = config.schemes ?? ["http", "https"];
  if (!schemes.includes(url.protocol.replace(/:$/, ""))) {
    return { ok: false, reason: "bad_url" };
  }

  // Userinfo in URL is never needed for DS fetch and is an SSRF/smuggle vector.
  if (url.username || url.password) {
    return { ok: false, reason: "bad_url" };
  }

  const host = url.hostname.toLowerCase();
  if (!host) {
    return { ok: false, reason: "bad_url" };
  }

  // Always block cloud metadata / link-local literals.
  if (isBlockedLiteralIp(host)) {
    return { ok: false, reason: "bad_url" };
  }

  const allowed = new Set(
    config.hosts.map((h) => h.trim().toLowerCase()).filter(Boolean),
  );
  if (allowed.size === 0) {
    // Fail closed when no allowlist configured.
    return { ok: false, reason: "bad_url" };
  }

  if (!allowed.has(host)) {
    return { ok: false, reason: "bad_url" };
  }

  return { ok: true, url };
}

function isBlockedLiteralIp(host: string): boolean {
  // Bracketed IPv6
  const bare = host.startsWith("[") && host.endsWith("]")
    ? host.slice(1, -1)
    : host;
  const ipVersion = isIP(bare);
  if (ipVersion === 0) {
    return false; // hostname, not literal IP
  }
  if (ipVersion === 4) {
    for (const prefix of BLOCKED_LITERAL_IP_PREFIXES) {
      if (bare.startsWith(prefix)) return true;
    }
    // Loopback and RFC1918 are only allowed if explicitly on host allowlist
    // (checked by caller after this); here we hard-block metadata only.
    if (bare === "169.254.169.254") return true;
    return false;
  }
  // IPv6: block link-local fe80::/10 and unique-local fc00::/7 loosely
  const lower = bare.toLowerCase();
  if (lower === "::1") return false; // may be allowlisted as hostname form separately
  if (lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd")) {
    return true;
  }
  return false;
}

/**
 * Stable vault.write idempotency key for a callback save attempt.
 * Same session + same body bytes converge on retries (DS retries are normal).
 */
export function buildOfficeCallbackIdempotencyKey(input: {
  session_id: string;
  status: number;
  contentSha256Hex: string;
}): string {
  // Max 128 per vault.write contract.
  const hash12 = input.contentSha256Hex.slice(0, 24);
  const key = `office-cb:${input.session_id}:${input.status}:${hash12}`;
  return key.length <= 128 ? key : key.slice(0, 128);
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Build vault.write params from session + fetched bytes.
 * Path and expected revision come **only** from the session (never callback body).
 */
export function buildOfficeCallbackWriteParams(input: {
  session: OfficeDocumentSession;
  bytes: Uint8Array;
  status: OfficeCallbackStatus;
  contentSha256Hex?: string;
}): VaultWriteParams {
  const contentSha256Hex =
    input.contentSha256Hex ?? sha256Hex(input.bytes);
  const content = Buffer.from(input.bytes).toString("base64");
  // Prefer current base: after a prior force-save, revision may have advanced.
  const expected = input.session.saved_revision ?? input.session.revision;
  return {
    path: input.session.path,
    mode: "replace_if_match",
    expectedRevision: {
      token: expected.token,
      kind: expected.kind,
      ...(expected.size_bytes !== undefined
        ? { size_bytes: expected.size_bytes }
        : {}),
      ...(expected.modified_at !== undefined
        ? { modified_at: expected.modified_at }
        : {}),
    },
    ifMatch: expected.token,
    encoding: "base64",
    content,
    mimeType: mimeForOfficeFileType(input.session.file_type),
    sizeBytes: input.bytes.byteLength,
    idempotencyKey: buildOfficeCallbackIdempotencyKey({
      session_id: input.session.session_id,
      status: input.status,
      contentSha256Hex,
    }),
  };
}

/**
 * Stream a Response body into a capped buffer.
 *
 * Missing Content-Length must not permit unbounded buffering: each chunk is
 * counted and the reader is cancelled once `maxBytes` is exceeded. A separate
 * wall-clock budget cancels a stalled `reader.read()` so slow-loris streams
 * cannot hold a BFF worker past `maxReadDurationMs`.
 *
 * Exported for unit tests that prove bounded memory under chunked transfer.
 */
export async function readOfficeCallbackBodyWithCap(input: {
  response: Response;
  maxBytes: number;
  maxReadDurationMs?: number;
  signal?: AbortSignal;
}): Promise<
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "oversized" | "fetch_failed" | "timeout" }
> {
  const maxBytes = input.maxBytes;
  if (!Number.isFinite(maxBytes) || maxBytes < 0) {
    return { ok: false, reason: "fetch_failed" };
  }

  // Empty / no body: treat as zero-length document (caller may still reject).
  if (!input.response.body) {
    return { ok: true, bytes: new Uint8Array(0) };
  }

  const maxReadDurationMs = resolvePositiveMs(
    input.maxReadDurationMs,
    DEFAULT_OFFICE_CALLBACK_READ_TIMEOUT_MS,
  );

  const reader = input.response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timedOut = false;

  // Wall-clock budget must cancel an in-flight read, not only check between chunks.
  const readTimeoutId = setTimeout(() => {
    timedOut = true;
    void reader.cancel("read_timeout");
  }, maxReadDurationMs);

  const onExternalAbort = (): void => {
    timedOut = true;
    void reader.cancel("aborted");
  };
  if (input.signal) {
    if (input.signal.aborted) {
      clearTimeout(readTimeoutId);
      await reader.cancel("aborted").catch(() => undefined);
      return { ok: false, reason: "timeout" };
    }
    input.signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    while (true) {
      if (timedOut || input.signal?.aborted) {
        return { ok: false, reason: "timeout" };
      }

      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      // Cap before retaining the chunk so peak memory ≈ maxBytes + one chunk.
      if (total + value.byteLength > maxBytes) {
        await reader.cancel("oversized").catch(() => undefined);
        return { ok: false, reason: "oversized" };
      }

      total += value.byteLength;
      chunks.push(value);
    }
  } catch (err) {
    if (timedOut || input.signal?.aborted) {
      return { ok: false, reason: "timeout" };
    }
    // DOMException AbortError from underlying stream cancel
    if (
      err &&
      typeof err === "object" &&
      "name" in err &&
      (err as { name: string }).name === "AbortError"
    ) {
      return { ok: false, reason: "timeout" };
    }
    return { ok: false, reason: "fetch_failed" };
  } finally {
    clearTimeout(readTimeoutId);
    input.signal?.removeEventListener("abort", onExternalAbort);
  }

  if (timedOut || input.signal?.aborted) {
    return { ok: false, reason: "timeout" };
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes: out };
}

function resolvePositiveMs(
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

/**
 * Default Node fetch for Document Server assembled files (lp-p37.9).
 *
 * - Streams the body in chunks and aborts once maxBytes is exceeded (no
 *   unbounded `arrayBuffer()` when Content-Length is absent).
 * - Enforces connect/TTFB timeout and maximum body-read duration.
 * - Uses `redirect: "manual"` and revalidates every Location against the host
 *   allowlist before following (bounded hop count).
 */
export function createDefaultOfficeCallbackFetcher(
  allowlist: OfficeCallbackAllowlistConfig,
  options: OfficeCallbackFetcherOptions = {},
): OfficeCallbackFetcher {
  const fetchTimeoutMs = resolvePositiveMs(
    options.fetchTimeoutMs,
    DEFAULT_OFFICE_CALLBACK_FETCH_TIMEOUT_MS,
  );
  const maxReadDurationMs = resolvePositiveMs(
    options.maxReadDurationMs,
    DEFAULT_OFFICE_CALLBACK_READ_TIMEOUT_MS,
  );
  const maxRedirects =
    options.maxRedirects === undefined
      ? DEFAULT_OFFICE_CALLBACK_MAX_REDIRECTS
      : Math.max(0, Math.floor(options.maxRedirects));
  const fetchImpl = options.fetchImpl ?? fetch;
  const emit = (event: OfficeCallbackFetchEvent): void => {
    try {
      options.onEvent?.(event);
    } catch {
      // Metrics must never break the save path.
    }
  };

  return async (input) => {
    const initial = assertOfficeCallbackUrlAllowed(input.url, allowlist);
    if (!initial.ok) {
      emit({ reason: "bad_url", bytes_read: 0, redirect_hops: 0 });
      return { ok: false, reason: "bad_url" };
    }

    let currentUrl = initial.url.toString();
    let redirectHops = 0;

    // Outer loop: request → optional allowlisted redirect → stream body.
    while (true) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, fetchTimeoutMs);

      let response: Response;
      try {
        response = await fetchImpl(currentUrl, {
          method: "GET",
          redirect: "manual", // never auto-follow; revalidate every hop
          headers: { accept: "*/*" },
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timeoutId);
        const timedOut =
          controller.signal.aborted ||
          (err &&
            typeof err === "object" &&
            "name" in err &&
            (err as { name: string }).name === "AbortError");
        emit({
          reason: timedOut ? "timeout" : "fetch_failed",
          bytes_read: 0,
          redirect_hops: redirectHops,
        });
        // Map timeout → fetch_failed for the existing deny surface (DS unreachable).
        return { ok: false, reason: "fetch_failed" };
      } finally {
        clearTimeout(timeoutId);
      }

      // Redirect: revalidate Location host/scheme/credentials before following.
      if (response.status >= 300 && response.status < 400) {
        // Drain redirect body so the connection can close promptly.
        if (response.body) {
          await response.body.cancel().catch(() => undefined);
        }

        if (redirectHops >= maxRedirects) {
          emit({
            reason: "redirect_rejected",
            bytes_read: 0,
            redirect_hops: redirectHops,
          });
          return { ok: false, reason: "bad_url" };
        }

        const location = response.headers.get("location");
        if (!location) {
          emit({
            reason: "redirect_rejected",
            bytes_read: 0,
            redirect_hops: redirectHops,
          });
          return { ok: false, reason: "bad_url" };
        }

        let nextUrl: URL;
        try {
          nextUrl = new URL(location, currentUrl);
        } catch {
          emit({
            reason: "redirect_rejected",
            bytes_read: 0,
            redirect_hops: redirectHops,
          });
          return { ok: false, reason: "bad_url" };
        }

        const recheck = assertOfficeCallbackUrlAllowed(
          nextUrl.toString(),
          allowlist,
        );
        if (!recheck.ok) {
          emit({
            reason: "redirect_rejected",
            bytes_read: 0,
            redirect_hops: redirectHops,
          });
          return { ok: false, reason: "bad_url" };
        }

        currentUrl = recheck.url.toString();
        redirectHops += 1;
        continue;
      }

      if (!response.ok) {
        if (response.body) {
          await response.body.cancel().catch(() => undefined);
        }
        emit({
          reason: "fetch_failed",
          bytes_read: 0,
          redirect_hops: redirectHops,
        });
        return { ok: false, reason: "fetch_failed" };
      }

      // Early reject on declared Content-Length (still stream-cap when absent).
      const lenHeader = response.headers.get("content-length");
      if (lenHeader) {
        const declared = Number(lenHeader);
        if (Number.isFinite(declared) && declared > input.maxBytes) {
          if (response.body) {
            await response.body.cancel().catch(() => undefined);
          }
          emit({
            reason: "oversized",
            bytes_read: 0,
            redirect_hops: redirectHops,
          });
          return { ok: false, reason: "oversized" };
        }
      }

      // Body-read budget is independent of connect/TTFB timeout above.
      const read = await readOfficeCallbackBodyWithCap({
        response,
        maxBytes: input.maxBytes,
        maxReadDurationMs,
      });

      if (!read.ok) {
        emit({
          reason: read.reason === "timeout" ? "timeout" : read.reason,
          bytes_read: 0,
          redirect_hops: redirectHops,
        });
        // Preserve oversized; map timeout → fetch_failed for callers.
        return {
          ok: false,
          reason: read.reason === "oversized" ? "oversized" : "fetch_failed",
        };
      }

      emit({
        reason: "success",
        bytes_read: read.bytes.byteLength,
        redirect_hops: redirectHops,
      });
      return {
        ok: true,
        bytes: read.bytes,
        contentType: response.headers.get("content-type") ?? undefined,
      };
    }
  };
}

function deny(
  reason: OfficeCallbackDenyReason,
  httpStatus: number,
  onlyoffice_status?: number,
  session_id?: string,
): OfficeCallbackHandleResult {
  return {
    httpStatus,
    body: { error: 1, code: reason },
    save: {
      status:
        reason === "expired"
          ? "expired"
          : reason === "write_conflict"
            ? "conflict"
            : reason === "mode" ||
                reason === "lifecycle" ||
                reason === "invalid_nonce" ||
                reason === "tenant_mismatch" ||
                reason === "closed" ||
                reason === "not_found" ||
                reason === "missing_session_id" ||
                reason === "missing_nonce"
              ? "forbidden"
              : "upstream_error",
      session_id,
      onlyoffice_status,
      error_code: reason,
    },
  };
}

function accepted(
  code: NonNullable<OnlyOfficeCallbackResponse["code"]>,
  save: NonNullable<OfficeCallbackHandleResult["save"]>,
): OfficeCallbackHandleResult {
  return {
    httpStatus: 200,
    body: { error: 0, code },
    save,
  };
}

/**
 * Authorize callback against server-owned session (nonce + tenant + write gate).
 * Non-write statuses (ignore / save_error) still require nonce + tenant but
 * allow broader lifecycles so final "closed" acks work after save.
 */
export function authorizeOfficeCallback(input: {
  session: OfficeDocumentSession | null;
  tenant_id: string;
  nonce: string | null;
  action: OfficeCallbackAction;
  now?: Date;
}):
  | { ok: true; session: OfficeDocumentSession }
  | { ok: false; reason: OfficeCallbackDenyReason; httpStatus: number } {
  if (!input.nonce) {
    return { ok: false, reason: "missing_nonce", httpStatus: 401 };
  }
  if (!input.session) {
    return { ok: false, reason: "not_found", httpStatus: 404 };
  }
  if (!verifyCallbackNonce(input.nonce, input.session.callback_nonce)) {
    return { ok: false, reason: "invalid_nonce", httpStatus: 403 };
  }

  if (input.action === "save" || input.action === "force_save") {
    // Duplicate final-save retries: session already saved; allow through so
    // handleOfficeCallback can return { error: 0 } without a second write.
    if (
      input.action === "save" &&
      input.session.tenant_id === input.tenant_id &&
      input.session.lifecycle === "saved" &&
      input.session.last_save_status === "saved"
    ) {
      return { ok: true, session: input.session };
    }

    const authz = authorizeOfficeSession({
      session: input.session,
      tenant_id: input.tenant_id,
      purpose: "write",
      now: input.now,
    });
    if (!authz.ok) {
      return {
        ok: false,
        reason: authz.reason as OfficeCallbackDenyReason,
        httpStatus: authz.reason === "not_found" ? 404 : 403,
      };
    }
    return { ok: true, session: authz.session };
  }

  // ignore / save_error / unknown: still require tenant + not-expired for session mapping
  if (input.session.tenant_id !== input.tenant_id) {
    return { ok: false, reason: "tenant_mismatch", httpStatus: 403 };
  }
  const expMs = Date.parse(input.session.expires_at);
  const now = input.now ?? new Date();
  if (!Number.isFinite(expMs) || now.getTime() >= expMs) {
    return { ok: false, reason: "expired", httpStatus: 403 };
  }
  if (input.session.lifecycle === "closed" && input.action === "save_error") {
    // Allow ack of errors on closed sessions.
    return { ok: true, session: input.session };
  }
  return { ok: true, session: input.session };
}

export type HandleOfficeCallbackInput = {
  tenant_id: string;
  session_id: string | null;
  nonce: string | null;
  rawBody: unknown;
  store: OfficeDocumentSessionStore;
  allowlist: OfficeCallbackAllowlistConfig;
  fetchBytes: OfficeCallbackFetcher;
  writeVault: OfficeCallbackVaultWriter;
  maxBytes?: number;
  now?: Date;
};

/**
 * Full callback pipeline: parse → auth → status action → optional fetch/write.
 * Path and expected_revision are taken only from OfficeDocumentSession.
 */
export async function handleOfficeCallback(
  input: HandleOfficeCallbackInput,
): Promise<OfficeCallbackHandleResult> {
  const now = input.now ?? new Date();
  const maxBytes = resolveOfficeDownloadMaxBytes(
    input.maxBytes ?? DEFAULT_OFFICE_FILE_MAX_BYTES,
  );

  if (!input.session_id) {
    return deny("missing_session_id", 401);
  }

  const parsed = parseOnlyOfficeCallbackPayload(input.rawBody);
  if (!parsed.ok) {
    return deny("invalid_payload", 400);
  }
  const { payload } = parsed;
  if (!isOfficeCallbackStatus(payload.status)) {
    return deny("unsupported_status", 400, payload.status, input.session_id);
  }

  const action = mapOnlyOfficeCallbackStatus(payload.status);
  if (action === "unknown") {
    return deny("unsupported_status", 400, payload.status, input.session_id);
  }

  const session = await input.store.get(input.session_id);
  const authz = authorizeOfficeCallback({
    session,
    tenant_id: input.tenant_id,
    nonce: input.nonce,
    action,
    now,
  });
  if (!authz.ok) {
    return deny(authz.reason, authz.httpStatus, payload.status, input.session_id);
  }
  const bound = authz.session;

  // Optional document.key consistency check (soft): mismatch is not path retarget,
  // but may indicate wrong session binding — fail closed for save actions.
  if (
    (action === "save" || action === "force_save") &&
    payload.key &&
    payload.key !== bound.document_key
  ) {
    return deny("invalid_payload", 403, payload.status, bound.session_id);
  }

  const callbackAt = now.toISOString();

  if (action === "ignore") {
    await input.store.put({
      ...bound,
      last_callback_at: callbackAt,
    });
    return accepted("ignored", {
      status: "ignored",
      session_id: bound.session_id,
      onlyoffice_status: payload.status,
    });
  }

  if (action === "save_error") {
    await input.store.updateLifecycle(bound.session_id, bound.lifecycle, {
      last_save_status: "failed",
      last_callback_at: callbackAt,
    });
    return accepted("save_error", {
      status: "upstream_error",
      session_id: bound.session_id,
      onlyoffice_status: payload.status,
      error_code: "write_failed",
    });
  }

  // --- save / force_save ---

  // Duplicate final save: session already saved and DS retries status 2.
  if (
    action === "save" &&
    bound.lifecycle === "saved" &&
    bound.last_save_status === "saved" &&
    bound.saved_revision
  ) {
    await input.store.put({
      ...bound,
      last_callback_at: callbackAt,
    });
    return accepted("duplicate", {
      status: "duplicate",
      session_id: bound.session_id,
      onlyoffice_status: payload.status,
      new_revision: bound.saved_revision,
      idempotent_replay: true,
    });
  }

  // Also treat lifecycle not writable but already saved as duplicate for status 2.
  if (action === "save" && bound.lifecycle === "saved") {
    return accepted("duplicate", {
      status: "duplicate",
      session_id: bound.session_id,
      onlyoffice_status: payload.status,
      new_revision: bound.saved_revision,
      idempotent_replay: true,
    });
  }

  const url = payload.url?.trim();
  if (!url) {
    return deny("missing_url", 400, payload.status, bound.session_id);
  }

  const urlCheck = assertOfficeCallbackUrlAllowed(url, input.allowlist);
  if (!urlCheck.ok) {
    return deny("bad_url", 403, payload.status, bound.session_id);
  }

  // Mark saving before network I/O (best-effort).
  await input.store.updateLifecycle(bound.session_id, "saving", {
    last_save_status: "pending",
    last_callback_at: callbackAt,
  });

  const fetched = await input.fetchBytes({ url, maxBytes });
  if (!fetched.ok) {
    await input.store.updateLifecycle(bound.session_id, "active", {
      last_save_status: "failed",
      last_callback_at: callbackAt,
    });
    return deny(fetched.reason, 502, payload.status, bound.session_id);
  }

  const contentSha256Hex = sha256Hex(fetched.bytes);
  // Re-load session in case concurrent update (use bound revision for CAS).
  const latest = (await input.store.get(bound.session_id)) ?? bound;
  const writeParams = buildOfficeCallbackWriteParams({
    session: latest.lifecycle === "saving" ? { ...latest, revision: bound.revision, saved_revision: bound.saved_revision } : latest,
    bytes: fetched.bytes,
    status: payload.status,
    contentSha256Hex,
  });

  let writeResult: VaultWriteHttpBody;
  try {
    writeResult = await input.writeVault({
      session: bound,
      params: writeParams,
    });
  } catch (err) {
    return await mapWriteError(err, input.store, bound, payload.status, callbackAt);
  }

  const newRevision: DocumentRevision = writeResult.revision;
  const nextLifecycle: OfficeSessionLifecycle =
    action === "save" ? "saved" : "active";
  const nextSave: OfficeLastSaveStatus = "saved";

  await input.store.put({
    ...((await input.store.get(bound.session_id)) ?? bound),
    lifecycle: nextLifecycle,
    last_save_status: nextSave,
    last_callback_at: callbackAt,
    saved_revision: newRevision,
    // Advance CAS base so subsequent force-saves match host.
    revision: newRevision,
    dirty: action === "force_save",
  });

  return accepted(action === "save" ? "saved" : "force_saved", {
    status: writeResult.idempotent_replay ? "duplicate" : "saved",
    session_id: bound.session_id,
    onlyoffice_status: payload.status,
    new_revision: newRevision,
    idempotent_replay: writeResult.idempotent_replay === true,
  });
}

async function mapWriteError(
  err: unknown,
  store: OfficeDocumentSessionStore,
  bound: OfficeDocumentSession,
  onlyofficeStatus: number,
  callbackAt: string,
): Promise<OfficeCallbackHandleResult> {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code: unknown }).code)
      : "";
  const message =
    err instanceof Error ? err.message : "vault.write failed";

  if (code === "conflict" || /revision_mismatch|conflict/i.test(message)) {
    await store.updateLifecycle(bound.session_id, "conflict", {
      last_save_status: "conflict",
      last_callback_at: callbackAt,
    });
    // Accepted handling of conflict: DS should stop retrying the same bytes.
    return accepted("conflict", {
      status: "conflict",
      session_id: bound.session_id,
      onlyoffice_status: onlyofficeStatus,
      error_code: "write_conflict",
    });
  }

  if (code === "forbidden") {
    await store.updateLifecycle(bound.session_id, "active", {
      last_save_status: "forbidden",
      last_callback_at: callbackAt,
    });
    return deny("write_forbidden", 403, onlyofficeStatus, bound.session_id);
  }

  if (code === "method_not_found" || code === "not_implemented") {
    await store.updateLifecycle(bound.session_id, "active", {
      last_save_status: "failed",
      last_callback_at: callbackAt,
    });
    return deny("write_unavailable", 503, onlyofficeStatus, bound.session_id);
  }

  if (code === "payload_too_large") {
    await store.updateLifecycle(bound.session_id, "active", {
      last_save_status: "failed",
      last_callback_at: callbackAt,
    });
    return deny("oversized", 413, onlyofficeStatus, bound.session_id);
  }

  await store.updateLifecycle(bound.session_id, "active", {
    last_save_status: "failed",
    last_callback_at: callbackAt,
  });
  return deny("write_failed", 502, onlyofficeStatus, bound.session_id);
}

/**
 * Build public callback URL for editor config (lp-5q6.26 consumers).
 * Includes session_id + nonce query params.
 */
export function buildOfficeCallbackUrl(input: {
  publicBaseUrl: string;
  sessionId: string;
  callbackNonce: string;
  tenantPathPrefix?: string;
}): string {
  const base = input.publicBaseUrl.replace(/\/+$/, "");
  const prefix = (input.tenantPathPrefix ?? "").replace(/\/+$/, "");
  const path = `${prefix}/api/office/callback`;
  const url = new URL(path.startsWith("http") ? path : `${base}${path}`);
  url.searchParams.set("session_id", input.sessionId);
  url.searchParams.set("nonce", input.callbackNonce);
  return url.toString();
}

/** Redact nonce from callback URL for logs. */
export function redactOfficeCallbackUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("nonce")) {
      parsed.searchParams.set("nonce", "[redacted]");
    }
    return parsed.toString();
  } catch {
    return "[invalid-url]";
  }
}

/**
 * Resolve Document Server host allowlist from environment.
 *
 * Env: BFF_OFFICE_DOCUMENT_SERVER_HOSTS=host1,host2 (required for save callbacks)
 * Optional: BFF_OFFICE_DOCUMENT_SERVER_SCHEMES=http,https
 */
export function loadOfficeCallbackAllowlist(
  env: NodeJS.ProcessEnv = process.env,
): OfficeCallbackAllowlistConfig {
  const hostsRaw =
    env.BFF_OFFICE_DOCUMENT_SERVER_HOSTS?.trim() ||
    env.ONLYOFFICE_DOCUMENT_SERVER_HOSTS?.trim() ||
    "";
  const hosts = hostsRaw
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  const schemesRaw = env.BFF_OFFICE_DOCUMENT_SERVER_SCHEMES?.trim();
  const schemes = schemesRaw
    ? schemesRaw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    : ["http", "https"];

  return { hosts, schemes };
}
