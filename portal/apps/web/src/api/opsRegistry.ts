/**
 * Platform registry client (lp-hdzm.20). Search/promote/custom/delete go
 * through `/api/admin/registry/*`. The browser never fetches integrations.sh.
 */
import { apiErrorMessage, opsApiFetch } from "./opsApi.js";

type ApiErrorBody = { error?: string; message?: string };

export const REGISTRY_SURFACE_KINDS = [
  "mcp",
  "openapi",
  "graphql",
  "cli",
] as const;
export type RegistrySurfaceKind = (typeof REGISTRY_SURFACE_KINDS)[number];

export type RegistrySearchHit = {
  domain: string;
  name: string;
  description: string;
  kinds: RegistrySurfaceKind[];
};

export type CanonicalConnectorRow = {
  id: string;
  domain: string | null;
  label: string;
  source: string;
  source_entry_id: string | null;
  archived: boolean;
  onboarded_tenant_count: number;
};

export type CustomSurfacePayload =
  | {
      kind: "mcp";
      initialize_url: string;
      transports: ["streamable-http"];
      auth_kind?: string;
    }
  | { kind: "openapi"; spec: Record<string, unknown> }
  | { kind: "cli"; argv: string[] };

export type CustomConnectorInput = {
  slug: string;
  label: string;
  surfaces: CustomSurfacePayload[];
};

function isSurfaceKind(value: unknown): value is RegistrySurfaceKind {
  return (
    typeof value === "string" &&
    (REGISTRY_SURFACE_KINDS as readonly string[]).includes(value)
  );
}

export function parseRegistrySearchHits(body: unknown): RegistrySearchHit[] {
  const rec =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const rows = Array.isArray(rec.results) ? rec.results : [];
  const hits: RegistrySearchHit[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }
    const item = row as Record<string, unknown>;
    if (typeof item.domain !== "string" || !item.domain) {
      continue;
    }
    if (typeof item.name !== "string") {
      continue;
    }
    const kinds = Array.isArray(item.kinds)
      ? item.kinds.filter(isSurfaceKind)
      : [];
    hits.push({
      domain: item.domain,
      name: item.name,
      description: typeof item.description === "string" ? item.description : "",
      kinds,
    });
  }
  return hits;
}

export function parseCanonicalConnectorRow(
  value: unknown,
): CanonicalConnectorRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const rec = value as Record<string, unknown>;
  if (typeof rec.id !== "string" || !rec.id) {
    return null;
  }
  if (typeof rec.label !== "string" || !rec.label) {
    return null;
  }
  const countRaw = rec.onboarded_tenant_count;
  const count =
    typeof countRaw === "number" ? countRaw : Number(countRaw);
  return {
    id: rec.id,
    domain: typeof rec.domain === "string" && rec.domain ? rec.domain : null,
    label: rec.label,
    source: typeof rec.source === "string" ? rec.source : "",
    source_entry_id:
      typeof rec.source_entry_id === "string" && rec.source_entry_id
        ? rec.source_entry_id
        : null,
    archived: rec.archived === true,
    onboarded_tenant_count:
      Number.isFinite(count) && count > 0 ? count : 0,
  };
}

export function parseCanonicalConnectors(
  body: unknown,
): CanonicalConnectorRow[] {
  const rec =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const rows = Array.isArray(rec.connectors) ? rec.connectors : [];
  return rows
    .map(parseCanonicalConnectorRow)
    .filter((row): row is CanonicalConnectorRow => row !== null);
}

async function readJson(res: Response): Promise<unknown> {
  return res.json().catch(() => ({}));
}

export async function searchOpsRegistry(
  query: string,
): Promise<RegistrySearchHit[]> {
  const q = query.trim();
  const res = await opsApiFetch(
    `/api/admin/registry/search?q=${encodeURIComponent(q)}`,
  );
  const body = await readJson(res);
  if (!res.ok) {
    throw new Error(
      apiErrorMessage(body as ApiErrorBody, "Search failed", res.status),
    );
  }
  return parseRegistrySearchHits(body);
}

export async function fetchCanonicalConnectors(): Promise<
  CanonicalConnectorRow[]
> {
  const res = await opsApiFetch("/api/admin/registry/connectors");
  const body = await readJson(res);
  if (!res.ok) {
    throw new Error(
      apiErrorMessage(body as ApiErrorBody, "Registry failed", res.status),
    );
  }
  return parseCanonicalConnectors(body);
}

export async function promoteRegistryDomain(
  domain: string,
): Promise<CanonicalConnectorRow> {
  const res = await opsApiFetch("/api/admin/registry/promote", {
    method: "POST",
    body: JSON.stringify({ domain }),
  });
  const body = await readJson(res);
  if (!res.ok) {
    throw new Error(
      apiErrorMessage(body as ApiErrorBody, "Promote failed", res.status),
    );
  }
  const row = parseCanonicalConnectorRow(body);
  if (!row) {
    throw new Error("Promote failed");
  }
  return row;
}

export async function createCustomConnector(
  input: CustomConnectorInput,
): Promise<CanonicalConnectorRow> {
  const res = await opsApiFetch("/api/admin/registry/custom", {
    method: "POST",
    body: JSON.stringify(input),
  });
  const body = await readJson(res);
  if (!res.ok) {
    throw new Error(
      apiErrorMessage(body as ApiErrorBody, "Custom add failed", res.status),
    );
  }
  const row = parseCanonicalConnectorRow(body);
  if (!row) {
    throw new Error("Custom add failed");
  }
  return row;
}

export async function deleteCanonicalConnector(
  id: string,
): Promise<CanonicalConnectorRow> {
  const res = await opsApiFetch(
    `/api/admin/registry/connectors/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  const body = await readJson(res);
  if (!res.ok) {
    throw new Error(
      apiErrorMessage(body as ApiErrorBody, "Delete failed", res.status),
    );
  }
  const row = parseCanonicalConnectorRow(body);
  if (!row) {
    throw new Error("Delete failed");
  }
  return row;
}
