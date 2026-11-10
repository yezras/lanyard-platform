/**
 * Portal currentness and history UX helpers (lp-ye4.11).
 *
 * Surfaces artifact head metadata (revision, operation_id, actor, head_kind)
 * without treating chat/event payloads as vault body bytes. Stale open
 * documents map to reload / conflict / checkpoint actions via the existing
 * document-key invalidation policy.
 *
 * Thread collaboration mode is intentionally separate from vault write
 * authority — share grants never mint path ACL or vault.write capability.
 *
 * Domain: docs/architecture/signed-operation-ledger.md
 */

import type { SessionShareMode } from "../../../api/types.js";
import {
  evaluateDocumentKeyInvalidation,
  type DocumentKeyInvalidationDecision,
} from "./documentKeyInvalidation.js";
import type {
  CheckpointOffer,
  ConflictState,
  DocumentRevision,
  VaultPath,
} from "./types.js";

// ---------------------------------------------------------------------------
// Wire-shaped types (mirror BFF / signed-operation; camel optional in UI)
// ---------------------------------------------------------------------------

export type CurrentnessActorKind =
  | "human"
  | "agent"
  | "system"
  | "delegated_agent";

/** Safe actor provenance from ledger / heads (no secrets, no ACL bags). */
export type CurrentnessActor = {
  kind: CurrentnessActorKind;
  subject_id: string;
  display_name?: string;
  portal_user_id?: string;
  agent_id?: string;
  run_id?: string;
  session_id?: string;
  backend_profile?: string;
  grant_id?: string;
};

export type ArtifactHeadKind = "canonical" | "checkpoint";

/**
 * Artifact head as returned by GET /api/vault/heads/artifact.
 * Never includes body bytes — only identity + currentness metadata.
 */
export type ArtifactHeadView = {
  record_type?: "artifact_head";
  path: string;
  operation_id: string;
  revision: DocumentRevision;
  updated_at?: string;
  head_kind: ArtifactHeadKind;
  source_path?: string;
  actor?: CurrentnessActor;
  workspace_id?: string;
  source?: string;
};

/** Signed operation event summary for history panel rows (metadata only). */
export type HistoryEventView = {
  operation_id: string;
  occurred_at?: string;
  kind: string;
  actor?: CurrentnessActor;
  target?: {
    path?: string;
    source_path?: string;
    scope?: string;
  };
  result?: {
    status?: string;
    reason?: string;
    revision?: DocumentRevision;
    write_kind?: string;
  };
  vault_write_mode?: string;
  advances_artifact_head?: boolean;
};

export type HistoryListView = {
  path: string;
  events: HistoryEventView[];
  truncated?: boolean;
  next_cursor?: string | null;
  source?: string;
};

// ---------------------------------------------------------------------------
// Display model (artifact pane chrome)
// ---------------------------------------------------------------------------

export type CurrentnessDisplay = {
  path: string;
  revisionToken: string;
  revisionKind?: DocumentRevision["kind"];
  operationId: string;
  actorLabel: string;
  actorKind?: CurrentnessActorKind;
  headKind: ArtifactHeadKind;
  headKindLabel: string;
  sourcePath?: string;
  updatedAt?: string;
  /**
   * True when this head is a checkpoint sibling (not canonical vault path).
   */
  isCheckpoint: boolean;
};

/**
 * Format actor for pane chrome. Prefers display_name, then subject ids.
 * Never surfaces raw tokens or grant signatures.
 */
export function formatCurrentnessActor(
  actor: CurrentnessActor | null | undefined,
): string {
  if (!actor) return "Unknown actor";
  const name = actor.display_name?.trim();
  if (name) return name;
  if (actor.kind === "human" && actor.portal_user_id) {
    return actor.portal_user_id;
  }
  if (
    (actor.kind === "agent" || actor.kind === "delegated_agent") &&
    actor.agent_id
  ) {
    return actor.agent_id;
  }
  if (actor.subject_id) return actor.subject_id;
  return actor.kind;
}

