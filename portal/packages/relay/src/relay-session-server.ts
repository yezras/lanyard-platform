import type { BrainRpcRequestFrame, MessageEvent } from "@lanyard/shared";
import { RELAY_UNAUTHORIZED_CLOSE_CODE } from "@lanyard/shared";
import type { IncomingMessage } from "node:http";
import type { WebSocket } from "ws";
import {
  extractBearerToken,
  peekGatewayId,
  verifyUpgradeToken,
} from "./auth.js";
import type { RelayCluster } from "./cluster/types.js";
import type { JtiStore } from "./jti-store.js";
import { InMemoryJtiStore } from "./jti-store.js";
import {
  policyToVerifyOptions,
  resolveRelayAuthPolicy,
  type RelayAuthPolicy,
} from "./relay-auth-policy.js";
import {
  RelaySessionImpl,
  type BrainRpcDeliveryResult,
  type RelaySession,
} from "./relay-session.js";
import { shouldPersistInteraction } from "./retention.js";
import type { SecretStore } from "./secret-store.js";
import { WebPlatformAdapter } from "./web-platform-adapter.js";
import type { ChatDeliveryHub } from "./chat-delivery-hub.js";

export interface RelaySessionServerOptions {
  secretStore: SecretStore;
  chatHub: ChatDeliveryHub;
  /** Also accept ?token= for dev; production should use Authorization header. */
  allowQueryToken?: boolean;
  /**
   * Multi-relay routing bus (G6). Default: process-local single-node behavior.
   * When provided, start() is called by the server bootstrap after construction.
   */
  cluster?: RelayCluster;
  /** G2a single-use jti store (default: in-memory). */
  jtiStore?: JtiStore;
  /**
   * Upgrade auth policy. When omitted, resolved from env
   * (production fail-closed when NODE_ENV=production).
   */
  authPolicy?: RelayAuthPolicy;
}

export type UpgradeAuthFailureReason =
  | "missing_token"
  | "invalid_token"
  | "unknown_gateway"
  | "revoked"
  | "verify_failed"
  | "replay";

export interface RelaySessionServer {
  authenticateUpgrade(
    req: IncomingMessage,
  ): Promise<
    | { ok: true; gatewayId: string }
    | { ok: false; reason?: UpgradeAuthFailureReason }
  >;
  acceptConnection(socket: WebSocket, gatewayId: string): RelaySession;
  deliverInbound(
    instanceId: string,
    event: MessageEvent,
    bufferId?: string,
  ): Promise<boolean>;
  deliverInterruptInbound(
    instanceId: string,
    sessionKey: string,
    chatId: string,
  ): Promise<boolean>;
  /** Set freeze for thread_id and notify the gateway. Freeze sticks if offline. */
  haltMailbox(instanceId: string, threadId: string): boolean;
  /** Clear freeze for thread_id. Notify gateway when connected. */
  thawMailbox(instanceId: string, threadId: string): boolean;
  isMailboxFrozen(threadId: string): boolean;
  /**
   * G3.3: route a brain_rpc_request to the live gateway session for instanceId.
   * Fail-closed when no connected handshake-complete session exists.
   */
  deliverBrainRpc(
    instanceId: string,
    request: BrainRpcRequestFrame,
  ): Promise<BrainRpcDeliveryResult>;
  /**
   * Revoke instance secret material and force-close any live gateway session.
   * Live sockets are closed with RELAY_UNAUTHORIZED_CLOSE_CODE (4401).
   * In bus mode, also writes shared revoke marker and fans out to all nodes.
   */
  revokeInstance(instanceId: string): Promise<RevokeInstanceResult>;
  getSession(instanceId: string): RelaySession | undefined;
  sessionCount(): number;
  /** Local-only close without secret revoke (session replaced by another node). */
  closeLocalSession(instanceId: string, reason: string): number;
  getCluster(): RelayCluster | undefined;
  /**
   * Apply revoke locally without re-publishing (bus consumer path).
   * Returns sessions closed on this node.
   */
  applyLocalRevoke(instanceId: string, reason?: string): number;
  /** G2a metadata counters (no token/secret material). */
  authMetrics(): RelayAuthMetrics;
}

