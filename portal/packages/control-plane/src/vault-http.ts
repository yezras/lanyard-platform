/**
 * Internal CP HTTP vault list/stat/get (lp-oop.9) + put/CAS (lp-zuh.12.7).
 *
 * Routes stay under the stamped tenant vault prefix. Callers inject
 * {@link VaultObjectStore} (tests: FakeS3). No Daytona wake. No @aws-sdk
 * in BFF — CP is the only S3 caller (plan 0015 Option B).
 */

import { createHash } from "node:crypto";

import { InvalidVaultPathError, normalizeVaultPath } from "@lanyard/shared";
import { z } from "zod";

import {
  assertS3VaultPrefixBoundToTenant,
  assertValidTenantIdForVaultPrefix,
  buildS3VaultPrefix,
  InvalidS3VaultPrefixError,
  InvalidTenantIdForVaultPrefixError,
  type VaultObjectGetHit,
  type VaultObjectStore,
} from "./vault-prefix.js";

export const VAULT_HTTP_ROUTE_TEMPLATES = {
  list: "/internal/tenants/:tenantId/vault/list",
  stat: "/internal/tenants/:tenantId/vault/stat",
  get: "/internal/tenants/:tenantId/vault/get",
  put: "/internal/tenants/:tenantId/vault/put",
} as const;

export const VAULT_HTTP_API_PATHS = {
  list: (tenantId: string) => `/internal/tenants/${tenantId}/vault/list`,
  stat: (tenantId: string) => `/internal/tenants/${tenantId}/vault/stat`,
  get: (tenantId: string) => `/internal/tenants/${tenantId}/vault/get`,
  put: (tenantId: string) => `/internal/tenants/${tenantId}/vault/put`,
} as const;

/** Decoded body hard max for vault/put (matches vault.write inline hard max). */
export const VAULT_HTTP_PUT_HARD_MAX_BYTES = 4_194_304 as const;

export const VAULT_HTTP_LIST_MAX_KEYS = 1000 as const;

export type VaultHttpEntryKind = "file" | "directory";

/** Vault UI entry (plan 0015 VaultEntry + name for BFF tree mapping). */
export type VaultHttpEntry = {
  path: string;
  name: string;
  kind: VaultHttpEntryKind;
  size_bytes?: number;
  etag?: string;
  mtime?: string;
  content_type?: string;
};

export type VaultHttpListResponse = {
  tenant_id: string;
  path: string;
  s3_vault_prefix: string;
  entries: VaultHttpEntry[];
  next_cursor?: string;
  truncated: boolean;
};

export type VaultHttpStatResponse = VaultHttpEntry & {
  tenant_id: string;
  s3_vault_prefix: string;
};

export type VaultHttpGetResponse = {
  tenant_id: string;
  path: string;
  kind: "file";
  body: string;
  encoding: "utf-8";
  content_type: string;
  size_bytes: number;
  etag?: string;
  mtime?: string;
  s3_vault_prefix: string;
};

export type VaultHttpPutMode =
  | "replace_if_match"
  | "create_new"
  | "replace_if_absent";

export type VaultHttpPutBody = {
  path: string;
  body: string;
  encoding: "utf-8" | "base64";
  content_type?: string;
  /** CAS token (etag or content_hash). Required for replace_if_match. */
  if_match?: string;
  mode?: VaultHttpPutMode;
  idempotency_key?: string;
  size_bytes?: number;
};

export type VaultHttpPutResponse = {
  tenant_id: string;
  path: string;
  kind: "file";
  revision: {
    token: string;
    kind: "etag" | "content_hash";
    size_bytes: number;
    modified_at?: string;
  };
  etag?: string;
  size_bytes: number;
  content_type: string;
  written_at: string;
  created: boolean;
  idempotent_replay?: boolean;
  s3_vault_prefix: string;
};

export type VaultHttpErrorCode =
  | "VAULT_CROSS_TENANT"
  | "VAULT_INVALID_PATH"
  | "VAULT_OBJECT_NOT_FOUND"
  | "VAULT_NOT_A_FILE"
  | "VAULT_OBJECT_STORE_NOT_CONFIGURED"
  | "VAULT_BUCKET_NOT_CONFIGURED"
  | "VAULT_REVISION_CONFLICT"
  | "VAULT_ALREADY_EXISTS"
  | "VAULT_PAYLOAD_TOO_LARGE"
  | "VAULT_INVALID_BODY";

