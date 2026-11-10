/**
 * In-memory per-instance secret store (dev stub; control plane #5 replaces this).
 */

export interface SecretRecord {
  gatewayId: string;
  instanceId: string;
  /** Set when relay validates against control plane (needed for retention gate). */
  tenantId?: string;
  /** Primary + optional rotation secrets for verify list. */
  secrets: string[];
  revoked: boolean;
}

export interface SecretStore {
  getByGatewayId(gatewayId: string): SecretRecord | undefined;
  getByInstanceId(instanceId: string): SecretRecord | undefined;
  revoke(instanceId: string): boolean;
  register(record: Omit<SecretRecord, "revoked">): void;
  setTenantId(instanceId: string, tenantId: string): boolean;
  list(): SecretRecord[];
}

export class InMemorySecretStore implements SecretStore {
  private readonly byGatewayId = new Map<string, SecretRecord>();
  private readonly byInstanceId = new Map<string, SecretRecord>();

  getByGatewayId(gatewayId: string): SecretRecord | undefined {
    return this.byGatewayId.get(gatewayId);
  }

  getByInstanceId(instanceId: string): SecretRecord | undefined {
    return this.byInstanceId.get(instanceId);
  }

  setTenantId(instanceId: string, tenantId: string): boolean {
    const record = this.byInstanceId.get(instanceId);
    if (!record || record.tenantId) return false;
    record.tenantId = tenantId;
    return true;
  }

  /**
   * Upsert credentials for a gateway/instance pair.
   * Clears revoked flag (re-register after revoke is allowed).
   * Keeps byGatewayId / byInstanceId maps consistent when ids change.
   */
  register(record: Omit<SecretRecord, "revoked">): void {
    const gatewayId = record.gatewayId.trim();
    const instanceId = record.instanceId.trim();
    if (!gatewayId || !instanceId) {
      throw new Error("gatewayId and instanceId are required");
    }
    if (!record.secrets.length || record.secrets.some((s) => !s)) {
      throw new Error("at least one non-empty secret is required");
    }

    // Drop stale cross-maps when gatewayId or instanceId is re-bound.
    const existingByInstance = this.byInstanceId.get(instanceId);
    if (
      existingByInstance &&
      existingByInstance.gatewayId !== gatewayId
    ) {
      this.byGatewayId.delete(existingByInstance.gatewayId);
    }
    const existingByGateway = this.byGatewayId.get(gatewayId);
    if (
      existingByGateway &&
      existingByGateway.instanceId !== instanceId
    ) {
      this.byInstanceId.delete(existingByGateway.instanceId);
    }

    const full: SecretRecord = {
      gatewayId,
      instanceId,
      secrets: [...record.secrets],
      tenantId: record.tenantId,
      revoked: false,
    };
    this.byGatewayId.set(gatewayId, full);
    this.byInstanceId.set(instanceId, full);
  }

  revoke(instanceId: string): boolean {
    const record = this.byInstanceId.get(instanceId);
    if (!record) return false;
    record.revoked = true;
    return true;
  }

  list(): SecretRecord[] {
    return [...this.byInstanceId.values()];
  }
}

export interface DevSecretSeed {
  gatewayId: string;
  instanceId: string;
  secret: string;
  rotationSecret?: string;
  tenantId?: string;
}

export function loadDevSecretsFromEnv(
  store: InMemorySecretStore,
): InMemorySecretStore {
  const json = process.env.RELAY_DEV_SECRETS?.trim();
  if (json) {
    const seeds = JSON.parse(json) as DevSecretSeed[];
    for (const seed of seeds) {
      const secrets = [seed.secret];
      if (seed.rotationSecret) secrets.push(seed.rotationSecret);
      store.register({
        gatewayId: seed.gatewayId,
        instanceId: seed.instanceId,
        secrets,
        tenantId: seed.tenantId,
      });
    }
    return store;
  }

  const gatewayId = process.env.RELAY_GATEWAY_ID?.trim();
  const secret = process.env.RELAY_GATEWAY_SECRET?.trim();
  const instanceId = process.env.RELAY_INSTANCE_ID?.trim() ?? "dev-instance";
  if (gatewayId && secret) {
    store.register({ gatewayId, instanceId, secrets: [secret] });
  }

  return store;
}