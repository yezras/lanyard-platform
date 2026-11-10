import { describe, expect, it } from "vitest";
import {
  LANYARD_WEB_PLATFORM,
  RELAY_CONTRACT_VERSION,
} from "./contract.js";
import {
  createLanyardWebDescriptor,
  isValidCapabilityDescriptor,
  parseCapabilityDescriptor,
  serializeCapabilityDescriptor,
} from "./descriptor.js";
import {
  HERMES_MINIMAL_DESCRIPTOR_JSON,
  HERMES_TELEGRAM_DESCRIPTOR,
} from "../fixtures/hermes-vectors.js";

describe("CapabilityDescriptor handshake", () => {
  it("round-trips Hermes telegram descriptor JSON", () => {
    const json = serializeCapabilityDescriptor(HERMES_TELEGRAM_DESCRIPTOR);
    const restored = parseCapabilityDescriptor(json);
    expect(restored).toEqual(HERMES_TELEGRAM_DESCRIPTOR);
  });

  it("ignores unknown keys (Hermes forward-compat vector)", () => {
    const json = serializeCapabilityDescriptor(HERMES_TELEGRAM_DESCRIPTOR);
    const withUnknown = `${json.slice(0, -1)},"future_field":"ignored"}`;
    const restored = parseCapabilityDescriptor(withUnknown);
    expect(restored).toEqual(HERMES_TELEGRAM_DESCRIPTOR);
  });

  it("fills optional defaults from minimal Hermes JSON", () => {
    const descriptor = parseCapabilityDescriptor(HERMES_MINIMAL_DESCRIPTOR_JSON);
    expect(descriptor.pii_safe).toBe(false);
    expect(descriptor.platform_hint).toBe("");
    expect(descriptor.emoji).toBe("\u{1F50C}");
  });

  it("validates lanyard_web handshake descriptor shape", () => {
    const descriptor = createLanyardWebDescriptor();
    expect(isValidCapabilityDescriptor(descriptor)).toBe(true);
    expect(descriptor.contract_version).toBe(RELAY_CONTRACT_VERSION);
    expect(descriptor.platform).toBe(LANYARD_WEB_PLATFORM);
    expect(descriptor.supports_draft_streaming).toBe(true);
    expect(descriptor.supports_edit).toBe(true);
    expect(descriptor.max_message_length).toBeGreaterThan(0);
    expect(descriptor.len_unit).toBe("chars");
  });

  it("serializes handshake descriptor with stable sorted keys", () => {
    const descriptor = createLanyardWebDescriptor();
    const json = serializeCapabilityDescriptor(descriptor);
    const keys = Object.keys(JSON.parse(json));
    expect(keys).toEqual([...keys].sort());
  });
});