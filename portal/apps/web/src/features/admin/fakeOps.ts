/**
 * In-memory FakeOps admin plane (lp-hdzm.30).
 *
 * One store. Requests parse at the HTTP edge; handlers mutate the store.
 * Playwright drives the real OpsConsole against this instead of BFF+CP.
 */

export type FakeOpsMode = "superadmin" | "tenant_admin" | "unauth";

export type FakeOpsSurfaceId = "mcp" | "api" | "cli";

export type FakeOpsTenant = {
  tenant_id: string;
  tenant_slug: string;
  display_name: string;
};

export type FakeOpsCanonical = {
  id: string;
  domain: string | null;
  label: string;
  source: string;
  source_entry_id: string | null;
  archived: boolean;
  snapshot: unknown;
};

export type FakeOpsSearchHit = {
  domain: string;
  name: string;
  description: string;
  kinds: Array<"mcp" | "openapi" | "graphql" | "cli">;
};

export type FakeOpsUser = {
  user_id: string;
  display_name: string;
  email: string;
  role: "tenant_admin" | "member";
  connectors: string[];
  last_active_at: string | null;
};

export type FakeOpsOnboard = {
  connector_id: string;
  surfaces: FakeOpsSurfaceId[];
};

export type FakeOpsGrant = {
  user_id: string;
  connector_id: string;
};

/** Fingerprint-only Class C row. The paste value is never stored. */
export type FakeOpsClassCSecret = {
  connector_id: string;
  surface_id: FakeOpsSurfaceId;
  fingerprint: string;
  rotated_at: string;
};

export type FakeOpsStore = {
  mode: FakeOpsMode;
  tenant: FakeOpsTenant;
  canonical: FakeOpsCanonical[];
  catalog: FakeOpsSearchHit[];
  onboarded: FakeOpsOnboard[];
  users: FakeOpsUser[];
  grants: FakeOpsGrant[];
  classCSecrets: FakeOpsClassCSecret[];
};

export type FakeOpsRequest = {
  method: string;
  pathname: string;
  search: URLSearchParams;
  body: unknown;
};

export type FakeOpsResponse = {
  status: number;
  body: unknown;
};

const CSRF = { csrf_token: "fakeops-csrf" };

export const MOCK_LAB: FakeOpsTenant = {
  tenant_id: "tenant-mocklab",
  tenant_slug: "mocklab",
  display_name: "Mock Lab",
};

export const RUNNABLE_MCP_SNAPSHOT = {
  runnability: "runnable",
  surfaces: [{ kind: "mcp", runnability: "runnable" }],
};

export const GOOGLE_CANONICAL: FakeOpsCanonical = {
  id: "google",
  domain: "google.com",
  label: "Google",
  source: "first_class",
  source_entry_id: null,
  archived: false,
  snapshot: {},
};

export const STRIPE_CANONICAL: FakeOpsCanonical = {
  id: "stripe",
  domain: "stripe.com",
  label: "Stripe",
  source: "integrations.sh",
  source_entry_id: "integrations.sh:stripe.com",
  archived: false,
  snapshot: RUNNABLE_MCP_SNAPSHOT,
};

export const STRIPE_HIT: FakeOpsSearchHit = {
  domain: "stripe.com",
  name: "Stripe",
  description: "Payments",
  kinds: ["mcp", "openapi", "cli"],
};

export const ADA_USER: FakeOpsUser = {
  user_id: "user-ada",
  display_name: "Ada Admin",
  email: "ada@mocklab.test",
  role: "tenant_admin",
  connectors: [],
  last_active_at: null,
};

const FIRST_CLASS_IDS = ["google", "hubspot", "whatsapp", "github"] as const;

const SURFACES: readonly FakeOpsSurfaceId[] = ["mcp", "api", "cli"];

export function createFakeOpsStore(mode: FakeOpsMode = "superadmin"): FakeOpsStore {
  const store: FakeOpsStore = {
    mode,
    tenant: { ...MOCK_LAB },
    canonical: [{ ...GOOGLE_CANONICAL }],
    catalog: [{ ...STRIPE_HIT }],
    onboarded: [],
    users: [{ ...ADA_USER, connectors: [] }],
    grants: [],
    classCSecrets: [],
  };
  if (mode === "tenant_admin") {
    store.canonical.push({ ...STRIPE_CANONICAL });
    store.onboarded.push({ connector_id: "stripe", surfaces: ["mcp"] });
  }
  return store;
}