export function headKindLabel(kind: ArtifactHeadKind): string {
  return kind === "checkpoint" ? "Checkpoint" : "Canonical";
}

/**
 * Map an artifact head (from BFF heads API) into pane display fields.
 * Does **not** read or trust event body bytes — only head metadata.
 */
export function currentnessFromArtifactHead(
  head: ArtifactHeadView,
): CurrentnessDisplay {
  const headKind = head.head_kind === "checkpoint" ? "checkpoint" : "canonical";
  return {
    path: head.path,
    revisionToken: head.revision.token,
    revisionKind: head.revision.kind,
    operationId: head.operation_id,
    actorLabel: formatCurrentnessActor(head.actor),
    actorKind: head.actor?.kind,
    headKind,
    headKindLabel: headKindLabel(headKind),
    sourcePath: head.source_path,
    updatedAt: head.updated_at,
    isCheckpoint: headKind === "checkpoint",
  };
}

// ---------------------------------------------------------------------------
// Stale open document evaluation
// ---------------------------------------------------------------------------

export type StaleHeadAction =
  | "none"
  | "reload"
  | "conflict"
  | "checkpoint_offer";

export type StaleHeadDecision =
  | {
      action: "none";
      currentness: CurrentnessDisplay;
    }
  | {
      action: "reload";
      currentness: CurrentnessDisplay;
      invalidation: DocumentKeyInvalidationDecision;
    }
  | {
      action: "conflict";
      currentness: CurrentnessDisplay;
      conflict: ConflictState;
      invalidation: DocumentKeyInvalidationDecision;
    }
  | {
      action: "checkpoint_offer";
      currentness: CurrentnessDisplay;
      checkpointOffer: CheckpointOffer;
    };

export type EvaluateStaleHeadInput = {
  /** Open pane path (canonical or checkpoint). */
  openPath: VaultPath;
  /** Pane knownRevision (last loaded / saved). */
  knownRevision: DocumentRevision | null | undefined;
  /** Whether the human buffer is dirty / active edit. */
  dirty: boolean;
  /** Authoritative head from GET /api/vault/heads/artifact for openPath. */
  head: ArtifactHeadView;
  /**
   * Optional head for a related checkpoint path (soft offer while viewing
   * canonical). When present and open path is not the checkpoint, surface
   * checkpoint_offer instead of treating the open path as stale.
   */
  checkpointHead?: ArtifactHeadView | null;
};

const CHECKPOINT_OFFER_MESSAGE =
  "Agent saved a checkpoint. Open it without leaving your current document.";

/**
 * Compare open pane revision against authoritative artifact head.
 *
 * - Event payloads / chat frames are never treated as body bytes.
 * - Dirty + revision advance → conflict (reload / discard actions).
 * - Clean + revision advance → reload.
 * - Related checkpoint head while on canonical → soft checkpoint offer.
 */
export function evaluateStaleHead(
  input: EvaluateStaleHeadInput,
): StaleHeadDecision {
  const currentness = currentnessFromArtifactHead(input.head);

  // Soft checkpoint sibling offer (does not require open path to be stale).
  if (
    input.checkpointHead &&
    input.checkpointHead.head_kind === "checkpoint" &&
    input.checkpointHead.path !== input.openPath
  ) {
    const rev = input.checkpointHead.revision;
    return {
      action: "checkpoint_offer",
      currentness,
      checkpointOffer: {
        ref: {
          path: input.checkpointHead.path,
          source: "agent_checkpoint",
          title: "Agent checkpoint",
        },
        revision: {
          token: rev.token,
          kind: rev.kind,
          sizeBytes: rev.sizeBytes ?? (rev as { size_bytes?: number }).size_bytes,
          modifiedAt:
            rev.modifiedAt ?? (rev as { modified_at?: string }).modified_at,
        },
        sourcePath: input.checkpointHead.source_path ?? input.openPath,
        message: CHECKPOINT_OFFER_MESSAGE,
      },
    };
  }

  const invalidation = evaluateDocumentKeyInvalidation({
    baseRevisionToken: input.knownRevision?.token,
    currentRevisionToken: input.head.revision.token,
    dirty: input.dirty,
    path: input.openPath,
    baseRevision: input.knownRevision,
    currentRevision: {
      token: input.head.revision.token,
      kind: input.head.revision.kind,
      sizeBytes:
        input.head.revision.sizeBytes ??
        (input.head.revision as { size_bytes?: number }).size_bytes,
      modifiedAt:
        input.head.revision.modifiedAt ??
        (input.head.revision as { modified_at?: string }).modified_at,
    },
  });

  if (invalidation.action === "conflict") {
    return {
      action: "conflict",
      currentness,
      conflict: invalidation.conflict,
      invalidation,
    };
  }

  if (invalidation.action === "reload") {
    return {
      action: "reload",
      currentness,
      invalidation,
    };
  }

  return { action: "none", currentness };
}

