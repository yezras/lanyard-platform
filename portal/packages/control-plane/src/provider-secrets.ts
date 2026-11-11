/**
 * Class B tenant provider secrets (`lp-2qs.4`,
 * dual-auth-credential-planes.md §6). One row per `(tenant_id, slot)` in
 * `tenant_provider_secrets`. Ciphertext is a KMS envelope (same crypto as
 * connector secrets); plaintext exists only at wake-inject time inside CP.
 * Audit metadata records slot + actor, never the value.
 */

import {
  OPS_OAUTH_SLOT_IDS,
  opsSecretSlotId,
  parseOpsSecretSlot,
  PROVIDER_WAKE_ENV_KEYS,
  type OpsSecretSlot,
} from "@lanyard/shared";

import {
  ConnectorKmsNotConfiguredError,
  decryptUtf8Envelope,
  encryptUtf8Envelope,
  type ConnectorKms,
} from "./connector-kms.js";
import type { SqlClient } from "./db.js";
import { fingerprintSecretValue } from "./daytona-env-redact.js";

export class InvalidProviderSecretSlotError extends Error {
  readonly code = "INVALID_PROVIDER_SECRET_SLOT";

  constructor(value: string) {
    super(`Unknown provider secret slot: ${value}`);
    this.name = "InvalidProviderSecretSlotError";
  }
}

export class InvalidProviderSecretValueError extends Error {
  readonly code = "INVALID_PROVIDER_SECRET_VALUE";

  constructor() {
    super("Provider secret value must be a non-empty string");
    this.name = "InvalidProviderSecretValueError";
  }
}

/** KMS not wired → fail closed rather than store plaintext. */
export class ProviderSecretKmsNotConfiguredError extends ConnectorKmsNotConfiguredError {
  constructor() {
    super();
    this.name = "ProviderSecretKmsNotConfiguredError";
  }
}

type ProviderSecretAuditRecorder = (input: {
  tenant_id: string | null;
  action:
    | "tenant.provider_secret_upserted"
    | "tenant.provider_secret_deleted";
  actor: string | null;
  metadata: Record<string, unknown>;
}) => Promise<void>;

export type TenantProviderSecretStatus = {
  tenant_id: string;
  slot: OpsSecretSlot;
  present: boolean;
  /** sha256 of plaintext, first 12 hex chars — safe to display. */
  fingerprint: string | null;
  rotated_at: string | null;
};

type SecretRow = {
  tenant_id: string;
  slot_id: string;
  secrets_ciphertext: string;
  fingerprint: string;
  created_at: string;
  updated_at: string;
};

/** Parse a URL/body slot id or throw (closed allowlist). */
export function parseProviderSecretSlotOrThrow(value: string): OpsSecretSlot {
  const slot = parseOpsSecretSlot(value);
  if (!slot) {
    throw new InvalidProviderSecretSlotError(value);
  }
  return slot;
}

function statusFor(
  tenantId: string,
  slot: OpsSecretSlot,
  row?: SecretRow,
): TenantProviderSecretStatus {
  return {
    tenant_id: tenantId,
    slot,
    present: Boolean(row),
    fingerprint: row?.fingerprint ?? null,
    rotated_at: row?.updated_at ?? null,
  };
}

const ALL_SLOT_IDS = [...PROVIDER_WAKE_ENV_KEYS, ...OPS_OAUTH_SLOT_IDS] as const;

export async function listTenantProviderSecretStatuses(
  db: SqlClient,
  tenant_id: string,
): Promise<TenantProviderSecretStatus[]> {
  const rows = await db.all<SecretRow>(
    `SELECT tenant_id, slot_id, fingerprint, updated_at
     FROM tenant_provider_secrets
     WHERE tenant_id = ?
     ORDER BY slot_id`,
    [tenant_id],
  );
  const bySlot = new Map(rows.map((row) => [row.slot_id, row]));
  return ALL_SLOT_IDS.map((slotId) => {
    const slot = parseOpsSecretSlot(slotId);
    if (!slot) {
      throw new InvalidProviderSecretSlotError(slotId);
    }
    return statusFor(tenant_id, slot, bySlot.get(slotId));
  });
}

