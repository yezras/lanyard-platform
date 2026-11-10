import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

import { readCsrfToken } from "../session.js";
import type { BffVariables } from "../types.js";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export const csrfProtection: MiddlewareHandler<{ Variables: BffVariables }> =
  async (c, next) => {
    if (!MUTATION_METHODS.has(c.req.method)) {
      await next();
      return;
    }

    const cookieToken = readCsrfToken(c);
    const headerToken = c.req.header("x-csrf-token");
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      throw new HTTPException(403, { message: "CSRF token missing or invalid" });
    }

    await next();
  };