export class VaultHttpError extends Error {
  readonly code: VaultHttpErrorCode;
  readonly httpStatus: 400 | 403 | 404 | 409 | 413 | 501 | 503;
  readonly tenantId?: string;
  readonly path?: string;
  readonly expectedRevisionToken?: string;
  readonly actualRevisionToken?: string;

  constructor(
    code: VaultHttpErrorCode,
    message: string,
    httpStatus: 400 | 403 | 404 | 409 | 413 | 501 | 503,
    extras: {
      tenantId?: string;
      path?: string;
      expectedRevisionToken?: string;
      actualRevisionToken?: string;
    } = {},
  ) {
    super(message);
    this.name = "VaultHttpError";
    this.code = code;
    this.httpStatus = httpStatus;
    this.tenantId = extras.tenantId;
    this.path = extras.path;
    this.expectedRevisionToken = extras.expectedRevisionToken;
    this.actualRevisionToken = extras.actualRevisionToken;
  }

  toBody(): {
    error: string;
    code: VaultHttpErrorCode;
    tenant_id?: string;
    path?: string;
    expected_revision_token?: string;
    actual_revision_token?: string;
  } {
    return {
      error: this.message,
      code: this.code,
      ...(this.tenantId ? { tenant_id: this.tenantId } : {}),
      ...(this.path ? { path: this.path } : {}),
      ...(this.expectedRevisionToken
        ? { expected_revision_token: this.expectedRevisionToken }
        : {}),
      ...(this.actualRevisionToken
        ? { actual_revision_token: this.actualRevisionToken }
        : {}),
    };
  }
}

export const vaultHttpListQuerySchema = z
  .object({
    path: z.string().max(1024).optional(),
    prefix: z.string().min(1).max(1024).optional(),
    cursor: z.string().min(1).max(512).optional(),
    max_keys: z.coerce
      .number()
      .int()
      .positive()
      .max(VAULT_HTTP_LIST_MAX_KEYS)
      .optional(),
  })
  .strict();

export const vaultHttpPathQuerySchema = z
  .object({
    path: z.string().min(1).max(1024),
    prefix: z.string().min(1).max(1024).optional(),
  })
  .strict();

export const vaultHttpPutBodySchema = z
  .object({
    path: z.string().min(1).max(1024),
    body: z.string(),
    encoding: z.enum(["utf-8", "base64"]),
    content_type: z.string().min(1).max(200).optional(),
    if_match: z.string().min(1).max(256).optional(),
    mode: z
      .enum(["replace_if_match", "create_new", "replace_if_absent"])
      .optional(),
    idempotency_key: z.string().min(1).max(128).optional(),
    size_bytes: z.number().int().nonnegative().optional(),
    prefix: z.string().min(1).max(1024).optional(),
  })
  .strict();

export type VaultHttpListQuery = z.infer<typeof vaultHttpListQuerySchema>;
export type VaultHttpPathQuery = z.infer<typeof vaultHttpPathQuerySchema>;
export type VaultHttpPutQuery = z.infer<typeof vaultHttpPutBodySchema>;

/**
 * Resolve the S3 key prefix this tenant may read.
 * Optional `requestedPrefix` must bind to `tenantId` (cross-tenant → 403).
 */
export function resolveTenantVaultPrefix(
  tenantId: string,
  requestedPrefix?: string,
): string {
  let id: string;
  try {
    id = assertValidTenantIdForVaultPrefix(tenantId);
  } catch (error) {
    if (error instanceof InvalidTenantIdForVaultPrefixError) {
      throw new VaultHttpError(
        "VAULT_INVALID_PATH",
        error.message,
        400,
        { tenantId },
      );
    }
    throw error;
  }

  if (!requestedPrefix?.trim()) {
    return buildS3VaultPrefix(id);
  }

  try {
    return assertS3VaultPrefixBoundToTenant(requestedPrefix, id);
  } catch (error) {
    if (error instanceof InvalidS3VaultPrefixError) {
      throw new VaultHttpError(
        "VAULT_CROSS_TENANT",
        `Cross-tenant vault prefix denied for tenant ${id}`,
        403,
        { tenantId: id },
      );
    }
    throw error;
  }
}

