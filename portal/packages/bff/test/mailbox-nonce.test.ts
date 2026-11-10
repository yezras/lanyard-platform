import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { mailboxDedupeKey, mailboxExternalMessageId } from "@lanyard/shared";

import { ChatThreadStore } from "../src/chat-store.js";
import { MailboxNonceStore } from "../src/mailbox-nonce.js";

describe("MailboxNonceStore", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDbPath(): string {
    const dir = mkdtempSync(join(tmpdir(), "bff-mailbox-nonce-"));
    dirs.push(dir);
    return join(dir, "nonce.db");
  }

  it("nonce is externalMessageId and the only dedupe key", () => {
    const nonce = "11111111-1111-1111-1111-111111111111";
    expect(mailboxExternalMessageId(nonce)).toBe(nonce);
    expect(mailboxDedupeKey(nonce)).toBe(nonce);
  });

  it("replay of the same nonce returns the original message_id", () => {
    const store = new MailboxNonceStore();
    const first = store.remember("thr_1", "n-1", "msg_1");
    const replay = store.remember("thr_1", "n-1", "msg_2");
    expect(first).toEqual({ message_id: "msg_1", replayed: false });
    expect(replay).toEqual({ message_id: "msg_1", replayed: true });
    expect(store.lookup("thr_1", "n-1")).toBe("msg_1");
    store.close();
  });

  it("does not dedupe on raw text; different nonces append twice", () => {
    const store = new MailboxNonceStore();
    const a = store.remember("thr_1", "n-a", "msg_a");
    const b = store.remember("thr_1", "n-b", "msg_b");
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(false);
    expect(store.lookup("thr_1", "n-a")).toBe("msg_a");
    expect(store.lookup("thr_1", "n-b")).toBe("msg_b");
    store.close();
  });

  it("nonce replay does not append a second history event", () => {
    const threads = new ChatThreadStore();
    const thread = threads.create({
      tenant_id: "ten_example",
      user_id: "usr_alice",
      title: "Review room",
      kind: "group",
      participants: [
        { kind: "human", user_id: "usr_alice", display_name: "Alice" },
        { kind: "persona", persona_id: "bill", display_name: "Bill" },
      ],
    });
    const nonces = new MailboxNonceStore();
    let appends = 0;
    const send = (nonce: string, messageId: string) =>
      nonces.runOnce(thread.thread_id, nonce, () => {
        appends += 1;
        threads.appendHistory(thread.thread_id, {
          type: "message_send",
          chat_id: thread.thread_id,
          message_id: messageId,
          content: "same body",
          created_at: "2026-08-25T10:00:00.000Z",
        });
        return { message_id: messageId };
      });

    const first = send("nonce-1", "msg_1");
    const replay = send("nonce-1", "msg_2");
    expect(first).toEqual({ message_id: "msg_1", replayed: false });
    expect(replay).toEqual({ message_id: "msg_1", replayed: true });
    expect(appends).toBe(1);
    expect(threads.listHistory(thread.thread_id)).toHaveLength(1);
    expect(threads.listHistory(thread.thread_id)[0]).toMatchObject({
      message_id: "msg_1",
    });
    nonces.close();
  });

  it("persists unique(thread_id, nonce) across reopen", () => {
    const dbPath = tempDbPath();
    const first = new MailboxNonceStore({ dbPath });
    first.remember("thr_1", "n-1", "msg_1");
    first.close();

    const reopened = new MailboxNonceStore({ dbPath });
    expect(reopened.lookup("thr_1", "n-1")).toBe("msg_1");
    expect(reopened.remember("thr_1", "n-1", "msg_other")).toEqual({
      message_id: "msg_1",
      replayed: true,
    });
    reopened.close();
  });
});
