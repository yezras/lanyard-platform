/**
 * BFF boundary for access grants and unknown-agent identity (lp-ye4.9).
 *
 * ## Rules
 *
 * 1. Validate signed grants at the BFF boundary before any vault mutation.
 * 2. Never trust browser-supplied ACL (`pathPrefixes`), agent identity bags,
 *    or client-forged grant fields as authority — only a validated grant
 *    (or an already-stamped server session) may set effective path prefixes
 *    and actor provenance.
 * 3. Stamp {@link BackendRuntimeContext} with safe actor + grant_id so the
 *    host/ledger never sees secrets or raw tokens.
 *
 * ## Flow
 *
 * ```text
 * unknown agent / delegated run
 *   → present AccessGrant (header/body envelope; not vault.write identity fields)
 *   → validateAccessGrantAtBoundary(...)
 *   → backendContextFromValidatedGrant(...)
 *   → writeVaultContent / history / heads (ACL from grant path_prefixes)
 * ```
 */

import {
  actorFromGrant,
  type AccessGrant,
  type AccessGrantTrustConfig,
  type AccessGrantValidationRequest,
  type AccessGrantValidationResult,
  type GrantCapability,
  validateAccessGrant,
} from "./access-grant.js";
import { BackendRuntimeError } from "./errors.js";
import type { BackendRuntimeContext } from "./types.js";
import type { OperationActor } from "./signed-operation.js";

/** Map grant denial → BackendRuntimeError code. */
export function grantDenialToErrorCode(
  reason: Extract<AccessGrantValidationResult, { ok: false }>["reason"],
): string {
  switch (reason) {
    case "expired":
    case "not_yet_valid":
    case "untrusted_key":
    case "unsigned_not_allowed":
    case "signature_invalid":
    case "wrong_session":
      return "unauthenticated";
    case "wrong_tenant":
    case "wrong_instance":
    case "path_denied":
    case "capability_denied":
      return "forbidden";
    case "malformed":
    default:
      return "invalid_argument";
  }
}

/**
 * Validate a grant at the BFF boundary.
 * Throws BackendRuntimeError on denial (fail closed).
 */
export function validateAccessGrantAtBoundary(
  input: unknown,
  request: AccessGrantValidationRequest,
  trust: AccessGrantTrustConfig,
): Extract<AccessGrantValidationResult, { ok: true }> {
  const result = validateAccessGrant(input, request, trust);
  if (!result.ok) {
    throw new BackendRuntimeError(
      grantDenialToErrorCode(result.reason),
      result.message,
      {
        retryable: false,
        details: {
          reason: result.reason,
          method: request.capability,
          path: request.path,
        },
      },
    );
  }
  return result;
}

/**
 * Build BackendRuntimeContext from a **validated** grant.
 * Path prefixes and actor come only from the grant — never from client ACL claims.
 */
export function backendContextFromValidatedGrant(input: {
  grant: AccessGrant;
  actor: OperationActor;
  pathPrefixes: readonly string[];
  capabilities: readonly GrantCapability[];
  /** Host instance id for the request (may differ from grant.instance_id when unbound). */
  instanceId: string;
  /** Session id for audit when grant does not bind one. */
  sessionId?: string;
  roles?: string[];
  timeoutMs?: number;
}): BackendRuntimeContext {
  const profileName =
    input.grant.backend_profile ??
    (input.grant.subject.kind === "human" ? "contributor" : "agent_run");
  const userId =
    input.grant.subject.portal_user_id ??
    input.grant.subject.subject_id;
  const sessionId =
    input.grant.session_id ?? input.sessionId ?? `grant:${input.grant.grant_id}`;

  return {
    tenantId: input.grant.tenant_id,
    instanceId: input.instanceId,
    userId,
    sessionId,
    profile: {
      name: profileName,
      // AUTHORITY: grant path prefixes only — never browser/agent claims.
      pathPrefixes: [...input.pathPrefixes],
      hermesProfileAlias: profileName,
    },
    roles: input.roles ? [...input.roles] : [],
    timeoutMs: input.timeoutMs,
    actor: input.actor,
    grantId: input.grant.grant_id,
    grantCapabilities: [...input.capabilities],
  };
}

/**
 * One-shot: validate grant + stamp context for a vault path + capability.
 */
export function stampContextFromAccessGrant(input: {
  grant: unknown;
  tenantId: string;
  instanceId: string;
  sessionId?: string;
  path?: string;
  paths?: readonly string[];
  capability: GrantCapability;
  trust: AccessGrantTrustConfig;
  roles?: string[];
  timeoutMs?: number;
}): {
  ctx: BackendRuntimeContext;
  grant: AccessGrant;
  actor: OperationActor;
} {
  const validated = validateAccessGrantAtBoundary(
    input.grant,
    {
      tenantId: input.tenantId,
      instanceId: input.instanceId,
      sessionId: input.sessionId,
      path: input.path,
      paths: input.paths,
      capability: input.capability,
    },
    input.trust,
  );

  const ctx = backendContextFromValidatedGrant({
    grant: validated.grant,
    actor: validated.actor,
    pathPrefixes: validated.pathPrefixes,
    capabilities: validated.capabilities,
    instanceId: input.instanceId,
    sessionId: input.sessionId,
    roles: input.roles,
    timeoutMs: input.timeoutMs,
  });

  return {
    ctx,
    grant: validated.grant,
    actor: validated.actor,
  };
}

/**
 * Reject client-supplied identity / ACL claims that must never override grants.
 * Used when an envelope may carry both a grant and a write body.
 */
export const FORBIDDEN_CLIENT_AUTHORITY_FIELDS = [
  "tenant_id",
  "tenantId",
  "instance_id",
  "instanceId",
  "user_id",
  "userId",
  "session_id",
  "sessionId",
  "portal_user_id",
  "subject",
  "auth",
  "path_prefixes",
  "pathPrefixes",
  "hermes_profile",
  "backend_profile",
  "profile",
  "roles",
  "actor",
  "grant_id",
  "grantId",
  "agent_id",
  "agentId",
  "run_id",
  "runId",
  "absolute_path",
  "absolutePath",
  "host_path",
  "hostPath",
  "vault_root",
  "vaultRoot",
] as const;

/**
 * Assert a client body does not smuggle authority fields.
 * Call on vault.write bodies and grant envelopes (excluding the grant object itself).
 */
export function assertNoClientAuthorityFields(
  raw: Record<string, unknown>,
  opts?: { method?: string },
): void {
  for (const key of FORBIDDEN_CLIENT_AUTHORITY_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(raw, key)) {
      throw new BackendRuntimeError(
        "invalid_argument",
        `request must not include ${key}; BFF validates grants and stamps subject, tenant, session, profile, and path prefixes`,
        {
          retryable: false,
          details: {
            field: key,
            method: opts?.method,
            reason: "client_authority_claim",
          },
        },
      );
    }
  }
}

/**
 * Offline/lab trust config accepting fixture key ids + alg none.
 * Never use in production.
 */
export function createOfflineGrantTrustConfig(opts?: {
  trustedKeyIds?: readonly string[];
  now?: () => Date;
}): AccessGrantTrustConfig {
  return {
    trustedKeyIds: opts?.trustedKeyIds ?? [
      "fixture-grant-key-v1",
      "lab-grant-key",
    ],
    allowUnsigned: true,
    now: opts?.now,
  };
}

/**
 * Re-export actorFromGrant for composition sites that already hold a grant.
 */
export { actorFromGrant };
