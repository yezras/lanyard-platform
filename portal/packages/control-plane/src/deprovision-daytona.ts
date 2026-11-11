/**
 * Daytona instance / tenant deprovision (lp-e96 / plan §4.11).
 *
 * Full teardown for `runtime_kind=daytona` instances:
 *   1. Archive (destroy) sandbox when `sandbox_id` is set (real harness / SDK)
 *   2. Revoke gateway secret (CP SoT) — WS/credentials refuse re-connect (4401)
 *   3. Clear `sandbox_id`, presence → offline
 *   4. Drop optional wake-inject material store entry (lp-9my port)
 *   5. Vault S3: **retain by default** (lp-zmg); optional GC is gated and
 *      never runs from the happy-path deprovision handler
 *
 * EC2 instances: secret revoke only (no Daytona, no vault GC). Sandbox clear
 * is a no-op when `sandbox_id` is null.
 *
 * Design:
 *   docs/plans/0008-daytona-agent-sandboxes/vault-s3-retain-vs-gc.md
 *   docs/plans/0008-daytona-agent-sandboxes/provision-runbook-daytona.md §7
 *   docs/plans/0008-daytona-agent-sandboxes/overview.md §4.11
 */

import {
  DaytonaSandboxNotFoundError,
  type DaytonaClient,
} from "./daytona-client.js";
import type { OrchestratorInstanceStore } from "./instance-orchestrator.js";
import { applyPresenceReason, type InstancePresence } from "./presence.js";
import type { RuntimeKind } from "./types.js";

/** Pilot default — never auto-delete vault bytes on deprovision. */
export const DEFAULT_VAULT_DEPROVISION_GC_MODE = "retain" as const;

/**
 * Vault GC mode (lp-zmg / lp-e96).
 * - `retain` (default): leave S3 objects under s3_vault_prefix
 * - `delete_after_hold`: require hold cleared + explicit run
 * - `delete_immediate`: require explicit confirm + no hold
 */
export const VAULT_DEPROVISION_GC_MODES = [
  "retain",
  "delete_after_hold",
  "delete_immediate",
] as const;

export type VaultDeprovisionGcMode = (typeof VAULT_DEPROVISION_GC_MODES)[number];

/** Env: platform vault GC mode. Default retain when unset/invalid. */
export const VAULT_DEPROVISION_GC_MODE_ENV = "VAULT_DEPROVISION_GC_MODE";

export class InvalidVaultDeprovisionGcModeError extends Error {
  readonly code = "INVALID_VAULT_DEPROVISION_GC_MODE";

  constructor(value: string) {
    super(
      `vault deprovision_gc_mode must be one of: ${VAULT_DEPROVISION_GC_MODES.join(", ")} (got ${JSON.stringify(value)})`,
    );
    this.name = "InvalidVaultDeprovisionGcModeError";
  }
}

/**
 * Parse GC mode. Empty/undefined → retain. Unknown throws when `strict`;
 * otherwise falls back to retain (pilot-safe).
 */
export function parseVaultDeprovisionGcMode(
  value: string | null | undefined,
  options?: { strict?: boolean },
): VaultDeprovisionGcMode {
  if (value === undefined || value === null || value.trim() === "") {
    return DEFAULT_VAULT_DEPROVISION_GC_MODE;
  }
  const trimmed = value.trim().toLowerCase();
  if ((VAULT_DEPROVISION_GC_MODES as readonly string[]).includes(trimmed)) {
    return trimmed as VaultDeprovisionGcMode;
  }
  if (options?.strict) {
    throw new InvalidVaultDeprovisionGcModeError(value);
  }
  return DEFAULT_VAULT_DEPROVISION_GC_MODE;
}

/** Resolve mode from process env (pilot-safe default retain). */
export function resolveVaultDeprovisionGcMode(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): VaultDeprovisionGcMode {
  return parseVaultDeprovisionGcMode(env[VAULT_DEPROVISION_GC_MODE_ENV]);
}

/**
 * S3 port for optional vault GC only. Separate from provision ensure
 * ({@link import("./vault-prefix.js").VaultObjectStore}) so product deprovision
 * does not require delete capability on the happy path.
 */
