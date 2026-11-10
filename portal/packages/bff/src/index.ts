import { existsSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createLogger } from "@lanyard/shared";

import { loadAgentBackendConfig } from "./agent-backend.js";
import { createApp } from "./app.js";
import { shouldWriteChatCorpus } from "./chat-corpus.js";
import { ChatThreadStore } from "./chat-store.js";
import { ControlPlaneAuthClient } from "./control-plane-client.js";
import { loadConfig } from "./config.js";
import { HarnessClient } from "./harness-client.js";
import { createLazyPgHarnessTurnRegistry } from "./harness-turn-registry-pg.js";
import {
  createLazyPgInboundQueue,
  inboundQueueDatabaseUrl,
} from "./inbound-queue-pg.js";
import { createLazyPgThreadLiveEventsHub } from "./thread-live-events-pg.js";
import { loadCognitoPasswordAuth } from "./cognito-aws.js";
import { createCorpusWriterFromConfig } from "./corpus-writer-factory.js";
import {
  hermesProjectVaultRoots,
  listHermesProjects,
  projectsDbPath,
} from "./hermes/projects.js";
import { RelayClient } from "./relay-client.js";
import { GoogleAuthorizationCodeExchanger } from "./ops-google.js";
import { createEnvOperatorDirectory } from "./operator-directory.js";
import {
  assertSessionStoreConfig,
  createOpsSessionStore,
  createSessionStore,
} from "./session-factory.js";
import { resolveHermesHome } from "./settings-discover.js";
import { createFixtureStagingStorageProvider } from "./staging/fixture-provider.js";
import { createFsStagingStorageProvider } from "./staging/fs-provider.js";
import { createHttpTenantResolver } from "./tenant-resolver.js";
import { createCpS3OfficeBinaryContentSource } from "./office/cp-s3-binary-source.js";
import { createCpS3OfficeCallbackVaultWriter } from "./office/cp-s3-callback-writer.js";
import { createCpS3ScheduledJobStore } from "./scheduled-task-vault-store.js";
import { createCpS3WorkflowRunVaultPersist } from "./workflow-run-vault-persist.js";
import { createCpS3VaultContentProvider } from "./vault/cp-s3-provider.js";
import { createFixtureVaultContentProvider } from "./vault/fixture-provider.js";
import { createFixtureVaultIndexProvider } from "./vault/fixture-index.js";
import { createFsVaultContentProvider } from "./vault/fs-provider.js";
import { createMultiRootFsVaultContentProvider } from "./vault/multi-root-fs-provider.js";
import type { VaultContentProvider } from "./vault/types.js";

const log = createLogger({ service: "bff" });
const config = loadConfig();
const agentBackend = loadAgentBackendConfig(process.env);
const inboundDbUrl = inboundQueueDatabaseUrl();
assertSessionStoreConfig(config.sessionStore);
const sessions = createSessionStore(config.sessionStore);
const opsSessions = createOpsSessionStore(config.sessionStore);
const operatorDirectory = createEnvOperatorDirectory();
const opsGoogleVerifier =
  config.googleClientId && config.googleClientSecret
    ? new GoogleAuthorizationCodeExchanger({
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
      })
    : undefined;
const hermesHome = resolveHermesHome();

function createVaultContentProvider(): VaultContentProvider {
  // Prefer Hermes project folders as vault roots (multi-root absolute paths).
  if (existsSync(projectsDbPath(hermesHome))) {
    return createMultiRootFsVaultContentProvider({
      getRoots: () =>
        hermesProjectVaultRoots(listHermesProjects({ hermesHome })),
    });
  }
  // Legacy single-root mirror when VAULT_ROOT is set without projects.db.
  if (config.vaultRoot) {
    return createFsVaultContentProvider(config.vaultRoot);
  }
  return createFixtureVaultContentProvider();
}

const vaultContentProvider = createVaultContentProvider();

