import type {
  BackendCapabilitySet,
  BackendHealthResult,
  BackendProject,
  BackendRuntimeContext,
  CreateProjectInput,
  DeleteProjectInput,
  DeleteProjectResult,
  ListProjectsParams,
  ProjectsListResult,
  SettingsPatchInput,
  SettingsPatchResult,
  SettingsSnapshot,
  SettingsSnapshotParams,
  VaultEntry,
  VaultListParams,
  VaultListResult,
  VaultReadParams,
  VaultReadResult,
  VaultStatParams,
  VaultWriteParams,
  VaultWriteResult,
  HistoryListParams,
  HistoryListResult,
  HeadsArtifactParams,
  HeadsArtifactResult,
  HeadsWorkspaceParams,
  HeadsWorkspaceResult,
} from "./types.js";

/**
 * Portal BFF service boundary for backend runtime operations.
 *
 * Callers (HTTP route handlers, UI state loaders) must depend on this interface
 * instead of importing Hermes-specific modules directly. Implementations:
 *
 * - {@link HermesBackendRuntimeService} — migration adapter wrapping current
 *   Hermes-Lanyard / local Hermes behavior
 * - Fake/in-memory implementations for unit and contract tests
 * - Future Lanyard Agent / pure Brain RPC adapters
 *
 * Method set covers backend-runtime-v1 required ops (health, projects, settings,
 * vault) plus capabilities discovery used for feature gating.
 *
 * Normative wire shapes: `contracts/backend-runtime-v1/brain-rpc.schema.json`
 * and `capabilities.schema.json`. Design: phase-4 plan
 * `docs/plans/0001-platform-monorepo-migration/phase-4-portal-backend-abstraction.md`.
 */
export interface BackendRuntimeService {
  // ---- health -------------------------------------------------------------

  /**
   * Host readiness for MVP read path (`brain.health`).
   * status ok = vault reads usable; degraded = partial; unavailable = cannot serve.
   */
  health(ctx: BackendRuntimeContext): Promise<BackendHealthResult>;

  // ---- projects -----------------------------------------------------------

  /**
   * List non-archived (by default) agent projects (`projects.list`).
   * Missing projects store → empty list, not an error.
   */
  listProjects(
    ctx: BackendRuntimeContext,
    params?: ListProjectsParams,
  ): Promise<ProjectsListResult>;

  /**
   * Create a project (`projects.create` expansion).
   * Optional: only when capabilities advertise projects_create.
   * Hermes migration path wraps local hermes-projects CLI / store.
   */
  createProject?(
    ctx: BackendRuntimeContext,
    input: CreateProjectInput,
  ): Promise<BackendProject>;

  /** Soft-delete / archive project (`projects.delete`). */
  deleteProject?(
    ctx: BackendRuntimeContext,
    input: DeleteProjectInput,
  ): Promise<DeleteProjectResult>;

  // ---- settings -----------------------------------------------------------

  /**
   * Redacted settings snapshot (`settings.snapshot`).
   * Never returns secret-shaped keys; BFF re-asserts redaction.
   * Powers the Portal settings page (required v1).
   */
  settingsSnapshot(
    ctx: BackendRuntimeContext,
    params?: SettingsSnapshotParams,
  ): Promise<SettingsSnapshot>;

  /**
   * Patch a redacted settings subset (`settings.patch` expansion).
   * Optional: only when capabilities advertise settings_patch (or models/cron
   * for those ops). Validated against backend config.schema.json surfaces
   * before invoke (skills.disabled, model object, mcp_servers entries).
   */
  patchSettings?(
    ctx: BackendRuntimeContext,
    input: SettingsPatchInput,
  ): Promise<SettingsPatchResult>;

  // ---- vault --------------------------------------------------------------

  /**
   * List vault directory entries (`vault.list`). Path ACL enforced by host/BFF.
   */
  listVault(
    ctx: BackendRuntimeContext,
    params?: VaultListParams,
  ): Promise<VaultListResult>;

  /**
   * Stat a single vault path (`vault.stat`).
   */
  statVault(
    ctx: BackendRuntimeContext,
    params: VaultStatParams,
  ): Promise<VaultEntry>;

  /**
   * Read vault file body (`vault.read`). Directories → invalid_argument.
   */
  readVault(
    ctx: BackendRuntimeContext,
    params: VaultReadParams,
  ): Promise<VaultReadResult>;

  /**
   * Write or create a single vault file (`vault.write` expansion).
   * Optional: only when capabilities advertise vault_write + method vault.write.
   * Prefer replace_if_match + expected_revision over blind overwrites.
   * Callers (BFF) must capability-gate and ACL-stamp before invoking.
   */
  writeVault?(
    ctx: BackendRuntimeContext,
    params: VaultWriteParams,
  ): Promise<VaultWriteResult>;

  // ---- history / heads (lp-ye4.7 expansion) --------------------------------

  /**
   * List signed operation history for one vault path (`history.list` expansion).
   * Optional: only when capabilities advertise history_read + method history.list.
   * Callers (BFF) must capability-gate and ACL-stamp before invoking.
   */
  listHistory?(
    ctx: BackendRuntimeContext,
    params: HistoryListParams,
  ): Promise<HistoryListResult>;

  /**
   * Current artifact head for one path (`heads.artifact` expansion).
   * Optional: only when capabilities advertise heads_read + method heads.artifact.
   */
  readArtifactHead?(
    ctx: BackendRuntimeContext,
    params: HeadsArtifactParams,
  ): Promise<HeadsArtifactResult>;

  /**
   * Current workspace tree head (`heads.workspace` expansion).
   * Optional: only when capabilities advertise heads_read + method heads.workspace.
   */
  readWorkspaceHead?(
    ctx: BackendRuntimeContext,
    params?: HeadsWorkspaceParams,
  ): Promise<HeadsWorkspaceResult>;

  // ---- capabilities -------------------------------------------------------

  /**
   * Backend capability descriptor for Portal feature gating
   * (`brain.capabilities` live discovery, or artifact/static fallback).
   */
  capabilities(ctx: BackendRuntimeContext): Promise<BackendCapabilitySet>;
}

/**
 * Type guard helper for tests and DI: ensures an object implements the required
 * BackendRuntimeService surface (optional createProject excluded).
 */
export function isBackendRuntimeService(
  value: unknown,
): value is BackendRuntimeService {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.health === "function" &&
    typeof s.listProjects === "function" &&
    typeof s.settingsSnapshot === "function" &&
    typeof s.listVault === "function" &&
    typeof s.statVault === "function" &&
    typeof s.readVault === "function" &&
    typeof s.capabilities === "function"
  );
}

/** Required method names for documentation and contract tests. */
export const BACKEND_RUNTIME_SERVICE_METHODS = [
  "health",
  "listProjects",
  "settingsSnapshot",
  "listVault",
  "statVault",
  "readVault",
  "capabilities",
] as const satisfies readonly (keyof BackendRuntimeService)[];

/** Optional expansion methods on the interface. */
export const BACKEND_RUNTIME_SERVICE_OPTIONAL_METHODS = [
  "createProject",
  "deleteProject",
  "patchSettings",
  "writeVault",
  "listHistory",
  "readArtifactHead",
  "readWorkspaceHead",
] as const;
