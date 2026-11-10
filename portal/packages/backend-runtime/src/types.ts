/**
 * Domain types for BackendRuntimeService.
 *
 * Shapes align with contracts/backend-runtime-v1 (brain-rpc + capabilities)
 * and current Portal BFF Hermes modules under packages/bff (health, projects,
 * settings snapshot, vault). Field names prefer backend-neutral terms;
 * hermes_* aliases are accepted during migration.
 */

import type {
  ArtifactHead,
  OperationActor,
  SignedOperationEvent,
  WorkspaceHead,
} from "./signed-operation.js";

/** Backend product family when known (artifact kind). */
export type BackendKind =
  | "hermes_upstream"
  | "hermes_lanyard"
  | "lanyard_agent";

/**
 * Selected profile for a session subject.
 * Prefer `name` / `backend_profile` over legacy `hermes_profile`.
 */
export type BackendProfileRef = {
  /** Profile name (e.g. admin, contributor). */
  name: string;
  /**
   * Effective vault path ACL prefixes for this subject (vault-root-relative,
   * starting with /). Empty + vault_full capability → full vault.
   */
  pathPrefixes: string[];
  /**
   * Legacy wire alias used by Hermes-Lanyard and current Portal stamps.
   * When omitted, adapters may set it equal to `name`.
   */
  hermesProfileAlias?: string;
};

/**
 * Per-call auth/session context stamped by the BFF (never trusted from the browser).
 * Maps to Brain RPC auth subject fields.
 *
 * Access grants (lp-ye4.9): when authority comes from a validated signed grant,
 * BFF stamps `actor`, `grantId`, and grant-derived `profile.pathPrefixes`.
 * Clients must never supply these fields as request authority.
 */
export type BackendRuntimeContext = {
  tenantId: string;
  instanceId: string;
  userId: string;
  sessionId: string;
  profile: BackendProfileRef;
  /** Control-plane / Portal role names for audit and complementary gates. */
  roles: string[];
  /** Optional caller timeout budget (ms); hosts clamp to contract max. */
  timeoutMs?: number;
  /**
   * Safe actor provenance for ledger events (lp-ye4.9).
   * Stamped by BFF from session or validated access grant — never secrets/tokens.
   */
  actor?: OperationActor;
  /**
   * Validated access-grant id when authority came from a signed grant.
   * Also mirrored on actor.grant_id for ledger events.
   */
  grantId?: string;
  /**
   * Capability names authorized by the validated grant (when grant-backed).
   * Informational for hosts; BFF enforces capability checks before stamping.
   */
  grantCapabilities?: string[];
};

// ---------------------------------------------------------------------------
// Health (brain.health)
// ---------------------------------------------------------------------------

export type BackendHealthStatus = "ok" | "degraded" | "unavailable";

export type BackendHealthChecks = {
  vault_root_readable?: boolean;
  /** Preferred BACKEND_HOME presence check. */
  backend_home_present?: boolean;
  /** Legacy alias of backend_home_present (Hermes-compatible hosts). */
  hermes_home_present?: boolean;
  profiles_present?: boolean;
  projects_db_present?: boolean;
  [key: string]: boolean | undefined;
};

export type BackendHealthVersions = {
  brain_rpc?: number;
  /** Preferred artifact version field. */
  backend_artifact?: string | null;
  /** Legacy Hermes-Lanyard artifact version field. */
  hermes_artifact?: string | null;
  client_core_seed?: string | null;
  [key: string]: string | number | null | undefined;
};

export type BackendHealthResult = {
  status: BackendHealthStatus;
  checks: BackendHealthChecks;
  versions: BackendHealthVersions;
  /** Active backend profile name for the request subject when known. */
  profile?: string;
};

// ---------------------------------------------------------------------------
// Projects (projects.list / projects.create / projects.delete)
// ---------------------------------------------------------------------------

export type BackendProjectFolder = {
  path: string;
  label?: string | null;
  is_primary?: boolean;
};

