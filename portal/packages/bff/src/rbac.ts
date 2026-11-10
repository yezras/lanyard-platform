import {
  isVaultPathAllowed,
  normalizeVaultPath,
  projectToVaultRelativePath,
} from "@lanyard/shared";
import { HTTPException } from "hono/http-exception";

import type { UserRbac } from "./control-plane-client.js";
import type { SessionUser } from "./session.js";

/**
 * Explicit BFF host-settings permissions (lp-p37.7).
 *
 * - `settings.read` — redacted snapshot / health-check. Granted to any
 *   authenticated session user (data is already secret-redacted).
 * - `settings.manage` — PATCH skills / crons / MCP / active model. Granted to
 *   admin (role name or hermes_profile) or an explicit settings-manager role.
 */
export type SettingsPermission = "settings.read" | "settings.manage";

/** Role / profile labels that grant settings.manage without full admin. */
const EXPLICIT_SETTINGS_MANAGE_LABELS = new Set([
  "settings",
  "settings-admin",
  "settings.manage",
  "settings-manager",
  "settings_admin",
  "settings_manage",
]);

export function requireUserRbac(
  rbac: UserRbac | null,
): UserRbac {
  if (!rbac?.hermes_profile) {
    throw new HTTPException(403, {
      message: "No Hermes profile mapping for user",
    });
  }
  return rbac;
}

export type AssertVaultPathAccessOptions = {
  /**
   * When set (typically `VAULT_ROOT`), host paths under this root are stripped
   * to vault-root-relative form before ACL (lp-vnz.3). Safe for Brain RPC /
   * single-root FS; omit for multi-root absolute identity.
   */
  vaultRoot?: string | null;
  /**
   * When true, apply host→vault-relative projection (top-level strip + optional
   * vaultRoot). Defaults true so Brain RPC vault.read accepts agent host paths.
   */
  projectHostPaths?: boolean;
};

/**
 * Normalize a browser vault path for ACL + read (lp-vnz.3).
 * Projects host-absolute agent paths to vault-root-relative when they embed
 * known vault top-level folders or sit under `vaultRoot`.
 */
export function normalizeBrowserVaultPath(
  path: string,
  options: AssertVaultPathAccessOptions = {},
): string {
  const projectHostPaths = options.projectHostPaths !== false;
  const projected = projectHostPaths
    ? projectToVaultRelativePath(path, {
        vaultRoot: options.vaultRoot,
      })
    : path;
  return normalizeVaultPath(projected);
}

export function assertVaultPathAccess(
  rbac: UserRbac,
  path: string,
  options: AssertVaultPathAccessOptions = {},
): { path: string; allowed: true } {
  const normalized = normalizeBrowserVaultPath(path, options);
  if (!isVaultPathAllowed(rbac.allowed_path_prefixes, normalized)) {
    throw new HTTPException(403, {
      message: "Vault path not permitted for user role",
    });
  }
  return { path: normalized, allowed: true };
}

/** Tenant Portal admin (Connectors Team / role grants). Not ops cookie. */
export function isTenantAdmin(rbac: UserRbac | null): boolean {
  if (!rbac) {
    return false;
  }
  const names = (rbac.role_names ?? []).map((n) => n.trim().toLowerCase());
  const profile = (rbac.hermes_profile ?? "").trim().toLowerCase();
  return names.includes("admin") || profile === "admin";
}

/**
 * Whether RBAC grants host settings mutations (skills/crons/MCP/models).
 * Prefer admin; also honor explicit settings-manager role names/profiles so
 * tenants can delegate settings without full admin elevation.
 */
export function hasSettingsManagePermission(rbac: UserRbac | null): boolean {
  if (!rbac) {
    return false;
  }

  if (isTenantAdmin(rbac)) {
    return true;
  }

  const names = (rbac.role_names ?? []).map((n) => n.trim().toLowerCase());
  const profile = (rbac.hermes_profile ?? "").trim().toLowerCase();

  if (names.some((n) => EXPLICIT_SETTINGS_MANAGE_LABELS.has(n))) {
    return true;
  }
  if (EXPLICIT_SETTINGS_MANAGE_LABELS.has(profile)) {
    return true;
  }

  return false;
}

/**
 * Enforce a settings permission before any Brain RPC or local file fallback.
 *
 * Call after authentication middleware has populated `user` / `rbac`.
 * Fail closed: missing session → 401; manage without admin/settings → 403.
 */
export function assertSettingsPermission(
  permission: SettingsPermission,
  input: {
    user: SessionUser | null;
    rbac: UserRbac | null;
  },
): void {
  if (!input.user) {
    throw new HTTPException(401, { message: "Not authenticated" });
  }

  if (permission === "settings.read") {
    // Authenticated session is sufficient for redacted snapshot / health.
    return;
  }

  // settings.manage
  if (!hasSettingsManagePermission(input.rbac)) {
    throw new HTTPException(403, {
      message:
        "Settings mutation requires admin or explicit settings permission",
    });
  }
}
