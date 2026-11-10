/**
 * Access grant domain types and validation (lp-ye4.9 / epic lp-ye4).
 *
 * Authoritative schema:
 *   contracts/backend-runtime-v1/access-grant.schema.json
 *
 * Domain doc:
 *   docs/architecture/signed-operation-ledger.md (phase 5)
 *
 * Rules:
 * - Grants are the authority for unknown-agent (and optional human/session) scope.
 * - BFF validates grants at the boundary; never trust browser-supplied ACL or
 *   agent identity/path claims as authority.
 * - Ledger actor provenance uses safe fields only (grant_id, kind, subject_id,
 *   agent_id, run_id, session_id, backend_profile) — never secrets or raw tokens.
 */

import type { OperationActor, ActorKind } from "./signed-operation.js";

/** Schema major — required on every access grant. */
export const ACCESS_GRANT_SCHEMA_VERSION = 1 as const;
export const ACCESS_GRANT_RECORD_TYPE = "access_grant" as const;

/** Stable grant id. Prefixed grant_. Never a secret. */
export type GrantId = string;

export type GrantSignatureAlgorithm = "ed25519" | "hmac-sha256" | "none";

/**
 * Capability / method names authorized by a grant.
 * Exact match or issuer-documented wildcard (e.g. vault.*).
 */
export type GrantCapability = string;

export type GrantSubject = {
  kind: ActorKind;
  subject_id: string;
  display_name?: string;
  portal_user_id?: string;
  agent_id?: string;
  run_id?: string;
};

export type GrantSignature = {
  alg: GrantSignatureAlgorithm;
  /** Signing key id — must be in BFF trusted key set. */
  key_id: string;
  value: string;
  signed_at: string;
  signed_fields?: string[];
};

/**
 * Signed, scoped authority for vault operations.
 * BFF validates then stamps BackendRuntimeContext + ledger actor.
 */
export type AccessGrant = {
  schema_version: typeof ACCESS_GRANT_SCHEMA_VERSION;
  record_type: typeof ACCESS_GRANT_RECORD_TYPE;
  grant_id: GrantId;
  tenant_id: string;
  instance_id?: string;
  session_id?: string;
  subject: GrantSubject;
  /** Effective ACL prefixes after validation (vault-root-relative). */
  path_prefixes: string[];
  capabilities: GrantCapability[];
  issued_at: string;
  not_before?: string;
  expires_at: string;
  issuer?: string;
  backend_profile?: string;
  signature: GrantSignature;
  meta?: {
    request_id?: string;
    tool_call_id?: string;
    notes?: string;
    [key: string]: unknown;
  };
};

// ---------------------------------------------------------------------------
// Trust / validation
// ---------------------------------------------------------------------------

/**
 * BFF trust config for grant verification.
 * Production hosts populate trustedKeyIds from issuer key material.
 * Offline/fake may set allowUnsigned + a fixture key id.
 */
export type AccessGrantTrustConfig = {
  /** Allowed signature.key_id values. Empty / missing → deny all. */
  trustedKeyIds: ReadonlySet<string> | readonly string[];
  /**
   * When true, accept alg "none" with value "unsigned" (offline/fake only).
   * Production MUST leave this false/undefined.
   */
  allowUnsigned?: boolean;
  /**
   * Optional cryptographic verifier. When provided and alg is not "none",
   * must return true for a valid signature. When omitted, shape + key_id trust
   * is checked only (fixture / pre-phase-7 path).
   */
  verifySignature?: (grant: AccessGrant) => boolean;
  /** Clock for expiry checks. Defaults to Date.now(). */
  now?: () => Date;
};

export type AccessGrantValidationRequest = {
  /** Request tenant — must equal grant.tenant_id. */
  tenantId: string;
  /** Optional request instance binding. */
  instanceId?: string;
  /**
   * Request session. When the grant binds `session_id`, this MUST be present
   * and equal — omit or mismatch is fail-closed (`wrong_session`).
   * When the grant does not bind a session, this is optional audit context.
   */
  sessionId?: string;
  /** Vault path the caller intends to touch (optional; checked when provided). */
  path?: string;
  /** Additional paths (e.g. write_checkpoint source_path). */
  paths?: readonly string[];
  /** Capability required for this operation (e.g. vault.write). */
  capability?: GrantCapability;
};

