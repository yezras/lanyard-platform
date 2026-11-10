import { describe, expect, it } from "vitest";

import type { OutboundAction } from "./frames.js";
import {
  buildMcqSelectionMessageEvent,
  parseConnectorQrOutboundMetadata,
  parseMcqOutboundMetadata,
} from "./portal-metadata.js";

describe("parseMcqOutboundMetadata", () => {
  it("parses valid MCQ metadata", () => {
    const action: OutboundAction = {
      op: "send",
      chat_id: "thread-1",
      content: "Pick a lane",
      metadata: {
        portal_event: "mcq",
        mcq_id: "q-001",
        choices: [
          { id: "a", label: "Alpha" },
          { id: "b", label: "Beta" },
        ],
      },
    };

    const parsed = parseMcqOutboundMetadata(action);
    expect(parsed).toEqual({
      mcq_id: "q-001",
      prompt: "Pick a lane",
      choices: [
        { id: "a", label: "Alpha" },
        { id: "b", label: "Beta" },
      ],
    });
  });

  it("rejects fewer than two choices", () => {
    const action: OutboundAction = {
      op: "send",
      metadata: {
        portal_event: "mcq",
        mcq_id: "q-001",
        choices: [{ id: "only", label: "Only" }],
      },
    };
    expect(parseMcqOutboundMetadata(action)).toBeNull();
  });
});

describe("parseConnectorQrOutboundMetadata", () => {
  it("parses connector.qr and keeps the pairing id", () => {
    const action: OutboundAction = {
      op: "send",
      chat_id: "thread-1",
      content: "WhatsApp pairing in progress.",
      metadata: {
        portal_event: "connector.qr",
        connector_id: "whatsapp",
        pairing_id: "pair-1",
        code: "2@raw-qr-payload",
        ts: 1700000001000,
        phase: "code",
      },
    };
    expect(parseConnectorQrOutboundMetadata(action)).toEqual({
      portal_event: "connector.qr",
      connector_id: "whatsapp",
      pairing_id: "pair-1",
      code: "2@raw-qr-payload",
      ts: 1700000001000,
      phase: "code",
    });
  });

  it("ignores tool_progress metadata", () => {
    const action: OutboundAction = {
      op: "send",
      metadata: { portal_event: "tool_progress", pairing_id: "x" },
    };
    expect(parseConnectorQrOutboundMetadata(action)).toBeNull();
  });
});

describe("buildMcqSelectionMessageEvent", () => {
  it("normalizes selection into inbound metadata", () => {
    const event = buildMcqSelectionMessageEvent({
      selection: {
        mcq_id: "q-001",
        choice_id: "a",
        label: "Alpha",
        prompt_message_id: "msg-42",
      },
      source: {
        platform: "lanyard_web",
        chat_id: "thread-1",
        chat_type: "dm",
        chat_name: "Demo",
        user_id: "user-1",
        user_name: "Tester",
        thread_id: null,
        chat_topic: null,
      },
    });

    expect(event.text).toBe("Alpha");
    expect(event.message_type).toBe("mcq_selection");
    expect(event.reply_to_message_id).toBe("msg-42");
    expect(event.metadata).toEqual({
      portal_inbound: "mcq_selection",
      mcq_id: "q-001",
      choice_id: "a",
      choice_label: "Alpha",
    });
  });
});