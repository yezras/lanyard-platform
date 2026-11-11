/**
 * Connector lifecycle (lp-xhf4.12).
 *
 * Frozen table: docs/architecture/portal-connectors.md §7.
 * Events are the domain. Apply is one reducer. No soft-delete of secrets.
 */

import {
  ConnectorConnectionNotFoundError,
  emptyConnectorSecrets,
  type ConnectorId,
  type ConnectorSecrets,
  type ConnectionStatus,
  type ConnectorConnectionPublic,
} from "./connectors.js";
import { oauthRefreshStillValid, whatsappSessionStillValid } from "./connector-user-sandbox.js";

export const CONNECTOR_LIFECYCLE_EVENTS = [
  "user_disconnect",
  "refresh",
  "refresh_fail",
  "role_grant_off",
  "tenant_entitlement_off",
  "user_removed",
  "clear_hubspot_pin",
] as const;

export type ConnectorLifecycleEventKind =
  (typeof CONNECTOR_LIFECYCLE_EVENTS)[number];

export type ConnectorRowEffect =
  | "delete"
  | "keep_rotate"
  | "keep_needs_reauth"
  | "keep";

export type ConnectorProviderEffect =
  | "revoke_or_logout"
  | "refresh_grant"
  | "none";

export type ConnectorSandboxEffect =
  | "drop_cache"
  | "next_inject"
  | "wizard"
  | "none";

export type ConnectorLifecyclePlan = {
  event: ConnectorLifecycleEventKind;
  row: ConnectorRowEffect;
  provider: ConnectorProviderEffect;
  sandbox: ConnectorSandboxEffect;
  wizard: boolean;
};

/** Normative copy of portal-connectors.md §7. */
export const CONNECTOR_LIFECYCLE_TABLE: Record<
  ConnectorLifecycleEventKind,
  ConnectorLifecyclePlan
> = {
  user_disconnect: {
    event: "user_disconnect",
    row: "delete",
    provider: "revoke_or_logout",
    sandbox: "drop_cache",
    wizard: false,
  },
  refresh: {
    event: "refresh",
    row: "keep_rotate",
    provider: "refresh_grant",
    sandbox: "next_inject",
    wizard: false,
  },
  refresh_fail: {
    event: "refresh_fail",
    row: "keep_needs_reauth",
    provider: "none",
    sandbox: "wizard",
    wizard: true,
  },
  role_grant_off: {
    event: "role_grant_off",
    row: "delete",
    provider: "revoke_or_logout",
    sandbox: "drop_cache",
    wizard: false,
  },
  tenant_entitlement_off: {
    event: "tenant_entitlement_off",
    row: "delete",
    provider: "revoke_or_logout",
    sandbox: "drop_cache",
    wizard: false,
  },
  user_removed: {
    event: "user_removed",
    row: "delete",
    provider: "revoke_or_logout",
    sandbox: "drop_cache",
    wizard: false,
  },
  clear_hubspot_pin: {
    event: "clear_hubspot_pin",
    row: "keep",
    provider: "none",
    sandbox: "none",
    wizard: false,
  },
};

export type ConnectorLifecycleEvent =
  | {
      kind: "user_disconnect";
      tenant_id: string;
      user_id: string;
      connector_id: ConnectorId;
      actor?: string | null;
    }
  | {
      kind: "refresh";
      tenant_id: string;
      user_id: string;
      connector_id: ConnectorId;
      actor?: string | null;
    }
  | {
      kind: "refresh_fail";
      tenant_id: string;
      user_id: string;
      connector_id: ConnectorId;
      actor?: string | null;
    }
  | {
      kind: "role_grant_off";
      tenant_id: string;
      role_id: string;
      connector_id: ConnectorId;
      actor?: string | null;
    }
  | {
      kind: "tenant_entitlement_off";
      tenant_id: string;
      connector_id: ConnectorId;
      actor?: string | null;
    }
  | {
      kind: "user_removed";
      tenant_id: string;
      user_id: string;
      actor?: string | null;
    }
  | {
      kind: "clear_hubspot_pin";
      tenant_id: string;
      actor?: string | null;
    };

export type ConnectorLifecycleTarget = {
  user_id: string;
  connector_id: ConnectorId;
};

