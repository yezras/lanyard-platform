/**
 * Visible “Agent starting…” chip during cold wake (lp-6ty).
 *
 * Reuses the thinking-pulse visual language so the timeline never looks stuck
 * while ensure_online runs (no assistant turn yet). Fixed copy — not rotating
 * cooking keywords.
 */

import { Text } from "@astryxdesign/core/Text";

import { AGENT_STARTING_MESSAGE } from "./agentStarting.js";

export type AgentStartingStatusProps = {
  /** Override label (tests / localization). Default: Agent starting… */
  message?: string;
  /** When false, render nothing. */
  active?: boolean;
};

/**
 * Pure helper: show starting chip when wake status is starting and we are not
 * already rendering a mid-turn thinking pulse / assistant answer.
 */
export function shouldShowAgentStartingStatus(input: {
  agentStarting: boolean;
  /** True when an open assistant turn already owns the thinking pulse. */
  hasOpenAssistantTurn?: boolean;
}): boolean {
  if (!input.agentStarting) {
    return false;
  }
  // Prefer assistant-turn ThinkingPulse once the stream is past wake.
  if (input.hasOpenAssistantTurn) {
    return false;
  }
  return true;
}

export function AgentStartingStatus({
  message = AGENT_STARTING_MESSAGE,
  active = true,
}: AgentStartingStatusProps) {
  if (!active) {
    return null;
  }

  const label = message.trim() || AGENT_STARTING_MESSAGE;

  return (
    <div
      className="chat-thinking-pulse chat-agent-starting"
      data-testid="agent-starting-status"
      role="status"
      aria-live="polite"
      aria-label={label}
    >
      <span className="chat-thinking-pulse-dot" aria-hidden="true" />
      <Text type="body" color="secondary" className="chat-thinking-pulse-label">
        {label}
      </Text>
    </div>
  );
}
