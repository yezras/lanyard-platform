/**
 * Orchestrator create/start params for S3 vault Mountpoint (lp-hjo / lp-3a1.5).
 *
 * Maps durable CP `s3_vault_prefix` → guest mount at **VAULT_ROOT**.
 * Path must match the gateway env contract and the agent-gateway entrypoint
 * default (`deploy/daytona/agent-gateway/entrypoint.sh` → `/mnt/vault`).
 *
 * Product path (spike-3en + lp-zuh.9 Mountpoint):
 *   1. Create-time **env** inject (not Daytona-hosted `volumes[]`):
 *      - `VAULT_ROOT` (agent product contract — parity with EC2)
 *      - `S3_VAULT_PREFIX` / `LANYARD_VAULT_BUCKET` (entrypoint `mount-s3`)
 *      - short-lived `AWS_*` via STS (lp-zuh.9.2) so guest can mount
 *   2. Guest entrypoint runs `mount-s3` → `/mnt/vault` (lp-zuh.6).
 * Do **not** map the platform S3 bucket name into Daytona `volumes[].volumeId`
 * — that API expects Daytona volume UUIDs; bucket names yield create 404
 * (lp-zuh.9.4 live proof). {@link DaytonaMountSpec} remains CP metadata.
 *
 * Design anchors:
 *   docs/plans/0008-daytona-agent-sandboxes/gateway-env-contract.md
 *   docs/plans/0008-daytona-agent-sandboxes/s3-vault-prefix-layout.md
 *   docs/plans/0008-daytona-agent-sandboxes/spike-3en-s3-vault-mount.md
 *   docs/plans/0008-daytona-agent-sandboxes/iam-scoped-s3-mount-policy.md
 */

import type {
  CreateSandboxParams,
  DaytonaMountSpec,
} from "./daytona-client.js";

/**
 * Guest absolute path for Daytona vault mount / `VAULT_ROOT`.
 * Matches `entrypoint.sh` default (`VAULT_ROOT="${VAULT_ROOT:-/mnt/vault}"`).
 * EC2 host disk may still use `/opt/company-brain`; Daytona wake injects this.
 */
export const DEFAULT_DAYTONA_VAULT_ROOT = "/mnt/vault";

/**
 * Alias for orchestrator deps (`vaultMountPath` default).
 * Same value as {@link DEFAULT_DAYTONA_VAULT_ROOT}.
 */
export const DEFAULT_VAULT_MOUNT_PATH = DEFAULT_DAYTONA_VAULT_ROOT;

/** Gateway env contract key — absolute local vault tree. */
export const GATEWAY_ENV_VAULT_ROOT = "VAULT_ROOT" as const;

/**
 * Entrypoint / Mountpoint helper: durable prefix string.
 * Agent product contract prefers `VAULT_ROOT` only (gateway-env-contract.md).
 */
export const GATEWAY_ENV_S3_VAULT_PREFIX = "S3_VAULT_PREFIX" as const;

/**
 * Platform vault bucket name for mount-s3 (helper; not agent auth identity).
 * Matches IAM template placeholder `${LANYARD_VAULT_BUCKET}`.
 */
export const GATEWAY_ENV_LANYARD_VAULT_BUCKET = "LANYARD_VAULT_BUCKET" as const;

/**
 * Entrypoint knob (lp-kng.6.7): seconds the guest entrypoint retries the
 * post-mount writable probe before failing closed. Mountpoint can take
 * minutes to accept first writes on cold mounts (lp-frwn observed ~60s+;
 * 2026-08-24 staging wakes exceeded the baked 120s default repeatedly),
 * which killed the guest before the gateway started → relay_never_connect.
 * CP injects a wider window so cold creates survive slow FUSE settle.
 */
export const GATEWAY_ENV_POST_MOUNT_WRITABLE_SEC =
  "LANYARD_ENTRY_POST_MOUNT_WRITABLE_SEC" as const;

/** Default injected window (seconds); ≥ entrypoint baked default (120).
 * 2026-08-24 staging: lone cold mounts took 3–15+ min to accept first
 * writes; 600 was exceeded repeatedly during multi-mount churn. */
export const DEFAULT_POST_MOUNT_WRITABLE_SEC = 1200;

export class SandboxVaultMountError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SandboxVaultMountError";
    this.code = code;
  }
}

export type BuildSandboxVaultMountInput = {
  /**
   * CP `s3_vault_prefix` (e.g. `tenants/{tenant_id}/vault/`).
   * Full `s3://bucket/prefix` URIs are accepted and split when possible.
   */
  s3VaultPrefix: string;
  /**
   * Guest absolute mount path (= `VAULT_ROOT`).
   * @default DEFAULT_DAYTONA_VAULT_ROOT
   */
  vaultRoot?: string | null;
  /**
   * Platform vault bucket (bare name, no `s3://`).
   * Optional until CP config wires `vault.bucket`; when set, included on
   * the mount spec and as `LANYARD_VAULT_BUCKET` env for mount helpers.
   */
  vaultBucket?: string | null;
};

