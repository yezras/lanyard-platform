import { describe, expect, it } from "vitest";
import { createLanyardWebDescriptor } from "./descriptor.js";
import {
  HERMES_HELLO_FRAME,
  HERMES_INBOUND_FRAME,
  HERMES_OUTBOUND_RESULT_FRAME,
  HERMES_OUTBOUND_SEND_FRAME,
} from "../fixtures/hermes-vectors.js";
import {
  isDescriptorFrame,
  isInboundFrame,
  isOutboundFrame,
  parseFrame,
  parseFrameBuffer,
  serializeFrame,
} from "./serialize.js";

describe("relay frame serialization", () => {
  it("serializes and parses gateway hello frame", () => {
    const line = serializeFrame(HERMES_HELLO_FRAME);
    const parsed = parseFrame(line);
    expect(parsed).toEqual(HERMES_HELLO_FRAME);
  });

  it("serializes handshake descriptor reply frame", () => {
    const frame = {
      type: "descriptor" as const,
      descriptor: createLanyardWebDescriptor(),
    };
    const parsed = parseFrame(serializeFrame(frame));
    expect(isDescriptorFrame(parsed)).toBe(true);
    if (isDescriptorFrame(parsed)) {
      expect(parsed.descriptor.platform).toBe("lanyard_web");
      expect(parsed.descriptor.contract_version).toBe(1);
    }
  });

  it("serializes inbound MessageEvent envelope", () => {
    const line = serializeFrame(HERMES_INBOUND_FRAME);
    const parsed = parseFrame(line);
    expect(isInboundFrame(parsed)).toBe(true);
    if (isInboundFrame(parsed)) {
      expect(parsed.event.text).toBe("hello brain");
      expect(parsed.event.source.platform).toBe("lanyard_web");
      expect(parsed.event.source.chat_id).toBe("chat-abc");
    }
  });

  it("serializes outbound send action and result pair", () => {
    const outboundLine = serializeFrame(HERMES_OUTBOUND_SEND_FRAME);
    const outbound = parseFrame(outboundLine);
    expect(isOutboundFrame(outbound)).toBe(true);
    if (isOutboundFrame(outbound)) {
      expect(outbound.action.op).toBe("send");
      expect(outbound.requestId).toBe("req-send-1");
    }

    const resultLine = serializeFrame(HERMES_OUTBOUND_RESULT_FRAME);
    const result = parseFrame(resultLine);
    expect(result.type).toBe("outbound_result");
    if (result.type === "outbound_result") {
      expect(result.result.success).toBe(true);
      expect(result.result.message_id).toBe("m1");
    }
  });

  it("parses multi-frame NDJSON buffers (mock gateway transcript)", () => {
    const transcript = [
      serializeFrame(HERMES_HELLO_FRAME),
      serializeFrame({
        type: "descriptor",
        descriptor: createLanyardWebDescriptor(),
      }),
      serializeFrame(HERMES_OUTBOUND_SEND_FRAME),
      serializeFrame(HERMES_OUTBOUND_RESULT_FRAME),
      serializeFrame(HERMES_INBOUND_FRAME),
    ].join("");

    const frames = parseFrameBuffer(transcript);
    expect(frames).toHaveLength(5);
    expect(frames[0]?.type).toBe("hello");
    expect(frames[1]?.type).toBe("descriptor");
    expect(frames[2]?.type).toBe("outbound");
    expect(frames[3]?.type).toBe("outbound_result");
    expect(frames[4]?.type).toBe("inbound");
  });
});