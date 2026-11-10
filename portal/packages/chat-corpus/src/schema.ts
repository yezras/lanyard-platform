import { z } from "zod";

import { contentSha256, SHA256_HEX_RE } from "./hash.js";

/** ChatTurnRecord schema major — required on every record. */
export const CHAT_TURN_SCHEMA_VERSION = 1 as const;

/** Discriminator for multi-type corpus objects (v1). */
export const CHAT_TURN_RECORD_TYPE = "chat_turn" as const;

const sha256Hex = z
  .string()
  .regex(SHA256_HEX_RE, "content_sha256 must be 64 lowercase hex chars");

const dateTimeString = z
  .string()
  .min(1)
  .refine((v) => !Number.isNaN(Date.parse(v)), {
    message: "must be an RFC3339 / ISO-8601 date-time string",
  });

const nonEmpty = z.string().min(1);

export const ModelRefSchema = z
  .object({
    provider: nonEmpty,
    name: nonEmpty,
    api_id: nonEmpty.optional(),
  })
  .strict();

export const TurnMessageInputSchema = z
  .object({
    role: z.enum(["user", "system"]),
    content: z.string(),
    content_sha256: sha256Hex,
    content_type: z.enum(["text/plain", "text/markdown"]).optional(),
  })
  .strict()
  .superRefine((msg, ctx) => {
    if (contentSha256(msg.content) !== msg.content_sha256) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content_sha256"],
        message: "content_sha256 does not match UTF-8 SHA-256 of content",
      });
    }
  });

export const TurnMessageOutputSchema = z
  .object({
    role: z.literal("assistant"),
    content: z.string(),
    content_sha256: sha256Hex,
    finish_reason: nonEmpty.optional(),
    content_type: z.enum(["text/plain", "text/markdown"]).optional(),
  })
  .strict()
  .superRefine((msg, ctx) => {
    if (contentSha256(msg.content) !== msg.content_sha256) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content_sha256"],
        message: "content_sha256 does not match UTF-8 SHA-256 of content",
      });
    }
  });

export const ToolEventSchema = z
  .object({
    tool_call_id: nonEmpty,
    tool_name: nonEmpty,
    status: z.enum(["pending", "running", "complete", "error"]),
    target: z.string().optional(),
    duration_ms: z.number().int().nonnegative().optional(),
    result_summary: z.string().optional(),
    error_message: z.string().optional(),
    started_at: dateTimeString.optional(),
    finished_at: dateTimeString.optional(),
  })
  .strict();

/**
 * Operational metadata. Known keys are typed; additional string keys allowed
 * for forward-compatible writer tags (matches JSON Schema additionalProperties).
 */
export const TurnMetaSchema = z
  .object({
    request_id: nonEmpty.optional(),
    duration_ms: z.number().int().nonnegative().optional(),
    sandbox_id: nonEmpty.optional(),
    client: nonEmpty.optional(),
    relay_session_id: nonEmpty.optional(),
    job_id: nonEmpty.optional(),
  })
  .catchall(z.unknown());

/**
 * Zod write-boundary schema for ChatTurnRecord v1.
 * Aligns with contracts/chat-corpus-v1/chat-turn-record.schema.json.
 */
export const ChatTurnRecordSchema = z
  .object({
    schema_version: z.literal(CHAT_TURN_SCHEMA_VERSION),
    record_type: z.literal(CHAT_TURN_RECORD_TYPE),
    tenant_id: nonEmpty,
    user_id: nonEmpty,
    instance_id: nonEmpty,
    thread_id: nonEmpty,
    turn_id: nonEmpty,
    session_key: nonEmpty.optional(),
    created_at: dateTimeString,
    completed_at: dateTimeString.optional(),
    model: ModelRefSchema,
    input: TurnMessageInputSchema,
    output: TurnMessageOutputSchema,
    tool_events: z.array(ToolEventSchema),
    meta: TurnMetaSchema,
  })
  .strict();

export type ChatTurnRecord = z.infer<typeof ChatTurnRecordSchema>;
export type ModelRef = z.infer<typeof ModelRefSchema>;
export type TurnMessageInput = z.infer<typeof TurnMessageInputSchema>;
export type TurnMessageOutput = z.infer<typeof TurnMessageOutputSchema>;
export type ToolEvent = z.infer<typeof ToolEventSchema>;
export type TurnMeta = z.infer<typeof TurnMetaSchema>;

/** Input shape before content_sha256 is filled (writer helper). */
export type TurnMessageInputDraft = Omit<
  z.input<typeof TurnMessageInputSchema>,
  "content_sha256"
> & { content_sha256?: string };

export type TurnMessageOutputDraft = Omit<
  z.input<typeof TurnMessageOutputSchema>,
  "content_sha256"
> & { content_sha256?: string };

export type ChatTurnRecordDraft = Omit<
  z.input<typeof ChatTurnRecordSchema>,
  "input" | "output"
> & {
  input: TurnMessageInputDraft;
  output: TurnMessageOutputDraft;
};
