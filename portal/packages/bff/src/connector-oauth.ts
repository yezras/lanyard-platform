/**
 * Shared connector OAuth PKCE + callback page (lp-xhf4.10).
 *
 * Google and HubSpot use the same signed-state bind and tiny "you can close
 * this" tab. Provider authorize URLs stay in per-connector modules.
 */
import { createHash, randomBytes } from "node:crypto";

import type { OauthConnectorId } from "./connectors.js";

export const CONNECTOR_OAUTH_MESSAGE_TYPE = "lanyard.connector.oauth" as const;

export type PkcePair = {
  verifier: string;
  challenge: string;
  method: "S256";
};

export type ConnectorOAuthState = {
  kind: "connector_oauth";
  connector_id: OauthConnectorId;
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

export function connectorOAuthState(input: {
  connectorId: OauthConnectorId;
  tenantId: string;
  userId: string;
  redirectUri: string;
  codeVerifier: string;
  threadId?: string;
}): Record<string, string> {
  return {
    kind: "connector_oauth",
    connector_id: input.connectorId,
    tenant_id: input.tenantId,
    user_id: input.userId,
    thread_id: input.threadId ?? "",
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  };
}

export function parseConnectorOAuthState(
  raw: Record<string, string> | null,
  expectedConnector: OauthConnectorId,
): ConnectorOAuthState | null {
  if (!raw) return null;
  if (raw.kind !== "connector_oauth") return null;
  if (raw.connector_id !== expectedConnector) return null;
  const tenant_id = raw.tenant_id?.trim() ?? "";
  const user_id = raw.user_id?.trim() ?? "";
  const redirect_uri = raw.redirect_uri?.trim() ?? "";
  const code_verifier = raw.code_verifier?.trim() ?? "";
  if (!tenant_id || !user_id || !redirect_uri || !code_verifier) {
    return null;
  }
  return {
    kind: "connector_oauth",
    connector_id: expectedConnector,
    tenant_id,
    user_id,
    thread_id: raw.thread_id ?? "",
    redirect_uri,
    code_verifier,
  };
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
  connector_id: OauthConnectorId;
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

const CONNECTOR_TITLES: Record<OauthConnectorId, string> = {
  google: "Google",
  hubspot: "HubSpot",
};

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
  const titleName = CONNECTOR_TITLES[view.connector_id];
  const title =
    view.status === "connected"
      ? `${titleName} connected`
      : `${titleName} connect failed`;
  const bodyText =
    view.status === "connected"
      ? "You can close this tab."
      : escapeHtml(view.error ?? `${titleName} connect failed`);
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
