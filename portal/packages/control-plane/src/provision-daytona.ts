/**
 * Daytona tenant provision path (lp-6jx / plan §4.11).
 *
 * CP-first durable register only:
 * - Mint instance_id + secret (via store)
 * - Set runtime_kind=daytona
 * - Assign durable s3_vault_prefix
 * - presence=offline, sandbox_id=null (lazy compute on ensure_online)
 * - No EC2 id, no Terraform, no Daytona create/start at provision
 *
 * Tenants never receive Daytona API keys. Agent compute is Orchestrator→Daytona
 * on demand (Phase 6 wake path / ensure_online).
 *
 * Design: docs/plans/0008-daytona-agent-sandboxes/provision-runbook-daytona.md
 * overview.md §4.11
 */

import {
  isValidAgentSnapshotPinShape,
  AGENT_SNAPSHOT_ID_MAX_LENGTH,
} from "./daytona-config.js";
import {
  assertS3VaultPrefixBoundToTenant,
  assignS3VaultPrefixForProvision,
  buildS3VaultPrefix,
  InvalidS3VaultPrefixError,
  InvalidTenantIdForVaultPrefixError,
  VaultPrefixError,
} from "./vault-prefix.js";
import type {
  InstancePresence,
  RuntimeKind,
} from "./types.js";
import { RUNTIME_KINDS } from "./types.js";

export class InvalidProvisionInputError extends Error {
  readonly code = "INVALID_PROVISION_INPUT";

  constructor(message: string) {
    super(message);
    this.name = "InvalidProvisionInputError";
  }
}

/**
 * Pure fields written onto `gateway_instances` at register/provision time.
 * No network, no Daytona SDK, no AWS — safe for unit tests.
 */
export type GatewayInstanceProvisionFields = {
  runtime_kind: RuntimeKind;
  /** Always null at provision — lazy sandbox on ensure_online for daytona. */
  sandbox_id: null;
  /** offline until first successful wake (daytona) or host reports (ec2). */
  presence: InstancePresence;
  agent_snapshot_id: string | null;
  /**
   * Durable S3 vault root for daytona; null for pure EC2 host-disk vault.
   * Never derived from sandbox_id.
   */
  s3_vault_prefix: string | null;
  /**
   * Always null at provision for daytona (§4.11 — no company-brain EC2).
   * EC2 path also leaves this null until registry update after TF apply.
   */
  ec2_instance_id: null;
};

export type BuildProvisionFieldsInput = {
  tenantId: string;
  /** Default `ec2` preserves existing tenants / deploy tooling. */
  runtimeKind?: RuntimeKind | string | null;
  /** Optional pin override; null/omit → inherit platform default at wake. */
  agentSnapshotId?: string | null;
  /**
   * Optional override of the durable prefix. When omitted and runtime is
   * daytona, assigns `tenants/{tenant_id}/vault/`. Rejected when empty string
   * is passed for daytona (must be a real prefix). Ignored for ec2 (always null).
   */
  s3VaultPrefix?: string | null;
};

/**
 * Parse runtime_kind for provision. Empty/undefined → `ec2` (product default).
 * Unknown values throw (do not silently coerce — operators must pass a valid kind).
 */
export function parseProvisionRuntimeKind(
  value: string | null | undefined,
): RuntimeKind {
  if (value === undefined || value === null || value === "") {
    return "ec2";
  }
  const trimmed = value.trim();
  if ((RUNTIME_KINDS as readonly string[]).includes(trimmed)) {
    return trimmed as RuntimeKind;
  }
  throw new InvalidProvisionInputError(
    `runtime_kind must be one of: ${RUNTIME_KINDS.join(", ")}`,
  );
}

function normalizeAgentSnapshotId(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const trimmed = value.trim();
  if (!isValidAgentSnapshotPinShape(trimmed)) {
    throw new InvalidProvisionInputError(
      `agent_snapshot_id must be a non-empty single-line pin (max ${AGENT_SNAPSHOT_ID_MAX_LENGTH} chars)`,
    );
  }
  return trimmed;
}

/**
 * Normalize optional operator override and **bind to tenant_id** (lp-3a1.1).
 * Foreign-tenant prefixes and non-layout shapes are rejected.
 */
