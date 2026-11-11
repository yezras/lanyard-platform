/**
 * Short-lived STS credentials for Daytona vault Mountpoint (lp-zuh.9.2 / lp-zuh.8).
 *
 * On cold create / ensure_online wake when `s3_vault_prefix` + vault bucket are
 * known, Control Plane assumes the shared base role
 * (`SANDBOX_VAULT_MOUNT_ROLE_ARN` / `lanyard-sandbox-vault-mount`) with a
 * **session policy** locked to `tenants/{tenant_id}/vault/` and injects:
 *
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN
 *   AWS_REGION, AWS_DEFAULT_REGION
 *   (non-secret vault path env stays in sandbox-vault-mount.ts)
 *
 * Never log secret values — use {@link summarizeSandboxVaultMountStsEnvForLog}
 * or {@link daytonaEnvLogSummary}. TTL short (default 3600s); re-issue on every
 * cold create (Daytona has no post-create env PATCH; warm start reuses guest env).
 *
 * Design anchors:
 *   docs/plans/0008-daytona-agent-sandboxes/gateway-env-contract.md
 *   docs/plans/0008-daytona-agent-sandboxes/iam-scoped-s3-mount-policy.md
 *   deploy/modules/sandbox-vault-mount-iam/
 *   docs/plans/0008-daytona-agent-sandboxes/drafts/iam/sandbox-vault-mount-session-policy.json
 */

import {
  AssumeRoleCommand,
  STSClient,
  type STSClientConfig,
} from "@aws-sdk/client-sts";

import type { CreateSandboxParams } from "./daytona-client.js";
import {
  daytonaEnvLogSummary,
  type DaytonaEnvLogSummary,
} from "./daytona-env-redact.js";

// ---------------------------------------------------------------------------
// Env key names (guest inject — gateway-env-contract Bucket C)
// ---------------------------------------------------------------------------

/** Temporary access key id from STS (secret material in logs). */
export const GATEWAY_ENV_AWS_ACCESS_KEY_ID = "AWS_ACCESS_KEY_ID" as const;
/** Temporary secret key from STS (secret material in logs). */
export const GATEWAY_ENV_AWS_SECRET_ACCESS_KEY =
  "AWS_SECRET_ACCESS_KEY" as const;
/** Session token from STS AssumeRole (secret material in logs). */
export const GATEWAY_ENV_AWS_SESSION_TOKEN = "AWS_SESSION_TOKEN" as const;
/** Guest AWS region for mount-s3 (non-secret). */
export const GATEWAY_ENV_AWS_REGION = "AWS_REGION" as const;
/** Alias region env many AWS clients read (non-secret). */
export const GATEWAY_ENV_AWS_DEFAULT_REGION = "AWS_DEFAULT_REGION" as const;

/** Secret guest env keys minted by this module (never log values). */
export const SANDBOX_VAULT_MOUNT_STS_SECRET_ENV_KEYS = [
  GATEWAY_ENV_AWS_ACCESS_KEY_ID,
  GATEWAY_ENV_AWS_SECRET_ACCESS_KEY,
  GATEWAY_ENV_AWS_SESSION_TOKEN,
] as const;

/** Non-secret region keys injected alongside STS. */
export const SANDBOX_VAULT_MOUNT_STS_REGION_ENV_KEYS = [
  GATEWAY_ENV_AWS_REGION,
  GATEWAY_ENV_AWS_DEFAULT_REGION,
] as const;

/** All AWS_* keys this module may inject. */
export const SANDBOX_VAULT_MOUNT_STS_ENV_KEYS = [
  ...SANDBOX_VAULT_MOUNT_STS_SECRET_ENV_KEYS,
  ...SANDBOX_VAULT_MOUNT_STS_REGION_ENV_KEYS,
] as const;

// ---------------------------------------------------------------------------
// CP process env contract (from TF module outputs.cp_env_contract)
// ---------------------------------------------------------------------------

/** Shared base role ARN CP task assumes at wake. */
export const SANDBOX_VAULT_MOUNT_ROLE_ARN_ENV =
  "SANDBOX_VAULT_MOUNT_ROLE_ARN" as const;
