import {
  agentProjectsErrorToHttp,
  backendContextFromSession,
  createAgentProjectsHandlers,
  createContextHandlers,
  createHistoryHandlers,
  createSettingsHandlers,
  createVaultHandlers,
  historyErrorToHttp,
  BackendRuntimeError,
  parseSettingsPatchInput,
  settingsErrorToHttp,
  vaultErrorToHttp,
} from "@lanyard/backend-runtime";
import { deprecationHeadersForLegacyPath } from "@lanyard/hermes-compat";
import {
  brainRpcErrorToHttpStatus,
  buildMcqSelectionMessageEvent,
  createLanyardWebDescriptor,
  createLogger,
  InvalidVaultPathError,
  LANYARD_WEB_PLATFORM,
  StagingPathNotAllowedError,
  type MailboxErrorCode,
} from "@lanyard/shared";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { createProductionBackendRuntimeService } from "./backend-runtime-compose.js";
import {
  buildBrainRpcRequest,
  isBrainRpcHostOk,
  stampBrainRpcAuth,
} from "./brain-rpc.js";
import {
  ControlPlaneRequestError,
  type EnsureOnlineResponse,
  type InstancePresenceState,
} from "./control-plane-client.js";
import {
  isLocalDevMode,
  resolveDemoMemberRoleId,
  shouldAutoAssignDemoMember,
} from "./local-dev.js";
import {
  authenticatePassword,
  registerPassword,
} from "./password-auth.js";
import { resolveOAuthRedirectOrigin } from "./oauth-redirect.js";
import {
  canAssignBootstrapTitle,
  canAssignLlmTitle,
  isBootstrapAssignMessage,
  CHAT_SUGGEST_TITLE_METHOD,
  CHAT_SUGGEST_TITLE_PROMPT,
  fixtureAgentNameFromMessage,
  titleFromSuggestTitleResult,
} from "./agent-name.js";
import {
  canAssignLlmSystemPrompt,
  CHAT_SUGGEST_PURPOSE_METHOD,
  chatSystemPromptMetadata,
  countCompletedUserTurns,
  fixtureSystemPromptFromMessages,
  purposeFromSuggestResult,
  sanitizeSystemPrompt,
  shouldGenerateSystemPrompt,
  SYSTEM_PROMPT_MAX_CHARS,
} from "./agent-system-prompt.js";
import { CreateChannelError } from "./create-channel.js";
import { SetChannelLeadError } from "./channel-lead.js";
import {
  resolveLeadSuccessor,
  type SuccessionContext,
} from "./channel-succession.js";
import {
  ChannelNotFoundError,
  durableOutboundFromRelayEvent,
  mergeChatHistoryEvents,
  type Channel,
  type ChatThread,
  type DurableAgent,
} from "./chat-store.js";
import { stampGroupDeliverInbound } from "./group-inbound-stamp.js";
import {
  boundRoomTail,
  harnessWakeMetadata,
} from "./harness-wake-payload.js";
import { personaMetaForWake } from "./persona-turn.js";
import { HOST_PLAYBOOK } from "./host-playbook.js";
import {
  ContextPoolStore,
  createInMemoryChannelPoolStore,
  type ChannelPoolStore,
} from "./context-pool.js";
import {
  freezeMailboxRoom,
  mailboxErrorBody,
  mailboxHaltRoomFromThreadId,
  thawMailboxRoom,
} from "./mailbox-halt.js";
import {
  appendMailboxFuseTripNotice,
  mailboxFuseTripLiveEvent,
  mailboxInternalTokenMatches,
  parseMailboxFuseTripInput,
} from "./mailbox-fuse-notice.js";
import { MailboxNonceStore } from "./mailbox-nonce.js";
import {
  executeMailboxSend,
  hopHumanOneToOneMentions,
  hopMailboxFromHarnessEvent,
  parseMailboxAppendOrError,
  type MailboxSpineEnqueue,
} from "./mailbox-send.js";
import {
  hopScheduledTaskFromHarnessEvent,
  stampScheduledTaskCreateMetadata,
} from "./scheduled-task-create-hop.js";
import {
  createChatCorpusCapture,
  type ChatCorpusCapture,
} from "./chat-corpus-capture.js";
import type { WorkflowRunVaultPersist } from "./workflow-run-vault-persist.js";
import {
  chatWorkingDirectoryMetadata,
  resolveChatWorkingDirectory,
} from "./chat-working-directory.js";
import {
  buildAgentReadyEvent,
  buildAgentStartingAcceptedBody,
  buildAgentStartingEvent,
  mapEnsureOnlineErrorToLiveEvent,
} from "./agent-starting-events.js";
import { ensureOnlineBeforeBrainRpc } from "./ensure-online-brain-rpc.js";
import { proxyHarnessTurnsUntilAbort } from "./chat-delivery-events.js";
import {
  deliverChatTurn,
  deliverHarnessPersonaTurns,
  deliverRelayChatTurns,
  harnessTurnMessage,
  interruptChatTurn,
  isRelayGatewayNotReady,
  RELAY_GATEWAY_READY_RETRY_BUDGET_MS,
  RELAY_GATEWAY_READY_RETRY_MS,
} from "./chat-delivery-send.js";
import { completeAgentBackendTurn } from "./agent-backend.js";
import {
  agentBackendPublicView,
  AgentPersonaPathError,
  listAgentCrons,
  listAgentMemory,
  loadAgentBackend,
  personaJobThreadId,
  readAgentMemory,
  resolveChatAgentBackend,
  saveAgentBackend,
  saveAgentCrons,
  writeAgentMemory,
} from "./agent-persona-store.js";
import { resolveChatSendInstance } from "./chat-instance-resolve.js";
import {
  deliverSpineTurns,
  inboundActivitySource,
  inboundWorkItemFromClassifiedTurn,
} from "./inbound-queue.js";
import {
  chatHopDelivery,
  isHarnessChatHop,
  resolveChatHop,
  type ChatHop,
} from "./inbound-spine.js";
import {
  DEFAULT_CHAT_DELIVERY,
  DEFAULT_VAULT_PLANE,
  resolveChatDelivery,
  type ChatDelivery,
} from "./config.js";
import {
  harnessSettingsSnapshotHttpError,
  mergeHarnessModelCapabilities,
} from "./harness-client.js";
import { createHarnessTurnRegistry } from "./harness-turn-registry.js";
import {
  ensureOnlineBeforeChatDeliver,
  ensureOnlineBeforeChatDeliverKickoff,
} from "./ensure-online-chat.js";
import { createEnsureOnlineFlightRegistry } from "./ensure-online-hook.js";
import { kickSpeculativeEnsureOnline } from "./ensure-online-speculative.js";
import {
  mapControlPlaneWakeFailure,
  wakeFailureToJsonBody,
} from "./ensure-online-errors.js";
import {
  parseRelaySseDataLine,
  RELAY_INTERNAL_TOKEN_HEADER,
} from "./relay-client.js";
import { createThreadLiveEventsHub } from "./thread-live-events.js";
import {
  signalActivityBestEffort,
  signalActivityIfNeeded,
} from "./signal-activity.js";
import { registerConnectorRoutes } from "./connectors-routes.js";
import { MemoryPendingConnectorUseStore } from "./pending-connector-use.js";
import { csrfProtection } from "./middleware/csrf.js";
import { createTenantMiddleware } from "./middleware/tenant.js";
import { createOpsAuthApp } from "./ops-auth-routes.js";
import { MemoryOpsSessionStore } from "./ops-session.js";
import {
  clearSessionCookie,
  createCsrfToken,
  readSessionId,
  resolveSessionUser,
  setCsrfCookie,
  setSessionCookie,
  signOAuthState,
  verifyOAuthState,
  type SessionUser,
} from "./session.js";
import {
  assertSettingsPermission,
  assertVaultPathAccess,
  isTenantAdmin,
  requireUserRbac,
} from "./rbac.js";
import {
  loadModelCatalog,
  normalizeModelCatalog,
  routeCatalogModel,
  saveModelCatalog,
  DEFAULT_MODEL_CATALOG,
  type ModelCatalog,
} from "./model-catalog.js";
import { materializeLiteLLMConfig } from "./litellm-generated-config.js";
import {
  listLiteLLMProviderModels,
  listLiteLLMProviders,
} from "./litellm-model-search.js";
import { ProviderKeyRejectedError } from "./litellm-provider-call.js";
import {
  addModelKey,
  completeSavedModelTurn,
  listSavedModels,
  removeSavedModel,
} from "./model-keys.js";
import {
  assertCatalogKeyIds,
  deleteProviderKey,
  InvalidProviderKeyError,
  listProviderKeys,
  ProviderKeyInUseError,
  ProviderKeyNotFoundError,
  saveProviderKey,
} from "./provider-keys.js";
import { canSendMessages, resolveThreadAccess } from "./thread-access.js";
import {
  listSettingsHostDirectory,
  loadSettingsCronJobDetail,
  readSettingsHostContent,
  SettingsContentError,
} from "./settings-content.js";
import { checkIntegrationHealth } from "./settings-health.js";
import {
  loadSettingsSnapshot,
  patchSettingsActiveModel,
  patchSettingsCron,
  patchSettingsMcp,
  patchSettingsSkill,
  SettingsPatchNotFoundError,
  type RedactedSettingsSnapshot,
  type SettingsIntegration,
} from "./settings-snapshot.js";
import {
  formatStagingReferences,
  StagingService,
} from "./staging/service.js";
import {
  BFF_VAULT_SCHEDULED_JOBS_PATH,
  newScheduledTaskJobId,
  overlayVaultCronsOnSnapshot,
  scheduledJobToSettingsCron,
  type BffScheduledJob,
} from "./scheduled-task-vault-store.js";
import {
  bindScheduledTaskConnectorNeed,
  TenantCronUserConnectorError,
} from "./scheduled-task-connectors.js";
import { projectVaultInventoryOntoSnapshot } from "./vault-harness-inventory.js";

import {
  createDefaultHermesProjectsService,
  HermesCliNotFoundError,
  HermesProjectCreateError,
  type HermesProject,
} from "./hermes-projects.js";
import {
  authorizeOfficeDownload,
  buildOfficeSafeLogFields,
  classifyOfficeDownloadReason,
  classifyOfficeError,
  createDefaultOfficeCallbackFetcher,
  createVaultOfficeBinaryContentSource,
  extractOfficeCallbackAuth,
  extractOfficeDownloadToken,
  handleOfficeCallback,
  loadOfficeCallbackAllowlist,
  loadOfficeJwtSecret,
  loadOfficePublicBaseUrl,
  mimeForOfficeFileType,
  mintOfficeEditorSession,
  officeDownloadErrorBody,
  officeMetrics,
  officeSizeBucket,
  resolveOfficeDownloadMaxBytes,
  MemoryOfficeDocumentSessionStore,
  type DocumentRevision,
  type OfficeBinaryContentSource,
  type OfficeCallbackFetcher,
  type OfficeCallbackVaultWriter,
  type OfficeDocumentSessionStore,
  type OfficeMetricOutcome,
  type OfficeSessionMode,
} from "./office/index.js";
import { parseEnvFlag } from "./config.js";
import { VaultService } from "./vault/service.js";
import type { BffBindings, BffVariables } from "./types.js";

const log = createLogger({ service: "bff" });

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(128),
});

const createThreadSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  /** Hermes project id (e.g. p_abc123) — agent cwd source of truth. */
  project_id: z.string().min(1).max(128).optional(),
  /**
   * Optional create flags (lp-fn5.5.1). Prefer POST …/ensure-for-job for
   * idempotent job streams; these allow one-shot create with binding.
   */
  kind: z.enum(["chat", "scheduled_task"]).optional(),
  scheduled_job_id: z.string().min(1).max(200).optional(),
  title_source: z.enum(["default", "llm", "user", "job"]).optional(),
  /** Durable agent bind for scheduled_task streams (lp-cxhb.11). */
  agent_id: z.string().min(1).max(200).optional(),
});

const agentBackendPutSchema = z.object({
  base_url: z.string().url(),
  api_key: z.string().min(1).max(500),
  protocol: z.enum(["openai_chat", "lanyard_harness"]),
  model: z.string().min(1).max(80).optional(),
});

const agentCronsPutSchema = z.object({
  jobs: z
    .array(
      z.object({
        id: z.string().min(1).max(80),
        name: z.string().min(1).max(120),
      }),
    )
    .max(50),
});

const agentMemoryPutSchema = z.object({
  content: z.string().max(200_000),
});

const updateThreadSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    /** Set to `user` on explicit rename so LLM auto-name will not overwrite. */
    title_source: z.enum(["default", "llm", "user", "job"]).optional(),
    /**
     * Per-thread purpose prompt (lp-lv9.4). When set via PATCH from the
     * header editor, BFF forces system_prompt_source=user.
     */
    system_prompt: z.string().max(SYSTEM_PROMPT_MAX_CHARS).optional(),
    system_prompt_source: z.enum(["default", "llm", "user"]).optional(),
  })
  .refine(
    (body) => body.title !== undefined || body.system_prompt !== undefined,
    { message: "title or system_prompt is required" },
  );

/** POST /chat/threads/:id/assign-name — LLM/fixture agent name (lp-fn5.3.4). */
const assignThreadNameSchema = z.object({
  /** First user message (or other context) for the short name. */
  message: z.string().max(8_000).optional(),
});

/**
 * POST /chat/threads/:id/assign-system-prompt — LLM/fixture purpose (lp-lv9.4).
 * Body may include early conversation messages for the offline fixture path.
 */
const assignThreadSystemPromptSchema = z.object({
  /** Early user messages (or other context) for the purpose summary. */
  messages: z.array(z.string().max(8_000)).max(8).optional(),
  /** Single message convenience alias (first turn). */
  message: z.string().max(8_000).optional(),
});

/**
 * POST /chat/threads/ensure-for-job — idempotent job stream chat (lp-fn5.5.1).
 * Same job_id for the owner always returns the same thread_id.
 */
const ensureThreadForJobSchema = z.object({
  job_id: z.string().min(1).max(200),
  /** Job display name → thread title when title_source=job. */
  name: z.string().min(1).max(200),
  /** Durable agent this job runs as (lp-cxhb.11). Required on product create. */
  agent_id: z.string().min(1).max(200).optional(),
});

/** POST /agents — mint a catalog row + the one 1:1 (lp-cxhb.2). */
const createAgentSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  avatar: z.string().min(1).max(64).optional(),
  objective: z.string().max(SYSTEM_PROMPT_MAX_CHARS).optional(),
});

/** PATCH /agents/:id — catalog name is the identity write (lp-v62i.22). */
const renameAgentSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

/** Public thread summary fields (owned + shared list/create/patch). */
function threadSummaryJson(thread: ChatThread) {
  return {
    thread_id: thread.thread_id,
    title: thread.title,
    project_id: thread.project_id,
    project_vault_path: thread.project_vault_path,
    created_at: thread.created_at,
    avatar_seed: thread.avatar_seed,
    title_source: thread.title_source,
    kind: thread.kind,
    scheduled_job_id: thread.scheduled_job_id,
    system_prompt: thread.system_prompt,
    system_prompt_source: thread.system_prompt_source,
    agent_id: thread.agent_id,
    participants: thread.participants,
    orchestrator_persona_id: thread.orchestrator_persona_id,
  };
}

/** Public durable-agent catalog fields (lp-cxhb.2). */
function agentSummaryJson(agent: DurableAgent) {
  return {
    agent_id: agent.agent_id,
    name: agent.name,
    avatar: agent.avatar,
    objective: agent.objective,
    thread_id: agent.thread_id,
    created_at: agent.created_at,
  };
}

/** Public channel fields (lp-cxhb.5 / lp-cxhb.7). */
function channelSummaryJson(channel: Channel) {
  return {
    ...threadSummaryJson(channel.thread),
    name: channel.name,
    kind: "group" as const,
    lead_agent_id: channel.lead_agent_id,
    members: channel.members,
  };
}

const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  vault_path: z.string().min(1),
  parent_project_id: z.string().uuid().nullable().optional(),
});

const createHermesProjectSchema = z.object({
  name: z.string().min(1).max(200),
  folders: z.array(z.string().min(1)).max(20).optional(),
});

const updateProjectSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    vault_path: z.string().min(1).optional(),
  })
  .refine((body) => body.name !== undefined || body.vault_path !== undefined, {
    message: "At least one of name or vault_path must be provided",
  });

const mcqSelectionSchema = z.object({
  mcq_id: z.string().min(1).max(128),
  choice_id: z.string().min(1).max(128),
  label: z.string().min(1).max(500),
  prompt_message_id: z.string().min(1).max(128).optional(),
});

const createSessionShareSchema = z.object({
  grantee_email: z.string().email(),
  mode: z.enum(["read", "collaborate"]),
});

const sendMessageSchema = z
  .object({
    text: z.string().min(1).max(32_000).optional(),
    staging_paths: z.array(z.string().min(1)).max(20).optional(),
    mcq_selection: mcqSelectionSchema.optional(),
  })
  .refine((body) => Boolean(body.text?.trim() || body.mcq_selection), {
    message: "Either text or mcq_selection is required",
  });

/**
 * Resolve ui.can.vault_edit for Office edit mint (lp-5q6.26).
 * Bindings override wins (tests); else env BFF_OFFICE_VAULT_EDIT (default false).
 */
async function resolveOfficeVaultEdit(bindings: BffBindings): Promise<boolean> {
  if (bindings.officeCanVaultEdit !== undefined) {
    if (typeof bindings.officeCanVaultEdit === "function") {
      return Boolean(await bindings.officeCanVaultEdit());
    }
    return Boolean(bindings.officeCanVaultEdit);
  }
  return parseEnvFlag(process.env.BFF_OFFICE_VAULT_EDIT);
}

/** Path-first tenant prefix for DS-visible Office URLs (`/{slug}` or empty). */
function officeTenantPathPrefix(
  c: { req: { url: string; path: string } },
  tenantSlug: string,
): string {
  let pathname = c.req.path;
  try {
    pathname = new URL(c.req.url).pathname;
  } catch {
    // keep path
  }
  if (pathname.startsWith(`/${tenantSlug}/`)) {
    return `/${tenantSlug}`;
  }
  return "";
}

function requireUser(c: { get: (key: "user") => SessionUser | null }) {
  const user = c.get("user");
  if (!user) {
    throw new HTTPException(401, { message: "Not authenticated" });
  }
  return user;
}

/** G3.3: brain RPC surface is feature-flagged; disabled → fail closed (503). */
function requireBrainRpcEnabled(bindings: BffBindings): void {
  if (!bindings.brainRpcEnabled) {
    throw new HTTPException(503, {
      message:
        "The agent is not available for this action.",
    });
  }
}

/**
 * lp-oop.29: instance/tenant persist beats process env. Unset inherit
 * `CHAT_DELIVERY` (default relay) so MockLab can flip alone.
 * Honesty / settings / speculative wake still use this. Send / SSE /
 * cancel use `requestChatHop` (lp-k5c4.8) so spine tenants never consult it.
 */
function requestChatDelivery(
  bindings: BffBindings,
  tenant: { chat_delivery?: ChatDelivery | null },
): ChatDelivery {
  return resolveChatDelivery({
    env: bindings.chatDelivery ?? DEFAULT_CHAT_DELIVERY,
    tenant: tenant.chat_delivery,
  });
}

/** Send / SSE / cancel hop. Spine short-circuits before requestChatDelivery. */
function requestChatHop(
  bindings: BffBindings,
  tenant: { chat_delivery?: ChatDelivery | null },
): ChatHop {
  return resolveChatHop({
    tenantChatDelivery: tenant.chat_delivery,
    harnessUrlWired: Boolean(bindings.harnessClient),
    envChatDelivery: bindings.chatDelivery ?? DEFAULT_CHAT_DELIVERY,
  });
}

/**
 * Build BackendRuntimeContext for production Brain RPC handlers
 * (projects.list / settings.snapshot / vault.list|stat|read).
 * Stamps L3 subject from control-plane RBAC.
 */
async function resolveBackendRuntimeContext(
  c: Context<{ Variables: BffVariables }>,
  bindings: BffBindings,
) {
  const tenant = c.get("tenant");
  const user = requireUser(c);
  const rbac = requireUserRbac(c.get("rbac"));
  const sessionId = readSessionId(c) ?? `sess_${user.user_id}`;

  let instanceId: string;
  try {
    const primary = await bindings.authClient.getPrimaryGatewayInstance(
      tenant.tenant_id,
    );
    instanceId = primary.instance_id;
  } catch (error) {
    if (error instanceof ControlPlaneRequestError) {
      throw new HTTPException(error.status as ContentfulStatusCode, {
        message: error.message,
      });
    }
    throw error;
  }

  return backendContextFromSession({
    tenantId: tenant.tenant_id,
    instanceId,
    userId: user.user_id,
    sessionId,
    profileName: rbac.hermes_profile,
    pathPrefixes: rbac.allowed_path_prefixes,
    roles: rbac.role_names,
  });
}

async function establishSession(
  bindings: BffBindings,
  c: Parameters<typeof setSessionCookie>[0],
  input: { userId: string; tenantId: string; email: string },
): Promise<void> {
  const session = await bindings.sessions.create(input);
  const csrfToken = createCsrfToken();
  setSessionCookie(c, session.sessionId, bindings.config.secureCookies);
  setCsrfCookie(c, csrfToken, bindings.config.secureCookies);
}