function rejectAbsoluteS3VaultPath(normalized: string, tenantId: string): void {
  if (
    normalized === "/tenants" ||
    normalized.startsWith("/tenants/") ||
    normalized.includes("://")
  ) {
    throw new VaultHttpError(
      "VAULT_CROSS_TENANT",
      "Vault path must be vault-root-relative (not an S3 key or URI)",
      403,
      { tenantId, path: normalized },
    );
  }
}

/**
 * Join a vault-root-relative UI path onto the tenant prefix.
 * Rejects traversal and any key that would escape the prefix.
 */
export function joinTenantVaultKey(input: {
  tenantId: string;
  prefix: string;
  vaultPath: string;
  directory?: boolean;
}): { prefix: string; path: string; key: string } {
  const prefix = input.prefix.endsWith("/")
    ? input.prefix
    : `${input.prefix}/`;
  let normalized: string;
  try {
    normalized = normalizeVaultPath(input.vaultPath);
  } catch (error) {
    if (error instanceof InvalidVaultPathError) {
      throw new VaultHttpError(
        "VAULT_INVALID_PATH",
        error.message,
        400,
        { tenantId: input.tenantId, path: input.vaultPath },
      );
    }
    throw error;
  }
  rejectAbsoluteS3VaultPath(normalized, input.tenantId);

  const relative = normalized === "/" ? "" : normalized.slice(1);
  const base = relative ? `${prefix}${relative}` : prefix.slice(0, -1);
  const key =
    input.directory && !base.endsWith("/") ? `${base}/` : base;

  if (key !== prefix.slice(0, -1) && !key.startsWith(prefix)) {
    throw new VaultHttpError(
      "VAULT_CROSS_TENANT",
      `Vault key escaped tenant prefix ${prefix}`,
      403,
      { tenantId: input.tenantId, path: normalized },
    );
  }
  if (key.includes("..")) {
    throw new VaultHttpError(
      "VAULT_INVALID_PATH",
      `Invalid vault path: ${input.vaultPath}`,
      400,
      { tenantId: input.tenantId, path: normalized },
    );
  }

  return { prefix, path: normalized, key };
}

function vaultName(path: string): string {
  if (path === "/") {
    return "";
  }
  const parts = path.split("/").filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? "";
}

function vaultPathFromKey(
  prefix: string,
  key: string,
  tenantId: string,
): string {
  if (key !== prefix.slice(0, -1) && !key.startsWith(prefix)) {
    throw new VaultHttpError(
      "VAULT_CROSS_TENANT",
      "Listed key is outside the tenant vault prefix",
      403,
      { tenantId },
    );
  }
  const rest = key.startsWith(prefix)
    ? key.slice(prefix.length)
    : "";
  const trimmed = rest.replace(/\/+$/, "");
  return trimmed ? `/${trimmed}` : "/";
}

export type TenantVaultHttpDeps = {
  store: VaultObjectStore;
  bucket: string;
  tenantId: string;
  requestedPrefix?: string;
};

export function requireVaultHttpDeps(input: {
  store?: VaultObjectStore | null;
  bucket?: string | null;
}): { store: VaultObjectStore; bucket: string } {
  if (!input.store) {
    throw new VaultHttpError(
      "VAULT_OBJECT_STORE_NOT_CONFIGURED",
      "Vault object store is not configured (inject VaultObjectStore; lp-oop.9)",
      501,
    );
  }
  const bucket = input.bucket?.trim() ?? "";
  if (!bucket) {
    throw new VaultHttpError(
      "VAULT_BUCKET_NOT_CONFIGURED",
      "Vault bucket is not configured",
      503,
    );
  }
  return { store: input.store, bucket };
}

