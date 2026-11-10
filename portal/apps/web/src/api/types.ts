export type McqChoice = {
  id: string;
  label: string;
};

/** Structured schedule for cron.create / jobs.json projection (lp-jzl.3 / lp-jzl.9.1). */
export type SettingsCronSchedule = {
  kind?: string;
  expr?: string;
  display?: string;
  timezone?: string;
  run_at?: string;
};

/**
 * File or web reference attached to an assistant message.
 * - Vault: `path` is a vault path → open in document pane / Vault.
 * - Web: `path` is an absolute http(s) URL → open externally (lp-95v.5).
 * - Optional `snippet` enriches web cards beyond bare hostname (lp-uxy.7).
 */
export type ChatCitation = {
  path: string;
  title: string;
  /** Optional excerpt for richer web citation cards (search/crawl). */
  snippet?: string;
};

export type ChatToolCallStatus = "pending" | "running" | "complete" | "error";

/**
 * Structural snapshot of an artifact wire event (lp-5q6.10 / lp-5q6.11).
 * Prefer parsing via `@lanyard/shared` `normalizeArtifactEventsFromChatEvent`;
 * durable history retains raw `metadata` so this field can be re-derived after reload.
 */
export type ChatArtifactEvent = {
  portal_event:
    | "artifact.open"
    | "artifact.progress"
    | "artifact.updated"
    | "artifact.error"
    | "artifact.close";
  thread_id: string;
  artifact_id: string;
  vault_path: string;
  title: string;
  mime_type?: string;
  file_type?: string;
  producer: string;
  status: string;
  timestamp: string;
  revision?: {
    token: string;
    kind: string;
    size_bytes?: number;
    modified_at?: string;
  };
  progress_label?: string;
  percent?: number;
  operation?: string;
  additions?: number;
  deletions?: number;
  preview_mode?: string;
  tool_call_id?: string;
  operation_id?: string;
  write_kind?: string;
  source_path?: string;
  error_code?: string;
  error_message?: string;
  preferred_mode?: "preview" | "edit";
  close_reason?: string;
};

export type ChatEvent = {
  type:
    | "message_send"
    | "message_edit"
    | "typing"
    | "tool_progress"
    | "reasoning"
    | "mcq"
    | "tool_approval"
    | "connector.qr"
    | "system_notice";
  chat_id: string;
  message_id?: string;
  content?: string;
  /** Human label for tool_progress (legacy / display). */
  tool_label?: string;
  /** Tool function name when gateway provides richer metadata. */
  tool_name?: string;
  /** Stable id for upserting a tool call across progress events. */
  tool_call_id?: string;
  tool_status?: ChatToolCallStatus;
  /** Target of the tool action (path, query, etc.). */
  tool_target?: string;
  /** Execution duration string (e.g. "1.2s", "340ms") when complete. */
  duration?: string;
  /** Error detail when tool_status is error (snake or camel from gateway). */
  error_message?: string;
  errorMessage?: string;
  /** Diff stats for edit-style tools. */
  additions?: number;
  deletions?: number;
  /** Sandbox / node badge (e.g. "cli:remote-server"). */
  node?: string;
  /** Kind discriminator; "subagent" maps to a distinct ChatToolCalls row. */
  tool_kind?: string;
  /** Subagent display name when tool_kind is subagent (or equivalent). */
  subagent_name?: string;
  /**
   * Tool result body for ChatToolCalls resultDetail (diff, stdout, etc.).
   * Prefer metadata.result / result_detail when both content and result exist.
   */
  result?: string;
  result_detail?: string;
  mcq_id?: string;
  choices?: McqChoice[];
  approval_id?: string;
  gate?: "sticky" | "every_call";
  action_class?: string | null;
  mapped?: boolean;
  pairing_id?: string;
  code?: string;
  phase?: string;
  ts?: number;
  connector_id?: string | null;
  /** Model id/name from gateway metadata when present. */
  model?: string;
  /** File citations for vault deep-link (on final message or dedicated events). */
  citations?: ChatCitation[];
  /**
   * Raw outbound metadata (MCQ, tool_progress, artifact.*, citations, …).
   * Must be retained on durable history so pane state can re-parse after reload
   * (`collectArtifactEventsFromHistory` / `normalizeArtifactEventsFromChatEvent`).
   */
  metadata?: Record<string, unknown>;
  /**
   * Optional typed artifact events after boundary parse (lp-5q6.11).
   * SSE path may omit this; consumers should call the shared normalizer on
   * `metadata` / tool fields / citations when absent.
   */
  artifact_events?: ChatArtifactEvent[];
  /** Present on durable history rows from relay/BFF. */
  created_at?: string;
  /**
   * Group-room author stamp (group-rooms-v1 historySpeaker).
   * Absent on 1:1 history. Also accepted on metadata.speaker.
   */
  speaker?: HistorySpeaker;
};

