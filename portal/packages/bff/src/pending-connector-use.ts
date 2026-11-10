/**
 * In-process pending_connector_use store (lp-xhf4.8).
 *
 * One row per tenant+user. Chat writes it; page Connect does not.
 */
import {
  decideConnectorResume,
  type ConnectorResumeDecision,
  type PendingConnectorUse,
} from "@lanyard/connectors";

export type PendingConnectorUseStore = {
  get(tenantId: string, userId: string): Promise<PendingConnectorUse | null>;
  put(pending: PendingConnectorUse): Promise<void>;
  delete(tenantId: string, userId: string): Promise<void>;
};

function pendingKey(tenantId: string, userId: string): string {
  return `${tenantId}:${userId}`;
}

export class MemoryPendingConnectorUseStore implements PendingConnectorUseStore {
  private readonly rows = new Map<string, PendingConnectorUse>();

  async get(
    tenantId: string,
    userId: string,
  ): Promise<PendingConnectorUse | null> {
    return this.rows.get(pendingKey(tenantId, userId)) ?? null;
  }

  async put(pending: PendingConnectorUse): Promise<void> {
    this.rows.set(pendingKey(pending.tenant_id, pending.user_id), pending);
  }

  async delete(tenantId: string, userId: string): Promise<void> {
    this.rows.delete(pendingKey(tenantId, userId));
  }
}

export async function consumePendingConnectorUse(input: {
  store: PendingConnectorUseStore;
  tenantId: string;
  userId: string;
  connectorId: PendingConnectorUse["connector_id"];
  cancelled?: boolean;
  source?: "chat" | "page";
  now?: number;
}): Promise<ConnectorResumeDecision> {
  const pending = await input.store.get(input.tenantId, input.userId);
  const decision = decideConnectorResume({
    pending,
    connector_id: input.connectorId,
    cancelled: input.cancelled,
    source: input.source,
    now: input.now,
  });
  await input.store.delete(input.tenantId, input.userId);
  return decision;
}
