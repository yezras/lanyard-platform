/**
 * Canonical mailbox.send / mailbox_halt types (lp-v62i.1.1).
 * SoT: wayfinder/agent-mailbox-v1.md. Types only — no send runtime.
 *
 * Branding matches BFF wake-policy.ts (no colon, no whitespace).
 * Do not import BFF chat-store types here.
 */

import { isMailboxErrorCode, type MailboxErrorCode } from "./errors.js";

export const MAILBOX_SCHEMA_VERSION = 1 as const;

export type PersonaId = string & { readonly __brand: "PersonaId" };
export type ThreadId = string & { readonly __brand: "ThreadId" };

const ID_PATTERN = /^[^:\s]+$/;
const ID_MAX = 128;

/** Connector @ marks. Not personas. Parser leaf uses these; they do not wake. */
export const CONNECTOR_MARKS = [
  "google",
  "hubspot",
  "whatsapp",
  "github",
] as const;

export type ConnectorMark = (typeof CONNECTOR_MARKS)[number];

const CONNECTOR_MARK_SET = new Set<string>(CONNECTOR_MARKS);

export function isConnectorMark(value: string): value is ConnectorMark {
  return CONNECTOR_MARK_SET.has(value);
}

/** Jack is not a mailbox address. Talk to Jack is a normal room message. */
export function isJackAddress(value: string): boolean {
  return value.toLowerCase() === "jack";
}

/**
 * `to` values that are never a persona: Jack, or a connector mark mistaken
 * as a persona. Self is a runtime `bad_to` (needs `from`).
 */
export function isMailboxForbiddenTo(value: string): boolean {
  return isJackAddress(value) || isConnectorMark(value);
}

/** Parse a PersonaId at the boundary. Colon and whitespace are illegal. */
export function personaId(value: string): PersonaId {
  if (value.length === 0 || value.length > ID_MAX || !ID_PATTERN.test(value)) {
    throw new Error("invalid PersonaId");
  }
  return value as PersonaId;
}

/** Parse a BFF thread_id. Colon and whitespace are illegal. Not a channel name. */
export function threadId(value: string): ThreadId {
  if (value.length === 0 || value.length > ID_MAX || !ID_PATTERN.test(value)) {
    throw new Error("invalid ThreadId");
  }
  return value as ThreadId;
}

/**
 * One mailbox `to`. Not a list, not a user id, not Jack, not a connector id.
 */
export function parseMailboxTo(value: string): PersonaId {
  if (isMailboxForbiddenTo(value)) {
    throw new Error("bad_to");
  }
  return personaId(value);
}

/** Canonical tool name. Platform hop authorizes; agent runtime calls this. */
export const MAILBOX_SEND_TOOL_NAME = "mailbox.send";

/** Model-visible mailbox.send fields. `from` is absent. */
export const MAILBOX_SEND_INPUT_FIELDS = ["to", "room", "text", "nonce"] as const;

/** Gateway stamps. Never model-settable. */
export const MAILBOX_SEND_STAMP_FIELDS = ["from", "tenant_id"] as const;

const SEND_INPUT_FIELD_SET = new Set<string>(MAILBOX_SEND_INPUT_FIELDS);
const HALT_FIELD_SET = new Set<string>(["room"]);
const APPEND_FIELD_SET = new Set<string>([
  ...MAILBOX_SEND_INPUT_FIELDS,
  ...MAILBOX_SEND_STAMP_FIELDS,
]);
const APPEND_OK_FIELD_SET = new Set<string>(["ok", "message_id"]);
const APPEND_ERR_FIELD_SET = new Set<string>(["ok", "error"]);

/**
 * Model-visible mailbox.send tool input.
 * `nonce` IS `externalMessageId` on the wire. Dedupe key is nonce only.
 */
export type MailboxSendInput = {
  to: PersonaId;
  room: ThreadId;
  text: string;
  nonce: string;
};

/** Gateway stamps. Session persona; never spoofed from the model. */
export type MailboxSendStamps = {
  from: PersonaId;
  tenant_id: string;
};

/**
 * Internal BFF append body (types only; BFF leaf implements).
 * Send input plus gateway `from` / `tenant_id` stamps.
 */
export type MailboxAppendRequest = MailboxSendInput & MailboxSendStamps;

