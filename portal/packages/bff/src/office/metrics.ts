/**
 * Office bridge observability (lp-5q6.33).
 *
 * In-process counters + safe structured log field builders for:
 * - config mint (lp-5q6.26 consumers)
 * - signed download (lp-5q6.22)
 * - editor load (web / lp-5q6.27)
 * - callback status / write success / conflict / error (lp-5q6.23)
 * - chat document pane open/load/error
 *
 * Labels and log fields are **codes and IDs only** — never path, filename,
 * JWT, download token, callback nonce, URL with secrets, or file body.
 *
 * Threat notes: docs/architecture/portal-office-document-bridge-threat-notes.md §5.11
 * Catalog: docs/architecture/portal-office-observability.md
 */

/** Coarse size buckets for logs/metrics (not exact byte lengths as labels). */
export type OfficeSizeBucket =
  | "unknown"
  | "empty"
  | "lt_1kb"
  | "1kb_64kb"
  | "64kb_1mb"
  | "1mb_10mb"
  | "10mb_50mb"
  | "gte_50mb";

/**
 * Operator-facing failure classes for support dashboards.
 * Maps low-level deny/error codes into four primary distinctions from
 * acceptance: Document Server unreachable, BFF callback rejected, host write
 * conflict, unsupported type — plus a few adjacent classes.
 */
export type OfficeOperatorClass =
  | "ok"
  | "document_server_unreachable"
  | "bff_callback_rejected"
  | "host_write_conflict"
  | "unsupported_type"
  | "auth_denied"
  | "session_unavailable"
  | "oversized"
  | "write_failed"
  | "ignored"
  | "duplicate"
  | "unknown";

/** Metric event names (stable strings for future Prometheus export). */
export type OfficeMetricEvent =
  | "office_config_mint"
  | "office_download"
  | "office_editor_load"
  | "office_callback"
  | "office_write"
  | "office_pane";

export type OfficeMetricOutcome =
  | "success"
  | "error"
  | "denied"
  | "conflict"
  | "ignored"
  | "duplicate"
  | "pending";

/**
 * Snapshot of counters. All values are non-negative integers.
 * Nested maps use only enum-like keys (result codes), never free-form paths.
 */
export type OfficeMetricsSnapshot = {
  config_mint_total: number;
  config_mint_by_outcome: Record<string, number>;
  download_total: number;
  download_by_outcome: Record<string, number>;
  download_by_reason: Record<string, number>;
  editor_load_total: number;
  editor_load_by_outcome: Record<string, number>;
  callback_total: number;
  callback_by_code: Record<string, number>;
  callback_by_onlyoffice_status: Record<string, number>;
  /**
   * Callback assembled-file fetch outcomes (lp-p37.9).
   * Keys are low-cardinality reasons: success, oversized, timeout, …
   */
  callback_fetch_total: number;
  callback_fetch_by_reason: Record<string, number>;
  /** Successful callback downloads that were stream-capped (byte cap hit). */
  callback_fetch_capped_total: number;
  write_success_total: number;
  write_conflict_total: number;
  write_error_total: number;
  pane_open_total: number;
  pane_load_total: number;
  pane_error_total: number;
  pane_by_error_code: Record<string, number>;
  error_by_operator_class: Record<string, number>;
};

export type OfficeSafeLogFields = {
  /** Correlation id when available (request / open id). */
  request_id?: string;
  tenant_id?: string;
  /**
   * Opaque Office document session id.
   * Named `office_session_id` (not `session_id`) so G2b secret redaction of
   * browser session cookies does not strip the operator correlation field.
   */
  office_session_id?: string;
  route?: string;
  /** HTTP or domain status (numeric when HTTP). */
  status?: number | string;
  /** Duration in milliseconds (integer). */
  latency_ms?: number;
  /** Coarse size bucket — prefer over raw size_bytes in multi-tenant labels. */
  size_bucket?: OfficeSizeBucket;
  /** Exact size is allowed in L1 logs (threat notes: byte length optional). */
  size_bytes?: number;
  error_code?: string;
  /** Operator class for dashboards. */
  operator_class?: OfficeOperatorClass;
  outcome?: OfficeMetricOutcome;
  file_type?: string;
  mode?: string;
  onlyoffice_status?: number;
  idempotent_replay?: boolean;
  event?: OfficeMetricEvent;
};

