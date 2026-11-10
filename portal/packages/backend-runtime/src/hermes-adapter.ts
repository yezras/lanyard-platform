import { BackendRuntimeError } from "./errors.js";
import {
  defaultHermesLanyardCapabilities,
} from "./capability-defaults.js";
import type { BackendRuntimeService } from "./service.js";
import {
  settingsPatchInputToWireParams,
} from "./settings-bff.js";
import {
  headsArtifactParamsToWire,
  headsWorkspaceParamsToWire,
  historyListParamsToWire,
  normalizeHistoryListWireResult,
} from "./history-bff.js";
import type {
  ArtifactHead,
  WorkspaceHead,
} from "./signed-operation.js";
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
 * Delegates that map 1:1 onto current Portal BFF Hermes modules.
 *
 * When full Portal is imported, wire:
 * - projects  ← packages/bff/src/hermes-projects.ts (HermesProjectsService)
 * - settings  ← packages/bff/src/settings-snapshot.ts (discover / redacted load)
 * - vault     ← packages/bff/src/vault/service.ts (VaultService) or Brain RPC
 * - brainRpc  ← packages/bff/src/brain-rpc.ts + relay-client invoke path
 * - health    ← Brain RPC brain.health or local host probes
 *
 * During migration, either inject real module adapters or leave a port unset
 * so the method fails with method_not_found / not_implemented rather than
 * calling Hermes-specific code from route handlers directly.
 */
export type HermesProjectsPort = {
  listProjects(params?: ListProjectsParams): Promise<ProjectsListResult> | ProjectsListResult;
  getProject?(id: string): Promise<BackendProject | null> | BackendProject | null;
  createProject?(input: CreateProjectInput): Promise<BackendProject>;
};

export type HermesSettingsPort = {
  settingsSnapshot(
    params?: SettingsSnapshotParams,
  ): Promise<SettingsSnapshot> | SettingsSnapshot;
  /**
   * Local settings patch (current: settings-snapshot.ts writeHermes*).
   * **Test / migration fallback only.** Production uses Brain RPC settings.patch.
   */
  patchSettings?(
    input: SettingsPatchInput,
  ): Promise<SettingsPatchResult> | SettingsPatchResult;
};

export type HermesVaultPort = {
  listVault(params?: VaultListParams): Promise<VaultListResult>;
  statVault(params: VaultStatParams): Promise<VaultEntry>;
  readVault(params: VaultReadParams): Promise<VaultReadResult>;
  /** Expansion: vault.write (lp-5q6.19). Test/migration only when Brain RPC off. */
  writeVault?(params: VaultWriteParams): Promise<VaultWriteResult>;
};

export type HermesHealthPort = {
  health(ctx: BackendRuntimeContext): Promise<BackendHealthResult>;
};

/**
 * Optional Brain RPC invoker. When provided and brainRpcPreferred is true,
 * methods prefer RPC over local Hermes filesystem/SQLite ports.
 *
 * method: brain.health | projects.list | settings.snapshot | vault.* | brain.capabilities
 */
export type BrainRpcInvoker = (input: {
  method: string;
  params: Record<string, unknown>;
  ctx: BackendRuntimeContext;
}) => Promise<unknown>;