/**
 * Durable history row from GET /api/chat/threads/:id/history.
 * Includes synthetic user_message events written on send, plus outbound ChatEvents.
 */
export type ChatHistoryEvent =
  | {
      type: "user_message";
      message_id: string;
      content: string;
      created_at: string;
      chat_id: string;
      /** Optional model stamp when durable history carries it. */
      model?: string;
      /** Group-room author stamp. Absent on 1:1 history. */
      speaker?: HistorySpeaker;
    }
  | ChatEvent;

export type AuthUser = {
  user_id: string;
  email: string;
  tenant_id: string;
};

/**
 * Chat directory project. When sourced from Hermes (SoT), `project_id` is the
 * Hermes project id and `vault_path` is the absolute primary_path (agent cwd).
 */
export type Project = {
  project_id: string;
  name: string;
  vault_path: string;
  parent_project_id: string | null;
};

/** Shared contract with BFF GET/POST /api/agent/projects (preferred; legacy /api/hermes/projects). */
export type HermesProjectFolder = {
  path: string;
  label?: string | null;
  is_primary: boolean;
};

export type HermesProject = {
  id: string;
  slug: string;
  name: string;
  primary_path: string | null;
  folders: HermesProjectFolder[];
};

/**
 * Provenance of the agent display name (lp-fn5.3).
 * - default: temporary create title ("New chat" / project name)
 * - llm: auto-assigned short name
 * - user: explicit rename (must not be overwritten by LLM)
 * - job: bound to a scheduled-task stream name
 */
export type ThreadTitleSource = "default" | "llm" | "user" | "job";

/** Who last set the per-thread system / purpose prompt (lp-lv9.4). */
export type ThreadSystemPromptSource = "default" | "llm" | "user";

/**
 * Thread product kind (lp-fn5.5.1 / lp-cxhb.5 / lac-bx3 P9).
 * - chat: interactive agent 1:1 (default)
 * - scheduled_task: durable job stream under Scheduled Tasks folder
 * - group: named channel roster (group-rooms-v1)
 */
export type ThreadKind = "chat" | "scheduled_task" | "group";

/** Room roster member (group-rooms-v1 Speaker). */
export type ThreadParticipant =
  | { kind: "human"; user_id: string; display_name?: string }
  | { kind: "persona"; persona_id: string; display_name?: string };

/**
 * Persisted/UI speaker stamp (group-rooms-v1 historySpeaker).
 * `id` is `user_id` or `persona_id` according to `kind`.
 */
export type HistorySpeaker = {
  kind: "human" | "persona";
  id: string;
  display_name: string;
};

/** Channel roster pointer (lp-cxhb.5). */
export type ChannelMember = {
  agent_id: string;
  joined_at: string;
};

/** Named multi-agent room created via POST /api/channels (lp-cxhb.5/.7). */
export type Channel = {
  thread_id: string;
  name: string;
  kind: "group";
  lead_agent_id: string;
  members: ChannelMember[];
  created_at: string;
  title: string;
  avatar_seed: string | number;
  title_source: ThreadTitleSource;
  project_id: string | null;
  project_vault_path: string | null;
};

