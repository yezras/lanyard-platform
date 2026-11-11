/**
 * In-memory Daytona client (lp-57ha: renamed from prior test double, no banned substring) for unit tests (lp-7v5 + lp-2tz failure modes).
 *
 * No network, no SDK, no secrets store. Implements the full
 * {@link DaytonaClient} surface so offline orchestrator logic
 * (`lp-kng.2.1` ensure_online) can run without managed Daytona.
 *
 * Failure injection (lp-2tz matrix):
 *   - createError / holdNextCreate / createDelayMs — cold wake + timeout
 *   - startError / holdNextStart / startDelayMs — warm start timeout/fail
 *   - setApiDown — all lifecycle methods throw (Daytona API unavailable)
 */

import {
  DaytonaClientError,
  DaytonaSandboxNotFoundError,
  DaytonaSandboxStateError,
  type CreateSandboxParams,
  type DaytonaClient,
  type DaytonaMountSpec,
  type DaytonaSandbox,
  type DaytonaSandboxState,
  type ListSandboxesFilter,
} from "./daytona-client.js";

export type InMemoryDaytonaClientOptions = {
  /** Default region when create omits region (mirrors CP config). */
  defaultRegion?: string;
  /**
   * Initial state after create. Default `started` so a single create
   * satisfies lazy wake without a separate start (ensure_online path).
   * Set `stopped` to force an explicit start step in tests.
   */
  createState?: Extract<DaytonaSandboxState, "started" | "stopped">;
  /** Optional id factory for deterministic tests. */
  idFactory?: () => string;
  /** Clock for createdAt/updatedAt (ISO). Defaults to Date.now. */
  now?: () => Date;
  /**
   * Fixed delay (ms) before create resolves — for timeout tests.
   * Prefer {@link InMemoryDaytonaClient.holdNextCreate} for singleflight tests.
   */
  createDelayMs?: number;
  /**
   * When set, create throws (Error, message, or factory). Cleared after one
   * throw if value is a one-shot factory that returns then empties — static
   * Error/string throws on every create until cleared via {@link InMemoryDaytonaClient.clearCreateError}.
   */
  createError?: string | Error | (() => string | Error);
  /**
   * Fixed delay (ms) before start resolves — warm-path timeout tests.
   * Prefer {@link InMemoryDaytonaClient.holdNextStart} for singleflight/start-hold.
   */
  startDelayMs?: number;
  /**
   * When set, start throws (Error, message, or factory). Static until cleared
   * via {@link InMemoryDaytonaClient.clearStartError}.
   */
  startError?: string | Error | (() => string | Error);
  /**
   * When true, every create/start/stop/archive/get/list throws
   * {@link DaytonaClientError} with code `DAYTONA_API_DOWN` (lp-2tz API-down).
   * Toggle via {@link InMemoryDaytonaClient.setApiDown}.
   */
  apiDown?: boolean;
};

type StoredSandbox = {
  record: DaytonaSandbox;
  /** Env kept only in fake memory for inspect/assert in tests — never logged. */
  env: Readonly<Record<string, string>>;
};

type InjectedError = string | Error | (() => string | Error);

/**
 * Pure in-memory Daytona client. Safe for concurrent single-process tests;
 * not a multi-process mock.
 */
export class InMemoryDaytonaClient implements DaytonaClient {
  private readonly sandboxes = new Map<string, StoredSandbox>();
  private readonly defaultRegion: string;
  private readonly createState: Extract<
    DaytonaSandboxState,
    "started" | "stopped"
  >;
  private readonly idFactory: () => string;
  private readonly now: () => Date;
  private readonly createDelayMs: number;
  private readonly startDelayMs: number;
  private createError: InjectedError | null;
  private startError: InjectedError | null;
  private apiDown: boolean;
  private seq = 0;
  private createCount = 0;
  private startCount = 0;
  private stopCount = 0;
  private archiveCount = 0;
  /** Optional gate: create awaits until releaseCreate(). */
  private createGate: Promise<void> | null = null;
  private createRelease: (() => void) | null = null;
  /** Optional gate: start awaits until releaseStart(). */
  private startGate: Promise<void> | null = null;
  private startRelease: (() => void) | null = null;

  constructor(options: InMemoryDaytonaClientOptions = {}) {
    this.defaultRegion = options.defaultRegion?.trim() || "us";
    this.createState = options.createState ?? "started";
    this.idFactory =
      options.idFactory ??
      (() => {
        this.seq += 1;
        return `fake-sandbox-${this.seq}`;
      });
    this.now = options.now ?? (() => new Date());
    this.createDelayMs = Math.max(0, options.createDelayMs ?? 0);
    this.startDelayMs = Math.max(0, options.startDelayMs ?? 0);
    this.createError = options.createError ?? null;
    this.startError = options.startError ?? null;
    this.apiDown = options.apiDown === true;
  }

