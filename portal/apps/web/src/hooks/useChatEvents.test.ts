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

  it("accumulates durable tool calls on an assistant turn (not ephemeral only)", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) => new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      emitEvent("tool_progress", {
        tool_label: "Searching vault",
        tool_name: "vault_search",
        tool_call_id: "tc-1",
        tool_status: "running",
      });
    });
    expect(result.current.toolProgress).toBeNull();
    expect(result.current.items).toEqual([
      {
        type: "assistant_turn",
        id: "streaming",
        content: "",
        isStreaming: true,
        segments: [
          {
            kind: "tool",
            call: {
              key: "tc-1",
              name: "Searching vault",
              technicalName: "vault_search",
              target: "Searching vault",
              status: "running",
            },
          },
        ],
        toolCalls: [
          {
            key: "tc-1",
            name: "Searching vault",
            technicalName: "vault_search",
            target: "Searching vault",
            status: "running",
          },
        ],
      },
    ]);

    act(() => {
      emitEvent("tool_progress", {
        tool_label: "Reading file",
        tool_name: "read_file",
        tool_call_id: "tc-2",
        tool_status: "running",
      });
    });

    const turn = result.current.items[0];
    expect(turn?.type).toBe("assistant_turn");
    if (turn?.type === "assistant_turn") {
      expect(turn.toolCalls).toHaveLength(2);
      expect(turn.toolCalls.map((c) => c.name)).toEqual([
        "Searching vault",
        "Reading file",
      ]);
      expect(turn.toolCalls.map((c) => c.technicalName)).toEqual([
        "vault_search",
        "read_file",
      ]);
    }

    act(() => {
      emitEvent("message_send", {
        message_id: "msg-1",
        content: "Hello from brain",
      });
    });

    const finalized = result.current.items[0];
    expect(finalized).toMatchObject({
      type: "assistant_turn",
      id: "msg-1",
      content: "Hello from brain",
      isStreaming: false,
    });
    if (finalized?.type === "assistant_turn") {
      expect(finalized.toolCalls.every((c) => c.status === "complete")).toBe(
        true,
      );
      expect(finalized.createdAt).toBeTruthy();
    }
  });

  it("upserts richer tool fields (duration, error, diffs, node) by tool_call_id", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) =>
          new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      emitEvent("tool_progress", {
        tool_name: "edit",
        tool_call_id: "tc-edit",
        tool_target: "middleware.ts",
        tool_status: "running",
        node: "cli:remote-server",
      });
    });

    act(() => {
      emitEvent("tool_progress", {
        tool_name: "edit",
        tool_call_id: "tc-edit",
        tool_target: "middleware.ts",
        tool_status: "complete",
        duration: "85ms",
        additions: 8,
        deletions: 2,
        result: "--- a/x\n+++ b/x\n+line",
      });
    });

    const turn = result.current.items[0];
    expect(turn?.type).toBe("assistant_turn");
    if (turn?.type === "assistant_turn") {
      expect(turn.toolCalls).toHaveLength(1);
      expect(turn.toolCalls[0]).toEqual({
        key: "tc-edit",
        name: "Editing a document",
        technicalName: "edit",
        target: "middleware.ts",
        status: "complete",
        duration: "85ms",
        additions: 8,
        deletions: 2,
        node: "cli:remote-server",
        result: "--- a/x\n+++ b/x\n+line",
      });
    }

    act(() => {
      emitEvent("tool_progress", {
        tool_name: "bash",
        tool_call_id: "tc-bash",
        tool_target: "yarn test",
        tool_status: "error",
        errorMessage: "exit code 1",
        duration: "1.2s",
      });
    });

    const withError = result.current.items[0];
    if (withError?.type === "assistant_turn") {
      expect(withError.toolCalls).toHaveLength(2);
      expect(withError.toolCalls[1]).toMatchObject({
        key: "tc-bash",
        name: "Running a command",
        technicalName: "bash",
        target: "yarn test",
        status: "error",
        errorMessage: "exit code 1",
        duration: "1.2s",
      });
    }
  });

  it("applies complete/error mid-turn across multiple tools without finalizing", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) =>
          new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      emitEvent("tool_progress", {
        tool_name: "vault_search",
        tool_call_id: "tc-a",
        tool_label: "Searching vault",
        tool_status: "running",
      });
    });

    act(() => {
      emitEvent("tool_progress", {
        tool_name: "vault_search",
        tool_call_id: "tc-a",
        tool_label: "Searching vault",
        tool_status: "complete",
        duration: "120ms",
      });
    });

    act(() => {
      emitEvent("tool_progress", {
        tool_name: "read_file",
        tool_call_id: "tc-b",
        tool_label: "Reading file",
        tool_status: "running",
      });
    });

    let turn = result.current.items[0];
    expect(turn).toMatchObject({
      type: "assistant_turn",
      id: "streaming",
      isStreaming: true,
    });
    // No message_send yet — turn stays open and streaming.
    expect(result.current.items).toHaveLength(1);
    if (turn?.type === "assistant_turn") {
      expect(turn.toolCalls).toEqual([
        {
          key: "tc-a",
          name: "Searching vault",
          technicalName: "vault_search",
          target: "Searching vault",
          status: "complete",
          duration: "120ms",
        },
        {
          key: "tc-b",
          name: "Reading file",
          technicalName: "read_file",
          target: "Reading file",
          status: "running",
        },
      ]);
    }
    expect(isChatResponsePending(result.current.items, false)).toBe(true);

    act(() => {
      emitEvent("tool_progress", {
        tool_name: "bash",
        tool_call_id: "tc-c",
        tool_target: "yarn test",
        tool_status: "error",
        errorMessage: "exit code 1",
        duration: "800ms",
      });
    });

    turn = result.current.items[0];
    expect(turn).toMatchObject({
      type: "assistant_turn",
      id: "streaming",
      isStreaming: true,
    });
    if (turn?.type === "assistant_turn") {
      expect(turn.toolCalls).toHaveLength(3);
      expect(turn.toolCalls[0]).toMatchObject({
        key: "tc-a",
        status: "complete",
      });
      expect(turn.toolCalls[1]).toMatchObject({
        key: "tc-b",
        status: "running",
      });
      expect(turn.toolCalls[2]).toMatchObject({
        key: "tc-c",
        name: "Running a command",
        technicalName: "bash",
        status: "error",
        errorMessage: "exit code 1",
        duration: "800ms",
      });
    }
    expect(isChatResponsePending(result.current.items, false)).toBe(true);
  });

  it("attributes nested tool_progress with parent_subagent_id (lp-uxy.1)", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) =>
          new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      emitEvent("tool_progress", {
        tool_kind: "subagent",
        subagent_name: "Explore",
        tool_call_id: "sa-1",
        tool_status: "running",
      });
    });
    act(() => {
      emitEvent("tool_progress", {
        tool_name: "read_file",
        tool_call_id: "tc-nested-1",
        tool_status: "running",
        tool_target: "/Notes/a.md",
        metadata: {
          portal_event: "tool_progress",
          parent_subagent_id: "sa-1",
        },
      });
    });
    act(() => {
      emitEvent("tool_progress", {
        tool_name: "read_file",
        tool_call_id: "tc-nested-1",
        tool_status: "complete",
        tool_target: "/Notes/a.md",
        duration: "0.4s",
        metadata: {
          portal_event: "tool_progress",
          parent_subagent_id: "sa-1",
        },
      });
    });

    await waitFor(() => {
      const turn = result.current.items.find(
        (i) => i.type === "assistant_turn",
      );
      expect(turn?.type).toBe("assistant_turn");
      if (turn?.type !== "assistant_turn") return;
      const nested = turn.toolCalls.find((c) => c.key === "tc-nested-1");
      expect(nested).toMatchObject({
        key: "tc-nested-1",
        status: "complete",
        duration: "0.4s",
        parentSubagentId: "sa-1",
      });
      const sa = turn.toolCalls.find((c) => c.key === "sa-1");
      expect(sa?.kind).toBe("subagent");
    });
  });

  it("maps subagent runs as distinct tool call rows", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) =>
          new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      emitEvent("tool_progress", {
        tool_kind: "subagent",
        subagent_name: "researcher",
        tool_label: "Investigate auth flow",
        tool_call_id: "sub-1",
        tool_status: "pending",
      });
    });
    act(() => {
      emitEvent("tool_progress", {
        tool_kind: "subagent",
        subagent_name: "researcher",
        tool_label: "Investigate auth flow",
        tool_call_id: "sub-1",
        tool_status: "running",
      });
    });
    act(() => {
      emitEvent("tool_progress", {
        tool_kind: "subagent",
        subagent_name: "coder",
        tool_label: "Apply patch",
        tool_call_id: "sub-2",
        tool_status: "running",
      });
    });
    act(() => {
      emitEvent("tool_progress", {
        tool_kind: "subagent",
        subagent_name: "researcher",
        tool_label: "Investigate auth flow",
        tool_call_id: "sub-1",
        tool_status: "complete",
        duration: "4.1s",
      });
    });
    act(() => {
      emitEvent("tool_progress", {
        tool_kind: "subagent",
        subagent_name: "coder",
        tool_label: "Apply patch",
        tool_call_id: "sub-2",
        tool_status: "error",
        error_message: "patch rejected",
      });
    });

    const turn = result.current.items[0];
    expect(turn?.type).toBe("assistant_turn");
    if (turn?.type === "assistant_turn") {
      expect(turn.toolCalls).toMatchObject([
        {
          key: "sub-1",
          name: "researcher",
          target: "Investigate auth flow",
          status: "complete",
          duration: "4.1s",
          kind: "subagent",
          subagentStatus: "done",
          subagentIcon: "research",
        },
        {
          key: "sub-2",
          name: "coder",
          target: "Apply patch",
          status: "error",
          errorMessage: "patch rejected",
          kind: "subagent",
          subagentStatus: "failed",
          subagentIcon: "code",
        },
      ]);
      expect(turn.toolCalls[0]?.subagentColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("completes parent spawn/wait tool when linked subagent finishes (lp-dpr.6)", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) =>
          new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      emitEvent("tool_progress", {
        tool_name: "Task",
        tool_call_id: "parent-1",
        tool_label: "Spawn Explore",
        tool_status: "running",
      });
    });
    act(() => {
      emitEvent("tool_progress", {
        tool_kind: "subagent",
        subagent_name: "Explore",
        tool_call_id: "sa-1",
        tool_status: "running",
        tool_target: "Scan policies",
        metadata: { parent_tool_call_id: "parent-1" },
      });
    });

    let turn = result.current.items[0];
    expect(turn?.type).toBe("assistant_turn");
    if (turn?.type === "assistant_turn") {
      expect(turn.toolCalls).toMatchObject([
        {
          key: "parent-1",
          name: "Running a helper agent",
          technicalName: "Task",
          status: "running",
        },
        {
          key: "sa-1",
          name: "Explore",
          status: "running",
          kind: "subagent",
          parentToolCallId: "parent-1",
        },
      ]);
    }

    act(() => {
      emitEvent("tool_progress", {
        tool_kind: "subagent",
        subagent_name: "Explore",
        tool_call_id: "sa-1",
        tool_status: "complete",
        duration: "4.1s",
        result: "ok",
        metadata: { parent_tool_call_id: "parent-1" },
      });
    });

    turn = result.current.items[0];
    expect(turn?.type).toBe("assistant_turn");
    if (turn?.type === "assistant_turn") {
      expect(turn.toolCalls).toMatchObject([
        {
          key: "parent-1",
          name: "Running a helper agent",
          technicalName: "Task",
          status: "complete",
          duration: "4.1s",
          result: "ok",
        },
        {
          key: "sa-1",
          name: "Explore",
          status: "complete",
          duration: "4.1s",
          kind: "subagent",
          subagentStatus: "done",
          parentToolCallId: "parent-1",
        },
      ]);
    }
  });

  it("flips parent to error when linked subagent fails (lp-dpr.6)", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) =>
          new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      emitEvent("tool_progress", {
        tool_name: "wait_for_subagent",
        tool_call_id: "wait-1",
        tool_status: "running",
      });
      emitEvent("tool_progress", {
        tool_kind: "subagent",
        subagent_name: "coder",
        tool_call_id: "sa-err",
        tool_status: "error",
        error_message: "patch rejected",
        duration: "800ms",
        metadata: { parent_tool_call_id: "wait-1" },
      });
    });

    const turn = result.current.items[0];
    expect(turn?.type).toBe("assistant_turn");
    if (turn?.type === "assistant_turn") {
      expect(turn.toolCalls).toMatchObject([
        {
          key: "wait-1",
          status: "error",
          duration: "800ms",
          errorMessage: "patch rejected",
        },
        {
          key: "sa-err",
          status: "error",
          kind: "subagent",
          subagentStatus: "failed",
        },
      ]);
    }
  });

  it("hides self-improve skill_view from toolCalls but keeps other skill_view", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) =>
          new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      emitEvent("tool_progress", {
        tool_name: "skill_view",
        tool_call_id: "tc-si",
        tool_target: "self-improve",
        tool_label: "skill_view: self-improve",
        tool_status: "running",
      });
    });

    expect(result.current.items).toEqual([]);
    expect(result.current.toolProgress).toBeNull();

    act(() => {
      emitEvent("tool_progress", {
        tool_name: "skill_view",
        tool_call_id: "tc-ops",
        tool_target: "self_improve_operations",
        tool_status: "running",
      });
    });

    expect(result.current.items).toEqual([]);

    // Path-qualified forms must also hide (BUG-1 review fix).
    act(() => {
      emitEvent("tool_progress", {
        tool_name: "skill_view",
        tool_call_id: "tc-path-ops",
        tool_target: "software-development/self-improve-operations",
        tool_label:
          "skill_view: software-development/self-improve-operations",
        tool_status: "running",
      });
    });

    expect(result.current.items).toEqual([]);

    act(() => {
      emitEvent("tool_progress", {
        tool_name: "skill_view",
        tool_call_id: "tc-plugin-si",
        tool_target: "plugin:self-improve",
        tool_status: "running",
      });
    });

    expect(result.current.items).toEqual([]);

    act(() => {
      emitEvent("tool_progress", {
        tool_name: "skill_view",
        tool_call_id: "tc-arch",
        tool_target: "architect",
        tool_label: "skill_view: architect",
        tool_status: "running",
      });
    });

    const turn = result.current.items[0];
    expect(turn?.type).toBe("assistant_turn");
    if (turn?.type === "assistant_turn") {
      expect(turn.toolCalls).toHaveLength(1);
      expect(turn.toolCalls[0]).toMatchObject({
        key: "tc-arch",
        name: "Using a skill",
        technicalName: "skill_view",
        target: "architect",
        status: "running",
      });
    }

    // Path-qualified architect remains visible.
    act(() => {
      emitEvent("tool_progress", {
        tool_name: "skill_view",
        tool_call_id: "tc-path-arch",
        tool_target: "software-development/architect",
        tool_label: "skill_view: software-development/architect",
        tool_status: "running",
      });
    });

    const afterPathArch = result.current.items[0];
    if (afterPathArch?.type === "assistant_turn") {
      expect(afterPathArch.toolCalls).toHaveLength(2);
      expect(afterPathArch.toolCalls[1]).toMatchObject({
        key: "tc-path-arch",
        name: "Using a skill",
        technicalName: "skill_view",
        target: "software-development/architect",
        status: "running",
      });
    }

    act(() => {
      emitEvent("tool_progress", {
        tool_name: "skill_manage",
        tool_call_id: "tc-manage-si",
        tool_target: "self-improve",
        tool_status: "complete",
      });
    });

    const afterManage = result.current.items[0];
    if (afterManage?.type === "assistant_turn") {
      expect(afterManage.toolCalls).toHaveLength(2);
      expect(
        afterManage.toolCalls.every(
          (c) =>
            c.name === "Using a skill" && c.technicalName === "skill_view",
        ),
      ).toBe(true);
    }
  });

  it("gracefully falls back for label-only tool_progress", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) =>
          new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      emitEvent("tool_progress", {
        tool_label: "Searching vault",
        tool_status: "running",
      });
    });

    let turn = result.current.items[0];
    expect(turn?.type).toBe("assistant_turn");
    if (turn?.type === "assistant_turn") {
      expect(turn.toolCalls).toEqual([
        {
          key: "label:Searching vault",
          name: "Searching vault",
          target: "Searching vault",
          status: "running",
        },
      ]);
    }

    act(() => {
      emitEvent("tool_progress", {
        tool_label: "Reading notes",
        tool_status: "running",
      });
    });

    turn = result.current.items[0];
    if (turn?.type === "assistant_turn") {
      expect(turn.toolCalls).toHaveLength(2);
      expect(turn.toolCalls[0]?.status).toBe("complete");
      expect(turn.toolCalls[1]).toMatchObject({
        name: "Reading notes",
        status: "running",
      });
    }
  });

  it("streams reasoning with the answer on one continuous turn", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) => new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      emitEvent("reasoning", {
        message_id: "reason-1",
        content: "Considering options…",
      });
    });
    expect(result.current.items).toEqual([
      {
        type: "assistant_turn",
        id: "reason-1",
        content: "",
        isStreaming: true,
        segments: [
          {
            kind: "reasoning",
            key: "reason-1-0",
            content: "Considering options…",
            isStreaming: true,
          },
        ],
        toolCalls: [],
        reasoning: {
          content: "Considering options…",
          isStreaming: true,
        },
      },
    ]);

    act(() => {
      emitEvent("reasoning", {
        message_id: "reason-1",
        content: "Considering options… Picked plan A.",
      });
    });
    expect(result.current.items[0]).toMatchObject({
      type: "assistant_turn",
      reasoning: {
        content: "Considering options… Picked plan A.",
        isStreaming: true,
      },
      segments: [
        {
          kind: "reasoning",
          content: "Considering options… Picked plan A.",
          isStreaming: true,
        },
      ],
    });

    act(() => {
      emitEvent("message_send", {
        message_id: "msg-1",
        content: "Here is the answer.",
        model: "gpt-test",
      });
    });
    expect(result.current.items).toEqual([
      expect.objectContaining({
        type: "assistant_turn",
        id: "msg-1",
        content: "Here is the answer.",
        isStreaming: false,
        model: "gpt-test",
        reasoning: {
          content: "Considering options… Picked plan A.",
          isStreaming: false,
        },
        toolCalls: [],
      }),
    ]);
  });

  it("interleaves tool and reasoning segments in chronological event order", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) =>
          new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    // tool A running
    act(() => {
      emitEvent("tool_progress", {
        tool_name: "vault_search",
        tool_call_id: "tc-a",
        tool_label: "Search A",
        tool_status: "running",
      });
    });

    // reasoning R1 (between tools)
    act(() => {
      emitEvent("reasoning", {
        message_id: "turn-1",
        content: "Need another file…",
      });
    });

    // tool A complete (updates existing segment; does not reorder)
    act(() => {
      emitEvent("tool_progress", {
        tool_name: "vault_search",
        tool_call_id: "tc-a",
        tool_label: "Search A",
        tool_status: "complete",
        duration: "50ms",
      });
    });

    // tool B running
    act(() => {
      emitEvent("tool_progress", {
        tool_name: "read_file",
        tool_call_id: "tc-b",
        tool_label: "Read B",
        tool_status: "running",
      });
    });

    let turn = result.current.items[0];
    expect(turn?.type).toBe("assistant_turn");
    if (turn?.type === "assistant_turn") {
      // Order: tool A, reasoning R1, tool B — not collapsed to all-tools / all-reasoning.
      expect(turn.segments?.map((s) => s.kind)).toEqual([
        "tool",
        "reasoning",
        "tool",
      ]);
      expect(turn.segments?.[0]).toMatchObject({
        kind: "tool",
        call: { key: "tc-a", status: "complete", duration: "50ms" },
      });
      expect(turn.segments?.[1]).toMatchObject({
        kind: "reasoning",
        content: "Need another file…",
        isStreaming: true,
      });
      expect(turn.segments?.[2]).toMatchObject({
        kind: "tool",
        call: { key: "tc-b", status: "running" },
      });
      // Convenience views stay consistent.
      expect(turn.toolCalls.map((c) => c.key)).toEqual(["tc-a", "tc-b"]);
      expect(turn.toolCalls[0]?.status).toBe("complete");
      expect(turn.toolCalls[1]?.status).toBe("running");
      expect(turn.reasoning?.content).toBe("Need another file…");
    }
    expect(isChatResponsePending(result.current.items, false)).toBe(true);

    // reasoning R2 after tool B started
    act(() => {
      emitEvent("reasoning", {
        message_id: "turn-1",
        content: "Summarizing findings…",
      });
    });

    // tool B complete
    act(() => {
      emitEvent("tool_progress", {
        tool_name: "read_file",
        tool_call_id: "tc-b",
        tool_label: "Read B",
        tool_status: "complete",
        duration: "80ms",
      });
    });

    turn = result.current.items[0];
    if (turn?.type === "assistant_turn") {
      // New reasoning after tools → new segment (does not overwrite R1).
      expect(turn.segments?.map((s) => s.kind)).toEqual([
        "tool",
        "reasoning",
        "tool",
        "reasoning",
      ]);
      expect(turn.segments?.[1]).toMatchObject({
        kind: "reasoning",
        content: "Need another file…",
      });
      expect(turn.segments?.[3]).toMatchObject({
        kind: "reasoning",
        content: "Summarizing findings…",
        isStreaming: true,
      });
      // Stable message_id must not force duplicate React keys on interleaved CoT.
      const reasoningKeys =
        turn.segments
          ?.filter((s) => s.kind === "reasoning")
          .map((s) => (s.kind === "reasoning" ? s.key : "")) ?? [];
      expect(reasoningKeys).toHaveLength(2);
      expect(new Set(reasoningKeys).size).toBe(reasoningKeys.length);
      expect(turn.segments?.[2]).toMatchObject({
        kind: "tool",
        call: { key: "tc-b", status: "complete", duration: "80ms" },
      });
      expect(turn.toolCalls.every((c) => c.status === "complete")).toBe(true);
      // A was complete while B was mid-turn (regression of multi-tool status).
      expect(turn.toolCalls[0]).toMatchObject({
        key: "tc-a",
        status: "complete",
      });
    }

    act(() => {
      emitEvent("message_send", {
        message_id: "msg-interleave",
        content: "Final interleaved answer.",
      });
    });

    const finalized = result.current.items[0];
    if (finalized?.type === "assistant_turn") {
      expect(finalized.content).toBe("Final interleaved answer.");
      expect(finalized.isStreaming).toBe(false);
      expect(finalized.segments?.map((s) => s.kind)).toEqual([
        "tool",
        "reasoning",
        "tool",
        "reasoning",
      ]);
      expect(
        finalized.segments
          ?.filter((s) => s.kind === "reasoning")
          .every((s) => s.kind === "reasoning" && !s.isStreaming),
      ).toBe(true);
    }
  });

  it("citationsFromToolCalls promotes file tool targets", () => {
    expect(isVaultFileToolTarget("/Projects/README.md")).toBe(true);
    expect(isVaultFileToolTarget("yarn test")).toBe(false);
    expect(
      citationsFromToolCalls([
        {
          key: "1",
          name: "read_file",
          target: "/Projects/README.md",
          status: "complete",
        },
        {
          key: "2",
          name: "bash",
          target: "yarn test",
          status: "complete",
        },
        {
          key: "3",
          name: "edit",
          target: "/Projects/README.md",
          status: "complete",
        },
      ]),
    ).toEqual([{ path: "/Projects/README.md", title: "README.md" }]);
  });

  it("lp-uxy.2: citationsFromSubagentToolCalls harvests host artifacts + nested writes", () => {
    expect(
      citationsFromSubagentToolCalls([
        {
          key: "sa-a",
          name: "Explore",
          status: "complete",
          kind: "subagent",
          artifacts: [
            {
              path: "/Notes/a.md",
              title: "a.md",
              kind: "vault",
            },
            {
              path: "https://example.com/ref",
              title: "ref",
              kind: "web",
            },
          ],
        },
        {
          key: "sa-b",
          name: "coder",
          status: "complete",
          kind: "subagent",
          // no host artifacts — harvest nested write
        },
        {
          key: "tc-b",
          name: "write_file",
          target: "/Notes/b.md",
          status: "complete",
          parentSubagentId: "sa-b",
        },
      ]),
    ).toEqual([
      { path: "/Notes/a.md", title: "a.md" },
      { path: "https://example.com/ref", title: "ref" },
      { path: "/Notes/b.md", title: "b.md" },
    ]);
  });

  it("citationsFromToolCalls joins relative targets with projectVaultPath", () => {
    expect(
      citationsFromToolCalls(
        [
          {
            key: "1",
            name: "read_file",
            target: "src/foo.ts",
            status: "complete",
          },
          {
            key: "2",
            name: "edit",
            target: "README.md",
            status: "complete",
          },
        ],
        "/home/u/Core",
      ),
    ).toEqual([
      { path: "/home/u/Core/src/foo.ts", title: "foo.ts" },
      { path: "/home/u/Core/README.md", title: "README.md" },
    ]);
  });

  it("lp-vnz.8: citationsFromToolCalls promotes read (not only read_file) + AGENTS.md", () => {
    expect(isVaultFileToolTarget("AGENTS.md")).toBe(true);
    expect(
      citationsFromToolCalls(
        [
          {
            key: "1",
            name: "read",
            target: "AGENTS.md",
            status: "complete",
          },
          {
            key: "2",
            name: "vault_read",
            target: "/docs/memo.md",
            status: "complete",
          },
          {
            key: "3",
            name: "coding__read_file",
            target: "notes.md",
            status: "complete",
          },
        ],
        "/home/u/Core",
      ),
    ).toEqual([
      { path: "/home/u/Core/AGENTS.md", title: "AGENTS.md" },
      { path: "/docs/memo.md", title: "memo.md" },
      { path: "/home/u/Core/notes.md", title: "notes.md" },
    ]);
  });

  it("lp-vnz.8: citationsFromToolCalls uses technicalName when display name is friendly", () => {
    expect(
      citationsFromToolCalls([
        {
          key: "1",
          name: "Reading documents",
          // technicalName is optional (lp-vnz.9); cast for forward-compat.
          ...({ technicalName: "read_file" } as object),
          target: "/AGENTS.md",
          status: "complete",
        } as never,
      ]),
    ).toEqual([{ path: "/AGENTS.md", title: "AGENTS.md" }]);
  });

  it("derives citations from tool targets when gateway omits metadata.citations", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) =>
          new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      emitEvent("tool_progress", {
        tool_name: "read_file",
        tool_call_id: "tc-read",
        tool_target: "/Projects/notes.md",
        tool_status: "complete",
      });
    });
    act(() => {
      emitEvent("message_send", {
        message_id: "msg-from-tools",
        content: "Based on the notes…",
      });
    });

    expect(result.current.items[0]).toMatchObject({
      type: "assistant_turn",
      content: "Based on the notes…",
      citations: [{ path: "/Projects/notes.md", title: "notes.md" }],
    });
  });

  it("lp-uxy.2: finalizes subagent artifacts[] into assistant citations", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) =>
          new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      emitEvent("tool_progress", {
        tool_call_id: "sa-writer",
        tool_kind: "subagent",
        subagent_name: "coder",
        tool_status: "complete",
        metadata: {
          portal_event: "subagent",
          artifacts: [
            {
              vault_path: "/Notes/subagent-report.md",
              title: "subagent-report.md",
              kind: "vault",
            },
          ],
        },
      });
    });
    act(() => {
      emitEvent("tool_progress", {
        tool_call_id: "tc-nested-write",
        tool_name: "write_file",
        tool_target: "/Notes/nested-only.md",
        tool_status: "complete",
        metadata: {
          portal_event: "tool_progress",
          parent_subagent_id: "sa-writer",
        },
      });
    });
    act(() => {
      emitEvent("message_send", {
        message_id: "msg-subagent-arts",
        content: "Two reports are ready.",
      });
    });

    const turn = result.current.items[0];
    expect(turn?.type).toBe("assistant_turn");
    if (turn?.type === "assistant_turn") {
      const sa = turn.toolCalls.find((c) => c.key === "sa-writer");
      expect(sa?.kind).toBe("subagent");
      expect(sa?.artifacts?.[0]?.path).toBe("/Notes/subagent-report.md");
      expect(turn.citations).toEqual(
        expect.arrayContaining([
          { path: "/Notes/subagent-report.md", title: "subagent-report.md" },
          { path: "/Notes/nested-only.md", title: "nested-only.md" },
        ]),
      );
    }
  });

  it("lp-vnz.8: derives AGENTS.md citation from read tool without metadata.citations", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) =>
          new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
        projectVaultPath: "/home/u/Core",
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      emitEvent("tool_progress", {
        tool_name: "read",
        tool_call_id: "tc-agents",
        tool_target: "AGENTS.md",
        tool_status: "complete",
      });
    });
    act(() => {
      emitEvent("message_send", {
        message_id: "msg-agents",
        content: "AGENTS.md describes agent conventions.",
      });
    });

    expect(result.current.items[0]).toMatchObject({
      type: "assistant_turn",
      content: "AGENTS.md describes agent conventions.",
      citations: [{ path: "/home/u/Core/AGENTS.md", title: "AGENTS.md" }],
    });
  });

  it("lp-95v.5: promotes http(s) URLs from final answer into web citations", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) => new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      emitEvent("message_send", {
        message_id: "msg-web-sources",
        content: [
          "Spain beat Argentina 1–0.",
          "Sources",
          "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
          "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026",
          "https://www.bbc.com/sport/football/world-cup",
        ].join("\n"),
      });
    });

    expect(result.current.items[0]).toMatchObject({
      type: "assistant_turn",
      citations: [
        {
          path: "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
          title: "en.wikipedia.org",
        },
        {
          path: "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026",
          title: "fifa.com",
        },
        {
          path: "https://www.bbc.com/sport/football/world-cup",
          title: "bbc.com",
        },
      ],
    });
  });

  it("lp-95v.5: web_search tool streams keep Searching the web label + result URLs", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) => new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      emitEvent("tool_progress", {
        tool_call_id: "tc-web-1",
        tool_name: "web_search",
        tool_status: "running",
        tool_target: "2026 FIFA World Cup final",
      });
    });

    const running = result.current.items[0] as {
      type: string;
      toolCalls: Array<{ name: string; technicalName?: string; status: string }>;
    };
    expect(running.type).toBe("assistant_turn");
    expect(running.toolCalls[0]).toMatchObject({
      name: "Searching the web",
      technicalName: "web_search",
      status: "running",
    });

    act(() => {
      emitEvent("tool_progress", {
        tool_call_id: "tc-web-1",
        tool_name: "web_search",
        tool_status: "complete",
        tool_target: "2026 FIFA World Cup final",
        result:
          "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup\nhttps://www.fifa.com/hub",
      });
      emitEvent("message_send", {
        message_id: "msg-web-tools",
        content: "Final score Spain 1-0 Argentina.",
      });
    });

    const done = result.current.items[0] as {
      type: string;
      toolCalls: Array<{ name: string; status: string }>;
      citations?: Array<{ path: string; title: string }>;
    };
    expect(done.toolCalls[0]).toMatchObject({
      name: "Searching the web",
      status: "complete",
    });
    expect(done.citations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
        }),
        expect.objectContaining({
          path: "https://www.fifa.com/hub",
        }),
      ]),
    );
  });

  it("lp-95v.5: does not invent web citations when answer has no URLs and no web tools", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) => new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      emitEvent("tool_progress", {
        tool_call_id: "tc-bash",
        tool_name: "bash",
        tool_status: "complete",
        tool_target: "echo hi",
      });
      emitEvent("message_send", {
        message_id: "msg-plain",
        content: "Hello with no links.",
      });
    });

    expect(result.current.items[0]).toMatchObject({
      type: "assistant_turn",
      content: "Hello with no links.",
    });
    expect(
      (result.current.items[0] as { citations?: unknown }).citations,
    ).toBeUndefined();
  });

  it("attaches citations from event or metadata", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) => new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      emitEvent("message_send", {
        message_id: "msg-cite",
        content: "See notes.",
        citations: [
          { path: "/Projects/notes.md", title: "notes.md" },
        ],
      });
    });

    expect(result.current.items[0]).toMatchObject({
      type: "assistant_turn",
      content: "See notes.",
      citations: [{ path: "/Projects/notes.md", title: "notes.md" }],
    });

    act(() => {
      emitEvent("message_send", {
        message_id: "msg-meta",
        content: "From metadata",
        metadata: {
          citations: [{ path: "/vault/a.md", title: "A" }],
          model: "claude-test",
        },
      });
    });

    expect(result.current.items[1]).toMatchObject({
      type: "assistant_turn",
      id: "msg-meta",
      citations: [{ path: "/vault/a.md", title: "A" }],
      model: "claude-test",
    });
  });

  it("lp-uxy.7: preserves snippet on structured web citations from metadata", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) => new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      emitEvent("message_send", {
        message_id: "msg-web-snippet",
        content: "The tournament opens in 2026.",
        metadata: {
          citations: [
            {
              path: "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
              title: "2026 FIFA World Cup",
              snippet: "The 2026 FIFA World Cup is the 23rd FIFA World Cup.",
            },
            {
              url: "https://www.fifa.com/en/tournaments",
              title: "FIFA hub",
              description: "Official tournament hub.",
            },
          ],
        },
      });
    });

    expect(result.current.items[0]).toMatchObject({
      type: "assistant_turn",
      citations: [
        {
          path: "https://en.wikipedia.org/wiki/2026_FIFA_World_Cup",
          title: "2026 FIFA World Cup",
          snippet: "The 2026 FIFA World Cup is the 23rd FIFA World Cup.",
        },
        {
          path: "https://www.fifa.com/en/tournaments",
          title: "FIFA hub",
          snippet: "Official tournament hub.",
        },
      ],
    });
  });

  it("tracks user message delivery status", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) => new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    let userId = "";
    act(() => {
      userId = result.current.appendUserMessage("Hello");
    });
    expect(result.current.items[0]).toMatchObject({
      type: "user",
      id: userId,
      content: "Hello",
      status: "sending",
    });

    act(() => {
      result.current.updateUserMessageStatus(userId, "sent");
    });
    expect(result.current.items[0]).toMatchObject({ status: "sent" });

    act(() => {
      result.current.updateUserMessageStatus(userId, "error");
    });
    expect(result.current.items[0]).toMatchObject({ status: "error" });
  });

  it("renders MCQ prompts once and tracks user messages", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) => new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      emitEvent("mcq", {
        mcq_id: "mcq-1",
        message_id: "prompt-1",
        content: "Pick one",
        choices: [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ],
      });
      emitEvent("mcq", {
        mcq_id: "mcq-1",
        message_id: "prompt-1",
        content: "Pick one",
        choices: [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ],
      });
      result.current.appendUserMessage("Alpha");
      result.current.markMcqSelected("mcq-1", "a");
    });

    expect(result.current.items).toEqual([
      {
        type: "mcq",
        mcqId: "mcq-1",
        messageId: "prompt-1",
        content: "Pick one",
        choices: [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ],
        selectedChoiceId: "a",
        disabled: true,
      },
      expect.objectContaining({
        type: "user",
        id: "user-1",
        content: "Alpha",
        status: "sending",
      }),
    ]);
  });

  it("reports SSE disconnections", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) => new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      latestSource().triggerError();
    });

    expect(result.current.connectionStatus).toMatch(/SSE disconnected/);
  });

  it("shows agent_starting then clears on agent_ready (lp-6ty)", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) =>
          new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      latestSource().emit(
        "agent_starting",
        JSON.stringify({
          type: "agent_starting",
          instance_id: "inst-1",
          thread_id: "thread-1",
          presence: "offline",
          message: "Agent starting…",
          created_at: "2026-01-01T00:00:00.000Z",
        }),
      );
    });

    expect(result.current.agentWakeStatus).toEqual({
      kind: "starting",
      message: "Agent starting…",
      presence: "offline",
      instanceId: "inst-1",
    });

    act(() => {
      latestSource().emit(
        "agent_ready",
        JSON.stringify({
          type: "agent_ready",
          instance_id: "inst-1",
          thread_id: "thread-1",
          already_online: false,
          wake_joined: false,
          created_at: "2026-01-01T00:00:01.000Z",
        }),
      );
    });

    expect(result.current.agentWakeStatus).toBeNull();
  });

  it("noteAgentStarting shows the chip from POST 202 (lp-vqr0.8)", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) =>
          new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    act(() => {
      result.current.noteAgentStarting("Agent starting…");
    });

    expect(result.current.agentWakeStatus).toEqual({
      kind: "starting",
      message: "Agent starting…",
    });
  });

  it("maps wake error SSE to agentWakeStatus error (lp-6ty)", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) =>
          new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      latestSource().emit(
        "agent_starting",
        JSON.stringify({
          type: "agent_starting",
          instance_id: "inst-1",
          thread_id: "thread-1",
          presence: "waking",
          message: "Agent starting…",
        }),
      );
    });
    expect(result.current.agentWakeStatus?.kind).toBe("starting");

    act(() => {
      latestSource().emit(
        "error",
        JSON.stringify({
          type: "error",
          code: "ENSURE_ONLINE_TIMEOUT",
          message: "ensure_online timed out",
          status: 504,
          instance_id: "inst-1",
          thread_id: "thread-1",
        }),
      );
    });

    expect(result.current.agentWakeStatus).toMatchObject({
      kind: "error",
      code: "ENSURE_ONLINE_TIMEOUT",
      message: "ensure_online timed out",
      status: 504,
    });
    // Named wake error must not look like a connection drop.
    expect(result.current.connectionStatus).toBeNull();
  });

  it("clears agent starting when normal chat SSE arrives", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) =>
          new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      latestSource().emit(
        "agent_starting",
        JSON.stringify({
          type: "agent_starting",
          message: "Agent starting…",
          presence: "offline",
        }),
      );
    });
    expect(result.current.agentWakeStatus?.kind).toBe("starting");

    act(() => {
      emitEvent("message_send", {
        message_id: "msg-1",
        content: "Hello after wake",
      });
    });

    expect(result.current.agentWakeStatus).toBeNull();
    expect(result.current.items.some((i) => i.type === "assistant_turn")).toBe(
      true,
    );
  });

  it("does not open SSE when threadId is null", async () => {
    renderHook(() =>
      useChatEvents({
        threadId: null,
        eventSourceFactory: (url) => new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    expect(MockEventSource.instances).toHaveLength(0);
  });

  it("ignores malformed SSE payloads", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) => new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      latestSource().emit("message_send", "not-json");
    });

    expect(result.current.items).toEqual([]);
  });

  it("clears timeline state when reset is called", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) => new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      emitEvent("message_send", {
        message_id: "msg-1",
        content: "Hello",
      });
      result.current.appendUserMessage("Hi");
      result.current.reset();
    });

    expect(result.current.items).toEqual([]);
    expect(result.current.toolProgress).toBeNull();
    expect(result.current.connectionStatus).toBeNull();
  });

  it("toggles MCQ disabled state without selecting a choice", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) => new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      emitEvent("mcq", {
        mcq_id: "mcq-1",
        message_id: "prompt-1",
        content: "Pick one",
        choices: [{ id: "a", label: "Alpha" }],
      });
      result.current.setMcqDisabled("mcq-1", true);
    });

    expect(result.current.items).toEqual([
      {
        type: "mcq",
        mcqId: "mcq-1",
        messageId: "prompt-1",
        content: "Pick one",
        choices: [{ id: "a", label: "Alpha" }],
        selectedChoiceId: null,
        disabled: true,
      },
    ]);
  });

  it("lp-xhf4.19: upsertConnectorOAuth paints connect then connected from one card", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) => new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      result.current.upsertConnectorOAuth({
        connectorId: "google",
        phase: "connect",
      });
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({
      type: "connector.oauth",
      connectorId: "google",
      phase: "connect",
    });

    // Success replaces the connect card in place — same upsert as #622.
    act(() => {
      result.current.upsertConnectorOAuth({
        connectorId: "google",
        phase: "connected",
        accountLabel: "  ada@gmail.com  ",
      });
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toEqual({
      type: "connector.oauth",
      connectorId: "google",
      phase: "connected",
      accountLabel: "ada@gmail.com",
      ts: expect.any(Number),
    });
  });

  it("lp-xhf4.19: upsertConnectorOAuth drops blank labels and keeps connectors separate", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) => new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      result.current.upsertConnectorOAuth({
        connectorId: "hubspot",
        phase: "connected",
        accountLabel: "   ",
      });
    });

    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({
      type: "connector.oauth",
      connectorId: "hubspot",
      phase: "connected",
    });
    expect(result.current.items[0]).not.toHaveProperty("accountLabel");

    act(() => {
      result.current.upsertConnectorOAuth({
        connectorId: "google",
        phase: "connect",
      });
    });

    // Distinct connector ids never collapse into one card.
    expect(result.current.items).toHaveLength(2);
  });

  it("closes the previous connection when the thread changes and idle", async () => {
    const { rerender } = renderHook(
      ({ threadId }: { threadId: string | null }) =>
        useChatEvents({
          threadId,
          eventSourceFactory: (url) => new MockEventSource(url) as unknown as EventSource,
          historyFetcher: emptyHistory,
        }),
      { initialProps: { threadId: "thread-1" as string | null } },
    );

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    const first = latestSource();

    rerender({ threadId: "thread-2" });
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(2));

    // Idle previous thread is closed to free browser connection slots.
    expect(first.closed).toBe(true);
    expect(latestSource().url).toBe("/api/chat/threads/thread-2/events");
  });

  it("keeps SSE open for a generating chat while another is focused", async () => {
    const { result, rerender } = renderHook(
      ({ threadId }: { threadId: string | null }) =>
        useChatEvents({
          threadId,
          eventSourceFactory: (url) =>
            new MockEventSource(url) as unknown as EventSource,
          historyFetcher: emptyHistory,
        }),
      { initialProps: { threadId: "thread-a" as string | null } },
    );

    await waitFor(() => expect(MockEventSource.instances).toHaveLength(1));
    const sourceA = latestSource();

    act(() => {
      result.current.appendUserMessage("Work on A");
      result.current.retainThreadStream("thread-a");
    });

    rerender({ threadId: "thread-b" });
    await waitFor(() => expect(MockEventSource.instances).toHaveLength(2));

    // Background generating chat must keep its EventSource.
    expect(sourceA.closed).toBe(false);

    // Events on A still apply to cache while B is focused.
    act(() => {
      sourceA.emit(
        "message_send",
        JSON.stringify({
          type: "message_send",
          chat_id: "thread-a",
          message_id: "ans-a",
          content: "Answer for A",
        }),
      );
    });

    // Focused thread B is still empty (aside from nothing).
    expect(result.current.items).toEqual([]);

    // Switching back to A shows the background-streamed answer.
    rerender({ threadId: "thread-a" });
    await waitFor(() => {
      expect(result.current.items.some((i) => i.type === "assistant_turn")).toBe(
        true,
      );
    });
    expect(result.current.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "assistant_turn",
          content: "Answer for A",
        }),
      ]),
    );
  });

  it("restores session-local timeline when switching threads A→B→A", async () => {
    const { result, rerender } = renderHook(
      ({ threadId }: { threadId: string | null }) =>
        useChatEvents({
          threadId,
          eventSourceFactory: (url) =>
            new MockEventSource(url) as unknown as EventSource,
          historyFetcher: emptyHistory,
        }),
      { initialProps: { threadId: "thread-a" as string | null } },
    );

    await waitFor(() => expect(MockEventSource.instances.length).toBeGreaterThan(0));

    act(() => {
      result.current.appendUserMessage("Hello from A");
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({
      type: "user",
      content: "Hello from A",
    });

    rerender({ threadId: "thread-b" });
    await waitFor(() => {
      expect(result.current.items).toEqual([]);
    });

    act(() => {
      result.current.appendUserMessage("Hello from B");
    });
    expect(result.current.items[0]).toMatchObject({
      content: "Hello from B",
    });

    rerender({ threadId: "thread-a" });
    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
      expect(result.current.items[0]).toMatchObject({
        type: "user",
        content: "Hello from A",
      });
    });
  });

  it("hydrates empty cache from durable history API (reload path)", async () => {
    const history: ChatHistoryEvent[] = [
      {
        type: "user_message",
        message_id: "u-1",
        content: "What is in the vault?",
        created_at: "2026-01-01T00:00:00.000Z",
        chat_id: "thread-reload",
      },
      {
        type: "tool_progress",
        chat_id: "thread-reload",
        tool_name: "read_file",
        tool_call_id: "tc-1",
        tool_target: "/Projects/notes.md",
        tool_status: "complete",
      },
      {
        type: "message_send",
        chat_id: "thread-reload",
        message_id: "a-1",
        content: "Notes say hello.",
        citations: [{ path: "/Projects/notes.md", title: "notes.md" }],
      },
    ];
    const historyFetcher = vi.fn(async () => history);

    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-reload",
        eventSourceFactory: (url) =>
          new MockEventSource(url) as unknown as EventSource,
        historyFetcher,
      }),
    );

    await waitFor(() => {
      expect(historyFetcher).toHaveBeenCalledWith("thread-reload");
      expect(result.current.items).toHaveLength(2);
    });

    expect(result.current.items[0]).toMatchObject({
      type: "user",
      id: "u-1",
      content: "What is in the vault?",
      status: "sent",
    });
    expect(result.current.items[1]).toMatchObject({
      type: "assistant_turn",
      id: "a-1",
      content: "Notes say hello.",
      isStreaming: false,
      citations: [{ path: "/Projects/notes.md", title: "notes.md" }],
    });
    if (result.current.items[1]?.type === "assistant_turn") {
      expect(result.current.items[1].toolCalls).toEqual([
        expect.objectContaining({
          key: "tc-1",
          name: "Reading documents",
          technicalName: "read_file",
          status: "complete",
        }),
      ]);
    }
  });

  it("does not wipe hydrated items when SSE connects and stays idle", async () => {
    const historyFetcher = vi.fn(async () => [
      {
        type: "user_message" as const,
        message_id: "u-keep",
        content: "Keep me",
        created_at: "2026-01-01T00:00:00.000Z",
        chat_id: "thread-keep",
      },
      {
        type: "message_send" as const,
        chat_id: "thread-keep",
        message_id: "a-keep",
        content: "Still here after reload",
      },
    ]);

    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-keep",
        eventSourceFactory: (url) =>
          new MockEventSource(url) as unknown as EventSource,
        historyFetcher,
      }),
    );

    await waitFor(() => {
      expect(result.current.items).toHaveLength(2);
    });

    // SSE is open but no events — hydrated transcript must remain.
    expect(MockEventSource.instances.length).toBeGreaterThan(0);
    expect(latestSource().closed).toBe(false);
    expect(result.current.items[1]).toMatchObject({
      type: "assistant_turn",
      content: "Still here after reload",
    });
  });

  it("applies live SSE after hydrate without dropping history base", async () => {
    let resolveHistory!: (events: ChatHistoryEvent[]) => void;
    const historyPromise = new Promise<ChatHistoryEvent[]>((resolve) => {
      resolveHistory = resolve;
    });
    const historyFetcher = vi.fn(() => historyPromise);

    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-race",
        eventSourceFactory: (url) =>
          new MockEventSource(url) as unknown as EventSource,
        historyFetcher,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    // Live event arrives while history is still in flight — buffered.
    act(() => {
      latestSource().emit(
        "message_send",
        JSON.stringify({
          type: "message_send",
          chat_id: "thread-race",
          message_id: "live-1",
          content: "Live after hydrate",
        }),
      );
    });
    expect(result.current.items).toEqual([]);

    await act(async () => {
      resolveHistory([
        {
          type: "user_message",
          message_id: "u-old",
          content: "Prior question",
          created_at: "2026-01-01T00:00:00.000Z",
          chat_id: "thread-race",
        },
        {
          type: "message_send",
          chat_id: "thread-race",
          message_id: "a-old",
          content: "Prior answer",
        },
      ]);
      await historyPromise;
    });

    await waitFor(() => {
      expect(result.current.items.length).toBeGreaterThanOrEqual(3);
    });
    expect(result.current.items[0]).toMatchObject({
      type: "user",
      content: "Prior question",
    });
    expect(result.current.items[1]).toMatchObject({
      type: "assistant_turn",
      content: "Prior answer",
    });
    expect(result.current.items[2]).toMatchObject({
      type: "assistant_turn",
      content: "Live after hydrate",
    });
  });
});

