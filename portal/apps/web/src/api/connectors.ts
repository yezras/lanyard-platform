import { apiFetch } from "./client.js";
import { withApiBase } from "./tenantBase.js";
import type {
  ConnectionStatus,
  ConnectorId,
  SpaConnectorStatus,
} from "../features/settings/connectorsCatalog.js";
import {
  CONNECTION_STATUSES,
  isConnectorId,
} from "../features/settings/connectorsCatalog.js";
import {
  parseConnectorsTeam,
  type ConnectorsTeamResponse,
  type SpaRoleConnectorGrant,
} from "../features/settings/connectorsTeam.js";

export const CONNECTOR_OAUTH_MESSAGE_TYPE = "lanyard.connector.oauth" as const;

type ApiErrorBody = { error?: string; message?: string };

export type ConnectorsListResponse = {
  connectors: SpaConnectorStatus[];
};

function isConnectionStatus(value: unknown): value is ConnectionStatus {
  return (
    typeof value === "string" &&
    (CONNECTION_STATUSES as readonly string[]).includes(value)
  );
}

function parseSticky(value: unknown): Record<string, true> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out: Record<string, true> = {};
  for (const [key, flag] of Object.entries(value as Record<string, unknown>)) {
    if (flag === true) {
      out[key] = true;
    }
  }
  return out;
}

function parseConnectorRow(value: unknown): SpaConnectorStatus | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const rec = value as Record<string, unknown>;
  if (!isConnectorId(rec.connector_id)) {
    return null;
  }
  const label = typeof rec.label === "string" && rec.label.trim() !== ""
    ? rec.label
    : undefined;
  return {
    connector_id: rec.connector_id,
    ...(label ? { label } : {}),
    status: isConnectionStatus(rec.status) ? rec.status : "not_connected",
    account_label:
      typeof rec.account_label === "string" ? rec.account_label : null,
    sticky: parseSticky(rec.sticky),
    entitled: rec.entitled === true,
    role_granted: rec.role_granted === true,
    hubspot_portal_id:
      typeof rec.hubspot_portal_id === "string" ? rec.hubspot_portal_id : null,
  };
}

/** Fail-closed parse of GET /api/connectors. Unknown ids dropped; flags default false. */
export function parseConnectorsList(body: unknown): ConnectorsListResponse {
  const rec =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const raw = Array.isArray(rec.connectors) ? rec.connectors : [];
  const connectors: SpaConnectorStatus[] = [];
  for (const item of raw) {
    const row = parseConnectorRow(item);
    if (row) {
      connectors.push(row);
    }
  }
  return { connectors };
}

async function parseError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as ApiErrorBody;
  return body.error ?? body.message ?? fallback;
}

export type SendToolApprovalDecisionInput = {
  approvalId: string;
  decision: "always" | "approve_this_call" | "reject";
};

export async function sendToolApprovalDecision(
  input: SendToolApprovalDecisionInput,
): Promise<{ outcome: string; run: boolean; disconnected: boolean }> {
  const res = await apiFetch(
    `/api/connectors/approval/${input.approvalId}/decide`,
    {
      method: "POST",
      body: JSON.stringify({ decision: input.decision }),
    },
  );
  if (!res.ok) {
    throw new Error(await parseError(res, `Approval failed (${res.status})`));
  }
  return (await res.json()) as {
    outcome: string;
    run: boolean;
    disconnected: boolean;
  };
}

export async function patchConnectorSticky(input: {
  connectorId: ConnectorId;
  actionClass: string;
  enabled: boolean;
}): Promise<SpaConnectorStatus> {
  const res = await apiFetch(`/api/connectors/${input.connectorId}/sticky`, {
    method: "PATCH",
    body: JSON.stringify({
      action_class: input.actionClass,
      enabled: input.enabled,
    }),
  });
  if (!res.ok) {
    throw new Error(await parseError(res, `Clear sticky failed (${res.status})`));
  }
  const row = parseConnectorRow(await res.json());
  if (!row) {
    throw new Error("Clear sticky returned an unknown connector");
  }
  return row;
}

