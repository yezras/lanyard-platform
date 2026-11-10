import { describe, expect, it } from "vitest";

import type { ChatTimelineItem } from "../../hooks/useChatEvents.js";

import {
  deriveThreadResponseStatus,
  statusDotFromThreadStatus,
} from "./threadResponseStatus.js";

describe("statusDotFromThreadStatus", () => {
  it("maps generating to accent + pulse with a11y label", () => {
    expect(statusDotFromThreadStatus("generating")).toEqual({
      variant: "accent",
      isPulsing: true,
      label: "Generating…",
    });
  });

  it("maps success / error / neutral / off (and undefined) with labels", () => {
    expect(statusDotFromThreadStatus("success")).toEqual({
      variant: "success",
      label: "Response complete",
    });
    expect(statusDotFromThreadStatus("error")).toEqual({
      variant: "error",
      label: "Response failed",
    });
    expect(statusDotFromThreadStatus("neutral")).toEqual({
      variant: "neutral",
      label: "Idle",
    });
    expect(statusDotFromThreadStatus("off")).toEqual({
      variant: "neutral",
      label: "Off",
    });
    expect(statusDotFromThreadStatus(undefined)).toEqual({
      variant: "neutral",
      label: "Idle",
    });
  });
});

describe("deriveThreadResponseStatus", () => {
  it("returns null when idle (nothing observed)", () => {
    expect(deriveThreadResponseStatus([])).toBeNull();
  });

  it("returns generating while isSending", () => {
    expect(
      deriveThreadResponseStatus([], { isSending: true }),
    ).toBe("generating");
  });

  it("returns error when hasSendError", () => {
    expect(
      deriveThreadResponseStatus([], { hasSendError: true }),
    ).toBe("error");
  });

  it("returns generating for an in-flight user message", () => {
    const items: ChatTimelineItem[] = [
      {
        type: "user",
        id: "u1",
        content: "Hello",
        status: "sending",
      },
    ];
    expect(deriveThreadResponseStatus(items)).toBe("generating");
  });

  it("returns generating while waiting after user send", () => {
    const items: ChatTimelineItem[] = [
      {
        type: "user",
        id: "u1",
        content: "Hello",
        status: "sent",
      },
    ];
    expect(deriveThreadResponseStatus(items)).toBe("generating");
  });

  it("returns error for failed user send", () => {
    const items: ChatTimelineItem[] = [
      {
        type: "user",
        id: "u1",
        content: "Hello",
        status: "error",
      },
    ];
    expect(deriveThreadResponseStatus(items)).toBe("error");
  });

  it("returns generating for an open assistant turn", () => {
    const items: ChatTimelineItem[] = [
      { type: "user", id: "u1", content: "Hello", status: "sent" },
      {
        type: "assistant_turn",
        id: "a1",
        toolCalls: [{ key: "t1", name: "search", status: "running" }],
        content: "",
        isStreaming: true,
      },
    ];
    expect(deriveThreadResponseStatus(items)).toBe("generating");
  });

  it("returns success when the last assistant turn is complete", () => {
    const items: ChatTimelineItem[] = [
      { type: "user", id: "u1", content: "Hello", status: "sent" },
      {
        type: "assistant_turn",
        id: "a1",
        toolCalls: [{ key: "t1", name: "search", status: "complete" }],
        content: "Done.",
        isStreaming: false,
      },
    ];
    expect(deriveThreadResponseStatus(items)).toBe("success");
  });
});
