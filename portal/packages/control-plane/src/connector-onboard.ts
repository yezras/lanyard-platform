/**
 * Tenant onboard domain (lp-hdzm.21).
 *
 * Onboard is the entitlement row with a non-empty surfaces[]. Absence or
 * empty surfaces is not onboarded. GraphQL is never a surface id.
 */
import {
  CONNECTOR_SURFACE_IDS,
  isConnectorSurfaceId,
  type ConnectorSurfaceId,
} from "./class-c-secrets.js";
import {
  isFirstClassConnectorId,
  type FirstClassConnectorId,
} from "./connectors.js";
import {
  parseCompiledSnapshot,
  type CompiledSurfaceKind,
} from "./connector-registry.js";

export { CONNECTOR_SURFACE_IDS, isConnectorSurfaceId };
export type { ConnectorSurfaceId };

export const FIRST_CLASS_ONBOARD_SURFACES: Record<
  FirstClassConnectorId,
  readonly ConnectorSurfaceId[]
> = {
  google: ["cli"],
  hubspot: ["api", "cli"],
  whatsapp: ["cli"],
  github: ["cli"],
};

export class ConnectorNotOnboardableError extends Error {
  readonly code = "CONNECTOR_NOT_ONBOARDABLE";

  constructor(id: string) {
    super(`Connector is not onboardable: ${id}`);
    this.name = "ConnectorNotOnboardableError";
  }
}

export function compiledKindToSurfaceId(
  kind: CompiledSurfaceKind,
): ConnectorSurfaceId {
  return kind === "openapi" ? "api" : kind;
}

/** Onboarded iff the entitlement is enabled with a non-empty surfaces[]. */
export function connectorIsOnboarded(entitlement: {
  enabled: boolean;
  surfaces: readonly unknown[];
} | null | undefined): boolean {
  return Boolean(entitlement?.enabled && entitlement.surfaces.length > 0);
}

export function parseOnboardSurfaces(value: unknown): ConnectorSurfaceId[] {
  let parsed = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const surfaces: ConnectorSurfaceId[] = [];
  for (const item of parsed) {
    if (typeof item !== "string" || !isConnectorSurfaceId(item)) {
      continue;
    }
    if (!surfaces.includes(item)) {
      surfaces.push(item);
    }
  }
  return surfaces;
}

export function availableOnboardSurfaces(input: {
  id: string;
  snapshot: unknown;
}): ConnectorSurfaceId[] {
  if (isFirstClassConnectorId(input.id)) {
    return [...FIRST_CLASS_ONBOARD_SURFACES[input.id]];
  }
  try {
    const snapshot = parseCompiledSnapshot(input.snapshot);
    if (snapshot.runnability !== "runnable") {
      return [];
    }
    const surfaces: ConnectorSurfaceId[] = [];
    for (const row of snapshot.surfaces) {
      if (row.runnability !== "runnable") {
        continue;
      }
      const id = compiledKindToSurfaceId(row.kind);
      if (!surfaces.includes(id)) {
        surfaces.push(id);
      }
    }
    return surfaces;
  } catch {
    return [];
  }
}

export function assertOnboardSurfacesAllowed(
  connectorId: string,
  requested: ConnectorSurfaceId[],
  available: ConnectorSurfaceId[],
): void {
  if (available.length === 0) {
    throw new ConnectorNotOnboardableError(connectorId);
  }
  if (requested.length === 0) {
    throw new ConnectorNotOnboardableError(connectorId);
  }
  for (const surface of requested) {
    if (!available.includes(surface)) {
      throw new ConnectorNotOnboardableError(connectorId);
    }
  }
}

export function droppedOnboardSurfaces(input: {
  previous: ConnectorSurfaceId[];
  next: ConnectorSurfaceId[];
}): ConnectorSurfaceId[] {
  if (input.next.length === 0) {
    const dropped: ConnectorSurfaceId[] = [];
    for (const surface of CONNECTOR_SURFACE_IDS) {
      dropped.push(surface);
    }
    return dropped;
  }
  return input.previous.filter((surface) => !input.next.includes(surface));
}
