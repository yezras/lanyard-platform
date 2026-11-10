/**
 * Deprecation catalog for Hermes-named Portal HTTP routes.
 *
 * Bead: `lp-k7g.8.7` — preserve existing Hermes deployment compatibility.
 *
 * Existing deployments and web clients call `/api/hermes/*` (mounted as
 * `/hermes/*` on the BFF app). During the migration window those paths stay
 * live and return the same JSON shapes, but they are **deprecated wire
 * aliases** of backend-neutral routes. New clients and docs must use the
 * preferred paths.
 *
 * Composition after Portal import: dual-register both paths on the same
 * handlers from `@lanyard/backend-runtime` (projects-bff, etc.), and attach
 * deprecation headers on the legacy path only.
 */

/** Lifecycle of a catalog entry. */
export type EndpointCompatStatus =
  | "deprecated_alias" // live; dual-mounted; prefer preferredPath
  | "preferred" // backend-neutral target
  | "retired"; // removed after removal criteria met

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * One legacy Hermes path and its backend-neutral replacement.
 *
 * `legacyPath` / `preferredPath` are absolute under the Portal API host
 * (include `/api` prefix as web clients see it).
 */
export type HermesEndpointDeprecation = {
  id: string;
  methods: readonly HttpMethod[];
  /** Historical path still served for wire stability. */
  legacyPath: string;
  /** Backend-neutral path new clients must use. */
  preferredPath: string;
  status: EndpointCompatStatus;
  /**
   * Short human note for OpenAPI / README / Deprecation response header.
   * Always present for legacy aliases.
   */
  deprecationNote: string;
  /** Optional RFC 8594 Sunset date (ISO date) once scheduled; null = unscheduled. */
  sunset: string | null;
  /** Handler / module after Portal import. */
  handler: string;
  /** Related beads / packages. */
  related: readonly string[];
};

/**
 * Canonical catalog of Hermes-named Portal endpoints.
 *
 * Paths are fixed for this bead so web and BFF can dual-mount before full
 * Portal product code is imported. Extend when additional `/hermes/*` routes
 * are discovered during import.
 */
export const HERMES_ENDPOINT_DEPRECATIONS: readonly HermesEndpointDeprecation[] =
  [
    {
      id: "agent-projects-list",
      methods: ["GET"],
      legacyPath: "/api/hermes/projects",
      preferredPath: "/api/agent/projects",
      status: "deprecated_alias",
      deprecationNote:
        "Deprecated: use GET /api/agent/projects. " +
        "/api/hermes/projects remains a temporary wire alias of Brain RPC projects.list " +
        "(lp-k7g.8.3 / lp-k7g.8.7). Removal requires HERMES_COMPAT_REMOVAL_CRITERIA.",
      sunset: null,
      handler:
        "@lanyard/backend-runtime createAgentProjectsHandlers().list / listAgentProjects",
      related: ["lp-k7g.8.3", "lp-k7g.8.7", "@lanyard/backend-runtime"],
    },
    {
      id: "agent-projects-create",
      methods: ["POST"],
      legacyPath: "/api/hermes/projects",
      preferredPath: "/api/agent/projects",
      status: "deprecated_alias",
      deprecationNote:
        "Deprecated: use POST /api/agent/projects. " +
        "/api/hermes/projects remains a temporary wire alias of Brain RPC projects.create " +
        "(expansion; capability-gated). Removal requires HERMES_COMPAT_REMOVAL_CRITERIA.",
      sunset: null,
      handler:
        "@lanyard/backend-runtime createAgentProjectsHandlers().create / createAgentProject",
      related: ["lp-k7g.8.3", "lp-k7g.8.7", "@lanyard/backend-runtime"],
    },
    {
      id: "agent-projects-delete",
      methods: ["DELETE"],
      legacyPath: "/api/hermes/projects/:id",
      preferredPath: "/api/agent/projects/:id",
      status: "deprecated_alias",
      deprecationNote:
        "Deprecated: use DELETE /api/agent/projects/:id. " +
        "Soft-archive only (Brain RPC projects.delete → {id, archived:true}); " +
        "workspace files stay on agent disk (lp-uxy.5). " +
        "Removal requires HERMES_COMPAT_REMOVAL_CRITERIA.",
      sunset: null,
      handler:
        "@lanyard/backend-runtime createAgentProjectsHandlers().delete / deleteAgentProject",
      related: ["lp-uxy.5", "lp-k7g.8.7", "@lanyard/backend-runtime"],
    },
  ] as const;

/** Preferred (non-Hermes) agent project routes for dual-mount registration. */
export const PREFERRED_AGENT_PROJECT_ROUTES = {
  list: {
    method: "GET" as const,
    path: "/api/agent/projects",
    bffMount: "/agent/projects",
  },
  create: {
    method: "POST" as const,
    path: "/api/agent/projects",
    bffMount: "/agent/projects",
  },
  delete: {
    method: "DELETE" as const,
    path: "/api/agent/projects/:id",
    bffMount: "/agent/projects/:id",
  },
} as const;

/** Legacy Hermes agent project routes still dual-mounted. */
export const LEGACY_HERMES_PROJECT_ROUTES = {
  list: {
    method: "GET" as const,
    path: "/api/hermes/projects",
    bffMount: "/hermes/projects",
  },
  create: {
    method: "POST" as const,
    path: "/api/hermes/projects",
    bffMount: "/hermes/projects",
  },
  delete: {
    method: "DELETE" as const,
    path: "/api/hermes/projects/:id",
    bffMount: "/hermes/projects/:id",
  },
} as const;