/** Result of force-revoking an instance on the live relay process. */
export type RevokeInstanceResult = {
  instance_id: string;
  /** True when a secret record existed and was marked revoked (idempotent). */
  secret_revoked: boolean;
  /** Number of live WebSocket sessions closed on this node (0 or 1 in v1). */
  sessions_closed: number;
  /** Hermes contract close code for unauthorized / revoked credentials. */
  close_code: typeof RELAY_UNAUTHORIZED_CLOSE_CODE;
  /** True when shared revoke marker was written (bus mode). */
  cluster_revoked?: boolean;
};

/** In-process counters for upgrade auth (metadata only; G2b-safe). */
export type RelayAuthMetrics = {
  upgrade_ok: number;
  upgrade_replay_rejected: number;
  /** Stock Hermes G2a mint path (v1j). */
  upgrade_jti_accepted: number;
  /** Pre-jti / host-patch path (v1 legacy) when dual-accept allows it. */
  upgrade_legacy_accepted: number;
  upgrade_auth_failed: number;
};

export class RelaySessionServerImpl implements RelaySessionServer {
  private readonly secretStore: SecretStore;
  private readonly webAdapter: WebPlatformAdapter;
  private readonly allowQueryToken: boolean;
  private readonly cluster: RelayCluster | undefined;
  private readonly jtiStore: JtiStore;
  private readonly authPolicy: RelayAuthPolicy;
  private readonly sessionsByInstance = new Map<string, RelaySessionImpl>();
  /** One freeze bit per BFF thread_id (gateway-owned; agent fuse is later). */
  private readonly frozenThreadIds = new Set<string>();
  private clusterStarted = false;
  private readonly metrics: RelayAuthMetrics = {
    upgrade_ok: 0,
    upgrade_replay_rejected: 0,
    upgrade_jti_accepted: 0,
    upgrade_legacy_accepted: 0,
    upgrade_auth_failed: 0,
  };

  constructor(options: RelaySessionServerOptions) {
    this.secretStore = options.secretStore;
    this.webAdapter = new WebPlatformAdapter(options.chatHub);
    this.cluster = options.cluster;
    this.jtiStore = options.jtiStore ?? new InMemoryJtiStore();
    this.authPolicy =
      options.authPolicy ??
      resolveRelayAuthPolicy(process.env, {
        allowQueryToken: options.allowQueryToken,
      });
    // Explicit constructor flag wins over env for query tokens (tests).
    this.allowQueryToken =
      options.allowQueryToken ?? this.authPolicy.allowQueryToken;
  }

  getCluster(): RelayCluster | undefined {
    return this.cluster;
  }

  authMetrics(): RelayAuthMetrics {
    return { ...this.metrics };
  }

  /**
   * Wire cluster bus handlers. Idempotent. Call after construction before accepting traffic.
   */
  async startCluster(): Promise<void> {
    if (!this.cluster || this.clusterStarted) return;
    await this.cluster.start({
      onDeliverLocal: (msg) => {
        return this.deliverInboundLocal(
          msg.instance_id,
          msg.event,
          msg.buffer_id,
        );
      },
      onInterruptLocal: (msg) => {
        return this.deliverInterruptInboundLocal(
          msg.instance_id,
          msg.session_key,
          msg.chat_id,
        );
      },
      onRevokeLocal: (instanceId, reason) => {
        this.applyLocalRevoke(instanceId, reason);
      },
      onOwnerChangedLocal: (instanceId, newNodeId) => {
        if (newNodeId === this.cluster?.nodeId) return;
        this.closeLocalSession(instanceId, "session_replaced");
      },
    });
    this.clusterStarted = true;
  }

  async stopCluster(): Promise<void> {
    if (!this.cluster || !this.clusterStarted) return;
    await this.cluster.stop();
    this.clusterStarted = false;
  }

