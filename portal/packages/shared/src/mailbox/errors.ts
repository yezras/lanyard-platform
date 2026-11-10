/**
 * Fail-closed mailbox error codes (lp-v62i.1.1).
 * SoT: wayfinder/agent-mailbox-v1.md. Do not add codes the map does not name.
 */

export const MAILBOX_ERROR_CODES = [
  "not_found",
  "forbidden",
  "frozen",
  "fuse_tripped",
  "bad_to",
  "dead_room",
] as const;

export type MailboxErrorCode = (typeof MAILBOX_ERROR_CODES)[number];

const ERROR_CODE_SET = new Set<string>(MAILBOX_ERROR_CODES);

export function isMailboxErrorCode(value: string): value is MailboxErrorCode {
  return ERROR_CODE_SET.has(value);
}
