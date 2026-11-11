/**
 * Chat pending connector use (lp-xhf4.8).
 *
 * One pending tool per user. OAuth/QR success resumes that argv only.
 * Page Connect never writes a pending row.
 */
import { classifyCommand, commandTokens } from "./classify.js";
import type { ActionClass, ConnectorId } from "./types.js";

/** TTL minutes from portal-connectors.md §8. */
export const PENDING_CONNECTOR_USE_TTL_MS = 10 * 60 * 1000;

export const GMAIL_DRAFTS_CREATE_ARGV = [
  "gws",
  "gmail",
  "users",
  "drafts",
  "create",
] as const;

export const NEEDS_AUTH_PORTAL_EVENT = "needs_auth" as const;

export type PendingConnectorUse = {
  tenant_id: string;
  user_id: string;
  thread_id: string;
  connector_id: ConnectorId;
  tool: string;
  args: string[];
  action_class: ActionClass | null;
  created_at: number;
  expires_at: number;
};

export type ConnectorChatUseDecision =
  | { kind: "needs_auth"; pending: PendingConnectorUse }
  | { kind: "ready" };

export type ConnectorResumeReason =
  | "cancelled"
  | "expired"
  | "page_connect"
  | "missing";

export type ConnectorResumeDecision =
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
      reason: ConnectorResumeReason;
      message: string;
    };

export type NeedsAuthChoice = {
  id: "connect" | "cancel";
  label: string;
};

export type NeedsAuthWizard = {
  portal_event: typeof NEEDS_AUTH_PORTAL_EVENT;
  connector_id: ConnectorId;
  thread_id: string;
  mcq_id: string;
  content: string;
  choices: [NeedsAuthChoice, NeedsAuthChoice];
};

export function isHealthyConnectorStatus(
  status: string | null | undefined,
): boolean {
  return status === "connected";
}

export function connectorIdForActionClass(
  actionClass: ActionClass,
): ConnectorId {
  switch (actionClass) {
    case "gmail.read":
    case "gmail.draft":
    case "gmail.send":
    case "calendar.read":
    case "calendar.write":
    case "drive.read":
    case "drive.write":
      return "google";
    case "hubspot.read":
    case "hubspot.write":
      return "hubspot";
    case "whatsapp.read":
    case "whatsapp.send":
      return "whatsapp";
    case "github.read":
    case "github.write":
      return "github";
  }
}

export function connectorIdForArgv(
  argv: readonly string[],
): ConnectorId | null {
  const classified = classifyCommand(argv);
  if (!classified.action_class) {
    return null;
  }
  return connectorIdForActionClass(classified.action_class);
}

/**
 * Keep flags; replace a Gmail send prefix with drafts.create so connect
 * never auto-sends.
 */
export function preferPendingGmailDraft(argv: readonly string[]): string[] {
  const classified = classifyCommand(argv);
  if (classified.action_class !== "gmail.send") {
    return argv.map((token) => token);
  }
  const rest: string[] = [];
  let seenFlag = false;
  for (const raw of argv) {
    const token = raw.trim();
    if (!token) {
      continue;
    }
    if (token.startsWith("-") || seenFlag) {
      seenFlag = true;
      rest.push(raw);
    }
  }
  return [...GMAIL_DRAFTS_CREATE_ARGV, ...rest];
}

export function pendingArgv(pending: Pick<PendingConnectorUse, "tool" | "args">): string[] {
  return [pending.tool, ...pending.args];
}

function splitToolArgs(argv: readonly string[]): { tool: string; args: string[] } {
  const normalized = argv.map((token) => token).filter((token) => token.trim());
  const tool = commandTokens(normalized)[0] ?? "gws";
  const first = normalized.findIndex((token) => {
    const base = token.replaceAll("\\", "/").split("/").pop() ?? token;
    return base === tool || token === tool;
  });
  const start = first >= 0 ? first : 0;
  return {
    tool,
    args: normalized.slice(start + 1),
  };
}

export function buildPendingConnectorUse(input: {
  tenant_id: string;
  user_id: string;
  thread_id: string;
  connector_id: ConnectorId;
  argv: readonly string[];
  now?: number;
  ttl_ms?: number;
}): PendingConnectorUse {
  const now = input.now ?? Date.now();
  const ttl = input.ttl_ms ?? PENDING_CONNECTOR_USE_TTL_MS;
  const storedArgv = preferPendingGmailDraft(input.argv);
  const classified = classifyCommand(storedArgv);
  const { tool, args } = splitToolArgs(storedArgv);
  return {
    tenant_id: input.tenant_id,
    user_id: input.user_id,
    thread_id: input.thread_id,
    connector_id: input.connector_id,
    tool,
    args,
    action_class: classified.action_class,
    created_at: now,
    expires_at: now + ttl,
  };
}

