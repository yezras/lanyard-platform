/**
 * Class C tenant-principal connector secrets (lp-hdzm.24 / 0018.24).
 *
 * Keyed `(tenant_id, connector_id, surface_id)` in CP Postgres as a KMS
 * envelope. Registry connectors (Stripe, Linear, …) paste a tenant key;
 * first-class google/hubspot/whatsapp/github stay on Class A user rows.
 *
 * Decrypt happens at request-time attach (`class-c-attach.ts`) on the
 * harness HTTP client. Never `buildProviderWakeEnv`. Never guest files.
 */

import {
  FIRST_CLASS_CONNECTOR_IDS,
  isFirstClassConnectorId,
  parseConnectorId,
  type ConnectorId,
} from "./connectors.js";
import {
  ConnectorKmsNotConfiguredError,
  decryptUtf8Envelope,
  encryptUtf8Envelope,
  type ConnectorKms,
} from "./connector-kms.js";
import { fingerprintSecretValue } from "./daytona-env-redact.js";
import type { SqlClient } from "./db.js";

export const CONNECTOR_SURFACE_IDS = ["mcp", "api", "cli"] as const;
export type ConnectorSurfaceId = (typeof CONNECTOR_SURFACE_IDS)[number];

export const CLASS_C_AUTH_KINDS = ["bearer", "api_key"] as const;
export type ClassCAuthKind = (typeof CLASS_C_AUTH_KINDS)[number];

export type ClassCSecretPayload = {
  auth_kind: ClassCAuthKind;
  value: string;
};

export type ClassCSecretStatus = {
  tenant_id: string;
  connector_id: ConnectorId;
  surface_id: ConnectorSurfaceId;
  present: boolean;
  fingerprint: string | null;
  rotated_at: string | null;
};

type SecretRow = {
  tenant_id: string;
  connector_id: string;
  surface_id: string;
  secrets_ciphertext: string;
  fingerprint: string;
  created_at: string;
  updated_at: string;
};

type ClassCAuditRecorder = (input: {
  tenant_id: string | null;
  action: "tenant.class_c_secret_upserted" | "tenant.class_c_secret_deleted";
  actor: string | null;
  metadata: Record<string, unknown>;
}) => Promise<void>;

export class InvalidConnectorSurfaceError extends Error {
  readonly code = "INVALID_CONNECTOR_SURFACE";

  constructor(value: string) {
    super(`Unknown connector surface: ${value}`);
    this.name = "InvalidConnectorSurfaceError";
  }
}

export class InvalidClassCAuthKindError extends Error {
  readonly code = "INVALID_CLASS_C_AUTH_KIND";

  constructor(value: string) {
    super(`Unknown Class C auth_kind: ${value}`);
    this.name = "InvalidClassCAuthKindError";
  }
}

export class InvalidClassCSecretValueError extends Error {
  readonly code = "INVALID_CLASS_C_SECRET_VALUE";

  constructor() {
    super("Class C secret value must be a non-empty string");
    this.name = "InvalidClassCSecretValueError";
  }
}

export class ClassCFirstClassConnectorError extends Error {
  readonly code = "CLASS_C_FIRST_CLASS_CONNECTOR";

  constructor(connector_id: string) {
    super(
      `Class C is for registry connectors; ${connector_id} uses user-principal Class A`,
    );
    this.name = "ClassCFirstClassConnectorError";
  }
}

export class ClassCSecretNotFoundError extends Error {
  readonly code = "CLASS_C_SECRET_NOT_FOUND";

  constructor(
    tenant_id: string,
    connector_id: ConnectorId,
    surface_id: ConnectorSurfaceId,
  ) {
    super(
      `Class C secret not found: ${tenant_id}/${connector_id}/${surface_id}`,
    );
    this.name = "ClassCSecretNotFoundError";
  }
}

export class ClassCKmsNotConfiguredError extends ConnectorKmsNotConfiguredError {
  constructor() {
    super();
    this.name = "ClassCKmsNotConfiguredError";
  }
}

