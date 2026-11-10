export {
  makeToken,
  makeUpgradeToken,
  verifyToken,
  verifyUpgradeToken,
  parseUpgradeToken,
  peekGatewayId,
  extractBearerToken,
  generateJti,
  isJtiShape,
  DEFAULT_UPGRADE_TTL_SECONDS,
  MAX_UPGRADE_TTL_SECONDS,
  type MakeUpgradeTokenOptions,
  type ParsedUpgradeToken,
  type VerifiedUpgrade,
  type VerifyUpgradeOptions,
  type UpgradeTokenFormat,
} from "./auth.js";
export {
  InMemoryJtiStore,
  RedisJtiStore,
  type JtiStore,
  type RedisJtiClient,
  type RedisJtiStoreOptions,
} from "./jti-store.js";
export {
  resolveRelayAuthMode,
  resolveRelayAuthPolicy,
  policyToVerifyOptions,
  type RelayAuthMode,
  type RelayAuthPolicy,
} from "./relay-auth-policy.js";
export {
  InMemorySecretStore,
  loadDevSecretsFromEnv,
  type SecretRecord,
  type SecretStore,
} from "./secret-store.js";
export { handleOutboundAction } from "./outbound-handler.js";
export {
  ChatDeliveryHub,
  detectMcq,
  detectReasoning,
  detectToolApproval,
  detectToolProgress,
  extractChatSpeaker,
  extractCitations,
  extractModel,
  isHermesHomeChannelSetupNotice,
  MAILBOX_CHANNEL_SEND_EVENT_TYPE,
  MAILBOX_ONE_TO_ONE_HOP_NOTICE_EVENT_TYPE,
  mailboxVisibleEventType,
  outboundActionToChatEvent,
  outboundActionToChatEvents,
  expandHermesToolProgressLines,
  parseToolStatus,
  type ChatOutboundCitation,
  type ChatOutboundEvent,
  type ChatOutboundEventType,
  type ChatSpeaker,
  type MailboxVisibleKind,
} from "./chat-delivery-hub.js";
export { WebPlatformAdapter } from "./web-platform-adapter.js";
export {
  RELAY_INTERNAL_TOKEN_HEADER,
  type RelayInternalHttpOptions,
} from "./internal-http.js";
export {
  RelaySessionServerImpl,
  type RelaySessionServer,
  type RelaySessionServerOptions,
  type RevokeInstanceResult,
} from "./relay-session-server.js";
export { RelaySessionImpl, type RelaySession, type RelaySessionInfo } from "./relay-session.js";
export { createRelayServer, type RelayServerConfig, type RelayServerHandle } from "./server.js";
export {
  fetchTenantRetention,
  shouldPersistInteraction,
  type ShouldPersistInteractionOptions,
  type TenantRetentionSnapshot,
} from "./retention.js";
export {
  assertRelayClusterEnvConfig,
  createRelayCluster,
  createRelayClusterFromEnv,
  loadRelayClusterConfig,
  SingleNodeCluster,
  RedisRelayCluster,
  RELAY_KEY_PREFIX,
  ownerKey,
  revokedKey,
  BUS_CHANNEL,
  type RelayCluster,
  type RelayClusterConfig,
  type RelayClusterMode,
  type OwnerRecord,
  type RedisLike,
} from "./cluster/index.js";

import { createLogger } from "@lanyard/shared";
import { createRelayClusterFromEnv } from "./cluster/index.js";
import { InMemoryJtiStore } from "./jti-store.js";
import { resolveRelayAuthPolicy } from "./relay-auth-policy.js";
import { ChatDeliveryHub } from "./chat-delivery-hub.js";
import { loadDevSecretsFromEnv, InMemorySecretStore } from "./secret-store.js";
import { RelaySessionServerImpl } from "./relay-session-server.js";
import { createRelayServer } from "./server.js";

const log = createLogger({ service: "relay" });

export async function startRelayFromEnv(): Promise<{
  server: Awaited<ReturnType<typeof createRelayServer>>;
  sessionServer: RelaySessionServerImpl;
  chatHub: ChatDeliveryHub;
}> {
  const secretStore = loadDevSecretsFromEnv(new InMemorySecretStore());
  const chatHub = new ChatDeliveryHub();
  const cluster = createRelayClusterFromEnv();
  const authPolicy = resolveRelayAuthPolicy(process.env);
  // Single-task default; multi-relay Redis jti is G6 (inject RedisJtiStore).
  const jtiStore = new InMemoryJtiStore();
  const sessionServer = new RelaySessionServerImpl({
    secretStore,
    chatHub,
    jtiStore,
    authPolicy,
    allowQueryToken: authPolicy.allowQueryToken,
    cluster,
  });

  const port = Number.parseInt(process.env.PORT ?? process.env.RELAY_PORT ?? "8787", 10);
  const relayPath = process.env.RELAY_PATH ?? "/relay";

  const server = await createRelayServer({
    host: process.env.RELAY_HOST ?? "0.0.0.0",
    port,
    relayPath,
    sessionServer,
    chatHub,
    secretStore,
    internalToken: process.env.RELAY_INTERNAL_TOKEN,
  });

  // Metadata only — never chat/tool/vault/token/secret material (G2b).
  log.info("listening", {
    host: server.host,
    port: server.port,
    relay_path: server.relayPath,
    debug_payloads: log.debugPayloads,
    cluster_mode: cluster.mode,
    auth_mode: authPolicy.mode,
    require_jti: authPolicy.requireJti,
    reject_non_expiring: authPolicy.rejectNonExpiring,
    max_ttl_seconds: authPolicy.maxTtlSeconds,
    allow_query_token: authPolicy.allowQueryToken,
  });

  return { server, sessionServer, chatHub };
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("/index.js") || process.argv[1].endsWith("/index.ts"));

if (isMain) {
  startRelayFromEnv().catch((err) => {
    log.error("failed to start", { error: err });
    process.exit(1);
  });
}