async function getSecretRow(
  db: SqlClient,
  tenant_id: string,
  slotId: string,
): Promise<SecretRow | null> {
  return (
    (await db.get<SecretRow>(
      `SELECT tenant_id, slot_id, fingerprint, secrets_ciphertext, created_at, updated_at
       FROM tenant_provider_secrets
       WHERE tenant_id = ? AND slot_id = ?`,
      [tenant_id, slotId],
    )) ?? null
  );
}

export async function upsertTenantProviderSecret(
  db: SqlClient,
  kms: ConnectorKms | null,
  recordAudit: ProviderSecretAuditRecorder,
  input: {
    tenant_id: string;
    slot: OpsSecretSlot;
    value: string;
    actor?: string | null;
  },
): Promise<TenantProviderSecretStatus> {
  if (!kms) {
    throw new ProviderSecretKmsNotConfiguredError();
  }
  const value = input.value.trim();
  if (!value) {
    throw new InvalidProviderSecretValueError();
  }
  const slotId = opsSecretSlotId(input.slot);
  const now = new Date().toISOString();
  const existing = await getSecretRow(db, input.tenant_id, slotId);
  const ciphertext = await encryptUtf8Envelope(kms, value);
  const fingerprint = fingerprintSecretValue(value);

  await db.run(
    `INSERT INTO tenant_provider_secrets
       (tenant_id, slot_id, secrets_ciphertext, fingerprint, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (tenant_id, slot_id) DO UPDATE SET
       secrets_ciphertext = EXCLUDED.secrets_ciphertext,
       fingerprint = EXCLUDED.fingerprint,
       updated_at = EXCLUDED.updated_at`,
    [
      input.tenant_id,
      slotId,
      ciphertext,
      fingerprint,
      existing?.created_at ?? now,
      now,
    ],
  );

  await recordAudit({
    tenant_id: input.tenant_id,
    action: "tenant.provider_secret_upserted",
    actor: input.actor ?? null,
    metadata: { slot_id: slotId, kind: input.slot.kind },
  });

  return {
    tenant_id: input.tenant_id,
    slot: input.slot,
    present: true,
    fingerprint,
    rotated_at: now,
  };
}

export async function deleteTenantProviderSecret(
  db: SqlClient,
  recordAudit: ProviderSecretAuditRecorder,
  input: {
    tenant_id: string;
    slot: OpsSecretSlot;
    actor?: string | null;
  },
): Promise<boolean> {
  const slotId = opsSecretSlotId(input.slot);
  const result = await db.run(
    `DELETE FROM tenant_provider_secrets
     WHERE tenant_id = ? AND slot_id = ?`,
    [input.tenant_id, slotId],
  );
  if (result.changes > 0) {
    await recordAudit({
      tenant_id: input.tenant_id,
      action: "tenant.provider_secret_deleted",
      actor: input.actor ?? null,
      metadata: { slot_id: slotId, kind: input.slot.kind },
    });
  }
  return result.changes > 0;
}

/**
 * Decrypt env-kind rows for one tenant into a wake-env fragment.
 * Only slots in `PROVIDER_WAKE_ENV_KEYS` are returned; OAuth-slot material is
 * consumed by other inject paths and stays out of guest create env here.
 */
export async function getTenantProviderWakeEnvValues(
  db: SqlClient,
  kms: ConnectorKms | null,
  tenant_id: string,
): Promise<Record<string, string>> {
  if (!kms) {
    throw new ProviderSecretKmsNotConfiguredError();
  }
  const rows = await db.all<SecretRow>(
    `SELECT tenant_id, slot_id, fingerprint, secrets_ciphertext, created_at, updated_at
     FROM tenant_provider_secrets
     WHERE tenant_id = ? AND slot_id IN (${PROVIDER_WAKE_ENV_KEYS.map(() => "?").join(", ")})`,
    [tenant_id, ...PROVIDER_WAKE_ENV_KEYS],
  );
  const out: Record<string, string> = {};
  for (const row of rows) {
    out[row.slot_id] = await decryptUtf8Envelope(kms, row.secrets_ciphertext);
  }
  return out;
}
