/**
 * lp-6ty — Agent starting UI helpers (pure).
 */
import { describe, expect, it } from "vitest";

import {
  AGENT_STARTING_MESSAGE,
  agentWakeUiStatusFromLiveEvent,
  isAgentWakeErrorPayload,
  isAgentWakeLiveEvent,
  parseAgentWakeLiveEvent,
  wakeFailureBannerTitle,
} from "./agentStarting.js";
import {
  chatSendErrorFromResponse,
  formatWakeFailureDescription,
  isWakeFailureResponseBody,
} from "../../api/chat.js";
import { shouldShowAgentStartingStatus } from "./AgentStartingStatus.js";

describe("agent starting message (lp-6ty)", () => {
  it("matches BFF user-visible copy", () => {
    expect(AGENT_STARTING_MESSAGE).toBe("Agent starting…");
  });
});

describe("parseAgentWakeLiveEvent", () => {
  it("accepts agent_starting with default message", () => {
    const ev = parseAgentWakeLiveEvent({
      type: "agent_starting",
      instance_id: "inst-1",
      thread_id: "thr-1",
      presence: "offline",
      message: AGENT_STARTING_MESSAGE,
    });
    expect(ev?.type).toBe("agent_starting");
    expect(isAgentWakeLiveEvent(ev)).toBe(true);
    expect(agentWakeUiStatusFromLiveEvent(ev!)).toEqual({
      kind: "starting",
      message: AGENT_STARTING_MESSAGE,
      presence: "offline",
      instanceId: "inst-1",
    });
  });

  it("agent_ready clears UI status", () => {
    const ev = parseAgentWakeLiveEvent({
      type: "agent_ready",
      instance_id: "inst-1",
      thread_id: "thr-1",
      already_online: false,
      wake_joined: true,
    });
    expect(agentWakeUiStatusFromLiveEvent(ev!)).toBeNull();
  });

  it("maps ENSURE_ONLINE_TIMEOUT error to error status", () => {
    const ev = parseAgentWakeLiveEvent({
      type: "error",
      code: "ENSURE_ONLINE_TIMEOUT",
      message: "ensure_online timed out",
      status: 504,
      instance_id: "inst-1",
      thread_id: "thr-1",
    });
    expect(isAgentWakeErrorPayload(ev)).toBe(true);
    expect(agentWakeUiStatusFromLiveEvent(ev!)).toMatchObject({
      kind: "error",
      code: "ENSURE_ONLINE_TIMEOUT",
      message: "ensure_online timed out",
      status: 504,
    });
  });

  it("rejects unrelated chat events", () => {
    expect(
      parseAgentWakeLiveEvent({
        type: "message_send",
        chat_id: "t1",
        content: "hi",
      }),
    ).toBeNull();
    expect(isAgentWakeLiveEvent({ type: "typing" })).toBe(false);
  });
});

describe("shouldShowAgentStartingStatus", () => {
  it("shows when starting and no open assistant turn", () => {
    expect(
      shouldShowAgentStartingStatus({
        agentStarting: true,
        hasOpenAssistantTurn: false,
      }),
    ).toBe(true);
  });

  it("hides when not starting or assistant turn open", () => {
    expect(
      shouldShowAgentStartingStatus({
        agentStarting: false,
        hasOpenAssistantTurn: false,
      }),
    ).toBe(false);
    expect(
      shouldShowAgentStartingStatus({
        agentStarting: true,
        hasOpenAssistantTurn: true,
      }),
    ).toBe(false);
  });
});

describe("wake failure HTTP body (lp-mrh / lp-6ty)", () => {
  it("detects ensure_online phase body", () => {
    expect(
      isWakeFailureResponseBody({
        error: "wake_timeout",
        code: "wake_timeout",
        message: "The agent is taking longer than expected to start.",
        retryable: true,
        retry_guidance: "Wait a few seconds and send again.",
        phase: "ensure_online",
        cp_code: "ENSURE_ONLINE_TIMEOUT",
      }),
    ).toBe(true);
  });

  it("formats message + retry_guidance", () => {
    const text = formatWakeFailureDescription({
      message: "The agent is taking longer than expected to start.",
      retry_guidance: "Wait a few seconds and send again.",
    });
    expect(text).toContain("taking longer");
    expect(text).toContain("Wait a few seconds");
  });

  it("chatSendErrorFromResponse sets isWakeFailure", () => {
    const err = chatSendErrorFromResponse(504, {
      error: "wake_timeout",
      code: "wake_timeout",
      message: "The agent is taking longer than expected to start.",
      retryable: true,
      retry_guidance: "Wait a few seconds and send again.",
      phase: "ensure_online",
    });
    expect(err.isWakeFailure).toBe(true);
    expect(err.code).toBe("wake_timeout");
    expect(err.message).toContain("taking longer");
    expect(err.message).toContain("Wait a few seconds");
    expect(wakeFailureBannerTitle(err.code)).toBe("Agent start timed out");
  });

  it("non-wake HTTP error is not isWakeFailure", () => {
    const err = chatSendErrorFromResponse(502, { error: "Relay down" });
    expect(err.isWakeFailure).toBe(false);
    expect(err.message).toBe("Relay down");
    expect(wakeFailureBannerTitle()).toBe("Agent failed to start");
  });
});
