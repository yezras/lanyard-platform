/**
 * Tenant deployment / resource registry (cbd-mta.3.3).
 *
 * Stores non-secret hosting and AWS reference metadata so Portal can route and
 * operate tenants without duplicating Terraform state or credentials.
 * Canonical vault content stays on the customer host (Brain RPC).
 */

import { randomUUID } from "node:crypto";
import { redactAuditMetadata } from "@lanyard/shared";

import type { SqlClient } from "./db.js";
import type {
  AuditAction,
  AuditResult,
  DeploymentStatus,
  HostingTrack,
  InstanceHealthStatus,
  ChatDelivery,
  InstancePresence,
  IsolationMode,
  ResourceKind,
  ResourceRefStatus,
  RuntimeKind,
  TenantDeployment,
  TenantResourceRef,
} from "./types.js";
import {
  CHAT_DELIVERIES,
  DEPLOYMENT_STATUSES,
  HOSTING_TRACKS,
  INSTANCE_HEALTH_STATUSES,
  INSTANCE_PRESENCE_STATES,
  ISOLATION_MODES,
  RESOURCE_KINDS,
  RESOURCE_REF_STATUSES,
  RUNTIME_KINDS,
} from "./types.js";
import {
  assertS3VaultPrefixBoundToTenant,
  InvalidS3VaultPrefixError,
  InvalidTenantIdForVaultPrefixError,
  VaultPrefixError,
} from "./vault-prefix.js";

export type AuditRecorder = (input: {
  tenant_id: string | null;
  action: AuditAction;
  actor: string | null;
  metadata: Record<string, unknown>;
  instance_id?: string | null;
  result?: AuditResult;
  request_id?: string | null;
}) => Promise<void>;

const AWS_ACCOUNT_RE = /^\d{12}$/;
const SECRET_ARN_RE =
  /^arn:aws(?:-us-gov|-cn)?:(ssm|secretsmanager):[a-z0-9-]+:\d{12}:.+/i;
const EC2_ID_RE = /^i-[0-9a-f]{8,17}$/i;

export class InvalidDeploymentInputError extends Error {
  readonly code = "INVALID_DEPLOYMENT_INPUT";

  constructor(message: string) {
    super(message);
    this.name = "InvalidDeploymentInputError";
  }
}

export class ResourceRefNotFoundError extends Error {
  readonly code = "RESOURCE_REF_NOT_FOUND";

  constructor(resource_ref_id: string) {
    super(`Resource ref not found: ${resource_ref_id}`);
    this.name = "ResourceRefNotFoundError";
  }
}

export class CrossTenantResourceRefError extends Error {
  readonly code = "CROSS_TENANT_RESOURCE_REF";

  constructor(detail: string) {
    super(detail);
    this.name = "CrossTenantResourceRefError";
  }
}

function parseHostingTrack(value: string): HostingTrack {
  if ((HOSTING_TRACKS as readonly string[]).includes(value)) {
    return value as HostingTrack;
  }
  throw new InvalidDeploymentInputError(
    `hosting_track must be one of: ${HOSTING_TRACKS.join(", ")}`,
  );
}

function parseIsolationMode(value: string): IsolationMode {
  if ((ISOLATION_MODES as readonly string[]).includes(value)) {
    return value as IsolationMode;
  }
  throw new InvalidDeploymentInputError(
    `isolation_mode must be one of: ${ISOLATION_MODES.join(", ")}`,
  );
}

function parseDeploymentStatus(value: string): DeploymentStatus {
  if ((DEPLOYMENT_STATUSES as readonly string[]).includes(value)) {
    return value as DeploymentStatus;
  }
  throw new InvalidDeploymentInputError(
    `status must be one of: ${DEPLOYMENT_STATUSES.join(", ")}`,
  );
}

function parseResourceKind(value: string): ResourceKind {
  if ((RESOURCE_KINDS as readonly string[]).includes(value)) {
    return value as ResourceKind;
  }
  throw new InvalidDeploymentInputError(
    `resource_kind must be one of: ${RESOURCE_KINDS.join(", ")}`,
  );
}

function parseResourceStatus(value: string): ResourceRefStatus {
  if ((RESOURCE_REF_STATUSES as readonly string[]).includes(value)) {
    return value as ResourceRefStatus;
  }
  throw new InvalidDeploymentInputError(
    `resource status must be one of: ${RESOURCE_REF_STATUSES.join(", ")}`,
  );
}