export type BackendProject = {
  id: string;
  name: string;
  slug?: string;
  primary_path?: string | null;
  folders?: BackendProjectFolder[];
};

export type ListProjectsParams = {
  includeArchived?: boolean;
};

export type ProjectsListResult = {
  projects: BackendProject[];
  /**
   * Origin tag (e.g. hermes_projects_db, projects_db, none, brain_rpc).
   * Missing projects.db → empty list with source "none".
   */
  source: string;
};

/**
 * Domain input for projects.create (expansion).
 * Wire shape: contracts/backend-runtime-v1 `$defs/params_projects_create`.
 * Callers must gate on capabilities.features.projects_create before invoking.
 */
export type CreateProjectInput = {
  /** Human-readable project name (required, 1..200). */
  name: string;
  /**
   * Optional working-directory folder paths.
   * First folder is treated as primary when the host creates folder rows.
   */
  folders?: string[];
};

/**
 * Domain input for projects.delete (host soft-archive).
 * Wire: contracts/backend-runtime-v1 `$defs/params_projects_delete`.
 * Soft-archive only — does not purge workspace/vault disk (lp-uxy.5).
 */
export type DeleteProjectInput = {
  id: string;
};

/** Wire: `$defs/result_projects_delete` — always `{ id, archived: true }`. */
export type DeleteProjectResult = {
  id: string;
  archived: true;
};

// ---------------------------------------------------------------------------
// Settings (settings.snapshot)
// ---------------------------------------------------------------------------

export type SettingsSkill = {
  id: string;
  name: string;
  enabled?: boolean;
  path?: string;
  source?: string;
};

/**
 * Structured schedule for product jobs.json / settings.patch cron.create|update
 * (lp-jzl.3). List snapshot may still use a human display string.
 */
export type SettingsCronSchedule = {
  kind?: string;
  expr?: string;
  display?: string;
  timezone?: string;
  run_at?: string;
};

export type SettingsCron = {
  id: string;
  name: string;
  /**
   * Human display string (legacy list snapshot) or structured schedule
   * (create/update result / jobs.json projection).
   */
  schedule?: string | SettingsCronSchedule;
  enabled?: boolean;
  path?: string;
  /** Agent instructions / task body (jobs.json prompt). */
  prompt?: string;
  /** Optional skill ids attached to the job (lp-jzl.9.2). */
  skills?: string[];
  last_run_at?: string | null;
  next_run_at?: string | null;
  /** Host job state when provided (scheduled | running | paused | …). lp-su0. */
  state?: string | null;
  /** Last run outcome when host provides it (ok | error | …). */
  last_status?: string | null;
};

export type SettingsMcpServer = {
  name: string;
  transport?: string;
  command?: string;
  enabled?: boolean;
};

export type SettingsModel = {
  provider: string;
  model: string;
  is_active?: boolean;
  connected?: boolean;
};

export type SettingsIntegration = {
  id: string;
  name: string;
  type?: string;
  bin?: string;
  path?: string;
};

/** User-created workflow definition (settings.snapshot.workflows). */
export type SettingsWorkflow = {
  id: string;
  name: string;
  path?: string;
  description?: string;
  enabled?: boolean;
  updated_at?: string | null;
};

export type SettingsSnapshotSection =
  | "skills"
  | "crons"
  | "mcp_servers"
  | "models"
  | "integrations"
  | "workflows";

export type SettingsSnapshotParams = {
  include?: SettingsSnapshotSection[];
};

/** Redacted settings subset for Portal (no secrets on the wire). */
export type SettingsSnapshot = {
  exported_at: string;
  source: string;
  /** Preferred BACKEND_HOME display path. */
  backend_home?: string | null;
  /** Legacy Hermes home path still emitted by Hermes-Lanyard. */
  hermes_home?: string | null;
  skills?: SettingsSkill[];
  crons?: SettingsCron[];
  mcp_servers?: SettingsMcpServer[];
  models?: SettingsModel[];
  integrations?: SettingsIntegration[];
  /** User-created workflow defs (additive; empty when host has none). */
  workflows?: SettingsWorkflow[];
};

