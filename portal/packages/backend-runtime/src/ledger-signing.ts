/**
 * Host ledger signing + canonicalization (lp-ye4.12 / phase 7).
 *
 * Production hosts sign observed commits **after** ACL/CAS verification.
 * Signatures are host-produced authority over history; clients and browsers
 * never supply authoritative ledger signatures or actor claims.
 *
 * Canonicalization is documented in:
 *   docs/architecture/signed-operation-ledger.md (Phase 7)
 */

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from "node:crypto";

import type {
  OperationSignature,
  SignatureAlgorithm,
  SignedOperationEvent,
} from "./signed-operation.js";

// ---------------------------------------------------------------------------
// Default signed field set (host canonical envelope)
// ---------------------------------------------------------------------------

/**
 * Default field names included in the host signature payload when
 * `signature.signed_fields` is omitted.
 *
 * Excludes:
 * - `signature` (the envelope being produced)
 * - `meta` (optional host-private extensions; not part of currentness)
 */
export const DEFAULT_LEDGER_SIGNED_FIELDS = [
  "schema_version",
  "record_type",
  "operation_id",
  "tenant_id",
  "instance_id",
  "occurred_at",
  "kind",
  "actor",
  "target",
  "parents",
  "body_hash",
  "result",
  "idempotency_key",
  "vault_write_mode",
  "advances_artifact_head",
  "advances_workspace_head",
] as const;

export type LedgerSignedField = (typeof DEFAULT_LEDGER_SIGNED_FIELDS)[number];

// ---------------------------------------------------------------------------
// Canonical JSON (deterministic, UTF-8)
// ---------------------------------------------------------------------------

/**
 * Deterministic JSON for signature payloads.
 *
 * Rules (phase 7):
 * 1. Objects: keys sorted lexicographically (code unit order); recurse.
 * 2. Arrays: element order preserved; each element canonicalized.
 * 3. No insignificant whitespace.
 * 4. Numbers/booleans/null as JSON; strings as JSON strings (UTF-8).
 * 5. `undefined` and functions are omitted (must not appear on wire events).
 *
 * This is a constrained JCS-like encoding sufficient for host ledger events.
 * It is **not** a general RFC 8785 implementation for arbitrary JSON.
 */
export function canonicalizeJson(value: unknown): string {
  return stringifyCanonical(value);
}

function stringifyCanonical(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new LedgerSigningError(
        "invalid_argument",
        "canonical JSON does not allow NaN or Infinity",
      );
    }
    // JSON.stringify produces the unique finite number representation we need.
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stringifyCanonical(v)).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    const parts: string[] = [];
    for (const k of keys) {
      parts.push(`${JSON.stringify(k)}:${stringifyCanonical(obj[k])}`);
    }
    return `{${parts.join(",")}}`;
  }
  throw new LedgerSigningError(
    "invalid_argument",
    `unsupported canonical JSON type: ${typeof value}`,
  );
}

/**
 * Build the unsigned payload object from an event using the default or
 * explicit signed field list. Missing optional fields are omitted.
 */
export function unsignedLedgerEnvelope(
  event: SignedOperationEvent,
  signedFields?: readonly string[],
): Record<string, unknown> {
  const fields = signedFields ?? DEFAULT_LEDGER_SIGNED_FIELDS;
  const src = event as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field === "signature") continue;
    if (Object.prototype.hasOwnProperty.call(src, field) && src[field] !== undefined) {
      out[field] = src[field];
    }
  }
  return out;
}

/**
 * Canonical UTF-8 bytes of the unsigned event envelope.
 */
export function canonicalizeSignedOperationEvent(
  event: SignedOperationEvent,
  signedFields?: readonly string[],
): Buffer {
  const envelope = unsignedLedgerEnvelope(event, signedFields);
  return Buffer.from(canonicalizeJson(envelope), "utf8");
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class LedgerSigningError extends Error {
  readonly code:
    | "invalid_argument"
    | "untrusted_key"
    | "signature_invalid"
    | "algorithm_not_allowed"
    | "key_unavailable";

  constructor(code: LedgerSigningError["code"], message: string) {
    super(message);
    this.name = "LedgerSigningError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Key material + rotation
// ---------------------------------------------------------------------------

export type HostLedgerKeyPair = {
  keyId: string;
  /** Present when this key can sign. Omit for verify-only / retired public keys. */
  privateKey?: KeyObject;
  publicKey: KeyObject;
  /** When true, may be used to sign new events. */
  active: boolean;
  /** Optional not-before / not-after for rotation windows (ISO). */
  notBefore?: string;
  notAfter?: string;
};

export type HostLedgerKeyRing = {
  /** Active key id used for new signatures. */
  activeKeyId: string;
  /** All trusted keys (active + retired still accepted for verify). */
  keys: ReadonlyMap<string, HostLedgerKeyPair>;
};

export type GenerateHostLedgerKeyOptions = {
  keyId: string;
  active?: boolean;
};

/**
 * Generate an ed25519 host ledger key pair (PKCS8/SPKI DER KeyObjects).
 */
export function generateHostLedgerKeyPair(
  options: GenerateHostLedgerKeyOptions,
): HostLedgerKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    keyId: options.keyId,
    privateKey,
    publicKey,
    active: options.active !== false,
  };
}

/**
 * Import ed25519 private key from PKCS8 DER (raw Buffer) or PEM string.
 */
export function importHostLedgerPrivateKey(
  keyId: string,
  material: Buffer | string,
  opts?: { active?: boolean; notBefore?: string; notAfter?: string },
): HostLedgerKeyPair {
  const privateKey = createPrivateKey(
    typeof material === "string"
      ? material
      : { key: material, format: "der", type: "pkcs8" },
  );
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new LedgerSigningError(
      "invalid_argument",
      `expected ed25519 private key for ${keyId}, got ${privateKey.asymmetricKeyType}`,
    );
  }
  const publicKey = createPublicKey(privateKey);
  return {
    keyId,
    privateKey,
    publicKey,
    active: opts?.active !== false,
    ...(opts?.notBefore ? { notBefore: opts.notBefore } : {}),
    ...(opts?.notAfter ? { notAfter: opts.notAfter } : {}),
  };
}