export type AccessGrantDenialReason =
  | "malformed"
  | "untrusted_key"
  | "unsigned_not_allowed"
  | "signature_invalid"
  | "expired"
  | "not_yet_valid"
  | "wrong_tenant"
  | "wrong_instance"
  | "wrong_session"
  | "path_denied"
  | "capability_denied";

export type AccessGrantValidationResult =
  | {
      ok: true;
      grant: AccessGrant;
      /** Safe actor for ledger / BackendRuntimeContext. */
      actor: OperationActor;
      /** Effective path prefixes (from grant; never from browser). */
      pathPrefixes: string[];
      capabilities: GrantCapability[];
    }
  | {
      ok: false;
      reason: AccessGrantDenialReason;
      message: string;
    };

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

const GRANT_ID_RE = /^grant_[A-Za-z0-9._:-]+$/;
const VAULT_PATH_RE = /^\//;
const CAPABILITY_RE = /^[A-Za-z][A-Za-z0-9_.*:-]*$/;

const ACTOR_KINDS = new Set<ActorKind>([
  "human",
  "agent",
  "system",
  "delegated_agent",
]);
const SIG_ALGS = new Set<GrantSignatureAlgorithm>([
  "ed25519",
  "hmac-sha256",
  "none",
]);

export class AccessGrantParseError extends Error {
  readonly path: string;

  constructor(path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "AccessGrantParseError";
    this.path = path;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(
  obj: Record<string, unknown>,
  key: string,
  path: string,
  opts?: { pattern?: RegExp; max?: number },
): string {
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new AccessGrantParseError(path, `missing or empty string '${key}'`);
  }
  if (opts?.max !== undefined && v.length > opts.max) {
    throw new AccessGrantParseError(path, `'${key}' exceeds max length`);
  }
  if (opts?.pattern && !opts.pattern.test(v)) {
    throw new AccessGrantParseError(path, `'${key}' failed pattern`);
  }
  return v;
}

function optionalString(
  obj: Record<string, unknown>,
  key: string,
  path: string,
): string | undefined {
  if (!(key in obj) || obj[key] === undefined) return undefined;
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new AccessGrantParseError(
      path,
      `'${key}' must be non-empty string when set`,
    );
  }
  return v;
}

function parseSubject(value: unknown, path: string): GrantSubject {
  if (!isPlainObject(value)) {
    throw new AccessGrantParseError(path, "must be object");
  }
  const kind = requireString(value, "kind", path) as ActorKind;
  if (!ACTOR_KINDS.has(kind)) {
    throw new AccessGrantParseError(path, `invalid subject kind ${kind}`);
  }
  const subject: GrantSubject = {
    kind,
    subject_id: requireString(value, "subject_id", path),
  };
  for (const k of [
    "display_name",
    "portal_user_id",
    "agent_id",
    "run_id",
  ] as const) {
    const v = optionalString(value, k, path);
    if (v !== undefined) subject[k] = v;
  }
  for (const k of Object.keys(value)) {
    if (
      ![
        "kind",
        "subject_id",
        "display_name",
        "portal_user_id",
        "agent_id",
        "run_id",
      ].includes(k)
    ) {
      throw new AccessGrantParseError(path, `unknown property '${k}'`);
    }
  }
  return subject;
}

function parseSignature(value: unknown, path: string): GrantSignature {
  if (!isPlainObject(value)) {
    throw new AccessGrantParseError(path, "must be object");
  }
  const alg = requireString(value, "alg", path) as GrantSignatureAlgorithm;
  if (!SIG_ALGS.has(alg)) {
    throw new AccessGrantParseError(path, `invalid signature alg ${alg}`);
  }
  const sig: GrantSignature = {
    alg,
    key_id: requireString(value, "key_id", path),
    value: requireString(value, "value", path),
    signed_at: requireString(value, "signed_at", path),
  };
  if ("signed_fields" in value && value.signed_fields !== undefined) {
    if (!Array.isArray(value.signed_fields) || value.signed_fields.length === 0) {
      throw new AccessGrantParseError(path, "signed_fields must be non-empty array");
    }
    for (const f of value.signed_fields) {
      if (typeof f !== "string" || f.length === 0) {
        throw new AccessGrantParseError(
          path,
          "signed_fields items must be non-empty strings",
        );
      }
    }
    sig.signed_fields = value.signed_fields as string[];
  }
  for (const k of Object.keys(value)) {
    if (!["alg", "key_id", "value", "signed_at", "signed_fields"].includes(k)) {
      throw new AccessGrantParseError(path, `unknown property '${k}'`);
    }
  }
  return sig;
}

