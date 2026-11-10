/**
 * G3.3: Portal BFF helpers for customer-host Brain RPC.
 *
 * Contract: company-brain-deploy `references/brain-rpc-contract.md`
 * Transport: existing authenticated relay WSS (via RelayClient → /internal/brain-rpc).
 */

import {
  BRAIN_RPC_AUTH_TTL_MS,
  BRAIN_RPC_CONTRACT_VERSION,
  clampBrainRpcTimeoutMs,
  type BrainRpcAuth,
  type BrainRpcMethod,
  type BrainRpcRequestFrame,
  type BrainRpcResultFrame,
} from "@lanyard/shared";
import { randomUUID } from "node:crypto";

export {
  BRAIN_RPC_AUTH_TTL_MS,
  BRAIN_RPC_CONTRACT_VERSION,
  brainRpcErrorToHttpStatus,
  clampBrainRpcTimeoutMs,
} from "@lanyard/shared";

export type {
  BrainRpcAuth,
  BrainRpcMethod,
  BrainRpcRequestFrame,
  BrainRpcResultFrame,
};

/** Control-plane RBAC fields needed for L3 subject stamp. */
export type BrainRpcRbac = {
  hermes_profile: string;
  allowed_path_prefixes: string[];
  role_names: string[];
};

export function stampBrainRpcAuth(input: {
  tenantId: string;
  instanceId: string;
  userId: string;
  sessionId: string;
  rbac: BrainRpcRbac;
  now?: Date;
  ttlMs?: number;
}): BrainRpcAuth {
  const now = input.now ?? new Date();
  const ttl = input.ttlMs ?? BRAIN_RPC_AUTH_TTL_MS;
  const issued = now.toISOString();
  const expires = new Date(now.getTime() + ttl).toISOString();

  return {
    tenant_id: input.tenantId,
    instance_id: input.instanceId,
    subject: {
      portal_user_id: input.userId,
      hermes_profile: input.rbac.hermes_profile,
      roles: [...input.rbac.role_names],
      path_prefixes: [...input.rbac.allowed_path_prefixes],
    },
    session_id: input.sessionId,
    issued_at: issued,
    expires_at: expires,
  };
}

export function buildBrainRpcRequest(input: {
  method: BrainRpcMethod | string;
  auth: BrainRpcAuth;
  params?: Record<string, unknown>;
  timeoutMs?: number;
  requestId?: string;
  idempotencyKey?: string | null;
}): BrainRpcRequestFrame {
  return {
    type: "brain_rpc_request",
    contract_version: BRAIN_RPC_CONTRACT_VERSION,
    request_id: input.requestId ?? randomUUID().replace(/-/g, ""),
    method: input.method,
    timeout_ms: clampBrainRpcTimeoutMs(input.timeoutMs),
    auth: input.auth,
    params: input.params ?? {},
    idempotency_key: input.idempotencyKey ?? null,
  };
}

/** True when host returned a successful brain_rpc_result. */
export function isBrainRpcHostOk(
  frame: BrainRpcResultFrame | undefined | null,
): frame is BrainRpcResultFrame & { ok: true } {
  return Boolean(frame && frame.ok === true);
}