/**
 * settings.patch op names (expansion).
 * Wire: contracts/backend-runtime-v1 `$defs/params_settings_patch`.
 * Each op maps onto a BACKEND_HOME config.schema.json surface
 * (or cron/jobs.json for cron ops).
 */
export type SettingsPatchOp =
  | "skill.set_enabled"
  | "cron.set_enabled"
  | "cron.create"
  | "cron.update"
  | "mcp.set_enabled"
  | "model.set_active";

/**
 * Domain input for settings.patch (expansion).
 * Callers must gate on capabilities.features.settings_patch (or related
 * models/cron capabilities for model/cron ops) before invoking.
 * Full job create/update (`cron.create` / `cron.update`) additionally
 * requires features.cron or cron.patch/cron.create/cron.update methods.
 */
export type SettingsPatchInput =
  | {
      op: "skill.set_enabled";
      skillId: string;
      enabled: boolean;
    }
  | {
      op: "cron.set_enabled";
      cronId: string;
      enabled: boolean;
    }
  | {
      op: "cron.create";
      /** Optional client-provided id; host generates when omitted. */
      cronId?: string;
      name: string;
      /** Agent instructions (jobs.json prompt). */
      prompt: string;
      schedule: string | SettingsCronSchedule;
      enabled?: boolean;
      skills?: string[];
    }
  | {
      op: "cron.update";
      cronId: string;
      name?: string;
      prompt?: string;
      schedule?: string | SettingsCronSchedule;
      enabled?: boolean;
      skills?: string[];
    }
  | {
      op: "mcp.set_enabled";
      mcpName: string;
      enabled: boolean;
    }
  | {
      op: "model.set_active";
      provider: string;
      model: string;
    };

/**
 * Result of settings.patch — updated redacted entity + origin tag.
 * Never includes secret-shaped keys.
 */
export type SettingsPatchResult = {
  op: SettingsPatchOp;
  source: string;
  skill?: SettingsSkill;
  cron?: SettingsCron;
  mcp?: SettingsMcpServer;
  model?: SettingsModel;
};

// ---------------------------------------------------------------------------
// Vault (vault.list / vault.stat / vault.read)
// ---------------------------------------------------------------------------

export type VaultEntryKind = "file" | "directory";

export type VaultEntry = {
  name: string;
  path: string;
  kind: VaultEntryKind;
  mime_type?: string | null;
  size_bytes?: number | null;
  mtime?: string | null;
};

export type VaultListParams = {
  /** Directory to list (vault-root-relative, starts with /). Default /. */
  path?: string;
  cursor?: string | null;
  limit?: number;
};

export type VaultListResult = {
  path: string;
  entries: VaultEntry[];
  next_cursor?: string | null;
  truncated: boolean;
};

export type VaultStatParams = {
  path: string;
};

export type VaultReadParams = {
  path: string;
  maxBytes?: number;
};

export type VaultReadResult = {
  path: string;
  kind: "file";
  mime_type?: string | null;
  encoding: "utf-8" | "base64";
  content: string;
  size_bytes: number;
};

// ---------------------------------------------------------------------------
// Vault write (vault.write expansion — lp-5q6.18 / lp-5q6.19)
// ---------------------------------------------------------------------------

/** How revision.token was produced (Brain RPC documentRevisionKind). */
export type DocumentRevisionKind =
  | "etag"
  | "content_hash"
  | "host_revision"
  | "mtime_size_fallback";

/**
 * Host-owned identity of specific bytes at a vault path.
 * Used for vault.write CAS (expected_revision / if_match) and write results.
 * Opaque token — never a file body.
 */
export type DocumentRevision = {
  token: string;
  kind: DocumentRevisionKind;
  size_bytes?: number;
  modified_at?: string;
};