export type ConnectorLifecycleDeleted = ConnectorLifecycleTarget & {
  revoke_attempted: boolean;
  cache_dropped: boolean;
};

export type ConnectorLifecycleRefreshed = ConnectorLifecycleTarget & {
  status: ConnectionStatus;
  wizard: boolean;
};

export type ConnectorLifecycleResult = {
  event: ConnectorLifecycleEventKind;
  plan: ConnectorLifecyclePlan;
  deleted: ConnectorLifecycleDeleted[];
  refreshed: ConnectorLifecycleRefreshed[];
  wizard: boolean;
};

export type OauthRefreshGrant = {
  oauth_access: string;
  oauth_refresh: string | null;
  oauth_expiry: string;
  oauth_scopes?: string[];
};

export class ConnectorRefreshError extends Error {
  readonly code = "CONNECTOR_REFRESH_FAILED" as const;

  constructor(message = "Connector refresh failed") {
    super(message);
    this.name = "ConnectorRefreshError";
  }
}

export class ConnectorOauthNotConfiguredError extends Error {
  readonly code = "CONNECTOR_OAUTH_NOT_CONFIGURED" as const;

  constructor(message: string) {
    super(message);
    this.name = "ConnectorOauthNotConfiguredError";
  }
}

export type ConnectorLifecyclePorts = {
  getConnection(
    tenant_id: string,
    user_id: string,
    connector_id: ConnectorId,
  ): Promise<ConnectorConnectionPublic | null>;
  getSecrets(
    tenant_id: string,
    user_id: string,
    connector_id: ConnectorId,
  ): Promise<ConnectorSecrets>;
  deleteConnection(input: {
    tenant_id: string;
    user_id: string;
    connector_id: ConnectorId;
    actor?: string | null;
    reason: ConnectorLifecycleEventKind;
  }): Promise<boolean>;
  upsertConnection(input: {
    tenant_id: string;
    user_id: string;
    connector_id: ConnectorId;
    status?: ConnectionStatus;
    secrets?: Partial<ConnectorSecrets>;
    actor?: string | null;
  }): Promise<ConnectorConnectionPublic>;
  listConnectionsForConnector(
    tenant_id: string,
    connector_id: ConnectorId,
  ): Promise<ConnectorLifecycleTarget[]>;
  listConnectionsForUser(
    tenant_id: string,
    user_id: string,
  ): Promise<ConnectorLifecycleTarget[]>;
  listUsersLosingRoleGrant(
    tenant_id: string,
    role_id: string,
    connector_id: ConnectorId,
  ): Promise<string[]>;
  dropGuestCache(input: {
    tenant_id: string;
    user_id: string;
    connector_id: ConnectorId;
  }): Promise<boolean>;
  revokeOauth(input: {
    connector_id: Exclude<ConnectorId, "whatsapp">;
    secrets: ConnectorSecrets;
  }): Promise<void>;
  refreshOauth(input: {
    connector_id: Exclude<ConnectorId, "whatsapp">;
    secrets: ConnectorSecrets;
  }): Promise<OauthRefreshGrant>;
  logoutWhatsApp(input: {
    tenant_id: string;
    user_id: string;
  }): Promise<void>;
};

export function planForLifecycleEvent(
  kind: ConnectorLifecycleEventKind,
): ConnectorLifecyclePlan {
  return CONNECTOR_LIFECYCLE_TABLE[kind];
}

export function providerActionFor(
  plan: ConnectorLifecyclePlan,
  connector_id: ConnectorId,
): "revoke" | "wacli_logout" | "refresh_grant" | "none" {
  if (plan.provider === "none") return "none";
  if (connector_id === "github") {
    // cli_token connector: no provider-side OAuth revoke/refresh in v1.
    return "none";
  }
  if (plan.provider === "refresh_grant") {
    return connector_id === "whatsapp" ? "none" : "refresh_grant";
  }
  return connector_id === "whatsapp" ? "wacli_logout" : "revoke";
}