export type VaultGcObjectStore = {
  /** List object keys under prefix (inclusive). Empty prefix → empty list. */
  listKeysUnderPrefix(input: {
    bucket: string;
    prefix: string;
  }): Promise<string[]>;
  /** Delete one object. Missing key is success (idempotent). */
  deleteObject(input: { bucket: string; key: string }): Promise<void>;
};

/** Minimal secret material port (compatible with lp-9my InstanceSecretMaterialStore). */
export type SecretMaterialDeleter = {
  delete(instanceId: string): Promise<void>;
};

/** Instance snapshot needed for teardown (store or in-memory). */
export type DeprovisionInstanceSnapshot = {
  instance_id: string;
  tenant_id: string;
  runtime_kind: RuntimeKind | string | null;
  sandbox_id: string | null;
  presence: InstancePresence | string | null;
  s3_vault_prefix: string | null;
  revoked_at: string | null;
};

/** Credential / identity SoT used by deprovision (ControlPlaneStore shape). */
export type DeprovisionCredentialStore = {
  getInstance(
    instanceId: string,
  ): Promise<DeprovisionInstanceSnapshot | null>;
  revokeInstance(input: {
    tenant_id: string;
    instance_id: string;
    actor?: string;
  }): Promise<{
    tenant_id: string;
    instance_id: string;
    already_revoked: boolean;
    revoked_at: string;
  }>;
  listActiveInstances(
    tenantId: string,
  ): Promise<
    Array<{
      instance_id: string;
      runtime_kind?: RuntimeKind | string | null;
      sandbox_id?: string | null;
      s3_vault_prefix?: string | null;
      presence?: InstancePresence | string | null;
    }>
  >;
  deprovisionTenant(input: {
    tenant_id: string;
    actor?: string;
  }): Promise<{
    tenant_id: string;
    revoked_instance_count: number;
    revoked_instance_ids: string[];
  }>;
};

export type DeprovisionDaytonaDeps = {
  /** CP identity + secret revoke (hashes). */
  store: DeprovisionCredentialStore;
  /**
   * Presence / sandbox_id store. When set, clears binding after archive
   * (in-memory orch store or SQL via store.asOrchestratorInstanceStore).
   */
  instances?: OrchestratorInstanceStore | null;
  /** Daytona client for archive/stop. Null = skip compute teardown. */
  daytona?: DaytonaClient | null;
  /**
   * Optional plaintext material store (wake inject). Revoke deletes entry
   * so a later cold wake cannot re-inject a revoked secret (lp-9my).
   */
  secretMaterial?: SecretMaterialDeleter | null;
  /**
   * Optional vault object store for **explicit** GC only.
   * Happy-path deprovision never deletes S3 when mode is retain.
   */
  vaultGcStore?: VaultGcObjectStore | null;
  /** Shared vault bucket name (required when GC runs). */
  vaultBucket?: string | null;
  /**
   * Platform GC mode. Default retain. Deprovision happy path ignores
   * non-retain unless `runVaultGc: true` is passed (gated).
   */
  vaultGcMode?: VaultDeprovisionGcMode;
  now?: () => Date;
};

export type DeprovisionDaytonaInstanceInput = {
  tenantId: string;
  instanceId: string;
  actor?: string;
  /**
   * When true **and** vaultGcMode ≠ retain **and** gates pass, run optional
   * vault GC. Happy-path app routes leave this false (pilot).
   */
  runVaultGc?: boolean;
  /** Legal/operator hold cleared — required for any delete mode. */
  vaultGcHoldCleared?: boolean;
  /** Human confirmation for delete_immediate. */
  vaultGcConfirm?: boolean;
};

export type DeprovisionDaytonaInstanceResult = {
  tenant_id: string;
  instance_id: string;
  already_revoked: boolean;
  revoked_at: string;
  runtime_kind: RuntimeKind | string | null;
  sandbox_id_before: string | null;
  /** True when archive/stop was attempted and sandbox is gone or was null. */
  sandbox_stopped: boolean;
  presence: InstancePresence;
  s3_vault_prefix: string | null;
  vault_gc_mode: VaultDeprovisionGcMode;
  /** Objects deleted under prefix; always 0 when retain / GC not run. */
  vault_gc_deleted_count: number;
  vault_gc_skipped_reason: string | null;
  material_deleted: boolean;
  relay_close_code: 4401;
};

export type DeprovisionDaytonaTenantInput = {
  tenantId: string;
  actor?: string;
  runVaultGc?: boolean;
  vaultGcHoldCleared?: boolean;
  vaultGcConfirm?: boolean;
};