/**
 * Write semantics. Office callback and agent replace of existing files MUST
 * use replace_if_match with expected_revision or if_match. When a dirty human
 * Office session owns the logical path, agents MUST use write_checkpoint (or
 * refuse with human_edit_active) — never bare overwrite (lp-5q6.32 / lp-ye4.10).
 * Blind overwrite of existing files is not a v1 mode.
 */
export type VaultWriteMode =
  | "create_new"
  | "replace_if_match"
  | "replace_if_absent"
  | "write_checkpoint";

/**
 * Reference to bytes already staged for this write (BFF spool, host upload
 * session, or chunked write commit). Prefer content_ref for production Office
 * bodies above the inline cap.
 */
export type VaultWriteContentRef = {
  kind: "bff_spool" | "host_upload_session" | "chunked_write_session";
  id: string;
  content_sha256?: string;
};

/**
 * Shared vault.write fields (all modes).
 * Wire: contracts/backend-runtime-v1 `$defs/params_vault_write`.
 */
type VaultWriteParamsBase = {
  path: string;
  /** CAS precondition for replace_if_match (preferred form). */
  expectedRevision?: DocumentRevision;
  /** Shorthand CAS token equivalent to expectedRevision.token. */
  ifMatch?: string;
  /** Required when content (inline body) is present. */
  encoding?: "utf-8" | "base64";
  /** Inline file body as UTF-8 text or base64. Mutually exclusive with contentRef. */
  content?: string;
  /** Staged-bytes reference. Mutually exclusive with content/encoding. */
  contentRef?: VaultWriteContentRef;
  mimeType?: string;
  /** Decoded byte length of the full body (inline or staged). */
  sizeBytes: number;
  /**
   * Caller-supplied key so retries converge. After a successful write, retries
   * with the same key and identical body fingerprint return the same revision.
   */
  idempotencyKey: string;
  /** When true, create missing parent directories within the path ACL. */
  createParents?: boolean;
};

/**
 * Domain input for vault.write (expansion).
 * Callers must gate on capabilities.features.vault_write and
 * brain_rpc_methods includes vault.write before invoking.
 *
 * Exactly one content plane: inline content+encoding OR content_ref.
 *
 * `sourcePath` is modeled **only** on `write_checkpoint` (canonical path the
 * agent intended). Other modes must not carry sourcePath (lp-ye4.10).
 */
export type VaultWriteParams =
  | (VaultWriteParamsBase & {
      mode: "create_new" | "replace_if_match" | "replace_if_absent";
      sourcePath?: undefined;
    })
  | (VaultWriteParamsBase & {
      mode: "write_checkpoint";
      /**
       * Canonical vault path the agent intended to update (ownership subject).
       * Must differ from `path` (checkpoint destination). Both are ACL-checked.
       */
      sourcePath: string;
    });

/** Optional write kind for pane/artifact alignment (result_vault_write). */
export type VaultWriteKind =
  | "create"
  | "replace"
  | "checkpoint"
  | "conflict_copy";

/**
 * Ledger operation kinds produced by a successful vault.write (lp-ye4.8).
 * Maps from VaultWriteMode via vaultWriteModeToOperationKind.
 */
export type VaultWriteCommitKind =
  | "file_create"
  | "file_replace"
  | "file_checkpoint";

/**
 * Optional signed-operation ledger commit metadata on vault.write success
 * (`result_vault_write.commit`, lp-ye4.8).
 *
 * Clients MUST tolerate absence. `operation_id` is never a DocumentRevision
 * CAS token — use `revision` for vault CAS / Office document.key.
 */
export type VaultWriteCommitMetadata = {
  /** Ledger operation_id (op_…); history/head pointer only. */
  operation_id: string;
  /** Ledger kind for this successful write. */
  kind: VaultWriteCommitKind;
  /** Workspace id whose tree head advanced when known. */
  workspace_id?: string;
  /** workspace_head.tree_root_hash after this commit when advanced. */
  tree_root_hash?: string;
  advances_artifact_head?: boolean;
  advances_workspace_head?: boolean;
};

