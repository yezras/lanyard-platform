/**
 * In-memory {@link VaultObjectStore} for unit tests (lp-jt5).
 * Also implements {@link VaultGcObjectStore} for optional deprovision GC (lp-e96).
 * listPrefix + getObject read the same map (lp-oop.6). Missing keys are a
 * typed miss — not an exception.
 * No network, no AWS SDK, no credentials.
 */

import { createHash } from "node:crypto";

import type { VaultGcObjectStore } from "./deprovision-daytona.js";
import type {
  VaultObjectGetResult,
  VaultObjectListEntry,
  VaultObjectListInput,
  VaultObjectListPage,
  VaultObjectStore,
} from "./vault-prefix.js";

export type FakeS3ObjectRecord = {
  body: string;
  contentType: string;
  /** ISO timestamp of last put. */
  updatedAt: string;
};

export type FakeS3ObjectStoreOptions = {
  now?: () => Date;
  /**
   * When set, head / put / get / list / delete throw (string message or Error).
   * Cleared via {@link FakeS3ObjectStore.clearError}.
   */
  error?: string | Error | (() => string | Error);
};

const DEFAULT_LIST_MAX_KEYS = 1000;

function objectMapKey(bucket: string, key: string): string {
  return `${bucket}\0${key}`;
}

function parseObjectMapKey(mapKey: string): { bucket: string; key: string } {
  const sep = mapKey.indexOf("\0");
  return { bucket: mapKey.slice(0, sep), key: mapKey.slice(sep + 1) };
}

function objectByteLength(body: string): number {
  return Buffer.byteLength(body, "utf8");
}

function objectEtag(body: string): string {
  return createHash("md5").update(body, "utf8").digest("hex");
}

function listPageLimit(maxKeys?: number): number {
  if (maxKeys !== undefined && maxKeys > 0) {
    return Math.min(Math.floor(maxKeys), DEFAULT_LIST_MAX_KEYS);
  }
  return DEFAULT_LIST_MAX_KEYS;
}

