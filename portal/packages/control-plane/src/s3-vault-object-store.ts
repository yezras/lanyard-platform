/**
 * Live S3 {@link VaultObjectStore} (lp-oop.37.1).
 *
 * ListObjectsV2 / GetObject / HeadObject / PutObject. CP is the only S3
 * caller (no @aws-sdk in BFF). Task role today can only AssumeRole the
 * shared vault-mount role (`SANDBOX_VAULT_MOUNT_ROLE_ARN`); that role is
 * the S3 identity (List/Get/Put on tenants/{id}/vault/). No tenant session
 * policy here — HTTP ACL stamps the tenant prefix. Never log credentials.
 *
 * Inject from server.ts when `S3_VAULT_BUCKET` is set.
 */

import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import {
  AssumeRoleCommand,
  STSClient,
  type STSClientConfig,
} from "@aws-sdk/client-sts";

import {
  clampSandboxVaultMountDurationSeconds,
  DEFAULT_SANDBOX_VAULT_MOUNT_AWS_REGION,
  SANDBOX_VAULT_MOUNT_DURATION_SECONDS_ENV,
  SANDBOX_VAULT_MOUNT_EXTERNAL_ID_ENV,
  SANDBOX_VAULT_MOUNT_ROLE_ARN_ENV,
} from "./sandbox-vault-mount-sts.js";
import type {
  VaultObjectGetResult,
  VaultObjectListInput,
  VaultObjectListPage,
  VaultObjectStore,
} from "./vault-prefix.js";

export const S3_VAULT_BUCKET_ENV = "S3_VAULT_BUCKET" as const;
export const CP_VAULT_OBJECT_STORE_ROLE_SESSION_NAME =
  "cp-vault-object-store" as const;

/** Refresh assumed-role creds this many ms before expiry. */
const ASSUME_ROLE_REFRESH_SKEW_MS = 60_000;

export class S3VaultObjectStoreError extends Error {
  readonly code = "S3_VAULT_OBJECT_STORE" as const;
  readonly operation: string;

  constructor(
    operation: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(`S3 vault ${operation} failed: ${message}`, options);
    this.name = "S3VaultObjectStoreError";
    this.operation = operation;
  }
}

export type S3VaultListObjectsV2Input = {
  Bucket: string;
  Prefix?: string;
  Delimiter?: string;
  MaxKeys?: number;
  ContinuationToken?: string;
};

export type S3VaultListObjectsV2Output = {
  Contents?: Array<{
    Key?: string;
    Size?: number;
    ETag?: string;
    LastModified?: Date;
  }>;
  CommonPrefixes?: Array<{ Prefix?: string }>;
  IsTruncated?: boolean;
  NextContinuationToken?: string;
};

export type S3VaultGetObjectOutput = {
  Body?: unknown;
  ContentType?: string;
  ContentLength?: number;
  ETag?: string;
  LastModified?: Date;
};

export type S3VaultHeadObjectOutput = {
  ContentType?: string;
  ContentLength?: number;
  ETag?: string;
  LastModified?: Date;
};

/**
 * Thin S3 surface used by the adapter. Tests inject a FakeS3-backed sdk;
 * live wraps {@link S3Client}.
 */
export type S3VaultSdk = {
  listObjectsV2(
    input: S3VaultListObjectsV2Input,
  ): Promise<S3VaultListObjectsV2Output>;
  getObject(input: { Bucket: string; Key: string }): Promise<S3VaultGetObjectOutput>;
  headObject(input: {
    Bucket: string;
    Key: string;
  }): Promise<S3VaultHeadObjectOutput>;
  putObject(input: {
    Bucket: string;
    Key: string;
    Body: string;
    ContentType?: string;
  }): Promise<void>;
};

export type VaultMountAssumedRoleIdentity = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiration?: Date;
};

export type VaultMountCredentialProvider =
  () => Promise<VaultMountAssumedRoleIdentity>;

export type StsAssumeRoleClient = {
  send(command: AssumeRoleCommand): Promise<{
    Credentials?: {
      AccessKeyId?: string;
      SecretAccessKey?: string;
      SessionToken?: string;
      Expiration?: Date;
    };
  }>;
};

export type CreateVaultMountAssumedRoleCredentialsOptions = {
  roleArn: string;
  externalId?: string | null;
  region?: string;
  durationSeconds?: number;
  roleSessionName?: string;
  stsClient?: StsAssumeRoleClient;
  stsClientConfig?: STSClientConfig;
  now?: () => number;
};

