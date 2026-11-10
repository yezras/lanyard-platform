/**
 * lp-cxhb.12 — P11 migrate legacy chats to durable agents.
 * I15: each interactive chat → one agent + that history; no auto-channels.
 * I16: duplicate titles get a suffix; avatars preserved.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import {
  ChatThreadStore,
  uniqueLegacyAgentName,
} from "../src/chat-store.js";
import { SessionStore } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import { cookieHeader, createTestBindings } from "./test-helpers.js";

const tenant: TenantContext = {
  tenant_id: "tenant-legacy-migrate",
  tenant_slug: "demo",
  display_name: "Demo",
  host: "demo.withlanyard.com",
};
const userId = "user-legacy-migrate";

describe("uniqueLegacyAgentName (lp-cxhb.12 I16)", () => {
  it("keeps the first title when unused", () => {
    expect(uniqueLegacyAgentName("Legal", [])).toBe("Legal");
  });

  it("suffixes from 2 when the base name is taken", () => {
    expect(uniqueLegacyAgentName("Legal", ["Legal"])).toBe("Legal 2");
    expect(uniqueLegacyAgentName("Legal", ["Legal", "Legal 2"])).toBe("Legal 3");
  });

  it("treats names as taken case-insensitively", () => {
    expect(uniqueLegacyAgentName("Legal", ["legal"])).toBe("Legal 2");
  });

  it("falls back to New chat when the title is blank", () => {
    expect(uniqueLegacyAgentName("   ", [])).toBe("New chat");
    expect(uniqueLegacyAgentName("", ["New chat"])).toBe("New chat 2");
  });
});

describe("ChatThreadStore.migrateLegacyChatsToAgents (lp-cxhb.12 I15/I16)", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  function tempDbPath(): string {
    const dir = mkdtempSync(join(tmpdir(), "bff-legacy-migrate-"));
    dirs.push(dir);
    return join(dir, "chat.db");
  }

  function seedFixture(store: ChatThreadStore) {
    const first = store.create({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      title: "Legal",
      project_id: "proj-alpha",
      project_vault_path: "/Projects/Alpha",
      avatar_seed: "aaaaaaaaaaaaaaaa",
      title_source: "user",
      system_prompt: "Contracts.",
      created_at: "2026-08-01T10:00:00.000Z",
    });
    const second = store.create({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      title: "Legal",
      project_id: "proj-beta",
      project_vault_path: "/Projects/Beta",
      avatar_seed: "bbbbbbbbbbbbbbbb",
      title_source: "user",
      system_prompt: "Also contracts.",
      created_at: "2026-08-01T11:00:00.000Z",
    });
    const job = store.ensureForJob({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      job_id: "job-digest",
      name: "Daily digest",
    });
    store.appendHistory(first.thread_id, {
      type: "user_message",
      message_id: "msg-first",
      content: "Review the NDA",
      created_at: "2026-08-01T10:00:00.000Z",
      chat_id: first.thread_id,
    });
    store.appendHistory(second.thread_id, {
      type: "user_message",
      message_id: "msg-second",
      content: "Review the MSA",
      created_at: "2026-08-01T11:00:00.000Z",
      chat_id: second.thread_id,
    });
    return { first, second, job };
  }

  it("I15: in-memory migrate adopts each chat, skips the job stream, creates no channels", () => {
    const store = new ChatThreadStore();
    const { first, second, job } = seedFixture(store);
    expect(store.listAgents(tenant.tenant_id, userId)).toEqual([]);

    const result = store.migrateLegacyChatsToAgents();
    expect(result).toMatchObject({
      migrated: 2,
      job_streams: 1,
      channels_created: 0,
    });

    const agents = store
      .listAgents(tenant.tenant_id, userId)
      .slice()
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    expect(agents).toHaveLength(2);
    expect(agents.map((agent) => agent.name)).toEqual(["Legal", "Legal 2"]);
    expect(store.get(first.thread_id)?.agent_id).toBe(agents[0]?.agent_id);
    expect(store.get(second.thread_id)?.agent_id).toBe(agents[1]?.agent_id);
    expect(store.get(job.thread.thread_id)?.agent_id).toBeNull();
    expect(store.get(job.thread.thread_id)?.kind).toBe("scheduled_task");
    expect(store.listForOwner(tenant.tenant_id, userId)).toHaveLength(3);

    const again = store.migrateLegacyChatsToAgents();
    expect(again.migrated).toBe(0);
    expect(again.channels_created).toBe(0);
  });

  it("I15/I16: fixture DB with two project chats and one job stream", () => {
    const dbPath = tempDbPath();
    const store1 = new ChatThreadStore({ dbPath });
    const { first, second, job } = seedFixture(store1);
    expect(store1.listAgents(tenant.tenant_id, userId)).toEqual([]);
    store1.close();

    const store2 = new ChatThreadStore({ dbPath });
    try {
      const result = store2.migrateLegacyChatsToAgents();
      expect(result.channels_created).toBe(0);
      expect(result.job_streams).toBe(1);

      const agents = store2
        .listAgents(tenant.tenant_id, userId)
        .slice()
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      expect(agents).toHaveLength(2);

      const names = agents.map((agent) => agent.name).sort();
      expect(names).toEqual(["Legal", "Legal 2"]);

      const byThread = new Map(
        agents.map((agent) => [agent.thread_id, agent]),
      );
      const adoptedFirst = byThread.get(first.thread_id);
      const adoptedSecond = byThread.get(second.thread_id);
      expect(adoptedFirst).toMatchObject({
        name: "Legal",
        avatar: "aaaaaaaaaaaaaaaa",
        objective: "Contracts.",
        thread_id: first.thread_id,
      });
      expect(adoptedSecond).toMatchObject({
        name: "Legal 2",
        avatar: "bbbbbbbbbbbbbbbb",
        objective: "Also contracts.",
        thread_id: second.thread_id,
      });

      expect(store2.get(first.thread_id)).toMatchObject({
        agent_id: adoptedFirst?.agent_id,
        title: "Legal",
        avatar_seed: "aaaaaaaaaaaaaaaa",
        kind: "chat",
        project_id: "proj-alpha",
      });
      expect(store2.get(second.thread_id)).toMatchObject({
        agent_id: adoptedSecond?.agent_id,
        title: "Legal 2",
        avatar_seed: "bbbbbbbbbbbbbbbb",
        kind: "chat",
        project_id: "proj-beta",
      });

      expect(store2.listHistory(first.thread_id)).toMatchObject([
        { type: "user_message", message_id: "msg-first", content: "Review the NDA" },
      ]);
      expect(store2.listHistory(second.thread_id)).toMatchObject([
        { type: "user_message", message_id: "msg-second", content: "Review the MSA" },
      ]);

      const jobThread = store2.get(job.thread.thread_id);
      expect(jobThread).toMatchObject({
        kind: "scheduled_task",
        scheduled_job_id: "job-digest",
        title: "Daily digest",
        agent_id: null,
      });
      expect(
        agents.some((agent) => agent.thread_id === job.thread.thread_id),
      ).toBe(false);

      const threads = store2.listForOwner(tenant.tenant_id, userId);
      expect(threads).toHaveLength(3);
      expect(threads.filter((thread) => thread.kind === "chat")).toHaveLength(2);
      expect(
        threads.filter((thread) => thread.kind === "scheduled_task"),
      ).toHaveLength(1);

      const again = store2.migrateLegacyChatsToAgents();
      expect(again).toMatchObject({
        migrated: 0,
        channels_created: 0,
        job_streams: 1,
      });
      expect(
        store2.listAgents(tenant.tenant_id, userId).map((agent) => agent.agent_id).sort(),
      ).toEqual(agents.map((agent) => agent.agent_id).sort());
    } finally {
      store2.close();
    }
  });

  it("is idempotent across SQLite reopen", () => {
    const dbPath = tempDbPath();
    const store1 = new ChatThreadStore({ dbPath });
    seedFixture(store1);
    store1.close();

    const store2 = new ChatThreadStore({ dbPath });
    const snapshot = store2.listAgents(tenant.tenant_id, userId).map((agent) => ({
      agent_id: agent.agent_id,
      name: agent.name,
      avatar: agent.avatar,
      thread_id: agent.thread_id,
    }));
    expect(snapshot).toHaveLength(2);
    const firstPass = store2.migrateLegacyChatsToAgents();
    expect(firstPass.migrated).toBe(0);
    store2.close();

    const store3 = new ChatThreadStore({ dbPath });
    try {
      const secondPass = store3.migrateLegacyChatsToAgents();
      expect(secondPass.migrated).toBe(0);
      expect(secondPass.channels_created).toBe(0);
      const reloaded = store3.listAgents(tenant.tenant_id, userId).map((agent) => ({
        agent_id: agent.agent_id,
        name: agent.name,
        avatar: agent.avatar,
        thread_id: agent.thread_id,
      }));
      expect(reloaded).toEqual(snapshot);
    } finally {
      store3.close();
    }
  });

  it("does not collide names across owners", () => {
    const store = new ChatThreadStore();
    store.create({
      tenant_id: tenant.tenant_id,
      user_id: "user-a",
      title: "Legal",
      avatar_seed: "1111111111111111",
    });
    store.create({
      tenant_id: tenant.tenant_id,
      user_id: "user-b",
      title: "Legal",
      avatar_seed: "2222222222222222",
    });
    const result = store.migrateLegacyChatsToAgents();
    expect(result.migrated).toBe(2);
    expect(store.listAgents(tenant.tenant_id, "user-a").map((a) => a.name)).toEqual([
      "Legal",
    ]);
    expect(store.listAgents(tenant.tenant_id, "user-b").map((a) => a.name)).toEqual([
      "Legal",
    ]);
  });
});

describe("GET /api/agents after legacy migrate (lp-cxhb.12)", () => {
  async function boot(store: ChatThreadStore) {
    const sessions = new SessionStore();
    const session = await sessions.create({
      userId,
      tenantId: tenant.tenant_id,
      email: "migrate@example.com",
    });
    const authClient = {
      getUserRbac: async () => ({
        user_id: userId,
        tenant_id: tenant.tenant_id,
        hermes_profile: "default",
        allowed_path_prefixes: ["/"],
        role_names: ["member"],
      }),
      getPrimaryGatewayInstance: async () => ({
        instance_id: "inst-legacy-migrate",
      }),
      getActiveSessionShare: async () => null,
      listSessionSharesForGrantee: async () => [],
    };
    const app = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          sessions,
          chatThreads: store,
          brainRpcEnabled: false,
          authClient: authClient as never,
        },
      ),
    );
    const cookies = {
      lanyard_session: session.sessionId,
      lanyard_csrf: "test-csrf-legacy-migrate",
    };
    return { app, cookies };
  }

  it("lists adopted catalog rows and not the job stream", async () => {
    const store = new ChatThreadStore();
    store.create({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      title: "Ops",
      project_id: "proj-ops",
      avatar_seed: "cccccccccccccccc",
    });
    store.create({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      title: "Ops",
      project_id: "proj-ops-2",
      avatar_seed: "dddddddddddddddd",
    });
    store.ensureForJob({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      job_id: "job-nightly",
      name: "Nightly backup",
    });
    store.migrateLegacyChatsToAgents();

    const { app, cookies } = await boot(store);
    const listed = await app.request("/api/agents", {
      headers: new Headers({
        host: tenant.host,
        cookie: cookieHeader(cookies),
      }),
    });
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      agents: Array<{ name: string; avatar: string; thread_id: string }>;
    };
    expect(body.agents).toHaveLength(2);
    expect(body.agents.map((row) => row.name).sort()).toEqual(["Ops", "Ops 2"]);
    expect(body.agents.map((row) => row.avatar).sort()).toEqual([
      "cccccccccccccccc",
      "dddddddddddddddd",
    ]);
    expect(body.agents.some((row) => row.name === "Nightly backup")).toBe(false);
  });
});