/**
 * Lookup deprecation entries for a request path (with or without /api prefix).
 */
export function deprecationsForPath(
  path: string,
): HermesEndpointDeprecation[] {
  const normalized = normalizeApiPath(path);
  return HERMES_ENDPOINT_DEPRECATIONS.filter(
    (entry) =>
      normalizeApiPath(entry.legacyPath) === normalized ||
      normalizeApiPath(entry.preferredPath) === normalized,
  );
}

/**
 * True when the path is a known temporary Hermes wire alias.
 */
export function isLegacyHermesEndpoint(path: string): boolean {
  const normalized = normalizeApiPath(path);
  return HERMES_ENDPOINT_DEPRECATIONS.some(
    (entry) =>
      entry.status === "deprecated_alias" &&
      normalizeApiPath(entry.legacyPath) === normalized,
  );
}

/**
 * Preferred replacement path for a legacy Hermes path, or null if unknown.
 */
export function preferredPathForLegacy(path: string): string | null {
  const normalized = normalizeApiPath(path);
  const entry = HERMES_ENDPOINT_DEPRECATIONS.find(
    (e) =>
      e.status === "deprecated_alias" &&
      normalizeApiPath(e.legacyPath) === normalized,
  );
  return entry?.preferredPath ?? null;
}

/**
 * Deprecation note text for responses / OpenAPI. Null when path is not legacy.
 */
export function deprecationNoteForPath(path: string): string | null {
  const normalized = normalizeApiPath(path);
  const entry = HERMES_ENDPOINT_DEPRECATIONS.find(
    (e) =>
      e.status === "deprecated_alias" &&
      normalizeApiPath(e.legacyPath) === normalized,
  );
  return entry?.deprecationNote ?? null;
}

/**
 * HTTP response headers for a legacy Hermes route (RFC 8594 / draft deprecation).
 *
 * - `Deprecation: true` — signal the resource is deprecated
 * - `Link: <preferred>; rel="successor-version"` — point clients at the new path
 * - `Sunset: <http-date>` — only when a sunset date is scheduled
 * - `X-Lanyard-Deprecation-Note` — human-readable note (non-standard, ops-friendly)
 */
export function deprecationHeadersForLegacyPath(
  path: string,
): Record<string, string> | null {
  const normalized = normalizeApiPath(path);
  const entry = HERMES_ENDPOINT_DEPRECATIONS.find(
    (e) =>
      e.status === "deprecated_alias" &&
      normalizeApiPath(e.legacyPath) === normalized,
  );
  if (!entry) return null;

  const headers: Record<string, string> = {
    Deprecation: "true",
    Link: `<${entry.preferredPath}>; rel="successor-version"`,
    "X-Lanyard-Deprecation-Note": entry.deprecationNote,
  };
  if (entry.sunset) {
    // RFC 8594 wants an HTTP-date; ISO date alone is acceptable for docs until
    // operators schedule an exact cutover instant.
    headers.Sunset = entry.sunset;
  }
  return headers;
}

/**
 * BFF dual-mount plan: register preferred + legacy for each deprecated group.
 * Handlers must be identical so wire JSON stays stable.
 */
export function dualMountPlan(): readonly {
  id: string;
  methods: readonly HttpMethod[];
  preferredPath: string;
  legacyPath: string;
  preferredBffMount: string;
  legacyBffMount: string;
  deprecationNote: string;
  handler: string;
}[] {
  const byId = new Map<string, HermesEndpointDeprecation>();
  // Collapse list+create sharing the same path into one dual-mount row per path+handler family.
  const seen = new Set<string>();
  const plan: {
    id: string;
    methods: HttpMethod[];
    preferredPath: string;
    legacyPath: string;
    preferredBffMount: string;
    legacyBffMount: string;
    deprecationNote: string;
    handler: string;
  }[] = [];

  for (const entry of HERMES_ENDPOINT_DEPRECATIONS) {
    if (entry.status !== "deprecated_alias") continue;
    const key = `${entry.legacyPath}→${entry.preferredPath}`;
    if (seen.has(key)) {
      const existing = plan.find(
        (p) =>
          p.legacyPath === entry.legacyPath &&
          p.preferredPath === entry.preferredPath,
      );
      if (existing) {
        for (const m of entry.methods) {
          if (!existing.methods.includes(m)) existing.methods.push(m);
        }
      }
      continue;
    }
    seen.add(key);
    byId.set(entry.id, entry);
    plan.push({
      id: entry.id,
      methods: [...entry.methods],
      preferredPath: entry.preferredPath,
      legacyPath: entry.legacyPath,
      preferredBffMount: stripApiPrefix(entry.preferredPath),
      legacyBffMount: stripApiPrefix(entry.legacyPath),
      deprecationNote: entry.deprecationNote,
      handler: entry.handler,
    });
  }

  void byId;
  return plan;
}

function normalizeApiPath(path: string): string {
  let p = path.trim();
  if (!p.startsWith("/")) p = `/${p}`;
  // Accept BFF mounts without /api prefix.
  if (p.startsWith("/hermes/") || p === "/hermes") {
    p = `/api${p}`;
  } else if (p.startsWith("/agent/") || p === "/agent") {
    p = `/api${p}`;
  }
  // Drop trailing slash except root.
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  return p;
}

function stripApiPrefix(path: string): string {
  const n = normalizeApiPath(path);
  return n.startsWith("/api/") ? n.slice(4) : n;
}