describe("historyEventsToTimelineItems", () => {
  it("maps user_message + assistant events into timeline items", () => {
    const items = historyEventsToTimelineItems([
      {
        type: "user_message",
        message_id: "u1",
        content: "Hi",
        created_at: "2026-01-01T00:00:00.000Z",
        chat_id: "c1",
        model: "grok-4.5",
      },
      {
        type: "message_send",
        chat_id: "c1",
        message_id: "a1",
        content: "Hello",
        model: "gpt-test",
      },
    ]);
    expect(items).toEqual([
      {
        type: "user",
        id: "u1",
        content: "Hi",
        status: "sent",
        createdAt: "2026-01-01T00:00:00.000Z",
        model: "grok-4.5",
      },
      expect.objectContaining({
        type: "assistant_turn",
        id: "a1",
        content: "Hello",
        isStreaming: false,
        model: "gpt-test",
      }),
    ]);
  });

  it("does not reuse a harness turn id after a later user message (LA restart)", () => {
    const items = historyEventsToTimelineItems([
      {
        type: "user_message",
        message_id: "u1",
        content: "first",
        chat_id: "c1",
      },
      {
        type: "message_send",
        chat_id: "c1",
        message_id: "msg_turn_3",
        content: "old answer",
      },
      {
        type: "user_message",
        message_id: "u2",
        content: "qa ping reply pong only",
        chat_id: "c1",
      },
      {
        type: "message_send",
        chat_id: "c1",
        message_id: "msg_turn_3",
        content: "pong",
      },
    ]);
    expect(items.map((item) => [item.type, item.content])).toEqual([
      ["user", "first"],
      ["assistant_turn", "old answer"],
      ["user", "qa ping reply pong only"],
      ["assistant_turn", "pong"],
    ]);
    expect(isChatResponsePending(items, false)).toBe(false);
  });

  it("hydrates fuse-trip system_notice as a text line", () => {
    const items = historyEventsToTimelineItems([
      {
        type: "system_notice",
        chat_id: "c1",
        message_id: "fuse-1",
        content: "This room paused after too much agent traffic.",
        created_at: "2026-08-25T00:00:00.000Z",
      },
    ]);
    expect(items).toEqual([
      {
        type: "system_notice",
        id: "fuse-1",
        content: "This room paused after too much agent traffic.",
        createdAt: "2026-08-25T00:00:00.000Z",
      },
    ]);
  });

  it("hydrates Sent-to notice and mailbox_inbound; skips mailbox.send tool rows", () => {
    const items = historyEventsToTimelineItems([
      {
        type: "system_notice",
        chat_id: "fred-1to1",
        message_id: "sent-1",
        content: "Sent to Bill\nBill, take this",
        created_at: "2026-08-28T00:00:00.000Z",
      },
      {
        type: "tool_progress",
        chat_id: "fred-1to1",
        message_id: "tool-1",
        tool_name: "mailbox.send",
        content: JSON.stringify({ to: "agt_bill-uuid", text: "Bill, take this" }),
        metadata: { mailbox_send: { to: "agt_bill-uuid" } },
      },
      {
        type: "message_send",
        chat_id: "bill-1to1",
        message_id: "in-1",
        content: "Bill, take this",
        speaker: { kind: "persona", id: "agt_fred", display_name: "Fred" },
        metadata: {
          mailbox_inbound: {
            from: "agt_fred",
            from_display_name: "Fred",
            origin_thread_id: "fred-1to1",
          },
        },
      },
    ]);
    expect(items).toEqual([
      {
        type: "system_notice",
        id: "sent-1",
        content: "Sent to Bill\nBill, take this",
        createdAt: "2026-08-28T00:00:00.000Z",
      },
      expect.objectContaining({
        type: "assistant_turn",
        id: "in-1",
        content: "Bill, take this",
        mailboxInbound: { from_display_name: "Fred" },
      }),
    ]);
    expect(JSON.stringify(items)).not.toContain("A message has been sent");
    expect(JSON.stringify(items)).not.toContain("mailbox.send");
    expect(JSON.stringify(items)).not.toContain("agt_bill-uuid");
  });

  it("inherits user model onto assistant when outbound omits model", () => {
    const items = historyEventsToTimelineItems([
      {
        type: "user_message",
        message_id: "u-inherit",
        content: "Ping",
        created_at: "2026-01-01T00:00:00.000Z",
        chat_id: "c1",
        model: "grok-4.5",
      },
      {
        type: "message_send",
        chat_id: "c1",
        message_id: "a-inherit",
        content: "Pong",
      },
    ]);
    expect(items[1]).toMatchObject({
      type: "assistant_turn",
      id: "a-inherit",
      model: "grok-4.5",
    });
  });

  it("hydrates group-room speakers onto user and persona turns", () => {
    const items = historyEventsToTimelineItems([
      {
        type: "user_message",
        message_id: "u-alice",
        content: "Please review.",
        created_at: "2026-01-01T00:00:00.000Z",
        chat_id: "room-1",
        speaker: { kind: "human", id: "usr_alice", display_name: "Alice" },
      },
      {
        type: "message_send",
        chat_id: "room-1",
        message_id: "a-skip",
        content: "First pass.",
        speaker: { kind: "persona", id: "skip", display_name: "Skip" },
      },
      {
        type: "message_send",
        chat_id: "room-1",
        message_id: "a-lev",
        content: "Security notes.",
        metadata: {
          persona_id: "lev",
          speaker: { kind: "persona", id: "lev", display_name: "Lev" },
        },
      },
    ]);
    expect(items[0]).toMatchObject({
      type: "user",
      speaker: { kind: "human", id: "usr_alice", display_name: "Alice" },
    });
    expect(items[1]).toMatchObject({
      type: "assistant_turn",
      id: "a-skip",
      speaker: { kind: "persona", id: "skip", display_name: "Skip" },
    });
    expect(items[2]).toMatchObject({
      type: "assistant_turn",
      id: "a-lev",
      speaker: { kind: "persona", id: "lev", display_name: "Lev" },
    });
  });

  it("hydrates durable tool lifecycle including status aliases (lp-dpr.3)", () => {
    const items = historyEventsToTimelineItems([
      {
        type: "user_message",
        message_id: "u-tools",
        content: "Read notes",
        created_at: "2026-01-01T00:00:00.000Z",
        chat_id: "c1",
      },
      {
        type: "tool_progress",
        chat_id: "c1",
        tool_name: "read_file",
        tool_call_id: "tc-hist",
        tool_target: "/Projects/notes.md",
        // Host alias — must normalize to running then complete on final row.
        metadata: { status: "started" },
      },
      {
        type: "tool_progress",
        chat_id: "c1",
        tool_name: "read_file",
        tool_call_id: "tc-hist",
        tool_target: "/Projects/notes.md",
        tool_status: "complete",
        duration: "400ms",
        result: "# Notes\nhello",
      },
      {
        type: "message_send",
        chat_id: "c1",
        message_id: "a-tools",
        content: "Notes say hello.",
      },
    ]);

    expect(items).toHaveLength(2);
    const turn = items[1];
    expect(turn?.type).toBe("assistant_turn");
    if (turn?.type === "assistant_turn") {
      expect(turn.toolCalls).toEqual([
        expect.objectContaining({
          key: "tc-hist",
          name: "Reading documents",
          technicalName: "read_file",
          target: "/Projects/notes.md",
          status: "complete",
          duration: "400ms",
          result: "# Notes\nhello",
        }),
      ]);
      expect(turn.isStreaming).toBe(false);
    }
  });

  /**
   * Complex multi-subagent + many nested tool_progress rows — the hard-reload
   * crash class from lp-uxy.11. One corrupt tool_progress must not wipe the
   * whole hydrate; remaining tools/subagents and final answer must survive.
   */
  it("hydrates multi-subagent + many tools; isolates corrupt tool_progress (lp-uxy.11)", () => {
    const hugeResult = "X".repeat(MAX_HISTORY_TOOL_RESULT_CHARS + 12_000);

    const corruptTool = new Proxy(
      {
        type: "tool_progress" as const,
        chat_id: "c-complex",
        tool_call_id: "tc-corrupt",
        tool_status: "complete" as const,
      },
      {
        get(target, prop, receiver) {
          if (prop === "tool_name" || prop === "metadata" || prop === "result") {
            throw new Error("corrupt tool_progress row");
          }
          return Reflect.get(target, prop, receiver);
        },
      },
    ) as ChatEvent;

    const history: ChatHistoryEvent[] = [
      {
        type: "user_message",
        message_id: "u-complex",
        content: "Research and implement auth",
        created_at: "2026-08-01T00:00:00.000Z",
        chat_id: "c-complex",
        model: "grok-4.5",
      },
      // Parent subagent A
      {
        type: "tool_progress",
        chat_id: "c-complex",
        tool_kind: "subagent",
        subagent_name: "Explore",
        tool_call_id: "sa-explore",
        tool_status: "running",
        tool_label: "Scan codebase",
      },
      // Nested tools under Explore
      ...Array.from({ length: 12 }, (_, i) => ({
        type: "tool_progress" as const,
        chat_id: "c-complex",
        tool_name: "read_file",
        tool_call_id: `tc-explore-${i}`,
        tool_target: `/Projects/src/file-${i}.ts`,
        tool_status: "complete" as const,
        duration: "12ms",
        result: `// file ${i}\nexport const x = ${i};`,
        metadata: {
          portal_event: "tool_progress",
          parent_subagent_id: "sa-explore",
        },
      })),
      {
        type: "tool_progress",
        chat_id: "c-complex",
        tool_kind: "subagent",
        subagent_name: "Explore",
        tool_call_id: "sa-explore",
        tool_status: "complete",
        duration: "2.1s",
        tool_label: "Scan codebase",
        metadata: {
          artifacts: [{ path: "/Projects/src/auth.ts", kind: "file" }],
        },
      },
      // Parent subagent B + nested tools
      {
        type: "tool_progress",
        chat_id: "c-complex",
        tool_kind: "subagent",
        subagent_name: "Coder",
        tool_call_id: "sa-coder",
        tool_status: "running",
        tool_label: "Apply auth patch",
      },
      {
        type: "tool_progress",
        chat_id: "c-complex",
        tool_name: "bash",
        tool_call_id: "tc-bash-1",
        tool_target: "npm test",
        tool_status: "complete",
        duration: "4s",
        // Oversized result must be truncated on history hydrate.
        result: hugeResult,
        metadata: {
          portal_event: "tool_progress",
          parent_subagent_id: "sa-coder",
          output: hugeResult,
        },
      },
      {
        type: "tool_progress",
        chat_id: "c-complex",
        tool_name: "search_replace",
        tool_call_id: "tc-edit-1",
        tool_target: "/Projects/src/auth.ts",
        tool_status: "complete",
        duration: "80ms",
        additions: 12,
        deletions: 3,
        metadata: {
          portal_event: "tool_progress",
          parent_subagent_id: "sa-coder",
        },
      },
      // Corrupt row interleaved mid-stream — must be skipped.
      corruptTool,
      // Null / garbage rows
      null as unknown as ChatHistoryEvent,
      undefined as unknown as ChatHistoryEvent,
      { type: "tool_progress" } as ChatHistoryEvent,
      {
        type: "tool_progress",
        chat_id: "c-complex",
        tool_kind: "subagent",
        subagent_name: "Coder",
        tool_call_id: "sa-coder",
        tool_status: "complete",
        duration: "5.0s",
        tool_label: "Apply auth patch",
      },
      // Generic tools after subagents
      {
        type: "tool_progress",
        chat_id: "c-complex",
        tool_name: "web_search",
        tool_call_id: "tc-web",
        tool_target: "oauth best practices",
        tool_status: "complete",
        duration: "300ms",
        result: JSON.stringify({
          results: [{ title: "OAuth 2.0", url: "https://example.com/oauth" }],
        }),
      },
      {
        type: "message_send",
        chat_id: "c-complex",
        message_id: "a-complex",
        content: "Auth flow implemented with OAuth.",
        model: "grok-4.5",
      },
    ];

    // Must not throw — full hydrate isolation.
    let items: ChatTimelineItem[] = [];
    expect(() => {
      items = historyEventsToTimelineItems(history);
    }).not.toThrow();

    expect(items.length).toBeGreaterThanOrEqual(2);
    expect(items[0]).toMatchObject({
      type: "user",
      id: "u-complex",
      content: "Research and implement auth",
      model: "grok-4.5",
    });

    const turn = items.find((i) => i.type === "assistant_turn");
    expect(turn?.type).toBe("assistant_turn");
    if (turn?.type !== "assistant_turn") {
      return;
    }

    expect(turn.content).toBe("Auth flow implemented with OAuth.");
    expect(turn.isStreaming).toBe(false);
    expect(turn.model).toBe("grok-4.5");

    // Both subagents present
    const explore = turn.toolCalls.find((c) => c.key === "sa-explore");
    const coder = turn.toolCalls.find((c) => c.key === "sa-coder");
    expect(explore).toMatchObject({
      kind: "subagent",
      status: "complete",
      name: "Explore",
    });
    expect(coder).toMatchObject({
      kind: "subagent",
      status: "complete",
      name: "Coder",
    });

    // Nested tools attributed + present (12 explore reads + bash + edit + web)
    const nestedExplore = turn.toolCalls.filter(
      (c) => c.parentSubagentId === "sa-explore",
    );
    expect(nestedExplore.length).toBe(12);
    expect(
      turn.toolCalls.find((c) => c.key === "tc-bash-1")?.parentSubagentId,
    ).toBe("sa-coder");
    expect(
      turn.toolCalls.find((c) => c.key === "tc-edit-1")?.parentSubagentId,
    ).toBe("sa-coder");
    expect(turn.toolCalls.find((c) => c.key === "tc-web")).toMatchObject({
      status: "complete",
    });

    // Corrupt id never materializes as a tool row
    expect(turn.toolCalls.find((c) => c.key === "tc-corrupt")).toBeUndefined();

    // Huge result truncated on history load
    const bash = turn.toolCalls.find((c) => c.key === "tc-bash-1");
    expect(bash?.result).toBeDefined();
    expect(bash!.result!.length).toBeLessThan(hugeResult.length);
    expect(bash!.result!.length).toBeLessThanOrEqual(
      MAX_HISTORY_TOOL_RESULT_CHARS + 40,
    );
    expect(bash!.result).toMatch(/\[truncated \d+ chars\]/);
  });

  it("lp-oop.38.21: merges call-* workflow start into wf_* card and reads stages from result JSON", () => {
    const snapshot = {
      workflow_id: "wf_abc",
      workflow_name: "research-lite",
      workflow_status: "running",
      tool_call_id: "wf_abc",
      tool_kind: "workflow",
      stages: [
        { id: "plan", name: "Plan", status: "complete" },
        { id: "explore", name: "Explore", status: "running" },
        { id: "synthesize", name: "Synthesize", status: "pending" },
      ],
    };
    const launchResult = {
      action: "launch",
      success: true,
      run: {
        run_id: "wf_abc",
        display_name: "research-lite",
        status: "running",
      },
    };
    const events: ChatEvent[] = [
      {
        type: "tool_progress",
        chat_id: "c1",
        tool_name: "workflow",
        tool_call_id: "call-lite-1",
        tool_status: "running",
        tool_kind: "workflow",
        tool_label: "research-lite",
        metadata: {
          portal_event: "workflow_progress",
          tool_name: "workflow",
          tool_call_id: "call-lite-1",
          status: "running",
          tool_kind: "workflow",
          tool_label: "research-lite",
        },
      },
      {
        type: "tool_progress",
        chat_id: "c1",
        tool_name: "workflow",
        tool_call_id: "wf_abc",
        tool_status: "running",
        tool_kind: "workflow",
        tool_label: "research-lite",
        result: JSON.stringify(snapshot),
        metadata: {
          portal_event: "workflow_progress",
          tool_name: "workflow",
          tool_call_id: "wf_abc",
          status: "running",
          tool_kind: "workflow",
          tool_label: "research-lite",
          result: JSON.stringify(snapshot),
        },
      },
      {
        type: "tool_progress",
        chat_id: "c1",
        tool_name: "workflow",
        tool_call_id: "call-lite-1",
        tool_status: "complete",
        tool_kind: "workflow",
        tool_label: "research-lite",
        result: JSON.stringify(launchResult),
        metadata: {
          portal_event: "workflow_progress",
          tool_name: "workflow",
          tool_call_id: "call-lite-1",
          status: "completed",
          tool_kind: "workflow",
          tool_label: "research-lite",
          result: JSON.stringify(launchResult),
        },
      },
    ];
    let items: ChatTimelineItem[] = [];
    for (const event of events) {
      items = applyChatEvent(items, event);
    }
    const turn = items.find((item) => item.type === "assistant_turn");
    expect(turn?.type).toBe("assistant_turn");
    if (turn?.type !== "assistant_turn") {
      return;
    }
    const workflowCalls = (turn.segments ?? []).filter(
      (seg) => seg.kind === "tool" && seg.call.kind === "workflow",
    );
    expect(workflowCalls).toHaveLength(1);
    const card = workflowCalls[0]?.kind === "tool" ? workflowCalls[0].call : undefined;
    expect(card?.key).toBe("wf_abc");
    expect(card?.name).toBe("research-lite");
    expect(card?.status).toBe("running");
    expect(card?.workflowStatus).toBe("running");
    expect(card?.workflowStages?.map((s) => s.name)).toEqual([
      "Plan",
      "Explore",
      "Synthesize",
    ]);
    expect(card?.workflowStages?.map((s) => s.status)).toEqual([
      "complete",
      "running",
      "pending",
    ]);
  });

  it("lp-oop.38.23: extra call-* workflow start does not add Waiting for stages card", () => {
    const snapshot = {
      workflow_id: "wf_1850",
      workflow_name: "research-lite",
      workflow_status: "running",
      tool_call_id: "wf_1850",
      tool_kind: "workflow",
      stages: [
        { id: "plan", name: "Plan", status: "running" },
        { id: "explore", name: "Explore", status: "pending" },
        { id: "synthesize", name: "Synthesize", status: "pending" },
      ],
    };
    const events: ChatEvent[] = [
      {
        type: "tool_progress",
        chat_id: "c1",
        tool_name: "workflow",
        tool_call_id: "call-c58ff027-38b7-4981-ae6f-82e001d83d72-0",
        tool_status: "running",
        tool_kind: "workflow",
        tool_label: "research-lite",
        metadata: {
          portal_event: "workflow_progress",
          tool_kind: "workflow",
          tool_label: "research-lite",
        },
      },
      {
        type: "tool_progress",
        chat_id: "c1",
        tool_name: "workflow",
        tool_call_id: "wf_1850",
        tool_status: "running",
        tool_kind: "workflow",
        tool_label: "research-lite",
        result: JSON.stringify(snapshot),
        metadata: {
          portal_event: "workflow_progress",
          tool_kind: "workflow",
          tool_label: "research-lite",
          result: JSON.stringify(snapshot),
        },
      },
      {
        type: "tool_progress",
        chat_id: "c1",
        tool_name: "workflow",
        tool_call_id: "call-e2d86319-638a-481b-b229-37a63cf7a1a0-1",
        tool_status: "running",
        tool_kind: "workflow",
        tool_label: "workflow",
        metadata: {
          portal_event: "workflow_progress",
          tool_kind: "workflow",
          tool_label: "workflow",
        },
      },
    ];
    let items: ChatTimelineItem[] = [];
    for (const event of events) {
      items = applyChatEvent(items, event);
    }
    const turn = items.find((item) => item.type === "assistant_turn");
    expect(turn?.type).toBe("assistant_turn");
    if (turn?.type !== "assistant_turn") {
      return;
    }
    const workflowCalls = (turn.segments ?? []).filter(
      (seg) => seg.kind === "tool" && seg.call.kind === "workflow",
    );
    expect(workflowCalls).toHaveLength(1);
    const card =
      workflowCalls[0]?.kind === "tool" ? workflowCalls[0].call : undefined;
    expect(card?.key).toBe("wf_1850");
    expect(card?.name).toBe("research-lite");
    expect(card?.workflowStages?.map((s) => s.name)).toEqual([
      "Plan",
      "Explore",
      "Synthesize",
    ]);
  });

  it("reduces nested helper tools onto research-lite stages (lp-oop.38.25.1)", () => {
    const events: ChatEvent[] = [
      {
        type: "tool_progress",
        chat_id: "c1",
        tool_call_id: "wf_live",
        tool_kind: "workflow",
        tool_label: "research-lite",
        metadata: {
          portal_event: "workflow_progress",
          workflow_id: "wf_live",
          workflow_name: "research-lite",
          workflow_status: "running",
          stages: [
            { id: "plan", name: "Plan", status: "running" },
            { id: "explore", name: "Explore", status: "pending" },
            { id: "synthesize", name: "Synthesize", status: "pending" },
          ],
        },
      },
      {
        type: "tool_progress",
        chat_id: "c1",
        tool_call_id: "tc-ls",
        tool_name: "ls",
        tool_label: "Listing files",
        tool_status: "complete",
      },
      {
        type: "tool_progress",
        chat_id: "c1",
        tool_call_id: "wf_live",
        tool_kind: "workflow",
        tool_label: "research-lite",
        metadata: {
          portal_event: "workflow_progress",
          workflow_id: "wf_live",
          workflow_name: "research-lite",
          workflow_status: "running",
          stages: [
            { id: "plan", name: "Plan", status: "complete" },
            { id: "explore", name: "Explore", status: "running" },
            { id: "synthesize", name: "Synthesize", status: "pending" },
          ],
        },
      },
      {
        type: "tool_progress",
        chat_id: "c1",
        tool_call_id: "tc-grep",
        tool_name: "grep",
        tool_label: "Searching files",
        tool_status: "complete",
        metadata: { parent_subagent_id: "wf_live:explore-structure" },
      },
      {
        type: "tool_progress",
        chat_id: "c1",
        tool_call_id: "wf_live",
        tool_kind: "workflow",
        tool_label: "research-lite",
        metadata: {
          portal_event: "workflow_progress",
          workflow_id: "wf_live",
          workflow_name: "research-lite",
          workflow_status: "complete",
          stages: [
            { id: "plan", name: "Plan", status: "complete" },
            { id: "explore", name: "Explore", status: "complete" },
            { id: "synthesize", name: "Synthesize", status: "complete" },
          ],
        },
      },
    ];
    let items: ChatTimelineItem[] = [];
    for (const event of events) {
      items = applyChatEvent(items, event);
    }
    const turn = items.find((item) => item.type === "assistant_turn");
    expect(turn?.type).toBe("assistant_turn");
    if (turn?.type !== "assistant_turn") {
      return;
    }
    const card = (turn.segments ?? []).find(
      (seg) => seg.kind === "tool" && seg.call.kind === "workflow",
    );
    expect(card?.kind).toBe("tool");
    if (card?.kind !== "tool") return;
    expect(card.call.workflowStages?.[0]).toMatchObject({
      id: "plan",
      status: "complete",
      toolCallIds: ["tc-ls"],
      summary: "Listing files",
    });
    expect(card.call.workflowStages?.[1]).toMatchObject({
      id: "explore",
      status: "complete",
      toolCallIds: ["tc-grep"],
      subagentIds: ["wf_live:explore-structure"],
      summary: "Searching files",
    });
    expect(card.call.workflowStages?.[2]?.toolCallIds).toBeUndefined();
  });

  it("applyChatEvent maps system_notice to a text line, not a card", () => {
    const items = applyChatEvent([], {
      type: "system_notice",
      chat_id: "c1",
      message_id: "fuse-1",
      content: "This room paused after too much agent traffic.",
      created_at: "2026-08-25T00:00:00.000Z",
    });
    expect(items).toEqual([
      {
        type: "system_notice",
        id: "fuse-1",
        content: "This room paused after too much agent traffic.",
        createdAt: "2026-08-25T00:00:00.000Z",
      },
    ]);
    const again = applyChatEvent(items, {
      type: "system_notice",
      chat_id: "c1",
      message_id: "fuse-1",
      content: "This room paused after too much agent traffic.",
    });
    expect(again).toHaveLength(1);
  });

  it("stamps assistant model from harness message_send (lp-oop.38.5)", () => {
    const items = applyChatEvent([], {
      type: "message_send",
      chat_id: "c1",
      message_id: "a1",
      content: "Harness reply",
      model: "openai/gpt-4.1",
    });
    const turn = items.find((item) => item.type === "assistant_turn");
    expect(turn?.type).toBe("assistant_turn");
    if (turn?.type === "assistant_turn") {
      expect(turn.model).toBe("openai/gpt-4.1");
      expect(turn.model).not.toBe("unknown");
    }
  });

  it("applies reserved tool.approval as a timeline bubble", () => {
    const items = applyChatEvent([], {
      type: "tool_approval",
      chat_id: "c1",
      content: "Allow gmail.draft?",
      approval_id: "appr-1",
      gate: "sticky",
      action_class: "gmail.draft",
      mapped: true,
      choices: [
        { id: "always", label: "Always" },
        { id: "reject", label: "Reject" },
      ],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: "tool_approval",
      approvalId: "appr-1",
      gate: "sticky",
      actionClass: "gmail.draft",
    });
  });

  it("applyChatEvent returns prior items when a tool_progress throws (lp-uxy.11)", () => {
    const base = historyEventsToTimelineItems([
      {
        type: "user_message",
        message_id: "u1",
        content: "Hi",
        created_at: "2026-01-01T00:00:00.000Z",
        chat_id: "c1",
      },
      {
        type: "message_send",
        chat_id: "c1",
        message_id: "a1",
        content: "Hello",
      },
    ]);
    const poison = new Proxy(
      {
        type: "tool_progress" as const,
        chat_id: "c1",
        tool_call_id: "boom",
      },
      {
        get(target, prop, receiver) {
          if (prop === "tool_name" || prop === "tool_label" || prop === "metadata") {
            throw new Error("boom");
          }
          return Reflect.get(target, prop, receiver);
        },
      },
    ) as ChatEvent;

    const next = applyChatEvent(base, poison);
    expect(next).toEqual(base);
    expect(next).toHaveLength(2);
  });

  it("truncateHistoryToolResult / sanitizeHistoryEventForHydrate cap size (lp-uxy.11)", () => {
    const big = "Z".repeat(MAX_HISTORY_TOOL_RESULT_CHARS + 500);
    expect(truncateHistoryToolResult(big)?.endsWith("chars]")).toBe(true);
    expect(truncateHistoryToolResult("short")).toBe("short");
    expect(truncateHistoryToolResult(null)).toBeUndefined();

    const sanitized = sanitizeHistoryEventForHydrate({
      type: "tool_progress",
      chat_id: "c1",
      tool_name: "bash",
      tool_call_id: "tc-big",
      result: big,
      metadata: { output: big, result: big },
    });
    expect(sanitized.type).toBe("tool_progress");
    if (sanitized.type === "tool_progress") {
      expect(sanitized.result?.length).toBeLessThan(big.length);
      expect(typeof sanitized.metadata?.output).toBe("string");
      expect(String(sanitized.metadata?.output).length).toBeLessThan(big.length);
    }
  });

  it("historyFetcher multi-subagent reload does not leave empty timeline (lp-uxy.11)", async () => {
    const history: ChatHistoryEvent[] = [
      {
        type: "user_message",
        message_id: "u-reload",
        content: "multi agent please",
        created_at: "2026-08-01T00:00:00.000Z",
        chat_id: "thread-reload",
      },
      {
        type: "tool_progress",
        chat_id: "thread-reload",
        tool_kind: "subagent",
        subagent_name: "Researcher",
        tool_call_id: "sa-r",
        tool_status: "complete",
        duration: "1s",
      },
      {
        type: "tool_progress",
        chat_id: "thread-reload",
        tool_kind: "subagent",
        subagent_name: "Writer",
        tool_call_id: "sa-w",
        tool_status: "complete",
        duration: "2s",
      },
      ...Array.from({ length: 8 }, (_, i) => ({
        type: "tool_progress" as const,
        chat_id: "thread-reload",
        tool_name: "read_file",
        tool_call_id: `tc-r-${i}`,
        tool_status: "complete" as const,
        tool_target: `/Notes/n${i}.md`,
        metadata: { parent_subagent_id: "sa-r" },
      })),
      {
        type: "message_send",
        chat_id: "thread-reload",
        message_id: "a-reload",
        content: "Done with multi-agent work.",
      },
    ];

    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-reload",
        eventSourceFactory: (url) =>
          new MockEventSource(url) as unknown as EventSource,
        historyFetcher: async () => history,
      }),
    );

    await waitFor(() => {
      expect(result.current.items.length).toBeGreaterThanOrEqual(2);
    });

    const turn = result.current.items.find((i) => i.type === "assistant_turn");
    expect(turn?.type).toBe("assistant_turn");
    if (turn?.type === "assistant_turn") {
      expect(turn.content).toBe("Done with multi-agent work.");
      expect(turn.toolCalls.some((c) => c.key === "sa-r")).toBe(true);
      expect(turn.toolCalls.some((c) => c.key === "sa-w")).toBe(true);
      expect(
        turn.toolCalls.filter((c) => c.parentSubagentId === "sa-r").length,
      ).toBe(8);
      // Not stuck streaming after hydrate of a finished turn.
      expect(turn.isStreaming).toBe(false);
    }
    expect(isChatResponsePending(result.current.items, false)).toBe(false);
  });
});

