import { describe, expect, it } from "vitest";

import { RELAY_CHAT_EVENT_TYPES } from "../harness/turn.js";
import type { MessageEvent, MessageType } from "./message-event.js";

describe("inbound MessageType has no mailbox_* variant (lp-v62i.3.4)", () => {
  it("channel mailbox send inbound stays message_type text, not mailbox_send", () => {
    const event: MessageEvent = {
      text: "Fizz, take the workshop notes.",
      message_type: "text",
      source: {
        platform: "lanyard_web",
        chat_id: "thr_workshop",
        chat_type: "channel",
        chat_name: "workshop",
        user_id: "bill",
        user_name: "Bill",
        thread_id: "thr_workshop",
        chat_topic: null,
      },
    };
    const locked: MessageType = "text";
    expect(event.message_type).toBe(locked);
    expect(event.message_type).not.toBe("mailbox_send");
    expect(String(event.message_type).startsWith("mailbox_")).toBe(false);
  });

  it("RelayChatEvent kinds do not include mailbox_*", () => {
    expect(RELAY_CHAT_EVENT_TYPES).not.toContain("mailbox_send");
    expect(RELAY_CHAT_EVENT_TYPES).not.toContain("mailbox_event");
    expect(
      RELAY_CHAT_EVENT_TYPES.some((type) => type.startsWith("mailbox_")),
    ).toBe(false);
  });
});
