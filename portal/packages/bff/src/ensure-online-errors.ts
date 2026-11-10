/**
 * Map Control Plane ensure_online / presence failures to user-visible errors
 * with stable codes and retry guidance (lp-mrh / Phase 5).
 *
 * Call sites:
 * - Chat send (`app.ts` POST messages) — structured JSON body on wake fail
 * - Brain RPC (`controlPlaneEnsureOnlineToBackendError`) — BackendRuntimeError
 * - Channel adapters (`deliverChannelAdapterInbound`) — ok:false + code
 *
 * Never swallows failures: mapped errors are non-2xx so clients can surface
 * the failure and retry; chat must not deliver-inbound or appendHistory on
 * wake failure (no silent drop of the user message).
 *
 * @see docs/plans/0008-daytona-agent-sandboxes/wake-failure-errors.md
 * @see docs/plans/0008-daytona-agent-sandboxes/cp-internal-orchestrator-api.md
 */

import { ControlPlaneRequestError } from "./control-plane-client.js";

/**
 * Stable BFF-facing codes for wake / ensure_online failures.
 * Prefer these over raw CP `ENSURE_ONLINE_*` strings in UI and logs.
 */
export const WAKE_FAILURE_CODES = [
  "wake_timeout",
  "daytona_unavailable",
  "vault_mount_failed",
  "wake_failed",
  "daytona_path_gated",
  "instance_revoked",
  "not_found",
  "not_implemented",
  "rate_limited",
  "invalid_argument",
  "forbidden",
  "unavailable",
] as const;

export type WakeFailureCode = (typeof WAKE_FAILURE_CODES)[number];

/** BackendRuntimeError codes used by vault/settings/projects handlers. */
export type WakeBackendErrorCode =
  | "timeout"
  | "unavailable"
  | "forbidden"
  | "not_found"
  | "rate_limited"
  | "invalid_argument"
  | "not_implemented"
  | "internal";

export type WakeFailureMapping = {
  /** Stable user/API code (lp-mrh). */
  code: WakeFailureCode;
  /** HTTP status for chat / direct routes. */
  httpStatus: number;
  /** BackendRuntimeError code for Brain RPC / vault paths. */
  backendCode: WakeBackendErrorCode;
  /** Short machine-oriented error string (also `error` JSON field). */
  error: string;
  /** Human-readable explanation safe to show in UI. */
  message: string;
  /** Whether the client should offer a retry of the same action. */
  retryable: boolean;
  /** Short guidance for UI / operator copy. */
  retryGuidance: string;
  /** CP wire code when known (e.g. ENSURE_ONLINE_TIMEOUT). */
  cpCode?: string;
  /** Original CP HTTP status. */
  status: number;
  /** Phase label for multi-step paths (chat / channel). */
  phase: "ensure_online";
};

/** JSON body returned on chat (and similar) wake failures. */
export type WakeFailureJsonBody = {
  error: string;
  code: WakeFailureCode;
  message: string;
  retryable: boolean;
  retry_guidance: string;
  phase: "ensure_online";
  /** CP code when present (debug / support). */
  cp_code?: string;
};

const VAULT_MOUNT_HINT =
  /vault\s*mount|s3_vault_prefix|invalid_s3_vault|invalid_vault_root|vault_root|mountpath|mount path|lanyard_vault_bucket/i;

const DAYTONA_DOWN_HINT =
  /daytona\s*(api\s*)?(down|unavailable)|api\s*down|econnrefused|enotfound|fetch failed|network|502 bad gateway|service unavailable|connection refused|timed?\s*out.*daytona|daytona.*timed?\s*out/i;

/**
 * Classify a ControlPlaneRequestError from ensure_online / presence into a
 * user-visible wake failure (timeout, Daytona down, vault mount, …).
 */
