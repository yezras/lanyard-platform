/**
 * Map shared artifact wire events → pane domain ArtifactEvent.
 *
 * Bead: lp-5q6.14
 * Wire protocol: @lanyard/shared document-pane (lp-5q6.10 / lp-5q6.11)
 * Domain events: ./types.ts (lp-5q6.12)
 */

import type { ArtifactEventWire } from "@lanyard/shared";

import type {
  ArtifactErrorCode,
  ArtifactEvent,
  DocumentRevision,
  VaultArtifactRef,
} from "./types.js";

export type ArtifactWireSource =
  | "explicit"
  | "citation"
  | "tool_progress";

function revisionFromWire(
  revision: ArtifactEventWire["revision"],
): DocumentRevision | undefined {
  if (!revision?.token) return undefined;
  const kind = revision.kind;
  if (
    kind !== "etag" &&
    kind !== "content_hash" &&
    kind !== "host_revision" &&
    kind !== "mtime_size_fallback"
  ) {
    return undefined;
  }
  const out: DocumentRevision = {
    token: revision.token,
    kind,
  };
  if (typeof revision.size_bytes === "number") {
    out.sizeBytes = revision.size_bytes;
  }
  if (typeof revision.modified_at === "string" && revision.modified_at) {
    out.modifiedAt = revision.modified_at;
  }
  return out;
}

function refFromWire(
  wire: ArtifactEventWire,
  source?: VaultArtifactRef["source"],
): VaultArtifactRef {
  const ref: VaultArtifactRef = {
    path: wire.vault_path,
    title: wire.title,
  };
  if (source) ref.source = source;
  return ref;
}

function sourceForWire(
  parseSource: ArtifactWireSource | undefined,
): VaultArtifactRef["source"] | undefined {
  if (parseSource === "citation") return "citation";
  if (parseSource === "tool_progress") return "tool_target";
  if (parseSource === "explicit") return "artifact_event";
  return "artifact_event";
}

function mapErrorCode(code: string | undefined): ArtifactErrorCode {
  switch (code) {
    case "not_found":
    case "forbidden":
    case "payload_too_large":
    case "unsupported_type":
    case "revision_mismatch":
    case "human_edit_active":
    case "session_expired":
    case "upstream":
    case "invalid_path":
      return code;
    default:
      return "unknown";
  }
}

/**
 * Convert a typed wire event into a reducer {@link ArtifactEvent}.
 * Returns null when the wire shape cannot drive the pane (missing path).
 */
export function mapArtifactWireToPanelEvent(
  wire: ArtifactEventWire,
  parseSource?: ArtifactWireSource,
): ArtifactEvent | null {
  if (!wire?.vault_path?.trim() && wire.portal_event !== "artifact.close") {
    // close may omit path when clearing all interest
    if (wire.portal_event !== "artifact.close") return null;
  }

  const source = sourceForWire(parseSource);
  const operationId = wire.operation_id ?? wire.tool_call_id;

  switch (wire.portal_event) {
    case "artifact.open": {
      if (!wire.vault_path?.trim()) return null;
      const revision = revisionFromWire(wire.revision);
      return {
        type: "open",
        ref: refFromWire(wire, source),
        preferredMode: wire.preferred_mode ?? "preview",
        reason: source,
        ...(revision ? { revision } : {}),
        ...(operationId ? { operationId } : {}),
      };
    }
    case "artifact.progress": {
      const event: Extract<ArtifactEvent, { type: "progress" }> = {
        type: "progress",
        ...(wire.vault_path?.trim()
          ? { ref: refFromWire(wire, source) }
          : {}),
        ...(typeof wire.percent === "number" ? { percent: wire.percent } : {}),
        ...(wire.progress_label || wire.operation
          ? { message: wire.progress_label ?? wire.operation }
          : {}),
        ...(wire.operation ? { phase: wire.operation } : {}),
        ...(operationId ? { operationId } : {}),
      };
      return event;
    }
    case "artifact.updated": {
      if (!wire.vault_path?.trim()) return null;
      const revision = revisionFromWire(wire.revision);
      if (!revision) return null;
      return {
        type: "updated",
        ref: refFromWire(wire, source),
        revision,
        ...(wire.write_kind === "canonical" ||
        wire.write_kind === "checkpoint" ||
        wire.write_kind === "conflict_copy"
          ? { writeKind: wire.write_kind }
          : {}),
        ...(wire.source_path ? { sourcePath: wire.source_path } : {}),
        ...(operationId ? { operationId } : {}),
      };
    }
    case "artifact.error": {
      return {
        type: "error",
        ...(wire.vault_path?.trim()
          ? { ref: refFromWire(wire, source) }
          : {}),
        code: mapErrorCode(wire.error_code),
        message: wire.error_message || "Artifact error",
        ...(operationId ? { operationId } : {}),
      };
    }
    case "artifact.close": {
      return {
        type: "close",
        ...(wire.vault_path?.trim()
          ? { ref: refFromWire(wire, source) }
          : {}),
        ...(wire.close_reason === "user" ||
        wire.close_reason === "thread_change" ||
        wire.close_reason === "superseded" ||
        wire.close_reason === "error"
          ? { reason: wire.close_reason }
          : {}),
        ...(operationId ? { operationId } : {}),
      };
    }
    default:
      return null;
  }
}