async function resolveTargets(
  event: ConnectorLifecycleEvent,
  ports: ConnectorLifecyclePorts,
): Promise<ConnectorLifecycleTarget[]> {
  switch (event.kind) {
    case "user_disconnect":
    case "refresh":
    case "refresh_fail":
      return [
        { user_id: event.user_id, connector_id: event.connector_id },
      ];
    case "role_grant_off": {
      const userIds = await ports.listUsersLosingRoleGrant(
        event.tenant_id,
        event.role_id,
        event.connector_id,
      );
      return userIds.map((user_id) => ({
        user_id,
        connector_id: event.connector_id,
      }));
    }
    case "tenant_entitlement_off":
      return ports.listConnectionsForConnector(
        event.tenant_id,
        event.connector_id,
      );
    case "user_removed":
      return ports.listConnectionsForUser(event.tenant_id, event.user_id);
    case "clear_hubspot_pin":
      return [];
  }
}

async function loadSecrets(
  ports: ConnectorLifecyclePorts,
  tenant_id: string,
  target: ConnectorLifecycleTarget,
): Promise<ConnectorSecrets> {
  try {
    return await ports.getSecrets(
      tenant_id,
      target.user_id,
      target.connector_id,
    );
  } catch {
    return emptyConnectorSecrets();
  }
}

async function attemptProvider(
  action: ReturnType<typeof providerActionFor>,
  ports: ConnectorLifecyclePorts,
  tenant_id: string,
  target: ConnectorLifecycleTarget,
  secrets: ConnectorSecrets,
): Promise<boolean> {
  if (action === "none" || action === "refresh_grant") {
    return false;
  }
  try {
    if (action === "wacli_logout") {
      await ports.logoutWhatsApp({
        tenant_id,
        user_id: target.user_id,
      });
    } else if (target.connector_id !== "whatsapp") {
      await ports.revokeOauth({
        connector_id: target.connector_id,
        secrets,
      });
    }
    return true;
  } catch {
    return true;
  }
}

async function deleteTarget(
  event: ConnectorLifecycleEvent,
  plan: ConnectorLifecyclePlan,
  ports: ConnectorLifecyclePorts,
  target: ConnectorLifecycleTarget,
): Promise<ConnectorLifecycleDeleted> {
  const secrets = await loadSecrets(ports, event.tenant_id, target);
  const action = providerActionFor(plan, target.connector_id);
  const revoke_attempted = await attemptProvider(
    action,
    ports,
    event.tenant_id,
    target,
    secrets,
  );
  await ports.deleteConnection({
    tenant_id: event.tenant_id,
    user_id: target.user_id,
    connector_id: target.connector_id,
    actor: event.actor,
    reason: event.kind,
  });
  let cache_dropped = false;
  try {
    cache_dropped = await ports.dropGuestCache({
      tenant_id: event.tenant_id,
      user_id: target.user_id,
      connector_id: target.connector_id,
    });
  } catch {
    cache_dropped = false;
  }
  return {
    user_id: target.user_id,
    connector_id: target.connector_id,
    revoke_attempted,
    cache_dropped,
  };
}

