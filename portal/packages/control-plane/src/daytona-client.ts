/**
 * Daytona managed-API client interface for the Instance Orchestrator (lp-7v5).
 *
 * Normative lifecycle surface: create / start / stop / archive / get / list.
 * The Control Plane owns sandbox lifecycle; the agent guest never calls this
 * (plan §4.3 / identity-model.md). Real HTTP wrapper: {@link import("./daytona-sdk-client.js").DaytonaSdkClient}
 * (`lp-012`); offline tests use {@link real harnessClient}.
 *
 * **Secret env redaction (lp-pec.1):** Daytona create/GET JSON may echo the full
 * process `env` map (including `GATEWAY_RELAY_SECRET`). Real clients must run
 * raw responses through `parseDaytonaSandboxApiBody` /
 * `redactDaytonaApiResponseForLog` in `./daytona-env-redact.js` before any
 * log or structured event. Public {@link DaytonaSandbox} records never carry env.
 *
 * Design anchors:
 *   docs/plans/0008-daytona-agent-sandboxes/offline-piping.md
 *   docs/plans/0008-daytona-agent-sandboxes/identity-model.md
 *   docs/plans/0008-daytona-agent-sandboxes/cp-daytona-config.md
 *   docs/plans/0008-daytona-agent-sandboxes/daytona-response-redaction.md
 *
 * Offline track: interface + fake only. No network, no Daytona SDK import.
 */

/** Lifecycle state of a managed sandbox (orchestrator view). */
export const DAYTONA_SANDBOX_STATES = [
  "creating",
  "started",
  "stopped",
  "archived",
  "error",
] as const;

export type DaytonaSandboxState = (typeof DAYTONA_SANDBOX_STATES)[number];

/**
 * S3 Mountpoint-style mount for the durable tenant vault prefix (lp-hjo / lp-3a1.5).
 * Orchestrator maps `s3_vault_prefix` (+ platform bucket) → guest
 * `mountPath` (= gateway env `VAULT_ROOT`). See `sandbox-vault-mount.ts`.
 *
 * Real SDK create serializes mounts with `s3Bucket` into Daytona body
 * `volumes: [{ volumeId, mountPath, subpath }]` so cold create is not
 * `volumes=[]`. Env inject (`VAULT_ROOT`, `S3_VAULT_PREFIX`, optional
 * `LANYARD_VAULT_BUCKET`) remains for guest helpers.
 */
export type DaytonaMountSpec = {
  /** Durable vault prefix ref (e.g. `tenants/{tenant_id}/vault/`). */
  s3Prefix: string;
  /** Absolute path inside the sandbox guest (parity with VAULT_ROOT). */
  mountPath: string;
  /**
   * Platform vault bucket bare name (e.g. `lanyard-mocklab-vault-…`).
   * Optional when only the prefix is known; set when `vault.bucket` /
   * `S3_VAULT_BUCKET` is wired. Required for create `volumes[]` attach.
   */
  s3Bucket?: string;
};

/**
 * Create-from-snapshot request. Labels carry CP identity for webhooks /
 * reverse map (`instance_id`, `tenant_id`) — not auth material.
 */
export type CreateSandboxParams = {
  /** Agent image/snapshot pin (instance pin or platform default). */
  snapshotId: string;
  /** Region; omit to let the real client use config default. */
  region?: string;
  /**
   * Opaque labels for inventory / webhook correlation.
   * Prefer `instance_id` + `tenant_id` keys (identity-model.md).
   */
  labels?: Readonly<Record<string, string>>;
  /**
   * Process env inject at create/start (Bucket C wake inject).
   * Vault mount path: include `VAULT_ROOT` matching `mounts[].mountPath`
   * (lp-hjo / `buildSandboxVaultMountParams`). Callers must not log secrets.
   * Fake stores env in memory only.
   */
  env?: Readonly<Record<string, string>>;
  /**
   * Vault Mountpoint mapping (lp-hjo). When `s3_vault_prefix` is set on the
   * instance, orchestrator always passes a single mount at VAULT_ROOT.
   */
  mounts?: readonly DaytonaMountSpec[];
};

