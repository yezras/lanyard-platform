/**
 * HubSpot connector OAuth (lp-xhf4.10).
 *
 * One Lanyard-owned HubSpot app. Scopes are closed: read+write on the six
 * CRM objects (contacts, companies, deals, notes, tasks, meetings) plus
 * OAuth identity (user email + portal id). Notes/tasks/meetings use HubSpot
 * contacts engagement scopes; Settings / users admin / marketing are not
 * requested.
 *
 * First successful connect pins hubspot_portal_id on the tenant entitlement.
 * Later connects whose token portal mismatches are rejected. Clearing the
 * pin does not delete connection rows or tokens.
 */

import {
  EVERY_CALL_ACTION_CLASSES,
  emptyConnectorSecrets,
  type ConnectorAccess,
  type ConnectorConnectionPublic,
  type ConnectorSecrets,
  type TenantConnectorEntitlement,
} from "./connectors.js";

export const HUBSPOT_OAUTH_AUTHORIZE_URL =
  "https://app.hubspot.com/oauth/authorize" as const;

export const HUBSPOT_OAUTH_TOKEN_URL =
  "https://api.hubapi.com/oauth/v1/token" as const;

export const HUBSPOT_OAUTH_TOKEN_INFO_URL =
  "https://api.hubapi.com/oauth/v1/access-tokens" as const;

/** Six v1 CRM objects. Tickets/custom objects require a later reconnect. */
export const HUBSPOT_CRM_OBJECTS = [
  "contacts",
  "companies",
  "deals",
  "notes",
  "tasks",
  "meetings",
] as const;

export type HubSpotCrmObject = (typeof HUBSPOT_CRM_OBJECTS)[number];

/**
 * Fixed v1 HubSpot consent. Not per-role.
 *
 * HubSpot's Notes/Tasks/Meetings APIs authorize via contacts engagement
 * scopes (crm.objects.contacts.read/write), not crm.objects.notes.*.
 */
export const HUBSPOT_OAUTH_SCOPES = [
  "oauth",
  "crm.objects.contacts.read",
  "crm.objects.contacts.write",
  "crm.objects.companies.read",
  "crm.objects.companies.write",
  "crm.objects.deals.read",
  "crm.objects.deals.write",
] as const;

export type HubSpotOauthScope = (typeof HUBSPOT_OAUTH_SCOPES)[number];

const FORBIDDEN_HUBSPOT_SCOPES = [
  "settings",
  "settings.users.write",
  "crm.objects.users.write",
  "content",
  "marketing.campaigns.write",
  "automation",
] as const;

export type HubSpotTokenGrant = {
  access_token: string;
  refresh_token: string;
  expiry: string;
  scopes: string[];
  email: string;
  portal_id: string;
};

export type HubSpotPinDecision =
  | { kind: "set"; portal_id: string }
  | { kind: "match"; portal_id: string }
  | { kind: "mismatch"; portal_id: string; pinned: string };

export class InsufficientHubSpotScopesError extends Error {
  readonly code = "INSUFFICIENT_HUBSPOT_SCOPES" as const;

  constructor(message: string) {
    super(message);
    this.name = "InsufficientHubSpotScopesError";
  }
}

export class HubSpotGrantError extends Error {
  readonly code = "HUBSPOT_GRANT" as const;

  constructor(message: string) {
    super(message);
    this.name = "HubSpotGrantError";
  }
}

export class HubSpotPortalPinMismatchError extends Error {
  readonly code = "HUBSPOT_PORTAL_PIN_MISMATCH" as const;
  readonly portal_id: string;
  readonly pinned: string;

  constructor(portal_id: string, pinned: string) {
    super(
      `HubSpot portal ${portal_id} does not match tenant pin ${pinned}`,
    );
    this.name = "HubSpotPortalPinMismatchError";
    this.portal_id = portal_id;
    this.pinned = pinned;
  }
}

export class HubSpotConnectorDeniedError extends Error {
  readonly code = "HUBSPOT_CONNECTOR_DENIED" as const;

  constructor(message: string) {
    super(message);
    this.name = "HubSpotConnectorDeniedError";
  }
}

export class HubSpotAuthError extends Error {
  readonly code = "HUBSPOT_AUTH" as const;