async function refreshTarget(
  event: Extract<ConnectorLifecycleEvent, { kind: "refresh" | "refresh_fail" }>,
  ports: ConnectorLifecyclePorts,
  target: ConnectorLifecycleTarget,
): Promise<ConnectorLifecycleRefreshed> {
  if (event.kind === "refresh_fail") {
    const row = await ports.upsertConnection({
      tenant_id: event.tenant_id,
      user_id: target.user_id,
      connector_id: target.connector_id,
      status: "needs_reauth",
      actor: event.actor,
    });
    return {
      user_id: target.user_id,
      connector_id: target.connector_id,
      status: row.status,
      wizard: true,
    };
  }

  const existing = await ports.getConnection(
    event.tenant_id,
    target.user_id,
    target.connector_id,
  );
  if (!existing) {
    throw new ConnectorConnectionNotFoundError(
      event.tenant_id,
      target.user_id,
      target.connector_id,
    );
  }
  const secrets = await loadSecrets(ports, event.tenant_id, target);

  if (target.connector_id === "whatsapp") {
    if (whatsappSessionStillValid(secrets)) {
      const row = await ports.upsertConnection({
        tenant_id: event.tenant_id,
        user_id: target.user_id,
        connector_id: "whatsapp",
        status: "connected",
        actor: event.actor,
      });
      return {
        user_id: target.user_id,
        connector_id: "whatsapp",
        status: row.status,
        wizard: false,
      };
    }
    const row = await ports.upsertConnection({
      tenant_id: event.tenant_id,
      user_id: target.user_id,
      connector_id: "whatsapp",
      status: "needs_reauth",
      actor: event.actor,
    });
    return {
      user_id: target.user_id,
      connector_id: "whatsapp",
      status: row.status,
      wizard: true,
    };
  }

  if (!oauthRefreshStillValid(secrets)) {
    const row = await ports.upsertConnection({
      tenant_id: event.tenant_id,
      user_id: target.user_id,
      connector_id: target.connector_id,
      status: "needs_reauth",
      actor: event.actor,
    });
    return {
      user_id: target.user_id,
      connector_id: target.connector_id,
      status: row.status,
      wizard: true,
    };
  }

  try {
    const grant = await ports.refreshOauth({
      connector_id: target.connector_id,
      secrets,
    });
    const row = await ports.upsertConnection({
      tenant_id: event.tenant_id,
      user_id: target.user_id,
      connector_id: target.connector_id,
      status: "connected",
      secrets: {
        oauth_access: grant.oauth_access,
        oauth_refresh: grant.oauth_refresh ?? secrets.oauth_refresh,
        oauth_expiry: grant.oauth_expiry,
        oauth_scopes: grant.oauth_scopes ?? secrets.oauth_scopes,
      },
      actor: event.actor,
    });
    return {
      user_id: target.user_id,
      connector_id: target.connector_id,
      status: row.status,
      wizard: false,
    };
  } catch (error) {
    if (error instanceof ConnectorOauthNotConfiguredError) {
      throw error;
    }
    const row = await ports.upsertConnection({
      tenant_id: event.tenant_id,
      user_id: target.user_id,
      connector_id: target.connector_id,
      status: "needs_reauth",
      actor: event.actor,
    });
    return {
      user_id: target.user_id,
      connector_id: target.connector_id,
      status: row.status,
      wizard: true,
    };
  }
}

export async function applyConnectorLifecycle(
  event: ConnectorLifecycleEvent,
  ports: ConnectorLifecyclePorts,
): Promise<ConnectorLifecycleResult> {
  const plan = planForLifecycleEvent(event.kind);
  const targets = await resolveTargets(event, ports);
  const deleted: ConnectorLifecycleDeleted[] = [];
  const refreshed: ConnectorLifecycleRefreshed[] = [];

  if (plan.row === "delete") {
    for (const target of targets) {
      const existing = await ports.getConnection(
        event.tenant_id,
        target.user_id,
        target.connector_id,
      );
      if (!existing) {
        if (event.kind === "user_disconnect") {
          throw new ConnectorConnectionNotFoundError(
            event.tenant_id,
            target.user_id,
            target.connector_id,
          );
        }
        continue;
      }
      deleted.push(await deleteTarget(event, plan, ports, target));
    }
  } else if (plan.row === "keep_rotate" || plan.row === "keep_needs_reauth") {
    for (const target of targets) {
      refreshed.push(
        await refreshTarget(
          event as Extract<
            ConnectorLifecycleEvent,
            { kind: "refresh" | "refresh_fail" }
          >,
          ports,
          target,
        ),
      );
    }
  }

  const wizard =
    plan.wizard || refreshed.some((row) => row.wizard || row.status === "needs_reauth");
  return {
    event: event.kind,
    plan,
    deleted,
    refreshed,
    wizard,
  };
}

export const GOOGLE_OAUTH_REVOKE_URL =
  "https://oauth2.googleapis.com/revoke" as const;
export const GOOGLE_OAUTH_TOKEN_URL =
  "https://oauth2.googleapis.com/token" as const;
export const HUBSPOT_REFRESH_TOKEN_REVOKE_URL =
  "https://api.hubapi.com/oauth/v1/refresh-tokens" as const;
export const HUBSPOT_OAUTH_TOKEN_URL =
  "https://api.hubapi.com/oauth/v1/token" as const;

export type ConnectorOauthProviderConfig = {
  googleClientId?: string;
  googleClientSecret?: string;
  hubspotClientId?: string;
  hubspotClientSecret?: string;
  fetchImpl?: typeof fetch;
};