export async function fetchConnectors(): Promise<ConnectorsListResponse> {
  const res = await fetch(withApiBase("/api/connectors"), {
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(await parseError(res, `Connectors list failed (${res.status})`));
  }
  return parseConnectorsList(await res.json());
}

/**
 * GET /api/connectors/team. 401/403 → null (member cannot open Team).
 * Admin payload is fail-closed: status/label/grants/pin only.
 */
export async function fetchConnectorsTeam(): Promise<ConnectorsTeamResponse | null> {
  const res = await fetch(withApiBase("/api/connectors/team"), {
    credentials: "include",
  });
  if (res.status === 401 || res.status === 403) {
    return null;
  }
  if (!res.ok) {
    throw new Error(await parseError(res, `Connectors team failed (${res.status})`));
  }
  return parseConnectorsTeam(await res.json());
}

export async function putConnectorGrant(input: {
  role_id: string;
  connector_id: ConnectorId;
  enabled: boolean;
}): Promise<Pick<SpaRoleConnectorGrant, "role_id" | "connector_id" | "enabled">> {
  const res = await apiFetch("/api/connectors/grants", {
    method: "PUT",
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(await parseError(res, `Connector grant failed (${res.status})`));
  }
  const body = (await res.json()) as Record<string, unknown>;
  if (!isConnectorId(body.connector_id) || typeof body.role_id !== "string") {
    throw new Error("Connector grant response was invalid");
  }
  return {
    role_id: body.role_id,
    connector_id: body.connector_id,
    enabled: body.enabled === true,
  };
}

export async function clearHubSpotPin(): Promise<{ hubspot_portal_id: null }> {
  const res = await apiFetch("/api/connectors/hubspot/pin", {
    method: "PUT",
    body: JSON.stringify({ hubspot_portal_id: null }),
  });
  if (!res.ok) {
    throw new Error(await parseError(res, `HubSpot pin clear failed (${res.status})`));
  }
  return { hubspot_portal_id: null };
}

export type ConnectorDisconnectResponse = {
  connector_id: ConnectorId;
  status: "not_connected";
  revoke_attempted: boolean;
};

export type ConnectorRefreshResponse = {
  connector_id: ConnectorId;
  status: ConnectionStatus;
  account_label: string | null;
  wizard: boolean;
};

function assertNoSecretLeak(rec: Record<string, unknown>): void {
  if (
    typeof rec.oauth_refresh === "string" ||
    typeof rec.refresh_token === "string" ||
    typeof rec.oauth_access === "string" ||
    typeof rec.access_token === "string"
  ) {
    throw new Error("Connector response leaked a secret");
  }
}

export function parseConnectorDisconnect(
  body: unknown,
): ConnectorDisconnectResponse {
  const rec =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  assertNoSecretLeak(rec);
  if (!isConnectorId(rec.connector_id)) {
    throw new Error("Disconnect response missing connector_id");
  }
  return {
    connector_id: rec.connector_id,
    status: "not_connected",
    revoke_attempted: rec.revoke_attempted === true,
  };
}

export function parseConnectorRefresh(body: unknown): ConnectorRefreshResponse {
  const rec =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  assertNoSecretLeak(rec);
  if (!isConnectorId(rec.connector_id)) {
    throw new Error("Refresh response missing connector_id");
  }
  return {
    connector_id: rec.connector_id,
    status: isConnectionStatus(rec.status) ? rec.status : "needs_reauth",
    account_label:
      typeof rec.account_label === "string" ? rec.account_label : null,
    wizard: rec.wizard === true || rec.status === "needs_reauth",
  };
}

export async function disconnectConnector(
  connectorId: ConnectorId,
): Promise<ConnectorDisconnectResponse> {
  const res = await apiFetch(`/api/connectors/${connectorId}/disconnect`, {
    method: "POST",
    body: "{}",
  });
  if (!res.ok) {
    throw new Error(
      await parseError(res, `Connector disconnect failed (${res.status})`),
    );
  }
  return parseConnectorDisconnect(await res.json());
}

export async function refreshConnector(
  connectorId: ConnectorId,
): Promise<ConnectorRefreshResponse> {
  const res = await apiFetch(`/api/connectors/${connectorId}/refresh`, {
    method: "POST",
    body: "{}",
  });
  if (!res.ok) {
    throw new Error(
      await parseError(res, `Connector refresh failed (${res.status})`),
    );
  }
  return parseConnectorRefresh(await res.json());
}

export type ConnectorOAuthStartResponse = {
  connector_id: ConnectorId;
  url: string;
};

export function parseConnectorOAuthStart(
  body: unknown,
): ConnectorOAuthStartResponse {
  const rec =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  if (!isConnectorId(rec.connector_id) || typeof rec.url !== "string" || !rec.url) {
    throw new Error("OAuth start response missing connector url");
  }
  if (
    typeof rec.oauth_refresh === "string" ||
    typeof rec.refresh_token === "string" ||
    typeof rec.code_verifier === "string"
  ) {
    throw new Error("OAuth start response leaked a secret");
  }
  return { connector_id: rec.connector_id, url: rec.url };
}

export async function startConnectorOAuth(
  connectorId: ConnectorId,
  input: { thread_id?: string } = {},
): Promise<ConnectorOAuthStartResponse> {
  const res = await apiFetch(`/api/connectors/${connectorId}/oauth/start`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    throw new Error(
      await parseError(res, `Connector OAuth start failed (${res.status})`),
    );
  }
  return parseConnectorOAuthStart(await res.json());
}

export type ConnectorChatUseNeedsAuth = {
  kind: "needs_auth";
  connector_id: ConnectorId;
  wizard: {
    portal_event: "needs_auth";
    mcq_id: string;
    content: string;
    choices: { id: string; label: string }[];
  };
  pending: {
    tool: string;
    args: string[];
    action_class: string | null;
    expires_at: number;
    thread_id: string;
  };
};

export type ConnectorChatUseReady = {
  kind: "ready";
  connector_id: ConnectorId;
};

export type ConnectorChatUseResponse =
  | ConnectorChatUseNeedsAuth
  | ConnectorChatUseReady;

export function parseConnectorChatUse(body: unknown): ConnectorChatUseResponse {
  const rec =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  if (rec.kind === "ready" && isConnectorId(rec.connector_id)) {
    return { kind: "ready", connector_id: rec.connector_id };
  }
  if (rec.kind !== "needs_auth" || !isConnectorId(rec.connector_id)) {
    throw new Error("Connector chat-use response missing needs_auth wizard");
  }
  const wizardRaw =
    rec.wizard && typeof rec.wizard === "object" && !Array.isArray(rec.wizard)
      ? (rec.wizard as Record<string, unknown>)
      : {};
  const pendingRaw =
    rec.pending && typeof rec.pending === "object" && !Array.isArray(rec.pending)
      ? (rec.pending as Record<string, unknown>)
      : {};
  const choices = Array.isArray(wizardRaw.choices)
    ? wizardRaw.choices
        .filter(
          (item): item is { id: string; label: string } =>
            Boolean(
              item &&
                typeof item === "object" &&
                typeof (item as { id?: unknown }).id === "string" &&
                typeof (item as { label?: unknown }).label === "string",
            ),
        )
        .map((item) => ({ id: item.id, label: item.label }))
    : [];
  const args = Array.isArray(pendingRaw.args)
    ? pendingRaw.args.filter((item): item is string => typeof item === "string")
    : [];
  return {
    kind: "needs_auth",
    connector_id: rec.connector_id,
    wizard: {
      portal_event: "needs_auth",
      mcq_id: typeof wizardRaw.mcq_id === "string" ? wizardRaw.mcq_id : "",
      content: typeof wizardRaw.content === "string" ? wizardRaw.content : "",
      choices,
    },
    pending: {
      tool: typeof pendingRaw.tool === "string" ? pendingRaw.tool : "gws",
      args,
      action_class:
        typeof pendingRaw.action_class === "string" ? pendingRaw.action_class : null,
      expires_at:
        typeof pendingRaw.expires_at === "number" ? pendingRaw.expires_at : 0,
      thread_id:
        typeof pendingRaw.thread_id === "string" ? pendingRaw.thread_id : "",
    },
  };
}

export async function beginConnectorChatUse(
  connectorId: ConnectorId,
  input: { thread_id: string; args: string[]; tool?: string },
): Promise<ConnectorChatUseResponse> {
  const res = await apiFetch(`/api/connectors/${connectorId}/chat-use`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (res.status === 403) {
    throw new Error("Connector chat-use failed closed with 403");
  }
  if (!res.ok) {
    throw new Error(
      await parseError(res, `Connector chat-use failed (${res.status})`),
    );
  }
  return parseConnectorChatUse(await res.json());
}

export type ConnectorPendingResumeResponse =
  | {
      kind: "resume";
      connector_id: ConnectorId;
      tool: string;
      args: string[];
      thread_id: string;
    }
  | {
      kind: "connected_no_resume";
      connector_id: ConnectorId;
      reason: string;
      message: string;
    };

export function parseConnectorPendingResume(
  body: unknown,
): ConnectorPendingResumeResponse {
  const rec =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  if (!isConnectorId(rec.connector_id)) {
    throw new Error("Pending resume missing connector_id");
  }
  if (rec.kind === "resume") {
    const args = Array.isArray(rec.args)
      ? rec.args.filter((item): item is string => typeof item === "string")
      : [];
    return {
      kind: "resume",
      connector_id: rec.connector_id,
      tool: typeof rec.tool === "string" ? rec.tool : "gws",
      args,
      thread_id: typeof rec.thread_id === "string" ? rec.thread_id : "",
    };
  }
  return {
    kind: "connected_no_resume",
    connector_id: rec.connector_id,
    reason: typeof rec.reason === "string" ? rec.reason : "missing",
    message:
      typeof rec.message === "string" ? rec.message : "Google connected.",
  };
}

export async function resumePendingConnectorUse(
  connectorId: ConnectorId,
): Promise<ConnectorPendingResumeResponse> {
  const res = await apiFetch(`/api/connectors/${connectorId}/pending/resume`, {
    method: "POST",
    body: "{}",
  });
  if (!res.ok) {
    throw new Error(
      await parseError(res, `Connector pending resume failed (${res.status})`),
    );
  }
  return parseConnectorPendingResume(await res.json());
}

export async function cancelPendingConnectorUse(
  connectorId: ConnectorId,
): Promise<ConnectorPendingResumeResponse> {
  const res = await apiFetch(`/api/connectors/${connectorId}/pending/cancel`, {
    method: "POST",
    body: "{}",
  });
  if (!res.ok) {
    throw new Error(
      await parseError(res, `Connector pending cancel failed (${res.status})`),
    );
  }
  return parseConnectorPendingResume(await res.json());
}

export function isConnectorOAuthMessage(
  origin: string,
  expectedOrigin: string,
  data: unknown,
): data is {
  type: typeof CONNECTOR_OAUTH_MESSAGE_TYPE;
  connector_id: ConnectorId;
  status: ConnectionStatus | "error";
  account_label: string | null;
} {
  if (origin !== expectedOrigin) {
    return false;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return false;
  }
  const rec = data as Record<string, unknown>;
  return (
    rec.type === CONNECTOR_OAUTH_MESSAGE_TYPE && isConnectorId(rec.connector_id)
  );
}

export type WhatsAppPairResponse = {
  connector_id: "whatsapp";
  status: ConnectionStatus;
  account_label: string | null;
  pairing_id: string;
  llm_status?: string;
  error?: string;
};

export async function startWhatsAppPair(input?: {
  threadId?: string;
}): Promise<WhatsAppPairResponse> {
  const res = await fetch(withApiBase("/api/connectors/whatsapp/pair"), {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(
      input?.threadId ? { thread_id: input.threadId } : {},
    ),
  });
  const body = (await res.json().catch(() => ({}))) as WhatsAppPairResponse & {
    error?: string;
    message?: string;
  };
  if (!res.ok) {
    throw new Error(body.error ?? body.message ?? `WhatsApp pair failed (${res.status})`);
  }
  return body;
}