/**
 * Result of vault.write — new host revision after durable commit.
 * Idempotent replay returns the same revision/writtenAt (and commit metadata)
 * as the original success.
 */
export type VaultWriteResult = {
  path: string;
  revision: DocumentRevision;
  etag?: string;
  size_bytes: number;
  mime_type: string;
  written_at: string;
  created?: boolean;
  idempotent_replay?: boolean;
  /** Echo of canonical source_path when mode was write_checkpoint. */
  source_path?: string;
  /** write_checkpoint success SHOULD set `checkpoint`. */
  write_kind?: VaultWriteKind;
  /**
   * Optional ledger commit metadata (lp-ye4.8). Present when the host
   * maintains a signed-operation ledger and recorded this write.
   */
  commit?: VaultWriteCommitMetadata;
};

// ---------------------------------------------------------------------------
// History / heads (history.list, heads.artifact, heads.workspace) — lp-ye4.7
// Domain types for signed-operation ledger reads. Wire shapes are snake_case
// for events/heads (see signed-operation.schema.json); service params use
// camelCase like other BackendRuntimeService methods.
// ---------------------------------------------------------------------------

/** history.list params (path-scoped artifact history). */
export type HistoryListParams = {
  /** Vault-root-relative file path. */
  path: string;
  /** Max events (default 50, max 200). */
  limit?: number;
  /** Opaque cursor (typically last operation_id). */
  cursor?: string | null;
  /** Include operation_rejected events (default true). */
  includeRejected?: boolean;
};

/** history.list success. events are SignedOperationEvent wire records. */
export type HistoryListResult = {
  path: string;
  /** Append order (oldest → newest) after ACL filter. */
  events: SignedOperationEvent[];
  next_cursor?: string | null;
  truncated: boolean;
};

/** heads.artifact params. */
export type HeadsArtifactParams = {
  path: string;
};

/** heads.workspace params. */
export type HeadsWorkspaceParams = {
  workspaceId?: string;
};

/** heads.artifact success — artifact_head wire record. */
export type HeadsArtifactResult = ArtifactHead;

/** heads.workspace success — workspace_head wire record. */
export type HeadsWorkspaceResult = WorkspaceHead;

// ---------------------------------------------------------------------------
// Capabilities (brain.capabilities / artifact manifest fallback)
// ---------------------------------------------------------------------------

export type UiAffordanceState = "supported" | "unsupported" | "degraded";

/**
 * Backend capability descriptor — what the host can do (not session ACL).
 * Aligns with capabilities.schema.json capabilityDescriptor /
 * BackendCapabilitySet in phase-4 plan.
 */
export type BackendCapabilitySet = {
  schema_version: 1;
  source?: "brain_rpc" | "artifact_manifest" | "combined" | "static_default";
  kind?: BackendKind;
  version?: string;
  contract?: {
    runtime_layout: number;
    relay: number;
    brain_rpc: number;
  };
  profiles?: string[];
  brain_rpc_methods: string[];
  features: Record<string, boolean>;
  ui_affordances?: Record<string, UiAffordanceState>;
  limits?: {
    vault_read_default_max_bytes?: number;
    vault_read_hard_max_bytes?: number;
    vault_list_max_entries?: number;
    [key: string]: number | undefined;
  };
  notes?: string;
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Stable machine error codes aligned with brain-rpc.schema.json errorCode. */
export type BackendRuntimeErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_argument"
  | "invalid_type"
  | "payload_too_large"
  | "timeout"
  | "unavailable"
  | "conflict"
  | "method_not_found"
  | "version_unsupported"
  | "rate_limited"
  | "internal"
  | "not_implemented";

export type BackendRuntimeErrorDetails = {
  path?: string;
  method?: string;
  limit?: number;
  size_bytes?: number;
  max_bytes?: number;
  /** vault.write CAS conflict details (revision_mismatch, path_exists, …). */
  reason?: string;
  expected_revision_token?: string;
  actual_revision_token?: string;
  [key: string]: unknown;
};
