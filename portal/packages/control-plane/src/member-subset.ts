/**
 * Member subset: tool-name allowlist on (tenant, connector) (lp-hdzm.23).
 *
 * Person grant is a different table. This allowlist is not per-user.
 * First-class CLIs are grant on/off only. Unclassified tools are omitted.
 * Admins who are granted skip the allowlist.
 */
import {
  isFirstClassConnectorId,
  parseConnectorId,
  type ConnectorId,
} from "./connectors.js";
import { parseCompiledSnapshot } from "./connector-registry.js";
import { type SqlClient } from "./db.js";
import { listOpenApiToolsIgnoringCap } from "./openapi-adapter.js";
import type { AuditAction, OpsTenantUserRole } from "./types.js";

export const MEMBER_SUBSET_GROUPS = ["read", "write"] as const;
export type MemberSubsetGroup = (typeof MEMBER_SUBSET_GROUPS)[number];

export const MEMBER_SUBSET_KINDS = ["allowlist", "grant_only"] as const;
export type MemberSubsetKind = (typeof MEMBER_SUBSET_KINDS)[number];

export type ClassifiedMemberTool = {
  name: string;
  group: MemberSubsetGroup;
};

export type ConnectorMemberSubset = {
  tenant_id: string;
  connector_id: ConnectorId;
  kind: MemberSubsetKind;
  tools: ClassifiedMemberTool[];
  allowed_tools: string[];
};

type AuditRecorder = (input: {
  tenant_id: string | null;
  action: AuditAction;
  actor: string | null;
  metadata: Record<string, unknown>;
}) => Promise<void> | void;

export class InvalidMemberSubsetError extends Error {
  readonly code = "INVALID_MEMBER_SUBSET";

  constructor(message: string) {
    super(message);
    this.name = "InvalidMemberSubsetError";
  }
}

export function memberSubsetKindForConnector(id: string): MemberSubsetKind {
  return isFirstClassConnectorId(id) ? "grant_only" : "allowlist";
}

export function parseToolName(value: string): string {
  const name = value.trim();
  if (!name || name.length > 128 || /\s/.test(name)) {
    throw new InvalidMemberSubsetError(`Invalid tool name: ${value}`);
  }
  return name;
}