const emptySnapshot = (): OfficeMetricsSnapshot => ({
  config_mint_total: 0,
  config_mint_by_outcome: {},
  download_total: 0,
  download_by_outcome: {},
  download_by_reason: {},
  editor_load_total: 0,
  editor_load_by_outcome: {},
  callback_total: 0,
  callback_by_code: {},
  callback_by_onlyoffice_status: {},
  callback_fetch_total: 0,
  callback_fetch_by_reason: {},
  callback_fetch_capped_total: 0,
  write_success_total: 0,
  write_conflict_total: 0,
  write_error_total: 0,
  pane_open_total: 0,
  pane_load_total: 0,
  pane_error_total: 0,
  pane_by_error_code: {},
  error_by_operator_class: {},
});

function bump(map: Record<string, number>, key: string, n = 1): void {
  // Cap key length so a buggy caller cannot unbounded-label the map.
  const safe = key.slice(0, 64) || "unknown";
  map[safe] = (map[safe] ?? 0) + n;
}

/**
 * Map byte length → coarse bucket for metrics labels / log fields.
 * Prefer buckets over exact sizes when exporting as metric labels.
 */
export function officeSizeBucket(
  sizeBytes: number | undefined | null,
): OfficeSizeBucket {
  if (sizeBytes === undefined || sizeBytes === null) return "unknown";
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return "unknown";
  if (sizeBytes === 0) return "empty";
  if (sizeBytes < 1024) return "lt_1kb";
  if (sizeBytes < 64 * 1024) return "1kb_64kb";
  if (sizeBytes < 1024 * 1024) return "64kb_1mb";
  if (sizeBytes < 10 * 1024 * 1024) return "1mb_10mb";
  if (sizeBytes < 50 * 1024 * 1024) return "10mb_50mb";
  return "gte_50mb";
}

/**
 * Map download deny reasons and callback error codes to operator classes.
 * Acceptance: distinguish DS unreachable, BFF callback rejected, host write
 * conflict, unsupported type.
 */
export function classifyOfficeError(
  code: string | undefined | null,
): OfficeOperatorClass {
  if (!code) return "unknown";
  switch (code) {
    case "ok":
    case "saved":
    case "force_saved":
      return "ok";
    case "ignored":
      return "ignored";
    case "duplicate":
      return "duplicate";
    case "fetch_failed":
      return "document_server_unreachable";
    case "write_conflict":
    case "conflict":
      return "host_write_conflict";
    case "unsupported_file_type":
    case "unsupported_type":
    case "path_type_mismatch":
      return "unsupported_type";
    case "missing_token":
    case "invalid_token":
    case "missing_nonce":
    case "invalid_nonce":
    case "missing_session_id":
    case "tenant_mismatch":
    case "mode":
    case "lifecycle":
    case "revision_mismatch":
    case "bad_url":
    case "missing_url":
    case "invalid_payload":
    case "unsupported_status":
    case "write_forbidden":
      return "bff_callback_rejected";
    case "not_found":
    case "expired":
    case "closed":
    case "missing_file":
      return "session_unavailable";
    case "oversized":
    case "payload_too_large":
      return "oversized";
    case "write_failed":
    case "write_unavailable":
    case "save_error":
      return "write_failed";
    // Download auth denials (not callback, but same auth_denied bucket for ops).
    case "auth_denied":
      return "auth_denied";
    default:
      return "unknown";
  }
}

/**
 * Download-specific: auth denials vs content failures.
 * Invalid/missing token → auth_denied; unsupported type stays unsupported_type.
 */
