/**
 * Idempotent tenant S3 vault prefix ensure (lp-jt5).
 *
 * At provision for `runtime_kind=daytona`, assign durable
 * `s3_vault_prefix = tenants/{tenant_id}/vault/` and create a platform-only
 * marker object so the prefix is inventoryable. Does **not** seed client-core
 * content (that is `lp-9o6`).
 *
 * Layout: docs/plans/0008-daytona-agent-sandboxes/s3-vault-prefix-layout.md
 *
 * Real AWS is injected via {@link VaultObjectStore}; unit tests use
 * {@link import("./fake-s3-object-store.js").FakeS3ObjectStore}. This module
 * has no @aws-sdk import. Live S3 is
 * {@link import("./s3-vault-object-store.js").S3VaultObjectStore} (lp-oop.37.1).
 * No @aws-sdk in BFF — CP is the only S3 caller.
 */

import type { RuntimeKind } from "./types.js";

/** Relative key under the tenant for the ensure marker (never on guest mount). */
export const VAULT_PREFIX_PLATFORM_MARKER_REL =
  "_platform/vault-prefix-ensured.json" as const;

/** Marker schema version written into the JSON body. */
export const VAULT_PREFIX_MARKER_VERSION = 1 as const;

/** One object from {@link VaultObjectStore.listPrefix} (S3 key, not vault UI path). */
export type VaultObjectListEntry = {
  key: string;
  size_bytes: number;
  etag?: string;
  mtime?: string;
};

/** Input for {@link VaultObjectStore.listPrefix} (ListObjectsV2-style). */
export type VaultObjectListInput = {
  bucket: string;
  prefix: string;
  /** Opaque page token from a previous {@link VaultObjectListPage.next_cursor}. */
  cursor?: string;
  /** Page size hint (implementation may cap). */
  maxKeys?: number;
  /** Optional delimiter (typically "/") so common prefixes act as directories. */
  delimiter?: string;
};

/** Page of prefix list results for the vault UI plane (plan 0015 / lp-oop.4). */
export type VaultObjectListPage = {
  prefix: string;
  objects: VaultObjectListEntry[];
  /** Present when `delimiter` is set (S3 common prefixes). */
  common_prefixes?: string[];
  next_cursor?: string;
  truncated: boolean;
};

/** Successful {@link VaultObjectStore.getObject} (missing keys use {@link VaultObjectGetMiss}). */
export type VaultObjectGetHit = {
  found: true;
  bucket: string;
  key: string;
  /** Object bytes as a string; matches {@link VaultObjectStore.putObject} today. */
  body: string;
  contentType: string;
  size_bytes: number;
  etag?: string;
  mtime?: string;
};

/** Typed miss for {@link VaultObjectStore.getObject}. Not-found is not an exception. */
export type VaultObjectGetMiss = {
  found: false;
  bucket: string;
  key: string;
};

export type VaultObjectGetResult = VaultObjectGetHit | VaultObjectGetMiss;

/**
 * Minimal S3 object port used by prefix ensure and the vault UI plane.
 * Implementations must not log secret credentials. No @aws-sdk in BFF —
 * CP is the only AWS S3 caller (plan 0015 Option B).
 *
 * `listPrefix` / `getObject` land as types in lp-oop.4. FakeS3 implements
 * them on the in-memory map (lp-oop.6). HTTP list/stat/get is lp-oop.9;
 * put/CAS is lp-zuh.12.7. Missing keys are a typed miss.
 */
export type VaultObjectStore = {
  /**
   * Return true if the object exists (HeadObject 200).
   * Return false on not-found. Propagate other errors.
   */
  headObject(input: { bucket: string; key: string }): Promise<boolean>;
  /**
   * Put object bytes. Callers pass full body; store must not interpret secrets.
   * Idempotent callers may put the same key twice with the same body.
   */
  putObject(input: {
    bucket: string;
    key: string;
    body: string;
    contentType?: string;
  }): Promise<void>;
  /**
   * List objects under `prefix` (paginated). Empty prefix lists the bucket.
   * Must not interpret object bodies or log credentials.
   */
  listPrefix(input: VaultObjectListInput): Promise<VaultObjectListPage>;
  /**
   * Return object bytes + metadata, or a typed miss when the key is absent.
   * Propagate unexpected store failures. Must not throw for not-found.
   */
  getObject(input: {
    bucket: string;
    key: string;
  }): Promise<VaultObjectGetResult>;
};

/**
 * Thrown by adapters that have not implemented list/get yet.
 * FakeS3 implements both on the in-memory map (lp-oop.6).
 */