/** Optional ExternalId when trust policy requires it. Never log. */
export const SANDBOX_VAULT_MOUNT_EXTERNAL_ID_ENV =
  "SANDBOX_VAULT_MOUNT_EXTERNAL_ID" as const;
/** STS DurationSeconds (900–3600; product default 3600). */
export const SANDBOX_VAULT_MOUNT_DURATION_SECONDS_ENV =
  "SANDBOX_VAULT_MOUNT_DURATION_SECONDS" as const;

/** Product default guest session length (1h). */
export const DEFAULT_SANDBOX_VAULT_MOUNT_DURATION_SECONDS = 3600;
/** STS AssumeRole floor. */
export const MIN_SANDBOX_VAULT_MOUNT_DURATION_SECONDS = 900;
/** Product max guest session (re-issue rather than multi-hour). */
export const MAX_SANDBOX_VAULT_MOUNT_DURATION_SECONDS = 3600;

/** Default region when process env omits AWS_REGION / AWS_DEFAULT_REGION. */
export const DEFAULT_SANDBOX_VAULT_MOUNT_AWS_REGION = "us-east-1";

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class SandboxVaultMountStsError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "SandboxVaultMountStsError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Session policy (path A — matches TF template + drafts/iam)
// ---------------------------------------------------------------------------

/**
 * Render the per-tenant STS session policy JSON.
 * Placeholders match `deploy/modules/sandbox-vault-mount-iam/templates/session-policy.json`.
 * Never embeds secrets — only bucket name + tenant id.
 */
export function buildSandboxVaultMountSessionPolicy(input: {
  vaultBucket: string;
  tenantId: string;
}): string {
  const vaultBucket = input.vaultBucket?.trim() ?? "";
  const tenantId = input.tenantId?.trim() ?? "";
  if (!vaultBucket) {
    throw new SandboxVaultMountStsError(
      "INVALID_BUCKET",
      "vault bucket is required for vault mount session policy",
    );
  }
  if (vaultBucket.startsWith("s3://") || vaultBucket.includes("/")) {
    throw new SandboxVaultMountStsError(
      "INVALID_BUCKET",
      "vault bucket must be a bare name (no s3:// or key prefix)",
    );
  }
  if (!tenantId) {
    throw new SandboxVaultMountStsError(
      "INVALID_TENANT_ID",
      "tenant_id is required for vault mount session policy",
    );
  }
  // Session policy must not allow path traversal or wildcard tenant.
  if (
    tenantId.includes("..") ||
    tenantId.includes("*") ||
    tenantId.includes("/") ||
    tenantId.includes("\\")
  ) {
    throw new SandboxVaultMountStsError(
      "INVALID_TENANT_ID",
      "tenant_id must be a single path segment (no wildcards or slashes)",
    );
  }

  const policy = {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "ListOnlyBoundVaultPrefix",
        Effect: "Allow",
        Action: ["s3:ListBucket", "s3:GetBucketLocation"],
        Resource: `arn:aws:s3:::${vaultBucket}`,
        Condition: {
          StringLike: {
            "s3:prefix": [
              `tenants/${tenantId}/vault/`,
              `tenants/${tenantId}/vault/*`,
            ],
          },
        },
      },
      {
        Sid: "ObjectRWBoundVaultPrefix",
        Effect: "Allow",
        Action: [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:AbortMultipartUpload",
          "s3:ListMultipartUploadParts",
        ],
        Resource: `arn:aws:s3:::${vaultBucket}/tenants/${tenantId}/vault/*`,
      },
      {
        Sid: "DenyListBucketWithoutPrefix",
        Effect: "Deny",
        Action: "s3:ListBucket",
        Resource: `arn:aws:s3:::${vaultBucket}`,
        Condition: {
          Null: {
            "s3:prefix": "true",
          },
        },
      },
      {
        Sid: "DenyListBucketOutsideBoundVaultPrefix",
        Effect: "Deny",
        Action: "s3:ListBucket",
        Resource: `arn:aws:s3:::${vaultBucket}`,
        Condition: {
          StringNotLike: {
            "s3:prefix": [
              `tenants/${tenantId}/vault/`,
              `tenants/${tenantId}/vault/*`,
            ],
          },
        },
      },
      {
        Sid: "DenyPlatformSiblingUnderTenant",
        Effect: "Deny",
        Action: "s3:*",
        Resource: [
          `arn:aws:s3:::${vaultBucket}/tenants/${tenantId}/_platform`,
          `arn:aws:s3:::${vaultBucket}/tenants/${tenantId}/_platform/*`,
        ],
      },
    ],
  };
  return JSON.stringify(policy);
}

