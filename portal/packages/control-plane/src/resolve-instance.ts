/**
 * Resolve tenant+user → instance_id (lp-oop.18 / plan 0015 phase 5).
 *
 * Pure lookup. Does not wake, create, or talk to Daytona. Wake stays
 * `ensureOnline(instance_id)` via POST …/users/:userId/ensure-online
 * (lp-oop.19). User-scope instance wins when
 * present; else tenant primary; else fail closed.
 *
 * Records are 0010-shaped fixtures. This module does not migrate
 * `gateway_instances` (that is lp-zoh.2).
 */

export const INSTANCE_SCOPES = ["tenant", "user"] as const;

export type InstanceScope = (typeof INSTANCE_SCOPES)[number];

/** Chat / toolbox routing key. One sandbox per concurrent user, not per chat. */
export type SandboxKey = {
  tenant_id: string;
  user_id: string;
};

/**
 * 0010-shaped instance row used by the resolver.
 * Not a DB column set — callers pass fixtures or a later store adapter.
 */
export type ScopedInstanceRecord = {
  instance_id: string;
  tenant_id: string;
  scope: InstanceScope;
  /** Required when scope=user; null when scope=tenant. */
  owner_user_id: string | null;
  /** Tenant fallback candidate. Ignored on scope=user. */
  is_primary: boolean;
  revoked_at: string | null;
};

export type ResolveInstanceSource = "user" | "tenant_primary";

export type ResolveInstanceIdOk = {
  ok: true;
  instance_id: string;
  source: ResolveInstanceSource;
};

export type ResolveInstanceIdErr = {
  ok: false;
  code: "invalid_key" | "no_instance";
  /** 4xx for the HTTP leaf (lp-oop.19). */
  httpStatus: 400 | 404;
  message: string;
};

export type ResolveInstanceIdResult = ResolveInstanceIdOk | ResolveInstanceIdErr;

export class InvalidSandboxKeyError extends Error {
  readonly code = "invalid_key";
  readonly httpStatus = 400 as const;

  constructor(message: string) {
    super(message);
    this.name = "InvalidSandboxKeyError";
  }
}

export class NoResolvableInstanceError extends Error {
  readonly code = "no_instance";
  readonly httpStatus = 404 as const;
  readonly tenant_id: string;
  readonly user_id: string;

  constructor(tenant_id: string, user_id: string) {
    super(
      `No user instance or tenant primary for tenant ${tenant_id} user ${user_id}`,
    );
    this.name = "NoResolvableInstanceError";
    this.tenant_id = tenant_id;
    this.user_id = user_id;
  }
}

export function isInstanceScope(value: unknown): value is InstanceScope {
  return value === "tenant" || value === "user";
}

export function parseSandboxKey(input: {
  tenant_id: unknown;
  user_id: unknown;
}): SandboxKey | null {
  if (typeof input.tenant_id !== "string" || typeof input.user_id !== "string") {
    return null;
  }
  const tenant_id = input.tenant_id.trim();
  const user_id = input.user_id.trim();
  if (!tenant_id || !user_id) {
    return null;
  }
  return { tenant_id, user_id };
}

/** Today's single-instance-per-tenant row as a tenant-primary fixture. */
export function tenantPrimaryRecord(input: {
  instance_id: string;
  tenant_id: string;
  revoked_at?: string | null;
  /** lp-zoh.2: real flag from gateway_instances; defaults true (fixture). */
  is_primary?: boolean;
}): ScopedInstanceRecord {
  return {
    instance_id: input.instance_id,
    tenant_id: input.tenant_id,
    scope: "tenant",
    owner_user_id: null,
    is_primary: input.is_primary ?? true,
    revoked_at: input.revoked_at ?? null,
  };
}

/** 0010 user-scope fixture. Does not provision or wake. */
export function userScopeRecord(input: {
  instance_id: string;
  tenant_id: string;
  owner_user_id: string;
  revoked_at?: string | null;
  /** lp-zoh.2: real flag from gateway_instances; defaults false (fixture). */
  is_primary?: boolean;
}): ScopedInstanceRecord {
  return {
    instance_id: input.instance_id,
    tenant_id: input.tenant_id,
    scope: "user",
    owner_user_id: input.owner_user_id,
    is_primary: input.is_primary ?? false,
    revoked_at: input.revoked_at ?? null,
  };
}

function isActive(record: ScopedInstanceRecord): boolean {
  return record.revoked_at == null;
}

function isUsableUserRecord(
  record: ScopedInstanceRecord,
  tenant_id: string,
  user_id: string,
): boolean {
  return (
    isActive(record) &&
    record.scope === "user" &&
    record.tenant_id === tenant_id &&
    record.owner_user_id === user_id &&
    record.instance_id.trim().length > 0
  );
}

function isUsableTenantPrimary(
  record: ScopedInstanceRecord,
  tenant_id: string,
): boolean {
  return (
    isActive(record) &&
    record.scope === "tenant" &&
    record.is_primary &&
    record.tenant_id === tenant_id &&
    record.owner_user_id == null &&
    record.instance_id.trim().length > 0
  );
}

/**
 * Resolve `instance_id` for a sandbox key.
 *
 * Preference: active `scope=user` for (tenant, user), else active tenant
 * primary. Does not call ensureOnline or Daytona.
 */
export function resolveInstanceIdForUser(
  key: SandboxKey,
  instances: readonly ScopedInstanceRecord[],
): ResolveInstanceIdResult {
  const parsed = parseSandboxKey(key);
  if (!parsed) {
    return {
      ok: false,
      code: "invalid_key",
      httpStatus: 400,
      message: "SandboxKey requires non-empty tenant_id and user_id",
    };
  }

  const userRow = instances.find((row) =>
    isUsableUserRecord(row, parsed.tenant_id, parsed.user_id),
  );
  if (userRow) {
    return {
      ok: true,
      instance_id: userRow.instance_id,
      source: "user",
    };
  }

  const primary = instances.find((row) =>
    isUsableTenantPrimary(row, parsed.tenant_id),
  );
  if (primary) {
    return {
      ok: true,
      instance_id: primary.instance_id,
      source: "tenant_primary",
    };
  }

  return {
    ok: false,
    code: "no_instance",
    httpStatus: 404,
    message: `No user instance or tenant primary for tenant ${parsed.tenant_id} user ${parsed.user_id}`,
  };
}

/** Same as {@link resolveInstanceIdForUser} but throws typed errors. */
export function requireInstanceIdForUser(
  key: SandboxKey,
  instances: readonly ScopedInstanceRecord[],
): ResolveInstanceIdOk {
  const result = resolveInstanceIdForUser(key, instances);
  if (result.ok) {
    return result;
  }
  if (result.code === "invalid_key") {
    throw new InvalidSandboxKeyError(result.message);
  }
  throw new NoResolvableInstanceError(key.tenant_id.trim(), key.user_id.trim());
}