  constructor(message: string) {
    super(message);
    this.name = "HubSpotAuthError";
  }
}

export function hubspotOauthScopeParam(): string {
  return HUBSPOT_OAUTH_SCOPES.join(" ");
}

export function parseGrantedHubSpotScopes(
  scope: string | string[] | undefined | null,
): string[] {
  if (scope == null) {
    return [];
  }
  const raw = Array.isArray(scope) ? scope.join(" ") : scope;
  return raw
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function hubspotConsentCoversCrm(
  granted: readonly string[],
): { ok: true } | { ok: false; reason: string } {
  const set = new Set(granted);
  const missing = HUBSPOT_OAUTH_SCOPES.filter((scope) => {
    if (scope === "oauth") {
      return false;
    }
    return !set.has(scope);
  });
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `HubSpot consent missing scopes: ${missing.join(" ")}`,
    };
  }
  return { ok: true };
}

export function assertHubSpotConsentCoversCrm(
  granted: readonly string[],
): void {
  const result = hubspotConsentCoversCrm(granted);
  if (!result.ok) {
    throw new InsufficientHubSpotScopesError(result.reason);
  }
}

export function hubspotWriteIsEveryCall(): boolean {
  return (EVERY_CALL_ACTION_CLASSES as readonly string[]).includes(
    "hubspot.write",
  );
}

export function expiryFromExpiresIn(
  expiresIn: number | undefined,
  now: Date = new Date(),
): string {
  const seconds =
    typeof expiresIn === "number" && Number.isFinite(expiresIn) && expiresIn > 0
      ? expiresIn
      : 1800;
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

export function parseHubSpotPortalId(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return String(Math.trunc(value));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed)) {
      return trimmed;
    }
  }
  throw new HubSpotGrantError("HubSpot token info missing hub_id");
}

export function hubspotAccountLabel(email: string, portalId: string): string {
  return `${email} (${portalId})`;
}

export function connectorSecretsFromHubSpotGrant(
  grant: HubSpotTokenGrant,
): ConnectorSecrets {
  return {
    oauth_access: grant.access_token,
    oauth_refresh: grant.refresh_token,
    oauth_expiry: grant.expiry,
    oauth_scopes: grant.scopes,
    whatsapp_session_db: null,
  };
}

export function decideHubSpotPortalPin(
  existingPin: string | null | undefined,
  tokenPortalId: string,
): HubSpotPinDecision {
  const portal_id = tokenPortalId.trim();
  if (!portal_id) {
    throw new HubSpotGrantError("HubSpot token missing portal id");
  }
  const pinned = existingPin?.trim() || "";
  if (!pinned) {
    return { kind: "set", portal_id };
  }
  if (pinned === portal_id) {
    return { kind: "match", portal_id };
  }
  return { kind: "mismatch", portal_id, pinned };
}

export function applyHubSpotPortalPin(
  existingPin: string | null | undefined,
  tokenPortalId: string,
): Extract<HubSpotPinDecision, { kind: "set" | "match" }> {
  const decision = decideHubSpotPortalPin(existingPin, tokenPortalId);
  if (decision.kind === "mismatch") {
    throw new HubSpotPortalPinMismatchError(decision.portal_id, decision.pinned);
  }
  return decision;
}