/** Summary row from GET /api/chat/threads. */
export type ChatThreadSummary = {
  thread_id: string;
  title: string;
  project_id: string | null;
  project_vault_path: string | null;
  created_at: string;
  /**
   * Stable dither avatar seed (random at create). Missing/empty on legacy
   * rows is filled client-side via hash of thread_id only.
   */
  avatar_seed: string | number;
  title_source: ThreadTitleSource;
  /**
   * Product kind (lp-fn5.5.1). Prefer reading via `normalizeChatThreadSummary`
   * which defaults missing/unknown to `chat`.
   */
  kind?: ThreadKind;
  /**
   * When set, this row is the durable stream for that scheduled job
   * (lp-fn5.5.1). Null/undefined for interactive chats.
   */
  scheduled_job_id?: string | null;
  /**
   * Short per-thread purpose prompt (lp-lv9.4). Empty when unset.
   */
  system_prompt?: string;
  /**
   * Provenance of `system_prompt` — user edits must not be overwritten by LLM.
   */
  system_prompt_source?: ThreadSystemPromptSource;
  /**
   * Durable catalog person this interactive 1:1 belongs to (lp-cxhb.2).
   * Null/undefined on legacy chats and unbound job streams.
   */
  agent_id?: string | null;
  /**
   * Room roster (group-rooms-v1 Speaker). Empty/absent on 1:1 and job streams.
   * `kind=group` lists humans + personas (Skip, Lev, Bana, …).
   */
  participants?: ThreadParticipant[];
  /**
   * Default wake persona for the room. Null unless `kind=group`.
   */
  orchestrator_persona_id?: string | null;
  access?: "owner" | "read" | "collaborate" | string;
  owner_user_id?: string;
  grant_id?: string;
};

/**
 * POST/GET /api/agents catalog row (lp-cxhb.2 / lp-cxhb.4).
 * The Agents sidenav row is this person; `thread_id` is the one persistent 1:1.
 */
export type DurableAgent = {
  agent_id: string;
  name: string;
  avatar: string;
  objective: string;
  thread_id: string;
  created_at: string;
};

/** Share access mode (aligned with BFF createSessionShareSchema). */
export type SessionShareMode = "read" | "collaborate";

/**
 * Session share grant from BFF POST/DELETE /api/chat/threads/:id/shares
 * (and list owner view). Matches control-plane SessionShareGrant.
 */
export type SessionShareGrant = {
  grant_id: string;
  tenant_id: string;
  thread_id: string;
  owner_user_id: string;
  grantee_user_id: string;
  mode: SessionShareMode;
  created_at: string;
  revoked_at: string | null;
};

/** Same-tenant directory entry from GET /api/org/members (no secrets). */
export type OrgMember = {
  user_id: string;
  email: string;
};

export type OrgMembersResponse = {
  tenant_id: string;
  members: OrgMember[];
};

export type StagingUploadRecord = {
  path: string;
  filename: string;
};

export type VaultTreeNode = {
  name: string;
  path: string;
  kind: "file" | "directory";
  mime_type?: string;
  /** Supporting text (e.g. absolute disk path for Hermes project roots). */
  description?: string;
  children?: VaultTreeNode[];
};

/** GET /api/vault/tree response body. */
export type VaultTreeResponse = {
  roots: VaultTreeNode[];
  source?: string;
  unavailable?: boolean;
  /** True when the server node budget stopped the walk early (lp-8ty). */
  truncated?: boolean;
  truncated_reason?: string;
};

export type VaultEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
  mime_type?: string;
};

/** GET /api/vault/entries response body. */
export type VaultEntriesResponse = {
  path: string;
  entries: VaultEntry[];
  source?: string;
  truncated?: boolean;
  next_cursor?: string | null;
};

export type VaultFileContent = {
  path: string;
  mime_type: string;
  encoding: "utf-8" | "base64";
  content: string;
};

export type VaultSearchHit = {
  path: string;
  title: string;
  snippet: string;
  score: number;
};

export type VaultSearchResponse = {
  query: string;
  last_indexed_at: string;
  results: VaultSearchHit[];
};

// ---------------------------------------------------------------------------
// Vault history / current-head (lp-ye4.11) — metadata only, never body bytes
// ---------------------------------------------------------------------------

export type VaultHistoryActor = {
  kind: "human" | "agent" | "system" | "delegated_agent";
  subject_id: string;
  display_name?: string;
  portal_user_id?: string;
  agent_id?: string;
  run_id?: string;
  session_id?: string;
  backend_profile?: string;
  grant_id?: string;
};

export type VaultDocumentRevisionWire = {
  token: string;
  kind: "etag" | "content_hash" | "host_revision" | "mtime_size_fallback";
  size_bytes?: number;
  sizeBytes?: number;
  modified_at?: string;
  modifiedAt?: string;
};

/** GET /api/vault/heads/artifact */
export type ArtifactHeadResponse = {
  record_type?: "artifact_head";
  path: string;
  operation_id: string;
  revision: VaultDocumentRevisionWire;
  updated_at?: string;
  head_kind: "canonical" | "checkpoint";
  source_path?: string;
  actor?: VaultHistoryActor;
  workspace_id?: string;
  source?: string;
};