export function isConnectorSurfaceId(
  value: string,
): value is ConnectorSurfaceId {
  return (CONNECTOR_SURFACE_IDS as readonly string[]).includes(value);
}

export function parseConnectorSurfaceId(value: string): ConnectorSurfaceId {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "graphql") {
    throw new InvalidConnectorSurfaceError(value);
  }
  if (!isConnectorSurfaceId(trimmed)) {
    throw new InvalidConnectorSurfaceError(value);
  }
  return trimmed;
}

export function parseClassCAuthKind(value: unknown): ClassCAuthKind {
  if (value === undefined || value === null || value === "") {
    return "bearer";
  }
  if (typeof value !== "string") {
    throw new InvalidClassCAuthKindError(String(value));
  }
  const trimmed = value.trim().toLowerCase();
  if (!(CLASS_C_AUTH_KINDS as readonly string[]).includes(trimmed)) {
    throw new InvalidClassCAuthKindError(value);
  }
  return trimmed as ClassCAuthKind;
}

export async function parseClassCConnectorId(
  db: SqlClient,
  value: string,
): Promise<ConnectorId> {
  const id = await parseConnectorId(db, value);
  if (isFirstClassConnectorId(id)) {
    throw new ClassCFirstClassConnectorError(id);
  }
  return id;
}

function requireKms(kms: ConnectorKms | null | undefined): ConnectorKms {
  if (!kms) {
    throw new ClassCKmsNotConfiguredError();
  }
  return kms;
}

function statusFor(
  tenant_id: string,
  connector_id: ConnectorId,
  surface_id: ConnectorSurfaceId,
  row?: SecretRow,
): ClassCSecretStatus {
  return {
    tenant_id,
    connector_id,
    surface_id,
    present: Boolean(row),
    fingerprint: row?.fingerprint ?? null,
    rotated_at: row?.updated_at ?? null,
  };
}

export function parseClassCSecretPayload(
  value: unknown,
): ClassCSecretPayload {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new InvalidClassCSecretValueError();
  }
  const raw = value as Record<string, unknown>;
  if (
    "secrets_ciphertext" in raw ||
    "ciphertext" in raw ||
    "encrypted" in raw
  ) {
    throw new InvalidClassCSecretValueError();
  }
  const token = raw.value;
  if (typeof token !== "string" || !token.trim()) {
    throw new InvalidClassCSecretValueError();
  }
  return {
    auth_kind: parseClassCAuthKind(raw.auth_kind),
    value: token.trim(),
  };
}

async function getSecretRow(
  db: SqlClient,
  tenant_id: string,
  connector_id: ConnectorId,
  surface_id: ConnectorSurfaceId,
): Promise<SecretRow | null> {
  return (
    (await db.get<SecretRow>(
      `SELECT tenant_id, connector_id, surface_id, secrets_ciphertext,
              fingerprint, created_at, updated_at
       FROM tenant_connector_class_c_secrets
       WHERE tenant_id = ? AND connector_id = ? AND surface_id = ?`,
      [tenant_id, connector_id, surface_id],
    )) ?? null
  );
}

export async function listClassCSecretStatuses(
  db: SqlClient,
  tenant_id: string,
  connector_id: ConnectorId,
): Promise<ClassCSecretStatus[]> {
  if (isFirstClassConnectorId(connector_id)) {
    throw new ClassCFirstClassConnectorError(connector_id);
  }
  const rows = await db.all<SecretRow>(
    `SELECT tenant_id, connector_id, surface_id, fingerprint, updated_at
     FROM tenant_connector_class_c_secrets
     WHERE tenant_id = ? AND connector_id = ?
     ORDER BY surface_id`,
    [tenant_id, connector_id],
  );
  const bySurface = new Map(rows.map((row) => [row.surface_id, row]));
  return CONNECTOR_SURFACE_IDS.map((surface_id) =>
    statusFor(tenant_id, connector_id, surface_id, bySurface.get(surface_id)),
  );
}

