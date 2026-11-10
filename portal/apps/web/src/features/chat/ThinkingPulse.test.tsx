import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  shouldShowThinkingPulse,
  THINKING_PULSE_KEYWORDS,
  THINKING_PULSE_ROTATE_MS,
  ThinkingPulse,
} from "./ThinkingPulse.js";

describe("shouldShowThinkingPulse", () => {
  it("shows while streaming with no answer yet", () => {
    expect(
      shouldShowThinkingPulse({ isStreaming: true, hasAnswer: false }),
    ).toBe(true);
  });

  it("hides when final answer content is present", () => {
    expect(
      shouldShowThinkingPulse({ isStreaming: true, hasAnswer: true }),
    ).toBe(false);
  });

  it("hides when streaming ends (final or error close)", () => {
    expect(
      shouldShowThinkingPulse({ isStreaming: false, hasAnswer: false }),
    ).toBe(false);
    expect(
      shouldShowThinkingPulse({ isStreaming: false, hasAnswer: true }),
    ).toBe(false);
  });

  it("hides when isStreaming is undefined", () => {
    expect(shouldShowThinkingPulse({ hasAnswer: false })).toBe(false);
  });
});

describe("ThinkingPulse", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders status chip with data-testid and aria-live polite", () => {
    render(<ThinkingPulse />);
    const el = screen.getByTestId("chat-thinking-pulse");
    expect(el).toBeTruthy();
    expect(el.getAttribute("role")).toBe("status");
    expect(el.getAttribute("aria-live")).toBe("polite");
    expect(el.getAttribute("aria-label")?.toLowerCase()).toMatch(/thinking|working|cooking|planning|drafting/);
    expect(el.textContent?.toLowerCase()).toMatch(
      /thinking|working|cooking|planning|drafting/,
    );
  });

  it("is not a tool-call row (no tool testids / buttons)", () => {
    render(<ThinkingPulse />);
    const el = screen.getByTestId("chat-thinking-pulse");
    expect(el.tagName.toLowerCase()).toBe("div");
    expect(el.querySelector("button")).toBeNull();
    expect(el.getAttribute("data-testid")).toBe("chat-thinking-pulse");
  });

  it("rotates keywords on the interval", () => {
    const keywords = ["thinking", "working", "cooking"] as const;
    render(
      <ThinkingPulse
        keywords={keywords}
        rotateMs={THINKING_PULSE_ROTATE_MS}
        initialIndex={0}
      />,
    );
    expect(screen.getByTestId("chat-thinking-pulse").textContent).toMatch(
      /thinking/i,
    );

    act(() => {
      vi.advanceTimersByTime(THINKING_PULSE_ROTATE_MS);
    });
    expect(screen.getByTestId("chat-thinking-pulse").textContent).toMatch(
      /working/i,
    );

    act(() => {
      vi.advanceTimersByTime(THINKING_PULSE_ROTATE_MS);
    });
    expect(screen.getByTestId("chat-thinking-pulse").textContent).toMatch(
      /cooking/i,
    );

    act(() => {
      vi.advanceTimersByTime(THINKING_PULSE_ROTATE_MS);
    });
    expect(screen.getByTestId("chat-thinking-pulse").textContent).toMatch(
      /thinking/i,
    );
  });

  it("renders nothing when active=false", () => {
    render(<ThinkingPulse active={false} />);
    expect(screen.queryByTestId("chat-thinking-pulse")).toBeNull();
  });

  it("exports the default cooking keyword set", () => {
    expect(THINKING_PULSE_KEYWORDS).toEqual([
      "thinking",
      "working",
      "cooking",
      "planning",
      "drafting",
    ]);
  });
});
