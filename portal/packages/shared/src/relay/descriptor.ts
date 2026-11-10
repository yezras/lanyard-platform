/**
 * CapabilityDescriptor — relay handshake payload.
 *
 * @see https://github.com/NousResearch/hermes-agent/blob/main/docs/relay-connector-contract.md#2-capabilitydescriptor-handshake-payload
 * @see https://github.com/NousResearch/hermes-agent/blob/main/gateway/relay/descriptor.py
 */

import {
  LANYARD_WEB_PLATFORM,
  RELAY_CONTRACT_VERSION,
} from "./contract.js";

export type MarkdownDialect = "plain" | "markdown_v2" | "discord" | string;
export type LengthUnit = "chars" | "utf16";

export interface CapabilityDescriptor {
  contract_version: number;
  platform: string;
  label: string;
  max_message_length: number;
  supports_draft_streaming: boolean;
  supports_edit: boolean;
  supports_threads: boolean;
  markdown_dialect: MarkdownDialect;
  len_unit: LengthUnit;
  emoji?: string;
  platform_hint?: string;
  pii_safe?: boolean;
}

const REQUIRED_DESCRIPTOR_KEYS: (keyof CapabilityDescriptor)[] = [
  "contract_version",
  "platform",
  "label",
  "max_message_length",
  "supports_draft_streaming",
  "supports_edit",
  "supports_threads",
  "markdown_dialect",
  "len_unit",
];

const DESCRIPTOR_DEFAULTS: Pick<
  CapabilityDescriptor,
  "emoji" | "platform_hint" | "pii_safe"
> = {
  emoji: "\u{1F50C}",
  platform_hint: "",
  pii_safe: false,
};

/** Serialize descriptor to stable compact JSON (sorted keys, Hermes-compatible). */
export function serializeCapabilityDescriptor(
  descriptor: CapabilityDescriptor,
): string {
  const payload = { ...DESCRIPTOR_DEFAULTS, ...descriptor };
  const sorted = Object.fromEntries(
    Object.keys(payload)
      .sort()
      .map((key) => [key, payload[key as keyof typeof payload]]),
  );
  return JSON.stringify(sorted);
}

/** Parse handshake JSON; unknown keys ignored; optional fields get defaults. */
export function parseCapabilityDescriptor(json: string): CapabilityDescriptor {
  const raw = JSON.parse(json) as Record<string, unknown>;
  const known = new Set([
    ...REQUIRED_DESCRIPTOR_KEYS,
    "emoji",
    "platform_hint",
    "pii_safe",
  ]);
  const filtered = Object.fromEntries(
    Object.entries(raw).filter(([key]) => known.has(key)),
  ) as Partial<CapabilityDescriptor>;

  const missing = REQUIRED_DESCRIPTOR_KEYS.filter(
    (key) => filtered[key] === undefined,
  );
  if (missing.length > 0) {
    throw new Error(
      `CapabilityDescriptor missing required fields: ${missing.join(", ")}`,
    );
  }

  return {
    ...DESCRIPTOR_DEFAULTS,
    ...filtered,
  } as CapabilityDescriptor;
}

/** Validate handshake descriptor shape for CI conformance (no live WS). */
export function isValidCapabilityDescriptor(
  value: unknown,
): value is CapabilityDescriptor {
  if (!value || typeof value !== "object") return false;
  const d = value as Record<string, unknown>;
  return (
    typeof d.contract_version === "number" &&
    typeof d.platform === "string" &&
    typeof d.label === "string" &&
    typeof d.max_message_length === "number" &&
    typeof d.supports_draft_streaming === "boolean" &&
    typeof d.supports_edit === "boolean" &&
    typeof d.supports_threads === "boolean" &&
    typeof d.markdown_dialect === "string" &&
    (d.len_unit === "chars" || d.len_unit === "utf16")
  );
}

/** Portal web adapter descriptor advertised at relay handshake. */
export function createLanyardWebDescriptor(
  overrides: Partial<CapabilityDescriptor> = {},
): CapabilityDescriptor {
  return {
    contract_version: RELAY_CONTRACT_VERSION,
    platform: LANYARD_WEB_PLATFORM,
    label: "Lanyard Web Portal",
    max_message_length: 32_000,
    supports_draft_streaming: true,
    supports_edit: true,
    supports_threads: false,
    markdown_dialect: "plain",
    len_unit: "chars",
    emoji: "\u{1F9F5}",
    platform_hint:
      "You are chatting through the Lanyard Web Portal. Responses stream as markdown.",
    pii_safe: false,
    ...overrides,
  };
}