/**
 * Import ed25519 public key only (verify path / retired keys).
 */
export function importHostLedgerPublicKey(
  keyId: string,
  material: Buffer | string,
  opts?: { active?: boolean; notBefore?: string; notAfter?: string },
): HostLedgerKeyPair {
  const publicKey = createPublicKey(
    typeof material === "string"
      ? material
      : { key: material, format: "der", type: "spki" },
  );
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new LedgerSigningError(
      "invalid_argument",
      `expected ed25519 public key for ${keyId}, got ${publicKey.asymmetricKeyType}`,
    );
  }
  // Verify-only entry — no private key; sign fails closed.
  return {
    keyId,
    publicKey,
    active: opts?.active === true,
    ...(opts?.notBefore ? { notBefore: opts.notBefore } : {}),
    ...(opts?.notAfter ? { notAfter: opts.notAfter } : {}),
  };
}

export function createHostLedgerKeyRing(
  keys: HostLedgerKeyPair[],
  activeKeyId?: string,
): HostLedgerKeyRing {
  if (keys.length === 0) {
    throw new LedgerSigningError(
      "invalid_argument",
      "host ledger key ring requires at least one key",
    );
  }
  const map = new Map<string, HostLedgerKeyPair>();
  for (const k of keys) {
    if (map.has(k.keyId)) {
      throw new LedgerSigningError(
        "invalid_argument",
        `duplicate key_id in ring: ${k.keyId}`,
      );
    }
    map.set(k.keyId, k);
  }
  const active =
    activeKeyId ??
    keys.find((k) => k.active)?.keyId ??
    keys[0]!.keyId;
  if (!map.has(active)) {
    throw new LedgerSigningError(
      "key_unavailable",
      `active key_id not in ring: ${active}`,
    );
  }
  return { activeKeyId: active, keys: map };
}

/**
 * Rotate: mark previous active keys retired (still trusted for verify) and
 * set a new active key. The new key must already be in the ring or is added.
 */
export function rotateHostLedgerActiveKey(
  ring: HostLedgerKeyRing,
  next: HostLedgerKeyPair,
): HostLedgerKeyRing {
  const keys = new Map<string, HostLedgerKeyPair>();
  for (const [id, k] of ring.keys) {
    keys.set(id, { ...k, active: id === next.keyId });
  }
  keys.set(next.keyId, { ...next, active: true });
  return { activeKeyId: next.keyId, keys };
}

// ---------------------------------------------------------------------------
// Sign / verify
// ---------------------------------------------------------------------------

export type HostLedgerSigner = {
  readonly alg: SignatureAlgorithm;
  readonly keyId: string;
  /** Produce signature over a fully built event (signature field ignored). */
  sign(event: SignedOperationEvent, signedAt?: string): OperationSignature;
  /** Verify an event signature against the key ring / trust policy. */
  verify(event: SignedOperationEvent): void;
};

export type CreateEd25519HostLedgerSignerOptions = {
  ring: HostLedgerKeyRing;
  /**
   * When true (default), only `ed25519` signatures verify.
   * `alg: none` is never accepted by production signers.
   */
  requireEd25519?: boolean;
  /** Clock for notBefore/notAfter checks (default Date). */
  now?: () => Date;
};

function keyUsableAt(key: HostLedgerKeyPair, now: Date): boolean {
  if (key.notBefore && new Date(key.notBefore).getTime() > now.getTime()) {
    return false;
  }
  if (key.notAfter && new Date(key.notAfter).getTime() < now.getTime()) {
    return false;
  }
  return true;
}

/**
 * Production host signer: ed25519 over the canonical unsigned envelope.
 */
