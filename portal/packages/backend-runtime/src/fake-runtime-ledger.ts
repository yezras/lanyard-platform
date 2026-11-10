/**
 * In-memory signed-operation ledger + current-head harness (lp-ye4.6).
 *
 * Used by {@link FakeBackendRuntimeService} so Portal tests can exercise
 * multiplayer currentness (append-only history, artifact heads, workspace
 * tree root) without a live host or durable store.
 *
 * Phase 4 (lp-ye4.8): FakeBackendRuntimeService.writeVault records commits
 * and CAS/policy rejects through this harness (see recordRejection).
 * Phase 3 (lp-ye4.7): history/head Brain RPC reads over the same events.
 *
 * Rules (domain contract):
 * - operation_id is SEPARATE from DocumentRevision.token (vault CAS).
 * - Rejected operations are still appended; they MUST NOT advance heads.
 * - Idempotency key + body fingerprint → same operation_id and same heads.
 */

import { createHash, randomBytes } from "node:crypto";

import type { HostLedgerSigner } from "./ledger-signing.js";
import {
  ARTIFACT_HEAD_RECORD_TYPE,
  SIGNED_OPERATION_RECORD_TYPE,
  SIGNED_OPERATION_SCHEMA_VERSION,
  WORKSPACE_HEAD_RECORD_TYPE,
  type ArtifactHead,
  type BodyHash,
  type OperationActor,
  type OperationId,
  type OperationKind,
  type OperationMeta,
  type OperationResult,
  type OperationResultReason,
  type SignedOperationEvent,
  type WorkspaceHead,
} from "./signed-operation.js";
import type { DocumentRevision, VaultWriteMode } from "./types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type FakeRuntimeLedgerOptions = {
  tenantId?: string;
  instanceId?: string;
  /** Default workspace id for tree heads (default: "default"). */
  workspaceId?: string;
  /**
   * Signing key id stamped when no {@link signer} is provided (alg: none).
   * Offline / fake harness only.
   */
  signatureKeyId?: string;
  /**
   * Host signer for observed commits (lp-ye4.12). When set, commit/reject
   * paths sign with the host key after ACL/CAS decisions. Production durable
   * hosts must use ed25519 (see ledger-signing.ts).
   */
  signer?: HostLedgerSigner;
};

/** Mutation kinds the harness can commit (or reject via CAS/preconditions). */
export type LedgerMutationKind =
  | "file_create"
  | "file_replace"
  | "file_checkpoint"
  | "file_delete"
  | "file_rename"
  | "workspace_tree_advance";

/**
 * Intentional ledger mutation for offline fixtures and unit tests.
 * Prefer this over constructing full SignedOperationEvent envelopes by hand.
 */
export type LedgerCommitInput = {
  kind: LedgerMutationKind;
  actor: OperationActor;
  /**
   * Target path:
   * - create / replace / delete: vault path
   * - rename: destination path
   * - checkpoint: checkpoint destination path
   * - workspace_tree_advance: workspace root path (default "/")
   */
  path: string;
  /**
   * Source path for rename (old path) or write_checkpoint (canonical path).
   * Must differ from path for those kinds.
   */
  sourcePath?: string;
  workspaceId?: string;
  /**
   * New DocumentRevision after a committed body write.
   * Required for file_create, file_replace, file_checkpoint.
   * Ignored for delete / rename / pure tree advance (rename may supply a
   * revision to keep on the destination head; otherwise the source head's
   * revision moves with the path).
   */
  revision?: DocumentRevision;
  bodyHash?: BodyHash;
  /**
   * CAS base for file_replace. When set and the current artifact head token
   * differs, the harness appends operation_rejected (revision_mismatch) and
   * does not advance heads.
   */
  expectedRevision?: DocumentRevision;
  idempotencyKey?: string;
  vaultWriteMode?: VaultWriteMode;
  meta?: OperationMeta;
  occurredAt?: string;
  /**
   * Optional explicit parents. Default: single parent = last ledger
   * operation_id (empty for genesis).
   */
  parents?: OperationId[];
};

export type LedgerCommitResult = {
  event: SignedOperationEvent;
  /** True when idempotency_key replayed a prior identical commit. */
  idempotentReplay: boolean;
  /**
   * Artifact head for the primary path after the commit (or still-current
   * head when the attempt was rejected / was a pure workspace op).
   */
  artifactHead: ArtifactHead | undefined;
  workspaceHead: WorkspaceHead | undefined;
  /** All artifact heads after the operation (unchanged on reject). */
  artifactHeads: ArtifactHead[];
};

/**
 * Record a vault.write (or host) conflict after the file store already
 * decided the outcome. Always appends `operation_rejected` and never advances
 * heads — independent of whether an artifact head currently exists.
 */
export type LedgerRejectInput = {
  actor: OperationActor;
  path: string;
  sourcePath?: string;
  workspaceId?: string;
  reason: Extract<
    OperationResultReason,
    | "revision_mismatch"
    | "path_exists"
    | "path_missing"
    | "human_edit_active"
    | "forbidden"
    | "invalid_argument"
    | "other"
  >;
  vaultWriteMode?: VaultWriteMode;
  expectedRevision?: DocumentRevision;
  actualRevision?: DocumentRevision;
  priorRevision?: DocumentRevision;
  bodyHash?: BodyHash;
  message?: string;
  meta?: OperationMeta;
  occurredAt?: string;
  /**
   * Optional explicit parents. Default: single parent = last ledger
   * operation_id (empty for genesis).
   */
  parents?: OperationId[];
};