/**
 * Parse a strict access-grant record.
 * Throws AccessGrantParseError on invalid input.
 */
export function parseAccessGrant(value: unknown): AccessGrant {
  if (!isPlainObject(value)) {
    throw new AccessGrantParseError("$", "must be object");
  }
  if (value.schema_version !== ACCESS_GRANT_SCHEMA_VERSION) {
    throw new AccessGrantParseError("$", "schema_version must be 1");
  }
  if (value.record_type !== ACCESS_GRANT_RECORD_TYPE) {
    throw new AccessGrantParseError("$", "record_type must be access_grant");
  }

  if (!Array.isArray(value.path_prefixes)) {
    throw new AccessGrantParseError("$", "path_prefixes must be array");
  }
  const pathPrefixes: string[] = [];
  for (let i = 0; i < value.path_prefixes.length; i++) {
    const p = value.path_prefixes[i];
    if (typeof p !== "string" || !VAULT_PATH_RE.test(p)) {
      throw new AccessGrantParseError(
        `$.path_prefixes[${i}]`,
        "must be vault path starting with /",
      );
    }
    pathPrefixes.push(p);
  }

  if (!Array.isArray(value.capabilities) || value.capabilities.length === 0) {
    throw new AccessGrantParseError(
      "$",
      "capabilities must be non-empty array",
    );
  }
  const capabilities: GrantCapability[] = [];
  for (let i = 0; i < value.capabilities.length; i++) {
    const c = value.capabilities[i];
    if (typeof c !== "string" || !CAPABILITY_RE.test(c)) {
      throw new AccessGrantParseError(
        `$.capabilities[${i}]`,
        "invalid capability name",
      );
    }
    capabilities.push(c);
  }

  const grant: AccessGrant = {
    schema_version: ACCESS_GRANT_SCHEMA_VERSION,
    record_type: ACCESS_GRANT_RECORD_TYPE,
    grant_id: requireString(value, "grant_id", "$", { pattern: GRANT_ID_RE }),
    tenant_id: requireString(value, "tenant_id", "$"),
    subject: parseSubject(value.subject, "$.subject"),
    path_prefixes: pathPrefixes,
    capabilities,
    issued_at: requireString(value, "issued_at", "$"),
    expires_at: requireString(value, "expires_at", "$"),
    signature: parseSignature(value.signature, "$.signature"),
  };

  const instanceId = optionalString(value, "instance_id", "$");
  if (instanceId !== undefined) grant.instance_id = instanceId;
  const sessionId = optionalString(value, "session_id", "$");
  if (sessionId !== undefined) grant.session_id = sessionId;
  const notBefore = optionalString(value, "not_before", "$");
  if (notBefore !== undefined) grant.not_before = notBefore;
  const issuer = optionalString(value, "issuer", "$");
  if (issuer !== undefined) grant.issuer = issuer;
  const backendProfile = optionalString(value, "backend_profile", "$");
  if (backendProfile !== undefined) grant.backend_profile = backendProfile;
  if ("meta" in value && value.meta !== undefined) {
    if (!isPlainObject(value.meta)) {
      throw new AccessGrantParseError("$", "meta must be object");
    }
    grant.meta = value.meta as AccessGrant["meta"];
  }

  const allowed = new Set([
    "schema_version",
    "record_type",
    "grant_id",
    "tenant_id",
    "instance_id",
    "session_id",
    "subject",
    "path_prefixes",
    "capabilities",
    "issued_at",
    "not_before",
    "expires_at",
    "issuer",
    "backend_profile",
    "signature",
    "meta",
  ]);
  for (const k of Object.keys(value)) {
    if (!allowed.has(k)) {
      throw new AccessGrantParseError("$", `unknown property '${k}'`);
    }
  }

  return grant;
}