function parseHealthStatus(value: string): InstanceHealthStatus {
  if ((INSTANCE_HEALTH_STATUSES as readonly string[]).includes(value)) {
    return value as InstanceHealthStatus;
  }
  throw new InvalidDeploymentInputError(
    `health_status must be one of: ${INSTANCE_HEALTH_STATUSES.join(", ")}`,
  );
}

function parseRuntimeKind(value: string): RuntimeKind {
  if ((RUNTIME_KINDS as readonly string[]).includes(value)) {
    return value as RuntimeKind;
  }
  throw new InvalidDeploymentInputError(
    `runtime_kind must be one of: ${RUNTIME_KINDS.join(", ")}`,
  );
}

function parseChatDelivery(value: string): ChatDelivery {
  if ((CHAT_DELIVERIES as readonly string[]).includes(value)) {
    return value as ChatDelivery;
  }
  throw new InvalidDeploymentInputError(
    `chat_delivery must be one of: ${CHAT_DELIVERIES.join(", ")}`,
  );
}

function parseInstancePresence(value: string): InstancePresence {
  if ((INSTANCE_PRESENCE_STATES as readonly string[]).includes(value)) {
    return value as InstancePresence;
  }
  throw new InvalidDeploymentInputError(
    `presence must be one of: ${INSTANCE_PRESENCE_STATES.join(", ")}`,
  );
}

/** Opaque non-empty string field (sandbox_id, snapshot pin, s3 prefix). */
function normalizeOptionalOpaqueString(
  value: string | null | undefined,
  field: string,
  maxLen: number,
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > maxLen) {
    throw new InvalidDeploymentInputError(
      `${field} must be at most ${maxLen} characters when set`,
    );
  }
  return trimmed;
}

/**
 * Registry update path for s3_vault_prefix (lp-3a1.1).
 * Bind override to tenant_id; store normative relative form with trailing slash.
 */
function normalizeS3VaultPrefixForRegistryUpdate(
  value: string | null | undefined,
  tenantId: string,
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > 1024) {
    throw new InvalidDeploymentInputError(
      "s3_vault_prefix must be at most 1024 characters when set",
    );
  }
  try {
    return assertS3VaultPrefixBoundToTenant(trimmed, tenantId);
  } catch (err) {
    if (
      err instanceof InvalidS3VaultPrefixError ||
      err instanceof InvalidTenantIdForVaultPrefixError ||
      err instanceof VaultPrefixError
    ) {
      throw new InvalidDeploymentInputError(
        `s3_vault_prefix: ${err.message}`,
      );
    }
    throw err;
  }
}

function normalizeAwsAccountId(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const trimmed = value.trim();
  if (!AWS_ACCOUNT_RE.test(trimmed)) {
    throw new InvalidDeploymentInputError(
      "aws_account_id must be a 12-digit AWS account id when set",
    );
  }
  return trimmed;
}

function normalizeSecretArn(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const trimmed = value.trim();
  // Allow SSM parameter path-style refs used by some runbooks: arn:...:parameter/...
  if (!SECRET_ARN_RE.test(trimmed) && !trimmed.startsWith("arn:aws")) {
    throw new InvalidDeploymentInputError(
      "secret_arn / secret_param_arn must be an ARN reference (never a secret value)",
    );
  }
  // Reject obvious secret-value shapes (no arn, short tokens, or JSON blobs).
  if (
    trimmed.includes('"SecretString"') ||
    trimmed.includes("GATEWAY_RELAY_SECRET=") ||
    (!trimmed.startsWith("arn:") && trimmed.length < 20)
  ) {
    throw new InvalidDeploymentInputError(
      "secret fields must hold ARN refs only, not secret values",
    );
  }
  return trimmed;
}

function normalizeEc2InstanceId(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const trimmed = value.trim();
  if (!EC2_ID_RE.test(trimmed)) {
    throw new InvalidDeploymentInputError(
      "ec2_instance_id must look like i-… when set",
    );
  }
  return trimmed;
}

