/**
 * Gateway Relay credentials for Daytona wake inject (lp-9my / lp-3a1.2).
 *
 * CP register/rotate issues a show-once plaintext secret and stores only
 * scrypt hashes in Postgres. The plaintext must still be available to the
 * Instance Orchestrator for create-time `env` inject (spike-4l5 / Bucket C):
 *
 *   GATEWAY_RELAY_URL
 *   GATEWAY_RELAY_ID          (= permanent instance_id)
 *   GATEWAY_RELAY_INSTANCE_ID (= permanent instance_id)
 *   GATEWAY_RELAY_SECRET
 *
 * Design:
 *   docs/plans/0008-daytona-agent-sandboxes/gateway-env-contract.md
 *   docs/plans/0008-daytona-agent-sandboxes/spike-4l5-gateway-secret-inject.md
 *   docs/plans/0008-daytona-agent-sandboxes/provision-runbook-daytona.md §2
 *
 * Material store:
 *   - In-memory (default / tests)
 *   - Encrypted file when INSTANCE_SECRET_MATERIAL_PATH + KEY are set (lp-3a1.2)
 *   - Same AES-256-GCM envelope in Secrets Manager when
 *     INSTANCE_SECRET_MATERIAL_SM_SECRET_ID + KEY are set (lp-oop.37.6)
 *     so Fargate /tmp wipe cannot empty remaining guest_gateway wakes.
 * Never put plaintext in Postgres, audit logs, or git. Never log secret values —
 * use {@link fingerprintSecretValue} from daytona-env-redact when needed.
 */

import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
  type SecretsManagerClientConfig,
} from "@aws-sdk/client-secrets-manager";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { CreateSandboxParams } from "./daytona-client.js";
import type { RelayTier } from "./types.js";
import { RELAY_TIERS } from "./types.js";

/** Process env: Relay WSS base URL (parity with EC2). */
export const GATEWAY_ENV_RELAY_URL = "GATEWAY_RELAY_URL" as const;
/** Process env: gateway id presented to Relay (same as instance_id). */
export const GATEWAY_ENV_RELAY_ID = "GATEWAY_RELAY_ID" as const;
/** Process env: permanent product instance_id (never sandbox_id). */
export const GATEWAY_ENV_RELAY_INSTANCE_ID = "GATEWAY_RELAY_INSTANCE_ID" as const;
/** Process env: long-lived instance secret for WSS upgrade / HMAC. */
export const GATEWAY_ENV_RELAY_SECRET = "GATEWAY_RELAY_SECRET" as const;

/** Bucket C relay env keys the guest gateway expects. */
export const GATEWAY_RELAY_ENV_KEYS = [
  GATEWAY_ENV_RELAY_URL,
  GATEWAY_ENV_RELAY_ID,
  GATEWAY_ENV_RELAY_INSTANCE_ID,
  GATEWAY_ENV_RELAY_SECRET,
] as const;

export type GatewayRelayEnvKey = (typeof GATEWAY_RELAY_ENV_KEYS)[number];

export class GatewayRelayEnvError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GatewayRelayEnvError";
    this.code = code;
  }
}

/**
 * Missing plaintext material when orchestrator cold-creates a sandbox.
 * Register/rotate must {@link InstanceSecretMaterialStore.put} first.
 */
export class MissingInstanceSecretMaterialError extends Error {
  readonly code = "MISSING_INSTANCE_SECRET_MATERIAL" as const;
  readonly instanceId: string;

  constructor(instanceId: string) {
    super(
      `Missing relay secret material for instance ${instanceId}; ` +
        "register/rotate must put secret for wake inject (lp-9my)",
    );
    this.name = "MissingInstanceSecretMaterialError";
    this.instanceId = instanceId;
  }
}

/**
 * Platform-held plaintext material for wake inject.
 * Never write this to Postgres, audit logs, or git. In-memory or SSM/SM only.
 */
export type InstanceSecretMaterial = {
  instance_id: string;
  tenant_id: string;
  /** Show-once secret from register/rotate. */
  secret: string;
  /** Tenant-resolved Relay WSS URL (shared or dedicated tier). */
  relay_wss_url: string;
  relay_tier: RelayTier;
  /** ISO timestamp when this secret was issued (register or rotate). */
  issued_at: string;
};