export async function listTenantVault(
  deps: TenantVaultHttpDeps,
  query: VaultHttpListQuery,
): Promise<VaultHttpListResponse> {
  const prefix = resolveTenantVaultPrefix(deps.tenantId, query.prefix ?? deps.requestedPrefix);
  const joined = joinTenantVaultKey({
    tenantId: deps.tenantId,
    prefix,
    vaultPath: query.path?.trim() ? query.path : "/",
    directory: true,
  });
  const page = await deps.store.listPrefix({
    bucket: deps.bucket,
    prefix: joined.key,
    delimiter: "/",
    cursor: query.cursor,
    maxKeys: query.max_keys,
  });

  const entries: VaultHttpEntry[] = [];
  for (const common of page.common_prefixes ?? []) {
    const path = vaultPathFromKey(prefix, common, deps.tenantId);
    entries.push({
      path,
      name: vaultName(path),
      kind: "directory",
    });
  }
  for (const object of page.objects) {
    const path = vaultPathFromKey(prefix, object.key, deps.tenantId);
    entries.push({
      path,
      name: vaultName(path),
      kind: "file",
      size_bytes: object.size_bytes,
      ...(object.etag ? { etag: object.etag } : {}),
      ...(object.mtime ? { mtime: object.mtime } : {}),
    });
  }

  return {
    tenant_id: deps.tenantId,
    path: joined.path,
    s3_vault_prefix: prefix,
    entries,
    ...(page.next_cursor ? { next_cursor: page.next_cursor } : {}),
    truncated: page.truncated,
  };
}

async function directoryExists(
  store: VaultObjectStore,
  bucket: string,
  directoryKey: string,
): Promise<boolean> {
  const page = await store.listPrefix({
    bucket,
    prefix: directoryKey,
    delimiter: "/",
    maxKeys: 1,
  });
  return (
    page.objects.length > 0 ||
    (page.common_prefixes?.length ?? 0) > 0
  );
}

export async function statTenantVault(
  deps: TenantVaultHttpDeps,
  query: VaultHttpPathQuery,
): Promise<VaultHttpStatResponse> {
  const prefix = resolveTenantVaultPrefix(deps.tenantId, query.prefix ?? deps.requestedPrefix);
  const joined = joinTenantVaultKey({
    tenantId: deps.tenantId,
    prefix,
    vaultPath: query.path,
  });

  if (joined.path === "/") {
    return {
      tenant_id: deps.tenantId,
      path: "/",
      name: "",
      kind: "directory",
      s3_vault_prefix: prefix,
    };
  }

  const hit = await deps.store.getObject({
    bucket: deps.bucket,
    key: joined.key,
  });
  if (hit.found) {
    return entryFromHit(deps.tenantId, prefix, joined.path, hit);
  }

  const dirKey = joined.key.endsWith("/") ? joined.key : `${joined.key}/`;
  if (await directoryExists(deps.store, deps.bucket, dirKey)) {
    return {
      tenant_id: deps.tenantId,
      path: joined.path,
      name: vaultName(joined.path),
      kind: "directory",
      s3_vault_prefix: prefix,
    };
  }

  throw new VaultHttpError(
    "VAULT_OBJECT_NOT_FOUND",
    `Vault path not found: ${joined.path}`,
    404,
    { tenantId: deps.tenantId, path: joined.path },
  );
}

export async function getTenantVault(
  deps: TenantVaultHttpDeps,
  query: VaultHttpPathQuery,
): Promise<VaultHttpGetResponse> {
  const prefix = resolveTenantVaultPrefix(deps.tenantId, query.prefix ?? deps.requestedPrefix);
  const joined = joinTenantVaultKey({
    tenantId: deps.tenantId,
    prefix,
    vaultPath: query.path,
  });

  if (joined.path === "/") {
    throw new VaultHttpError(
      "VAULT_NOT_A_FILE",
      "Vault get requires a file path",
      400,
      { tenantId: deps.tenantId, path: joined.path },
    );
  }

  const hit = await deps.store.getObject({
    bucket: deps.bucket,
    key: joined.key,
  });
  if (!hit.found) {
    const dirKey = `${joined.key}/`;
    if (await directoryExists(deps.store, deps.bucket, dirKey)) {
      throw new VaultHttpError(
        "VAULT_NOT_A_FILE",
        `Vault get requires a file path (got directory ${joined.path})`,
        400,
        { tenantId: deps.tenantId, path: joined.path },
      );
    }
    throw new VaultHttpError(
      "VAULT_OBJECT_NOT_FOUND",
      `Vault path not found: ${joined.path}`,
      404,
      { tenantId: deps.tenantId, path: joined.path },
    );
  }

  return {
    tenant_id: deps.tenantId,
    path: joined.path,
    kind: "file",
    body: hit.body,
    encoding: "utf-8",
    content_type: hit.contentType,
    size_bytes: hit.size_bytes,
    ...(hit.etag ? { etag: hit.etag } : {}),
    ...(hit.mtime ? { mtime: hit.mtime } : {}),
    s3_vault_prefix: prefix,
  };
}

