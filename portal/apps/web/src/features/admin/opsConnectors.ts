/**
 * Tenant onboard list model (lp-hdzm.21).
 *
 * The Connectors page lists onboarded rows only. Onboard searches canonical
 * connectors not yet on this tenant. Surfaces live on detail.
 */
import type {
  OpsCanonicalConnector,
  OpsSurfaceId,
  OpsTenantOnboardedConnector,
} from "../../api/opsConnectors.js";

export type OpsConnectorId = string;
export type ConnectorStatus = "connected" | "reauth" | "pairing" | "not_connected";

export type OpsConnectorListRow = {
  connector_id: OpsConnectorId;
  label: string;
  authChips: string[];
  status: ConnectorStatus;
  connectedUsers: number;
  pairing: number;
  needsReauth: number;
  surfaces: OpsSurfaceId[];
  available_surfaces: OpsSurfaceId[];
};

export type OpsOnboardCandidate = {
  id: OpsConnectorId;
  label: string;
  available_surfaces: OpsSurfaceId[];
  authChips: string[];
};

export function connectorStatus(input: {
  connected: number;
  pairing: number;
  needs_reauth: number;
}): ConnectorStatus {
  if (input.needs_reauth > 0) {
    return "reauth";
  }
  if (input.pairing > 0) {
    return "pairing";
  }
  if (input.connected > 0) {
    return "connected";
  }
  return "not_connected";
}

export const CONNECTOR_STATUS_LABELS: Record<ConnectorStatus, string> = {
  connected: "Connected",
  reauth: "Needs reauth",
  pairing: "Pairing",
  not_connected: "Not connected",
};

export function buildOnboardedRows(
  connectors: OpsTenantOnboardedConnector[],
): OpsConnectorListRow[] {
  return connectors.map((entry) => ({
    connector_id: entry.connector_id,
    label: entry.label,
    authChips: entry.auth_chips,
    status: connectorStatus(entry.status_counts),
    connectedUsers: entry.status_counts.connected,
    pairing: entry.status_counts.pairing,
    needsReauth: entry.status_counts.needs_reauth,
    surfaces: entry.surfaces,
    available_surfaces: entry.available_surfaces,
  }));
}

function snapshotRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

const FIRST_CLASS_SURFACES: Record<string, readonly OpsSurfaceId[]> = {
  google: ["cli"],
  hubspot: ["api", "cli"],
  whatsapp: ["cli"],
  github: ["cli"],
};

function compiledKindToSurfaceId(kind: string): OpsSurfaceId | null {
  if (kind === "mcp" || kind === "cli" || kind === "api") {
    return kind;
  }
  if (kind === "openapi") {
    return "api";
  }
  return null;
}

export function availableOnboardSurfaces(input: {
  id: string;
  snapshot: unknown;
}): OpsSurfaceId[] {
  const firstClass = FIRST_CLASS_SURFACES[input.id];
  if (firstClass) {
    return [...firstClass];
  }
  const snapshot = snapshotRecord(input.snapshot);
  if (!snapshot || snapshot.runnability !== "runnable") {
    return [];
  }
  if (!Array.isArray(snapshot.surfaces)) {
    return [];
  }
  const surfaces: OpsSurfaceId[] = [];
  for (const row of snapshot.surfaces) {
    const surface = snapshotRecord(row);
    if (!surface || surface.runnability !== "runnable") {
      continue;
    }
    if (typeof surface.kind !== "string") {
      continue;
    }
    const id = compiledKindToSurfaceId(surface.kind);
    if (id && !surfaces.includes(id)) {
      surfaces.push(id);
    }
  }
  return surfaces;
}

export function searchCanonicalNotOnTenant(input: {
  canonical: OpsCanonicalConnector[];
  onboardedIds: ReadonlySet<string>;
  query: string;
}): OpsOnboardCandidate[] {
  const needle = input.query.trim().toLowerCase();
  const rows: OpsOnboardCandidate[] = [];
  for (const connector of input.canonical) {
    if (connector.archived || input.onboardedIds.has(connector.id)) {
      continue;
    }
    const available = availableOnboardSurfaces({
      id: connector.id,
      snapshot: connector.snapshot,
    });
    if (available.length === 0) {
      continue;
    }
    if (
      needle &&
      !connector.id.includes(needle) &&
      !connector.label.toLowerCase().includes(needle) &&
      !(connector.domain ?? "").toLowerCase().includes(needle)
    ) {
      continue;
    }
    rows.push({
      id: connector.id,
      label: connector.label,
      available_surfaces: available,
      authChips: [],
    });
  }
  return rows;
}

export function isLastSurfaceOff(
  current: OpsSurfaceId[],
  turningOff: OpsSurfaceId,
): boolean {
  return current.length === 1 && current[0] === turningOff;
}

export function remainingSurfaces(
  current: OpsSurfaceId[],
  turningOff: OpsSurfaceId,
): OpsSurfaceId[] {
  return current.filter((surface) => surface !== turningOff);
}
