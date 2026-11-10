import type {
  BackendRuntimeErrorCode,
  BackendRuntimeErrorDetails,
} from "./types.js";

/**
 * Typed failure from a BackendRuntimeService method.
 * BFF maps codes → HTTP via the same table as Brain RPC (brainRpcErrorToHttpStatus).
 */
export class BackendRuntimeError extends Error {
  readonly code: BackendRuntimeErrorCode | string;
  readonly retryable: boolean;
  readonly details?: BackendRuntimeErrorDetails;

  constructor(
    code: BackendRuntimeErrorCode | string,
    message: string,
    options?: {
      retryable?: boolean;
      details?: BackendRuntimeErrorDetails;
      cause?: unknown;
    },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "BackendRuntimeError";
    this.code = code;
    this.retryable = options?.retryable ?? isRetryableCode(code);
    this.details = options?.details;
  }
}

function isRetryableCode(code: string): boolean {
  return (
    code === "timeout" ||
    code === "unavailable" ||
    code === "rate_limited" ||
    code === "internal"
  );
}

/** Map host/service error codes → BFF HTTP status (brain-rpc contract §5.2). */
export function backendRuntimeErrorToHttpStatus(code: string): number {
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
    case "not_implemented":
      return 400;
    case "invalid_type":
      return 415;
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
