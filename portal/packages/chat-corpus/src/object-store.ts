/**
 * Minimal S3 object port for CorpusWriter (lp-gkh.4) and training export
 * (lp-gkh.8).
 *
 * Real AWS is injected by the host (BFF / deploy / export job wiring); unit
 * tests use {@link FakeCorpusObjectStore}. No @aws-sdk dependency in this
 * package.
 */

/** One object returned from a prefix list (ListObjectsV2-style). */
export type CorpusListedObject = {
  /** Relative object key (no bucket, no s3://). */
  key: string;
  /** Byte size when known. */
  size?: number;
};

/** Page of list results; empty `continuationToken` means end of listing. */
export type CorpusListObjectsResult = {
  objects: CorpusListedObject[];
  /**
   * Opaque token for the next page. Omit / undefined when no more pages.
   * Callers must pass this back as `continuationToken` unchanged.
   */
  continuationToken?: string;
};

/**
 * Object-store operations for corpus PutObject + training export list/get.
 * Implementations must not log secret credentials.
 *
 * Writers only need `getObject` + `putObject`. Export / reader paths also
 * require {@link CorpusObjectStore.listObjects}.
 */
export type CorpusObjectStore = {
  /**
   * Return object body when present, otherwise `null` (not-found).
   * Propagate / throw only for unexpected store failures (writer catches).
   */
  getObject(input: { bucket: string; key: string }): Promise<string | null>;
  /**
   * Put object bytes. Idempotent callers may put the same key twice.
   */
  putObject(input: {
    bucket: string;
    key: string;
    body: string;
    contentType?: string;
  }): Promise<void>;
  /**
   * List object keys under a prefix (training export / ops). Optional for
   * pure writer adapters; export paths require it and fail closed when missing.
   */
  listObjects?(input: {
    bucket: string;
    prefix: string;
    continuationToken?: string;
    /** Page size hint (store may cap). */
    maxKeys?: number;
  }): Promise<CorpusListObjectsResult>;
};

export type FakeCorpusObjectRecord = {
  body: string;
  contentType: string;
  /** ISO timestamp of last put. */
  updatedAt: string;
};

export type FakeCorpusObjectStoreOptions = {
  now?: () => Date;
  /**
   * When set, getObject / putObject throw (string message or Error).
   * Cleared via {@link FakeCorpusObjectStore.clearError}.
   */
  error?: string | Error | (() => string | Error);
};

function objectMapKey(bucket: string, key: string): string {
  return `${bucket}\0${key}`;
}

/**
 * Pure in-memory S3 object map for unit tests (no network, no credentials).
 */
export class FakeCorpusObjectStore implements CorpusObjectStore {
  private readonly objects = new Map<string, FakeCorpusObjectRecord>();
  private readonly now: () => Date;
  private error: string | Error | (() => string | Error) | null;
  private getCount = 0;
  private putCount = 0;
  private listCount = 0;

  constructor(options: FakeCorpusObjectStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.error = options.error ?? null;
  }

  async getObject(input: {
    bucket: string;
    key: string;
  }): Promise<string | null> {
    this.throwIfConfigured();
    this.getCount += 1;
    const rec = this.objects.get(objectMapKey(input.bucket, input.key));
    return rec ? rec.body : null;
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
   * List keys under `prefix` for one bucket (sorted; optional page token).
   * `continuationToken` is a 0-based offset string when paging.
   */
  async listObjects(input: {
    bucket: string;
    prefix: string;
    continuationToken?: string;
    maxKeys?: number;
  }): Promise<CorpusListObjectsResult> {
    this.throwIfConfigured();
    this.listCount += 1;
    const prefix = input.prefix ?? "";
    const maxKeys =
      input.maxKeys !== undefined && input.maxKeys > 0
        ? Math.min(Math.floor(input.maxKeys), 1000)
        : 1000;
    const all: CorpusListedObject[] = [];
    for (const [mapKey, rec] of this.objects.entries()) {
      const sep = mapKey.indexOf("\0");
      const b = mapKey.slice(0, sep);
      const k = mapKey.slice(sep + 1);
      if (b !== input.bucket) {
        continue;
      }
      if (prefix && !k.startsWith(prefix)) {
        continue;
      }
      all.push({
        key: k,
        size: Buffer.byteLength(rec.body, "utf8"),
      });
    }
    all.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    const start = input.continuationToken
      ? Number.parseInt(input.continuationToken, 10)
      : 0;
    const offset =
      Number.isFinite(start) && start >= 0 ? Math.floor(start) : 0;
    const page = all.slice(offset, offset + maxKeys);
    const next = offset + page.length;
    return {
      objects: page,
      continuationToken: next < all.length ? String(next) : undefined,
    };
  }

  get(bucket: string, key: string): FakeCorpusObjectRecord | undefined {
    return this.objects.get(objectMapKey(bucket, key));
  }

  has(bucket: string, key: string): boolean {
    return this.objects.has(objectMapKey(bucket, key));
  }

  listKeys(bucket?: string): string[] {
    const out: string[] = [];
    for (const mapKey of this.objects.keys()) {
      const sep = mapKey.indexOf("\0");
      const b = mapKey.slice(0, sep);
      const k = mapKey.slice(sep + 1);
      if (bucket === undefined || b === bucket) {
        out.push(bucket === undefined ? `${b}/${k}` : k);
      }
    }
    return out.sort();
  }

  getGetCount(): number {
    return this.getCount;
  }

  getPutCount(): number {
    return this.putCount;
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
    this.getCount = 0;
    this.putCount = 0;
    this.listCount = 0;
  }

  private throwIfConfigured(): void {
    if (!this.error) {
      return;
    }
    const raw = typeof this.error === "function" ? this.error() : this.error;
    throw raw instanceof Error ? raw : new Error(raw);
  }
}
