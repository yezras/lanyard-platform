/**
 * Platform ops console client. Always bare `/api/admin/*`.
 * Never `/api/auth/me` (tenant) and never a tenant slug prefix.
 */

import { PLATFORM_ADMIN_API_PREFIX } from "@lanyard/shared";

import { apiFetch, resetCsrfToken } from "./client.js";
import { withApiBase } from "./tenantBase.js";

export type OpsOperator = {
  operator_id: string;
  email: string;
  plane: "ops";
};

export function parseOpsOperator(raw: unknown): OpsOperator | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (value.plane !== "ops") {
    return null;
  }
  if (typeof value.tenant_id === "string" && value.tenant_id.length > 0) {
    return null;
  }
  if (typeof value.tenantId === "string" && value.tenantId.length > 0) {
    return null;
  }
  if (
    typeof value.operator_id !== "string" ||
    !value.operator_id ||
    typeof value.email !== "string" ||
    !value.email
  ) {
    return null;
  }
  return {
    operator_id: value.operator_id,
    email: value.email,
    plane: "ops",
  };
}

export function opsAdminApiPath(suffix: string): string {
  const rest = suffix.startsWith("/") ? suffix : `/${suffix}`;
  return `${PLATFORM_ADMIN_API_PREFIX}${rest}`;
}

export function opsGoogleStartUrl(): string {
  return withApiBase(opsAdminApiPath("/auth/google"));
}

export async function fetchOpsMe(): Promise<OpsOperator | null> {
  const res = await fetch(withApiBase(opsAdminApiPath("/auth/me")), {
    credentials: "include",
  });
  if (!res.ok) {
    return null;
  }
  return parseOpsOperator(await res.json());
}

export async function logoutOps(): Promise<void> {
  const res = await apiFetch(opsAdminApiPath("/auth/logout"), { method: "POST" });
  resetCsrfToken();
  if (!res.ok) {
    throw new Error(`Ops logout failed (${res.status})`);
  }
}

export async function stubOpsGoogleLogin(email: string): Promise<OpsOperator> {
  const res = await apiFetch(opsAdminApiPath("/auth/google/stub"), {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(
      body.error ?? body.message ?? `Ops stub sign-in failed (${res.status})`,
    );
  }
  const operator = parseOpsOperator(await res.json());
  if (!operator) {
    throw new Error("Ops stub sign-in returned a non-ops session");
  }
  resetCsrfToken();
  return operator;
}

export function isLocalOpsFrontend(hostname: string): boolean {
  const host = hostname.toLowerCase().split(":")[0] ?? hostname;
  return host === "localhost" || host.endsWith(".localhost");
}
