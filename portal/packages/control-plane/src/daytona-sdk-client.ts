/**
 * Real managed-Daytona HTTP client (lp-012).
 *
 * Implements {@link DaytonaClient} against the proven REST surface from Phase 0
 * spikes (`https://app.daytona.io/api`): create / start / stop / archive / get /
 * list. API key and org id come from {@link DaytonaConfig} only (never guest).
 *
 * Design:
 * - Thin fetch wrapper (no `@daytona/sdk` dependency) so unit tests inject a
 *   fake transport and stay offline / thrifty.
 * - Request timeouts via AbortSignal → {@link DaytonaTimeoutError}.
 * - HTTP / body errors → {@link DaytonaHttpError} or typed not-found / state.
 * - Create/GET JSON is run through {@link parseDaytonaSandboxApiBody} before
 *   any log callback (lp-pec.1); public {@link DaytonaSandbox} never carries env.
 *
 * Design anchors:
 *   docs/plans/0008-daytona-agent-sandboxes/spike-v2p-org-access.md
 *   docs/plans/0008-daytona-agent-sandboxes/spike-bnd-wake-latencies.md
 *   docs/plans/0008-daytona-agent-sandboxes/cp-daytona-config.md
 *   docs/plans/0008-daytona-agent-sandboxes/daytona-response-redaction.md
 *   docs/plans/0008-daytona-agent-sandboxes/daytona-autostop-safety-net.md (lp-4f2)
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
import {
  assertDaytonaConfigReady,
  type DaytonaConfig,
} from "./daytona-config.js";
import {
  parseDaytonaSandboxApiBody,
  type DaytonaEnvLogSummary,
} from "./daytona-env-redact.js";
import { mountsToDaytonaCreateVolumes } from "./sandbox-vault-mount.js";

/** Default managed API base (trailing slash stripped at construct). */
export const DEFAULT_DAYTONA_API_BASE_URL = "https://app.daytona.io/api";

/** Default per-request timeout (ms). Spikes saw create cold tails ~20s. */
export const DEFAULT_DAYTONA_REQUEST_TIMEOUT_MS = 30_000;

/** Header names (stable contract). */
export const DAYTONA_AUTH_HEADER = "Authorization";
export const DAYTONA_ORG_HEADER = "X-Daytona-Organization-ID";

/** Safe structured log event from the client (no secrets). */
export type DaytonaSdkLogEvent = {
  op: string;
  method: string;
  path: string;
  status?: number;
  sandbox_id?: string | null;
  /** Present when create/GET body was parsed. */
  envSummary?: DaytonaEnvLogSummary;
  /** Redacted body for dump-safe debug (never raw env secrets). */
  bodyForLog?: unknown;
  error_code?: string;
  error_message?: string;
  duration_ms?: number;
};

export type DaytonaSdkClientOptions = {
  /**
   * Platform Daytona config. `apiKey` is secret — used only for Authorization.
   * Must be ready (`assertDaytonaConfigReady`) when constructing.
   */
  config: DaytonaConfig;
  /** Override API base (tests / self-hosted). Default app.daytona.io/api. */
  baseUrl?: string;
  /** Per-request timeout ms. Default {@link DEFAULT_DAYTONA_REQUEST_TIMEOUT_MS}. */
  timeoutMs?: number;
  /** Injectable fetch (unit tests / contract fakes). Defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
  /**
   * Optional safe log sink. Receives only redacted payloads; never apiKey
   * or raw env secret values.
   */
  logSafe?: (event: DaytonaSdkLogEvent) => void;
  /**
   * Create-time `domainAllowList` (comma-separated hosts). CP production
   * wiring (lp-ccp) passes `formatDaytonaDomainAllowList(config.domainAllowList)`
   * from `DAYTONA_DOMAIN_ALLOWLIST` — empty/undefined **omits** the field
   * (fail-closed; no open-world default). Normative host set:
   * docs/plans/0008-daytona-agent-sandboxes/production-network-allowlist.md
   */
  domainAllowList?: string;
  /**
   * Daytona auto-stop interval in **minutes** (create-time `autoStopInterval`).
   * Omit to leave vendor default (tests/spikes). CP production wiring (lp-4f2)
   * always passes {@link DEFAULT_DAYTONA_AUTO_STOP_INTERVAL_MINUTES} (90) or
   * `DAYTONA_AUTO_STOP_INTERVAL_MINUTES` so the vendor safety net sits **above**
   * the 30m idle reaper and 45m mid-turn max hold — see
   * docs/plans/0008-daytona-agent-sandboxes/daytona-autostop-safety-net.md.
   * `0` disables auto-stop when the API accepts it (not recommended for pilot).
   */
  autoStopIntervalMinutes?: number;
  /**
   * Daytona auto-delete interval in **minutes** after stop.
   * `0` = delete on stop (ephemeral; thrifty for tests/spikes).
   * Omit to leave vendor default.
   */
  autoDeleteIntervalMinutes?: number;
};