export type HermesBackendRuntimeServiceOptions = {
  /**
   * Local projects store (current: hermes-projects.ts over $HERMES_HOME/projects.db).
   * **Test / migration fallback only.** Production composition must use
   * `invokeBrainRpc` with `projectsRequireBrainRpc: true` so list goes through
   * Brain RPC `projects.list` (see projects-bff.ts / lp-k7g.8.3).
   */
  projects?: HermesProjectsPort;
  /**
   * Local settings discovery/patch (current: settings-snapshot.ts + settings-discover.ts).
   * **Test / migration fallback only.** Production composition must use
   * `invokeBrainRpc` with `settingsRequireBrainRpc: true` so snapshot/patch
   * go through Brain RPC (see settings-bff.ts / lp-k7g.8.4).
   */
  settings?: HermesSettingsPort;
  /**
   * Local vault provider (current: VaultService + FS/fixture providers).
   * Production path should migrate to Brain RPC vault.list/stat/read.
   */
  vault?: HermesVaultPort;
  /**
   * Host health probes. Prefer Brain RPC brain.health when invoker is set.
   */
  health?: HermesHealthPort;
  /**
   * Authenticated relay Brain RPC invoke. When set, RPC is preferred for
   * health/settings/vault/projects/capabilities when brainRpcPreferred is true.
   * **Required for production projects.list** (lp-k7g.8.3).
   */
  invokeBrainRpc?: BrainRpcInvoker;
  /**
   * When true (default if invokeBrainRpc is provided), prefer Brain RPC over
   * local ports for methods that exist on the contract.
   */
  brainRpcPreferred?: boolean;
  /**
   * When true, listProjects never uses the local projects port (fixtures/DB).
   * Defaults to true whenever `invokeBrainRpc` is provided so production
   * routes agent projects exclusively through Brain RPC.
   * Set false only for migration/unit tests that inject HermesProjectsPort.
   */
  projectsRequireBrainRpc?: boolean;
  /**
   * When true, settingsSnapshot / patchSettings never use the local settings
   * port (filesystem config.yaml / fixtures). Defaults to true whenever
   * `invokeBrainRpc` is provided so production routes settings exclusively
   * through Brain RPC. Set false only for migration/unit tests.
   */
  settingsRequireBrainRpc?: boolean;
  /**
   * When true, listVault / statVault / readVault / writeVault never use the
   * local vault port (FS/fixture providers). Defaults to true whenever
   * `invokeBrainRpc` is provided so production routes vault exclusively
   * through Brain RPC (lp-t7q.2 / lp-5q6.19). Set false only for tests.
   */
  vaultRequireBrainRpc?: boolean;
  /**
   * Static capability descriptor used when brain.capabilities is missing or fails.
   * Defaults to Hermes-Lanyard v1 required method set.
   */
  staticCapabilities?: BackendCapabilitySet;
  /**
   * Artifact / host version string for health.versions.backend_artifact.
   */
  backendVersion?: string | null;
};

function notWired(method: string): never {
  throw new BackendRuntimeError(
    "not_implemented",
    `HermesBackendRuntimeService has no delegate wired for ${method}. ` +
      `Inject the corresponding port or invokeBrainRpc (see hermes-adapter migration map).`,
    { details: { method }, retryable: false },
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null) {
    return value as Record<string, unknown>;
  }
  throw new BackendRuntimeError(
    "internal",
    "Brain RPC result was not an object",
    { retryable: true },
  );
}

function normalizeProjectRow(raw: Record<string, unknown>): BackendProject {
  const id = typeof raw.id === "string" ? raw.id : "";
  const name = typeof raw.name === "string" ? raw.name : "";
  if (!id || !name) {
    throw new BackendRuntimeError(
      "internal",
      "Brain RPC project row missing id or name",
      { retryable: true },
    );
  }
  const folders = Array.isArray(raw.folders)
    ? (raw.folders as BackendProject["folders"])
    : undefined;
  return {
    id,
    name,
    slug: typeof raw.slug === "string" ? raw.slug : undefined,
    primary_path:
      raw.primary_path === null || typeof raw.primary_path === "string"
        ? (raw.primary_path as string | null)
        : undefined,
    folders,
  };
}

function normalizeProjectsListResult(
  raw: unknown,
  defaultSource: string,
): ProjectsListResult {
  const r = asRecord(raw);
  const list = Array.isArray(r.projects) ? r.projects : [];
  const projects: BackendProject[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    projects.push(normalizeProjectRow(item as Record<string, unknown>));
  }
  const source =
    typeof r.source === "string" && r.source.length > 0
      ? r.source
      : defaultSource;
  return { projects, source };
}