export type DeprovisionDaytonaTenantResult = {
  tenant_id: string;
  revoked_instance_count: number;
  revoked_instance_ids: string[];
  instances: DeprovisionDaytonaInstanceResult[];
  vault_gc_mode: VaultDeprovisionGcMode;
  vault_gc_deleted_count: number;
  relay_close_code: 4401;
};

export type PurgeVaultPrefixInput = {
  bucket: string;
  /** Exact stored s3_vault_prefix (must be under tenants/). */
  prefix: string;
  mode: VaultDeprovisionGcMode;
  holdCleared?: boolean;
  confirm?: boolean;
  tenantId?: string;
};

export type PurgeVaultPrefixResult = {
  deleted_count: number;
  skipped: boolean;
  skipped_reason: string | null;
  prefix: string;
  mode: VaultDeprovisionGcMode;
};

/**
 * Normalize vault prefix for GC scope checks.
 * Rejects empty, root, or paths that escape `tenants/`.
 */
export function assertSafeVaultGcPrefix(prefix: string): string {
  const raw = prefix?.trim() ?? "";
  if (!raw) {
    throw new Error("vault GC prefix is required");
  }
  const normalized = raw.endsWith("/") ? raw : `${raw}/`;
  if (normalized.startsWith("/") || normalized.includes("..")) {
    throw new Error("vault GC prefix must be a relative key prefix without ..");
  }
  if (!normalized.startsWith("tenants/")) {
    throw new Error("vault GC prefix must start with tenants/");
  }
  // Forbid wiping entire tenants/ tree
  if (normalized === "tenants/" || normalized === "tenants") {
    throw new Error("vault GC prefix must target a single tenant subtree");
  }
  return normalized;
}

/**
 * Optional vault GC (lp-zmg). **Not** the pilot default.
 * Gates: mode ≠ retain, hold cleared, confirm for delete_immediate,
 * prefix scope check. Idempotent: empty prefix → success with 0 deletes.
 */
export async function purgeVaultPrefix(
  store: VaultGcObjectStore,
  input: PurgeVaultPrefixInput,
): Promise<PurgeVaultPrefixResult> {
  const mode = input.mode;
  const prefix = assertSafeVaultGcPrefix(input.prefix);

  if (mode === "retain") {
    return {
      deleted_count: 0,
      skipped: true,
      skipped_reason: "retain",
      prefix,
      mode,
    };
  }

  if (!input.holdCleared) {
    return {
      deleted_count: 0,
      skipped: true,
      skipped_reason: "hold_not_cleared",
      prefix,
      mode,
    };
  }

  if (mode === "delete_immediate" && !input.confirm) {
    return {
      deleted_count: 0,
      skipped: true,
      skipped_reason: "confirm_required",
      prefix,
      mode,
    };
  }

  // delete_after_hold: holdCleared is the gate; no separate sweeper here.
  const keys = await store.listKeysUnderPrefix({
    bucket: input.bucket,
    prefix,
  });
  let deleted = 0;
  for (const key of keys) {
    // Defense in depth: never delete outside the exact prefix.
    if (!key.startsWith(prefix) && key + "/" !== prefix) {
      continue;
    }
    await store.deleteObject({ bucket: input.bucket, key });
    deleted += 1;
  }

  return {
    deleted_count: deleted,
    skipped: false,
    skipped_reason: null,
    prefix,
    mode,
  };
}

async function archiveSandboxBestEffort(
  daytona: DaytonaClient | null | undefined,
  sandboxId: string | null | undefined,
): Promise<boolean> {
  const id = sandboxId?.trim();
  if (!id || !daytona) {
    return false;
  }
  try {
    await daytona.archive(id);
    return true;
  } catch (err) {
    if (err instanceof DaytonaSandboxNotFoundError) {
      return true; // already gone
    }
    // Fallback: try stop then archive (some states)
    try {
      await daytona.stop(id);
    } catch {
      // ignore
    }
    try {
      await daytona.archive(id);
      return true;
    } catch (err2) {
      if (err2 instanceof DaytonaSandboxNotFoundError) {
        return true;
      }
      // Still clear CP binding; operator can GC orphan sandbox separately.
      return false;
    }
  }
}