export function createEd25519HostLedgerSigner(
  options: CreateEd25519HostLedgerSignerOptions,
): HostLedgerSigner {
  const requireEd25519 = options.requireEd25519 !== false;
  const now = options.now ?? (() => new Date());
  const ring = options.ring;

  return {
    alg: "ed25519",
    get keyId() {
      return ring.activeKeyId;
    },
    sign(event: SignedOperationEvent, signedAt?: string): OperationSignature {
      const key = ring.keys.get(ring.activeKeyId);
      if (!key) {
        throw new LedgerSigningError(
          "key_unavailable",
          `active signing key missing: ${ring.activeKeyId}`,
        );
      }
      if (!key.active) {
        throw new LedgerSigningError(
          "key_unavailable",
          `active key is not marked active: ${ring.activeKeyId}`,
        );
      }
      if (!key.privateKey) {
        throw new LedgerSigningError(
          "key_unavailable",
          `active key has no private material: ${ring.activeKeyId}`,
        );
      }
      const at = signedAt ?? new Date().toISOString();
      if (!keyUsableAt(key, new Date(at))) {
        throw new LedgerSigningError(
          "key_unavailable",
          `signing key outside validity window: ${key.keyId}`,
        );
      }
      // Sign over event with signature stripped conceptually (unsigned envelope).
      const payload = canonicalizeSignedOperationEvent(event);
      let sig: Buffer;
      try {
        sig = cryptoSign(null, payload, key.privateKey);
      } catch (err) {
        throw new LedgerSigningError(
          "key_unavailable",
          `ed25519 sign failed for key_id=${key.keyId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      return {
        alg: "ed25519",
        key_id: key.keyId,
        value: sig.toString("base64"),
        signed_at: at,
        signed_fields: [...DEFAULT_LEDGER_SIGNED_FIELDS],
      };
    },
    verify(event: SignedOperationEvent): void {
      const sig = event.signature;
      if (!sig) {
        throw new LedgerSigningError(
          "signature_invalid",
          "event missing signature",
        );
      }
      if (requireEd25519 && sig.alg !== "ed25519") {
        throw new LedgerSigningError(
          "algorithm_not_allowed",
          `production durable ledger requires ed25519, got ${sig.alg}`,
        );
      }
      if (sig.alg === "none") {
        throw new LedgerSigningError(
          "algorithm_not_allowed",
          "alg none is offline/fake only — not accepted on durable host ledger",
        );
      }
      const key = ring.keys.get(sig.key_id);
      if (!key) {
        throw new LedgerSigningError(
          "untrusted_key",
          `signature key_id is not trusted: ${sig.key_id}`,
        );
      }
      const at = new Date(sig.signed_at);
      if (!keyUsableAt(key, Number.isNaN(at.getTime()) ? now() : at)) {
        throw new LedgerSigningError(
          "untrusted_key",
          `signature key outside validity window: ${sig.key_id}`,
        );
      }
      const payload = canonicalizeSignedOperationEvent(
        event,
        sig.signed_fields,
      );
      let ok = false;
      try {
        const sigBytes = Buffer.from(sig.value, "base64");
        ok = cryptoVerify(null, payload, key.publicKey, sigBytes);
      } catch {
        ok = false;
      }
      if (!ok) {
        throw new LedgerSigningError(
          "signature_invalid",
          `ledger signature verification failed for operation_id=${event.operation_id}`,
        );
      }
    },
  };
}

/**
 * Offline/fake signer: alg none. Never use when advertising durable history.
 */
export function createNoneHostLedgerSigner(keyId = "fake-ledger-unsigned"): HostLedgerSigner {
  return {
    alg: "none",
    keyId,
    sign(event: SignedOperationEvent, signedAt?: string): OperationSignature {
      return {
        alg: "none",
        key_id: keyId,
        value: "unsigned",
        signed_at: signedAt ?? event.occurred_at ?? new Date().toISOString(),
      };
    },
    verify(event: SignedOperationEvent): void {
      if (event.signature?.alg !== "none") {
        throw new LedgerSigningError(
          "algorithm_not_allowed",
          "none signer only verifies alg:none fixtures",
        );
      }
    },
  };
}

/**
 * Apply host signature to an event, replacing any pre-existing signature.
 * Call only after ACL/CAS verification on the host.
 */
export function hostSignObservedEvent(
  event: SignedOperationEvent,
  signer: HostLedgerSigner,
  signedAt?: string,
): SignedOperationEvent {
  const signature = signer.sign(event, signedAt);
  return { ...event, signature };
}

/**
 * Export PKCS8/SPKI DER for durable key storage under BACKEND_HOME (mode 0600).
 */
export function exportHostLedgerKeyPairDer(pair: HostLedgerKeyPair): {
  privateKeyPkcs8Der?: Buffer;
  publicKeySpkiDer: Buffer;
} {
  return {
    ...(pair.privateKey
      ? {
          privateKeyPkcs8Der: pair.privateKey.export({
            type: "pkcs8",
            format: "der",
          }) as Buffer,
        }
      : {}),
    publicKeySpkiDer: pair.publicKey.export({
      type: "spki",
      format: "der",
    }) as Buffer,
  };
}