/**
 * Clamp STS DurationSeconds into product range [900, 3600].
 */
export function clampSandboxVaultMountDurationSeconds(
  raw: number | undefined | null,
): number {
  if (raw === undefined || raw === null || Number.isNaN(raw)) {
    return DEFAULT_SANDBOX_VAULT_MOUNT_DURATION_SECONDS;
  }
  const n = Math.floor(raw);
  if (n < MIN_SANDBOX_VAULT_MOUNT_DURATION_SECONDS) {
    return MIN_SANDBOX_VAULT_MOUNT_DURATION_SECONDS;
  }
  if (n > MAX_SANDBOX_VAULT_MOUNT_DURATION_SECONDS) {
    return MAX_SANDBOX_VAULT_MOUNT_DURATION_SECONDS;
  }
  return n;
}

/**
 * Build a RoleSessionName ≤64 chars (STS limit). Safe for logs (no secrets).
 */
export function buildSandboxVaultMountRoleSessionName(input: {
  instanceId: string;
  tenantId: string;
}): string {
  const instance = (input.instanceId?.trim() || "unknown").replace(
    /[^A-Za-z0-9+=,.@_-]/g,
    "-",
  );
  const tenant = (input.tenantId?.trim() || "t").replace(
    /[^A-Za-z0-9+=,.@_-]/g,
    "-",
  );
  // Prefer instance id; prefix with vault- for ops grep.
  const base = `vault-${instance}`;
  if (base.length <= 64) return base;
  // Fall back to short hash-like trim: vault- + first 32 of instance + tenant slice
  const short = `v-${instance.slice(0, 32)}-${tenant.slice(0, 20)}`;
  return short.slice(0, 64);
}

// ---------------------------------------------------------------------------
// Issuer port + credential types
// ---------------------------------------------------------------------------

/** Temporary credentials returned by STS AssumeRole (in-memory only). */
export type SandboxVaultMountStsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  /** ISO-8601 expiry when known; null if issuer omitted it. */
  expiration: string | null;
  /** DurationSeconds requested for this session. */
  durationSeconds: number;
};

export type MintSandboxVaultMountStsInput = {
  /** Permanent CP instance_id (session name / audit). */
  instanceId: string;
  /** Tenant UUID — session policy binds tenants/{tenantId}/vault/. */
  tenantId: string;
  /** Bare vault bucket name. */
  vaultBucket: string;
  /**
   * Durable s3_vault_prefix (must already be tenant-bound by caller).
   * Used for validation/logging only; policy is built from tenantId + bucket.
   */
  s3VaultPrefix: string;
  /** Optional override for DurationSeconds (clamped). */
  durationSeconds?: number;
};

/**
 * Port: mint short-lived vault mount credentials for one wake.
 * Implementations must not log secret values.
 */
export type SandboxVaultMountStsIssuer = {
  mint(
    input: MintSandboxVaultMountStsInput,
  ): Promise<SandboxVaultMountStsCredentials>;
};

// ---------------------------------------------------------------------------
// Env builders
// ---------------------------------------------------------------------------

export type BuildSandboxVaultMountStsEnvInput = {
  credentials: SandboxVaultMountStsCredentials;
  /** Guest + STS region (AWS_REGION / AWS_DEFAULT_REGION). */
  awsRegion: string;
};

/**
 * Build create-time AWS_* env fragment from STS credentials.
 * Values are secrets — do not log; use {@link summarizeSandboxVaultMountStsEnvForLog}.
 */