describe("streaming lifecycle (message_edit stays open)", () => {
  it("keeps pending open through message_edit then tools then final send", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) =>
          new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      result.current.appendUserMessage("Do work");
      result.current.updateUserMessageStatus("user-1", "sent");
    });

    act(() => {
      emitEvent("message_edit", {
        message_id: "msg-stream",
        content: "Partial…",
      });
    });

    expect(result.current.items[1]).toMatchObject({
      type: "assistant_turn",
      content: "Partial…",
      isStreaming: true,
    });
    expect(isChatResponsePending(result.current.items, false)).toBe(true);

    act(() => {
      emitEvent("tool_progress", {
        tool_name: "terminal",
        tool_label: "ls",
        tool_call_id: "tc-term",
        tool_status: "running",
      });
    });
    expect(isChatResponsePending(result.current.items, false)).toBe(true);

    act(() => {
      emitEvent("message_send", {
        message_id: "msg-stream",
        content: "Final answer.",
      });
    });

    expect(result.current.items[1]).toMatchObject({
      type: "assistant_turn",
      content: "Final answer.",
      isStreaming: false,
    });
    expect(isChatResponsePending(result.current.items, false)).toBe(false);
  });

  it("re-opens a closed turn when tool_progress arrives after interim text", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) =>
          new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      emitEvent("message_send", {
        message_id: "msg-1",
        content: "I'll check.",
      });
    });
    expect(result.current.items[0]).toMatchObject({
      isStreaming: false,
      content: "I'll check.",
    });

    act(() => {
      emitEvent("tool_progress", {
        tool_name: "read_file",
        tool_call_id: "tc-r",
        tool_status: "running",
      });
    });

    expect(result.current.items[0]).toMatchObject({
      type: "assistant_turn",
      isStreaming: true,
      toolCalls: [expect.objectContaining({ key: "tc-r", status: "running" })],
    });
    expect(isChatResponsePending(result.current.items, false)).toBe(true);
  });

  it("after halt, late tool_progress/message_send do not reopen the turn until next user send", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) =>
          new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      result.current.appendUserMessage("Do work");
      result.current.updateUserMessageStatus("user-1", "sent");
    });

    act(() => {
      emitEvent("tool_progress", {
        tool_name: "bash",
        tool_label: "long job",
        tool_call_id: "tc-long",
        tool_status: "running",
      });
    });

    expect(result.current.items[1]).toMatchObject({
      type: "assistant_turn",
      isStreaming: true,
      toolCalls: [
        expect.objectContaining({ key: "tc-long", status: "running" }),
      ],
    });
    expect(isChatResponsePending(result.current.items, false)).toBe(true);

    act(() => {
      result.current.haltOpenAssistantTurn("Cancelled");
    });

    const halted = result.current.items[1];
    expect(halted).toMatchObject({
      type: "assistant_turn",
      isStreaming: false,
      toolCalls: [
        expect.objectContaining({
          key: "tc-long",
          status: "error",
          errorMessage: "Cancelled",
        }),
      ],
    });
    expect(isChatResponsePending(result.current.items, false)).toBe(false);

    const snapshotAfterHalt = structuredClone(result.current.items);

    // Late SSE that would normally reopen or append must be dropped.
    act(() => {
      emitEvent("tool_progress", {
        tool_name: "bash",
        tool_label: "late tool",
        tool_call_id: "tc-late",
        tool_status: "running",
      });
      emitEvent("message_send", {
        message_id: "msg-late",
        content: "Late final answer that should not appear",
      });
      emitEvent("message_edit", {
        message_id: "msg-late",
        content: "Late stream edit",
      });
    });

    expect(result.current.items).toEqual(snapshotAfterHalt);
    expect(isChatResponsePending(result.current.items, false)).toBe(false);

    // Next user send clears suppress so new generation events apply again.
    act(() => {
      result.current.appendUserMessage("Try again");
      result.current.updateUserMessageStatus("user-2", "sent");
    });

    act(() => {
      emitEvent("message_send", {
        message_id: "msg-retry",
        content: "New answer after cancel",
      });
    });

    expect(result.current.items.at(-1)).toMatchObject({
      type: "assistant_turn",
      content: "New answer after cancel",
      isStreaming: false,
    });
  });

  it("after halt, retainThreadStream (retry path) clears suppress without appendUserMessage", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) =>
          new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      result.current.appendUserMessage("First try");
      result.current.updateUserMessageStatus("user-1", "sent");
    });

    act(() => {
      result.current.haltOpenAssistantTurn("Cancelled");
    });

    expect(result.current.items[0]).toMatchObject({
      type: "user",
      id: "user-1",
      status: "error",
    });

    const snapshotAfterHalt = structuredClone(result.current.items);

    // Late SSE still suppressed until retain (retry) or append.
    act(() => {
      emitEvent("message_send", {
        message_id: "msg-late",
        content: "Should not appear",
      });
    });
    expect(result.current.items).toEqual(snapshotAfterHalt);

    // Retry reuses the bubble: retain + status sending → sent (no append).
    act(() => {
      result.current.retainThreadStream("thread-1");
      result.current.updateUserMessageStatus("user-1", "sending");
      result.current.updateUserMessageStatus("user-1", "sent");
    });

    act(() => {
      emitEvent("message_send", {
        message_id: "msg-after-retry",
        content: "Answer after retry",
      });
    });

    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0]).toMatchObject({
      type: "user",
      id: "user-1",
      content: "First try",
      status: "sent",
    });
    expect(result.current.items[1]).toMatchObject({
      type: "assistant_turn",
      content: "Answer after retry",
      isStreaming: false,
    });
  });

  it("updateUserMessageStatus ignores sent when bubble is already error", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) =>
          new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    act(() => {
      result.current.appendUserMessage("In flight");
    });
    act(() => {
      result.current.haltOpenAssistantTurn("Cancelled");
    });
    expect(result.current.items[0]).toMatchObject({ status: "error" });

    // Late HTTP success from original send must not clear error.
    act(() => {
      result.current.updateUserMessageStatus("user-1", "sent");
    });
    expect(result.current.items[0]).toMatchObject({ status: "error" });
    expect(isChatResponsePending(result.current.items, false)).toBe(false);
  });

  it("prepareRegenerate truncates after the checkpoint user message", async () => {
    const { result } = renderHook(() =>
      useChatEvents({
        threadId: "thread-1",
        eventSourceFactory: (url) =>
          new MockEventSource(url) as unknown as EventSource,
        historyFetcher: emptyHistory,
      }),
    );

    await waitFor(() => expect(latestSource()).toBeTruthy());

    let userId = "";
    act(() => {
      userId = result.current.appendUserMessage("Original prompt");
      result.current.updateUserMessageStatus(userId, "sent");
    });
    act(() => {
      emitEvent("message_send", {
        message_id: "ans-1",
        content: "Old answer",
      });
    });

    let checkpoint: { userId: string; content: string } | null = null;
    act(() => {
      checkpoint = result.current.prepareRegenerate("ans-1");
    });

    expect(checkpoint).toEqual({
      userId,
      content: "Original prompt",
    });
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0]).toMatchObject({
      type: "user",
      content: "Original prompt",
      status: "sending",
    });
  });
});