export function parseAllowedToolNames(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new InvalidMemberSubsetError("allowed_tools must be an array");
  }
  const names: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new InvalidMemberSubsetError("allowed_tools must be tool names");
    }
    const name = parseToolName(item);
    if (!names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

const READ_NAME =
  /^(get|list|search|read|fetch|find|retrieve|describe|lookup|show)([A-Z_].*)?$/i;
const WRITE_NAME =
  /^(create|update|delete|post|put|patch|send|write|insert|remove|set|add)([A-Z_].*)?$/i;

export function classifyMcpToolName(name: string): MemberSubsetGroup | null {
  if (READ_NAME.test(name)) {
    return "read";
  }
  if (WRITE_NAME.test(name)) {
    return "write";
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function classifyOpenApiSpec(spec: unknown): ClassifiedMemberTool[] {
  try {
    const tools = listOpenApiToolsIgnoringCap(spec);
    const classified: ClassifiedMemberTool[] = [];
    for (const tool of tools) {
      const group: MemberSubsetGroup = tool.method === "get" ? "read" : "write";
      if (!classified.some((row) => row.name === tool.name)) {
        classified.push({ name: tool.name, group });
      }
    }
    return classified;
  } catch {
    return [];
  }
}

function classifyMcpTools(value: unknown): ClassifiedMemberTool[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const classified: ClassifiedMemberTool[] = [];
  for (const item of value) {
    const rec = asRecord(item);
    const raw = rec && typeof rec.name === "string" ? rec.name : "";
    let name: string;
    try {
      name = parseToolName(raw);
    } catch {
      continue;
    }
    const group = classifyMcpToolName(name);
    if (!group) {
      continue;
    }
    if (!classified.some((row) => row.name === name)) {
      classified.push({ name, group });
    }
  }
  return classified;
}

export function classifySnapshotTools(snapshot: unknown): ClassifiedMemberTool[] {
  try {
    const parsed = parseCompiledSnapshot(snapshot);
    const classified: ClassifiedMemberTool[] = [];
    for (const surface of parsed.surfaces) {
      if (surface.runnability !== "runnable") {
        continue;
      }
      if (surface.kind === "openapi" && surface.spec) {
        for (const tool of classifyOpenApiSpec(surface.spec)) {
          if (!classified.some((item) => item.name === tool.name)) {
            classified.push(tool);
          }
        }
        continue;
      }
      if (surface.kind === "mcp") {
        for (const tool of classifyMcpTools(surface.tools)) {
          if (!classified.some((item) => item.name === tool.name)) {
            classified.push(tool);
          }
        }
      }
    }
    return classified;
  } catch {
    return [];
  }
}

export function personMayCallTool(input: {
  onboarded: boolean;
  granted: boolean;
  role: OpsTenantUserRole;
  subsetKind: MemberSubsetKind;
  toolName: string;
  allowlist: readonly string[];
}): boolean {
  if (!input.onboarded || !input.granted) {
    return false;
  }
  if (input.subsetKind === "grant_only") {
    return true;
  }
  if (input.role === "tenant_admin") {
    return true;
  }
  return input.allowlist.includes(input.toolName);
}

function parseStoredToolNames(value: string | null): string[] {
  if (!value) {
    return [];
  }
  try {
    return parseAllowedToolNames(JSON.parse(value) as unknown);
  } catch {
    return [];
  }
}

function intersectAllowed(
  stored: string[],
  tools: ClassifiedMemberTool[],
): string[] {
  const names = new Set(tools.map((tool) => tool.name));
  return stored.filter((name) => names.has(name));
}

export async function getConnectorMemberSubset(
  db: SqlClient,
  tenant_id: string,
  connector_id_raw: string,
  snapshot: unknown,
): Promise<ConnectorMemberSubset> {
  const connector_id = await parseConnectorId(db, connector_id_raw);
  const kind = memberSubsetKindForConnector(connector_id);
  const tools =
    kind === "grant_only" ? [] : classifySnapshotTools(snapshot);
  const row = await db.get<{ tool_names_json: string | null }>(
    `SELECT tool_names_json
     FROM connector_member_subsets
     WHERE tenant_id = ? AND connector_id = ?`,
    [tenant_id, connector_id],
  );
  const allowed_tools =
    kind === "grant_only"
      ? []
      : intersectAllowed(parseStoredToolNames(row?.tool_names_json ?? null), tools);
  return {
    tenant_id,
    connector_id,
    kind,
    tools,
    allowed_tools,
  };
}

export async function setConnectorMemberSubset(
  db: SqlClient,
  recordAudit: AuditRecorder,
  input: {
    tenant_id: string;
    connector_id: string;
    allowed_tools: unknown;
    snapshot: unknown;
    actor?: string | null;
  },
): Promise<ConnectorMemberSubset> {
  const connector_id = await parseConnectorId(db, input.connector_id);
  const kind = memberSubsetKindForConnector(connector_id);
  if (kind === "grant_only") {
    throw new InvalidMemberSubsetError(
      "First-class connectors are grant on/off only",
    );
  }
  const tools = classifySnapshotTools(input.snapshot);
  const allowed = parseAllowedToolNames(input.allowed_tools);
  const classified = new Set(tools.map((tool) => tool.name));
  for (const name of allowed) {
    if (!classified.has(name)) {
      throw new InvalidMemberSubsetError(`Unknown tool: ${name}`);
    }
  }
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO connector_member_subsets
       (tenant_id, connector_id, tool_names_json, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (tenant_id, connector_id) DO UPDATE SET
       tool_names_json = EXCLUDED.tool_names_json,
       updated_at = EXCLUDED.updated_at`,
    [input.tenant_id, connector_id, JSON.stringify(allowed), now],
  );
  await recordAudit({
    tenant_id: input.tenant_id,
    action: "connector.member_subset_set",
    actor: input.actor ?? null,
    metadata: {
      connector_id,
      allowed_tools: allowed,
    },
  });
  return {
    tenant_id: input.tenant_id,
    connector_id,
    kind,
    tools,
    allowed_tools: allowed,
  };
}