/**
 * Create/start fragment for vault Mountpoint: mounts + non-secret env.
 * Merge `env` into {@link CreateSandboxParams.env}; never log secrets here
 * (this fragment has none).
 */
export type SandboxVaultMountParams = {
  mounts: readonly DaytonaMountSpec[];
  env: Readonly<Record<string, string>>;
  /** Resolved absolute guest `VAULT_ROOT`. */
  vaultRoot: string;
  /** Normalized prefix with trailing slash. */
  s3Prefix: string;
  /** Bare bucket when known; null if not supplied. */
  vaultBucket: string | null;
};

/**
 * Resolve guest vault path for Daytona wake inject.
 * Empty/unset → {@link DEFAULT_DAYTONA_VAULT_ROOT}.
 */
export function resolveDaytonaVaultRoot(
  vaultRoot?: string | null,
): string {
  const p = vaultRoot?.trim() ?? "";
  return p || DEFAULT_DAYTONA_VAULT_ROOT;
}

/**
 * Normalize CP prefix to a relative key prefix with trailing slash.
 * Accepts `tenants/…/vault/`, `tenants/…/vault`, or `s3://bucket/tenants/…`.
 * When a full URI is passed and `vaultBucket` is empty, bucket is returned
 * from the URI so callers can fill mount env.
 */
export function normalizeS3VaultPrefix(raw: string): {
  s3Prefix: string;
  bucketFromUri: string | null;
} {
  const input = raw?.trim() ?? "";
  if (!input) {
    throw new SandboxVaultMountError(
      "INVALID_S3_VAULT_PREFIX",
      "s3_vault_prefix is required for vault mount",
    );
  }

  let bucketFromUri: string | null = null;
  let prefix = input;

  if (prefix.startsWith("s3://")) {
    const withoutScheme = prefix.slice("s3://".length);
    const slash = withoutScheme.indexOf("/");
    if (slash <= 0) {
      throw new SandboxVaultMountError(
        "INVALID_S3_VAULT_PREFIX",
        "s3:// URI must include bucket and key prefix",
      );
    }
    bucketFromUri = withoutScheme.slice(0, slash);
    prefix = withoutScheme.slice(slash + 1);
  }

  if (prefix.startsWith("/")) {
    throw new SandboxVaultMountError(
      "INVALID_S3_VAULT_PREFIX",
      "s3_vault_prefix must be a relative key prefix (not an absolute path)",
    );
  }
  if (prefix.includes("..")) {
    throw new SandboxVaultMountError(
      "INVALID_S3_VAULT_PREFIX",
      "s3_vault_prefix must not contain path traversal",
    );
  }

  if (!prefix.endsWith("/")) {
    prefix = `${prefix}/`;
  }
  return { s3Prefix: prefix, bucketFromUri };
}

function assertAbsoluteVaultRoot(vaultRoot: string): string {
  const p = vaultRoot.trim();
  if (!p.startsWith("/")) {
    throw new SandboxVaultMountError(
      "INVALID_VAULT_ROOT",
      "VAULT_ROOT / mountPath must be an absolute guest path",
    );
  }
  if (p.includes("..")) {
    throw new SandboxVaultMountError(
      "INVALID_VAULT_ROOT",
      "VAULT_ROOT must not contain path traversal",
    );
  }
  // Strip trailing slash except root (agent expects a directory path).
  if (p.length > 1 && p.endsWith("/")) {
    return p.replace(/\/+$/, "");
  }
  return p;
}

function assertBareBucket(bucket: string): string {
  const b = bucket.trim();
  if (!b) {
    throw new SandboxVaultMountError("INVALID_BUCKET", "vault bucket is empty");
  }
  if (b.startsWith("s3://") || b.includes("/")) {
    throw new SandboxVaultMountError(
      "INVALID_BUCKET",
      "vault bucket must be a bare name (no s3:// or key prefix)",
    );
  }
  return b;
}

/**
 * Build create/start mount params: tenant prefix → `VAULT_ROOT`.
 *
 * Guarantees:
 * - `mounts[0].mountPath === env.VAULT_ROOT` (gateway env parity)
 * - `mounts[0].s3Prefix` is the durable tenant prefix (trailing slash)
 * - No secrets in the returned env fragment
 */