function listPageOffset(cursor?: string): number {
  if (!cursor) {
    return 0;
  }
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

type FakeS3ListItem =
  | { kind: "object"; sortKey: string; entry: VaultObjectListEntry }
  | { kind: "prefix"; sortKey: string; prefix: string };

/**
 * Pure in-memory S3 object map. Safe for single-process unit tests.
 */
export class FakeS3ObjectStore implements VaultObjectStore, VaultGcObjectStore {
  private readonly objects = new Map<string, FakeS3ObjectRecord>();
  private readonly now: () => Date;
  private error: string | Error | (() => string | Error) | null;
  private headCount = 0;
  private putCount = 0;
  private getCount = 0;
  private deleteCount = 0;
  private listCount = 0;

  constructor(options: FakeS3ObjectStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.error = options.error ?? null;
  }

  async headObject(input: {
    bucket: string;
    key: string;
  }): Promise<boolean> {
    this.throwIfConfigured();
    this.headCount += 1;
    return this.objects.has(objectMapKey(input.bucket, input.key));
  }

  async putObject(input: {
    bucket: string;
    key: string;
    body: string;
    contentType?: string;
  }): Promise<void> {
    this.throwIfConfigured();
    this.putCount += 1;
    this.objects.set(objectMapKey(input.bucket, input.key), {
      body: input.body,
      contentType: input.contentType ?? "application/octet-stream",
      updatedAt: this.now().toISOString(),
    });
  }

  /**
   * List objects under `prefix` from the in-memory map (lp-oop.6).
   * Empty prefix lists the bucket. `delimiter` groups remaining path
   * segments as S3 common prefixes. `cursor` is a 0-based offset string.
   */
  async listPrefix(input: VaultObjectListInput): Promise<VaultObjectListPage> {
    this.throwIfConfigured();
    this.listCount += 1;
    const prefix = input.prefix ?? "";
    const delimiter = input.delimiter;
    const items: FakeS3ListItem[] = [];
    const seenPrefixes = new Set<string>();

    for (const [mapKey, rec] of this.objects.entries()) {
      const { bucket, key } = parseObjectMapKey(mapKey);
      if (bucket !== input.bucket) {
        continue;
      }
      if (prefix && !key.startsWith(prefix)) {
        continue;
      }
      if (delimiter) {
        const rest = key.slice(prefix.length);
        const delimAt = rest.indexOf(delimiter);
        if (delimAt >= 0) {
          const common = prefix + rest.slice(0, delimAt + delimiter.length);
          if (!seenPrefixes.has(common)) {
            seenPrefixes.add(common);
            items.push({ kind: "prefix", sortKey: common, prefix: common });
          }
          continue;
        }
      }
      items.push({
        kind: "object",
        sortKey: key,
        entry: {
          key,
          size_bytes: objectByteLength(rec.body),
          etag: objectEtag(rec.body),
          mtime: rec.updatedAt,
        },
      });
    }

    items.sort((a, b) =>
      a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0,
    );

    const limit = listPageLimit(input.maxKeys);
    const offset = listPageOffset(input.cursor);
    const page = items.slice(offset, offset + limit);
    const next = offset + page.length;
    const truncated = next < items.length;
    const objects: VaultObjectListEntry[] = [];
    const commonPrefixes: string[] = [];
    for (const item of page) {
      if (item.kind === "object") {
        objects.push(item.entry);
      } else {
        commonPrefixes.push(item.prefix);
      }
    }

    return {
      prefix,
      objects,
      ...(delimiter !== undefined ? { common_prefixes: commonPrefixes } : {}),
      ...(truncated ? { next_cursor: String(next) } : {}),
      truncated,
    };
  }

  /**
   * Return object bytes + metadata from the in-memory map (lp-oop.6).
   * Missing keys are `{ found: false }` — not an exception.
   */
  async getObject(input: {
    bucket: string;
    key: string;
  }): Promise<VaultObjectGetResult> {
    this.throwIfConfigured();
    this.getCount += 1;
    const rec = this.objects.get(objectMapKey(input.bucket, input.key));
    if (!rec) {
      return {
        found: false,
        bucket: input.bucket,
        key: input.key,
      };
    }
    return {
      found: true,
      bucket: input.bucket,
      key: input.key,
      body: rec.body,
      contentType: rec.contentType,
      size_bytes: objectByteLength(rec.body),
      etag: objectEtag(rec.body),
      mtime: rec.updatedAt,
    };
  }

  /** lp-e96: list keys under prefix for optional vault GC tests. */
  async listKeysUnderPrefix(input: {
    bucket: string;
    prefix: string;
  }): Promise<string[]> {
    this.throwIfConfigured();
    this.listCount += 1;
    const prefix = input.prefix;
    const out: string[] = [];
    for (const mapKey of this.objects.keys()) {
      const { bucket, key } = parseObjectMapKey(mapKey);
      if (bucket === input.bucket && key.startsWith(prefix)) {
        out.push(key);
      }
    }
    return out.sort();
  }

  /** lp-e96: delete one object (idempotent if missing). */
  async deleteObject(input: {
    bucket: string;
    key: string;
  }): Promise<void> {
    this.throwIfConfigured();
    this.deleteCount += 1;
    this.objects.delete(objectMapKey(input.bucket, input.key));
  }

  /** Test helper: seed an object without going through putObject counters. */
  seed(bucket: string, key: string, body = "", contentType = "application/json"): void {
    this.objects.set(objectMapKey(bucket, key), {
      body,
      contentType,
      updatedAt: this.now().toISOString(),
    });
  }

  get(bucket: string, key: string): FakeS3ObjectRecord | undefined {
    return this.objects.get(objectMapKey(bucket, key));
  }

  has(bucket: string, key: string): boolean {
    return this.objects.has(objectMapKey(bucket, key));
  }

  listKeys(bucket?: string): string[] {
    const out: string[] = [];
    for (const mapKey of this.objects.keys()) {
      const parsed = parseObjectMapKey(mapKey);
      if (bucket === undefined || parsed.bucket === bucket) {
        out.push(
          bucket === undefined ? `${parsed.bucket}/${parsed.key}` : parsed.key,
        );
      }
    }
    return out.sort();
  }

  getHeadCount(): number {
    return this.headCount;
  }

  getPutCount(): number {
    return this.putCount;
  }

  getGetCount(): number {
    return this.getCount;
  }

  getDeleteCount(): number {
    return this.deleteCount;
  }

  getListCount(): number {
    return this.listCount;
  }

  setError(error: string | Error | (() => string | Error) | null): void {
    this.error = error;
  }

  clearError(): void {
    this.error = null;
  }

  clear(): void {
    this.objects.clear();
    this.headCount = 0;
    this.putCount = 0;
    this.getCount = 0;
    this.deleteCount = 0;
    this.listCount = 0;
  }

  private throwIfConfigured(): void {
    if (!this.error) {
      return;
    }
    const raw =
      typeof this.error === "function" ? this.error() : this.error;
    throw raw instanceof Error ? raw : new Error(raw);
  }
}