export function parseHubSpotTokenAndInfo(
  tokenBody: unknown,
  infoBody: unknown,
  now: Date = new Date(),
): HubSpotTokenGrant {
  if (!tokenBody || typeof tokenBody !== "object" || Array.isArray(tokenBody)) {
    throw new HubSpotGrantError("HubSpot token response is not an object");
  }
  const token = tokenBody as Record<string, unknown>;
  const access =
    typeof token.access_token === "string" ? token.access_token.trim() : "";
  const refresh =
    typeof token.refresh_token === "string" ? token.refresh_token.trim() : "";
  if (!access) {
    throw new HubSpotGrantError("HubSpot token response missing access_token");
  }
  if (!refresh) {
    throw new HubSpotGrantError("HubSpot token response missing refresh_token");
  }
  if (!infoBody || typeof infoBody !== "object" || Array.isArray(infoBody)) {
    throw new HubSpotGrantError("HubSpot token info is not an object");
  }
  const info = infoBody as Record<string, unknown>;
  const emailRaw =
    typeof info.user === "string"
      ? info.user
      : typeof info.user_email === "string"
        ? info.user_email
        : "";
  const email = emailRaw.trim().toLowerCase();
  if (!email) {
    throw new HubSpotGrantError("HubSpot token info missing user email");
  }
  const portal_id = parseHubSpotPortalId(info.hub_id ?? info.hubId);
  const scopes = parseGrantedHubSpotScopes(
    Array.isArray(info.scopes)
      ? (info.scopes as string[])
      : typeof info.scopes === "string"
        ? info.scopes
        : typeof token.scope === "string"
          ? token.scope
          : undefined,
  );
  assertHubSpotConsentCoversCrm(scopes);
  const expiresIn =
    typeof token.expires_in === "number"
      ? token.expires_in
      : typeof token.expires_in === "string"
        ? Number(token.expires_in)
        : typeof info.expires_in === "number"
          ? info.expires_in
          : undefined;
  return {
    access_token: access,
    refresh_token: refresh,
    expiry: expiryFromExpiresIn(expiresIn, now),
    scopes,
    email,
    portal_id,
  };
}

export function hubspotAccessTokenEnv(
  accessToken: string,
): Record<"HUBSPOT_ACCESS_TOKEN", string> {
  return { HUBSPOT_ACCESS_TOKEN: accessToken };
}

export function assertNoRefreshTokenInPublicDto(
  value: unknown,
  refreshToken: string,
): void {
  const raw = JSON.stringify(value);
  if (raw.includes(refreshToken)) {
    throw new Error("connector public DTO leaked refresh token");
  }
}

export type HubSpotCodeExchange = (input: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}) => Promise<HubSpotTokenGrant>;

export type HubSpotAuthConfig = {
  clientId?: string;
  clientSecret?: string;
  exchangeCode?: HubSpotCodeExchange;
};

function getHubSpotClientId(config: HubSpotAuthConfig = {}): string | undefined {
  return config.clientId?.trim() || process.env.HUBSPOT_CLIENT_ID?.trim() || undefined;
}

function getHubSpotClientSecret(
  config: HubSpotAuthConfig = {},
): string | undefined {
  return (
    config.clientSecret?.trim() ||
    process.env.HUBSPOT_CLIENT_SECRET?.trim() ||
    undefined
  );
}

export async function exchangeHubSpotCode(
  code: string,
  redirectUri: string,
  codeVerifier: string,
  config: HubSpotAuthConfig = {},
): Promise<HubSpotTokenGrant> {
  if (config.exchangeCode) {
    return config.exchangeCode({ code, redirectUri, codeVerifier });
  }

  const clientId = getHubSpotClientId(config);
  const clientSecret = getHubSpotClientSecret(config);
  if (!clientId || !clientSecret) {
    throw new HubSpotAuthError(
      "HUBSPOT_CLIENT_ID and HUBSPOT_CLIENT_SECRET must be configured",
    );
  }

  const tokenResponse = await fetch(HUBSPOT_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      code,
      code_verifier: codeVerifier,
    }),
  });
  if (!tokenResponse.ok) {
    throw new HubSpotAuthError("Failed to exchange HubSpot authorization code");
  }
  const tokenBody: unknown = await tokenResponse.json();
  const rec = tokenBody as { access_token?: string };
  if (!rec.access_token || typeof rec.access_token !== "string") {
    throw new HubSpotAuthError("HubSpot token response missing access_token");
  }

  const infoResponse = await fetch(
    `${HUBSPOT_OAUTH_TOKEN_INFO_URL}/${encodeURIComponent(rec.access_token)}`,
  );
  if (!infoResponse.ok) {
    throw new HubSpotAuthError("Failed to inspect HubSpot access token");
  }
  const infoBody: unknown = await infoResponse.json();
  return parseHubSpotTokenAndInfo(tokenBody, infoBody);
}

