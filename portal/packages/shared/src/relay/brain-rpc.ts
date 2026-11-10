/**
 * Brain RPC wire types (G3.1 contract / G3.3 Portal slice).
 *
 * Normative authority:
 * company-brain-deploy `references/brain-rpc-contract.md`
 *
 * Frames multiplex on the authenticated Hermes ↔ Portal relay WebSocket
 * (same session as chat). Portal/relay → Hermes: `brain_rpc_request`;
 * Hermes → Portal/relay: `brain_rpc_result`.
 */

/** Integer contract version for this MVP method set. */
export const BRAIN_RPC_CONTRACT_VERSION = 1;

/** Default caller budget for list/stat/ping/health/projects (contract §7). */
export const BRAIN_RPC_DEFAULT_TIMEOUT_MS = 10_000;

/** Max caller timeout for MVP (contract §7). */
export const BRAIN_RPC_MAX_TIMEOUT_MS = 30_000;

/** Default auth claim TTL stamped by BFF. */
export const BRAIN_RPC_AUTH_TTL_MS = 5 * 60 * 1000;

export type BrainRpcMethod =
  | "brain.ping"
  | "brain.health"
  | "vault.list"
  | "vault.stat"
  | "vault.read"
  | "settings.snapshot"
  | "projects.list";

export type BrainRpcErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid_argument"
  | "payload_too_large"
  | "timeout"
  | "unavailable"
  | "conflict"
  | "method_not_found"
  | "version_unsupported"
  | "rate_limited"
  | "internal";

export type BrainRpcSubject = {
  portal_user_id: string;
  hermes_profile: string;
  roles: string[];
  path_prefixes: string[];
};

export type BrainRpcAuth = {
  tenant_id: string;
  instance_id: string;
  subject: BrainRpcSubject;
  session_id: string;
  issued_at: string;
  expires_at: string;
};

export type BrainRpcError = {
  code: BrainRpcErrorCode | string;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

export type BrainRpcRequestFrame = {
  type: "brain_rpc_request";
  contract_version: number;
  request_id: string;
  method: BrainRpcMethod | string;
  timeout_ms: number;
  auth: BrainRpcAuth;
  params: Record<string, unknown>;
  idempotency_key?: string | null;
};

export type BrainRpcResultMeta = {
  duration_ms?: number;
  hermes_profile?: string;
  host_time?: string;
  [key: string]: unknown;
};

export type BrainRpcResultFrame = {
  type: "brain_rpc_result";
  contract_version: number;
  request_id: string;
  ok: boolean;
  result: unknown;
  error: BrainRpcError | null;
  meta?: BrainRpcResultMeta;
};

/** Map host error codes → BFF HTTP status (contract §5.2). */
export function brainRpcErrorToHttpStatus(code: string): number {
  switch (code) {
    case "unauthenticated":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
    case "method_not_found":
      return 404;
    case "invalid_argument":
    case "version_unsupported":
      return 400;
    case "payload_too_large":
      return 413;
    case "timeout":
      return 504;
    case "unavailable":
      return 503;
    case "conflict":
      return 409;
    case "rate_limited":
      return 429;
    case "internal":
    default:
      return 500;
  }
}

export function isBrainRpcRequestFrame(
  frame: unknown,
): frame is BrainRpcRequestFrame {
  return (
    typeof frame === "object" &&
    frame !== null &&
    (frame as { type?: string }).type === "brain_rpc_request"
  );
}

export function isBrainRpcResultFrame(
  frame: unknown,
): frame is BrainRpcResultFrame {
  return (
    typeof frame === "object" &&
    frame !== null &&
    (frame as { type?: string }).type === "brain_rpc_result"
  );
}

/** Clamp caller timeout to MVP bounds (contract §7). */
export function clampBrainRpcTimeoutMs(timeoutMs?: number): number {
  if (timeoutMs === undefined || Number.isNaN(timeoutMs)) {
    return BRAIN_RPC_DEFAULT_TIMEOUT_MS;
  }
  const n = Math.floor(timeoutMs);
  if (n < 1) return BRAIN_RPC_DEFAULT_TIMEOUT_MS;
  return Math.min(n, BRAIN_RPC_MAX_TIMEOUT_MS);
}
