import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import {
  ControlPlaneRequestError,
  type ClassCSecretStatus,
} from "./control-plane-client.js";
import { assertConnectorSpaJson } from "./connectors.js";
import { csrfProtection } from "./middleware/csrf.js";
import {
  parseOpsConnectorId,
  requireOpsOperator,
} from "./ops-connectors.js";
import { isFirstClassConnectorId } from "./ops-onboard.js";
import type { OpsVariables } from "./ops-session.js";
import type { BffBindings } from "./types.js";

const CLASS_C_SURFACES = ["mcp", "api", "cli"] as const;
type ClassCSurfaceId = (typeof CLASS_C_SURFACES)[number];

const putClassCSecretSchema = z.object({
  value: z.string().min(1).max(8_192),
  auth_kind: z.enum(["bearer", "api_key"]).optional(),
});

const CLASS_C_LEAK_KEYS = [
  "value",
  "payload",
  "secrets_ciphertext",
  "Authorization",
  "authorization",
] as const;

function throwControlPlane(error: unknown): never {
  if (error instanceof ControlPlaneRequestError) {
    throw new HTTPException(error.status as ContentfulStatusCode, {
      message: error.message,
    });
  }
  throw error;
}

function parseClassCSurfaceId(value: string): ClassCSurfaceId {
  const trimmed = value.trim().toLowerCase();
  if (
    trimmed === "mcp" ||
    trimmed === "api" ||
    trimmed === "cli"
  ) {
    return trimmed;
  }
  throw new HTTPException(400, { message: "Unknown connector surface" });
}

function parseRegistryConnectorId(value: string): string {
  const connectorId = parseOpsConnectorId(value);
  if (isFirstClassConnectorId(connectorId)) {
    throw new HTTPException(400, {
      message: `Class C is for registry connectors; ${connectorId} uses user-principal Class A`,
    });
  }
  return connectorId;
}

function assertNoClassCLeak(value: unknown): void {
  if (value == null || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertNoClassCLeak(item);
    }
    return;
  }
  const rec = value as Record<string, unknown>;
  for (const key of CLASS_C_LEAK_KEYS) {
    if (key in rec) {
      throw new Error(`Class C JSON leaked ${key}`);
    }
  }
  for (const child of Object.values(rec)) {
    if (child && typeof child === "object") {
      assertNoClassCLeak(child);
    }
  }
}

function publicClassCStatus(status: ClassCSecretStatus): ClassCSecretStatus {
  return {
    tenant_id: status.tenant_id,
    connector_id: status.connector_id,
    surface_id: status.surface_id,
    present: status.present,
    fingerprint: status.fingerprint,
    rotated_at: status.rotated_at,
  };
}

/**
 * Class C tenant-principal registry secrets (lp-hdzm.32). Statuses never
 * include the value. Attach stays on CP for the harness only.
 */
export function registerOpsClassCSecretRoutes(
  admin: Hono<{ Variables: OpsVariables }>,
  bindings: BffBindings,
): void {
  admin.get(
    "/tenants/:tenantId/connectors/:connectorId/class-c-secrets",
    async (c) => {
      requireOpsOperator(c);
      const connectorId = parseRegistryConnectorId(c.req.param("connectorId"));
      try {
        const listed = await bindings.authClient.listClassCSecrets({
          tenantId: c.req.param("tenantId"),
          connectorId,
        });
        const body = {
          tenant_id: listed.tenant_id,
          connector_id: listed.connector_id,
          surfaces: listed.surfaces.map(publicClassCStatus),
        };
        assertConnectorSpaJson(body);
        assertNoClassCLeak(body);
        return c.json(body);
      } catch (error) {
        throwControlPlane(error);
      }
    },
  );

  admin.put(
    "/tenants/:tenantId/connectors/:connectorId/class-c-secrets/:surfaceId",
    csrfProtection,
    async (c) => {
      const operator = requireOpsOperator(c);
      const connectorId = parseRegistryConnectorId(c.req.param("connectorId"));
      const surfaceId = parseClassCSurfaceId(c.req.param("surfaceId"));
      const body = putClassCSecretSchema.parse(await c.req.json());
      try {
        const status = await bindings.authClient.putClassCSecret({
          tenantId: c.req.param("tenantId"),
          connectorId,
          surfaceId,
          value: body.value,
          authKind: body.auth_kind,
          actor: operator.email,
        });
        const spa = publicClassCStatus(status);
        assertConnectorSpaJson(spa);
        assertNoClassCLeak(spa);
        return c.json(spa);
      } catch (error) {
        throwControlPlane(error);
      }
    },
  );

  admin.delete(
    "/tenants/:tenantId/connectors/:connectorId/class-c-secrets/:surfaceId",
    csrfProtection,
    async (c) => {
      const operator = requireOpsOperator(c);
      const connectorId = parseRegistryConnectorId(c.req.param("connectorId"));
      const surfaceId = parseClassCSurfaceId(c.req.param("surfaceId"));
      try {
        const result = await bindings.authClient.deleteClassCSecret({
          tenantId: c.req.param("tenantId"),
          connectorId,
          surfaceId,
          actor: operator.email,
        });
        return c.json(result);
      } catch (error) {
        throwControlPlane(error);
      }
    },
  );
}
