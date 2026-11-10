/** Tenant context attached to every /api/* request after subdomain resolution. */
export type TenantContext = {
  tenant_id: string;
  tenant_slug: string;
  display_name: string;
  host: string;
  /**
   * @deprecated lp-k5c4.13 Phase 10 column drop — request path no longer
   * branches on this persist. Kept for rollback / honesty. Column will be
   * dropped in the DB (see migrate.ts). Do not read for Send/SSE/cancel.
   */
  chat_delivery?: ChatDelivery | null;
};

export type TenantResolver = {
  resolveBySlug(slug: string): Promise<TenantContext | null>;
  resolveById(id: string): Promise<TenantContext | null>;
};

import type { CorpusWriter } from "@lanyard/chat-corpus";

import type {
  LeadSuccessionPicker,
} from "./channel-succession.js";
import type { ChatCorpusCapture } from "./chat-corpus-capture.js";
import type { ChatThreadStore } from "./chat-store.js";
import type { PendingConnectorUseStore } from "./connector-approval.js";
import type { CognitoPasswordAuth } from "./cognito-auth.js";
import type { ConnectorSource } from "./connector-source.js";
import type { RegistryCompileDeps } from "./registry-snapshot.js";
import type { ControlPlaneAuthClient } from "./control-plane-client.js";
import type { HermesProjectsService } from "./hermes-projects.js";
import type { OfficeBinaryContentSource } from "./office/binary-source.js";
import type {
  OfficeCallbackAllowlistConfig,
  OfficeCallbackFetcher,
  OfficeCallbackVaultWriter,
} from "./office/callback.js";
import type { OfficeDocumentSessionStore } from "./office/store.js";
import type { AgentBackendConfig } from "./agent-backend.js";
import type { BffConfig, ChatDelivery, VaultPlane } from "./config.js";
import type { HarnessClient } from "./harness-client.js";
import type { HarnessTurnRegistry } from "./harness-turn-registry.js";
import type { InboundQueueStore } from "./inbound-queue.js";
import type { BffScheduledJobStore } from "./scheduled-task-vault-store.js";
import type { RelayClient } from "./relay-client.js";
import type { UserRbac } from "./control-plane-client.js";
import type { OperatorDirectory } from "./operator-directory.js";
import type { OpsGoogleVerifier } from "./ops-google.js";
import type { OpsSessionStore } from "./ops-session.js";
import type { SessionStore, SessionUser } from "./session.js";
import type { StagingStorageProvider } from "./staging/types.js";
import type { ThreadLiveEventsHub } from "./thread-live-events.js";
import type { VaultContentProvider, VaultIndexProvider } from "./vault/types.js";

