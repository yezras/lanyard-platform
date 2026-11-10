/**
 * Offline integrations.sh ConnectorSource (lp-hdzm.5).
 *
 * Tests and CI use this so the BFF never hits the live network.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

type FixtureEntry = {
  hit: ConnectorSourceHit;
  surface: ConnectorSourceSurface;
};

type FixtureFile = {
  version: number | string;
  generatedAt: string;
  entries: unknown[];
};

function defaultFixturePath(): string {
  return join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "fixtures",
    "integrations-sh.json",
  );
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
  if (!domain || !Array.isArray(rec.surfaces)) {
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

function parseEntries(raw: unknown): {
  version: number | string;
  generatedAt: string;
  entries: FixtureEntry[];
} {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("integrations.sh fixture is not an object");
  }
  const rec = raw as Record<string, unknown>;
  const rows = Array.isArray(rec.entries) ? rec.entries : [];
  const entries: FixtureEntry[] = [];
  for (const row of rows) {
    const hit = parseConnectorSourceHit(row);
    if (!hit) continue;
    const surfaceRaw =
      row && typeof row === "object" && !Array.isArray(row)
        ? (row as Record<string, unknown>).surface
        : undefined;
    const surface = parseSurface(surfaceRaw, hit.domain);
    if (!surface) continue;
    entries.push({ hit, surface });
  }
  const version =
    typeof rec.version === "number" || typeof rec.version === "string"
      ? rec.version
      : 1;
  const generatedAt =
    typeof rec.generatedAt === "string"
      ? rec.generatedAt
      : "2026-08-26T00:00:00.000Z";
  return { version, generatedAt, entries };
}

export function loadIntegrationsShFixture(
  path = defaultFixturePath(),
): FixtureFile {
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("integrations.sh fixture is not an object");
  }
  return parsed as FixtureFile;
}

let defaultSource: ConnectorSource | undefined;

export function createFixtureConnectorSource(
  fixture?: unknown,
): ConnectorSource {
  if (fixture === undefined) {
    defaultSource ??= buildFixtureSource(loadIntegrationsShFixture());
    return defaultSource;
  }
  return buildFixtureSource(fixture);
}

function buildFixtureSource(fixture: unknown): ConnectorSource {
  const loaded = parseEntries(fixture);
  const byDomain = new Map<CatalogDomain, FixtureEntry>();
  for (const entry of loaded.entries) {
    byDomain.set(entry.hit.domain, entry);
  }

  const envelope: ConnectorSourceEnvelope = {
    source: CONNECTOR_SOURCE_ID,
    version: loaded.version,
    generatedAt: loaded.generatedAt,
    data: loaded.entries.map((entry) => entry.hit),
  };

  return {
    id: CONNECTOR_SOURCE_ID,

    async search(query: ConnectorSourceSearchQuery) {
      const q = query.q.trim().toLowerCase();
      if (!q) {
        return { ok: false, reason: "bad_query" };
      }
      const limit = query.limit ?? 20;
      const results: ConnectorSourceHit[] = [];
      for (const entry of loaded.entries) {
        if (query.kind && !entry.hit.kinds.includes(query.kind)) {
          continue;
        }
        const haystack =
          `${entry.hit.domain} ${entry.hit.name} ${entry.hit.description}`.toLowerCase();
        if (!haystack.includes(q)) {
          continue;
        }
        results.push(entry.hit);
        if (results.length >= limit) {
          break;
        }
      }
      return { ok: true, value: { results } };
    },

    async getEnvelope(): Promise<ConnectorSourceResult<ConnectorSourceEnvelope>> {
      return { ok: true, value: envelope };
    },

    async getSurface(domainRaw: string) {
      const domain = parseCatalogDomain(domainRaw);
      if (!domain) {
        return { ok: false, reason: "bad_domain" };
      }
      const entry = byDomain.get(domain);
      if (!entry) {
        return { ok: false, reason: "not_found" };
      }
      return { ok: true, value: entry.surface };
    },
  };
}