describe("isAssistantTurnOpen / isChatResponsePending", () => {
  const closedTurn: ChatTimelineAssistantTurn = {
    type: "assistant_turn",
    id: "msg-1",
    content: "Done",
    isStreaming: false,
    toolCalls: [],
  };

  const streamingTurn: ChatTimelineAssistantTurn = {
    type: "assistant_turn",
    id: "streaming",
    content: "",
    isStreaming: true,
    toolCalls: [],
  };

  const toolsRunningTurn: ChatTimelineAssistantTurn = {
    type: "assistant_turn",
    id: "tools",
    content: "",
    isStreaming: false,
    toolCalls: [
      {
        key: "tc-1",
        name: "vault_search",
        status: "running",
      },
    ],
  };

  it("detects open vs closed assistant turns", () => {
    expect(isAssistantTurnOpen(streamingTurn)).toBe(true);
    expect(isAssistantTurnOpen(toolsRunningTurn)).toBe(true);
    expect(isAssistantTurnOpen(closedTurn)).toBe(false);
    expect(
      isAssistantTurnOpen({
        ...closedTurn,
        reasoning: { content: "thinking", isStreaming: true },
      }),
    ).toBe(true);
  });

  it("marks response pending for isSending or open turn", () => {
    expect(isChatResponsePending([], false)).toBe(false);
    expect(isChatResponsePending([], true)).toBe(true);
    expect(isChatResponsePending([streamingTurn], false)).toBe(true);
    expect(isChatResponsePending([closedTurn], false)).toBe(false);
    expect(
      isChatResponsePending(
        [
          { type: "user", id: "u1", content: "hi", status: "sent" },
          streamingTurn,
        ],
        false,
      ),
    ).toBe(true);
    expect(
      isChatResponsePending(
        [
          { type: "user", id: "u1", content: "hi", status: "sent" },
          closedTurn,
        ],
        false,
      ),
    ).toBe(false);
    // Latest boundary is a sent/sending user message → still pending until SSE.
    expect(
      isChatResponsePending(
        [{ type: "user", id: "u1", content: "hi", status: "sent" }],
        false,
      ),
    ).toBe(true);
    expect(
      isChatResponsePending(
        [{ type: "user", id: "u1", content: "hi", status: "sending" }],
        false,
      ),
    ).toBe(true);
    expect(
      isChatResponsePending(
        [{ type: "user", id: "u1", content: "hi", status: "error" }],
        false,
      ),
    ).toBe(false);
    // Dead EventSource: trailing `sent` must not pin the composer on Stop.
    expect(
      isChatResponsePending(
        [{ type: "user", id: "u1", content: "hi", status: "sent" }],
        false,
        { streamLive: false },
      ),
    ).toBe(false);
    expect(
      isChatResponsePending(
        [{ type: "user", id: "u1", content: "hi", status: "sending" }],
        false,
        { streamLive: false },
      ),
    ).toBe(true);
    expect(
      isChatResponsePending(
        [{ type: "user", id: "u1", content: "hi", status: "sent" }],
        true,
        { streamLive: false },
      ),
    ).toBe(true);
  });
});

