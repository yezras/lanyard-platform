/**
 * Live integrations.sh ConnectorSource (lp-hdzm.5).
 *
 * Every GET is built from {@link INTEGRATIONS_SH_ORIGIN}. Callers cannot
 * supply a snapshot or an origin.
 */
import {
  CONNECTOR_SOURCE_ID,
  parseCatalogDomain,
  parseConnectorSourceHit,
  type CatalogDomain,
  type ConnectorSource,
  type ConnectorSourceEnvelope,
  type ConnectorSourceHit,
  type ConnectorSourceResult,
  type ConnectorSourceSearchQuery,
  type ConnectorSourceSurface,
} from "./connector-source.js";
import {
  INTEGRATIONS_SH_ENVELOPE_MAX_BYTES,
  INTEGRATIONS_SH_SEARCH_MAX_BYTES,
  INTEGRATIONS_SH_SURFACE_MAX_BYTES,
  createIntegrationsShFetcher,
  integrationsShEnvelopeUrl,
  integrationsShSearchUrl,
  integrationsShSurfaceUrl,
  parseIntegrationsShJson,
  type IntegrationsShFetchOptions,
  type IntegrationsShFetchResult,
} from "./integrations-sh-fetch.js";

export type IntegrationsShSourceOptions = IntegrationsShFetchOptions & {
  maxSearchBytes?: number;
  maxSurfaceBytes?: number;
  maxEnvelopeBytes?: number;
};

type PinnedGet = (input: {
  url: string;
  maxBytes: number;
}) => Promise<IntegrationsShFetchResult>;

function mapFetchFailure(
  reason: "bad_url" | "oversized" | "fetch_failed",
): ConnectorSourceResult<never> {
  if (reason === "bad_url") {
    return { ok: false, reason: "bad_url" };
  }
  if (reason === "oversized") {
    return { ok: false, reason: "oversized" };
  }
  return { ok: false, reason: "upstream" };
}

function parseHits(value: unknown): ConnectorSourceHit[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const rec = value as Record<string, unknown>;
  const rows = Array.isArray(rec.results)
    ? rec.results
    : Array.isArray(rec.data)
      ? rec.data
      : null;
  if (!rows) {
    return null;
  }
  const hits: ConnectorSourceHit[] = [];
  for (const row of rows) {
    const hit = parseConnectorSourceHit(row);
    if (hit) {
      hits.push(hit);
    }
  }
  return hits;
}

function parseSurface(
  value: unknown,
  fallbackDomain: CatalogDomain,
): ConnectorSourceSurface | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const rec = value as Record<string, unknown>;
  const domain =
    typeof rec.domain === "string"
      ? parseCatalogDomain(rec.domain)
      : fallbackDomain;
  if (!domain) {
    return null;
  }
  if (!Array.isArray(rec.surfaces)) {
    return null;
  }
  const surface: ConnectorSourceSurface = {
    version: rec.version ?? 3,
    domain,
    surfaces: rec.surfaces,
  };
  if (rec.credentials !== undefined) {
    surface.credentials = rec.credentials;
  }
  if (typeof rec.summary === "string") {
    surface.summary = rec.summary;
  }
  if (typeof rec.description === "string") {
    surface.description = rec.description;
  }
  if (typeof rec.discoveredAt === "string") {
    surface.discoveredAt = rec.discoveredAt;
  }
  return surface;
}

function parseEnvelope(value: unknown): ConnectorSourceEnvelope | null {
  const hits = parseHits(value);
  if (!hits) {
    return null;
  }
  const rec =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const version =
    typeof rec.version === "number" || typeof rec.version === "string"
      ? rec.version
      : 1;
  const generatedAt =
    typeof rec.generatedAt === "string"
      ? rec.generatedAt
      : typeof rec.generated_at === "string"
        ? rec.generated_at
        : new Date(0).toISOString();
  return {
    source: CONNECTOR_SOURCE_ID,
    version,
    generatedAt,
    data: hits,
  };
}

async function getJson(
  get: PinnedGet,
  url: URL,
  maxBytes: number,
): Promise<ConnectorSourceResult<unknown>> {
  const fetched = await get({ url: url.toString(), maxBytes });
  if (!fetched.ok) {
    return mapFetchFailure(fetched.reason);
  }
  const parsed = parseIntegrationsShJson(fetched.bytes);
  if (!parsed.ok) {
    return { ok: false, reason: "invalid_payload" };
  }
  return { ok: true, value: parsed.value };
}

export function createIntegrationsShSource(
  options: IntegrationsShSourceOptions = {},
): ConnectorSource {
  const get = createIntegrationsShFetcher(options);
  const maxSearchBytes =
    options.maxSearchBytes ?? INTEGRATIONS_SH_SEARCH_MAX_BYTES;
  const maxSurfaceBytes =
    options.maxSurfaceBytes ?? INTEGRATIONS_SH_SURFACE_MAX_BYTES;
  const maxEnvelopeBytes =
    options.maxEnvelopeBytes ?? INTEGRATIONS_SH_ENVELOPE_MAX_BYTES;

  return {
    id: CONNECTOR_SOURCE_ID,

    async search(query: ConnectorSourceSearchQuery) {
      const q = query.q.trim();
      if (!q) {
        return { ok: false, reason: "bad_query" };
      }
      const built = integrationsShSearchUrl({
        q,
        kind: query.kind,
        limit: query.limit,
      });
      if (!built.ok) {
        return { ok: false, reason: "bad_url" };
      }
      const json = await getJson(get, built.url, maxSearchBytes);
      if (!json.ok) {
        return json;
      }
      const hits = parseHits(json.value);
      if (!hits) {
        return { ok: false, reason: "invalid_payload" };
      }
      return { ok: true, value: { results: hits } };
    },

    async getEnvelope() {
      const built = integrationsShEnvelopeUrl();
      if (!built.ok) {
        return { ok: false, reason: "bad_url" };
      }
      const json = await getJson(get, built.url, maxEnvelopeBytes);
      if (!json.ok) {
        return json;
      }
      const envelope = parseEnvelope(json.value);
      if (!envelope) {
        return { ok: false, reason: "invalid_payload" };
      }
      return { ok: true, value: envelope };
    },

    async getSurface(domainRaw: string) {
      const domain = parseCatalogDomain(domainRaw);
      if (!domain) {
        return { ok: false, reason: "bad_domain" };
      }
      const built = integrationsShSurfaceUrl(domain);
      if (!built.ok) {
        return { ok: false, reason: "bad_url" };
      }
      const json = await getJson(get, built.url, maxSurfaceBytes);
      if (!json.ok) {
        return json;
      }
      const surface = parseSurface(json.value, domain);
      if (!surface) {
        return { ok: false, reason: "invalid_payload" };
      }
      return { ok: true, value: surface };
    },
  };
}