export function createApp(bindings: BffBindings): Hono<{ Variables: BffVariables }> {
  const vaultService = new VaultService(
    bindings.vaultContentProvider,
    bindings.vaultIndexProvider,
  );
  const stagingService = new StagingService(
    bindings.stagingStorageProvider,
    bindings.config.stagingMaxUploadBytes,
  );
  const hermesProjects =
    bindings.hermesProjects ??
    createDefaultHermesProjectsService({
      hermesHome: bindings.hermesHome ?? bindings.settingsHermesHome,
    });
  /**
   * Office document sessions (lp-5q6.21) + signed download (lp-5q6.22).
   * Memory store is the lab default; multi-instance injects Redis via bindings.
   */
  const officeDocumentSessions: OfficeDocumentSessionStore =
    bindings.officeDocumentSessions ?? new MemoryOfficeDocumentSessionStore();
  const pendingConnectorUseStore =
    bindings.pendingConnectorUseStore ?? new MemoryPendingConnectorUseStore();
  /**
   * lp-u7z / lp-k5c4.12 — BFF-originated chat live events (agent_starting /
   * agent_ready / wake error) fan out from message POST ensure_online to the
   * events SSE. Production injects Postgres LISTEN/NOTIFY for multi-replica.
   */
  const threadLiveEvents =
    bindings.threadLiveEvents ?? createThreadLiveEventsHub();
  /**
   * lp-vqr0.8 — per-app join for detached chat ensure_online so concurrent
   * POSTs share one CP wake instead of stacking CloudFront holds.
   */
  const ensureOnlineFlights = createEnsureOnlineFlightRegistry();
  /**
   * lp-oop.16 / lp-k5c4.12 — latest harness turn per thread so GET events /
   * cancel can pass through without forking the browser contract. Production
   * injects the Postgres registry when CONTROL_PLANE_DATABASE_URL is set.
   */
  const harnessTurns =
    bindings.harnessTurnRegistry ?? createHarnessTurnRegistry();
  const contextPoolStore =
    bindings.contextPoolStore ?? new ContextPoolStore();
  // Wire pool store into chatThreads for automatic append on 1:1 history (any writer)
  try {
    bindings.chatThreads.setContextPoolStore(contextPoolStore);
  } catch {}
  // lp-v62i.18 — single ChannelPoolStore with shared revision_id (collapsed, no alias)
  const channelPoolStore: ChannelPoolStore =
    (bindings as unknown as { channelPoolStore?: ChannelPoolStore }).channelPoolStore ??
    createInMemoryChannelPoolStore();
  const inboundWorkerOwner = randomUUID();
  const mailboxNonces =
    bindings.mailboxNonceStore ?? new MailboxNonceStore();

  const mailboxSpineEnqueue = (): MailboxSpineEnqueue | null => {
    const queue = bindings.inboundQueue;
    const harness = bindings.harnessClient;
    if (!queue || !harness) return null;
    return {
      store: queue,
      startTurn: (request) => harness.startTurn(request),
      owner: inboundWorkerOwner,
      remember: async (threadId, turnId) => {
        await harnessTurns.remember(threadId, turnId);
      },
      persist: {
        harnessClient: harness,
        registry: harnessTurns,
      },
      wake: {
        authClient: bindings.authClient,
        flights: ensureOnlineFlights,
      },
      signalMidTurn: async (item, midTurn) => {
        await signalActivityIfNeeded({
          enabled: Boolean(bindings.signalActivityEnabled),
          authClient: bindings.authClient,
          instanceId: item.instance_id,
          source: inboundActivitySource(item),
          midTurn,
        });
      },
    };
  };

  const mailboxGateway =
    typeof bindings.relayClient.isMailboxFrozen === "function"
      ? bindings.relayClient
      : undefined;
  /**
   * lp-gkh.5 — L10 chat corpus capture (user buffer + SSE-tee finalize).
   * Disabled unless corpusWriter / chatCorpusCapture is injected.
   * Fail-open for chat; fail-closed for enablement (chat_corpus_enabled).
   */
  const chatCorpusCapture: ChatCorpusCapture | null =
    bindings.chatCorpusCapture !== undefined
      ? bindings.chatCorpusCapture
      : createChatCorpusCapture({
          writer: bindings.corpusWriter ?? null,
          isEnabled: bindings.chatCorpusIsEnabled,
          writeTimeoutMs: bindings.chatCorpusWriteTimeoutMs,
        });
  const workflowRunVaultPersist: WorkflowRunVaultPersist | null =
    bindings.workflowRunVaultPersist ?? null;
  /**
   * OnlyOffice mint/download path resolution (lp-k59). Prefer a dedicated
   * provider that understands Brain RPC vault-relative paths under VAULT_ROOT.
   */
  const officeVaultContentProvider =
    bindings.officeVaultContentProvider ?? bindings.vaultContentProvider;
  const officeBinarySource: OfficeBinaryContentSource =
    bindings.officeBinarySource ??
    createVaultOfficeBinaryContentSource(officeVaultContentProvider);
  const officeMaxDownloadBytes = resolveOfficeDownloadMaxBytes(
    bindings.officeMaxDownloadBytes,
  );
  const officeCallbackAllowlist =
    bindings.officeDocumentServerAllowlist ?? loadOfficeCallbackAllowlist();
  const officeCallbackFetcher: OfficeCallbackFetcher =
    bindings.officeCallbackFetcher ??
    createDefaultOfficeCallbackFetcher(officeCallbackAllowlist, {
      // Stream/cap metrics (lp-p37.9) — low-cardinality reasons only.
      onEvent: (event) => {
        officeMetrics.recordCallbackFetch({
          reason: event.reason,
          capped: event.reason === "oversized",
        });
      },
    });
  /**
   * Production composition (lp-t7q.1 / lp-t7q.2 / lp-k7g.8.3+8.4): when
   * BRAIN_RPC_ENABLED, agent projects, settings, and vault browser go through
   * BackendRuntimeService → Brain RPC only. Fixture/local hermes-projects,
   * settings-snapshot, and vault FS/fixture providers remain for offline tests
   * when the flag is off (fail-closed: never silent host-looking fixture data
   * while the flag is on).
   *
   * lp-oop.11 / lp-oop.37.2 / lp-oop.37.3: VaultPlane=cp_s3 takes vault
   * HTTP, Directory, and Settings off this backend. Vault tree lists S3
   * through CP without ensure_online. Chat Directory (`/api/agent/projects`)
   * uses CP vault_path projects. Settings on cp_s3+relay stays snapshot /
   * discover (source fixture|hermes — not guest Brain RPC).
   * lp-oop.38.4: cp_s3 + ChatDelivery=harness GET /settings/snapshot
   * proxies harness HTTP. Opening Tools must not ensure_online a guest.
   */
  const vaultPlane =
    bindings.vaultPlane ??
    (bindings.brainRpcEnabled ? "brain_rpc" : DEFAULT_VAULT_PLANE);
  const brainRpcBackend =
    bindings.backendRuntimeService ??
    (bindings.brainRpcEnabled
      ? createProductionBackendRuntimeService(bindings.relayClient, {
          // lp-7bk: ensure_online before vault/settings/projects Brain RPC
          // (flag default off; failures → BackendRuntimeError → HTTP).
          ensureOnlineEnabled: Boolean(bindings.ensureOnlineOnBrainRpc),
          // lp-96v: signal-activity on Brain RPC (flag default off; best-effort).
          signalActivityEnabled: Boolean(bindings.signalActivityEnabled),
          authClient: bindings.authClient,
        })
      : null);
  const agentProjectsHandlers = brainRpcBackend
    ? createAgentProjectsHandlers(brainRpcBackend)
    : null;
  // lp-oop.37.3 / lp-oop.38.4: Settings SoT on cp_s3 is not guest Brain RPC.
  // relay → BFF snapshot/discover; harness → GET harness settings snapshot.
  // Other planes still use handlers when BRAIN_RPC_ENABLED.
  const settingsHandlers =
    vaultPlane !== "cp_s3" && brainRpcBackend
      ? createSettingsHandlers(brainRpcBackend)
      : null;
  const contextHandlers = brainRpcBackend
    ? createContextHandlers(brainRpcBackend)
    : null;
  const vaultHandlers =
    vaultPlane === "brain_rpc" && brainRpcBackend
      ? createVaultHandlers(brainRpcBackend, { emptyOnUnavailable: true })
      : null;
  const vaultServiceFor = (tenantId: string): VaultService => {
    if (vaultPlane !== "cp_s3") {
      return vaultService;
    }
    const provider = bindings.createCpS3VaultProvider
      ? bindings.createCpS3VaultProvider(tenantId)
      : bindings.vaultContentProvider;
    return new VaultService(provider, bindings.vaultIndexProvider);
  };
  /**
   * lp-oop.13: Office mint revision read uses CP S3 on VaultPlane=cp_s3
   * (same factory as Directory). Explicit officeVaultContentProvider still
   * wins. Default plane unchanged.
   */
  const officeMintVaultFor = (tenantId: string) => {
    if (bindings.officeVaultContentProvider) {
      return bindings.officeVaultContentProvider;
    }
    if (vaultPlane === "cp_s3" && bindings.createCpS3VaultProvider) {
      return bindings.createCpS3VaultProvider(tenantId);
    }
    return officeVaultContentProvider;
  };
  /** lp-ye4.11 — history.list / heads.artifact / heads.workspace HTTP surface. */
  const historyHandlers = brainRpcBackend
    ? createHistoryHandlers(brainRpcBackend)
    : null;
  const app = new Hono<{ Variables: BffVariables }>();

  app.get("/health", (c) =>
    c.json({ status: "ok", service: "bff" }),
  );

  /**
   * Readiness: when sessions are Redis-backed, PING Redis so LBs can drain
   * tasks that cannot reach the shared store (G5). Liveness stays /health only.
   */
  const opsSessions = bindings.opsSessions ?? new MemoryOpsSessionStore();

  app.get("/ready", async (c) => {
    const ready = await bindings.sessions.ready();
    const opsReady = await opsSessions.ready();
    if (!ready || !opsReady) {
      return c.json({ status: "not_ready", service: "bff" }, 503);
    }
    return c.json({ status: "ready", service: "bff" });
  });

  const api = new Hono<{ Variables: BffVariables }>();
  api.use("*", createTenantMiddleware(bindings));

  api.use("*", async (c, next) => {
    const tenant = c.get("tenant");
    // Office DS content/callback without Host tenant (lp-xcu.1): no Portal cookie.
    if (c.get("officeTenantDeferred")) {
      c.set("user", null);
      c.set("rbac", null);
      await next();
      return;
    }
    // lp-xhf4.18: bare APP_HOST OAuth callback defers session bind until
    // handler parses signed state and resolves tenant by id.
    if (c.get("connectorOAuthTenantDeferred")) {
      c.set("user", null);
      c.set("rbac", null);
      await next();
      return;
    }

    const sessionId = readSessionId(c);
    const user = await resolveSessionUser(
      bindings.sessions,
      sessionId,
      tenant.tenant_id,
    );
    c.set("user", user);

    if (user) {
      try {
        const rbac = await bindings.authClient.getUserRbac(
          tenant.tenant_id,
          user.user_id,
        );
        c.set("rbac", rbac);
      } catch (error) {
        if (error instanceof ControlPlaneRequestError) {
          throw new HTTPException(error.status as ContentfulStatusCode, {
            message: error.message,
          });
        }
        throw error;
      }
    } else {
      c.set("rbac", null);
    }

    await next();
  });

  api.get("/context", async (c) => {
    const tenant = c.get("tenant");
    const rbac = c.get("rbac");
    // Same gate as Office edit mint (lp-5q6.26 / lp-5q6.29). Fail closed.
    const vaultEdit = await resolveOfficeVaultEdit(bindings);

    const base = {
      tenant_id: tenant.tenant_id,
      tenant_slug: tenant.tenant_slug,
      display_name: tenant.display_name,
      host: tenant.host,
      allowed_path_prefixes: rbac?.allowed_path_prefixes ?? [],
      role_names: rbac?.role_names ?? [],
      // G3.3 readiness gate for UI: vault/settings/projects host ops remain
      // gated until BRAIN_RPC_ENABLED and a successful /api/brain/ping.
      brain_rpc_enabled: Boolean(bindings.brainRpcEnabled),
      // Honesty planes (lp-oop.37.8): web copy must not claim Relay/Brain RPC
      // when ChatDelivery=harness and VaultPlane=cp_s3.
      chat_delivery: requestChatDelivery(bindings, tenant),
      vault_plane: vaultPlane,
    };

    /**
     * When Brain RPC is enabled, attach backend_capabilities + derived ui
     * (lp-rt5.4 / lp-k7g.8.5) so Settings can hide unsupported sections.
     * Always merge Office vault_edit gate onto ui.can (fail-closed override).
     */
    if (contextHandlers) {
      try {
        // Requires session + RBAC; soft-fail for unauthenticated bootstrap so
        // /api/context still returns tenant + vault_edit (pre-login).
        const runtimeCtx = await resolveBackendRuntimeContext(c, bindings);
        const capsBody = await contextHandlers.get(runtimeCtx);
        const harnessModels =
          base.chat_delivery === "harness"
            ? mergeHarnessModelCapabilities({
                ui: {
                  ...capsBody.ui,
                  can: {
                    ...capsBody.ui.can,
                    vault_edit: vaultEdit,
                  },
                },
                backend_capabilities: capsBody.backend_capabilities,
                vaultEdit,
              })
            : null;
        return c.json({
          ...base,
          backend_capabilities:
            harnessModels?.backend_capabilities ??
            capsBody.backend_capabilities,
          ui: harnessModels
            ? harnessModels.ui
            : {
                ...capsBody.ui,
                can: {
                  ...capsBody.ui.can,
                  vault_edit: vaultEdit,
                },
              },
          capabilities_source: capsBody.capabilities_source,
          capabilities_degraded: capsBody.capabilities_degraded,
          ...(capsBody.capabilities_notes
            ? { capabilities_notes: capsBody.capabilities_notes }
            : {}),
        });
      } catch {
        // Soft-fail capabilities (no session, CP error, etc.): tenant context
        // + vault_edit gate still returned below.
      }
    }

    if (base.chat_delivery === "harness") {
      const harnessModels = mergeHarnessModelCapabilities({ vaultEdit });
      return c.json({
        ...base,
        backend_capabilities: harnessModels.backend_capabilities,
        ui: harnessModels.ui,
      });
    }

    return c.json({
      ...base,
      // Capability-derived UI gates for web affordances (Vault Edit, etc.).
      ui: {
        can: {
          vault_edit: vaultEdit,
        },
      },
    });
  });

  /**
   * G3.3 vertical slice: invoke host `brain.ping` over the authenticated relay.
   * Fail-closed when the flag is off, gateway is disconnected, or host errors.
   */
  api.get("/brain/ping", async (c) => {
    requireBrainRpcEnabled(bindings);
    const tenant = c.get("tenant");
    const user = requireUser(c);
    const rbac = requireUserRbac(c.get("rbac"));
    const sessionId = readSessionId(c) ?? `sess_${user.user_id}`;

    let instanceId: string;
    try {
      const primary = await bindings.authClient.getPrimaryGatewayInstance(
        tenant.tenant_id,
      );
      instanceId = primary.instance_id;
    } catch (error) {
      if (error instanceof ControlPlaneRequestError) {
        throw new HTTPException(error.status as ContentfulStatusCode, {
          message: error.message,
        });
      }
      throw error;
    }

    const echoParam = c.req.query("echo");
    const params: Record<string, unknown> = {};
    if (echoParam !== undefined && echoParam !== "") {
      params.echo = echoParam.slice(0, 64);
    }

    // lp-7bk / lp-kng.2.9: ensure_online before Brain RPC (flag default off).
    // Wake failures surface as the CP status (504 timeout, 502 wake fail, …).
    try {
      await ensureOnlineBeforeBrainRpc({
        enabled: Boolean(bindings.ensureOnlineOnBrainRpc),
        authClient: bindings.authClient,
        instanceId,
      });
    } catch (error) {
      if (error instanceof ControlPlaneRequestError) {
        throw new HTTPException(error.status as ContentfulStatusCode, {
          message: error.message,
        });
      }
      throw error;
    }

    // lp-96v: refresh idle timer from brain_rpc activity (best-effort; no Daytona).
    await signalActivityIfNeeded({
      enabled: Boolean(bindings.signalActivityEnabled),
      authClient: bindings.authClient,
      instanceId,
      source: "brain_rpc",
    });

    const auth = stampBrainRpcAuth({
      tenantId: tenant.tenant_id,
      instanceId,
      userId: user.user_id,
      sessionId,
      rbac,
    });
    const request = buildBrainRpcRequest({
      method: "brain.ping",
      auth,
      params,
    });

    const delivered = await bindings.relayClient.invokeBrainRpc({
      instanceId,
      tenantId: tenant.tenant_id,
      request,
    });

    if (!delivered.ok) {
      // Transport / relay fail-closed: map 502 from deliver-inbound style to 503
      // when the host is simply not connected (unavailable, retryable).
      const status =
        delivered.status === 502 || delivered.status === 503
          ? 503
          : (delivered.status as ContentfulStatusCode);
      throw new HTTPException(status as ContentfulStatusCode, {
        message: delivered.error,
      });
    }

    const frame = delivered.result;
    if (!isBrainRpcHostOk(frame)) {
      const code = frame.error?.code ?? "internal";
      const status = brainRpcErrorToHttpStatus(code) as ContentfulStatusCode;
      throw new HTTPException(status, {
        message: frame.error?.message ?? "The agent could not complete that request.",
      });
    }

    return c.json({
      ok: true,
      method: "brain.ping",
      instance_id: instanceId,
      request_id: frame.request_id,
      result: frame.result,
      meta: frame.meta ?? null,
    });
  });

  /**
   * G3.3 readiness probe for UI gating: same transport as ping, host `brain.health`.
   * Prefer this over /brain/ping when deciding whether vault/settings/projects UI may open.
   */
  api.get("/brain/health", async (c) => {
    requireBrainRpcEnabled(bindings);
    const tenant = c.get("tenant");
    const user = requireUser(c);
    const rbac = requireUserRbac(c.get("rbac"));
    const sessionId = readSessionId(c) ?? `sess_${user.user_id}`;

    let instanceId: string;
    try {
      const primary = await bindings.authClient.getPrimaryGatewayInstance(
        tenant.tenant_id,
      );
      instanceId = primary.instance_id;
    } catch (error) {
      if (error instanceof ControlPlaneRequestError) {
        throw new HTTPException(error.status as ContentfulStatusCode, {
          message: error.message,
        });
      }
      throw error;
    }

    // lp-7bk / lp-kng.2.9: ensure_online before Brain RPC (flag default off).
    try {
      await ensureOnlineBeforeBrainRpc({
        enabled: Boolean(bindings.ensureOnlineOnBrainRpc),
        authClient: bindings.authClient,
        instanceId,
      });
    } catch (error) {
      if (error instanceof ControlPlaneRequestError) {
        throw new HTTPException(error.status as ContentfulStatusCode, {
          message: error.message,
        });
      }
      throw error;
    }

    // lp-96v: refresh idle timer from brain_rpc activity (best-effort; no Daytona).
    await signalActivityIfNeeded({
      enabled: Boolean(bindings.signalActivityEnabled),
      authClient: bindings.authClient,
      instanceId,
      source: "brain_rpc",
    });

    const auth = stampBrainRpcAuth({
      tenantId: tenant.tenant_id,
      instanceId,
      userId: user.user_id,
      sessionId,
      rbac,
    });
    const request = buildBrainRpcRequest({
      method: "brain.health",
      auth,
      params: {},
    });

    const delivered = await bindings.relayClient.invokeBrainRpc({
      instanceId,
      tenantId: tenant.tenant_id,
      request,
    });

    if (!delivered.ok) {
      const status =
        delivered.status === 502 || delivered.status === 503
          ? 503
          : (delivered.status as ContentfulStatusCode);
      throw new HTTPException(status as ContentfulStatusCode, {
        message: delivered.error,
      });
    }

    const frame = delivered.result;
    if (!isBrainRpcHostOk(frame)) {
      const code = frame.error?.code ?? "internal";
      const status = brainRpcErrorToHttpStatus(code) as ContentfulStatusCode;
      throw new HTTPException(status, {
        message: frame.error?.message ?? "The agent could not complete that request.",
      });
    }

    return c.json({
      ok: true,
      method: "brain.health",
      instance_id: instanceId,
      request_id: frame.request_id,
      result: frame.result,
      meta: frame.meta ?? null,
    });
  });

  api.get("/relay/descriptor-preview", (c) => {
    const tenant = c.get("tenant");
    return c.json({
      tenant_id: tenant.tenant_id,
      descriptor: createLanyardWebDescriptor(),
    });
  });

  api.get("/auth/csrf", (c) => {
    const token = createCsrfToken();
    setCsrfCookie(c, token, bindings.config.secureCookies);
    return c.json({ csrf_token: token });
  });

  api.post("/auth/register", csrfProtection, async (c) => {
    const tenant = c.get("tenant");
    const body = registerSchema.parse(await c.req.json());

    const user = await registerPassword(
      bindings,
      tenant,
      body.email,
      body.password,
    );

    if (shouldAutoAssignDemoMember(bindings, tenant)) {
      const memberRoleId = await resolveDemoMemberRoleId(
        bindings.authClient,
        tenant.tenant_id,
        bindings.demoMemberRoleId,
      );
      if (memberRoleId) {
        await bindings.authClient.assignUserRoles({
          tenantId: tenant.tenant_id,
          userId: user.user_id,
          roleIds: [memberRoleId],
        });
      }
    }

    await establishSession(bindings, c, {
      userId: user.user_id,
      tenantId: tenant.tenant_id,
      email: user.email,
    });

    return c.json(
      {
        user_id: user.user_id,
        email: user.email,
        tenant_id: tenant.tenant_id,
      },
      201,
    );
  });

  api.post("/auth/login", csrfProtection, async (c) => {
    const tenant = c.get("tenant");
    const body = loginSchema.parse(await c.req.json());

    const user = await authenticatePassword(
      bindings,
      tenant,
      body.email,
      body.password,
    );

    await establishSession(bindings, c, {
      userId: user.user_id,
      tenantId: tenant.tenant_id,
      email: user.email,
    });

    return c.json({
      user_id: user.user_id,
      email: user.email,
      tenant_id: tenant.tenant_id,
    });
  });

  api.post("/auth/logout", csrfProtection, async (c) => {
    const sessionId = readSessionId(c);
    if (sessionId) {
      await bindings.sessions.delete(sessionId);
    }
    clearSessionCookie(c, bindings.config.secureCookies);
    return c.json({ ok: true });
  });

  api.get("/auth/me", (c) => {
    const user = c.get("user");
    if (!user) {
      throw new HTTPException(401, { message: "Not authenticated" });
    }
    return c.json(user);
  });

  api.get("/auth/google", (c) => {
    const tenant = c.get("tenant");
    if (!bindings.config.googleClientId) {
      throw new HTTPException(503, {
        message: "Google sign-in is not configured (GOOGLE_CLIENT_ID)",
      });
    }

    // Origin from tenant/app allowlist — never raw Host alone (lp-p37.8).
    const originResult = resolveOAuthRedirectOrigin({
      hostHeader: c.req.header("host"),
      tenantHost: tenant.host,
      tenantSlug: tenant.tenant_slug,
      appHosts: bindings.appHosts ?? [],
      secureCookies: bindings.config.secureCookies,
    });
    if (!originResult.ok) {
      throw new HTTPException(400, {
        message: "OAuth redirect host is not allowlisted",
      });
    }
    const redirectUri = `${originResult.origin}${bindings.config.googleRedirectPath}`;
    const state = signOAuthState(
      {
        tenant_id: tenant.tenant_id,
        tenant_slug: tenant.tenant_slug,
        redirect_uri: redirectUri,
      },
      bindings.config.sessionSecret,
    );

    const params = new URLSearchParams({
      client_id: bindings.config.googleClientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      prompt: "select_account",
    });

    return c.redirect(
      `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      302,
    );
  });

  api.get("/auth/google/callback", async (c) => {
    const tenant = c.get("tenant");
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) {
      throw new HTTPException(400, { message: "Missing Google OAuth code or state" });
    }

    const parsedState = verifyOAuthState(state, bindings.config.sessionSecret);
    if (!parsedState || parsedState.tenant_id !== tenant.tenant_id) {
      throw new HTTPException(403, { message: "Invalid OAuth state" });
    }

    const redirectUri = parsedState.redirect_uri;
    if (!redirectUri) {
      throw new HTTPException(400, { message: "OAuth state missing redirect_uri" });
    }

    try {
      const user = await bindings.authClient.googleCallback({
        tenantId: tenant.tenant_id,
        code,
        redirectUri,
      });

      await establishSession(bindings, c, {
        userId: user.user_id,
        tenantId: tenant.tenant_id,
        email: user.email,
      });

      // Browser OAuth navigates here full-page; redirect to the path-first SPA.
      // Return JSON only when Accept clearly prefers application/json and does
      // not prefer text/html (browsers often send both — default redirect).
      const accept = c.req.header("accept") ?? "";
      const prefersJson = /\bapplication\/json\b/i.test(accept);
      const prefersHtml = /\btext\/html\b/i.test(accept);
      if (prefersJson && !prefersHtml) {
        return c.json({
          user_id: user.user_id,
          email: user.email,
          tenant_id: tenant.tenant_id,
          provider: "google",
        });
      }

      return c.redirect(`/${tenant.tenant_slug}/`, 302);
    } catch (error) {
      if (error instanceof ControlPlaneRequestError) {
        throw new HTTPException(error.status as ContentfulStatusCode, {
          message: error.message,
        });
      }
      throw error;
    }
  });

  /**
   * Agent working directories (source of truth for chat Directory).
   * Preferred: GET|POST /api/agent/projects
   * Legacy alias: GET|POST /api/hermes/projects (+ deprecation headers)
   * VaultPlane=cp_s3: CP vault_path projects (no Brain RPC, no sandbox wake).
   * Production (BRAIN_RPC_ENABLED, other planes): Brain RPC projects.list/create.
   * Offline tests: local hermesProjects fixture / projects.db.
   */
  const hermesProjectFromCp = (project: {
    project_id: string;
    name: string;
    vault_path: string;
  }): HermesProject => {
    const path = project.vault_path.trim();
    return {
      id: project.project_id,
      slug: project.project_id,
      name: project.name,
      primary_path: path || null,
      folders: path ? [{ path, is_primary: true }] : [],
    };
  };

  const listAgentProjects = async (c: Context<{ Variables: BffVariables }>) => {
    requireUser(c);
    requireUserRbac(c.get("rbac"));

    if (vaultPlane === "cp_s3") {
      const tenant = c.get("tenant");
      const user = requireUser(c);
      try {
        const rows = await bindings.authClient.listProjects(
          tenant.tenant_id,
          user.user_id,
        );
        return c.json({ projects: rows.map(hermesProjectFromCp) });
      } catch (error) {
        if (error instanceof ControlPlaneRequestError) {
          throw new HTTPException(error.status as ContentfulStatusCode, {
            message: error.message,
          });
        }
        throw error;
      }
    }

    if (agentProjectsHandlers) {
      try {
        const ctx = await resolveBackendRuntimeContext(c, bindings);
        const body = await agentProjectsHandlers.list(ctx);
        return c.json(body);
      } catch (error) {
        if (error instanceof HTTPException) throw error;
        const mapped = agentProjectsErrorToHttp(error);
        return c.json(mapped.body, mapped.status as ContentfulStatusCode);
      }
    }

    const projects = hermesProjects.listProjects();
    return c.json({ projects });
  };

  const createAgentProject = async (
    c: Context<{ Variables: BffVariables }>,
  ) => {
    requireUser(c);
    requireUserRbac(c.get("rbac"));
    const body = createHermesProjectSchema.parse(await c.req.json());

    if (vaultPlane === "cp_s3") {
      const tenant = c.get("tenant");
      const user = requireUser(c);
      const vault_path = (body.folders?.[0] ?? `/${body.name}`).trim();
      try {
        const created = await bindings.authClient.createProject({
          tenantId: tenant.tenant_id,
          userId: user.user_id,
          name: body.name,
          vault_path,
        });
        return c.json(hermesProjectFromCp(created), 201);
      } catch (error) {
        if (error instanceof ControlPlaneRequestError) {
          throw new HTTPException(error.status as ContentfulStatusCode, {
            message: error.message,
          });
        }
        throw error;
      }
    }

    if (agentProjectsHandlers) {
      try {
        const ctx = await resolveBackendRuntimeContext(c, bindings);
        const project = await agentProjectsHandlers.create(ctx, body);
        return c.json(project, 201);
      } catch (error) {
        if (error instanceof HTTPException) throw error;
        const mapped = agentProjectsErrorToHttp(error);
        return c.json(mapped.body, mapped.status as ContentfulStatusCode);
      }
    }

    try {
      const project = await hermesProjects.createProject({
        name: body.name,
        folders: body.folders,
      });
      return c.json(project, 201);
    } catch (error) {
      if (error instanceof HermesCliNotFoundError) {
        // Honest fail-closed: do not suggest installing Hermes on cloud BFF or
        // running create against host-only paths the BFF cannot reach.
        throw new HTTPException(503, {
          message: error.message,
        });
      }
      if (error instanceof HermesProjectCreateError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }
  };

  const withLegacyProjectsDeprecation = async (
    c: Context<{ Variables: BffVariables }>,
    next: () => Promise<void>,
  ) => {
    const headers = deprecationHeadersForLegacyPath("/api/hermes/projects");
    if (headers) {
      for (const [name, value] of Object.entries(headers)) {
        c.header(name, value);
      }
    }
    await next();
  };

  const deleteAgentProjectRoute = async (
    c: Context<{ Variables: BffVariables }>,
  ) => {
    requireUser(c);
    requireUserRbac(c.get("rbac"));
    const projectId = c.req.param("id")?.trim() ?? "";
    if (!projectId) {
      throw new HTTPException(400, { message: "project id required" });
    }
    if (vaultPlane === "cp_s3") {
      const tenant = c.get("tenant");
      const user = requireUser(c);
      try {
        await bindings.authClient.deleteProject(
          tenant.tenant_id,
          user.user_id,
          projectId,
        );
        return c.json({ ok: true, id: projectId });
      } catch (error) {
        if (error instanceof ControlPlaneRequestError) {
          throw new HTTPException(error.status as ContentfulStatusCode, {
            message: error.message,
          });
        }
        throw error;
      }
    }

    if (agentProjectsHandlers) {
      try {
        const ctx = await resolveBackendRuntimeContext(c, bindings);
        const result = await agentProjectsHandlers.delete(ctx, projectId);
        return c.json(result);
      } catch (error) {
        if (error instanceof HTTPException) throw error;
        const mapped = agentProjectsErrorToHttp(error);
        return c.json(mapped.body, mapped.status as ContentfulStatusCode);
      }
    }
    throw new HTTPException(503, {
      message:
        "Deleting a project is unavailable right now.",
    });
  };

  // Preferred agent projects routes (lp-rt5.3).
  api.get("/agent/projects", listAgentProjects);
  api.post("/agent/projects", csrfProtection, createAgentProject);
  api.delete(
    "/agent/projects/:id",
    csrfProtection,
    deleteAgentProjectRoute,
  );
  // Legacy Hermes-named dual-mount with deprecation headers.
  api.get("/hermes/projects", withLegacyProjectsDeprecation, listAgentProjects);
  api.post(
    "/hermes/projects",
    csrfProtection,
    withLegacyProjectsDeprecation,
    createAgentProject,
  );
  api.delete(
    "/hermes/projects/:id",
    csrfProtection,
    withLegacyProjectsDeprecation,
    deleteAgentProjectRoute,
  );

  api.get("/projects", async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    requireUserRbac(c.get("rbac"));

    try {
      const projects = await bindings.authClient.listProjects(
        tenant.tenant_id,
        user.user_id,
      );
      return c.json({ projects });
    } catch (error) {
      if (error instanceof ControlPlaneRequestError) {
        throw new HTTPException(error.status as ContentfulStatusCode, {
          message: error.message,
        });
      }
      throw error;
    }
  });

  api.post("/projects", csrfProtection, async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    requireUserRbac(c.get("rbac"));
    const body = createProjectSchema.parse(await c.req.json());

    try {
      const project = await bindings.authClient.createProject({
        tenantId: tenant.tenant_id,
        userId: user.user_id,
        name: body.name,
        vault_path: body.vault_path,
        parent_project_id: body.parent_project_id ?? null,
      });
      return c.json(project, 201);
    } catch (error) {
      if (error instanceof ControlPlaneRequestError) {
        throw new HTTPException(error.status as ContentfulStatusCode, {
          message: error.message,
        });
      }
      throw error;
    }
  });

  api.get("/projects/:projectId", async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    requireUserRbac(c.get("rbac"));

    try {
      const project = await bindings.authClient.getProject(
        tenant.tenant_id,
        user.user_id,
        c.req.param("projectId"),
      );
      if (!project) {
        throw new HTTPException(404, { message: "Project not found" });
      }
      return c.json(project);
    } catch (error) {
      if (error instanceof ControlPlaneRequestError) {
        throw new HTTPException(error.status as ContentfulStatusCode, {
          message: error.message,
        });
      }
      throw error;
    }
  });

  api.put("/projects/:projectId", csrfProtection, async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    requireUserRbac(c.get("rbac"));
    const body = updateProjectSchema.parse(await c.req.json());

    try {
      const project = await bindings.authClient.updateProject({
        tenantId: tenant.tenant_id,
        userId: user.user_id,
        projectId: c.req.param("projectId"),
        name: body.name,
        vault_path: body.vault_path,
      });
      return c.json(project);
    } catch (error) {
      if (error instanceof ControlPlaneRequestError) {
        throw new HTTPException(error.status as ContentfulStatusCode, {
          message: error.message,
        });
      }
      throw error;
    }
  });

  api.delete("/projects/:projectId", csrfProtection, async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    requireUserRbac(c.get("rbac"));

    try {
      await bindings.authClient.deleteProject(
        tenant.tenant_id,
        user.user_id,
        c.req.param("projectId"),
      );
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof ControlPlaneRequestError) {
        throw new HTTPException(error.status as ContentfulStatusCode, {
          message: error.message,
        });
      }
      throw error;
    }
  });

  function personaVaultRoot(): string {
    const root = process.env.VAULT_ROOT?.trim();
    if (!root) {
      throw new HTTPException(503, {
        message: "VAULT_ROOT is required for agent personas",
      });
    }
    return root;
  }

  function requireOwnedAgent(c: {
    get: (key: "tenant" | "rbac") => unknown;
    req: { param: (name: string) => string };
  }) {
    const tenant = c.get("tenant") as { tenant_id: string };
    const user = requireUser(c as never);
    requireUserRbac(c.get("rbac"));
    const agent = bindings.chatThreads.getAgentForUser(
      c.req.param("id"),
      tenant.tenant_id,
      user.user_id,
    );
    if (!agent) {
      throw new HTTPException(404, { message: "Agent not found" });
    }
    return agent;
  }

  /**
   * lp-cxhb.2: Durable agent catalog. Each row is a person with exactly one
   * interactive 1:1. Second POST mints a different agent_id.
   */
  api.get("/agents", async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    requireUserRbac(c.get("rbac"));
    const agents = bindings.chatThreads.listAgents(
      tenant.tenant_id,
      user.user_id,
    );
    return c.json({ agents: agents.map(agentSummaryJson) });
  });

  api.post("/agents", csrfProtection, async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    requireUserRbac(c.get("rbac"));
    const body = createAgentSchema.parse(
      await c.req.json().catch(() => ({})),
    );
    const agent = bindings.chatThreads.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: user.user_id,
      name: body.name,
      avatar: body.avatar,
      objective: body.objective,
    });
    return c.json(agentSummaryJson(agent), 201);
  });

  /**
   * lp-bhcg.3: each persona stores its own base URL, API key, cron list,
   * and memory files. The key is not returned.
   */
  api.get("/agents/:id/backend", async (c) => {
    const agent = requireOwnedAgent(c);
    const root = personaVaultRoot();
    const stored = await loadAgentBackend(root, agent.agent_id);
    return c.json(agentBackendPublicView(stored));
  });

  api.put("/agents/:id/backend", csrfProtection, async (c) => {
    const agent = requireOwnedAgent(c);
    const body = agentBackendPutSchema.parse(
      await c.req.json().catch(() => ({})),
    );
    await saveAgentBackend(personaVaultRoot(), agent.agent_id, {
      baseUrl: body.base_url.replace(/\/$/, ""),
      apiKey: body.api_key,
      protocol: body.protocol,
      model: body.model?.trim() || "default",
    });
    const stored = await loadAgentBackend(personaVaultRoot(), agent.agent_id);
    return c.json(agentBackendPublicView(stored));
  });

  api.get("/agents/:id/crons", async (c) => {
    const agent = requireOwnedAgent(c);
    const jobs = await listAgentCrons(personaVaultRoot(), agent.agent_id);
    return c.json({ jobs });
  });

  api.put("/agents/:id/crons", csrfProtection, async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    const agent = requireOwnedAgent(c);
    const body = agentCronsPutSchema.parse(
      await c.req.json().catch(() => ({})),
    );
    const jobs = await saveAgentCrons(
      personaVaultRoot(),
      agent.agent_id,
      body.jobs,
    );
    for (const job of jobs) {
      bindings.chatThreads.ensureForJob({
        tenant_id: tenant.tenant_id,
        user_id: user.user_id,
        job_id: personaJobThreadId(agent.agent_id, job.id),
        name: job.name,
        agent_id: agent.agent_id,
      });
    }
    return c.json({ jobs });
  });

  api.get("/agents/:id/memory", async (c) => {
    const agent = requireOwnedAgent(c);
    const files = await listAgentMemory(personaVaultRoot(), agent.agent_id);
    return c.json({ files });
  });

  api.get("/agents/:id/memory/:name", async (c) => {
    const agent = requireOwnedAgent(c);
    try {
      const content = await readAgentMemory(
        personaVaultRoot(),
        agent.agent_id,
        c.req.param("name"),
      );
      if (content === null) {
        throw new HTTPException(404, { message: "Memory file not found" });
      }
      return c.json({ name: c.req.param("name"), content });
    } catch (error) {
      if (error instanceof AgentPersonaPathError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }
  });

  api.put("/agents/:id/memory/:name", csrfProtection, async (c) => {
    const agent = requireOwnedAgent(c);
    const body = agentMemoryPutSchema.parse(
      await c.req.json().catch(() => ({})),
    );
    try {
      await writeAgentMemory(
        personaVaultRoot(),
        agent.agent_id,
        c.req.param("name"),
        body.content,
      );
    } catch (error) {
      if (error instanceof AgentPersonaPathError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }
    return c.json({ name: c.req.param("name"), bytes: Buffer.byteLength(body.content) });
  });

  api.patch("/agents/:id", csrfProtection, async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    requireUserRbac(c.get("rbac"));
    const body = renameAgentSchema.parse(
      await c.req.json().catch(() => ({})),
    );
    const agent = bindings.chatThreads.renameAgent({
      agent_id: c.req.param("id"),
      tenant_id: tenant.tenant_id,
      user_id: user.user_id,
      name: body.name,
    });
    if (!agent) {
      throw new HTTPException(404, { message: "Agent not found" });
    }
    return c.json(agentSummaryJson(agent));
  });

  /**
   * lp-cxhb.5: Named channel. Required name, ≥2 durable-agent members.
   * First member is the create-time lead. Membership is a pointer, not a copy.
   */
  api.get("/channels", async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    requireUserRbac(c.get("rbac"));
    const channels = bindings.chatThreads.listChannels(
      tenant.tenant_id,
      user.user_id,
    );
    return c.json({ channels: channels.map(channelSummaryJson) });
  });

  api.post("/channels", csrfProtection, async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    requireUserRbac(c.get("rbac"));
    const body = (await c.req.json().catch(() => ({}))) as {
      name?: unknown;
      member_agent_ids?: unknown;
    };
    try {
      const channel = bindings.chatThreads.createChannel({
        tenant_id: tenant.tenant_id,
        user_id: user.user_id,
        name: body.name,
        member_agent_ids: body.member_agent_ids,
      });
      return c.json(channelSummaryJson(channel), 201);
    } catch (error) {
      if (error instanceof CreateChannelError) {
        return c.json(
          { error: error.message, issues: error.issues },
          400,
        );
      }
      throw error;
    }
  });

  /**
   * lp-cxhb.6: Membership after create. Floor of two. Delete keeps agents.
   */
  api.get("/channels/:threadId", async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    requireUserRbac(c.get("rbac"));
    const channel = bindings.chatThreads.getChannelForUser(
      c.req.param("threadId"),
      tenant.tenant_id,
      user.user_id,
    );
    if (!channel) {
      throw new HTTPException(404, { message: "Channel not found" });
    }
    return c.json(channelSummaryJson(channel));
  });

  api.patch("/channels/:threadId", csrfProtection, async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    requireUserRbac(c.get("rbac"));
    const body = (await c.req.json().catch(() => ({}))) as {
      lead_agent_id?: unknown;
    };
    try {
      const channel = bindings.chatThreads.setChannelLead({
        thread_id: c.req.param("threadId"),
        tenant_id: tenant.tenant_id,
        user_id: user.user_id,
        lead_agent_id: body.lead_agent_id,
      });
      if (!channel) {
        throw new HTTPException(404, { message: "Channel not found" });
      }
      return c.json(channelSummaryJson(channel));
    } catch (error) {
      if (error instanceof SetChannelLeadError) {
        return c.json({ error: error.message, issues: error.issues }, 400);
      }
      throw error;
    }
  });

  api.post("/channels/:threadId/members", csrfProtection, async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    requireUserRbac(c.get("rbac"));
    const body = (await c.req.json().catch(() => ({}))) as {
      agent_id?: unknown;
    };
    try {
      const channel = bindings.chatThreads.addChannelMember({
        thread_id: c.req.param("threadId"),
        tenant_id: tenant.tenant_id,
        user_id: user.user_id,
        agent_id: body.agent_id,
      });
      return c.json(channelSummaryJson(channel), 201);
    } catch (error) {
      if (error instanceof ChannelNotFoundError) {
        throw new HTTPException(404, { message: "Channel not found" });
      }
      if (error instanceof CreateChannelError) {
        return c.json(
          { error: error.message, issues: error.issues },
          400,
        );
      }
      throw error;
    }
  });

  api.delete(
    "/channels/:threadId/members/:agentId",
    csrfProtection,
    async (c) => {
      const tenant = c.get("tenant");
      const user = requireUser(c);
      requireUserRbac(c.get("rbac"));
      const threadId = c.req.param("threadId");
      const agentId = c.req.param("agentId");
      try {
        // lp-cxhb.9: lead succession runs before the removal. The picker
        // races a timeout, so the delete is never blocked on the model.
        const existing = bindings.chatThreads.getChannelForUser(
          threadId,
          tenant.tenant_id,
          user.user_id,
        );
        let successorAgentId: string | undefined;
        if (
          existing &&
          existing.lead_agent_id === agentId &&
          existing.members.length - 1 >= 2
        ) {
          const candidates = existing.members
            .filter((member) => member.agent_id !== agentId)
            .map((member) => ({
              agent_id: member.agent_id,
              name: bindings.chatThreads.getAgent(member.agent_id)?.name,
              objective:
                bindings.chatThreads.getAgent(member.agent_id)?.objective,
              joined_at: member.joined_at,
            }));
          if (bindings.leadSuccessionPicker && candidates.length > 0) {
            const log = bindings.chatThreads
              .listHistory(threadId)
              .slice(-40)
              .map((event) => ({
                speaker:
                  event.type === "system_notice"
                    ? null
                    : (event.speaker?.display_name ?? null),
                content: event.content ?? "",
              }));
            const context: SuccessionContext = {
              channel_name: existing.name,
              log,
              candidates,
            };
            successorAgentId = (
              await resolveLeadSuccessor({
                picker: bindings.leadSuccessionPicker,
                context,
                timeoutMs: bindings.leadSuccessionTimeoutMs,
              })
            )?.agent_id;
          }
        }
        const channel = bindings.chatThreads.removeChannelMember({
          thread_id: threadId,
          tenant_id: tenant.tenant_id,
          user_id: user.user_id,
          agent_id: agentId,
          successor_agent_id: successorAgentId,
        });
        return c.json(channelSummaryJson(channel));
      } catch (error) {
        if (error instanceof ChannelNotFoundError) {
          throw new HTTPException(404, { message: "Channel not found" });
        }
        if (error instanceof CreateChannelError) {
          return c.json(
            { error: error.message, issues: error.issues },
            400,
          );
        }
        throw error;
      }
    },
  );

  api.delete("/channels/:threadId", csrfProtection, async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    requireUserRbac(c.get("rbac"));
    const deleted = bindings.chatThreads.deleteChannel({
      thread_id: c.req.param("threadId"),
      tenant_id: tenant.tenant_id,
      user_id: user.user_id,
    });
    if (!deleted) {
      throw new HTTPException(404, { message: "Channel not found" });
    }
    return c.json({ ok: true });
  });

  api.get("/chat/threads", async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    requireUserRbac(c.get("rbac"));

    const owned = bindings.chatThreads.listForOwner(tenant.tenant_id, user.user_id);
    let grants;
    try {
      grants = await bindings.authClient.listSessionSharesForGrantee(
        tenant.tenant_id,
        user.user_id,
      );
    } catch (error) {
      if (error instanceof ControlPlaneRequestError) {
        throw new HTTPException(error.status as ContentfulStatusCode, {
          message: error.message,
        });
      }
      throw error;
    }

    const shared = grants
      .map((grant) => {
        const thread = bindings.chatThreads.getInTenant(
          grant.thread_id,
          tenant.tenant_id,
        );
        if (!thread) return null;
        return {
          ...threadSummaryJson(thread),
          access: grant.mode,
          owner_user_id: grant.owner_user_id,
          grant_id: grant.grant_id,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    return c.json({
      threads: [
        ...owned.map((thread) => ({
          ...threadSummaryJson(thread),
          access: "owner" as const,
        })),
        ...shared,
      ],
    });
  });

  /**
   * Speculative wake on /chat land (lp-vqr0.9 / T7). Silent: no
   * agent_starting. Joins the same flight Send uses. Fail-open so a
   * CP blip does not break opening chat; Send still has the lazy path.
   */
  api.post("/chat/ensure-online", csrfProtection, async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    requireUserRbac(c.get("rbac"));
    const chatDelivery = requestChatDelivery(bindings, tenant);
    try {
      const result = await kickSpeculativeEnsureOnline({
        enabled: Boolean(bindings.ensureOnlineOnChat),
        chatDelivery,
        authClient: bindings.authClient,
        tenantId: tenant.tenant_id,
        userId: user.user_id,
        flights: ensureOnlineFlights,
      });
      const status = result.action === "waking" ? 202 : 200;
      return c.json({ ok: true, ...result }, status);
    } catch {
      return c.json({ ok: true, action: "skipped", reason: "error" }, 200);
    }
  });

  api.post("/chat/threads", csrfProtection, async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    requireUserRbac(c.get("rbac"));
    const body = createThreadSchema.parse(await c.req.json().catch(() => ({})));

    let projectId: string | null = null;
    let projectVaultPath: string | null = null;
    let title = body.title;

    if (body.project_id) {
      // Production (BRAIN_RPC_ENABLED): resolve via Brain RPC projects.list so
      // host projects (Legal/Operations) bind project_vault_path=primary_path.
      // Offline: local hermesProjects store remains SoT for agent cwd.
      if (agentProjectsHandlers) {
        try {
          const ctx = await resolveBackendRuntimeContext(c, bindings);
          const listed = await agentProjectsHandlers.list(ctx);
          const project = listed.projects.find((p) => p.id === body.project_id);
          if (!project) {
            throw new HTTPException(404, { message: "Project not found" });
          }
          projectId = project.id;
          projectVaultPath = project.primary_path ?? null;
          if (!title) {
            title = project.name;
          }
        } catch (error) {
          if (error instanceof HTTPException) throw error;
          const mapped = agentProjectsErrorToHttp(error);
          return c.json(mapped.body, mapped.status as ContentfulStatusCode);
        }
      } else {
        const project = hermesProjects.getProject(body.project_id);
        if (!project) {
          throw new HTTPException(404, { message: "Project not found" });
        }
        projectId = project.id;
        projectVaultPath = project.primary_path;
        if (!title) {
          title = project.name;
        }
      }
    }

    // When scheduled_job_id is supplied, prefer idempotent ensure so create
    // flags cannot double-allocate streams for the same job (lp-fn5.5.1).
    if (body.scheduled_job_id) {
      const jobName = title?.trim() || body.scheduled_job_id;
      try {
        const outcome = bindings.chatThreads.ensureForJob({
          tenant_id: tenant.tenant_id,
          user_id: user.user_id,
          job_id: body.scheduled_job_id,
          name: jobName,
          agent_id: body.agent_id,
        });
        return c.json(
          {
            ...threadSummaryJson(outcome.thread),
            created: outcome.created,
          },
          outcome.created ? 201 : 200,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Invalid job binding";
        throw new HTTPException(400, { message });
      }
    }

    const thread = bindings.chatThreads.create({
      tenant_id: tenant.tenant_id,
      user_id: user.user_id,
      title,
      project_id: projectId,
      project_vault_path: projectVaultPath,
      kind: body.kind,
      title_source: body.title_source,
    });

    return c.json(threadSummaryJson(thread), 201);
  });

  /**
   * lp-fn5.5.1: Idempotent ensure of the durable scheduled-task stream chat
   * for a job. Same owner+job_id → same thread_id; title=job name;
   * kind=scheduled_task; title_source=job.
   */
  api.post("/chat/threads/ensure-for-job", csrfProtection, async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    requireUserRbac(c.get("rbac"));
    const body = ensureThreadForJobSchema.parse(
      await c.req.json().catch(() => ({})),
    );

    try {
      const outcome = bindings.chatThreads.ensureForJob({
        tenant_id: tenant.tenant_id,
        user_id: user.user_id,
        job_id: body.job_id,
        name: body.name,
        agent_id: body.agent_id,
      });
      return c.json(
        {
          ...threadSummaryJson(outcome.thread),
          created: outcome.created,
        },
        outcome.created ? 201 : 200,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid ensure-for-job body";
      throw new HTTPException(400, { message });
    }
  });

  api.patch("/chat/threads/:threadId", csrfProtection, async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    requireUserRbac(c.get("rbac"));
    const threadId = c.req.param("threadId");
    const thread = bindings.chatThreads.getForUser(
      threadId,
      tenant.tenant_id,
      user.user_id,
    );
    if (!thread) {
      throw new HTTPException(404, { message: "Chat thread not found" });
    }

    const body = updateThreadSchema.parse(await c.req.json());
    let updated: ChatThread | null = thread;

    if (body.title !== undefined) {
      updated = bindings.chatThreads.updateTitle(threadId, body.title, {
        title_source: body.title_source,
      });
      if (!updated) {
        throw new HTTPException(400, { message: "Invalid thread title" });
      }
    }

    if (body.system_prompt !== undefined) {
      // Header editor save always owns the prompt (lp-lv9.4).
      // Explicit client source only when provided; default PATCH ownership is user.
      const source =
        body.system_prompt_source === "default" ||
        body.system_prompt_source === "llm" ||
        body.system_prompt_source === "user"
          ? body.system_prompt_source
          : "user";
      // Empty string clears purpose; otherwise cap via sanitize.
      const sanitized = sanitizeSystemPrompt(body.system_prompt);
      const nextPrompt = sanitized ?? "";
      updated = bindings.chatThreads.updateSystemPrompt(threadId, nextPrompt, {
        system_prompt_source: source,
      });
      if (!updated) {
        throw new HTTPException(400, { message: "Invalid system prompt" });
      }
    }

    return c.json(threadSummaryJson(updated));
  });

  /**
   * lp-fn5.3.4 / lp-lv9.3 / lp-pxr.2 / lp-7st.1: Assign agent display name.
   * - Bootstrap (empty message, eager on create): always generic "New agent"
   *   when title_source=default — no host RPC, no keyword map
   * - Refine (first user message): when title_source is default|llm, prefer
   *   host `chat.suggest_title` (model invents a short name); else neutral
   *   offline hash-pool fixture (never a product Hound/Scout keyword map)
   * Never overwrites user|job.
   */
  api.post(
    "/chat/threads/:threadId/assign-name",
    csrfProtection,
    async (c) => {
      const tenant = c.get("tenant");
      const user = requireUser(c);
      const rbac = requireUserRbac(c.get("rbac"));
      const threadId = c.req.param("threadId");
      const thread = bindings.chatThreads.getForUser(
        threadId,
        tenant.tenant_id,
        user.user_id,
      );
      if (!thread) {
        throw new HTTPException(404, { message: "Chat thread not found" });
      }

      const body = assignThreadNameSchema.parse(
        await c.req.json().catch(() => ({})),
      );
      const message = body.message ?? "";
      const bootstrap = isBootstrapAssignMessage(message);

      // Sticky user renames / job streams — never overwrite.
      if (!canAssignLlmTitle(thread.title_source)) {
        return c.json({
          ...threadSummaryJson(thread),
          applied: false,
          name_source: null,
          skipped_reason: "title_source",
        });
      }
      // Late eager bootstrap must not clobber a first-message refine (llm).
      if (bootstrap && !canAssignBootstrapTitle(thread.title_source)) {
        return c.json({
          ...threadSummaryJson(thread),
          applied: false,
          name_source: null,
          skipped_reason: null,
        });
      }

      let resolvedName: string | null = null;
      let nameSource: "host" | "fixture" = "fixture";

      // Bootstrap naming moment is deferred to first-message refine (lp-7st.1).
      // Always leave the generic title — do not call host or keyword maps.
      if (bootstrap) {
        resolvedName = fixtureAgentNameFromMessage(message);
        nameSource = "fixture";
      } else if (bindings.brainRpcEnabled) {
        try {
          const primary = await bindings.authClient.getPrimaryGatewayInstance(
            tenant.tenant_id,
          );
          const sessionId = readSessionId(c) ?? `sess_${user.user_id}`;
          try {
            await ensureOnlineBeforeBrainRpc({
              enabled: Boolean(bindings.ensureOnlineOnBrainRpc),
              authClient: bindings.authClient,
              instanceId: primary.instance_id,
            });
          } catch {
            // Soft-fail: fall through to fixture namer.
          }
          const auth = stampBrainRpcAuth({
            tenantId: tenant.tenant_id,
            instanceId: primary.instance_id,
            userId: user.user_id,
            sessionId,
            rbac,
          });
          const request = buildBrainRpcRequest({
            method: CHAT_SUGGEST_TITLE_METHOD,
            auth,
            params: {
              thread_id: thread.thread_id,
              message: message.slice(0, 8_000),
              // Host models invent a codename; not a prompt word-snippet.
              instruction: CHAT_SUGGEST_TITLE_PROMPT,
              prompt: CHAT_SUGGEST_TITLE_PROMPT,
            },
            timeoutMs: 8_000,
          });
          const delivered = await bindings.relayClient.invokeBrainRpc({
            instanceId: primary.instance_id,
            tenantId: tenant.tenant_id,
            request,
          });
          if (
            delivered.ok &&
            isBrainRpcHostOk(delivered.result) &&
            delivered.result.result
          ) {
            const hostName = titleFromSuggestTitleResult(
              delivered.result.result,
            );
            if (hostName) {
              resolvedName = hostName;
              nameSource = "host";
            }
          }
        } catch {
          // Host/brain RPC optional for naming — fixture below.
        }
      }

      if (!resolvedName) {
        // Neutral hash-pool fixture only (no product keyword → Hound map).
        resolvedName = fixtureAgentNameFromMessage(message);
        nameSource = "fixture";
      }

      // Re-check policy immediately before write (TOCTOU after async Brain RPC).
      // Bootstrap must still see title_source=default; refine still blocks user|job.
      const latest = bindings.chatThreads.get(threadId);
      if (!latest) {
        throw new HTTPException(404, { message: "Chat thread not found" });
      }
      if (bootstrap && !canAssignBootstrapTitle(latest.title_source)) {
        return c.json({
          ...threadSummaryJson(latest),
          applied: false,
          name_source: null,
          skipped_reason: null,
        });
      }
      if (!bootstrap && !canAssignLlmTitle(latest.title_source)) {
        return c.json({
          ...threadSummaryJson(latest),
          applied: false,
          name_source: null,
          skipped_reason: "title_source",
        });
      }

      const outcome = bindings.chatThreads.assignLlmTitle(
        threadId,
        resolvedName,
        { mode: bootstrap ? "bootstrap" : "refine" },
      );
      if (!outcome) {
        throw new HTTPException(400, { message: "Invalid agent name" });
      }

      return c.json({
        ...threadSummaryJson(outcome.thread),
        applied: outcome.applied,
        name_source: outcome.applied ? nameSource : null,
        // Late bootstrap over llm is policy (null); sticky user|job → title_source.
        skipped_reason: outcome.applied
          ? null
          : outcome.thread.title_source === "user" ||
              outcome.thread.title_source === "job"
            ? "title_source"
            : null,
      });
    },
  );

  /**
   * lp-lv9.4: Assign a short per-thread purpose prompt after 1–2 turns.
   * Interactive kind only. Applies only when system_prompt_source is still
   * `default` (never overwrites user edits; generate once). Prefer host
   * `chat.suggest_purpose` when brain RPC is enabled; else offline fixture.
   */
  api.post(
    "/chat/threads/:threadId/assign-system-prompt",
    csrfProtection,
    async (c) => {
      const tenant = c.get("tenant");
      const user = requireUser(c);
      const rbac = requireUserRbac(c.get("rbac"));
      const threadId = c.req.param("threadId");
      const thread = bindings.chatThreads.getForUser(
        threadId,
        tenant.tenant_id,
        user.user_id,
      );
      if (!thread) {
        throw new HTTPException(404, { message: "Chat thread not found" });
      }

      const body = assignThreadSystemPromptSchema.parse(
        await c.req.json().catch(() => ({})),
      );
      const messages =
        body.messages && body.messages.length > 0
          ? body.messages
          : body.message !== undefined
            ? [body.message]
            : [];

      // Fall back to durable history when client omits context.
      const history = bindings.chatThreads.listHistory(threadId);
      const historyUserMessages = history
        .filter(
          (event): event is Extract<typeof event, { type: "user_message" }> =>
            event.type === "user_message",
        )
        .map((event) => event.content);
      const contextMessages =
        messages.length > 0 ? messages : historyUserMessages;
      const completedTurnCount = countCompletedUserTurns(history);

      if (
        !shouldGenerateSystemPrompt({
          kind: thread.kind,
          system_prompt_source: thread.system_prompt_source,
          completedTurnCount: Math.max(
            completedTurnCount,
            contextMessages.filter((m) => m.trim()).length,
          ),
        })
      ) {
        const skipped =
          thread.kind !== "chat"
            ? "kind"
            : !canAssignLlmSystemPrompt(thread.system_prompt_source)
              ? "system_prompt_source"
              : "turn_count";
        return c.json({
          ...threadSummaryJson(thread),
          applied: false,
          prompt_source: null,
          skipped_reason: skipped,
        });
      }

      let resolvedPrompt: string | null = null;
      let promptSource: "host" | "fixture" = "fixture";

      if (bindings.brainRpcEnabled) {
        try {
          const primary = await bindings.authClient.getPrimaryGatewayInstance(
            tenant.tenant_id,
          );
          const sessionId = readSessionId(c) ?? `sess_${user.user_id}`;
          try {
            await ensureOnlineBeforeBrainRpc({
              enabled: Boolean(bindings.ensureOnlineOnBrainRpc),
              authClient: bindings.authClient,
              instanceId: primary.instance_id,
            });
          } catch {
            // Soft-fail: fall through to fixture summarizer.
          }
          const auth = stampBrainRpcAuth({
            tenantId: tenant.tenant_id,
            instanceId: primary.instance_id,
            userId: user.user_id,
            sessionId,
            rbac,
          });
          const request = buildBrainRpcRequest({
            method: CHAT_SUGGEST_PURPOSE_METHOD,
            auth,
            params: {
              thread_id: thread.thread_id,
              messages: contextMessages.map((m) => m.slice(0, 8_000)).slice(0, 8),
            },
            timeoutMs: 8_000,
          });
          const delivered = await bindings.relayClient.invokeBrainRpc({
            instanceId: primary.instance_id,
            tenantId: tenant.tenant_id,
            request,
          });
          if (
            delivered.ok &&
            isBrainRpcHostOk(delivered.result) &&
            delivered.result.result
          ) {
            const hostPrompt = purposeFromSuggestResult(delivered.result.result);
            if (hostPrompt) {
              resolvedPrompt = hostPrompt;
              promptSource = "host";
            }
          }
        } catch {
          // Host/brain RPC optional for purpose — fixture below.
        }
      }

      if (!resolvedPrompt) {
        resolvedPrompt = fixtureSystemPromptFromMessages(contextMessages);
        promptSource = "fixture";
      }

      const outcome = bindings.chatThreads.assignLlmSystemPrompt(
        threadId,
        resolvedPrompt,
      );
      if (!outcome) {
        throw new HTTPException(400, { message: "Invalid system prompt" });
      }

      return c.json({
        ...threadSummaryJson(outcome.thread),
        applied: outcome.applied,
        prompt_source: outcome.applied ? promptSource : null,
        skipped_reason: outcome.applied
          ? null
          : outcome.thread.kind !== "chat"
            ? "kind"
            : "system_prompt_source",
      });
    },
  );

  api.delete("/chat/threads/:threadId", csrfProtection, async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    requireUserRbac(c.get("rbac"));
    const threadId = c.req.param("threadId");
    // Owner only — shared grantees cannot delete the underlying thread.
    const thread = bindings.chatThreads.getForUser(
      threadId,
      tenant.tenant_id,
      user.user_id,
    );
    if (!thread) {
      throw new HTTPException(404, { message: "Chat thread not found" });
    }

    bindings.chatThreads.delete(threadId);
    return c.json({ ok: true });
  });

  const settingsHermesHome =
    bindings.hermesHome ?? bindings.settingsHermesHome;

  /**
   * Settings page load. VaultPlane=cp_s3 + ChatDelivery=harness: proxy
   * GET /internal/settings/snapshot (no Brain RPC, no ensure_online;
   * unset URL / 404 / unavailable fail closed — not fixture-as-host).
   * VaultPlane=cp_s3 + relay: snapshot/discover (fixture|hermes).
   * Other planes + BRAIN_RPC_ENABLED: settings.snapshot via
   * BackendRuntimeService. Offline tests: fixture or local Hermes.
   *
   * Authz (lp-p37.7): `settings.read` — any authenticated session. Enforced
   * before Brain RPC and local fixture/Hermes fallback.
   */
  api.get("/settings/snapshot", async (c) => {
    const user = requireUser(c);
    assertSettingsPermission("settings.read", {
      user,
      rbac: c.get("rbac"),
    });

    const tenant = c.get("tenant");
    const chatDelivery = requestChatDelivery(bindings, tenant);
    if (vaultPlane === "cp_s3" && chatDelivery === "harness") {
      if (!bindings.harnessClient) {
        const mapped = harnessSettingsSnapshotHttpError("missing_client");
        return c.json(mapped.body, mapped.status);
      }
      let fetched;
      try {
        fetched = await bindings.harnessClient.getSettingsSnapshot();
      } catch {
        const mapped = harnessSettingsSnapshotHttpError("unavailable");
        return c.json(mapped.body, mapped.status);
      }
      if (!fetched.ok) {
        const mapped = harnessSettingsSnapshotHttpError(fetched);
        return c.json(mapped.body, mapped.status);
      }
      let snapshot = fetched.snapshot;
      if (bindings.scheduledJobStore) {
        const jobs = await bindings.scheduledJobStore.list(tenant.tenant_id);
        snapshot = overlayVaultCronsOnSnapshot(snapshot, jobs);
      }
      // Same CP/S3 vault document Vault UI lists. Empty harness BACKEND_HOME
      // must not hide vault skills/workflows from Tools.
      snapshot = await projectVaultInventoryOntoSnapshot(
        snapshot,
        vaultServiceFor(tenant.tenant_id),
        c.get("rbac"),
      );
      return c.json(snapshot);
    }

    if (settingsHandlers) {
      try {
        const ctx = await resolveBackendRuntimeContext(c, bindings);
        const snapshot = await settingsHandlers.snapshot(ctx);
        return c.json(snapshot);
      } catch (error) {
        if (error instanceof HTTPException) throw error;
        const mapped = settingsErrorToHttp(error);
        return c.json(mapped.body, mapped.status as ContentfulStatusCode);
      }
    }

    const snapshot = await loadSettingsSnapshot(
      bindings.settingsSnapshotPath,
      {
        // lp-bhcg.2: an API-key backend must not discover ~/.hermes as the
        // model. Hermes-named reads use settingsHandlers (backend runtime)
        // above. Offline, the fixture is the non-Hermes snapshot.
        preferFixture:
          bindings.settingsPreferFixture || Boolean(bindings.agentBackend),
        hermesHome: settingsHermesHome,
        seedLabMcp: bindings.settingsSeedLabMcp,
      },
    );
    return c.json(snapshot);
  });

  /**
   * On-demand host file body for Settings detail (lp-a8u.8).
   * Reads relative paths under BACKEND_HOME / HERMES_HOME (skills, workflows).
   * Authz: `settings.read`. Not available in fixture-only mode.
   */
  api.get("/settings/content", async (c) => {
    const user = requireUser(c);
    assertSettingsPermission("settings.read", {
      user,
      rbac: c.get("rbac"),
    });

    const relPath = c.req.query("path") ?? "";
    try {
      const body = await readSettingsHostContent(relPath, {
        preferFixture: bindings.settingsPreferFixture,
        hermesHome: settingsHermesHome,
      });
      return c.json(body);
    } catch (error) {
      if (error instanceof SettingsContentError) {
        return c.json(
          { error: error.message, code: error.code },
          error.status as ContentfulStatusCode,
        );
      }
      throw error;
    }
  });

  /**
   * One-level host directory listing for Settings skill packs (lp-75r.4).
   * Paths relative to BACKEND_HOME / HERMES_HOME. Authz: `settings.read`.
   */
  api.get("/settings/list", async (c) => {
    const user = requireUser(c);
    assertSettingsPermission("settings.read", {
      user,
      rbac: c.get("rbac"),
    });

    const relPath = c.req.query("path") ?? "";
    try {
      const body = await listSettingsHostDirectory(relPath, {
        preferFixture: bindings.settingsPreferFixture,
        hermesHome: settingsHermesHome,
      });
      return c.json(body);
    } catch (error) {
      if (error instanceof SettingsContentError) {
        return c.json(
          { error: error.message, code: error.code },
          error.status as ContentfulStatusCode,
        );
      }
      throw error;
    }
  });

  /**
   * On-demand cron job detail (command / prompt / payload) from host jobs.json
   * (lp-a8u.8). List snapshot stays light; detail is fetched when the drawer opens.
   */
  api.get("/settings/crons/:cronId/detail", async (c) => {
    const user = requireUser(c);
    assertSettingsPermission("settings.read", {
      user,
      rbac: c.get("rbac"),
    });

    const cronId = c.req.param("cronId");
    const tenant = c.get("tenant");
    const chatDelivery = requestChatDelivery(bindings, tenant);
    if (
      vaultPlane === "cp_s3" &&
      chatDelivery === "harness" &&
      bindings.scheduledJobStore
    ) {
      const job = await bindings.scheduledJobStore.get(
        tenant.tenant_id,
        cronId,
      );
      if (!job) {
        throw new HTTPException(404, {
          message: `scheduled task not found: ${cronId}`,
        });
      }
      const cron = scheduledJobToSettingsCron(job);
      return c.json({
        id: cron.id,
        name: cron.name,
        schedule: cron.schedule,
        enabled: cron.enabled,
        path: cron.path,
        last_run_at: cron.last_run_at,
        next_run_at: cron.next_run_at,
        prompt: cron.prompt,
      });
    }
    try {
      const body = await loadSettingsCronJobDetail(cronId, {
        preferFixture: bindings.settingsPreferFixture,
        hermesHome: settingsHermesHome,
      });
      return c.json(body);
    } catch (error) {
      if (error instanceof SettingsContentError) {
        return c.json(
          { error: error.message, code: error.code },
          error.status as ContentfulStatusCode,
        );
      }
      throw error;
    }
  });

  api.post("/settings/health-check", csrfProtection, async (c) => {
    const user = requireUser(c);
    assertSettingsPermission("settings.read", {
      user,
      rbac: c.get("rbac"),
    });

    let integrations: SettingsIntegration[] = [];
    let snapshotSource: string | undefined;

    if (settingsHandlers) {
      try {
        const ctx = await resolveBackendRuntimeContext(c, bindings);
        const snapshot = await settingsHandlers.snapshot(ctx);
        integrations = (snapshot.integrations ?? []) as SettingsIntegration[];
        snapshotSource = snapshot.source;
      } catch (error) {
        if (error instanceof HTTPException) throw error;
        const mapped = settingsErrorToHttp(error);
        return c.json(mapped.body, mapped.status as ContentfulStatusCode);
      }
    } else {
      const snapshot: RedactedSettingsSnapshot = await loadSettingsSnapshot(
        bindings.settingsSnapshotPath,
        {
          preferFixture: bindings.settingsPreferFixture,
          hermesHome: settingsHermesHome,
          seedLabMcp: bindings.settingsSeedLabMcp,
        },
      );
      integrations = snapshot.integrations;
      snapshotSource = snapshot.source;
    }

    const health = await checkIntegrationHealth(integrations, {
      useMock:
        bindings.settingsPreferFixture === true ||
        snapshotSource === "fixture",
    });
    return c.json(health);
  });

  const settingsEnabledPatchSchema = z.object({
    enabled: z.boolean(),
  });

  const settingsActiveModelSchema = z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
  });

  /**
   * Settings PATCH routes (lp-rt5.4 / lp-k7g.8.4):
   * Production (BRAIN_RPC_ENABLED): settings.patch via BackendRuntimeService.
   * Offline/dev fixture: local settings-snapshot write helpers.
   *
   * Authz (lp-p37.7): `settings.manage` — admin or explicit settings role.
   * Enforced before Brain RPC and before any fixture/Hermes file write.
   */
  api.patch("/settings/skills/:skillId", csrfProtection, async (c) => {
    const user = requireUser(c);
    assertSettingsPermission("settings.manage", {
      user,
      rbac: c.get("rbac"),
    });
    const skillId = c.req.param("skillId");
    const body = settingsEnabledPatchSchema.parse(await c.req.json());

    const tenant = c.get("tenant");
    const chatDelivery = requestChatDelivery(bindings, tenant);
    if (vaultPlane === "cp_s3" && chatDelivery === "harness") {
      if (!bindings.harnessClient) {
        const mapped = harnessSettingsSnapshotHttpError("missing_client");
        return c.json(
          {
            ...mapped.body,
            error:
              "Skill toggle is harness but no harness client is configured (set HARNESS_URL)",
          },
          mapped.status,
        );
      }
      let patched;
      try {
        patched = await bindings.harnessClient.patchSkillEnabled(
          skillId,
          body.enabled,
        );
      } catch {
        const mapped = harnessSettingsSnapshotHttpError("unavailable");
        return c.json(
          {
            ...mapped.body,
            error: "Harness skill toggle is unavailable",
          },
          mapped.status,
        );
      }
      if (!patched.ok) {
        if (patched.status === 404) {
          throw new HTTPException(404, { message: patched.error });
        }
        const mapped = harnessSettingsSnapshotHttpError(patched);
        return c.json(
          {
            ...mapped.body,
            error: patched.error || mapped.body.error,
          },
          mapped.status,
        );
      }
      return c.json({ skill: patched.skill, source: patched.source });
    }

    if (settingsHandlers) {
      try {
        const ctx = await resolveBackendRuntimeContext(c, bindings);
        const result = await settingsHandlers.patchSkill(ctx, skillId, body);
        return c.json(result);
      } catch (error) {
        if (error instanceof HTTPException) throw error;
        const mapped = settingsErrorToHttp(error);
        return c.json(mapped.body, mapped.status as ContentfulStatusCode);
      }
    }

    try {
      const result = await patchSettingsSkill(skillId, body.enabled, {
        snapshotPath: bindings.settingsSnapshotPath,
        preferFixture: bindings.settingsPreferFixture,
        hermesHome: settingsHermesHome,
      });
      return c.json(result);
    } catch (error) {
      if (error instanceof SettingsPatchNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      throw error;
    }
  });

  /**
   * POST /api/settings/crons — create full scheduled task (lp-jzl.3).
   * cp_s3+harness: vault jobs.json (lp-oop.38.8) — no guest Brain RPC / ensure_online.
   * Else: Brain RPC settingsHandlers + advertised cron create capability.
   * Body: { name, prompt|instructions, schedule, enabled?, skills?, id? }
   */
  api.post("/settings/crons", csrfProtection, async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    assertSettingsPermission("settings.manage", {
      user,
      rbac: c.get("rbac"),
    });
    const body = await c.req.json();
    const chatDelivery = requestChatDelivery(bindings, tenant);

    if (vaultPlane === "cp_s3" && chatDelivery === "harness") {
      if (!bindings.scheduledJobStore) {
        const mapped = harnessSettingsSnapshotHttpError("missing_client");
        return c.json(
          {
            ...mapped.body,
            error:
              "Scheduled task create is vault-backed but no scheduled job store is configured",
          },
          mapped.status,
        );
      }
      try {
        const parsed = parseSettingsPatchInput({
          op: "cron.create",
          ...(typeof body === "object" && body !== null ? body : {}),
        });
        if (parsed.op !== "cron.create") {
          throw new BackendRuntimeError(
            "invalid_argument",
            "scheduled task create requires cron.create fields",
            { retryable: false },
          );
        }
        const nowIso = new Date().toISOString();
        const jobId = parsed.cronId?.trim() || newScheduledTaskJobId();
        let connectorBind: ReturnType<typeof bindScheduledTaskConnectorNeed>;
        try {
          connectorBind = bindScheduledTaskConnectorNeed({
            skills: parsed.skills,
            prompt: parsed.prompt,
            user_id: user.user_id,
          });
        } catch (error) {
          if (error instanceof TenantCronUserConnectorError) {
            throw new HTTPException(400, { message: error.message });
          }
          throw error;
        }
        const job: BffScheduledJob = {
          id: jobId,
          name: parsed.name,
          enabled: parsed.enabled !== false,
          schedule: parsed.schedule,
          prompt: parsed.prompt,
          skills: parsed.skills,
          deliver: "portal_thread",
          path: BFF_VAULT_SCHEDULED_JOBS_PATH,
          tenant_id: tenant.tenant_id,
          user_id: user.user_id,
          ...(connectorBind.kind === "user_principal"
            ? {
                owner_user_id: connectorBind.owner_user_id,
                connector_ids: [...connectorBind.connector_ids],
              }
            : {}),
          created_at: nowIso,
          state: "scheduled",
          last_run_at: null,
          last_status: null,
          next_run_at:
            typeof parsed.schedule === "object" &&
            parsed.schedule !== null &&
            parsed.schedule.kind === "once" &&
            typeof parsed.schedule.run_at === "string"
              ? parsed.schedule.run_at
              : null,
        };
        const stored = await bindings.scheduledJobStore.putJob(
          tenant.tenant_id,
          job,
        );
        const cron = scheduledJobToSettingsCron(stored);
        const result = { cron, source: "vault" as const };
        try {
          const stream = bindings.chatThreads.ensureForJob({
            tenant_id: tenant.tenant_id,
            user_id: user.user_id,
            job_id: cron.id,
            name: cron.name,
          });
          return c.json(
            {
              ...result,
              thread_id: stream.thread.thread_id,
              thread: threadSummaryJson(stream.thread),
            },
            201,
          );
        } catch {
          return c.json(result, 201);
        }
      } catch (error) {
        if (error instanceof HTTPException) throw error;
        const mapped = settingsErrorToHttp(error);
        return c.json(mapped.body, mapped.status as ContentfulStatusCode);
      }
    }

    if (settingsHandlers) {
      try {
        const ctx = await resolveBackendRuntimeContext(c, bindings);
        const result = await settingsHandlers.createCron(ctx, body);
        // lp-fn5.5.1: bind a durable stream chat for the new job (idempotent).
        const cron = result?.cron;
        if (
          cron &&
          typeof cron === "object" &&
          typeof cron.id === "string" &&
          typeof cron.name === "string" &&
          cron.name.trim()
        ) {
          try {
            const stream = bindings.chatThreads.ensureForJob({
              tenant_id: tenant.tenant_id,
              user_id: user.user_id,
              job_id: cron.id,
              name: cron.name,
              agent_id:
                typeof body?.agent_id === "string" ? body.agent_id : undefined,
            });
            return c.json(
              {
                ...result,
                thread_id: stream.thread.thread_id,
                thread: threadSummaryJson(stream.thread),
              },
              201,
            );
          } catch {
            // Job create succeeded; stream binding is best-effort (client can ensure).
          }
        }
        return c.json(result, 201);
      } catch (error) {
        if (error instanceof HTTPException) throw error;
        const mapped = settingsErrorToHttp(error);
        return c.json(mapped.body, mapped.status as ContentfulStatusCode);
      }
    }

    return c.json(
      {
        error:
          "Creating a scheduled task is unavailable right now.",
        code: "method_not_found",
        unavailable: true,
        method: "settings.patch",
      },
      501,
    );
  });

  api.patch("/settings/crons/:cronId", csrfProtection, async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    assertSettingsPermission("settings.manage", {
      user,
      rbac: c.get("rbac"),
    });
    const cronId = c.req.param("cronId");
    const body = await c.req.json();
    const chatDelivery = requestChatDelivery(bindings, tenant);

    if (vaultPlane === "cp_s3" && chatDelivery === "harness") {
      if (!bindings.scheduledJobStore) {
        const mapped = harnessSettingsSnapshotHttpError("missing_client");
        return c.json(
          {
            ...mapped.body,
            error:
              "Scheduled task update is vault-backed but no scheduled job store is configured",
          },
          mapped.status,
        );
      }
      try {
        const raw =
          typeof body === "object" && body !== null && !Array.isArray(body)
            ? (body as Record<string, unknown>)
            : {};
        const hasFullUpdate =
          raw.name !== undefined ||
          raw.prompt !== undefined ||
          raw.instructions !== undefined ||
          raw.schedule !== undefined ||
          raw.skills !== undefined;
        const parsed = parseSettingsPatchInput(
          hasFullUpdate
            ? { op: "cron.update", cron_id: cronId, ...raw }
            : { op: "cron.set_enabled", cron_id: cronId, ...raw },
        );
        const existing = await bindings.scheduledJobStore.get(
          tenant.tenant_id,
          cronId,
        );
        if (!existing) {
          throw new HTTPException(404, {
            message: `scheduled task not found: ${cronId}`,
          });
        }
        const patch: Partial<BffScheduledJob> = {};
        if (parsed.op === "cron.set_enabled") {
          patch.enabled = parsed.enabled;
        } else if (parsed.op === "cron.update") {
          if (parsed.name !== undefined) patch.name = parsed.name;
          if (parsed.prompt !== undefined) patch.prompt = parsed.prompt;
          if (parsed.schedule !== undefined) patch.schedule = parsed.schedule;
          if (parsed.enabled !== undefined) patch.enabled = parsed.enabled;
          if (parsed.skills !== undefined) patch.skills = parsed.skills;
          if (parsed.prompt !== undefined || parsed.skills !== undefined) {
            try {
              const connectorBind = bindScheduledTaskConnectorNeed({
                skills: parsed.skills ?? existing.skills,
                prompt: parsed.prompt ?? existing.prompt,
                user_id:
                  existing.owner_user_id ?? existing.user_id ?? user.user_id,
              });
              if (connectorBind.kind === "user_principal") {
                patch.owner_user_id = connectorBind.owner_user_id;
                patch.connector_ids = [...connectorBind.connector_ids];
              }
            } catch (error) {
              if (error instanceof TenantCronUserConnectorError) {
                throw new HTTPException(400, { message: error.message });
              }
              throw error;
            }
          }
        }
        const stored = await bindings.scheduledJobStore.update(
          tenant.tenant_id,
          cronId,
          patch,
        );
        if (!stored) {
          throw new HTTPException(404, {
            message: `scheduled task not found: ${cronId}`,
          });
        }
        const cron = scheduledJobToSettingsCron(stored);
        if (cron.name.trim()) {
          bindings.chatThreads.syncJobTitle({
            tenant_id: tenant.tenant_id,
            user_id: user.user_id,
            job_id: cron.id,
            name: cron.name,
          });
        }
        return c.json({ cron, source: "vault" });
      } catch (error) {
        if (error instanceof HTTPException) throw error;
        const mapped = settingsErrorToHttp(error);
        return c.json(mapped.body, mapped.status as ContentfulStatusCode);
      }
    }

    if (settingsHandlers) {
      try {
        const ctx = await resolveBackendRuntimeContext(c, bindings);
        // Enabled-only or full update (name/prompt/schedule) via settings-bff.
        const result = await settingsHandlers.patchCron(ctx, cronId, body);
        // lp-fn5.5.1: when job name changes, rename bound stream if title_source=job.
        const cron = result?.cron;
        if (
          cron &&
          typeof cron === "object" &&
          typeof cron.id === "string" &&
          typeof cron.name === "string" &&
          cron.name.trim()
        ) {
          bindings.chatThreads.syncJobTitle({
            tenant_id: tenant.tenant_id,
            user_id: user.user_id,
            job_id: cron.id,
            name: cron.name,
          });
        }
        return c.json(result);
      } catch (error) {
        if (error instanceof HTTPException) throw error;
        const mapped = settingsErrorToHttp(error);
        return c.json(mapped.body, mapped.status as ContentfulStatusCode);
      }
    }

    // Fixture path: enable toggle only (legacy local snapshot write).
    const enabledBody = settingsEnabledPatchSchema.parse(body);
    try {
      const result = await patchSettingsCron(cronId, enabledBody.enabled, {
        snapshotPath: bindings.settingsSnapshotPath,
        preferFixture: bindings.settingsPreferFixture,
        hermesHome: settingsHermesHome,
      });
      return c.json(result);
    } catch (error) {
      if (error instanceof SettingsPatchNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      throw error;
    }
  });

  api.patch("/settings/mcp/:mcpName", csrfProtection, async (c) => {
    const user = requireUser(c);
    assertSettingsPermission("settings.manage", {
      user,
      rbac: c.get("rbac"),
    });
    const mcpName = c.req.param("mcpName");
    const body = settingsEnabledPatchSchema.parse(await c.req.json());

    const tenant = c.get("tenant");
    const chatDelivery = requestChatDelivery(bindings, tenant);
    if (vaultPlane === "cp_s3" && chatDelivery === "harness") {
      if (!bindings.harnessClient) {
        const mapped = harnessSettingsSnapshotHttpError("missing_client");
        return c.json(
          {
            ...mapped.body,
            error:
              "MCP toggle is harness but no harness client is configured (set HARNESS_URL)",
          },
          mapped.status,
        );
      }
      let patched;
      try {
        patched = await bindings.harnessClient.patchMcpEnabled(
          mcpName,
          body.enabled,
        );
      } catch {
        const mapped = harnessSettingsSnapshotHttpError("unavailable");
        return c.json(
          {
            ...mapped.body,
            error: "Harness MCP toggle is unavailable",
          },
          mapped.status,
        );
      }
      if (!patched.ok) {
        if (patched.status === 404) {
          throw new HTTPException(404, { message: patched.error });
        }
        const mapped = harnessSettingsSnapshotHttpError(patched);
        return c.json(
          {
            ...mapped.body,
            error: patched.error || mapped.body.error,
          },
          mapped.status,
        );
      }
      return c.json({ mcp: patched.mcp, source: patched.source });
    }

    if (settingsHandlers) {
      try {
        const ctx = await resolveBackendRuntimeContext(c, bindings);
        const result = await settingsHandlers.patchMcp(ctx, mcpName, body);
        return c.json(result);
      } catch (error) {
        if (error instanceof HTTPException) throw error;
        const mapped = settingsErrorToHttp(error);
        return c.json(mapped.body, mapped.status as ContentfulStatusCode);
      }
    }

    try {
      const result = await patchSettingsMcp(mcpName, body.enabled, {
        snapshotPath: bindings.settingsSnapshotPath,
        preferFixture: bindings.settingsPreferFixture,
        hermesHome: settingsHermesHome,
      });
      return c.json(result);
    } catch (error) {
      if (error instanceof SettingsPatchNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      throw error;
    }
  });

  api.get("/settings/model-catalog", async (c) => {
    requireUser(c);
    if (!isTenantAdmin(c.get("rbac"))) {
      throw new HTTPException(403, { message: "Admin role required" });
    }
    const root = process.env.VAULT_ROOT?.trim();
    if (!root) {
      throw new HTTPException(503, {
        message: "The agent is not available for this action.",
      });
    }
    const catalog = await loadModelCatalog(root);
    return c.json(catalog);
  });

  api.put("/settings/model-catalog", csrfProtection, async (c) => {
    requireUser(c);
    if (!isTenantAdmin(c.get("rbac"))) {
      throw new HTTPException(403, { message: "Admin role required" });
    }
    const root = process.env.VAULT_ROOT?.trim();
    if (!root) {
      throw new HTTPException(503, {
        message: "The agent is not available for this action.",
      });
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new HTTPException(400, { message: "Invalid JSON body" });
    }
    let catalog: ModelCatalog;
    try {
      catalog = normalizeModelCatalog(body);
      await assertCatalogKeyIds(root, catalog);
      await saveModelCatalog(root, catalog);
      await materializeLiteLLMConfig(root);
    } catch (error) {
      if (
        error instanceof ProviderKeyNotFoundError ||
        (error instanceof Error && error.message === "Invalid model catalog")
      ) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }
    return c.json(await loadModelCatalog(root));
  });

  api.get("/settings/provider-keys", async (c) => {
    requireUser(c);
    if (!isTenantAdmin(c.get("rbac"))) {
      throw new HTTPException(403, { message: "Admin role required" });
    }
    const root = process.env.VAULT_ROOT?.trim();
    if (!root) {
      throw new HTTPException(503, {
        message: "The agent is not available for this action.",
      });
    }
    return c.json({ keys: await listProviderKeys(root) });
  });

  api.post("/settings/provider-keys", csrfProtection, async (c) => {
    requireUser(c);
    if (!isTenantAdmin(c.get("rbac"))) {
      throw new HTTPException(403, { message: "Admin role required" });
    }
    const root = process.env.VAULT_ROOT?.trim();
    if (!root) {
      throw new HTTPException(503, {
        message: "The agent is not available for this action.",
      });
    }
    let body: { provider?: unknown; api_key?: unknown };
    try {
      body = (await c.req.json()) as { provider?: unknown; api_key?: unknown };
    } catch {
      throw new HTTPException(400, { message: "Invalid JSON body" });
    }
    try {
      const key = await saveProviderKey(root, {
        provider: typeof body.provider === "string" ? body.provider : "",
        api_key: typeof body.api_key === "string" ? body.api_key : "",
      });
      await materializeLiteLLMConfig(root);
      return c.json({ key });
    } catch (error) {
      if (error instanceof InvalidProviderKeyError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }
  });

  api.delete("/settings/provider-keys/:keyId", csrfProtection, async (c) => {
    requireUser(c);
    if (!isTenantAdmin(c.get("rbac"))) {
      throw new HTTPException(403, { message: "Admin role required" });
    }
    const root = process.env.VAULT_ROOT?.trim();
    if (!root) {
      throw new HTTPException(503, {
        message: "The agent is not available for this action.",
      });
    }
    try {
      await deleteProviderKey(root, c.req.param("keyId"));
      await materializeLiteLLMConfig(root);
    } catch (error) {
      if (error instanceof InvalidProviderKeyError) {
        throw new HTTPException(400, { message: error.message });
      }
      if (error instanceof ProviderKeyNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      if (error instanceof ProviderKeyInUseError) {
        throw new HTTPException(409, { message: error.message });
      }
      throw error;
    }
    return c.json({ keys: await listProviderKeys(root) });
  });

  api.get("/settings/litellm-providers", async (c) => {
    requireUser(c);
    if (!isTenantAdmin(c.get("rbac"))) {
      throw new HTTPException(403, { message: "Admin role required" });
    }
    return c.json({ providers: await listLiteLLMProviders() });
  });

  api.get("/settings/litellm-models", async (c) => {
    requireUser(c);
    if (!isTenantAdmin(c.get("rbac"))) {
      throw new HTTPException(403, { message: "Admin role required" });
    }
    const provider = c.req.query("provider") ?? "";
    const models = await listLiteLLMProviderModels(provider);
    return c.json({
      models: models.map((model) => ({ id: model.id, name: model.name })),
    });
  });

  api.get("/settings/model-keys", async (c) => {
    requireUser(c);
    if (!isTenantAdmin(c.get("rbac"))) {
      throw new HTTPException(403, { message: "Admin role required" });
    }
    const root = process.env.VAULT_ROOT?.trim();
    if (!root) {
      throw new HTTPException(503, {
        message: "The agent is not available for this action.",
      });
    }
    return c.json({ models: await listSavedModels(root) });
  });

  api.post("/settings/model-keys", csrfProtection, async (c) => {
    requireUser(c);
    if (!isTenantAdmin(c.get("rbac"))) {
      throw new HTTPException(403, { message: "Admin role required" });
    }
    const root = process.env.VAULT_ROOT?.trim();
    if (!root) {
      throw new HTTPException(503, {
        message: "The agent is not available for this action.",
      });
    }
    let body: { provider?: unknown; model?: unknown; api_key?: unknown };
    try {
      body = (await c.req.json()) as {
        provider?: unknown;
        model?: unknown;
        api_key?: unknown;
      };
    } catch {
      throw new HTTPException(400, { message: "Invalid JSON body" });
    }
    try {
      const saved = await addModelKey(root, {
        provider: typeof body.provider === "string" ? body.provider : "",
        model: typeof body.model === "string" ? body.model : "",
        api_key: typeof body.api_key === "string" ? body.api_key : "",
      });
      return c.json({ model: saved });
    } catch (error) {
      if (error instanceof ProviderKeyRejectedError || error instanceof InvalidProviderKeyError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }
  });

  api.delete("/settings/model-keys/:modelId", csrfProtection, async (c) => {
    requireUser(c);
    if (!isTenantAdmin(c.get("rbac"))) {
      throw new HTTPException(403, { message: "Admin role required" });
    }
    const root = process.env.VAULT_ROOT?.trim();
    if (!root) {
      throw new HTTPException(503, {
        message: "The agent is not available for this action.",
      });
    }
    await removeSavedModel(root, decodeURIComponent(c.req.param("modelId")));
    return c.json({ models: await listSavedModels(root) });
  });

  api.patch("/settings/models/active", csrfProtection, async (c) => {
    const user = requireUser(c);
    assertSettingsPermission("settings.manage", {
      user,
      rbac: c.get("rbac"),
    });
    const body = settingsActiveModelSchema.parse(await c.req.json());

    const tenant = c.get("tenant");
    const chatDelivery = requestChatDelivery(bindings, tenant);
    if (vaultPlane === "cp_s3" && chatDelivery === "harness") {
      if (!bindings.harnessClient) {
        const mapped = harnessSettingsSnapshotHttpError("missing_client");
        return c.json(
          {
            ...mapped.body,
            error:
              "Active model is harness but no harness client is configured (set HARNESS_URL)",
          },
          mapped.status,
        );
      }
      let patched;
      try {
        patched = await bindings.harnessClient.patchActiveModel(
          body.provider,
          body.model,
        );
      } catch {
        const mapped = harnessSettingsSnapshotHttpError("unavailable");
        return c.json(
          {
            ...mapped.body,
            error: "Harness set active model is unavailable",
          },
          mapped.status,
        );
      }
      if (!patched.ok) {
        const mapped = harnessSettingsSnapshotHttpError(patched);
        return c.json(
          {
            ...mapped.body,
            error: patched.error || mapped.body.error,
          },
          mapped.status,
        );
      }
      return c.json({ model: patched.model, source: patched.source });
    }

    if (settingsHandlers) {
      try {
        const ctx = await resolveBackendRuntimeContext(c, bindings);
        const result = await settingsHandlers.patchActiveModel(ctx, body);
        return c.json(result);
      } catch (error) {
        if (error instanceof HTTPException) throw error;
        const mapped = settingsErrorToHttp(error);
        return c.json(mapped.body, mapped.status as ContentfulStatusCode);
      }
    }

    try {
      const result = await patchSettingsActiveModel(
        body.provider,
        body.model,
        {
          snapshotPath: bindings.settingsSnapshotPath,
          preferFixture: bindings.settingsPreferFixture,
          hermesHome: settingsHermesHome,
        },
      );
      return c.json(result);
    } catch (error) {
      if (error instanceof SettingsPatchNotFoundError) {
        throw new HTTPException(404, { message: error.message });
      }
      throw error;
    }
  });

  api.get("/vault/access-check", async (c) => {
    const user = requireUser(c);
    const rbac = requireUserRbac(c.get("rbac"));
    const path = c.req.query("path");
    if (!path) {
      throw new HTTPException(400, { message: "path query parameter is required" });
    }

    try {
      const result = assertVaultPathAccess(rbac, path);
      return c.json({
        user_id: user.user_id,
        path: result.path,
        allowed: true,
        hermes_profile: rbac.hermes_profile,
      });
    } catch (error) {
      if (error instanceof InvalidVaultPathError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }
  });

  /**
   * Vault browser tree. VaultPlane=brain_rpc (today when BRAIN_RPC_ENABLED):
   * vault.list/stat via BackendRuntimeService / Brain RPC. VaultPlane=cp_s3:
   * CP HTTP list (no ensure_online). Offline / VaultPlane=fs: local
   * VaultService fixture/FS. Host unhealthy on brain_rpc → empty roots
   * (fail-closed, no fixture sample data).
   */
  api.get("/vault/tree", async (c) => {
    requireUser(c);
    const rbac = requireUserRbac(c.get("rbac"));

    if (vaultHandlers) {
      try {
        const ctx = await resolveBackendRuntimeContext(c, bindings);
        const tree = await vaultHandlers.tree(ctx);
        return c.json(tree);
      } catch (error) {
        if (error instanceof HTTPException) throw error;
        const mapped = vaultErrorToHttp(error);
        return c.json(mapped.body, mapped.status as ContentfulStatusCode);
      }
    }

    try {
      const tree = await vaultServiceFor(c.get("tenant").tenant_id).getTree(
        rbac,
      );
      return c.json(tree);
    } catch (error) {
      if (error instanceof InvalidVaultPathError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }
  });

  /**
   * Vault directory listing. VaultPlane=brain_rpc: Brain RPC vault.list.
   * VaultPlane=cp_s3: CP HTTP list (no ensure_online). Flag off / fs:
   * local fixture/FS. Fail-closed errors when host unhealthy (no fixtures).
   */
  api.get("/vault/entries", async (c) => {
    requireUser(c);
    const rbac = requireUserRbac(c.get("rbac"));
    const path = c.req.query("path");
    if (!path) {
      throw new HTTPException(400, { message: "path query parameter is required" });
    }
    const cursorQuery = c.req.query("cursor");
    const cursor = cursorQuery && cursorQuery.length > 0 ? cursorQuery : null;

    if (vaultHandlers) {
      try {
        // BFF-side ACL gate (defense in depth; host also enforces path_prefixes).
        assertVaultPathAccess(rbac, path);
        const ctx = await resolveBackendRuntimeContext(c, bindings);
        const listing = await vaultHandlers.list(ctx, path, { cursor });
        return c.json(listing);
      } catch (error) {
        if (error instanceof HTTPException) throw error;
        if (error instanceof InvalidVaultPathError) {
          throw new HTTPException(400, { message: error.message });
        }
        const mapped = vaultErrorToHttp(error);
        return c.json(mapped.body, mapped.status as ContentfulStatusCode);
      }
    }

    try {
      const listing = await vaultServiceFor(
        c.get("tenant").tenant_id,
      ).listEntries(rbac, path);
      return c.json({
        ...listing,
        truncated: false,
        next_cursor: null,
      });
    } catch (error) {
      if (error instanceof InvalidVaultPathError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }
  });

  api.get("/staging/uploads", async (c) => {
    requireUser(c);
    const rbac = requireUserRbac(c.get("rbac"));

    try {
      const listing = await stagingService.listUploads(rbac);
      return c.json(listing);
    } catch (error) {
      if (error instanceof StagingPathNotAllowedError) {
        throw new HTTPException(403, { message: error.message });
      }
      throw error;
    }
  });

  api.post("/staging/upload", csrfProtection, async (c) => {
    requireUser(c);
    const rbac = requireUserRbac(c.get("rbac"));

    const body = await c.req.parseBody();
    const fileField = body.file;
    if (!(fileField instanceof File)) {
      throw new HTTPException(400, { message: "multipart field 'file' is required" });
    }

    const projectVaultPath =
      typeof body.project_vault_path === "string"
        ? body.project_vault_path
        : undefined;

    try {
      const bytes = new Uint8Array(await fileField.arrayBuffer());
      const record = await stagingService.upload(rbac, {
        filename: fileField.name || "upload",
        mime_type: fileField.type || "application/octet-stream",
        bytes,
        project_vault_path: projectVaultPath,
      });

      return c.json(
        {
          ...record,
          ingest_note:
            "Customer ingest/vault-writer beads promote staging/uploads into canonical vault paths.",
        },
        201,
      );
    } catch (error) {
      if (error instanceof StagingPathNotAllowedError) {
        throw new HTTPException(403, { message: error.message });
      }
      if (error instanceof InvalidVaultPathError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }
  });

  /**
   * Vault file content. VaultPlane=brain_rpc: Brain RPC vault.read.
   * VaultPlane=cp_s3: CP HTTP get (no ensure_online). Flag off / fs:
   * local fixture/FS. Fail-closed when host unhealthy (no fixtures).
   *
   * lp-vnz.3: host-absolute agent paths under VAULT_ROOT (or embedding
   * Clients/Projects/…) are projected to vault-root-relative before ACL
   * and vault.read so chat soft-open does not 404.
   */
  api.get("/vault/content", async (c) => {
    requireUser(c);
    const rbac = requireUserRbac(c.get("rbac"));
    const path = c.req.query("path");
    if (!path) {
      throw new HTTPException(400, { message: "path query parameter is required" });
    }

    // Brain RPC / single-root: project host paths. Multi-root offline keeps
    // absolute identity unless the path embeds a known vault top-level.
    const vaultRootEnv = process.env.VAULT_ROOT?.trim() || undefined;
    const pathOpts = vaultHandlers
      ? { vaultRoot: vaultRootEnv, projectHostPaths: true as const }
      : { projectHostPaths: true as const };

    const materializeWorkflowStateJson = async (
      tenantId: string,
      vaultPath: string,
    ): Promise<boolean> => {
      if (!workflowRunVaultPersist) return false;
      const outcome = await workflowRunVaultPersist.persistMissing(
        tenantId,
        vaultPath,
      );
      return outcome === "created" || outcome === "exists";
    };

    if (vaultHandlers) {
      try {
        const access = assertVaultPathAccess(rbac, path, pathOpts);
        const ctx = await resolveBackendRuntimeContext(c, bindings);
        try {
          const content = await vaultHandlers.read(ctx, access.path);
          return c.json(content);
        } catch (error) {
          if (error instanceof HTTPException) throw error;
          if (error instanceof InvalidVaultPathError) {
            throw new HTTPException(400, { message: error.message });
          }
          const mapped = vaultErrorToHttp(error);
          if (mapped.status === 404) {
            const tenantId = c.get("tenant").tenant_id;
            if (await materializeWorkflowStateJson(tenantId, access.path)) {
              const created = await vaultHandlers.read(ctx, access.path);
              return c.json(created);
            }
            throw new HTTPException(404, {
              message: mapped.body.error || "Vault file not found",
            });
          }
          return c.json(mapped.body, mapped.status as ContentfulStatusCode);
        }
      } catch (error) {
        if (error instanceof HTTPException) throw error;
        if (error instanceof InvalidVaultPathError) {
          throw new HTTPException(400, { message: error.message });
        }
        throw error;
      }
    }

    try {
      // Project path for ACL + single-root FS; multi-root host folders without
      // vault top-level structure remain absolute (projectToVaultRelative no-op).
      const access = assertVaultPathAccess(rbac, path, pathOpts);
      const tenantId = c.get("tenant").tenant_id;
      try {
        const content = await vaultServiceFor(tenantId).readContent(
          rbac,
          access.path,
        );
        return c.json(content);
      } catch (error) {
        if (
          error instanceof HTTPException &&
          error.status === 404 &&
          (await materializeWorkflowStateJson(tenantId, access.path))
        ) {
          const created = await vaultServiceFor(tenantId).readContent(
            rbac,
            access.path,
          );
          return c.json(created);
        }
        throw error;
      }
    } catch (error) {
      if (error instanceof InvalidVaultPathError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }
  });

  /**
   * Mint ONLYOFFICE editor config + JWT (lp-5q6.26).
   *
   * Portal session + CSRF + vault path ACL. Browser never builds config.
   * BFF creates/retrieves OfficeDocumentSession, mints document.key, signed
   * download URL, callback URL, permissions, and HS256 JWT.
   * Never logs JWT, download token, or file body.
   */
  api.post("/office/sessions", csrfProtection, async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    const rbac = requireUserRbac(c.get("rbac"));
    const started = Date.now();
    const requestId =
      c.req.header("x-request-id")?.trim() || randomUUID();

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      officeMetrics.recordConfigMint({
        outcome: "error",
        error_code: "invalid_body",
      });
      throw new HTTPException(400, { message: "Invalid JSON body" });
    }

    const raw =
      typeof body === "object" && body !== null
        ? (body as Record<string, unknown>)
        : {};
    const path = typeof raw.path === "string" ? raw.path : "";
    const modeRaw = typeof raw.mode === "string" ? raw.mode : "view";
    const mode = modeRaw as OfficeSessionMode;
    const title = typeof raw.title === "string" ? raw.title : undefined;
    const caller_key =
      typeof raw.caller_key === "string"
        ? raw.caller_key
        : typeof raw.callerKey === "string"
          ? raw.callerKey
          : undefined;
    const file_type =
      typeof raw.file_type === "string"
        ? raw.file_type
        : typeof raw.fileType === "string"
          ? raw.fileType
          : undefined;

    let revision: DocumentRevision | undefined;
    const revRaw = raw.revision ?? raw.base_revision;
    if (revRaw && typeof revRaw === "object" && revRaw !== null) {
      const r = revRaw as Record<string, unknown>;
      if (typeof r.token === "string" && typeof r.kind === "string") {
        revision = {
          token: r.token,
          kind: r.kind as DocumentRevision["kind"],
          ...(typeof r.size_bytes === "number"
            ? { size_bytes: r.size_bytes }
            : {}),
          ...(typeof r.modified_at === "string"
            ? { modified_at: r.modified_at }
            : {}),
        };
      }
    }

    let pathAllowed = false;
    try {
      if (path) {
        assertVaultPathAccess(rbac, path);
        pathAllowed = true;
      }
    } catch (error) {
      if (error instanceof HTTPException && error.status === 403) {
        officeMetrics.recordConfigMint({
          outcome: "denied",
          error_code: "acl_denied",
        });
        log.warn(
          "office config mint denied",
          buildOfficeSafeLogFields({
            event: "office_config_mint",
            request_id: requestId,
            tenant_id: tenant.tenant_id,
            route: "/api/office/sessions",
            outcome: "denied",
            latency_ms: Date.now() - started,
            operator_class: classifyOfficeError("acl_denied"),
            error_code: "acl_denied",
          }),
        );
        throw error;
      }
      if (error instanceof InvalidVaultPathError) {
        officeMetrics.recordConfigMint({
          outcome: "error",
          error_code: "bad_path",
        });
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }

    const vaultEdit = await resolveOfficeVaultEdit(bindings);

    let jwtSecret: string | undefined = bindings.officeJwtSecret;
    if (!jwtSecret) {
      try {
        jwtSecret = loadOfficeJwtSecret(process.env).secret;
      } catch (error) {
        officeMetrics.recordConfigMint({
          outcome: "error",
          error_code: "missing_jwt_secret",
        });
        throw new HTTPException(503, {
          message:
            error instanceof Error
              ? error.message
              : "Office JWT secret not configured",
        });
      }
    }

    let publicBaseUrl: string | undefined = bindings.officePublicBaseUrl;
    if (!publicBaseUrl) {
      try {
        publicBaseUrl = loadOfficePublicBaseUrl(process.env);
      } catch (error) {
        officeMetrics.recordConfigMint({
          outcome: "error",
          error_code: "missing_public_base_url",
        });
        throw new HTTPException(503, {
          message:
            error instanceof Error
              ? error.message
              : "Office public base URL not configured",
        });
      }
    }

    const result = await mintOfficeEditorSession(
      {
        path,
        mode,
        title,
        caller_key,
        revision,
        file_type,
      },
      {
        store: officeDocumentSessions,
        vaultContentProvider: officeMintVaultFor(tenant.tenant_id),
        tenant_id: tenant.tenant_id,
        user_id: user.user_id,
        user_email: user.email,
        vault_edit: vaultEdit,
        path_allowed: pathAllowed,
        public_base_url: publicBaseUrl,
        tenant_path_prefix: officeTenantPathPrefix(c, tenant.tenant_slug),
        jwt_secret: jwtSecret,
      },
    );

    if (!result.ok) {
      const outcome: OfficeMetricOutcome =
        result.status === 403 ? "denied" : "error";
      officeMetrics.recordConfigMint({
        outcome,
        error_code: result.reason,
      });
      log.warn(
        "office config mint failed",
        buildOfficeSafeLogFields({
          event: "office_config_mint",
          request_id: requestId,
          tenant_id: tenant.tenant_id,
          route: "/api/office/sessions",
          outcome,
          latency_ms: Date.now() - started,
          operator_class: classifyOfficeError(result.reason),
          error_code: result.reason,
        }),
      );
      throw new HTTPException(result.status as ContentfulStatusCode, {
        message: result.message,
      });
    }

    officeMetrics.recordConfigMint({ outcome: "success" });
    log.info(
      "office config mint",
      buildOfficeSafeLogFields({
        event: "office_config_mint",
        request_id: requestId,
        tenant_id: tenant.tenant_id,
        office_session_id: result.session_id,
        route: "/api/office/sessions",
        outcome: "success",
        latency_ms: Date.now() - started,
        operator_class: "ok",
        mode: result.mode,
        file_type: result.file_type,
      }),
    );

    return c.json(
      {
        session_id: result.session_id,
        document_key: result.document_key,
        base_revision: result.base_revision,
        mode: result.mode,
        file_type: result.file_type,
        path: result.path,
        expires_at: result.expires_at,
        editor_config: result.editor_config,
        idempotent_replay: result.idempotent_replay,
      },
      result.idempotent_replay ? 200 : 201,
    );
  });

  /**
   * ONLYOFFICE Document Server callback writeback (lp-5q6.23).
   *
   * Auth: session-bound callback nonce (query/header); no Portal cookie / CSRF.
   * Compensating controls: nonce, session map, SSRF host allowlist, CAS write,
   * idempotency. Path + expected_revision come only from OfficeDocumentSession.
   * Returns { error: 0 } only after accepted handling (ONLYOFFICE contract).
   * Never logs file body or nonce.
   */
  api.post("/office/callback", async (c) => {
    const hostTenant = c.get("tenant");
    const officeTenantDeferred = Boolean(c.get("officeTenantDeferred"));
    const started = Date.now();
    const requestId =
      c.req.header("x-request-id")?.trim() || randomUUID();

    let rawBody: unknown;
    try {
      rawBody = await c.req.json();
    } catch {
      officeMetrics.recordCallback({
        code: "invalid_payload",
        error_code: "invalid_payload",
      });
      log.info(
        "office callback",
        buildOfficeSafeLogFields({
          event: "office_callback",
          request_id: requestId,
          tenant_id: officeTenantDeferred ? undefined : hostTenant.tenant_id,
          route: "/api/office/callback",
          status: 400,
          latency_ms: Date.now() - started,
          error_code: "invalid_payload",
          operator_class: classifyOfficeError("invalid_payload"),
          outcome: "denied",
        }),
      );
      return c.json({ error: 1, code: "invalid_payload" }, 400);
    }

    const bodyRecord =
      typeof rawBody === "object" && rawBody !== null && !Array.isArray(rawBody)
        ? (rawBody as Record<string, unknown>)
        : {};

    const auth = extractOfficeCallbackAuth({
      querySessionId: c.req.query("session_id"),
      queryNonce: c.req.query("nonce"),
      headerNonce: c.req.header("x-office-callback-nonce"),
      bodyNonce:
        typeof bodyRecord.nonce === "string" ? bodyRecord.nonce : null,
      bodySessionId:
        typeof bodyRecord.session_id === "string"
          ? bodyRecord.session_id
          : null,
    });

    // lp-xcu.1: when DS omits tenant Host, authorize against session.tenant_id
    // (nonce is the capability). Host tenant still required for mismatch when present.
    let callbackTenantId = hostTenant.tenant_id;
    if (officeTenantDeferred) {
      const boundSession = auth.session_id
        ? await officeDocumentSessions.get(auth.session_id)
        : null;
      callbackTenantId = boundSession?.tenant_id ?? "";
    }

    const writeVault: OfficeCallbackVaultWriter =
      bindings.officeCallbackVaultWriter ??
      (vaultPlane === "cp_s3" && bindings.createCpS3OfficeCallbackVaultWriter
        ? bindings.createCpS3OfficeCallbackVaultWriter()
        : undefined) ??
      (async ({ session, params }) => {
        const fsRoot = process.env.VAULT_ROOT?.trim();
        if (!vaultHandlers && fsRoot) {
          const { createFsOfficeCallbackVaultWriter } = await import(
            "./office/fs-callback-writer.js"
          );
          return createFsOfficeCallbackVaultWriter(fsRoot)({ session, params });
        }
        if (!vaultHandlers) {
          const err = new Error(
            "Saving this file is unavailable right now.",
          );
          (err as { code?: string }).code = "method_not_found";
          throw err;
        }

        let instanceId: string;
        try {
          const primary = await bindings.authClient.getPrimaryGatewayInstance(
            session.tenant_id,
          );
          instanceId = primary.instance_id;
        } catch (error) {
          if (error instanceof ControlPlaneRequestError) {
            const err = new Error(error.message);
            (err as { code?: string }).code = "unavailable";
            throw err;
          }
          throw error;
        }

        let pathPrefixes: string[] = [];
        let profileName = "default";
        let roles: string[] = [];
        try {
          const rbac = await bindings.authClient.getUserRbac(
            session.tenant_id,
            session.user_id,
          );
          if (rbac) {
            pathPrefixes = rbac.allowed_path_prefixes ?? [];
            profileName = rbac.hermes_profile || "default";
            roles = rbac.role_names ?? [];
          }
        } catch {
          // Host vault.write still enforces ACL; empty prefixes fail closed at BFF.
        }

        const ctx = backendContextFromSession({
          tenantId: session.tenant_id,
          instanceId,
          userId: session.user_id,
          sessionId: `office_${session.session_id}`,
          profileName,
          pathPrefixes,
          roles,
        });

        // Build body for writeCallback parser (origin-separated from browser).
        // Path/revision already stamped from session into params by handleOfficeCallback.
        const body: Record<string, unknown> = {
          path: params.path,
          mode: params.mode,
          size_bytes: params.sizeBytes,
          idempotency_key: params.idempotencyKey,
        };
        if (params.expectedRevision) {
          body.expected_revision = {
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
        if (params.ifMatch !== undefined) {
          body.if_match = params.ifMatch;
        }
        if (params.content !== undefined) {
          body.content = params.content;
          body.encoding = params.encoding ?? "base64";
        }
        if (params.contentRef) {
          body.content_ref = {
            kind: params.contentRef.kind,
            id: params.contentRef.id,
            ...(params.contentRef.content_sha256
              ? { content_sha256: params.contentRef.content_sha256 }
              : {}),
          };
        }
        if (params.mimeType !== undefined) {
          body.mime_type = params.mimeType;
        }

        return vaultHandlers.writeCallback(ctx, body, {
          // Office lab bodies may exceed default 1 MiB inline; hard cap still applies.
          maxInlineBytes: Math.min(
            officeMaxDownloadBytes,
            4_194_304,
          ),
        });
      });

    const result = await handleOfficeCallback({
      tenant_id: callbackTenantId,
      session_id: auth.session_id,
      nonce: auth.nonce,
      rawBody,
      store: officeDocumentSessions,
      allowlist: officeCallbackAllowlist,
      fetchBytes: officeCallbackFetcher,
      writeVault,
      maxBytes: officeMaxDownloadBytes,
    });

    const code = result.body.code ?? (result.body.error === 0 ? "ok" : "unknown");
    const errorCode = result.save?.error_code ?? (
      result.body.error === 0 ? undefined : String(code)
    );
    officeMetrics.recordCallback({
      code: String(code),
      onlyoffice_status: result.save?.onlyoffice_status,
      save_status: result.save?.status,
      error_code: errorCode,
    });

    const outcome: OfficeMetricOutcome = (() => {
      if (result.save?.status === "conflict" || code === "conflict") {
        return "conflict";
      }
      if (result.save?.status === "ignored" || code === "ignored") {
        return "ignored";
      }
      if (result.save?.status === "duplicate" || code === "duplicate") {
        return "duplicate";
      }
      if (
        result.save?.status === "saved" ||
        code === "saved" ||
        code === "force_saved"
      ) {
        return "success";
      }
      // Host/DS write path failures (accepted or not).
      if (
        errorCode === "write_failed" ||
        errorCode === "fetch_failed" ||
        errorCode === "write_unavailable" ||
        code === "save_error"
      ) {
        return "error";
      }
      // BFF auth / SSRF / payload gates (HTTP non-2xx or error:1).
      if (result.body.error !== 0 || result.save?.status === "forbidden") {
        return "denied";
      }
      if (result.save?.status === "upstream_error") {
        return "error";
      }
      return result.body.error === 0 ? "success" : "denied";
    })();

    // Safe log fields only — never nonce, URL with secrets, or file body.
    log.info(
      "office callback",
      buildOfficeSafeLogFields({
        event: "office_callback",
        request_id: requestId,
        tenant_id: callbackTenantId || undefined,
        office_session_id: auth.session_id ?? result.save?.session_id,
        route: "/api/office/callback",
        status: result.httpStatus,
        latency_ms: Date.now() - started,
        error_code: errorCode,
        operator_class: classifyOfficeError(errorCode ?? String(code)),
        outcome,
        onlyoffice_status: result.save?.onlyoffice_status,
        idempotent_replay: result.save?.idempotent_replay,
      }),
    );

    return c.json(result.body, result.httpStatus as ContentfulStatusCode);
  });

  /**
   * Signed Office binary download for Document Server (lp-5q6.22).
   *
   * Auth: short-lived single-purpose download token (query `token` or Bearer).
   * No Portal cookie / CSRF — DS is not a browser origin.
   * Path, revision, tenant, and file type come from the server-owned session only.
   * Never logs token or file body.
   */
  api.get("/office/sessions/:sessionId/content", async (c) => {
    const hostTenant = c.get("tenant");
    const officeTenantDeferred = Boolean(c.get("officeTenantDeferred"));
    const sessionId = c.req.param("sessionId");
    const started = Date.now();
    const requestId =
      c.req.header("x-request-id")?.trim() || randomUUID();
    const token = extractOfficeDownloadToken({
      queryToken: c.req.query("token"),
      authorizationHeader: c.req.header("authorization"),
    });
    const revisionClaim = c.req.query("revision");

    const session = await officeDocumentSessions.get(sessionId);
    // lp-xcu.1: DS public base URL often has no tenant Host. Capability token
    // binds the session; use session.tenant_id when Host tenant was deferred.
    const tenantIdForAuthz = officeTenantDeferred
      ? (session?.tenant_id ?? "")
      : hostTenant.tenant_id;
    const authz = authorizeOfficeDownload({
      session,
      tenant_id: tenantIdForAuthz,
      token,
      revision_token: revisionClaim,
    });

    if (!authz.ok) {
      officeMetrics.recordDownload({
        outcome: "denied",
        reason: authz.reason,
      });
      // Safe fields only — never token or vault path body.
      log.info(
        "office download denied",
        buildOfficeSafeLogFields({
          event: "office_download",
          request_id: requestId,
          tenant_id: tenantIdForAuthz || undefined,
          office_session_id: sessionId,
          route: "/api/office/sessions/:id/content",
          status: authz.status,
          latency_ms: Date.now() - started,
          error_code: authz.reason,
          operator_class: classifyOfficeDownloadReason(authz.reason),
          outcome: "denied",
        }),
      );
      return c.json(
        officeDownloadErrorBody(authz.reason),
        authz.status as ContentfulStatusCode,
      );
    }

    const bound = authz.session;
    // lp-oop.12: VaultPlane=cp_s3 streams CP getObject. Explicit
    // officeBinarySource (tests) still wins. Default plane unchanged.
    const downloadSource =
      !bindings.officeBinarySource &&
      vaultPlane === "cp_s3" &&
      bindings.createCpS3OfficeBinarySource
        ? bindings.createCpS3OfficeBinarySource(bound.tenant_id)
        : officeBinarySource;
    const binary = await downloadSource.read({
      path: bound.path,
      file_type: bound.file_type,
      max_bytes: officeMaxDownloadBytes,
      known_size_bytes: bound.revision.size_bytes,
    });

    if (!binary.ok) {
      officeMetrics.recordDownload({
        outcome: "denied",
        reason: binary.reason,
      });
      log.info(
        "office download content denied",
        buildOfficeSafeLogFields({
          event: "office_download",
          request_id: requestId,
          tenant_id: bound.tenant_id,
          office_session_id: sessionId,
          route: "/api/office/sessions/:id/content",
          status: binary.reason === "missing_file" ? 404 : 413,
          latency_ms: Date.now() - started,
          error_code: binary.reason,
          operator_class: classifyOfficeDownloadReason(binary.reason),
          outcome: "denied",
          file_type: bound.file_type,
          mode: bound.mode,
        }),
      );
      return c.json(
        officeDownloadErrorBody(binary.reason),
        (binary.reason === "missing_file" ? 404 : 413) as ContentfulStatusCode,
      );
    }

    officeMetrics.recordDownload({ outcome: "success" });
    log.info(
      "office download ok",
      buildOfficeSafeLogFields({
        event: "office_download",
        request_id: requestId,
        tenant_id: bound.tenant_id,
        office_session_id: sessionId,
        route: "/api/office/sessions/:id/content",
        status: 200,
        latency_ms: Date.now() - started,
        size_bytes: binary.size_bytes,
        size_bucket: officeSizeBucket(binary.size_bytes),
        outcome: "success",
        file_type: bound.file_type,
        mode: bound.mode,
        // path intentionally omitted from default logs (may be sensitive).
      }),
    );

    const fileName = bound.path.split("/").filter(Boolean).at(-1) ?? "document";
    c.header(
      "Content-Type",
      binary.mime_type || mimeForOfficeFileType(bound.file_type),
    );
    c.header("Content-Length", String(binary.size_bytes));
    c.header(
      "Content-Disposition",
      `attachment; filename="${fileName.replace(/"/g, "")}"`,
    );
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    // Expose revision binding for integrators / tests (not a secret).
    c.header("X-Office-Revision", bound.revision.token);
    c.header("X-Office-Session-Id", bound.session_id);

    return c.body(Buffer.from(binary.bytes));
  });

  /**
   * Browser-origin vault write (lp-5q6.19).
   *
   * Production (BRAIN_RPC_ENABLED): capability-gated vault.write via
   * BackendRuntimeService. BFF stamps subject/tenant/session/profile/path
   * prefixes from the session — body must not include tenant or host paths.
   * Document Server callback writeback uses a separate origin parser
   * (writeCallback) and is not this route (lp-5q6.23).
   *
   * Flag off: 404 (local VaultService has no write path).
   */
  api.put("/vault/content", csrfProtection, async (c) => {
    requireUser(c);
    const rbac = requireUserRbac(c.get("rbac"));

    if (!vaultHandlers) {
      throw new HTTPException(404, {
        message:
          "Saving this file is unavailable right now.",
      });
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw new HTTPException(400, { message: "Invalid JSON body" });
    }

    try {
      // Defense-in-depth ACL gate before pure writeVault path.
      const path =
        typeof body === "object" &&
        body !== null &&
        typeof (body as { path?: unknown }).path === "string"
          ? (body as { path: string }).path
          : "";
      if (path) {
        assertVaultPathAccess(rbac, path);
      }
      // Stamps tenant, instance, user, session, profile, path prefixes.
      const ctx = await resolveBackendRuntimeContext(c, bindings);
      const result = await vaultHandlers.writeBrowser(ctx, body);
      return c.json(result, result.created ? 201 : 200);
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      if (error instanceof InvalidVaultPathError) {
        throw new HTTPException(400, { message: error.message });
      }
      const mapped = vaultErrorToHttp(error);
      return c.json(mapped.body, mapped.status as ContentfulStatusCode);
    }
  });

  /**
   * Signed-operation history for a vault path (lp-ye4.7 / lp-ye4.11).
   * ACL + capability gated; never returns event body bytes.
   */
  api.get("/vault/history", async (c) => {
    requireUser(c);
    const rbac = requireUserRbac(c.get("rbac"));
    const path = c.req.query("path");
    if (!path) {
      throw new HTTPException(400, { message: "path query parameter is required" });
    }
    if (!historyHandlers) {
      return c.json(
        {
          error:
            "File history is unavailable right now.",
          code: "method_not_found",
          unavailable: true,
          method: "history.list",
          path,
        },
        404,
      );
    }

    const limitRaw = c.req.query("limit");
    const cursor = c.req.query("cursor") || undefined;
    const includeRejected =
      c.req.query("include_rejected") === "1" ||
      c.req.query("include_rejected") === "true";
    const limit =
      limitRaw && Number.isFinite(Number(limitRaw))
        ? Number(limitRaw)
        : undefined;

    try {
      assertVaultPathAccess(rbac, path);
      const ctx = await resolveBackendRuntimeContext(c, bindings);
      const body = await historyHandlers.list(ctx, {
        path,
        limit,
        cursor,
        includeRejected: includeRejected || undefined,
      });
      return c.json(body);
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      if (error instanceof InvalidVaultPathError) {
        throw new HTTPException(400, { message: error.message });
      }
      const mapped = historyErrorToHttp(error);
      return c.json(mapped.body, mapped.status as ContentfulStatusCode);
    }
  });

  /**
   * Current artifact head for a vault path (lp-ye4.7 / lp-ye4.11).
   * Returns revision + operation_id + actor + head_kind — not file bytes.
   */
  api.get("/vault/heads/artifact", async (c) => {
    requireUser(c);
    const rbac = requireUserRbac(c.get("rbac"));
    const path = c.req.query("path");
    if (!path) {
      throw new HTTPException(400, { message: "path query parameter is required" });
    }
    if (!historyHandlers) {
      return c.json(
        {
          error:
            "The current file revision is unavailable right now.",
          code: "method_not_found",
          unavailable: true,
          method: "heads.artifact",
          path,
        },
        404,
      );
    }

    try {
      assertVaultPathAccess(rbac, path);
      const ctx = await resolveBackendRuntimeContext(c, bindings);
      const body = await historyHandlers.artifactHead(ctx, { path });
      return c.json(body);
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      if (error instanceof InvalidVaultPathError) {
        throw new HTTPException(400, { message: error.message });
      }
      const mapped = historyErrorToHttp(error);
      return c.json(mapped.body, mapped.status as ContentfulStatusCode);
    }
  });

  /**
   * Workspace tree currentness head (lp-ye4.7 / lp-ye4.11).
   */
  api.get("/vault/heads/workspace", async (c) => {
    requireUser(c);
    requireUserRbac(c.get("rbac"));
    if (!historyHandlers) {
      return c.json(
        {
          error:
            "Workspace status is unavailable right now.",
          code: "method_not_found",
          unavailable: true,
          method: "heads.workspace",
        },
        404,
      );
    }

    const workspaceId = c.req.query("workspace_id") || undefined;
    try {
      const ctx = await resolveBackendRuntimeContext(c, bindings);
      const body = await historyHandlers.workspaceHead(ctx, {
        workspaceId,
      });
      return c.json(body);
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      const mapped = historyErrorToHttp(error);
      return c.json(mapped.body, mapped.status as ContentfulStatusCode);
    }
  });

  api.get("/vault/search", async (c) => {
    requireUser(c);
    const rbac = requireUserRbac(c.get("rbac"));
    const query = c.req.query("q");
    if (!query) {
      throw new HTTPException(400, { message: "q query parameter is required" });
    }

    try {
      const response = await vaultService.search(rbac, query);
      return c.json(response);
    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }
      if (error instanceof InvalidVaultPathError) {
        throw new HTTPException(400, { message: error.message });
      }
      throw error;
    }
  });

  registerConnectorRoutes(api, {
    ...bindings,
    pendingConnectorUseStore,
    threadLiveEvents,
  });

  /**
   * Same-tenant member directory for the share picker.
   * Tenant comes from host/path middleware only — never from client body.
   * Excludes the current user (cannot share with self).
   */
  api.get("/org/members", async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    requireUserRbac(c.get("rbac"));
    const q = c.req.query("q") ?? undefined;

    try {
      const members = await bindings.authClient.listTenantMembers(
        tenant.tenant_id,
        { q },
      );
      const others = members.filter((m) => m.user_id !== user.user_id);
      return c.json({
        tenant_id: tenant.tenant_id,
        members: others,
      });
    } catch (error) {
      if (error instanceof ControlPlaneRequestError) {
        throw new HTTPException(error.status as ContentfulStatusCode, {
          message: error.message,
        });
      }
      throw error;
    }
  });

  api.get("/chat/threads/:threadId/shares", async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    requireUserRbac(c.get("rbac"));
    const threadId = c.req.param("threadId");
    // Owner-only: invitees cannot list grants for a thread they don't own.
    const thread = bindings.chatThreads.getForUser(
      threadId,
      tenant.tenant_id,
      user.user_id,
    );
    if (!thread) {
      throw new HTTPException(404, { message: "Chat thread not found" });
    }

    try {
      const grants = await bindings.authClient.listSessionSharesForThread(
        tenant.tenant_id,
        user.user_id,
        threadId,
      );
      return c.json({
        tenant_id: tenant.tenant_id,
        owner_user_id: user.user_id,
        thread_id: threadId,
        grants,
      });
    } catch (error) {
      if (error instanceof ControlPlaneRequestError) {
        throw new HTTPException(error.status as ContentfulStatusCode, {
          message: error.message,
        });
      }
      throw error;
    }
  });

  api.post("/chat/threads/:threadId/shares", csrfProtection, async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    requireUserRbac(c.get("rbac"));
    const threadId = c.req.param("threadId");
    const thread = bindings.chatThreads.getForUser(
      threadId,
      tenant.tenant_id,
      user.user_id,
    );
    if (!thread) {
      throw new HTTPException(404, { message: "Chat thread not found" });
    }

    const body = createSessionShareSchema.parse(await c.req.json());

    try {
      const grant = await bindings.authClient.createSessionShare({
        tenantId: tenant.tenant_id,
        ownerUserId: user.user_id,
        threadId,
        granteeEmail: body.grantee_email,
        mode: body.mode,
      });
      return c.json(grant, 201);
    } catch (error) {
      if (error instanceof ControlPlaneRequestError) {
        throw new HTTPException(error.status as ContentfulStatusCode, {
          message: error.message,
        });
      }
      throw error;
    }
  });

  api.delete(
    "/chat/threads/:threadId/shares/:granteeUserId",
    csrfProtection,
    async (c) => {
      const tenant = c.get("tenant");
      const user = requireUser(c);
      requireUserRbac(c.get("rbac"));
      const threadId = c.req.param("threadId");
      const thread = bindings.chatThreads.getForUser(
        threadId,
        tenant.tenant_id,
        user.user_id,
      );
      if (!thread) {
        throw new HTTPException(404, { message: "Chat thread not found" });
      }

      try {
        const grant = await bindings.authClient.revokeSessionShare({
          tenantId: tenant.tenant_id,
          ownerUserId: user.user_id,
          threadId,
          granteeUserId: c.req.param("granteeUserId"),
        });
        return c.json(grant);
      } catch (error) {
        if (error instanceof ControlPlaneRequestError) {
          throw new HTTPException(error.status as ContentfulStatusCode, {
            message: error.message,
          });
        }
        throw error;
      }
    },
  );

  api.post("/chat/threads/:threadId/messages", csrfProtection, async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    const rbac = requireUserRbac(c.get("rbac"));
    const threadId = c.req.param("threadId");

    let resolved;
    try {
      resolved = await resolveThreadAccess(
        bindings.chatThreads,
        bindings.authClient,
        {
          tenantId: tenant.tenant_id,
          userId: user.user_id,
          threadId,
        },
      );
    } catch (error) {
      if (error instanceof ControlPlaneRequestError) {
        throw new HTTPException(error.status as ContentfulStatusCode, {
          message: error.message,
        });
      }
      throw error;
    }

    if (!resolved) {
      throw new HTTPException(404, { message: "Chat thread not found" });
    }

    if (!canSendMessages(resolved.access)) {
      throw new HTTPException(403, {
        message: "Read-only access to this shared thread",
      });
    }

    const thread = resolved.thread;

    const body = sendMessageSchema.parse(await c.req.json());

    const stagingPaths = body.mcq_selection
      ? []
      : (body.staging_paths ?? []).map((path) =>
          stagingService.assertReadablePath(rbac, path),
        );
    const outboundText =
      (body.text?.trim() ?? "") + formatStagingReferences(stagingPaths);

    // lp-oop.20 / lp-vqr0.11 T6: harness no-tool send looks up the primary
    // instance. Toolbox bind wakes Daytona. Relay keeps getPrimaryGatewayInstance
    // until cutover. lp-j39s: harness now persists bubble + arms mid_turn BEFORE
    // the turn and start-from-stopped (reuse) if the box is stopped, so the
    // idle reaper does not reap an unused box and proxy does not stream to a
    // dead harness.
    // lp-k5c4.8: spine tenants (persist harness + HARNESS_URL) skip
    // requestChatDelivery. Process env stays relay. EC2 residual stays Relay.
    // lp-vqr0.8: relay slow wakes must not hold the CloudFront origin (60s).
    const hop = requestChatHop(bindings, tenant);
    const chatDelivery = chatHopDelivery(hop);
    let instanceId: string;
    try {
      const resolvedInstance = await resolveChatSendInstance(
        chatDelivery === "harness"
          ? {
              chatDelivery: "harness",
              sandboxNeed: "none",
              authClient: bindings.authClient,
              tenantId: tenant.tenant_id,
              userId: user.user_id,
            }
          : {
              chatDelivery: "relay",
              authClient: bindings.authClient,
              tenantId: tenant.tenant_id,
              userId: user.user_id,
            },
      );
      instanceId = resolvedInstance.instanceId;
    } catch (error) {
      if (chatDelivery === "harness") {
        threadLiveEvents.publish(
          thread.thread_id,
          mapEnsureOnlineErrorToLiveEvent({
            error,
            threadId: thread.thread_id,
          }),
        );
        if (error instanceof ControlPlaneRequestError) {
          const mapped = mapControlPlaneWakeFailure(error);
          return c.json(
            wakeFailureToJsonBody(mapped),
            mapped.httpStatus as ContentfulStatusCode,
          );
        }
      }
      if (error instanceof ControlPlaneRequestError) {
        throw new HTTPException(error.status as ContentfulStatusCode, {
          message: error.message,
        });
      }
      throw error;
    }

    // Human message thaws halt/fuse freeze for this thread (gateway-owned).
    // Wake set is decideHuman: unmentioned → lead; named @s only (lp-k5c4.15).
    // lp-bhcg.2 / lp-bhcg.3: a persona backend or the process backend
    // does not need a relay process. The persona key wins.
    const chatBackend = await resolveChatAgentBackend({
      vaultRoot: process.env.VAULT_ROOT?.trim() || undefined,
      agentId: thread.agent_id,
      fallback: bindings.agentBackend,
    });
    if (!chatBackend) {
      await thawMailboxRoom({
        gateway: bindings.relayClient,
        instanceId,
        threadId: thread.thread_id,
      });
    }

    // Agent project primary_path is stored on the thread as project_vault_path.
    // Stamp host sandbox cwd via chat_topic + metadata.working_directory (lp-rt5.5).
    const workingDirectory = resolveChatWorkingDirectory(
      thread.project_vault_path,
    );
    const workingDirectoryMeta =
      chatWorkingDirectoryMetadata(workingDirectory);
    // lp-lv9.4: purpose block for interactive chats (additive; never replaces
    // vault/AGENTS.md host context — host should prepend purpose_block).
    const purposeMeta = chatSystemPromptMetadata(thread.system_prompt);
    const inboundMetadata =
      workingDirectoryMeta || purposeMeta
        ? {
            ...(workingDirectoryMeta ?? {}),
            ...(purposeMeta ?? {}),
          }
        : undefined;

    const sessionSource = {
      platform: LANYARD_WEB_PLATFORM,
      chat_id: thread.thread_id,
      chat_type: "dm" as const,
      chat_name: thread.title,
      user_id: user.user_id,
      user_name: user.email,
      thread_id: null,
      // Dual channel: SessionSource.chat_topic (historical Hermes pin) +
      // metadata.working_directory (explicit host cwd stamp).
      chat_topic: workingDirectory,
      profile: rbac.hermes_profile,
    };

    const wakeText = body.mcq_selection
      ? body.mcq_selection.label
      : outboundText;
    // lp-v62i.13 — live-fetch channel_context for group threads so harness personaTurns
    // carry sibling excerpts (channel pool hybrid per-thread lease + channel-wide read)
    let channelContext: import("@lanyard/shared").ChannelContext | null = null;
    if (thread.kind === "group") {
      try {
        channelContext = await channelPoolStore.fetchChannelContext({
          tenant_id: tenant.tenant_id,
          channel_id: thread.thread_id,
        });
      } catch {}
    }
    const groupStamp = stampGroupDeliverInbound({
      thread,
      authorUserId: user.user_id,
      authorDisplayName: user.email,
      text: wakeText,
      ...(channelContext ? { channelContext } : {}),
    });

    const event = body.mcq_selection
      ? buildMcqSelectionMessageEvent({
          selection: body.mcq_selection,
          source: sessionSource,
        })
      : {
          text: outboundText,
          message_type: stagingPaths.length > 0 ? ("document" as const) : ("text" as const),
          source: sessionSource,
          ...(inboundMetadata ? { metadata: inboundMetadata } : {}),
        };

    // lp-y3j (Phase 5): instance-scoped ensure_online before deliver-inbound
    // stays on the relay path (flag default off). Harness no-tool send does
    // not wake (lp-vqr0.11 T6); toolbox bind still ensure_online.
    //
    // lp-u7z: while wake runs, publish agent_starting → agent_ready (or error)
    // on the thread live-events hub so GET …/events SSE clients can show
    // "Agent starting…" and map timeout to a structured error event.
    //
    // lp-mrh: wake failures → structured user-visible error (code + retry
    // guidance). Do NOT deliver-inbound on failure.
    // lp-v62i.11: persist the user bubble BEFORE kickoff/deliver so a slow
    // or failed relay hop still paints (harness already did this in lp-j39s).
    //
    // lp-vqr0.8 / T4: if ensure_online is still pending this tick, return 202
    // agent_starting and finish wake + deliver off the CloudFront origin.
    let pendingRelayWake: Promise<EnsureOnlineResponse> | undefined;
    let startingPresence: InstancePresenceState | undefined;
    const publishStarting = (
      id: string,
      presence: InstancePresenceState,
    ) => {
      threadLiveEvents.publish(
        thread.thread_id,
        buildAgentStartingEvent({
          instanceId: id,
          threadId: thread.thread_id,
          presence,
        }),
      );
    };
    const publishReady = (
      id: string,
      alreadyOnline: boolean,
      wakeJoined: boolean,
    ) => {
      threadLiveEvents.publish(
        thread.thread_id,
        buildAgentReadyEvent({
          instanceId: id,
          threadId: thread.thread_id,
          alreadyOnline,
          wakeJoined,
        }),
      );
    };
    const publishWakeError = (error: unknown, id: string) => {
      threadLiveEvents.publish(
        thread.thread_id,
        mapEnsureOnlineErrorToLiveEvent({
          error,
          instanceId: id,
          threadId: thread.thread_id,
        }),
      );
    };

    // Snapshot tail before persist so the current send is not duplicated in
    // metadata.room_tail (it already lives in turn.message).
    const roomTail = boundRoomTail(
      bindings.chatThreads.listHistory(thread.thread_id),
    );

    const persistUserSendBubble = (sendInstanceId: string): string => {
      const userMessageId = randomUUID();
      const userCreatedAt = new Date().toISOString();
      let userContentForCorpus: string | null = null;
      const userSpeaker = groupStamp?.authorSpeaker;
      if (body.mcq_selection) {
        userContentForCorpus = body.mcq_selection.label;
        bindings.chatThreads.appendHistory(thread.thread_id, {
          type: "user_message",
          message_id: userMessageId,
          content: body.mcq_selection.label,
          created_at: userCreatedAt,
          chat_id: thread.thread_id,
          ...(userSpeaker ? { speaker: userSpeaker } : {}),
        });
      } else if (outboundText.trim()) {
        userContentForCorpus = outboundText;
        bindings.chatThreads.appendHistory(thread.thread_id, {
          type: "user_message",
          message_id: userMessageId,
          content: outboundText,
          created_at: userCreatedAt,
          chat_id: thread.thread_id,
          ...(userSpeaker ? { speaker: userSpeaker } : {}),
        });
      }
      if (chatCorpusCapture && userContentForCorpus !== null) {
        chatCorpusCapture.bufferUserTurn({
          turn_id: userMessageId,
          tenant_id: tenant.tenant_id,
          user_id: user.user_id,
          instance_id: sendInstanceId,
          thread_id: thread.thread_id,
          session_key: `agent:main:relay:dm:${thread.thread_id}`,
          created_at: userCreatedAt,
          content: userContentForCorpus,
        });
      }
      return userMessageId;
    };

    const userMessageId = persistUserSendBubble(instanceId);

    // lp-bhcg.2: three-field backend. No relay, Cognito, or Secrets Manager.
    // A rejected key is returned as-is. No Hermes default reply.
    // lp-bhcg.3: the thread's agent backend is used when one is stored.
    if (chatBackend && !body.mcq_selection) {
      const vaultRoot = process.env.VAULT_ROOT?.trim();
      const catalog = vaultRoot
        ? await loadModelCatalog(vaultRoot)
        : DEFAULT_MODEL_CATALOG;
      const savedTurn = vaultRoot
        ? await completeSavedModelTurn(vaultRoot, outboundText)
        : null;
      const result = savedTurn
        ? savedTurn
        : await (async () => {
            const routed = routeCatalogModel(catalog, outboundText);
            if (!routed.ok) {
              throw new HTTPException(503, { message: routed.error });
            }
            return completeAgentBackendTurn({
              config: { ...chatBackend, model: routed.modelId },
              turn: {
                tenant_id: tenant.tenant_id,
                user_id: user.user_id,
                instance_id: instanceId,
                thread_id: thread.thread_id,
                message: outboundText,
              },
            });
          })();
      if (!result.ok) {
        throw new HTTPException(result.status as ContentfulStatusCode, {
          message: result.error,
        });
      }
      const assistant = {
        type: "message_send" as const,
        chat_id: thread.thread_id,
        message_id: result.message_id,
        content: result.content,
        created_at: result.created_at,
      };
      bindings.chatThreads.appendHistory(thread.thread_id, assistant);
      threadLiveEvents.publish(thread.thread_id, assistant);
      return c.json({
        ok: true,
        thread_id: thread.thread_id,
        message_id: userMessageId,
      });
    }

    // lp-k5c4.16: Jack @Peer in a 1:1 is mailbox.send (origin notice +
    // target 1:1 source=mailbox). Do not wake the origin persona as if the
    // @ were for them. Mention-hop stays retired.
    const spine = mailboxSpineEnqueue();
    if (hop.kind === "spine" && spine && !body.mcq_selection) {
      const humanHop = await hopHumanOneToOneMentions({
        chat: bindings.chatThreads,
        nonces: mailboxNonces,
        liveEvents: threadLiveEvents,
        spine,
        tenantId: tenant.tenant_id,
        userId: user.user_id,
        instanceId,
        thread,
        text: outboundText,
        nonceSeed: userMessageId,
        gateway: mailboxGateway,
      });
      if (humanHop.hopped) {
        return c.json({ ok: true, thread_id: thread.thread_id });
      }
    }

    // lp-v62i.18 — old mention-hop relay branch removed (keep only harness Muse Spark path, HARNESS_URL 4310)
    // Previous chatDelivery !== "harness" ensureOnline kickoff deleted — harness path handles wake via spine/startTurn.

    const relayEvents =
      groupStamp === null
        ? [event]
        : groupStamp.deliveries.map((delivery) => ({
            ...event,
            metadata: {
              ...(event.metadata ?? {}),
              ...delivery.metadata,
            },
          }));

    const commitSend = async (opts: {
      instanceId: string;
      harnessSandboxId?: string;
    }) => {
      let sendInstanceId = opts.instanceId;
      let sendSandboxId = opts.harnessSandboxId;
      // lp-j39s / lp-v62i.11: user bubble is already persisted (before
      // kickoff/deliver). Harness still arms mid_turn before startTurn and
      // start-from-stopped reuses a stopped box. Relay delivers after this.
      // lp-oop.35: harness variant has no Relay client / deliverInbound.
      // EC2/guest dual-run stays on the relay variant.
      // lp-v62i.3.6: wake context is the TARGET room tail, not the previous
      // persona reply. Current user/mailbox text is the short trigger.
      if (chatDelivery === "harness") {
        // Arm mid_turn before idle-reaper check (lp-053) — CP store write only.
        await signalActivityIfNeeded({
          enabled: Boolean(bindings.signalActivityEnabled),
          authClient: bindings.authClient,
          instanceId: sendInstanceId,
          source: "message",
        });
        // If box is stopped (daytona not online), start-from-stopped (reuse)
        // — same path as relay (lp-vqr0.6) but for harness. No second box.
        // Guarded by ENSURE_ONLINE_ON_CHAT (live MockLab has it on). When off,
        // harness still delivers (offline test), but live will reuse.
        if (bindings.ensureOnlineOnChat) {
          try {
            const ensureResult = await ensureOnlineBeforeChatDeliver({
              enabled: true,
              authClient: bindings.authClient,
              instanceId: sendInstanceId,
              flights: ensureOnlineFlights,
              onStarting: ({ instanceId: id, presence }) => {
                threadLiveEvents.publish(
                  thread.thread_id,
                  buildAgentStartingEvent({
                    instanceId: id,
                    threadId: thread.thread_id,
                    presence,
                  }),
                );
              },
            });
            if (ensureResult.action === "ensured") {
              sendInstanceId = ensureResult.response.instance_id;
              if (ensureResult.response.sandbox_id) {
                sendSandboxId = ensureResult.response.sandbox_id;
              }
              threadLiveEvents.publish(
                thread.thread_id,
                buildAgentReadyEvent({
                  instanceId: sendInstanceId,
                  threadId: thread.thread_id,
                  alreadyOnline: ensureResult.response.already_online,
                  wakeJoined: ensureResult.response.wake_joined,
                }),
              );
            }
          } catch (error) {
            // Wake failed — bubble already persisted, publish error for SSE.
            threadLiveEvents.publish(
              thread.thread_id,
              mapEnsureOnlineErrorToLiveEvent({
                error,
                instanceId: sendInstanceId,
                threadId: thread.thread_id,
              }),
            );
            if (error instanceof ControlPlaneRequestError) {
              const mapped = mapControlPlaneWakeFailure(error);
              throw new HTTPException(mapped.httpStatus as ContentfulStatusCode, {
                message: JSON.stringify(wakeFailureToJsonBody(mapped)),
              });
            }
            throw error;
          }
        }
      }
      // lp-ornl: live per-call fetch from BFF-owned context_pool table.
      // Key is (tenant, human). Pool is messages-only, any writer.
      // Harness keeps SessionState per human-pool with delivered_event_ids + standing_context_sent.
      let contextPool: { tenant_id: string; human_user_id: string; revision_id: number; events: unknown[]; persona_ids?: string[] } | undefined;
      let standingContext: string | undefined;
      try {
        if (thread.kind === "chat" || thread.kind === "group") {
          const poolKey = { tenant_id: tenant.tenant_id, human_user_id: user.user_id };
          const fetched = contextPoolStore.fetch(poolKey);
          if (fetched.events.length > 0) {
            const personaIds = contextPoolStore.listParticipantPersonaIds(bindings.chatThreads, poolKey);
            // participants-only: filter pool events to this human's pool already ensures only participants' messages are in pool
            // Any writer already enforced at append; read is participants-only.
            const eventsJson = fetched.events.map((e) => e.event_json);
            contextPool = {
              tenant_id: poolKey.tenant_id,
              human_user_id: poolKey.human_user_id,
              revision_id: fetched.revision_id,
              events: eventsJson,
              persona_ids: personaIds,
            };
          }
          // standing context once per pool session — BFF sends it, harness tracks standing_context_sent
          standingContext = thread.system_prompt?.trim() || undefined;
        }
      } catch {}
      const turn = {
        tenant_id: tenant.tenant_id,
        user_id: user.user_id,
        instance_id: sendInstanceId,
        thread_id: thread.thread_id,
        message: harnessTurnMessage({
          text: outboundText,
          mcqLabel: body.mcq_selection?.label,
        }),
        metadata: harnessWakeMetadata({
          hostPlaybook: HOST_PLAYBOOK,
          roomTail,
          contextPool,
          standingContext,
          ...(channelContext ? { channelContext } : {}),
        }),
        ...(sendSandboxId ? { sandbox_id: sendSandboxId } : {}),
      };
      // lp-znef.1 / lp-v62i.19.1: each wake carries persona identity. Channel
      // fan-out uses deliveries; 1:1 stamps the thread's agent so Bill is
      // Bill, not Muse Spark.
      const teammates = bindings.chatThreads.listAgents(
        tenant.tenant_id,
        user.user_id,
      );
      const personaTurns = chatDelivery === "harness"
        ? (groupStamp?.deliveries ?? []).length > 0
          ? (groupStamp?.deliveries ?? []).map((delivery) => {
              const agent = bindings.chatThreads.getAgent(
                delivery.targetPersonaId,
              );
              return {
                ...turn,
                metadata: harnessWakeMetadata({
                  hostPlaybook: HOST_PLAYBOOK,
                  roomTail,
                  contextPool,
                  standingContext,
                  ...(channelContext ? { channelContext } : {}),
                  persona: personaMetaForWake({
                    thread,
                    personaId: delivery.targetPersonaId,
                    agent,
                    teammates,
                  }),
                }),
              };
            })
          : thread.kind === "chat" && thread.agent_id
            ? [
                {
                  ...turn,
                  metadata: harnessWakeMetadata({
                    hostPlaybook: HOST_PLAYBOOK,
                    roomTail,
                    contextPool,
                    standingContext,
                    persona: personaMetaForWake({
                      thread,
                      personaId: thread.agent_id,
                      agent: bindings.chatThreads.getAgent(thread.agent_id),
                      teammates,
                    }),
                  }),
                },
              ]
            : []
        : [];

      const spineQueue = bindings.inboundQueue;
      const spineHarness = bindings.harnessClient;
      const useSpine = hop.kind === "spine" && Boolean(spineQueue);
      const delivered =
        useSpine && spineQueue && spineHarness
          ? await deliverSpineTurns({
              store: spineQueue,
              startTurn: (request) => spineHarness.startTurn(request),
              items: (personaTurns.length > 0 ? personaTurns : [turn]).map(
                (personaTurn) =>
                  inboundWorkItemFromClassifiedTurn(personaTurn, {
                    source: "web",
                    text: personaTurn.message,
                    hasAttachment: stagingPaths.length > 0,
                  }),
              ),
              owner: inboundWorkerOwner,
              remember: async (threadId, turnId) => {
                await harnessTurns.remember(threadId, turnId);
              },
              wake: {
                authClient: bindings.authClient,
                flights: ensureOnlineFlights,
              },
              signalMidTurn: async (item, midTurn) => {
                await signalActivityIfNeeded({
                  enabled: Boolean(bindings.signalActivityEnabled),
                  authClient: bindings.authClient,
                  instanceId: item.instance_id,
                  source: inboundActivitySource(item),
                  midTurn,
                });
              },
            })
          : chatDelivery === "harness"
          ? bindings.harnessClient
            ? await deliverHarnessPersonaTurns({
                harnessClient: bindings.harnessClient,
                turns: personaTurns.length > 0 ? personaTurns : [turn],
                remember: async (turnId) => {
                  await harnessTurns.remember(thread.thread_id, turnId);
                },
              })
            : {
                ok: false as const,
                status: 503,
                error:
                  "Chat delivery is harness but no harness client is configured (set HARNESS_URL)",
              }
          : relayEvents.length === 0
            ? { ok: true as const, path: "relay" as const }
            : await deliverRelayChatTurns({
                relayClient: bindings.relayClient,
                instanceId: sendInstanceId,
                tenantId: tenant.tenant_id,
                events: relayEvents,
              });

      if (!delivered.ok) {
        throw new HTTPException(delivered.status as ContentfulStatusCode, {
          message: delivered.error,
        });
      }

      if (delivered.path === "harness") {
        await harnessTurns.remember(thread.thread_id, delivered.turn_id);
      }

      // lp-96v: refresh idle timer from user message activity (best-effort).
      // Arms mid_turn so idle reaper skips stop during the agent turn (lp-053).
      // CP store write only — no Daytona round-trip. Errors never fail chat.
      // Harness already signaled before startTurn. Relay still signals after
      // successful deliver (do not move mid_turn earlier in this leaf).
      if (chatDelivery !== "harness") {
        await signalActivityIfNeeded({
          enabled: Boolean(bindings.signalActivityEnabled),
          authClient: bindings.authClient,
          instanceId: sendInstanceId,
          source: "message",
        });
      }
    };

    const isHandshakeHttpError = (error: unknown): boolean =>
      error instanceof HTTPException &&
      isRelayGatewayNotReady({
        status: error.status,
        error: error.message,
      });

    const commitSendWhenGatewayReady = async (opts: {
      instanceId: string;
      harnessSandboxId?: string;
    }) => {
      const deadline = Date.now() + RELAY_GATEWAY_READY_RETRY_BUDGET_MS;
      for (;;) {
        try {
          await commitSend(opts);
          return;
        } catch (error) {
          if (!isHandshakeHttpError(error) || Date.now() >= deadline) {
            throw error;
          }
          await new Promise((resolve) =>
            setTimeout(resolve, RELAY_GATEWAY_READY_RETRY_MS),
          );
        }
      }
    };

    const finishDetachedWake = (
      flight: Promise<EnsureOnlineResponse>,
      presence: InstancePresenceState,
    ) => {
      void flight.then(
        async (response) => {
          publishReady(
            response.instance_id,
            response.already_online,
            response.wake_joined,
          );
          const sandbox = response.sandbox_id?.trim();
          try {
            await commitSendWhenGatewayReady({
              instanceId: response.instance_id,
              ...(sandbox ? { harnessSandboxId: sandbox } : {}),
            });
          } catch (error) {
            publishWakeError(error, response.instance_id);
          }
        },
        (error: unknown) => {
          publishWakeError(error, instanceId);
        },
      );
      return c.json(
        buildAgentStartingAcceptedBody({
          instanceId,
          threadId: thread.thread_id,
          presence,
        }),
        202,
      );
    };

    if (pendingRelayWake) {
      return finishDetachedWake(
        pendingRelayWake,
        startingPresence ?? "offline",
      );
    }

    try {
      await commitSend({ instanceId });
      return c.json({ ok: true, thread_id: thread.thread_id });
    } catch (error) {
      // Relay handshake 502/503 is agent-not-ready. Do not fail Send; T4
      // returns 202 and finishes deliver when the gateway can take it.
      if (chatDelivery === "harness" || !isHandshakeHttpError(error)) {
        throw error;
      }
      publishStarting(instanceId, startingPresence ?? "offline");
      void (async () => {
        try {
          const kick = await ensureOnlineBeforeChatDeliverKickoff({
            enabled: Boolean(bindings.ensureOnlineOnChat),
            authClient: bindings.authClient,
            instanceId,
            flights: ensureOnlineFlights,
            onStarting: ({ instanceId: id, presence }) => {
              startingPresence = presence;
              publishStarting(id, presence);
            },
          });
          if (kick.action === "waking" || kick.action === "ensured") {
            const response =
              kick.action === "waking" ? await kick.flight : kick.response;
            publishReady(
              response.instance_id,
              response.already_online,
              response.wake_joined,
            );
            const sandbox = response.sandbox_id?.trim();
            await commitSendWhenGatewayReady({
              instanceId: response.instance_id,
              ...(sandbox ? { harnessSandboxId: sandbox } : {}),
            });
            return;
          }
          await commitSendWhenGatewayReady({ instanceId });
          publishReady(instanceId, false, false);
        } catch (wakeError) {
          publishWakeError(wakeError, instanceId);
        }
      })();
      return c.json(
        buildAgentStartingAcceptedBody({
          instanceId,
          threadId: thread.thread_id,
          presence: startingPresence ?? "offline",
        }),
        202,
      );
    }
  });

  /**
   * Mid-turn cancel (Hermes Esc / interrupt_inbound).
   * Stops the active agent turn for this portal thread without sending a new message.
   */
  api.post("/chat/threads/:threadId/cancel", csrfProtection, async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    const threadId = c.req.param("threadId");

    let resolved;
    try {
      resolved = await resolveThreadAccess(
        bindings.chatThreads,
        bindings.authClient,
        {
          tenantId: tenant.tenant_id,
          userId: user.user_id,
          threadId,
        },
      );
    } catch (error) {
      if (error instanceof ControlPlaneRequestError) {
        throw new HTTPException(error.status as ContentfulStatusCode, {
          message: error.message,
        });
      }
      throw error;
    }

    if (!resolved) {
      throw new HTTPException(404, { message: "Chat thread not found" });
    }

    if (!canSendMessages(resolved.access)) {
      throw new HTTPException(403, { message: "Cannot cancel this thread" });
    }

    const hop = requestChatHop(bindings, tenant);

    // lp-oop.35 / lp-k5c4.8: Daytona harness/spine cancel uses the remembered
    // turn only. Spine tenants do not consult requestChatDelivery.
    // Do not resolve a Relay instance or call interruptInbound.
    if (isHarnessChatHop(hop)) {
      const delivered = await interruptChatTurn({
        chatDelivery: "harness",
        harnessClient: bindings.harnessClient,
        turnId: await harnessTurns.latest(threadId),
      });
      if (!delivered.ok) {
        throw new HTTPException(delivered.status as ContentfulStatusCode, {
          message: delivered.error,
        });
      }
      return c.json({ ok: true, thread_id: threadId });
    }

    let instanceId: string;
    try {
      const primary = await bindings.authClient.getPrimaryGatewayInstance(
        tenant.tenant_id,
      );
      instanceId = primary.instance_id;
    } catch (error) {
      if (error instanceof ControlPlaneRequestError) {
        throw new HTTPException(error.status as ContentfulStatusCode, {
          message: error.message,
        });
      }
      throw error;
    }

    // Hermes active-session key (exact match for interrupt_session_activity):
    // - Wire platform stays "lanyard_web", but _event_from_wire coerces
    //   Platform("lanyard_web") → Platform.RELAY ("relay") for session keys.
    // - handle_message uses build_session_key without profile → agent:main.
    // Using agent:main:lanyard_web:dm:… misses the active map and is a silent no-op.
    const sessionKey = `agent:main:relay:dm:${threadId}`;

    const delivered = await interruptChatTurn({
      chatDelivery: "relay",
      relayClient: bindings.relayClient,
      relay: {
        instanceId,
        sessionKey,
        chatId: threadId,
      },
    });

    if (!delivered.ok) {
      throw new HTTPException(delivered.status as ContentfulStatusCode, {
        message: delivered.error,
      });
    }

    return c.json({ ok: true, thread_id: threadId });
  });

  /**
   * Halt: abort in-flight turns and freeze new wakes until Jack speaks.
   * Stop-on-send (POST …/cancel) stays interrupt-only.
   */
  api.post("/chat/threads/:threadId/mailbox/halt", csrfProtection, async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    const threadId = c.req.param("threadId");

    const haltRoom = mailboxHaltRoomFromThreadId(threadId);
    if ("error" in haltRoom) {
      return c.json(mailboxErrorBody(haltRoom.error), 404);
    }

    let resolved;
    try {
      resolved = await resolveThreadAccess(
        bindings.chatThreads,
        bindings.authClient,
        {
          tenantId: tenant.tenant_id,
          userId: user.user_id,
          threadId: haltRoom.room,
        },
      );
    } catch (error) {
      if (error instanceof ControlPlaneRequestError) {
        throw new HTTPException(error.status as ContentfulStatusCode, {
          message: error.message,
        });
      }
      throw error;
    }

    if (!resolved) {
      return c.json(
        mailboxErrorBody("not_found" satisfies MailboxErrorCode),
        404,
      );
    }

    if (!canSendMessages(resolved.access)) {
      return c.json(
        mailboxErrorBody("forbidden" satisfies MailboxErrorCode),
        403,
      );
    }

    const chatDelivery = requestChatDelivery(bindings, tenant);

    const freeze = async (instanceId: string) => {
      const frozen = await freezeMailboxRoom({
        gateway: bindings.relayClient,
        instanceId,
        threadId: haltRoom.room,
      });
      if (!frozen.ok) {
        throw new HTTPException(frozen.status as ContentfulStatusCode, {
          message: frozen.error,
        });
      }
    };

    if (chatDelivery === "harness") {
      const delivered = await interruptChatTurn({
        chatDelivery: "harness",
        harnessClient: bindings.harnessClient,
        turnId: await harnessTurns.latest(haltRoom.room),
      });
      if (
        !delivered.ok &&
        !isRelayGatewayNotReady({
          status: delivered.status,
          error: delivered.error,
        })
      ) {
        throw new HTTPException(delivered.status as ContentfulStatusCode, {
          message: delivered.error,
        });
      }
      await freeze("harness");
      return c.json({ ok: true, thread_id: haltRoom.room });
    }

    let instanceId: string;
    try {
      const primary = await bindings.authClient.getPrimaryGatewayInstance(
        tenant.tenant_id,
      );
      instanceId = primary.instance_id;
    } catch (error) {
      if (error instanceof ControlPlaneRequestError) {
        throw new HTTPException(error.status as ContentfulStatusCode, {
          message: error.message,
        });
      }
      throw error;
    }

    const sessionKey = `agent:main:relay:dm:${haltRoom.room}`;
    const delivered = await interruptChatTurn({
      chatDelivery: "relay",
      relayClient: bindings.relayClient,
      relay: {
        instanceId,
        sessionKey,
        chatId: haltRoom.room,
      },
    });
    if (
      !delivered.ok &&
      !isRelayGatewayNotReady({
        status: delivered.status,
        error: delivered.error,
      })
    ) {
      throw new HTTPException(delivered.status as ContentfulStatusCode, {
        message: delivered.error,
      });
    }

    await freeze(instanceId);
    return c.json({ ok: true, thread_id: haltRoom.room });
  });

  /**
   * Durable thread transcript for reload hydrate (portal-wak.1 / portal-c0q.1).
   * Merges BFF history (user_message + SSE-teed outbound) with relay ring buffer,
   * de-duping on (type, message_id, tool_call_id, content).
   */
  api.get("/chat/threads/:threadId/history", async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    const threadId = c.req.param("threadId");

    let resolved;
    try {
      resolved = await resolveThreadAccess(
        bindings.chatThreads,
        bindings.authClient,
        {
          tenantId: tenant.tenant_id,
          userId: user.user_id,
          threadId,
        },
      );
    } catch (error) {
      if (error instanceof ControlPlaneRequestError) {
        throw new HTTPException(error.status as ContentfulStatusCode, {
          message: error.message,
        });
      }
      throw error;
    }

    if (!resolved) {
      throw new HTTPException(404, { message: "Chat thread not found" });
    }

    const bffEvents = bindings.chatThreads.listHistory(
      resolved.thread.thread_id,
    );

    const chatDelivery = bindings.chatDelivery ?? DEFAULT_CHAT_DELIVERY;
    const historyBackend = await resolveChatAgentBackend({
      vaultRoot: process.env.VAULT_ROOT?.trim() || undefined,
      agentId: resolved.thread.agent_id,
      fallback: bindings.agentBackend,
    });
    if (chatDelivery === "harness" || historyBackend) {
      // lp-oop.36: BFF store is SoT on the harness hop. Do not call Relay.
      // lp-bhcg.2: the API-key backend stores the assistant turn here too.
      return c.json({
        thread_id: resolved.thread.thread_id,
        events: mergeChatHistoryEvents(bffEvents, []),
      });
    }

    let relayEvents: import("./relay-client.js").RelayChatEvent[] = [];
    let outboundIncomplete = false;
    // G6: stick history to the relay task that owns the gateway chat hub.
    let historyInstanceId: string | undefined;
    try {
      const primary = await bindings.authClient.getPrimaryGatewayInstance(
        tenant.tenant_id,
      );
      historyInstanceId = primary.instance_id;
    } catch {
      // Fall back to service URL when primary instance is unavailable.
    }
    const relayHistory = await bindings.relayClient.fetchChatHistory(
      resolved.thread.thread_id,
      { instanceId: historyInstanceId },
    );
    if (relayHistory.ok) {
      relayEvents = relayHistory.events;
    } else {
      // Surface incomplete merge when relay fails and BFF has no teed outbound
      // (pre-tee clients / never-opened SSE would otherwise look user-only).
      log.warn("relay history failed", {
        thread_id: resolved.thread.thread_id,
        error_code: relayHistory.error,
        status: relayHistory.status,
      });
      if (!bindings.chatThreads.hasOutboundHistory(resolved.thread.thread_id)) {
        outboundIncomplete = true;
      }
    }

    const events = mergeChatHistoryEvents(bffEvents, relayEvents);

    return c.json({
      thread_id: resolved.thread.thread_id,
      events,
      ...(outboundIncomplete ? { outbound_incomplete: true } : {}),
    });
  });

  api.get("/chat/threads/:threadId/events", async (c) => {
    const tenant = c.get("tenant");
    const user = requireUser(c);
    const threadId = c.req.param("threadId");

    let resolved;
    try {
      resolved = await resolveThreadAccess(
        bindings.chatThreads,
        bindings.authClient,
        {
          tenantId: tenant.tenant_id,
          userId: user.user_id,
          threadId,
        },
      );
    } catch (error) {
      if (error instanceof ControlPlaneRequestError) {
        throw new HTTPException(error.status as ContentfulStatusCode, {
          message: error.message,
        });
      }
      throw error;
    }

    if (!resolved) {
      throw new HTTPException(404, { message: "Chat thread not found" });
    }

    const thread = resolved.thread;

    // G6: stick SSE to the relay task that owns the gateway chat hub.
    let eventsInstanceId: string | undefined;
    try {
      const primary = await bindings.authClient.getPrimaryGatewayInstance(
        tenant.tenant_id,
      );
      eventsInstanceId = primary.instance_id;
    } catch {
      // Fall back to service URL when primary instance is unavailable.
    }

    return streamSSE(c, async (stream) => {
      const abort = new AbortController();
      c.req.raw.signal.addEventListener("abort", () => abort.abort());

      // lp-u7z: gate so agent_ready/error published during presence probe or
      // before a secondary wait subscription is not lost (instant fake wakes).
      type WakeGate = "pending" | "ready" | "error";
      let wakeGate: WakeGate = "pending";
      const wakeWaiters = new Set<(state: WakeGate) => void>();
      const noteWake = (state: "ready" | "error") => {
        wakeGate = state;
        for (const w of wakeWaiters) w(state);
        wakeWaiters.clear();
      };
      const waitForWakeGate = (): Promise<WakeGate> => {
        if (wakeGate !== "pending") return Promise.resolve(wakeGate);
        if (abort.signal.aborted) return Promise.resolve("error");
        return new Promise((resolve) => {
          const onAbort = () => {
            wakeWaiters.delete(waiter);
            abort.signal.removeEventListener("abort", onAbort);
            resolve("error");
          };
          const waiter = (state: WakeGate) => {
            abort.signal.removeEventListener("abort", onAbort);
            resolve(state);
          };
          wakeWaiters.add(waiter);
          abort.signal.addEventListener("abort", onAbort);
        });
      };

      // Forward BFF wake status events on this connection before/while
      // proxying the normal relay chat stream.
      // Write SSE first, then advance the wake gate so waiters never close the
      // stream before agent_ready / error frames are flushed.
      const unsubLive = threadLiveEvents.subscribe(
        thread.thread_id,
        async (liveEvent) => {
          if (!abort.signal.aborted) {
            try {
              await stream.writeSSE({
                event: liveEvent.type,
                data: JSON.stringify(liveEvent),
              });
            } catch {
              /* client gone */
            }
          }
          if (liveEvent.type === "agent_ready") {
            noteWake("ready");
          } else if (liveEvent.type === "error") {
            noteWake("error");
          }
        },
      );

      const proxyRelayBody = async (body: ReadableStream<Uint8Array>) => {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              const event = parseRelaySseDataLine(line);
              if (event) {
                // Tee durable outbound into BFF history so reload hydrate does not
                // depend solely on the relay ring buffer (portal-c0q.1).
                const durable = durableOutboundFromRelayEvent(event);
                if (durable) {
                  bindings.chatThreads.appendHistory(thread.thread_id, durable);
                  // lp-gkh.5: when assistant outbound is known, assemble + async
                  // corpus write (enablement-gated; fail-open for chat).
                  chatCorpusCapture?.onDurableOutbound(
                    thread.thread_id,
                    durable,
                  );
                  workflowRunVaultPersist?.persistFromChatEvent(
                    tenant.tenant_id,
                    durable,
                  );
                }
                // lp-96v: tool_progress refreshes idle timer (debounced).
                // Do NOT signal on message_send token chunks (no per-token CP/Daytona).
                if (
                  event.type === "tool_progress" &&
                  eventsInstanceId &&
                  bindings.signalActivityEnabled
                ) {
                  signalActivityBestEffort({
                    enabled: true,
                    authClient: bindings.authClient,
                    instanceId: eventsInstanceId,
                    source: "tool_progress",
                  });
                }
                await stream.writeSSE({
                  event: event.type,
                  data: JSON.stringify(event),
                });
              }
            }
          }
        } finally {
          reader.releaseLock();
        }
      };

      // lp-znef.2: harness variant stamps persona speaker from turn metadata
      // so channel turns render ChatSpeakerLabel (avatar + name) and durable
      // history keeps attribution across reload.
      const proxyHarnessBody = async (body: ReadableStream<Uint8Array>) => {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const mailedTo = new Set<string>();
        const scheduledTaskCreated = new Set<string>();
        const nonceSeed = randomUUID();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              const event = parseRelaySseDataLine(line);
              if (!event) continue;
              const personaMeta = (
                event.metadata as Record<string, unknown> | undefined
              )?.persona as
                | { persona_id?: string; display_name?: string }
                | undefined;
              // lp-v62i.17 — also stamp tool_progress mailbox.send with caller persona so human pool retains "Bill → Fred" for "Message him"
              const shouldStampPersona =
                (event.type === "message_send" || event.type === "tool_progress") &&
                Boolean(personaMeta?.persona_id);
              let stamped = shouldStampPersona
                ? {
                    ...event,
                    speaker: {
                      kind: "persona" as const,
                      id: personaMeta!.persona_id!,
                      display_name:
                        personaMeta!.display_name ??
                        personaMeta!.persona_id!,
                    },
                  }
                : event;
              const durable = durableOutboundFromRelayEvent(stamped);
              if (durable) {
                bindings.chatThreads.appendHistory(thread.thread_id, durable);
                // lp-v62i.17 — explicit human pool append for group + tool_progress mailbox.send
                // ChatThreadStore.appendHistory already appends for group+chat via contextPoolStore,
                // but ensure tool_progress mailbox.send is pooled even if isMessagesOnly filtered before.
                // Direct append is idempotent via event_id dedup in pool; do it for tool_progress mailbox.send traces.
                if (
                  durable.type === "tool_progress" &&
                  ((durable as unknown as { tool_name?: string }).tool_name === "mailbox.send" ||
                    Boolean((durable as unknown as { metadata?: Record<string, unknown> }).metadata?.mailbox_send))
                ) {
                  try {
                    contextPoolStore.append({
                      key: { tenant_id: tenant.tenant_id, human_user_id: user.user_id },
                      threadId: thread.thread_id,
                      event: durable,
                    });
                  } catch {}
                }
                chatCorpusCapture?.onDurableOutbound(
                  thread.thread_id,
                  durable,
                );
              }
              // lp-k5c4.16: agent @ / mailbox.send tool → one hop brain.
              // Mention-hop does not start a second same-thread turn.
              const mailboxHop = requestChatHop(bindings, tenant);
              const spine = mailboxSpineEnqueue();
              if (mailboxHop.kind === "spine" && eventsInstanceId && spine) {
                await hopMailboxFromHarnessEvent({
                  chat: bindings.chatThreads,
                  nonces: mailboxNonces,
                  liveEvents: threadLiveEvents,
                  spine,
                  tenantId: tenant.tenant_id,
                  userId: user.user_id,
                  instanceId: eventsInstanceId,
                  thread,
                  event: stamped,
                  mailedTo,
                  nonceSeed,
                  gateway: mailboxGateway,
                });
              }
              // lp-v62i.23: scheduled_task.create → persist cron + bind stream.
              const scheduledHop = await hopScheduledTaskFromHarnessEvent({
                chat: bindings.chatThreads,
                jobs: bindings.scheduledJobStore,
                tenantId: tenant.tenant_id,
                userId: user.user_id,
                thread,
                event: stamped,
                createdIds: scheduledTaskCreated,
              });
              if (scheduledHop?.ok) {
                stamped = {
                  ...stamped,
                  metadata: stampScheduledTaskCreateMetadata(
                    stamped,
                    scheduledHop,
                  ),
                };
              }
              await stream.writeSSE({
                event: stamped.type,
                data: JSON.stringify(stamped),
              });
            }
          }
        } finally {
          reader.releaseLock();
        }
      };

      try {
        // lp-bhcg.2: assistant turns are published on this hub. Do not open Relay.
        const eventsBackend = await resolveChatAgentBackend({
          vaultRoot: process.env.VAULT_ROOT?.trim() || undefined,
          agentId: thread.agent_id,
          fallback: bindings.agentBackend,
        });
        if (eventsBackend) {
          await new Promise<void>((resolve) => {
            if (abort.signal.aborted) {
              resolve();
              return;
            }
            abort.signal.addEventListener("abort", () => resolve(), {
              once: true,
            });
          });
          return;
        }

        const hop = requestChatHop(bindings, tenant);
        if (isHarnessChatHop(hop)) {
          // Keep agent_starting / agent_ready on this connection when wake
          // still runs in front of the harness turn (ensure_online on chat).
          if (
            bindings.ensureOnlineOnChat &&
            !(await harnessTurns.latest(thread.thread_id))
          ) {
            if (eventsInstanceId) {
              try {
                const presence =
                  await bindings.authClient.getInstancePresence(eventsInstanceId);
                if (
                  presence.runtime_kind === "daytona" &&
                  presence.presence !== "online"
                ) {
                  await stream.writeSSE({
                    event: "agent_starting",
                    data: JSON.stringify(
                      buildAgentStartingEvent({
                        instanceId: eventsInstanceId,
                        threadId: thread.thread_id,
                        presence: presence.presence,
                      }),
                    ),
                  });
                } else {
                  noteWake("ready");
                }
              } catch {
                /* presence probe optional; message path still publishes starting */
              }
            }
            const wakeOutcome = await waitForWakeGate();
            if (wakeOutcome !== "ready") {
              return;
            }
          }

          if (!bindings.harnessClient) {
            await stream.writeSSE({
              event: "error",
              data: JSON.stringify({
                error:
                  "Chat delivery is harness but no harness client is configured (set HARNESS_URL)",
              }),
            });
            return;
          }

          await proxyHarnessTurnsUntilAbort({
            threadId: thread.thread_id,
            harnessClient: bindings.harnessClient,
            registry: harnessTurns,
            abort: abort.signal,
            proxyBody: proxyHarnessBody,
            // lp-v62i.8: a wedged harness turn must surface an error instead
            // of streaming silence forever (live MockLab turn_37 swallow).
            stallTimeoutMs: bindings.harnessTurnStallTimeoutMs,
            writeError: async (message) => {
              if (!abort.signal.aborted) {
                await stream.writeSSE({
                  event: "error",
                  data: JSON.stringify({ error: message }),
                });
              }
            },
            onTurnSettled: async () => {
              if (!eventsInstanceId) return;
              await signalActivityIfNeeded({
                enabled: Boolean(bindings.signalActivityEnabled),
                authClient: bindings.authClient,
                instanceId: eventsInstanceId,
                source: "message",
                midTurn: false,
              });
            },
          });
          return;
        }

        const openRelay = () =>
          bindings.relayClient.openChatEventStream(
            thread.thread_id,
            abort.signal,
            { instanceId: eventsInstanceId },
          );

        let relayResponse = await openRelay();

        // Cold wake: relay may be unreachable until ensure_online finishes.
        // When chat ensure_online is enabled, hold the SSE open, surface
        // agent_starting (from message POST / presence), wait for agent_ready,
        // then transition to the normal relay proxy. Timeout/wake fail → error.
        if ((!relayResponse.ok || !relayResponse.body) && bindings.ensureOnlineOnChat) {
          // Best-effort starting hint when presence is already non-online
          // (message POST may also publish agent_starting when wake begins).
          if (eventsInstanceId) {
            try {
              const presence =
                await bindings.authClient.getInstancePresence(eventsInstanceId);
              if (
                presence.runtime_kind === "daytona" &&
                presence.presence !== "online"
              ) {
                await stream.writeSSE({
                  event: "agent_starting",
                  data: JSON.stringify(
                    buildAgentStartingEvent({
                      instanceId: eventsInstanceId,
                      threadId: thread.thread_id,
                      presence: presence.presence,
                    }),
                  ),
                });
              } else {
                // Already online / non-daytona: message path will not publish
                // agent_ready (online skip). Do not hang the SSE hold gate.
                noteWake("ready");
              }
            } catch {
              // Presence probe optional; message path still publishes starting.
            }
          }

          const wakeOutcome = await waitForWakeGate();
          if (wakeOutcome !== "ready") {
            return;
          }

          relayResponse = await openRelay();
        }

        if (!relayResponse.ok || !relayResponse.body) {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({
              error: "Failed to connect to relay event stream",
            }),
          });
          return;
        }

        await proxyRelayBody(relayResponse.body);
      } catch (error) {
        if (!abort.signal.aborted) {
          await stream.writeSSE({
            event: "error",
            data: JSON.stringify({
              error: error instanceof Error ? error.message : "Stream error",
            }),
          });
        }
      } finally {
        unsubLive();
      }
    });
  });

  api.post("/auth/google/stub", csrfProtection, async (c) => {
    if (!isLocalDevMode(bindings)) {
      throw new HTTPException(404, { message: "Not found" });
    }

    const tenant = c.get("tenant");
    const body = z
      .object({
        google_sub: z.string().min(1),
        email: z.string().email(),
      })
      .parse(await c.req.json());

    try {
      const user = await bindings.authClient.googleCallback({
        tenantId: tenant.tenant_id,
        googleSub: body.google_sub,
        email: body.email,
      });

      await establishSession(bindings, c, {
        userId: user.user_id,
        tenantId: tenant.tenant_id,
        email: user.email,
      });

      return c.json({
        user_id: user.user_id,
        email: user.email,
        tenant_id: tenant.tenant_id,
        provider: "google",
      });
    } catch (error) {
      if (error instanceof ControlPlaneRequestError) {
        throw new HTTPException(error.status as ContentfulStatusCode, {
          message: error.message,
        });
      }
      throw error;
    }
  });

  /**
   * Gateway reports a fuse trip. BFF appends one system_notice; freeze stays
   * gateway-owned. Idempotent while the notice is still the open trip line.
   */
  app.post("/internal/mailbox/fuse-trip", async (c) => {
    const presented =
      c.req.header(RELAY_INTERNAL_TOKEN_HEADER)?.trim() ?? "";
    if (
      !mailboxInternalTokenMatches(
        bindings.config.relayInternalToken,
        presented,
      )
    ) {
      return c.json({ error: "unauthorized" }, 401);
    }

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(mailboxErrorBody("not_found"), 404);
    }

    const parsed = parseMailboxFuseTripInput(raw);
    if ("error" in parsed) {
      return c.json(mailboxErrorBody(parsed.error), 404);
    }

    const result = appendMailboxFuseTripNotice({
      store: bindings.chatThreads,
      tenant_id: parsed.tenant_id,
      thread_id: parsed.thread_id,
    });
    if (!result.ok) {
      return c.json(mailboxErrorBody(result.error), 404);
    }

    if (result.inserted) {
      threadLiveEvents.publish(
        result.thread_id,
        mailboxFuseTripLiveEvent({
          threadId: result.thread_id,
          messageId: result.message_id,
          createdAt: result.created_at,
        }),
      );
    }

    return c.json({
      ok: true,
      thread_id: result.thread_id,
      inserted: result.inserted,
      message_id: result.message_id,
    });
  });

  /**
   * Agent / harness mailbox.send. Authorize hop, origin system_notice,
   * enqueue source=mailbox on the target thread (lp-k5c4.16).
   */
  app.post("/internal/mailbox/send", async (c) => {
    const presented =
      c.req.header(RELAY_INTERNAL_TOKEN_HEADER)?.trim() ?? "";
    if (
      !mailboxInternalTokenMatches(
        bindings.config.relayInternalToken,
        presented,
      )
    ) {
      return c.json({ error: "unauthorized" }, 401);
    }

    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json(mailboxErrorBody("not_found"), 404);
    }

    const parsed = parseMailboxAppendOrError(raw);
    if ("error" in parsed) {
      return c.json(mailboxErrorBody(parsed.error), 404);
    }

    const ownerThread =
      bindings.chatThreads.getInTenant(parsed.room, parsed.tenant_id) ??
      bindings.chatThreads.findDirectThreadForAgent(parsed.from);
    if (!ownerThread) {
      return c.json(mailboxErrorBody("not_found"), 404);
    }

    let instanceId: string;
    try {
      const primary = await bindings.authClient.getPrimaryGatewayInstance(
        parsed.tenant_id,
      );
      instanceId = primary.instance_id;
    } catch {
      return c.json(mailboxErrorBody("not_found"), 404);
    }

    const result = await executeMailboxSend({
      chat: bindings.chatThreads,
      nonces: mailboxNonces,
      request: parsed,
      liveEvents: threadLiveEvents,
      spine: mailboxSpineEnqueue(),
      userId: ownerThread.user_id,
      instanceId,
      appendFromBubble: true,
      gateway: mailboxGateway,
    });
    if (!result.ok) {
      return c.json(mailboxErrorBody(result.error), 404);
    }
    void result.outputPersist.catch(() => {});
    return c.json({
      ok: true,
      replayed: result.replayed,
      message_id: result.message_id,
      target_thread_id: result.hop?.target_thread_id ?? null,
      mode: result.hop?.mode ?? null,
    });
  });

  // lp-ornl: BFF-owned context_pool table — CP fetches via BFF API (C shared API).
  // Live per-call fetch uses contextPoolStore.fetch(key) directly; this route is the CP-readable API.
  app.get("/internal/context-pool/:tenantId/:humanUserId", async (c) => {
    const presented = c.req.header(RELAY_INTERNAL_TOKEN_HEADER)?.trim() ?? "";
    if (!mailboxInternalTokenMatches(bindings.config.relayInternalToken, presented)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    const tenantId = c.req.param("tenantId")?.trim() ?? "";
    const humanUserId = c.req.param("humanUserId")?.trim() ?? "";
    if (!tenantId || !humanUserId) {
      return c.json({ error: "invalid key" }, 400);
    }
    const key = { tenant_id: tenantId, human_user_id: humanUserId };
    const fetched = contextPoolStore.fetch(key);
    return c.json({ ok: true, key, revision_id: fetched.revision_id, events: fetched.events });
  });

  // Ops console APIs. Mount before `/api` so `/api/admin/*` is not a tenant path.
  app.route("/api/admin", createOpsAuthApp({ ...bindings, opsSessions }));

  // Legacy + subdomain: Host {slug}.withlanyard.com → /api/*
  app.route("/api", api);
  // Path-based MVP: Host app.withlanyard.com → /{tenantSlug}/api/*
  app.route("/:tenantSlug/api", api);

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ error: error.message }, error.status);
    }
    if (error instanceof z.ZodError) {
      return c.json(
        { error: "Validation failed", details: error.flatten() },
        400,
      );
    }
    // Never log request bodies / vault content on the shared error sink (G2b.2).
    log.error("unhandled error", {
      error,
      route: c.req.path,
      method: c.req.method,
    });
    return c.json({ error: "Internal server error" }, 500);
  });

  return app;
}
