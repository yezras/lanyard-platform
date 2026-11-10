/**
 * Tenant Portal connector SPA DTOs and session gates (lp-xhf4.3).
 *
 * Browser never talks to CP. These types are the allowlisted JSON the BFF
 * returns: status, account_label, sticky, grants. Ciphertext stays on CP.
 */
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";

import {
  CONNECTOR_IDS,
  type ConnectorAccess,
  type ConnectorConnectionPublic,
  type ConnectorId,
  type ConnectionStatus,
  type GrantedConnectorAccess,
  type RoleConnectorGrant,
  type TenantRole,
  type UserRbac,
} from "./control-plane-client.js";
import { CONNECTOR_SLUG_RE } from "./registry-snapshot.js";
import { isTenantAdmin } from "./rbac.js";
import { readOpsSessionId, type SessionUser } from "./session.js";
import type { BffVariables } from "./types.js";

export { CONNECTOR_IDS };
export type { ConnectorId, ConnectionStatus };

export const OAUTH_CONNECTOR_IDS = ["google", "hubspot"] as const;
export type OauthConnectorId = (typeof OAUTH_CONNECTOR_IDS)[number];

/** Keys that must never appear on SPA connector JSON. */
export const CONNECTOR_SPA_FORBIDDEN_KEYS = [
  "secrets_ciphertext",
  "ciphertext",
  "secrets",
  "oauth_access",
  "oauth_refresh",
  "oauth_expiry",
  "oauth_scopes",
  "whatsapp_session_db",
  "access_token",
  "refresh_token",
  "pkce",
  "code_verifier",
  "session.db",
] as const;

export const FIRST_CLASS_CONNECTOR_LABELS: Record<
  (typeof CONNECTOR_IDS)[number],
  string
> = {
  google: "Google",
  hubspot: "HubSpot",
  whatsapp: "WhatsApp",
  github: "GitHub",
};