function normalizeOptionalS3VaultPrefix(
  value: string | null | undefined,
  field: string,
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
    throw new InvalidProvisionInputError(
      `${field} must be at most 1024 characters when set`,
    );
  }
  try {
    // Trailing slash + shape + tenant segment (default or multi-instance form).
    return assertS3VaultPrefixBoundToTenant(trimmed, tenantId);
  } catch (err) {
    if (
      err instanceof InvalidS3VaultPrefixError ||
      err instanceof InvalidTenantIdForVaultPrefixError ||
      err instanceof VaultPrefixError
    ) {
      throw new InvalidProvisionInputError(`${field}: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Resolve dual-run fields for a new gateway instance row.
 *
 * Daytona (lp-6jx / §4.11):
 * - runtime_kind=daytona
 * - s3_vault_prefix assigned (default layout or override)
 * - sandbox_id=null (lazy; not created at provision)
 * - presence=offline
 * - ec2_instance_id=null (no TF EC2)
 *
 * EC2 (default / unchanged):
 * - runtime_kind=ec2
 * - s3_vault_prefix=null
 * - sandbox_id=null
 * - presence=offline
 */
export function buildGatewayInstanceProvisionFields(
  input: BuildProvisionFieldsInput,
): GatewayInstanceProvisionFields {
  const runtime_kind = parseProvisionRuntimeKind(input.runtimeKind);
  const agent_snapshot_id = normalizeAgentSnapshotId(input.agentSnapshotId);

  if (runtime_kind === "daytona") {
    let s3_vault_prefix: string | null;
    if (input.s3VaultPrefix !== undefined && input.s3VaultPrefix !== null) {
      s3_vault_prefix = normalizeOptionalS3VaultPrefix(
        input.s3VaultPrefix,
        "s3_vault_prefix",
        input.tenantId,
      );
      if (!s3_vault_prefix) {
        throw new InvalidProvisionInputError(
          "s3_vault_prefix is required for runtime_kind=daytona (pass a prefix or omit for default)",
        );
      }
    } else {
      s3_vault_prefix = assignS3VaultPrefixForProvision(
        input.tenantId,
        "daytona",
      );
      // assignS3VaultPrefixForProvision always returns non-null for daytona
      // after valid tenant id; buildS3VaultPrefix throws on bad tenant id.
      if (!s3_vault_prefix) {
        s3_vault_prefix = buildS3VaultPrefix(input.tenantId);
      }
    }

    return {
      runtime_kind: "daytona",
      sandbox_id: null,
      presence: "offline",
      agent_snapshot_id,
      s3_vault_prefix,
      ec2_instance_id: null,
    };
  }

  // EC2 path — host-disk vault; no S3 prefix at register.
  if (
    input.s3VaultPrefix !== undefined &&
    input.s3VaultPrefix !== null &&
    String(input.s3VaultPrefix).trim() !== ""
  ) {
    throw new InvalidProvisionInputError(
      "s3_vault_prefix is only valid for runtime_kind=daytona",
    );
  }

  return {
    runtime_kind: "ec2",
    sandbox_id: null,
    presence: "offline",
    agent_snapshot_id,
    s3_vault_prefix: null,
    ec2_instance_id: null,
  };
}

/**
 * Dedicated Daytona product path helper (lp-6jx).
 * Forces runtime_kind=daytona and applies §4.11 field rules.
 * Does **not** call Daytona create, AWS, or Terraform.
 */
export function buildDaytonaProvisionFields(input: {
  tenantId: string;
  agentSnapshotId?: string | null;
  s3VaultPrefix?: string | null;
}): GatewayInstanceProvisionFields {
  return buildGatewayInstanceProvisionFields({
    tenantId: input.tenantId,
    runtimeKind: "daytona",
    agentSnapshotId: input.agentSnapshotId,
    s3VaultPrefix: input.s3VaultPrefix,
  });
}

/** True when provision fields match lazy-compute daytona posture. */
export function isLazyDaytonaProvision(
  fields: GatewayInstanceProvisionFields,
): boolean {
  return (
    fields.runtime_kind === "daytona" &&
    fields.sandbox_id === null &&
    fields.presence === "offline" &&
    fields.ec2_instance_id === null &&
    typeof fields.s3_vault_prefix === "string" &&
    fields.s3_vault_prefix.length > 0
  );
}