export class FakeRuntimeLedgerError extends Error {
  readonly code:
    | "idempotency_key_conflict"
    | "invalid_argument"
    | "duplicate_operation_id";

  constructor(
    code: FakeRuntimeLedgerError["code"],
    message: string,
  ) {
    super(message);
    this.name = "FakeRuntimeLedgerError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

type IdempotencyRecord = {
  fingerprint: string;
  event: SignedOperationEvent;
  /** Deep snapshot of heads at first commit (returned on replay). */
  artifactHeads: Map<string, ArtifactHead>;
  workspaceHeads: Map<string, WorkspaceHead>;
};

function normalizePath(path: string): string {
  if (!path || path === "") return "/";
  let p = path.startsWith("/") ? path : `/${path}`;
  p = p.replace(/\/+/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

function cloneRevision(rev: DocumentRevision): DocumentRevision {
  return {
    token: rev.token,
    kind: rev.kind,
    ...(rev.size_bytes !== undefined ? { size_bytes: rev.size_bytes } : {}),
    ...(rev.modified_at !== undefined ? { modified_at: rev.modified_at } : {}),
  };
}

function cloneHead(head: ArtifactHead): ArtifactHead {
  return {
    ...head,
    revision: cloneRevision(head.revision),
    ...(head.actor ? { actor: { ...head.actor } } : {}),
  };
}

function cloneWorkspaceHead(head: WorkspaceHead): WorkspaceHead {
  return { ...head };
}

function cloneEvent(event: SignedOperationEvent): SignedOperationEvent {
  return structuredClone(event);
}

function mapToHeads(map: Map<string, ArtifactHead>): ArtifactHead[] {
  return [...map.values()]
    .map(cloneHead)
    .sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Canonical path→revision fingerprint for workspace tree_root_hash.
 * Uses all current artifact heads (canonical + checkpoint) sorted by path.
 */
export function computeWorkspaceTreeRootHash(
  heads: Iterable<ArtifactHead>,
): { treeRootHash: string; entryCount: number } {
  const lines = [...heads]
    .map(
      (h) =>
        `${h.path}\0${h.revision.token}\0${h.head_kind}\0${h.source_path ?? ""}`,
    )
    .sort();
  const treeRootHash = createHash("sha256")
    .update(lines.join("\n"))
    .digest("hex");
  return { treeRootHash, entryCount: lines.length };
}

/**
 * Canonical idempotency fingerprint for a *committed* mutation.
 *
 * Must match for:
 * - `commit()` pre-check (from {@link LedgerCommitInput})
 * - `appendEvent()` / event replay (from {@link SignedOperationEvent})
 * - durable `idempotency.json` restore after crash
 *
 * Intentionally excludes CAS `expectedRevision` and reject status/reason so
 * the commit path and event-replay path hash the same logical write. Empty
 * workspace id normalizes to the ledger default ("default") so `""` and
 * omitted workspace do not diverge.
 */
function ledgerIdempotencyFingerprint(parts: {
  kind: string;
  path: string;
  sourcePath?: string;
  workspaceId?: string;
  revisionToken?: string;
  revisionKind?: string;
  bodyHashHex?: string;
  vaultWriteMode?: string;
}): string {
  const workspaceId =
    parts.workspaceId && parts.workspaceId.trim() !== ""
      ? parts.workspaceId.trim()
      : "default";
  return createHash("sha256")
    .update(
      [
        parts.kind,
        normalizePath(parts.path),
        parts.sourcePath ? normalizePath(parts.sourcePath) : "",
        workspaceId,
        parts.revisionToken ?? "",
        parts.revisionKind ?? "",
        parts.bodyHashHex ?? "",
        parts.vaultWriteMode ?? "",
      ].join("\0"),
    )
    .digest("hex");
}

function mutationFingerprint(
  input: LedgerCommitInput,
  defaultWorkspaceId: string,
): string {
  const workspaceId =
    input.workspaceId && input.workspaceId.trim() !== ""
      ? input.workspaceId
      : defaultWorkspaceId;
  return ledgerIdempotencyFingerprint({
    kind: input.kind,
    path: input.path,
    sourcePath: input.sourcePath,
    workspaceId,
    revisionToken: input.revision?.token,
    revisionKind: input.revision?.kind,
    bodyHashHex: input.bodyHash?.hex,
    vaultWriteMode: input.vaultWriteMode,
  });
}

function eventFingerprint(event: SignedOperationEvent): string {
  // Only committed ops are stored under idempotency_key (see commit/appendEvent).
  return ledgerIdempotencyFingerprint({
    kind: event.kind,
    path: event.target.path,
    sourcePath: event.target.source_path,
    workspaceId: event.target.workspace_id,
    revisionToken: event.result.revision?.token,
    revisionKind: event.result.revision?.kind,
    bodyHashHex: event.body_hash?.hex,
    vaultWriteMode: event.vault_write_mode,
  });
}

/**
 * Append-only in-memory ledger with materialized artifact and workspace heads.
 */
export class FakeRuntimeLedger {
  private _tenantId: string;
  private _instanceId: string;
  readonly defaultWorkspaceId: string;
  private readonly signatureKeyId: string;
  private readonly signer: HostLedgerSigner | undefined;
  private tenantLocked = false;

  private readonly events: SignedOperationEvent[] = [];
  private readonly artifactHeads = new Map<string, ArtifactHead>();
  private readonly workspaceHeads = new Map<string, WorkspaceHead>();
  private readonly byId = new Map<string, SignedOperationEvent>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private opSeq = 0;
  private lastOperationId: OperationId | null = null;

  constructor(options: FakeRuntimeLedgerOptions = {}) {
    this._tenantId = options.tenantId ?? "ten_fake";
    this._instanceId = options.instanceId ?? "inst_fake";
    this.defaultWorkspaceId = options.workspaceId ?? "default";
    this.signatureKeyId = options.signatureKeyId ?? "fake-ledger-unsigned";
    this.signer = options.signer;
    if (options.tenantId) this.tenantLocked = true;
  }

  /** Host signer when configured (lp-ye4.12); undefined for offline alg:none. */
  get hostSigner(): HostLedgerSigner | undefined {
    return this.signer;
  }

  get tenantId(): string {
    return this._tenantId;
  }

  get instanceId(): string {
    return this._instanceId;
  }

  /** Append-only history (oldest → newest). */
  listEvents(): SignedOperationEvent[] {
    return this.events.map(cloneEvent);
  }

  getEvent(operationId: OperationId): SignedOperationEvent | undefined {
    const e = this.byId.get(operationId);
    return e ? cloneEvent(e) : undefined;
  }

  getArtifactHead(path: string): ArtifactHead | undefined {
    const h = this.artifactHeads.get(normalizePath(path));
    return h ? cloneHead(h) : undefined;
  }

  listArtifactHeads(): ArtifactHead[] {
    return mapToHeads(this.artifactHeads);
  }

  getWorkspaceHead(workspaceId?: string): WorkspaceHead | undefined {
    const id = workspaceId ?? this.defaultWorkspaceId;
    const h = this.workspaceHeads.get(id);
    return h ? cloneWorkspaceHead(h) : undefined;
  }

  listWorkspaceHeads(): WorkspaceHead[] {
    return [...this.workspaceHeads.values()]
      .map(cloneWorkspaceHead)
      .sort((a, b) => a.workspace_id.localeCompare(b.workspace_id));
  }

  /**
   * Seed an artifact head without appending an event (test bootstrap only).
   * Does not recompute workspace head unless `recomputeWorkspace` is true.
   */
  seedArtifactHead(input: {
    path: string;
    revision: DocumentRevision;
    operationId?: OperationId;
    headKind?: ArtifactHead["head_kind"];
    sourcePath?: string;
    actor?: OperationActor;
    workspaceId?: string;
    updatedAt?: string;
    recomputeWorkspace?: boolean;
  }): ArtifactHead {
    const path = normalizePath(input.path);
    const head: ArtifactHead = {
      schema_version: SIGNED_OPERATION_SCHEMA_VERSION,
      record_type: ARTIFACT_HEAD_RECORD_TYPE,
      tenant_id: this._tenantId,
      path,
      operation_id: input.operationId ?? "op_seed_bootstrap",
      revision: cloneRevision(input.revision),
      updated_at: input.updatedAt ?? new Date().toISOString(),
      head_kind: input.headKind ?? "canonical",
      ...(input.sourcePath
        ? { source_path: normalizePath(input.sourcePath) }
        : {}),
      ...(input.actor ? { actor: { ...input.actor } } : {}),
      workspace_id: input.workspaceId ?? this.defaultWorkspaceId,
    };
    this.artifactHeads.set(path, head);
    if (input.recomputeWorkspace) {
      this.materializeWorkspaceHead({
        operationId: head.operation_id,
        updatedAt: head.updated_at,
        workspaceId: head.workspace_id ?? this.defaultWorkspaceId,
      });
    }
    return cloneHead(head);
  }

  /**
   * Commit (or reject) a mutation intent. Primary harness entry point for
   * create / replace / rename / delete / checkpoint / tree advance fixtures.
   */
  commit(input: LedgerCommitInput): LedgerCommitResult {
    this.validateCommitInput(input);

    const path = normalizePath(input.path);
    const sourcePath = input.sourcePath
      ? normalizePath(input.sourcePath)
      : undefined;
    const workspaceId =
      input.workspaceId && input.workspaceId.trim() !== ""
        ? input.workspaceId
        : this.defaultWorkspaceId;
    const fingerprint = mutationFingerprint(
      { ...input, path, sourcePath, workspaceId },
      this.defaultWorkspaceId,
    );

    if (input.idempotencyKey) {
      const prior = this.idempotency.get(input.idempotencyKey);
      if (prior) {
        if (prior.fingerprint !== fingerprint) {
          throw new FakeRuntimeLedgerError(
            "idempotency_key_conflict",
            `idempotency_key reused with different mutation fingerprint: ${input.idempotencyKey}`,
          );
        }
        return this.replayResult(prior);
      }
    }

    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const parents =
      input.parents ??
      (this.lastOperationId ? [this.lastOperationId] : []);

    const decision = this.decideOutcome(input, path, sourcePath);
    const operationId = this.nextOperationId();

    const unsigned: SignedOperationEvent = {
      schema_version: SIGNED_OPERATION_SCHEMA_VERSION,
      record_type: SIGNED_OPERATION_RECORD_TYPE,
      operation_id: operationId,
      tenant_id: this._tenantId,
      instance_id: this._instanceId,
      occurred_at: occurredAt,
      kind: decision.kind,
      actor: { ...input.actor },
      target: {
        scope: input.kind === "workspace_tree_advance" ? "workspace" : "file",
        path,
        ...(sourcePath ? { source_path: sourcePath } : {}),
        workspace_id: workspaceId,
      },
      parents: [...parents],
      ...(input.bodyHash ? { body_hash: { ...input.bodyHash } } : {}),
      result: decision.result,
      signature: {
        alg: "none",
        key_id: this.signatureKeyId,
        value: "unsigned",
        signed_at: occurredAt,
      },
      ...(input.idempotencyKey
        ? { idempotency_key: input.idempotencyKey }
        : {}),
      ...(input.vaultWriteMode
        ? { vault_write_mode: input.vaultWriteMode }
        : {}),
      advances_artifact_head: decision.advancesArtifactHead,
      advances_workspace_head: decision.advancesWorkspaceHead,
      ...(input.meta ? { meta: { ...input.meta } } : {}),
    };

    const event = this.applyHostSignature(unsigned, occurredAt);

    this.appendRaw(event);

    if (decision.advancesArtifactHead || decision.advancesWorkspaceHead) {
      this.applyHeadAdvances(event, {
        path,
        sourcePath,
        workspaceId,
        mutationKind: input.kind,
        revision: input.revision,
      });
    }

    if (input.idempotencyKey && event.result.status === "committed") {
      this.idempotency.set(input.idempotencyKey, {
        fingerprint,
        event: cloneEvent(event),
        artifactHeads: this.snapshotArtifactHeads(),
        workspaceHeads: this.snapshotWorkspaceHeads(),
      });
    }

    return {
      event: cloneEvent(event),
      idempotentReplay: false,
      artifactHead: this.getArtifactHead(
        decision.primaryHeadPath ?? path,
      ),
      workspaceHead: this.getWorkspaceHead(workspaceId),
      artifactHeads: this.listArtifactHeads(),
    };
  }

  /**
   * Append an operation_rejected event without advancing heads.
   * Use after vault.write CAS/policy failures decided by the file store
   * (lp-ye4.8) so history consumers see the conflict attempt.
   */
  recordRejection(input: LedgerRejectInput): LedgerCommitResult {
    if (!input.actor?.subject_id) {
      throw new FakeRuntimeLedgerError(
        "invalid_argument",
        "actor.subject_id is required",
      );
    }
    if (!input.path) {
      throw new FakeRuntimeLedgerError("invalid_argument", "path is required");
    }

    const path = normalizePath(input.path);
    const sourcePath = input.sourcePath
      ? normalizePath(input.sourcePath)
      : undefined;
    const workspaceId = input.workspaceId ?? this.defaultWorkspaceId;
    const occurredAt = input.occurredAt ?? new Date().toISOString();
    const parents =
      input.parents ??
      (this.lastOperationId ? [this.lastOperationId] : []);
    const operationId = this.nextOperationId();

    const unsigned: SignedOperationEvent = {
      schema_version: SIGNED_OPERATION_SCHEMA_VERSION,
      record_type: SIGNED_OPERATION_RECORD_TYPE,
      operation_id: operationId,
      tenant_id: this._tenantId,
      instance_id: this._instanceId,
      occurred_at: occurredAt,
      kind: "operation_rejected",
      actor: { ...input.actor },
      target: {
        scope: "file",
        path,
        ...(sourcePath ? { source_path: sourcePath } : {}),
        workspace_id: workspaceId,
      },
      parents: [...parents],
      ...(input.bodyHash ? { body_hash: { ...input.bodyHash } } : {}),
      result: {
        status: "rejected",
        reason: input.reason,
        ...(input.expectedRevision
          ? { prior_revision: cloneRevision(input.expectedRevision) }
          : input.priorRevision
            ? { prior_revision: cloneRevision(input.priorRevision) }
            : {}),
        ...(input.actualRevision
          ? { actual_revision: cloneRevision(input.actualRevision) }
          : {}),
        ...(input.message ? { message: input.message } : {}),
      },
      signature: {
        alg: "none",
        key_id: this.signatureKeyId,
        value: "unsigned",
        signed_at: occurredAt,
      },
      ...(input.vaultWriteMode
        ? { vault_write_mode: input.vaultWriteMode }
        : {}),
      advances_artifact_head: false,
      advances_workspace_head: false,
      ...(input.meta ? { meta: { ...input.meta } } : {}),
    };

    const event = this.applyHostSignature(unsigned, occurredAt);

    this.appendRaw(event);

    return {
      event: cloneEvent(event),
      idempotentReplay: false,
      artifactHead: this.getArtifactHead(path),
      workspaceHead: this.getWorkspaceHead(workspaceId),
      artifactHeads: this.listArtifactHeads(),
    };
  }

  /**
   * Append a pre-built signed operation (e.g. contract fixtures).
   * Materializes heads when the event claims advances_* flags and is committed.
   * Enforces idempotency_key uniqueness against fingerprints.
   */
  appendEvent(event: SignedOperationEvent): LedgerCommitResult {
    if (event.schema_version !== SIGNED_OPERATION_SCHEMA_VERSION) {
      throw new FakeRuntimeLedgerError(
        "invalid_argument",
        "schema_version must be 1",
      );
    }
    if (event.record_type !== SIGNED_OPERATION_RECORD_TYPE) {
      throw new FakeRuntimeLedgerError(
        "invalid_argument",
        "record_type must be signed_operation",
      );
    }
    if (this.byId.has(event.operation_id)) {
      throw new FakeRuntimeLedgerError(
        "duplicate_operation_id",
        `operation_id already present: ${event.operation_id}`,
      );
    }
    if (event.idempotency_key) {
      const prior = this.idempotency.get(event.idempotency_key);
      if (prior) {
        const fp = eventFingerprint(event);
        if (prior.fingerprint !== fp) {
          throw new FakeRuntimeLedgerError(
            "idempotency_key_conflict",
            `idempotency_key reused with different event fingerprint: ${event.idempotency_key}`,
          );
        }
        return this.replayResult(prior);
      }
    }

    if (
      event.result.status === "rejected" &&
      (event.advances_artifact_head === true ||
        event.advances_workspace_head === true)
    ) {
      throw new FakeRuntimeLedgerError(
        "invalid_argument",
        "rejected operations must not advance heads",
      );
    }

    const stored = cloneEvent(event);
    // Adopt tenant/instance from first fixture when ledger was not constructed
    // with an explicit tenant lock (enables contract fixtures as-is).
    if (this.events.length === 0 && !this.tenantLocked) {
      this._tenantId = stored.tenant_id;
      this._instanceId = stored.instance_id;
    } else if (stored.tenant_id !== this._tenantId) {
      throw new FakeRuntimeLedgerError(
        "invalid_argument",
        `tenant_id mismatch: ledger=${this._tenantId} event=${stored.tenant_id}`,
      );
    }

    this.appendRaw(stored);

    if (
      stored.result.status === "committed" &&
      (stored.advances_artifact_head || stored.advances_workspace_head)
    ) {
      this.applyHeadAdvances(stored, {
        path: stored.target.path,
        sourcePath: stored.target.source_path,
        workspaceId:
          stored.target.workspace_id ?? this.defaultWorkspaceId,
        mutationKind: stored.kind as LedgerMutationKind,
        revision: stored.result.revision,
      });
    }

    if (
      stored.idempotency_key &&
      stored.result.status === "committed"
    ) {
      this.idempotency.set(stored.idempotency_key, {
        fingerprint: eventFingerprint(stored),
        event: cloneEvent(stored),
        artifactHeads: this.snapshotArtifactHeads(),
        workspaceHeads: this.snapshotWorkspaceHeads(),
      });
    }

    const path = stored.target.path;
    return {
      event: cloneEvent(stored),
      idempotentReplay: false,
      artifactHead: this.getArtifactHead(path),
      workspaceHead: this.getWorkspaceHead(
        stored.target.workspace_id ?? this.defaultWorkspaceId,
      ),
      artifactHeads: this.listArtifactHeads(),
    };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private validateCommitInput(input: LedgerCommitInput): void {
    if (!input.actor?.subject_id) {
      throw new FakeRuntimeLedgerError(
        "invalid_argument",
        "actor.subject_id is required",
      );
    }
    if (!input.path) {
      throw new FakeRuntimeLedgerError(
        "invalid_argument",
        "path is required",
      );
    }
    if (
      input.kind === "file_create" ||
      input.kind === "file_replace" ||
      input.kind === "file_checkpoint"
    ) {
      if (!input.revision?.token) {
        throw new FakeRuntimeLedgerError(
          "invalid_argument",
          `${input.kind} requires revision`,
        );
      }
    }
    if (input.kind === "file_checkpoint" || input.kind === "file_rename") {
      if (!input.sourcePath) {
        throw new FakeRuntimeLedgerError(
          "invalid_argument",
          `${input.kind} requires sourcePath`,
        );
      }
      if (normalizePath(input.sourcePath) === normalizePath(input.path)) {
        throw new FakeRuntimeLedgerError(
          "invalid_argument",
          `${input.kind} sourcePath must differ from path`,
        );
      }
    }
  }

  private decideOutcome(
    input: LedgerCommitInput,
    path: string,
    sourcePath: string | undefined,
  ): {
    kind: OperationKind;
    result: OperationResult;
    advancesArtifactHead: boolean;
    advancesWorkspaceHead: boolean;
    /** Path whose head is most relevant for the return value. */
    primaryHeadPath?: string;
  } {
    const current = this.artifactHeads.get(path);

    switch (input.kind) {
      case "file_create": {
        if (current) {
          return {
            kind: "operation_rejected",
            result: {
              status: "rejected",
              reason: "path_exists",
              actual_revision: cloneRevision(current.revision),
              message: `path already exists: ${path}`,
            },
            advancesArtifactHead: false,
            advancesWorkspaceHead: false,
            primaryHeadPath: path,
          };
        }
        return {
          kind: "file_create",
          result: {
            status: "committed",
            reason: "ok",
            revision: cloneRevision(input.revision!),
            write_kind: "create",
            created: true,
          },
          advancesArtifactHead: true,
          advancesWorkspaceHead: true,
          primaryHeadPath: path,
        };
      }
      case "file_replace": {
        if (!current) {
          return {
            kind: "operation_rejected",
            result: {
              status: "rejected",
              reason: "path_missing",
              message: `path missing for replace: ${path}`,
            },
            advancesArtifactHead: false,
            advancesWorkspaceHead: false,
          };
        }
        if (input.expectedRevision) {
          if (input.expectedRevision.token !== current.revision.token) {
            return {
              kind: "operation_rejected",
              result: {
                status: "rejected",
                reason: "revision_mismatch",
                prior_revision: cloneRevision(input.expectedRevision),
                actual_revision: cloneRevision(current.revision),
                message: "revision_mismatch: expected base no longer current",
              },
              advancesArtifactHead: false,
              advancesWorkspaceHead: false,
              primaryHeadPath: path,
            };
          }
        }
        return {
          kind: "file_replace",
          result: {
            status: "committed",
            reason: "ok",
            revision: cloneRevision(input.revision!),
            prior_revision: cloneRevision(current.revision),
            write_kind: "replace",
            created: false,
          },
          advancesArtifactHead: true,
          advancesWorkspaceHead: true,
          primaryHeadPath: path,
        };
      }
      case "file_checkpoint": {
        if (current) {
          return {
            kind: "operation_rejected",
            result: {
              status: "rejected",
              reason: "path_exists",
              actual_revision: cloneRevision(current.revision),
              message: `checkpoint path already exists: ${path}`,
            },
            advancesArtifactHead: false,
            advancesWorkspaceHead: false,
            primaryHeadPath: path,
          };
        }
        return {
          kind: "file_checkpoint",
          result: {
            status: "committed",
            reason: "ok",
            revision: cloneRevision(input.revision!),
            write_kind: "checkpoint",
            created: true,
          },
          advancesArtifactHead: true,
          advancesWorkspaceHead: true,
          primaryHeadPath: path,
        };
      }
      case "file_delete": {
        if (!current) {
          return {
            kind: "operation_rejected",
            result: {
              status: "rejected",
              reason: "path_missing",
              message: `path missing for delete: ${path}`,
            },
            advancesArtifactHead: false,
            advancesWorkspaceHead: false,
          };
        }
        return {
          kind: "file_delete",
          result: {
            status: "committed",
            reason: "ok",
            prior_revision: cloneRevision(current.revision),
          },
          advancesArtifactHead: true,
          advancesWorkspaceHead: true,
          primaryHeadPath: path,
        };
      }
      case "file_rename": {
        const from = this.artifactHeads.get(sourcePath!);
        if (!from) {
          return {
            kind: "operation_rejected",
            result: {
              status: "rejected",
              reason: "path_missing",
              message: `rename source missing: ${sourcePath}`,
            },
            advancesArtifactHead: false,
            advancesWorkspaceHead: false,
          };
        }
        if (current) {
          return {
            kind: "operation_rejected",
            result: {
              status: "rejected",
              reason: "path_exists",
              actual_revision: cloneRevision(current.revision),
              message: `rename destination exists: ${path}`,
            },
            advancesArtifactHead: false,
            advancesWorkspaceHead: false,
            primaryHeadPath: path,
          };
        }
        return {
          kind: "file_rename",
          result: {
            status: "committed",
            reason: "ok",
            revision: cloneRevision(input.revision ?? from.revision),
            prior_revision: cloneRevision(from.revision),
          },
          advancesArtifactHead: true,
          advancesWorkspaceHead: true,
          primaryHeadPath: path,
        };
      }
      case "workspace_tree_advance": {
        return {
          kind: "workspace_tree_advance",
          result: {
            status: "committed",
            reason: "ok",
          },
          advancesArtifactHead: false,
          advancesWorkspaceHead: true,
        };
      }
      default: {
        const _exhaustive: never = input.kind;
        throw new FakeRuntimeLedgerError(
          "invalid_argument",
          `unknown mutation kind: ${String(_exhaustive)}`,
        );
      }
    }
  }

  private applyHeadAdvances(
    event: SignedOperationEvent,
    ctx: {
      path: string;
      sourcePath?: string;
      workspaceId: string;
      mutationKind: LedgerMutationKind | OperationKind;
      revision?: DocumentRevision;
    },
  ): void {
    const { path, sourcePath, workspaceId } = ctx;
    const kind = event.kind;

    if (event.advances_artifact_head) {
      if (kind === "file_delete") {
        this.artifactHeads.delete(path);
      } else if (kind === "file_rename" && sourcePath) {
        const from = this.artifactHeads.get(sourcePath);
        if (from) {
          this.artifactHeads.delete(sourcePath);
          const moved: ArtifactHead = {
            ...from,
            path,
            operation_id: event.operation_id,
            updated_at: event.occurred_at,
            revision: cloneRevision(
              event.result.revision ?? from.revision,
            ),
            actor: { ...event.actor },
            workspace_id: workspaceId,
          };
          this.artifactHeads.set(path, moved);
        }
      } else if (
        kind === "file_create" ||
        kind === "file_replace" ||
        kind === "file_checkpoint"
      ) {
        if (!event.result.revision) {
          throw new FakeRuntimeLedgerError(
            "invalid_argument",
            "committed file body write missing result.revision",
          );
        }
        const head: ArtifactHead = {
          schema_version: SIGNED_OPERATION_SCHEMA_VERSION,
          record_type: ARTIFACT_HEAD_RECORD_TYPE,
          tenant_id: this._tenantId,
          path,
          operation_id: event.operation_id,
          revision: cloneRevision(event.result.revision),
          updated_at: event.occurred_at,
          head_kind: kind === "file_checkpoint" ? "checkpoint" : "canonical",
          ...(kind === "file_checkpoint" && sourcePath
            ? { source_path: sourcePath }
            : {}),
          actor: { ...event.actor },
          workspace_id: workspaceId,
        };
        this.artifactHeads.set(path, head);
      }
    }

    if (event.advances_workspace_head) {
      this.materializeWorkspaceHead({
        operationId: event.operation_id,
        updatedAt: event.occurred_at,
        workspaceId,
        rootPath: kind === "workspace_tree_advance" ? path : undefined,
      });
    }
  }

  private materializeWorkspaceHead(opts: {
    operationId: OperationId;
    updatedAt: string;
    workspaceId: string;
    rootPath?: string;
  }): void {
    const { treeRootHash, entryCount } = computeWorkspaceTreeRootHash(
      this.artifactHeads.values(),
    );
    const prev = this.workspaceHeads.get(opts.workspaceId);
    const head: WorkspaceHead = {
      schema_version: SIGNED_OPERATION_SCHEMA_VERSION,
      record_type: WORKSPACE_HEAD_RECORD_TYPE,
      tenant_id: this._tenantId,
      workspace_id: opts.workspaceId,
      tree_root_hash: treeRootHash,
      operation_id: opts.operationId,
      updated_at: opts.updatedAt,
      entry_count: entryCount,
      root_path: opts.rootPath ?? prev?.root_path ?? "/",
    };
    this.workspaceHeads.set(opts.workspaceId, head);
  }

  /**
   * Host-signs an observed event after ACL/CAS (lp-ye4.12).
   * Without a signer, keeps offline alg:none placeholder.
   */
  private applyHostSignature(
    event: SignedOperationEvent,
    signedAt: string,
  ): SignedOperationEvent {
    if (!this.signer) return event;
    return {
      ...event,
      signature: this.signer.sign(event, signedAt),
    };
  }

  private appendRaw(event: SignedOperationEvent): void {
    this.events.push(event);
    this.byId.set(event.operation_id, event);
    this.lastOperationId = event.operation_id;
    // Keep opSeq monotonic when replaying loaded events with op_fake_NNNN_…
    const m = /^op_fake_(\d+)_/.exec(event.operation_id);
    if (m) {
      const n = Number.parseInt(m[1]!, 10);
      if (Number.isFinite(n) && n > this.opSeq) this.opSeq = n;
    }
  }

  /**
   * Replace in-memory state from a durable snapshot (lp-ye4.12 reload).
   * Does not re-sign events; loaded signatures must already be host-valid.
   */
  loadSnapshot(input: {
    tenantId: string;
    instanceId: string;
    events: SignedOperationEvent[];
    artifactHeads: ArtifactHead[];
    workspaceHeads: WorkspaceHead[];
    idempotency: Array<{
      key: string;
      fingerprint: string;
      operationId: OperationId;
    }>;
  }): void {
    this._tenantId = input.tenantId;
    this._instanceId = input.instanceId;
    this.tenantLocked = true;
    this.events.length = 0;
    this.byId.clear();
    this.artifactHeads.clear();
    this.workspaceHeads.clear();
    this.idempotency.clear();
    this.opSeq = 0;
    this.lastOperationId = null;

    for (const event of input.events) {
      const stored = cloneEvent(event);
      this.events.push(stored);
      this.byId.set(stored.operation_id, stored);
      this.lastOperationId = stored.operation_id;
      const m = /^op_fake_(\d+)_/.exec(stored.operation_id);
      if (m) {
        const n = Number.parseInt(m[1]!, 10);
        if (Number.isFinite(n) && n > this.opSeq) this.opSeq = n;
      }
    }

    for (const head of input.artifactHeads) {
      this.artifactHeads.set(normalizePath(head.path), cloneHead(head));
    }
    for (const head of input.workspaceHeads) {
      this.workspaceHeads.set(head.workspace_id, cloneWorkspaceHead(head));
    }

    for (const rec of input.idempotency) {
      const event = this.byId.get(rec.operationId);
      if (!event) continue;
      this.idempotency.set(rec.key, {
        fingerprint: rec.fingerprint,
        event: cloneEvent(event),
        artifactHeads: this.snapshotArtifactHeads(),
        workspaceHeads: this.snapshotWorkspaceHeads(),
      });
    }
  }

  /** Export idempotency index for durable persistence. */
  exportIdempotencyIndex(): Array<{
    key: string;
    fingerprint: string;
    operationId: OperationId;
    artifactHeads: ArtifactHead[];
    workspaceHeads: WorkspaceHead[];
  }> {
    return [...this.idempotency.entries()].map(([key, rec]) => ({
      key,
      fingerprint: rec.fingerprint,
      operationId: rec.event.operation_id,
      artifactHeads: mapToHeads(rec.artifactHeads),
      workspaceHeads: [...rec.workspaceHeads.values()]
        .map(cloneWorkspaceHead)
        .sort((a, b) => a.workspace_id.localeCompare(b.workspace_id)),
    }));
  }

  /**
   * Restore idempotency head *snapshots* from durable storage (lp-ye4.12).
   *
   * Fingerprints are always recomputed from the committed event via
   * {@link eventFingerprint} so a lagging or pre-alignment `idempotency.json`
   * cannot freeze a hash that diverges from `commit()` retries. Head maps
   * still prefer the file snapshot (point-in-time after that commit).
   */
  restoreIdempotencyRecords(
    records: Array<{
      key: string;
      fingerprint: string;
      operationId: OperationId;
      artifactHeads?: ArtifactHead[];
      workspaceHeads?: WorkspaceHead[];
    }>,
  ): void {
    for (const rec of records) {
      const event = this.byId.get(rec.operationId);
      if (!event) continue;
      // Always re-derive: file fingerprint may be stale or from the old
      // mutation/event dual-hash era (review blocker on crash windows).
      const fingerprint = eventFingerprint(event);
      const artifactHeads = new Map<string, ArtifactHead>();
      if (rec.artifactHeads && rec.artifactHeads.length > 0) {
        for (const h of rec.artifactHeads) {
          artifactHeads.set(normalizePath(h.path), cloneHead(h));
        }
      } else {
        for (const [k, v] of this.artifactHeads) {
          artifactHeads.set(k, cloneHead(v));
        }
      }
      const workspaceHeads = new Map<string, WorkspaceHead>();
      if (rec.workspaceHeads && rec.workspaceHeads.length > 0) {
        for (const h of rec.workspaceHeads) {
          workspaceHeads.set(h.workspace_id, cloneWorkspaceHead(h));
        }
      } else {
        for (const [k, v] of this.workspaceHeads) {
          workspaceHeads.set(k, cloneWorkspaceHead(v));
        }
      }
      this.idempotency.set(rec.key, {
        fingerprint,
        event: cloneEvent(event),
        artifactHeads,
        workspaceHeads,
      });
    }
  }

  private nextOperationId(): OperationId {
    this.opSeq += 1;
    const seq = String(this.opSeq).padStart(8, "0");
    const suffix = randomBytes(3).toString("hex");
    return `op_fake_${seq}_${suffix}`;
  }

  private snapshotArtifactHeads(): Map<string, ArtifactHead> {
    const m = new Map<string, ArtifactHead>();
    for (const [k, v] of this.artifactHeads) {
      m.set(k, cloneHead(v));
    }
    return m;
  }

  private snapshotWorkspaceHeads(): Map<string, WorkspaceHead> {
    const m = new Map<string, WorkspaceHead>();
    for (const [k, v] of this.workspaceHeads) {
      m.set(k, cloneWorkspaceHead(v));
    }
    return m;
  }

  private replayResult(prior: IdempotencyRecord): LedgerCommitResult {
    const event = cloneEvent(prior.event);
    // Surface idempotent_replay on the returned event for callers.
    event.result = {
      ...event.result,
      idempotent_replay: true,
      reason:
        event.result.status === "committed"
          ? event.result.reason === "ok"
            ? "idempotent_replay"
            : event.result.reason
          : event.result.reason,
    };
    const path = event.target.path;
    const workspaceId =
      event.target.workspace_id ?? this.defaultWorkspaceId;
    return {
      event,
      idempotentReplay: true,
      artifactHead: prior.artifactHeads.has(path)
        ? cloneHead(prior.artifactHeads.get(path)!)
        : this.getArtifactHead(path),
      workspaceHead: prior.workspaceHeads.has(workspaceId)
        ? cloneWorkspaceHead(prior.workspaceHeads.get(workspaceId)!)
        : this.getWorkspaceHead(workspaceId),
      artifactHeads: mapToHeads(prior.artifactHeads),
    };
  }
}

/** Build a sha256 body_hash from decoded body bytes. */
export function bodyHashFromContent(
  content: string,
  encoding: "utf-8" | "base64" = "utf-8",
): BodyHash {
  const buf = Buffer.from(content, encoding === "base64" ? "base64" : "utf8");
  return {
    alg: "sha256",
    hex: createHash("sha256").update(buf).digest("hex"),
    size_bytes: buf.byteLength,
  };
}

/** Build a sha256 body_hash from utf-8 content. */
export function bodyHashFromUtf8(content: string): BodyHash {
  return bodyHashFromContent(content, "utf-8");
}

/** Build a content_hash DocumentRevision from utf-8 content. */
export function revisionFromUtf8(
  content: string,
  modifiedAt?: string,
): DocumentRevision {
  const buf = Buffer.from(content, "utf8");
  const hex = createHash("sha256").update(buf).digest("hex");
  return {
    token: `sha256:${hex}`,
    kind: "content_hash",
    size_bytes: buf.byteLength,
    ...(modifiedAt ? { modified_at: modifiedAt } : {}),
  };
}