  async create(params: CreateSandboxParams): Promise<DaytonaSandbox> {
    this.throwIfApiDown("create");
    if (this.createGate) {
      await this.createGate;
    }
    if (this.createDelayMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, this.createDelayMs);
      });
    }
    // Re-check after await so setApiDown during hold still fails.
    this.throwIfApiDown("create");
    if (this.createError) {
      throw resolveInjectedError(this.createError);
    }

    const snapshotId = params.snapshotId?.trim();
    if (!snapshotId) {
      throw new Error("CreateSandboxParams.snapshotId is required");
    }
    this.createCount += 1;
    const region = params.region?.trim() || this.defaultRegion;
    const labels = freezeLabels(params.labels);
    const mounts = freezeMounts(params.mounts);
    const env = freezeEnv(params.env);
    const ts = this.now().toISOString();
    const sandboxId = this.idFactory();
    const record: DaytonaSandbox = {
      sandboxId,
      state: this.createState,
      snapshotId,
      region,
      labels,
      mounts,
      createdAt: ts,
      updatedAt: ts,
      errorMessage: null,
    };
    this.sandboxes.set(sandboxId, { record, env });
    return cloneSandbox(record);
  }

  async start(sandboxId: string): Promise<DaytonaSandbox> {
    this.throwIfApiDown("start");
    if (this.startGate) {
      await this.startGate;
    }
    if (this.startDelayMs > 0) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, this.startDelayMs);
      });
    }
    this.throwIfApiDown("start");
    if (this.startError) {
      throw resolveInjectedError(this.startError);
    }

    const stored = this.require(sandboxId);
    const { state } = stored.record;
    if (state === "started") {
      this.startCount += 1;
      return cloneSandbox(stored.record);
    }
    // lp-6bg / spike-bnd: managed Daytona restore-from-archive is POST …/start
    // while state is archived (no separate restore endpoint).
    if (state === "archived") {
      this.startCount += 1;
      return this.setState(stored, "started");
    }
    if (state === "creating" || state === "error") {
      throw new DaytonaSandboxStateError(sandboxId, state, "start");
    }
    // stopped → started
    this.startCount += 1;
    return this.setState(stored, "started");
  }

  async stop(sandboxId: string): Promise<DaytonaSandbox> {
    this.throwIfApiDown("stop");
    const stored = this.require(sandboxId);
    const { state } = stored.record;
    if (state === "stopped") {
      this.stopCount += 1;
      return cloneSandbox(stored.record);
    }
    if (state === "archived") {
      throw new DaytonaSandboxStateError(sandboxId, state, "stop");
    }
    if (state === "creating") {
      throw new DaytonaSandboxStateError(sandboxId, state, "stop");
    }
    // started | error → stopped
    this.stopCount += 1;
    return this.setState(stored, "stopped");
  }

  async archive(sandboxId: string): Promise<DaytonaSandbox> {
    this.throwIfApiDown("archive");
    const stored = this.require(sandboxId);
    if (stored.record.state === "archived") {
      this.archiveCount += 1;
      return cloneSandbox(stored.record);
    }
    this.archiveCount += 1;
    return this.setState(stored, "archived");
  }

  async get(sandboxId: string): Promise<DaytonaSandbox> {
    this.throwIfApiDown("get");
    return cloneSandbox(this.require(sandboxId).record);
  }

  async list(filter: ListSandboxesFilter = {}): Promise<DaytonaSandbox[]> {
    this.throwIfApiDown("list");
    let rows = [...this.sandboxes.values()].map((s) => s.record);
    if (filter.state) {
      rows = rows.filter((r) => r.state === filter.state);
    }
    if (filter.label) {
      const { key, value } = filter.label;
      rows = rows.filter((r) => r.labels[key] === value);
    }
    // Stable order: createdAt then sandboxId
    rows.sort((a, b) => {
      const t = a.createdAt.localeCompare(b.createdAt);
      return t !== 0 ? t : a.sandboxId.localeCompare(b.sandboxId);
    });
    if (filter.limit !== undefined && filter.limit >= 0) {
      rows = rows.slice(0, filter.limit);
    }
    return rows.map(cloneSandbox);
  }

  // ── Test helpers (not part of DaytonaClient) ──────────────────────────

  /** Number of sandboxes currently tracked (including archived). */
  size(): number {
    return this.sandboxes.size;
  }

  /** How many successful create() calls completed (not counting failed). */
  getCreateCount(): number {
    return this.createCount;
  }

  /** How many successful start() calls completed (including already-started). */
  getStartCount(): number {
    return this.startCount;
  }

  /** How many stop() calls completed (including already-stopped no-ops). */
  getStopCount(): number {
    return this.stopCount;
  }

  /** How many archive() calls completed (including already-archived no-ops). */
  getArchiveCount(): number {
    return this.archiveCount;
  }

  /**
   * Hold the next create(s) until {@link releaseCreate}.
   * Used by ensure_online singleflight tests so concurrent callers join
   * before Daytona create resolves.
   */
  holdNextCreate(): void {
    if (this.createGate) return;
    this.createGate = new Promise<void>((resolve) => {
      this.createRelease = resolve;
    });
  }

  /** Release a hold from {@link holdNextCreate}. */
  releaseCreate(): void {
    const release = this.createRelease;
    this.createRelease = null;
    this.createGate = null;
    release?.();
  }

  /**
   * Hold the next start(s) until {@link releaseStart}.
   * Used by warm-path start-timeout and concurrent-wake tests (lp-2tz).
   */
  holdNextStart(): void {
    if (this.startGate) return;
    this.startGate = new Promise<void>((resolve) => {
      this.startRelease = resolve;
    });
  }

  /** Release a hold from {@link holdNextStart}. */
  releaseStart(): void {
    const release = this.startRelease;
    this.startRelease = null;
    this.startGate = null;
    release?.();
  }

  /** Set or clear create failure injection. */
  setCreateError(error: InjectedError | null): void {
    this.createError = error;
  }

  clearCreateError(): void {
    this.createError = null;
  }

  /** Set or clear start failure injection. */
  setStartError(error: InjectedError | null): void {
    this.startError = error;
  }

  clearStartError(): void {
    this.startError = null;
  }

  /**
   * Simulate Daytona managed API unavailable (lp-2tz).
   * All lifecycle methods throw {@link DaytonaClientError} `DAYTONA_API_DOWN`.
   */
  setApiDown(down: boolean): void {
    this.apiDown = down;
  }

  /** Whether API-down injection is active. */
  isApiDown(): boolean {
    return this.apiDown;
  }

  /** Reset all in-memory state. */
  reset(): void {
    this.sandboxes.clear();
    this.seq = 0;
    this.createCount = 0;
    this.startCount = 0;
    this.stopCount = 0;
    this.releaseCreate();
    this.releaseStart();
    this.createError = null;
    this.startError = null;
    this.apiDown = false;
  }

  /**
   * Force a sandbox into `error` for failure-path tests.
   * @throws {DaytonaSandboxNotFoundError}
   */
  forceError(sandboxId: string, message: string): DaytonaSandbox {
    const stored = this.require(sandboxId);
    stored.record = {
      ...stored.record,
      state: "error",
      errorMessage: message,
      updatedAt: this.now().toISOString(),
    };
    return cloneSandbox(stored.record);
  }

  /**
   * Read inject env stored for a sandbox (test assertions only).
   * Never log the return value when it may contain secrets.
   */
  getEnvForTest(sandboxId: string): Readonly<Record<string, string>> {
    return { ...this.require(sandboxId).env };
  }

  private throwIfApiDown(operation: string): void {
    if (!this.apiDown) return;
    throw new DaytonaClientError(
      "DAYTONA_API_DOWN",
      `Daytona API unavailable (${operation})`,
    );
  }

  private require(sandboxId: string): StoredSandbox {
    const id = sandboxId?.trim();
    if (!id) {
      throw new DaytonaSandboxNotFoundError(sandboxId ?? "");
    }
    const stored = this.sandboxes.get(id);
    if (!stored) {
      throw new DaytonaSandboxNotFoundError(id);
    }
    return stored;
  }

  private setState(
    stored: StoredSandbox,
    state: DaytonaSandboxState,
  ): DaytonaSandbox {
    stored.record = {
      ...stored.record,
      state,
      errorMessage: state === "error" ? stored.record.errorMessage : null,
      updatedAt: this.now().toISOString(),
    };
    return cloneSandbox(stored.record);
  }
}

