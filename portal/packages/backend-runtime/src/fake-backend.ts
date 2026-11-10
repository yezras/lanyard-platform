import { createHash } from "node:crypto";

import {
  DurableRuntimeLedger,
  type DurableRuntimeLedgerOptions,
} from "./durable-runtime-ledger.js";
import { BackendRuntimeError } from "./errors.js";
import { defaultHermesLanyardCapabilities } from "./capability-defaults.js";
import {
  FakeRuntimeLedger,
  bodyHashFromContent,
  type FakeRuntimeLedgerOptions,
  type LedgerCommitInput,
  type LedgerCommitResult,
  type LedgerMutationKind,
} from "./fake-runtime-ledger.js";
import type { HostLedgerSigner } from "./ledger-signing.js";
import type { BackendRuntimeService } from "./service.js";
import {
  vaultWriteModeToOperationKind,
  type ArtifactHead,
  type OperationActor,
  type SignedOperationEvent,
  type WorkspaceHead,
} from "./signed-operation.js";
import { validateSettingsPatchAgainstConfigSchema } from "./settings-bff.js";
import type {
  BackendCapabilitySet,
  BackendHealthResult,
  BackendProject,
  BackendRuntimeContext,
  CreateProjectInput,
  DeleteProjectInput,
  DeleteProjectResult,
  DocumentRevision,
  ListProjectsParams,
  ProjectsListResult,
  SettingsCron,
  SettingsCronSchedule,
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
  VaultWriteCommitMetadata,
  VaultWriteParams,
  VaultWriteResult,
  HistoryListParams,
  HistoryListResult,
  HeadsArtifactParams,
  HeadsArtifactResult,
  HeadsWorkspaceParams,
  HeadsWorkspaceResult,
} from "./types.js";

export type FakeVaultFile = {
  path: string;
  content: string;
  mime_type?: string;
  encoding?: "utf-8" | "base64";
  mtime?: string;
  /** Optional host revision token; default is content_hash of body. */
  revision_token?: string;
};

export type FakeBackendRuntimeOptions = {
  projects?: BackendProject[];
  settings?: SettingsSnapshot;
  /** File bodies keyed by vault path. Directories are inferred from parents. */
  files?: FakeVaultFile[];
  capabilities?: BackendCapabilitySet;
  health?: BackendHealthResult;
  /** When true, createProject is implemented. Default true. */
  supportCreateProject?: boolean;
  /**
   * When true, deleteProject soft-archive is implemented. Default true.
   * Soft-archive only — never deletes vault file bodies in this fake.
   */
  supportDeleteProject?: boolean;
  /** When true, patchSettings is implemented. Default false (expansion off). */
  supportPatchSettings?: boolean;
  /**
   * When true (default), agent-tool cron create (`cronjob` / `/cron add`) is
   * allowed and writes durable jobs projected as settings.snapshot.crons.
   * Set false to prove clear failure when product cron / capability.cron is off.
   */
  supportAgentCronCreate?: boolean;
  /**
   * When true, settings.patch cron.create / cron.update write durable jobs
   * under cron/jobs.json (lp-jzl.3 Portal create path). Default false —
   * enable with advertiseDedicatedCronRpcs on the LA pin, or set explicitly.
   */
  supportCronCreateUpdate?: boolean;
  /**
   * When true, writeVault is implemented and vault.write is advertised.
   * Default false (expansion off — matches production honesty until host pins).
   */
  supportWriteVault?: boolean;
  /**
   * When true, history.list / heads.artifact / heads.workspace are implemented
   * and advertised (lp-ye4.7). Default false — offline unit tests only.
   *
   * **Production hosts (lp-ye4.12):** prefer {@link durableLedger}. History/head
   * capabilities must be advertised only when a durable store is enabled.
   * This flag alone is for in-memory harness tests without durability.
   */
  supportLedgerReads?: boolean;
  /**
   * Crash-safe durable ledger under backend-owned state (lp-ye4.12).
   * When set and the store opens successfully:
   * - history/heads Brain RPC methods are implemented and advertised
   * - commits are host-signed (ed25519) after ACL/CAS
   * - events, heads, and idempotency survive process restart
   *
   * When durable open fails, history/heads are **not** advertised (fail closed).
   */
  durableLedger?: Omit<DurableRuntimeLedgerOptions, "signer"> & {
    signer: HostLedgerSigner;
  };
  /** Inline write max (default 1 MiB). */
  vaultWriteMaxInlineBytes?: number;
  /**
   * Resolve content_ref staged bytes for callback-origin tests.
   * Default: look up id in an empty spool map (not_found).
   */
  resolveContentRef?: (
    ref: NonNullable<VaultWriteParams["contentRef"]>,
  ) => { content: string; encoding: "utf-8" | "base64" } | null;
  /**
   * In-memory signed-operation ledger + current-head harness (lp-ye4.6).
   * Always available; options configure tenant/instance/workspace ids.
   * Ignored for mutation path when {@link durableLedger} is active (durable
   * owns the ledger); still used as constructor seed when durable is off.
   */
  ledger?: FakeRuntimeLedgerOptions;
};

function basename(path: string): string {
  if (path === "/") return "";
  const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
  const idx = trimmed.lastIndexOf("/");
  return idx < 0 ? trimmed : trimmed.slice(idx + 1);
}

/** Normalize create/update schedule into jobs.json-compatible shape. */
function normalizeFakeCronSchedule(
  schedule: string | SettingsCronSchedule,
): SettingsCronSchedule {
  if (typeof schedule === "string") {
    return { kind: "cron", expr: schedule.trim() };
  }
  const expr = (schedule.expr ?? "").trim();
  return {
    kind: (schedule.kind ?? "cron").trim() || "cron",
    expr,
    ...(schedule.display?.trim()
      ? { display: schedule.display.trim() }
      : {}),
    ...(schedule.timezone?.trim()
      ? { timezone: schedule.timezone.trim() }
      : {}),
    ...(schedule.run_at?.trim() ? { run_at: schedule.run_at.trim() } : {}),
  };
}