async function clearPresenceAndSandbox(
  instances: OrchestratorInstanceStore | null | undefined,
  instanceId: string,
  presenceBefore: InstancePresence | string | null,
): Promise<InstancePresence> {
  const from =
    presenceBefore === "online" ||
    presenceBefore === "waking" ||
    presenceBefore === "error" ||
    presenceBefore === "offline"
      ? (presenceBefore as InstancePresence)
      : "offline";
  const next = applyPresenceReason(from, "explicit_stop");
  if (!instances) {
    return next;
  }
  try {
    await instances.update(instanceId, {
      presence: next,
      sandbox_id: null,
      mid_turn: false,
      mid_turn_until: null,
    });
  } catch {
    // Instance may already be revoked / missing from orch store; CP store owns truth.
  }
  return next;
}

async function deleteMaterialBestEffort(
  material: SecretMaterialDeleter | null | undefined,
  instanceId: string,
): Promise<boolean> {
  if (!material) return false;
  try {
    await material.delete(instanceId);
    return true;
  } catch {
    return false;
  }
}

async function maybeRunVaultGc(
  deps: DeprovisionDaytonaDeps,
  input: {
    runVaultGc?: boolean;
    holdCleared?: boolean;
    confirm?: boolean;
    prefix: string | null;
  },
): Promise<{ deleted: number; skipped_reason: string | null; mode: VaultDeprovisionGcMode }> {
  const mode = deps.vaultGcMode ?? DEFAULT_VAULT_DEPROVISION_GC_MODE;
  if (!input.runVaultGc) {
    return { deleted: 0, skipped_reason: "not_requested", mode };
  }
  if (mode === "retain") {
    return { deleted: 0, skipped_reason: "retain", mode };
  }
  if (!deps.vaultGcStore || !deps.vaultBucket?.trim()) {
    return { deleted: 0, skipped_reason: "vault_store_unavailable", mode };
  }
  if (!input.prefix?.trim()) {
    return { deleted: 0, skipped_reason: "no_prefix", mode };
  }
  const result = await purgeVaultPrefix(deps.vaultGcStore, {
    bucket: deps.vaultBucket.trim(),
    prefix: input.prefix,
    mode,
    holdCleared: input.holdCleared === true,
    confirm: input.confirm === true,
  });
  return {
    deleted: result.deleted_count,
    skipped_reason: result.skipped_reason,
    mode,
  };
}

/**
 * Full teardown for one instance (daytona or ec2).
 * Always revokes secret; archives sandbox when bound; retains vault by default.
 */
export async function deprovisionDaytonaInstance(
  deps: DeprovisionDaytonaDeps,
  input: DeprovisionDaytonaInstanceInput,
): Promise<DeprovisionDaytonaInstanceResult> {
  const tenantId = input.tenantId.trim();
  const instanceId = input.instanceId.trim();
  if (!tenantId || !instanceId) {
    throw new Error("tenantId and instanceId are required");
  }

  // Pre-load for sandbox_id / prefix teardown. store.revokeInstance enforces
  // tenant match + not-found (throws InstanceNotFoundError / TenantNotFoundError).
  const before = await deps.store.getInstance(instanceId);
  const sandboxIdBefore = before?.sandbox_id ?? null;
  const runtimeKind = before?.runtime_kind ?? null;
  const prefix = before?.s3_vault_prefix ?? null;
  const presenceBefore = before?.presence ?? "offline";

  // 1) Destroy ephemeral compute first (while sandbox_id still known).
  let sandboxStopped = false;
  if (sandboxIdBefore && runtimeKind === "daytona") {
    sandboxStopped = await archiveSandboxBestEffort(deps.daytona, sandboxIdBefore);
  } else if (!sandboxIdBefore) {
    // Lazy provision / already stopped — treat as clean.
    sandboxStopped = true;
  }

  // 2) Clear presence + sandbox binding (orch store / dual-write).
  const presence = await clearPresenceAndSandbox(
    deps.instances,
    instanceId,
    presenceBefore,
  );

  // 3) Revoke credential SoT (sets revoked_at; store also clears sandbox/presence).
  const revoked = await deps.store.revokeInstance({
    tenant_id: tenantId,
    instance_id: instanceId,
    actor: input.actor,
  });

  // 4) Drop wake-inject material (lp-9my); safe no-op when store not injected.
  const materialDeleted = await deleteMaterialBestEffort(
    deps.secretMaterial,
    instanceId,
  );

  // 5) Optional vault GC — never default.
  const gc = await maybeRunVaultGc(deps, {
    runVaultGc: input.runVaultGc,
    holdCleared: input.vaultGcHoldCleared,
    confirm: input.vaultGcConfirm,
    prefix,
  });

  return {
    tenant_id: tenantId,
    instance_id: instanceId,
    already_revoked: revoked.already_revoked,
    revoked_at: revoked.revoked_at,
    runtime_kind: runtimeKind,
    sandbox_id_before: sandboxIdBefore,
    sandbox_stopped: sandboxStopped,
    presence,
    s3_vault_prefix: prefix,
    vault_gc_mode: gc.mode,
    vault_gc_deleted_count: gc.deleted,
    vault_gc_skipped_reason: gc.skipped_reason,
    material_deleted: materialDeleted,
    relay_close_code: 4401,
  };
}

