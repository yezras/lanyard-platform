/**
 * Durable filesystem CorpusObjectStore for MockLab / local live proof (lp-gkh.9).
 *
 * Layout under `rootDir`:
 *   {rootDir}/{bucket}/{key}
 *
 * Keys use the normative corpus path (tenants/{tid}/chat-corpus/v1/…).
 * Survives process restart — proves L10 is independent of BFF in-memory state.
 *
 * Not a production multi-host store. Production injects a real S3 adapter.
 * Never logs object bodies (may contain full chat I/O).
 */

import {
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type {
  CorpusListedObject,
  CorpusListObjectsResult,
  CorpusObjectStore,
} from "./object-store.js";

export type FsCorpusObjectStoreOptions = {
  /**
   * Absolute directory that holds `{bucket}/{key}` trees.
   * Created on first put when missing.
   */
  rootDir: string;
};

function assertSafeRelativeKey(key: string): string {
  const normalized = key.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized) {
    throw new Error("FsCorpusObjectStore: key must be non-empty");
  }
  if (normalized.includes("\0")) {
    throw new Error("FsCorpusObjectStore: key must not contain NUL");
  }
  const segments = normalized.split("/");
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") {
      throw new Error(
        `FsCorpusObjectStore: key segment "${seg}" is not allowed`,
      );
    }
  }
  return normalized;
}

function assertSafeBucket(bucket: string): string {
  const b = bucket.trim();
  if (!b) {
    throw new Error("FsCorpusObjectStore: bucket is required");
  }
  if (b.includes("/") || b.includes("\\") || b.includes("\0") || b === ".." || b === ".") {
    throw new Error("FsCorpusObjectStore: bucket must be a bare name");
  }
  return b;
}

/**
 * Filesystem-backed S3 port. PutObject is durable across process restarts.
 */
export class FsCorpusObjectStore implements CorpusObjectStore {
  private readonly rootDir: string;

  constructor(options: FsCorpusObjectStoreOptions) {
    const root = options.rootDir?.trim();
    if (!root) {
      throw new Error("FsCorpusObjectStore: rootDir is required");
    }
    this.rootDir = path.resolve(root);
  }

  /** Absolute path for a bucket+key pair (for ops/debug — never log body). */
  resolvePath(bucket: string, key: string): string {
    const b = assertSafeBucket(bucket);
    const k = assertSafeRelativeKey(key);
    return path.join(this.rootDir, b, ...k.split("/"));
  }

  getRootDir(): string {
    return this.rootDir;
  }

  async getObject(input: {
    bucket: string;
    key: string;
  }): Promise<string | null> {
    const filePath = this.resolvePath(input.bucket, input.key);
    try {
      return await readFile(filePath, "utf8");
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: unknown }).code)
          : "";
      if (code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  async putObject(input: {
    bucket: string;
    key: string;
    body: string;
    contentType?: string;
  }): Promise<void> {
    const filePath = this.resolvePath(input.bucket, input.key);
    await mkdir(path.dirname(filePath), { recursive: true });
    // Atomic-ish: write then rename would be better; single write is enough
    // for lab proof (same process won't interleave the same turn_id).
    await writeFile(filePath, input.body, { encoding: "utf8", mode: 0o600 });
  }

  async listObjects(input: {
    bucket: string;
    prefix: string;
    continuationToken?: string;
    maxKeys?: number;
  }): Promise<CorpusListObjectsResult> {
    const b = assertSafeBucket(input.bucket);
    const prefix = (input.prefix ?? "").replace(/\\/g, "/").replace(/^\/+/, "");
    if (prefix) {
      assertSafeRelativeKey(prefix.endsWith("/") ? prefix.slice(0, -1) : prefix);
    }
    const maxKeys =
      input.maxKeys !== undefined && input.maxKeys > 0
        ? Math.min(Math.floor(input.maxKeys), 1000)
        : 1000;

    const bucketRoot = path.join(this.rootDir, b);
    const all: CorpusListedObject[] = [];
    await this.walkFiles(bucketRoot, "", all);

    const filtered = all
      .filter((o) => (prefix ? o.key.startsWith(prefix) : true))
      .sort((a, c) => (a.key < c.key ? -1 : a.key > c.key ? 1 : 0));

    const start = input.continuationToken
      ? Number.parseInt(input.continuationToken, 10)
      : 0;
    const offset =
      Number.isFinite(start) && start >= 0 ? Math.floor(start) : 0;
    const page = filtered.slice(offset, offset + maxKeys);
    const next = offset + page.length;
    return {
      objects: page,
      continuationToken: next < filtered.length ? String(next) : undefined,
    };
  }

  private async walkFiles(
    absDir: string,
    relPrefix: string,
    out: CorpusListedObject[],
  ): Promise<void> {
    let names: string[];
    try {
      names = await readdir(absDir);
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: unknown }).code)
          : "";
      if (code === "ENOENT") {
        return;
      }
      throw err;
    }
    for (const name of names) {
      const rel = relPrefix ? `${relPrefix}/${name}` : name;
      const abs = path.join(absDir, name);
      const st = await stat(abs);
      if (st.isDirectory()) {
        await this.walkFiles(abs, rel, out);
      } else if (st.isFile()) {
        out.push({ key: rel.replace(/\\/g, "/"), size: st.size });
      }
    }
  }
}
