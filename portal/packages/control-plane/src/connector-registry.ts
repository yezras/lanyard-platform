/**
 * Canonical connector registry writes (lp-hdzm.19).
 *
 * Promote/custom insert compiled snapshots. Delete archives the id so it
 * stays reserved. GraphQL is not a stored surface kind.
 */
import { isUniqueViolation, type SqlClient } from "./db.js";
import {
  CONNECTOR_ID_PATTERN,
  FIRST_CLASS_CONNECTOR_IDS,
  InvalidConnectorIdError,
  connectorIdFromRow,
  isConnectorId,
  type ConnectorId,
} from "./connectors.js";

export const REGISTRY_SOURCES = ["seeded", "integrations.sh", "custom"] as const;
export type RegistrySource = (typeof REGISTRY_SOURCES)[number];

export const COMPILED_SURFACE_KINDS = ["mcp", "openapi", "cli"] as const;
export type CompiledSurfaceKind = (typeof COMPILED_SURFACE_KINDS)[number];

export const RUNNABILITY = ["runnable", "not_runnable"] as const;
export type Runnability = (typeof RUNNABILITY)[number];

export const RESERVED_CONNECTOR_IDS = [
  ...FIRST_CLASS_CONNECTOR_IDS,
  "registry",
  "admin",
  "gmail",
] as const;

export type CompiledSurface = {
  kind: CompiledSurfaceKind;
  slug: string;
  label: string;
  runnability: Runnability;
  initialize_url?: string;
  transport?: "streamable-http";
  auth_kind?: string;
  spec?: Record<string, unknown>;
  argv?: string[];
  reason?: string;
  tools?: { name: string }[];
};

export type CompiledSnapshot = {
  version: 1;
  source: "integrations.sh" | "custom";
  domain: string | null;
  compiled_at: string;
  runnability: Runnability;
  surfaces: CompiledSurface[];
  credential_recipes?: unknown;
};

export type CanonicalConnector = {
  id: ConnectorId;
  domain: string | null;
  label: string;
  archived: boolean;
  seeded: boolean;
  source: RegistrySource;
  source_entry_id: string | null;
  snapshot: CompiledSnapshot | Record<string, never>;
  onboarded_tenant_count: number;
  created_at: string;
};

export type InsertCanonicalConnectorInput = {
  id: string;
  domain?: string | null;
  label: string;
  source: "integrations.sh" | "custom";
  source_entry_id?: string | null;
  snapshot: CompiledSnapshot;
  actor?: string | null;
};

type AuditRecorder = (input: {
  tenant_id: string | null;
  action: "connector.canonical_upserted" | "connector.canonical_archived";
  actor: string | null;
  metadata: Record<string, unknown>;
}) => Promise<void> | void;

export class ConnectorRegistryConflictError extends Error {
  readonly code = "CONNECTOR_REGISTRY_CONFLICT";
  readonly reason: "alias" | "reserved" | "collision";

  constructor(reason: "alias" | "reserved" | "collision", message: string) {
    super(message);
    this.name = "ConnectorRegistryConflictError";
    this.reason = reason;
  }
}

export class ConnectorOnboardedError extends Error {
  readonly code = "CONNECTOR_ONBOARDED";

  constructor(id: ConnectorId) {
    super(`Connector is onboarded: ${id}`);
    this.name = "ConnectorOnboardedError";
  }
}

export class InvalidRegistrySnapshotError extends Error {
  readonly code = "INVALID_REGISTRY_SNAPSHOT";

  constructor(message: string) {
    super(message);
    this.name = "InvalidRegistrySnapshotError";
  }
}

export class CanonicalConnectorNotFoundError extends Error {
  readonly code = "CANONICAL_CONNECTOR_NOT_FOUND";

  constructor(id: string) {
    super(`Canonical connector not found: ${id}`);
    this.name = "CanonicalConnectorNotFoundError";
  }
}

export function isReservedConnectorId(value: string): boolean {
  return (RESERVED_CONNECTOR_IDS as readonly string[]).includes(value);
}