export type BffBindings = {
  tenantResolver: TenantResolver;
  devTenantSlug?: string;
  /**
   * Path-first app hosts (defaults + optional `APP_HOSTS`). When omitted,
   * tenant middleware uses shared defaults only.
   */
  appHosts?: string[];
  demoMemberRoleId?: string;
  authClient: ControlPlaneAuthClient;
  /**
   * lp-xhf4.9 — pending connector tool.approval rows (TTL minutes).
   * Process-local; tests inject a store. Default is created in routes.
   */
  pendingConnectorUses?: PendingConnectorUseStore;
  /** Password IdP. Required outside local-dev; tests inject FakeCognitoPasswordAuth. */
  cognito?: CognitoPasswordAuth;
  relayClient: RelayClient;
  /**
   * lp-oop.15 / lp-oop.35 — dual-run chat send. Default `relay` (EC2/guest
   * deliverInbound). `harness` is the Daytona hop: startTurn only, no
   * deliverInbound.
   */
  chatDelivery?: ChatDelivery;
  /**
   * lp-oop.15 / lp-oop.38.4 — BFF → harness HTTP client. Required when
   * chatDelivery=harness (turns and GET /settings/snapshot on cp_s3).
   */
  harnessClient?: HarnessClient;
  /**
   * lp-bhcg.2 — base URL + API key (`openai_chat` or `lanyard_harness`).
   * When set, Send uses this backend and does not require Relay.
   */
  agentBackend?: AgentBackendConfig;
  /**
   * lp-k5c4.3 / lp-k5c4.8 — durable inbound queue (Postgres SKIP LOCKED).
   * When set, spineEnabled MockLab Daytona tenants enqueue on Send.
   * Unflipped and EC2 residual tenants do not use this path.
   */
  inboundQueue?: InboundQueueStore;
  /**
   * lp-k5c4.16 — mailbox.send nonce store (dedupe on nonce). When omitted,
   * createApp builds a process-local SQLite memory store.
   */
  mailboxNonceStore?: import("./mailbox-nonce.js").MailboxNonceStore;
  /**
   * lp-oop.38.8 — durable scheduled-task jobs.json under the tenant vault.
   * POST /settings/crons on cp_s3+harness writes here (no guest tree).
   */
  scheduledJobStore?: BffScheduledJobStore;
  /**
   * lp-oop.38.22 — persist workflow run state.json onto CP S3 so vault
   * citations open without depending on guest Mountpoint listing.
   */
  workflowRunVaultPersist?: import("./workflow-run-vault-persist.js").WorkflowRunVaultPersist | null;
  /**
   * lp-oop.11 — vault UI plane. Default is today's path: `brain_rpc` when
   * `brainRpcEnabled`, else `fs`. `cp_s3` uses the CP HTTP provider and
   * must not call ensure_online on GET /api/vault/tree.
   */
  vaultPlane?: VaultPlane;
  /**
   * lp-oop.11 — per-tenant CpS3 factory. Production sets this when
   * `VaultPlane=cp_s3`. Tests inject a fake-CP provider.
   */
  createCpS3VaultProvider?: (tenantId: string) => VaultContentProvider;
  /**
   * lp-oop.12 — per-tenant Office binary via CP getObject. Production sets
   * this when `VaultPlane=cp_s3`. Tests inject a fake-CP source. Not default.
   */
  createCpS3OfficeBinarySource?: (tenantId: string) => OfficeBinaryContentSource;
  /**
   * lp-zuh.12.7 — Office callback vault.write via CP vault/put when
   * `VaultPlane=cp_s3`. Production sets this on the short stack. Not default.
   */
  createCpS3OfficeCallbackVaultWriter?: () => OfficeCallbackVaultWriter;
  /**
   * lp-oop.16 / lp-k5c4.12 — thread_id → latest harness TurnId. GET events /
   * cancel look this up. When omitted, createApp builds a process-local
   * registry. Production injects Postgres so multi-replica cancel/SSE share
   * turn_id.
   */
  harnessTurnRegistry?: HarnessTurnRegistry;
  chatThreads: ChatThreadStore;
  sessions: SessionStore;
  /**
   * Ops console sessions (`lanyard_ops_session`). Separate store from tenant
   * sessions so a tenant cookie can never resolve as an operator.
   * When omitted, createApp uses an in-memory ops store.
   */
  opsSessions?: OpsSessionStore;
  /**
   * Closed operator allowlist. Empty/omitted is fail-closed (nobody).
   * Production: `PLATFORM_OPERATOR_EMAILS`.
   */
  operatorDirectory?: OperatorDirectory;
  /**
   * lp-hdzm.5 — catalog source for Registry search / pinned snapshots.
   * Tests inject the offline fixture so CI never hits integrations.sh.
   * Production uses the pinned HTTPS fetcher.
   */
  connectorSource?: ConnectorSource;
  /**
   * lp-hdzm.19 — MCP initialize / OpenAPI inliners for promote compile.
   * Tests inject fixture probes so CI never hits vendor URLs.
   */
  registryCompileDeps?: RegistryCompileDeps;
  /**
   * Google authorization-code exchange for ops login. Tests inject a fake.
   * Production uses GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET.
   */
  opsGoogleVerifier?: OpsGoogleVerifier;
  /**
   * lp-xhf4.8 — one pending connector tool per tenant user (TTL minutes).
   * When omitted, createApp builds an in-memory store.
   */
  pendingConnectorUseStore?: import("./pending-connector-use.js").PendingConnectorUseStore;
  /**
   * Server-owned Office document sessions (lp-5q6.21).
   * When omitted, createApp builds an in-memory store (lab default).
   */
  officeDocumentSessions?: OfficeDocumentSessionStore;
  /**
   * Vault content provider used for OnlyOffice mint revision + signed download.
   * When omitted, falls back to vaultContentProvider.
   *
   * Brain RPC vault paths are relative to VAULT_ROOT (`/Business/...`). Hermes
   * multi-root providers expect absolute project paths and fail mint with
   * missing_file — inject createFsVaultContentProvider(VAULT_ROOT) for lab/RPC.
   */
  officeVaultContentProvider?: VaultContentProvider;
  /**
   * Binary reader for signed Office download (lp-5q6.22).
   * When omitted, wraps officeVaultContentProvider ?? vaultContentProvider
   * unless VaultPlane=cp_s3 and createCpS3OfficeBinarySource is set (lp-oop.12).
   */
  officeBinarySource?: OfficeBinaryContentSource;
  /**
   * Max bytes for Office signed download / callback fetch (default 50 MiB).
   */
  officeMaxDownloadBytes?: number;
  /**
   * Document Server host allowlist for callback URL fetch (SSRF guard).
   * When omitted, loaded from BFF_OFFICE_DOCUMENT_SERVER_HOSTS.
   */
  officeDocumentServerAllowlist?: OfficeCallbackAllowlistConfig;
  /**
   * Injectable fetch for DS assembled file URL (tests). Production uses
   * default stream/cap fetch (lp-p37.9): redirect:manual with per-hop
   * allowlist re-check, hard byte cap without relying on Content-Length,
   * connect timeout + max body-read duration.
   */
  officeCallbackFetcher?: OfficeCallbackFetcher;
  /**
   * Injectable vault.write for callback (tests). Production builds context
   * from OfficeDocumentSession + control-plane RBAC and uses writeCallback.
   */
  officeCallbackVaultWriter?: OfficeCallbackVaultWriter;
  /**
   * ui.can.vault_edit gate for Office edit mint (lp-5q6.26).
   * When omitted: Brain RPC capabilities when enabled; else env
   * BFF_OFFICE_VAULT_EDIT (default false — fail closed).
   */
  officeCanVaultEdit?: boolean | (() => boolean | Promise<boolean>);
  /**
   * JWT secret for ONLYOFFICE editor config (lp-5q6.26). Tests inject;
   * production uses BFF_OFFICE_JWT_SECRET / ONLYOFFICE_JWT_SECRET.
   */
  officeJwtSecret?: string;
  /**
   * DS-reachable BFF public base for document.url + callbackUrl.
   * Production: BFF_OFFICE_PUBLIC_BASE_URL.
   */
  officePublicBaseUrl?: string;
  vaultContentProvider: VaultContentProvider;
  vaultIndexProvider: VaultIndexProvider;
  stagingStorageProvider: StagingStorageProvider;
  settingsSnapshotPath: string;
  /**
   * When true, always load fixture JSON (skip Hermes discovery).
   * Used by integration tests for deterministic snapshots.
   */
  settingsPreferFixture?: boolean;
  /**
   * When true, ensure lab_echo is in settings.snapshot.mcp_servers
   * (lp-zuh.14.3 MockLab / short-stack seed).
   */
  settingsSeedLabMcp?: boolean;
  /** Optional backend home override for live settings discovery. */
  settingsHermesHome?: string;
  /**
   * Agent projects.db service (working directories).
   * When omitted, createApp builds the default filesystem/CLI service.
   */
  hermesProjects?: HermesProjectsService;
  /**
   * Backend home for projects.db / vault multi-root / default agent projects service.
   * Defaults via resolveHermesHome: BACKEND_HOME, legacy HERMES_HOME, else ~/.hermes.
   */
  hermesHome?: string;
  /**
   * G3.3 feature flag — when true, `/api/brain/*` invokes host ops via relay.
   * Defaults false (fail-closed / gated). Overridable per-test.
   */
  brainRpcEnabled?: boolean;
  /**
   * Optional injectable BackendRuntimeService (lp-ye4.11 tests / offline fakes).
   * When set, takes precedence over the production Brain RPC composition so
   * history/heads/vault handlers can run against FakeBackendRuntimeService.
   */
  backendRuntimeService?: import("@lanyard/backend-runtime").BackendRuntimeService;
  /**
   * lp-y3j — when true, chat send ensures instance online before
   * deliver-inbound (daytona only; online skips wake). Default false.
   * Overridable per-test.
   */
  ensureOnlineOnChat?: boolean;
  /**
   * lp-kng.2.9 — when true, Brain RPC paths call CP ensure_online before
   * invokeBrainRpc (daytona only). Default false. Overridable per-test.
   */
  ensureOnlineOnBrainRpc?: boolean;
  /**
   * lp-kng.2.9 / lp-e23 — channel adapter inbound ensure_online flag.
   * When true, `deliverChannelAdapterInbound` wakes daytona before deliver.
   * Default false. Overridable per-test.
   */
  ensureOnlineOnChannelAdapter?: boolean;
  /**
   * lp-u7z / lp-k5c4.12 — hub for BFF-originated chat live events
   * (`agent_starting` / `agent_ready` / wake `error`). When omitted, createApp
   * builds a process-local hub. Production injects Postgres LISTEN/NOTIFY so
   * a publish on one replica reaches SSE on another.
   */
  threadLiveEvents?: ThreadLiveEventsHub;
  /**
   * lp-xhf4.11 — injectable WhatsApp pairing host (wacli auth --events).
   * Tests inject a fixture; production wires the user-sandbox toolbox.
   */
  whatsappPairingHost?: import("./whatsapp-pairing.js").WhatsAppPairingHost;
  /** Sandbox id the pairing host should target (tests / lazy inject). */
  whatsappPairingSandboxId?: string;
  /** WACLI_STORE_DIR on the user sandbox. */
  whatsappStoreDir?: string;
  /**
   * lp-96v — when true, BFF POSTs CP signal-activity on listed events
   * (message, toolbox, tool_progress, brain_rpc). Default false. Overridable
   * per-test. lp-k5c4.7: message and toolbox send regardless of this flag.
   */
  signalActivityEnabled?: boolean;
  /**
   * lp-v62i.8 — harness turn SSE no-activity watchdog (ms). A proxied
   * harness turn emitting nothing for this long surfaces an SSE error
   * instead of hanging silently. 0 disables. Default 120000
   * (`HARNESS_TURN_STALL_TIMEOUT_MS`). Overridable per-test.
   */
  harnessTurnStallTimeoutMs?: number;
  /**
   * lp-ornl — human-scoped 1:1 context pool store (BFF-owned table).
   * When omitted, createApp builds an in-memory store. CP fetches via BFF API.
   */
  contextPoolStore?: import("./context-pool.js").ContextPoolStore;
  /**
   * lp-692u / lp-v62i.18 — single channel-shared pool with shared revision_id (collapsed).
   * Live fetch via ChannelPoolStore.fetchChannelContext({tenant_id, channel_id})
   * stamps channel_context into harness personaTurns so agents see sibling pool.
   * When omitted, createApp builds an in-memory store. No alias.
   */
  channelPoolStore?: import("./context-pool.js").ChannelPoolStore;
  /**
   * lp-gkh.5 — L10 chat corpus writer (FakeCorpusWriter / S3CorpusWriter).
   * When omitted or null, capture is disabled (lab default). Inject in tests.
   * Prefer {@link chatCorpusCapture} when the full coordinator is needed.
   */
  corpusWriter?: CorpusWriter | null;
  /**
   * lp-gkh.5 — optional pre-built capture coordinator. When set, used as-is.
   * When omitted, createApp builds one from {@link corpusWriter} (if present).
   */
  chatCorpusCapture?: ChatCorpusCapture | null;
  /**
   * lp-gkh.5 — override for `chat_corpus_enabled` gate (tests).
   * Production uses CP retention via shouldWriteChatCorpus.
   */
  chatCorpusIsEnabled?: (tenantId: string) => boolean | Promise<boolean>;
  /**
   * lp-gkh.5 — writeTurn timeout in ms (default 5000).
   */
  chatCorpusWriteTimeoutMs?: number;
  /**
   * lp-cxhb.9 — lead succession picker invoked when the lead is removed
   * from a channel with ≥2 members remaining. Receives the channel name,
   * recent log, and remaining-member objectives; returns a candidate id.
   * Failure or `leadSuccessionTimeoutMs` (default 5000) falls back to the
   * longest-serving member. Tests inject fakes — no live model in BFF tests.
   */
  leadSuccessionPicker?: LeadSuccessionPicker;
  /** lp-cxhb.9 — succession picker timeout in ms (default 5000). */
  leadSuccessionTimeoutMs?: number;
  config: Pick<
    BffConfig,
    | "sessionSecret"
    | "secureCookies"
    | "googleClientId"
    | "googleRedirectPath"
    | "hubspotClientId"
    | "relayUrl"
    | "relayInternalToken"
    | "harnessServiceToken"
    | "stagingMaxUploadBytes"
  >;
};