  async authenticateUpgrade(
    req: IncomingMessage,
  ): Promise<
    | { ok: true; gatewayId: string }
    | { ok: false; reason?: UpgradeAuthFailureReason }
  > {
    const token = this.extractToken(req);
    if (!token) {
      this.metrics.upgrade_auth_failed += 1;
      return { ok: false, reason: "missing_token" };
    }

    const gatewayIdPeek = peekGatewayId(token);
    if (!gatewayIdPeek) {
      this.metrics.upgrade_auth_failed += 1;
      return { ok: false, reason: "invalid_token" };
    }

    const record = this.secretStore.getByGatewayId(gatewayIdPeek);
    if (!record) {
      this.metrics.upgrade_auth_failed += 1;
      return { ok: false, reason: "unknown_gateway" };
    }
    if (record.revoked) {
      this.metrics.upgrade_auth_failed += 1;
      return { ok: false, reason: "revoked" };
    }

    // Shared revoke marker (bus mode) — fail closed even if local secret cache is stale.
    if (this.cluster?.mode === "bus") {
      try {
        if (await this.cluster.isRevoked(record.instanceId)) {
          this.secretStore.revoke(record.instanceId);
          this.metrics.upgrade_auth_failed += 1;
          return { ok: false, reason: "revoked" };
        }
      } catch {
        // Fail closed for auth when Redis is unreachable in bus mode.
        this.metrics.upgrade_auth_failed += 1;
        return { ok: false, reason: "revoked" };
      }
    }

    const verified = verifyUpgradeToken(
      token,
      record.secrets,
      policyToVerifyOptions(this.authPolicy),
    );
    if (!verified || verified.gatewayId !== gatewayIdPeek) {
      this.metrics.upgrade_auth_failed += 1;
      return { ok: false, reason: "verify_failed" };
    }

    // Dual-accept claim shapes (lp-t7q.9 / G2a):
    // - v1j (jti): single-use via jti store — stock Hermes pins (g7h3+)
    // - v1 legacy: no jti; only when policy.requireJti is false
    if (verified.format === "jti" && verified.jti) {
      const claimed = await Promise.resolve(
        this.jtiStore.consume(verified.jti, verified.exp),
      );
      if (!claimed) {
        this.metrics.upgrade_replay_rejected += 1;
        return { ok: false, reason: "replay" };
      }
      this.metrics.upgrade_jti_accepted += 1;
    } else if (verified.format === "legacy") {
      this.metrics.upgrade_legacy_accepted += 1;
    }

    this.metrics.upgrade_ok += 1;
    return { ok: true, gatewayId: verified.gatewayId };
  }

  private extractToken(req: IncomingMessage): string | null {
    const headerToken = extractBearerToken(
      req.headers.authorization ?? req.headers.Authorization?.toString(),
    );

    let token = headerToken;
    if (!token && this.allowQueryToken && req.url) {
      const url = new URL(req.url, "http://localhost");
      token = url.searchParams.get("token");
    }
    return token;
  }

  acceptConnection(socket: WebSocket, gatewayId: string): RelaySession {
    const record = this.secretStore.getByGatewayId(gatewayId);
    if (!record) {
      socket.close(RELAY_UNAUTHORIZED_CLOSE_CODE, "unauthorized");
      throw new Error(`no secret record for gateway ${gatewayId}`);
    }

    // Session exclusivity: at most one live gateway WS per instance_id.
    // New auth wins → previous socket closed with 4401 reason "replaced".
    const previous = this.sessionsByInstance.get(record.instanceId);
    if (previous) {
      previous.close(RELAY_UNAUTHORIZED_CLOSE_CODE, "replaced");
      this.sessionsByInstance.delete(record.instanceId);
    }

    const session = new RelaySessionImpl(socket, record, this.webAdapter, undefined, {
      onHandshakeComplete: (s) => {
        void this.cluster?.claimOwner(s.info.instanceId, s.info.tenantId);
      },
    });
    this.sessionsByInstance.set(record.instanceId, session);

    socket.on("close", () => {
      if (this.sessionsByInstance.get(record.instanceId) === session) {
        this.sessionsByInstance.delete(record.instanceId);
        void this.cluster?.releaseOwner(record.instanceId);
      }
    });

    return session;
  }

  /**
   * Deliver inbound: local session first; bus hop when RELAY_CLUSTER_MODE=bus.
   */
  async deliverInbound(
    instanceId: string,
    event: MessageEvent,
    bufferId?: string,
  ): Promise<boolean> {
    if (this.deliverInboundLocal(instanceId, event, bufferId)) {
      return true;
    }
    if (this.cluster?.mode === "bus") {
      return this.cluster.publishDeliver({
        instanceId,
        event,
        bufferId,
      });
    }
    return false;
  }

  async deliverInterruptInbound(
    instanceId: string,
    sessionKey: string,
    chatId: string,
  ): Promise<boolean> {
    if (this.deliverInterruptInboundLocal(instanceId, sessionKey, chatId)) {
      return true;
    }
    if (this.cluster?.mode === "bus") {
      return this.cluster.publishInterrupt({
        instanceId,
        sessionKey,
        chatId,
      });
    }
    return false;
  }

