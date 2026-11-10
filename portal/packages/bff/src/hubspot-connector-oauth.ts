/**
 * HubSpot connector OAuth start URL (lp-xhf4.10).
 *
 * PKCE S256. Consent is the six CRM objects + identity.
 * Callback HTML/JSON live in connector-oauth.ts and omit refresh tokens.
 */
export const HUBSPOT_OAUTH_AUTHORIZE_URL =
  "https://app.hubspot.com/oauth/authorize" as const;

export const HUBSPOT_OAUTH_SCOPES = [
  "oauth",
  "crm.objects.contacts.read",
  "crm.objects.contacts.write",
  "crm.objects.companies.read",
  "crm.objects.companies.write",
  "crm.objects.deals.read",
  "crm.objects.deals.write",
] as const;

export const HUBSPOT_CRM_OBJECTS = [
  "contacts",
  "companies",
  "deals",
  "notes",
  "tasks",
  "meetings",
] as const;

export function hubspotOauthScopeParam(): string {
  return HUBSPOT_OAUTH_SCOPES.join(" ");
}

export function buildHubSpotConnectorAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: hubspotOauthScopeParam(),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${HUBSPOT_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

export function hubspotAuthorizeUrlIncludesCrmScopes(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const scope = parsed.searchParams.get("scope") ?? "";
  const granted = new Set(scope.split(/\s+/).filter(Boolean));
  return HUBSPOT_OAUTH_SCOPES.filter((item) => item !== "oauth").every((item) =>
    granted.has(item),
  );
}
