import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import { parseOpsSecretSlot } from "@lanyard/shared";

import { ControlPlaneRequestError } from "./control-plane-client.js";
import { csrfProtection } from "./middleware/csrf.js";
import { requireOpsOperator } from "./ops-connectors.js";
import type { OpsVariables } from "./ops-session.js";
import type { BffBindings } from "./types.js";

const putProviderSecretSchema = z.object({
  value: z.string().min(1).max(8_192),
});

function throwControlPlane(error: unknown): never {
  if (error instanceof ControlPlaneRequestError) {
    throw new HTTPException(error.status as ContentfulStatusCode, {
      message: error.message,
    });
  }
  throw error;
}

/**
 * Class B tenant provider secrets (lp-2qs.4). Slot ids are validated against
 * the shared closed allowlist before they reach CP; values are forwarded once
 * and never logged or echoed back.
 */
export function registerOpsSecretRoutes(
  admin: Hono<{ Variables: OpsVariables }>,
  bindings: BffBindings,
): void {
  admin.get("/tenants/:tenantId/secrets", async (c) => {
    requireOpsOperator(c);
    try {
      const slots = await bindings.authClient.listProviderSecrets(
        c.req.param("tenantId"),
      );
      return c.json({ tenant_id: c.req.param("tenantId"), slots });
    } catch (error) {
      throwControlPlane(error);
    }
  });

  admin.put(
    "/tenants/:tenantId/secrets/:slotId",
    csrfProtection,
    async (c) => {
      const operator = requireOpsOperator(c);
      const slot = parseOpsSecretSlot(c.req.param("slotId"));
      if (!slot) {
        throw new HTTPException(400, { message: "Unknown secret slot" });
      }
      const body = putProviderSecretSchema.parse(await c.req.json());
      try {
        const status = await bindings.authClient.putProviderSecret({
          tenantId: c.req.param("tenantId"),
          slotId: c.req.param("slotId"),
          value: body.value,
          actor: operator.email,
        });
        return c.json(status);
      } catch (error) {
        throwControlPlane(error);
      }
    },
  );

  admin.delete(
    "/tenants/:tenantId/secrets/:slotId",
    csrfProtection,
    async (c) => {
      const operator = requireOpsOperator(c);
      const slot = parseOpsSecretSlot(c.req.param("slotId"));
      if (!slot) {
        throw new HTTPException(400, { message: "Unknown secret slot" });
      }
      try {
        const result = await bindings.authClient.deleteProviderSecret({
          tenantId: c.req.param("tenantId"),
          slotId: c.req.param("slotId"),
          actor: operator.email,
        });
        return c.json(result);
      } catch (error) {
        throwControlPlane(error);
      }
    },
  );
}
