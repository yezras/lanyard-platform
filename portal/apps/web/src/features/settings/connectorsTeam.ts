/**
 * Tenant admin Connectors Team pane (lp-xhf4.5).
 *
 * Domain is a (role × connector) grant matrix plus per-user status labels.
 * Tokens, session.db, and impersonation Disconnect are unrepresentable here.
 */
import {
  CONNECTION_STATUSES,
  CONNECTOR_IDS,
  CONNECTOR_LABELS,
  connectionStatusLabel,
  type ConnectionStatus,
  type ConnectorId,
} from "./connectorsCatalog.js";

export type SpaTeamMemberConnector = {
  connector_id: ConnectorId;
  status: ConnectionStatus;
  account_label: string | null;
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

export type ConnectorsTeamResponse = {
  members: SpaTeamMember[];
  grants: SpaRoleConnectorGrant[];
  hubspot_portal_id: string | null;
};

export type RoleGrantRow = {
  role_id: string;
  role_name: string;
  grants: Record<ConnectorId, boolean>;
};

export type TeamMemberStatusCell = {
  connector_id: ConnectorId;
  label: string;
  status: ConnectionStatus;
  status_label: string;
  account_label: string | null;
};

export type TeamMemberStatusRow = {
  user_id: string;
  email: string;
  cells: TeamMemberStatusCell[];
};

export type ConnectorsTeamModel = {
  roles: RoleGrantRow[];
  members: TeamMemberStatusRow[];
  hubspot_portal_id: string | null;
};

const FORBIDDEN_TEAM_KEYS = [
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

function isConnectorId(value: unknown): value is ConnectorId {
  return (
    typeof value === "string" &&
    (CONNECTOR_IDS as readonly string[]).includes(value)
  );
}

function isConnectionStatus(value: unknown): value is ConnectionStatus {
  return (
    typeof value === "string" &&
    (CONNECTION_STATUSES as readonly string[]).includes(value)
  );
}

function parseTeamMemberConnector(
  value: unknown,
): SpaTeamMemberConnector | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const rec = value as Record<string, unknown>;
  if (!isConnectorId(rec.connector_id)) {
    return null;
  }
  return {
    connector_id: rec.connector_id,
    status: isConnectionStatus(rec.status) ? rec.status : "not_connected",
    account_label:
      typeof rec.account_label === "string" ? rec.account_label : null,
  };
}

function parseTeamMember(value: unknown): SpaTeamMember | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const rec = value as Record<string, unknown>;
  if (typeof rec.user_id !== "string" || rec.user_id.trim() === "") {
    return null;
  }
  const rawConnectors = Array.isArray(rec.connectors) ? rec.connectors : [];
  const byId = new Map<ConnectorId, SpaTeamMemberConnector>();
  for (const item of rawConnectors) {
    const row = parseTeamMemberConnector(item);
    if (row) {
      byId.set(row.connector_id, row);
    }
  }
  return {
    user_id: rec.user_id,
    email: typeof rec.email === "string" ? rec.email : rec.user_id,
    connectors: CONNECTOR_IDS.map(
      (connectorId) =>
        byId.get(connectorId) ?? {
          connector_id: connectorId,
          status: "not_connected",
          account_label: null,
        },
    ),
  };
}

function parseGrant(value: unknown): SpaRoleConnectorGrant | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const rec = value as Record<string, unknown>;
  if (typeof rec.role_id !== "string" || rec.role_id.trim() === "") {
    return null;
  }
  if (!isConnectorId(rec.connector_id)) {
    return null;
  }
  return {
    role_id: rec.role_id,
    role_name:
      typeof rec.role_name === "string" && rec.role_name.trim() !== ""
        ? rec.role_name
        : rec.role_id,
    connector_id: rec.connector_id,
    enabled: rec.enabled === true,
  };
}

export function teamJsonLeaksSecrets(value: unknown): boolean {
  if (value == null || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(teamJsonLeaksSecrets);
  }
  const rec = value as Record<string, unknown>;
  for (const key of FORBIDDEN_TEAM_KEYS) {
    if (key in rec) {
      return true;
    }
  }
  return Object.values(rec).some(teamJsonLeaksSecrets);
}

/** Fail-closed parse of GET /api/connectors/team. Unknown ids dropped. */
export function parseConnectorsTeam(body: unknown): ConnectorsTeamResponse {
  const rec =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const members: SpaTeamMember[] = [];
  const rawMembers = Array.isArray(rec.members) ? rec.members : [];
  for (const item of rawMembers) {
    const row = parseTeamMember(item);
    if (row) {
      members.push(row);
    }
  }
  const grants: SpaRoleConnectorGrant[] = [];
  const rawGrants = Array.isArray(rec.grants) ? rec.grants : [];
  for (const item of rawGrants) {
    const row = parseGrant(item);
    if (row) {
      grants.push(row);
    }
  }
  return {
    members,
    grants,
    hubspot_portal_id:
      typeof rec.hubspot_portal_id === "string" && rec.hubspot_portal_id !== ""
        ? rec.hubspot_portal_id
        : null,
  };
}

export function buildConnectorsTeamModel(
  team: ConnectorsTeamResponse,
): ConnectorsTeamModel {
  const rolesById = new Map<string, RoleGrantRow>();
  for (const grant of team.grants) {
    const existing = rolesById.get(grant.role_id) ?? {
      role_id: grant.role_id,
      role_name: grant.role_name,
      grants: { google: false, hubspot: false, whatsapp: false, github: false },
    };
    existing.grants[grant.connector_id] = grant.enabled;
    rolesById.set(grant.role_id, existing);
  }

  return {
    roles: [...rolesById.values()],
    members: team.members.map((member) => ({
      user_id: member.user_id,
      email: member.email,
      cells: member.connectors.map((cell) => ({
        connector_id: cell.connector_id,
        label: CONNECTOR_LABELS[cell.connector_id],
        status: cell.status,
        status_label: connectionStatusLabel(cell.status),
        account_label: cell.account_label,
      })),
    })),
    hubspot_portal_id: team.hubspot_portal_id,
  };
}

export function grantToggleKey(
  roleId: string,
  connectorId: ConnectorId,
): string {
  return `${roleId}:${connectorId}`;
}
