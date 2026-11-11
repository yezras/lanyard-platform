/**
 * Mock Lab Stripe 6-tuple (lp-hdzm.31 / 0018.31).
 *
 * Locked in docs/plans/0018-admin-tenant-workspace/decision-locked.md:
 * domain stripe.com; one surface (remote MCP XOR pinned OpenAPI); tenant
 * principal; API key / bearer; one read tool; superadmin paste.
 */
import {
  CLASS_C_AUTH_KINDS,
  parseClassCAuthKind,
  type ClassCAuthKind,
  type ConnectorSurfaceId,
} from "./class-c-secrets.js";
import type { ConnectorId } from "./connectors.js";
import type { CompiledSnapshot, CompiledSurface } from "./connector-registry.js";
import type { MemberSubsetGroup } from "./member-subset.js";

export const MOCK_LAB_STRIPE_DOMAIN = "stripe.com" as const;
export const MOCK_LAB_STRIPE_CONNECTOR_ID = "stripe" as const;
export const MOCK_LAB_TENANT_SLUG = "mocklab" as const;
export const MOCK_LAB_STRIPE_PRINCIPAL = "tenant" as const;
export const MOCK_LAB_STRIPE_PASTE = "superadmin" as const;

export const MOCK_LAB_STRIPE_OPENAPI_TOOL = {
  name: "GetCustomers",
  method: "GET",
  path: "/v1/customers",
  group: "read",
} as const;

export const MOCK_LAB_STRIPE_MCP_TOOL = {
  name: "get_stripe_account_info",
  group: "read",
} as const;

export type MockLabStripeOpenApiSurface = {
  kind: "openapi";
  surface_id: "api";
  tool: typeof MOCK_LAB_STRIPE_OPENAPI_TOOL;
};

export type MockLabStripeMcpSurface = {
  kind: "mcp";
  surface_id: "mcp";
  tool: typeof MOCK_LAB_STRIPE_MCP_TOOL;
};

export type MockLabStripeSurface =
  | MockLabStripeOpenApiSurface
  | MockLabStripeMcpSurface;

export type MockLabStripeSixTuple = {
  domain: typeof MOCK_LAB_STRIPE_DOMAIN;
  connector_id: typeof MOCK_LAB_STRIPE_CONNECTOR_ID;
  tenant_slug: typeof MOCK_LAB_TENANT_SLUG;
  principal: typeof MOCK_LAB_STRIPE_PRINCIPAL;
  auth_kind: ClassCAuthKind;
  paste: typeof MOCK_LAB_STRIPE_PASTE;
  surface: MockLabStripeSurface;
};

export const MOCK_LAB_STRIPE_OPENAPI_SIX_TUPLE: MockLabStripeSixTuple = {
  domain: MOCK_LAB_STRIPE_DOMAIN,
  connector_id: MOCK_LAB_STRIPE_CONNECTOR_ID,
  tenant_slug: MOCK_LAB_TENANT_SLUG,
  principal: MOCK_LAB_STRIPE_PRINCIPAL,
  auth_kind: "bearer",
  paste: MOCK_LAB_STRIPE_PASTE,
  surface: {
    kind: "openapi",
    surface_id: "api",
    tool: MOCK_LAB_STRIPE_OPENAPI_TOOL,
  },
};

/** Pinned OpenAPI fragment: the 6-tuple read plus one extra GET for omit. */
export const MOCK_LAB_STRIPE_OPENAPI_SPEC: Record<string, unknown> = {
  openapi: "3.0.0",
  info: { title: "Stripe", version: "1" },
  servers: [{ url: "https://api.stripe.com" }],
  paths: {
    "/v1/customers": {
      get: {
        operationId: "GetCustomers",
        summary: "List customers",
        parameters: [
          {
            name: "limit",
            in: "query",
            schema: { type: "integer" },
          },
        ],
        responses: { "200": { description: "ok" } },
      },
    },
    "/v1/account": {
      get: {
        operationId: "GetAccount",
        summary: "Retrieve account",
        responses: { "200": { description: "ok" } },
      },
    },
  },
};

export class MockLabStripeSixTupleError extends Error {
  readonly code = "MOCK_LAB_STRIPE_SIX_TUPLE" as const;

