import { describe, expect, it } from "vitest";

import type { OutboundAction } from "@lanyard/shared";

import {
  ChatDeliveryHub,
  detectReasoning,
  detectToolProgress,
  expandHermesToolProgressLines,
  extractChatSpeaker,
  extractCitations,
  extractModel,
  isHermesHomeChannelSetupNotice,
  MAILBOX_CHANNEL_SEND_EVENT_TYPE,
  MAILBOX_ONE_TO_ONE_HOP_NOTICE_EVENT_TYPE,
  mailboxVisibleEventType,
  outboundActionToChatEvent,
  outboundActionToChatEvents,
  parseToolStatus,
  type ChatOutboundEventType,
} from "../src/chat-delivery-hub.js";

type HasMailboxSse = Extract<ChatOutboundEventType, `mailbox_${string}`>;
const _noMailboxSseType: [HasMailboxSse] extends [never] ? true : false = true;
void _noMailboxSseType;

describe("ChatDeliveryHub history buffer", () => {
  it("retains durable outbound events without subscribers", () => {
    const hub = new ChatDeliveryHub();
    hub.publish({
      type: "message_send",
      chat_id: "chat-1",
      message_id: "m1",
      content: "Hello",
    });
    hub.publish({
      type: "typing",
      chat_id: "chat-1",
    });
    hub.publish({
      type: "tool_progress",
      chat_id: "chat-1",
      tool_name: "read_file",
      tool_call_id: "tc-1",
      tool_status: "complete",
    });

    const history = hub.listHistory("chat-1");
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      type: "message_send",
      message_id: "m1",
      content: "Hello",
    });
    expect(history[0]?.created_at).toBeTruthy();
    expect(history[1]).toMatchObject({
      type: "tool_progress",
      tool_call_id: "tc-1",
    });
  });

  it("retains message_edit and tool_progress with zero subscribers", () => {
    const hub = new ChatDeliveryHub();
    expect(hub.subscriberCount("chat-edit")).toBe(0);

    hub.publish({
      type: "message_edit",
      chat_id: "chat-edit",
      message_id: "m-edit",
      content: "Updated draft",
    });
    hub.publish({
      type: "tool_progress",
      chat_id: "chat-edit",
      tool_name: "bash",
      tool_call_id: "tc-edit",
      tool_status: "running",
      tool_label: "running tests",
    });
    hub.publish({
      type: "typing",
      chat_id: "chat-edit",
    });

    const history = hub.listHistory("chat-edit");
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({
      type: "message_edit",
      message_id: "m-edit",
      content: "Updated draft",
    });
    expect(history[0]?.created_at).toBeTruthy();
    expect(history[1]).toMatchObject({
      type: "tool_progress",
      tool_call_id: "tc-edit",
      tool_status: "running",
    });
    expect(history[1]?.created_at).toBeTruthy();
  });
});

describe("connector.qr portal_event", () => {
  it("maps reserved connector.qr and does not treat it as tool_progress", () => {
    const action: OutboundAction = {
      op: "send",
      chat_id: "chat-1",
      content: "WhatsApp pairing in progress.",
      metadata: {
        portal_event: "connector.qr",
        connector_id: "whatsapp",
        pairing_id: "pair-1",
        code: "2@raw-qr",
        ts: 1700000001000,
        phase: "code",
      },
    };
    expect(detectToolProgress(action)).toBeNull();
    expect(outboundActionToChatEvent(action, "m-qr")).toMatchObject({
      type: "connector.qr",
      pairing_id: "pair-1",
      code: "2@raw-qr",
      phase: "code",
      connector_id: "whatsapp",
    });
  });
});

describe("detectReasoning", () => {
  it("maps metadata.portal_event reasoning to content from metadata.reasoning", () => {
    const action: OutboundAction = {
      op: "send",
      chat_id: "chat-1",
      content: "ignored body",
      metadata: {
        portal_event: "reasoning",
        reasoning: "Step 1: inspect vault",
      },
    };

    expect(detectReasoning(action)).toEqual({
      content: "Step 1: inspect vault",
    });
  });

  it("falls back to action.content when metadata.reasoning is absent", () => {
    const action: OutboundAction = {
      op: "send",
      chat_id: "chat-1",
      content: "Thinking about files…",
      metadata: { portal_event: "reasoning" },
    };

    expect(detectReasoning(action)).toEqual({
      content: "Thinking about files…",
    });
  });

  it("returns null when portal_event is not reasoning", () => {
    const action: OutboundAction = {
      op: "send",
      chat_id: "chat-1",
      content: "hello",
      metadata: { portal_event: "tool_progress", tool_label: "search" },
    };

    expect(detectReasoning(action)).toBeNull();
  });
});