/** Request timed out (AbortSignal). */
export class DaytonaTimeoutError extends DaytonaClientError {
  readonly timeoutMs: number;
  readonly operation: string;

  constructor(
    operation: string,
    timeoutMs: number,
    options: { sandboxId?: string | null } = {},
  ) {
    super(
      "DAYTONA_TIMEOUT",
      `Daytona ${operation} timed out after ${timeoutMs}ms`,
      { sandboxId: options.sandboxId ?? null },
    );
    this.name = "DaytonaTimeoutError";
    this.timeoutMs = timeoutMs;
    this.operation = operation;
  }
}

/** Non-2xx (or unparseable) managed API response. */
export class DaytonaHttpError extends DaytonaClientError {
  readonly status: number;
  readonly operation: string;
  /** Redacted / truncated body snippet — never Authorization material. */
  readonly bodySnippet: string | null;

  constructor(
    operation: string,
    status: number,
    message: string,
    options: {
      sandboxId?: string | null;
      bodySnippet?: string | null;
      code?: string;
    } = {},
  ) {
    super(
      options.code ?? "DAYTONA_HTTP_ERROR",
      message,
      { sandboxId: options.sandboxId ?? null },
    );
    this.name = "DaytonaHttpError";
    this.status = status;
    this.operation = operation;
    this.bodySnippet = options.bodySnippet ?? null;
  }
}

/**
 * Real HTTP client for managed Daytona.
 * Construct via {@link createDaytonaSdkClient} so config readiness is asserted.
 */
export class DaytonaSdkClient implements DaytonaClient {
  private readonly apiKey: string;
  private readonly orgId: string;
  private readonly defaultRegion: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly logSafe: ((event: DaytonaSdkLogEvent) => void) | null;
  private readonly domainAllowList: string | undefined;
  private readonly autoStopIntervalMinutes: number | undefined;
  private readonly autoDeleteIntervalMinutes: number | undefined;

  constructor(options: DaytonaSdkClientOptions) {
    assertDaytonaConfigReady(options.config);
    // Keep secret only in this private field — never log.
    this.apiKey = options.config.apiKey;
    this.orgId = options.config.orgId;
    this.defaultRegion = options.config.region.trim();
    this.baseUrl = normalizeBaseUrl(
      options.baseUrl?.trim() || DEFAULT_DAYTONA_API_BASE_URL,
    );
    this.timeoutMs = Math.max(
      1,
      options.timeoutMs ?? DEFAULT_DAYTONA_REQUEST_TIMEOUT_MS,
    );
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.logSafe = options.logSafe ?? null;
    this.domainAllowList = options.domainAllowList?.trim() || undefined;
    this.autoStopIntervalMinutes = options.autoStopIntervalMinutes;
    this.autoDeleteIntervalMinutes = options.autoDeleteIntervalMinutes;
  }

  /** Non-secret base URL (safe to log). */
  get apiBaseUrl(): string {
    return this.baseUrl;
  }

  /** Configured request timeout ms. */
  get requestTimeoutMs(): number {
    return this.timeoutMs;
  }