export function domainMatchesAlias(domain: string, alias: string): boolean {
  const haystack = domain.trim().toLowerCase();
  const needle = alias.trim().toLowerCase();
  if (needle.startsWith("*.")) {
    const suffix = needle.slice(1);
    return haystack.endsWith(suffix) || haystack === needle.slice(2);
  }
  return haystack === needle;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function isCompiledKind(value: unknown): value is CompiledSurfaceKind {
  return (
    typeof value === "string" &&
    (COMPILED_SURFACE_KINDS as readonly string[]).includes(value)
  );
}

function isRunnability(value: unknown): value is Runnability {
  return (
    typeof value === "string" &&
    (RUNNABILITY as readonly string[]).includes(value)
  );
}

export function parseCompiledSnapshot(value: unknown): CompiledSnapshot {
  const rec = asRecord(value);
  if (!rec) {
    throw new InvalidRegistrySnapshotError("snapshot must be an object");
  }
  if (rec.version !== 1) {
    throw new InvalidRegistrySnapshotError("snapshot.version must be 1");
  }
  if (rec.source !== "integrations.sh" && rec.source !== "custom") {
    throw new InvalidRegistrySnapshotError("snapshot.source is invalid");
  }
  if (!isRunnability(rec.runnability)) {
    throw new InvalidRegistrySnapshotError("snapshot.runnability is invalid");
  }
  if (typeof rec.compiled_at !== "string" || !rec.compiled_at) {
    throw new InvalidRegistrySnapshotError("snapshot.compiled_at is required");
  }
  if (!Array.isArray(rec.surfaces)) {
    throw new InvalidRegistrySnapshotError("snapshot.surfaces must be an array");
  }
  const surfaces: CompiledSurface[] = [];
  for (const [index, row] of rec.surfaces.entries()) {
    const surface = asRecord(row);
    if (!surface) {
      throw new InvalidRegistrySnapshotError(`surface ${index} is not an object`);
    }
    if (surface.kind === "graphql") {
      throw new InvalidRegistrySnapshotError("GraphQL is not supported");
    }
    if (!isCompiledKind(surface.kind)) {
      throw new InvalidRegistrySnapshotError(`surface ${index} has invalid kind`);
    }
    if (!isRunnability(surface.runnability)) {
      throw new InvalidRegistrySnapshotError(
        `surface ${index} has invalid runnability`,
      );
    }
    if (typeof surface.slug !== "string" || typeof surface.label !== "string") {
      throw new InvalidRegistrySnapshotError(
        `surface ${index} needs slug and label`,
      );
    }
    const compiled: CompiledSurface = {
      kind: surface.kind,
      slug: surface.slug,
      label: surface.label,
      runnability: surface.runnability,
    };
    if (typeof surface.initialize_url === "string") {
      compiled.initialize_url = surface.initialize_url;
    }
    if (surface.transport === "streamable-http") {
      compiled.transport = "streamable-http";
    }
    if (typeof surface.auth_kind === "string") {
      compiled.auth_kind = surface.auth_kind;
    }
    const spec = asRecord(surface.spec);
    if (spec) {
      compiled.spec = spec;
    }
    if (
      Array.isArray(surface.argv) &&
      surface.argv.every((part) => typeof part === "string")
    ) {
      compiled.argv = surface.argv;
    }
    if (typeof surface.reason === "string") {
      compiled.reason = surface.reason;
    }
    if (Array.isArray(surface.tools)) {
      const tools: { name: string }[] = [];
      for (const item of surface.tools) {
        const tool = asRecord(item);
        if (tool && typeof tool.name === "string" && tool.name.trim()) {
          tools.push({ name: tool.name.trim() });
        }
      }
      if (tools.length > 0) {
        compiled.tools = tools;
      }
    }
    surfaces.push(compiled);
  }
  const snapshot: CompiledSnapshot = {
    version: 1,
    source: rec.source,
    domain: typeof rec.domain === "string" ? rec.domain : null,
    compiled_at: rec.compiled_at,
    runnability: rec.runnability,
    surfaces,
  };
  if (rec.credential_recipes !== undefined) {
    snapshot.credential_recipes = rec.credential_recipes;
  }
  return snapshot;
}

type CanonicalRow = {
  id: string;
  domain: string | null;
  label: string;
  archived: number | boolean;
  seeded: number | boolean;
  source: string;
  source_entry_id: string | null;
  snapshot: unknown;
  onboarded_tenant_count: number | string;
  created_at: string;
};

function mapRow(row: CanonicalRow): CanonicalConnector {
  const source = (REGISTRY_SOURCES as readonly string[]).includes(row.source)
    ? (row.source as RegistrySource)
    : "seeded";
  let snapshot: CanonicalConnector["snapshot"] = {};
  if (row.snapshot && typeof row.snapshot === "object") {
    try {
      snapshot = parseCompiledSnapshot(row.snapshot);
    } catch {
      snapshot = {};
    }
  }
  return {
    id: connectorIdFromRow(row.id),
    domain: row.domain,
    label: row.label,
    archived: Boolean(row.archived),
    seeded: Boolean(row.seeded),
    source,
    source_entry_id: row.source_entry_id,
    snapshot,
    onboarded_tenant_count: Number(row.onboarded_tenant_count) || 0,
    created_at: row.created_at,
  };
}

const SELECT_CANONICAL = `
  SELECT c.id, c.domain, c.label, c.archived, c.seeded, c.source,
         c.source_entry_id, c.snapshot, c.created_at,
         COALESCE(o.n, 0)::text AS onboarded_tenant_count
    FROM canonical_connectors c
    LEFT JOIN (
      SELECT connector_id, COUNT(*)::int AS n
        FROM tenant_connector_entitlements
       WHERE enabled = 1
       GROUP BY connector_id
    ) o ON o.connector_id = c.id
`;

export async function listCanonicalConnectors(
  db: SqlClient,
  options: { includeArchived?: boolean } = {},
): Promise<CanonicalConnector[]> {
  const sql = options.includeArchived
    ? `${SELECT_CANONICAL} ORDER BY c.id`
    : `${SELECT_CANONICAL} WHERE c.archived = 0 ORDER BY c.id`;
  const rows = await db.all<CanonicalRow>(sql);
  return rows.map(mapRow);
}

export async function getCanonicalConnector(
  db: SqlClient,
  id: string,
  options: { includeArchived?: boolean } = {},
): Promise<CanonicalConnector | null> {
  const sql = options.includeArchived
    ? `${SELECT_CANONICAL} WHERE c.id = ?`
    : `${SELECT_CANONICAL} WHERE c.id = ? AND c.archived = 0`;
  const row = await db.get<CanonicalRow>(sql, [id]);
  return row ? mapRow(row) : null;
}

export async function lookupCanonicalAlias(
  db: SqlClient,
  domain: string,
): Promise<{ alias: string; connector_id: ConnectorId } | null> {
  const aliases = await db.all<{ alias: string; connector_id: string }>(
    `SELECT alias, connector_id FROM canonical_connector_aliases`,
  );
  const hit = aliases.find((row) => domainMatchesAlias(domain, row.alias));
  if (!hit) {
    return null;
  }
  return { alias: hit.alias, connector_id: connectorIdFromRow(hit.connector_id) };
}

export async function insertCanonicalConnector(
  db: SqlClient,
  recordAudit: AuditRecorder,
  input: InsertCanonicalConnectorInput,
): Promise<CanonicalConnector> {
  if (!isConnectorId(input.id)) {
    throw new InvalidConnectorIdError(input.id);
  }
  const snapshot = parseCompiledSnapshot(input.snapshot);
  if (snapshot.source !== input.source) {
    throw new InvalidRegistrySnapshotError("snapshot.source must match source");
  }

  if (input.domain) {
    const alias = await lookupCanonicalAlias(db, input.domain);
    if (alias) {
      throw new ConnectorRegistryConflictError(
        "alias",
        `Domain is a first-class alias: ${input.domain}`,
      );
    }
  }
  if (isReservedConnectorId(input.id)) {
    throw new ConnectorRegistryConflictError(
      "reserved",
      `Connector id is reserved: ${input.id}`,
    );
  }

  const existing = await getCanonicalConnector(db, input.id, {
    includeArchived: true,
  });
  if (existing) {
    throw new ConnectorRegistryConflictError(
      "collision",
      `Connector id already exists: ${input.id}`,
    );
  }

  const created_at = new Date().toISOString();
  const source_entry_id = input.source_entry_id ?? null;
  try {
    await db.run(
      `INSERT INTO canonical_connectors
         (id, domain, label, archived, seeded, source, source_entry_id, snapshot, created_at)
       VALUES (?, ?, ?, 0, 0, ?, ?, ?::jsonb, ?)`,
      [
        input.id,
        input.domain ?? null,
        input.label,
        input.source,
        source_entry_id,
        JSON.stringify(snapshot),
        created_at,
      ],
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConnectorRegistryConflictError(
        "collision",
        `Connector id already exists: ${input.id}`,
      );
    }
    throw error;
  }

  await recordAudit({
    tenant_id: null,
    action: "connector.canonical_upserted",
    actor: input.actor ?? null,
    metadata: {
      connector_id: input.id,
      source: input.source,
      domain: input.domain ?? null,
      runnability: snapshot.runnability,
    },
  });

  const row = await getCanonicalConnector(db, input.id, { includeArchived: true });
  if (!row) {
    throw new CanonicalConnectorNotFoundError(input.id);
  }
  return row;
}

export async function archiveCanonicalConnector(
  db: SqlClient,
  recordAudit: AuditRecorder,
  input: { id: string; actor?: string | null },
): Promise<CanonicalConnector> {
  if (!CONNECTOR_ID_PATTERN.test(input.id)) {
    throw new InvalidConnectorIdError(input.id);
  }
  const existing = await getCanonicalConnector(db, input.id, {
    includeArchived: true,
  });
  if (!existing) {
    throw new CanonicalConnectorNotFoundError(input.id);
  }
  if (existing.onboarded_tenant_count > 0) {
    throw new ConnectorOnboardedError(existing.id);
  }
  if (existing.archived) {
    return existing;
  }
  await db.run(
    `UPDATE canonical_connectors SET archived = 1 WHERE id = ?`,
    [input.id],
  );
  await recordAudit({
    tenant_id: null,
    action: "connector.canonical_archived",
    actor: input.actor ?? null,
    metadata: { connector_id: input.id },
  });
  const row = await getCanonicalConnector(db, input.id, { includeArchived: true });
  if (!row) {
    throw new CanonicalConnectorNotFoundError(input.id);
  }
  return row;
}
