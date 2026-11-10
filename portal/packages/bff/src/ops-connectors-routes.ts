import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import { ControlPlaneRequestError } from "./control-plane-client.js";
import { csrfProtection } from "./middleware/csrf.js";
import {
  parseOpsConnectorId,
  requireOpsOperator,
  toOpsConnectorCatalog,
  toOpsConnectorToggle,
} from "./ops-connectors.js";
import { toOpsTenantOnboarded } from "./ops-onboard.js";
import type { OpsVariables } from "./ops-session.js";
import type { BffBindings } from "./types.js";

const putEntitlementSchema = z
  .object({
    enabled: z.boolean().optional(),
    surfaces: z.array(z.enum(["mcp", "api", "cli"])).optional(),
  })
  .refine(
    (body) => body.enabled !== undefined || body.surfaces !== undefined,
    { message: "enabled or surfaces is required" },
  );

const putMemberSubsetSchema = z.object({
  allowed_tools: z.array(z.string().min(1).max(128)).max(64),
});

function throwControlPlane(error: unknown): never {
  if (error instanceof ControlPlaneRequestError) {
    throw new HTTPException(error.status as ContentfulStatusCode, {
      message: error.message,
    });
  }
  throw error;
}

export function registerOpsConnectorRoutes(
  admin: Hono<{ Variables: OpsVariables }>,
  bindings: BffBindings,
): void {
  admin.get("/connectors", async (c) => {
    requireOpsOperator(c);
    try {
      const catalog = await bindings.authClient.listConnectorCatalog();
      return c.json(toOpsConnectorCatalog(catalog));
    } catch (error) {
      throwControlPlane(error);
    }
  });

  admin.get("/tenants/:tenantId/connectors", async (c) => {
    requireOpsOperator(c);
    const tenantId = c.req.param("tenantId");
    try {
      const [canonical, entitlements, catalog] = await Promise.all([
        bindings.authClient.listCanonicalConnectors(),
        bindings.authClient.listConnectorEntitlements(tenantId),
        bindings.authClient.listConnectorCatalog(),
      ]);
      const tenant = catalog.tenants.find((row) => row.tenant_id === tenantId);
      const statusByConnector: Record<
        string,
        { connected: number; pairing: number; needs_reauth: number }
      > = {};
      for (const entry of tenant?.connectors ?? []) {
        statusByConnector[entry.connector_id] = entry.status_counts;
      }
      const connectors = toOpsTenantOnboarded({
        canonical,
        entitlements,
        statusByConnector,
      });
      return c.json({ tenant_id: tenantId, connectors });
    } catch (error) {
      throwControlPlane(error);
    }
  });

  admin.put(
    "/tenants/:tenantId/connectors/:connectorId",
    csrfProtection,
    async (c) => {
      const operator = requireOpsOperator(c);
      const tenantId = c.req.param("tenantId");
      const connectorId = parseOpsConnectorId(c.req.param("connectorId"));
      const body = putEntitlementSchema.parse(await c.req.json());
      try {
        const entitlement = await bindings.authClient.upsertConnectorEntitlement({
          tenantId,
          connectorId,
          enabled: body.enabled,
          surfaces: body.surfaces,
          actor: operator.email,
        });
        return c.json(
          toOpsConnectorToggle({
            tenantId: entitlement.tenant_id,
            connectorId: entitlement.connector_id,
            enabled: entitlement.enabled,
            surfaces: entitlement.surfaces ?? [],
          }),
        );
      } catch (error) {
        throwControlPlane(error);
      }
    },
  );

  admin.get(
    "/tenants/:tenantId/connectors/:connectorId/member-subset",
    async (c) => {
      requireOpsOperator(c);
      const tenantId = c.req.param("tenantId");
      const connectorId = parseOpsConnectorId(c.req.param("connectorId"));
      try {
        const subset = await bindings.authClient.getConnectorMemberSubset(
          tenantId,
          connectorId,
        );
        return c.json(subset);
      } catch (error) {
        throwControlPlane(error);
      }
    },
  );

  admin.put(
    "/tenants/:tenantId/connectors/:connectorId/member-subset",
    csrfProtection,
    async (c) => {
      const operator = requireOpsOperator(c);
      const tenantId = c.req.param("tenantId");
      const connectorId = parseOpsConnectorId(c.req.param("connectorId"));
      const body = putMemberSubsetSchema.parse(await c.req.json());
      try {
        const subset = await bindings.authClient.setConnectorMemberSubset({
          tenantId,
          connectorId,
          allowedTools: body.allowed_tools,
          actor: operator.email,
        });
        return c.json(subset);
      } catch (error) {
        throwControlPlane(error);
      }
    },
  );
}