function normalizeVaultPath(path: string): string {
  if (!path || path === "") return "/";
  let p = path.startsWith("/") ? path : `/${path}`;
  p = p.replace(/\/+/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  if (p.includes("..") || p.includes("\0")) {
    throw new BackendRuntimeError(
      "invalid_argument",
      `Invalid vault path: ${path}`,
      { details: { path }, retryable: false },
    );
  }
  return p;
}

function pathAllowed(prefixes: string[], path: string): boolean {
  if (prefixes.length === 0) return true; // fake: empty prefixes = full access for tests
  if (prefixes.includes("/")) return true;
  return prefixes.some(
    (prefix) => path === prefix || path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`),
  );
}

/**
 * In-memory {@link BackendRuntimeService} for unit and contract tests.
 * Proves Portal can exercise health, projects, settings, vault, and capabilities
 * without a live Hermes host (phase-4 verification: "fake backend implementing the contract").
 *
 * Owns an in-memory signed-operation ledger + current-head harness
 * (`lp-ye4.6`). Successful `writeVault` commits append ledger events and return
 * optional `commit` metadata (`lp-ye4.8`); CAS/policy conflicts record
 * `operation_rejected` without advancing heads. History/head reads:
 * `lp-ye4.7`. Optional durable store + host signing: `lp-ye4.12`.
 */
type IdempotencyRecord = {
  fingerprint: string;
  result: VaultWriteResult;
};

/** Shared mutation surface used by writeVault / history (memory or durable). */
type HostLedgerSurface = {
  listEvents(): SignedOperationEvent[];
  getArtifactHead(path: string): ArtifactHead | undefined;
  listArtifactHeads(): ArtifactHead[];
  getWorkspaceHead(workspaceId?: string): WorkspaceHead | undefined;
  listWorkspaceHeads(): WorkspaceHead[];
  seedArtifactHead(
    input: Parameters<FakeRuntimeLedger["seedArtifactHead"]>[0],
  ): ArtifactHead;
  commit(input: LedgerCommitInput): LedgerCommitResult;
  recordRejection(input: LedgerRejectInput): LedgerCommitResult;
  appendEvent(event: SignedOperationEvent): LedgerCommitResult;
};

// Re-export shape for recordRejection typing without circular import noise.
type LedgerRejectInput = import("./fake-runtime-ledger.js").LedgerRejectInput;

export class FakeBackendRuntimeService implements BackendRuntimeService {
  private projects: BackendProject[];
  /** Soft-archived projects (still in registry; excluded from default list). */
  private archivedProjects: BackendProject[] = [];
  private settings: SettingsSnapshot;
  private files: Map<string, FakeVaultFile>;
  private capabilitySet: BackendCapabilitySet;
  private healthResult: BackendHealthResult;
  private readonly supportCreateProject: boolean;
  private readonly supportDeleteProject: boolean;
  private readonly supportPatchSettings: boolean;
  /** True when agent-tool cron create is allowed on this fake host. */
  readonly supportAgentCronCreate: boolean;
  /** True when settings.patch cron.create / cron.update is implemented. */
  readonly supportCronCreateUpdate: boolean;
  /** True when vault.write expansion is enabled on this fake host. */
  readonly supportWriteVault: boolean;
  /**
   * True when history/head Brain RPC expansions are enabled.
   * For durable hosts (lp-ye4.12) this is true only when the durable store
   * opened successfully.
   */
  readonly supportLedgerReads: boolean;
  /** True when crash-safe durable ledger is active under backend-owned state. */
  readonly durableLedgerEnabled: boolean;
  private readonly vaultWriteMaxInlineBytes: number;
  private readonly resolveContentRef?: FakeBackendRuntimeOptions["resolveContentRef"];
  private readonly idempotency = new Map<string, IdempotencyRecord>();
  private projectSeq = 0;
  private cronSeq = 0;
  /**
   * Append-only signed operation ledger + materialized file/workspace heads.
   * When durable is enabled this is the in-memory view of the durable store
   * (`durable.memory`); otherwise a pure in-memory harness.
   * Public for harness tests; not part of BackendRuntimeService interface.
   */
  readonly ledger: FakeRuntimeLedger;
  /** Durable store when {@link durableLedgerEnabled}; otherwise undefined. */
  readonly durable: DurableRuntimeLedger | undefined;
  private readonly hostLedger: HostLedgerSurface;

  constructor(options: FakeBackendRuntimeOptions = {}) {
    this.projects = options.projects ? [...options.projects] : [];
    this.settings = options.settings ?? {
      exported_at: "2026-07-12T00:00:00.000Z",
      source: "fake",
      backend_home: "/tmp/fake-backend-home",
      hermes_home: "/tmp/fake-backend-home",
      skills: [],
      crons: [],
      mcp_servers: [],
      models: [],
      integrations: [],
    };
    this.files = new Map(
      (options.files ?? []).map((f) => [normalizeVaultPath(f.path), { ...f, path: normalizeVaultPath(f.path) }]),
    );
    this.supportCreateProject = options.supportCreateProject !== false;
    this.supportDeleteProject = options.supportDeleteProject !== false;
    this.supportPatchSettings = options.supportPatchSettings === true;
    this.supportAgentCronCreate = options.supportAgentCronCreate !== false;
    this.supportCronCreateUpdate = options.supportCronCreateUpdate === true;
    this.supportWriteVault = options.supportWriteVault === true;
    this.vaultWriteMaxInlineBytes =
      options.vaultWriteMaxInlineBytes ?? 1_048_576;
    this.resolveContentRef = options.resolveContentRef;

    // Durable store (lp-ye4.12): open fail-closed — no history/heads advertise.
    let durable: DurableRuntimeLedger | undefined;
    if (options.durableLedger) {
      try {
        durable = DurableRuntimeLedger.open({
          ...options.ledger,
          ...options.durableLedger,
        });
      } catch {
        durable = undefined;
      }
    }
    this.durable = durable;
    this.durableLedgerEnabled = durable !== undefined;
    // Advertise history/heads when durable is up, or (offline tests only)
    // when supportLedgerReads is explicitly set without durable.
    this.supportLedgerReads =
      this.durableLedgerEnabled || options.supportLedgerReads === true;

    if (durable) {
      this.ledger = durable.memory;
      this.hostLedger = durable;
    } else {
      this.ledger = new FakeRuntimeLedger(options.ledger);
      this.hostLedger = this.ledger;
    }

    this.capabilitySet =
      options.capabilities ??
      defaultHermesLanyardCapabilities({
        source: "static_default",
        kind: "hermes_lanyard",
        features: {
          chat: true,
          health: true,
          capabilities_discovery: true,
          vault_read: true,
          vault_write: this.supportWriteVault,
          history_read: this.supportLedgerReads,
          heads_read: this.supportLedgerReads,
          settings_snapshot: true,
          settings_patch: this.supportPatchSettings,
          projects_list: true,
          projects_create: this.supportCreateProject,
          projects_delete: this.supportDeleteProject,
          models: this.supportPatchSettings,
          cron: this.supportPatchSettings,
        },
        brain_rpc_methods: [
          ...defaultHermesLanyardCapabilities().brain_rpc_methods,
          ...(this.supportPatchSettings ? (["settings.patch"] as const) : []),
          ...(this.supportCreateProject ? (["projects.create"] as const) : []),
          ...(this.supportDeleteProject ? (["projects.delete"] as const) : []),
          ...(this.supportWriteVault ? (["vault.write"] as const) : []),
          ...(this.supportLedgerReads
            ? (["history.list", "heads.artifact", "heads.workspace"] as const)
            : []),
        ],
        // Align host-asserted UI affordances with feature flags so contract
        // tests and BFF context derivation see consistent can.* gates.
        ui_affordances: {
          chat_panel: "supported",
          vault_browser: "supported",
          vault_editor: this.supportWriteVault ? "supported" : "unsupported",
          settings_page: "supported",
          settings_editor: this.supportPatchSettings
            ? "supported"
            : "unsupported",
          project_picker: "supported",
          project_create: this.supportCreateProject
            ? "supported"
            : "unsupported",
          model_selector: this.supportPatchSettings
            ? "supported"
            : "unsupported",
          cron_manager: this.supportPatchSettings
            ? "supported"
            : "unsupported",
          host_health: "supported",
        },
        limits: {
          vault_read_default_max_bytes: 1_048_576,
          vault_read_hard_max_bytes: 4_194_304,
          vault_list_max_entries: 500,
          vault_write_inline_max_bytes: this.vaultWriteMaxInlineBytes,
        },
      });
    this.healthResult = options.health ?? {
      status: "ok",
      checks: {
        vault_root_readable: true,
        backend_home_present: true,
        hermes_home_present: true,
        profiles_present: true,
        projects_db_present: true,
      },
      versions: {
        brain_rpc: 1,
        backend_artifact: "fake-0.0.0",
        hermes_artifact: "fake-0.0.0",
      },
    };
  }

  async health(ctx: BackendRuntimeContext): Promise<BackendHealthResult> {
    return {
      ...this.healthResult,
      profile: ctx.profile.name,
    };
  }

  async listProjects(
    _ctx: BackendRuntimeContext,
    params?: ListProjectsParams,
  ): Promise<ProjectsListResult> {
    const active = this.projects.map((p) => ({ ...p }));
    if (params?.includeArchived) {
      return {
        projects: [...active, ...this.archivedProjects.map((p) => ({ ...p }))],
        source: "fake",
      };
    }
    return {
      projects: active,
      source: "fake",
    };
  }

  async createProject(
    _ctx: BackendRuntimeContext,
    input: CreateProjectInput,
  ): Promise<BackendProject> {
    if (!this.supportCreateProject) {
      throw new BackendRuntimeError(
        "method_not_found",
        "projects.create is not supported by this fake",
        { retryable: false, details: { method: "projects.create" } },
      );
    }
    const name = input.name.trim();
    if (!name) {
      throw new BackendRuntimeError(
        "invalid_argument",
        "project name is required",
        { retryable: false },
      );
    }
    this.projectSeq += 1;
    const id = `proj_fake_${this.projectSeq}`;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const folders = (input.folders ?? []).map((path, i) => ({
      path,
      label: null as string | null,
      is_primary: i === 0,
    }));
    const project: BackendProject = {
      id,
      slug,
      name,
      primary_path: folders[0]?.path ?? null,
      folders,
    };
    this.projects.push(project);
    return { ...project };
  }

  /**
   * Soft-archive: remove from default projects.list; keep row for
   * includeArchived; never delete vault file bodies.
   */
  async deleteProject(
    _ctx: BackendRuntimeContext,
    input: DeleteProjectInput,
  ): Promise<DeleteProjectResult> {
    if (!this.supportDeleteProject) {
      throw new BackendRuntimeError(
        "method_not_found",
        "projects.delete is not supported by this fake",
        { retryable: false, details: { method: "projects.delete" } },
      );
    }
    const id = input.id.trim();
    if (!id) {
      throw new BackendRuntimeError(
        "invalid_argument",
        "projects.delete requires a non-empty project id",
        { retryable: false, details: { method: "projects.delete" } },
      );
    }
    const idx = this.projects.findIndex((p) => p.id === id);
    if (idx < 0) {
      // Already archived counts as success (idempotent soft-archive).
      if (this.archivedProjects.some((p) => p.id === id)) {
        return { id, archived: true };
      }
      throw new BackendRuntimeError(
        "not_found",
        `project not found: ${id}`,
        { retryable: false, details: { method: "projects.delete", id } },
      );
    }
    const [removed] = this.projects.splice(idx, 1);
    if (removed) {
      this.archivedProjects.push(removed);
    }
    // Intentionally do not touch this.files — workspace/vault stay on "disk".
    return { id, archived: true };
  }

  async settingsSnapshot(
    _ctx: BackendRuntimeContext,
    params?: SettingsSnapshotParams,
  ): Promise<SettingsSnapshot> {
    const snap = { ...this.settings };
    if (!params?.include || params.include.length === 0) {
      return structuredClone(snap);
    }
    const include = new Set(params.include);
    return {
      exported_at: snap.exported_at,
      source: snap.source,
      backend_home: snap.backend_home,
      hermes_home: snap.hermes_home,
      skills: include.has("skills") ? snap.skills : undefined,
      crons: include.has("crons") ? snap.crons : undefined,
      mcp_servers: include.has("mcp_servers") ? snap.mcp_servers : undefined,
      models: include.has("models") ? snap.models : undefined,
      integrations: include.has("integrations") ? snap.integrations : undefined,
    };
  }

  /**
   * Simulate host agent NL create (Hermes/LA `cronjob` / `/cron add`).
   *
   * Writes a durable job projected at `settings.snapshot.crons` with path
   * `cron/jobs.json` under BACKEND_HOME (never Hermes install home for LA pins).
   * Portal Settings has no Create form — create is this agent-tool path only.
   *
   * Fails clearly when product cron / agent create is disabled on the pin
   * (models the capability.cron=false / no product store failure mode).
   */
  createCronJobFromAgent(input: {
    id: string;
    name: string;
    schedule: string;
    enabled?: boolean;
    last_run_at?: string | null;
    next_run_at?: string | null;
  }): SettingsCron {
    if (!this.supportAgentCronCreate) {
      throw new BackendRuntimeError(
        "not_implemented",
        "Cron job creation is unavailable: this backend does not support scheduled jobs (capability.cron / product cron store off).",
        {
          retryable: false,
          details: {
            method: "agent.cronjob",
            features_cron: this.capabilitySet.features.cron === true,
            support_agent_cron_create: false,
          },
        },
      );
    }
    const id = input.id.trim();
    const name = input.name.trim();
    const schedule = input.schedule.trim();
    if (!id || !name || !schedule) {
      throw new BackendRuntimeError(
        "invalid_argument",
        "cronjob create requires id, name, and schedule",
        { retryable: false, details: { method: "agent.cronjob" } },
      );
    }
    const existing = this.settings.crons ?? [];
    if (existing.some((c) => c.id === id)) {
      throw new BackendRuntimeError(
        "conflict",
        `Cron job already exists: ${id}`,
        { retryable: false, details: { method: "agent.cronjob", id } },
      );
    }
    const cron: SettingsCron = {
      id,
      name,
      schedule,
      enabled: input.enabled !== false,
      // Contract-relative path under BACKEND_HOME — never absolute ~/.hermes.
      path: "cron/jobs.json",
      last_run_at: input.last_run_at ?? null,
      next_run_at: input.next_run_at ?? null,
    };
    this.settings = {
      ...this.settings,
      crons: [...existing, cron],
      exported_at: new Date().toISOString(),
    };
    return { ...cron };
  }

  async patchSettings(
    _ctx: BackendRuntimeContext,
    input: SettingsPatchInput,
  ): Promise<SettingsPatchResult> {
    if (!this.supportPatchSettings) {
      throw new BackendRuntimeError(
        "method_not_found",
        "settings.patch is not supported by this fake",
        { retryable: false, details: { method: "settings.patch" } },
      );
    }
    validateSettingsPatchAgainstConfigSchema(input);
    const source = "fake";

    switch (input.op) {
      case "skill.set_enabled": {
        const skills = [...(this.settings.skills ?? [])];
        const idx = skills.findIndex(
          (s) =>
            s.id === input.skillId ||
            s.name === input.skillId ||
            s.path === input.skillId,
        );
        if (idx < 0) {
          throw new BackendRuntimeError(
            "not_found",
            `Skill not found: ${input.skillId}`,
            { retryable: false, details: { method: "settings.patch" } },
          );
        }
        const skill = { ...skills[idx]!, enabled: input.enabled };
        skills[idx] = skill;
        this.settings = { ...this.settings, skills };
        return { op: input.op, source, skill };
      }
      case "cron.set_enabled": {
        const crons = [...(this.settings.crons ?? [])];
        const idx = crons.findIndex((c) => c.id === input.cronId);
        if (idx < 0) {
          throw new BackendRuntimeError(
            "not_found",
            `Cron not found: ${input.cronId}`,
            { retryable: false, details: { method: "settings.patch" } },
          );
        }
        const cron = { ...crons[idx]!, enabled: input.enabled };
        crons[idx] = cron;
        this.settings = { ...this.settings, crons };
        return { op: input.op, source, cron };
      }
      case "cron.create": {
        if (!this.supportCronCreateUpdate) {
          throw new BackendRuntimeError(
            "not_implemented",
            "Scheduled task create is unavailable: this backend does not advertise full cron create/update (features.cron / cron.patch).",
            {
              retryable: false,
              details: {
                method: "settings.patch",
                op: "cron.create",
                support_cron_create_update: false,
              },
            },
          );
        }
        const existing = this.settings.crons ?? [];
        this.cronSeq += 1;
        const id =
          input.cronId?.trim() ||
          `st-${Date.now().toString(36)}-${this.cronSeq}`;
        if (existing.some((c) => c.id === id)) {
          throw new BackendRuntimeError(
            "conflict",
            `Cron job already exists: ${id}`,
            {
              retryable: false,
              details: { method: "settings.patch", op: "cron.create", id },
            },
          );
        }
        const schedule = normalizeFakeCronSchedule(input.schedule);
        const cron: SettingsCron = {
          id,
          name: input.name.trim(),
          enabled: input.enabled !== false,
          path: "cron/jobs.json",
          prompt: input.prompt.trim(),
          schedule,
          skills: input.skills ? [...input.skills] : undefined,
          state: input.enabled === false ? "paused" : "scheduled",
          last_run_at: null,
          next_run_at: null,
          last_status: null,
        };
        this.settings = {
          ...this.settings,
          crons: [...existing, cron],
          exported_at: new Date().toISOString(),
        };
        return { op: input.op, source, cron: { ...cron } };
      }
      case "cron.update": {
        if (!this.supportCronCreateUpdate) {
          throw new BackendRuntimeError(
            "not_implemented",
            "Scheduled task update is unavailable: this backend does not advertise full cron create/update (features.cron / cron.patch).",
            {
              retryable: false,
              details: {
                method: "settings.patch",
                op: "cron.update",
                support_cron_create_update: false,
              },
            },
          );
        }
        const crons = [...(this.settings.crons ?? [])];
        const idx = crons.findIndex((c) => c.id === input.cronId);
        if (idx < 0) {
          throw new BackendRuntimeError(
            "not_found",
            `Cron not found: ${input.cronId}`,
            {
              retryable: false,
              details: { method: "settings.patch", op: "cron.update" },
            },
          );
        }
        const prev = crons[idx]!;
        const next: SettingsCron = { ...prev };
        if (input.name !== undefined) next.name = input.name.trim();
        if (input.prompt !== undefined) next.prompt = input.prompt.trim();
        if (input.schedule !== undefined) {
          next.schedule = normalizeFakeCronSchedule(input.schedule);
        }
        if (input.enabled !== undefined) {
          next.enabled = input.enabled;
          if (input.enabled === false && next.state === "scheduled") {
            next.state = "paused";
          } else if (input.enabled === true && next.state === "paused") {
            next.state = "scheduled";
          }
        }
        if (input.skills !== undefined) next.skills = [...input.skills];
        if (!next.path) next.path = "cron/jobs.json";
        crons[idx] = next;
        this.settings = {
          ...this.settings,
          crons,
          exported_at: new Date().toISOString(),
        };
        return { op: input.op, source, cron: { ...next } };
      }
      case "mcp.set_enabled": {
        const servers = [...(this.settings.mcp_servers ?? [])];
        const idx = servers.findIndex((s) => s.name === input.mcpName);
        if (idx < 0) {
          throw new BackendRuntimeError(
            "not_found",
            `MCP server not found: ${input.mcpName}`,
            { retryable: false, details: { method: "settings.patch" } },
          );
        }
        const mcp = { ...servers[idx]!, enabled: input.enabled };
        servers[idx] = mcp;
        this.settings = { ...this.settings, mcp_servers: servers };
        return { op: input.op, source, mcp };
      }
      case "model.set_active": {
        const models = [...(this.settings.models ?? [])];
        const idx = models.findIndex(
          (m) => m.provider === input.provider && m.model === input.model,
        );
        if (idx < 0) {
          throw new BackendRuntimeError(
            "not_found",
            `Model not found: ${input.provider}/${input.model}`,
            { retryable: false, details: { method: "settings.patch" } },
          );
        }
        const updated = models.map((m, i) => ({
          ...m,
          is_active: i === idx,
        }));
        const model = { ...updated[idx]! };
        this.settings = { ...this.settings, models: updated };
        return { op: input.op, source, model };
      }
    }
  }

  async listVault(
    ctx: BackendRuntimeContext,
    params?: VaultListParams,
  ): Promise<VaultListResult> {
    const path = normalizeVaultPath(params?.path ?? "/");
    this.assertPathAccess(ctx, path);

    const childNames = new Set<string>();
    const entries: VaultEntry[] = [];

    // Directories: unique first segments under path
    for (const filePath of this.files.keys()) {
      if (filePath === path) continue;
      if (path === "/") {
        if (!filePath.startsWith("/")) continue;
        const rest = filePath.slice(1);
        const segment = rest.split("/")[0];
        if (!segment) continue;
        childNames.add(segment);
      } else if (filePath.startsWith(`${path}/`)) {
        const rest = filePath.slice(path.length + 1);
        const segment = rest.split("/")[0];
        if (!segment) continue;
        childNames.add(segment);
      }
    }

    for (const name of [...childNames].sort()) {
      const childPath = path === "/" ? `/${name}` : `${path}/${name}`;
      if (!pathAllowed(ctx.profile.pathPrefixes, childPath) && !pathAllowed(ctx.profile.pathPrefixes, path)) {
        // still show if parent allowed; filter leaf
        if (!pathAllowed(ctx.profile.pathPrefixes, childPath)) continue;
      }
      const isFile = this.files.has(childPath);
      if (isFile) {
        const f = this.files.get(childPath)!;
        entries.push({
          name,
          path: childPath,
          kind: "file",
          mime_type: f.mime_type ?? "text/plain",
          size_bytes: Buffer.byteLength(f.content, f.encoding === "base64" ? "base64" : "utf8"),
          mtime: f.mtime ?? null,
        });
      } else {
        entries.push({
          name,
          path: childPath,
          kind: "directory",
          mime_type: null,
          size_bytes: null,
          mtime: null,
        });
      }
    }

    const limit = params?.limit ?? 200;
    const truncated = entries.length > limit;
    const page = entries.slice(0, limit);
    return {
      path,
      entries: page,
      next_cursor: truncated ? String(limit) : null,
      truncated,
    };
  }

  async statVault(
    ctx: BackendRuntimeContext,
    params: VaultStatParams,
  ): Promise<VaultEntry> {
    const path = normalizeVaultPath(params.path);
    this.assertPathAccess(ctx, path);

    if (this.files.has(path)) {
      const f = this.files.get(path)!;
      return {
        name: basename(path),
        path,
        kind: "file",
        mime_type: f.mime_type ?? "text/plain",
        size_bytes: Buffer.byteLength(f.content, f.encoding === "base64" ? "base64" : "utf8"),
        mtime: f.mtime ?? null,
      };
    }

    // Directory if any file lives under it
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(`${path}/`) || (path === "/" && filePath !== "/")) {
        return {
          name: basename(path),
          path,
          kind: "directory",
          mime_type: null,
          size_bytes: null,
          mtime: null,
        };
      }
    }

    throw new BackendRuntimeError("not_found", `Vault path not found: ${path}`, {
      details: { path },
      retryable: false,
    });
  }

  async readVault(
    ctx: BackendRuntimeContext,
    params: VaultReadParams,
  ): Promise<VaultReadResult> {
    const path = normalizeVaultPath(params.path);
    this.assertPathAccess(ctx, path);

    const file = this.files.get(path);
    if (!file) {
      // If path is a directory, invalid_argument per contract
      for (const filePath of this.files.keys()) {
        if (filePath.startsWith(`${path}/`)) {
          throw new BackendRuntimeError(
            "invalid_argument",
            `Cannot read directory: ${path}`,
            { details: { path }, retryable: false },
          );
        }
      }
      throw new BackendRuntimeError("not_found", `Vault file not found: ${path}`, {
        details: { path },
        retryable: false,
      });
    }

    const encoding = file.encoding ?? "utf-8";
    const size = Buffer.byteLength(file.content, encoding === "base64" ? "base64" : "utf8");
    const max = params.maxBytes ?? 1_048_576;
    if (size > max) {
      throw new BackendRuntimeError(
        "payload_too_large",
        `File exceeds max_bytes (${max})`,
        {
          details: { path, size_bytes: size, max_bytes: max },
          retryable: false,
        },
      );
    }

    return {
      path,
      kind: "file",
      mime_type: file.mime_type ?? "text/plain",
      encoding,
      content: file.content,
      size_bytes: size,
    };
  }

  async writeVault(
    ctx: BackendRuntimeContext,
    params: VaultWriteParams,
  ): Promise<VaultWriteResult> {
    if (!this.supportWriteVault) {
      throw new BackendRuntimeError(
        "method_not_found",
        "vault.write is not supported by this fake",
        { retryable: false, details: { method: "vault.write" } },
      );
    }

    const path = normalizeVaultPath(params.path);
    this.assertPathAccess(ctx, path);

    // write_checkpoint: ACL + validate source_path without mutating it.
    let sourcePath: string | undefined;
    if (params.mode === "write_checkpoint") {
      if (!params.sourcePath) {
        throw new BackendRuntimeError(
          "invalid_argument",
          "vault.write write_checkpoint requires source_path",
          {
            retryable: false,
            details: { path, method: "vault.write" },
          },
        );
      }
      sourcePath = normalizeVaultPath(params.sourcePath);
      this.assertPathAccess(ctx, sourcePath);
      if (sourcePath === path) {
        throw new BackendRuntimeError(
          "invalid_argument",
          "vault.write write_checkpoint source_path must differ from path",
          {
            retryable: false,
            details: {
              path,
              method: "vault.write",
              source_path: sourcePath,
            },
          },
        );
      }
    }

    // Directories cannot be written as files.
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(`${path}/`)) {
        throw new BackendRuntimeError(
          "invalid_argument",
          `Cannot write directory path: ${path}`,
          { details: { path, method: "vault.write" }, retryable: false },
        );
      }
    }

    const { content, encoding } = this.resolveWriteBody(params);
    const size = Buffer.byteLength(
      content,
      encoding === "base64" ? "base64" : "utf8",
    );
    if (size !== params.sizeBytes) {
      throw new BackendRuntimeError(
        "invalid_argument",
        `size_bytes (${params.sizeBytes}) does not match body length (${size})`,
        {
          details: {
            path,
            method: "vault.write",
            size_bytes: size,
          },
          retryable: false,
        },
      );
    }
    if (params.content !== undefined && size > this.vaultWriteMaxInlineBytes) {
      throw new BackendRuntimeError(
        "payload_too_large",
        `File exceeds vault write max_bytes (${this.vaultWriteMaxInlineBytes})`,
        {
          details: {
            path,
            method: "vault.write",
            size_bytes: size,
            max_bytes: this.vaultWriteMaxInlineBytes,
          },
          retryable: false,
        },
      );
    }

    const fingerprint = this.writeFingerprint(params, content, encoding);
    const prior = this.idempotency.get(params.idempotencyKey);
    if (prior) {
      if (prior.fingerprint === fingerprint) {
        return { ...prior.result, idempotent_replay: true };
      }
      throw new BackendRuntimeError(
        "conflict",
        "idempotency_key reused with different body fingerprint",
        {
          retryable: false,
          details: {
            path,
            method: "vault.write",
            reason: "idempotency_key_conflict",
          },
        },
      );
    }

    const exists = this.files.has(path);
    const currentRevision = exists
      ? this.revisionForFile(this.files.get(path)!)
      : null;
    const actor = this.actorFromContext(ctx);
    const bodyHash = bodyHashFromContent(content, encoding);

    // Snapshot canonical source revision before any write (must not advance).
    const sourceBefore =
      sourcePath && this.files.has(sourcePath)
        ? this.revisionForFile(this.files.get(sourcePath)!)
        : null;

    switch (params.mode) {
      case "create_new": {
        if (exists) {
          this.recordVaultWriteConflict({
            actor,
            path,
            reason: "path_exists",
            vaultWriteMode: params.mode,
            actualRevision: currentRevision ?? undefined,
            bodyHash,
            message: `Path already exists: ${path}`,
          });
          throw new BackendRuntimeError(
            "conflict",
            `Path already exists: ${path}`,
            {
              retryable: false,
              details: {
                path,
                method: "vault.write",
                reason: "path_exists",
                actual_revision_token: currentRevision?.token,
              },
            },
          );
        }
        break;
      }
      case "replace_if_absent": {
        if (exists) {
          this.recordVaultWriteConflict({
            actor,
            path,
            reason: "path_exists",
            vaultWriteMode: params.mode,
            actualRevision: currentRevision ?? undefined,
            bodyHash,
            message: `Path already exists (replace_if_absent): ${path}`,
          });
          throw new BackendRuntimeError(
            "conflict",
            `Path already exists (replace_if_absent): ${path}`,
            {
              retryable: false,
              details: {
                path,
                method: "vault.write",
                reason: "path_exists",
                actual_revision_token: currentRevision?.token,
              },
            },
          );
        }
        break;
      }
      case "replace_if_match": {
        if (!exists || !currentRevision) {
          this.recordVaultWriteConflict({
            actor,
            path,
            reason: "path_missing",
            vaultWriteMode: params.mode,
            bodyHash,
            message: `Vault file not found for replace_if_match: ${path}`,
          });
          throw new BackendRuntimeError(
            "not_found",
            `Vault file not found for replace_if_match: ${path}`,
            {
              details: {
                path,
                method: "vault.write",
                reason: "path_missing",
              },
              retryable: false,
            },
          );
        }
        const expectedToken =
          params.expectedRevision?.token ?? params.ifMatch ?? "";
        if (
          !expectedToken ||
          !timingSafeEqualTokens(expectedToken, currentRevision.token)
        ) {
          const expectedRevision: DocumentRevision | undefined = expectedToken
            ? params.expectedRevision ?? {
                token: expectedToken,
                kind: "content_hash",
              }
            : undefined;
          this.recordVaultWriteConflict({
            actor,
            path,
            reason: "revision_mismatch",
            vaultWriteMode: params.mode,
            expectedRevision,
            actualRevision: currentRevision,
            bodyHash,
            message: `revision_mismatch for ${path}`,
          });
          throw new BackendRuntimeError(
            "conflict",
            `revision_mismatch for ${path}`,
            {
              retryable: false,
              details: {
                path,
                method: "vault.write",
                reason: "revision_mismatch",
                expected_revision_token: expectedToken,
                actual_revision_token: currentRevision.token,
              },
            },
          );
        }
        break;
      }
      case "write_checkpoint": {
        // Destination uses create_new semantics: never overwrite existing
        // checkpoint path; never touch canonical source_path (lp-ye4.10).
        if (exists) {
          this.recordVaultWriteConflict({
            actor,
            path,
            sourcePath,
            reason: "path_exists",
            vaultWriteMode: params.mode,
            actualRevision: currentRevision ?? undefined,
            bodyHash,
            message: `Checkpoint path already exists: ${path}`,
          });
          throw new BackendRuntimeError(
            "conflict",
            `Checkpoint path already exists: ${path}`,
            {
              retryable: false,
              details: {
                path,
                method: "vault.write",
                reason: "path_exists",
                actual_revision_token: currentRevision?.token,
              },
            },
          );
        }
        break;
      }
      default: {
        // Exhaustiveness: all VaultWriteMode variants handled above.
        const unknownMode: string = String(
          (params as { mode?: string }).mode ?? "undefined",
        );
        throw new BackendRuntimeError(
          "invalid_argument",
          `Unknown write mode: ${unknownMode}`,
          { retryable: false, details: { method: "vault.write" } },
        );
      }
    }

    const mime =
      params.mimeType ??
      (exists ? this.files.get(path)?.mime_type : undefined) ??
      "application/octet-stream";
    const writtenAt = new Date().toISOString();
    const token = contentHashToken(content, encoding);
    const revision: DocumentRevision = {
      token,
      kind: "content_hash",
      size_bytes: size,
      modified_at: writtenAt,
    };

    this.files.set(path, {
      path,
      content,
      encoding,
      mime_type: mime,
      mtime: writtenAt,
      revision_token: token,
    });

    // Invariant: write_checkpoint must not advance the canonical source path.
    if (sourcePath) {
      const sourceAfter = this.files.has(sourcePath)
        ? this.revisionForFile(this.files.get(sourcePath)!)
        : null;
      if (
        (sourceBefore?.token ?? null) !== (sourceAfter?.token ?? null) ||
        (sourceBefore === null) !== (sourceAfter === null)
      ) {
        // Should be unreachable — defense for future edits.
        throw new BackendRuntimeError(
          "internal",
          "write_checkpoint advanced source_path revision (fake invariant)",
          {
            retryable: false,
            details: {
              path,
              method: "vault.write",
              source_path: sourcePath,
            },
          },
        );
      }
    }

    const created = !exists;
    let writeKind: VaultWriteResult["write_kind"];
    if (params.mode === "write_checkpoint") {
      writeKind = "checkpoint";
    } else if (
      params.mode === "create_new" ||
      params.mode === "replace_if_absent"
    ) {
      writeKind = "create";
    } else if (params.mode === "replace_if_match") {
      writeKind = "replace";
    }

    // lp-ye4.8: append authoritative ledger event + return commit metadata.
    const commit = this.commitVaultWriteToLedger({
      actor,
      params,
      path,
      sourcePath,
      revision,
      created,
      bodyHash,
      priorRevision: exists ? currentRevision : null,
      occurredAt: writtenAt,
    });

    const result: VaultWriteResult = {
      path,
      revision,
      etag: token,
      size_bytes: size,
      mime_type: mime,
      written_at: writtenAt,
      created,
      idempotent_replay: false,
      ...(writeKind ? { write_kind: writeKind } : {}),
      ...(params.mode === "write_checkpoint" && sourcePath
        ? { source_path: sourcePath }
        : {}),
      commit,
    };
    this.idempotency.set(params.idempotencyKey, { fingerprint, result });
    return { ...result };
  }

  async capabilities(
    _ctx: BackendRuntimeContext,
  ): Promise<BackendCapabilitySet> {
    return structuredClone(this.capabilitySet);
  }

  /** Test helper: seed or replace a vault file. */
  putFile(file: FakeVaultFile): void {
    const path = normalizeVaultPath(file.path);
    this.files.set(path, { ...file, path });
  }

  /** Test helper: current content-hash revision for a path (if present). */
  getFileRevision(path: string): DocumentRevision | null {
    const file = this.files.get(normalizeVaultPath(path));
    if (!file) return null;
    return this.revisionForFile(file);
  }

  /** Test helper: replace project list. */
  setProjects(projects: BackendProject[]): void {
    this.projects = [...projects];
  }

  // ---------------------------------------------------------------------------
  // History / heads Brain RPC expansions (lp-ye4.7)
  // ---------------------------------------------------------------------------

  async listHistory(
    ctx: BackendRuntimeContext,
    params: HistoryListParams,
  ): Promise<HistoryListResult> {
    if (!this.supportLedgerReads) {
      throw new BackendRuntimeError(
        "method_not_found",
        "history.list is not implemented by this fake host",
        { retryable: false, details: { method: "history.list" } },
      );
    }
    const path = normalizeVaultPath(params.path);
    this.assertPathAccess(ctx, path);
    const includeRejected = params.includeRejected !== false;
    const limit =
      typeof params.limit === "number" && Number.isFinite(params.limit)
        ? Math.min(200, Math.max(1, Math.trunc(params.limit)))
        : 50;

    let events = this.hostLedger.listEvents().filter((ev) => {
      const tpath = ev.target?.path;
      if (typeof tpath !== "string") return false;
      const normalized = normalizeVaultPath(tpath);
      if (normalized !== path) {
        // Include checkpoint events whose source_path is the canonical path.
        const src = ev.target?.source_path;
        if (typeof src !== "string" || normalizeVaultPath(src) !== path) {
          return false;
        }
      }
      if (!includeRejected && ev.result?.status === "rejected") {
        return false;
      }
      // ACL: only events for allowed paths (defense in depth).
      if (!pathAllowed(ctx.profile.pathPrefixes, normalized)) {
        return false;
      }
      return true;
    });

    // cursor = last operation_id from previous page (exclusive start after it)
    if (typeof params.cursor === "string" && params.cursor.length > 0) {
      const idx = events.findIndex((e) => e.operation_id === params.cursor);
      if (idx >= 0) {
        events = events.slice(idx + 1);
      }
    }

    const page = events.slice(0, limit);
    const truncated = events.length > limit;
    return {
      path,
      events: page,
      next_cursor: truncated
        ? page.length > 0
          ? page[page.length - 1]!.operation_id
          : null
        : null,
      truncated,
    };
  }

  async readArtifactHead(
    ctx: BackendRuntimeContext,
    params: HeadsArtifactParams,
  ): Promise<HeadsArtifactResult> {
    if (!this.supportLedgerReads) {
      throw new BackendRuntimeError(
        "method_not_found",
        "heads.artifact is not implemented by this fake host",
        { retryable: false, details: { method: "heads.artifact" } },
      );
    }
    const path = normalizeVaultPath(params.path);
    this.assertPathAccess(ctx, path);
    const head = this.hostLedger.getArtifactHead(path);
    if (!head) {
      throw new BackendRuntimeError(
        "not_found",
        `No artifact head for path: ${path}`,
        { retryable: false, details: { method: "heads.artifact", path } },
      );
    }
    return head;
  }

  async readWorkspaceHead(
    ctx: BackendRuntimeContext,
    params?: HeadsWorkspaceParams,
  ): Promise<HeadsWorkspaceResult> {
    if (!this.supportLedgerReads) {
      throw new BackendRuntimeError(
        "method_not_found",
        "heads.workspace is not implemented by this fake host",
        { retryable: false, details: { method: "heads.workspace" } },
      );
    }
    void ctx;
    const head = this.hostLedger.getWorkspaceHead(params?.workspaceId);
    if (!head) {
      throw new BackendRuntimeError(
        "not_found",
        `No workspace head for workspace: ${params?.workspaceId ?? "default"}`,
        { retryable: false, details: { method: "heads.workspace" } },
      );
    }
    return head;
  }

  // ---------------------------------------------------------------------------
  // Signed operation ledger harness (lp-ye4.6) — offline currentness only
  // ---------------------------------------------------------------------------

  /** Append-only ledger events (oldest → newest). */
  listLedgerEvents(): SignedOperationEvent[] {
    return this.hostLedger.listEvents();
  }

  getArtifactHead(path: string): ArtifactHead | undefined {
    return this.hostLedger.getArtifactHead(path);
  }

  listArtifactHeads(): ArtifactHead[] {
    return this.hostLedger.listArtifactHeads();
  }

  getWorkspaceHead(workspaceId?: string): WorkspaceHead | undefined {
    return this.hostLedger.getWorkspaceHead(workspaceId);
  }

  /**
   * Commit (or CAS-reject) a ledger mutation fixture.
   * Does not mutate vault file bodies — use writeVault for bytes + automatic
   * ledger append (lp-ye4.8). This path materializes heads only.
   */
  commitLedgerMutation(input: LedgerCommitInput): LedgerCommitResult {
    this.assertHostObservedActor(input.actor);
    return this.hostLedger.commit(input);
  }

  /**
   * Append a pre-built signed operation (contract fixtures) and materialize
   * heads when the event advances them.
   *
   * Durable hosts (lp-ye4.12) **re-sign** with the host key — client/browser
   * signatures are never accepted as authority.
   */
  appendLedgerEvent(event: SignedOperationEvent): LedgerCommitResult {
    this.assertHostObservedActor(event.actor);
    return this.hostLedger.appendEvent(event);
  }

  /**
   * Map BackendRuntimeContext → safe ledger actor (no secrets / ACL claims).
   * Prefer BFF-stamped actor from a validated access grant (lp-ye4.9);
   * fall back to human session subject when no actor was stamped.
   *
   * Durable hosts reject empty/forged subject claims (lp-ye4.12).
   */
  private actorFromContext(ctx: BackendRuntimeContext): OperationActor {
    if (ctx.actor) {
      // Copy only safe provenance fields — never trust extra bags.
      if (!ctx.actor.subject_id || ctx.actor.subject_id.trim() === "") {
        throw new BackendRuntimeError(
          "invalid_argument",
          "forged or empty actor.subject_id rejected by host",
          {
            retryable: false,
            details: { reason: "forged_actor_claim", method: "vault.write" },
          },
        );
      }
      if (
        ctx.actor.kind === "delegated_agent" &&
        this.durableLedgerEnabled &&
        !(ctx.actor.grant_id ?? ctx.grantId)
      ) {
        throw new BackendRuntimeError(
          "forbidden",
          "delegated_agent actor requires host-validated grant_id",
          {
            retryable: false,
            details: { reason: "forged_actor_claim", method: "vault.write" },
          },
        );
      }
      const actor: OperationActor = {
        kind: ctx.actor.kind,
        subject_id: ctx.actor.subject_id,
      };
      if (ctx.actor.display_name !== undefined) {
        actor.display_name = ctx.actor.display_name;
      }
      if (ctx.actor.portal_user_id !== undefined) {
        actor.portal_user_id = ctx.actor.portal_user_id;
      }
      if (ctx.actor.agent_id !== undefined) {
        actor.agent_id = ctx.actor.agent_id;
      }
      if (ctx.actor.run_id !== undefined) {
        actor.run_id = ctx.actor.run_id;
      }
      if (ctx.actor.session_id !== undefined) {
        actor.session_id = ctx.actor.session_id;
      } else if (ctx.sessionId) {
        actor.session_id = ctx.sessionId;
      }
      if (ctx.actor.backend_profile !== undefined) {
        actor.backend_profile = ctx.actor.backend_profile;
      } else if (ctx.profile?.name) {
        actor.backend_profile = ctx.profile.name;
      }
      const grantId = ctx.actor.grant_id ?? ctx.grantId;
      if (grantId !== undefined) actor.grant_id = grantId;
      return actor;
    }
    if (this.durableLedgerEnabled && (!ctx.userId || ctx.userId.trim() === "")) {
      throw new BackendRuntimeError(
        "unauthenticated",
        "durable host requires stamped actor or session subject",
        {
          retryable: false,
          details: { reason: "forged_actor_claim", method: "vault.write" },
        },
      );
    }
    return {
      kind: "human",
      subject_id: ctx.userId,
      portal_user_id: ctx.userId,
      session_id: ctx.sessionId,
      backend_profile: ctx.profile.name,
      ...(ctx.grantId ? { grant_id: ctx.grantId } : {}),
    };
  }

  /**
   * Host-observed actor gate (lp-ye4.12): reject empty subjects and
   * delegated_agent without grant_id on the durable path. Never accepts
   * browser-forged signature authority (signing is always host-side).
   */
  private assertHostObservedActor(actor: OperationActor): void {
    if (!actor?.subject_id || actor.subject_id.trim() === "") {
      throw new BackendRuntimeError(
        "invalid_argument",
        "forged or empty actor.subject_id rejected by host",
        {
          retryable: false,
          details: { reason: "forged_actor_claim" },
        },
      );
    }
    if (
      this.durableLedgerEnabled &&
      actor.kind === "delegated_agent" &&
      !actor.grant_id
    ) {
      throw new BackendRuntimeError(
        "forbidden",
        "delegated_agent requires host-validated grant_id; forged actor claim rejected",
        {
          retryable: false,
          details: { reason: "forged_actor_claim" },
        },
      );
    }
  }

  /**
   * Record vault.write conflict on the ledger without advancing heads
   * (lp-ye4.8). Failures here must not mask the vault conflict response.
   */
  private recordVaultWriteConflict(input: {
    actor: OperationActor;
    path: string;
    sourcePath?: string;
    reason:
      | "revision_mismatch"
      | "path_exists"
      | "path_missing"
      | "human_edit_active"
      | "forbidden"
      | "other";
    vaultWriteMode: VaultWriteParams["mode"];
    expectedRevision?: DocumentRevision;
    actualRevision?: DocumentRevision;
    bodyHash?: ReturnType<typeof bodyHashFromContent>;
    message?: string;
  }): void {
    try {
      this.hostLedger.recordRejection({
        actor: input.actor,
        path: input.path,
        sourcePath: input.sourcePath,
        reason: input.reason,
        vaultWriteMode: input.vaultWriteMode,
        expectedRevision: input.expectedRevision,
        actualRevision: input.actualRevision,
        bodyHash: input.bodyHash,
        message: input.message,
      });
    } catch {
      // Ledger is best-effort for offline conflict history; vault error wins.
    }
  }

  /**
   * After a durable vault.write file commit, append the ledger event and
   * build optional result.commit metadata (lp-ye4.8).
   */
  private commitVaultWriteToLedger(input: {
    actor: OperationActor;
    params: VaultWriteParams;
    path: string;
    sourcePath?: string;
    revision: DocumentRevision;
    created: boolean;
    bodyHash: ReturnType<typeof bodyHashFromContent>;
    priorRevision: DocumentRevision | null;
    occurredAt: string;
  }): VaultWriteCommitMetadata {
    const kind = vaultWriteModeToOperationKind(input.params.mode, {
      created: input.created,
    });
    const mutationKind = kind as LedgerMutationKind;

    // replace_if_match after putFile may lack a ledger head — seed from the
    // CAS base so file_replace does not reject as path_missing.
    if (
      mutationKind === "file_replace" &&
      input.priorRevision &&
      !this.hostLedger.getArtifactHead(input.path)
    ) {
      this.hostLedger.seedArtifactHead({
        path: input.path,
        revision: input.priorRevision,
        recomputeWorkspace: true,
      });
    }

    const expectedRevision =
      input.params.mode === "replace_if_match"
        ? input.params.expectedRevision ??
          (input.params.ifMatch
            ? {
                token: input.params.ifMatch,
                kind: "content_hash" as const,
              }
            : input.priorRevision ?? undefined)
        : undefined;

    this.assertHostObservedActor(input.actor);
    const ledgerResult = this.hostLedger.commit({
      kind: mutationKind,
      actor: input.actor,
      path: input.path,
      sourcePath: input.sourcePath,
      revision: input.revision,
      bodyHash: input.bodyHash,
      expectedRevision,
      idempotencyKey: input.params.idempotencyKey,
      vaultWriteMode: input.params.mode,
      occurredAt: input.occurredAt,
    });

    if (ledgerResult.event.result.status !== "committed") {
      // File store already committed; ledger must not diverge on success path.
      throw new BackendRuntimeError(
        "internal",
        `vault.write ledger commit rejected after durable write: ${ledgerResult.event.result.reason}`,
        {
          retryable: false,
          details: {
            path: input.path,
            method: "vault.write",
            reason: ledgerResult.event.result.reason,
          },
        },
      );
    }

    return {
      operation_id: ledgerResult.event.operation_id,
      kind,
      ...(ledgerResult.workspaceHead
        ? {
            workspace_id: ledgerResult.workspaceHead.workspace_id,
            tree_root_hash: ledgerResult.workspaceHead.tree_root_hash,
          }
        : {}),
      advances_artifact_head:
        ledgerResult.event.advances_artifact_head === true,
      advances_workspace_head:
        ledgerResult.event.advances_workspace_head === true,
    };
  }

  private resolveWriteBody(params: VaultWriteParams): {
    content: string;
    encoding: "utf-8" | "base64";
  } {
    if (params.content !== undefined) {
      return {
        content: params.content,
        encoding: params.encoding ?? "utf-8",
      };
    }
    if (params.contentRef) {
      const resolved = this.resolveContentRef?.(params.contentRef) ?? null;
      if (!resolved) {
        throw new BackendRuntimeError(
          "not_found",
          `content_ref not found: ${params.contentRef.kind}:${params.contentRef.id}`,
          {
            retryable: false,
            details: { method: "vault.write", path: params.path },
          },
        );
      }
      return resolved;
    }
    throw new BackendRuntimeError(
      "invalid_argument",
      "vault.write requires content or content_ref",
      { retryable: false, details: { method: "vault.write" } },
    );
  }

  private revisionForFile(file: FakeVaultFile): DocumentRevision {
    const encoding = file.encoding ?? "utf-8";
    const token =
      file.revision_token ?? contentHashToken(file.content, encoding);
    const size = Buffer.byteLength(
      file.content,
      encoding === "base64" ? "base64" : "utf8",
    );
    return {
      token,
      kind: "content_hash",
      size_bytes: size,
      modified_at: file.mtime ?? undefined,
    };
  }

  private writeFingerprint(
    params: VaultWriteParams,
    content: string,
    encoding: "utf-8" | "base64",
  ): string {
    return createHash("sha256")
      .update(
        [
          params.path,
          params.mode,
          params.mode === "write_checkpoint" ? (params.sourcePath ?? "") : "",
          encoding,
          content,
          String(params.sizeBytes),
          params.mimeType ?? "",
          params.contentRef
            ? `${params.contentRef.kind}:${params.contentRef.id}`
            : "",
        ].join("\0"),
      )
      .digest("hex");
  }

  private assertPathAccess(ctx: BackendRuntimeContext, path: string): void {
    const prefixes = ctx.profile.pathPrefixes;
    if (prefixes.length === 0) return;
    if (!pathAllowed(prefixes, path)) {
      throw new BackendRuntimeError(
        "forbidden",
        `Vault path not allowed: ${path}`,
        { details: { path, method: "vault.write" }, retryable: false },
      );
    }
  }
}

function contentHashToken(
  content: string,
  encoding: "utf-8" | "base64",
): string {
  const buf = Buffer.from(content, encoding === "base64" ? "base64" : "utf8");
  return `sha256:${createHash("sha256").update(buf).digest("hex")}`;
}

/** Constant-time-ish string compare for CAS tokens (length must match). */
function timingSafeEqualTokens(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function createFakeBackendRuntimeService(
  options: FakeBackendRuntimeOptions = {},
): BackendRuntimeService {
  return new FakeBackendRuntimeService(options);
}

/**
 * Canonical LA runtime home for offline fixtures (lp-uxy.3).
 * Product cron + Brain RPC settings.snapshot must share this tree —
 * never Hermes install home (`~/.hermes`).
 */
export const LANYARD_AGENT_FIXTURE_BACKEND_HOME =
  "/var/lib/lanyard-agent" as const;

/** Seed jobs projected as settings.snapshot.crons for LA pin tests. */
export const LANYARD_AGENT_FIXTURE_CRONS = [
  {
    id: "la-vault-index",
    name: "LA vault index refresh",
    schedule: "Daily at 3:00 AM",
    enabled: true,
    path: "cron/jobs.json",
    last_run_at: "2026-08-04T03:00:11.000Z",
    next_run_at: "2026-08-05T03:00:00.000Z",
    state: "scheduled",
    last_status: "ok",
  },
  {
    id: "la-weekly-digest",
    name: "LA weekly digest",
    schedule: "Weekly on Monday at 9:00 AM",
    enabled: false,
    path: "cron/jobs.json",
    last_run_at: null as string | null,
    next_run_at: null as string | null,
    state: "paused",
    last_status: null as string | null,
  },
  {
    id: "la-manual-start",
    name: "LA manual start example",
    schedule: "One-shot (manual start)",
    enabled: true,
    path: "cron/jobs.json",
    last_run_at: "2026-08-04T15:00:01.000Z",
    next_run_at: null as string | null,
    /** lp-su0: running indicator for start-job UI path */
    state: "running",
    last_status: null as string | null,
  },
] as const;

export type LanyardAgentFakeBackendOptions = {
  /**
   * When true (default), advertise settings.patch + implement cron.set_enabled.
   * Portal can list/toggle via settings.snapshot + settings.patch even if
   * features.cron stays false (honest until cron.list/cron.patch ship).
   */
  supportPatchSettings?: boolean;
  /**
   * When true, also advertise dedicated cron.list/cron.patch and features.cron.
   * Enables settings.patch cron.create/cron.update (lp-jzl.3).
   * Default false — matches current LA honesty (capabilities.lanyard-agent.json).
   */
  advertiseDedicatedCronRpcs?: boolean;
  /**
   * When true (default), agent NL create (`cronjob`) writes durable jobs under
   * LA BACKEND_HOME. Set false to exercise clear failure when cron is off.
   */
  supportAgentCronCreate?: boolean;
  /**
   * Override for full job create/update via settings.patch.
   * Defaults to true when advertiseDedicatedCronRpcs is true.
   */
  supportCronCreateUpdate?: boolean;
  /** Override seed settings; defaults to LA home + fixture crons. */
  settings?: SettingsSnapshot;
  capabilities?: BackendCapabilitySet;
};

/**
 * Fake backend pin for `kind: lanyard_agent` cron Settings path (lp-uxy.3).
 *
 * - Jobs live under `$BACKEND_HOME/cron/jobs.json` (contract layout)
 * - `backend_home` is LA state root, never `~/.hermes`
 * - Capability flags stay honest: features.cron only when dedicated cron RPCs
 *   are advertised; settings.patch alone still enables cron toggles
 */
export function createLanyardAgentFakeBackendRuntimeService(
  options: LanyardAgentFakeBackendOptions = {},
): FakeBackendRuntimeService {
  const supportPatchSettings = options.supportPatchSettings !== false;
  const advertiseDedicatedCronRpcs = options.advertiseDedicatedCronRpcs === true;
  const supportAgentCronCreate = options.supportAgentCronCreate !== false;
  const supportCronCreateUpdate =
    options.supportCronCreateUpdate ?? advertiseDedicatedCronRpcs;
  const backendHome = LANYARD_AGENT_FIXTURE_BACKEND_HOME;

  const settings: SettingsSnapshot =
    options.settings ??
    ({
      exported_at: "2026-08-04T12:00:00.000Z",
      source: "lanyard_agent",
      backend_home: backendHome,
      // Legacy display alias; same tree as backend_home for pure LA pins.
      hermes_home: backendHome,
      skills: [
        {
          id: "post-meeting-triage",
          name: "Post-meeting triage",
          enabled: true,
          path: "skills/crm/post-meeting-triage",
        },
      ],
      crons: LANYARD_AGENT_FIXTURE_CRONS.map((c) => ({ ...c })),
      mcp_servers: [],
      models: [
        {
          provider: "xai",
          model: "grok-4",
          is_active: true,
          connected: true,
        },
      ],
      integrations: [],
    } satisfies SettingsSnapshot);

  const methods = [
    "brain.ping",
    "brain.health",
    "brain.capabilities",
    "vault.list",
    "vault.stat",
    "vault.read",
    "settings.snapshot",
    "projects.list",
    ...(supportPatchSettings ? (["settings.patch"] as const) : []),
    ...(advertiseDedicatedCronRpcs
      ? (["cron.list", "cron.patch"] as const)
      : []),
  ];

  const featuresCron = advertiseDedicatedCronRpcs;
  const capabilities: BackendCapabilitySet =
    options.capabilities ??
    ({
      schema_version: 1,
      source: "brain_rpc",
      kind: "lanyard_agent",
      contract: { runtime_layout: 1, relay: 1, brain_rpc: 1 },
      profiles: ["admin", "contributor"],
      brain_rpc_methods: [...methods],
      features: {
        chat: true,
        health: true,
        capabilities_discovery: true,
        vault_read: true,
        vault_write: false,
        settings_snapshot: true,
        settings_patch: supportPatchSettings,
        projects_list: true,
        projects_create: false,
        projects_delete: false,
        models: false,
        cron: featuresCron,
      },
      ui_affordances: {
        chat_panel: "supported",
        vault_browser: "supported",
        vault_editor: "unsupported",
        settings_page: "supported",
        settings_editor: supportPatchSettings ? "supported" : "unsupported",
        project_picker: "supported",
        project_create: "unsupported",
        model_selector: "unsupported",
        // Dedicated cron RPCs → supported; otherwise unsupported (honest).
        // Portal still enables toggles via settings_patch + snapshot crons.
        cron_manager: featuresCron ? "supported" : "unsupported",
        host_health: "supported",
      },
      limits: {
        vault_read_default_max_bytes: 1_048_576,
        vault_read_hard_max_bytes: 4_194_304,
        vault_list_max_entries: 500,
      },
      notes: featuresCron
        ? "LA pin with dedicated cron.list/cron.patch (features.cron=true); settings.patch cron.create/cron.update enabled (lp-jzl.3)."
        : "LA pin: cron jobs under BACKEND_HOME; features.cron=false until dedicated RPCs ship; settings.patch enables toggles only (no create).",
    } satisfies BackendCapabilitySet);

  return new FakeBackendRuntimeService({
    settings,
    capabilities,
    supportPatchSettings,
    supportAgentCronCreate,
    supportCronCreateUpdate,
    supportCreateProject: false,
    supportDeleteProject: false,
    health: {
      status: "ok",
      checks: {
        vault_root_readable: true,
        backend_home_present: true,
        hermes_home_present: true,
        profiles_present: true,
        projects_db_present: true,
      },
      versions: {
        brain_rpc: 1,
        backend_artifact: "lanyard-agent-fake-0.0.0",
      },
    },
  });
}
