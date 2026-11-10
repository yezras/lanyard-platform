/**
 * Chat Connect wizard (lp-xhf4.8).
 *
 * Portal-owned MCQ: Connect opens OAuth in a new tab; Cancel/TTL never
 * auto-sends the stored tool. Page Connect does not use this session.
 */
import type { McqChoice } from "../../api/types.js";

export const CONNECTOR_WIZARD_MCQ_PREFIX = "cc-needs_auth-" as const;

export type ConnectorChatWizardStep =
  | "needs_auth"
  | "waiting_oauth"
  | "resuming"
  | "done"
  | "cancelled"
  | "expired";

export type ConnectorChatWizardSession = {
  sessionId: string;
  connectorId: "google" | "hubspot" | "whatsapp";
  threadId: string;
  step: ConnectorChatWizardStep;
  tool: string;
  args: string[];
  expiresAt: number;
  statusMessage: string;
  oauthUrl: string | null;
  popupBlocked: boolean;
};

export type ConnectorWizardApplyResult =
  | {
      ok: true;
      session: ConnectorChatWizardSession;
      shouldOpenOAuth: boolean;
      shouldCancelPending: boolean;
      shouldResume: boolean;
      nextMcq: {
        mcq_id: string;
        content: string;
        choices: McqChoice[];
      } | null;
      assistantMessage: string | null;
    }
  | { ok: false; session: ConnectorChatWizardSession; error: string };

export function isConnectorChatWizardMcqId(mcqId: string): boolean {
  return mcqId.startsWith(CONNECTOR_WIZARD_MCQ_PREFIX);
}

export function connectorWizardMcqId(
  connectorId: ConnectorChatWizardSession["connectorId"],
  threadId: string,
): string {
  return `${CONNECTOR_WIZARD_MCQ_PREFIX}${connectorId}-${threadId}`;
}

export function createConnectorChatWizardSession(input: {
  connectorId: ConnectorChatWizardSession["connectorId"];
  threadId: string;
  tool: string;
  args: string[];
  expiresAt: number;
  content?: string;
}): ConnectorChatWizardSession {
  const name = input.connectorId === "google" ? "Google" : input.connectorId;
  return {
    sessionId: connectorWizardMcqId(input.connectorId, input.threadId),
    connectorId: input.connectorId,
    threadId: input.threadId,
    step: "needs_auth",
    tool: input.tool,
    args: [...input.args],
    expiresAt: input.expiresAt,
    statusMessage:
      input.content ??
      `Connect ${name} to continue this tool. The chat stays here — Google opens in a new tab.`,
    oauthUrl: null,
    popupBlocked: false,
  };
}

export function connectorWizardChoices(
  connectorId: ConnectorChatWizardSession["connectorId"],
): McqChoice[] {
  const name = connectorId === "google" ? "Google" : connectorId;
  return [
    { id: "connect", label: `Connect ${name}` },
    { id: "cancel", label: "Cancel" },
  ];
}

export function applyConnectorWizardChoice(
  session: ConnectorChatWizardSession,
  selection: { mcq_id: string; choice_id: string },
  now = Date.now(),
): ConnectorWizardApplyResult {
  if (selection.mcq_id !== session.sessionId) {
    return { ok: false, session, error: "mcq_id does not match this Connect wizard" };
  }
  if (session.step !== "needs_auth") {
    return { ok: false, session, error: "Connect wizard is not waiting for a choice" };
  }
  if (now >= session.expiresAt) {
    const expired: ConnectorChatWizardSession = {
      ...session,
      step: "expired",
      statusMessage: "Google connected. The pending tool was not sent.",
    };
    return {
      ok: true,
      session: expired,
      shouldOpenOAuth: false,
      shouldCancelPending: true,
      shouldResume: false,
      nextMcq: null,
      assistantMessage: expired.statusMessage,
    };
  }
  if (selection.choice_id === "cancel") {
    const cancelled: ConnectorChatWizardSession = {
      ...session,
      step: "cancelled",
      statusMessage: "Connect cancelled. You can connect later from Connectors.",
    };
    return {
      ok: true,
      session: cancelled,
      shouldOpenOAuth: false,
      shouldCancelPending: true,
      shouldResume: false,
      nextMcq: null,
      assistantMessage: cancelled.statusMessage,
    };
  }
  if (selection.choice_id !== "connect") {
    return { ok: false, session, error: "Unknown Connect wizard choice" };
  }
  const waiting: ConnectorChatWizardSession = {
    ...session,
    step: "waiting_oauth",
    statusMessage: "Waiting for Google in the new tab…",
  };
  return {
    ok: true,
    session: waiting,
    shouldOpenOAuth: true,
    shouldCancelPending: false,
    shouldResume: false,
    nextMcq: null,
    assistantMessage: waiting.statusMessage,
  };
}

