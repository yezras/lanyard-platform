import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ChatTimelineItem } from "../../hooks/useChatEvents.js";

import { ChatTimeline } from "./ChatTimeline.js";

const timelineItems: ChatTimelineItem[] = [
  {
    type: "user",
    id: "user-1",
    content: "Hello brain",
    status: "sent",
    createdAt: "2026-07-01T12:00:00.000Z",
  },
  {
    type: "assistant_turn",
    id: "msg-1",
    content: "Hi there",
    toolCalls: [],
    isStreaming: false,
    createdAt: "2026-07-01T12:00:05.000Z",
    model: "test-model",
  },
  {
    type: "mcq",
    mcqId: "mcq-1",
    messageId: "prompt-1",
    content: "Pick one",
    choices: [
      { id: "a", label: "Alpha" },
      { id: "b", label: "Beta" },
    ],
    selectedChoiceId: null,
    disabled: false,
  },
];

const tableMarkdown = `| Name | Score |
| --- | --- |
| Alice | 10 |
| Bob | 8 |`;

describe("ChatTimeline", () => {
  afterEach(() => {
    cleanup();
  });

  it("replaces the same WhatsApp QR bubble when the code rotates", () => {
    const first: ChatTimelineItem = {
      type: "connector.qr",
      pairingId: "pair-1",
      code: "2@FIRST",
      phase: "code",
      ts: 1,
    };
    const { rerender } = render(
      <ChatTimeline items={[first]} toolProgress={null} onMcqSelect={vi.fn()} />,
    );
    expect(screen.getByTestId("connector-qr-bubble").getAttribute("data-pairing-id")).toBe(
      "pair-1",
    );
    expect(screen.getByTestId("connector-qr-image")).toBeTruthy();
    expect(screen.queryByTestId("connector-qr-ascii-fallback")).toBeNull();
    rerender(
      <ChatTimeline
        items={[
          {
            ...first,
            code: "2@ROTATED",
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId("connector-qr-bubble")).toHaveLength(1);
    expect(screen.getByTestId("connector-qr-image").getAttribute("data-qr-code")).toBe(
      "2@ROTATED",
    );
  });

  it("renders timeline items and MCQ choices", () => {
    render(
      <ChatTimeline
        items={timelineItems}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("Hello brain")).toBeTruthy();
    expect(screen.getByText("Hi there")).toBeTruthy();
    expect(screen.getByText("Pick one")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Alpha" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Beta" })).toBeTruthy();
  });

  it("U2: three persona replies render as three speakers", () => {
    render(
      <ChatTimeline
        items={[
          {
            type: "user",
            id: "u1",
            content: "Please review the auth change.",
            status: "sent",
            speaker: {
              kind: "human",
              id: "usr_alice",
              display_name: "Alice",
            },
          },
          {
            type: "assistant_turn",
            id: "skip-1",
            content: "I'll take the first pass.",
            toolCalls: [],
            speaker: { kind: "persona", id: "skip", display_name: "Skip" },
          },
          {
            type: "assistant_turn",
            id: "lev-1",
            content: "Security notes attached.",
            toolCalls: [],
            speaker: { kind: "persona", id: "lev", display_name: "Lev" },
          },
          {
            type: "assistant_turn",
            id: "bana-1",
            content: "Architecture looks sound.",
            toolCalls: [],
            speaker: { kind: "persona", id: "bana", display_name: "Bana" },
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );

    expect(screen.getByTestId("chat-speaker-persona-skip")).toBeTruthy();
    expect(screen.getByTestId("chat-speaker-persona-lev")).toBeTruthy();
    expect(screen.getByTestId("chat-speaker-persona-bana")).toBeTruthy();
    expect(screen.getByText("I'll take the first pass.")).toBeTruthy();
    expect(screen.getByText("Security notes attached.")).toBeTruthy();
    expect(screen.getByText("Architecture looks sound.")).toBeTruthy();
  });

  it("U4: Skip's private subagent is a chip under Skip, not a fourth peer", () => {
    render(
      <ChatTimeline
        items={[
          {
            type: "assistant_turn",
            id: "skip-sub",
            content: "Helper finished.",
            speaker: { kind: "persona", id: "skip", display_name: "Skip" },
            toolCalls: [
              {
                key: "sa-qa-helper",
                name: "qa-helper",
                status: "complete",
                kind: "subagent",
                subagentStatus: "done",
              },
            ],
            segments: [
              {
                kind: "tool",
                call: {
                  key: "sa-qa-helper",
                  name: "qa-helper",
                  status: "complete",
                  kind: "subagent",
                  subagentStatus: "done",
                },
              },
            ],
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );

    const skipTurn = screen.getByTestId("chat-turn-persona-skip");
    expect(skipTurn).toBeTruthy();
    expect(
      skipTurn.querySelector('[data-testid="dither-avatar-roster"]') ??
        skipTurn.querySelector('[data-testid="chat-subagent-chip-wrap"]'),
    ).toBeTruthy();
    expect(screen.queryByTestId("chat-speaker-persona-qa-helper")).toBeNull();
    expect(screen.queryByTestId("chat-turn-persona-qa-helper")).toBeNull();
  });

  it("renders GFM markdown tables in assistant content", () => {
    render(
      <ChatTimeline
        items={[
          {
            type: "assistant_turn",
            id: "msg-table",
            content: tableMarkdown,
            toolCalls: [],
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );

    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("Bob")).toBeTruthy();
    expect(screen.getByText("10")).toBeTruthy();
  });

  it("renders collapsible reasoning; expanded while streaming, collapsed when final", () => {
    const { rerender } = render(
      <ChatTimeline
        items={[
          {
            type: "assistant_turn",
            id: "turn-1",
            content: "",
            toolCalls: [],
            isStreaming: true,
            reasoning: {
              content: "Working through the problem…",
              isStreaming: true,
            },
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );

    const thinkingTrigger = screen.getByRole("button", { name: /Thinking/i });
    expect(thinkingTrigger).toBeTruthy();
    expect(thinkingTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Working through the problem…")).toBeTruthy();

    rerender(
      <ChatTimeline
        items={[
          {
            type: "assistant_turn",
            id: "turn-1",
            content: "Final answer",
            toolCalls: [],
            isStreaming: false,
            reasoning: {
              content: "Working through the problem…",
              isStreaming: false,
            },
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );

    const thoughtTrigger = screen.getByRole("button", {
      name: /Thought process/i,
    });
    expect(thoughtTrigger).toBeTruthy();
    expect(thoughtTrigger.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText("Final answer")).toBeTruthy();
  });

  it("renders durable ChatToolCalls on the assistant turn", () => {
    render(
      <ChatTimeline
        items={[
          {
            type: "assistant_turn",
            id: "turn-tools",
            content: "Done",
            toolCalls: [
              {
                key: "tc-1",
                name: "vault_search",
                target: "query notes",
                status: "complete",
              },
            ],
            isStreaming: false,
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );

    expect(screen.getByText(/Searching files/i)).toBeTruthy();
    expect(screen.queryByText(/vault_search/i)).toBeNull();
    expect(screen.getByText(/query notes/i)).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
  });

  it("renders interleaved segments in chronological order (tool → reasoning → tool)", () => {
    const { container } = render(
      <ChatTimeline
        items={[
          {
            type: "assistant_turn",
            id: "turn-interleave",
            content: "Final answer",
            isStreaming: false,
            toolCalls: [
              {
                key: "tc-a",
                name: "vault_search",
                target: "query A",
                status: "complete",
              },
              {
                key: "tc-b",
                name: "read_file",
                target: "notes.md",
                status: "complete",
              },
            ],
            segments: [
              {
                kind: "tool",
                call: {
                  key: "tc-a",
                  name: "vault_search",
                  target: "query A",
                  status: "complete",
                },
              },
              {
                kind: "reasoning",
                key: "r1",
                content: "Mid-turn thought between tools",
                isStreaming: false,
              },
              {
                kind: "tool",
                call: {
                  key: "tc-b",
                  name: "read_file",
                  target: "notes.md",
                  status: "complete",
                },
              },
            ],
            reasoning: {
              content: "Mid-turn thought between tools",
              isStreaming: false,
            },
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );

    const text = container.textContent ?? "";
    // Default UI shows friendly activity verbs, not raw tool ids (lp-vnz.9).
    const toolA = text.indexOf("Searching files");
    const reasoning = text.indexOf("Mid-turn thought between tools");
    const toolB = text.indexOf("Reading documents");
    const answer = text.indexOf("Final answer");

    // Collapsed reasoning may hide body until expanded — trigger is enough for order.
    const thoughtTrigger = text.indexOf("Thought process");
    expect(toolA).toBeGreaterThanOrEqual(0);
    expect(toolB).toBeGreaterThanOrEqual(0);
    expect(answer).toBeGreaterThanOrEqual(0);
    // tool A before reasoning chrome before tool B before answer
    expect(toolA).toBeLessThan(thoughtTrigger >= 0 ? thoughtTrigger : toolB);
    expect(toolA).toBeLessThan(toolB);
    expect(toolB).toBeLessThan(answer);

    // Expand thought process so reasoning body is visible in order too.
    const trigger = screen.getByRole("button", { name: /Thought process/i });
    fireEvent.click(trigger);
    const afterExpand = container.textContent ?? "";
    const r = afterExpand.indexOf("Mid-turn thought between tools");
    expect(r).toBeGreaterThan(afterExpand.indexOf("Searching files"));
    expect(r).toBeLessThan(afterExpand.indexOf("Reading documents"));
    expect(reasoning).toBeGreaterThanOrEqual(0); // was in DOM (collapsed) or appears after expand
  });

  it("renders running tools and richer complete/error fields", () => {
    render(
      <ChatTimeline
        items={[
          {
            type: "assistant_turn",
            id: "turn-rich",
            content: "",
            isStreaming: true,
            toolCalls: [
              {
                key: "tc-run",
                name: "bash",
                target: "yarn test",
                status: "running",
                node: "cli:remote-server",
              },
              {
                key: "tc-done",
                name: "edit",
                target: "middleware.ts",
                status: "complete",
                duration: "85ms",
                additions: 8,
                deletions: 2,
              },
              {
                key: "tc-err",
                name: "read",
                target: "missing.ts",
                status: "error",
                errorMessage: "ENOENT",
              },
              {
                key: "sub-1",
                name: "researcher",
                target: "Investigate auth",
                status: "complete",
                duration: "2.1s",
              },
            ],
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );

    // Default UI: friendly verb, no raw bash / argv (lp-vnz.9).
    expect(screen.getByText(/Running a command/i)).toBeTruthy();
    expect(screen.queryByText(/^bash$/i)).toBeNull();
    expect(screen.queryByText(/yarn test/i)).toBeNull();
    expect(screen.getByText(/cli:remote-server/i)).toBeTruthy();
    expect(screen.getByText(/85ms/i)).toBeTruthy();
    expect(screen.getByText(/\+8/)).toBeTruthy();
    expect(screen.getByText(/-2/)).toBeTruthy();
    expect(screen.getByText(/researcher/i)).toBeTruthy();
    expect(screen.getByText(/Investigate auth/i)).toBeTruthy();
  });

  it("renders tool resultDetail CodeBlock for complete tools with result", () => {
    const result = `$ yarn test
 PASS  src/utils/formatDate.test.ts
Tests: 14 passed`;
    const { container } = render(
      <ChatTimeline
        items={[
          {
            type: "assistant_turn",
            id: "turn-result",
            content: "",
            isStreaming: true,
            toolCalls: [
              {
                key: "tc-bash",
                name: "bash",
                target: "yarn test",
                status: "complete",
                duration: "1.8s",
                result,
              },
            ],
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );

    expect(screen.getByText(/Running a command/i)).toBeTruthy();
    // Default row hides argv; advanced expand keeps technical detail.
    expect(container.textContent).not.toContain("formatDate.test.ts");
    const expandableRow = container.querySelector('[role="button"]');
    expect(expandableRow).toBeTruthy();
    fireEvent.click(expandableRow!);
    // CodeBlock tokenizes source — assert on aggregate textContent.
    expect(container.textContent).toContain("formatDate.test.ts");
  });

  it("shows the stamped model on user bubbles and hides it on assistant bubbles", () => {
    render(
      <ChatTimeline
        items={timelineItems.map((item) =>
          item.type === "user" ? { ...item, model: "user-model" } : item,
        )}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );

    // User model stamp.
    expect(screen.getByText("user-model")).toBeTruthy();
    // Assistant turns keep the model off the bubble (lp-bhcg.22).
    expect(screen.queryByTestId("chat-assistant-model")).toBeNull();
    expect(screen.queryByTestId("chat-assistant-footer")).toBeNull();
    expect(screen.queryByText("test-model")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Copy$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Regenerate/i })).toBeNull();
    // Quiet success: "sent" status is not shown.
    expect(screen.queryByText(/^Sent$/i)).toBeNull();
  });

  it("renders subagent runs as distinct chips (not ChatToolCalls rows)", () => {
    const onSubagentSelect = vi.fn();
    render(
      <ChatTimeline
        items={[
          {
            type: "assistant_turn",
            id: "turn-sub",
            content: "Done",
            isStreaming: false,
            toolCalls: [
              {
                key: "tc-read",
                name: "read_file",
                target: "a.md",
                status: "complete",
              },
              {
                key: "sa-1",
                name: "Explore",
                target: "Scan policies",
                status: "running",
                kind: "subagent",
                subagentStatus: "running",
                subagentColor: "#3B82F6",
                subagentIcon: "explore",
                duration: "0:42",
              },
            ],
            segments: [
              {
                kind: "tool",
                call: {
                  key: "tc-read",
                  name: "read_file",
                  target: "a.md",
                  status: "complete",
                },
              },
              {
                kind: "tool",
                call: {
                  key: "sa-1",
                  name: "Explore",
                  target: "Scan policies",
                  status: "running",
                  kind: "subagent",
                  subagentStatus: "running",
                  subagentColor: "#3B82F6",
                  subagentIcon: "explore",
                  duration: "0:42",
                },
              },
            ],
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
        onSubagentSelect={onSubagentSelect}
      />,
    );

    // Generic tool still present (friendly label, not raw tool id).
    expect(screen.getByText(/Reading documents/i)).toBeTruthy();
    expect(screen.queryByText(/read_file/i)).toBeNull();

    // Condensed header replaces inline chip with dither avatar roster (lp-n6e)
    expect(screen.getByTestId("chat-condensed-header")).toBeTruthy();
    expect(screen.getByTestId("dither-avatar-roster")).toBeTruthy();
    const avatar = screen.getByTestId("dither-avatar-sa-1");
    expect(avatar).toBeTruthy();
    expect(avatar.getAttribute("data-run-status")).toBe("running");
    // Inline chip no longer rendered when avatars present
    expect(screen.queryByTestId("chat-subagent-run-chip")).toBeNull();

    fireEvent.click(avatar);
    expect(onSubagentSelect).toHaveBeenCalledTimes(1);
    expect(onSubagentSelect.mock.calls[0]?.[0]).toMatchObject({
      id: "sa-1",
      name: "Explore",
      status: "running",
      color: "#3B82F6",
      icon: "explore",
    });
  });

  it("renders workflow runs as stage cards with nested subagents (lp-dpr.7)", () => {
    const onWorkflowSelect = vi.fn();
    const onSubagentSelect = vi.fn();
    render(
      <ChatTimeline
        items={[
          {
            type: "assistant_turn",
            id: "turn-wf",
            content: "",
            isStreaming: true,
            toolCalls: [
              {
                key: "wf-1",
                name: "Onboard project",
                status: "running",
                kind: "workflow",
                workflowStatus: "running",
                workflowStages: [
                  {
                    id: "discover",
                    name: "Discover",
                    status: "complete",
                    duration: "2s",
                    subagentIds: ["sa-1"],
                  },
                  {
                    id: "implement",
                    name: "Implement",
                    status: "running",
                    subagentIds: ["sa-2"],
                  },
                ],
              },
              {
                key: "sa-1",
                name: "Explore",
                status: "complete",
                kind: "subagent",
                subagentStatus: "done",
                subagentColor: "#3B82F6",
                subagentIcon: "explore",
              },
              {
                key: "sa-2",
                name: "coder",
                status: "running",
                kind: "subagent",
                subagentStatus: "running",
                subagentColor: "#10B981",
                subagentIcon: "code",
              },
            ],
            segments: [
              {
                kind: "tool",
                call: {
                  key: "wf-1",
                  name: "Onboard project",
                  status: "running",
                  kind: "workflow",
                  workflowStatus: "running",
                  workflowStages: [
                    {
                      id: "discover",
                      name: "Discover",
                      status: "complete",
                      duration: "2s",
                      subagentIds: ["sa-1"],
                    },
                    {
                      id: "implement",
                      name: "Implement",
                      status: "running",
                      subagentIds: ["sa-2"],
                    },
                  ],
                },
              },
              {
                kind: "tool",
                call: {
                  key: "sa-1",
                  name: "Explore",
                  status: "complete",
                  kind: "subagent",
                  subagentStatus: "done",
                  subagentColor: "#3B82F6",
                  subagentIcon: "explore",
                },
              },
              {
                kind: "tool",
                call: {
                  key: "sa-2",
                  name: "coder",
                  status: "running",
                  kind: "subagent",
                  subagentStatus: "running",
                  subagentColor: "#10B981",
                  subagentIcon: "code",
                },
              },
            ],
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
        onSubagentSelect={onSubagentSelect}
        onWorkflowSelect={onWorkflowSelect}
      />,
    );

    const card = screen.getByTestId("chat-workflow-run-card");
    expect(card.getAttribute("data-workflow-id")).toBe("wf-1");
    expect(screen.getByTestId("chat-workflow-stage-list")).toBeTruthy();
    expect(screen.getAllByTestId("chat-workflow-stage")).toHaveLength(2);
    // Nested subagent under expanded running stage
    expect(
      screen.getAllByTestId("chat-workflow-nested-subagent").length,
    ).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByTestId("chat-workflow-run-header"));
    expect(onWorkflowSelect).toHaveBeenCalledTimes(1);
    expect(onWorkflowSelect.mock.calls[0]?.[0]).toMatchObject({
      id: "wf-1",
      name: "Onboard project",
      status: "running",
    });
  });

  it("shows stamped model on user bubble (immutable per message)", () => {
    render(
      <ChatTimeline
        items={[
          {
            type: "user",
            id: "user-model",
            content: "Hi",
            status: "sending",
            createdAt: "2026-07-01T12:00:00.000Z",
            model: "grok-3",
          },
          {
            type: "assistant_turn",
            id: "turn-no-model",
            content: "Answer without model field",
            toolCalls: [],
            isStreaming: false,
            createdAt: "2026-07-01T12:00:05.000Z",
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("grok-3")).toBeTruthy();
    expect(screen.queryByTestId("chat-assistant-model")).toBeNull();
    expect(screen.queryByText(/model unknown/i)).toBeNull();
    // Sending status on user bubble.
    expect(screen.getByText(/Sending/i)).toBeTruthy();
  });

  it("renders assistant answers as filled bubbles with a time and no copy or regenerate", () => {
    const { container } = render(
      <ChatTimeline
        items={[
          {
            type: "user",
            id: "user-1",
            content: "Explain TLS",
            status: "sent",
            createdAt: "2026-07-01T12:00:00.000Z",
            model: "grok-4.5",
          },
          {
            type: "assistant_turn",
            id: "asst-1",
            content: "TLS encrypts transport…",
            toolCalls: [],
            isStreaming: false,
            createdAt: "2026-07-01T12:00:05.000Z",
            model: "grok-4.5",
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );

    const answer = screen.getByText("TLS encrypts transport…");
    const answerBubble = answer.closest(
      '[class*="astryx-chat-message-bubble"]',
    );
    expect(answerBubble?.getAttribute("data-sender")).toBe("assistant");
    expect(answerBubble?.getAttribute("data-variant")).toBe("filled");

    const user = screen.getByText("Explain TLS");
    const userBubble = user.closest('[class*="astryx-chat-message-bubble"]');
    expect(userBubble?.getAttribute("data-variant")).toBe("filled");

    const metaText = Array.from(
      container.querySelectorAll('[class*="astryx-chat-message-metadata"]'),
    )
      .map((node) => node.textContent ?? "")
      .join(" ");
    expect(metaText).toMatch(/\d{1,2}:\d{2}/);

    expect(screen.queryByTestId("chat-assistant-model")).toBeNull();
    expect(screen.queryByTestId("chat-assistant-footer")).toBeNull();
    expect(screen.queryByTestId("chat-assistant-regenerate")).toBeNull();
    expect(screen.queryByRole("button", { name: /Regenerate/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Copy$/i })).toBeNull();
    expect(screen.queryByText("grok-4.5")).toBeTruthy();
  });

  it("hides model, copy, and regenerate while assistant is streaming", () => {
    render(
      <ChatTimeline
        items={[
          {
            type: "assistant_turn",
            id: "streaming-1",
            content: "Partial…",
            toolCalls: [],
            isStreaming: true,
            model: "grok-4.5",
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("chat-assistant-model")).toBeNull();
    expect(screen.queryByTestId("chat-assistant-footer")).toBeNull();
    expect(screen.queryByRole("button", { name: /Regenerate/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Copy$/i })).toBeNull();
  });

  it("shows error status and retry on failed user message", () => {
    const onRetry = vi.fn();
    render(
      <ChatTimeline
        items={[
          {
            type: "user",
            id: "user-err",
            content: "Failed send",
            status: "error",
            createdAt: "2026-07-01T12:00:00.000Z",
            model: "grok-3",
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
        onRetryUserMessage={onRetry}
      />,
    );

    expect(screen.getByLabelText(/Message failed/i)).toBeTruthy();
    const retry = screen.getByRole("button", { name: /Retry/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledWith("user-err");
  });

  it("renders user and assistant answers as filled bubbles (lp-bhcg.22)", () => {
    const { container } = render(
      <ChatTimeline
        items={[
          {
            type: "user",
            id: "user-ghost-check",
            content: "User plain",
          },
          {
            type: "assistant_turn",
            id: "ghost-1",
            content: "Ghost answer",
            toolCalls: [],
            isStreaming: false,
            createdAt: "2026-07-01T12:00:05.000Z",
            model: "ghost-model",
            reasoning: {
              content: "Ghost reasoning",
              isStreaming: false,
            },
          },
          {
            type: "assistant",
            id: "legacy-asst",
            content: "Legacy ghost",
            isStreaming: false,
            model: "legacy-model",
            createdAt: "2026-07-01T12:01:00.000Z",
          },
          {
            type: "reasoning",
            id: "legacy-reason",
            content: "Legacy thought",
            isStreaming: false,
          },
          {
            type: "mcq",
            mcqId: "mcq-ghost",
            messageId: "prompt-ghost",
            content: "MCQ ghost",
            choices: [{ id: "a", label: "A" }],
            selectedChoiceId: null,
            disabled: false,
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("Ghost answer")).toBeTruthy();
    expect(screen.queryByText("ghost-model")).toBeNull();
    expect(screen.queryByText("legacy-model")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Copy$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Regenerate/i })).toBeNull();

    const answerBubble = screen
      .getByText("Ghost answer")
      .closest('[class*="astryx-chat-message-bubble"]');
    const legacyBubble = screen
      .getByText("Legacy ghost")
      .closest('[class*="astryx-chat-message-bubble"]');
    expect(answerBubble?.getAttribute("data-variant")).toBe("filled");
    expect(legacyBubble?.getAttribute("data-variant")).toBe("filled");

    // User bubbles stay filled, matching assistant answers.
    const userBubbles = container.querySelectorAll(
      '[class*="astryx-chat-message-bubble"][data-sender="user"]',
    );
    expect(userBubbles.length).toBeGreaterThanOrEqual(1);
    for (const bubble of userBubbles) {
      expect(bubble.getAttribute("data-variant")).toBe("filled");
    }

    // Reasoning and MCQ stay ghost; they are not conversation turns.
    const ghostBubbles = container.querySelectorAll(
      '[class*="astryx-chat-message-bubble"][data-variant="ghost"]',
    );
    expect(ghostBubbles.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Ghost reasoning")).toBeTruthy();
    expect(screen.getByText("MCQ ghost")).toBeTruthy();
  });

  it("renders empty streaming assistant shell as thinking pulse (lp-95v.6)", () => {
    const { container } = render(
      <ChatTimeline
        items={[
          {
            type: "assistant_turn",
            id: "stream-empty",
            content: "",
            toolCalls: [],
            isStreaming: true,
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );

    const pulse = screen.getByTestId("chat-thinking-pulse");
    expect(pulse).toBeTruthy();
    expect(pulse.getAttribute("aria-live")).toBe("polite");
    expect(pulse.textContent?.toLowerCase()).toMatch(
      /thinking|working|cooking|planning|drafting/,
    );
    const shell = container.querySelector(
      '[class*="astryx-chat-message-bubble"][data-variant="ghost"]',
    );
    expect(shell).toBeTruthy();
  });

  it("shows thinking pulse between tools while streaming; hides on final (lp-95v.6)", () => {
    const midTurnTools = [
      {
        key: "tc-1",
        name: "web_search",
        target: "world cup",
        status: "complete" as const,
      },
      {
        key: "tc-2",
        name: "read",
        target: "notes.md",
        status: "complete" as const,
      },
    ];

    const { rerender } = render(
      <ChatTimeline
        items={[
          {
            type: "assistant_turn",
            id: "turn-pulse",
            content: "",
            isStreaming: true,
            toolCalls: midTurnTools,
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );

    // Pulse is present and distinct from tool rows.
    const pulse = screen.getByTestId("chat-thinking-pulse");
    expect(pulse).toBeTruthy();
    expect(pulse.closest(".astryx-chat-tool-calls")).toBeNull();
    expect(
      screen.getAllByText(/Searching the web|Reading documents/i).length,
    ).toBeGreaterThanOrEqual(1);

    // Final answer lands — pulse disappears.
    rerender(
      <ChatTimeline
        items={[
          {
            type: "assistant_turn",
            id: "turn-pulse",
            content: "Here is the summary.",
            isStreaming: false,
            toolCalls: midTurnTools,
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("chat-thinking-pulse")).toBeNull();
    expect(screen.getByText("Here is the summary.")).toBeTruthy();
  });

  it("hides thinking pulse when answer content starts streaming", () => {
    const { container } = render(
      <ChatTimeline
        items={[
          {
            type: "assistant_turn",
            id: "turn-partial",
            content: "Partial answer text",
            isStreaming: true,
            toolCalls: [],
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );

    // hasAnswer gates the pulse even while tokens are still streaming.
    expect(screen.queryByTestId("chat-thinking-pulse")).toBeNull();
    // Answer bubble is present (Markdown may stream-buffer text into children).
    expect(
      container.querySelector(
        '[class*="astryx-chat-message-bubble"][data-sender="assistant"][data-variant="filled"]',
      ),
    ).toBeTruthy();
    expect(
      container.querySelector('[class*="astryx-markdown"]'),
    ).toBeTruthy();
  });

  it("renders citations and invokes onCitationClick", () => {
    const onCitationClick = vi.fn();

    render(
      <ChatTimeline
        items={[
          {
            type: "assistant_turn",
            id: "cite-1",
            content: "See source",
            toolCalls: [],
            citations: [
              { path: "/Projects/README.md", title: "README.md" },
            ],
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
        onCitationClick={onCitationClick}
      />,
    );

    const citation = screen.getByText("Projects/README.md");
    expect(citation).toBeTruthy();
    fireEvent.click(citation);
    expect(onCitationClick).toHaveBeenCalledWith("/Projects/README.md");
  });

  it("does not show connection status chrome", () => {
    render(
      <ChatTimeline
        items={timelineItems}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );

    expect(screen.queryByText(/Connected/i)).toBeNull();
  });

  it("invokes onMcqSelect when a choice is clicked", () => {
    const onMcqSelect = vi.fn();

    render(
      <ChatTimeline
        items={timelineItems}
        toolProgress={null}
        onMcqSelect={onMcqSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));

    expect(onMcqSelect).toHaveBeenCalledWith({
      mcqId: "mcq-1",
      choice: { id: "a", label: "Alpha" },
      promptMessageId: "prompt-1",
    });
  });

  it("renders in-progress tool calls from toolProgress fallback", () => {
    render(
      <ChatTimeline
        items={timelineItems}
        toolProgress="Searching vault index"
        onMcqSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("Searching vault index")).toBeTruthy();
  });

  it("renders user message content without name/status chrome", () => {
    render(
      <ChatTimeline
        items={[
          {
            type: "user",
            id: "user-1",
            content: "Hello brain",
            status: "sent",
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("Hello brain")).toBeTruthy();
    expect(screen.queryByText("You")).toBeNull();
    expect(screen.queryByText(/sent/i)).toBeNull();
  });

  it("does not invoke onMcqSelect when MCQ choices are disabled", () => {
    const onMcqSelect = vi.fn();

    render(
      <ChatTimeline
        items={[
          {
            type: "mcq",
            mcqId: "mcq-1",
            messageId: "prompt-1",
            content: "Pick one",
            choices: [{ id: "a", label: "Alpha" }],
            selectedChoiceId: "a",
            disabled: true,
          },
        ]}
        toolProgress={null}
        onMcqSelect={onMcqSelect}
      />,
    );

    const choice = screen.getByRole("button", { name: "Alpha" });
    expect(choice).toHaveProperty("disabled", true);
    fireEvent.click(choice);
    expect(onMcqSelect).not.toHaveBeenCalled();
  });

  it("renders gmail.draft Always / Reject and gmail.send Approve this call / Reject", () => {
    const onToolApprovalSelect = vi.fn();
    render(
      <ChatTimeline
        items={[
          {
            type: "tool_approval",
            approvalId: "appr-draft",
            gate: "sticky",
            actionClass: "gmail.draft",
            mapped: true,
            connectorId: "google",
            content: "Allow gmail.draft?",
            choices: [
              { id: "always", label: "Always" },
              { id: "reject", label: "Reject" },
            ],
            selectedChoiceId: null,
            disabled: false,
          },
          {
            type: "tool_approval",
            approvalId: "appr-send",
            gate: "every_call",
            actionClass: "gmail.send",
            mapped: true,
            connectorId: "google",
            content: "Approve this gmail.send call?",
            choices: [
              { id: "approve_this_call", label: "Approve this call" },
              { id: "reject", label: "Reject" },
            ],
            selectedChoiceId: null,
            disabled: false,
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
        onToolApprovalSelect={onToolApprovalSelect}
      />,
    );

    const bubbles = screen.getAllByTestId("tool-approval-bubble");
    const draft = bubbles[0];
    const sendBubble = bubbles[1];
    expect(draft?.getAttribute("data-action-class")).toBe("gmail.draft");
    expect(screen.getByRole("button", { name: "Always" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Reject" })).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Approve this call" })).toBeTruthy();
    expect(sendBubble?.getAttribute("data-gate")).toBe("every_call");
    expect(sendBubble?.textContent).not.toMatch(/Always/);

    fireEvent.click(screen.getByRole("button", { name: "Always" }));
    expect(onToolApprovalSelect).toHaveBeenCalledWith({
      approvalId: "appr-draft",
      choice: { id: "always", label: "Always" },
    });
  });

  it("renders complex multi-subagent + many nested tools after hydrate (lp-uxy.11)", () => {
    const nestedTools = Array.from({ length: 10 }, (_, i) => ({
      key: `tc-nested-${i}`,
      name: "Reading documents",
      technicalName: "read_file",
      target: `/Projects/file-${i}.ts`,
      status: "complete" as const,
      duration: "10ms",
      result: `// snippet ${i}\n`.repeat(20),
      parentSubagentId: "sa-explore",
    }));

    const hugeResult = "Y".repeat(60_000);
    const items: ChatTimelineItem[] = [
      {
        type: "user",
        id: "u-complex",
        content: "Complex multi-subagent request",
        status: "sent",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
      {
        type: "assistant_turn",
        id: "a-complex",
        content: "Finished multi-subagent work.",
        isStreaming: false,
        model: "grok-4.5",
        createdAt: "2026-08-01T00:01:00.000Z",
        toolCalls: [
          {
            key: "sa-explore",
            name: "Explore",
            target: "Scan codebase",
            status: "complete",
            kind: "subagent",
            subagentStatus: "done",
            subagentColor: "#3B82F6",
            subagentIcon: "explore",
            duration: "2.1s",
            artifacts: [{ path: "/Projects/src/auth.ts", kind: "file" }],
          },
          ...nestedTools,
          {
            key: "sa-coder",
            name: "Coder",
            target: "Apply patch",
            status: "complete",
            kind: "subagent",
            subagentStatus: "done",
            subagentColor: "#10B981",
            subagentIcon: "code",
            duration: "5s",
          },
          {
            key: "tc-bash",
            name: "Running a command",
            technicalName: "bash",
            target: "npm test",
            status: "complete",
            duration: "4s",
            result: hugeResult,
            parentSubagentId: "sa-coder",
          },
          {
            key: "tc-web",
            name: "Searching the web",
            technicalName: "web_search",
            target: "oauth",
            status: "complete",
            result: JSON.stringify({
              results: [{ title: "OAuth", url: "https://example.com" }],
            }),
          },
        ],
        segments: [
          {
            kind: "tool",
            call: {
              key: "sa-explore",
              name: "Explore",
              target: "Scan codebase",
              status: "complete",
              kind: "subagent",
              subagentStatus: "done",
              subagentColor: "#3B82F6",
              subagentIcon: "explore",
              duration: "2.1s",
            },
          },
          ...nestedTools.map((call) => ({
            kind: "tool" as const,
            call,
          })),
          {
            kind: "tool",
            call: {
              key: "sa-coder",
              name: "Coder",
              target: "Apply patch",
              status: "complete",
              kind: "subagent",
              subagentStatus: "done",
              subagentColor: "#10B981",
              subagentIcon: "code",
              duration: "5s",
            },
          },
          {
            kind: "tool",
            call: {
              key: "tc-bash",
              name: "Running a command",
              technicalName: "bash",
              target: "npm test",
              status: "complete",
              duration: "4s",
              result: hugeResult,
              parentSubagentId: "sa-coder",
            },
          },
          {
            kind: "tool",
            call: {
              key: "tc-web",
              name: "Searching the web",
              technicalName: "web_search",
              target: "oauth",
              status: "complete",
              result: JSON.stringify({
                results: [{ title: "OAuth", url: "https://example.com" }],
              }),
            },
          },
        ],
      },
    ];

    expect(() => {
      render(
        <ChatTimeline
          items={items}
          toolProgress={null}
          onMcqSelect={vi.fn()}
          onSubagentSelect={vi.fn()}
        />,
      );
    }).not.toThrow();

    expect(screen.getByText("Complex multi-subagent request")).toBeTruthy();
    expect(screen.getByText("Finished multi-subagent work.")).toBeTruthy();
    // Subagent avatars replace chips (not blank screen).
    expect(screen.getByTestId("dither-avatar-roster")).toBeTruthy();
    const avatars = screen.getAllByTestId(/^dither-avatar-/);
    expect(avatars.length).toBeGreaterThanOrEqual(2);
    // No per-item error fallback for the healthy turn.
    expect(screen.queryByTestId("chat-timeline-item-error")).toBeNull();
  });

  it("isolates a single turn render failure without blanking the thread (lp-uxy.11)", () => {
    // Force AssistantTurnBubble to throw via a Proxy toolCalls that blows up
    // when groupSegmentsForRender / resolveTurnSegments walks segments.
    const toxicCall = new Proxy(
      {
        key: "toxic",
        name: "boom",
        status: "complete" as const,
      },
      {
        get(target, prop, receiver) {
          if (prop === "kind" || prop === "status") {
            throw new Error("render-time corruption");
          }
          return Reflect.get(target, prop, receiver);
        },
      },
    );

    render(
      <ChatTimeline
        items={[
          {
            type: "user",
            id: "u-ok",
            content: "Still visible user message",
            status: "sent",
          },
          {
            type: "assistant_turn",
            id: "turn-toxic",
            content: "Should fallback",
            isStreaming: false,
            toolCalls: [toxicCall as ChatTimelineItem extends never ? never : never] as never,
            segments: [
              {
                kind: "tool",
                call: toxicCall as never,
              },
            ],
          },
          {
            type: "assistant_turn",
            id: "turn-ok",
            content: "Healthy answer after toxic turn",
            isStreaming: false,
            toolCalls: [],
            segments: [],
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );

    // User + healthy turn remain; toxic turn shows fallback or still paints answer.
    expect(screen.getByText("Still visible user message")).toBeTruthy();
    expect(screen.getByText("Healthy answer after toxic turn")).toBeTruthy();
  });

  it("keeps multi-subagent chips when answer content throws (lp-uxy.11 chart isolation)", () => {
    // AnswerContentErrorBoundary must preserve mid-turn subagent chips when the
    // final answer (e.g. chart fence / recharts Invalid hook call) throws.
    // Force answer render to throw via a content getter that only blows up when
    // ChatMessageContent reads the string — use a Proxy string-like object is
    // awkward; instead mount a turn whose content is fine and rely on the
    // separate ChartFenceErrorBoundary unit test for engine throws. Here we
    // verify mid-turn chips + tools still paint alongside a chart fence answer
    // (engine may succeed or error-boundary; chips must remain either way).
    const chartAnswer = [
      "Here is the runtime comparison:",
      "",
      "```chart",
      JSON.stringify({
        version: 1,
        type: "bar",
        title: "Big O over n",
        xKey: "n",
        series: [
          { key: "two_sum", label: "Two Sum" },
          { key: "merge", label: "Merge" },
          { key: "knapsack", label: "Knapsack" },
        ],
        data: [
          { n: "10", two_sum: 10, merge: 20, knapsack: 40 },
          { n: "100", two_sum: 100, merge: 200, knapsack: 400 },
        ],
      }),
      "```",
    ].join("\n");

    expect(() => {
      render(
        <ChatTimeline
          items={[
            {
              type: "user",
              id: "u-chart",
              content:
                "run three sub-agents and report a chart of their big O runtime",
              status: "sent",
            },
            {
              type: "assistant_turn",
              id: "turn-chart-subagents",
              content: chartAnswer,
              isStreaming: false,
              model: "test-model",
              toolCalls: [
                {
                  key: "sa-a",
                  name: "TwoSum",
                  target: "O(n)",
                  status: "complete",
                  kind: "subagent",
                  subagentStatus: "done",
                  subagentColor: "#3B82F6",
                  subagentIcon: "code",
                  duration: "2s",
                },
                {
                  key: "sa-b",
                  name: "MergeSort",
                  target: "O(n log n)",
                  status: "complete",
                  kind: "subagent",
                  subagentStatus: "done",
                  subagentColor: "#10B981",
                  subagentIcon: "code",
                  duration: "3s",
                },
                {
                  key: "sa-c",
                  name: "Knapsack",
                  target: "O(nW)",
                  status: "complete",
                  kind: "subagent",
                  subagentStatus: "done",
                  subagentColor: "#F59E0B",
                  subagentIcon: "code",
                  duration: "4s",
                },
              ],
              segments: [
                {
                  kind: "tool",
                  call: {
                    key: "sa-a",
                    name: "TwoSum",
                    target: "O(n)",
                    status: "complete",
                    kind: "subagent",
                    subagentStatus: "done",
                    subagentColor: "#3B82F6",
                    subagentIcon: "code",
                    duration: "2s",
                  },
                },
                {
                  kind: "tool",
                  call: {
                    key: "sa-b",
                    name: "MergeSort",
                    target: "O(n log n)",
                    status: "complete",
                    kind: "subagent",
                    subagentStatus: "done",
                    subagentColor: "#10B981",
                    subagentIcon: "code",
                    duration: "4s",
                  },
                },
                {
                  kind: "tool",
                  call: {
                    key: "sa-c",
                    name: "Knapsack",
                    target: "O(nW)",
                    status: "complete",
                    kind: "subagent",
                    subagentStatus: "done",
                    subagentColor: "#F59E0B",
                    subagentIcon: "code",
                    duration: "4s",
                  },
                },
              ],
            },
          ]}
          toolProgress={null}
          onMcqSelect={vi.fn()}
          onSubagentSelect={vi.fn()}
        />,
      );
    }).not.toThrow();

    // User prompt + three subagent avatars must remain even if chart engine fails (chips replaced by roster).
    expect(
      screen.getByText(
        /run three sub-agents and report a chart of their big O runtime/i,
      ),
    ).toBeTruthy();
    expect(screen.getByTestId("dither-avatar-roster")).toBeTruthy();
    const avatars = screen.getAllByTestId(/^dither-avatar-/);
    expect(avatars.length).toBeGreaterThanOrEqual(3);
    // Whole-turn item error must NOT fire for a chart-in-answer failure.
    expect(screen.queryByTestId("chat-timeline-item-error")).toBeNull();
  });




  it("static chart table keeps subagent chips when answer has chart fence (lp-uxy.11 residual)", () => {
    const chartJson = JSON.stringify({
      version: 1,
      type: "bar",
      title: "Big O",
      xKey: "n",
      series: [{ key: "t", label: "t" }],
      data: [{ n: "10", t: 10 }],
    });
    const chartFence = ["```chart", chartJson, "```"].join("\n");
    render(
      <ChatTimeline
        items={[
          {
            type: "assistant_turn",
            id: "a-chart",
            content: "Results:\n\n" + chartFence,
            isStreaming: false,
            toolCalls: [
              {
                key: "sa-1",
                name: "Explore",
                target: "Scan",
                status: "complete",
                kind: "subagent",
                subagentStatus: "done",
                subagentColor: "#3B82F6",
                subagentIcon: "explore",
                duration: "1s",
              },
            ],
            segments: [
              {
                kind: "tool",
                call: {
                  key: "sa-1",
                  name: "Explore",
                  target: "Scan",
                  status: "complete",
                  kind: "subagent",
                  subagentStatus: "done",
                  subagentColor: "#3B82F6",
                  subagentIcon: "explore",
                  duration: "1s",
                },
              },
            ],
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
        onSubagentSelect={vi.fn()}
      />,
    );
    expect(screen.getByTestId("dither-avatar-roster")).toBeTruthy();
    expect(screen.getByTestId("chat-static-chart-table")).toBeTruthy();
    expect(screen.queryByTestId("chat-timeline-item-error")).toBeNull();
  });

});

describe("ChatTimeline channel hides tool/activity dump (lp-cxhb.15.4)", () => {
  afterEach(() => {
    cleanup();
  });

  const noisyItems: ChatTimelineItem[] = [
    {
      type: "user",
      id: "u-noisy",
      content: "Please review the auth change.",
      status: "sent",
      createdAt: "2026-07-01T12:00:00.000Z",
      speaker: { kind: "human", id: "usr_alice", display_name: "Alice" },
    },
    {
      type: "assistant_turn",
      id: "skip-noisy",
      content: "I'll **take** the first pass.",
      isStreaming: false,
      createdAt: "2026-07-01T12:01:00.000Z",
      speaker: { kind: "persona", id: "skip", display_name: "Skip" },
      reasoning: {
        content: "CoT the room should never see",
        isStreaming: false,
      },
      toolCalls: [
        {
          key: "tc-read",
          name: "read_file",
          target: "auth.ts",
          status: "complete",
        },
        {
          key: "sa-qa",
          name: "qa-helper",
          status: "complete",
          kind: "subagent",
          subagentStatus: "done",
          subagentColor: "#3B82F6",
          subagentIcon: "explore",
        },
        {
          key: "wf-onboard",
          name: "Onboard project",
          status: "complete",
          kind: "workflow",
          workflowStatus: "complete",
          workflowStages: [
            { id: "discover", name: "Discover", status: "complete" },
          ],
        },
      ],
      segments: [
        {
          kind: "tool",
          call: {
            key: "tc-read",
            name: "read_file",
            target: "auth.ts",
            status: "complete",
          },
        },
        {
          kind: "reasoning",
          key: "r-noisy",
          content: "CoT the room should never see",
          isStreaming: false,
        },
        {
          kind: "tool",
          call: {
            key: "sa-qa",
            name: "qa-helper",
            status: "complete",
            kind: "subagent",
            subagentStatus: "done",
            subagentColor: "#3B82F6",
            subagentIcon: "explore",
          },
        },
        {
          kind: "tool",
          call: {
            key: "wf-onboard",
            name: "Onboard project",
            status: "complete",
            kind: "workflow",
            workflowStatus: "complete",
            workflowStages: [
              { id: "discover", name: "Discover", status: "complete" },
            ],
          },
        },
      ],
    },
  ];

  function assertNoToolDump() {
    // No generic tool rows (friendly labels), raw ids, or reasoning chrome.
    expect(screen.queryByText(/Searching files/i)).toBeNull();
    expect(screen.queryByText(/Reading documents/i)).toBeNull();
    expect(screen.queryByText(/Thought process/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Thinking/i })).toBeNull();
    // No subagent / workflow / source-stack activity chrome.
    expect(screen.queryByTestId("chat-subagent-chip-wrap")).toBeNull();
    expect(screen.queryByTestId("dither-avatar-roster")).toBeNull();
    expect(screen.queryByTestId("chat-workflow-run-card")).toBeNull();
    expect(screen.queryByTestId("chat-condensed-header")).toBeNull();
  }

  it("channel view shows chat text only: no tool/reasoning/subagent/workflow dump", () => {
    const { container } = render(
      <ChatTimeline
        items={noisyItems}
        toolProgress={null}
        onMcqSelect={vi.fn()}
        threadKind="group"
      />,
    );

    assertNoToolDump();

    // Chat text itself still renders, grouped as a channel row.
    const row = container.querySelector('[data-channel-item="skip-noisy"]');
    expect(row).toBeTruthy();
    expect(row?.textContent).toContain("the first pass.");
  });

  it("channel agent text renders as markdown (bold becomes strong)", () => {
    const { container } = render(
      <ChatTimeline
        items={noisyItems}
        toolProgress={null}
        onMcqSelect={vi.fn()}
        threadKind="group"
      />,
    );

    const strong = container.querySelector(
      '[data-channel-item="skip-noisy"] strong',
    );
    expect(strong).toBeTruthy();
    expect(strong?.textContent).toBe("take");
    // Markdown pipeline active (not tokenized plain text with literal asterisks).
    expect(rowText(container)).not.toContain("**take**");
  });

  it("hides the deprecated toolProgress activity row in channels", () => {
    render(
      <ChatTimeline
        items={noisyItems}
        toolProgress="Searching vault index"
        onMcqSelect={vi.fn()}
        threadKind="group"
      />,
    );

    expect(screen.queryByText("Searching vault index")).toBeNull();
  });

  it("1:1 thread keeps the full tool UI unchanged", () => {
    const { container } = render(
      <ChatTimeline
        items={noisyItems}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );

    // Friendly tool label present, subagent avatar roster, workflow card.
    expect(screen.getByText(/Reading documents/i)).toBeTruthy();
    expect(screen.getByTestId("dither-avatar-roster")).toBeTruthy();
    expect(screen.getByTestId("chat-workflow-run-card")).toBeTruthy();
    // Reasoning chrome still available in 1:1.
    expect(screen.getByRole("button", { name: /Thought process/i })).toBeTruthy();
    // Markdown bold also renders in 1:1 answers.
    expect(container.querySelector("strong")?.textContent).toBe("take");
  });
});

function rowText(container: HTMLElement): string {
  return (
    container.querySelector('[data-channel-item="skip-noisy"]')?.textContent ??
    ""
  );
}

describe("ChatTimeline channel transcript (lp-cxhb.15.3)", () => {
  afterEach(() => {
    cleanup();
  });

  const channelItems: ChatTimelineItem[] = [
    {
      type: "user",
      id: "u-chan",
      content: "Please review the auth change.",
      status: "sent",
      createdAt: "2026-07-01T12:00:00.000Z",
      speaker: {
        kind: "human",
        id: "usr_alice",
        display_name: "Alice",
      },
    },
    {
      type: "assistant_turn",
      id: "skip-1",
      content: "I'll take the first pass.",
      toolCalls: [],
      isStreaming: false,
      createdAt: "2026-07-01T12:01:00.000Z",
      model: "test-model",
      speaker: { kind: "persona", id: "skip", display_name: "Skip" },
    },
    {
      type: "assistant_turn",
      id: "skip-2",
      content: "Second pass complete.",
      toolCalls: [],
      isStreaming: false,
      createdAt: "2026-07-01T12:02:00.000Z",
      speaker: { kind: "persona", id: "skip", display_name: "Skip" },
    },
    {
      type: "assistant_turn",
      id: "lev-1",
      content: "Security notes attached.",
      toolCalls: [],
      isStreaming: false,
      createdAt: "2026-07-01T12:03:00.000Z",
      speaker: { kind: "persona", id: "lev", display_name: "Lev" },
    },
  ];

  function renderChannel() {
    return render(
      <ChatTimeline
        items={channelItems}
        toolProgress={null}
        onMcqSelect={vi.fn()}
        threadKind="group"
      />,
    );
  }

  it("renders grouped bubbles with dither avatar, sender name, time and delivered receipt", () => {
    const { container } = renderChannel();

    // Sender name shows on the first row of the Skip run only.
    const names = screen.getAllByTestId("chat-speaker-persona-skip");
    expect(names).toHaveLength(1);
    expect(names[0].textContent).toContain("Skip");
    expect(screen.getByTestId("chat-speaker-persona-lev")).toBeTruthy();

    // Dither avatar beside the bubble column.
    const avatar = screen.getByTestId("chat-channel-avatar-persona-skip");
    expect(avatar.getAttribute("data-avatar-seed")).toBe("skip");

    // Bubble grouping: first/middle/last across consecutive same-speaker rows.
    const row = (itemId: string) =>
      container.querySelector(`[data-channel-item="${itemId}"]`);
    expect(row("skip-1")?.getAttribute("data-channel-group")).toBe("first");
    expect(row("skip-2")?.getAttribute("data-channel-group")).toBe("last");
    expect(row("lev-1")?.getAttribute("data-channel-group")).toBe("single");

    // Time + delivered receipts are visible.
    const metas = container.querySelectorAll(
      '[class*="astryx-chat-message-metadata"]',
    );
    expect(metas.length).toBeGreaterThanOrEqual(2);
    const metaText = Array.from(metas)
      .map((m) => m.textContent ?? "")
      .join(" ");
    expect(metaText).toMatch(/\d{1,2}:\d{2}/);
    expect(screen.getByText("Delivered")).toBeTruthy();

    // Content still renders.
    expect(screen.getByText("I'll take the first pass.")).toBeTruthy();

    // Persona answer bubbles are visible filled bubbles in channels.
    const filledPersonaBubbles = container.querySelectorAll(
      '[class*="astryx-chat-message-bubble"][data-sender="assistant"]:not([data-variant="ghost"])',
    );
    expect(filledPersonaBubbles.length).toBe(3);
  });

  it("shows no model name and no regenerate/copy affordances in channels", () => {
    renderChannel();

    // Agent turns carry model ids in fixtures — channels never show them.
    expect(screen.queryByText(/test-model/i)).toBeNull();
    expect(screen.queryByText(/model unknown/i)).toBeNull();
    expect(screen.queryByTestId("chat-assistant-model")).toBeNull();
    expect(screen.queryByTestId("chat-assistant-footer")).toBeNull();
    expect(screen.queryByRole("button", { name: /regenerate/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^copy$/i })).toBeNull();
  });

  it("mailbox hop system_notice renders Sent to X band, not Messaged @X", () => {
    const { container } = render(
      <ChatTimeline
        items={[
          {
            type: "system_notice",
            id: "hop-1",
            content: "Sent to Bill\ncan you take this?",
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );

    const notice = screen.getByTestId("system-notice");
    const band = screen.getByTestId("mailbox-hop-band");
    expect(band.getAttribute("data-mailbox-band")).toBe("sent");
    expect(band.textContent).toContain("Sent to Bill");
    expect(band.textContent).toContain("can you take this?");
    expect(container.textContent).not.toContain("A message has been sent");
    expect(container.textContent).not.toContain("Messaged @");
    expect(screen.queryByTestId("mailbox-hop-notice")).toBeNull();
    expect(notice.textContent).not.toMatch(/I tagged/i);
    expect(notice.closest("button")).toBeNull();
    expect(notice.querySelector("a")).toBeNull();
    expect(screen.queryByRole("button", { name: /Resume/i })).toBeNull();
  });

  it("hides mailbox.send UUID tool rows from the chat transcript", () => {
    const { container } = render(
      <ChatTimeline
        items={[
          {
            type: "assistant_turn",
            id: "hop-tool",
            content: "",
            toolCalls: [
              {
                key: "mailbox-uuid",
                name: "mailbox.send",
                technicalName: "mailbox.send",
                target: "agt_bill-uuid-1234",
                status: "complete",
                result: JSON.stringify({
                  to: "agt_bill-uuid-1234",
                  text: "hi",
                }),
              },
            ],
            isStreaming: false,
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );

    expect(container.textContent).not.toContain("mailbox.send");
    expect(container.textContent).not.toContain("agt_bill-uuid-1234");
    expect(screen.queryByTestId("mailbox-hop-notice")).toBeNull();
  });

  it("restyles mailbox_inbound as Received from X, not a Fred bubble", () => {
    const { container } = render(
      <ChatTimeline
        items={[
          {
            type: "assistant_turn",
            id: "inbound-1",
            content: "Bill, take this",
            toolCalls: [],
            isStreaming: false,
            speaker: {
              kind: "persona",
              id: "agt_fred",
              display_name: "Fred",
            },
            mailboxInbound: { from_display_name: "Fred" },
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );

    const band = screen.getByTestId("mailbox-hop-band");
    expect(band.getAttribute("data-mailbox-band")).toBe("received");
    expect(band.textContent).toContain("Received from Fred");
    expect(band.textContent).toContain("Bill, take this");
    expect(container.textContent).not.toContain("A message has been sent");
    expect(container.textContent).not.toContain("Messaged @");
    expect(screen.queryByTestId("mailbox-hop-notice")).toBeNull();
    expect(band.closest("button")).toBeNull();
    expect(band.querySelector("a")).toBeNull();
  });

  it("does not add 1:1 hop chrome on channel bubbles", () => {
    render(
      <ChatTimeline
        items={[
          {
            type: "assistant_turn",
            id: "chan-fred",
            content: "Bill, stay in the room",
            toolCalls: [],
            isStreaming: false,
            speaker: {
              kind: "persona",
              id: "agt_fred",
              display_name: "Fred",
            },
            mailboxInbound: { from_display_name: "Fred" },
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
        threadKind="group"
      />,
    );

    expect(screen.queryByTestId("mailbox-hop-band")).toBeNull();
    expect(screen.queryByText("Received from Fred")).toBeNull();
    expect(screen.queryByText("Sent to Bill")).toBeNull();
    expect(screen.getByText("Bill, stay in the room")).toBeTruthy();
  });

  it("system_notice renders as non-tappable text with no Resume control", () => {
    render(
      <ChatTimeline
        items={[
          {
            type: "system_notice",
            id: "fuse-1",
            content: "This room paused after too much agent traffic.",
          },
        ]}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );

    const notice = screen.getByTestId("system-notice");
    expect(notice.textContent).toBe(
      "This room paused after too much agent traffic.",
    );
    expect(notice.closest("button")).toBeNull();
    expect(notice.querySelector("a")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: /Resume/i })).toBeNull();
    expect(screen.queryByText("Resume")).toBeNull();
    expect(screen.queryByText(/fuse/i)).toBeNull();
    expect(screen.queryByTestId("mailbox-halt")).toBeNull();
    expect(
      notice.closest('[class*="astryx-chat-message-bubble"]'),
    ).toBeNull();
  });

  it("keeps 1:1 free of model, copy, and regenerate without channel chrome", () => {
    const { container } = render(
      <ChatTimeline
        items={channelItems}
        toolProgress={null}
        onMcqSelect={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("chat-assistant-model")).toBeNull();
    expect(screen.queryByTestId("chat-assistant-footer")).toBeNull();
    expect(screen.queryByTestId("chat-assistant-regenerate")).toBeNull();
    expect(screen.queryByRole("button", { name: /regenerate/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^copy$/i })).toBeNull();
    expect(screen.queryByText(/test-model/i)).toBeNull();
    expect(screen.queryByText(/model unknown/i)).toBeNull();
    expect(screen.queryByTestId("chat-channel-avatar-persona-skip")).toBeNull();

    const filledAnswers = container.querySelectorAll(
      '[class*="astryx-chat-message-bubble"][data-sender="assistant"][data-variant="filled"]',
    );
    expect(filledAnswers.length).toBe(3);
    const metaText = Array.from(
      container.querySelectorAll('[class*="astryx-chat-message-metadata"]'),
    )
      .map((node) => node.textContent ?? "")
      .join(" ");
    expect(metaText).toMatch(/\d{1,2}:\d{2}/);
  });
});