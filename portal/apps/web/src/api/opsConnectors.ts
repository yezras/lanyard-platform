import { withApiBase } from "./tenantBase.js";
import {
  CONNECTOR_IDS,
  type ConnectorId,
} from "../features/settings/connectorsCatalog.js";
import { apiErrorMessage, opsApiFetch } from "./opsApi.js";

export type OpsConnectorStatusCounts = {
  connected: number;
  pairing: number;
  needs_reauth: number;
};

export type OpsConnectorEntry = {
  connector_id: ConnectorId;
  enabled: boolean;
  status_counts: OpsConnectorStatusCounts;
};

export type OpsConnectorTenant = {
  tenant_id: string;
  tenant_slug: string;
  display_name: string;
  connectors: OpsConnectorEntry[];
};

export type OpsConnectorTotals = Record<
  ConnectorId,
  OpsConnectorStatusCounts & { entitled_tenants: number }
>;

export type OpsConnectorCatalog = {
  tenants: OpsConnectorTenant[];
  totals: OpsConnectorTotals;
};

type ApiErrorBody = { error?: string; message?: string };

function emptyCounts(): OpsConnectorStatusCounts {
  return { connected: 0, pairing: 0, needs_reauth: 0 };
}

function parseCounts(value: unknown): OpsConnectorStatusCounts {
  const rec = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const n = (key: keyof OpsConnectorStatusCounts) => {
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

function isConnectorId(value: unknown): value is ConnectorId {
  return (
    typeof value === "string" &&
    (CONNECTOR_IDS as readonly string[]).includes(value)
  );
}

function parseEntry(value: unknown): OpsConnectorEntry | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const rec = value as Record<string, unknown>;
  if (!isConnectorId(rec.connector_id)) {
    return null;
  }
  return {
    connector_id: rec.connector_id,
    enabled: rec.enabled === true,
    status_counts: parseCounts(rec.status_counts),
  };
}

function parseTenant(value: unknown): OpsConnectorTenant | null {
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
  const byId = new Map<ConnectorId, OpsConnectorEntry>();
  if (Array.isArray(rec.connectors)) {
    for (const item of rec.connectors) {
      const entry = parseEntry(item);
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

function parseTotals(value: unknown): OpsConnectorTotals {
  const rec = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const totals = {} as OpsConnectorTotals;
  for (const connectorId of CONNECTOR_IDS) {
    const row =
      rec[connectorId] && typeof rec[connectorId] === "object"
        ? (rec[connectorId] as Record<string, unknown>)
        : {};
    const entitledRaw = row.entitled_tenants;
    const entitled =
      typeof entitledRaw === "number" ? entitledRaw : Number(entitledRaw);
    totals[connectorId] = {
      ...parseCounts(row),
      entitled_tenants: Number.isFinite(entitled) && entitled > 0 ? entitled : 0,
    };
  }
  return totals;
}

export function parseOpsConnectorCatalog(body: unknown): OpsConnectorCatalog {
  const rec =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const tenants = Array.isArray(rec.tenants)
    ? rec.tenants
        .map(parseTenant)
        .filter((row): row is OpsConnectorTenant => row !== null)
    : [];
  return { tenants, totals: parseTotals(rec.totals) };
}

export async function fetchOpsConnectorCatalog(): Promise<OpsConnectorCatalog> {
  const res = await opsApiFetch("/api/admin/connectors");
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  if (!res.ok) {
    throw new Error(apiErrorMessage(body, "Catalog failed", res.status));
  }
  return parseOpsConnectorCatalog(body);
}

export const OPS_SURFACE_IDS = ["mcp", "api", "cli"] as const;
export type OpsSurfaceId = (typeof OPS_SURFACE_IDS)[number];

export type OpsCanonicalConnector = {
  id: string;
  domain: string | null;
  label: string;
  archived: boolean;
  snapshot: unknown;
};

export type OpsTenantOnboardedConnector = {
  connector_id: string;
  label: string;
  surfaces: OpsSurfaceId[];
  available_surfaces: OpsSurfaceId[];
  status_counts: OpsConnectorStatusCounts;
  auth_chips: string[];
};

function isOpsSurfaceId(value: unknown): value is OpsSurfaceId {
  return (
    typeof value === "string" &&
    (OPS_SURFACE_IDS as readonly string[]).includes(value)
  );
}

function parseSurfaces(value: unknown): OpsSurfaceId[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const surfaces: OpsSurfaceId[] = [];
  for (const item of value) {
    if (isOpsSurfaceId(item) && !surfaces.includes(item)) {
      surfaces.push(item);
    }
  }
  return surfaces;
}

export function parseOpsCanonicalConnectors(
  body: unknown,
): OpsCanonicalConnector[] {
  const rec =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (!Array.isArray(rec.connectors)) {
    return [];
  }
  const rows: OpsCanonicalConnector[] = [];
  for (const item of rec.connectors) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id || typeof row.label !== "string") {
      continue;
    }
    rows.push({
      id: row.id,
      domain: typeof row.domain === "string" ? row.domain : null,
      label: row.label,
      archived: row.archived === true,
      snapshot: row.snapshot,
    });
  }
  return rows;
}

export function parseOpsTenantOnboarded(
  body: unknown,
): OpsTenantOnboardedConnector[] {
  const rec =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  if (!Array.isArray(rec.connectors)) {
    return [];
  }
  const rows: OpsTenantOnboardedConnector[] = [];
  for (const item of rec.connectors) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as Record<string, unknown>;
    if (typeof row.connector_id !== "string" || !row.connector_id) {
      continue;
    }
    const chips = Array.isArray(row.auth_chips)
      ? row.auth_chips.filter((chip): chip is string => typeof chip === "string")
      : [];
    rows.push({
      connector_id: row.connector_id,
      label: typeof row.label === "string" ? row.label : row.connector_id,
      surfaces: parseSurfaces(row.surfaces),
      available_surfaces: parseSurfaces(row.available_surfaces),
      status_counts: parseCounts(row.status_counts),
      auth_chips: chips,
    });
  }
  return rows;
}

export async function fetchOpsCanonicalConnectors(): Promise<
  OpsCanonicalConnector[]
> {
  const res = await opsApiFetch("/api/admin/registry/connectors");
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  if (!res.ok) {
    throw new Error(apiErrorMessage(body, "Registry failed", res.status));
  }
  return parseOpsCanonicalConnectors(body);
}

export async function fetchOpsTenantConnectors(
  tenantId: string,
): Promise<OpsTenantOnboardedConnector[]> {
  const res = await opsApiFetch(
    `/api/admin/tenants/${encodeURIComponent(tenantId)}/connectors`,
  );
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  if (!res.ok) {
    throw new Error(apiErrorMessage(body, "Connectors failed", res.status));
  }
  return parseOpsTenantOnboarded(body);
}

export async function putOpsConnectorEntitlement(input: {
  tenantId: string;
  connectorId: string;
  enabled?: boolean;
  surfaces?: OpsSurfaceId[];
}): Promise<{
  tenant_id: string;
  connector_id: string;
  enabled: boolean;
  surfaces: OpsSurfaceId[];
}> {
  const res = await opsApiFetch(
    `/api/admin/tenants/${encodeURIComponent(input.tenantId)}/connectors/${encodeURIComponent(input.connectorId)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        enabled: input.enabled,
        surfaces: input.surfaces,
      }),
    },
  );
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody & {
    tenant_id?: string;
    connector_id?: string;
    enabled?: boolean;
    surfaces?: unknown;
  };
  if (!res.ok) {
    throw new Error(apiErrorMessage(body, "Onboard failed", res.status));
  }
  return {
    tenant_id: typeof body.tenant_id === "string" ? body.tenant_id : input.tenantId,
    connector_id:
      typeof body.connector_id === "string" ? body.connector_id : input.connectorId,
    enabled: body.enabled === true,
    surfaces: parseSurfaces(body.surfaces),
  };
}

export async function putOpsConnectorOnboard(input: {
  tenantId: string;
  connectorId: string;
  surfaces: OpsSurfaceId[];
}): Promise<{
  tenant_id: string;
  connector_id: string;
  enabled: boolean;
  surfaces: OpsSurfaceId[];
}> {
  return putOpsConnectorEntitlement(input);
}