/** GET /api/vault/heads/workspace */
export type WorkspaceHeadResponse = {
  record_type?: "workspace_head";
  workspace_id: string;
  tree_root_hash: string;
  operation_id: string;
  updated_at?: string;
  entry_count?: number;
  source?: string;
};

export type SignedOperationHistoryEvent = {
  operation_id: string;
  occurred_at?: string;
  kind: string;
  actor?: VaultHistoryActor;
  target?: {
    path?: string;
    source_path?: string;
    scope?: string;
  };
  result?: {
    status?: string;
    reason?: string;
    revision?: VaultDocumentRevisionWire;
    write_kind?: string;
  };
  vault_write_mode?: string;
  advances_artifact_head?: boolean;
};

/** GET /api/vault/history */
export type VaultHistoryResponse = {
  path: string;
  events: SignedOperationHistoryEvent[];
  truncated?: boolean;
  next_cursor?: string | null;
  source?: string;
};

/** Redacted settings snapshot from GET /api/settings/snapshot (aligned with BFF). */
export type SettingsSkill = {
  id: string;
  name: string;
  path?: string;
  enabled: boolean;
  /** One-line summary when host provides list metadata (lp-a8u.6). */
  description?: string;
};

export type SettingsCron = {
  id: string;
  name: string;
  /**
   * Human display string (legacy list snapshot) or structured schedule
   * (create/update result / jobs.json projection — lp-jzl.3).
   */
  schedule: string | SettingsCronSchedule;
  path?: string;
  enabled: boolean;
  last_run_at?: string | null;
  next_run_at?: string | null;
  /**
   * Host job state when provided (scheduled | running | paused | completed | …).
   * Settings Scheduled tasks table shows a Status indicator when present (lp-su0).
   */
  state?: string | null;
  /** Last run outcome when host provides it (ok | error | …). */
  last_status?: string | null;
  /** Present only when host/detail includes it (not required on list snapshot). */
  command?: string;
  prompt?: string;
  payload?: unknown;
  /** Optional skill ids attached to the job (lp-jzl.9.2). */
  skills?: string[];
};

/** GET /api/settings/content — host-home file body for skill/workflow detail. */
export type SettingsHostContent = {
  path: string;
  content: string;
  mime_type: string;
  encoding: "utf-8" | string;
  byte_length?: number;
};

/** GET /api/settings/list — one-level host-home directory (skill pack files). */
export type SettingsHostListEntry = {
  name: string;
  path: string;
  kind: "file" | "directory";
};

export type SettingsHostList = {
  path: string;
  entries: SettingsHostListEntry[];
};

/** GET /api/settings/crons/:id/detail — job fields from host jobs.json. */
export type SettingsCronDetail = {
  id: string;
  name: string;
  schedule?: string;
  enabled?: boolean;
  path?: string;
  last_run_at?: string | null;
  next_run_at?: string | null;
  command?: string;
  prompt?: string;
  payload?: unknown;
};

export type SettingsMcpServer = {
  name: string;
  transport: string;
  command?: string;
  enabled?: boolean;
};

export type SettingsModel = {
  provider: string;
  model: string;
  is_active?: boolean;
  connected?: boolean;
};

/** Settings / snapshot origin tags (backend-neutral; hermes kept as legacy). */
export type SettingsSource =
  | "fixture"
  | "hermes"
  | "brain_rpc"
  | "backend"
  | "lanyard_agent"
  | (string & {});

export type SettingsSkillPatchResponse = {
  skill: SettingsSkill;
  source: SettingsSource;
};

export type SettingsCronPatchResponse = {
  cron: SettingsCron;
  source: SettingsSource;
};

/** POST /api/settings/crons body (lp-jzl.3 / lp-jzl.5 form / lp-jzl.9.1 wizard). */
export type SettingsCronCreateBody = {
  name: string;
  prompt?: string;
  /** Alias for prompt. */
  instructions?: string;
  schedule: string | SettingsCronSchedule;
  enabled?: boolean;
  skills?: string[];
  id?: string;
  cron_id?: string;
};

/** Alias for form/wizard callers that prefer Request naming. */
export type SettingsCronCreateRequest = SettingsCronCreateBody;

/** POST /api/settings/crons response. */
export type SettingsCronCreateResponse = {
  cron: SettingsCron;
  source: SettingsSource;
};

