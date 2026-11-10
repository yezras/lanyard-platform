/**
 * Ops tenant users and person-connector grants (lp-hdzm.6).
 *
 * Superadmin session required. Tenant cookies are unauthenticated here.
 * Person grant is row presence; CP validates connector ids against the registry.
 */
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import {
  ControlPlaneRequestError,
  OPS_TENANT_USER_ROLES,
} from "./control-plane-client.js";
import { csrfProtection } from "./middleware/csrf.js";
import { requireOpsOperator } from "./ops-connectors.js";
import type { OpsVariables } from "./ops-session.js";
import type { BffBindings } from "./types.js";

const CONNECTOR_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

const provisionSchema = z.object({
  display_name: z.string().min(1).max(200),
  email: z.string().email(),
  role: z.enum(OPS_TENANT_USER_ROLES),
});

const patchSchema = z
  .object({
    display_name: z.string().min(1).max(200).optional(),
    role: z.enum(OPS_TENANT_USER_ROLES).optional(),
  })
  .refine((value) => value.display_name !== undefined || value.role !== undefined, {
    message: "display_name or role required",
  });

const grantSchema = z.object({
  granted: z.boolean(),
});

function throwControlPlane(error: unknown): never {
  if (error instanceof ControlPlaneRequestError) {
    throw new HTTPException(error.status as ContentfulStatusCode, {
      message: error.message,
    });
  }
  throw error;
}

function parseConnectorSlug(value: string): string {
  if (!CONNECTOR_ID_PATTERN.test(value)) {
    throw new HTTPException(400, { message: "Unknown connector" });
  }
  return value;
}

export function registerOpsUserRoutes(
  admin: Hono<{ Variables: OpsVariables }>,
  bindings: BffBindings,
): void {
  admin.get("/tenants/:tenantId/users", async (c) => {
    requireOpsOperator(c);
    const tenantId = c.req.param("tenantId");
    try {
      const users = await bindings.authClient.listOpsTenantUsers(tenantId);
      return c.json({ tenant_id: tenantId, users });
    } catch (error) {
      throwControlPlane(error);
    }
  });

  admin.post("/tenants/:tenantId/users", csrfProtection, async (c) => {
    const operator = requireOpsOperator(c);
    const tenantId = c.req.param("tenantId");
    const body = provisionSchema.parse(await c.req.json());
    try {
      const user = await bindings.authClient.provisionOpsTenantUser({
        tenantId,
        displayName: body.display_name,
        email: body.email,
        role: body.role,
        actor: operator.email,
      });
      return c.json(user, 201);
    } catch (error) {
      throwControlPlane(error);
    }
  });

  admin.patch("/tenants/:tenantId/users/:userId", csrfProtection, async (c) => {
    const operator = requireOpsOperator(c);
    const tenantId = c.req.param("tenantId");
    const userId = c.req.param("userId");
    const body = patchSchema.parse(await c.req.json());
    try {
      const user = await bindings.authClient.updateOpsTenantUser({
        tenantId,
        userId,
        displayName: body.display_name,
        role: body.role,
        actor: operator.email,
      });
      return c.json(user);
    } catch (error) {
      throwControlPlane(error);
    }
  });

  admin.delete("/tenants/:tenantId/users/:userId", csrfProtection, async (c) => {
    const operator = requireOpsOperator(c);
    const tenantId = c.req.param("tenantId");
    const userId = c.req.param("userId");
    try {
      await bindings.authClient.deleteOpsTenantUser({
        tenantId,
        userId,
        actor: operator.email,
      });
      return c.json({ ok: true });
    } catch (error) {
      throwControlPlane(error);
    }
  });

  admin.get("/tenants/:tenantId/connectors/:connectorId/users", async (c) => {
    requireOpsOperator(c);
    const tenantId = c.req.param("tenantId");
    const connectorId = parseConnectorSlug(c.req.param("connectorId"));
    try {
      const users = await bindings.authClient.listOpsConnectorUsers(
        tenantId,
        connectorId,
      );
      return c.json({ tenant_id: tenantId, connector_id: connectorId, users });
    } catch (error) {
      throwControlPlane(error);
    }
  });

  admin.put(
    "/tenants/:tenantId/connectors/:connectorId/users/:userId",
    csrfProtection,
    async (c) => {
      const operator = requireOpsOperator(c);
      const tenantId = c.req.param("tenantId");
      const connectorId = parseConnectorSlug(c.req.param("connectorId"));
      const userId = c.req.param("userId");
      const body = grantSchema.parse(await c.req.json());
      try {
        const grant = await bindings.authClient.setPersonConnectorGrant({
          tenantId,
          connectorId,
          userId,
          granted: body.granted,
          actor: operator.email,
        });
        return c.json(grant);
      } catch (error) {
        throwControlPlane(error);
      }
    },
  );
}