describe("outboundActionToChatEvent reasoning", () => {
  it("emits SSE type reasoning for portal_event reasoning", () => {
    const action: OutboundAction = {
      op: "send",
      chat_id: "chat-1",
      content: "chain of thought",
      metadata: { portal_event: "reasoning" },
    };

    expect(outboundActionToChatEvent(action, "msg-r1")).toEqual({
      type: "reasoning",
      chat_id: "chat-1",
      message_id: "msg-r1",
      content: "chain of thought",
      metadata: { portal_event: "reasoning" },
    });
  });

  it("still maps tool_progress ahead of reasoning", () => {
    const action: OutboundAction = {
      op: "send",
      chat_id: "chat-1",
      content: "searching",
      metadata: {
        portal_event: "tool_progress",
        tool_label: "vault search",
      },
    };

    expect(detectToolProgress(action)).toMatchObject({
      tool_label: "vault search",
      tool_status: "running",
    });
    expect(detectToolProgress(action)?.tool_name).toBeUndefined();
    expect(outboundActionToChatEvent(action)?.type).toBe("tool_progress");
  });

  it("normalizes host status aliases onto ChatToolCalls lifecycle (lp-dpr.3)", () => {
    expect(parseToolStatus("in_progress")).toBe("running");
    expect(parseToolStatus("started")).toBe("running");
    expect(parseToolStatus("done")).toBe("complete");
    expect(parseToolStatus("failed")).toBe("error");
    expect(parseToolStatus("queued")).toBe("pending");
    expect(parseToolStatus("nope")).toBeUndefined();

    const action: OutboundAction = {
      op: "send",
      chat_id: "chat-1",
      content: "read",
      metadata: {
        portal_event: "tool_call",
        tool_name: "read_file",
        tool_call_id: "tc-alias",
        status: "in_progress",
        tool_target: "/Projects/a.md",
      },
    };
    expect(detectToolProgress(action)).toMatchObject({
      tool_name: "read_file",
      tool_call_id: "tc-alias",
      tool_status: "running",
      tool_target: "/Projects/a.md",
    });
    expect(outboundActionToChatEvent(action)?.type).toBe("tool_progress");
  });

  it("maps Hermes emoji tool chrome content as tool_progress", () => {
    const action: OutboundAction = {
      op: "send",
      chat_id: "chat-1",
      content: '🔍 Searching the web for "lanyard"',
    };

    expect(detectToolProgress(action)).toMatchObject({
      tool_status: "running",
      tool_label: expect.stringContaining("Searching"),
    });
    expect(outboundActionToChatEvent(action)?.type).toBe("tool_progress");
  });

  it("maps multi-line Hermes progress bubbles as tool_progress", () => {
    const action: OutboundAction = {
      op: "edit",
      chat_id: "chat-1",
      message_id: "prog-1",
      content: '🔍 Searching the web for "a"\n💻 terminal: "ls -la"',
    };

    expect(detectToolProgress(action)).toMatchObject({
      tool_status: "running",
    });
    expect(outboundActionToChatEvent(action)?.type).toBe("tool_progress");
  });

  it("does not treat normal assistant prose as tool progress", () => {
    const action: OutboundAction = {
      op: "send",
      chat_id: "chat-1",
      content:
        "Here is a full answer about your project.\nIt has multiple paragraphs of text.",
    };

    expect(detectToolProgress(action)).toBeNull();
    expect(outboundActionToChatEvent(action)?.type).toBe("message_send");
  });

  it("maps reserved tool.approval to a dedicated chat event, not tool_progress", () => {
    const action: OutboundAction = {
      op: "send",
      chat_id: "chat-1",
      content: "Allow gmail.draft?",
      metadata: {
        portal_event: "tool.approval",
        approval_id: "appr-1",
        gate: "sticky",
        action_class: "gmail.draft",
        mapped: true,
        connector_id: "google",
        choices: [
          { id: "always", label: "Always" },
          { id: "reject", label: "Reject" },
        ],
      },
    };
    expect(detectToolProgress(action)).toBeNull();
    expect(outboundActionToChatEvent(action, "msg-1")).toMatchObject({
      type: "tool_approval",
      approval_id: "appr-1",
      gate: "sticky",
      action_class: "gmail.draft",
      mapped: true,
      connector_id: "google",
      content: "Allow gmail.draft?",
      choices: [
        { id: "always", label: "Always" },
        { id: "reject", label: "Reject" },
      ],
    });
  });

  it("maps richer tool metadata fields onto tool_progress events", () => {
    const action: OutboundAction = {
      op: "send",
      chat_id: "chat-1",
      content: "running",
      metadata: {
        portal_event: "tool_progress",
        tool_label: "read notes",
        tool_name: "read_file",
        tool_call_id: "call-9",
        tool_status: "complete",
        tool_target: "/Projects/notes.md",
        duration: "85ms",
        node: "cli:remote-server",
        additions: 8,
        deletions: 2,
        error_message: "ignored when complete",
      },
    };

    expect(outboundActionToChatEvent(action)).toMatchObject({
      type: "tool_progress",
      tool_label: "read notes",
      tool_name: "read_file",
      tool_call_id: "call-9",
      tool_status: "complete",
      tool_target: "/Projects/notes.md",
      duration: "85ms",
      node: "cli:remote-server",
      additions: 8,
      deletions: 2,
      error_message: "ignored when complete",
      errorMessage: "ignored when complete",
    });
  });

  it("formats numeric duration_ms and camelCase errorMessage", () => {
    const action: OutboundAction = {
      op: "send",
      chat_id: "chat-1",
      content: "failed",
      metadata: {
        portal_event: "tool_progress",
        tool_label: "bash",
        tool_name: "bash",
        tool_call_id: "call-err",
        tool_status: "error",
        duration_ms: 1500,
        errorMessage: "exit 1",
      },
    };

    expect(detectToolProgress(action)).toMatchObject({
      tool_status: "error",
      duration: "1.5s",
      errorMessage: "exit 1",
      error_message: "exit 1",
    });
  });

  it("maps tool result metadata onto tool_progress", () => {
    const action: OutboundAction = {
      op: "send",
      chat_id: "chat-1",
      content: "done",
      metadata: {
        portal_event: "tool_progress",
        tool_name: "bash",
        tool_call_id: "call-out",
        tool_status: "complete",
        tool_target: "yarn test",
        result: "PASS  14 tests",
      },
    };

    expect(outboundActionToChatEvent(action)).toMatchObject({
      type: "tool_progress",
      tool_name: "bash",
      result: "PASS  14 tests",
      tool_status: "complete",
    });
  });

  it("extracts fenced body from Hermes terminal chrome as result", () => {
    const action: OutboundAction = {
      op: "send",
      chat_id: "chat-1",
      content: '💻 terminal: "ls -la"\n```\ntotal 12\ndrwxr-xr-x  3 user\n```',
    };

    expect(detectToolProgress(action)).toMatchObject({
      tool_name: "terminal",
      tool_target: "ls -la",
      tool_status: "complete",
      result: "total 12\ndrwxr-xr-x  3 user",
    });
  });

  it("expands multi-line Hermes chrome into multiple tool_progress events", () => {
    const content =
      '🔍 Searching the web for "auth"\n💻 terminal: "rg refreshToken"';
    const expanded = expandHermesToolProgressLines(content);
    expect(expanded.length).toBe(2);
    expect(expanded[0]?.tool_name).toBeTruthy();
    expect(expanded[1]?.tool_name).toBe("terminal");

    const action: OutboundAction = {
      op: "edit",
      chat_id: "chat-1",
      message_id: "prog-1",
      content,
    };
    const events = outboundActionToChatEvents(action, "msg-1");
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.type === "tool_progress")).toBe(true);
  });

  it("keeps structured portal_event tool_progress as a single event", () => {
    const action: OutboundAction = {
      op: "send",
      chat_id: "chat-1",
      content: "running",
      metadata: {
        portal_event: "tool_progress",
        tool_name: "read_file",
        tool_call_id: "tc-1",
        tool_status: "running",
        tool_target: "/Projects/a.md",
      },
    };
    const events = outboundActionToChatEvents(action);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "tool_progress",
      tool_call_id: "tc-1",
      tool_name: "read_file",
    });
  });

  it("maps subagent portal_event as a distinct tool_progress row", () => {
    const action: OutboundAction = {
      op: "send",
      chat_id: "chat-1",
      content: "researching",
      metadata: {
        portal_event: "subagent",
        subagent_name: "researcher",
        tool_label: "Investigate auth flow",
        tool_call_id: "sub-1",
        tool_status: "running",
      },
    };

    expect(detectToolProgress(action)).toMatchObject({
      tool_label: "Investigate auth flow",
      tool_name: "researcher",
      tool_target: "Investigate auth flow",
      tool_call_id: "sub-1",
      tool_status: "running",
      tool_kind: "subagent",
      subagent_name: "researcher",
    });
    expect(outboundActionToChatEvent(action)?.type).toBe("tool_progress");
  });

  it("maps tool_kind subagent on tool_progress metadata", () => {
    const action: OutboundAction = {
      op: "send",
      chat_id: "chat-1",
      content: "done",
      metadata: {
        portal_event: "tool_progress",
        tool_kind: "subagent",
        agent_name: "coder",
        tool_label: "Implement fix",
        tool_status: "complete",
        duration: "3.2s",
      },
    };

    expect(detectToolProgress(action)).toMatchObject({
      tool_name: "coder",
      tool_target: "Implement fix",
      tool_kind: "subagent",
      subagent_name: "coder",
      tool_status: "complete",
      duration: "3.2s",
    });
  });

  it("maps workflow_progress portal_event as tool_progress with tool_kind workflow (lp-dpr.7)", () => {
    const action: OutboundAction = {
      op: "send",
      chat_id: "chat-1",
      content: "running workflow",
      metadata: {
        portal_event: "workflow_progress",
        workflow_id: "wf-1",
        workflow_name: "Onboard project",
        workflow_status: "running",
        stages: [
          { id: "discover", name: "Discover", status: "complete" },
          { id: "implement", name: "Implement", status: "running" },
        ],
      },
    };

    expect(detectToolProgress(action)).toMatchObject({
      tool_name: "Onboard project",
      tool_call_id: "wf-1",
      tool_status: "running",
      tool_kind: "workflow",
      tool_label: "Onboard project",
    });
    const event = outboundActionToChatEvent(action);
    expect(event?.type).toBe("tool_progress");
    expect(event?.tool_kind).toBe("workflow");
    expect(event?.metadata?.stages).toHaveLength(2);
  });

  it("extracts citations and model on final message_send", () => {
    const action: OutboundAction = {
      op: "send",
      chat_id: "chat-1",
      content: "Answer",
      metadata: {
        model: "claude-test",
        citations: [{ path: "/Projects/a.md", title: "A" }],
      },
    };

    expect(extractCitations(action.metadata)).toEqual([
      { path: "/Projects/a.md", title: "A" },
    ]);
    expect(extractModel(action.metadata)).toBe("claude-test");
    expect(outboundActionToChatEvent(action, "msg-1")).toMatchObject({
      type: "message_send",
      message_id: "msg-1",
      content: "Answer",
      model: "claude-test",
      citations: [{ path: "/Projects/a.md", title: "A" }],
    });
  });
});

