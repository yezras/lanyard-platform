/**
 * Catalog source boundary (lp-hdzm.5).
 *
 * The browser never fetches integrations.sh. Promote compiles a snapshot the
 * BFF retrieved. Client-supplied snapshot bodies are illegal at this edge.
 */
import { isIP } from "node:net";

export const CONNECTOR_SOURCE_ID = "integrations.sh" as const;
export type ConnectorSourceId = typeof CONNECTOR_SOURCE_ID;

export const CONNECTOR_SOURCE_KINDS = [
  "mcp",
  "openapi",
  "graphql",
  "cli",
] as const;
export type ConnectorSourceKind = (typeof CONNECTOR_SOURCE_KINDS)[number];

/** LDH hostname branded after {@link parseCatalogDomain}. */
export type CatalogDomain = string & { readonly __brand: "CatalogDomain" };

export type ConnectorSourceHit = {
  domain: CatalogDomain;
  name: string;
  description: string;
  kinds: ConnectorSourceKind[];
};

export type ConnectorSourceEnvelope = {
  source: ConnectorSourceId;
  version: number | string;
  generatedAt: string;
  data: ConnectorSourceHit[];
};

export type ConnectorSourceSurface = {
  version: unknown;
  domain: CatalogDomain;
  surfaces: unknown[];
  credentials?: unknown;
  summary?: string;
  description?: string;
  discoveredAt?: string;
};

export type ConnectorSourceSearchQuery = {
  q: string;
  kind?: ConnectorSourceKind;
  limit?: number;
};

export type ConnectorSourceFailure = {
  ok: false;
  reason:
    | "bad_domain"
    | "bad_query"
    | "bad_url"
    | "oversized"
    | "upstream"
    | "not_found"
    | "invalid_payload";
};

export type ConnectorSourceResult<T> =
  | { ok: true; value: T }
  | ConnectorSourceFailure;

/**
 * Ordered catalog backends. This epic ships one implementation.
 * Later catalogs implement the same surface.
 */
export type ConnectorSource = {
  readonly id: ConnectorSourceId;
  search(
    query: ConnectorSourceSearchQuery,
  ): Promise<ConnectorSourceResult<{ results: ConnectorSourceHit[] }>>;
  getEnvelope(): Promise<ConnectorSourceResult<ConnectorSourceEnvelope>>;
  getSurface(
    domain: string,
  ): Promise<ConnectorSourceResult<ConnectorSourceSurface>>;
};

const DOMAIN_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

export function isConnectorSourceKind(
  value: unknown,
): value is ConnectorSourceKind {
  return (
    typeof value === "string" &&
    (CONNECTOR_SOURCE_KINDS as readonly string[]).includes(value)
  );
}

export function parseCatalogDomain(raw: string): CatalogDomain | null {
  const trimmed = raw.trim().toLowerCase();
  if (!DOMAIN_RE.test(trimmed)) {
    return null;
  }
  if (isIP(trimmed)) {
    return null;
  }
  if (trimmed === "localhost" || trimmed.endsWith(".localhost")) {
    return null;
  }
  return trimmed as CatalogDomain;
}

export function parseConnectorSourceKind(
  raw: string | undefined,
): ConnectorSourceKind | null | undefined {
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  const value = raw.trim().toLowerCase();
  return isConnectorSourceKind(value) ? value : null;
}

export function parseSearchLimit(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") {
    return 20;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    return null;
  }
  return parsed;
}

export function parseConnectorSourceHit(
  value: unknown,
): ConnectorSourceHit | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const rec = value as Record<string, unknown>;
  const domain = parseCatalogDomain(String(rec.domain ?? ""));
  if (!domain) {
    return null;
  }
  if (typeof rec.name !== "string" || typeof rec.description !== "string") {
    return null;
  }
  if (!Array.isArray(rec.kinds)) {
    return null;
  }
  const kinds = rec.kinds.filter(isConnectorSourceKind);
  return {
    domain,
    name: rec.name,
    description: rec.description,
    kinds,
  };
}

export function clientSuppliedSnapshot(body: unknown): boolean {
  return Boolean(
    body &&
      typeof body === "object" &&
      !Array.isArray(body) &&
      "snapshot" in body,
  );
}
