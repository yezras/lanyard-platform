/**
 * Platform ops admin list APIs (lp-2qs.5): tenants, gateway instances,
 * roles, audit. Always bare `/api/admin/*` via BFF — never a CP host.
 * Read-only GET surfaces; tenant cookies are unauthenticated here.
 */

import { opsAdminApiPath } from "./opsAuth.js";
import { withApiBase } from "./tenantBase.js";

export type OpsTenantSummary = {
  tenant_id: string;
  tenant_slug: string;
  display_name: string;
};

export type OpsGatewayInstance = {
  instance_id: string;
  created_at: string;
  label: string | null;
  health_status: string;
  runtime_kind: string;
  presence: string;
  sandbox_id: string | null;
  revoked_at: string | null;
  last_activity_at: string | null;
};

export type OpsRole = {
  role_id: string;
  name: string;
  hermes_profile: string;
  path_prefixes: string[];
  created_at: string;
};

export type OpsAuditEntry = {
  audit_id: string;
  action: string;
  actor: string | null;
  result: string;
  created_at: string;
  instance_id: string | null;
};

type ApiErrorBody = { error?: string; message?: string };

async function opsAdminGet<T>(path: string, parse: (body: unknown) => T): Promise<T> {
  const res = await fetch(withApiBase(opsAdminApiPath(path)), {
    credentials: "include",
  });
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  if (!res.ok) {
    throw new Error(body.error ?? body.message ?? `Request failed (${res.status})`);
  }
  return parse(body);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function parseOpsTenants(body: unknown): OpsTenantSummary[] {
  const rec = asRecord(body);
  if (!Array.isArray(rec.tenants)) {
    return [];
  }
  return rec.tenants
    .map(asRecord)
    .filter(
      (row) =>
        typeof row.tenant_id === "string" &&
        row.tenant_id &&
        typeof row.tenant_slug === "string" &&
        row.tenant_slug &&
        typeof row.display_name === "string",
    )
    .map((row) => ({
      tenant_id: row.tenant_id as string,
      tenant_slug: row.tenant_slug as string,
      display_name: row.display_name as string,
    }));
}

export function parseOpsInstances(body: unknown): OpsGatewayInstance[] {
  const rec = asRecord(body);
  if (!Array.isArray(rec.instances)) {
    return [];
  }
  return rec.instances
    .map(asRecord)
    .filter((row) => typeof row.instance_id === "string" && row.instance_id)
    .map((row) => ({
      instance_id: row.instance_id as string,
      created_at: stringOrEmpty(row.created_at),
      label: optionalString(row.label),
      health_status: stringOrEmpty(row.health_status),
      runtime_kind: stringOrEmpty(row.runtime_kind),
      presence: stringOrEmpty(row.presence),
      sandbox_id: optionalString(row.sandbox_id),
      revoked_at: optionalString(row.revoked_at),
      last_activity_at: optionalString(row.last_activity_at),
    }));
}

export function parseOpsRoles(body: unknown): OpsRole[] {
  const rec = asRecord(body);
  if (!Array.isArray(rec.roles)) {
    return [];
  }
  return rec.roles
    .map(asRecord)
    .filter(
      (row) =>
        typeof row.role_id === "string" &&
        row.role_id &&
        typeof row.name === "string",
    )
    .map((row) => ({
      role_id: row.role_id as string,
      name: row.name as string,
      hermes_profile: stringOrEmpty(row.hermes_profile),
      path_prefixes: Array.isArray(row.path_prefixes)
        ? row.path_prefixes.filter(
            (prefix): prefix is string => typeof prefix === "string",
          )
        : [],
      created_at: stringOrEmpty(row.created_at),
    }));
}

export function parseOpsAuditEntries(body: unknown): OpsAuditEntry[] {
  const rec = asRecord(body);
  if (!Array.isArray(rec.entries)) {
    return [];
  }
  return rec.entries
    .map(asRecord)
    .filter(
      (row) =>
        typeof row.audit_id === "string" &&
        row.audit_id &&
        typeof row.action === "string",
    )
    .map((row) => ({
      audit_id: row.audit_id as string,
      action: row.action as string,
      actor: optionalString(row.actor),
      result: stringOrEmpty(row.result),
      created_at: stringOrEmpty(row.created_at),
      instance_id: optionalString(row.instance_id),
    }));
}

export function fetchOpsTenants(): Promise<OpsTenantSummary[]> {
  return opsAdminGet("/tenants", parseOpsTenants);
}

export function fetchOpsTenantInstances(
  tenantId: string,
): Promise<OpsGatewayInstance[]> {
  return opsAdminGet(
    `/tenants/${encodeURIComponent(tenantId)}/instances`,
    parseOpsInstances,
  );
}

export function fetchOpsTenantRoles(tenantId: string): Promise<OpsRole[]> {
  return opsAdminGet(
    `/tenants/${encodeURIComponent(tenantId)}/roles`,
    parseOpsRoles,
  );
}

export function fetchOpsTenantAudit(tenantId: string): Promise<OpsAuditEntry[]> {
  return opsAdminGet(
    `/tenants/${encodeURIComponent(tenantId)}/audit`,
    parseOpsAuditEntries,
  );
}