/** mailbox_halt input. Lead tool + Jack's button. Non-lead is `forbidden`. */
export type MailboxHaltInput = {
  room: ThreadId;
};

export type MailboxAppendResult =
  | { ok: true; message_id: string }
  | { ok: false; error: MailboxErrorCode };

/**
 * Nonce IS externalMessageId. Same nonce → idempotent no-op.
 * Do not dedupe on (from, to, room, text).
 */
export function mailboxExternalMessageId(nonce: string): string {
  return nonce;
}

/** Dedupe key is nonce only. */
export function mailboxDedupeKey(nonce: string): string {
  return nonce;
}

/** Prose @ path nonce. Tool path uses a UUID per send. */
export function proseMailboxNonce(
  turnId: string,
  to: PersonaId,
  room: ThreadId,
): string {
  return `prose:${turnId}:${to}:${room}`;
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

function requireString(
  rec: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const value = rec[key];
  if (typeof value !== "string") {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function parseNonce(value: string, label: string): string {
  if (value.length === 0) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

function parseSendFields(
  rec: Record<string, unknown>,
  label: string,
): MailboxSendInput {
  if (Array.isArray(rec.to)) {
    throw new Error(`invalid ${label}`);
  }
  const to = parseMailboxTo(requireString(rec, "to", label));
  const room = threadId(requireString(rec, "room", label));
  const text = requireString(rec, "text", label);
  const nonce = parseNonce(requireString(rec, "nonce", label), label);
  return { to, room, text, nonce };
}

/** Parse model-visible mailbox.send input. Rejects `from` and extra keys. */
export function parseMailboxSendInput(value: unknown): MailboxSendInput {
  const rec = asRecord(value, "MailboxSendInput");
  assertExactKeys(rec, SEND_INPUT_FIELD_SET, "MailboxSendInput");
  for (const key of MAILBOX_SEND_INPUT_FIELDS) {
    if (!(key in rec)) {
      throw new Error("invalid MailboxSendInput");
    }
  }
  return parseSendFields(rec, "MailboxSendInput");
}

export function parseMailboxHaltInput(value: unknown): MailboxHaltInput {
  const rec = asRecord(value, "MailboxHaltInput");
  assertExactKeys(rec, HALT_FIELD_SET, "MailboxHaltInput");
  if (!("room" in rec)) {
    throw new Error("invalid MailboxHaltInput");
  }
  return { room: threadId(requireString(rec, "room", "MailboxHaltInput")) };
}

export function parseMailboxAppendRequest(value: unknown): MailboxAppendRequest {
  const rec = asRecord(value, "MailboxAppendRequest");
  assertExactKeys(rec, APPEND_FIELD_SET, "MailboxAppendRequest");
  for (const key of MAILBOX_SEND_INPUT_FIELDS) {
    if (!(key in rec)) {
      throw new Error("invalid MailboxAppendRequest");
    }
  }
  if (!("from" in rec) || !("tenant_id" in rec)) {
    throw new Error("invalid MailboxAppendRequest");
  }
  const send = parseSendFields(rec, "MailboxAppendRequest");
  const from = personaId(requireString(rec, "from", "MailboxAppendRequest"));
  const tenant_id = requireString(rec, "tenant_id", "MailboxAppendRequest");
  if (tenant_id.length === 0) {
    throw new Error("invalid MailboxAppendRequest");
  }
  return { ...send, from, tenant_id };
}

export function parseMailboxAppendResult(value: unknown): MailboxAppendResult {
  const rec = asRecord(value, "MailboxAppendResult");
  if (rec.ok === true) {
    assertExactKeys(rec, APPEND_OK_FIELD_SET, "MailboxAppendResult");
    const message_id = requireString(rec, "message_id", "MailboxAppendResult");
    if (message_id.length === 0) {
      throw new Error("invalid MailboxAppendResult");
    }
    return { ok: true, message_id };
  }
  if (rec.ok === false) {
    assertExactKeys(rec, APPEND_ERR_FIELD_SET, "MailboxAppendResult");
    const error = requireString(rec, "error", "MailboxAppendResult");
    if (!isMailboxErrorCode(error)) {
      throw new Error("invalid MailboxAppendResult");
    }
    return { ok: false, error };
  }
  throw new Error("invalid MailboxAppendResult");
}