export class VaultObjectStoreNotImplementedError extends Error {
  readonly code = "VAULT_OBJECT_STORE_NOT_IMPLEMENTED" as const;
  readonly operation: "listPrefix" | "getObject";

  constructor(operation: "listPrefix" | "getObject") {
    super(
      `VaultObjectStore.${operation} is not implemented (lp-oop.6)`,
    );
    this.name = "VaultObjectStoreNotImplementedError";
    this.operation = operation;
  }
}

export class VaultPrefixError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "VaultPrefixError";
    this.code = code;
  }
}

export class InvalidTenantIdForVaultPrefixError extends VaultPrefixError {
  constructor(reason: string) {
    super(
      "INVALID_TENANT_ID",
      `Invalid tenant_id for vault prefix: ${reason}`,
    );
    this.name = "InvalidTenantIdForVaultPrefixError";
  }
}

export class VaultPrefixRuntimeKindError extends VaultPrefixError {
  constructor(runtimeKind: string) {
    super(
      "RUNTIME_KIND_NOT_DAYTONA",
      `Vault prefix ensure requires runtime_kind=daytona (got ${runtimeKind})`,
    );
    this.name = "VaultPrefixRuntimeKindError";
  }
}

/**
 * Validate `tenant_id` as a single path segment for the vault layout.
 * Rejects empty, path separators, `..`, and whitespace-only values.
 */
export function assertValidTenantIdForVaultPrefix(tenantId: string): string {
  const id = tenantId?.trim() ?? "";
  if (!id) {
    throw new InvalidTenantIdForVaultPrefixError("empty");
  }
  if (id.includes("/") || id.includes("\\")) {
    throw new InvalidTenantIdForVaultPrefixError("must be a single path segment");
  }
  if (id === "." || id === ".." || id.includes("..")) {
    throw new InvalidTenantIdForVaultPrefixError("path traversal not allowed");
  }
  // Opaque CP ids (UUID / slug-like); disallow control chars and spaces.
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id)) {
    throw new InvalidTenantIdForVaultPrefixError(
      "must match opaque single-segment id (alnum start, max 128)",
    );
  }
  return id;
}

/**
 * Normative CP `s3_vault_prefix` for the default product path.
 * Always trailing slash. Not derived from sandbox_id.
 */
export function buildS3VaultPrefix(tenantId: string): string {
  const id = assertValidTenantIdForVaultPrefix(tenantId);
  return `tenants/${id}/vault/`;
}

/**
 * Optional multi-instance exception path (s3-vault-prefix-layout.md).
 * Always trailing slash. Not derived from sandbox_id.
 */
export function buildS3VaultPrefixForInstance(
  tenantId: string,
  instanceId: string,
): string {
  const tid = assertValidTenantIdForVaultPrefix(tenantId);
  // Same single-segment rules as tenant_id (opaque CP ids).
  const iid = assertValidTenantIdForVaultPrefix(instanceId);
  return `tenants/${tid}/instances/${iid}/vault/`;
}

/**
 * lp-zoh.2 / plan 0010: shared (team) vault prefix for a tenant.
 * Always trailing slash: `tenants/{tenant_id}/vault/shared/`.
 */
export function buildSharedVaultPrefix(tenantId: string): string {
  const id = assertValidTenantIdForVaultPrefix(tenantId);
  return `tenants/${id}/vault/shared/`;
}

/**
 * lp-zoh.2 / plan 0010: personal vault prefix for a user in a tenant.
 * Always trailing slash: `tenants/{tenant_id}/users/{user_id}/vault/`.
 * scope=user instances only — never assigned for tenant scope.
 */
export function buildPersonalVaultPrefix(
  tenantId: string,
  userId: string,
): string {
  const tid = assertValidTenantIdForVaultPrefix(tenantId);
  // Same single-segment rules as tenant_id (opaque CP ids).
  const uid = assertValidTenantIdForVaultPrefix(userId);
  return `tenants/${tid}/users/${uid}/vault/`;
}

export class InvalidS3VaultPrefixError extends VaultPrefixError {
  constructor(message: string) {
    super("INVALID_S3_VAULT_PREFIX", message);
    this.name = "InvalidS3VaultPrefixError";
  }
}

/**
 * Strip optional `s3://bucket/` URI shell to a relative key prefix.
 * Does not validate tenant binding — use {@link assertS3VaultPrefixBoundToTenant}.
 */