describe("isHermesHomeChannelSetupNotice", () => {
  const hermesNotice =
    "📬 No home channel is set for Relay. A home channel is where Hermes delivers cron job results and cross-platform messages.\n\nType /sethome to make this chat your home channel, or ignore to skip.";

  it("detects the Hermes Relay home-channel setup notice", () => {
    expect(isHermesHomeChannelSetupNotice(hermesNotice)).toBe(true);
  });

  it("returns false for normal assistant content", () => {
    expect(isHermesHomeChannelSetupNotice("Here is your report.")).toBe(false);
    expect(
      isHermesHomeChannelSetupNotice(
        "You can use /sethome on Slack if you want a home channel.",
      ),
    ).toBe(false);
    expect(isHermesHomeChannelSetupNotice("")).toBe(false);
    expect(isHermesHomeChannelSetupNotice(null)).toBe(false);
  });
});

describe("outboundActionToChatEvent home-channel notice filter", () => {
  const hermesNotice =
    "📬 No home channel is set for Relay. A home channel is where Hermes delivers cron job results and cross-platform messages.\n\nType /sethome to make this chat your home channel, or ignore to skip.";

  it("drops Hermes Relay home-channel setup notices (send)", () => {
    const action: OutboundAction = {
      op: "send",
      chat_id: "chat-1",
      content: hermesNotice,
    };

    expect(outboundActionToChatEvent(action, "msg-noise")).toBeNull();
  });

  it("drops Hermes Relay home-channel setup notices (edit)", () => {
    const action: OutboundAction = {
      op: "edit",
      chat_id: "chat-1",
      message_id: "msg-1",
      content: hermesNotice,
    };

    expect(outboundActionToChatEvent(action)).toBeNull();
  });

  it("still maps ordinary send messages", () => {
    const action: OutboundAction = {
      op: "send",
      chat_id: "chat-1",
      content: "Hello from Hermes",
    };

    expect(outboundActionToChatEvent(action, "msg-1")).toMatchObject({
      type: "message_send",
      chat_id: "chat-1",
      content: "Hello from Hermes",
    });
  });
});

