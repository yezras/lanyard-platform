/**
 * channel.add_member tool schema (lp-k5c4.20).
 *
 * Host tool wrapping POST /api/channels/:threadId/members as owner identity.
 * Model-visible fields are { thread_id, agent_id } only. Caller is stamped
 * by host (from session persona), never model-settable. Fail closed.
 *
 * Do not auto-add on @ of a non-member. Do not start a turn.
 */

const ID_PATTERN = /^[^:\s]+$/;
const ID_MAX = 128;

export const CHANNEL_ADD_MEMBER_TOOL_NAME = "channel.add_member" as const;

export const CHANNEL_ADD_MEMBER_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  required: ["thread_id", "agent_id"],
  properties: {
    thread_id: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[^:\\s]+$",
      description: "BFF thread_id of the channel (kind=group).",
    },
    agent_id: {
      type: "string",
      minLength: 1,
      maxLength: 128,
      pattern: "^[^:\\s]+$",
      description: "Catalog agent_id to add (existing person, not new).",
    },
  },
} as const;

export type ChannelAddMemberInput = {
  thread_id: string;
  agent_id: string;
};

export type ChannelAddMemberErrorCode =
  | "not_found"
  | "forbidden"
  | "bad_request";

function parseId(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`invalid ${label}`);
  }
  const trimmed = value.trim();
  if (
    trimmed.length === 0 ||
    trimmed.length > ID_MAX ||
    !ID_PATTERN.test(trimmed)
  ) {
    throw new Error(`invalid ${label}`);
  }
  return trimmed;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  rec: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
): void {
  for (const key of Object.keys(rec)) {
    if (!allowed.has(key)) {
      throw new Error(`invalid ${label}`);
    }
  }
}

const INPUT_FIELD_SET = new Set<string>(["thread_id", "agent_id"]);

/**
 * Parse model-visible channel.add_member input. Rejects extra keys and
 * empty/colon/whitespace ids. Caller is never model-settable.
 */
export function parseChannelAddMemberInput(
  value: unknown,
): ChannelAddMemberInput {
  const rec = asRecord(value, "ChannelAddMemberInput");
  assertExactKeys(rec, INPUT_FIELD_SET, "ChannelAddMemberInput");
  for (const key of ["thread_id", "agent_id"] as const) {
    if (!(key in rec)) {
      throw new Error("invalid ChannelAddMemberInput");
    }
  }
  const thread_id = parseId(rec.thread_id, "ChannelAddMemberInput.thread_id");
  const agent_id = parseId(rec.agent_id, "ChannelAddMemberInput.agent_id");
  return { thread_id, agent_id };
}

export function isChannelAddMemberErrorCode(
  value: string,
): value is ChannelAddMemberErrorCode {
  return value === "not_found" || value === "forbidden" || value === "bad_request";
}