/**
 * Port: store plaintext after register/rotate; orchestrator reads on cold create.
 * Implementations must not log secret values.
 */
export type InstanceSecretMaterialStore = {
  put(material: InstanceSecretMaterial): Promise<void>;
  get(instanceId: string): Promise<InstanceSecretMaterial | null>;
  delete(instanceId: string): Promise<void>;
};

export type BuildGatewayRelayEnvInput = {
  /** Permanent CP instance_id (Relay identity). */
  instanceId: string;
  /** Relay WSS URL for the tenant tier. */
  relayWssUrl: string;
  /** Plaintext instance secret. */
  secret: string;
};

/**
 * Build create-time env map for gateway Relay dial (spike-4l5 primary path).
 * Sets GATEWAY_RELAY_ID and GATEWAY_RELAY_INSTANCE_ID to the same permanent
 * instance_id — never sandbox_id.
 */
export function buildGatewayRelayEnv(
  input: BuildGatewayRelayEnvInput,
): Readonly<Record<string, string>> {
  const instanceId = input.instanceId?.trim() ?? "";
  const relayWssUrl = input.relayWssUrl?.trim() ?? "";
  // Do not trim secret beyond empty check — value is opaque base64url.
  const secret = input.secret ?? "";

  if (!instanceId) {
    throw new GatewayRelayEnvError(
      "INVALID_INSTANCE_ID",
      "instance_id is required for GATEWAY_RELAY_* inject",
    );
  }
  if (!relayWssUrl) {
    throw new GatewayRelayEnvError(
      "INVALID_RELAY_WSS_URL",
      "relay_wss_url is required for GATEWAY_RELAY_URL inject",
    );
  }
  if (!secret) {
    throw new GatewayRelayEnvError(
      "INVALID_SECRET",
      "secret is required for GATEWAY_RELAY_SECRET inject",
    );
  }

  return Object.freeze({
    [GATEWAY_ENV_RELAY_URL]: relayWssUrl,
    [GATEWAY_ENV_RELAY_ID]: instanceId,
    [GATEWAY_ENV_RELAY_INSTANCE_ID]: instanceId,
    [GATEWAY_ENV_RELAY_SECRET]: secret,
  });
}

/**
 * Build material from a provisioned/rotated instance response (show-once).
 */
export function materialFromIssued(input: {
  instance_id: string;
  tenant_id: string;
  secret: string;
  relay_wss_url: string;
  relay_tier: RelayTier;
  issued_at?: string;
}): InstanceSecretMaterial {
  const instance_id = input.instance_id?.trim() ?? "";
  const tenant_id = input.tenant_id?.trim() ?? "";
  const relay_wss_url = input.relay_wss_url?.trim() ?? "";
  const secret = input.secret ?? "";
  if (!instance_id || !tenant_id || !relay_wss_url || !secret) {
    throw new GatewayRelayEnvError(
      "INVALID_MATERIAL",
      "instance_id, tenant_id, relay_wss_url, and secret are required",
    );
  }
  return {
    instance_id,
    tenant_id,
    secret,
    relay_wss_url,
    relay_tier: input.relay_tier,
    issued_at: input.issued_at ?? new Date().toISOString(),
  };
}

/**
 * Merge Relay env into create params. Relay keys always win so vault/helper
 * env cannot clobber GATEWAY_RELAY_SECRET.
 */
export function applyGatewayRelayEnvToCreateParams(
  params: CreateSandboxParams,
  relayEnv: Readonly<Record<string, string>>,
): CreateSandboxParams {
  return {
    ...params,
    env: {
      ...(params.env ?? {}),
      ...relayEnv,
    },
  };
}

/**
 * In-process material store for lab / single-process CP + unit tests.
 * Default when durable env is unset. Never put plaintext in git or Postgres.
 */