function resolveInjectedError(error: InjectedError): Error {
  const raw = typeof error === "function" ? error() : error;
  return raw instanceof Error ? raw : new Error(raw);
}

function freezeLabels(
  labels: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  if (!labels) return Object.freeze({});
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(labels)) {
    if (k) out[k] = v;
  }
  return Object.freeze(out);
}

function freezeMounts(
  mounts: readonly DaytonaMountSpec[] | undefined,
): readonly DaytonaMountSpec[] {
  if (!mounts?.length) return Object.freeze([]);
  return Object.freeze(
    mounts.map((m) => {
      const row: DaytonaMountSpec = {
        s3Prefix: m.s3Prefix,
        mountPath: m.mountPath,
      };
      if (m.s3Bucket) {
        row.s3Bucket = m.s3Bucket;
      }
      return Object.freeze(row);
    }),
  );
}

function freezeEnv(
  env: Readonly<Record<string, string>> | undefined,
): Readonly<Record<string, string>> {
  if (!env) return Object.freeze({});
  return Object.freeze({ ...env });
}

function cloneSandbox(record: DaytonaSandbox): DaytonaSandbox {
  return {
    sandboxId: record.sandboxId,
    state: record.state,
    snapshotId: record.snapshotId,
    region: record.region,
    labels: { ...record.labels },
    mounts: record.mounts.map((m) => {
      const copy: DaytonaMountSpec = {
        s3Prefix: m.s3Prefix,
        mountPath: m.mountPath,
      };
      if (m.s3Bucket) copy.s3Bucket = m.s3Bucket;
      return copy;
    }),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    errorMessage: record.errorMessage,
  };
}