/** Optional filters for list. */
export type ListSandboxesFilter = {
  /** Match sandboxes that have this exact label key/value. */
  label?: { key: string; value: string };
  state?: DaytonaSandboxState;
  /** Max rows (implementations may ignore or clamp). */
  limit?: number;
};

/**
 * Orchestrator-facing sandbox record.
 * `sandboxId` is ephemeral compute only — never Relay / Brain RPC identity.
 */
export type DaytonaSandbox = {
  sandboxId: string;
  state: DaytonaSandboxState;
  snapshotId: string;
  region: string;
  labels: Readonly<Record<string, string>>;
  mounts: readonly DaytonaMountSpec[];
  /** ISO-8601 create time. */
  createdAt: string;
  /** ISO-8601 last state change. */
  updatedAt: string;
  /** Present when state is `error`. */
  errorMessage: string | null;
};

/** Structured client errors (no secret values in messages). */
export class DaytonaClientError extends Error {
  readonly code: string;
  readonly sandboxId: string | null;

  constructor(
    code: string,
    message: string,
    options: { sandboxId?: string | null } = {},
  ) {
    super(message);
    this.name = "DaytonaClientError";
    this.code = code;
    this.sandboxId = options.sandboxId ?? null;
  }
}

export class DaytonaSandboxNotFoundError extends DaytonaClientError {
  constructor(sandboxId: string) {
    super("DAYTONA_SANDBOX_NOT_FOUND", `Sandbox not found: ${sandboxId}`, {
      sandboxId,
    });
    this.name = "DaytonaSandboxNotFoundError";
  }
}

export class DaytonaSandboxStateError extends DaytonaClientError {
  readonly from: DaytonaSandboxState;
  readonly operation: string;

  constructor(
    sandboxId: string,
    from: DaytonaSandboxState,
    operation: string,
  ) {
    super(
      "DAYTONA_SANDBOX_STATE_ERROR",
      `Cannot ${operation} sandbox ${sandboxId} from state ${from}`,
      { sandboxId },
    );
    this.name = "DaytonaSandboxStateError";
    this.from = from;
    this.operation = operation;
  }
}

/**
 * Managed Daytona API surface used by the Instance Orchestrator.
 *
 * Implementations:
 * - {@link real harnessClient} — in-memory, unit tests / offline ensure_online
 * - {@link import("./daytona-sdk-client.js").DaytonaSdkClient} (`lp-012`) —
 *   managed HTTP API; inject `fetch` for contract tests; key from CP config
 *
 * All methods are async to match network clients; fake resolves immediately.
 */
export interface DaytonaClient {
  /** Create a sandbox from a snapshot (optionally with mounts + env). */
  create(params: CreateSandboxParams): Promise<DaytonaSandbox>;

  /** Start a stopped (or startable) sandbox. */
  start(sandboxId: string): Promise<DaytonaSandbox>;

  /** Stop a running sandbox (idle reaper / explicit stop). */
  stop(sandboxId: string): Promise<DaytonaSandbox>;

  /** Archive / destroy; sandbox must not be used for new starts. */
  archive(sandboxId: string): Promise<DaytonaSandbox>;

  /** Fetch current sandbox record. */
  get(sandboxId: string): Promise<DaytonaSandbox>;

  /** List sandboxes, optionally filtered by label and/or state. */
  list(filter?: ListSandboxesFilter): Promise<DaytonaSandbox[]>;
}

/** Type guard helper for dependency injection sites. */
export function isDaytonaClient(value: unknown): value is DaytonaClient {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const c = value as Record<string, unknown>;
  return (
    typeof c.create === "function" &&
    typeof c.start === "function" &&
    typeof c.stop === "function" &&
    typeof c.archive === "function" &&
    typeof c.get === "function" &&
    typeof c.list === "function"
  );
}