function envTrim(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function googleCredentials(config: ConnectorOauthProviderConfig): {
  clientId: string;
  clientSecret: string;
} {
  const clientId =
    config.googleClientId?.trim() || envTrim("GOOGLE_CLIENT_ID");
  const clientSecret =
    config.googleClientSecret?.trim() || envTrim("GOOGLE_CLIENT_SECRET");
  return { clientId, clientSecret };
}

function hubspotCredentials(config: ConnectorOauthProviderConfig): {
  clientId: string;
  clientSecret: string;
} {
  const clientId =
    config.hubspotClientId?.trim() || envTrim("HUBSPOT_CLIENT_ID");
  const clientSecret =
    config.hubspotClientSecret?.trim() || envTrim("HUBSPOT_CLIENT_SECRET");
  return { clientId, clientSecret };
}

function expiryFromExpiresIn(
  expiresIn: number | undefined,
  now: Date = new Date(),
): string {
  const seconds =
    typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0
      ? expiresIn
      : 3600;
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

export function createDefaultConnectorOauthProvider(
  config: ConnectorOauthProviderConfig = {},
): Pick<ConnectorLifecyclePorts, "revokeOauth" | "refreshOauth"> {
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    async revokeOauth(input) {
      const token =
        input.secrets.oauth_refresh?.trim() ||
        input.secrets.oauth_access?.trim() ||
        "";
      if (!token) return;
      if (input.connector_id === "google") {
        await fetchImpl(GOOGLE_OAUTH_REVOKE_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }).toString(),
        }).catch(() => undefined);
        return;
      }
      const encoded = encodeURIComponent(token);
      await fetchImpl(`${HUBSPOT_REFRESH_TOKEN_REVOKE_URL}/${encoded}`, {
        method: "DELETE",
      }).catch(() => undefined);
    },

    async refreshOauth(input) {
      const refresh = input.secrets.oauth_refresh?.trim() ?? "";
      if (!refresh) {
        throw new ConnectorRefreshError("No refresh token");
      }
      if (input.connector_id === "google") {
        const { clientId, clientSecret } = googleCredentials(config);
        if (!clientId || !clientSecret) {
          throw new ConnectorOauthNotConfiguredError(
            "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be configured",
          );
        }
        const response = await fetchImpl(GOOGLE_OAUTH_TOKEN_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: refresh,
            client_id: clientId,
            client_secret: clientSecret,
          }).toString(),
        });
        const body = (await response.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        const access =
          typeof body.access_token === "string" ? body.access_token.trim() : "";
        if (!response.ok || !access) {
          throw new ConnectorRefreshError("Google refresh grant failed");
        }
        const newRefresh =
          typeof body.refresh_token === "string"
            ? body.refresh_token.trim()
            : "";
        const expiresIn =
          typeof body.expires_in === "number"
            ? body.expires_in
            : typeof body.expires_in === "string"
              ? Number(body.expires_in)
              : undefined;
        return {
          oauth_access: access,
          oauth_refresh: newRefresh || refresh,
          oauth_expiry: expiryFromExpiresIn(expiresIn),
        };
      }

      const { clientId, clientSecret } = hubspotCredentials(config);
      if (!clientId || !clientSecret) {
        throw new ConnectorOauthNotConfiguredError(
          "HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET must be configured",
        );
      }
      const response = await fetchImpl(HUBSPOT_OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: refresh,
          client_id: clientId,
          client_secret: clientSecret,
        }).toString(),
      });
      const body = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      const access =
        typeof body.access_token === "string" ? body.access_token.trim() : "";
      if (!response.ok || !access) {
        throw new ConnectorRefreshError("HubSpot refresh grant failed");
      }
      const newRefresh =
        typeof body.refresh_token === "string" ? body.refresh_token.trim() : "";
      const expiresIn =
        typeof body.expires_in === "number"
          ? body.expires_in
          : typeof body.expires_in === "string"
            ? Number(body.expires_in)
            : undefined;
      return {
        oauth_access: access,
        oauth_refresh: newRefresh || refresh,
        oauth_expiry: expiryFromExpiresIn(expiresIn),
      };
    },
  };
}
