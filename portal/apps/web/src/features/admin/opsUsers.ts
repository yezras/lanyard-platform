/**
 * Users page domain (lp-hdzm.22).
 *
 * Admin|Member lives on the user row. Last tenant admin cannot be removed.
 * Add-user draft is display name + email + role. No invited.
 */

import type { OpsTenantUser, OpsTenantUserRole } from "../../api/opsTenantAdmin.js";

export type AddUserDraft = {
  displayName: string;
  email: string;
  role: OpsTenantUserRole;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function tenantAdminCount(
  users: readonly Pick<OpsTenantUser, "role">[],
): number {
  return users.filter((user) => user.role === "tenant_admin").length;
}

export function isLastTenantAdmin(
  users: readonly Pick<OpsTenantUser, "role" | "user_id">[],
  userId: string,
): boolean {
  const user = users.find((row) => row.user_id === userId);
  if (!user || user.role !== "tenant_admin") {
    return false;
  }
  return tenantAdminCount(users) <= 1;
}

export function parseAddUserDraft(draft: AddUserDraft): AddUserDraft | null {
  const displayName = draft.displayName.trim();
  const email = draft.email.trim().toLowerCase();
  if (!displayName || !EMAIL_RE.test(email)) {
    return null;
  }
  return { displayName, email, role: draft.role };
}

export function connectorsAfterGrant(
  connectors: readonly string[],
  connectorId: string,
  granted: boolean,
): string[] {
  if (granted) {
    return connectors.includes(connectorId)
      ? [...connectors]
      : [...connectors, connectorId];
  }
  return connectors.filter((id) => id !== connectorId);
}