function normalizeSettingsSnapshot(
  raw: unknown,
  defaultSource: string,
): SettingsSnapshot {
  const r = asRecord(raw);
  const exported_at =
    typeof r.exported_at === "string" && r.exported_at.length > 0
      ? r.exported_at
      : "";
  if (!exported_at) {
    throw new BackendRuntimeError(
      "internal",
      "Brain RPC settings.snapshot missing exported_at",
      { retryable: true, details: { method: "settings.snapshot" } },
    );
  }
  const source =
    typeof r.source === "string" && r.source.length > 0
      ? r.source
      : defaultSource;
  return {
    exported_at,
    source,
    backend_home:
      r.backend_home === null || typeof r.backend_home === "string"
        ? (r.backend_home as string | null)
        : undefined,
    hermes_home:
      r.hermes_home === null || typeof r.hermes_home === "string"
        ? (r.hermes_home as string | null)
        : undefined,
    skills: Array.isArray(r.skills)
      ? (r.skills as SettingsSnapshot["skills"])
      : undefined,
    crons: Array.isArray(r.crons)
      ? (r.crons as SettingsSnapshot["crons"])
      : undefined,
    mcp_servers: Array.isArray(r.mcp_servers)
      ? (r.mcp_servers as SettingsSnapshot["mcp_servers"])
      : undefined,
    models: Array.isArray(r.models)
      ? (r.models as SettingsSnapshot["models"])
      : undefined,
    integrations: Array.isArray(r.integrations)
      ? (r.integrations as SettingsSnapshot["integrations"])
      : undefined,
    workflows: Array.isArray(r.workflows)
      ? (r.workflows as SettingsSnapshot["workflows"])
      : undefined,
  };
}

function vaultWriteParamsToWire(
  params: VaultWriteParams,
): Record<string, unknown> {
  const wire: Record<string, unknown> = {
    path: params.path,
    mode: params.mode,
    size_bytes: params.sizeBytes,
    idempotency_key: params.idempotencyKey,
  };
  if (params.expectedRevision) {
    wire.expected_revision = {
      token: params.expectedRevision.token,
      kind: params.expectedRevision.kind,
      ...(params.expectedRevision.size_bytes !== undefined
        ? { size_bytes: params.expectedRevision.size_bytes }
        : {}),
      ...(params.expectedRevision.modified_at !== undefined
        ? { modified_at: params.expectedRevision.modified_at }
        : {}),
    };
  }
  if (params.ifMatch !== undefined) wire.if_match = params.ifMatch;
  if (params.content !== undefined) {
    wire.content = params.content;
    wire.encoding = params.encoding ?? "utf-8";
  }
  if (params.contentRef) {
    wire.content_ref = {
      kind: params.contentRef.kind,
      id: params.contentRef.id,
      ...(params.contentRef.content_sha256
        ? { content_sha256: params.contentRef.content_sha256 }
        : {}),
    };
  }
  if (params.mimeType !== undefined) wire.mime_type = params.mimeType;
  if (params.createParents !== undefined) {
    wire.create_parents = params.createParents;
  }
  if (params.mode === "write_checkpoint" && params.sourcePath) {
    wire.source_path = params.sourcePath;
  }
  return wire;
}

