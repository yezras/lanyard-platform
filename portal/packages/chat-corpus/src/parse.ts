import { contentSha256 } from "./hash.js";
import {
  ChatTurnRecordSchema,
  type ChatTurnRecord,
  type ChatTurnRecordDraft,
  type TurnMessageInput,
  type TurnMessageOutput,
} from "./schema.js";

/**
 * Parse and validate a ChatTurnRecord at the write boundary.
 * Throws ZodError when invalid (including content_sha256 mismatch).
 */
export function parseChatTurnRecord(input: unknown): ChatTurnRecord {
  return ChatTurnRecordSchema.parse(input);
}

/** Non-throwing parse for callers that branch on success. */
export function safeParseChatTurnRecord(input: unknown) {
  return ChatTurnRecordSchema.safeParse(input);
}

/**
 * Attach content_sha256 digests to input/output from UTF-8 content.
 * Overwrites any existing digests with the canonical hash.
 */
export function withContentHashes(draft: ChatTurnRecordDraft): ChatTurnRecord {
  const input: TurnMessageInput = {
    role: draft.input.role,
    content: draft.input.content,
    content_sha256: contentSha256(draft.input.content),
    ...(draft.input.content_type !== undefined
      ? { content_type: draft.input.content_type }
      : {}),
  };
  const output: TurnMessageOutput = {
    role: "assistant",
    content: draft.output.content,
    content_sha256: contentSha256(draft.output.content),
    ...(draft.output.finish_reason !== undefined
      ? { finish_reason: draft.output.finish_reason }
      : {}),
    ...(draft.output.content_type !== undefined
      ? { content_type: draft.output.content_type }
      : {}),
  };
  return parseChatTurnRecord({
    ...draft,
    input,
    output,
  });
}

/**
 * Return null when both body digests match; otherwise a short error string.
 * Does not run full schema validation.
 */
export function verifyContentHashes(record: {
  input: { content: string; content_sha256: string };
  output: { content: string; content_sha256: string };
}): string | null {
  const inHash = contentSha256(record.input.content);
  if (inHash !== record.input.content_sha256) {
    return `input.content_sha256 mismatch (expected ${inHash})`;
  }
  const outHash = contentSha256(record.output.content);
  if (outHash !== record.output.content_sha256) {
    return `output.content_sha256 mismatch (expected ${outHash})`;
  }
  return null;
}
