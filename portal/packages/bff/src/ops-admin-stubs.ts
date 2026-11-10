/**
 * Admin shell context + leftover Home stub.
 *
 * `/context` reports only what the ops session proves: superadmin.
 * Never default a role. Tenant Home has no CP source; fail closed 501.
 * Users and person grants live in ops-users-routes (lp-hdzm.6).
 */
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { requireOpsOperator } from "./ops-connectors.js";
import type { OpsVariables } from "./ops-session.js";

function notImplemented(what: string): HTTPException {
  return new HTTPException(501, { message: `${what} is not implemented yet` });
}

export function registerOpsAdminShellRoutes(
  admin: Hono<{ Variables: OpsVariables }>,
): void {
  admin.get("/context", (c) => {
    const operator = requireOpsOperator(c);
    return c.json({ role: "superadmin", operator_id: operator.operator_id });
  });

  admin.get("/tenants/:tenantId/home", (c) => {
    requireOpsOperator(c);
    throw notImplemented("Tenant home activity");
  });
}