export function extractRelativeS3VaultPrefix(raw: string): string {
  const input = raw?.trim() ?? "";
  if (!input) {
    throw new InvalidS3VaultPrefixError("s3_vault_prefix is empty");
  }

  let prefix = input;
  if (prefix.startsWith("s3://")) {
    const withoutScheme = prefix.slice("s3://".length);
    const slash = withoutScheme.indexOf("/");
    if (slash <= 0) {
      throw new InvalidS3VaultPrefixError(
        "s3:// URI must include bucket and key prefix",
      );
    }
    prefix = withoutScheme.slice(slash + 1);
  }

  if (prefix.startsWith("/")) {
    throw new InvalidS3VaultPrefixError(
      "s3_vault_prefix must be a relative key prefix (not an absolute path)",
    );
  }
  if (prefix.includes("..")) {
    throw new InvalidS3VaultPrefixError(
      "s3_vault_prefix must not contain path traversal",
    );
  }
  if (!prefix.endsWith("/")) {
    prefix = `${prefix}/`;
  }
  return prefix;
}

/**
 * Defense-in-depth: bind CP `s3_vault_prefix` to `tenant_id`.
 *
 * Accepts normative shapes only (trailing slash on return):
 * - `tenants/{tenant_id}/vault/`
 * - `tenants/{tenant_id}/instances/{instance_id}/vault/` (multi-instance exception)
 *
 * Rejects foreign-tenant prefixes, wrong shapes, path traversal, empty values.
 * Accepts optional `s3://bucket/…` URI shell and returns the relative key form.
 *
 * Used on provision/update overrides and re-checked on ensure_online before
 * create env / mount inject (lp-3a1.1 / security-review residual §4.5 / §11).
 */
export function assertS3VaultPrefixBoundToTenant(
  rawPrefix: string,
  tenantId: string,
): string {
  const id = assertValidTenantIdForVaultPrefix(tenantId);
  const prefix = extractRelativeS3VaultPrefix(rawPrefix);

  const defaultPrefix = `tenants/${id}/vault/`;
  if (prefix === defaultPrefix) {
    return prefix;
  }

  const multiHead = `tenants/${id}/instances/`;
  const multiTail = "/vault/";
  if (prefix.startsWith(multiHead) && prefix.endsWith(multiTail)) {
    const instanceSeg = prefix.slice(
      multiHead.length,
      prefix.length - multiTail.length,
    );
    // Single segment only; reuse tenant id rules for opaque instance ids.
    if (instanceSeg && !instanceSeg.includes("/")) {
      try {
        assertValidTenantIdForVaultPrefix(instanceSeg);
        return prefix;
      } catch {
        // fall through to unified error
      }
    }
  }

  throw new InvalidS3VaultPrefixError(
    `s3_vault_prefix must be tenants/${id}/vault/ or tenants/${id}/instances/{instance_id}/vault/ (tenant segment must match register tenant_id)`,
  );
}

/**
 * lp-zoh.2 / plan 0010: exact-shape bind of `s3_shared_vault_prefix` to
 * `tenant_id`. Accepts only `tenants/{tenant_id}/vault/shared/` (trailing
 * slash required). Rejects foreign tenants, legacy `vault/` shapes, missing
 * trailing slash, traversal, and empty values. Fail closed.
 */
export function assertS3SharedVaultPrefixBoundToTenant(
  rawPrefix: string,
  tenantId: string,
): string {
  const id = assertValidTenantIdForVaultPrefix(tenantId);
  const prefix = rawPrefix?.trim() ?? "";
  if (!prefix) {
    throw new InvalidS3VaultPrefixError("s3_shared_vault_prefix is empty");
  }
  const expected = `tenants/${id}/vault/shared/`;
  if (prefix !== expected) {
    throw new InvalidS3VaultPrefixError(
      `s3_shared_vault_prefix must be ${expected} (exact shape, trailing slash required; tenant segment must match register tenant_id)`,
    );
  }
  return prefix;
}

/**
 * lp-zoh.2 / plan 0010: exact-shape bind of `s3_personal_vault_prefix` to
 * `(tenant_id, owner_user_id)`. Accepts only
 * `tenants/{tenant_id}/users/{user_id}/vault/` (trailing slash required).
 * Rejects foreign tenants/users, shared shapes, missing trailing slash,
 * traversal, and empty values. Fail closed.
 */
export function assertS3PersonalVaultPrefixBoundToTenantUser(
  rawPrefix: string,
  tenantId: string,
  userId: string,
): string {
  const tid = assertValidTenantIdForVaultPrefix(tenantId);
  // Same single-segment rules as tenant_id (opaque CP ids).
  const uid = assertValidTenantIdForVaultPrefix(userId);
  const prefix = rawPrefix?.trim() ?? "";
  if (!prefix) {
    throw new InvalidS3VaultPrefixError("s3_personal_vault_prefix is empty");
  }
  const expected = `tenants/${tid}/users/${uid}/vault/`;
  if (prefix !== expected) {
    throw new InvalidS3VaultPrefixError(
      `s3_personal_vault_prefix must be ${expected} (exact shape, trailing slash required; tenant/user segments must match register tenant_id/owner_user_id)`,
    );
  }
  return prefix;
}