  async create(params: CreateSandboxParams): Promise<DaytonaSandbox> {
    const snapshotId = params.snapshotId?.trim();
    if (!snapshotId) {
      throw new DaytonaClientError(
        "DAYTONA_INVALID_PARAMS",
        "CreateSandboxParams.snapshotId is required",
      );
    }
    const region = params.region?.trim() || this.defaultRegion;
    const body: Record<string, unknown> = {
      snapshot: snapshotId,
      target: region,
    };
    if (params.labels && Object.keys(params.labels).length > 0) {
      body.labels = { ...params.labels };
    }
    if (params.env && Object.keys(params.env).length > 0) {
      body.env = { ...params.env };
    }
    if (this.domainAllowList) {
      body.domainAllowList = this.domainAllowList;
    }
    if (this.autoStopIntervalMinutes !== undefined) {
      body.autoStopInterval = this.autoStopIntervalMinutes;
    }
    if (this.autoDeleteIntervalMinutes !== undefined) {
      body.autoDeleteInterval = this.autoDeleteIntervalMinutes;
    }
    // lp-3a1.5: attach vault at create so live sandboxes are not volumes=[].
    // Map CP mounts (s3Bucket + s3Prefix + mountPath) → Daytona SandboxVolume
    // { volumeId, mountPath, subpath }. Guest env still carries VAULT_ROOT /
    // S3_VAULT_PREFIX / LANYARD_VAULT_BUCKET for helpers and contract parity.
    const volumes = mountsToDaytonaCreateVolumes(params.mounts);
    if (volumes.length > 0) {
      body.volumes = volumes.map((v) => ({
        volumeId: v.volumeId,
        mountPath: v.mountPath,
        subpath: v.subpath,
      }));
    }

    const raw = await this.requestJson("create", "POST", "/sandbox", {
      body,
      parseEnv: true,
    });
    return mapSandboxBody(raw, {
      fallbackRegion: region,
      fallbackSnapshotId: snapshotId,
      fallbackMounts: params.mounts,
    });
  }

  async start(sandboxId: string): Promise<DaytonaSandbox> {
    const id = requireSandboxId(sandboxId);
    const raw = await this.requestJson(
      "start",
      "POST",
      `/sandbox/${encodeURIComponent(id)}/start`,
      { sandboxId: id, parseEnv: true, allowEmpty: true },
    );
    if (raw === undefined || raw === null || isEmptyObject(raw)) {
      return this.get(id);
    }
    return mapSandboxBody(raw, { sandboxId: id });
  }

  async stop(sandboxId: string): Promise<DaytonaSandbox> {
    const id = requireSandboxId(sandboxId);
    const raw = await this.requestJson(
      "stop",
      "POST",
      `/sandbox/${encodeURIComponent(id)}/stop`,
      { sandboxId: id, parseEnv: true, allowEmpty: true },
    );
    if (raw === undefined || raw === null || isEmptyObject(raw)) {
      return this.get(id);
    }
    return mapSandboxBody(raw, { sandboxId: id });
  }

  async archive(sandboxId: string): Promise<DaytonaSandbox> {
    const id = requireSandboxId(sandboxId);
    const raw = await this.requestJson(
      "archive",
      "POST",
      `/sandbox/${encodeURIComponent(id)}/archive`,
      { sandboxId: id, parseEnv: true, allowEmpty: true },
    );
    if (raw === undefined || raw === null || isEmptyObject(raw)) {
      return this.get(id);
    }
    return mapSandboxBody(raw, { sandboxId: id });
  }

  async get(sandboxId: string): Promise<DaytonaSandbox> {
    const id = requireSandboxId(sandboxId);
    const raw = await this.requestJson(
      "get",
      "GET",
      `/sandbox/${encodeURIComponent(id)}`,
      { sandboxId: id, parseEnv: true },
    );
    return mapSandboxBody(raw, { sandboxId: id });
  }

  async list(filter: ListSandboxesFilter = {}): Promise<DaytonaSandbox[]> {
    const qs = new URLSearchParams();
    if (filter.limit !== undefined && filter.limit >= 0) {
      qs.set("limit", String(filter.limit));
    }
    // Label filter: API may support labels[key]=value; client also filters.
    if (filter.label) {
      qs.set(`labels[${filter.label.key}]`, filter.label.value);
    }
    const path = qs.size > 0 ? `/sandbox?${qs.toString()}` : "/sandbox";
    const raw = await this.requestJson("list", "GET", path, {
      parseEnv: false,
      allowEmpty: true,
    });
    let items = extractListItems(raw);
    let rows = items.map((item) =>
      mapSandboxBody(item, { fallbackRegion: this.defaultRegion }),
    );
    if (filter.state) {
      rows = rows.filter((r) => r.state === filter.state);
    }
    if (filter.label) {
      const { key, value } = filter.label;
      rows = rows.filter((r) => r.labels[key] === value);
    }
    if (filter.limit !== undefined && filter.limit >= 0) {
      rows = rows.slice(0, filter.limit);
    }
    return rows;
  }