export function classifyOfficeDownloadReason(
  reason: string,
): OfficeOperatorClass {
  switch (reason) {
    case "missing_token":
    case "invalid_token":
    case "tenant_mismatch":
    case "mode":
    case "lifecycle":
    case "revision_mismatch":
      return "auth_denied";
    case "unsupported_file_type":
    case "path_type_mismatch":
      return "unsupported_type";
    case "not_found":
    case "expired":
    case "closed":
    case "missing_file":
      return "session_unavailable";
    case "oversized":
    case "payload_too_large":
      return "oversized";
    default:
      return classifyOfficeError(reason);
  }
}

/** Build a structured log object with only safe fields (no secrets/bodies). */
export function buildOfficeSafeLogFields(
  fields: OfficeSafeLogFields,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (fields.request_id !== undefined) out.request_id = fields.request_id;
  if (fields.tenant_id !== undefined) out.tenant_id = fields.tenant_id;
  if (fields.office_session_id !== undefined) {
    out.office_session_id = fields.office_session_id;
  }
  if (fields.route !== undefined) out.route = fields.route;
  if (fields.status !== undefined) out.status = fields.status;
  if (fields.latency_ms !== undefined) {
    out.latency_ms = Math.max(0, Math.round(fields.latency_ms));
  }
  if (fields.size_bucket !== undefined) out.size_bucket = fields.size_bucket;
  if (fields.size_bytes !== undefined) out.size_bytes = fields.size_bytes;
  if (fields.error_code !== undefined) out.error_code = fields.error_code;
  if (fields.operator_class !== undefined) {
    out.operator_class = fields.operator_class;
  }
  if (fields.outcome !== undefined) out.outcome = fields.outcome;
  if (fields.file_type !== undefined) out.file_type = fields.file_type;
  if (fields.mode !== undefined) out.mode = fields.mode;
  if (fields.onlyoffice_status !== undefined) {
    out.onlyoffice_status = fields.onlyoffice_status;
  }
  if (fields.idempotent_replay !== undefined) {
    out.idempotent_replay = fields.idempotent_replay;
  }
  if (fields.event !== undefined) out.event = fields.event;
  return scrubOfficeLogFields(out);
}

/**
 * Keys that must never appear in Office log fields even if a caller passes them.
 * Defense-in-depth on top of @lanyard/shared redactForLog.
 */
export const OFFICE_FORBIDDEN_LOG_KEYS: ReadonlySet<string> = new Set([
  "token",
  "download_token",
  "callback_nonce",
  "nonce",
  "jwt",
  "editor_jwt",
  "authorization",
  "body",
  "content",
  "file_bytes",
  "vault_content",
  "vault_body",
  "callback_url",
  "download_url",
  "url",
  "password",
  "secret",
]);

/** Strip forbidden keys from a log fields object (shallow). */
export function scrubOfficeLogFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (OFFICE_FORBIDDEN_LOG_KEYS.has(key.toLowerCase())) continue;
    out[key] = value;
  }
  return out;
}

export class OfficeMetrics {
  private snap: OfficeMetricsSnapshot = emptySnapshot();

  /** Reset all counters (tests). */
  reset(): void {
    this.snap = emptySnapshot();
  }

  /** Deep copy for operators / tests. */
  snapshot(): OfficeMetricsSnapshot {
    return structuredClone(this.snap);
  }

  private noteOperatorClass(cls: OfficeOperatorClass, isError: boolean): void {
    if (!isError && (cls === "ok" || cls === "ignored" || cls === "duplicate")) {
      return;
    }
    if (cls === "ok" || cls === "ignored" || cls === "duplicate") return;
    bump(this.snap.error_by_operator_class, cls);
  }

  /**
   * Config / editor JWT mint (lp-5q6.26). Call from mint route when it lands.
   */
  recordConfigMint(input: {
    outcome: OfficeMetricOutcome;
    error_code?: string;
  }): void {
    this.snap.config_mint_total += 1;
    bump(this.snap.config_mint_by_outcome, input.outcome);
    if (input.outcome === "error" || input.outcome === "denied") {
      this.noteOperatorClass(
        classifyOfficeError(input.error_code),
        true,
      );
    }
  }

