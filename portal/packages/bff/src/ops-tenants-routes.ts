/**
 * Ops tenant/instance/role/audit list routes (lp-2qs.5).
 *
 * Platform operator session required on every route. All data comes from
 * existing CP HTTP endpoints via the service-token client — the CP itself
 * stays private (no public ALB); the browser only ever talks to /api/admin/*.
 */
import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { ControlPlaneRequestError } from "./control-plane-client.js";
import { requireOpsOperator } from "./ops-connectors.js";
import type { OpsVariables } from "./ops-session.js";
import type { BffBindings } from "./types.js";

function throwControlPlane(error: unknown): never {
  if (error instanceof ControlPlaneRequestError) {
    throw new HTTPException(error.status as ContentfulStatusCode, {
      message: error.message,
    });
  }
  throw error;
}

export function registerOpsTenantRoutes(
  admin: Hono<{ Variables: OpsVariables }>,
  bindings: BffBindings,
): void {
  admin.get("/tenants", async (c) => {
    requireOpsOperator(c);
    try {
      const catalog = await bindings.authClient.listConnectorCatalog();
      let vaultIds: string[] = [];
      try {
        vaultIds = await bindings.authClient.listVaultTenantPrefixes();
      } catch {
        vaultIds = [];
      }

      const byId = new Map<
        string,
        { tenant_id: string; tenant_slug: string; display_name: string }
      >();
      for (const tenant of catalog.tenants) {
        byId.set(tenant.tenant_id, {
          tenant_id: tenant.tenant_id,
          tenant_slug: tenant.tenant_slug,
          display_name: tenant.display_name,
        });
      }
      for (const vaultId of vaultIds) {
        if (!byId.has(vaultId)) {
          byId.set(vaultId, {
            tenant_id: vaultId,
            tenant_slug: vaultId,
            display_name: vaultId,
          });
        }
      }
      const tenants = [...byId.values()].sort((a, b) =>
        a.tenant_slug.localeCompare(b.tenant_slug),
      );
      return c.json({ tenants });
    } catch (error) {
      throwControlPlane(error);
    }
  });

  admin.get("/tenants/:tenantId/instances", async (c) => {
    requireOpsOperator(c);
    const tenantId = c.req.param("tenantId");
    try {
      const instances = await bindings.authClient.listGatewayInstances(tenantId);
      return c.json({ tenant_id: tenantId, instances });
    } catch (error) {
      throwControlPlane(error);
    }
  });

  admin.get("/tenants/:tenantId/roles", async (c) => {
    requireOpsOperator(c);
    const tenantId = c.req.param("tenantId");
    try {
      const { roles } = await bindings.authClient.listRoles(tenantId);
      return c.json({ tenant_id: tenantId, roles });
    } catch (error) {
      throwControlPlane(error);
    }
  });

  admin.get("/tenants/:tenantId/audit", async (c) => {
    requireOpsOperator(c);
    const tenantId = c.req.param("tenantId");
    try {
      const entries = await bindings.authClient.listAuditEntries(tenantId);
      return c.json({ tenant_id: tenantId, entries });
    } catch (error) {
      throwControlPlane(error);
    }
  });
}
