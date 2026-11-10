/**
 * Ops connector catalog DTO (lp-xhf4.14).
 *
 * Lanyard ops grants tenant entitlement. Never OAuth, never QR, never sticky.
 * Tenant cookie on these routes is unauthenticated.
 */
import { HTTPException } from "hono/http-exception";

import {
  CONNECTOR_IDS,
  type ConnectorCatalog,
  type ConnectorCatalogEntry,
  type ConnectorCatalogTenant,
  type ConnectorCatalogTotals,
  type ConnectorId,
  type ConnectorStatusCounts,
} from "./control-plane-client.js";
import {
  CONNECTOR_SPA_FORBIDDEN_KEYS,
  assertConnectorSpaJson,
  isConnectorId,
} from "./connectors.js";
import type { OpsSessionUser } from "./ops-session.js";
import { parseConnectorSlug } from "./registry-snapshot.js";

export { CONNECTOR_IDS, CONNECTOR_SPA_FORBIDDEN_KEYS, assertConnectorSpaJson };
export type {
  ConnectorCatalog,
  ConnectorCatalogEntry,
  ConnectorCatalogTenant,
  ConnectorCatalogTotals,
  ConnectorId,
  ConnectorStatusCounts,
};

export function requireOpsOperator(c: {
  get: (key: "opsOperator") => OpsSessionUser | null;
}): OpsSessionUser {
  const operator = c.get("opsOperator");
  if (!operator) {
    throw new HTTPException(401, { message: "Not authenticated" });
  }
  return operator;
}

export function parseOpsConnectorId(value: string): string {
  const slug = parseConnectorSlug(value);
  if (!slug) {
    throw new HTTPException(400, { message: "Unknown connector" });
  }
  return slug;
}

function emptyCounts(): ConnectorStatusCounts {
  return { connected: 0, pairing: 0, needs_reauth: 0 };
}

function parseStatusCounts(value: unknown): ConnectorStatusCounts {
  const rec = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const n = (key: keyof ConnectorStatusCounts) => {
    const raw = rec[key];
    const parsed = typeof raw === "number" ? raw : Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  };
  return {
    connected: n("connected"),
    pairing: n("pairing"),
    needs_reauth: n("needs_reauth"),
  };
}

function parseCatalogEntry(value: unknown): ConnectorCatalogEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const rec = value as Record<string, unknown>;
  if (!isConnectorId(String(rec.connector_id ?? ""))) {
    return null;
  }
  return {
    connector_id: rec.connector_id as ConnectorId,
    enabled: rec.enabled === true,
    status_counts: parseStatusCounts(rec.status_counts),
  };
}

function parseCatalogTenant(value: unknown): ConnectorCatalogTenant | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const rec = value as Record<string, unknown>;
  if (
    typeof rec.tenant_id !== "string" ||
    !rec.tenant_id ||
    typeof rec.tenant_slug !== "string" ||
    !rec.tenant_slug ||
    typeof rec.display_name !== "string"
  ) {
    return null;
  }
  const byId = new Map<ConnectorId, ConnectorCatalogEntry>();
  if (Array.isArray(rec.connectors)) {
    for (const item of rec.connectors) {
      const entry = parseCatalogEntry(item);
      if (entry) {
        byId.set(entry.connector_id, entry);
      }
    }
  }
  return {
    tenant_id: rec.tenant_id,
    tenant_slug: rec.tenant_slug,
    display_name: rec.display_name,
    connectors: CONNECTOR_IDS.map(
      (connector_id) =>
        byId.get(connector_id) ?? {
          connector_id,
          enabled: false,
          status_counts: emptyCounts(),
        },
    ),
  };
}

function parseTotals(value: unknown): ConnectorCatalogTotals {
  const rec = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const totals = {} as ConnectorCatalogTotals;
  for (const connectorId of CONNECTOR_IDS) {
    const row =
      rec[connectorId] && typeof rec[connectorId] === "object"
        ? (rec[connectorId] as Record<string, unknown>)
        : {};
    const entitledRaw = row.entitled_tenants;
    const entitled =
      typeof entitledRaw === "number"
        ? entitledRaw
        : Number(entitledRaw);
    totals[connectorId] = {
      ...parseStatusCounts(row),
      entitled_tenants:
        Number.isFinite(entitled) && entitled > 0 ? entitled : 0,
    };
  }
  return totals;
}

/** Allowlisted ops JSON. Drops ciphertext, OAuth, QR, sticky, account labels. */
export function toOpsConnectorCatalog(value: ConnectorCatalog): ConnectorCatalog {
  const tenants = value.tenants
    .map(parseCatalogTenant)
    .filter((row): row is ConnectorCatalogTenant => row !== null);
  const catalog: ConnectorCatalog = {
    tenants,
    totals: parseTotals(value.totals),
  };
  assertConnectorSpaJson(catalog);
  return catalog;
}

export function toOpsConnectorToggle(input: {
  tenantId: string;
  connectorId: string;
  enabled: boolean;
  surfaces?: string[];
}): {
  tenant_id: string;
  connector_id: string;
  enabled: boolean;
  surfaces: string[];
} {
  const spa = {
    tenant_id: input.tenantId,
    connector_id: input.connectorId,
    enabled: input.enabled,
    surfaces: input.surfaces ?? [],
  };
  assertConnectorSpaJson(spa);
  return spa;
}