/**
 * OnlyOffice mint + signed download (lp-k59).
 *
 * Browser vault paths under Brain RPC are VAULT_ROOT-relative (`/Business/...`).
 * Hermes multi-root providers use absolute project paths and fail mint with
 * "Vault file not found". Prefer single-root FS under VAULT_ROOT for Office.
 */
function createOfficeVaultContentProvider(): VaultContentProvider {
  if (config.vaultRoot) {
    return createFsVaultContentProvider(config.vaultRoot);
  }
  return vaultContentProvider;
}

const officeVaultContentProvider = createOfficeVaultContentProvider();

/** L10 corpus writer — fail closed unless CHAT_CORPUS_BUCKET + store configured. */
const corpusWriter = createCorpusWriterFromConfig({
  bucket: config.chatCorpusBucket,
  fsRoot: config.chatCorpusFsRoot,
});

const app = createApp({
  tenantResolver: createHttpTenantResolver(config.controlPlaneUrl, {
    serviceToken: config.controlPlaneServiceToken,
    internalToken: config.controlPlaneInternalToken,
  }),
  devTenantSlug: config.devTenantSlug,
  appHosts: config.appHosts,
  demoMemberRoleId: config.demoMemberRoleId,
  authClient: new ControlPlaneAuthClient(config.controlPlaneUrl, fetch, {
    serviceToken: config.controlPlaneServiceToken,
    internalToken: config.controlPlaneInternalToken,
  }),
  cognito: loadCognitoPasswordAuth(),
  relayClient: new RelayClient(config.relayUrl, config.relayInternalToken),
  chatDelivery: config.chatDelivery,
  harnessClient: config.harnessUrl
    ? new HarnessClient(config.harnessUrl, config.harnessServiceToken)
    : undefined,
  agentBackend,
  inboundQueue: inboundDbUrl
    ? createLazyPgInboundQueue(inboundDbUrl)
    : undefined,
  harnessTurnRegistry: inboundDbUrl
    ? createLazyPgHarnessTurnRegistry(inboundDbUrl)
    : undefined,
  threadLiveEvents: inboundDbUrl
    ? createLazyPgThreadLiveEventsHub(inboundDbUrl)
    : undefined,
  chatThreads: new ChatThreadStore(
    config.chatStorePath ? { dbPath: config.chatStorePath } : undefined,
  ),
  sessions,
  opsSessions,
  operatorDirectory,
  opsGoogleVerifier,
  vaultContentProvider,
  // lp-oop.13: cp_s3 mint reads via createCpS3VaultProvider. Keep the
  // FS/fixture office provider only on today's default plane.
  officeVaultContentProvider:
    config.vaultPlane === "cp_s3" ? undefined : officeVaultContentProvider,
  vaultIndexProvider: createFixtureVaultIndexProvider(),
  vaultPlane: config.vaultPlane,
  createCpS3VaultProvider:
    config.vaultPlane === "cp_s3"
      ? (tenantId) =>
          createCpS3VaultContentProvider({
            tenantId,
            baseUrl: config.controlPlaneUrl,
            serviceToken: config.controlPlaneServiceToken,
          })
      : undefined,
  createCpS3OfficeBinarySource:
    config.vaultPlane === "cp_s3"
      ? (tenantId) =>
          createCpS3OfficeBinaryContentSource({
            tenantId,
            baseUrl: config.controlPlaneUrl,
            serviceToken: config.controlPlaneServiceToken,
          })
      : undefined,
  createCpS3OfficeCallbackVaultWriter:
    config.vaultPlane === "cp_s3"
      ? () =>
          createCpS3OfficeCallbackVaultWriter({
            baseUrl: config.controlPlaneUrl,
            serviceToken: config.controlPlaneServiceToken,
          })
      : undefined,
  scheduledJobStore:
    config.vaultPlane === "cp_s3"
      ? createCpS3ScheduledJobStore({
          baseUrl: config.controlPlaneUrl,
          serviceToken: config.controlPlaneServiceToken,
        })
      : undefined,
  workflowRunVaultPersist:
    config.vaultPlane === "cp_s3"
      ? createCpS3WorkflowRunVaultPersist({
          baseUrl: config.controlPlaneUrl,
          serviceToken: config.controlPlaneServiceToken,
        })
      : undefined,
  stagingStorageProvider: config.stagingFsRoot
    ? createFsStagingStorageProvider(config.stagingFsRoot)
    : createFixtureStagingStorageProvider(),
  settingsSnapshotPath: config.settingsSnapshotPath,
  settingsSeedLabMcp: config.settingsSeedLabMcp,
  hermesHome,
  brainRpcEnabled: config.brainRpcEnabled,
  ensureOnlineOnChat: config.ensureOnlineOnChat,
  ensureOnlineOnBrainRpc: config.ensureOnlineOnBrainRpc,
  ensureOnlineOnChannelAdapter: config.ensureOnlineOnChannelAdapter,
  signalActivityEnabled: config.signalActivityEnabled,
  corpusWriter,
  // Fail-closed enablement: CP tenant retention chat_corpus_enabled.
  chatCorpusIsEnabled: (tenantId) =>
    shouldWriteChatCorpus(tenantId, {
      controlPlaneUrl: config.controlPlaneUrl,
      internalOpsToken: config.controlPlaneInternalToken,
    }),
  config: {
    sessionSecret: config.sessionSecret,
    secureCookies: config.secureCookies,
    googleClientId: config.googleClientId,
    googleRedirectPath: config.googleRedirectPath,
    hubspotClientId: config.hubspotClientId,
    relayUrl: config.relayUrl,
    relayInternalToken: config.relayInternalToken,
    stagingMaxUploadBytes: config.stagingMaxUploadBytes,
  },
});

serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  (info) => {
    log.info("listening", {
      port: info.port,
      debug_payloads: log.debugPayloads,
      chat_delivery: config.chatDelivery,
      agent_backend: agentBackend
        ? { protocol: agentBackend.protocol, base_url_set: true }
        : null,
      vault_plane: config.vaultPlane,
      brain_rpc_enabled: config.brainRpcEnabled,
      staging_fs_root: config.stagingFsRoot ?? null,
      ensure_online_on_chat: config.ensureOnlineOnChat,
      ensure_online_on_brain_rpc: config.ensureOnlineOnBrainRpc,
      ensure_online_on_channel_adapter: config.ensureOnlineOnChannelAdapter,
      signal_activity_enabled: config.signalActivityEnabled,
      session_backend: config.sessionStore.backend,
      multi_instance: config.sessionStore.multiInstance,
      vault_mode: existsSync(projectsDbPath(hermesHome))
        ? "hermes_multi_root"
        : config.vaultRoot
          ? "filesystem"
          : "fixture",
      office_vault_mode:
        config.vaultPlane === "cp_s3"
          ? "cp_s3"
          : config.vaultRoot
            ? "filesystem_vault_root"
            : existsSync(projectsDbPath(hermesHome))
              ? "hermes_multi_root"
              : "fixture",
      ...(config.devTenantSlug
        ? { dev_tenant_slug: config.devTenantSlug }
        : {}),
      app_hosts: config.appHosts,
      ...(existsSync(projectsDbPath(hermesHome))
        ? {
            hermes_project_count: listHermesProjects({ hermesHome }).length,
          }
        : {}),
      // Path only — never vault file bodies (G2b.2).
      ...(config.vaultRoot ? { vault_root_set: true } : {}),
      ...(config.chatStorePath ? { chat_store_durable: true } : {}),
      chat_corpus_writer: corpusWriter ? "fs" : "disabled",
      ...(config.chatCorpusBucket
        ? { chat_corpus_bucket_set: true }
        : {}),
    });
  },
);