export function buildSandboxVaultMountStsEnv(
  input: BuildSandboxVaultMountStsEnvInput,
): Readonly<Record<string, string>> {
  const accessKeyId = input.credentials.accessKeyId?.trim() ?? "";
  const secretAccessKey = input.credentials.secretAccessKey ?? "";
  const sessionToken = input.credentials.sessionToken ?? "";
  const awsRegion = input.awsRegion?.trim() || DEFAULT_SANDBOX_VAULT_MOUNT_AWS_REGION;

  if (!accessKeyId || !secretAccessKey || !sessionToken) {
    throw new SandboxVaultMountStsError(
      "INVALID_CREDENTIALS",
      "STS credentials incomplete (access key, secret, and session token required)",
    );
  }

  return Object.freeze({
    [GATEWAY_ENV_AWS_ACCESS_KEY_ID]: accessKeyId,
    [GATEWAY_ENV_AWS_SECRET_ACCESS_KEY]: secretAccessKey,
    [GATEWAY_ENV_AWS_SESSION_TOKEN]: sessionToken,
    [GATEWAY_ENV_AWS_REGION]: awsRegion,
    [GATEWAY_ENV_AWS_DEFAULT_REGION]: awsRegion,
  });
}

/**
 * Merge STS AWS_* env into create params. STS keys always win so a stale
 * process-env leak cannot clobber wake-minted credentials.
 */
export function applySandboxVaultMountStsEnvToCreateParams(
  params: CreateSandboxParams,
  stsEnv: Readonly<Record<string, string>>,
): CreateSandboxParams {
  return {
    ...params,
    env: {
      ...(params.env ?? {}),
      ...stsEnv,
    },
  };
}

/**
 * Log-safe summary: key names + secret present/length/fingerprint only.
 * Never includes raw secret values. Prefer this over dumping create env.
 */
export function summarizeSandboxVaultMountStsEnvForLog(
  env: Readonly<Record<string, string>> | null | undefined,
): DaytonaEnvLogSummary {
  return daytonaEnvLogSummary(env);
}

/**
 * True when all three secret AWS_* keys are present and non-empty.
 */
export function hasSandboxVaultMountStsEnv(
  env: Readonly<Record<string, string>> | null | undefined,
): boolean {
  if (!env) return false;
  return SANDBOX_VAULT_MOUNT_STS_SECRET_ENV_KEYS.every(
    (k) => typeof env[k] === "string" && env[k]!.trim().length > 0,
  );
}

// ---------------------------------------------------------------------------
// Fake issuer (unit tests / offline)
// ---------------------------------------------------------------------------

export type FakeSandboxVaultMountStsIssuer = SandboxVaultMountStsIssuer & {
  /** Calls recorded (no secret values — only safe fields). */
  readonly calls: ReadonlyArray<{
    instanceId: string;
    tenantId: string;
    vaultBucket: string;
    s3VaultPrefix: string;
    durationSeconds: number;
  }>;
  /** Force next mint() to fail (fail-closed tests). */
  failNext(message?: string): void;
  /** Clear recorded calls + fail flag. */
  reset(): void;
  /** Test-only: last minted secret access key (never log in product). */
  getLastSecretAccessKeyForTest(): string | null;
};

/**
 * Deterministic fake STS issuer for offline unit tests.
 * Credentials look realistic enough for env-shape asserts; not valid AWS keys.
 */
