/**
 * Map vault preview fetch failures into ArtifactPanelError codes.
 * Bead: lp-5q6.13
 */

import type { ArtifactErrorCode, ArtifactPanelError } from "./types.js";

export function mapVaultPreviewError(
  err: unknown,
  refPath?: string,
): ArtifactPanelError {
  const message =
    err instanceof Error && err.message.trim()
      ? err.message
      : "Failed to open file";
  const lower = message.toLowerCase();

  let code: ArtifactErrorCode = "unknown";
  if (/\b404\b|not found|missing/i.test(lower)) {
    code = "not_found";
  } else if (/\b403\b|forbidden|denied|unauthorized|401/i.test(lower)) {
    code = "forbidden";
  } else if (/too large|payload|413/i.test(lower)) {
    code = "payload_too_large";
  } else if (/unsupported|mime/i.test(lower)) {
    code = "unsupported_type";
  } else if (/invalid path|bad path/i.test(lower)) {
    code = "invalid_path";
  } else if (/\b5\d\d\b|upstream|gateway|network/i.test(lower)) {
    code = "upstream";
  }

  return {
    code,
    message,
    retryable: code === "upstream" || code === "unknown",
    ref: refPath ? { path: refPath } : undefined,
  };
}