function assertIamRoleArn(roleArn: string): string {
  const arn = roleArn?.trim() ?? "";
  if (!arn) {
    throw new S3VaultObjectStoreError(
      "assumeRole",
      "SANDBOX_VAULT_MOUNT_ROLE_ARN is required to assume the vault-mount role",
    );
  }
  if (!arn.startsWith("arn:aws:iam::") || !arn.includes(":role/")) {
    throw new S3VaultObjectStoreError(
      "assumeRole",
      "SANDBOX_VAULT_MOUNT_ROLE_ARN must be an IAM role ARN",
    );
  }
  return arn;
}

function assumeRoleFailureMessage(err: unknown): string {
  if (err instanceof S3VaultObjectStoreError) {
    return err.message.replace(/^S3 vault assumeRole failed: /, "");
  }
  if (err instanceof Error && err.message.trim()) {
    return err.message;
  }
  return "AssumeRole failed";
}

/**
 * Credential provider: task role AssumeRole → lanyard-sandbox-vault-mount.
 * No tenant session policy (CP serves every tenant prefix; vault-http ACL
 * binds the key). Never log returned secret values.
 */
export function createVaultMountAssumedRoleCredentials(
  options: CreateVaultMountAssumedRoleCredentialsOptions,
): VaultMountCredentialProvider {
  const roleArn = assertIamRoleArn(options.roleArn);
  const externalId = options.externalId?.trim() || null;
  const durationSeconds = clampSandboxVaultMountDurationSeconds(
    options.durationSeconds,
  );
  const roleSessionName =
    options.roleSessionName?.trim() || CP_VAULT_OBJECT_STORE_ROLE_SESSION_NAME;
  const region =
    options.region?.trim() || DEFAULT_SANDBOX_VAULT_MOUNT_AWS_REGION;
  const client =
    options.stsClient ??
    new STSClient({
      region,
      ...(options.stsClientConfig ?? {}),
    });
  const now = options.now ?? Date.now;
  let cached: {
    identity: VaultMountAssumedRoleIdentity;
    refreshAfterMs: number;
  } | null = null;

  return async () => {
    const t = now();
    if (cached && cached.refreshAfterMs > t) {
      return cached.identity;
    }
    try {
      const out = await client.send(
        new AssumeRoleCommand({
          RoleArn: roleArn,
          RoleSessionName: roleSessionName,
          DurationSeconds: durationSeconds,
          ...(externalId ? { ExternalId: externalId } : {}),
        }),
      );
      const creds = out.Credentials;
      if (
        !creds?.AccessKeyId ||
        !creds.SecretAccessKey ||
        !creds.SessionToken
      ) {
        throw new S3VaultObjectStoreError(
          "assumeRole",
          "AssumeRole returned incomplete credentials",
        );
      }
      const expiration = creds.Expiration;
      const identity: VaultMountAssumedRoleIdentity = {
        accessKeyId: creds.AccessKeyId,
        secretAccessKey: creds.SecretAccessKey,
        sessionToken: creds.SessionToken,
        ...(expiration ? { expiration } : {}),
      };
      const refreshAfterMs = expiration
        ? expiration.getTime() - ASSUME_ROLE_REFRESH_SKEW_MS
        : t + durationSeconds * 1000 - ASSUME_ROLE_REFRESH_SKEW_MS;
      cached = { identity, refreshAfterMs };
      return identity;
    } catch (err) {
      if (err instanceof S3VaultObjectStoreError) {
        throw err;
      }
      throw new S3VaultObjectStoreError(
        "assumeRole",
        assumeRoleFailureMessage(err),
        { cause: err },
      );
    }
  };
}

function stripEtag(etag: string | undefined): string | undefined {
  if (!etag) {
    return undefined;
  }
  const trimmed = etag.replaceAll('"', "").trim();
  return trimmed || undefined;
}

function isS3NotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  const e = err as {
    name?: string;
    Code?: string;
    code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  const code = e.name ?? e.Code ?? e.code;
  if (code === "NoSuchKey" || code === "NotFound" || code === "NotFoundError") {
    return true;
  }
  return e.$metadata?.httpStatusCode === 404;
}