function normalizeVaultWriteResult(
  raw: unknown,
  fallbackPath: string,
): VaultWriteResult {
  const r = asRecord(raw);
  const revisionRaw = r.revision;
  if (
    typeof revisionRaw !== "object" ||
    revisionRaw === null ||
    typeof (revisionRaw as { token?: unknown }).token !== "string" ||
    typeof (revisionRaw as { kind?: unknown }).kind !== "string"
  ) {
    throw new BackendRuntimeError(
      "internal",
      "Brain RPC vault.write missing revision",
      { retryable: true, details: { method: "vault.write" } },
    );
  }
  const rev = revisionRaw as {
    token: string;
    kind: VaultWriteResult["revision"]["kind"];
    size_bytes?: number;
    modified_at?: string;
  };
  const commit = normalizeVaultWriteCommit(r.commit);
  return {
    path:
      typeof r.path === "string" && r.path.length > 0 ? r.path : fallbackPath,
    revision: {
      token: rev.token,
      kind: rev.kind,
      ...(typeof rev.size_bytes === "number"
        ? { size_bytes: rev.size_bytes }
        : {}),
      ...(typeof rev.modified_at === "string"
        ? { modified_at: rev.modified_at }
        : {}),
    },
    ...(typeof r.etag === "string" ? { etag: r.etag } : {}),
    size_bytes:
      typeof r.size_bytes === "number" && Number.isFinite(r.size_bytes)
        ? r.size_bytes
        : 0,
    mime_type:
      typeof r.mime_type === "string" && r.mime_type.length > 0
        ? r.mime_type
        : "application/octet-stream",
    written_at:
      typeof r.written_at === "string" && r.written_at.length > 0
        ? r.written_at
        : new Date().toISOString(),
    ...(typeof r.created === "boolean" ? { created: r.created } : {}),
    ...(typeof r.idempotent_replay === "boolean"
      ? { idempotent_replay: r.idempotent_replay }
      : {}),
    ...(typeof r.source_path === "string" && r.source_path.length > 0
      ? { source_path: r.source_path }
      : {}),
    ...(typeof r.write_kind === "string"
      ? {
          write_kind: r.write_kind as VaultWriteResult["write_kind"],
        }
      : {}),
    ...(commit ? { commit } : {}),
  };
}

/** Pass through optional result_vault_write.commit (lp-ye4.8). */
function normalizeVaultWriteCommit(
  raw: unknown,
): VaultWriteResult["commit"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const c = raw as Record<string, unknown>;
  if (
    typeof c.operation_id !== "string" ||
    !c.operation_id.startsWith("op_") ||
    (c.kind !== "file_create" &&
      c.kind !== "file_replace" &&
      c.kind !== "file_checkpoint")
  ) {
    return undefined;
  }
  return {
    operation_id: c.operation_id,
    kind: c.kind,
    ...(typeof c.workspace_id === "string" && c.workspace_id.length > 0
      ? { workspace_id: c.workspace_id }
      : {}),
    ...(typeof c.tree_root_hash === "string" &&
    /^[a-f0-9]{64}$/.test(c.tree_root_hash)
      ? { tree_root_hash: c.tree_root_hash }
      : {}),
    ...(typeof c.advances_artifact_head === "boolean"
      ? { advances_artifact_head: c.advances_artifact_head }
      : {}),
    ...(typeof c.advances_workspace_head === "boolean"
      ? { advances_workspace_head: c.advances_workspace_head }
      : {}),
  };
}

function normalizeSettingsPatchResult(
  raw: unknown,
  op: SettingsPatchInput["op"],
  defaultSource: string,
): SettingsPatchResult {
  const r = asRecord(raw);
  const source =
    typeof r.source === "string" && r.source.length > 0
      ? r.source
      : defaultSource;
  const resultOp =
    typeof r.op === "string" && r.op.length > 0
      ? (r.op as SettingsPatchResult["op"])
      : op;
  return {
    op: resultOp,
    source,
    skill:
      typeof r.skill === "object" && r.skill !== null
        ? (r.skill as SettingsPatchResult["skill"])
        : undefined,
    cron:
      typeof r.cron === "object" && r.cron !== null
        ? (r.cron as SettingsPatchResult["cron"])
        : undefined,
    mcp:
      typeof r.mcp === "object" && r.mcp !== null
        ? (r.mcp as SettingsPatchResult["mcp"])
        : undefined,
    model:
      typeof r.model === "object" && r.model !== null
        ? (r.model as SettingsPatchResult["model"])
        : undefined,
  };
}

/**
 * Production composition helper for projects + settings + vault (Brain RPC ops).
 * Ensures listProjects, settingsSnapshot, and vault list/stat/read use Brain RPC
 * only — no local projects.db / config.yaml / FS-fixture fallback.
 */
export function createProductionHermesBackendRuntimeService(
  options: Omit<
    HermesBackendRuntimeServiceOptions,
    | "projectsRequireBrainRpc"
    | "settingsRequireBrainRpc"
    | "vaultRequireBrainRpc"
    | "brainRpcPreferred"
  > & { invokeBrainRpc: BrainRpcInvoker },
): BackendRuntimeService {
  return new HermesBackendRuntimeService({
    ...options,
    brainRpcPreferred: true,
    projectsRequireBrainRpc: true,
    settingsRequireBrainRpc: true,
    vaultRequireBrainRpc: true,
  });
}

