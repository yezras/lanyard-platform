/**
 * Signed operation ledger domain types (lp-ye4.5 / epic lp-ye4).
 *
 * Authoritative schema:
 *   contracts/backend-runtime-v1/signed-operation.schema.json
 *
 * Domain doc:
 *   docs/architecture/signed-operation-ledger.md
 *
 * Rules:
 * - operation_id is SEPARATE from DocumentRevision.token (vault CAS).
 * - Types mirror the schema without loose optional bags: discriminated
 *   record_type unions and required fields match JSON Schema required[].
 * - Existing DocumentRevision and vault.write modes are reused, not replaced.
 */

import type { DocumentRevision, VaultWriteKind, VaultWriteMode } from "./types.js";

/** Schema major — required on every ledger record. */
export const SIGNED_OPERATION_SCHEMA_VERSION = 1 as const;

/** Discriminators for multi-type ledger objects. */
export const SIGNED_OPERATION_RECORD_TYPE = "signed_operation" as const;
export const ARTIFACT_HEAD_RECORD_TYPE = "artifact_head" as const;
export const WORKSPACE_HEAD_RECORD_TYPE = "workspace_head" as const;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Stable ledger event id. Prefixed op_. Never a DocumentRevision.token. */
export type OperationId = string;

export type ActorKind = "human" | "agent" | "system" | "delegated_agent";

/**
 * Safe actor provenance on ledger events.
 * Never secrets, raw tokens, or browser-supplied ACL claims.
 */
export type OperationActor = {
  kind: ActorKind;
  /** Stable subject id for this actor kind. */
  subject_id: string;
  display_name?: string;
  portal_user_id?: string;
  agent_id?: string;
  run_id?: string;
  session_id?: string;
  backend_profile?: string;
  /** Access-grant id (phase 5). */
  grant_id?: string;
};

export type OperationTargetScope = "file" | "workspace";

/**
 * What the operation attempted to mutate.
 * For file_checkpoint, path is the checkpoint destination and source_path is
 * the canonical vault path (mirrors vault.write).
 */
export type OperationTarget = {
  scope: OperationTargetScope;
  path: string;
  source_path?: string;
  workspace_id?: string;
};

export type OperationKind =
  | "file_create"
  | "file_replace"
  | "file_checkpoint"
  | "file_delete"
  | "file_rename"
  | "workspace_tree_advance"
  | "operation_rejected";

export type OperationResultStatus = "committed" | "rejected";

export type OperationResultReason =
  | "ok"
  | "revision_mismatch"
  | "path_exists"
  | "path_missing"
  | "human_edit_active"
  | "forbidden"
  | "invalid_argument"
  | "idempotent_replay"
  | "other";

/**
 * Outcome of the attempted mutation.
 * On committed file writes, revision is the new DocumentRevision (CAS-compatible).
 */
export type OperationResult = {
  status: OperationResultStatus;
  reason: OperationResultReason;
  revision?: DocumentRevision;
  prior_revision?: DocumentRevision;
  actual_revision?: DocumentRevision;
  write_kind?: VaultWriteKind;
  created?: boolean;
  idempotent_replay?: boolean;
  message?: string;
};

/** Body content fingerprint — independent of DocumentRevision.token format. */
export type BodyHash = {
  alg: "sha256";
  hex: string;
  size_bytes?: number;
};

export type SignatureAlgorithm = "ed25519" | "hmac-sha256" | "none";

/**
 * Host signature over the canonicalized event (phase 7).
 * Fixtures use shape-valid placeholders. alg "none" is offline/fake only.
 */
export type OperationSignature = {
  alg: SignatureAlgorithm;
  key_id: string;
  value: string;
  signed_at: string;
  signed_fields?: string[];
};

export type OperationMeta = {
  request_id?: string;
  tool_call_id?: string;
  office_session_id?: string;
  [key: string]: unknown;
};

/**
 * Append-only signed ledger event.
 * Does not replace vault.write frames; hosts append after ACL/CAS verification.
 */
