/**
 * Normalized inbound MessageEvent wire surface.
 *
 * @see https://github.com/NousResearch/hermes-agent/blob/main/docs/relay-connector-contract.md#3-inbound-messageevent-envelope
 * @see https://github.com/NousResearch/hermes-agent/blob/main/gateway/session.py (SessionSource.to_dict)
 */

export type ChatType = "dm" | "group" | "channel" | "thread" | "forum";
export type MessageType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document"
  | "sticker"
  | string;

/** SessionSource wire form (snake_case keys per Hermes §3). */
export interface SessionSource {
  platform: string;
  chat_id: string;
  chat_type: ChatType;
  chat_name: string | null;
  user_id: string | null;
  user_name: string | null;
  thread_id: string | null;
  chat_topic: string | null;
  user_id_alt?: string;
  chat_id_alt?: string;
  scope_id?: string;
  guild_id?: string;
  parent_chat_id?: string;
  message_id?: string;
  profile?: string;
}

/** Connector-normalized inbound event delivered inside an `inbound` frame. */
export interface MessageEvent {
  text: string;
  message_type: MessageType;
  source: SessionSource;
  message_id?: string;
  reply_to_message_id?: string;
  media_urls?: string[];
  /** Lanyard portal extensions (e.g. MCQ selection); additive wire field. */
  metadata?: Record<string, unknown>;
}