export function connectorLabel(id: string, fallback?: string | null): string {
  if (id in FIRST_CLASS_CONNECTOR_LABELS) {
    return FIRST_CLASS_CONNECTOR_LABELS[id as (typeof CONNECTOR_IDS)[number]];
  }
  const fromCanonical = fallback?.trim();
  if (fromCanonical) {
    return fromCanonical;
  }
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export type SpaConnectorStatus = {
  connector_id: string;
  label: string;
  status: ConnectionStatus;
  account_label: string | null;
  sticky: Record<string, true>;
  entitled: boolean;
  role_granted: boolean;
  hubspot_portal_id: string | null;
};

export type SpaTeamMemberConnector = {
  connector_id: ConnectorId;
  status: ConnectionStatus;
  account_label: string | null;
  sticky: Record<string, true>;
};

export type SpaTeamMember = {
  user_id: string;
  email: string;
  connectors: SpaTeamMemberConnector[];
};

export type SpaRoleConnectorGrant = {
  role_id: string;
  role_name: string;
  connector_id: ConnectorId;
  enabled: boolean;
};

/** Tenant HubSpot pin for admin Team display. Never a token. */
export type SpaHubSpotPin = {
  hubspot_portal_id: string | null;
};

export type SpaConnectorsTeam = {
  members: SpaTeamMember[];
  grants: SpaRoleConnectorGrant[];
  hubspot_portal_id: string | null;
};

export type ConnectorCaller = {
  user: SessionUser;
  rbac: UserRbac | null;
};

type ConnectorContext = Context<{ Variables: BffVariables }>;

export function isConnectorId(value: string): value is ConnectorId {
  return CONNECTOR_SLUG_RE.test(value);
}

export function parseConnectorId(value: string): ConnectorId {
  if (!CONNECTOR_SLUG_RE.test(value)) {
    throw new HTTPException(400, { message: "Unknown connector" });
  }
  return value as ConnectorId;
}

export function isOauthConnectorId(value: string): value is OauthConnectorId {
  return (OAUTH_CONNECTOR_IDS as readonly string[]).includes(value);
}

function stickyFlags(
  sticky: ConnectorConnectionPublic["sticky"] | undefined,
): Record<string, true> {
  if (!sticky || typeof sticky !== "object") {
    return {};
  }
  const out: Record<string, true> = {};
  for (const [key, flag] of Object.entries(sticky)) {
    if (flag === true) {
      out[key] = true;
    }
  }
  return out;
}

export function toSpaConnectorStatus(
  access: ConnectorAccess | GrantedConnectorAccess,
): SpaConnectorStatus {
  const connection = access.connection;
  const label =
    "label" in access
      ? connectorLabel(access.connector_id, access.label)
      : connectorLabel(access.connector_id);
  return {
    connector_id: access.connector_id,
    label,
    status: connection?.status ?? "not_connected",
    account_label: connection?.account_label ?? null,
    sticky: stickyFlags(connection?.sticky),
    entitled: Boolean(access.entitled),
    role_granted: Boolean(access.role_granted),
    hubspot_portal_id: connection?.hubspot_portal_id ?? null,
  };
}

export function toSpaTeamMemberConnector(
  connectorId: ConnectorId,
  connection: ConnectorConnectionPublic | null,
): SpaTeamMemberConnector {
  return {
    connector_id: connectorId,
    status: connection?.status ?? "not_connected",
    account_label: connection?.account_label ?? null,
    sticky: stickyFlags(connection?.sticky),
  };
}

export function hubspotPinFromEntitlements(
  entitlements: Array<{
    connector_id: string;
    hubspot_portal_id: string | null;
  }>,
): string | null {
  const hubspot = entitlements.find((row) => row.connector_id === "hubspot");
  const pin = hubspot?.hubspot_portal_id;
  return typeof pin === "string" && pin !== "" ? pin : null;
}

export function teamGrantMatrix(
  roles: TenantRole[],
  grantsByRole: Map<string, RoleConnectorGrant[]>,
): SpaRoleConnectorGrant[] {
  const rows: SpaRoleConnectorGrant[] = [];
  for (const role of roles) {
    const existing = new Map(
      (grantsByRole.get(role.role_id) ?? []).map((g) => [g.connector_id, g]),
    );
    for (const connectorId of CONNECTOR_IDS) {
      rows.push({
        role_id: role.role_id,
        role_name: role.name,
        connector_id: connectorId,
        enabled: existing.get(connectorId)?.enabled === true,
      });
    }
  }
  return rows;
}

export function assertConnectorSpaJson(value: unknown): void {
  if (value == null || typeof value !== "object") {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      assertConnectorSpaJson(item);
    }
    return;
  }
  const rec = value as Record<string, unknown>;
  for (const key of CONNECTOR_SPA_FORBIDDEN_KEYS) {
    if (key in rec) {
      throw new Error(`connector SPA JSON leaked ${key}`);
    }
  }
  for (const child of Object.values(rec)) {
    if (child && typeof child === "object") {
      assertConnectorSpaJson(child);
    }
  }
}

/**
 * Ops cookie on a tenant connector route is unauthenticated, not 403.
 * Same collapse as a missing or wrong-tenant session (no existence leak).
 */
export function requireConnectorTenantUser(c: ConnectorContext): SessionUser {
  if (readOpsSessionId(c)) {
    throw new HTTPException(401, { message: "Not authenticated" });
  }
  const user = c.get("user");
  if (!user) {
    throw new HTTPException(401, { message: "Not authenticated" });
  }
  return user;
}

export function requireConnectorAdmin(c: ConnectorContext): ConnectorCaller {
  const user = requireConnectorTenantUser(c);
  const rbac = c.get("rbac");
  if (!isTenantAdmin(rbac)) {
    throw new HTTPException(403, {
      message: "Connector grants require tenant admin",
    });
  }
  return { user, rbac };
}

export function connectorOAuthStartState(input: {
  connectorId: OauthConnectorId;
  tenantId: string;
  userId: string;
  threadId?: string;
  redirectUri?: string;
  codeVerifier?: string;
}): Record<string, string> {
  const state: Record<string, string> = {
    kind: "connector_oauth",
    connector_id: input.connectorId,
    tenant_id: input.tenantId,
    user_id: input.userId,
    thread_id: input.threadId ?? "",
  };
  if (input.redirectUri) {
    state.redirect_uri = input.redirectUri;
  }
  if (input.codeVerifier) {
    state.code_verifier = input.codeVerifier;
  }
  return state;
}

export function connectorOAuthStartUrl(
  connectorId: OauthConnectorId,
  state: string,
): string {
  const params = new URLSearchParams({ state });
  return `/api/connectors/${connectorId}/oauth/callback?${params.toString()}`;
}
