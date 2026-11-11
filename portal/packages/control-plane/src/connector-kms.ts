/**
 * KMS envelope encryption for connector secrets (lp-xhf4.2).
 *
 * GenerateDataKey (or a local wrap) produces a 32-byte data key. Payload is
 * AES-256-GCM. Postgres stores the envelope JSON only — never plaintext.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from "node:crypto";
import { DecryptCommand, GenerateDataKeyCommand, KMSClient } from "@aws-sdk/client-kms";

export const CONNECTOR_KMS_KEY_ID_ENV = "CONNECTOR_KMS_KEY_ID" as const;
export const CONNECTOR_KMS_LOCAL_KEY_ENV = "CONNECTOR_KMS_LOCAL_KEY" as const;

const ALG = "aes-256-gcm" as const;
const VERSION = 1 as const;
const IV_LEN = 12;
const KEY_LEN = 32;
const LOCAL_KEY_ID = "local";
const LOCAL_SCRYPT_SALT = "lp-xhf4.2-connector-kms-v1";

export type ConnectorKmsEnvelope = {
  v: typeof VERSION;
  alg: typeof ALG;
  kms_key_id: string;
  encrypted_data_key: string;
  iv: string;
  tag: string;
  ct: string;
};

export type ConnectorKms = {
  generateDataKey(): Promise<{
    plaintext: Buffer;
    ciphertext: Buffer;
    keyId: string;
  }>;
  decryptDataKey(ciphertext: Buffer, keyId: string): Promise<Buffer>;
};

/** Minimal KMS surface so tests inject a fake without the AWS SDK. */
export type ConnectorKmsSdk = {
  send(
    command: GenerateDataKeyCommand | DecryptCommand,
  ): Promise<{
    Plaintext?: Uint8Array;
    CiphertextBlob?: Uint8Array;
    KeyId?: string;
  }>;
};

export class ConnectorKmsError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ConnectorKmsError";
    this.code = code;
  }
}

export class ConnectorKmsNotConfiguredError extends ConnectorKmsError {
  constructor() {
    super(
      "CONNECTOR_KMS_NOT_CONFIGURED",
      "Connector KMS is not configured (set CONNECTOR_KMS_KEY_ID or CONNECTOR_KMS_LOCAL_KEY)",
    );
    this.name = "ConnectorKmsNotConfiguredError";
  }
}

export function parseConnectorKmsLocalKey(keyMaterial: string): Buffer {
  const raw = keyMaterial.trim();
  if (!raw) {
    throw new ConnectorKmsError(
      "INVALID_LOCAL_KEY",
      "CONNECTOR_KMS_LOCAL_KEY is empty",
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  for (const encoding of ["base64url", "base64"] as const) {
    try {
      const buf = Buffer.from(raw, encoding);
      if (buf.length === KEY_LEN) {
        return buf;
      }
    } catch {
      // try next encoding
    }
  }
  if (raw.length < 16) {
    throw new ConnectorKmsError(
      "INVALID_LOCAL_KEY",
      "CONNECTOR_KMS_LOCAL_KEY must be 64-char hex, 32-byte base64, or passphrase ≥16 chars",
    );
  }
  return scryptSync(raw, LOCAL_SCRYPT_SALT, KEY_LEN);
}

function wrapLocalDataKey(master: Buffer, plaintext: Buffer): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, master, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ct]);
}

function unwrapLocalDataKey(master: Buffer, wrapped: Buffer): Buffer {
  if (wrapped.length < IV_LEN + 16 + 1) {
    throw new ConnectorKmsError(
      "CORRUPT_ENVELOPE",
      "local data-key wrap is truncated",
    );
  }
  const iv = wrapped.subarray(0, IV_LEN);
  const tag = wrapped.subarray(IV_LEN, IV_LEN + 16);
  const ct = wrapped.subarray(IV_LEN + 16);
  const decipher = createDecipheriv(ALG, master, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new ConnectorKmsError(
      "DECRYPT_FAILED",
      "failed to unwrap local connector data key",
    );
  }
}

export function createLocalConnectorKms(
  keyMaterial?: string | Buffer,
): ConnectorKms {
  const master = Buffer.isBuffer(keyMaterial)
    ? keyMaterial
    : keyMaterial
      ? parseConnectorKmsLocalKey(keyMaterial)
      : randomBytes(KEY_LEN);
  if (master.length !== KEY_LEN) {
    throw new ConnectorKmsError(
      "INVALID_LOCAL_KEY",
      "local connector KMS master key must be 32 bytes",
    );
  }
  return {
    async generateDataKey() {
      const plaintext = randomBytes(KEY_LEN);
      return {
        plaintext,
        ciphertext: wrapLocalDataKey(master, plaintext),
        keyId: LOCAL_KEY_ID,
      };
    },
    async decryptDataKey(ciphertext) {
      return unwrapLocalDataKey(master, ciphertext);
    },
  };
}

