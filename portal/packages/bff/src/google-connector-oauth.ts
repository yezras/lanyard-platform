/**
 * Google connector OAuth start/callback (lp-xhf4.7).
 *
 * PKCE S256. Signed state binds tenant + user + verifier.
 * Consent is Gmail + Calendar + full Drive, never drive.file-only.
 * Callback HTML/JSON never includes refresh tokens.
 */
import { createHash, randomBytes } from "node:crypto";

import type { OauthConnectorId } from "./connectors.js";


export const GOOGLE_OAUTH_AUTHORIZE_URL =
  "https://accounts.google.com/o/oauth2/v2/auth" as const;

export const GOOGLE_DRIVE_SCOPE =
  "https://www.googleapis.com/auth/drive" as const;

export const GOOGLE_DRIVE_FILE_SCOPE =
  "https://www.googleapis.com/auth/drive.file" as const;

export const GOOGLE_WORKSPACE_OAUTH_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  GOOGLE_DRIVE_SCOPE,
] as const;

export const CONNECTOR_OAUTH_MESSAGE_TYPE = "lanyard.connector.oauth" as const;

export type PkcePair = {
  verifier: string;
  challenge: string;
  method: "S256";
};

export type ConnectorGoogleOAuthState = {
  kind: "connector_oauth";
  connector_id: "google";
  tenant_id: string;
  user_id: string;
  thread_id: string;
  redirect_uri: string;
  code_verifier: string;
};

export function createPkcePair(): PkcePair {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge, method: "S256" };
}

export function googleWorkspaceScopeParam(): string {
  return GOOGLE_WORKSPACE_OAUTH_SCOPES.join(" ");
}

export function googleAuthorizeUrlIncludesWorkspaceScopes(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const scope = parsed.searchParams.get("scope") ?? "";
  const granted = new Set(scope.split(/\s+/).filter(Boolean));
  if (granted.has(GOOGLE_DRIVE_FILE_SCOPE) && !granted.has(GOOGLE_DRIVE_SCOPE)) {
    return false;
  }
  return GOOGLE_WORKSPACE_OAUTH_SCOPES.every((item) => granted.has(item));
}

export function connectorGoogleOAuthState(input: {
  tenantId: string;
  userId: string;
  redirectUri: string;
  codeVerifier: string;
  threadId?: string;
}): Record<string, string> {
  return {
    kind: "connector_oauth",
    connector_id: "google",
    tenant_id: input.tenantId,
    user_id: input.userId,
    thread_id: input.threadId ?? "",
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  };
}

export function parseConnectorGoogleOAuthState(
  raw: Record<string, string> | null,
): ConnectorGoogleOAuthState | null {
  if (!raw) return null;
  if (raw.kind !== "connector_oauth") return null;
  if (raw.connector_id !== "google") return null;
  const tenant_id = raw.tenant_id?.trim() ?? "";
  const user_id = raw.user_id?.trim() ?? "";
  const redirect_uri = raw.redirect_uri?.trim() ?? "";
  const code_verifier = raw.code_verifier?.trim() ?? "";
  if (!tenant_id || !user_id || !redirect_uri || !code_verifier) {
    return null;
  }
  return {
    kind: "connector_oauth",
    connector_id: "google",
    tenant_id,
    user_id,
    thread_id: raw.thread_id ?? "",
    redirect_uri,
    code_verifier,
  };
}

export function buildGoogleConnectorAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: googleWorkspaceScopeParam(),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
  });
  return `${GOOGLE_OAUTH_AUTHORIZE_URL}?${params.toString()}`;
}

export function connectorOAuthCallbackRedirectPath(
  connectorId: OauthConnectorId,
): string {
  return `/api/connectors/${connectorId}/oauth/callback`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export type ConnectorOAuthCallbackView = {
  connector_id: "google";
  status: "connected" | "error";
  account_label: string | null;
  error?: string;
};

export function connectorOAuthCallbackJson(
  view: ConnectorOAuthCallbackView,
): Record<string, string | null> {
  const body: Record<string, string | null> = {
    connector_id: view.connector_id,
    status: view.status,
    account_label: view.account_label,
  };
  if (view.error) {
    body.error = view.error;
  }
  return body;
}

export function connectorOAuthCallbackHtml(
  view: ConnectorOAuthCallbackView,
): string {
  const payload = {
    type: CONNECTOR_OAUTH_MESSAGE_TYPE,
    connector_id: view.connector_id,
    status: view.status,
    account_label: view.account_label,
  };
  const message = JSON.stringify(payload).replaceAll("</", "<\\/");
  const title =
    view.status === "connected" ? "Google connected" : "Google connect failed";
  const bodyText =
    view.status === "connected"
      ? "You can close this tab."
      : escapeHtml(view.error ?? "Google connect failed");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
</head>
<body>
  <p>${bodyText}</p>
  <script>
    (function () {
      var payload = ${message};
      if (window.opener) {
        window.opener.postMessage(payload, window.location.origin);
      }
    })();
  </script>
</body>
</html>
`;
}