function entryFromHit(
  tenantId: string,
  prefix: string,
  path: string,
  hit: VaultObjectGetHit,
): VaultHttpStatResponse {
  return {
    tenant_id: tenantId,
    path,
    name: vaultName(path),
    kind: "file",
    size_bytes: hit.size_bytes,
    ...(hit.etag ? { etag: hit.etag } : {}),
    ...(hit.mtime ? { mtime: hit.mtime } : {}),
    content_type: hit.contentType,
    s3_vault_prefix: prefix,
  };
}

function contentHashHex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function decodePutBody(
  body: string,
  encoding: "utf-8" | "base64",
  tenantId: string,
  path: string,
): Buffer {
  if (encoding === "base64") {
    try {
      return Buffer.from(body, "base64");
    } catch {
      throw new VaultHttpError(
        "VAULT_INVALID_BODY",
        "Vault put body is not valid base64",
        400,
        { tenantId, path },
      );
    }
  }
  return Buffer.from(body, "utf8");
}

/**
 * Tokens that identify the current object for CAS.
 * Mint uses content_hash (sha256 of utf-8 store bytes); S3/FakeS3 also expose etag.
 */
export function vaultObjectCasTokens(hit: VaultObjectGetHit): {
  content_hash: string;
  etag?: string;
} {
  const content_hash = contentHashHex(Buffer.from(hit.body, "utf8"));
  return {
    content_hash,
    ...(hit.etag ? { etag: hit.etag } : {}),
  };
}

function casMatches(ifMatch: string, tokens: { content_hash: string; etag?: string }): boolean {
  if (ifMatch === tokens.content_hash) {
    return true;
  }
  if (tokens.etag && ifMatch === tokens.etag) {
    return true;
  }
  return false;
}

/**
 * Put (create/replace) under the tenant vault prefix with optional etag/content_hash CAS.
 * No Daytona wake. Store body remains a UTF-8 string (existing FakeS3 / S3 adapter model).
 */
