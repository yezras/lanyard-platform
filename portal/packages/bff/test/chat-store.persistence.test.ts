import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ChatThreadStore,
  secureChatDbArtifacts,
} from "../src/chat-store.js";

function fileMode(path: string): number {
  return statSync(path).mode & 0o777;
}

describe("ChatThreadStore SQLite durability", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDbPath(): string {
    const dir = mkdtempSync(join(tmpdir(), "bff-chat-store-"));
    dirs.push(dir);
    return join(dir, "chat.db");
  }

  it("retains threads and user+assistant history after simulated restart", () => {
    const dbPath = tempDbPath();

    const store1 = new ChatThreadStore({ dbPath });
    const thread = store1.create({
      tenant_id: "tenant-a",
      user_id: "user-1",
      title: "Durable chat",
      project_id: "proj-1",
      project_vault_path: "/vault/proj-1",
    });

    store1.appendHistory(thread.thread_id, {
      type: "user_message",
      message_id: "msg-user-1",
      content: "Hello assistant",
      created_at: "2026-07-15T10:00:00.000Z",
      chat_id: thread.thread_id,
    });
    store1.appendHistory(thread.thread_id, {
      type: "message_send",
      chat_id: thread.thread_id,
      message_id: "msg-asst-1",
      content: "Hello human",
      created_at: "2026-07-15T10:00:01.000Z",
    });
    store1.close();

    // Simulate BFF process restart: new store instance, same CHAT_STORE_PATH.
    const store2 = new ChatThreadStore({ dbPath });
    try {
      const listed = store2.listForOwner("tenant-a", "user-1");
      expect(listed).toHaveLength(1);
      expect(listed[0]?.thread_id).toBe(thread.thread_id);
      expect(listed[0]?.title).toBe("Durable chat");
      expect(listed[0]?.project_id).toBe("proj-1");

      const history = store2.listHistory(thread.thread_id);
      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({
        type: "user_message",
        message_id: "msg-user-1",
        content: "Hello assistant",
      });
      expect(history[1]).toMatchObject({
        type: "message_send",
        message_id: "msg-asst-1",
        content: "Hello human",
      });
      expect(store2.hasOutboundHistory(thread.thread_id)).toBe(true);
    } finally {
      store2.close();
    }
  });

  it("delete removes durable history; clearHistory empties events", () => {
    const dbPath = tempDbPath();
    const store = new ChatThreadStore({ dbPath });
    const thread = store.create({
      tenant_id: "tenant-a",
      user_id: "user-1",
    });
    store.appendHistory(thread.thread_id, {
      type: "user_message",
      message_id: "m1",
      content: "hi",
      created_at: "2026-07-15T10:00:00.000Z",
      chat_id: thread.thread_id,
    });
    store.clearHistory(thread.thread_id);
    expect(store.listHistory(thread.thread_id)).toEqual([]);

    store.appendHistory(thread.thread_id, {
      type: "user_message",
      message_id: "m2",
      content: "again",
      created_at: "2026-07-15T10:00:02.000Z",
      chat_id: thread.thread_id,
    });
    expect(store.delete(thread.thread_id)).toBe(true);
    store.close();

    const reopened = new ChatThreadStore({ dbPath });
    try {
      expect(reopened.get(thread.thread_id)).toBeUndefined();
      expect(reopened.listHistory(thread.thread_id)).toEqual([]);
      expect(reopened.listForOwner("tenant-a", "user-1")).toEqual([]);
    } finally {
      reopened.close();
    }
  });

  it("updateTitle persists across restart", () => {
    const dbPath = tempDbPath();
    const store1 = new ChatThreadStore({ dbPath });
    const thread = store1.create({
      tenant_id: "t",
      user_id: "u",
      title: "Old",
    });
    expect(store1.updateTitle(thread.thread_id, "Renamed")).not.toBeNull();
    store1.close();

    const store2 = new ChatThreadStore({ dbPath });
    try {
      expect(store2.get(thread.thread_id)?.title).toBe("Renamed");
    } finally {
      store2.close();
    }
  });

  it("assigns random avatar_seed and default title_source on create (lp-fn5.3.1)", () => {
    const dbPath = tempDbPath();
    const store1 = new ChatThreadStore({ dbPath });
    const a = store1.create({ tenant_id: "t", user_id: "u" });
    const b = store1.create({ tenant_id: "t", user_id: "u" });
    expect(a.avatar_seed).toMatch(/^[0-9a-f]{16}$/);
    expect(b.avatar_seed).toMatch(/^[0-9a-f]{16}$/);
    expect(a.avatar_seed).not.toBe(b.avatar_seed);
    expect(a.title_source).toBe("default");
    expect(a.title).toBe("New chat");
    expect(a.kind).toBe("chat");
    expect(a.scheduled_job_id).toBeNull();

    // Rename with title_source=user; avatar_seed must stay stable.
    const seed = a.avatar_seed;
    const updated = store1.updateTitle(a.thread_id, "My agent", {
      title_source: "user",
    });
    expect(updated?.title).toBe("My agent");
    expect(updated?.title_source).toBe("user");
    expect(updated?.avatar_seed).toBe(seed);
    store1.close();

    const store2 = new ChatThreadStore({ dbPath });
    try {
      const reloaded = store2.get(a.thread_id);
      expect(reloaded?.avatar_seed).toBe(seed);
      expect(reloaded?.title_source).toBe("user");
      expect(reloaded?.title).toBe("My agent");
      expect(reloaded?.kind).toBe("chat");
      expect(reloaded?.scheduled_job_id).toBeNull();
    } finally {
      store2.close();
    }
  });

  it("updateTitle without title_source preserves existing source", () => {
    const store = new ChatThreadStore();
    const thread = store.create({
      tenant_id: "t",
      user_id: "u",
      title: "New chat",
    });
    store.updateTitle(thread.thread_id, "LLM name", { title_source: "llm" });
    const again = store.updateTitle(thread.thread_id, "LLM name v2");
    expect(again?.title_source).toBe("llm");
    expect(again?.title).toBe("LLM name v2");
  });

  it("persists system_prompt + system_prompt_source across restart (lp-lv9.4)", () => {
    const dbPath = tempDbPath();
    const store1 = new ChatThreadStore({ dbPath });
    const thread = store1.create({ tenant_id: "t", user_id: "u" });
    expect(thread.system_prompt).toBe("");
    expect(thread.system_prompt_source).toBe("default");

    const updated = store1.updateSystemPrompt(
      thread.thread_id,
      "Help with quarterly planning",
      { system_prompt_source: "user" },
    );
    expect(updated?.system_prompt).toBe("Help with quarterly planning");
    expect(updated?.system_prompt_source).toBe("user");
    store1.close();

    const store2 = new ChatThreadStore({ dbPath });
    try {
      const reloaded = store2.get(thread.thread_id);
      expect(reloaded?.system_prompt).toBe("Help with quarterly planning");
      expect(reloaded?.system_prompt_source).toBe("user");
    } finally {
      store2.close();
    }
  });

  it("memory-only mode (no dbPath) loses data after new instance", () => {
    const store1 = new ChatThreadStore();
    const thread = store1.create({ tenant_id: "t", user_id: "u" });
    store1.appendHistory(thread.thread_id, {
      type: "user_message",
      message_id: "m",
      content: "x",
      created_at: "2026-07-15T10:00:00.000Z",
      chat_id: thread.thread_id,
    });

    const store2 = new ChatThreadStore();
    expect(store2.get(thread.thread_id)).toBeUndefined();
    expect(store2.listHistory(thread.thread_id)).toEqual([]);
  });

  it("enforces history cap (≤ 2000 events) in durable mode", () => {
    const dbPath = tempDbPath();
    const store = new ChatThreadStore({ dbPath });
    const thread = store.create({ tenant_id: "t", user_id: "u" });

    for (let i = 0; i < 2005; i++) {
      store.appendHistory(thread.thread_id, {
        type: "user_message",
        message_id: `m-${i}`,
        content: `c-${i}`,
        created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, i % 60, i)).toISOString(),
        chat_id: thread.thread_id,
      });
    }
    expect(store.listHistory(thread.thread_id)).toHaveLength(2000);
    expect(store.listHistory(thread.thread_id)[0]).toMatchObject({
      message_id: "m-5",
    });
    store.close();

    const reopened = new ChatThreadStore({ dbPath });
    try {
      expect(reopened.listHistory(thread.thread_id)).toHaveLength(2000);
      expect(reopened.listHistory(thread.thread_id)[0]).toMatchObject({
        message_id: "m-5",
      });
      expect(reopened.listHistory(thread.thread_id)[1999]).toMatchObject({
        message_id: "m-2004",
      });
    } finally {
      reopened.close();
    }
  });

  it("creates chat.db with owner-only permissions (lp-p37.13)", () => {
    // Skip on non-POSIX where mode bits are not meaningful.
    if (process.platform === "win32") return;

    const dbPath = tempDbPath();
    const store = new ChatThreadStore({ dbPath });
    try {
      const thread = store.create({ tenant_id: "t", user_id: "u" });
      store.appendHistory(thread.thread_id, {
        type: "user_message",
        message_id: "m",
        content: "sensitive body",
        created_at: "2026-07-15T10:00:00.000Z",
        chat_id: thread.thread_id,
      });
      // Trigger WAL sidecars, then re-secure.
      secureChatDbArtifacts(dbPath);

      const dbMode = fileMode(dbPath);
      expect(dbMode & 0o077).toBe(0);
      expect(dbMode & 0o600).toBe(0o600);

      const dirMode = fileMode(dirname(dbPath));
      expect(dirMode & 0o077).toBe(0);

      for (const side of [`${dbPath}-wal`, `${dbPath}-shm`]) {
        try {
          const m = fileMode(side);
          expect(m & 0o077).toBe(0);
        } catch {
          // sidecars may be absent depending on sqlite timing
        }
      }
    } finally {
      store.close();
    }
  });
});
