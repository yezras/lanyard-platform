import { describe, expect, it } from "vitest";

import {
  MAILBOX_ERROR_CODES,
  type MailboxErrorCode,
} from "@lanyard/shared";

import { ChatThreadStore } from "../src/chat-store.js";
import { checkMailboxRoster } from "../src/mailbox-roster.js";

const tenantId = "ten_mailbox";
const userId = "usr_jack";

function lockedCode(error: MailboxErrorCode): MailboxErrorCode {
  expect(MAILBOX_ERROR_CODES).toContain(error);
  return error;
}

describe("checkMailboxRoster", () => {
  function roomWithBillAndFizz() {
    const store = new ChatThreadStore();
    const bill = store.createAgent({
      tenant_id: tenantId,
      user_id: userId,
      name: "Bill",
    });
    const fizz = store.createAgent({
      tenant_id: tenantId,
      user_id: userId,
      name: "Fizz",
    });
    const outsider = store.createAgent({
      tenant_id: tenantId,
      user_id: userId,
      name: "Outsider",
    });
    const channel = store.createChannel({
      tenant_id: tenantId,
      user_id: userId,
      name: "Workshop",
      member_agent_ids: [bill.agent_id, fizz.agent_id],
    });
    return { store, bill, fizz, outsider, channel };
  }

  it("allows a channel member to address another catalog persona", () => {
    const { store, bill, fizz, channel } = roomWithBillAndFizz();
    const result = checkMailboxRoster({
      store,
      tenant_id: tenantId,
      room: channel.thread_id,
      from: bill.agent_id,
      to: fizz.agent_id,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.thread.thread_id).toBe(channel.thread_id);
    }
  });

  it("unknown room is not_found", () => {
    const { store, bill, fizz } = roomWithBillAndFizz();
    const result = checkMailboxRoster({
      store,
      tenant_id: tenantId,
      room: "thr_missing",
      from: bill.agent_id,
      to: fizz.agent_id,
    });
    expect(result).toEqual({ ok: false, error: lockedCode("not_found") });
  });

  it("from not on the channel roster is forbidden", () => {
    const { store, fizz, outsider, channel } = roomWithBillAndFizz();
    const result = checkMailboxRoster({
      store,
      tenant_id: tenantId,
      room: channel.thread_id,
      from: outsider.agent_id,
      to: fizz.agent_id,
    });
    expect(result).toEqual({ ok: false, error: lockedCode("forbidden") });
  });

  it("unknown to is not_found", () => {
    const { store, bill, channel } = roomWithBillAndFizz();
    const result = checkMailboxRoster({
      store,
      tenant_id: tenantId,
      room: channel.thread_id,
      from: bill.agent_id,
      to: "no-such-persona",
    });
    expect(result).toEqual({ ok: false, error: lockedCode("not_found") });
  });

  it("connector id as to is bad_to", () => {
    const { store, bill, channel } = roomWithBillAndFizz();
    for (const to of ["google", "hubspot", "whatsapp", "github"]) {
      const result = checkMailboxRoster({
        store,
        tenant_id: tenantId,
        room: channel.thread_id,
        from: bill.agent_id,
        to,
      });
      expect(result).toEqual({ ok: false, error: lockedCode("bad_to") });
    }
  });

  it("Jack is not a mailbox to", () => {
    const { store, bill, channel } = roomWithBillAndFizz();
    for (const to of ["Jack", "jack"]) {
      const result = checkMailboxRoster({
        store,
        tenant_id: tenantId,
        room: channel.thread_id,
        from: bill.agent_id,
        to,
      });
      expect(result).toEqual({ ok: false, error: lockedCode("bad_to") });
    }
  });

  it("human user id as to is bad_to", () => {
    const { store, bill, channel } = roomWithBillAndFizz();
    const result = checkMailboxRoster({
      store,
      tenant_id: tenantId,
      room: channel.thread_id,
      from: bill.agent_id,
      to: userId,
    });
    expect(result).toEqual({ ok: false, error: lockedCode("bad_to") });
  });

  it("self as to is bad_to", () => {
    const { store, bill, channel } = roomWithBillAndFizz();
    const result = checkMailboxRoster({
      store,
      tenant_id: tenantId,
      room: channel.thread_id,
      from: bill.agent_id,
      to: bill.agent_id,
    });
    expect(result).toEqual({ ok: false, error: lockedCode("bad_to") });
  });

  it("1:1 from-not-participant defaults to forbidden", () => {
    const store = new ChatThreadStore();
    const bill = store.createAgent({
      tenant_id: tenantId,
      user_id: userId,
      name: "Bill",
    });
    const fizz = store.createAgent({
      tenant_id: tenantId,
      user_id: userId,
      name: "Fizz",
    });
    const result = checkMailboxRoster({
      store,
      tenant_id: tenantId,
      room: bill.thread_id,
      from: bill.agent_id,
      to: fizz.agent_id,
    });
    expect(result).toEqual({ ok: false, error: lockedCode("forbidden") });
  });
});
