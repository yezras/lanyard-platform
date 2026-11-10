import type { ControlPlaneAuthClient } from "./control-plane-client.js";
import type { BffBindings, TenantContext } from "./types.js";

/** True when BFF local dev bypass is active (`DEV_TENANT_SLUG` set). */
export function isLocalDevMode(bindings: BffBindings): boolean {
  return Boolean(bindings.devTenantSlug?.trim());
}

/** Demo tenant registrations in local dev should receive the seeded member role. */
export function shouldAutoAssignDemoMember(
  bindings: BffBindings,
  tenant: TenantContext,
): boolean {
  const devSlug = bindings.devTenantSlug?.trim().toLowerCase();
  return Boolean(devSlug && tenant.tenant_slug.toLowerCase() === devSlug);
}

export async function resolveDemoMemberRoleId(
  authClient: ControlPlaneAuthClient,
  tenantId: string,
  configuredRoleId?: string,
): Promise<string | undefined> {
  const explicit = configuredRoleId?.trim();
  if (explicit) {
    return explicit;
  }

  const response = await authClient.listRoles(tenantId);
  const member = response.roles.find((role) => role.name === "member");
  return member?.role_id;
}