export function createAwsConnectorKms(options: {
  keyId: string;
  client?: ConnectorKmsSdk;
}): ConnectorKms {
  const keyId = options.keyId.trim();
  if (!keyId) {
    throw new ConnectorKmsError("INVALID_KMS_KEY_ID", "CONNECTOR_KMS_KEY_ID is empty");
  }
  const client = options.client ?? new KMSClient({});
  return {
    async generateDataKey() {
      const out = await client.send(
        new GenerateDataKeyCommand({ KeyId: keyId, KeySpec: "AES_256" }),
      );
      if (!out.Plaintext || !out.CiphertextBlob) {
        throw new ConnectorKmsError(
          "KMS_GENERATE_FAILED",
          "KMS GenerateDataKey returned empty key material",
        );
      }
      return {
        plaintext: Buffer.from(out.Plaintext),
        ciphertext: Buffer.from(out.CiphertextBlob),
        keyId: out.KeyId ?? keyId,
      };
    },
    async decryptDataKey(ciphertext, wrappedKeyId) {
      const out = await client.send(
        new DecryptCommand({
          CiphertextBlob: ciphertext,
          KeyId: wrappedKeyId || keyId,
        }),
      );
      if (!out.Plaintext) {
        throw new ConnectorKmsError(
          "KMS_DECRYPT_FAILED",
          "KMS Decrypt returned empty plaintext",
        );
      }
      return Buffer.from(out.Plaintext);
    },
  };
}

export type ResolvedConnectorKms = {
  kms: ConnectorKms | null;
  kind: "aws" | "local" | "none";
};

export function resolveConnectorKmsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedConnectorKms {
  const keyId = env[CONNECTOR_KMS_KEY_ID_ENV]?.trim();
  if (keyId) {
    return { kms: createAwsConnectorKms({ keyId }), kind: "aws" };
  }
  const local = env[CONNECTOR_KMS_LOCAL_KEY_ENV]?.trim();
  if (local) {
    return { kms: createLocalConnectorKms(local), kind: "local" };
  }
  return { kms: null, kind: "none" };
}

export async function encryptUtf8Envelope(
  kms: ConnectorKms,
  plaintext: string,
): Promise<string> {
  const dataKey = await kms.generateDataKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, dataKey.plaintext, iv);
  const ct = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf8")),
    cipher.final(),
  ]);
  const envelope: ConnectorKmsEnvelope = {
    v: VERSION,
    alg: ALG,
    kms_key_id: dataKey.keyId,
    encrypted_data_key: dataKey.ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ct: ct.toString("base64url"),
  };
  dataKey.plaintext.fill(0);
  return JSON.stringify(envelope);
}

export async function decryptUtf8Envelope(
  kms: ConnectorKms,
  envelopeJson: string,
): Promise<string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelopeJson);
  } catch {
    throw new ConnectorKmsError(
      "CORRUPT_ENVELOPE",
      "connector secrets envelope is not JSON",
    );
  }
  if (!isConnectorKmsEnvelope(parsed)) {
    throw new ConnectorKmsError(
      "CORRUPT_ENVELOPE",
      "connector secrets envelope has invalid shape",
    );
  }
  const dataKey = await kms.decryptDataKey(
    Buffer.from(parsed.encrypted_data_key, "base64url"),
    parsed.kms_key_id,
  );
  const decipher = createDecipheriv(
    ALG,
    dataKey,
    Buffer.from(parsed.iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(parsed.tag, "base64url"));
  try {
    const pt = Buffer.concat([
      decipher.update(Buffer.from(parsed.ct, "base64url")),
      decipher.final(),
    ]);
    dataKey.fill(0);
    return pt.toString("utf8");
  } catch {
    dataKey.fill(0);
    throw new ConnectorKmsError(
      "DECRYPT_FAILED",
      "failed to decrypt connector secrets envelope",
    );
  }
}

export function isConnectorKmsEnvelope(
  value: unknown,
): value is ConnectorKmsEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }
  const e = value as Record<string, unknown>;
  return (
    e.v === VERSION &&
    e.alg === ALG &&
    typeof e.kms_key_id === "string" &&
    typeof e.encrypted_data_key === "string" &&
    typeof e.iv === "string" &&
    typeof e.tag === "string" &&
    typeof e.ct === "string"
  );
}