function rowToDeployment(row: {
  tenant_id: string;
  hosting_track: string;
  isolation_mode: string;
  aws_account_id: string | null;
  aws_region: string | null;
  project_name: string | null;
  status: string;
  client_core_version: string | null;
  hermes_version: string | null;
  primary_instance_id: string | null;
  created_at: string;
  updated_at: string;
  retired_at: string | null;
}): TenantDeployment {
  return {
    tenant_id: row.tenant_id,
    hosting_track: row.hosting_track as HostingTrack,
    isolation_mode: row.isolation_mode as IsolationMode,
    aws_account_id: row.aws_account_id,
    aws_region: row.aws_region,
    project_name: row.project_name,
    status: row.status as DeploymentStatus,
    client_core_version: row.client_core_version,
    hermes_version: row.hermes_version,
    primary_instance_id: row.primary_instance_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
    retired_at: row.retired_at,
  };
}

function rowToResourceRef(row: {
  resource_ref_id: string;
  tenant_id: string;
  resource_kind: string;
  name: string;
  aws_id: string | null;
  arn: string | null;
  secret_arn: string | null;
  aws_region: string | null;
  status: string;
  last_seen_at: string | null;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}): TenantResourceRef {
  let metadata: Record<string, unknown> = {};
  try {
    metadata = JSON.parse(row.metadata_json) as Record<string, unknown>;
  } catch {
    metadata = {};
  }
  return {
    resource_ref_id: row.resource_ref_id,
    tenant_id: row.tenant_id,
    resource_kind: row.resource_kind as ResourceKind,
    name: row.name,
    aws_id: row.aws_id,
    arn: row.arn,
    secret_arn: row.secret_arn,
    aws_region: row.aws_region,
    status: row.status as ResourceRefStatus,
    last_seen_at: row.last_seen_at,
    metadata: redactAuditMetadata(metadata),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export async function getTenantDeployment(
  db: SqlClient,
  tenant_id: string,
): Promise<TenantDeployment | null> {
  const row = await db.get<{
    tenant_id: string;
    hosting_track: string;
    isolation_mode: string;
    aws_account_id: string | null;
    aws_region: string | null;
    project_name: string | null;
    status: string;
    client_core_version: string | null;
    hermes_version: string | null;
    primary_instance_id: string | null;
    created_at: string;
    updated_at: string;
    retired_at: string | null;
  }>(
    `SELECT tenant_id, hosting_track, isolation_mode, aws_account_id, aws_region,
            project_name, status, client_core_version, hermes_version,
            primary_instance_id, created_at, updated_at, retired_at
     FROM tenant_deployments WHERE tenant_id = ?`,
    [tenant_id],
  );
  return row ? rowToDeployment(row) : null;
}

export async function upsertTenantDeployment(
  db: SqlClient,
  recordAudit: AuditRecorder,
  input: {
    tenant_id: string;
    hosting_track: string;
    isolation_mode: string;
    aws_account_id?: string | null;
    aws_region?: string | null;
    project_name?: string | null;
    status?: string;
    client_core_version?: string | null;
    hermes_version?: string | null;
    primary_instance_id?: string | null;
    actor?: string | null;
    request_id?: string | null;
  },
): Promise<TenantDeployment> {
  const hosting_track = parseHostingTrack(input.hosting_track);
  const isolation_mode = parseIsolationMode(input.isolation_mode);
  const status = parseDeploymentStatus(input.status ?? "registered");
  const aws_account_id = normalizeAwsAccountId(input.aws_account_id);
  const now = new Date().toISOString();
  const retired_at = status === "retired" || status === "offboarding" ? now : null;

  if (input.primary_instance_id) {
    const inst = await db.get<{ tenant_id: string }>(
      `SELECT tenant_id FROM gateway_instances WHERE instance_id = ?`,
      [input.primary_instance_id],
    );
    if (!inst || inst.tenant_id !== input.tenant_id) {
      throw new CrossTenantResourceRefError(
        "primary_instance_id must belong to the same tenant",
      );
    }
  }

  const existing = await getTenantDeployment(db, input.tenant_id);
  if (existing) {
    await db.run(
      `UPDATE tenant_deployments SET
         hosting_track = ?,
         isolation_mode = ?,
         aws_account_id = ?,
         aws_region = ?,
         project_name = ?,
         status = ?,
         client_core_version = ?,
         hermes_version = ?,
         primary_instance_id = ?,
         updated_at = ?,
         retired_at = ?
       WHERE tenant_id = ?`,
      [
        hosting_track,
        isolation_mode,
        aws_account_id,
        input.aws_region ?? null,
        input.project_name ?? null,
        status,
        input.client_core_version ?? null,
        input.hermes_version ?? null,
        input.primary_instance_id ?? null,
        now,
        retired_at ?? existing.retired_at,
        input.tenant_id,
      ],
    );
  } else {
    await db.run(
      `INSERT INTO tenant_deployments
       (tenant_id, hosting_track, isolation_mode, aws_account_id, aws_region,
        project_name, status, client_core_version, hermes_version,
        primary_instance_id, created_at, updated_at, retired_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.tenant_id,
        hosting_track,
        isolation_mode,
        aws_account_id,
        input.aws_region ?? null,
        input.project_name ?? null,
        status,
        input.client_core_version ?? null,
        input.hermes_version ?? null,
        input.primary_instance_id ?? null,
        now,
        now,
        retired_at,
      ],
    );
  }

  const next = await getTenantDeployment(db, input.tenant_id);
  if (!next) {
    throw new Error("tenant_deployments upsert failed");
  }

  await recordAudit({
    tenant_id: input.tenant_id,
    action: "tenant.deployment_upserted",
    actor: input.actor ?? null,
    result: "success",
    request_id: input.request_id ?? null,
    instance_id: next.primary_instance_id,
    metadata: {
      hosting_track: next.hosting_track,
      isolation_mode: next.isolation_mode,
      aws_account_id: next.aws_account_id,
      aws_region: next.aws_region,
      project_name: next.project_name,
      status: next.status,
      client_core_version: next.client_core_version,
      hermes_version: next.hermes_version,
      primary_instance_id: next.primary_instance_id,
    },
  });

  return next;
}

export async function listTenantResourceRefs(
  db: SqlClient,
  tenant_id: string,
  options: { include_retired?: boolean } = {},
): Promise<TenantResourceRef[]> {
  const rows = options.include_retired
    ? await db.all<{
        resource_ref_id: string;
        tenant_id: string;
        resource_kind: string;
        name: string;
        aws_id: string | null;
        arn: string | null;
        secret_arn: string | null;
        aws_region: string | null;
        status: string;
        last_seen_at: string | null;
        metadata_json: string;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT resource_ref_id, tenant_id, resource_kind, name, aws_id, arn,
                secret_arn, aws_region, status, last_seen_at, metadata_json,
                created_at, updated_at
         FROM tenant_resource_refs
         WHERE tenant_id = ?
         ORDER BY resource_kind ASC, name ASC`,
        [tenant_id],
      )
    : await db.all<{
        resource_ref_id: string;
        tenant_id: string;
        resource_kind: string;
        name: string;
        aws_id: string | null;
        arn: string | null;
        secret_arn: string | null;
        aws_region: string | null;
        status: string;
        last_seen_at: string | null;
        metadata_json: string;
        created_at: string;
        updated_at: string;
      }>(
        `SELECT resource_ref_id, tenant_id, resource_kind, name, aws_id, arn,
                secret_arn, aws_region, status, last_seen_at, metadata_json,
                created_at, updated_at
         FROM tenant_resource_refs
         WHERE tenant_id = ? AND status <> 'retired'
         ORDER BY resource_kind ASC, name ASC`,
        [tenant_id],
      );

  return rows.map(rowToResourceRef);
}

export async function upsertTenantResourceRef(
  db: SqlClient,
  recordAudit: AuditRecorder,
  input: {
    tenant_id: string;
    resource_kind: string;
    name: string;
    aws_id?: string | null;
    arn?: string | null;
    secret_arn?: string | null;
    aws_region?: string | null;
    status?: string;
    last_seen_at?: string | null;
    metadata?: Record<string, unknown>;
    actor?: string | null;
    request_id?: string | null;
  },
): Promise<TenantResourceRef> {
  const resource_kind = parseResourceKind(input.resource_kind);
  const name = input.name.trim();
  if (!name || name.length > 128) {
    throw new InvalidDeploymentInputError(
      "resource name is required (max 128 chars)",
    );
  }
  const status = parseResourceStatus(input.status ?? "active");
  const secret_arn = normalizeSecretArn(input.secret_arn);
  const now = new Date().toISOString();
  const safeMetadata = redactAuditMetadata(input.metadata ?? {});

  // Secret-bearing kinds should prefer secret_arn over stuffing values into arn.
  if (
    (resource_kind === "ssm_parameter" ||
      resource_kind === "secrets_manager_secret") &&
    secret_arn === null &&
    input.arn
  ) {
    // Allow arn as the secret container ref when secret_arn omitted.
    normalizeSecretArn(input.arn);
  }

  const existing = await db.get<{ resource_ref_id: string }>(
    `SELECT resource_ref_id FROM tenant_resource_refs
     WHERE tenant_id = ? AND resource_kind = ? AND name = ?`,
    [input.tenant_id, resource_kind, name],
  );

  let resource_ref_id: string;
  if (existing) {
    resource_ref_id = existing.resource_ref_id;
    await db.run(
      `UPDATE tenant_resource_refs SET
         aws_id = ?,
         arn = ?,
         secret_arn = ?,
         aws_region = ?,
         status = ?,
         last_seen_at = ?,
         metadata_json = ?,
         updated_at = ?
       WHERE resource_ref_id = ? AND tenant_id = ?`,
      [
        input.aws_id ?? null,
        input.arn ?? null,
        secret_arn,
        input.aws_region ?? null,
        status,
        input.last_seen_at ?? null,
        JSON.stringify(safeMetadata),
        now,
        resource_ref_id,
        input.tenant_id,
      ],
    );
  } else {
    resource_ref_id = randomUUID();
    await db.run(
      `INSERT INTO tenant_resource_refs
       (resource_ref_id, tenant_id, resource_kind, name, aws_id, arn, secret_arn,
        aws_region, status, last_seen_at, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        resource_ref_id,
        input.tenant_id,
        resource_kind,
        name,
        input.aws_id ?? null,
        input.arn ?? null,
        secret_arn,
        input.aws_region ?? null,
        status,
        input.last_seen_at ?? null,
        JSON.stringify(safeMetadata),
        now,
        now,
      ],
    );
  }

  const rows = await listTenantResourceRefs(db, input.tenant_id, {
    include_retired: true,
  });
  const next = rows.find((r) => r.resource_ref_id === resource_ref_id);
  if (!next) {
    throw new Error("tenant_resource_refs upsert failed");
  }

  await recordAudit({
    tenant_id: input.tenant_id,
    action: "tenant.resource_upserted",
    actor: input.actor ?? null,
    result: "success",
    request_id: input.request_id ?? null,
    metadata: {
      resource_ref_id: next.resource_ref_id,
      resource_kind: next.resource_kind,
      name: next.name,
      aws_id: next.aws_id,
      arn: next.arn,
      secret_arn: next.secret_arn,
      status: next.status,
    },
  });

  return next;
}

export async function retireTenantResourceRef(
  db: SqlClient,
  recordAudit: AuditRecorder,
  input: {
    tenant_id: string;
    resource_ref_id: string;
    actor?: string | null;
    request_id?: string | null;
  },
): Promise<TenantResourceRef> {
  const row = await db.get<{
    resource_ref_id: string;
    tenant_id: string;
    resource_kind: string;
    name: string;
    aws_id: string | null;
    arn: string | null;
    secret_arn: string | null;
    aws_region: string | null;
    status: string;
    last_seen_at: string | null;
    metadata_json: string;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT resource_ref_id, tenant_id, resource_kind, name, aws_id, arn,
            secret_arn, aws_region, status, last_seen_at, metadata_json,
            created_at, updated_at
     FROM tenant_resource_refs WHERE resource_ref_id = ?`,
    [input.resource_ref_id],
  );

  if (!row) {
    throw new ResourceRefNotFoundError(input.resource_ref_id);
  }
  if (row.tenant_id !== input.tenant_id) {
    throw new CrossTenantResourceRefError(
      "resource_ref_id does not belong to this tenant",
    );
  }

  const now = new Date().toISOString();
  await db.run(
    `UPDATE tenant_resource_refs
     SET status = 'retired', updated_at = ?
     WHERE resource_ref_id = ? AND tenant_id = ?`,
    [now, input.resource_ref_id, input.tenant_id],
  );

  const next = rowToResourceRef({ ...row, status: "retired", updated_at: now });

  await recordAudit({
    tenant_id: input.tenant_id,
    action: "tenant.resource_retired",
    actor: input.actor ?? null,
    result: "success",
    request_id: input.request_id ?? null,
    metadata: {
      resource_ref_id: next.resource_ref_id,
      resource_kind: next.resource_kind,
      name: next.name,
    },
  });

  return next;
}

/**
 * Soft-retire all active resource refs and mark deployment offboarding.
 * Used by tenant deprovision / offboarding paths.
 */
export async function offboardTenantRegistry(
  db: SqlClient,
  recordAudit: AuditRecorder,
  input: {
    tenant_id: string;
    actor?: string | null;
    request_id?: string | null;
  },
): Promise<{ retired_resource_count: number }> {
  const now = new Date().toISOString();
  const result = await db.run(
    `UPDATE tenant_resource_refs
     SET status = 'retired', updated_at = ?
     WHERE tenant_id = ? AND status <> 'retired'`,
    [now, input.tenant_id],
  );

  const existing = await getTenantDeployment(db, input.tenant_id);
  if (existing && existing.status !== "retired") {
    await db.run(
      `UPDATE tenant_deployments
       SET status = 'offboarding', updated_at = ?, retired_at = ?
       WHERE tenant_id = ?`,
      [now, now, input.tenant_id],
    );
  }

  await recordAudit({
    tenant_id: input.tenant_id,
    action: "tenant.deployment_upserted",
    actor: input.actor ?? null,
    result: "success",
    request_id: input.request_id ?? null,
    metadata: {
      status: "offboarding",
      retired_resource_count: result.changes,
      reason: "tenant_offboard",
    },
  });

  return { retired_resource_count: result.changes };
}

export async function updateInstanceRegistry(
  db: SqlClient,
  recordAudit: AuditRecorder,
  input: {
    tenant_id: string;
    instance_id: string;
    label?: string | null;
    last_seen_at?: string | null;
    health_status?: string;
    secret_param_arn?: string | null;
    ec2_instance_id?: string | null;
    aws_region?: string | null;
    runtime_kind?: string | null;
    sandbox_id?: string | null;
    presence?: string | null;
    agent_snapshot_id?: string | null;
    s3_vault_prefix?: string | null;
    last_activity_at?: string | null;
    chat_delivery?: string | null;
    actor?: string | null;
    request_id?: string | null;
  },
): Promise<{
  instance_id: string;
  tenant_id: string;
  label: string | null;
  last_seen_at: string | null;
  health_status: InstanceHealthStatus;
  credential_rotated_at: string | null;
  secret_param_arn: string | null;
  ec2_instance_id: string | null;
  aws_region: string | null;
  revoked_at: string | null;
  runtime_kind: RuntimeKind;
  sandbox_id: string | null;
  presence: InstancePresence;
  agent_snapshot_id: string | null;
  s3_vault_prefix: string | null;
  last_activity_at: string | null;
  chat_delivery: ChatDelivery | null;
}> {
  const row = await db.get<{
    instance_id: string;
    tenant_id: string;
    label: string | null;
    last_seen_at: string | null;
    health_status: string;
    credential_rotated_at: string | null;
    secret_param_arn: string | null;
    ec2_instance_id: string | null;
    aws_region: string | null;
    revoked_at: string | null;
    runtime_kind: string | null;
    sandbox_id: string | null;
    presence: string | null;
    agent_snapshot_id: string | null;
    s3_vault_prefix: string | null;
    last_activity_at: string | null;
    chat_delivery: string | null;
  }>(
    `SELECT instance_id, tenant_id, label, last_seen_at, health_status,
            credential_rotated_at, secret_param_arn, ec2_instance_id,
            aws_region, revoked_at,
            runtime_kind, sandbox_id, presence, agent_snapshot_id, s3_vault_prefix,
            last_activity_at, chat_delivery
     FROM gateway_instances WHERE instance_id = ?`,
    [input.instance_id],
  );

  if (!row || row.tenant_id !== input.tenant_id) {
    throw new CrossTenantResourceRefError(
      "instance_id not found for this tenant",
    );
  }

  const health_status =
    input.health_status !== undefined
      ? parseHealthStatus(input.health_status)
      : (row.health_status as InstanceHealthStatus);
  const secret_param_arn =
    input.secret_param_arn !== undefined
      ? normalizeSecretArn(input.secret_param_arn)
      : row.secret_param_arn;
  const ec2_instance_id =
    input.ec2_instance_id !== undefined
      ? normalizeEc2InstanceId(input.ec2_instance_id)
      : row.ec2_instance_id;
  const runtime_kind =
    input.runtime_kind !== undefined && input.runtime_kind !== null
      ? parseRuntimeKind(input.runtime_kind)
      : row.runtime_kind &&
          (RUNTIME_KINDS as readonly string[]).includes(row.runtime_kind)
        ? (row.runtime_kind as RuntimeKind)
        : ("ec2" as RuntimeKind);
  const presence =
    input.presence !== undefined && input.presence !== null
      ? parseInstancePresence(input.presence)
      : row.presence &&
          (INSTANCE_PRESENCE_STATES as readonly string[]).includes(row.presence)
        ? (row.presence as InstancePresence)
        : ("offline" as InstancePresence);
  const sandbox_id =
    input.sandbox_id !== undefined
      ? normalizeOptionalOpaqueString(input.sandbox_id, "sandbox_id", 256)
      : row.sandbox_id;
  const agent_snapshot_id =
    input.agent_snapshot_id !== undefined
      ? normalizeOptionalOpaqueString(
          input.agent_snapshot_id,
          "agent_snapshot_id",
          256,
        )
      : row.agent_snapshot_id;
  const s3_vault_prefix =
    input.s3_vault_prefix !== undefined
      ? normalizeS3VaultPrefixForRegistryUpdate(
          input.s3_vault_prefix,
          input.tenant_id,
        )
      : row.s3_vault_prefix;
  const last_activity_at =
    input.last_activity_at !== undefined
      ? input.last_activity_at
      : (row.last_activity_at ?? null);
  const label = input.label !== undefined ? input.label : row.label;
  const last_seen_at =
    input.last_seen_at !== undefined ? input.last_seen_at : row.last_seen_at;
  const aws_region =
    input.aws_region !== undefined ? input.aws_region : row.aws_region;
  const chat_delivery =
    input.chat_delivery !== undefined
      ? input.chat_delivery === null || input.chat_delivery === ""
        ? null
        : parseChatDelivery(input.chat_delivery)
      : row.chat_delivery &&
          (CHAT_DELIVERIES as readonly string[]).includes(row.chat_delivery)
        ? (row.chat_delivery as ChatDelivery)
        : null;

  await db.run(
    `UPDATE gateway_instances SET
       label = ?,
       last_seen_at = ?,
       health_status = ?,
       secret_param_arn = ?,
       ec2_instance_id = ?,
       aws_region = ?,
       runtime_kind = ?,
       sandbox_id = ?,
       presence = ?,
       agent_snapshot_id = ?,
       s3_vault_prefix = ?,
       last_activity_at = ?,
       chat_delivery = ?
     WHERE instance_id = ? AND tenant_id = ?`,
    [
      label,
      last_seen_at,
      health_status,
      secret_param_arn,
      ec2_instance_id,
      aws_region,
      runtime_kind,
      sandbox_id,
      presence,
      agent_snapshot_id,
      s3_vault_prefix,
      last_activity_at,
      chat_delivery,
      input.instance_id,
      input.tenant_id,
    ],
  );

  await recordAudit({
    tenant_id: input.tenant_id,
    action: "instance.registry_updated",
    actor: input.actor ?? null,
    result: "success",
    request_id: input.request_id ?? null,
    instance_id: input.instance_id,
    metadata: {
      instance_id: input.instance_id,
      health_status,
      last_seen_at,
      secret_param_arn,
      ec2_instance_id,
      aws_region,
      runtime_kind,
      sandbox_id,
      presence,
      agent_snapshot_id,
      s3_vault_prefix,
      last_activity_at,
      chat_delivery,
    },
  });

  return {
    instance_id: input.instance_id,
    tenant_id: input.tenant_id,
    label,
    last_seen_at,
    health_status,
    credential_rotated_at: row.credential_rotated_at,
    secret_param_arn,
    ec2_instance_id,
    aws_region,
    revoked_at: row.revoked_at,
    runtime_kind,
    sandbox_id,
    presence,
    agent_snapshot_id,
    s3_vault_prefix,
    last_activity_at,
    chat_delivery,
  };
}