async function readObjectBody(body: unknown): Promise<string> {
  if (body == null) {
    return "";
  }
  if (typeof body === "string") {
    return body;
  }
  if (Buffer.isBuffer(body)) {
    return body.toString("utf8");
  }
  if (typeof body === "object") {
    const stream = body as {
      transformToString?: (encoding?: string) => Promise<string>;
      transformToByteArray?: () => Promise<Uint8Array>;
    };
    if (typeof stream.transformToString === "function") {
      return stream.transformToString("utf-8");
    }
    if (typeof stream.transformToByteArray === "function") {
      return Buffer.from(await stream.transformToByteArray()).toString("utf8");
    }
  }
  throw new S3VaultObjectStoreError(
    "getObject",
    "unsupported GetObject body type",
  );
}

export function createAwsS3VaultSdk(
  client: S3Client,
): S3VaultSdk {
  return {
    async listObjectsV2(input) {
      return client.send(new ListObjectsV2Command(input));
    },
    async getObject(input) {
      return client.send(new GetObjectCommand(input));
    },
    async headObject(input) {
      return client.send(new HeadObjectCommand(input));
    },
    async putObject(input) {
      await client.send(new PutObjectCommand(input));
    },
  };
}

/**
 * Live adapter. Maps AWS List/Get/Head/Put onto {@link VaultObjectStore}.
 * Missing Get/Head keys are a typed miss — not an exception.
 */
export class S3VaultObjectStore implements VaultObjectStore {
  constructor(private readonly sdk: S3VaultSdk) {}

  async headObject(input: { bucket: string; key: string }): Promise<boolean> {
    try {
      await this.sdk.headObject({ Bucket: input.bucket, Key: input.key });
      return true;
    } catch (err) {
      if (isS3NotFound(err)) {
        return false;
      }
      throw wrapS3Error("headObject", err);
    }
  }

  async putObject(input: {
    bucket: string;
    key: string;
    body: string;
    contentType?: string;
  }): Promise<void> {
    try {
      await this.sdk.putObject({
        Bucket: input.bucket,
        Key: input.key,
        Body: input.body,
        ContentType: input.contentType ?? "application/octet-stream",
      });
    } catch (err) {
      throw wrapS3Error("putObject", err);
    }
  }

  async listPrefix(input: VaultObjectListInput): Promise<VaultObjectListPage> {
    const prefix = input.prefix ?? "";
    const delimiter = input.delimiter;
    try {
      const out = await this.sdk.listObjectsV2({
        Bucket: input.bucket,
        ...(prefix ? { Prefix: prefix } : {}),
        ...(delimiter !== undefined ? { Delimiter: delimiter } : {}),
        ...(input.maxKeys !== undefined ? { MaxKeys: input.maxKeys } : {}),
        ...(input.cursor ? { ContinuationToken: input.cursor } : {}),
      });
      const objects = (out.Contents ?? [])
        .filter((item): item is { Key: string; Size?: number; ETag?: string; LastModified?: Date } =>
          Boolean(item.Key),
        )
        .map((item) => ({
          key: item.Key,
          size_bytes: item.Size ?? 0,
          ...(stripEtag(item.ETag) ? { etag: stripEtag(item.ETag) } : {}),
          ...(item.LastModified
            ? { mtime: item.LastModified.toISOString() }
            : {}),
        }));
      const commonPrefixes = (out.CommonPrefixes ?? [])
        .map((item) => item.Prefix)
        .filter((value): value is string => Boolean(value));
      const truncated = Boolean(out.IsTruncated);
      return {
        prefix,
        objects,
        ...(delimiter !== undefined ? { common_prefixes: commonPrefixes } : {}),
        ...(truncated && out.NextContinuationToken
          ? { next_cursor: out.NextContinuationToken }
          : {}),
        truncated,
      };
    } catch (err) {
      throw wrapS3Error("listPrefix", err);
    }
  }

  async getObject(input: {
    bucket: string;
    key: string;
  }): Promise<VaultObjectGetResult> {
    try {
      const out = await this.sdk.getObject({
        Bucket: input.bucket,
        Key: input.key,
      });
      const body = await readObjectBody(out.Body);
      const sizeBytes =
        typeof out.ContentLength === "number" && Number.isFinite(out.ContentLength)
          ? out.ContentLength
          : Buffer.byteLength(body, "utf8");
      return {
        found: true,
        bucket: input.bucket,
        key: input.key,
        body,
        contentType: out.ContentType ?? "application/octet-stream",
        size_bytes: sizeBytes,
        ...(stripEtag(out.ETag) ? { etag: stripEtag(out.ETag) } : {}),
        ...(out.LastModified ? { mtime: out.LastModified.toISOString() } : {}),
      };
    } catch (err) {
      if (isS3NotFound(err)) {
        return {
          found: false,
          bucket: input.bucket,
          key: input.key,
        };
      }
      throw wrapS3Error("getObject", err);
    }
  }
}