export function mapControlPlaneWakeFailure(
  error: ControlPlaneRequestError,
): WakeFailureMapping {
  const status = error.status;
  const cpCode = error.code?.trim() || undefined;
  const rawMessage = (error.message || "").trim();
  const haystack = `${cpCode ?? ""} ${rawMessage}`;

  // --- Timeout (CP wait_timeout_ms / singleflight) ---
  if (
    status === 504 ||
    cpCode === "ENSURE_ONLINE_TIMEOUT" ||
    /ensure_online_timeout/i.test(rawMessage)
  ) {
    return base({
      code: "wake_timeout",
      httpStatus: 504,
      backendCode: "timeout",
      error: "wake_timeout",
      message:
        "The agent is taking longer than expected to start. Your message was not delivered.",
      retryable: true,
      retryGuidance:
        "Wait a few seconds and send your message again. Cold start can take up to a minute.",
      cpCode: cpCode ?? "ENSURE_ONLINE_TIMEOUT",
      status,
    });
  }

  // --- Authz / path gate / revoke ---
  if (status === 403) {
    if (
      cpCode === "DAYTONA_PATH_GATED" ||
      /daytona_path_gated|path gated|not on .*allowlist|DAYTONA_ENABLED is off/i.test(
        haystack,
      )
    ) {
      return base({
        code: "daytona_path_gated",
        httpStatus: 403,
        backendCode: "forbidden",
        error: "daytona_path_gated",
        message:
          "On-demand agent compute is not enabled for this workspace.",
        retryable: false,
        retryGuidance:
          "Contact your admin to enable Daytona sandboxes for this tenant. Retry will not help until the path is enabled.",
        cpCode: cpCode ?? "DAYTONA_PATH_GATED",
        status,
      });
    }
    return base({
      code: "instance_revoked",
      httpStatus: 403,
      backendCode: "forbidden",
      error: "instance_revoked",
      message: "This agent instance is no longer available.",
      retryable: false,
      retryGuidance:
        "Refresh the page or contact support. Retrying the same message will not wake a revoked instance.",
      cpCode: cpCode ?? "ORCHESTRATOR_INSTANCE_REVOKED",
      status,
    });
  }

  if (status === 404) {
    return base({
      code: "not_found",
      httpStatus: 404,
      backendCode: "not_found",
      error: "instance_not_found",
      message: "No agent instance was found for this workspace.",
      retryable: false,
      retryGuidance:
        "Refresh and try again. If this persists, the workspace may need re-provisioning.",
      cpCode,
      status,
    });
  }

  if (
    status === 501 ||
    cpCode === "ORCHESTRATOR_NOT_IMPLEMENTED" ||
    /not_implemented/i.test(rawMessage)
  ) {
    return base({
      code: "not_implemented",
      httpStatus: 501,
      backendCode: "not_implemented",
      error: "orchestrator_not_implemented",
      message: "Agent wake is not available on this environment yet.",
      retryable: false,
      retryGuidance:
        "This environment is not wired for on-demand wake. Use the always-on path or wait for orchestrator enablement.",
      cpCode: cpCode ?? "ORCHESTRATOR_NOT_IMPLEMENTED",
      status,
    });
  }

  if (
    status === 429 ||
    cpCode === "ENSURE_ONLINE_RATE_LIMITED" ||
    /rate_limited|rate limited/i.test(haystack)
  ) {
    return base({
      code: "rate_limited",
      httpStatus: 429,
      backendCode: "rate_limited",
      error: "rate_limited",
      message: "Too many wake requests. Your message was not delivered.",
      retryable: true,
      retryGuidance: "Wait briefly, then send your message again.",
      cpCode: cpCode ?? "ENSURE_ONLINE_RATE_LIMITED",
      status: status || 429,
    });
  }

  if (status === 400) {
    return base({
      code: "invalid_argument",
      httpStatus: 400,
      backendCode: "invalid_argument",
      error: "invalid_argument",
      message: "The wake request was rejected as invalid.",
      retryable: false,
      retryGuidance: "Refresh the page and try again. Contact support if it continues.",
      cpCode,
      status,
    });
  }

  // --- 502 wake failed: split vault mount vs Daytona down vs generic ---
  if (
    status === 502 ||
    cpCode === "ENSURE_ONLINE_WAKE_FAILED" ||
    /ensure_online_wake_failed|wake failed/i.test(rawMessage)
  ) {
    if (VAULT_MOUNT_HINT.test(haystack)) {
      return base({
        code: "vault_mount_failed",
        httpStatus: 502,
        backendCode: "unavailable",
        error: "vault_mount_failed",
        message:
          "The agent could not attach workspace storage. Your message was not delivered.",
        retryable: false,
        retryGuidance:
          "This is usually a platform configuration issue (vault mount). Retry after support has fixed the mount; repeated retries will not help.",
        cpCode: cpCode ?? "ENSURE_ONLINE_WAKE_FAILED",
        status: status || 502,
      });
    }
    if (DAYTONA_DOWN_HINT.test(haystack) || status === 503) {
      return base({
        code: "daytona_unavailable",
        httpStatus: status === 503 ? 503 : 502,
        backendCode: "unavailable",
        error: "daytona_unavailable",
        message:
          "Agent compute is temporarily unavailable. Your message was not delivered.",
        retryable: true,
        retryGuidance:
          "Wait a minute and send your message again. If this keeps happening, the sandbox provider may be down.",
        cpCode: cpCode ?? "ENSURE_ONLINE_WAKE_FAILED",
        status: status || 502,
      });
    }
    return base({
      code: "wake_failed",
      httpStatus: 502,
      backendCode: "unavailable",
      error: "wake_failed",
      message:
        "The agent failed to start. Your message was not delivered.",
      retryable: true,
      retryGuidance:
        "Send your message again to retry wake. If it fails repeatedly, contact support.",
      cpCode: cpCode ?? "ENSURE_ONLINE_WAKE_FAILED",
      status: status || 502,
    });
  }

  if (status === 503 || DAYTONA_DOWN_HINT.test(haystack)) {
    return base({
      code: "daytona_unavailable",
      httpStatus: 503,
      backendCode: "unavailable",
      error: "daytona_unavailable",
      message:
        "Agent compute is temporarily unavailable. Your message was not delivered.",
      retryable: true,
      retryGuidance:
        "Wait a minute and send your message again. If this keeps happening, the sandbox provider may be down.",
      cpCode,
      status: status || 503,
    });
  }

  // Fallback: other 5xx → unavailable + retry; else forbidden-ish
  if (status >= 500) {
    return base({
      code: "unavailable",
      httpStatus: status,
      backendCode: "unavailable",
      error: "unavailable",
      message:
        "The agent could not be reached. Your message was not delivered.",
      retryable: true,
      retryGuidance: "Retry shortly. If the problem continues, contact support.",
      cpCode,
      status,
    });
  }

  return base({
    code: "forbidden",
    httpStatus: status >= 400 && status < 600 ? status : 502,
    backendCode: "forbidden",
    error: "forbidden",
    message: rawMessage || "Wake was denied.",
    retryable: false,
    retryGuidance: "You may not have permission to wake this agent.",
    cpCode,
    status: status || 403,
  });
}