export type BffVariables = {
  tenant: TenantContext;
  /**
    * True when office content/callback arrived without Host/path tenant
    * (Document Server public base URL). Handlers must resolve tenant_id from
    * the office session after token/nonce verification (lp-xcu.1).
    */
  officeTenantDeferred?: boolean;
  /**
    * True when connector OAuth callback arrived on bare APP_HOST
    * (`/api/connectors/:id/oauth/callback` with no path slug and Host is
    * app.withlanyard.com). Handlers must resolve tenant from signed OAuth
    * state before binding the session (lp-xhf4.18).
    */
  connectorOAuthTenantDeferred?: boolean;
  user: SessionUser | null;
  rbac: UserRbac | null;
};

/**
 * Placeholder tenant when DS hits office routes without Host/path identity.
 * Handlers must not authorize against this object — use session.tenant_id.
 * Empty tenant_id fails closed (tenant_mismatch) if a handler forgets the flag.
 */
export const OFFICE_DS_DEFERRED_TENANT: TenantContext = {
  tenant_id: "",
  tenant_slug: "",
  display_name: "",
  host: "",
};

/**
 * Placeholder tenant when connector OAuth callback hits bare APP_HOST.
 * Handlers must resolve tenant_id from signed OAuth state (lp-xhf4.18).
 * Reuses the same empty shape as office deferred — handlers must not
 * authorize against this object.
 */
export const CONNECTOR_OAUTH_DEFERRED_TENANT: TenantContext = {
  tenant_id: "",
  tenant_slug: "",
  display_name: "",
  host: "",
};