  recordDownload(input: {
    outcome: OfficeMetricOutcome;
    reason?: string;
  }): void {
    this.snap.download_total += 1;
    bump(this.snap.download_by_outcome, input.outcome);
    if (input.reason) {
      bump(this.snap.download_by_reason, input.reason);
      if (input.outcome !== "success") {
        this.noteOperatorClass(
          classifyOfficeDownloadReason(input.reason),
          true,
        );
      }
    }
  }

  /**
   * Editor iframe/api.js load (web host). Call from web or BFF when reported.
   */
  recordEditorLoad(input: {
    outcome: OfficeMetricOutcome;
    error_code?: string;
  }): void {
    this.snap.editor_load_total += 1;
    bump(this.snap.editor_load_by_outcome, input.outcome);
    if (input.outcome === "error" || input.outcome === "denied") {
      this.noteOperatorClass(
        classifyOfficeError(input.error_code ?? "unknown"),
        true,
      );
    }
  }

  /**
   * Callback assembled-file download (stream/cap path, lp-p37.9).
   * Reasons are enum-like only — never URLs or body lengths as label keys.
   * Operator-class errors remain attributed by {@link recordCallback} so we
   * do not double-count when both fire for the same request.
   */
  recordCallbackFetch(input: {
    reason: string;
    /** When true, body was aborted because maxBytes was exceeded. */
    capped?: boolean;
  }): void {
    this.snap.callback_fetch_total += 1;
    bump(this.snap.callback_fetch_by_reason, input.reason);
    if (input.capped || input.reason === "oversized") {
      this.snap.callback_fetch_capped_total += 1;
    }
  }

  /**
   * Callback handling. Maps ONLYOFFICE body.code + save status into counters.
   */
  recordCallback(input: {
    code?: string;
    onlyoffice_status?: number;
    save_status?: string;
    error_code?: string;
  }): void {
    this.snap.callback_total += 1;
    const code = input.code ?? "unknown";
    bump(this.snap.callback_by_code, code);
    if (input.onlyoffice_status !== undefined) {
      bump(
        this.snap.callback_by_onlyoffice_status,
        String(input.onlyoffice_status),
      );
    }

    const save = input.save_status;
    if (save === "saved" || code === "saved" || code === "force_saved") {
      this.snap.write_success_total += 1;
    } else if (save === "conflict" || code === "conflict") {
      this.snap.write_conflict_total += 1;
      this.noteOperatorClass("host_write_conflict", true);
    } else if (
      save === "upstream_error" ||
      save === "forbidden" ||
      save === "expired" ||
      (typeof input.error_code === "string" && input.error_code.length > 0) ||
      (code !== "ok" &&
        code !== "ignored" &&
        code !== "duplicate" &&
        code !== "saved" &&
        code !== "force_saved")
    ) {
      // Error path: BFF rejection or write failure.
      if (save !== "ignored" && save !== "duplicate") {
        this.snap.write_error_total += 1;
        this.noteOperatorClass(
          classifyOfficeError(input.error_code ?? code),
          true,
        );
      }
    }
  }

  recordPane(input: {
    kind: "open" | "load" | "error";
    error_code?: string;
  }): void {
    if (input.kind === "open") this.snap.pane_open_total += 1;
    if (input.kind === "load") this.snap.pane_load_total += 1;
    if (input.kind === "error") {
      this.snap.pane_error_total += 1;
      if (input.error_code) {
        bump(this.snap.pane_by_error_code, input.error_code);
        this.noteOperatorClass(classifyOfficeError(input.error_code), true);
      }
    }
  }
}

/** Process-wide default registry (tests may `reset()` or inject their own). */
export const officeMetrics = new OfficeMetrics();
