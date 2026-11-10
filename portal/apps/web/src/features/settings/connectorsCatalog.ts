/**
 * Connectors page model (lp-xhf4.4 / lp-hdzm.28).
 *
 * The SaaS list is person grants ∩ onboarded rows, including registry ids.
 * First-class ids keep custom runtimes. Host tools still bind only to
 * first-class connectors. Models are not part of this page.
 */

export const FIRST_CLASS_CONNECTOR_IDS = [
  "google",
  "hubspot",
  "whatsapp",
  "github",
] as const;
export type FirstClassConnectorId = (typeof FIRST_CLASS_CONNECTOR_IDS)[number];

/** Live ids are grant rows (canonical slugs), not the first-class four. */
export const CONNECTOR_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
export type ConnectorId = string;

/** First-class custom runtimes. Live list is GET /api/connectors grants. */
export const CONNECTOR_IDS = FIRST_CLASS_CONNECTOR_IDS;

export function isFirstClassConnectorId(
  value: string,
): value is FirstClassConnectorId {
  return (FIRST_CLASS_CONNECTOR_IDS as readonly string[]).includes(value);
}

export function isConnectorId(value: unknown): value is ConnectorId {
  return typeof value === "string" && CONNECTOR_ID_PATTERN.test(value);
}

export function connectorLabel(id: string, fallback?: string | null): string {
  if (isFirstClassConnectorId(id)) {
    return CONNECTOR_LABELS[id];
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

export const CONNECTION_STATUSES = [
  "not_connected",
  "pairing",
  "connected",
  "needs_reauth",
] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export type ConnectorRuntime = "api" | "cli" | "mcp" | "skill";

export const CONNECTOR_LABELS: Record<string, string> = {
  google: "Google",
  hubspot: "HubSpot",
  whatsapp: "WhatsApp",
  github: "GitHub",
};

export const CONNECTOR_RUNTIMES: Record<
  FirstClassConnectorId,
  readonly ConnectorRuntime[]
> = {
  google: ["cli", "skill"],
  hubspot: ["api", "cli", "skill"],
  whatsapp: ["cli", "skill"],
  github: ["cli", "skill"],
};

export type SpaConnectorStatus = {
  connector_id: ConnectorId;
  label?: string;
  status: ConnectionStatus;
  account_label: string | null;
  sticky: Record<string, true>;
  entitled: boolean;
  role_granted: boolean;
  hubspot_portal_id: string | null;
};

export type HostToolKind = "skill" | "mcp" | "cli";

export type HostTool = {
  kind: HostToolKind;
  id: string;
  name: string;
  path?: string;
  command?: string;
  bin?: string;
  enabled?: boolean;
};

export type BoundHostTool = HostTool & {
  connector_id: FirstClassConnectorId;
};

export type SaasConnectorRow = {
  kind: "saas";
  connector_id: ConnectorId;
  label: string;
  runtimes: readonly ConnectorRuntime[];
  status: ConnectionStatus;
  account_label: string | null;
  sticky: Record<string, true>;
  bound_tools: BoundHostTool[];
};

export type OnThisBrainRow = HostTool & {
  kind: "on_this_brain";
  tool_kind: HostToolKind;
};

export type ConnectorsPageModel = {
  saas: SaasConnectorRow[];
  on_this_brain: OnThisBrainRow[];
};

const BINDING_PREFIXES: readonly {
  connector_id: FirstClassConnectorId;
  prefixes: readonly string[];
}[] = [
  { connector_id: "google", prefixes: ["gws-", "gws/", "gmail"] },
  { connector_id: "hubspot", prefixes: ["hubspot", "hs-"] },
  { connector_id: "whatsapp", prefixes: ["wacli", "whatsapp"] },
  { connector_id: "github", prefixes: ["gh-", "github"] },
];

const BINDING_SEGMENTS: readonly {
  connector_id: FirstClassConnectorId;
  segments: readonly string[];
}[] = [
  { connector_id: "google", segments: ["gws", "gmail"] },
  { connector_id: "hubspot", segments: ["hubspot"] },
  { connector_id: "whatsapp", segments: ["wacli", "whatsapp"] },
  { connector_id: "github", segments: ["gh", "github"] },
];

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replaceAll("\\", "/");
}

function basename(token: string): string {
  const parts = token.split("/").filter(Boolean);
  return parts[parts.length - 1] || token;
}

/**
 * Map a host skill / MCP / CLI to a v1 connector, or null if unbound.
 * Prefix and path-segment table; not a free-text config name.
 */
export function bindHostTool(tool: HostTool): FirstClassConnectorId | null {
  const candidates = [tool.id, tool.name, tool.path, tool.command, tool.bin]
    .filter((value): value is string => typeof value === "string" && value.trim() !== "")
    .map(normalizeToken);

  for (const token of candidates) {
    const base = basename(token);
    for (const { connector_id, prefixes } of BINDING_PREFIXES) {
      for (const prefix of prefixes) {
        if (base === prefix.replace(/[-/]$/, "") || base.startsWith(prefix)) {
          return connector_id;
        }
      }
    }
    const segments = token.split("/").filter(Boolean);
    for (const { connector_id, segments: wanted } of BINDING_SEGMENTS) {
      if (wanted.some((segment) => segments.includes(segment) || base === segment)) {
        return connector_id;
      }
    }
  }
  return null;
}

export function connectorIsEntitled(row: SpaConnectorStatus): boolean {
  return row.entitled === true && row.role_granted === true;
}

export type BuildConnectorsPageModelInput = {
  connectors: readonly SpaConnectorStatus[];
  skills?: readonly {
    id: string;
    name: string;
    path?: string;
    enabled?: boolean;
  }[];
  mcp_servers?: readonly {
    name: string;
    transport?: string;
    command?: string;
    enabled?: boolean;
  }[];
  integrations?: readonly {
    id: string;
    name: string;
    type?: string;
    bin?: string;
    path?: string;
  }[];
};

function asHostTools(input: BuildConnectorsPageModelInput): HostTool[] {
  const tools: HostTool[] = [];
  for (const skill of input.skills ?? []) {
    tools.push({
      kind: "skill",
      id: skill.id,
      name: skill.name,
      path: skill.path,
      enabled: skill.enabled,
    });
  }
  for (const server of input.mcp_servers ?? []) {
    tools.push({
      kind: "mcp",
      id: server.name,
      name: server.name,
      command: server.command,
      enabled: server.enabled,
    });
  }
  for (const integration of input.integrations ?? []) {
    tools.push({
      kind: "cli",
      id: integration.id,
      name: integration.name,
      path: integration.path,
      bin: integration.bin,
    });
  }
  return tools;
}

/**
 * Project BFF connector status + settings snapshot into the Connectors page.
 * SaaS rows are the grant list (onboarded ∧ person-granted), including
 * registry ids. Bound tools never sit as sibling catalog rows.
 */
export function buildConnectorsPageModel(
  input: BuildConnectorsPageModelInput,
): ConnectorsPageModel {
  const boundByConnector = new Map<FirstClassConnectorId, BoundHostTool[]>(
    FIRST_CLASS_CONNECTOR_IDS.map((id) => [id, []]),
  );
  const onThisBrain: OnThisBrainRow[] = [];

  for (const tool of asHostTools(input)) {
    const connectorId = bindHostTool(tool);
    if (connectorId) {
      boundByConnector.get(connectorId)!.push({ ...tool, connector_id: connectorId });
      continue;
    }
    onThisBrain.push({
      ...tool,
      kind: "on_this_brain",
      tool_kind: tool.kind,
    });
  }

  const saas: SaasConnectorRow[] = [];
  for (const status of input.connectors) {
    if (!isConnectorId(status.connector_id) || !connectorIsEntitled(status)) {
      continue;
    }
    const connectorId = status.connector_id;
    saas.push({
      kind: "saas",
      connector_id: connectorId,
      label: connectorLabel(connectorId, status.label),
      runtimes: isFirstClassConnectorId(connectorId)
        ? CONNECTOR_RUNTIMES[connectorId]
        : [],
      status: status.status,
      account_label: status.account_label,
      sticky: status.sticky,
      bound_tools: isFirstClassConnectorId(connectorId)
        ? (boundByConnector.get(connectorId) ?? [])
        : [],
    });
  }

  return { saas, on_this_brain: onThisBrain };
}

export function connectionStatusLabel(status: ConnectionStatus): string {
  switch (status) {
    case "not_connected":
      return "Not connected";
    case "pairing":
      return "Pairing";
    case "connected":
      return "Connected";
    case "needs_reauth":
      return "Needs reauth";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