// ---------------------------------------------------------------------------
// Thread collab ≠ vault write authority
// ---------------------------------------------------------------------------

export type ThreadAccessMode =
  | "owner"
  | "read"
  | "collaborate"
  | SessionShareMode
  | string
  | null
  | undefined;

/**
 * Vault write / history authority is **never** derived from thread share mode.
 * Collaborate lets users post to a shared chat thread; it does not grant
 * vault.write, heads mutation, or path ACL expansion.
 */
export type VaultAuthorityFromThread = {
  /** Always false — thread collab is not vault write authority. */
  canVaultWrite: boolean;
  /** Always false — share mode never expands vault path ACL. */
  expandsVaultAcl: boolean;
  /** Thread mode may allow chat posts; independent of vault. */
  canPostToThread: boolean;
  reason: string;
};

/**
 * Map thread access to vault authority. Fail closed for vault writes.
 */
export function vaultAuthorityFromThreadAccess(
  access: ThreadAccessMode,
): VaultAuthorityFromThread {
  const mode = typeof access === "string" ? access : "";
  const canPostToThread =
    mode === "owner" || mode === "collaborate" || mode === "";
  return {
    canVaultWrite: false,
    expandsVaultAcl: false,
    canPostToThread,
    reason:
      "Thread collaboration mode is separate from vault write authority; " +
      "path ACL and vault.write come from session RBAC / access grants only.",
  };
}

/**
 * Whether UI may show vault write affordances based solely on thread access.
 * Always false — callers must consult portal context / RBAC separately.
 */
export function threadAccessGrantsVaultWrite(
  access: ThreadAccessMode,
): boolean {
  return vaultAuthorityFromThreadAccess(access).canVaultWrite;
}

// ---------------------------------------------------------------------------
// History row display helpers
// ---------------------------------------------------------------------------

export function formatHistoryEventSummary(event: HistoryEventView): string {
  const kind = event.kind || "operation";
  const actor = formatCurrentnessActor(event.actor);
  const status = event.result?.status ?? "";
  const reason = event.result?.reason;
  const parts = [kind, actor];
  if (status) parts.push(status);
  if (reason && reason !== "ok") parts.push(reason);
  return parts.join(" · ");
}

/**
 * Drop any history event whose target path is outside allowed prefixes.
 * Defense-in-depth for client-side display (BFF already ACL-filters).
 */
export function filterHistoryEventsByAcl(
  events: HistoryEventView[],
  pathPrefixes: string[],
): HistoryEventView[] {
  if (!pathPrefixes.length) return [];
  const normalized = pathPrefixes.map((p) =>
    p.endsWith("/") && p !== "/" ? p.slice(0, -1) : p,
  );
  return events.filter((ev) => {
    const path = ev.target?.path;
    if (typeof path !== "string" || !path.startsWith("/")) return false;
    return normalized.some(
      (prefix) =>
        prefix === "/" || path === prefix || path.startsWith(`${prefix}/`),
    );
  });
}