export type SignedOperationEvent = {
  schema_version: typeof SIGNED_OPERATION_SCHEMA_VERSION;
  record_type: typeof SIGNED_OPERATION_RECORD_TYPE;
  operation_id: OperationId;
  tenant_id: string;
  instance_id: string;
  occurred_at: string;
  kind: OperationKind;
  actor: OperationActor;
  target: OperationTarget;
  parents: OperationId[];
  body_hash?: BodyHash;
  result: OperationResult;
  signature: OperationSignature;
  idempotency_key?: string;
  vault_write_mode?: VaultWriteMode;
  advances_artifact_head?: boolean;
  advances_workspace_head?: boolean;
  meta?: OperationMeta;
};

export type ArtifactHeadKind = "canonical" | "checkpoint";

/**
 * Materialized current head for one vault path.
 * revision is the same DocumentRevision vault.stat / vault.write CAS use.
 */
export type ArtifactHead = {
  schema_version: typeof SIGNED_OPERATION_SCHEMA_VERSION;
  record_type: typeof ARTIFACT_HEAD_RECORD_TYPE;
  tenant_id: string;
  path: string;
  operation_id: OperationId;
  revision: DocumentRevision;
  updated_at: string;
  head_kind: ArtifactHeadKind;
  source_path?: string;
  actor?: OperationActor;
  workspace_id?: string;
};

/**
 * Materialized workspace currentness (tree fingerprint).
 */
export type WorkspaceHead = {
  schema_version: typeof SIGNED_OPERATION_SCHEMA_VERSION;
  record_type: typeof WORKSPACE_HEAD_RECORD_TYPE;
  tenant_id: string;
  workspace_id: string;
  tree_root_hash: string;
  operation_id: OperationId;
  updated_at: string;
  entry_count?: number;
  root_path?: string;
};

/** Discriminated union of all ledger domain records. */
export type SignedOperationRecord =
  | SignedOperationEvent
  | ArtifactHead
  | WorkspaceHead;

// ---------------------------------------------------------------------------
// vault.write → operation kind mapping (phase 4 consumes this)
// ---------------------------------------------------------------------------

/** Ledger kinds produced by a successful vault.write (lp-ye4.8). */
export type VaultWriteLedgerKind =
  | "file_create"
  | "file_replace"
  | "file_checkpoint";

/**
 * Map a successful vault.write mode to a ledger operation kind.
 * Rejected attempts always use kind "operation_rejected" regardless of mode.
 */
