import { randomUUID } from "node:crypto";

import type { MessageEvent } from "@lanyard/shared";

import {
  BUS_CHANNEL,
  nodeInstancesKey,
  ownerKey,
  replyChannel,
  revokedKey,
} from "./keys.js";
import type {
  BusReplyMessage,
  DeliverBusMessage,
  InterruptBusMessage,
  OwnerChangedBusMessage,
  OwnerRecord,
  RedisLike,
  RelayCluster,
  RelayClusterConfig,
  RelayClusterHandlers,
  RelayClusterMode,
  RevokeBusMessage,
  RevokedRecord,
} from "./types.js";

export type RedisRelayClusterOptions = RelayClusterConfig & {
  /** Injected client (tests / ioredis-mock). When set, redisUrl is unused. */
  redisClient: RedisLike;
};

/**
 * Redis-backed multi-relay routing bus (G6.2).
 *
 * - Owner lease: `relay:v1:owner:{instance_id}` with TTL + heartbeat
 * - Pub/sub: deliver / interrupt / revoke / owner_changed
 * - Shared revoke marker: `relay:v1:revoked:{instance_id}`
 * - Fail-closed readiness via PING
 */
export class RedisRelayCluster implements RelayCluster {
  readonly mode: RelayClusterMode = "bus";
  readonly nodeId: string;
  advertiseUrl: string | null;

