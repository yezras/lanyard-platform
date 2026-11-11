/**
 * lp-oop.8 — CP vault store tests on FakeS3.
 * List pagination + get bytes. No HTTP. No live S3. No @aws-sdk/client-s3.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { FakeS3ObjectStore } from "../src/fake-s3-object-store.js";
import type {
  VaultObjectListInput,
  VaultObjectListPage,
} from "../src/vault-prefix.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fakeSrc = readFileSync(
  join(__dirname, "../src/fake-s3-object-store.ts"),
  "utf8",
);
const testSrc = readFileSync(fileURLToPath(import.meta.url), "utf8");
const cpPkg = JSON.parse(
  readFileSync(join(__dirname, "../package.json"), "utf8"),
) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

const BUCKET = "lanyard-mocklab-vault-test";
const OTHER_BUCKET = "lanyard-other-vault-test";
const PREFIX = "tenants/mocklab/vault/";
const OTHER_PREFIX = "tenants/other/vault/";
const FIXED_NOW = () => new Date("2026-08-14T00:00:00.000Z");

function md5Hex(body: string): string {
  return createHash("md5").update(body, "utf8").digest("hex");
}

function seedKeys(
  store: FakeS3ObjectStore,
  keys: string[],
  bodyFor: (key: string, i: number) => string = (_key, i) => `body-${i}`,
): void {
  keys.forEach((key, i) => {
    store.seed(BUCKET, key, bodyFor(key, i), "text/plain");
  });
}

async function collectPages(
  store: FakeS3ObjectStore,
  input: Omit<VaultObjectListInput, "cursor">,
): Promise<VaultObjectListPage[]> {
  const pages: VaultObjectListPage[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 64; i += 1) {
    const page = await store.listPrefix({ ...input, cursor });
    pages.push(page);
    if (!page.truncated) {
      expect(page.next_cursor).toBeUndefined();
      return pages;
    }
    expect(page.next_cursor).toEqual(expect.any(String));
    expect(String(page.next_cursor).length).toBeGreaterThan(0);
    cursor = page.next_cursor;
  }
  throw new Error("listPrefix pagination did not terminate");
}

describe("FakeS3 stays offline (lp-oop.8)", () => {
  it("does not import live S3 or @aws-sdk/client-s3", () => {
    expect(cpPkg.dependencies?.["@aws-sdk/lib-storage"]).toBeUndefined();
    expect(fakeSrc).not.toMatch(/from ["']@aws-sdk/);
    expect(fakeSrc).toMatch(/No network, no AWS SDK/);
    expect(testSrc).not.toMatch(/from ["']@aws-sdk/);
    expect(fakeSrc).not.toMatch(/\bS3Client\b/);
    // Live adapter is s3-vault-object-store.ts (lp-oop.37.1), not FakeS3.
  });
});

describe("FakeS3 list pagination (lp-oop.8)", () => {
  it("walks next_cursor until the last page", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    const keys = ["a.md", "b.md", "c.md", "d.md", "e.md", "f.md", "g.md"].map(
      (name) => `${PREFIX}${name}`,
    );
    seedKeys(store, keys);

    const pages = await collectPages(store, {
      bucket: BUCKET,
      prefix: PREFIX,
      maxKeys: 3,
    });

    expect(pages).toHaveLength(3);
    expect(pages.map((p) => p.objects.map((o) => o.key))).toEqual([
      [`${PREFIX}a.md`, `${PREFIX}b.md`, `${PREFIX}c.md`],
      [`${PREFIX}d.md`, `${PREFIX}e.md`, `${PREFIX}f.md`],
      [`${PREFIX}g.md`],
    ]);
    expect(pages[0]).toMatchObject({
      prefix: PREFIX,
      truncated: true,
      next_cursor: "3",
    });
    expect(pages[1]).toMatchObject({
      truncated: true,
      next_cursor: "6",
    });
    expect(pages[2]).toMatchObject({
      truncated: false,
    });
    expect(pages[2]?.next_cursor).toBeUndefined();

    const union = pages.flatMap((p) => p.objects.map((o) => o.key));
    expect(union).toEqual(keys);
    expect(new Set(union).size).toBe(keys.length);
    expect(store.getListCount()).toBe(3);
  });

  it("maxKeys=1 yields one object per page", async () => {
    const store = new FakeS3ObjectStore();
    const keys = [`${PREFIX}x.md`, `${PREFIX}y.md`, `${PREFIX}z.md`];
    seedKeys(store, keys);

    const pages = await collectPages(store, {
      bucket: BUCKET,
      prefix: PREFIX,
      maxKeys: 1,
    });
    expect(pages).toHaveLength(3);
    expect(pages.every((p) => p.objects.length === 1)).toBe(true);
    expect(pages.flatMap((p) => p.objects.map((o) => o.key))).toEqual(keys);
    expect(pages[0]?.next_cursor).toBe("1");
    expect(pages[1]?.next_cursor).toBe("2");
    expect(pages[2]?.truncated).toBe(false);
  });

  it("empty prefix lists the whole bucket in lex order", async () => {
    const store = new FakeS3ObjectStore();
    store.seed(BUCKET, `${PREFIX}readme.md`, "a");
    store.seed(BUCKET, "tenants/mocklab/_platform/marker.json", "{}");
    store.seed(OTHER_BUCKET, `${PREFIX}readme.md`, "other");

    const page = await store.listPrefix({ bucket: BUCKET, prefix: "" });
    expect(page.prefix).toBe("");
    expect(page.truncated).toBe(false);
    expect(page.objects.map((o) => o.key)).toEqual([
      "tenants/mocklab/_platform/marker.json",
      `${PREFIX}readme.md`,
    ]);
  });

  it("unknown tenant prefix is an empty page, not an error", async () => {
    const store = new FakeS3ObjectStore();
    store.seed(BUCKET, `${PREFIX}readme.md`, "# hi\n");

    const page = await store.listPrefix({
      bucket: BUCKET,
      prefix: OTHER_PREFIX,
    });
    expect(page).toEqual({
      prefix: OTHER_PREFIX,
      objects: [],
      truncated: false,
    });
  });

  it("does not include sibling prefixes", async () => {
    const store = new FakeS3ObjectStore();
    store.seed(BUCKET, `${PREFIX}readme.md`, "a");
    store.seed(BUCKET, `${OTHER_PREFIX}secret.md`, "nope");
    store.seed(BUCKET, "tenants/mocklab/vault-backup/x.md", "nope");

    const page = await store.listPrefix({ bucket: BUCKET, prefix: PREFIX });
    expect(page.objects.map((o) => o.key)).toEqual([`${PREFIX}readme.md`]);
  });

  it("pages stay lexicographic even when seeded out of order", async () => {
    const store = new FakeS3ObjectStore();
    seedKeys(store, [`${PREFIX}m.md`, `${PREFIX}a.md`, `${PREFIX}z.md`]);

    const pages = await collectPages(store, {
      bucket: BUCKET,
      prefix: PREFIX,
      maxKeys: 2,
    });
    expect(pages.flatMap((p) => p.objects.map((o) => o.key))).toEqual([
      `${PREFIX}a.md`,
      `${PREFIX}m.md`,
      `${PREFIX}z.md`,
    ]);
  });

  it("paginates mixed objects and common prefixes under delimiter", async () => {
    const store = new FakeS3ObjectStore();
    store.seed(BUCKET, `${PREFIX}a.txt`, "a");
    store.seed(BUCKET, `${PREFIX}docs/1.md`, "1");
    store.seed(BUCKET, `${PREFIX}docs/2.md`, "2");
    store.seed(BUCKET, `${PREFIX}z.txt`, "z");

    const pages = await collectPages(store, {
      bucket: BUCKET,
      prefix: PREFIX,
      delimiter: "/",
      maxKeys: 2,
    });

    expect(pages).toHaveLength(2);
    expect(pages[0]?.objects.map((o) => o.key)).toEqual([`${PREFIX}a.txt`]);
    expect(pages[0]?.common_prefixes).toEqual([`${PREFIX}docs/`]);
    expect(pages[0]?.truncated).toBe(true);
    expect(pages[0]?.next_cursor).toBe("2");
    expect(pages[1]?.objects.map((o) => o.key)).toEqual([`${PREFIX}z.txt`]);
    expect(pages[1]?.common_prefixes).toEqual([]);
    expect(pages[1]?.truncated).toBe(false);
  });

  it("treats maxKeys 0 or negative as the default page size", async () => {
    const store = new FakeS3ObjectStore();
    const keys = Array.from({ length: 5 }, (_, i) => `${PREFIX}${i}.md`);
    seedKeys(store, keys);

    for (const maxKeys of [0, -3]) {
      const page = await store.listPrefix({
        bucket: BUCKET,
        prefix: PREFIX,
        maxKeys,
      });
      expect(page.objects).toHaveLength(5);
      expect(page.truncated).toBe(false);
      expect(page.next_cursor).toBeUndefined();
    }
  });

  it("caps maxKeys at 1000 and continues with next_cursor", async () => {
    const store = new FakeS3ObjectStore();
    const keys = Array.from(
      { length: 1001 },
      (_, i) => `${PREFIX}${String(i).padStart(4, "0")}.md`,
    );
    seedKeys(store, keys);

    const first = await store.listPrefix({
      bucket: BUCKET,
      prefix: PREFIX,
      maxKeys: 5000,
    });
    expect(first.objects).toHaveLength(1000);
    expect(first.truncated).toBe(true);
    expect(first.next_cursor).toBe("1000");

    const second = await store.listPrefix({
      bucket: BUCKET,
      prefix: PREFIX,
      maxKeys: 5000,
      cursor: first.next_cursor,
    });
    expect(second.objects).toHaveLength(1);
    expect(second.truncated).toBe(false);
    expect(second.objects[0]?.key).toBe(`${PREFIX}1000.md`);
    expect(
      [...first.objects, ...second.objects].map((o) => o.key),
    ).toEqual(keys);
  });

  it("invalid cursor starts at offset 0", async () => {
    const store = new FakeS3ObjectStore();
    seedKeys(store, [`${PREFIX}a.md`, `${PREFIX}b.md`]);

    const page = await store.listPrefix({
      bucket: BUCKET,
      prefix: PREFIX,
      maxKeys: 1,
      cursor: "not-a-number",
    });
    expect(page.objects.map((o) => o.key)).toEqual([`${PREFIX}a.md`]);
    expect(page.truncated).toBe(true);
    expect(page.next_cursor).toBe("1");
  });

  it("cursor past the end is an empty untruncated page", async () => {
    const store = new FakeS3ObjectStore();
    seedKeys(store, [`${PREFIX}a.md`]);

    const page = await store.listPrefix({
      bucket: BUCKET,
      prefix: PREFIX,
      cursor: "9",
    });
    expect(page.objects).toEqual([]);
    expect(page.truncated).toBe(false);
    expect(page.next_cursor).toBeUndefined();
  });

  it("empty store lists an empty untruncated page", async () => {
    const store = new FakeS3ObjectStore();
    const page = await store.listPrefix({ bucket: BUCKET, prefix: PREFIX });
    expect(page).toEqual({
      prefix: PREFIX,
      objects: [],
      truncated: false,
    });
  });
});

describe("FakeS3 get bytes (lp-oop.8)", () => {
  it("returns exact UTF-8 bytes, size, etag, and content type", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    const key = `${PREFIX}note.md`;
    const body = "café 🎉\n";
    const size = Buffer.byteLength(body, "utf8");
    expect(size).toBeGreaterThan(body.length);

    await store.putObject({
      bucket: BUCKET,
      key,
      body,
      contentType: "text/markdown; charset=utf-8",
    });

    const hit = await store.getObject({ bucket: BUCKET, key });
    expect(hit).toEqual({
      found: true,
      bucket: BUCKET,
      key,
      body,
      contentType: "text/markdown; charset=utf-8",
      size_bytes: size,
      etag: md5Hex(body),
      mtime: "2026-08-14T00:00:00.000Z",
    });
    if (hit.found) {
      expect(Buffer.from(hit.body, "utf8").equals(Buffer.from(body, "utf8"))).toBe(
        true,
      );
    }
  });

  it("returns an empty body with size 0", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    const key = `${PREFIX}empty.txt`;
    store.seed(BUCKET, key, "", "text/plain");

    const hit = await store.getObject({ bucket: BUCKET, key });
    expect(hit).toEqual({
      found: true,
      bucket: BUCKET,
      key,
      body: "",
      contentType: "text/plain",
      size_bytes: 0,
      etag: md5Hex(""),
      mtime: "2026-08-14T00:00:00.000Z",
    });
  });

  it("list etag and size match getObject for the same key", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    const key = `${PREFIX}readme.md`;
    const body = "# title\n\nbody";
    store.seed(BUCKET, key, body, "text/markdown");

    const page = await store.listPrefix({ bucket: BUCKET, prefix: PREFIX });
    const hit = await store.getObject({ bucket: BUCKET, key });
    expect(hit.found).toBe(true);
    if (!hit.found) {
      return;
    }
    expect(page.objects[0]).toEqual({
      key,
      size_bytes: hit.size_bytes,
      etag: hit.etag,
      mtime: hit.mtime,
    });
    expect(hit.etag).toBe(md5Hex(body));
    expect(hit.size_bytes).toBe(Buffer.byteLength(body, "utf8"));
  });

  it("overwrite returns the new bytes and a new etag", async () => {
    const store = new FakeS3ObjectStore({ now: FIXED_NOW });
    const key = `${PREFIX}note.txt`;
    await store.putObject({
      bucket: BUCKET,
      key,
      body: "v1",
      contentType: "text/plain",
    });
    const first = await store.getObject({ bucket: BUCKET, key });
    await store.putObject({
      bucket: BUCKET,
      key,
      body: "v2-longer",
      contentType: "text/plain",
    });
    const second = await store.getObject({ bucket: BUCKET, key });

    expect(first.found).toBe(true);
    expect(second.found).toBe(true);
    if (!first.found || !second.found) {
      return;
    }
    expect(first.body).toBe("v1");
    expect(second.body).toBe("v2-longer");
    expect(second.etag).toBe(md5Hex("v2-longer"));
    expect(second.etag).not.toBe(first.etag);
    expect(second.size_bytes).toBe(Buffer.byteLength("v2-longer", "utf8"));
  });

  it("missing key is a typed miss, including empty and other-bucket keys", async () => {
    const store = new FakeS3ObjectStore();
    store.seed(BUCKET, `${PREFIX}readme.md`, "# hi\n");

    const missing = await store.getObject({
      bucket: BUCKET,
      key: `${PREFIX}missing.md`,
    });
    const otherBucket = await store.getObject({
      bucket: OTHER_BUCKET,
      key: `${PREFIX}readme.md`,
    });
    const emptyKey = await store.getObject({ bucket: BUCKET, key: "" });

    expect(missing).toEqual({
      found: false,
      bucket: BUCKET,
      key: `${PREFIX}missing.md`,
    });
    expect(otherBucket).toEqual({
      found: false,
      bucket: OTHER_BUCKET,
      key: `${PREFIX}readme.md`,
    });
    expect(emptyKey).toEqual({ found: false, bucket: BUCKET, key: "" });
    expect(store.getGetCount()).toBe(3);
  });

  it("configured error throws on list and get instead of a typed miss", async () => {
    const store = new FakeS3ObjectStore({ error: "s3 down" });
    store.seed(BUCKET, `${PREFIX}readme.md`, "x");

    await expect(
      store.listPrefix({ bucket: BUCKET, prefix: PREFIX }),
    ).rejects.toThrow("s3 down");
    await expect(
      store.getObject({ bucket: BUCKET, key: `${PREFIX}readme.md` }),
    ).rejects.toThrow("s3 down");
    await expect(
      store.getObject({ bucket: BUCKET, key: `${PREFIX}missing.md` }),
    ).rejects.toThrow("s3 down");
  });
});