export function vaultWriteModeToOperationKind(
  mode: VaultWriteMode,
  opts?: { created?: boolean },
): VaultWriteLedgerKind {
  switch (mode) {
    case "create_new":
      return "file_create";
    case "replace_if_match":
      return "file_replace";
    case "replace_if_absent":
      return opts?.created === false ? "file_replace" : "file_create";
    case "write_checkpoint":
      return "file_checkpoint";
    default: {
      const _exhaustive: never = mode;
      throw new Error(`unknown vault write mode: ${String(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Parse / validate (strict, no loose optional bags)
// ---------------------------------------------------------------------------

const OPERATION_ID_RE = /^op_[A-Za-z0-9._:-]+$/;
const SHA256_HEX_RE = /^[a-f0-9]{64}$/;
const VAULT_PATH_RE = /^\//;

const ACTOR_KINDS = new Set<ActorKind>([
  "human",
  "agent",
  "system",
  "delegated_agent",
]);
const OPERATION_KINDS = new Set<OperationKind>([
  "file_create",
  "file_replace",
  "file_checkpoint",
  "file_delete",
  "file_rename",
  "workspace_tree_advance",
  "operation_rejected",
]);
const RESULT_STATUSES = new Set<OperationResultStatus>(["committed", "rejected"]);
const RESULT_REASONS = new Set<OperationResultReason>([
  "ok",
  "revision_mismatch",
  "path_exists",
  "path_missing",
  "human_edit_active",
  "forbidden",
  "invalid_argument",
  "idempotent_replay",
  "other",
]);
const SIG_ALGS = new Set<SignatureAlgorithm>([
  "ed25519",
  "hmac-sha256",
  "none",
]);
const REVISION_KINDS = new Set([
  "etag",
  "content_hash",
  "host_revision",
  "mtime_size_fallback",
]);
const WRITE_MODES = new Set<VaultWriteMode>([
  "create_new",
  "replace_if_match",
  "replace_if_absent",
  "write_checkpoint",
]);
const WRITE_KINDS = new Set<VaultWriteKind>([
  "create",
  "replace",
  "checkpoint",
  "conflict_copy",
]);
const HEAD_KINDS = new Set<ArtifactHeadKind>(["canonical", "checkpoint"]);

export class SignedOperationParseError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "SignedOperationParseError";
    this.path = path;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  opts?: { pattern?: RegExp; max?: number },
): string {
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new SignedOperationParseError(path, `missing or empty string '${key}'`);
  }
  if (opts?.max !== undefined && v.length > opts.max) {
    throw new SignedOperationParseError(path, `'${key}' exceeds max length`);
  }
  if (opts?.pattern && !opts.pattern.test(v)) {
    throw new SignedOperationParseError(path, `'${key}' failed pattern`);
  }
  return v;
}

function optionalString(
  obj: Record<string, unknown>,
  key: string,
  path: string,
): string | undefined {
  if (!(key in obj) || obj[key] === undefined) return undefined;
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new SignedOperationParseError(path, `'${key}' must be non-empty string when set`);
  }
  return v;
}

function requireBoolean(
  obj: Record<string, unknown>,
  key: string,
  path: string,
): boolean | undefined {
  if (!(key in obj) || obj[key] === undefined) return undefined;
  if (typeof obj[key] !== "boolean") {
    throw new SignedOperationParseError(path, `'${key}' must be boolean`);
  }
  return obj[key] as boolean;
}

function parseDocumentRevision(
  value: unknown,
  path: string,
): DocumentRevision {
  if (!isPlainObject(value)) {
    throw new SignedOperationParseError(path, "must be object");
  }
  const token = requireString(value, "token", path, { max: 256 });
  const kind = requireString(value, "kind", path);
  if (!REVISION_KINDS.has(kind)) {
    throw new SignedOperationParseError(path, `invalid revision kind ${kind}`);
  }
  const rev: DocumentRevision = {
    token,
    kind: kind as DocumentRevision["kind"],
  };
  if ("size_bytes" in value && value.size_bytes !== undefined) {
    if (typeof value.size_bytes !== "number" || !Number.isInteger(value.size_bytes) || value.size_bytes < 0) {
      throw new SignedOperationParseError(path, "size_bytes must be non-negative integer");
    }
    rev.size_bytes = value.size_bytes;
  }
  if ("modified_at" in value && value.modified_at !== undefined) {
    rev.modified_at = requireString(value, "modified_at", path);
  }
  // Reject unknown keys for strictness (schema additionalProperties: false)
  for (const k of Object.keys(value)) {
    if (!["token", "kind", "size_bytes", "modified_at"].includes(k)) {
      throw new SignedOperationParseError(path, `unknown property '${k}'`);
    }
  }
  return rev;
}

function parseActor(value: unknown, path: string): OperationActor {
  if (!isPlainObject(value)) {
    throw new SignedOperationParseError(path, "must be object");
  }
  const kind = requireString(value, "kind", path) as ActorKind;
  if (!ACTOR_KINDS.has(kind)) {
    throw new SignedOperationParseError(path, `invalid actor kind ${kind}`);
  }
  const actor: OperationActor = {
    kind,
    subject_id: requireString(value, "subject_id", path),
  };
  const optKeys = [
    "display_name",
    "portal_user_id",
    "agent_id",
    "run_id",
    "session_id",
    "backend_profile",
    "grant_id",
  ] as const;
  for (const k of optKeys) {
    const v = optionalString(value, k, path);
    if (v !== undefined) actor[k] = v;
  }
  for (const k of Object.keys(value)) {
    if (
      ![
        "kind",
        "subject_id",
        "display_name",
        "portal_user_id",
        "agent_id",
        "run_id",
        "session_id",
        "backend_profile",
        "grant_id",
      ].includes(k)
    ) {
      throw new SignedOperationParseError(path, `unknown property '${k}'`);
    }
  }
  return actor;
}

function parseTarget(value: unknown, path: string): OperationTarget {
  if (!isPlainObject(value)) {
    throw new SignedOperationParseError(path, "must be object");
  }
  const scope = requireString(value, "scope", path);
  if (scope !== "file" && scope !== "workspace") {
    throw new SignedOperationParseError(path, `invalid scope ${scope}`);
  }
  const targetPath = requireString(value, "path", path, { pattern: VAULT_PATH_RE });
  const target: OperationTarget = {
    scope,
    path: targetPath,
  };
  const sourcePath = optionalString(value, "source_path", path);
  if (sourcePath !== undefined) {
    if (!VAULT_PATH_RE.test(sourcePath)) {
      throw new SignedOperationParseError(path, "source_path must start with /");
    }
    target.source_path = sourcePath;
  }
  const workspaceId = optionalString(value, "workspace_id", path);
  if (workspaceId !== undefined) target.workspace_id = workspaceId;

  for (const k of Object.keys(value)) {
    if (!["scope", "path", "source_path", "workspace_id"].includes(k)) {
      throw new SignedOperationParseError(path, `unknown property '${k}'`);
    }
  }
  return target;
}

function parseBodyHash(value: unknown, path: string): BodyHash {
  if (!isPlainObject(value)) {
    throw new SignedOperationParseError(path, "must be object");
  }
  const alg = requireString(value, "alg", path);
  if (alg !== "sha256") {
    throw new SignedOperationParseError(path, "alg must be sha256");
  }
  const hex = requireString(value, "hex", path, { pattern: SHA256_HEX_RE });
  const body: BodyHash = { alg: "sha256", hex };
  if ("size_bytes" in value && value.size_bytes !== undefined) {
    if (typeof value.size_bytes !== "number" || !Number.isInteger(value.size_bytes) || value.size_bytes < 0) {
      throw new SignedOperationParseError(path, "size_bytes must be non-negative integer");
    }
    body.size_bytes = value.size_bytes;
  }
  for (const k of Object.keys(value)) {
    if (!["alg", "hex", "size_bytes"].includes(k)) {
      throw new SignedOperationParseError(path, `unknown property '${k}'`);
    }
  }
  return body;
}

function parseResult(value: unknown, path: string): OperationResult {
  if (!isPlainObject(value)) {
    throw new SignedOperationParseError(path, "must be object");
  }
  const status = requireString(value, "status", path) as OperationResultStatus;
  if (!RESULT_STATUSES.has(status)) {
    throw new SignedOperationParseError(path, `invalid status ${status}`);
  }
  const reason = requireString(value, "reason", path) as OperationResultReason;
  if (!RESULT_REASONS.has(reason)) {
    throw new SignedOperationParseError(path, `invalid reason ${reason}`);
  }
  const result: OperationResult = { status, reason };
  if ("revision" in value && value.revision !== undefined) {
    result.revision = parseDocumentRevision(value.revision, `${path}.revision`);
  }
  if ("prior_revision" in value && value.prior_revision !== undefined) {
    result.prior_revision = parseDocumentRevision(
      value.prior_revision,
      `${path}.prior_revision`,
    );
  }
  if ("actual_revision" in value && value.actual_revision !== undefined) {
    result.actual_revision = parseDocumentRevision(
      value.actual_revision,
      `${path}.actual_revision`,
    );
  }
  if ("write_kind" in value && value.write_kind !== undefined) {
    const wk = requireString(value, "write_kind", path) as VaultWriteKind;
    if (!WRITE_KINDS.has(wk)) {
      throw new SignedOperationParseError(path, `invalid write_kind ${wk}`);
    }
    result.write_kind = wk;
  }
  const created = requireBoolean(value, "created", path);
  if (created !== undefined) result.created = created;
  const replay = requireBoolean(value, "idempotent_replay", path);
  if (replay !== undefined) result.idempotent_replay = replay;
  const message = optionalString(value, "message", path);
  if (message !== undefined) result.message = message;

  for (const k of Object.keys(value)) {
    if (
      ![
        "status",
        "reason",
        "revision",
        "prior_revision",
        "actual_revision",
        "write_kind",
        "created",
        "idempotent_replay",
        "message",
      ].includes(k)
    ) {
      throw new SignedOperationParseError(path, `unknown property '${k}'`);
    }
  }
  return result;
}

function parseSignature(value: unknown, path: string): OperationSignature {
  if (!isPlainObject(value)) {
    throw new SignedOperationParseError(path, "must be object");
  }
  const alg = requireString(value, "alg", path) as SignatureAlgorithm;
  if (!SIG_ALGS.has(alg)) {
    throw new SignedOperationParseError(path, `invalid signature alg ${alg}`);
  }
  const sig: OperationSignature = {
    alg,
    key_id: requireString(value, "key_id", path),
    value: requireString(value, "value", path),
    signed_at: requireString(value, "signed_at", path),
  };
  if ("signed_fields" in value && value.signed_fields !== undefined) {
    if (!Array.isArray(value.signed_fields) || value.signed_fields.length === 0) {
      throw new SignedOperationParseError(path, "signed_fields must be non-empty array");
    }
    for (const f of value.signed_fields) {
      if (typeof f !== "string" || f.length === 0) {
        throw new SignedOperationParseError(path, "signed_fields items must be non-empty strings");
      }
    }
    sig.signed_fields = value.signed_fields as string[];
  }
  for (const k of Object.keys(value)) {
    if (!["alg", "key_id", "value", "signed_at", "signed_fields"].includes(k)) {
      throw new SignedOperationParseError(path, `unknown property '${k}'`);
    }
  }
  return sig;
}

function assertHeadAdvanceConsistency(event: SignedOperationEvent, path: string): void {
  if (event.result.status === "rejected") {
    if (event.advances_artifact_head === true) {
      throw new SignedOperationParseError(
        path,
        "rejected operations must not set advances_artifact_head=true",
      );
    }
    if (event.advances_workspace_head === true) {
      throw new SignedOperationParseError(
        path,
        "rejected operations must not set advances_workspace_head=true",
      );
    }
  }
  if (event.kind === "file_checkpoint") {
    if (!event.target.source_path) {
      throw new SignedOperationParseError(
        path,
        "file_checkpoint requires target.source_path",
      );
    }
    if (event.target.source_path === event.target.path) {
      throw new SignedOperationParseError(
        path,
        "file_checkpoint source_path must differ from path",
      );
    }
  }
  if (
    event.result.status === "committed" &&
    (event.kind === "file_create" ||
      event.kind === "file_replace" ||
      event.kind === "file_checkpoint") &&
    !event.result.revision
  ) {
    throw new SignedOperationParseError(
      path,
      "committed file body writes require result.revision",
    );
  }
}

function parseSignedOperationEvent(
  value: Record<string, unknown>,
  path: string,
): SignedOperationEvent {
  const schemaVersion = value.schema_version;
  if (schemaVersion !== SIGNED_OPERATION_SCHEMA_VERSION) {
    throw new SignedOperationParseError(path, "schema_version must be 1");
  }
  if (value.record_type !== SIGNED_OPERATION_RECORD_TYPE) {
    throw new SignedOperationParseError(path, "record_type must be signed_operation");
  }

  const kind = requireString(value, "kind", path) as OperationKind;
  if (!OPERATION_KINDS.has(kind)) {
    throw new SignedOperationParseError(path, `invalid kind ${kind}`);
  }

  if (!Array.isArray(value.parents)) {
    throw new SignedOperationParseError(path, "parents must be array");
  }
  const parents: OperationId[] = [];
  for (let i = 0; i < value.parents.length; i++) {
    const p = value.parents[i];
    if (typeof p !== "string" || !OPERATION_ID_RE.test(p)) {
      throw new SignedOperationParseError(`${path}.parents[${i}]`, "invalid operation_id");
    }
    parents.push(p);
  }

  const event: SignedOperationEvent = {
    schema_version: SIGNED_OPERATION_SCHEMA_VERSION,
    record_type: SIGNED_OPERATION_RECORD_TYPE,
    operation_id: requireString(value, "operation_id", path, {
      pattern: OPERATION_ID_RE,
    }),
    tenant_id: requireString(value, "tenant_id", path),
    instance_id: requireString(value, "instance_id", path),
    occurred_at: requireString(value, "occurred_at", path),
    kind,
    actor: parseActor(value.actor, `${path}.actor`),
    target: parseTarget(value.target, `${path}.target`),
    parents,
    result: parseResult(value.result, `${path}.result`),
    signature: parseSignature(value.signature, `${path}.signature`),
  };

  if ("body_hash" in value && value.body_hash !== undefined) {
    event.body_hash = parseBodyHash(value.body_hash, `${path}.body_hash`);
  }
  const idem = optionalString(value, "idempotency_key", path);
  if (idem !== undefined) event.idempotency_key = idem;
  if ("vault_write_mode" in value && value.vault_write_mode !== undefined) {
    const mode = requireString(value, "vault_write_mode", path) as VaultWriteMode;
    if (!WRITE_MODES.has(mode)) {
      throw new SignedOperationParseError(path, `invalid vault_write_mode ${mode}`);
    }
    event.vault_write_mode = mode;
  }
  const advArt = requireBoolean(value, "advances_artifact_head", path);
  if (advArt !== undefined) event.advances_artifact_head = advArt;
  const advWs = requireBoolean(value, "advances_workspace_head", path);
  if (advWs !== undefined) event.advances_workspace_head = advWs;
  if ("meta" in value && value.meta !== undefined) {
    if (!isPlainObject(value.meta)) {
      throw new SignedOperationParseError(path, "meta must be object");
    }
    event.meta = value.meta as OperationMeta;
  }

  const allowed = new Set([
    "schema_version",
    "record_type",
    "operation_id",
    "tenant_id",
    "instance_id",
    "occurred_at",
    "kind",
    "actor",
    "target",
    "parents",
    "body_hash",
    "result",
    "signature",
    "idempotency_key",
    "vault_write_mode",
    "advances_artifact_head",
    "advances_workspace_head",
    "meta",
  ]);
  for (const k of Object.keys(value)) {
    if (!allowed.has(k)) {
      throw new SignedOperationParseError(path, `unknown property '${k}'`);
    }
  }

  assertHeadAdvanceConsistency(event, path);
  return event;
}

function parseArtifactHead(
  value: Record<string, unknown>,
  path: string,
): ArtifactHead {
  if (value.schema_version !== SIGNED_OPERATION_SCHEMA_VERSION) {
    throw new SignedOperationParseError(path, "schema_version must be 1");
  }
  if (value.record_type !== ARTIFACT_HEAD_RECORD_TYPE) {
    throw new SignedOperationParseError(path, "record_type must be artifact_head");
  }
  const headKind = requireString(value, "head_kind", path) as ArtifactHeadKind;
  if (!HEAD_KINDS.has(headKind)) {
    throw new SignedOperationParseError(path, `invalid head_kind ${headKind}`);
  }
  const head: ArtifactHead = {
    schema_version: SIGNED_OPERATION_SCHEMA_VERSION,
    record_type: ARTIFACT_HEAD_RECORD_TYPE,
    tenant_id: requireString(value, "tenant_id", path),
    path: requireString(value, "path", path, { pattern: VAULT_PATH_RE }),
    operation_id: requireString(value, "operation_id", path, {
      pattern: OPERATION_ID_RE,
    }),
    revision: parseDocumentRevision(value.revision, `${path}.revision`),
    updated_at: requireString(value, "updated_at", path),
    head_kind: headKind,
  };
  const sourcePath = optionalString(value, "source_path", path);
  if (sourcePath !== undefined) {
    if (!VAULT_PATH_RE.test(sourcePath)) {
      throw new SignedOperationParseError(path, "source_path must start with /");
    }
    head.source_path = sourcePath;
  }
  if (headKind === "checkpoint" && !head.source_path) {
    throw new SignedOperationParseError(
      path,
      "checkpoint head requires source_path",
    );
  }
  if ("actor" in value && value.actor !== undefined) {
    head.actor = parseActor(value.actor, `${path}.actor`);
  }
  const workspaceId = optionalString(value, "workspace_id", path);
  if (workspaceId !== undefined) head.workspace_id = workspaceId;

  for (const k of Object.keys(value)) {
    if (
      ![
        "schema_version",
        "record_type",
        "tenant_id",
        "path",
        "operation_id",
        "revision",
        "updated_at",
        "head_kind",
        "source_path",
        "actor",
        "workspace_id",
      ].includes(k)
    ) {
      throw new SignedOperationParseError(path, `unknown property '${k}'`);
    }
  }
  return head;
}

function parseWorkspaceHead(
  value: Record<string, unknown>,
  path: string,
): WorkspaceHead {
  if (value.schema_version !== SIGNED_OPERATION_SCHEMA_VERSION) {
    throw new SignedOperationParseError(path, "schema_version must be 1");
  }
  if (value.record_type !== WORKSPACE_HEAD_RECORD_TYPE) {
    throw new SignedOperationParseError(path, "record_type must be workspace_head");
  }
  const head: WorkspaceHead = {
    schema_version: SIGNED_OPERATION_SCHEMA_VERSION,
    record_type: WORKSPACE_HEAD_RECORD_TYPE,
    tenant_id: requireString(value, "tenant_id", path),
    workspace_id: requireString(value, "workspace_id", path),
    tree_root_hash: requireString(value, "tree_root_hash", path, {
      pattern: SHA256_HEX_RE,
    }),
    operation_id: requireString(value, "operation_id", path, {
      pattern: OPERATION_ID_RE,
    }),
    updated_at: requireString(value, "updated_at", path),
  };
  if ("entry_count" in value && value.entry_count !== undefined) {
    if (
      typeof value.entry_count !== "number" ||
      !Number.isInteger(value.entry_count) ||
      value.entry_count < 0
    ) {
      throw new SignedOperationParseError(path, "entry_count must be non-negative integer");
    }
    head.entry_count = value.entry_count;
  }
  const rootPath = optionalString(value, "root_path", path);
  if (rootPath !== undefined) {
    if (!VAULT_PATH_RE.test(rootPath)) {
      throw new SignedOperationParseError(path, "root_path must start with /");
    }
    head.root_path = rootPath;
  }
  for (const k of Object.keys(value)) {
    if (
      ![
        "schema_version",
        "record_type",
        "tenant_id",
        "workspace_id",
        "tree_root_hash",
        "operation_id",
        "updated_at",
        "entry_count",
        "root_path",
      ].includes(k)
    ) {
      throw new SignedOperationParseError(path, `unknown property '${k}'`);
    }
  }
  return head;
}

/**
 * Parse any signed-operation domain record (event | artifact_head | workspace_head).
 * Throws SignedOperationParseError on invalid input.
 */
export function parseSignedOperationRecord(value: unknown): SignedOperationRecord {
  if (!isPlainObject(value)) {
    throw new SignedOperationParseError("$", "must be object");
  }
  const recordType = value.record_type;
  if (recordType === SIGNED_OPERATION_RECORD_TYPE) {
    return parseSignedOperationEvent(value, "$");
  }
  if (recordType === ARTIFACT_HEAD_RECORD_TYPE) {
    return parseArtifactHead(value, "$");
  }
  if (recordType === WORKSPACE_HEAD_RECORD_TYPE) {
    return parseWorkspaceHead(value, "$");
  }
  throw new SignedOperationParseError(
    "$",
    `unknown record_type ${String(recordType)}`,
  );
}

export function parseSignedOperationEventOnly(
  value: unknown,
): SignedOperationEvent {
  const rec = parseSignedOperationRecord(value);
  if (rec.record_type !== SIGNED_OPERATION_RECORD_TYPE) {
    throw new SignedOperationParseError(
      "$",
      `expected signed_operation, got ${rec.record_type}`,
    );
  }
  return rec;
}

export function safeParseSignedOperationRecord(
  value: unknown,
):
  | { ok: true; record: SignedOperationRecord }
  | { ok: false; error: SignedOperationParseError } {
  try {
    return { ok: true, record: parseSignedOperationRecord(value) };
  } catch (err) {
    if (err instanceof SignedOperationParseError) {
      return { ok: false, error: err };
    }
    throw err;
  }
}

/** Type guard: record is a signed operation event. */
export function isSignedOperationEvent(
  value: SignedOperationRecord,
): value is SignedOperationEvent {
  return value.record_type === SIGNED_OPERATION_RECORD_TYPE;
}

export function isArtifactHead(
  value: SignedOperationRecord,
): value is ArtifactHead {
  return value.record_type === ARTIFACT_HEAD_RECORD_TYPE;
}

export function isWorkspaceHead(
  value: SignedOperationRecord,
): value is WorkspaceHead {
  return value.record_type === WORKSPACE_HEAD_RECORD_TYPE;
}
