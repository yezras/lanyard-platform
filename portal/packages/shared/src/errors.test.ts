import { describe, expect, it } from "vitest";

import {
  ConflictError,
  deserializeApiError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "./errors.js";

describe("deserializeApiError", () => {
  it("round-trips each reviewed code", () => {
    const cases = [
      new UnauthorizedError("nope"),
      new ForbiddenError("no"),
      new NotFoundError("missing"),
      new ConflictError("dup"),
      new ValidationError("bad"),
    ];
    for (const err of cases) {
      const again = deserializeApiError({
        code: err.code,
        message: err.message,
      });
      expect(again).toBeInstanceOf(err.constructor);
      expect(again.code).toBe(err.code);
      expect(again.message).toBe(err.message);
      expect(again.status).toBe(err.status);
    }
  });
});