/**
 * Platform-only marker key for a tenant (sibling of vault/, not mounted).
 * `tenants/{tenant_id}/_platform/vault-prefix-ensured.json`
 */
export function buildVaultPrefixMarkerKey(tenantId: string): string {
  const id = assertValidTenantIdForVaultPrefix(tenantId);
  return `tenants/${id}/${VAULT_PREFIX_PLATFORM_MARKER_REL}`;
}

export type EnsureTenantVaultPrefixInput = {
  /** Platform vault bucket name (no s3://). */
  bucket: string;
  tenantId: string;
  store: VaultObjectStore;
  /** Clock for marker `created_at` (ISO). Defaults to Date.now. */
  now?: () => Date;
};

export type EnsureTenantVaultPrefixResult = {
  bucket: string;
  tenantId: string;
  /** Normative CP field value. */
  s3_vault_prefix: string;
  /** Full object key of the platform ensure marker. */
  markerKey: string;
  /** True when this call wrote the marker; false when it already existed. */
  created: boolean;
};

function assertBucketName(bucket: string): string {
  const b = bucket?.trim() ?? "";
  if (!b) {
    throw new VaultPrefixError("INVALID_BUCKET", "bucket is required");
  }
  if (b.startsWith("s3://") || b.includes("/")) {
    throw new VaultPrefixError(
      "INVALID_BUCKET",
      "bucket must be a bare bucket name (no s3:// or key prefix)",
    );
  }
  return b;
}

/**
 * Idempotent ensure: if the platform marker is missing, write it.
 * Returns the durable `s3_vault_prefix` to persist on the instance row.
 *
 * Does not seed vault content (`lp-9o6`). Does not create the bucket (`lp-d26`).
 */
export async function ensureTenantVaultPrefix(
  input: EnsureTenantVaultPrefixInput,
): Promise<EnsureTenantVaultPrefixResult> {
  const bucket = assertBucketName(input.bucket);
  const tenantId = assertValidTenantIdForVaultPrefix(input.tenantId);
  const s3_vault_prefix = buildS3VaultPrefix(tenantId);
  const markerKey = buildVaultPrefixMarkerKey(tenantId);

  const exists = await input.store.headObject({ bucket, key: markerKey });
  if (exists) {
    return {
      bucket,
      tenantId,
      s3_vault_prefix,
      markerKey,
      created: false,
    };
  }

  const now = input.now ?? (() => new Date());
  const body = JSON.stringify({
    version: VAULT_PREFIX_MARKER_VERSION,
    s3_vault_prefix,
    tenant_id: tenantId,
    created_at: now().toISOString(),
  });

  await input.store.putObject({
    bucket,
    key: markerKey,
    body,
    contentType: "application/json",
  });

  return {
    bucket,
    tenantId,
    s3_vault_prefix,
    markerKey,
    created: true,
  };
}

export type EnsureVaultPrefixForDaytonaProvisionInput = {
  tenantId: string;
  /** Must be `daytona`; ec2 path has no S3 vault prefix ensure. */
  runtimeKind: RuntimeKind;
  bucket: string;
  store: VaultObjectStore;
  now?: () => Date;
};

/**
 * Provision-path entry point (lp-jt5).
 *
 * Call when registering/provisioning an instance with `runtime_kind=daytona`
 * (after tenant exists, before or after minting `instance_id`). Assigns the
 * durable prefix and ensures the empty-prefix marker object exists.
 *
 * Idempotent: re-running for the same tenant returns `created: false` and the
 * same `s3_vault_prefix` (safe on provision retries).
 */
export async function ensureVaultPrefixForDaytonaProvision(
  input: EnsureVaultPrefixForDaytonaProvisionInput,
): Promise<EnsureTenantVaultPrefixResult> {
  if (input.runtimeKind !== "daytona") {
    throw new VaultPrefixRuntimeKindError(String(input.runtimeKind));
  }
  return ensureTenantVaultPrefix({
    bucket: input.bucket,
    tenantId: input.tenantId,
    store: input.store,
    now: input.now,
  });
}

/**
 * Prefix string to store on the instance row at provision time.
 * `daytona` → `tenants/{id}/vault/`; `ec2` → null (host-disk vault).
 */
export function assignS3VaultPrefixForProvision(
  tenantId: string,
  runtimeKind: RuntimeKind,
): string | null {
  if (runtimeKind !== "daytona") {
    return null;
  }
  return buildS3VaultPrefix(tenantId);
}
