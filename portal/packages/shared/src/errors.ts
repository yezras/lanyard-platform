export type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION";

/**
 * Small, reviewed error contract that may cross a Start server-function boundary.
 * Do not add stack traces, causes, or unreviewed upstream messages.
 */
export abstract class ApiError extends Error {
  abstract readonly code: ApiErrorCode;
  abstract readonly status: number;

  protected constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = new.target.name;
  }
}

export class UnauthorizedError extends ApiError {
  readonly code = "UNAUTHORIZED";
  readonly status = 401;

  constructor(message = "Not authenticated") {
    super(message);
  }
}

export class ForbiddenError extends ApiError {
  readonly code = "FORBIDDEN";
  readonly status = 403;

  constructor(message = "Not permitted") {
    super(message);
  }
}

export class NotFoundError extends ApiError {
  readonly code = "NOT_FOUND";
  readonly status = 404;

  constructor(message = "Not found") {
    super(message);
  }
}

export class ConflictError extends ApiError {
  readonly code = "CONFLICT";
  readonly status = 409;

  constructor(message = "Operation conflicts with existing data") {
    super(message);
  }
}

export class ValidationError extends ApiError {
  readonly code = "VALIDATION";
  readonly status = 400;

  constructor(message = "Invalid request") {
    super(message);
  }
}

export type SerializedApiError = {
  code: ApiErrorCode;
  message: string;
};

/** Reconstitutes only errors explicitly approved for display to a caller. */
export function deserializeApiError({
  code,
  message,
}: SerializedApiError): ApiError {
  switch (code) {
    case "UNAUTHORIZED":
      return new UnauthorizedError(message);
    case "FORBIDDEN":
      return new ForbiddenError(message);
    case "NOT_FOUND":
      return new NotFoundError(message);
    case "CONFLICT":
      return new ConflictError(message);
    case "VALIDATION":
      return new ValidationError(message);
  }
}
