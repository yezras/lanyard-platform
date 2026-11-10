import type { MessageEvent } from "@lanyard/shared";

/** Process-local only (default lab / desired count = 1). */
export type RelayClusterMode = "single" | "bus";

export type OwnerRecord = {
  node_id: string;
  advertise_url: string;
  tenant_id?: string;
  connected_at: string;
};

export type RevokedRecord = {
  revoked_at: string;
  reason: string;
};

export type DeliverBusMessage = {
  type: "deliver";
  instance_id: string;
  tenant_id?: string;
  event: MessageEvent;
  buffer_id?: string;
  correlation_id: string;
  reply_to: string;
};

export type InterruptBusMessage = {
  type: "interrupt";
  instance_id: string;
  session_key: string;
  chat_id: string;
  correlation_id: string;
  reply_to: string;
};

export type RevokeBusMessage = {
  type: "revoke";
  instance_id: string;
  reason: string;
  at: string;
};

export type OwnerChangedBusMessage = {
  type: "owner_changed";
  instance_id: string;
  node_id: string;
  advertise_url: string;
};

export type BusReplyMessage = {
  type: "reply";
  correlation_id: string;
  ok: boolean;
  node_id: string;
};

/**
 * Minimal Redis surface for the routing bus (real ioredis + ioredis-mock).
 * Subscribe client must be a dedicated connection (duplicate).
 */
export type RedisLike = {
  get(key: string): Promise<string | null>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set(key: string, value: string, ...args: any[]): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sadd(key: string, ...members: any[]): Promise<number>;
  srem(key: string, ...members: string[]): Promise<number>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(...channels: string[]): Promise<unknown>;
  unsubscribe(...channels: string[]): Promise<unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, listener: (...args: any[]) => void): unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  off?(event: string, listener: (...args: any[]) => void): unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  removeListener?(event: string, listener: (...args: any[]) => void): unknown;
  ping(): Promise<string>;
  quit(): Promise<string>;
  duplicate(): RedisLike;
  status?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  connect?(): Promise<any>;
};

/** Local handlers invoked when this node processes bus messages or lifecycle events. */
export type RelayClusterHandlers = {
  /**
   * Deliver inbound on the local gateway WS if this node owns the session.
   * Returns true when delivered.
   */
  onDeliverLocal(msg: DeliverBusMessage): boolean;
  onInterruptLocal(msg: InterruptBusMessage): boolean;
  /**
   * Apply revoke locally (secret + close WS). Idempotent.
   * Does not re-publish to the bus.
   */
  onRevokeLocal(instanceId: string, reason: string): void;
  /**
   * Another node claimed ownership — close local session if present (not secret revoke).
   */
  onOwnerChangedLocal(instanceId: string, newNodeId: string): void;
};

export type RelayClusterConfig = {
  mode: RelayClusterMode;
  /** Stable for process lifetime. */
  nodeId: string;
  /**
   * Internal base URL other tasks/BFF can HTTP-call for SSE/history.
   * Required when mode=bus.
   */
  advertiseUrl: string | null;
  /** Owner lease TTL seconds (default 30). */
  ownerLeaseSeconds: number;
  /** Heartbeat refresh interval ms (default 10_000). */
  ownerHeartbeatMs: number;
  /** Shared revoke marker retention seconds (default 7d). */
  revokeRetentionSeconds: number;
  /** Wait for deliver/interrupt bus ack (default 2000ms). */
  busAckTimeoutMs: number;
  /**
   * Redis URL (redis:// or rediss://). Required when mode=bus unless redisClient injected.
   * Env name: REDIS_URL — never commit credentials.
   */
  redisUrl?: string;
};

export interface RelayCluster {
  readonly mode: RelayClusterMode;
  readonly nodeId: string;
  /** Internal base URL for SSE/history stickiness (mutable for test bind-after-listen). */
  advertiseUrl: string | null;

  /** Subscribe to bus channels and start heartbeat loop. */
  start(handlers: RelayClusterHandlers): Promise<void>;
  stop(): Promise<void>;

  /**
   * Readiness: single mode always true; bus mode requires Redis PING.
   * Fail-closed when bus cannot reach Redis.
   */
  ready(): Promise<boolean>;

  claimOwner(instanceId: string, tenantId?: string): Promise<void>;
  refreshOwner(instanceId: string): Promise<void>;
  releaseOwner(instanceId: string): Promise<void>;
  getOwner(instanceId: string): Promise<OwnerRecord | null>;

  /**
   * Cross-node deliver via pub/sub. Caller should try local first.
   * Returns true if an owner acked delivery.
   */
  publishDeliver(input: {
    instanceId: string;
    tenantId?: string;
    event: MessageEvent;
    bufferId?: string;
  }): Promise<boolean>;

  publishInterrupt(input: {
    instanceId: string;
    sessionKey: string;
    chatId: string;
  }): Promise<boolean>;

  /**
   * Write shared revoke marker + fan-out. Local handler is also invoked
   * (via bus message on this node, or directly for single mode).
   */
  publishRevoke(instanceId: string, reason?: string): Promise<void>;

  /** Fast path: shared revoke marker present. */
  isRevoked(instanceId: string): Promise<boolean>;
}