/**
 * Tenant offboard: archive all active sandboxes, revoke all secrets,
 * clear presence, optional per-prefix GC (gated). Vault retain by default.
 */
export async function deprovisionDaytonaTenant(
  deps: DeprovisionDaytonaDeps,
  input: DeprovisionDaytonaTenantInput,
): Promise<DeprovisionDaytonaTenantResult> {
  const tenantId = input.tenantId.trim();
  if (!tenantId) {
    throw new Error("tenantId is required");
  }

  const active = await deps.store.listActiveInstances(tenantId);
  const perInstance: DeprovisionDaytonaInstanceResult[] = [];
  let vaultGcDeleted = 0;
  const mode = deps.vaultGcMode ?? DEFAULT_VAULT_DEPROVISION_GC_MODE;

  // Capture sandbox ids before bulk revoke clears them.
  for (const row of active) {
    const snap: DeprovisionInstanceSnapshot = {
      instance_id: row.instance_id,
      tenant_id: tenantId,
      runtime_kind: row.runtime_kind ?? null,
      sandbox_id: row.sandbox_id ?? null,
      presence: row.presence ?? "offline",
      s3_vault_prefix: row.s3_vault_prefix ?? null,
      revoked_at: null,
    };

    if (snap.sandbox_id && snap.runtime_kind === "daytona") {
      await archiveSandboxBestEffort(deps.daytona, snap.sandbox_id);
    }
    await clearPresenceAndSandbox(
      deps.instances,
      snap.instance_id,
      snap.presence,
    );
    await deleteMaterialBestEffort(deps.secretMaterial, snap.instance_id);
  }

  const bulk = await deps.store.deprovisionTenant({
    tenant_id: tenantId,
    actor: input.actor,
  });

  // Material + optional GC after identity offboard (gate: revoked).
  for (const row of active) {
    const prefix = row.s3_vault_prefix ?? null;
    const gc = await maybeRunVaultGc(deps, {
      runVaultGc: input.runVaultGc,
      holdCleared: input.vaultGcHoldCleared,
      confirm: input.vaultGcConfirm,
      prefix,
    });
    vaultGcDeleted += gc.deleted;

    perInstance.push({
      tenant_id: tenantId,
      instance_id: row.instance_id,
      already_revoked: false,
      revoked_at: new Date().toISOString(),
      runtime_kind: row.runtime_kind ?? null,
      sandbox_id_before: row.sandbox_id ?? null,
      sandbox_stopped: true,
      presence: "offline",
      s3_vault_prefix: prefix,
      vault_gc_mode: gc.mode,
      vault_gc_deleted_count: gc.deleted,
      vault_gc_skipped_reason: gc.skipped_reason,
      material_deleted: deps.secretMaterial != null,
      relay_close_code: 4401,
    });
  }

  // Also drop material for any id reported by bulk that was not in active snapshot.
  for (const id of bulk.revoked_instance_ids) {
    if (!active.some((r) => r.instance_id === id)) {
      await deleteMaterialBestEffort(deps.secretMaterial, id);
    }
  }

  return {
    tenant_id: bulk.tenant_id,
    revoked_instance_count: bulk.revoked_instance_count,
    revoked_instance_ids: bulk.revoked_instance_ids,
    instances: perInstance,
    vault_gc_mode: mode,
    vault_gc_deleted_count: vaultGcDeleted,
    relay_close_code: 4401,
  };
}