  constructor(message: string) {
    super(message);
    this.name = "MockLabStripeSixTupleError";
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseOpenApiSurface(rec: Record<string, unknown>): MockLabStripeOpenApiSurface {
  if (rec.kind !== "openapi") {
    throw new MockLabStripeSixTupleError("openapi surface.kind must be openapi");
  }
  if (rec.surface_id !== "api") {
    throw new MockLabStripeSixTupleError("openapi surface_id must be api");
  }
  const tool = asRecord(rec.tool);
  if (
    !tool ||
    tool.name !== MOCK_LAB_STRIPE_OPENAPI_TOOL.name ||
    tool.method !== MOCK_LAB_STRIPE_OPENAPI_TOOL.method ||
    tool.path !== MOCK_LAB_STRIPE_OPENAPI_TOOL.path ||
    tool.group !== MOCK_LAB_STRIPE_OPENAPI_TOOL.group
  ) {
    throw new MockLabStripeSixTupleError(
      "openapi tool must be GET /v1/customers (GetCustomers)",
    );
  }
  return {
    kind: "openapi",
    surface_id: "api",
    tool: MOCK_LAB_STRIPE_OPENAPI_TOOL,
  };
}

function parseMcpSurface(rec: Record<string, unknown>): MockLabStripeMcpSurface {
  if (rec.kind !== "mcp") {
    throw new MockLabStripeSixTupleError("mcp surface.kind must be mcp");
  }
  if (rec.surface_id !== "mcp") {
    throw new MockLabStripeSixTupleError("mcp surface_id must be mcp");
  }
  const tool = asRecord(rec.tool);
  if (
    !tool ||
    tool.name !== MOCK_LAB_STRIPE_MCP_TOOL.name ||
    tool.group !== MOCK_LAB_STRIPE_MCP_TOOL.group
  ) {
    throw new MockLabStripeSixTupleError(
      "mcp tool must be get_stripe_account_info",
    );
  }
  return {
    kind: "mcp",
    surface_id: "mcp",
    tool: MOCK_LAB_STRIPE_MCP_TOOL,
  };
}

export function parseMockLabStripeSurface(
  value: unknown,
): MockLabStripeSurface {
  const rec = asRecord(value);
  if (!rec) {
    throw new MockLabStripeSixTupleError("surface must be an object");
  }
  if (rec.kind === "openapi") {
    return parseOpenApiSurface(rec);
  }
  if (rec.kind === "mcp") {
    return parseMcpSurface(rec);
  }
  throw new MockLabStripeSixTupleError(
    "surface must be remote MCP or pinned OpenAPI, not both",
  );
}

export function parseMockLabStripeSixTuple(value: unknown): MockLabStripeSixTuple {
  const rec = asRecord(value);
  if (!rec) {
    throw new MockLabStripeSixTupleError("6-tuple must be an object");
  }
  if (rec.domain !== MOCK_LAB_STRIPE_DOMAIN) {
    throw new MockLabStripeSixTupleError("domain must be stripe.com");
  }
  if (rec.connector_id !== MOCK_LAB_STRIPE_CONNECTOR_ID) {
    throw new MockLabStripeSixTupleError("connector_id must be stripe");
  }
  if (rec.tenant_slug !== MOCK_LAB_TENANT_SLUG) {
    throw new MockLabStripeSixTupleError("tenant_slug must be mocklab");
  }
  if (rec.principal !== MOCK_LAB_STRIPE_PRINCIPAL) {
    throw new MockLabStripeSixTupleError("principal must be tenant");
  }
  if (rec.paste !== MOCK_LAB_STRIPE_PASTE) {
    throw new MockLabStripeSixTupleError("paste must be superadmin");
  }
  let auth_kind: ClassCAuthKind;
  try {
    auth_kind = parseClassCAuthKind(rec.auth_kind);
  } catch {
    throw new MockLabStripeSixTupleError(
      `auth_kind must be ${CLASS_C_AUTH_KINDS.join(" | ")}`,
    );
  }
  return {
    domain: MOCK_LAB_STRIPE_DOMAIN,
    connector_id: MOCK_LAB_STRIPE_CONNECTOR_ID,
    tenant_slug: MOCK_LAB_TENANT_SLUG,
    principal: MOCK_LAB_STRIPE_PRINCIPAL,
    auth_kind,
    paste: MOCK_LAB_STRIPE_PASTE,
    surface: parseMockLabStripeSurface(rec.surface),
  };
}

export function mockLabStripeConnectorId(): ConnectorId {
  return MOCK_LAB_STRIPE_CONNECTOR_ID as ConnectorId;
}

export function surfaceIdForTuple(
  tuple: MockLabStripeSixTuple,
): ConnectorSurfaceId {
  return tuple.surface.surface_id;
}

function isRemoteKind(kind: CompiledSurface["kind"]): boolean {
  return kind === "openapi" || kind === "mcp";
}

/** One runnable remote surface. MCP XOR OpenAPI. GraphQL already illegal. */
export function assertOneRemoteSurface(
  snapshot: CompiledSnapshot,
): CompiledSurface {
  const remote = snapshot.surfaces.filter(
    (surface) => surface.runnability === "runnable" && isRemoteKind(surface.kind),
  );
  if (remote.length !== 1) {
    throw new MockLabStripeSixTupleError(
      `expected one remote surface, got ${remote.length}`,
    );
  }
  const surface = remote[0]!;
  const mcp = remote.some((row) => row.kind === "mcp");
  const openapi = remote.some((row) => row.kind === "openapi");
  if (mcp && openapi) {
    throw new MockLabStripeSixTupleError("MCP and OpenAPI cannot both be present");
  }
  return surface;
}

export function mockLabStripeOpenApiSnapshot(
  compiledAt = "2026-08-27T00:00:00.000Z",
): CompiledSnapshot {
  const snapshot: CompiledSnapshot = {
    version: 1,
    source: "integrations.sh",
    domain: MOCK_LAB_STRIPE_DOMAIN,
    compiled_at: compiledAt,
    runnability: "runnable",
    surfaces: [
      {
        kind: "openapi",
        slug: "api",
        label: "API",
        runnability: "runnable",
        spec: structuredClone(MOCK_LAB_STRIPE_OPENAPI_SPEC),
      },
    ],
  };
  assertOneRemoteSurface(snapshot);
  return snapshot;
}

export function publicSixTuple(tuple: MockLabStripeSixTuple): {
  domain: string;
  connector_id: string;
  tenant_slug: string;
  principal: string;
  auth_kind: ClassCAuthKind;
  paste: string;
  surface: MockLabStripeSurface["kind"];
  surface_id: ConnectorSurfaceId;
  tool: string;
  group: MemberSubsetGroup;
} {
  return {
    domain: tuple.domain,
    connector_id: tuple.connector_id,
    tenant_slug: tuple.tenant_slug,
    principal: tuple.principal,
    auth_kind: tuple.auth_kind,
    paste: tuple.paste,
    surface: tuple.surface.kind,
    surface_id: tuple.surface.surface_id,
    tool:
      tuple.surface.kind === "openapi"
        ? `${tuple.surface.tool.method} ${tuple.surface.tool.path}`
        : tuple.surface.tool.name,
    group: tuple.surface.tool.group,
  };
}