export function createInMemoryInstanceSecretMaterialStore(): InstanceSecretMaterialStore & {
  /** Test/ops: number of held secrets (no values). */
  size(): number;
  /** Test-only: read secret for assertions — never log in product code. */
  getSecretForTest(instanceId: string): string | null;
  /** Test-only: clear all material. */
  clear(): void;
} {
  const byInstance = new Map<string, InstanceSecretMaterial>();

  return {
    async put(material: InstanceSecretMaterial): Promise<void> {
      const id = material.instance_id?.trim();
      if (!id || !material.secret) {
        throw new GatewayRelayEnvError(
          "INVALID_MATERIAL",
          "put requires instance_id and secret",
        );
      }
      // Store a shallow copy so callers cannot mutate held material.
      byInstance.set(id, {
        instance_id: id,
        tenant_id: material.tenant_id,
        secret: material.secret,
        relay_wss_url: material.relay_wss_url,
        relay_tier: material.relay_tier,
        issued_at: material.issued_at,
      });
    },

    async get(instanceId: string): Promise<InstanceSecretMaterial | null> {
      const row = byInstance.get(instanceId.trim());
      if (!row) return null;
      return { ...row };
    },

    async delete(instanceId: string): Promise<void> {
      byInstance.delete(instanceId.trim());
    },

    size(): number {
      return byInstance.size;
    },

    getSecretForTest(instanceId: string): string | null {
      return byInstance.get(instanceId.trim())?.secret ?? null;
    },

    clear(): void {
      byInstance.clear();
    },
  };
}

// ---------------------------------------------------------------------------
// lp-3a1.2 — durable encrypted-file material store (survives CP redeploy)
// ---------------------------------------------------------------------------

/** Env: absolute/relative path to encrypted material file (durable volume). */
export const INSTANCE_SECRET_MATERIAL_PATH_ENV =
  "INSTANCE_SECRET_MATERIAL_PATH" as const;
/** Env: 32-byte key (64 hex) or passphrase (scrypt-derived). Never log. */
export const INSTANCE_SECRET_MATERIAL_KEY_ENV =
  "INSTANCE_SECRET_MATERIAL_KEY" as const;
/**
 * Env: Secrets Manager secret name or ARN holding the same AES-256-GCM
 * envelope as the file store (lp-oop.37.6). Pair with KEY. Do not also set PATH.
 */
export const INSTANCE_SECRET_MATERIAL_SM_SECRET_ID_ENV =
  "INSTANCE_SECRET_MATERIAL_SM_SECRET_ID" as const;

const FILE_STORE_ALG = "aes-256-gcm" as const;
const FILE_STORE_VERSION = 1 as const;
const FILE_STORE_IV_LEN = 12;
const FILE_STORE_KEY_LEN = 32;
/** Fixed salt for passphrase → key (lab only; prefer 64-hex raw key in prod). */
const FILE_STORE_SCRYPT_SALT = "lp-3a1.2-instance-secret-material-v1";

type FileStoreEnvelope = {
  v: typeof FILE_STORE_VERSION;
  alg: typeof FILE_STORE_ALG;
  iv: string;
  tag: string;
  ct: string;
};

type FileStorePayload = {
  instances: Record<string, InstanceSecretMaterial>;
};

export type EncryptedFileInstanceSecretMaterialStoreOptions = {
  /** Path to the encrypted blob (parent dirs created on first put). */
  path: string;
  /**
   * 32-byte AES key as 64-char hex, or a passphrase (≥16 chars) scrypt-derived
   * to 32 bytes. Never log this value.
   */
  key: string;
};

/**
 * Parse INSTANCE_SECRET_MATERIAL_KEY into a 32-byte AES key.
 * Prefer 64-char hex for production; passphrase is accepted for lab.
 */