export function buildSandboxVaultMountParams(
  input: BuildSandboxVaultMountInput,
): SandboxVaultMountParams {
  const vaultRoot = assertAbsoluteVaultRoot(
    resolveDaytonaVaultRoot(input.vaultRoot),
  );
  const { s3Prefix, bucketFromUri } = normalizeS3VaultPrefix(
    input.s3VaultPrefix,
  );

  let vaultBucket: string | null = null;
  const rawBucket = input.vaultBucket?.trim() || bucketFromUri;
  if (rawBucket) {
    vaultBucket = assertBareBucket(rawBucket);
  }

  const mount: DaytonaMountSpec = {
    s3Prefix,
    mountPath: vaultRoot,
  };
  if (vaultBucket) {
    mount.s3Bucket = vaultBucket;
  }

  const env: Record<string, string> = {
    [GATEWAY_ENV_VAULT_ROOT]: vaultRoot,
    [GATEWAY_ENV_S3_VAULT_PREFIX]: s3Prefix,
  };
  if (vaultBucket) {
    env[GATEWAY_ENV_LANYARD_VAULT_BUCKET] = vaultBucket;
    // Only meaningful when the entrypoint will run mount-s3 (bucket present).
    env[GATEWAY_ENV_POST_MOUNT_WRITABLE_SEC] = String(
      DEFAULT_POST_MOUNT_WRITABLE_SEC,
    );
  }

  return {
    mounts: Object.freeze([Object.freeze({ ...mount })]),
    env: Object.freeze(env),
    vaultRoot,
    s3Prefix,
    vaultBucket,
  };
}

/**
 * Merge vault mount mounts + env into a create request.
 * Existing `params.env` keys are preserved unless overridden by mount env
 * (`VAULT_ROOT` / prefix / bucket always win so path stays consistent).
 *
 * Real SDK create maps `mounts` → HTTP body `volumes[]` when `s3Bucket` is set
 * (lp-3a1.5); see {@link buildDaytonaCreateVolumes}.
 */
export function applyVaultMountToCreateParams(
  params: CreateSandboxParams,
  mount: SandboxVaultMountParams,
): CreateSandboxParams {
  return {
    ...params,
    mounts: mount.mounts,
    env: {
      ...(params.env ?? {}),
      ...mount.env,
    },
  };
}

/**
 * Daytona `POST /sandbox` volume attach shape (lp-3a1.5).
 *
 * Managed API: `volumes: [{ volumeId, mountPath, subpath? }]`.
 * We map platform vault bucket → `volumeId`, tenant prefix → `subpath`,
 * guest `VAULT_ROOT` → `mountPath` so cold create is not `volumes=[]`.
 *
 * When `vaultBucket` / `s3Bucket` is missing, returns empty (env-only path
 * still injects `VAULT_ROOT` / `S3_VAULT_PREFIX` for guest helpers).
 */
export type DaytonaCreateVolumeMount = {
  volumeId: string;
  mountPath: string;
  /** S3 key prefix within the volume (tenant vault tree). */
  subpath: string;
};

/**
 * Build Daytona create `volumes` from vault mount params.
 *
 * **Product path (lp-zuh.9 / spike-3en):** Lanyard vault is **not** a Daytona
 * hosted volume. Guest Mountpoint (`mount-s3`) uses create-time env:
 * `VAULT_ROOT` + `S3_VAULT_PREFIX` + `LANYARD_VAULT_BUCKET` + short-lived
 * `AWS_*` (lp-zuh.9.2). Mapping the platform S3 **bucket name** into Daytona
 * `volumes[].volumeId` makes `POST /sandbox` return **404** (volume not found)
 * — live proof lp-zuh.9.4. Always return empty; keep helper for contract tests
 * and any future first-class Daytona volume id path.
 */
export function buildDaytonaCreateVolumes(
  _mount: Pick<SandboxVaultMountParams, "mounts" | "vaultBucket" | "vaultRoot" | "s3Prefix">,
): DaytonaCreateVolumeMount[] {
  return [];
}

/**
 * Map CP {@link DaytonaMountSpec} list → Daytona create `volumes` body.
 *
 * Always empty for S3 vault mounts (see {@link buildDaytonaCreateVolumes}).
 * Daytona `volumeId` is a Daytona volume UUID, not an AWS bucket name.
 */
export function mountsToDaytonaCreateVolumes(
  _mounts: readonly DaytonaMountSpec[] | undefined | null,
): DaytonaCreateVolumeMount[] {
  return [];
}

/**
 * True when mount path and gateway `VAULT_ROOT` env agree (contract check).
 */
export function vaultRootMatchesMount(
  mounts: readonly DaytonaMountSpec[] | undefined,
  env: Readonly<Record<string, string>> | undefined,
): boolean {
  const root = env?.[GATEWAY_ENV_VAULT_ROOT]?.trim();
  const mountPath = mounts?.[0]?.mountPath?.trim();
  if (!root || !mountPath) return false;
  return root === mountPath;
}