export function createFakeSandboxVaultMountStsIssuer(options?: {
  durationSeconds?: number;
  /** Fixed access key id prefix (default ASIATEST). */
  accessKeyIdPrefix?: string;
}): FakeSandboxVaultMountStsIssuer {
  const defaultDuration = clampSandboxVaultMountDurationSeconds(
    options?.durationSeconds,
  );
  const prefix = options?.accessKeyIdPrefix?.trim() || "ASIATEST";
  const calls: Array<{
    instanceId: string;
    tenantId: string;
    vaultBucket: string;
    s3VaultPrefix: string;
    durationSeconds: number;
  }> = [];
  let failMessage: string | null = null;
  let lastSecret: string | null = null;
  let seq = 0;

  return {
    get calls() {
      return calls;
    },

    failNext(message = "simulated AssumeRole failure"): void {
      failMessage = message;
    },

    reset(): void {
      calls.length = 0;
      failMessage = null;
      lastSecret = null;
      seq = 0;
    },

    getLastSecretAccessKeyForTest(): string | null {
      return lastSecret;
    },

    async mint(
      input: MintSandboxVaultMountStsInput,
    ): Promise<SandboxVaultMountStsCredentials> {
      if (failMessage) {
        const msg = failMessage;
        failMessage = null;
        throw new SandboxVaultMountStsError("ASSUME_ROLE_FAILED", msg);
      }
      // Validate policy inputs the same way the live path does.
      buildSandboxVaultMountSessionPolicy({
        vaultBucket: input.vaultBucket,
        tenantId: input.tenantId,
      });
      const durationSeconds = clampSandboxVaultMountDurationSeconds(
        input.durationSeconds ?? defaultDuration,
      );
      calls.push({
        instanceId: input.instanceId,
        tenantId: input.tenantId,
        vaultBucket: input.vaultBucket,
        s3VaultPrefix: input.s3VaultPrefix,
        durationSeconds,
      });
      seq += 1;
      const accessKeyId = `${prefix}${String(seq).padStart(4, "0")}`;
      // Deterministic but non-empty secret material for redaction tests.
      const secretAccessKey = `fake-secret-${input.instanceId.slice(0, 8)}-${seq}`;
      const sessionToken = `fake-session-token-${input.tenantId.slice(0, 8)}-${seq}`;
      lastSecret = secretAccessKey;
      const expiration = new Date(
        Date.now() + durationSeconds * 1000,
      ).toISOString();
      return {
        accessKeyId,
        secretAccessKey,
        sessionToken,
        expiration,
        durationSeconds,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Live AWS STS issuer
// ---------------------------------------------------------------------------

export type AwsSdkSandboxVaultMountStsIssuerOptions = {
  /** Shared base role ARN (SANDBOX_VAULT_MOUNT_ROLE_ARN). */
  roleArn: string;
  /** Optional ExternalId when trust requires it. Never log. */
  externalId?: string | null;
  /** Default DurationSeconds (clamped 900–3600). @default 3600 */
  durationSeconds?: number;
  /**
   * Region for the STS client (and a hint for guest AWS_REGION).
   * @default process env / us-east-1
   */
  region?: string;
  /** Optional STS client override (tests inject a stub client). */
  stsClient?: STSClient;
  /** Optional STSClient config when constructing the default client. */
  stsClientConfig?: STSClientConfig;
};

/**
 * Live issuer: sts:AssumeRole + session policy on the shared vault-mount role.
 * Uses task-role credentials from the default AWS credential chain (ECS task).
 */
export function createAwsSdkSandboxVaultMountStsIssuer(
  options: AwsSdkSandboxVaultMountStsIssuerOptions,
): SandboxVaultMountStsIssuer {
  const roleArn = options.roleArn?.trim() ?? "";
  if (!roleArn) {
    throw new SandboxVaultMountStsError(
      "INVALID_ROLE_ARN",
      "SANDBOX_VAULT_MOUNT_ROLE_ARN is required for live vault mount STS",
    );
  }
  if (!roleArn.startsWith("arn:aws:iam::") || !roleArn.includes(":role/")) {
    throw new SandboxVaultMountStsError(
      "INVALID_ROLE_ARN",
      "SANDBOX_VAULT_MOUNT_ROLE_ARN must be an IAM role ARN",
    );
  }
  const externalId = options.externalId?.trim() || null;
  const defaultDuration = clampSandboxVaultMountDurationSeconds(
    options.durationSeconds,
  );
  const region =
    options.region?.trim() || DEFAULT_SANDBOX_VAULT_MOUNT_AWS_REGION;
  const client =
    options.stsClient ??
    new STSClient({
      region,
      ...(options.stsClientConfig ?? {}),
    });

  return {
    async mint(
      input: MintSandboxVaultMountStsInput,
    ): Promise<SandboxVaultMountStsCredentials> {
      const durationSeconds = clampSandboxVaultMountDurationSeconds(
        input.durationSeconds ?? defaultDuration,
      );
      let policy: string;
      try {
        policy = buildSandboxVaultMountSessionPolicy({
          vaultBucket: input.vaultBucket,
          tenantId: input.tenantId,
        });
      } catch (err) {
        if (err instanceof SandboxVaultMountStsError) throw err;
        throw new SandboxVaultMountStsError(
          "SESSION_POLICY_BUILD_FAILED",
          "failed to build vault mount session policy",
          { cause: err },
        );
      }
      const roleSessionName = buildSandboxVaultMountRoleSessionName({
        instanceId: input.instanceId,
        tenantId: input.tenantId,
      });

      try {
        const out = await client.send(
          new AssumeRoleCommand({
            RoleArn: roleArn,
            RoleSessionName: roleSessionName,
            DurationSeconds: durationSeconds,
            Policy: policy,
            ...(externalId ? { ExternalId: externalId } : {}),
          }),
        );
        const creds = out.Credentials;
        if (
          !creds?.AccessKeyId ||
          !creds.SecretAccessKey ||
          !creds.SessionToken
        ) {
          throw new SandboxVaultMountStsError(
            "ASSUME_ROLE_FAILED",
            "AssumeRole returned incomplete credentials",
          );
        }
        return {
          accessKeyId: creds.AccessKeyId,
          secretAccessKey: creds.SecretAccessKey,
          sessionToken: creds.SessionToken,
          expiration: creds.Expiration
            ? creds.Expiration.toISOString()
            : null,
          durationSeconds,
        };
      } catch (err) {
        if (err instanceof SandboxVaultMountStsError) throw err;
        const msg =
          err instanceof Error ? err.message : "AssumeRole failed";
        // Never include policy body or secret material in the message.
        throw new SandboxVaultMountStsError(
          "ASSUME_ROLE_FAILED",
          `vault mount AssumeRole failed: ${msg}`,
          { cause: err },
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Env resolution (server boot)
// ---------------------------------------------------------------------------

export type ResolvedSandboxVaultMountSts = {
  /** Null when role ARN unset (STS inject skipped). */
  issuer: SandboxVaultMountStsIssuer | null;
  /** Guest + STS AWS region. */
  awsRegion: string;
  /** Safe for logs — never role external id or secrets. */
  configured: boolean;
  /** Role ARN present (value itself is not secret but avoid dumping in noisy logs). */
  roleArnConfigured: boolean;
  durationSeconds: number;
};

/**
 * Resolve vault-mount STS issuer from CP process env (lp-zuh.9.2).
 *
 * - `SANDBOX_VAULT_MOUNT_ROLE_ARN` set → live STS issuer
 * - unset → issuer null (skip inject; offline / pre-IAM boots)
 *
 * Duration from `SANDBOX_VAULT_MOUNT_DURATION_SECONDS` (default 3600).
 * Region from `AWS_REGION` or `AWS_DEFAULT_REGION` (default us-east-1).
 */
export function resolveSandboxVaultMountStsFromEnv(
  env: NodeJS.ProcessEnv | Readonly<Record<string, string | undefined>> = process.env,
): ResolvedSandboxVaultMountSts {
  const roleArn = env[SANDBOX_VAULT_MOUNT_ROLE_ARN_ENV]?.trim() ?? "";
  const externalId = env[SANDBOX_VAULT_MOUNT_EXTERNAL_ID_ENV]?.trim() || null;
  const durationRaw = env[SANDBOX_VAULT_MOUNT_DURATION_SECONDS_ENV]?.trim();
  const durationSeconds = clampSandboxVaultMountDurationSeconds(
    durationRaw ? Number(durationRaw) : undefined,
  );
  const awsRegion =
    env.AWS_REGION?.trim() ||
    env.AWS_DEFAULT_REGION?.trim() ||
    DEFAULT_SANDBOX_VAULT_MOUNT_AWS_REGION;

  if (!roleArn) {
    return {
      issuer: null,
      awsRegion,
      configured: false,
      roleArnConfigured: false,
      durationSeconds,
    };
  }

  return {
    issuer: createAwsSdkSandboxVaultMountStsIssuer({
      roleArn,
      externalId,
      durationSeconds,
      region: awsRegion,
    }),
    awsRegion,
    configured: true,
    roleArnConfigured: true,
    durationSeconds,
  };
}
