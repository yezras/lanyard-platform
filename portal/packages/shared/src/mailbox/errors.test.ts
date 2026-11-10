import { describe, expect, it } from "vitest";

import {
  isMailboxErrorCode,
  MAILBOX_ERROR_CODES,
  type MailboxErrorCode,
} from "./errors.js";

describe("MailboxErrorCode", () => {
  it("is the locked fail-closed union", () => {
    expect([...MAILBOX_ERROR_CODES]).toEqual([
      "not_found",
      "forbidden",
      "frozen",
      "fuse_tripped",
      "bad_to",
      "dead_room",
    ]);
    const _exhaustive: readonly MailboxErrorCode[] = MAILBOX_ERROR_CODES;
    expect(_exhaustive).toHaveLength(6);
  });

  it("accepts only named codes", () => {
    expect(isMailboxErrorCode("not_found")).toBe(true);
    expect(isMailboxErrorCode("forbidden")).toBe(true);
    expect(isMailboxErrorCode("frozen")).toBe(true);
    expect(isMailboxErrorCode("fuse_tripped")).toBe(true);
    expect(isMailboxErrorCode("bad_to")).toBe(true);
    expect(isMailboxErrorCode("dead_room")).toBe(true);
    expect(isMailboxErrorCode("unauthorized")).toBe(false);
    expect(isMailboxErrorCode("conflict")).toBe(false);
    expect(isMailboxErrorCode("")).toBe(false);
  });
});