/**
 * Migration adapter: implements {@link BackendRuntimeService} by wrapping
 * current Hermes-specific BFF behavior (local modules and/or Brain RPC).
 *
 * ## Current BFF → interface mapping
 *
 * | Interface method     | Current Hermes / BFF behavior                                      | Target contract        |
 * | -------------------- | ------------------------------------------------------------------ | ---------------------- |
 * | health               | brain.health via relay, or local BACKEND_HOME/HERMES_HOME probes   | brain.health           |
 * | listProjects         | hermes-projects.listProjects (SQLite projects.db)                  | projects.list          |
 * | createProject        | hermes-projects.createProject (hermes CLI)                         | projects.create (exp.) |
 * | settingsSnapshot     | settings-snapshot discover + redact from HERMES_HOME               | settings.snapshot      |
 * | patchSettings?       | settings-snapshot writeHermes* (local)                             | settings.patch (exp.)  |
 * | listVault/stat/read  | VaultService + FS/fixture provider (or brain vault.*)              | vault.list/stat/read   |
 * | writeVault?          | Brain RPC vault.write (expansion); local port test-only            | vault.write (exp.)     |
 * | capabilities         | static pin / brain.capabilities                                    | brain.capabilities     |
 *
 * Route handlers should take `BackendRuntimeService` only; construct this
 * adapter at BFF composition root with injected ports.
 */
export class HermesBackendRuntimeService implements BackendRuntimeService {
  private readonly projects?: HermesProjectsPort;
  private readonly settings?: HermesSettingsPort;
  private readonly vault?: HermesVaultPort;
  private readonly healthPort?: HermesHealthPort;
  private readonly invokeBrainRpc?: BrainRpcInvoker;
  private readonly brainRpcPreferred: boolean;
  private readonly projectsRequireBrainRpc: boolean;
  private readonly settingsRequireBrainRpc: boolean;
  private readonly vaultRequireBrainRpc: boolean;
  private readonly staticCapabilities: BackendCapabilitySet;
  private readonly backendVersion: string | null;

  constructor(options: HermesBackendRuntimeServiceOptions = {}) {
    this.projects = options.projects;
    this.settings = options.settings;
    this.vault = options.vault;
    this.healthPort = options.health;
    this.invokeBrainRpc = options.invokeBrainRpc;
    this.brainRpcPreferred =
      options.brainRpcPreferred ?? Boolean(options.invokeBrainRpc);
    // Production default: if Brain RPC invoker is present, projects.list,
    // settings.snapshot, and vault.* must not fall back to local SQLite /
    // config / FS fixtures.
    this.projectsRequireBrainRpc =
      options.projectsRequireBrainRpc ?? Boolean(options.invokeBrainRpc);
    this.settingsRequireBrainRpc =
      options.settingsRequireBrainRpc ?? Boolean(options.invokeBrainRpc);
    this.vaultRequireBrainRpc =
      options.vaultRequireBrainRpc ?? Boolean(options.invokeBrainRpc);
    this.staticCapabilities =
      options.staticCapabilities ?? defaultHermesLanyardCapabilities();
    this.backendVersion = options.backendVersion ?? null;
  }

  async health(ctx: BackendRuntimeContext): Promise<BackendHealthResult> {
    if (this.brainRpcPreferred && this.invokeBrainRpc) {
      const raw = await this.invokeBrainRpc({
        method: "brain.health",
        params: {},
        ctx,
      });
      return asRecord(raw) as unknown as BackendHealthResult;
    }
    if (this.healthPort) {
      return this.healthPort.health(ctx);
    }
    // Scaffold default: report degraded with hermes alias checks unset.
    return {
      status: "degraded",
      checks: {
        vault_root_readable: false,
        backend_home_present: false,
        hermes_home_present: false,
        profiles_present: false,
        projects_db_present: false,
      },
      versions: {
        brain_rpc: 1,
        backend_artifact: this.backendVersion,
        hermes_artifact: this.backendVersion,
      },
      profile: ctx.profile.name,
    };
  }