export function parseInstanceSecretMaterialKey(keyMaterial: string): Buffer {
  const raw = keyMaterial?.trim() ?? "";
  if (!raw) {
    throw new GatewayRelayEnvError(
      "INVALID_MATERIAL_KEY",
      "INSTANCE_SECRET_MATERIAL_KEY is required for encrypted file store",
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  // base64 / base64url that decodes to exactly 32 bytes
  for (const encoding of ["base64url", "base64"] as const) {
    try {
      const buf = Buffer.from(raw, encoding);
      if (buf.length === FILE_STORE_KEY_LEN) {
        // Reject empty decode of garbage: re-encode must match for base64url-ish
        return buf;
      }
    } catch {
      // try next encoding
    }
  }
  if (raw.length < 16) {
    throw new GatewayRelayEnvError(
      "INVALID_MATERIAL_KEY",
      "INSTANCE_SECRET_MATERIAL_KEY must be 64-char hex, 32-byte base64, or passphrase ≥16 chars",
    );
  }
  return scryptSync(raw, FILE_STORE_SCRYPT_SALT, FILE_STORE_KEY_LEN);
}

function cloneMaterial(material: InstanceSecretMaterial): InstanceSecretMaterial {
  return {
    instance_id: material.instance_id,
    tenant_id: material.tenant_id,
    secret: material.secret,
    relay_wss_url: material.relay_wss_url,
    relay_tier: material.relay_tier,
    issued_at: material.issued_at,
  };
}

function assertMaterialShape(
  value: unknown,
): asserts value is InstanceSecretMaterial {
  if (!value || typeof value !== "object") {
    throw new GatewayRelayEnvError(
      "CORRUPT_MATERIAL_STORE",
      "encrypted material payload entry is not an object",
    );
  }
  const m = value as Record<string, unknown>;
  if (
    typeof m.instance_id !== "string" ||
    typeof m.tenant_id !== "string" ||
    typeof m.secret !== "string" ||
    typeof m.relay_wss_url !== "string" ||
    typeof m.issued_at !== "string" ||
    typeof m.relay_tier !== "string" ||
    !(RELAY_TIERS as readonly string[]).includes(m.relay_tier)
  ) {
    throw new GatewayRelayEnvError(
      "CORRUPT_MATERIAL_STORE",
      "encrypted material payload entry has invalid shape",
    );
  }
}

function encryptPayload(key: Buffer, payload: FileStorePayload): FileStoreEnvelope {
  const iv = randomBytes(FILE_STORE_IV_LEN);
  const cipher = createCipheriv(FILE_STORE_ALG, key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: FILE_STORE_VERSION,
    alg: FILE_STORE_ALG,
    iv: iv.toString("base64url"),
    tag: tag.toString("base64url"),
    ct: ct.toString("base64url"),
  };
}

function decryptPayload(key: Buffer, envelope: FileStoreEnvelope): FileStorePayload {
  if (envelope.v !== FILE_STORE_VERSION || envelope.alg !== FILE_STORE_ALG) {
    throw new GatewayRelayEnvError(
      "CORRUPT_MATERIAL_STORE",
      "unsupported encrypted material envelope version/alg",
    );
  }
  const iv = Buffer.from(envelope.iv, "base64url");
  const tag = Buffer.from(envelope.tag, "base64url");
  const ct = Buffer.from(envelope.ct, "base64url");
  const decipher = createDecipheriv(FILE_STORE_ALG, key, iv);
  decipher.setAuthTag(tag);
  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new GatewayRelayEnvError(
      "CORRUPT_MATERIAL_STORE",
      "failed to decrypt instance secret material (wrong key or corrupt file)",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext.toString("utf8"));
  } catch {
    throw new GatewayRelayEnvError(
      "CORRUPT_MATERIAL_STORE",
      "encrypted material plaintext is not JSON",
    );
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("instances" in parsed) ||
    typeof (parsed as FileStorePayload).instances !== "object" ||
    (parsed as FileStorePayload).instances === null
  ) {
    throw new GatewayRelayEnvError(
      "CORRUPT_MATERIAL_STORE",
      "encrypted material payload missing instances map",
    );
  }
  const instances = (parsed as FileStorePayload).instances;
  for (const [id, entry] of Object.entries(instances)) {
    assertMaterialShape(entry);
    if (entry.instance_id !== id) {
      throw new GatewayRelayEnvError(
        "CORRUPT_MATERIAL_STORE",
        "encrypted material entry instance_id does not match map key",
      );
    }
  }
  return { instances };
}

/**
 * Encrypted-file {@link InstanceSecretMaterialStore} (lp-3a1.2).
 *
 * Ciphertext on disk only (AES-256-GCM). Survives CP process/task replacement
 * when PATH points at a durable volume. Never writes plaintext secrets.
 */
export function createEncryptedFileInstanceSecretMaterialStore(
  options: EncryptedFileInstanceSecretMaterialStoreOptions,
): InstanceSecretMaterialStore {
  const filePath = options.path?.trim() ?? "";
  if (!filePath) {
    throw new GatewayRelayEnvError(
      "INVALID_MATERIAL_PATH",
      "INSTANCE_SECRET_MATERIAL_PATH is required for encrypted file store",
    );
  }
  const key = parseInstanceSecretMaterialKey(options.key);

  /** Serialize read-modify-write so concurrent put/delete cannot clobber. */
  let chain: Promise<void> = Promise.resolve();
  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function loadMap(): Promise<Map<string, InstanceSecretMaterial>> {
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        return new Map();
      }
      throw err;
    }
    if (!raw.trim()) {
      return new Map();
    }
    let envelope: FileStoreEnvelope;
    try {
      envelope = JSON.parse(raw) as FileStoreEnvelope;
    } catch {
      throw new GatewayRelayEnvError(
        "CORRUPT_MATERIAL_STORE",
        "material store file is not JSON",
      );
    }
    const payload = decryptPayload(key, envelope);
    const map = new Map<string, InstanceSecretMaterial>();
    for (const [id, material] of Object.entries(payload.instances)) {
      map.set(id, cloneMaterial(material));
    }
    return map;
  }

  async function persistMap(
    map: Map<string, InstanceSecretMaterial>,
  ): Promise<void> {
    const instances: Record<string, InstanceSecretMaterial> = {};
    for (const [id, material] of map) {
      instances[id] = cloneMaterial(material);
    }
    const envelope = encryptPayload(key, { instances });
    const body = `${JSON.stringify(envelope)}\n`;
    await mkdir(dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    await writeFile(tmpPath, body, { encoding: "utf8", mode: 0o600 });
    await rename(tmpPath, filePath);
  }

  return {
    async put(material: InstanceSecretMaterial): Promise<void> {
      await withLock(async () => {
        const id = material.instance_id?.trim();
        if (!id || !material.secret) {
          throw new GatewayRelayEnvError(
            "INVALID_MATERIAL",
            "put requires instance_id and secret",
          );
        }
        const map = await loadMap();
        map.set(id, {
          instance_id: id,
          tenant_id: material.tenant_id,
          secret: material.secret,
          relay_wss_url: material.relay_wss_url,
          relay_tier: material.relay_tier,
          issued_at: material.issued_at,
        });
        await persistMap(map);
      });
    },

    async get(instanceId: string): Promise<InstanceSecretMaterial | null> {
      return withLock(async () => {
        const map = await loadMap();
        const row = map.get(instanceId.trim());
        return row ? cloneMaterial(row) : null;
      });
    },

    async delete(instanceId: string): Promise<void> {
      await withLock(async () => {
        const map = await loadMap();
        const id = instanceId.trim();
        if (!map.has(id)) return;
        map.delete(id);
        await persistMap(map);
      });
    },
  };
}