describe("mailbox send is message_send, no new SSE type (lp-v62i.3.4)", () => {
  const speaker = {
    kind: "persona" as const,
    id: "bill",
    display_name: "Bill",
  };

  it("does not add a mailbox_* ChatOutboundEventType", () => {
    const types: ChatOutboundEventType[] = [
      "message_send",
      "message_edit",
      "typing",
      "tool_progress",
      "reasoning",
      "mcq",
      "tool_approval",
      "connector.qr",
    ];
    expect(types.some((type) => type.startsWith("mailbox_"))).toBe(false);
    expect(MAILBOX_CHANNEL_SEND_EVENT_TYPE).toBe("message_send");
    expect(mailboxVisibleEventType("channel_send")).toBe("message_send");
  });

  it("channel mailbox send maps to message_send with speaker", () => {
    const action: OutboundAction = {
      op: "send",
      chat_id: "thr_workshop",
      content: "Fizz, take the workshop notes.",
      metadata: {
        speaker,
        persona: { persona_id: "bill", display_name: "Bill" },
      },
    };

    expect(detectToolProgress(action)).toBeNull();
    const event = outboundActionToChatEvent(action, "msg-mailbox-1");
    expect(event).toMatchObject({
      type: "message_send",
      chat_id: "thr_workshop",
      message_id: "msg-mailbox-1",
      content: "Fizz, take the workshop notes.",
      speaker,
    });
    expect(event?.type).toBe(MAILBOX_CHANNEL_SEND_EVENT_TYPE);
    expect(event?.type.startsWith("mailbox_")).toBe(false);
    expect(extractChatSpeaker(action.metadata)).toEqual(speaker);
  });

  it("stamps speaker from metadata.persona when metadata.speaker is absent (lp-znef.2)", () => {
    const action: OutboundAction = {
      op: "send",
      chat_id: "thr_workshop",
      content: "On it.",
      metadata: {
        persona: { persona_id: "fizz", display_name: "Fizz" },
      },
    };
    expect(outboundActionToChatEvent(action, "msg-fizz")).toMatchObject({
      type: "message_send",
      speaker: { kind: "persona", id: "fizz", display_name: "Fizz" },
    });
  });

  it("1:1 hop notice maps to existing system_notice; app.ts already consumes system_notice from history (~1788) so SSE does not need a mailbox_event type", () => {
    expect(mailboxVisibleEventType("one_to_one_hop_notice")).toBe(
      "system_notice",
    );
    expect(MAILBOX_ONE_TO_ONE_HOP_NOTICE_EVENT_TYPE).toBe("system_notice");
    expect(MAILBOX_ONE_TO_ONE_HOP_NOTICE_EVENT_TYPE.startsWith("mailbox_")).toBe(
      false,
    );

    const types: ChatOutboundEventType[] = [
      "message_send",
      "message_edit",
      "typing",
      "tool_progress",
      "reasoning",
      "mcq",
      "tool_approval",
      "connector.qr",
    ];
    expect(types).not.toContain("system_notice");
    expect(types).not.toContain("mailbox_event");
    expect(types).not.toContain("mailbox_send");
  });

  it("tool_progress is not the shared-room mailbox bubble", () => {
    const mailboxSend: OutboundAction = {
      op: "send",
      chat_id: "thr_workshop",
      content: "Fizz, please review the contract.",
      metadata: {
        speaker,
        persona: { persona_id: "bill", display_name: "Bill" },
      },
    };
    expect(detectToolProgress(mailboxSend)).toBeNull();
    expect(outboundActionToChatEvent(mailboxSend)?.type).toBe("message_send");

    const toolRow: OutboundAction = {
      op: "send",
      chat_id: "thr_workshop",
      content: "searching vault",
      metadata: {
        portal_event: "tool_progress",
        tool_label: "Searching vault",
        speaker,
      },
    };
    expect(outboundActionToChatEvent(toolRow)?.type).toBe("tool_progress");
    expect(outboundActionToChatEvent(toolRow)?.type).not.toBe("message_send");
  });

  it("retains speaker-stamped message_send in durable hub history", () => {
    const hub = new ChatDeliveryHub();
    const event = outboundActionToChatEvent(
      {
        op: "send",
        chat_id: "thr_workshop",
        content: "Channel a2a bubble.",
        metadata: { speaker },
      },
      "msg-hist",
    );
    expect(event).not.toBeNull();
    if (!event) return;
    hub.publish(event);
    expect(hub.listHistory("thr_workshop")[0]).toMatchObject({
      type: "message_send",
      content: "Channel a2a bubble.",
      speaker,
    });
  });
});