export function safeParseAccessGrant(
  value: unknown,
):
  | { ok: true; grant: AccessGrant }
  | { ok: false; error: AccessGrantParseError } {
  try {
    return { ok: true, grant: parseAccessGrant(value) };
  } catch (err) {
    if (err instanceof AccessGrantParseError) {
      return { ok: false, error: err };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Capability + path helpers
// ---------------------------------------------------------------------------

/**
 * Whether a required capability is covered by grant capabilities.
 * Supports trailing `.*` wildcards on grant entries (e.g. vault.* covers vault.write).
 */
export function grantAllowsCapability(
  granted: readonly GrantCapability[],
  required: GrantCapability,
): boolean {
  if (granted.includes(required)) return true;
  for (const g of granted) {
    if (g.endsWith(".*")) {
      const prefix = g.slice(0, -1); // keep trailing '.'
      if (required.startsWith(prefix) || required === g.slice(0, -2)) {
        return true;
      }
    }
    if (g === "*") return true;
  }
  return false;
}

/**
 * Path ACL aligned with vault-bff isVaultPathAllowedByPrefixes:
 * empty prefixes deny; `/` allows all; else equal or nested under a prefix.
 */
export function grantAllowsPath(
  pathPrefixes: readonly string[],
  path: string,
): boolean {
  if (pathPrefixes.length === 0) return false;
  const normalized = normalizeGrantPath(path);
  if (normalized === null) return false;
  for (const raw of pathPrefixes) {
    const prefix = normalizeGrantPath(raw);
    if (prefix === null) continue;
    if (prefix === "/") return true;
    if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
      return true;
    }
  }
  return false;
}

function normalizeGrantPath(path: string): string | null {
  if (typeof path !== "string" || path.length === 0) return null;
  let p = path.trim();
  if (!p.startsWith("/")) return null;
  // Collapse // and strip trailing slash (except root).
  p = p.replace(/\/+/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  if (p.includes("..")) return null;
  return p;
}

function parseIsoMs(iso: string): number | null {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

function trustedKeySet(
  config: AccessGrantTrustConfig,
): Set<string> {
  if (config.trustedKeyIds instanceof Set) {
    return config.trustedKeyIds as Set<string>;
  }
  return new Set(config.trustedKeyIds);
}

/**
 * Map a validated grant subject → safe ledger actor (no secrets / tokens).
 */
export function actorFromGrant(
  grant: AccessGrant,
  opts?: { sessionId?: string },
): OperationActor {
  const actor: OperationActor = {
    kind: grant.subject.kind,
    subject_id: grant.subject.subject_id,
    grant_id: grant.grant_id,
  };
  if (grant.subject.display_name !== undefined) {
    actor.display_name = grant.subject.display_name;
  }
  if (grant.subject.portal_user_id !== undefined) {
    actor.portal_user_id = grant.subject.portal_user_id;
  }
  if (grant.subject.agent_id !== undefined) {
    actor.agent_id = grant.subject.agent_id;
  }
  if (grant.subject.run_id !== undefined) {
    actor.run_id = grant.subject.run_id;
  }
  const sessionId = grant.session_id ?? opts?.sessionId;
  if (sessionId !== undefined) actor.session_id = sessionId;
  if (grant.backend_profile !== undefined) {
    actor.backend_profile = grant.backend_profile;
  }
  return actor;
}

/**
 * Validate a raw or parsed grant against trust config + request binding.
 * This is the BFF boundary check — never skip in favor of client claims.
 */
export function validateAccessGrant(
  input: unknown,
  request: AccessGrantValidationRequest,
  trust: AccessGrantTrustConfig,
): AccessGrantValidationResult {
  let grant: AccessGrant;
  if (
    isPlainObject(input) &&
    input.schema_version === ACCESS_GRANT_SCHEMA_VERSION &&
    input.record_type === ACCESS_GRANT_RECORD_TYPE &&
    "grant_id" in input &&
    typeof (input as AccessGrant).grant_id === "string" &&
    Array.isArray((input as AccessGrant).path_prefixes)
  ) {
    // Prefer strict parse always so unknown bags fail closed.
    try {
      grant = parseAccessGrant(input);
    } catch (err) {
      return {
        ok: false,
        reason: "malformed",
        message:
          err instanceof AccessGrantParseError
            ? err.message
            : "access grant is malformed",
      };
    }
  } else {
    try {
      grant = parseAccessGrant(input);
    } catch (err) {
      return {
        ok: false,
        reason: "malformed",
        message:
          err instanceof AccessGrantParseError
            ? err.message
            : "access grant is malformed",
      };
    }
  }

  const keys = trustedKeySet(trust);
  if (!keys.has(grant.signature.key_id)) {
    return {
      ok: false,
      reason: "untrusted_key",
      message: `access grant signing key_id is not trusted: ${grant.signature.key_id}`,
    };
  }

  if (grant.signature.alg === "none") {
    if (!trust.allowUnsigned) {
      return {
        ok: false,
        reason: "unsigned_not_allowed",
        message:
          "access grant alg 'none' is not allowed (offline/fake only; set allowUnsigned)",
      };
    }
    if (grant.signature.value !== "unsigned") {
      return {
        ok: false,
        reason: "signature_invalid",
        message: "access grant alg 'none' requires signature.value 'unsigned'",
      };
    }
  } else if (trust.verifySignature) {
    try {
      if (!trust.verifySignature(grant)) {
        return {
          ok: false,
          reason: "signature_invalid",
          message: "access grant signature verification failed",
        };
      }
    } catch {
      return {
        ok: false,
        reason: "signature_invalid",
        message: "access grant signature verification failed",
      };
    }
  }

  if (grant.tenant_id !== request.tenantId) {
    return {
      ok: false,
      reason: "wrong_tenant",
      message: `access grant tenant_id does not match request tenant`,
    };
  }

  if (
    grant.instance_id !== undefined &&
    request.instanceId !== undefined &&
    grant.instance_id !== request.instanceId
  ) {
    return {
      ok: false,
      reason: "wrong_instance",
      message: "access grant instance_id does not match request instance",
    };
  }

  // Fail closed: a session-bound grant is only valid when the request presents
  // that same session. Omitting request.sessionId must not bypass the binding.
  if (grant.session_id !== undefined) {
    if (request.sessionId === undefined) {
      return {
        ok: false,
        reason: "wrong_session",
        message:
          "access grant is bound to a session; request sessionId was omitted",
      };
    }
    if (grant.session_id !== request.sessionId) {
      return {
        ok: false,
        reason: "wrong_session",
        message: "access grant session_id does not match request session",
      };
    }
  }

  const now = (trust.now ?? (() => new Date()))();
  const nowMs = now.getTime();
  const expiresMs = parseIsoMs(grant.expires_at);
  if (expiresMs === null) {
    return {
      ok: false,
      reason: "malformed",
      message: "access grant expires_at is not a valid timestamp",
    };
  }
  if (expiresMs <= nowMs) {
    return {
      ok: false,
      reason: "expired",
      message: `access grant expired at ${grant.expires_at}`,
    };
  }

  const notBeforeIso = grant.not_before ?? grant.issued_at;
  const notBeforeMs = parseIsoMs(notBeforeIso);
  if (notBeforeMs === null) {
    return {
      ok: false,
      reason: "malformed",
      message: "access grant not_before/issued_at is not a valid timestamp",
    };
  }
  if (nowMs < notBeforeMs) {
    return {
      ok: false,
      reason: "not_yet_valid",
      message: `access grant not valid before ${notBeforeIso}`,
    };
  }

  if (request.capability !== undefined) {
    if (!grantAllowsCapability(grant.capabilities, request.capability)) {
      return {
        ok: false,
        reason: "capability_denied",
        message: `access grant does not include capability ${request.capability}`,
      };
    }
  }

  const pathsToCheck: string[] = [];
  if (request.path !== undefined) pathsToCheck.push(request.path);
  if (request.paths) pathsToCheck.push(...request.paths);
  for (const p of pathsToCheck) {
    if (!grantAllowsPath(grant.path_prefixes, p)) {
      return {
        ok: false,
        reason: "path_denied",
        message: `access grant does not allow path ${p}`,
      };
    }
  }

  const actor = actorFromGrant(grant, { sessionId: request.sessionId });
  return {
    ok: true,
    grant,
    actor,
    pathPrefixes: [...grant.path_prefixes],
    capabilities: [...grant.capabilities],
  };
}

/**
 * Build a minimal OperationActor for human session stamps without a grant.
 * Grant-backed flows should use actorFromGrant instead.
 */
export function actorFromHumanSession(input: {
  userId: string;
  sessionId: string;
  backendProfile?: string;
  displayName?: string;
}): OperationActor {
  const actor: OperationActor = {
    kind: "human",
    subject_id: input.userId,
    portal_user_id: input.userId,
    session_id: input.sessionId,
  };
  if (input.backendProfile !== undefined) {
    actor.backend_profile = input.backendProfile;
  }
  if (input.displayName !== undefined) {
    actor.display_name = input.displayName;
  }
  return actor;
}

/**
 * Build a system actor for host-internal maintenance ops.
 */
export function actorFromSystem(input?: {
  subjectId?: string;
  backendProfile?: string;
}): OperationActor {
  return {
    kind: "system",
    subject_id: input?.subjectId ?? "system",
    ...(input?.backendProfile
      ? { backend_profile: input.backendProfile }
      : {}),
  };
}
