import type { StatusDotVariant } from "@astryxdesign/core/StatusDot";

import type { ChatTimelineItem } from "../../hooks/useChatEvents.js";

/** Session-local sidebar status for a chat thread's latest response. */
export type ThreadResponseStatus =
  | "generating"
  | "success"
  | "error"
  | "neutral";

/**
 * Full sidenav status including scheduled-task explicit Off (lp-lv9.2).
 * Session map stays {@link ThreadResponseStatus}; composite may yield `"off"`.
 */
export type AgentSideNavStatus = ThreadResponseStatus | "off";

export type ThreadStatusDotProps = {
  variant: StatusDotVariant;
  label: string;
  isPulsing?: boolean;
};

export function statusDotFromThreadStatus(
  status: AgentSideNavStatus | undefined,
): ThreadStatusDotProps {
  switch (status) {
    case "generating":
      return {
        variant: "accent",
        isPulsing: true,
        label: "Generating…",
      };
    case "success":
      return {
        variant: "success",
        label: "Response complete",
      };
    case "error":
      return {
        variant: "error",
        label: "Response failed",
      };
    case "off":
      return {
        variant: "neutral",
        label: "Off",
      };
    default:
      return {
        variant: "neutral",
        label: "Idle",
      };
  }
}

function isAssistantTurnOpen(item: Extract<ChatTimelineItem, { type: "assistant_turn" }>): boolean {
  if (item.isStreaming) {
    return true;
  }
  if (item.reasoning?.isStreaming) {
    return true;
  }
  if (
    item.toolCalls.some(
      (call) => call.status === "running" || call.status === "pending",
    )
  ) {
    return true;
  }
  // Empty answer with prior activity still open until message_send finalizes.
  if (!item.content) {
    return true;
  }
  return false;
}

/**
 * Derive session response status from the live timeline + send UI state.
 * Returns `null` when nothing observable has happened yet (keep cached/neutral).
 */
export function deriveThreadResponseStatus(
  items: ChatTimelineItem[],
  options: {
    isSending?: boolean;
    hasSendError?: boolean;
  } = {},
): ThreadResponseStatus | null {
  if (options.hasSendError) {
    return "error";
  }

  if (options.isSending) {
    return "generating";
  }

  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (!item) {
      continue;
    }

    if (item.type === "assistant_turn") {
      return isAssistantTurnOpen(item) ? "generating" : "success";
    }

    if (item.type === "user") {
      if (item.status === "error") {
        return "error";
      }
      if (item.status === "sending" || item.status === "sent") {
        // Awaiting first assistant events after a successful/in-flight send.
        return "generating";
      }
      return null;
    }

    if (item.type === "mcq" || item.type === "tool_approval") {
      // Waiting on the user; not an in-flight assistant response.
      return null;
    }

    if (item.type === "connector.qr") {
      return null;
    }
  }

  return null;
}
