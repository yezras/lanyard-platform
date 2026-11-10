/**
 * Ops tenant onboard DTOs (lp-hdzm.21).
 *
 * List is onboarded-only. Onboard search is canonical rows not on the
 * tenant. Surfaces are mcp | api | cli. GraphQL is never onboardable.
 */
import type { CanonicalConnector } from "./control-plane-client.js";

export const CONNECTOR_SURFACE_IDS = ["mcp", "api", "cli"] as const;
export type ConnectorSurfaceId = (typeof CONNECTOR_SURFACE_IDS)[number];

export const FIRST_CLASS_CONNECTOR_IDS = [
  "google",
  "hubspot",
  "whatsapp",
  "github",
] as const;
export type FirstClassConnectorId = (typeof FIRST_CLASS_CONNECTOR_IDS)[number];

const FIRST_CLASS_ONBOARD_SURFACES: Record<
  FirstClassConnectorId,
  readonly ConnectorSurfaceId[]
> = {
  google: ["cli"],
  hubspot: ["api", "cli"],
  whatsapp: ["cli"],
  github: ["cli"],
};

const FIRST_CLASS_AUTH_CHIPS: Record<FirstClassConnectorId, readonly string[]> = {
  google: ["OAuth"],
  hubspot: ["OAuth"],
  whatsapp: ["OAuth", "QR"],
  github: ["CLI"],
};

export type OpsTenantOnboardedConnector = {
  connector_id: string;
  label: string;
  surfaces: ConnectorSurfaceId[];
  available_surfaces: ConnectorSurfaceId[];
  status_counts: {
    connected: number;
    pairing: number;
    needs_reauth: number;
  };
  auth_chips: string[];
};

export function isConnectorSurfaceId(
  value: string,
): value is ConnectorSurfaceId {
  return (CONNECTOR_SURFACE_IDS as readonly string[]).includes(value);
}

export function isFirstClassConnectorId(
  value: string,
): value is FirstClassConnectorId {
  return (FIRST_CLASS_CONNECTOR_IDS as readonly string[]).includes(value);
}

function compiledKindToSurfaceId(kind: string): ConnectorSurfaceId | null {
  if (kind === "mcp" || kind === "cli") {
    return kind;
  }
  if (kind === "openapi") {
    return "api";
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function availableOnboardSurfaces(input: {
  id: string;
  snapshot: unknown;
}): ConnectorSurfaceId[] {
  if (isFirstClassConnectorId(input.id)) {
    return [...FIRST_CLASS_ONBOARD_SURFACES[input.id]];
  }
  const snapshot = asRecord(input.snapshot);
  if (!snapshot || snapshot.runnability !== "runnable") {
    return [];
  }
  if (!Array.isArray(snapshot.surfaces)) {
    return [];
  }
  const surfaces: ConnectorSurfaceId[] = [];
  for (const row of snapshot.surfaces) {
    const surface = asRecord(row);
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

export function authChipsForCanonical(input: {
  id: string;
  snapshot: unknown;
}): string[] {
  if (isFirstClassConnectorId(input.id)) {
    return [...FIRST_CLASS_AUTH_CHIPS[input.id]];
  }
  const snapshot = asRecord(input.snapshot);
  const chips: string[] = [];
  const rows = Array.isArray(snapshot?.surfaces) ? snapshot.surfaces : [];
  for (const row of rows) {
    const surface = asRecord(row);
    const kind =
      typeof surface?.auth_kind === "string" ? surface.auth_kind : surface?.kind;
    if (typeof kind !== "string") {
      continue;
    }
    const chip =
      kind === "oauth"
        ? "OAuth"
        : kind === "api_key"
          ? "API key"
          : kind === "mcp" || kind === "openapi"
            ? "MCP"
            : kind === "cli"
              ? "CLI"
              : null;
    if (chip && !chips.includes(chip)) {
      chips.push(chip);
    }
  }
  return chips;
}

export function parseOnboardSurfaces(value: unknown): ConnectorSurfaceId[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const surfaces: ConnectorSurfaceId[] = [];
  for (const item of value) {
    if (typeof item === "string" && isConnectorSurfaceId(item) && !surfaces.includes(item)) {
      surfaces.push(item);
    }
  }
  return surfaces;
}

export function toOpsTenantOnboarded(input: {
  canonical: CanonicalConnector[];
  entitlements: Array<{
    connector_id: string;
    enabled: boolean;
    surfaces?: unknown;
  }>;
  statusByConnector: Record<
    string,
    { connected: number; pairing: number; needs_reauth: number }
  >;
}): OpsTenantOnboardedConnector[] {
  const byId = new Map(input.canonical.map((row) => [row.id, row]));
  const rows: OpsTenantOnboardedConnector[] = [];
  for (const entitlement of input.entitlements) {
    if (!entitlement.enabled) {
      continue;
    }
    const canonical = byId.get(entitlement.connector_id);
    const available = availableOnboardSurfaces({
      id: entitlement.connector_id,
      snapshot: canonical?.snapshot ?? {},
    });
    const stored = parseOnboardSurfaces(entitlement.surfaces);
    const surfaces = stored.length > 0 ? stored : available;
    rows.push({
      connector_id: entitlement.connector_id,
      label: canonical?.label ?? entitlement.connector_id,
      surfaces,
      available_surfaces: available,
      status_counts: input.statusByConnector[entitlement.connector_id] ?? {
        connected: 0,
        pairing: 0,
        needs_reauth: 0,
      },
      auth_chips: authChipsForCanonical({
        id: entitlement.connector_id,
        snapshot: canonical?.snapshot ?? {},
      }),
    });
  }
  return rows;
}

export function searchCanonicalNotOnTenant(input: {
  canonical: CanonicalConnector[];
  onboardedIds: ReadonlySet<string>;
  query: string;
}): Array<{
  id: string;
  label: string;
  available_surfaces: ConnectorSurfaceId[];
  auth_chips: string[];
}> {
  const needle = input.query.trim().toLowerCase();
  const rows: Array<{
    id: string;
    label: string;
    available_surfaces: ConnectorSurfaceId[];
    auth_chips: string[];
  }> = [];
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
      auth_chips: authChipsForCanonical({
        id: connector.id,
        snapshot: connector.snapshot,
      }),
    });
  }
  return rows;
}