function json(status: number, body: unknown): FakeOpsResponse {
  return { status, body };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function matchPath(
  pathname: string,
  pattern: string,
): Record<string, string> | null {
  const pathParts = pathname.split("/").filter(Boolean);
  const patParts = pattern.split("/").filter(Boolean);
  if (pathParts.length !== patParts.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (let i = 0; i < patParts.length; i += 1) {
    const pat = patParts[i]!;
    const val = pathParts[i]!;
    if (pat.startsWith(":")) {
      params[pat.slice(1)] = decodeURIComponent(val);
    } else if (pat !== val) {
      return null;
    }
  }
  return params;
}

function isSurface(value: unknown): value is FakeOpsSurfaceId {
  return typeof value === "string" && (SURFACES as readonly string[]).includes(value);
}

function fingerprintValue(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `sha256:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function classCStatusPayload(
  store: FakeOpsStore,
  connectorId: string,
): {
  tenant_id: string;
  connector_id: string;
  surfaces: Array<{
    tenant_id: string;
    connector_id: string;
    surface_id: FakeOpsSurfaceId;
    present: boolean;
    fingerprint: string | null;
    rotated_at: string | null;
  }>;
} {
  return {
    tenant_id: store.tenant.tenant_id,
    connector_id: connectorId,
    surfaces: SURFACES.map((surface_id) => {
      const row = store.classCSecrets.find(
        (secret) =>
          secret.connector_id === connectorId &&
          secret.surface_id === surface_id,
      );
      return {
        tenant_id: store.tenant.tenant_id,
        connector_id: connectorId,
        surface_id,
        present: Boolean(row),
        fingerprint: row?.fingerprint ?? null,
        rotated_at: row?.rotated_at ?? null,
      };
    }),
  };
}

function parseSurfaces(value: unknown): FakeOpsSurfaceId[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const surfaces: FakeOpsSurfaceId[] = [];
  for (const item of value) {
    if (isSurface(item) && !surfaces.includes(item)) {
      surfaces.push(item);
    }
  }
  return surfaces;
}

function authChips(surfaces: FakeOpsSurfaceId[]): string[] {
  const chips: string[] = [];
  if (surfaces.includes("mcp")) {
    chips.push("MCP");
  }
  if (surfaces.includes("api")) {
    chips.push("API key");
  }
  if (surfaces.includes("cli")) {
    chips.push("CLI");
  }
  return chips;
}

function canonicalRow(store: FakeOpsStore, row: FakeOpsCanonical) {
  const onboarded = store.onboarded.some((item) => item.connector_id === row.id)
    ? 1
    : 0;
  return {
    ...row,
    onboarded_tenant_count: onboarded,
  };
}

function connectorUsers(store: FakeOpsStore, connectorId: string) {
  return store.users.map((user) => ({
    user_id: user.user_id,
    display_name: user.display_name,
    email: user.email,
    role_label: user.role === "tenant_admin" ? "Admin" : "Member",
    granted: store.grants.some(
      (grant) =>
        grant.user_id === user.user_id && grant.connector_id === connectorId,
    ),
  }));
}

function onboardedPayload(store: FakeOpsStore) {
  return {
    tenant_id: store.tenant.tenant_id,
    connectors: store.onboarded.map((row) => {
      const canonical =
        store.canonical.find((item) => item.id === row.connector_id) ?? null;
      const grantCount = store.grants.filter(
        (grant) => grant.connector_id === row.connector_id,
      ).length;
      return {
        connector_id: row.connector_id,
        label: canonical?.label ?? row.connector_id,
        surfaces: row.surfaces,
        available_surfaces: row.surfaces.length > 0 ? row.surfaces : ["mcp"],
        status_counts: {
          connected: grantCount,
          pairing: 0,
          needs_reauth: 0,
        },
        auth_chips: authChips(row.surfaces),
      };
    }),
  };
}

function catalogPayload(store: FakeOpsStore) {
  return {
    tenants: [
      {
        tenant_id: store.tenant.tenant_id,
        tenant_slug: store.tenant.tenant_slug,
        display_name: store.tenant.display_name,
        connectors: FIRST_CLASS_IDS.map((connector_id) => ({
          connector_id,
          enabled: store.onboarded.some((row) => row.connector_id === connector_id),
          status_counts: { connected: 0, pairing: 0, needs_reauth: 0 },
        })),
      },
    ],
    totals: {},
  };
}

function requireTenant(store: FakeOpsStore, tenantId: string): FakeOpsResponse | null {
  if (tenantId !== store.tenant.tenant_id) {
    return json(404, { error: "Unknown tenant" });
  }
  return null;
}

function slugUserId(email: string): string {
  const slug = email.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `user-${slug || "member"}`;
}

type Handler = (
  store: FakeOpsStore,
  params: Record<string, string>,
  req: FakeOpsRequest,
) => FakeOpsResponse;

const ROUTES: Array<{ method: string; pattern: string; handle: Handler }> = [
  {
    method: "GET",
    pattern: "/api/auth/csrf",
    handle: () => json(200, CSRF),
  },
  {
    method: "GET",
    pattern: "/api/admin/auth/csrf",
    handle: () => json(200, CSRF),
  },
  {
    method: "GET",
    pattern: "/api/admin/auth/google",
    handle: () => json(503, { error: "Google sign-in is not configured" }),
  },
  {
    method: "GET",
    pattern: "/api/admin/auth/me",
    handle: (store) => {
      if (store.mode === "unauth") {
        return json(401, { error: "Not authenticated" });
      }
      return json(200, {
        operator_id: "op-ops@lanyard.local",
        email: "ops@lanyard.local",
        plane: "ops",
      });
    },
  },
  {
    method: "POST",
    pattern: "/api/admin/auth/google/stub",
    handle: (store, _params, req) => {
      const email = String(asRecord(req.body).email ?? "").trim().toLowerCase();
      if (store.mode === "unauth" || !email.endsWith("@lanyard.local")) {
        return json(403, {
          error: "This Google account is not an allowlisted platform operator",
        });
      }
      return json(200, {
        operator_id: `op-${email}`,
        email,
        plane: "ops",
        provider: "google",
      });
    },
  },
  {
    method: "POST",
    pattern: "/api/admin/auth/logout",
    handle: () => json(200, { ok: true }),
  },
  {
    method: "GET",
    pattern: "/api/admin/context",
    handle: (store) => {
      if (store.mode === "unauth") {
        return json(401, { error: "Not authenticated" });
      }
      if (store.mode === "tenant_admin") {
        return json(200, { role: "tenant_admin", tenant: store.tenant });
      }
      return json(200, { role: "superadmin" });
    },
  },
  {
    method: "GET",
    pattern: "/api/admin/tenants",
    handle: (store) => json(200, { tenants: [store.tenant] }),
  },
  {
    method: "GET",
    pattern: "/api/admin/connectors",
    handle: (store) => json(200, catalogPayload(store)),
  },
  {
    method: "GET",
    pattern: "/api/admin/registry/search",
    handle: (store, _params, req) => {
      const q = (req.search.get("q") ?? "").trim().toLowerCase();
      const results = store.catalog.filter(
        (hit) =>
          !q ||
          hit.domain.toLowerCase().includes(q) ||
          hit.name.toLowerCase().includes(q),
      );
      return json(200, { results });
    },
  },
  {
    method: "GET",
    pattern: "/api/admin/registry/connectors",
    handle: (store) =>
      json(200, {
        connectors: store.canonical.map((row) => canonicalRow(store, row)),
      }),
  },
  {
    method: "POST",
    pattern: "/api/admin/registry/promote",
    handle: (store, _params, req) => {
      const domain = String(asRecord(req.body).domain ?? "").trim().toLowerCase();
      const hit = store.catalog.find((row) => row.domain.toLowerCase() === domain);
      if (!hit) {
        return json(404, { error: "Unknown domain" });
      }
      const existing = store.canonical.find(
        (row) => (row.domain ?? "").toLowerCase() === domain,
      );
      if (existing) {
        return json(200, canonicalRow(store, existing));
      }
      const id = hit.domain.replace(/\.com$/, "").replace(/[^a-z0-9-]/g, "-");
      const row: FakeOpsCanonical = {
        id,
        domain: hit.domain,
        label: hit.name,
        source: "integrations.sh",
        source_entry_id: `integrations.sh:${hit.domain}`,
        archived: false,
        snapshot: RUNNABLE_MCP_SNAPSHOT,
      };
      store.canonical.push(row);
      return json(200, canonicalRow(store, row));
    },
  },
  {
    method: "GET",
    pattern: "/api/admin/tenants/:tenantId/connectors",
    handle: (store, params) =>
      requireTenant(store, params.tenantId!) ?? json(200, onboardedPayload(store)),
  },
  {
    method: "PUT",
    pattern: "/api/admin/tenants/:tenantId/connectors/:connectorId",
    handle: (store, params, req) => {
      const denied = requireTenant(store, params.tenantId!);
      if (denied) {
        return denied;
      }
      const connectorId = params.connectorId!;
      const surfaces = parseSurfaces(asRecord(req.body).surfaces);
      store.onboarded = store.onboarded.filter(
        (row) => row.connector_id !== connectorId,
      );
      if (surfaces.length > 0) {
        store.onboarded.push({ connector_id: connectorId, surfaces });
      } else {
        store.grants = store.grants.filter(
          (grant) => grant.connector_id !== connectorId,
        );
      }
      return json(200, {
        tenant_id: store.tenant.tenant_id,
        connector_id: connectorId,
        enabled: surfaces.length > 0,
        surfaces,
      });
    },
  },
  {
    method: "GET",
    pattern: "/api/admin/tenants/:tenantId/users",
    handle: (store, params) =>
      requireTenant(store, params.tenantId!) ?? json(200, { users: store.users }),
  },
  {
    method: "POST",
    pattern: "/api/admin/tenants/:tenantId/users",
    handle: (store, params, req) => {
      const denied = requireTenant(store, params.tenantId!);
      if (denied) {
        return denied;
      }
      const rec = asRecord(req.body);
      const display_name = String(rec.display_name ?? "").trim();
      const email = String(rec.email ?? "").trim().toLowerCase();
      const role = rec.role === "tenant_admin" ? "tenant_admin" : "member";
      if (!display_name || !email || !email.includes("@")) {
        return json(422, { error: "Invalid user" });
      }
      if (store.users.some((user) => user.email === email)) {
        return json(409, { error: "Email already on tenant" });
      }
      const user: FakeOpsUser = {
        user_id: slugUserId(email),
        display_name,
        email,
        role,
        connectors: [],
        last_active_at: null,
      };
      store.users.push(user);
      return json(201, user);
    },
  },
  {
    method: "GET",
    pattern: "/api/admin/tenants/:tenantId/connectors/:connectorId/users",
    handle: (store, params) =>
      requireTenant(store, params.tenantId!) ??
      json(200, { users: connectorUsers(store, params.connectorId!) }),
  },
  {
    method: "PUT",
    pattern: "/api/admin/tenants/:tenantId/connectors/:connectorId/users/:userId",
    handle: (store, params, req) => {
      const denied = requireTenant(store, params.tenantId!);
      if (denied) {
        return denied;
      }
      const connectorId = params.connectorId!;
      const userId = params.userId!;
      const granted = asRecord(req.body).granted === true;
      store.grants = store.grants.filter(
        (grant) =>
          !(grant.user_id === userId && grant.connector_id === connectorId),
      );
      if (granted) {
        store.grants.push({ user_id: userId, connector_id: connectorId });
      }
      const user = store.users.find((row) => row.user_id === userId);
      if (user) {
        user.connectors = store.grants
          .filter((grant) => grant.user_id === userId)
          .map((grant) => grant.connector_id);
      }
      return json(200, { granted });
    },
  },
  {
    method: "GET",
    pattern: "/api/admin/tenants/:tenantId/connectors/:connectorId/member-subset",
    handle: (store, params) =>
      requireTenant(store, params.tenantId!) ??
      json(200, {
        tenant_id: store.tenant.tenant_id,
        connector_id: params.connectorId,
        kind: "grant_only",
        tools: [],
        allowed_tools: [],
      }),
  },
  {
    method: "GET",
    pattern: "/api/admin/tenants/:tenantId/connectors/:connectorId/class-c-secrets",
    handle: (store, params) => {
      const denied = requireTenant(store, params.tenantId!);
      if (denied) {
        return denied;
      }
      const connectorId = params.connectorId!;
      if ((FIRST_CLASS_IDS as readonly string[]).includes(connectorId)) {
        return json(400, {
          error: `Class C is for registry connectors; ${connectorId} uses user-principal Class A`,
        });
      }
      return json(200, classCStatusPayload(store, connectorId));
    },
  },
  {
    method: "PUT",
    pattern:
      "/api/admin/tenants/:tenantId/connectors/:connectorId/class-c-secrets/:surfaceId",
    handle: (store, params, req) => {
      const denied = requireTenant(store, params.tenantId!);
      if (denied) {
        return denied;
      }
      const connectorId = params.connectorId!;
      if ((FIRST_CLASS_IDS as readonly string[]).includes(connectorId)) {
        return json(400, {
          error: `Class C is for registry connectors; ${connectorId} uses user-principal Class A`,
        });
      }
      const surfaceId = params.surfaceId!;
      if (!isSurface(surfaceId)) {
        return json(400, { error: "Unknown connector surface" });
      }
      const value = String(asRecord(req.body).value ?? "").trim();
      if (!value) {
        return json(400, { error: "Class C secret value must be a non-empty string" });
      }
      const fingerprint = fingerprintValue(value);
      const rotated_at = new Date().toISOString();
      store.classCSecrets = store.classCSecrets.filter(
        (row) =>
          !(
            row.connector_id === connectorId && row.surface_id === surfaceId
          ),
      );
      store.classCSecrets.push({
        connector_id: connectorId,
        surface_id: surfaceId,
        fingerprint,
        rotated_at,
      });
      return json(200, {
        tenant_id: store.tenant.tenant_id,
        connector_id: connectorId,
        surface_id: surfaceId,
        present: true,
        fingerprint,
        rotated_at,
      });
    },
  },
  {
    method: "DELETE",
    pattern:
      "/api/admin/tenants/:tenantId/connectors/:connectorId/class-c-secrets/:surfaceId",
    handle: (store, params) => {
      const denied = requireTenant(store, params.tenantId!);
      if (denied) {
        return denied;
      }
      const connectorId = params.connectorId!;
      const surfaceId = params.surfaceId!;
      if (!isSurface(surfaceId)) {
        return json(400, { error: "Unknown connector surface" });
      }
      const before = store.classCSecrets.length;
      store.classCSecrets = store.classCSecrets.filter(
        (row) =>
          !(
            row.connector_id === connectorId && row.surface_id === surfaceId
          ),
      );
      return json(200, {
        ok: true,
        deleted: store.classCSecrets.length < before,
      });
    },
  },
  {
    method: "GET",
    pattern: "/api/admin/tenants/:tenantId/secrets",
    handle: (store, params) =>
      requireTenant(store, params.tenantId!) ?? json(200, { slots: [] }),
  },
  {
    method: "GET",
    pattern: "/api/admin/tenants/:tenantId/instances",
    handle: (store, params) =>
      requireTenant(store, params.tenantId!) ?? json(200, { instances: [] }),
  },
  {
    method: "GET",
    pattern: "/api/admin/tenants/:tenantId/roles",
    handle: (store, params) =>
      requireTenant(store, params.tenantId!) ?? json(200, { roles: [] }),
  },
  {
    method: "GET",
    pattern: "/api/admin/tenants/:tenantId/audit",
    handle: (store, params) =>
      requireTenant(store, params.tenantId!) ?? json(200, { entries: [] }),
  },
];

export function handleFakeOpsRequest(
  store: FakeOpsStore,
  req: FakeOpsRequest,
): FakeOpsResponse | null {
  const method = req.method.toUpperCase();
  for (const route of ROUTES) {
    if (route.method !== method) {
      continue;
    }
    const params = matchPath(req.pathname, route.pattern);
    if (!params) {
      continue;
    }
    return route.handle(store, params, req);
  }
  if (req.pathname.startsWith("/api/admin/") || req.pathname === "/api/auth/csrf") {
    return json(404, { error: `FakeOps has no handler for ${method} ${req.pathname}` });
  }
  return null;
}