// ---------------------------------------------------------------------------
// lp-oop.37.6 — same envelope in Secrets Manager (survives Fargate /tmp wipe)
// ---------------------------------------------------------------------------

/** Default region when AWS_REGION / AWS_DEFAULT_REGION are unset. */
const DEFAULT_MATERIAL_SM_AWS_REGION = "us-east-1";

/**
 * True when PATH is Fargate task-local (wiped on force-new-deployment).
 * Live MockLab historically used /tmp/control-plane/instance-secret-material.bin.
 */
export function isEphemeralInstanceSecretMaterialPath(path: string): boolean {
  const normalized = path.trim();
  if (!normalized) return false;
  return (
    normalized === "/tmp" ||
    normalized.startsWith("/tmp/") ||
    normalized === "/var/tmp" ||
    normalized.startsWith("/var/tmp/")
  );
}

/**
 * Thin SM surface used by the durable store. Tests inject a fake; live wraps
 * {@link SecretsManagerClient}. Never log SecretString.
 */
export type InstanceSecretMaterialSecretsManagerSdk = {
  getSecretValue(input: { SecretId: string }): Promise<{
    SecretString?: string;
    SecretBinary?: Uint8Array;
  }>;
  putSecretValue(input: {
    SecretId: string;
    SecretString: string;
  }): Promise<void>;
};

