/**
 * Inter-tool thinking/working pulse (lp-95v.6).
 *
 * Claude-style non-tool status chip shown while the agent is active between
 * partials/tools and before the final answer. Rotates short cooking keywords
 * so the UI feels alive without looking like a fake tool-call row.
 */

import { useEffect, useRef, useState } from "react";

import { Text } from "@astryxdesign/core/Text";

/** Keywords rotate while the agent is mid-turn (not tool-call labels). */
export const THINKING_PULSE_KEYWORDS = [
  "thinking",
  "working",
  "cooking",
  "planning",
  "drafting",
] as const;

export type ThinkingPulseKeyword = (typeof THINKING_PULSE_KEYWORDS)[number];

export const THINKING_PULSE_ROTATE_MS = 1600;

export type ThinkingPulseProps = {
  /** When false, render nothing (caller still may unmount). */
  active?: boolean;
  /** Override keyword list (tests / localization). */
  keywords?: readonly string[];
  /** Keyword rotation interval ms. */
  rotateMs?: number;
  /** Start at a fixed index (tests). */
  initialIndex?: number;
};

/**
 * Pure helper: should the inter-tool pulse show for this assistant turn?
 *
 * Visible while the agent turn is open (`isStreaming`) and no final answer
 * text has landed yet. Covers the empty opening ghost, inter-tool gaps, and
 * post-tool wait. Distinct from tool-call rows (not a ChatToolCalls item).
 * Hides on final answer, error close, or when streaming ends.
 *
 * When a tool is actively running the pulse still shows below tool rows so
 * multi-step turns never look "stuck" between SSE events (lp-95v.6 QA).
 */
export function shouldShowThinkingPulse(input: {
  isStreaming?: boolean;
  hasAnswer?: boolean;
}): boolean {
  if (!input.isStreaming) {
    return false;
  }
  if (input.hasAnswer) {
    return false;
  }
  return true;
}

export function ThinkingPulse({
  active = true,
  keywords = THINKING_PULSE_KEYWORDS,
  rotateMs = THINKING_PULSE_ROTATE_MS,
  initialIndex = 0,
}: ThinkingPulseProps) {
  const list =
    keywords.length > 0 ? keywords : (THINKING_PULSE_KEYWORDS as readonly string[]);
  const listRef = useRef(list);
  listRef.current = list;

  const [index, setIndex] = useState(
    () => Math.abs(initialIndex) % Math.max(list.length, 1),
  );

  useEffect(() => {
    if (!active || listRef.current.length <= 1) {
      return;
    }
    const id = window.setInterval(() => {
      const len = listRef.current.length;
      setIndex((prev) => (prev + 1) % len);
    }, rotateMs);
    return () => window.clearInterval(id);
  }, [active, rotateMs]);

  if (!active) {
    return null;
  }

  const len = list.length;
  const keyword = list[index % len] ?? "thinking";
  const label = `${keyword}…`;

  return (
    <div
      className="chat-thinking-pulse"
      data-testid="chat-thinking-pulse"
      role="status"
      aria-live="polite"
      aria-label={`Agent ${keyword}`}
    >
      <span className="chat-thinking-pulse-dot" aria-hidden="true" />
      <Text type="body" color="secondary" className="chat-thinking-pulse-label">
        {label}
      </Text>
    </div>
  );
}
