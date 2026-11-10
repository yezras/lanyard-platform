import { describe, expect, it } from "vitest";

import {
  asTurnId,
  isRelayChatEvent,
  isTurnEvent,
  isTurnId,
  isTurnRequest,
  parseTurnRequest,
  RELAY_CHAT_EVENT_TYPES,
  type RelayChatEvent,
  type TurnEvent,
  type TurnId,
  type TurnRequest,
} from "./turn.js";

const VALID_REQUEST: TurnRequest = {
  tenant_id: "ten_1",
  user_id: "usr_1",
  instance_id: "inst_1",
  thread_id: "thr_1",
  message: "hello",
};

const VALID_EVENT: RelayChatEvent = {
  type: "message_send",
  chat_id: "thr_1",
  message_id: "msg_1",
  content: "hi",
};

describe("TurnId", () => {
  it("brands a non-empty string", () => {
    const id: TurnId = asTurnId("turn_1");
    expect(id).toBe("turn_1");
    expect(isTurnId(id)).toBe(true);
  });

  it("trims surrounding whitespace", () => {
    expect(asTurnId("  turn_2  ")).toBe("turn_2");
  });

  it("rejects empty and whitespace-only values", () => {
    expect(() => asTurnId("")).toThrow(/non-empty/);
    expect(() => asTurnId("   ")).toThrow(/non-empty/);
    expect(isTurnId("")).toBe(false);
    expect(isTurnId("   ")).toBe(false);
    expect(isTurnId(1)).toBe(false);
  });
});

describe("TurnRequest", () => {
  it("parses the five required fields", () => {
    expect(parseTurnRequest(VALID_REQUEST)).toEqual(VALID_REQUEST);
    expect(isTurnRequest(VALID_REQUEST)).toBe(true);
  });

  it("trims string fields", () => {
    expect(
      parseTurnRequest({
        tenant_id: " ten_1 ",
        user_id: " usr_1 ",
        instance_id: " inst_1 ",
        thread_id: " thr_1 ",
        message: " hello ",
      }),
    ).toEqual(VALID_REQUEST);
  });

  it("rejects missing or blank fields", () => {
    expect(isTurnRequest(null)).toBe(false);
    expect(isTurnRequest("turn")).toBe(false);
    expect(() =>
      parseTurnRequest({ ...VALID_REQUEST, tenant_id: "" }),
    ).toThrow(/tenant_id/);
    expect(() =>
      parseTurnRequest({ ...VALID_REQUEST, message: "   " }),
    ).toThrow(/message/);
    expect(() =>
      parseTurnRequest({ ...VALID_REQUEST, instance_id: 1 }),
    ).toThrow(/instance_id/);
    const { message: _omit, ...rest } = VALID_REQUEST;
    expect(isTurnRequest(rest)).toBe(false);
  });

  it("accepts optional sandbox_id and trims it", () => {
    expect(
      parseTurnRequest({ ...VALID_REQUEST, sandbox_id: " sbx-1 " }),
    ).toEqual({ ...VALID_REQUEST, sandbox_id: "sbx-1" });
  });

  it("omits missing or blank sandbox_id", () => {
    expect(parseTurnRequest(VALID_REQUEST)).toEqual(VALID_REQUEST);
    expect(parseTurnRequest({ ...VALID_REQUEST, sandbox_id: "" })).toEqual(
      VALID_REQUEST,
    );
    expect(parseTurnRequest({ ...VALID_REQUEST, sandbox_id: "   " })).toEqual(
      VALID_REQUEST,
    );
    expect(
      parseTurnRequest({ ...VALID_REQUEST, sandbox_id: null }),
    ).toEqual(VALID_REQUEST);
  });

  it("rejects a non-string sandbox_id", () => {
    expect(() =>
      parseTurnRequest({ ...VALID_REQUEST, sandbox_id: 1 }),
    ).toThrow(/sandbox_id/);
  });

  it("preserves persona, room_tail, and hidden_instruction (lp-v62i.3.6)", () => {
    const withMeta = {
      ...VALID_REQUEST,
      metadata: {
        persona: {
          persona_id: "agt_fizz",
          display_name: "Fizz",
          system_prompt: "You are Fizz.",
        },
        room_tail: [
          {
            type: "user_message",
            message_id: "msg_1",
            content: "hello",
            created_at: "2026-08-25T12:00:00.000Z",
            chat_id: "thr_1",
          },
        ],
        hidden_instruction: " Bill says take this ",
      },
    };
    expect(parseTurnRequest(withMeta)).toEqual({
      ...VALID_REQUEST,
      metadata: {
        persona: {
          persona_id: "agt_fizz",
          display_name: "Fizz",
          system_prompt: "You are Fizz.",
        },
        room_tail: [
          {
            type: "user_message",
            message_id: "msg_1",
            content: "hello",
            created_at: "2026-08-25T12:00:00.000Z",
            chat_id: "thr_1",
          },
        ],
        hidden_instruction: "Bill says take this",
      },
    });
    expect(parseTurnRequest(JSON.parse(JSON.stringify(withMeta)))).toEqual(
      parseTurnRequest(withMeta),
    );
  });

  it("omits blank metadata and rejects a non-object metadata", () => {
    expect(parseTurnRequest({ ...VALID_REQUEST, metadata: {} })).toEqual(
      VALID_REQUEST,
    );
    expect(
      parseTurnRequest({ ...VALID_REQUEST, metadata: { hidden_instruction: "  " } }),
    ).toEqual(VALID_REQUEST);
    expect(() =>
      parseTurnRequest({ ...VALID_REQUEST, metadata: [] }),
    ).toThrow(/metadata/);
    expect(() =>
      parseTurnRequest({ ...VALID_REQUEST, metadata: { room_tail: {} } }),
    ).toThrow(/room_tail/);
    expect(() =>
      parseTurnRequest({
        ...VALID_REQUEST,
        metadata: { hidden_instruction: 1 },
      }),
    ).toThrow(/hidden_instruction/);
  });
});

describe("TurnEvent alias of RelayChatEvent", () => {
  it("exports the same Relay event kinds the web mapper already consumes", () => {
    expect(RELAY_CHAT_EVENT_TYPES).toEqual([
      "message_send",
      "message_edit",
      "typing",
      "tool_progress",
      "reasoning",
      "mcq",
    ]);
  });

  it("accepts a RelayChatEvent as a TurnEvent", () => {
    const event: TurnEvent = VALID_EVENT;
    expect(isRelayChatEvent(event)).toBe(true);
    expect(isTurnEvent(event)).toBe(true);
    expect(isTurnEvent(event)).toBe(isRelayChatEvent(event));
  });

  it("accepts tool_progress and mcq shapes used on the relay path", () => {
    const tool: TurnEvent = {
      type: "tool_progress",
      chat_id: "thr_1",
      tool_name: "bash",
      tool_status: "running",
    };
    const mcq: TurnEvent = {
      type: "mcq",
      chat_id: "thr_1",
      mcq_id: "q1",
      choices: [{ id: "a", label: "A" }],
    };
    expect(isTurnEvent(tool)).toBe(true);
    expect(isTurnEvent(mcq)).toBe(true);
  });

  it("rejects unknown event types and missing chat_id", () => {
    expect(isTurnEvent({ type: "agent_starting", chat_id: "thr_1" })).toBe(
      false,
    );
    expect(isTurnEvent({ type: "message_send" })).toBe(false);
    expect(isTurnEvent(null)).toBe(false);
  });
});