function base(
  partial: Omit<WakeFailureMapping, "phase">,
): WakeFailureMapping {
  return { ...partial, phase: "ensure_online" };
}

/** JSON body for chat / HTTP clients (lp-mrh). */
export function wakeFailureToJsonBody(
  mapped: WakeFailureMapping,
): WakeFailureJsonBody {
  const body: WakeFailureJsonBody = {
    error: mapped.error,
    code: mapped.code,
    message: mapped.message,
    retryable: mapped.retryable,
    retry_guidance: mapped.retryGuidance,
    phase: mapped.phase,
  };
  if (mapped.cpCode) {
    body.cp_code = mapped.cpCode;
  }
  return body;
}

/**
 * Map for Brain RPC BackendRuntimeError (lp-7bk / lp-mrh shared table).
 * Preserves ensure_online + status in details; adds wake `code` + retryable.
 */
export function wakeFailureToBackendFields(mapped: WakeFailureMapping): {
  code: WakeBackendErrorCode;
  message: string;
  retryable: boolean;
  details: {
    ensure_online: true;
    status: number;
    wake_code: WakeFailureCode;
    retry_guidance: string;
    cp_code?: string;
  };
} {
  return {
    code: mapped.backendCode,
    message: mapped.message,
    retryable: mapped.retryable,
    details: {
      ensure_online: true,
      status: mapped.status,
      wake_code: mapped.code,
      retry_guidance: mapped.retryGuidance,
      ...(mapped.cpCode ? { cp_code: mapped.cpCode } : {}),
    },
  };
}

/** True when an error is a CP wake/presence failure we should map (lp-mrh). */
export function isControlPlaneWakeError(
  error: unknown,
): error is ControlPlaneRequestError {
  return error instanceof ControlPlaneRequestError;
}
