/**
 * Tenant-scoped admin users and person grants (lp-hdzm.6).
 *
 * Home activity still has no CP source (501). Users and person grants
 * parse strictly — a malformed success payload throws.
 */

import { apiErrorMessage, opsApiFetch } from "./opsApi.js";
import { opsAdminApiPath } from "./opsAuth.js";
import { withApiBase } from "./tenantBase.js";

export type OpsTenantActivityEntry = {
  activity_id: string;
  message: string;
  created_at: string;
};

export type OpsTenantHome = {
  tenant_id: string;
  users_provisioned: number;
  activity: OpsTenantActivityEntry[];
};

export type OpsTenantUserRole = "tenant_admin" | "member";

export type OpsTenantUser = {
  user_id: string;
  display_name: string;
  email: string;
  role: OpsTenantUserRole;
  connectors: string[];
  last_active_at: string | null;
};

export type OpsConnectorUser = {
  user_id: string;
  display_name: string;
  email: string;
  role_label: string;
  granted: boolean;
};

type ApiErrorBody = { error?: string; message?: string };

async function opsAdminGet(path: string): Promise<unknown> {
  const res = await fetch(withApiBase(opsAdminApiPath(path)), {
    credentials: "include",
  });
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  if (!res.ok) {
    throw new Error(body.error ?? body.message ?? `Request failed (${res.status})`);
  }
  return body;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requireString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseActivityEntries(value: unknown): OpsTenantActivityEntry[] {
  if (!Array.isArray(value)) {
    throw new Error("Malformed tenant home activity");
  }
  return value.map((row) => {
    const rec = asRecord(row);
    const activity_id = requireString(rec.activity_id);
    const message = requireString(rec.message);
    const created_at = requireString(rec.created_at);
    if (!activity_id || !message || !created_at) {
      throw new Error("Malformed tenant home activity");
    }
    return { activity_id, message, created_at };
  });
}

export function parseOpsTenantHome(body: unknown): OpsTenantHome {
  const rec = asRecord(body);
  const tenant_id = requireString(rec.tenant_id);
  const rawUsers = rec.users_provisioned;
  const users_provisioned =
    typeof rawUsers === "number" && Number.isFinite(rawUsers) && rawUsers >= 0
      ? rawUsers
      : -1;
  if (!tenant_id || users_provisioned < 0) {
    throw new Error("Malformed tenant home");
  }
  return {
    tenant_id,
    users_provisioned,
    activity: parseActivityEntries(rec.activity),
  };
}

export async function fetchOpsTenantHome(tenantId: string): Promise<OpsTenantHome> {
  const body = await opsAdminGet(
    `/tenants/${encodeURIComponent(tenantId)}/home`,
  );
  return parseOpsTenantHome(body);
}

const TENANT_USER_ROLES: readonly OpsTenantUserRole[] = [
  "tenant_admin",
  "member",
];

function parseTenantUsers(value: unknown): OpsTenantUser[] {
  const rec = asRecord(value);
  if (!Array.isArray(rec.users)) {
    throw new Error("Malformed tenant users");
  }
  return rec.users.map((row) => {
    const user = asRecord(row);
    const user_id = requireString(user.user_id);
    const display_name = requireString(user.display_name);
    const email = requireString(user.email);
    const role = requireString(user.role) as OpsTenantUserRole;
    if (!user_id || !display_name || !email) {
      throw new Error("Malformed tenant users");
    }
    if (!TENANT_USER_ROLES.includes(role)) {
      throw new Error("Malformed tenant users");
    }
    if (!Array.isArray(user.connectors)) {
      throw new Error("Malformed tenant users");
    }
    return {
      user_id,
      display_name,
      email,
      role,
      connectors: user.connectors.filter(
        (id): id is string => typeof id === "string" && id.length > 0,
      ),
      last_active_at:
        typeof user.last_active_at === "string" && user.last_active_at
          ? user.last_active_at
          : null,
    };
  });
}

export async function fetchOpsTenantUsers(tenantId: string): Promise<OpsTenantUser[]> {
  const body = await opsAdminGet(
    `/tenants/${encodeURIComponent(tenantId)}/users`,
  );
  return parseTenantUsers(body);
}

function parseOpsTenantUser(body: unknown): OpsTenantUser {
  const users = parseTenantUsers({ users: [body] });
  const user = users[0];
  if (!user) {
    throw new Error("Malformed tenant user");
  }
  return user;
}

export async function createOpsTenantUser(input: {
  tenantId: string;
  displayName: string;
  email: string;
  role: OpsTenantUserRole;
}): Promise<OpsTenantUser> {
  const res = await opsApiFetch(
    opsAdminApiPath(`/tenants/${encodeURIComponent(input.tenantId)}/users`),
    {
      method: "POST",
      body: JSON.stringify({
        display_name: input.displayName,
        email: input.email,
        role: input.role,
      }),
    },
  );
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  if (!res.ok) {
    throw new Error(apiErrorMessage(body, "Add user failed", res.status));
  }
  return parseOpsTenantUser(body);
}

export async function updateOpsTenantUser(input: {
  tenantId: string;
  userId: string;
  displayName?: string;
  role?: OpsTenantUserRole;
}): Promise<OpsTenantUser> {
  const res = await opsApiFetch(
    opsAdminApiPath(
      `/tenants/${encodeURIComponent(input.tenantId)}/users/${encodeURIComponent(input.userId)}`,
    ),
    {
      method: "PATCH",
      body: JSON.stringify({
        display_name: input.displayName,
        role: input.role,
      }),
    },
  );
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  if (!res.ok) {
    throw new Error(apiErrorMessage(body, "Update user failed", res.status));
  }
  return parseOpsTenantUser(body);
}

export async function deleteOpsTenantUser(input: {
  tenantId: string;
  userId: string;
}): Promise<void> {
  const res = await opsApiFetch(
    opsAdminApiPath(
      `/tenants/${encodeURIComponent(input.tenantId)}/users/${encodeURIComponent(input.userId)}`,
    ),
    { method: "DELETE" },
  );
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  if (!res.ok) {
    throw new Error(apiErrorMessage(body, "Remove user failed", res.status));
  }
}

function parseConnectorUsers(value: unknown): OpsConnectorUser[] {
  const rec = asRecord(value);
  if (!Array.isArray(rec.users)) {
    throw new Error("Malformed connector users");
  }
  return rec.users.map((row) => {
    const user = asRecord(row);
    const user_id = requireString(user.user_id);
    const display_name = requireString(user.display_name);
    const email = requireString(user.email);
    const role_label = requireString(user.role_label);
    if (!user_id || !display_name || !email || !role_label) {
      throw new Error("Malformed connector users");
    }
    return {
      user_id,
      display_name,
      email,
      role_label,
      granted: user.granted === true,
    };
  });
}

export async function fetchOpsConnectorUsers(input: {
  tenantId: string;
  connectorId: string;
}): Promise<OpsConnectorUser[]> {
  const body = await opsAdminGet(
    `/tenants/${encodeURIComponent(input.tenantId)}/connectors/${encodeURIComponent(input.connectorId)}/users`,
  );
  return parseConnectorUsers(body);
}

export async function putOpsConnectorUserGrant(input: {
  tenantId: string;
  connectorId: string;
  userId: string;
  granted: boolean;
}): Promise<void> {
  const res = await opsApiFetch(
    opsAdminApiPath(
      `/tenants/${encodeURIComponent(input.tenantId)}/connectors/${encodeURIComponent(input.connectorId)}/users/${encodeURIComponent(input.userId)}`,
    ),
    {
      method: "PUT",
      body: JSON.stringify({ granted: input.granted }),
    },
  );
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  if (!res.ok) {
    throw new Error(apiErrorMessage(body, "Grant update failed", res.status));
  }
}

export const MEMBER_SUBSET_GROUPS = ["read", "write"] as const;
export type MemberSubsetGroup = (typeof MEMBER_SUBSET_GROUPS)[number];

export const MEMBER_SUBSET_KINDS = ["allowlist", "grant_only"] as const;
export type MemberSubsetKind = (typeof MEMBER_SUBSET_KINDS)[number];

export type MemberSubsetTool = {
  name: string;
  group: MemberSubsetGroup;
};

export type OpsMemberSubset = {
  tenant_id: string;
  connector_id: string;
  kind: MemberSubsetKind;
  tools: MemberSubsetTool[];
  allowed_tools: string[];
};

function isMemberSubsetGroup(value: unknown): value is MemberSubsetGroup {
  return (
    typeof value === "string" &&
    (MEMBER_SUBSET_GROUPS as readonly string[]).includes(value)
  );
}

function isMemberSubsetKind(value: unknown): value is MemberSubsetKind {
  return (
    typeof value === "string" &&
    (MEMBER_SUBSET_KINDS as readonly string[]).includes(value)
  );
}

export function parseOpsMemberSubset(body: unknown): OpsMemberSubset {
  const rec = asRecord(body);
  const tenant_id = requireString(rec.tenant_id);
  const connector_id = requireString(rec.connector_id);
  const kind = rec.kind;
  if (!tenant_id || !connector_id || !isMemberSubsetKind(kind)) {
    throw new Error("Malformed member subset");
  }
  if (!Array.isArray(rec.tools) || !Array.isArray(rec.allowed_tools)) {
    throw new Error("Malformed member subset");
  }
  const tools: MemberSubsetTool[] = rec.tools.map((row) => {
    const tool = asRecord(row);
    const name = requireString(tool.name);
    if (!name || !isMemberSubsetGroup(tool.group)) {
      throw new Error("Malformed member subset");
    }
    return { name, group: tool.group };
  });
  const allowed_tools = rec.allowed_tools.filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  return { tenant_id, connector_id, kind, tools, allowed_tools };
}

export async function fetchOpsMemberSubset(input: {
  tenantId: string;
  connectorId: string;
}): Promise<OpsMemberSubset> {
  const body = await opsAdminGet(
    `/tenants/${encodeURIComponent(input.tenantId)}/connectors/${encodeURIComponent(input.connectorId)}/member-subset`,
  );
  return parseOpsMemberSubset(body);
}

export async function putOpsMemberSubset(input: {
  tenantId: string;
  connectorId: string;
  allowedTools: string[];
}): Promise<OpsMemberSubset> {
  const res = await opsApiFetch(
    opsAdminApiPath(
      `/tenants/${encodeURIComponent(input.tenantId)}/connectors/${encodeURIComponent(input.connectorId)}/member-subset`,
    ),
    {
      method: "PUT",
      body: JSON.stringify({ allowed_tools: input.allowedTools }),
    },
  );
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  if (!res.ok) {
    throw new Error(apiErrorMessage(body, "Member subset update failed", res.status));
  }
  return parseOpsMemberSubset(body);
}
