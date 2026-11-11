import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatEvent, ChatHistoryEvent } from "../api/types.js";

import {
  applyChatEvent,
  citationsFromSubagentToolCalls,
  citationsFromToolCalls,
  historyEventsToTimelineItems,
  isAssistantTurnOpen,
  isChatResponsePending,
  isVaultFileToolTarget,
  MAX_HISTORY_TOOL_RESULT_CHARS,
  sanitizeHistoryEventForHydrate,
  truncateHistoryToolResult,
  useChatEvents,
  type ChatTimelineAssistantTurn,
  type ChatTimelineItem,
} from "./useChatEvents.js";

/** Default: no durable history (unit tests focus on live SSE). */
const emptyHistory = async (): Promise<ChatHistoryEvent[]> => [];

type Listener = (event: Event) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  withCredentials?: boolean;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, Set<Listener>>();

  constructor(url: string, options?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = options?.withCredentials;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: Listener): void {
    const handlers = this.listeners.get(type) ?? new Set<Listener>();
    handlers.add(handler);
    this.listeners.set(type, handlers);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: string): void {
    const event = { data } as MessageEvent;
    for (const handler of this.listeners.get(type) ?? []) {
      handler(event);
    }
    if (type === "message" && this.onmessage) {
      this.onmessage(event);
    }
  }

  /**
   * Connection-level error (no payload). Named SSE `event: error` frames use
   * `emit("error", json)` instead so handlers receive MessageEvent.data.
   */
  triggerError(): void {
    const event = new Event("error");
    for (const handler of this.listeners.get("error") ?? []) {
      handler(event);
    }
    this.onerror?.();
  }
}

function latestSource(): MockEventSource {
  const source = MockEventSource.instances.at(-1);
  if (!source) {
    throw new Error("Expected MockEventSource instance");
  }
  return source;
}

function emitEvent(
  type: ChatEvent["type"],
  payload: Omit<ChatEvent, "type" | "chat_id">,
) {
  const event: ChatEvent = { type, chat_id: "chat-1", ...payload };
  latestSource().emit(type, JSON.stringify(event));
}

describe("useChatEvents", () => {
  afterEach(() => {
    MockEventSource.instances = [];
  });

  it("connects to the thread events endpoint with credentials", async () => {
    const factory = vi.fn((url: string) => new MockEventSource(url) as unknown as EventSource);

    renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: factory,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => {
      expect(factory).toHaveBeenCalledWith("/api/chat/threads/thread-1/events");
    });
  });
});
