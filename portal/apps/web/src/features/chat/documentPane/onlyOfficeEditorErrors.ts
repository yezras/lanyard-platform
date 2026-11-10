/**
 * Operator- and user-facing copy for ONLYOFFICE host error states
 * (lp-5q6.27 / lp-5q6.28).
 *
 * Save / callback failures use {@link mapOfficeSaveFailureToUserError}
 * so the pane shows understandable copy when status 3 / invalid_nonce /
 * write conflicts surface from the BFF.
 * Never embed vault paths, JWT, or download tokens in messages.
 */

import {
  mapOfficeSaveFailureToUserError,
  type OfficeSaveUserError,
} from "./officeSaveUserErrors.js";
import type {
  OfficeEditorErrorCode,
  OfficeEditorHostError,
} from "./onlyOfficeTypes.js";

const COPY: Record<
  OfficeEditorErrorCode,
  { message: string; retryable: boolean }
> = {
  load_failure: {
    message:
      "Could not load the Office editor. Check that Document Server is reachable and try again.",
    retryable: true,
  },
  unsupported_file: {
    message:
      "This file type is not supported for in-pane Office editing. Use the preview or open the file in Vault.",
    retryable: false,
  },
  no_edit_permission: {
    message:
      "You do not have permission to edit this document. You can still view it when a view session is available.",
    retryable: false,
  },
  callback_save_issue: {
    message:
      "The editor reported a save problem. Your latest changes may not be on the server — try save again or reload.",
    retryable: true,
  },
  config_missing: {
    message:
      "Office editor configuration is not available for this document yet.",
    retryable: true,
  },
  config_mint_failed: {
    message:
      "Could not open an Office editing session. Try again or use the read-only preview.",
    retryable: true,
  },
  not_enabled: {
    message: "Office editing is turned off for this environment.",
    retryable: false,
  },
};

export function officeEditorError(
  code: OfficeEditorErrorCode,
  detail?: string,
): OfficeEditorHostError {
  const base = COPY[code];
  return {
    code,
    message: base.message,
    retryable: base.retryable,
    ...(detail ? { detail } : {}),
  };
}

/**
 * Map BFF callback / last_save codes into the host error union so the pane
 * banner shows the lp-5q6.28 user-facing save copy (not a generic load error).
 */
export function mapSaveFailureToEditorError(input: {
  code?: string | null;
  status?: number;
  detail?: string;
}): OfficeEditorHostError {
  const user: OfficeSaveUserError = mapOfficeSaveFailureToUserError(input);
  // Host union only has callback_save_issue for save-family failures; keep the
  // more specific user message from officeSaveUserErrors.
  return {
    code: "callback_save_issue",
    message: user.message,
    retryable: user.retryable,
    ...(input.detail
      ? { detail: input.detail }
      : user.code !== "callback_save_issue"
        ? { detail: user.code }
        : {}),
  };
}

/** Map BFF mint deny reasons (HTTP body message / reason) to host codes. */
export function mapMintFailureToEditorError(input: {
  status: number;
  reason?: string;
  message?: string;
}): OfficeEditorHostError {
  const reason = (input.reason ?? "").toLowerCase();
  const message = (input.message ?? "").toLowerCase();
  const combined = `${reason} ${message}`;

  if (
    input.status === 400 &&
    (combined.includes("unsupported") || combined.includes("file type"))
  ) {
    return officeEditorError(
      "unsupported_file",
      input.message || input.reason,
    );
  }
  if (
    input.status === 403 &&
    (combined.includes("edit") ||
      combined.includes("vault_edit") ||
      combined.includes("permission") ||
      reason === "edit_not_allowed" ||
      reason === "missing_write_capability")
  ) {
    return officeEditorError(
      "no_edit_permission",
      input.message || input.reason,
    );
  }
  if (input.status === 403) {
    return officeEditorError(
      "no_edit_permission",
      input.message || input.reason,
    );
  }
  return officeEditorError(
    "config_mint_failed",
    input.message || input.reason || `HTTP ${input.status}`,
  );
}