  // ---------------------------------------------------------------------------
  // HTTP
  // ---------------------------------------------------------------------------

  private async requestJson(
    op: string,
    method: string,
    path: string,
    options: {
      body?: unknown;
      sandboxId?: string | null;
      parseEnv?: boolean;
      allowEmpty?: boolean;
    } = {},
  ): Promise<unknown> {
    const started = Date.now();
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = {
      Accept: "application/json",
      [DAYTONA_AUTH_HEADER]: `Bearer ${this.apiKey}`,
      [DAYTONA_ORG_HEADER]: this.orgId,
    };
    let bodyText: string | undefined;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      bodyText = JSON.stringify(options.body);
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: bodyText,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (isAbortError(err)) {
        const timeoutErr = new DaytonaTimeoutError(op, this.timeoutMs, {
          sandboxId: options.sandboxId,
        });
        this.emitLog({
          op,
          method,
          path,
          sandbox_id: options.sandboxId ?? null,
          error_code: timeoutErr.code,
          error_message: timeoutErr.message,
          duration_ms: Date.now() - started,
        });
        throw timeoutErr;
      }
      const message =
        err instanceof Error ? err.message : "Daytona network request failed";
      // Never include Authorization / apiKey in messages.
      const netErr = new DaytonaClientError(
        "DAYTONA_NETWORK_ERROR",
        `Daytona ${op} network error: ${sanitizeErrorMessage(message)}`,
        { sandboxId: options.sandboxId },
      );
      this.emitLog({
        op,
        method,
        path,
        sandbox_id: options.sandboxId ?? null,
        error_code: netErr.code,
        error_message: netErr.message,
        duration_ms: Date.now() - started,
      });
      throw netErr;
    } finally {
      clearTimeout(timer);
    }

    const status = response.status;
    const text = await response.text();
    const durationMs = Date.now() - started;

    if (status === 404) {
      const notFound = new DaytonaSandboxNotFoundError(
        options.sandboxId?.trim() || extractIdFromPath(path) || "unknown",
      );
      this.emitLog({
        op,
        method,
        path,
        status,
        sandbox_id: options.sandboxId ?? null,
        error_code: notFound.code,
        error_message: notFound.message,
        duration_ms: durationMs,
      });
      throw notFound;
    }

    if (status < 200 || status >= 300) {
      const snippet = truncateSnippet(text);
      const apiMessage = extractApiErrorMessage(text) ?? `HTTP ${status}`;
      // Map common lifecycle conflicts without leaking bodies.
      if (
        status === 400 ||
        status === 409 ||
        status === 422
      ) {
        const stateHint = detectStateError(apiMessage);
        if (stateHint && options.sandboxId) {
          const stateErr = new DaytonaSandboxStateError(
            options.sandboxId,
            stateHint.from,
            op,
          );
          this.emitLog({
            op,
            method,
            path,
            status,
            sandbox_id: options.sandboxId,
            error_code: stateErr.code,
            error_message: stateErr.message,
            duration_ms: durationMs,
          });
          throw stateErr;
        }
      }
      const httpErr = new DaytonaHttpError(
        op,
        status,
        `Daytona ${op} failed: ${sanitizeErrorMessage(apiMessage)}`,
        {
          sandboxId: options.sandboxId,
          bodySnippet: snippet,
        },
      );
      this.emitLog({
        op,
        method,
        path,
        status,
        sandbox_id: options.sandboxId ?? null,
        error_code: httpErr.code,
        error_message: httpErr.message,
        duration_ms: durationMs,
      });
      throw httpErr;
    }