export type SettingsMcpPatchResponse = {
  mcp: SettingsMcpServer;
  source: SettingsSource;
};

export type SettingsModelPatchResponse = {
  model: SettingsModel;
  source: SettingsSource;
};

export type SettingsIntegration = {
  id: string;
  name: string;
  type: string;
  bin?: string;
  path?: string;
};

/**
 * User-created workflow definition listed in settings.snapshot.
 * Hosts may store IR under `.lanyard/workflows/`; Brain RPC may omit until wired.
 */
export type SettingsWorkflow = {
  id: string;
  name: string;
  path?: string;
  description?: string;
  enabled?: boolean;
  updated_at?: string | null;
};

export type SettingsSnapshot = {
  exported_at: string;
  /** Preferred host home (BACKEND_HOME). */
  backend_home?: string | null;
  /** Legacy alias of backend_home (Hermes-era field). */
  hermes_home?: string | null;
  source?: SettingsSource;
  skills: SettingsSkill[];
  crons: SettingsCron[];
  mcp_servers: SettingsMcpServer[];
  models: SettingsModel[];
  integrations: SettingsIntegration[];
  /** User-created workflow defs (additive; empty when host has none). */
  workflows?: SettingsWorkflow[];
};

export type IntegrationHealthStatus = "healthy" | "unhealthy";

export type IntegrationHealthResult = {
  id: string;
  name: string;
  type: string;
  status: IntegrationHealthStatus;
  latency_ms: number;
  checked_at: string;
  message: string;
};

export type SettingsHealthCheckResponse = {
  checked_at: string;
  integrations: IntegrationHealthResult[];
};

/**
 * UI full-support gates from GET /api/context `ui.can`
 * (mirrors backend-runtime PortalUiCanFlags subset used by web).
 */
export type PortalContextUiCan = {
  /** vault_editor affordance / Office edit mint (lp-5q6.29). */
  vault_edit?: boolean;
  settings_view?: boolean;
  settings_edit?: boolean;
  project_list?: boolean;
  project_create?: boolean;
  model_select?: boolean;
  cron_manage?: boolean;
  host_health?: boolean;
  chat?: boolean;
  vault_browse?: boolean;
};

export type PortalContextUiAffordanceState =
  | "supported"
  | "unsupported"
  | "degraded";

/**
 * Capability descriptor subset from GET /api/context `backend_capabilities`
 * (lp-rt5.4 / lp-k7g.8.5). Structural — no backend_kind branches in UI.
 */
export type PortalBackendCapabilities = {
  schema_version?: number;
  source?: string;
  features?: Record<string, boolean>;
  brain_rpc_methods?: string[];
  ui_affordances?: Record<string, PortalContextUiAffordanceState | string>;
};

/**
 * Session bootstrap from GET /api/context (BFF).
 * Includes honesty gates `brain_rpc_enabled`, `vault_plane`, `chat_delivery`
 * for Directory/Vault/Settings (lp-oop.37.8).
 */
export type PortalContext = {
  tenant_id?: string;
  tenant_slug?: string | null;
  display_name?: string;
  host?: string;
  hermes_profile?: string | null;
  allowed_path_prefixes?: string[];
  role_names?: string[];
  /** When false/absent, host-backed Brain RPC panes are not production-ready. */
  brain_rpc_enabled?: boolean;
  /** Dual-run chat path. Absent/unknown → honesty keeps guest-world relay copy. */
  chat_delivery?: "relay" | "harness";
  /**
   * Vault UI plane. `cp_s3` means Directory/Vault are control-plane, not
   * guest Brain RPC.
   */
  vault_plane?: "fs" | "brain_rpc" | "cp_s3";
  /**
   * Capability-derived UI gates (lp-5q6.29 + lp-rt5.4).
   * `ui.can.vault_edit` gates the Vault Office Edit affordance.
   * Settings section visibility uses affordances + can.* (grill Q10).
   */
  ui?: {
    affordances?: Record<string, PortalContextUiAffordanceState | string>;
    can?: PortalContextUiCan;
    degraded?: string[];
    unsupported?: string[];
  };
  /** Live/static backend capability descriptor when Brain RPC path is active. */
  backend_capabilities?: PortalBackendCapabilities;
  capabilities_source?: string;
  capabilities_degraded?: boolean;
  capabilities_notes?: string;
};
