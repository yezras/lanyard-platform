/**
 * lp-oop.37.1 — live S3 VaultObjectStore adapter.
 * Tests wrap a FakeS3-shaped SDK (no network). AssumeRole is stubbed.
 * No secrets in log summaries. No @aws-sdk in BFF.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AssumeRoleCommand } from "@aws-sdk/client-sts";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { FakeS3ObjectStore } from "../src/fake-s3-object-store.js";
import {
  CP_VAULT_OBJECT_STORE_ROLE_SESSION_NAME,
  createS3VaultObjectStore,
  createVaultMountAssumedRoleCredentials,
  resolveS3VaultObjectStoreFromEnv,
  S3_VAULT_BUCKET_ENV,
  S3VaultObjectStore,
  S3VaultObjectStoreError,
  summarizeS3VaultObjectStoreForLog,
  type S3VaultSdk,
  type StsAssumeRoleClient,
} from "../src/s3-vault-object-store.js";
import { SANDBOX_VAULT_MOUNT_ROLE_ARN_ENV } from "../src/sandbox-vault-mount-sts.js";
import type { ControlPlaneStore } from "../src/store.js";
import { VAULT_HTTP_API_PATHS } from "../src/vault-http.js";
import type { VaultObjectStore } from "../src/vault-prefix.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const adapterSrc = readFileSync(
  join(__dirname, "../src/s3-vault-object-store.ts"),
  "utf8",
);
const serverSrc = readFileSync(join(__dirname, "../src/server.ts"), "utf8");
const indexSrc = readFileSync(join(__dirname, "../src/index.ts"), "utf8");
const bffPkg = JSON.parse(
  readFileSync(join(__dirname, "../../bff/package.json"), "utf8"),
) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
const cpPkg = JSON.parse(
  readFileSync(join(__dirname, "../package.json"), "utf8"),
) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

const BUCKET = "lanyard-mocklab-vault-test";
const OTHER_BUCKET = "lanyard-other-vault-test";
const TENANT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PREFIX = `tenants/${TENANT}/vault/`;
const ROLE_ARN =
  "arn:aws:iam::123456789012:role/lanyard-sandbox-vault-mount";
const FIXED_MTIME = new Date("2026-08-14T00:00:00.000Z");

class FakeNotFoundError extends Error {
  readonly name = "NoSuchKey";
  readonly $metadata = { httpStatusCode: 404 };

  constructor(message = "The specified key does not exist.") {
    super(message);
  }
}

class FakeHeadNotFoundError extends Error {
  readonly name = "NotFound";
  readonly $metadata = { httpStatusCode: 404 };

  constructor() {
    super("UnknownError");
  }
}

function wrapFakeS3AsSdk(store: FakeS3ObjectStore): S3VaultSdk & {
  calls: Array<{ op: string; input: Record<string, unknown> }>;
} {
  const calls: Array<{ op: string; input: Record<string, unknown> }> = [];
  return {
    calls,
    async listObjectsV2(input) {
      calls.push({ op: "listObjectsV2", input: { ...input } });
      const page = await store.listPrefix({
        bucket: input.Bucket,
        prefix: input.Prefix ?? "",
        delimiter: input.Delimiter,
        maxKeys: input.MaxKeys,
        cursor: input.ContinuationToken,
      });
      return {
        Contents: page.objects.map((object) => ({
          Key: object.key,
          Size: object.size_bytes,
          ETag: object.etag ? `"${object.etag}"` : undefined,
          LastModified: object.mtime ? new Date(object.mtime) : undefined,
        })),
        CommonPrefixes: (page.common_prefixes ?? []).map((prefix) => ({
          Prefix: prefix,
        })),
        IsTruncated: page.truncated,
        NextContinuationToken: page.next_cursor,
      };
    },
    async getObject(input) {
      calls.push({ op: "getObject", input: { ...input } });
      const hit = await store.getObject({
        bucket: input.Bucket,
        key: input.Key,
      });
      if (!hit.found) {
        throw new FakeNotFoundError();
      }
      return {
        Body: {
          transformToString: async () => hit.body,
        },
        ContentType: hit.contentType,
        ContentLength: hit.size_bytes,
        ETag: hit.etag ? `"${hit.etag}"` : undefined,
        LastModified: hit.mtime ? new Date(hit.mtime) : undefined,
      };
    },
    async headObject(input) {
      calls.push({ op: "headObject", input: { ...input } });
      const exists = await store.headObject({
        bucket: input.Bucket,
        key: input.Key,
      });
      if (!exists) {
        throw new FakeHeadNotFoundError();
      }
      return { ContentType: "application/octet-stream" };
    },
    async putObject(input) {
      calls.push({ op: "putObject", input: { ...input } });
      await store.putObject({
        bucket: input.Bucket,
        key: input.Key,
        body: input.Body,
        contentType: input.ContentType,
      });
    },
  };
}

function fakeSts(options: {
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  expiration?: Date;
  fail?: string;
} = {}): StsAssumeRoleClient & { commands: AssumeRoleCommand[] } {
  const commands: AssumeRoleCommand[] = [];
  return {
    commands,
    async send(command: AssumeRoleCommand) {
      commands.push(command);
      if (options.fail) {
        throw new Error(options.fail);
      }
      return {
        Credentials: {
          AccessKeyId: options.accessKeyId ?? "ASIAFAKE0001",
          SecretAccessKey: options.secretAccessKey ?? "fake-secret-material",
          SessionToken: options.sessionToken ?? "fake-session-token",
          Expiration: options.expiration ?? new Date(Date.now() + 3600_000),
        },
      };
    },
  };
}

describe("S3VaultObjectStore catalog (lp-oop.37.1)", () => {
  it("exports the live adapter and injects from server.ts", () => {
    expect(indexSrc).toContain("S3VaultObjectStore");
    expect(indexSrc).toContain("resolveS3VaultObjectStoreFromEnv");
    expect(serverSrc).toContain("resolveS3VaultObjectStoreFromEnv");
    expect(serverSrc).toContain("vaultObjectStore: vaultObjectStoreResolved.store");
    expect(serverSrc).toContain("S3_VAULT_BUCKET");
    expect(adapterSrc).toMatch(/ListObjectsV2/);
    expect(adapterSrc).toMatch(/GetObject/);
    expect(adapterSrc).toMatch(/HeadObject/);
    expect(adapterSrc).toMatch(/PutObject/);
    expect(adapterSrc).toMatch(/AssumeRole/);
    expect(adapterSrc).toMatch(/Never log/);
  });

  it("adds @aws-sdk/client-s3 to CP only — not BFF", () => {
    expect(cpPkg.dependencies?.["@aws-sdk/client-s3"]).toMatch(/^\^3\./);
    const bffDeps = { ...bffPkg.dependencies, ...bffPkg.devDependencies };
    expect(bffDeps["@aws-sdk/client-s3"]).toBeUndefined();
    expect(bffDeps["@aws-sdk/lib-storage"]).toBeUndefined();
  });

  it("assigns S3VaultObjectStore to the VaultObjectStore port", () => {
    const store: VaultObjectStore = createS3VaultObjectStore({
      sdk: wrapFakeS3AsSdk(new FakeS3ObjectStore()),
    });
    expect(store).toBeInstanceOf(S3VaultObjectStore);
    expect(typeof store.headObject).toBe("function");
    expect(typeof store.putObject).toBe("function");
    expect(typeof store.listPrefix).toBe("function");
    expect(typeof store.getObject).toBe("function");
  });
});

describe("S3VaultObjectStore vs FakeS3-shaped SDK", () => {
  it("put / list / get / head roundtrip on the tenant prefix", async () => {
    const backing = new FakeS3ObjectStore({
      now: () => FIXED_MTIME,
    });
    const sdk = wrapFakeS3AsSdk(backing);
    const store = createS3VaultObjectStore({ sdk });
    const key = `${PREFIX}AGENTS.md`;
    const body = "# mocklab\n";

    expect(await store.headObject({ bucket: BUCKET, key })).toBe(false);
    await store.putObject({
      bucket: BUCKET,
      key,
      body,
      contentType: "text/markdown",
    });
    expect(await store.headObject({ bucket: BUCKET, key })).toBe(true);

    const page = await store.listPrefix({
      bucket: BUCKET,
      prefix: PREFIX,
      delimiter: "/",
    });
    expect(page.prefix).toBe(PREFIX);
    expect(page.truncated).toBe(false);
    expect(page.objects).toEqual([
      {
        key,
        size_bytes: Buffer.byteLength(body, "utf8"),
        etag: expect.any(String),
        mtime: FIXED_MTIME.toISOString(),
      },
    ]);
    expect(page.common_prefixes).toEqual([]);

    const hit = await store.getObject({ bucket: BUCKET, key });
    expect(hit).toEqual({
      found: true,
      bucket: BUCKET,
      key,
      body,
      contentType: "text/markdown",
      size_bytes: Buffer.byteLength(body, "utf8"),
      etag: page.objects[0]?.etag,
      mtime: FIXED_MTIME.toISOString(),
    });
    expect(sdk.calls.map((call) => call.op)).toEqual([
      "headObject",
      "putObject",
      "headObject",
      "listObjectsV2",
      "getObject",
    ]);
  });

  it("missing get/head is a typed miss (does not throw)", async () => {
    const store = createS3VaultObjectStore({
      sdk: wrapFakeS3AsSdk(new FakeS3ObjectStore()),
    });
    const key = `${PREFIX}missing.md`;
    const miss = await store.getObject({ bucket: BUCKET, key });
    expect(miss).toEqual({ found: false, bucket: BUCKET, key });
    expect(await store.headObject({ bucket: BUCKET, key })).toBe(false);
  });

  it("groups delimiter remainder as common prefixes", async () => {
    const backing = new FakeS3ObjectStore();
    backing.seed(BUCKET, `${PREFIX}readme.md`, "root");
    backing.seed(BUCKET, `${PREFIX}Projects/a.md`, "a");
    backing.seed(BUCKET, `${PREFIX}Projects/b.md`, "b");
    const store = createS3VaultObjectStore({ sdk: wrapFakeS3AsSdk(backing) });

    const page = await store.listPrefix({
      bucket: BUCKET,
      prefix: PREFIX,
      delimiter: "/",
    });
    expect(page.objects.map((object) => object.key)).toEqual([
      `${PREFIX}readme.md`,
    ]);
    expect(page.common_prefixes).toEqual([`${PREFIX}Projects/`]);
  });

  it("does not leak keys across buckets", async () => {
    const backing = new FakeS3ObjectStore();
    const key = `${PREFIX}readme.md`;
    backing.seed(BUCKET, key, "a");
    backing.seed(OTHER_BUCKET, key, "b");
    const store = createS3VaultObjectStore({ sdk: wrapFakeS3AsSdk(backing) });

    const page = await store.listPrefix({ bucket: BUCKET, prefix: PREFIX });
    expect(page.objects.map((object) => object.key)).toEqual([key]);
    const hit = await store.getObject({ bucket: OTHER_BUCKET, key });
    expect(hit.found).toBe(true);
    if (hit.found) {
      expect(hit.body).toBe("b");
    }
  });

  it("maps ContinuationToken pagination onto cursor", async () => {
    const backing = new FakeS3ObjectStore();
    for (const name of ["a.md", "b.md", "c.md"]) {
      backing.seed(BUCKET, `${PREFIX}${name}`, name);
    }
    const store = createS3VaultObjectStore({ sdk: wrapFakeS3AsSdk(backing) });
    const first = await store.listPrefix({
      bucket: BUCKET,
      prefix: PREFIX,
      maxKeys: 2,
    });
    expect(first.objects).toHaveLength(2);
    expect(first.truncated).toBe(true);
    expect(first.next_cursor).toEqual(expect.any(String));

    const second = await store.listPrefix({
      bucket: BUCKET,
      prefix: PREFIX,
      maxKeys: 2,
      cursor: first.next_cursor,
    });
    expect(second.objects).toHaveLength(1);
    expect(second.truncated).toBe(false);
    expect(second.next_cursor).toBeUndefined();
  });

  it("propagates unexpected S3 errors (not 404)", async () => {
    const sdk: S3VaultSdk = {
      async listObjectsV2() {
        throw Object.assign(new Error("AccessDenied"), { name: "AccessDenied" });
      },
      async getObject() {
        throw Object.assign(new Error("SlowDown"), { name: "SlowDown" });
      },
      async headObject() {
        throw Object.assign(new Error("SlowDown"), { name: "SlowDown" });
      },
      async putObject() {
        throw Object.assign(new Error("SlowDown"), { name: "SlowDown" });
      },
    };
    const store = createS3VaultObjectStore({ sdk });
    await expect(
      store.listPrefix({ bucket: BUCKET, prefix: PREFIX }),
    ).rejects.toBeInstanceOf(S3VaultObjectStoreError);
    await expect(
      store.getObject({ bucket: BUCKET, key: `${PREFIX}x.md` }),
    ).rejects.toMatchObject({ operation: "getObject" });
    await expect(
      store.headObject({ bucket: BUCKET, key: `${PREFIX}x.md` }),
    ).rejects.toMatchObject({ operation: "headObject" });
    await expect(
      store.putObject({ bucket: BUCKET, key: `${PREFIX}x.md`, body: "x" }),
    ).rejects.toMatchObject({ operation: "putObject" });
  });
});

describe("vault-mount AssumeRole credentials", () => {
  it("assumes the mount role with no tenant session policy", async () => {
    const sts = fakeSts();
    const provider = createVaultMountAssumedRoleCredentials({
      roleArn: ROLE_ARN,
      stsClient: sts,
      region: "us-east-1",
    });
    const creds = await provider();
    expect(sts.commands).toHaveLength(1);
    const input = sts.commands[0]?.input;
    expect(input?.RoleArn).toBe(ROLE_ARN);
    expect(input?.RoleSessionName).toBe(CP_VAULT_OBJECT_STORE_ROLE_SESSION_NAME);
    expect(input?.Policy).toBeUndefined();
    expect(input?.DurationSeconds).toBe(3600);
    expect(creds.accessKeyId).toMatch(/^ASIA/);
    expect(creds.sessionToken).toBeTruthy();
  });

  it("caches credentials until refresh skew", async () => {
    let now = 1_000_000;
    const sts = fakeSts({
      expiration: new Date(now + 3600_000),
    });
    const provider = createVaultMountAssumedRoleCredentials({
      roleArn: ROLE_ARN,
      stsClient: sts,
      now: () => now,
    });
    await provider();
    now += 30_000;
    await provider();
    expect(sts.commands).toHaveLength(1);
    now += 3_600_000;
    await provider();
    expect(sts.commands).toHaveLength(2);
  });

  it("passes ExternalId when set and fail-closes on AssumeRole errors", async () => {
    const sts = fakeSts({ fail: "AccessDenied: not authorized" });
    const provider = createVaultMountAssumedRoleCredentials({
      roleArn: ROLE_ARN,
      externalId: "vault-ext",
      stsClient: sts,
    });
    await expect(provider()).rejects.toBeInstanceOf(S3VaultObjectStoreError);
    expect(sts.commands[0]?.input.ExternalId).toBe("vault-ext");
    expect(sts.commands[0]?.input.Policy).toBeUndefined();
  });

  it("rejects a non-role ARN without echoing the value", () => {
    expect(() =>
      createVaultMountAssumedRoleCredentials({
        roleArn: "not-an-arn",
      }),
    ).toThrow(/must be an IAM role ARN/);
    try {
      createVaultMountAssumedRoleCredentials({ roleArn: "not-an-arn" });
    } catch (err) {
      expect(String(err)).not.toContain("not-an-arn");
    }
  });
});

describe("resolveS3VaultObjectStoreFromEnv", () => {
  it("returns a null store when S3_VAULT_BUCKET is unset", () => {
    const resolved = resolveS3VaultObjectStoreFromEnv({});
    expect(resolved.store).toBeNull();
    expect(resolved.configured).toBe(false);
    expect(resolved.assumedRole).toBe(false);
    expect(resolved.bucket).toBeNull();
  });

  it("builds a store when the bucket is set (no role → default chain)", () => {
    const sdk = wrapFakeS3AsSdk(new FakeS3ObjectStore());
    const resolved = resolveS3VaultObjectStoreFromEnv(
      { [S3_VAULT_BUCKET_ENV]: BUCKET, AWS_REGION: "us-east-1" },
      { sdk },
    );
    expect(resolved.store).toBeInstanceOf(S3VaultObjectStore);
    expect(resolved.configured).toBe(true);
    expect(resolved.assumedRole).toBe(false);
    expect(resolved.bucket).toBe(BUCKET);
    expect(resolved.region).toBe("us-east-1");
  });

  it("marks assumed_role when SANDBOX_VAULT_MOUNT_ROLE_ARN is set", () => {
    const sdk = wrapFakeS3AsSdk(new FakeS3ObjectStore());
    const resolved = resolveS3VaultObjectStoreFromEnv(
      {
        [S3_VAULT_BUCKET_ENV]: BUCKET,
        [SANDBOX_VAULT_MOUNT_ROLE_ARN_ENV]: ROLE_ARN,
      },
      { sdk, stsClient: fakeSts() },
    );
    expect(resolved.configured).toBe(true);
    expect(resolved.assumedRole).toBe(true);
    expect(resolved.roleArnConfigured).toBe(true);
  });

  it("log summary has no secrets, ARNs, or bucket name", () => {
    const resolved = resolveS3VaultObjectStoreFromEnv(
      {
        [S3_VAULT_BUCKET_ENV]: BUCKET,
        [SANDBOX_VAULT_MOUNT_ROLE_ARN_ENV]: ROLE_ARN,
        SANDBOX_VAULT_MOUNT_EXTERNAL_ID: "do-not-log-external-id",
      },
      { sdk: wrapFakeS3AsSdk(new FakeS3ObjectStore()) },
    );
    const summary = summarizeS3VaultObjectStoreForLog(resolved);
    const dumped = JSON.stringify(summary);
    expect(summary).toEqual({
      configured: true,
      assumed_role: true,
      role_arn_configured: true,
      bucket_configured: true,
      region: "us-east-1",
      duration_seconds: 3600,
    });
    expect(dumped).not.toContain(ROLE_ARN);
    expect(dumped).not.toContain(BUCKET);
    expect(dumped).not.toContain("do-not-log-external-id");
    expect(dumped).not.toMatch(/ASIA|AKIA|secret|SessionToken|ExternalId/i);
  });
});

describe("CP HTTP list/get through S3 adapter (no Daytona wake)", () => {
  it("lists and gets the tenant prefix via the adapter", async () => {
    const backing = new FakeS3ObjectStore({
      now: () => FIXED_MTIME,
    });
    backing.seed(BUCKET, `${PREFIX}AGENTS.md`, "# tenant\n", "text/markdown");
    backing.seed(
      BUCKET,
      `${PREFIX}Projects/Alpha/readme.md`,
      "hello\n",
      "text/markdown",
    );
    const store = createS3VaultObjectStore({ sdk: wrapFakeS3AsSdk(backing) });
    const ensureOnline = vi.fn(async () => {
      throw new Error("Daytona wake must not run on vault HTTP (lp-oop.37.1)");
    });
    const app = createApp({} as unknown as ControlPlaneStore, {
      devOpen: true,
      vaultObjectStore: store,
      vaultBucket: BUCKET,
      instanceOrchestrator: {
        ensureOnline,
        stop: vi.fn(),
      },
    });

    const list = await app.request(`${VAULT_HTTP_API_PATHS.list(TENANT)}?path=/`);
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      entries: Array<{ path: string; kind: string }>;
      s3_vault_prefix: string;
    };
    expect(listBody.s3_vault_prefix).toBe(PREFIX);
    expect(listBody.entries.map((entry) => entry.path).sort()).toEqual([
      "/AGENTS.md",
      "/Projects",
    ]);

    const get = await app.request(
      `${VAULT_HTTP_API_PATHS.get(TENANT)}?path=${encodeURIComponent("/AGENTS.md")}`,
    );
    expect(get.status).toBe(200);
    const getBody = (await get.json()) as { body: string; encoding: string };
    expect(getBody.body).toBe("# tenant\n");
    expect(getBody.encoding).toBe("utf-8");
    expect(ensureOnline).not.toHaveBeenCalled();
  });
});
