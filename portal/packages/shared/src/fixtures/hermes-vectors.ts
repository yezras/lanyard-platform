/**
 * Hermes relay conformance vectors for mock gateway / CI tests.
 *
 * Derived from hermes-agent tests/gateway/relay/ and relay-connector-contract.md.
 * No live WebSocket or Python dependency required.
 *
 * @see https://github.com/NousResearch/hermes-agent/blob/main/docs/relay-connector-contract.md
 */

import { RELAY_CONTRACT_VERSION } from "../relay/contract.js";
import type { CapabilityDescriptor } from "../relay/descriptor.js";
import type {
  HelloFrame,
  InboundFrame,
  OutboundFrame,
  OutboundResultFrame,
} from "../relay/frames.js";
import type { MessageEvent } from "../relay/message-event.js";

/** Hermes test_descriptor.py telegram fixture (utf16 / markdown_v2). */
export const HERMES_TELEGRAM_DESCRIPTOR: CapabilityDescriptor = {
  contract_version: RELAY_CONTRACT_VERSION,
  platform: "telegram",
  label: "Telegram",
  max_message_length: 4096,
  supports_draft_streaming: false,
  supports_edit: true,
  supports_threads: true,
  markdown_dialect: "markdown_v2",
  len_unit: "utf16",
  emoji: "\u2708\uFE0F",
  platform_hint: "You are on Telegram.",
  pii_safe: false,
};

/** Minimal descriptor JSON from Hermes test_from_json_fills_optional_defaults. */
export const HERMES_MINIMAL_DESCRIPTOR_JSON =
  '{"contract_version":1,"platform":"x","label":"X","max_message_length":2000,"supports_draft_streaming":false,"supports_edit":false,"supports_threads":false,"markdown_dialect":"plain","len_unit":"chars"}';

/** Gateway hello frame (ws_transport.py). */
export const HERMES_HELLO_FRAME: HelloFrame = {
  type: "hello",
  platform: "telegram",
  botId: "bot-123",
};

/** Connector inbound frame with normalized MessageEvent (contract §3). */
export const HERMES_INBOUND_CHAT_EVENT: MessageEvent = {
  text: "hello brain",
  message_type: "text",
  source: {
    platform: "lanyard_web",
    chat_id: "chat-abc",
    chat_type: "dm",
    chat_name: "Portal Chat",
    user_id: "user-42",
    user_name: "Alex",
    thread_id: null,
    chat_topic: null,
    profile: "default",
  },
  message_id: "msg-001",
};

export const HERMES_INBOUND_FRAME: InboundFrame = {
  type: "inbound",
  event: HERMES_INBOUND_CHAT_EVENT,
};

/** Gateway outbound send action (contract §4). */
export const HERMES_OUTBOUND_SEND_FRAME: OutboundFrame = {
  type: "outbound",
  requestId: "req-send-1",
  action: {
    op: "send",
    chat_id: "chat-abc",
    content: "Hello from the brain.",
    metadata: { stream: true },
  },
  platform: "lanyard_web",
};

export const HERMES_OUTBOUND_RESULT_FRAME: OutboundResultFrame = {
  type: "outbound_result",
  requestId: "req-send-1",
  result: {
    success: true,
    message_id: "m1",
  },
};