  haltMailbox(instanceId: string, threadId: string): boolean {
    const id = threadId.trim();
    if (!id) return false;
    this.frozenThreadIds.add(id);
    const session = this.sessionsByInstance.get(instanceId);
    if (session?.info.handshakeComplete) {
      session.deliverMailboxHalt(id);
    }
    return true;
  }

  thawMailbox(instanceId: string, threadId: string): boolean {
    const id = threadId.trim();
    if (!id) return false;
    this.frozenThreadIds.delete(id);
    const session = this.sessionsByInstance.get(instanceId);
    if (session?.info.handshakeComplete) {
      session.deliverMailboxThaw(id);
    }
    return true;
  }

  isMailboxFrozen(threadId: string): boolean {
    return this.frozenThreadIds.has(threadId.trim());
  }

  private deliverInboundLocal(
    instanceId: string,
    event: MessageEvent,
    bufferId?: string,
  ): boolean {
    const session = this.sessionsByInstance.get(instanceId);
    if (!session?.info.handshakeComplete) return false;

    // Retention policy gate (slice 17 / Core#19): export pipeline stub only.
    // No message bodies are written to long-term Lanyard stores here.
    // TODO(#19): when shouldPersistInteraction is true, enqueue metadata-only export job.
    const tenantId = session.info.tenantId;
    if (tenantId) {
      void shouldPersistInteraction(tenantId).then((enabled) => {
        if (enabled) {
          // Future: enqueue interaction export job (metadata only; never message bodies in audit).
        }
      });
    }

    session.deliverInbound(event, bufferId);
    return true;
  }

  private deliverInterruptInboundLocal(
    instanceId: string,
    sessionKey: string,
    chatId: string,
  ): boolean {
    const session = this.sessionsByInstance.get(instanceId);
    if (!session?.info.handshakeComplete) return false;
    session.deliverInterruptInbound(sessionKey, chatId);
    return true;
  }

async deliverBrainRpc(
    instanceId: string,
    request: BrainRpcRequestFrame,
  ): Promise<BrainRpcDeliveryResult> {
    const session = this.sessionsByInstance.get(instanceId);
    if (!session?.info.handshakeComplete) {
      return {
        ok: false,
        reason: "not_connected",
        message: "Gateway not connected or handshake incomplete",
      };
    }
    return session.deliverBrainRpc(request);
  }


  async revokeInstance(instanceId: string): Promise<RevokeInstanceResult> {
    if (this.cluster?.mode === "bus") {
      // Shared marker + fan-out. Local secret/session apply is inside publishRevoke
      // (onRevokeLocal) so non-owners still get the bus event.
      const hadSession = this.sessionsByInstance.has(instanceId);
      const secret_revoked = this.secretStore.revoke(instanceId);
      await this.cluster.publishRevoke(instanceId, "revoked");
      return {
        instance_id: instanceId,
        secret_revoked,
        // Local count only — remote owners close via bus (may be 0 on non-owners).
        sessions_closed: hadSession ? 1 : 0,
        close_code: RELAY_UNAUTHORIZED_CLOSE_CODE,
        cluster_revoked: true,
      };
    }

    const secret_revoked = this.secretStore.revoke(instanceId);
    const sessions_closed = this.applyLocalRevoke(instanceId, "revoked");
    return {
      instance_id: instanceId,
      secret_revoked,
      sessions_closed,
      close_code: RELAY_UNAUTHORIZED_CLOSE_CODE,
    };
  }

  applyLocalRevoke(instanceId: string, reason = "revoked"): number {
    this.secretStore.revoke(instanceId);
    const session = this.sessionsByInstance.get(instanceId);
    let sessions_closed = 0;
    if (session) {
      session.close(RELAY_UNAUTHORIZED_CLOSE_CODE, reason);
      this.sessionsByInstance.delete(instanceId);
      sessions_closed = 1;
      void this.cluster?.releaseOwner(instanceId);
    }
    return sessions_closed;
  }

  closeLocalSession(instanceId: string, reason: string): number {
    const session = this.sessionsByInstance.get(instanceId);
    if (!session) return 0;
    session.close(RELAY_UNAUTHORIZED_CLOSE_CODE, reason);
    this.sessionsByInstance.delete(instanceId);
    void this.cluster?.releaseOwner(instanceId);
    return 1;
  }

  getSession(instanceId: string): RelaySession | undefined {
    return this.sessionsByInstance.get(instanceId);
  }

  sessionCount(): number {
    return this.sessionsByInstance.size;
  }
}