export async function putTenantVault(
  deps: TenantVaultHttpDeps,
  input: VaultHttpPutQuery,
): Promise<VaultHttpPutResponse> {
  const mode: VaultHttpPutMode = input.mode ?? "replace_if_match";
  const prefix = resolveTenantVaultPrefix(
    deps.tenantId,
    input.prefix ?? deps.requestedPrefix,
  );
  const joined = joinTenantVaultKey({
    tenantId: deps.tenantId,
    prefix,
    vaultPath: input.path,
  });

  if (joined.path === "/") {
    throw new VaultHttpError(
      "VAULT_NOT_A_FILE",
      "Vault put requires a file path",
      400,
      { tenantId: deps.tenantId, path: joined.path },
    );
  }

  const decoded = decodePutBody(
    input.body,
    input.encoding,
    deps.tenantId,
    joined.path,
  );
  if (decoded.byteLength > VAULT_HTTP_PUT_HARD_MAX_BYTES) {
    throw new VaultHttpError(
      "VAULT_PAYLOAD_TOO_LARGE",
      `Vault put body exceeds hard max_bytes (${VAULT_HTTP_PUT_HARD_MAX_BYTES})`,
      413,
      { tenantId: deps.tenantId, path: joined.path },
    );
  }
  if (
    input.size_bytes !== undefined &&
    input.size_bytes !== decoded.byteLength
  ) {
    throw new VaultHttpError(
      "VAULT_INVALID_BODY",
      `size_bytes (${input.size_bytes}) does not match decoded body length (${decoded.byteLength})`,
      400,
      { tenantId: deps.tenantId, path: joined.path },
    );
  }

  // Persist as UTF-8 string (matches getObject / FakeS3 today). Lab Office
  // probes and ASCII fixtures round-trip; true binary ZIP/docx bytes may need
  // a later binary-safe store body (tracked outside this put surface).
  const storeBody = decoded.toString("utf8");
  const contentType =
    input.content_type?.trim() || "application/octet-stream";
  const newContentHash = contentHashHex(Buffer.from(storeBody, "utf8"));

  const existing = await deps.store.getObject({
    bucket: deps.bucket,
    key: joined.key,
  });

  if (mode === "create_new") {
    if (existing.found) {
      throw new VaultHttpError(
        "VAULT_ALREADY_EXISTS",
        `Vault path already exists: ${joined.path}`,
        409,
        { tenantId: deps.tenantId, path: joined.path },
      );
    }
  } else if (mode === "replace_if_absent") {
    if (existing.found) {
      const tokens = vaultObjectCasTokens(existing);
      return {
        tenant_id: deps.tenantId,
        path: joined.path,
        kind: "file",
        revision: {
          token: tokens.content_hash,
          kind: "content_hash",
          size_bytes: existing.size_bytes,
          ...(existing.mtime ? { modified_at: existing.mtime } : {}),
        },
        ...(existing.etag ? { etag: existing.etag } : {}),
        size_bytes: existing.size_bytes,
        content_type: existing.contentType,
        written_at: existing.mtime ?? new Date().toISOString(),
        created: false,
        idempotent_replay: true,
        s3_vault_prefix: prefix,
      };
    }
  } else {
    // replace_if_match
    const ifMatch = input.if_match?.trim();
    if (!ifMatch) {
      throw new VaultHttpError(
        "VAULT_INVALID_BODY",
        "replace_if_match requires if_match (etag or content_hash)",
        400,
        { tenantId: deps.tenantId, path: joined.path },
      );
    }
    if (!existing.found) {
      throw new VaultHttpError(
        "VAULT_OBJECT_NOT_FOUND",
        `Vault path not found: ${joined.path}`,
        404,
        { tenantId: deps.tenantId, path: joined.path },
      );
    }
    const tokens = vaultObjectCasTokens(existing);
    if (!casMatches(ifMatch, tokens)) {
      throw new VaultHttpError(
        "VAULT_REVISION_CONFLICT",
        `Vault CAS mismatch for ${joined.path}`,
        409,
        {
          tenantId: deps.tenantId,
          path: joined.path,
          expectedRevisionToken: ifMatch,
          actualRevisionToken: tokens.content_hash,
        },
      );
    }
    // Identical body + matching CAS → idempotent replay (stable revision).
    if (tokens.content_hash === newContentHash) {
      return {
        tenant_id: deps.tenantId,
        path: joined.path,
        kind: "file",
        revision: {
          token: tokens.content_hash,
          kind: "content_hash",
          size_bytes: existing.size_bytes,
          ...(existing.mtime ? { modified_at: existing.mtime } : {}),
        },
        ...(existing.etag ? { etag: existing.etag } : {}),
        size_bytes: existing.size_bytes,
        content_type: existing.contentType,
        written_at: existing.mtime ?? new Date().toISOString(),
        created: false,
        idempotent_replay: true,
        s3_vault_prefix: prefix,
      };
    }
  }

  await deps.store.putObject({
    bucket: deps.bucket,
    key: joined.key,
    body: storeBody,
    contentType,
  });

  const after = await deps.store.getObject({
    bucket: deps.bucket,
    key: joined.key,
  });
  if (!after.found) {
    throw new VaultHttpError(
      "VAULT_OBJECT_NOT_FOUND",
      `Vault put did not persist ${joined.path}`,
      503,
      { tenantId: deps.tenantId, path: joined.path },
    );
  }

  const tokens = vaultObjectCasTokens(after);
  const writtenAt = after.mtime ?? new Date().toISOString();
  return {
    tenant_id: deps.tenantId,
    path: joined.path,
    kind: "file",
    revision: {
      token: tokens.content_hash,
      kind: "content_hash",
      size_bytes: after.size_bytes,
      modified_at: writtenAt,
    },
    ...(after.etag ? { etag: after.etag } : {}),
    size_bytes: after.size_bytes,
    content_type: after.contentType,
    written_at: writtenAt,
    created: !existing.found,
    s3_vault_prefix: prefix,
  };
}