export async function upsertClassCSecret(
  db: SqlClient,
  kms: ConnectorKms | null,
  recordAudit: ClassCAuditRecorder,
  input: {
    tenant_id: string;
    connector_id: ConnectorId;
    surface_id: ConnectorSurfaceId;
    payload: ClassCSecretPayload;
    actor?: string | null;
  },
): Promise<ClassCSecretStatus> {
  const connector_id = await parseClassCConnectorId(db, input.connector_id);
  const surface_id = parseConnectorSurfaceId(input.surface_id);
  const value = input.payload.value.trim();
  if (!value) {
    throw new InvalidClassCSecretValueError();
  }
  const cipher = requireKms(kms);
  const now = new Date().toISOString();
  const existing = await getSecretRow(
    db,
    input.tenant_id,
    connector_id,
    surface_id,
  );
  const stored: ClassCSecretPayload = {
    auth_kind: parseClassCAuthKind(input.payload.auth_kind),
    value,
  };
  const secrets_ciphertext = await encryptUtf8Envelope(
    cipher,
    JSON.stringify(stored),
  );
  const fingerprint = fingerprintSecretValue(value);

  await db.run(
    `INSERT INTO tenant_connector_class_c_secrets
       (tenant_id, connector_id, surface_id, secrets_ciphertext, fingerprint,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (tenant_id, connector_id, surface_id) DO UPDATE SET
       secrets_ciphertext = EXCLUDED.secrets_ciphertext,
       fingerprint = EXCLUDED.fingerprint,
       updated_at = EXCLUDED.updated_at`,
    [
      input.tenant_id,
      connector_id,
      surface_id,
      secrets_ciphertext,
      fingerprint,
      existing?.created_at ?? now,
      now,
    ],
  );

  await recordAudit({
    tenant_id: input.tenant_id,
    action: "tenant.class_c_secret_upserted",
    actor: input.actor ?? null,
    metadata: {
      connector_id,
      surface_id,
      auth_kind: stored.auth_kind,
    },
  });

  return {
    tenant_id: input.tenant_id,
    connector_id,
    surface_id,
    present: true,
    fingerprint,
    rotated_at: now,
  };
}

export async function deleteClassCSecret(
  db: SqlClient,
  recordAudit: ClassCAuditRecorder,
  input: {
    tenant_id: string;
    connector_id: ConnectorId;
    surface_id: ConnectorSurfaceId;
    actor?: string | null;
  },
): Promise<boolean> {
  const connector_id = await parseClassCConnectorId(db, input.connector_id);
  const surface_id = parseConnectorSurfaceId(input.surface_id);
  const result = await db.run(
    `DELETE FROM tenant_connector_class_c_secrets
     WHERE tenant_id = ? AND connector_id = ? AND surface_id = ?`,
    [input.tenant_id, connector_id, surface_id],
  );
  if (result.changes > 0) {
    await recordAudit({
      tenant_id: input.tenant_id,
      action: "tenant.class_c_secret_deleted",
      actor: input.actor ?? null,
      metadata: { connector_id, surface_id },
    });
  }
  return result.changes > 0;
}

export async function getClassCSecretPayload(
  db: SqlClient,
  kms: ConnectorKms | null,
  tenant_id: string,
  connector_id: ConnectorId,
  surface_id: ConnectorSurfaceId,
): Promise<ClassCSecretPayload> {
  const id = await parseClassCConnectorId(db, connector_id);
  const surface = parseConnectorSurfaceId(surface_id);
  const row = await getSecretRow(db, tenant_id, id, surface);
  if (!row) {
    throw new ClassCSecretNotFoundError(tenant_id, id, surface);
  }
  const json = await decryptUtf8Envelope(requireKms(kms), row.secrets_ciphertext);
  return parseClassCSecretPayload(JSON.parse(json) as unknown);
}

/** Compile-time proof first-class ids are not a Class C closed set. */
export const CLASS_C_FORBIDDEN_FIRST_CLASS_IDS = FIRST_CLASS_CONNECTOR_IDS;
