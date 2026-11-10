import type { MessageEvent } from "@lanyard/shared";

import type {
  OwnerRecord,
  RelayCluster,
  RelayClusterConfig,
  RelayClusterHandlers,
  RelayClusterMode,
} from "./types.js";

/**
 * Process-local cluster (default). No Redis; deliver/interrupt never hop;
 * revoke only affects this process. Preserves docker-compose / desired count = 1.
 */
export class SingleNodeCluster implements RelayCluster {
  readonly mode: RelayClusterMode = "single";
  readonly nodeId: string;
  advertiseUrl: string | null;

  private handlers: RelayClusterHandlers | null = null;
  private readonly owners = new Map<string, OwnerRecord>();
  private readonly revoked = new Set<string>();

  constructor(config: Pick<RelayClusterConfig, "nodeId" | "advertiseUrl">) {
    this.nodeId = config.nodeId;
    this.advertiseUrl = config.advertiseUrl;
  }

  async start(handlers: RelayClusterHandlers): Promise<void> {
    this.handlers = handlers;
  }

  async stop(): Promise<void> {
    this.handlers = null;
    this.owners.clear();
  }

  async ready(): Promise<boolean> {
    return true;
  }

  async claimOwner(instanceId: string, tenantId?: string): Promise<void> {
    this.owners.set(instanceId, {
      node_id: this.nodeId,
      advertise_url: this.advertiseUrl ?? "",
      tenant_id: tenantId,
      connected_at: new Date().toISOString(),
    });
  }

  async refreshOwner(instanceId: string): Promise<void> {
    const existing = this.owners.get(instanceId);
    if (existing && existing.node_id === this.nodeId) {
      // no-op for in-memory; lease is process lifetime
      void existing;
    }
  }

  async releaseOwner(instanceId: string): Promise<void> {
    const existing = this.owners.get(instanceId);
    if (existing?.node_id === this.nodeId) {
      this.owners.delete(instanceId);
    }
  }

  async getOwner(instanceId: string): Promise<OwnerRecord | null> {
    return this.owners.get(instanceId) ?? null;
  }

  async publishDeliver(_input: {
    instanceId: string;
    tenantId?: string;
    event: MessageEvent;
    bufferId?: string;
  }): Promise<boolean> {
    // Single-node: no bus hop; caller already tried local.
    return false;
  }

  async publishInterrupt(_input: {
    instanceId: string;
    sessionKey: string;
    chatId: string;
  }): Promise<boolean> {
    return false;
  }

  async publishRevoke(instanceId: string, reason = "revoked"): Promise<void> {
    this.revoked.add(instanceId);
    this.handlers?.onRevokeLocal(instanceId, reason);
  }

  async isRevoked(instanceId: string): Promise<boolean> {
    return this.revoked.has(instanceId);
  }
}
