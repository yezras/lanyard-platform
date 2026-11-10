// Stream connector cards (lp-xhf4.17) — signed frames under the agent bubble.
// Cards are stream objects, not composer-only and not /admin. Ops does not
// finish OAuth or scan QR. Letter marks G/H/W (not brand logos).

export const CONNECTOR_OAUTH_PORTAL_EVENT = "connector.oauth" as const;
export const CONNECTOR_CLI_PORTAL_EVENT = "connector.cli" as const;

export type ConnectorOAuthPhase = "connect" | "connected";

export type ConnectorOAuthEventFields = {
  connector_id: "google" | "hubspot";
  phase: ConnectorOAuthPhase;
  account_label?: string;
  ts: number;
};

export type ConnectorCliEventFields = {
  connector_id: "github";
  device_code: string;
  command: string;
  status: "waiting" | "authorized";
  ts: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickString(
  event: Record<string, unknown>,
  meta: Record<string, unknown>,
  key: string,
): string | undefined {
  const top = event[key];
  if (typeof top === "string" && top.trim()) return top.trim();
  const m = meta[key];
  if (typeof m === "string" && m.trim()) return m.trim();
  return undefined;
}

function pickNumber(
  event: Record<string, unknown>,
  meta: Record<string, unknown>,
  key: string,
): number | undefined {
  const top = event[key];
  if (typeof top === "number") return top;
  const m = meta[key];
  if (typeof m === "number") return m;
  return undefined;
}

export function parseConnectorOAuthEvent(event: {
  type?: string;
  connector_id?: string;
  phase?: string;
  account_label?: string;
  accountLabel?: string;
  ts?: number;
  metadata?: Record<string, unknown>;
}): ConnectorOAuthEventFields | null {
  const meta = isRecord(event.metadata) ? event.metadata : {};
  const rec = event as unknown as Record<string, unknown>;
  const portal =
    event.type === CONNECTOR_OAUTH_PORTAL_EVENT ||
    (typeof meta.portal_event === "string" && meta.portal_event === CONNECTOR_OAUTH_PORTAL_EVENT) ||
    (typeof meta.portal_event === "string" && meta.portal_event.startsWith("connector.oauth"));
  if (!portal) return null;
  const rawId = pickString(rec, meta, "connector_id");
  if (rawId !== "google" && rawId !== "hubspot") return null;
  const rawPhase = pickString(rec, meta, "phase") ?? "connect";
  const phase: ConnectorOAuthPhase = rawPhase === "connected" || rawPhase === "success" ? "connected" : "connect";
  const account_label =
    pickString(rec, meta, "account_label") ?? pickString(rec, meta, "accountLabel");
  const ts = pickNumber(rec, meta, "ts") ?? 0;
  return {
    connector_id: rawId,
    phase,
    ts,
    ...(account_label ? { account_label } : {}),
  };
}

export function parseConnectorCliEvent(event: {
  type?: string;
  connector_id?: string;
  device_code?: string;
  deviceCode?: string;
  code?: string;
  command?: string;
  status?: string;
  phase?: string;
  ts?: number;
  metadata?: Record<string, unknown>;
}): ConnectorCliEventFields | null {
  const meta = isRecord(event.metadata) ? event.metadata : {};
  const rec = event as unknown as Record<string, unknown>;
  const portal =
    event.type === CONNECTOR_CLI_PORTAL_EVENT ||
    (typeof meta.portal_event === "string" && meta.portal_event === CONNECTOR_CLI_PORTAL_EVENT) ||
    (typeof meta.portal_event === "string" && meta.portal_event.startsWith("connector.cli"));
  if (!portal) return null;
  const rawId = pickString(rec, meta, "connector_id") ?? "github";
  if (rawId !== "github") return null;
  const device_code =
    pickString(rec, meta, "device_code") ??
    pickString(rec, meta, "deviceCode") ??
    pickString(rec, meta, "code") ??
    "";
  if (!device_code.trim()) return null;
  const command =
    pickString(rec, meta, "command") ?? "gh auth login --hostname github.com";
  const rawStatus = pickString(rec, meta, "status") ?? pickString(rec, meta, "phase") ?? "waiting";
  const status: ConnectorCliEventFields["status"] = rawStatus === "authorized" ? "authorized" : "waiting";
  const ts = pickNumber(rec, meta, "ts") ?? 0;
  return {
    connector_id: "github",
    device_code: device_code.trim(),
    command,
    status,
    ts,
  };
}

// Helpers for tests / local preview: build synthetic timeline payloads.
export function buildConnectorOAuthConnectPayload(
  connectorId: "google" | "hubspot" = "google",
): ConnectorOAuthEventFields {
  return { connector_id: connectorId, phase: "connect", ts: Date.now() };
}

export function buildConnectorOAuthSuccessPayload(
  accountLabel = "operator@example.com",
  connectorId: "google" | "hubspot" = "google",
): ConnectorOAuthEventFields {
  return { connector_id: connectorId, phase: "connected", account_label: accountLabel, ts: Date.now() };
}

export function buildConnectorCliPayload(
  deviceCode = "XXXX-1234",
  status: ConnectorCliEventFields["status"] = "waiting",
): ConnectorCliEventFields {
  return {
    connector_id: "github",
    device_code: deviceCode,
    command: "gh auth login --hostname github.com",
    status,
    ts: Date.now(),
  };
}