export type CreateSecretsManagerInstanceSecretMaterialStoreOptions = {
  /** SM secret name or ARN. Ops create the secret once; Put updates the version. */
  secretId: string;
  /**
   * 32-byte AES key as 64-char hex, or a passphrase (≥16 chars) scrypt-derived
   * to 32 bytes. Same KEY as the file store. Never log this value.
   */
  key: string;
  /** Injected in tests. Omit to use the default AWS client. */
  sdk?: InstanceSecretMaterialSecretsManagerSdk;
  region?: string;
  clientConfig?: SecretsManagerClientConfig;
};

function isSecretsManagerNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const rec = err as {
    name?: string;
    Code?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    rec.name === "ResourceNotFoundException" ||
    rec.Code === "ResourceNotFoundException" ||
    rec.$metadata?.httpStatusCode === 404
  );
}

function secretsManagerFailureMessage(err: unknown): string {
  if (err instanceof GatewayRelayEnvError) {
    return err.message;
  }
  if (err instanceof Error && err.message.trim()) {
    return err.message;
  }
  return "Secrets Manager request failed";
}

function decodeSecretBinary(binary: Uint8Array | undefined): string | null {
  if (!binary || binary.byteLength === 0) return null;
  return Buffer.from(binary).toString("utf8");
}

/**
 * Parse SM SecretString. Empty / `{}` is a bootstrap empty map (ops
 * `create-secret --secret-string '{}'`). Anything else must be the same
 * AES-256-GCM envelope as the file store — never a plaintext instances map.
 */
