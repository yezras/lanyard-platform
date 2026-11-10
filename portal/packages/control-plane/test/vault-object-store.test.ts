/**
 * lp-oop.6 — FakeS3 listPrefix + getObject on the in-memory map.
 * Missing key is a typed miss. No HTTP. No live S3. No @aws-sdk in BFF.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { FakeS3ObjectStore } from "../src/fake-s3-object-store.js";
import {
  type VaultObjectGetResult,
  type VaultObjectListPage,
  type VaultObjectStore,
} from "../src/vault-prefix.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(join(__dirname, "../src/index.ts"), "utf8");
const vaultSrc = readFileSync(join(__dirname, "../src/vault-prefix.ts"), "utf8");
const fakeSrc = readFileSync(
  join(__dirname, "../src/fake-s3-object-store.ts"),
  "utf8",
);
const bffPkg = JSON.parse(
  readFileSync(
    join(__dirname, "../../bff/package.json"),
    "utf8",
  ),
) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

const BUCKET = "lanyard-mocklab-vault-test";
const OTHER_BUCKET = "lanyard-other-vault-test";
const FIXED_NOW = () => new Date("2026-08-14T00:00:00.000Z");

describe("VaultObjectStore port (lp-oop.4)", () => {
  it("declares listPrefix + getObject on the port", () => {
    expect(vaultSrc).toMatch(/listPrefix\(input: VaultObjectListInput\)/);
    expect(vaultSrc).toMatch(/getObject\(input: \{/);
    expect(vaultSrc).toContain("VaultObjectListPage");
    expect(vaultSrc).toContain("VaultObjectGetResult");
    expect(vaultSrc).toContain("found: false");
  });

  it("exports list/get types from the package index", () => {
    expect(indexSrc).toContain("VaultObjectStore");
    expect(indexSrc).toContain("VaultObjectListPage");
    expect(indexSrc).toContain("VaultObjectGetResult");
    expect(indexSrc).toContain("VaultObjectStoreNotImplementedError");
  });

  it("assigns FakeS3ObjectStore to the grown port", () => {
    const store: VaultObjectStore = new FakeS3ObjectStore();
    expect(typeof store.headObject).toBe("function");
    expect(typeof store.putObject).toBe("function");
    expect(typeof store.listPrefix).toBe("function");
    expect(typeof store.getObject).toBe("function");
  });

  it("does not add an S3 AWS SDK to BFF", () => {
    const deps = {
      ...bffPkg.dependencies,
      ...bffPkg.devDependencies,
    };
    expect(
      Object.keys(deps).some(
        (name) =>
          name.startsWith("@aws-sdk/client-s3") ||
          name.startsWith("@aws-sdk/lib-storage"),
      ),
    ).toBe(false);
    expect(vaultSrc).toMatch(/No @aws-sdk in BFF/);
    expect(vaultSrc).not.toMatch(/from ["']@aws-sdk/);
  });
});

describe("FakeS3 list/get (lp-oop.6)", () => {
  it("put then listPrefix + getObject roundtrip", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    const key = "tenants/mocklab/vault/readme.md";
    const body = "# hi\n";
    await store.putObject({
      bucket: BUCKET,
      key,
      body,
      contentType: "text/markdown",
    });

    const page = await store.listPrefix({
      bucket: BUCKET,
      prefix: "tenants/mocklab/vault/",
    });
    expect(page.prefix).toBe("tenants/mocklab/vault/");
    expect(page.truncated).toBe(false);
    expect(page.next_cursor).toBeUndefined();
    expect(page.objects).toEqual([
      {
        key,
        size_bytes: Buffer.byteLength(body, "utf8"),
        etag: expect.any(String),
        mtime: "2026-08-14T00:00:00.000Z",
      },
    ]);

    const hit = await store.getObject({ bucket: BUCKET, key });
    expect(hit).toEqual({
      found: true,
      bucket: BUCKET,
      key,
      body,
      contentType: "text/markdown",
      size_bytes: Buffer.byteLength(body, "utf8"),
      etag: page.objects[0]?.etag,
      mtime: "2026-08-14T00:00:00.000Z",
    });
    expect(store.getListCount()).toBe(1);
    expect(store.getGetCount()).toBe(1);
    expect(fakeSrc).toMatch(/typed miss/);
  });

  it("missing key is a typed miss (does not throw)", async () => {
    const store = new FakeS3ObjectStore();
    store.seed(BUCKET, "tenants/mocklab/vault/readme.md", "# hi\n");
    const miss = await store.getObject({
      bucket: BUCKET,
      key: "tenants/mocklab/vault/missing.md",
    });
    expect(miss).toEqual({
      found: false,
      bucket: BUCKET,
      key: "tenants/mocklab/vault/missing.md",
    });
    expect(store.getGetCount()).toBe(1);
  });

  it("does not leak keys across buckets", async () => {
    const store = new FakeS3ObjectStore();
    const key = "tenants/mocklab/vault/readme.md";
    store.seed(BUCKET, key, "a");
    store.seed(OTHER_BUCKET, key, "b");

    const page = await store.listPrefix({
      bucket: BUCKET,
      prefix: "tenants/mocklab/vault/",
    });
    expect(page.objects.map((o) => o.key)).toEqual([key]);

    const hit = await store.getObject({ bucket: OTHER_BUCKET, key });
    expect(hit.found).toBe(true);
    if (hit.found) {
      expect(hit.body).toBe("b");
    }
  });

  it("groups delimiter remainder as common prefixes", async () => {
    const store = new FakeS3ObjectStore();
    store.seed(BUCKET, "tenants/mocklab/vault/readme.md", "root");
    store.seed(BUCKET, "tenants/mocklab/vault/docs/a.md", "a");
    store.seed(BUCKET, "tenants/mocklab/vault/docs/b.md", "b");

    const page = await store.listPrefix({
      bucket: BUCKET,
      prefix: "tenants/mocklab/vault/",
      delimiter: "/",
    });
    expect(page.objects.map((o) => o.key)).toEqual([
      "tenants/mocklab/vault/readme.md",
    ]);
    expect(page.common_prefixes).toEqual(["tenants/mocklab/vault/docs/"]);
    expect(page.truncated).toBe(false);
  });

  it("headObject / putObject still work on the same store", async () => {
    const store = new FakeS3ObjectStore();
    const key = "tenants/mocklab/vault/note.txt";
    expect(await store.headObject({ bucket: BUCKET, key })).toBe(false);
    await store.putObject({
      bucket: BUCKET,
      key,
      body: "hello",
      contentType: "text/plain",
    });
    expect(await store.headObject({ bucket: BUCKET, key })).toBe(true);
    expect(store.get(BUCKET, key)?.body).toBe("hello");
    expect(store.getPutCount()).toBe(1);
    expect(store.getHeadCount()).toBe(2);
  });
});

describe("list/get result types (compile-time shapes)", () => {
  it("typed miss is found:false, hit carries body + size", () => {
    const miss: VaultObjectGetResult = {
      found: false,
      bucket: BUCKET,
      key: "tenants/mocklab/vault/missing.md",
    };
    const hit: VaultObjectGetResult = {
      found: true,
      bucket: BUCKET,
      key: "tenants/mocklab/vault/readme.md",
      body: "# hi\n",
      contentType: "text/markdown",
      size_bytes: 5,
      etag: "abc",
      mtime: "2026-08-14T00:00:00.000Z",
    };
    const page: VaultObjectListPage = {
      prefix: "tenants/mocklab/vault/",
      objects: [
        {
          key: "tenants/mocklab/vault/readme.md",
          size_bytes: 5,
          etag: "abc",
          mtime: "2026-08-14T00:00:00.000Z",
        },
      ],
      common_prefixes: ["tenants/mocklab/vault/docs/"],
      truncated: false,
    };
    expect(miss.found).toBe(false);
    expect(hit.found).toBe(true);
    expect(page.objects).toHaveLength(1);
    if (hit.found) {
      expect(hit.size_bytes).toBe(5);
    }
  });
});