describe("applyChatEvent connector.qr", () => {
  it("upserts the same pairing bubble when the QR rotates", () => {
    const first = applyChatEvent([], {
      type: "connector.qr",
      chat_id: "c1",
      pairing_id: "pair-1",
      code: "2@A",
      phase: "code",
      ts: 1,
      metadata: { portal_event: "connector.qr", pairing_id: "pair-1", code: "2@A" },
    });
    const second = applyChatEvent(first, {
      type: "connector.qr",
      chat_id: "c1",
      pairing_id: "pair-1",
      code: "2@B",
      phase: "code",
      ts: 2,
      metadata: { portal_event: "connector.qr", pairing_id: "pair-1", code: "2@B" },
    });
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({
      type: "connector.qr",
      pairingId: "pair-1",
      code: "2@B",
    });
  });

  it("replaces the same bubble when pairing needs_reauth", () => {
    const first = applyChatEvent([], {
      type: "connector.qr",
      chat_id: "c1",
      pairing_id: "pair-2",
      code: "2@A",
      phase: "code",
      ts: 1,
      metadata: { portal_event: "connector.qr", pairing_id: "pair-2" },
    });
    const next = applyChatEvent(first, {
      type: "connector.qr",
      chat_id: "c1",
      pairing_id: "pair-2",
      code: "",
      phase: "needs_reauth",
      ts: 2,
      metadata: {
        portal_event: "connector.qr",
        pairing_id: "pair-2",
        phase: "needs_reauth",
        message: "Device unlinked",
      },
    });
    expect(next).toHaveLength(1);
    expect(next[0]).toMatchObject({
      type: "connector.qr",
      pairingId: "pair-2",
      phase: "needs_reauth",
      message: "Device unlinked",
    });
  });
});