  async listProjects(
    ctx: BackendRuntimeContext,
    params?: ListProjectsParams,
  ): Promise<ProjectsListResult> {
    if (this.brainRpcPreferred && this.invokeBrainRpc) {
      const raw = await this.invokeBrainRpc({
        method: "projects.list",
        params: {
          include_archived: params?.includeArchived ?? false,
        },
        ctx,
      });
      return normalizeProjectsListResult(raw, "brain_rpc");
    }
    if (this.projectsRequireBrainRpc) {
      throw new BackendRuntimeError(
        "unavailable",
        "projects.list requires Brain RPC in production " +
          "(projectsRequireBrainRpc). Wire invokeBrainRpc; " +
          "local projects.db / fixtures are test-only (lp-k7g.8.3).",
        { retryable: true, details: { method: "projects.list" } },
      );
    }
    if (this.projects) {
      // Migration / test-only local port (hermes-projects over projects.db).
      return this.projects.listProjects(params);
    }
    // Match contract: missing store → empty list, source none.
    return { projects: [], source: "none" };
  }

  async createProject(
    ctx: BackendRuntimeContext,
    input: CreateProjectInput,
  ): Promise<BackendProject> {
    // Expansion method: prefer Brain RPC when configured (production).
    // Local hermes CLI/DB port is test/migration-only.
    if (this.brainRpcPreferred && this.invokeBrainRpc) {
      const raw = await this.invokeBrainRpc({
        method: "projects.create",
        params: {
          name: input.name,
          folders: input.folders ?? [],
        },
        ctx,
      });
      return normalizeProjectRow(asRecord(raw));
    }
    if (this.projectsRequireBrainRpc) {
      throw new BackendRuntimeError(
        "unavailable",
        "projects.create requires Brain RPC when projectsRequireBrainRpc is set. " +
          "Local hermes project create is test/migration-only.",
        { retryable: true, details: { method: "projects.create" } },
      );
    }
    if (this.projects?.createProject) {
      return this.projects.createProject(input);
    }
    notWired("createProject");
  }

  async deleteProject(
    ctx: BackendRuntimeContext,
    input: DeleteProjectInput,
  ): Promise<DeleteProjectResult> {
    if (this.brainRpcPreferred && this.invokeBrainRpc) {
      const raw = await this.invokeBrainRpc({
        method: "projects.delete",
        params: { id: input.id },
        ctx,
      });
      const rec = asRecord(raw);
      const id = typeof rec.id === "string" ? rec.id : input.id;
      return { id, archived: true as const };
    }
    if (this.projectsRequireBrainRpc) {
      throw new BackendRuntimeError(
        "unavailable",
        "projects.delete requires Brain RPC when projectsRequireBrainRpc is set.",
        { retryable: true, details: { method: "projects.delete" } },
      );
    }
    notWired("deleteProject");
  }

  async settingsSnapshot(
    ctx: BackendRuntimeContext,
    params?: SettingsSnapshotParams,
  ): Promise<SettingsSnapshot> {
    if (this.brainRpcPreferred && this.invokeBrainRpc) {
      const raw = await this.invokeBrainRpc({
        method: "settings.snapshot",
        params: {
          include: params?.include,
        },
        ctx,
      });
      return normalizeSettingsSnapshot(raw, "brain_rpc");
    }
    if (this.settingsRequireBrainRpc) {
      throw new BackendRuntimeError(
        "unavailable",
        "settings.snapshot requires Brain RPC in production " +
          "(settingsRequireBrainRpc). Wire invokeBrainRpc; " +
          "local config.yaml / fixtures are test-only (lp-k7g.8.4).",
        { retryable: true, details: { method: "settings.snapshot" } },
      );
    }
    if (this.settings) {
      // Migration / test-only local port (settings-snapshot discover).
      return this.settings.settingsSnapshot(params);
    }
    notWired("settingsSnapshot");
  }