export function markConnectorOAuthOpened(
  session: ConnectorChatWizardSession,
  input: { url: string; opened: boolean },
): ConnectorChatWizardSession {
  return {
    ...session,
    oauthUrl: input.url,
    popupBlocked: !input.opened,
    statusMessage: input.opened
      ? session.statusMessage
      : "Pop-up blocked. Use Open Google below — still a new tab, this thread stays.",
  };
}

export function applyConnectorOAuthSuccess(
  session: ConnectorChatWizardSession,
  now = Date.now(),
): ConnectorWizardApplyResult {
  if (session.step === "cancelled") {
    return {
      ok: true,
      session,
      shouldOpenOAuth: false,
      shouldCancelPending: false,
      shouldResume: false,
      nextMcq: null,
      assistantMessage: "Google connected. The pending tool was not sent.",
    };
  }
  if (session.step !== "waiting_oauth" && session.step !== "needs_auth") {
    return {
      ok: true,
      session,
      shouldOpenOAuth: false,
      shouldCancelPending: false,
      shouldResume: false,
      nextMcq: null,
      assistantMessage: null,
    };
  }
  if (now >= session.expiresAt) {
    const expired: ConnectorChatWizardSession = {
      ...session,
      step: "expired",
      statusMessage: "Google connected. The pending tool was not sent.",
    };
    return {
      ok: true,
      session: expired,
      shouldOpenOAuth: false,
      shouldCancelPending: true,
      shouldResume: false,
      nextMcq: null,
      assistantMessage: expired.statusMessage,
    };
  }
  const resuming: ConnectorChatWizardSession = {
    ...session,
    step: "resuming",
    statusMessage: "Google connected. Resuming the stored tool only.",
  };
  return {
    ok: true,
    session: resuming,
    shouldOpenOAuth: false,
    shouldCancelPending: false,
    shouldResume: true,
    nextMcq: null,
    assistantMessage: resuming.statusMessage,
  };
}

export function markConnectorResumeFinished(
  session: ConnectorChatWizardSession,
  resumed: boolean,
): ConnectorChatWizardSession {
  return {
    ...session,
    step: "done",
    statusMessage: resumed
      ? "Google connected. Resuming the stored tool only."
      : "Google connected. The pending tool was not sent.",
  };
}

export function openConnectorOAuthTab(url: string): { opened: boolean } {
  if (typeof window === "undefined" || typeof window.open !== "function") {
    return { opened: false };
  }
  // No noopener: callback HTML postMessages window.opener.
  const popup = window.open(url, "_blank");
  return { opened: Boolean(popup) };
}

export function googleToolArgvFromChatEvent(event: {
  tool_name?: string | null;
  tool_label?: string | null;
  tool_target?: string | null;
  error_message?: string | null;
  errorMessage?: string | null;
  metadata?: Record<string, unknown> | null;
}): string[] | null {
  const meta = event.metadata ?? {};
  const metaArgv = meta.argv;
  if (Array.isArray(metaArgv) && metaArgv.every((item) => typeof item === "string")) {
    if (looksLikeGoogleArgv(metaArgv)) {
      return metaArgv as string[];
    }
  }
  const target = typeof event.tool_target === "string" ? event.tool_target.trim() : "";
  if (target) {
    const argv = target.split(/\s+/).filter(Boolean);
    if (looksLikeGoogleArgv(argv)) {
      return argv;
    }
  }
  const blob = [
    event.tool_name,
    event.tool_label,
    event.tool_target,
    event.error_message,
    event.errorMessage,
    typeof meta.tool_name === "string" ? meta.tool_name : "",
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/\b(gws|gmail|gws-gmail)\b/.test(blob)) {
    return ["gws", "gmail", "users", "drafts", "create"];
  }
  return null;
}

function looksLikeGoogleArgv(argv: readonly string[]): boolean {
  const blob = argv.join(" ").toLowerCase();
  return /\b(gws|gmail)\b/.test(blob);
}

export function formatConnectorResumePrompt(tool: string, args: string[]): string {
  return `Resume only this Google tool (do not replay the previous turn): ${[tool, ...args].join(" ")}`;
}