export function decideConnectorChatUse(input: {
  tenant_id: string;
  user_id: string;
  thread_id: string;
  connector_id: ConnectorId;
  argv: readonly string[];
  connection_status: string | null | undefined;
  now?: number;
  ttl_ms?: number;
}): ConnectorChatUseDecision {
  if (isHealthyConnectorStatus(input.connection_status)) {
    return { kind: "ready" };
  }
  return {
    kind: "needs_auth",
    pending: buildPendingConnectorUse(input),
  };
}

export function isPendingExpired(
  pending: PendingConnectorUse | null | undefined,
  now = Date.now(),
): boolean {
  return !pending || now >= pending.expires_at;
}

export function connectedNoResumeMessage(
  connectorId: ConnectorId,
  reason: ConnectorResumeReason,
): string {
  const name = connectorDisplayName(connectorId);
  if (reason === "cancelled" || reason === "expired") {
    return `${name} connected. The pending tool was not sent.`;
  }
  return `${name} connected.`;
}

export function connectorDisplayName(connectorId: ConnectorId): string {
  switch (connectorId) {
    case "google":
      return "Google";
    case "hubspot":
      return "HubSpot";
    case "whatsapp":
      return "WhatsApp";
    case "github":
      return "GitHub";
  }
}

export function decideConnectorResume(input: {
  pending: PendingConnectorUse | null;
  connector_id: ConnectorId;
  now?: number;
  cancelled?: boolean;
  source?: "chat" | "page";
}): ConnectorResumeDecision {
  const now = input.now ?? Date.now();
  if (input.source === "page") {
    return {
      kind: "connected_no_resume",
      connector_id: input.connector_id,
      reason: "page_connect",
      message: connectedNoResumeMessage(input.connector_id, "page_connect"),
    };
  }
  if (input.cancelled) {
    return {
      kind: "connected_no_resume",
      connector_id: input.connector_id,
      reason: "cancelled",
      message: connectedNoResumeMessage(input.connector_id, "cancelled"),
    };
  }
  if (!input.pending) {
    return {
      kind: "connected_no_resume",
      connector_id: input.connector_id,
      reason: "missing",
      message: connectedNoResumeMessage(input.connector_id, "missing"),
    };
  }
  if (isPendingExpired(input.pending, now)) {
    return {
      kind: "connected_no_resume",
      connector_id: input.connector_id,
      reason: "expired",
      message: connectedNoResumeMessage(input.connector_id, "expired"),
    };
  }
  if (input.pending.connector_id !== input.connector_id) {
    return {
      kind: "connected_no_resume",
      connector_id: input.connector_id,
      reason: "missing",
      message: connectedNoResumeMessage(input.connector_id, "missing"),
    };
  }
  return {
    kind: "resume",
    connector_id: input.pending.connector_id,
    tool: input.pending.tool,
    args: [...input.pending.args],
    thread_id: input.pending.thread_id,
  };
}

export function needsAuthMcqId(
  connectorId: ConnectorId,
  threadId: string,
): string {
  return `cc-needs_auth-${connectorId}-${threadId}`;
}

export function buildNeedsAuthWizard(input: {
  connector_id: ConnectorId;
  thread_id: string;
}): NeedsAuthWizard {
  const name = connectorDisplayName(input.connector_id);
  return {
    portal_event: NEEDS_AUTH_PORTAL_EVENT,
    connector_id: input.connector_id,
    thread_id: input.thread_id,
    mcq_id: needsAuthMcqId(input.connector_id, input.thread_id),
    content: `Connect ${name} to continue this tool. The chat stays here — Google opens in a new tab.`,
    choices: [
      { id: "connect", label: `Connect ${name}` },
      { id: "cancel", label: "Cancel" },
    ],
  };
}

export function spaPendingConnectorUse(
  pending: PendingConnectorUse,
): {
  tool: string;
  args: string[];
  action_class: ActionClass | null;
  expires_at: number;
  thread_id: string;
} {
  return {
    tool: pending.tool,
    args: [...pending.args],
    action_class: pending.action_class,
    expires_at: pending.expires_at,
    thread_id: pending.thread_id,
  };
}
