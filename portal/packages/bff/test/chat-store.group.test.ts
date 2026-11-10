import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ChatThreadStore,
  durableOutboundFromRelayEvent,
  InvalidGroupThreadError,
} from "../src/chat-store.js";

describe("ChatThreadStore group rooms (lac-bx3.11 S1-S4)", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDbPath(): string {
    const dir = mkdtempSync(join(tmpdir(), "bff-chat-store-group-"));
    dirs.push(dir);
    return join(dir, "chat.db");
  }

  const owner = {
    kind: "human" as const,
    user_id: "usr_alice",
    display_name: "Alice",
  };
  const skip = {
    kind: "persona" as const,
    persona_id: "skip",
    display_name: "Skip",
  };
  const lev = {
    kind: "persona" as const,
    persona_id: "lev",
    display_name: "Lev",
  };

  it("S1: create kind=group with two personas + owner", () => {
    const dbPath = tempDbPath();
    const store = new ChatThreadStore({ dbPath });
    const thread = store.create({
      tenant_id: "ten_example",
      user_id: "usr_alice",
      title: "Review room",
      kind: "group",
      orchestrator_persona_id: "skip",
      participants: [owner, skip, lev],
    });

    expect(thread.kind).toBe("group");
    expect(thread.orchestrator_persona_id).toBe("skip");
    expect(thread.participants).toEqual([owner, skip, lev]);
    store.close();

    const reopened = new ChatThreadStore({ dbPath });
    try {
      const loaded = reopened.get(thread.thread_id);
      expect(loaded?.kind).toBe("group");
      expect(loaded?.orchestrator_persona_id).toBe("skip");
      expect(loaded?.participants).toEqual([owner, skip, lev]);
    } finally {
      reopened.close();
    }
  });

  it("S1: kind=group with no persona is rejected", () => {
    const store = new ChatThreadStore();
    expect(() =>
      store.create({
        tenant_id: "ten_example",
        user_id: "usr_alice",
        kind: "group",
        participants: [owner],
      }),
    ).toThrow(InvalidGroupThreadError);
  });

  it("S2: 1:1 kind=chat still works with an empty roster", () => {
    const dbPath = tempDbPath();
    const store = new ChatThreadStore({ dbPath });
    const thread = store.create({
      tenant_id: "tenant-a",
      user_id: "user-1",
      title: "Durable chat",
    });
    expect(thread.kind).toBe("chat");
    expect(thread.participants).toEqual([]);
    expect(thread.orchestrator_persona_id).toBeNull();
    store.appendHistory(thread.thread_id, {
      type: "user_message",
      message_id: "msg-user-1",
      content: "Hello assistant",
      created_at: "2026-07-15T10:00:00.000Z",
      chat_id: thread.thread_id,
    });
    store.close();

    const reopened = new ChatThreadStore({ dbPath });
    try {
      const loaded = reopened.get(thread.thread_id);
      expect(loaded?.kind).toBe("chat");
      expect(loaded?.participants).toEqual([]);
      expect(loaded?.orchestrator_persona_id).toBeNull();
      expect(reopened.listHistory(thread.thread_id)).toHaveLength(1);
    } finally {
      reopened.close();
    }
  });

  it("S3: history event persists speaker {kind, id, display_name}", () => {
    const dbPath = tempDbPath();
    const store = new ChatThreadStore({ dbPath });
    const thread = store.create({
      tenant_id: "ten_example",
      user_id: "usr_alice",
      kind: "group",
      orchestrator_persona_id: "skip",
      participants: [owner, skip, lev],
    });
    const speaker = { kind: "persona" as const, id: "skip", display_name: "Skip" };
    store.appendHistory(thread.thread_id, {
      type: "message_send",
      chat_id: thread.thread_id,
      message_id: "msg-skip-1",
      content: "I'll take the first pass.",
      created_at: "2026-08-20T10:00:01.000Z",
      speaker,
    });
    store.appendHistory(thread.thread_id, {
      type: "user_message",
      message_id: "msg-alice-1",
      content: "Please review.",
      created_at: "2026-08-20T10:00:00.000Z",
      chat_id: thread.thread_id,
      speaker: { kind: "human", id: "usr_alice", display_name: "Alice" },
    });
    expect(() =>
      store.appendHistory(thread.thread_id, {
        type: "message_send",
        chat_id: thread.thread_id,
        message_id: "msg-bana-1",
        content: "Impersonation",
        created_at: "2026-08-20T10:00:02.000Z",
        speaker: { kind: "persona", id: "bana", display_name: "Bana" },
      }),
    ).toThrow(InvalidGroupThreadError);
    store.close();

    const reopened = new ChatThreadStore({ dbPath });
    try {
      const history = reopened.listHistory(thread.thread_id);
      expect(history).toHaveLength(2);
      expect(history[0]?.speaker).toEqual(speaker);
      expect(history[1]?.speaker).toEqual({
        kind: "human",
        id: "usr_alice",
        display_name: "Alice",
      });
    } finally {
      reopened.close();
    }
  });

  it("tees historySpeaker from outbound metadata.speaker", () => {
    const durable = durableOutboundFromRelayEvent({
      type: "message_send",
      chat_id: "room-skip-lev-bana",
      message_id: "msg-lev-1",
      content: "I'll take the first pass.",
      metadata: {
        persona_id: "lev",
        speaker: { kind: "persona", id: "lev", display_name: "Lev" },
      },
    });
    expect(durable?.speaker).toEqual({
      kind: "persona",
      id: "lev",
      display_name: "Lev",
    });
  });

  it("S4: session-share grantee appears as a human participant", () => {
    const dbPath = tempDbPath();
    const store = new ChatThreadStore({ dbPath });
    const thread = store.create({
      tenant_id: "ten_example",
      user_id: "usr_alice",
      kind: "group",
      orchestrator_persona_id: "skip",
      participants: [owner, skip, lev],
    });
    const grantee = {
      kind: "human" as const,
      user_id: "usr_bob",
      display_name: "Bob",
    };
    const updated = store.addParticipant(thread.thread_id, grantee);
    expect(updated?.participants).toEqual([owner, skip, lev, grantee]);
    const again = store.addParticipant(thread.thread_id, grantee);
    expect(again?.participants).toHaveLength(4);
    store.close();

    const reopened = new ChatThreadStore({ dbPath });
    try {
      expect(reopened.get(thread.thread_id)?.participants).toEqual([
        owner,
        skip,
        lev,
        grantee,
      ]);
    } finally {
      reopened.close();
    }
  });
});