  private readonly redis: RedisLike;
  private sub: RedisLike | null = null;
  private handlers: RelayClusterHandlers | null = null;
  private readonly ownedInstances = new Set<string>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly pendingReplies = new Map<
    string,
    { resolve: (ok: boolean) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private messageListener:
    | ((channel: string, message: string) => void)
    | null = null;
  private started = false;

  private readonly ownerLeaseSeconds: number;
  private readonly ownerHeartbeatMs: number;
  private readonly revokeRetentionSeconds: number;
  private readonly busAckTimeoutMs: number;

  constructor(options: RedisRelayClusterOptions) {
    if (!options.advertiseUrl) {
      throw new Error("RedisRelayCluster requires advertiseUrl");
    }
    this.nodeId = options.nodeId;
    this.advertiseUrl = options.advertiseUrl;
    this.redis = options.redisClient;
    this.ownerLeaseSeconds = options.ownerLeaseSeconds;
    this.ownerHeartbeatMs = options.ownerHeartbeatMs;
    this.revokeRetentionSeconds = options.revokeRetentionSeconds;
    this.busAckTimeoutMs = options.busAckTimeoutMs;
  }

  async start(handlers: RelayClusterHandlers): Promise<void> {
    if (this.started) {
      return;
    }
    this.handlers = handlers;
    this.sub = this.redis.duplicate();
    if (typeof this.sub.connect === "function" && this.sub.status === "wait") {
      await this.sub.connect();
    }

    this.messageListener = (channel: string, message: string) => {
      void this.onBusMessage(channel, message);
    };
    this.sub.on("message", this.messageListener);

    await this.sub.subscribe(
      BUS_CHANNEL.deliver,
      BUS_CHANNEL.interrupt,
      BUS_CHANNEL.revoke,
      BUS_CHANNEL.ownerChanged,
    );

    this.heartbeatTimer = setInterval(() => {
      void this.refreshAllOwned();
    }, this.ownerHeartbeatMs);
    // Allow process to exit if this is the only timer left.
    if (typeof this.heartbeatTimer.unref === "function") {
      this.heartbeatTimer.unref();
    }

    this.started = true;
  }

  async stop(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    for (const [id, pending] of this.pendingReplies) {
      clearTimeout(pending.timer);
      pending.resolve(false);
      this.pendingReplies.delete(id);
    }

    if (this.sub && this.messageListener) {
      try {
        if (this.sub.removeListener) {
          this.sub.removeListener("message", this.messageListener);
        } else if (this.sub.off) {
          this.sub.off("message", this.messageListener);
        }
        await this.sub.unsubscribe(
          BUS_CHANNEL.deliver,
          BUS_CHANNEL.interrupt,
          BUS_CHANNEL.revoke,
          BUS_CHANNEL.ownerChanged,
        );
      } catch {
        // ignore unsubscribe errors during shutdown
      }
      try {
        await this.sub.quit();
      } catch {
        // ignore
      }
    }
    this.sub = null;
    this.messageListener = null;
    this.handlers = null;
    this.ownedInstances.clear();
    this.started = false;
  }

  async ready(): Promise<boolean> {
    try {
      const pong = await this.redis.ping();
      return pong === "PONG";
    } catch {
      return false;
    }
  }

  async claimOwner(instanceId: string, tenantId?: string): Promise<void> {
    const record: OwnerRecord = {
      node_id: this.nodeId,
      advertise_url: this.advertiseUrl!,
      tenant_id: tenantId,
      connected_at: new Date().toISOString(),
    };
    await this.redis.set(
      ownerKey(instanceId),
      JSON.stringify(record),
      "EX",
      this.ownerLeaseSeconds,
    );
    await this.redis.sadd(nodeInstancesKey(this.nodeId), instanceId);
    this.ownedInstances.add(instanceId);

    const msg: OwnerChangedBusMessage = {
      type: "owner_changed",
      instance_id: instanceId,
      node_id: this.nodeId,
      advertise_url: this.advertiseUrl!,
    };
    await this.redis.publish(BUS_CHANNEL.ownerChanged, JSON.stringify(msg));
  }

  async refreshOwner(instanceId: string): Promise<void> {
    if (!this.ownedInstances.has(instanceId)) return;
    const raw = await this.redis.get(ownerKey(instanceId));
    if (!raw) {
      // Lease lost — re-claim if we still think we own it.
      return;
    }
    try {
      const record = JSON.parse(raw) as OwnerRecord;
      if (record.node_id !== this.nodeId) {
        this.ownedInstances.delete(instanceId);
        return;
      }
    } catch {
      // corrupt — refresh expire anyway if we still track it
    }
    await this.redis.expire(ownerKey(instanceId), this.ownerLeaseSeconds);
  }

  async releaseOwner(instanceId: string): Promise<void> {
    this.ownedInstances.delete(instanceId);
    try {
      await this.redis.srem(nodeInstancesKey(this.nodeId), instanceId);
    } catch {
      // best-effort
    }
    const raw = await this.redis.get(ownerKey(instanceId));
    if (!raw) return;
    try {
      const record = JSON.parse(raw) as OwnerRecord;
      if (record.node_id === this.nodeId) {
        await this.redis.del(ownerKey(instanceId));
      }
    } catch {
      // ignore parse errors
    }
  }

  async getOwner(instanceId: string): Promise<OwnerRecord | null> {
    const raw = await this.redis.get(ownerKey(instanceId));
    if (!raw) return null;
    try {
      const record = JSON.parse(raw) as OwnerRecord;
      if (!record.node_id || !record.advertise_url) return null;
      return record;
    } catch {
      return null;
    }
  }

  async publishDeliver(input: {
    instanceId: string;
    tenantId?: string;
    event: MessageEvent;
    bufferId?: string;
  }): Promise<boolean> {
    const owner = await this.getOwner(input.instanceId);
    if (!owner) return false;
    // If we are the owner but local miss, race — treat as not connected.
    if (owner.node_id === this.nodeId) return false;

    const correlationId = randomUUID();
    const replyTo = replyChannel(correlationId);
    const msg: DeliverBusMessage = {
      type: "deliver",
      instance_id: input.instanceId,
      tenant_id: input.tenantId,
      event: input.event,
      buffer_id: input.bufferId,
      correlation_id: correlationId,
      reply_to: replyTo,
    };

    return this.publishAndWait(replyTo, correlationId, async () => {
      await this.redis.publish(BUS_CHANNEL.deliver, JSON.stringify(msg));
    });
  }

  async publishInterrupt(input: {
    instanceId: string;
    sessionKey: string;
    chatId: string;
  }): Promise<boolean> {
    const owner = await this.getOwner(input.instanceId);
    if (!owner) return false;
    if (owner.node_id === this.nodeId) return false;

    const correlationId = randomUUID();
    const replyTo = replyChannel(correlationId);
    const msg: InterruptBusMessage = {
      type: "interrupt",
      instance_id: input.instanceId,
      session_key: input.sessionKey,
      chat_id: input.chatId,
      correlation_id: correlationId,
      reply_to: replyTo,
    };

    return this.publishAndWait(replyTo, correlationId, async () => {
      await this.redis.publish(BUS_CHANNEL.interrupt, JSON.stringify(msg));
    });
  }

  async publishRevoke(instanceId: string, reason = "revoked"): Promise<void> {
    const record: RevokedRecord = {
      revoked_at: new Date().toISOString(),
      reason,
    };
    await this.redis.set(
      revokedKey(instanceId),
      JSON.stringify(record),
      "EX",
      this.revokeRetentionSeconds,
    );

    const msg: RevokeBusMessage = {
      type: "revoke",
      instance_id: instanceId,
      reason,
      at: record.revoked_at,
    };
    await this.redis.publish(BUS_CHANNEL.revoke, JSON.stringify(msg));

    // Apply locally immediately (do not depend solely on pub/sub echo).
    this.handlers?.onRevokeLocal(instanceId, reason);
  }

  async isRevoked(instanceId: string): Promise<boolean> {
    const raw = await this.redis.get(revokedKey(instanceId));
    return raw != null;
  }

  private async refreshAllOwned(): Promise<void> {
    for (const instanceId of [...this.ownedInstances]) {
      try {
        await this.refreshOwner(instanceId);
      } catch {
        // best-effort heartbeat
      }
    }
  }

  private async publishAndWait(
    replyTo: string,
    correlationId: string,
    publish: () => Promise<void>,
  ): Promise<boolean> {
    if (!this.sub) {
      throw new Error("RedisRelayCluster not started");
    }

    await this.sub.subscribe(replyTo);

    const ack = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.pendingReplies.delete(correlationId);
        resolve(false);
      }, this.busAckTimeoutMs);
      this.pendingReplies.set(correlationId, { resolve, timer });
    });

    try {
      await publish();
      return await ack;
    } finally {
      const pending = this.pendingReplies.get(correlationId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingReplies.delete(correlationId);
      }
      try {
        await this.sub.unsubscribe(replyTo);
      } catch {
        // ignore
      }
    }
  }

  private async onBusMessage(channel: string, raw: string): Promise<void> {
    // Reply channels
    if (channel.startsWith(BUS_CHANNEL.replyPrefix)) {
      try {
        const reply = JSON.parse(raw) as BusReplyMessage;
        const pending = this.pendingReplies.get(reply.correlation_id);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingReplies.delete(reply.correlation_id);
          pending.resolve(Boolean(reply.ok));
        }
      } catch {
        // ignore malformed replies
      }
      return;
    }

    if (!this.handlers) return;

    try {
      if (channel === BUS_CHANNEL.deliver) {
        const msg = JSON.parse(raw) as DeliverBusMessage;
        const ok = this.handlers.onDeliverLocal(msg);
        const reply: BusReplyMessage = {
          type: "reply",
          correlation_id: msg.correlation_id,
          ok,
          node_id: this.nodeId,
        };
        await this.redis.publish(msg.reply_to, JSON.stringify(reply));
        return;
      }

      if (channel === BUS_CHANNEL.interrupt) {
        const msg = JSON.parse(raw) as InterruptBusMessage;
        const ok = this.handlers.onInterruptLocal(msg);
        const reply: BusReplyMessage = {
          type: "reply",
          correlation_id: msg.correlation_id,
          ok,
          node_id: this.nodeId,
        };
        await this.redis.publish(msg.reply_to, JSON.stringify(reply));
        return;
      }

      if (channel === BUS_CHANNEL.revoke) {
        const msg = JSON.parse(raw) as RevokeBusMessage;
        this.handlers.onRevokeLocal(msg.instance_id, msg.reason);
        return;
      }

      if (channel === BUS_CHANNEL.ownerChanged) {
        const msg = JSON.parse(raw) as OwnerChangedBusMessage;
        if (msg.node_id !== this.nodeId) {
          this.handlers.onOwnerChangedLocal(msg.instance_id, msg.node_id);
          this.ownedInstances.delete(msg.instance_id);
        }
      }
    } catch {
      // never throw out of bus listener
    }
  }
}