  async patchSettings(
    ctx: BackendRuntimeContext,
    input: SettingsPatchInput,
  ): Promise<SettingsPatchResult> {
    // Expansion method: prefer Brain RPC when configured (production).
    // Local hermes config.yaml / jobs.json port is test/migration-only.
    if (this.brainRpcPreferred && this.invokeBrainRpc) {
      const raw = await this.invokeBrainRpc({
        method: "settings.patch",
        params: settingsPatchInputToWireParams(input),
        ctx,
      });
      return normalizeSettingsPatchResult(raw, input.op, "brain_rpc");
    }
    if (this.settingsRequireBrainRpc) {
      throw new BackendRuntimeError(
        "unavailable",
        "settings.patch requires Brain RPC when settingsRequireBrainRpc is set. " +
          "Local hermes config writes are test/migration-only.",
        { retryable: true, details: { method: "settings.patch" } },
      );
    }
    if (this.settings?.patchSettings) {
      return this.settings.patchSettings(input);
    }
    notWired("patchSettings");
  }

  async listVault(
    ctx: BackendRuntimeContext,
    params?: VaultListParams,
  ): Promise<VaultListResult> {
    if (this.brainRpcPreferred && this.invokeBrainRpc) {
      const raw = await this.invokeBrainRpc({
        method: "vault.list",
        params: {
          path: params?.path ?? "/",
          cursor: params?.cursor ?? null,
          limit: params?.limit,
        },
        ctx,
      });
      return asRecord(raw) as unknown as VaultListResult;
    }
    if (this.vaultRequireBrainRpc) {
      throw new BackendRuntimeError(
        "unavailable",
        "vault.list requires Brain RPC in production " +
          "(vaultRequireBrainRpc). Wire invokeBrainRpc; " +
          "local FS/fixture vault providers are test-only (lp-t7q.2).",
        { retryable: true, details: { method: "vault.list" } },
      );
    }
    if (this.vault) {
      return this.vault.listVault(params);
    }
    notWired("listVault");
  }

  async statVault(
    ctx: BackendRuntimeContext,
    params: VaultStatParams,
  ): Promise<VaultEntry> {
    if (this.brainRpcPreferred && this.invokeBrainRpc) {
      const raw = await this.invokeBrainRpc({
        method: "vault.stat",
        params: { path: params.path },
        ctx,
      });
      return asRecord(raw) as unknown as VaultEntry;
    }
    if (this.vaultRequireBrainRpc) {
      throw new BackendRuntimeError(
        "unavailable",
        "vault.stat requires Brain RPC in production " +
          "(vaultRequireBrainRpc). Wire invokeBrainRpc; " +
          "local FS/fixture vault providers are test-only (lp-t7q.2).",
        { retryable: true, details: { method: "vault.stat" } },
      );
    }
    if (this.vault) {
      return this.vault.statVault(params);
    }
    notWired("statVault");
  }

  async readVault(
    ctx: BackendRuntimeContext,
    params: VaultReadParams,
  ): Promise<VaultReadResult> {
    if (this.brainRpcPreferred && this.invokeBrainRpc) {
      const raw = await this.invokeBrainRpc({
        method: "vault.read",
        params: {
          path: params.path,
          max_bytes: params.maxBytes,
        },
        ctx,
      });
      return asRecord(raw) as unknown as VaultReadResult;
    }
    if (this.vaultRequireBrainRpc) {
      throw new BackendRuntimeError(
        "unavailable",
        "vault.read requires Brain RPC in production " +
          "(vaultRequireBrainRpc). Wire invokeBrainRpc; " +
          "local FS/fixture vault providers are test-only (lp-t7q.2).",
        { retryable: true, details: { method: "vault.read" } },
      );
    }
    if (this.vault) {
      return this.vault.readVault(params);
    }
    notWired("readVault");
  }