export type CompleteHubSpotConnectorOAuthPorts = {
  exchange(input: {
    code: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<HubSpotTokenGrant>;
  getAccess(input: {
    tenant_id: string;
    user_id: string;
  }): Promise<ConnectorAccess>;
  getEntitlement(
    tenant_id: string,
  ): Promise<TenantConnectorEntitlement | null>;
  upsertEntitlement(input: {
    tenant_id: string;
    connector_id: "hubspot";
    enabled: boolean;
    hubspot_portal_id: string | null;
    actor?: string | null;
  }): Promise<TenantConnectorEntitlement>;
  upsert(input: {
    tenant_id: string;
    user_id: string;
    connector_id: "hubspot";
    status: "connected";
    account_label: string;
    secrets: ConnectorSecrets;
    replace_secrets?: boolean;
    actor?: string | null;
  }): Promise<ConnectorConnectionPublic>;
  ensureUserSandbox(input: {
    tenant_id: string;
    owner_user_id: string;
    actor?: string | null;
  }): Promise<unknown>;
};

export async function completeHubSpotConnectorOAuth(input: {
  tenant_id: string;
  user_id: string;
  code: string;
  redirect_uri: string;
  code_verifier: string;
  actor?: string | null;
  ports: CompleteHubSpotConnectorOAuthPorts;
}): Promise<ConnectorConnectionPublic> {
  const code = input.code.trim();
  const redirect_uri = input.redirect_uri.trim();
  const code_verifier = input.code_verifier.trim();
  if (!code || !redirect_uri || !code_verifier) {
    throw new HubSpotGrantError(
      "HubSpot connector OAuth requires code, redirect_uri, and code_verifier",
    );
  }

  const access = await input.ports.getAccess({
    tenant_id: input.tenant_id,
    user_id: input.user_id,
  });
  if (!access.entitled || !access.role_granted) {
    throw new HubSpotConnectorDeniedError(
      "HubSpot is not entitled for this tenant and role",
    );
  }

  const grant = await input.ports.exchange({
    code,
    redirectUri: redirect_uri,
    codeVerifier: code_verifier,
  });

  const entitlement = await input.ports.getEntitlement(input.tenant_id);
  const pin = applyHubSpotPortalPin(
    entitlement?.hubspot_portal_id ?? null,
    grant.portal_id,
  );
  if (pin.kind === "set") {
    await input.ports.upsertEntitlement({
      tenant_id: input.tenant_id,
      connector_id: "hubspot",
      enabled: entitlement?.enabled ?? true,
      hubspot_portal_id: pin.portal_id,
      actor: input.actor ?? null,
    });
  }

  const connection = await input.ports.upsert({
    tenant_id: input.tenant_id,
    user_id: input.user_id,
    connector_id: "hubspot",
    status: "connected",
    account_label: hubspotAccountLabel(grant.email, grant.portal_id),
    secrets: connectorSecretsFromHubSpotGrant(grant),
    replace_secrets: true,
    actor: input.actor ?? null,
  });
  await input.ports.ensureUserSandbox({
    tenant_id: input.tenant_id,
    owner_user_id: input.user_id,
    actor: input.actor ?? null,
  });
  return connection;
}

export type ClearHubSpotPortalPinPorts = {
  getEntitlement(
    tenant_id: string,
  ): Promise<TenantConnectorEntitlement | null>;
  upsertEntitlement(input: {
    tenant_id: string;
    connector_id: "hubspot";
    enabled: boolean;
    hubspot_portal_id: string | null;
    actor?: string | null;
  }): Promise<TenantConnectorEntitlement>;
};

export async function clearHubSpotPortalPin(input: {
  tenant_id: string;
  actor?: string | null;
  ports: ClearHubSpotPortalPinPorts;
}): Promise<{ hubspot_portal_id: null }> {
  const existing = await input.ports.getEntitlement(input.tenant_id);
  if (!existing) {
    return { hubspot_portal_id: null };
  }
  await input.ports.upsertEntitlement({
    tenant_id: input.tenant_id,
    connector_id: "hubspot",
    enabled: existing.enabled,
    hubspot_portal_id: null,
    actor: input.actor ?? null,
  });
  return { hubspot_portal_id: null };
}

export function emptyHubSpotSecrets(): ConnectorSecrets {
  return emptyConnectorSecrets();
}

/** Exported so tests can assert we never request marketing/settings scopes. */
export function hubspotOauthRequestsForbiddenScope(): boolean {
  const requested = new Set<string>(HUBSPOT_OAUTH_SCOPES);
  return FORBIDDEN_HUBSPOT_SCOPES.some((scope) => requested.has(scope));
}
