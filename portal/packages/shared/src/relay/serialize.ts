/**
 * Frame serialization helpers for relay v1 wire conformance tests.
 *
 * @see https://github.com/NousResearch/hermes-agent/blob/main/docs/relay-connector-contract.md
 */

import type { RelayFrame } from "./frames.js";

/** Serialize a single relay frame as newline-delimited JSON (one line). */
export function serializeFrame(frame: RelayFrame): string {
  return `${JSON.stringify(frame)}\n`;
}

/** Parse one NDJSON line into a relay frame object. */
export function parseFrame(line: string): RelayFrame {
  const trimmed = line.trim();
  if (!trimmed) {
    throw new Error("empty relay frame line");
  }
  const parsed = JSON.parse(trimmed) as RelayFrame;
  if (!parsed || typeof parsed !== "object" || !("type" in parsed)) {
    throw new Error("relay frame missing type field");
  }
  return parsed;
}

/** Parse a multi-line NDJSON buffer (as used on the relay WebSocket). */
export function parseFrameBuffer(buffer: string): RelayFrame[] {
  return buffer
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseFrame(line));
}

/** Type guard for descriptor handshake reply. */
export function isDescriptorFrame(
  frame: RelayFrame,
): frame is Extract<RelayFrame, { type: "descriptor" }> {
  return frame.type === "descriptor";
}

/** Type guard for inbound delivery frame. */
export function isInboundFrame(
  frame: RelayFrame,
): frame is Extract<RelayFrame, { type: "inbound" }> {
  return frame.type === "inbound";
}

/** Type guard for outbound action frame. */
export function isOutboundFrame(
  frame: RelayFrame,
): frame is Extract<RelayFrame, { type: "outbound" }> {
  return frame.type === "outbound";
}