function parseSecretsManagerBody(raw: string, key: Buffer): FileStorePayload {
  if (!raw.trim()) {
    return { instances: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new GatewayRelayEnvError(
      "CORRUPT_MATERIAL_STORE",
      "material store is not JSON",
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new GatewayRelayEnvError(
      "CORRUPT_MATERIAL_STORE",
      "material store is not an object",
    );
  }
  const rec = parsed as Record<string, unknown>;
  if (!("v" in rec) && !("ct" in rec)) {
    if (Object.keys(rec).length === 0) {
      return { instances: {} };
    }
    throw new GatewayRelayEnvError(
      "CORRUPT_MATERIAL_STORE",
      "material store is not an encrypted envelope",
    );
  }
  return decryptPayload(key, parsed as FileStoreEnvelope);
}

export function createDefaultInstanceSecretMaterialSecretsManagerSdk(
  options: {
    region?: string;
    clientConfig?: SecretsManagerClientConfig;
  } = {},
): InstanceSecretMaterialSecretsManagerSdk {
  const region =
    options.region?.trim() || DEFAULT_MATERIAL_SM_AWS_REGION;
  const client = new SecretsManagerClient({
    region,
    ...(options.clientConfig ?? {}),
  });
  return {
    async getSecretValue(input) {
      const out = await client.send(new GetSecretValueCommand(input));
      return {
        SecretString: out.SecretString,
        SecretBinary: out.SecretBinary
          ? Uint8Array.from(out.SecretBinary)
          : undefined,
      };
    },
    async putSecretValue(input) {
      await client.send(new PutSecretValueCommand(input));
    },
  };
}

/**
 * Secrets Manager {@link InstanceSecretMaterialStore} (lp-oop.37.6).
 *
 * Same ciphertext envelope as {@link createEncryptedFileInstanceSecretMaterialStore}.
 * Survives CP Fargate force-new-deployment (no EFS). Never writes plaintext
 * secrets. Ops must create the SM secret once; this store only Get/Put versions.
 */
export function createSecretsManagerInstanceSecretMaterialStore(
  options: CreateSecretsManagerInstanceSecretMaterialStoreOptions,
): InstanceSecretMaterialStore {
  const secretId = options.secretId?.trim() ?? "";
  if (!secretId) {
    throw new GatewayRelayEnvError(
      "INVALID_MATERIAL_SM_SECRET_ID",
      "INSTANCE_SECRET_MATERIAL_SM_SECRET_ID is required for Secrets Manager store",
    );
  }
  const key = parseInstanceSecretMaterialKey(options.key);
  const sdk =
    options.sdk ??
    createDefaultInstanceSecretMaterialSecretsManagerSdk({
      region: options.region,
      clientConfig: options.clientConfig,
    });

  /** Serialize read-modify-write so concurrent put/delete cannot clobber. */
  let chain: Promise<void> = Promise.resolve();
  function withLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async function loadMap(): Promise<Map<string, InstanceSecretMaterial>> {
    let raw: string | null = null;
    try {
      const out = await sdk.getSecretValue({ SecretId: secretId });
      raw =
        out.SecretString ?? decodeSecretBinary(out.SecretBinary) ?? "";
    } catch (err) {
      if (isSecretsManagerNotFound(err)) {
        throw new GatewayRelayEnvError(
          "MISSING_MATERIAL_SM_SECRET",
          "INSTANCE_SECRET_MATERIAL_SM_SECRET_ID does not exist (create the secret first)",
        );
      }
      if (err instanceof GatewayRelayEnvError) {
        throw err;
      }
      throw new GatewayRelayEnvError(
        "MATERIAL_SM_GET_FAILED",
        `failed to read instance secret material: ${secretsManagerFailureMessage(err)}`,
      );
    }
    const payload = parseSecretsManagerBody(raw ?? "", key);
    const map = new Map<string, InstanceSecretMaterial>();
    for (const [id, material] of Object.entries(payload.instances)) {
      map.set(id, cloneMaterial(material));
    }
    return map;
  }

  async function persistMap(
    map: Map<string, InstanceSecretMaterial>,
  ): Promise<void> {
    const instances: Record<string, InstanceSecretMaterial> = {};
    for (const [id, material] of map) {
      instances[id] = cloneMaterial(material);
    }
    const envelope = encryptPayload(key, { instances });
    const body = `${JSON.stringify(envelope)}\n`;
    try {
      await sdk.putSecretValue({ SecretId: secretId, SecretString: body });
    } catch (err) {
      if (isSecretsManagerNotFound(err)) {
        throw new GatewayRelayEnvError(
          "MISSING_MATERIAL_SM_SECRET",
          "INSTANCE_SECRET_MATERIAL_SM_SECRET_ID does not exist (create the secret first)",
        );
      }
      if (err instanceof GatewayRelayEnvError) {
        throw err;
      }
      throw new GatewayRelayEnvError(
        "MATERIAL_SM_PUT_FAILED",
        `failed to write instance secret material: ${secretsManagerFailureMessage(err)}`,
      );
    }
  }

  return {
    async put(material: InstanceSecretMaterial): Promise<void> {
      await withLock(async () => {
        const id = material.instance_id?.trim();
        if (!id || !material.secret) {
          throw new GatewayRelayEnvError(
            "INVALID_MATERIAL",
            "put requires instance_id and secret",
          );
        }
        const map = await loadMap();
        map.set(id, {
          instance_id: id,
          tenant_id: material.tenant_id,
          secret: material.secret,
          relay_wss_url: material.relay_wss_url,
          relay_tier: material.relay_tier,
          issued_at: material.issued_at,
        });
        await persistMap(map);
      });
    },

    async get(instanceId: string): Promise<InstanceSecretMaterial | null> {
      return withLock(async () => {
        const map = await loadMap();
        const row = map.get(instanceId.trim());
        return row ? cloneMaterial(row) : null;
      });
    },

    async delete(instanceId: string): Promise<void> {
      await withLock(async () => {
        const map = await loadMap();
        const id = instanceId.trim();
        if (!map.has(id)) return;
        map.delete(id);
        await persistMap(map);
      });
    },
  };
}

export type InstanceSecretMaterialStoreKind =
  | "memory"
  | "encrypted_file"
  | "secrets_manager";

export type ResolvedInstanceSecretMaterialStore = {
  store: InstanceSecretMaterialStore;
  /** Safe for logs — never includes path secrets or key material. */
  kind: InstanceSecretMaterialStoreKind;
  /**
   * Path when kind is encrypted_file (ops diagnostics only; not secret).
   * Omitted for memory / secrets_manager.
   */
  path?: string;
  /** True when encrypted_file PATH is Fargate-ephemeral (/tmp). */
  ephemeralPath?: boolean;
  /** True when kind is secrets_manager (id/ARN configured; value never logged). */
  secretIdConfigured?: boolean;
};

export type ResolveInstanceSecretMaterialStoreOptions = {
  /** Test inject. Live resolve builds the default AWS client. */
  secretsManagerSdk?: InstanceSecretMaterialSecretsManagerSdk;
  region?: string;
};

/**
 * Resolve material store from env (lp-3a1.2 / lp-oop.37.6).
 *
 * - INSTANCE_SECRET_MATERIAL_SM_SECRET_ID + KEY → Secrets Manager envelope
 * - INSTANCE_SECRET_MATERIAL_PATH + KEY → encrypted file
 * - otherwise → in-memory (default for tests / single-process lab)
 *
 * SM and PATH must not be set together. Partial pairs fail closed.
 * `/tmp` file paths still resolve (do not take live CP down) but are
 * marked ephemeral — live must use SM.
 */
export function resolveInstanceSecretMaterialStore(
  env: NodeJS.ProcessEnv = process.env,
  options: ResolveInstanceSecretMaterialStoreOptions = {},
): ResolvedInstanceSecretMaterialStore {
  const path = env[INSTANCE_SECRET_MATERIAL_PATH_ENV]?.trim() ?? "";
  const key = env[INSTANCE_SECRET_MATERIAL_KEY_ENV]?.trim() ?? "";
  const secretId =
    env[INSTANCE_SECRET_MATERIAL_SM_SECRET_ID_ENV]?.trim() ?? "";
  const region =
    options.region?.trim() ||
    env.AWS_REGION?.trim() ||
    env.AWS_DEFAULT_REGION?.trim() ||
    DEFAULT_MATERIAL_SM_AWS_REGION;

  if (secretId && path) {
    throw new GatewayRelayEnvError(
      "INVALID_MATERIAL_STORE_CONFIG",
      "set INSTANCE_SECRET_MATERIAL_SM_SECRET_ID or INSTANCE_SECRET_MATERIAL_PATH, not both",
    );
  }
  if (secretId) {
    if (!key) {
      throw new GatewayRelayEnvError(
        "INVALID_MATERIAL_STORE_CONFIG",
        "INSTANCE_SECRET_MATERIAL_SM_SECRET_ID and INSTANCE_SECRET_MATERIAL_KEY must both be set",
      );
    }
    return {
      store: createSecretsManagerInstanceSecretMaterialStore({
        secretId,
        key,
        sdk: options.secretsManagerSdk,
        region,
      }),
      kind: "secrets_manager",
      secretIdConfigured: true,
    };
  }
  if (path && key) {
    return {
      store: createEncryptedFileInstanceSecretMaterialStore({ path, key }),
      kind: "encrypted_file",
      path,
      ephemeralPath: isEphemeralInstanceSecretMaterialPath(path),
    };
  }
  if (path || key) {
    throw new GatewayRelayEnvError(
      "INVALID_MATERIAL_STORE_CONFIG",
      "INSTANCE_SECRET_MATERIAL_PATH and INSTANCE_SECRET_MATERIAL_KEY must both be set (or both unset)",
    );
  }
  return {
    store: createInMemoryInstanceSecretMaterialStore(),
    kind: "memory",
  };
}

/** Safe for logs — never KEY, envelope, or plaintext secrets. */
export function summarizeInstanceSecretMaterialStoreForLog(
  resolved: ResolvedInstanceSecretMaterialStore,
): {
  kind: InstanceSecretMaterialStoreKind;
  path_configured: boolean;
  path_ephemeral: boolean;
  sm_configured: boolean;
} {
  return {
    kind: resolved.kind,
    path_configured: resolved.kind === "encrypted_file",
    path_ephemeral: resolved.ephemeralPath === true,
    sm_configured: resolved.kind === "secrets_manager",
  };
}