  async writeVault(
    ctx: BackendRuntimeContext,
    params: VaultWriteParams,
  ): Promise<VaultWriteResult> {
    // Expansion method: prefer Brain RPC when configured (production).
    // Local vault port write is test/migration-only.
    if (this.brainRpcPreferred && this.invokeBrainRpc) {
      const raw = await this.invokeBrainRpc({
        method: "vault.write",
        params: vaultWriteParamsToWire(params),
        ctx,
      });
      return normalizeVaultWriteResult(raw, params.path);
    }
    if (this.vaultRequireBrainRpc) {
      throw new BackendRuntimeError(
        "unavailable",
        "vault.write requires Brain RPC when vaultRequireBrainRpc is set. " +
          "Local FS vault writes are test/migration-only (lp-5q6.19).",
        { retryable: true, details: { method: "vault.write" } },
      );
    }
    if (this.vault?.writeVault) {
      return this.vault.writeVault(params);
    }
    notWired("writeVault");
  }

  async listHistory(
    ctx: BackendRuntimeContext,
    params: HistoryListParams,
  ): Promise<HistoryListResult> {
    if (this.brainRpcPreferred && this.invokeBrainRpc) {
      const raw = await this.invokeBrainRpc({
        method: "history.list",
        params: historyListParamsToWire(params),
        ctx,
      });
      return normalizeHistoryListWireResult(raw, params.path);
    }
    throw new BackendRuntimeError(
      "method_not_found",
      "history.list requires Brain RPC (lp-ye4.7); no local Hermes port",
      { retryable: false, details: { method: "history.list" } },
    );
  }

  async readArtifactHead(
    ctx: BackendRuntimeContext,
    params: HeadsArtifactParams,
  ): Promise<HeadsArtifactResult> {
    if (this.brainRpcPreferred && this.invokeBrainRpc) {
      const raw = await this.invokeBrainRpc({
        method: "heads.artifact",
        params: headsArtifactParamsToWire(params),
        ctx,
      });
      return raw as ArtifactHead;
    }
    throw new BackendRuntimeError(
      "method_not_found",
      "heads.artifact requires Brain RPC (lp-ye4.7); no local Hermes port",
      { retryable: false, details: { method: "heads.artifact" } },
    );
  }

  async readWorkspaceHead(
    ctx: BackendRuntimeContext,
    params?: HeadsWorkspaceParams,
  ): Promise<HeadsWorkspaceResult> {
    if (this.brainRpcPreferred && this.invokeBrainRpc) {
      const raw = await this.invokeBrainRpc({
        method: "heads.workspace",
        params: headsWorkspaceParamsToWire(params),
        ctx,
      });
      return raw as WorkspaceHead;
    }
    throw new BackendRuntimeError(
      "method_not_found",
      "heads.workspace requires Brain RPC (lp-ye4.7); no local Hermes port",
      { retryable: false, details: { method: "heads.workspace" } },
    );
  }

  async capabilities(
    ctx: BackendRuntimeContext,
  ): Promise<BackendCapabilitySet> {
    if (this.brainRpcPreferred && this.invokeBrainRpc) {
      try {
        const raw = await this.invokeBrainRpc({
          method: "brain.capabilities",
          params: {
            include_limits: true,
            include_ui_affordances: true,
          },
          ctx,
        });
        const result = asRecord(raw) as unknown as BackendCapabilitySet;
        return {
          ...result,
          source: result.source ?? "brain_rpc",
          schema_version: 1,
        };
      } catch (err) {
        if (
          err instanceof BackendRuntimeError &&
          (err.code === "method_not_found" || err.code === "not_implemented")
        ) {
          return {
            ...this.staticCapabilities,
            source: "artifact_manifest",
            notes:
              this.staticCapabilities.notes ??
              "brain.capabilities unavailable; using static / pin fallback",
          };
        }
        throw err;
      }
    }
    return { ...this.staticCapabilities };
  }
}

/**
 * Factory used by BFF composition root once Portal is imported.
 * Prefer this over constructing the class with ad hoc options in route files.
 */
export function createHermesBackendRuntimeService(
  options: HermesBackendRuntimeServiceOptions = {},
): BackendRuntimeService {
  return new HermesBackendRuntimeService(options);
}