    if (!text.trim()) {
      if (options.allowEmpty) {
        this.emitLog({
          op,
          method,
          path,
          status,
          sandbox_id: options.sandboxId ?? null,
          duration_ms: durationMs,
        });
        return null;
      }
      throw new DaytonaHttpError(
        op,
        status,
        `Daytona ${op} returned empty body`,
        { sandboxId: options.sandboxId },
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new DaytonaHttpError(
        op,
        status,
        `Daytona ${op} returned non-JSON body`,
        {
          sandboxId: options.sandboxId,
          bodySnippet: truncateSnippet(text),
        },
      );
    }

    if (options.parseEnv) {
      const safe = parseDaytonaSandboxApiBody(parsed);
      this.emitLog({
        op,
        method,
        path,
        status,
        sandbox_id: options.sandboxId ?? pickId(parsed),
        envSummary: safe.envSummary,
        bodyForLog: safe.bodyForLog,
        duration_ms: durationMs,
      });
      // Mapping uses original `parsed` (env kept in memory only if needed by
      // callers later — public DaytonaSandbox strips it).
      return parsed;
    }

    this.emitLog({
      op,
      method,
      path,
      status,
      sandbox_id: options.sandboxId ?? null,
      bodyForLog: parseDaytonaSandboxApiBody(parsed).bodyForLog,
      duration_ms: durationMs,
    });
    return parsed;
  }

  private emitLog(event: DaytonaSdkLogEvent): void {
    if (!this.logSafe) return;
    try {
      this.logSafe(event);
    } catch {
      // Logging must never break lifecycle operations.
    }
  }
}

/**
 * Build a ready {@link DaytonaSdkClient} from CP config.
 * Throws {@link DaytonaConfigError} when required keys are missing.
 */
export function createDaytonaSdkClient(
  options: DaytonaSdkClientOptions,
): DaytonaSdkClient {
  return new DaytonaSdkClient(options);
}

// ---------------------------------------------------------------------------
// Mapping / helpers
// ---------------------------------------------------------------------------

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

function requireSandboxId(sandboxId: string): string {
  const id = sandboxId?.trim();
  if (!id) {
    throw new DaytonaSandboxNotFoundError(sandboxId ?? "");
  }
  return id;
}

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = (err as { name?: string }).name;
  if (name === "AbortError" || name === "TimeoutError") return true;
  // Node undici sometimes wraps
  const cause = (err as { cause?: unknown }).cause;
  if (cause && typeof cause === "object") {
    const cname = (cause as { name?: string }).name;
    if (cname === "AbortError" || cname === "TimeoutError") return true;
  }
  return false;
}

function isEmptyObject(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value as object).length === 0
  );
}

function extractListItems(raw: unknown): unknown[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "object") return [];
  const obj = raw as Record<string, unknown>;
  for (const key of ["items", "data", "sandboxes", "results"]) {
    const v = obj[key];
    if (Array.isArray(v)) return v;
  }
  // Single sandbox object masquerading as list payload
  if (pickId(raw)) return [raw];
  return [];
}

