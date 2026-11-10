/**
 * User-facing copy for Office save / callback failures (lp-5q6.28).
 *
 * Used by the editor host (lp-5q6.27) and lab go/no-go proof.
 * Never embed vault paths, JWT, download tokens, nonces, or file bodies.
 */

export type OfficeSaveUserErrorCode =
  | "callback_save_issue"
  | "save_conflict"
  | "document_server_unreachable"
  | "save_rejected"
  | "session_expired";

export type OfficeSaveUserError = {
  code: OfficeSaveUserErrorCode;
  /** Short message safe to show in the document pane. */
  message: string;
  retryable: boolean;
};

/**
 * Map BFF callback / last_save codes and operator classes to pane copy.
 * Accepts BOTH BFF body.code values and operator_class strings.
 */
export function mapOfficeSaveFailureToUserError(input: {
  /** BFF callback body.code or last_save_status or operator_class. */
  code?: string | null;
  /** Optional HTTP status from a poll/mint path. */
  status?: number;
}): OfficeSaveUserError {
  const raw = (input.code ?? "").toLowerCase().trim();

  if (
    raw === "conflict" ||
    raw === "write_conflict" ||
    raw === "host_write_conflict"
  ) {
    return {
      code: "save_conflict",
      message:
        "This document changed while you were editing. Reload to see the latest version, then re-apply your edits.",
      retryable: true,
    };
  }

  if (
    raw === "fetch_failed" ||
    raw === "document_server_unreachable"
  ) {
    return {
      code: "document_server_unreachable",
      message:
        "Could not reach Document Server to finish saving. Check that the lab Document Server is running and try save again.",
      retryable: true,
    };
  }

  if (
    raw === "expired" ||
    raw === "closed" ||
    raw === "session_unavailable" ||
    raw === "not_found"
  ) {
    return {
      code: "session_expired",
      message:
        "Your editing session expired. Re-open the document to continue editing.",
      retryable: true,
    };
  }

  if (
    raw === "invalid_nonce" ||
    raw === "missing_nonce" ||
    raw === "bad_url" ||
    raw === "invalid_payload" ||
    raw === "write_forbidden" ||
    raw === "bff_callback_rejected" ||
    raw === "forbidden"
  ) {
    return {
      code: "save_rejected",
      message:
        "Save was rejected by the server. Your latest changes may not be stored — try save again or reload.",
      retryable: true,
    };
  }

  // status 3 / 7 save_error, write_failed, failed, or unknown
  return {
    code: "callback_save_issue",
    message:
      "The editor reported a save problem. Your latest changes may not be on the server — try save again or reload.",
    retryable: true,
  };
}
