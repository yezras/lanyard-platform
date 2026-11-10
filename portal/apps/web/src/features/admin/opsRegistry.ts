/**
 * Superadmin Registry model (lp-hdzm.20).
 *
 * Search hits are integrations.sh rows. A hit already on the canonical
 * list is `on_registry` (no Promote). Custom surfaces cannot be GraphQL.
 */
import type {
  CanonicalConnectorRow,
  CustomConnectorInput,
  CustomSurfacePayload,
  RegistrySearchHit,
  RegistrySurfaceKind,
} from "../../api/opsRegistry.js";

export type { CanonicalConnectorRow, RegistrySearchHit, RegistrySurfaceKind };

export const CUSTOM_SURFACE_KINDS = ["mcp", "openapi", "cli"] as const;
export type CustomSurfaceKind = (typeof CUSTOM_SURFACE_KINDS)[number];

export const CONNECTOR_SLUG_RE = /^[a-z][a-z0-9-]{0,63}$/;

export const SURFACE_CHIP_LABELS: Record<RegistrySurfaceKind, string> = {
  mcp: "MCP",
  openapi: "API",
  graphql: "GraphQL",
  cli: "CLI",
};

export type RegistrySearchAction =
  | { kind: "on_registry" }
  | { kind: "promote"; domain: string };

export type RegistrySearchRow = RegistrySearchHit & {
  action: RegistrySearchAction;
};

export type CustomSurfaceDraft = {
  kind: CustomSurfaceKind;
  initialize_url: string;
  auth_kind: string;
  spec_text: string;
  argv_text: string;
};

export function emptyCustomSurfaceDraft(): CustomSurfaceDraft {
  return {
    kind: "mcp",
    initialize_url: "",
    auth_kind: "",
    spec_text: "",
    argv_text: "",
  };
}

export function liveCanonicalRows(
  rows: readonly CanonicalConnectorRow[],
): CanonicalConnectorRow[] {
  return rows.filter((row) => !row.archived);
}

export function canonicalForHit(
  hit: RegistrySearchHit,
  rows: readonly CanonicalConnectorRow[],
): CanonicalConnectorRow | null {
  const live = liveCanonicalRows(rows);
  const byDomain = live.find((row) => row.domain === hit.domain);
  if (byDomain) {
    return byDomain;
  }
  const entryId = `integrations.sh:${hit.domain}`;
  return live.find((row) => row.source_entry_id === entryId) ?? null;
}

export function searchActionForHit(
  hit: RegistrySearchHit,
  rows: readonly CanonicalConnectorRow[],
): RegistrySearchAction {
  return canonicalForHit(hit, rows)
    ? { kind: "on_registry" }
    : { kind: "promote", domain: hit.domain };
}

export function buildRegistrySearchRows(
  hits: readonly RegistrySearchHit[],
  canonical: readonly CanonicalConnectorRow[],
): RegistrySearchRow[] {
  return hits.map((hit) => ({
    ...hit,
    action: searchActionForHit(hit, canonical),
  }));
}

export function canDeleteCanonical(row: CanonicalConnectorRow): boolean {
  return row.onboarded_tenant_count === 0;
}

export function parseConnectorSlug(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  return CONNECTOR_SLUG_RE.test(value) ? value : null;
}

function parseOpenApiSpec(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseArgv(text: string): string[] | null {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return null;
  }
  return parts;
}

export function parseCustomSurfaceDraft(
  draft: CustomSurfaceDraft,
): { ok: true; value: CustomSurfacePayload } | { ok: false; error: string } {
  if (draft.kind === "mcp") {
    const initialize_url = draft.initialize_url.trim();
    if (!initialize_url) {
      return { ok: false, error: "MCP initialize URL is required" };
    }
    const auth = draft.auth_kind.trim();
    return {
      ok: true,
      value: {
        kind: "mcp",
        initialize_url,
        transports: ["streamable-http"],
        ...(auth ? { auth_kind: auth } : {}),
      },
    };
  }
  if (draft.kind === "openapi") {
    const spec = parseOpenApiSpec(draft.spec_text);
    if (!spec) {
      return { ok: false, error: "OpenAPI spec must be JSON" };
    }
    return { ok: true, value: { kind: "openapi", spec } };
  }
  const argv = parseArgv(draft.argv_text);
  if (!argv) {
    return { ok: false, error: "CLI argv is required" };
  }
  return { ok: true, value: { kind: "cli", argv } };
}

export function parseCustomConnectorForm(input: {
  slug: string;
  label: string;
  surface: CustomSurfaceDraft;
}): { ok: true; value: CustomConnectorInput } | { ok: false; error: string } {
  const slug = parseConnectorSlug(input.slug);
  if (!slug) {
    return { ok: false, error: "Invalid slug" };
  }
  const label = input.label.trim();
  if (!label) {
    return { ok: false, error: "Label is required" };
  }
  const surface = parseCustomSurfaceDraft(input.surface);
  if (!surface.ok) {
    return surface;
  }
  return {
    ok: true,
    value: { slug, label, surfaces: [surface.value] },
  };
}