function pickId(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  for (const key of ["id", "sandboxId", "sandbox_id"]) {
    const v = o[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function extractIdFromPath(path: string): string | null {
  const m = path.match(/\/sandbox\/([^/?#]+)/);
  if (!m?.[1] || m[1] === "start" || m[1] === "stop" || m[1] === "archive") {
    return null;
  }
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

function mapSandboxBody(
  raw: unknown,
  hints: {
    sandboxId?: string;
    fallbackRegion?: string;
    fallbackSnapshotId?: string;
    fallbackMounts?: readonly DaytonaMountSpec[];
  } = {},
): DaytonaSandbox {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DaytonaClientError(
      "DAYTONA_INVALID_RESPONSE",
      "Daytona response is not a sandbox object",
      { sandboxId: hints.sandboxId ?? null },
    );
  }
  const o = raw as Record<string, unknown>;
  const sandboxId =
    pickId(raw) ??
    hints.sandboxId?.trim() ??
    "";
  if (!sandboxId) {
    throw new DaytonaClientError(
      "DAYTONA_INVALID_RESPONSE",
      "Daytona response missing sandbox id",
    );
  }

  const state = normalizeState(o.state ?? o.status);
  const snapshotId =
    pickString(o, ["snapshot", "snapshotId", "snapshot_id", "image"]) ??
    hints.fallbackSnapshotId ??
    "";
  const region =
    pickString(o, ["target", "region", "regionId", "region_id"]) ??
    hints.fallbackRegion ??
    "";
  const labels = normalizeLabels(o.labels);
  // Prefer mounts[]; fall back to volumes[] (Daytona create/GET shape, lp-3a1.5).
  const mounts =
    normalizeMounts(o.mounts) ??
    normalizeMounts(o.volumes) ??
    (hints.fallbackMounts
      ? hints.fallbackMounts.map((m) => ({ ...m }))
      : []);
  const createdAt =
    pickString(o, ["createdAt", "created_at", "created"]) ??
    new Date(0).toISOString();
  const updatedAt =
    pickString(o, ["updatedAt", "updated_at", "updated"]) ?? createdAt;
  const errorMessage =
    pickString(o, ["errorMessage", "error_message", "error", "message"]) ??
    null;

  return {
    sandboxId,
    state,
    snapshotId,
    region,
    labels,
    mounts,
    createdAt,
    updatedAt,
    errorMessage: state === "error" ? errorMessage : null,
  };
}

function normalizeState(value: unknown): DaytonaSandboxState {
  if (typeof value !== "string") return "error";
  const s = value.trim().toLowerCase();
  switch (s) {
    case "creating":
    case "pending":
    case "starting":
      return "creating";
    case "started":
    case "running":
    case "active":
      return "started";
    case "stopped":
    case "stopping":
      return "stopped";
    case "archived":
    case "archiving":
      return "archived";
    case "error":
    case "failed":
    case "destroyed":
    case "deleted":
      return "error";
    default:
      // Unknown vendor state — surface as error so orchestrator does not
      // treat it as online.
      return "error";
  }
}

function pickString(
  o: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const v = o[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function normalizeLabels(
  value: unknown,
): Readonly<Record<string, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return Object.freeze({});
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (!k) continue;
    if (typeof v === "string") out[k] = v;
    else if (v == null) out[k] = "";
    else if (
      typeof v === "number" ||
      typeof v === "boolean" ||
      typeof v === "bigint"
    ) {
      out[k] = String(v);
    }
  }
  return Object.freeze(out);
}

function normalizeMounts(
  value: unknown,
): DaytonaMountSpec[] | null {
  if (!Array.isArray(value)) return null;
  const out: DaytonaMountSpec[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    // Accept both CP mount shape and Daytona volumes[] shape (lp-3a1.5):
    //   volumeId → s3Bucket, subpath → s3Prefix, mountPath → mountPath
    const s3Prefix =
      pickString(m, [
        "s3Prefix",
        "s3_prefix",
        "bucketPath",
        "source",
        "subpath",
        "subPath",
      ]) ?? "";
    const mountPath =
      pickString(m, ["mountPath", "mount_path", "path", "destination"]) ?? "";
    const s3Bucket =
      pickString(m, [
        "s3Bucket",
        "s3_bucket",
        "bucket",
        "volumeId",
        "volume_id",
      ]) ?? undefined;
    if (s3Prefix || mountPath) {
      const row: DaytonaMountSpec = { s3Prefix, mountPath };
      if (s3Bucket) row.s3Bucket = s3Bucket;
      out.push(row);
    }
  }
  return out;
}

function extractApiErrorMessage(text: string): string | null {
  if (!text.trim()) return null;
  try {
    const j = JSON.parse(text) as Record<string, unknown>;
    for (const key of ["message", "error", "detail", "title"]) {
      const v = j[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  } catch {
    // plain text body
  }
  return text.trim().slice(0, 240);
}

function detectStateError(
  message: string,
): { from: DaytonaSandboxState } | null {
  const m = message.toLowerCase();
  if (m.includes("archiv")) {
    return { from: "archived" };
  }
  if (m.includes("already started") || m.includes("not stopped")) {
    return { from: "started" };
  }
  if (m.includes("not started") || m.includes("already stopped")) {
    return { from: "stopped" };
  }
  if (m.includes("creating") || m.includes("not ready")) {
    return { from: "creating" };
  }
  return null;
}

function truncateSnippet(text: string, max = 200): string | null {
  const t = text.trim();
  if (!t) return null;
  // Never leave Bearer tokens / obvious secret material in snippets.
  const scrubbed = t
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(
      /("?(?:GATEWAY_RELAY_SECRET|DAYTONA_API_KEY|password|token|secret)"?\s*:\s*)"[^"]*"/gi,
      '$1"[REDACTED]"',
    );
  return scrubbed.length > max ? `${scrubbed.slice(0, max)}…` : scrubbed;
}

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/dtn_[A-Za-z0-9_-]+/g, "[REDACTED_KEY]")
    .slice(0, 400);
}