function wrapS3Error(operation: string, err: unknown): S3VaultObjectStoreError {
  if (err instanceof S3VaultObjectStoreError) {
    return err;
  }
  const message =
    err instanceof Error && err.message.trim()
      ? err.message
      : `${operation} failed`;
  return new S3VaultObjectStoreError(operation, message, { cause: err });
}

export type CreateS3VaultObjectStoreOptions = {
  region?: string;
  sdk?: S3VaultSdk;
  s3Client?: S3Client;
  credentials?: VaultMountCredentialProvider;
  s3ClientConfig?: S3ClientConfig;
};

export function createS3VaultObjectStore(
  options: CreateS3VaultObjectStoreOptions = {},
): S3VaultObjectStore {
  if (options.sdk) {
    return new S3VaultObjectStore(options.sdk);
  }
  const region =
    options.region?.trim() || DEFAULT_SANDBOX_VAULT_MOUNT_AWS_REGION;
  const client =
    options.s3Client ??
    new S3Client({
      region,
      ...(options.credentials ? { credentials: options.credentials } : {}),
      ...(options.s3ClientConfig ?? {}),
    });
  return new S3VaultObjectStore(createAwsS3VaultSdk(client));
}

export type ResolvedS3VaultObjectStore = {
  store: S3VaultObjectStore | null;
  bucket: string | null;
  configured: boolean;
  assumedRole: boolean;
  roleArnConfigured: boolean;
  region: string;
  durationSeconds: number;
};

export type ResolveS3VaultObjectStoreFromEnvOverrides = {
  sdk?: S3VaultSdk;
  s3Client?: S3Client;
  stsClient?: StsAssumeRoleClient;
};

/**
 * Boot wire: `S3_VAULT_BUCKET` set → live store. When
 * `SANDBOX_VAULT_MOUNT_ROLE_ARN` is also set, S3 calls use assumed-role
 * credentials (CP task role has no direct S3). Unset bucket → store null
 * (vault HTTP stays 501).
 */
export function resolveS3VaultObjectStoreFromEnv(
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>> = process.env,
  overrides: ResolveS3VaultObjectStoreFromEnvOverrides = {},
): ResolvedS3VaultObjectStore {
  const bucket = env[S3_VAULT_BUCKET_ENV]?.trim() || null;
  const roleArn = env[SANDBOX_VAULT_MOUNT_ROLE_ARN_ENV]?.trim() ?? "";
  const externalId = env[SANDBOX_VAULT_MOUNT_EXTERNAL_ID_ENV]?.trim() || null;
  const durationRaw = env[SANDBOX_VAULT_MOUNT_DURATION_SECONDS_ENV]?.trim();
  const durationSeconds = clampSandboxVaultMountDurationSeconds(
    durationRaw ? Number(durationRaw) : undefined,
  );
  const region =
    env.AWS_REGION?.trim() ||
    env.AWS_DEFAULT_REGION?.trim() ||
    DEFAULT_SANDBOX_VAULT_MOUNT_AWS_REGION;

  if (!bucket) {
    return {
      store: null,
      bucket: null,
      configured: false,
      assumedRole: false,
      roleArnConfigured: Boolean(roleArn),
      region,
      durationSeconds,
    };
  }

  const credentials = roleArn
    ? createVaultMountAssumedRoleCredentials({
        roleArn,
        externalId,
        region,
        durationSeconds,
        stsClient: overrides.stsClient,
      })
    : undefined;

  const store = createS3VaultObjectStore({
    region,
    sdk: overrides.sdk,
    s3Client: overrides.s3Client,
    credentials,
  });

  return {
    store,
    bucket,
    configured: true,
    assumedRole: Boolean(roleArn),
    roleArnConfigured: Boolean(roleArn),
    region,
    durationSeconds,
  };
}

/** Safe for logs — never role ARN, ExternalId, or secret material. */
export function summarizeS3VaultObjectStoreForLog(
  resolved: ResolvedS3VaultObjectStore,
): {
  configured: boolean;
  assumed_role: boolean;
  role_arn_configured: boolean;
  bucket_configured: boolean;
  region: string;
  duration_seconds: number;
} {
  return {
    configured: resolved.configured,
    assumed_role: resolved.assumedRole,
    role_arn_configured: resolved.roleArnConfigured,
    bucket_configured: Boolean(resolved.bucket),
    region: resolved.region,
    duration_seconds: resolved.durationSeconds,
  };
}
