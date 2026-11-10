/**
 * lp-fn5.5.1 — Job↔thread binding + ensureAgentChatForJob.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { ChatThreadStore } from "../src/chat-store.js";
import { SessionStore } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import { cookieHeader, createTestBindings } from "./test-helpers.js";

const tenant: TenantContext = {
  tenant_id: "tenant-job-stream",
  tenant_slug: "demo",
  display_name: "Demo",
  host: "demo.withlanyard.com",
};
const userId = "user-job-stream";

describe("ChatThreadStore.ensureForJob (lp-fn5.5.1)", () => {
  const dirs: string[] = [];

  afterEach(() => {
    while (dirs.length > 0) {
      const dir = dirs.pop();
      if (dir) rmSync(dir, { recursive: true, force: true });
    }
  });

  it("creates scheduled_task stream with title=job name and title_source=job", () => {
    const store = new ChatThreadStore();
    const outcome = store.ensureForJob({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      job_id: "job-daily",
      name: "Daily digest",
    });

    expect(outcome.created).toBe(true);
    expect(outcome.thread.title).toBe("Daily digest");
    expect(outcome.thread.kind).toBe("scheduled_task");
    expect(outcome.thread.title_source).toBe("job");
    expect(outcome.thread.scheduled_job_id).toBe("job-daily");
    expect(outcome.thread.project_id).toBeNull();
  });

  it("is idempotent: same job_id returns the same thread_id", () => {
    const store = new ChatThreadStore();
    const first = store.ensureForJob({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      job_id: "job-idem",
      name: "First name",
    });
    const second = store.ensureForJob({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      job_id: "job-idem",
      name: "First name",
    });

    expect(second.created).toBe(false);
    expect(second.thread.thread_id).toBe(first.thread.thread_id);
    expect(store.listForOwner(tenant.tenant_id, userId)).toHaveLength(1);
  });

  it("scopes binding per owner (different users get different streams)", () => {
    const store = new ChatThreadStore();
    const a = store.ensureForJob({
      tenant_id: tenant.tenant_id,
      user_id: "user-a",
      job_id: "shared-job",
      name: "Shared job",
    });
    const b = store.ensureForJob({
      tenant_id: tenant.tenant_id,
      user_id: "user-b",
      job_id: "shared-job",
      name: "Shared job",
    });
    expect(a.thread.thread_id).not.toBe(b.thread.thread_id);
  });

  it("syncs title on re-ensure when title_source=job", () => {
    const store = new ChatThreadStore();
    const first = store.ensureForJob({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      job_id: "job-rename",
      name: "Old name",
    });
    const second = store.ensureForJob({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      job_id: "job-rename",
      name: "New name",
    });
    expect(second.created).toBe(false);
    expect(second.thread.thread_id).toBe(first.thread.thread_id);
    expect(second.thread.title).toBe("New name");
    expect(second.thread.title_source).toBe("job");
  });

  it("syncJobTitle renames only job-owned titles", () => {
    const store = new ChatThreadStore();
    const jobOwned = store.ensureForJob({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      job_id: "job-sync",
      name: "Original",
    });
    store.updateTitle(jobOwned.thread.thread_id, "User override", {
      title_source: "user",
    });

    const sticky = store.ensureForJob({
      tenant_id: tenant.tenant_id,
      user_id: "other-user",
      job_id: "job-sync",
      name: "Original",
    });

    const updated = store.syncJobTitle({
      tenant_id: tenant.tenant_id,
      job_id: "job-sync",
      name: "Renamed by job",
    });

    // user-overridden stream not renamed; job-owned sibling is.
    expect(store.get(jobOwned.thread.thread_id)?.title).toBe("User override");
    expect(store.get(sticky.thread.thread_id)?.title).toBe("Renamed by job");
    expect(updated).toHaveLength(1);
    expect(updated[0]?.thread_id).toBe(sticky.thread.thread_id);
  });

  it("persists job binding across SQLite restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "bff-job-stream-"));
    dirs.push(dir);
    const dbPath = join(dir, "chat.db");

    const store1 = new ChatThreadStore({ dbPath });
    const created = store1.ensureForJob({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      job_id: "job-durable",
      name: "Durable job chat",
    });
    store1.close();

    const store2 = new ChatThreadStore({ dbPath });
    try {
      const found = store2.findByScheduledJobId(
        tenant.tenant_id,
        userId,
        "job-durable",
      );
      expect(found?.thread_id).toBe(created.thread.thread_id);
      expect(found?.kind).toBe("scheduled_task");
      expect(found?.scheduled_job_id).toBe("job-durable");
      expect(found?.title_source).toBe("job");

      const again = store2.ensureForJob({
        tenant_id: tenant.tenant_id,
        user_id: userId,
        job_id: "job-durable",
        name: "Durable job chat",
      });
      expect(again.created).toBe(false);
      expect(again.thread.thread_id).toBe(created.thread.thread_id);
    } finally {
      store2.close();
    }
  });

  it("rejects empty job_id / name", () => {
    const store = new ChatThreadStore();
    expect(() =>
      store.ensureForJob({
        tenant_id: tenant.tenant_id,
        user_id: userId,
        job_id: "  ",
        name: "x",
      }),
    ).toThrow(/job_id/i);
    expect(() =>
      store.ensureForJob({
        tenant_id: tenant.tenant_id,
        user_id: userId,
        job_id: "job-1",
        name: "  ",
      }),
    ).toThrow(/name/i);
  });

  it("I14: product create binds catalog agent_id without changing job_id uniqueness", () => {
    const store = new ChatThreadStore();
    const agent = store.createAgent({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Legal",
    });
    const first = store.ensureForJob({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      job_id: "job-bound",
      name: "Bound digest",
      agent_id: agent.agent_id,
    });
    const second = store.ensureForJob({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      job_id: "job-bound",
      name: "Bound digest",
      agent_id: agent.agent_id,
    });
    expect(first.thread.agent_id).toBe(agent.agent_id);
    expect(second.created).toBe(false);
    expect(second.thread.thread_id).toBe(first.thread.thread_id);
    expect(store.listForOwner(tenant.tenant_id, userId).filter((row) => row.kind === "scheduled_task")).toHaveLength(1);
  });
});

describe("POST /api/chat/threads/ensure-for-job", () => {
  async function boot() {
    const chatThreads = new ChatThreadStore();
    const sessions = new SessionStore();
    const session = await sessions.create({
      userId,
      tenantId: tenant.tenant_id,
      email: "job@example.com",
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
        instance_id: "inst-job-stream",
      }),
      getActiveSessionShare: async () => null,
      listSessionSharesForGrantee: async () => [],
    };

    const app = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          sessions,
          chatThreads,
          brainRpcEnabled: false,
          authClient: authClient as never,
        },
      ),
    );

    const cookies = {
      lanyard_session: session.sessionId,
      lanyard_csrf: "test-csrf-job-stream",
    };

    return { app, chatThreads, cookies };
  }

  async function ensure(
    app: ReturnType<typeof createApp>,
    cookies: Record<string, string>,
    body: { job_id: string; name: string; agent_id?: string },
  ) {
    const headers = new Headers({
      host: tenant.host,
      cookie: cookieHeader(cookies),
      "x-csrf-token": cookies.lanyard_csrf,
      "content-type": "application/json",
    });
    return app.request("/api/chat/threads/ensure-for-job", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  it("returns 201 on first ensure and 200 with same thread on second", async () => {
    const { app, cookies, chatThreads } = await boot();

    const res1 = await ensure(app, cookies, {
      job_id: "cron-1",
      name: "Morning brief",
    });
    expect(res1.status).toBe(201);
    const body1 = (await res1.json()) as {
      thread_id: string;
      title: string;
      kind: string;
      scheduled_job_id: string;
      title_source: string;
      created: boolean;
    };
    expect(body1.created).toBe(true);
    expect(body1.title).toBe("Morning brief");
    expect(body1.kind).toBe("scheduled_task");
    expect(body1.scheduled_job_id).toBe("cron-1");
    expect(body1.title_source).toBe("job");

    const res2 = await ensure(app, cookies, {
      job_id: "cron-1",
      name: "Morning brief",
    });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as {
      thread_id: string;
      created: boolean;
    };
    expect(body2.created).toBe(false);
    expect(body2.thread_id).toBe(body1.thread_id);
    expect(chatThreads.listForOwner(tenant.tenant_id, userId)).toHaveLength(1);
  });

  it("lists job binding fields on GET /api/chat/threads", async () => {
    const { app, cookies } = await boot();
    await ensure(app, cookies, { job_id: "cron-list", name: "Listed job" });

    const headers = new Headers({
      host: tenant.host,
      cookie: cookieHeader(cookies),
    });
    const res = await app.request("/api/chat/threads", { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      threads: Array<{
        kind: string;
        scheduled_job_id: string | null;
        title: string;
      }>;
    };
    const jobThread = body.threads.find((t) => t.scheduled_job_id === "cron-list");
    expect(jobThread).toMatchObject({
      kind: "scheduled_task",
      title: "Listed job",
      scheduled_job_id: "cron-list",
    });
  });

  it("create flags with scheduled_job_id are also idempotent", async () => {
    const { app, cookies } = await boot();
    const headers = new Headers({
      host: tenant.host,
      cookie: cookieHeader(cookies),
      "x-csrf-token": cookies.lanyard_csrf,
      "content-type": "application/json",
    });

    const res1 = await app.request("/api/chat/threads", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "Via create flags",
        scheduled_job_id: "cron-flags",
        kind: "scheduled_task",
      }),
    });
    expect(res1.status).toBe(201);
    const body1 = (await res1.json()) as { thread_id: string };

    const res2 = await app.request("/api/chat/threads", {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: "Via create flags",
        scheduled_job_id: "cron-flags",
      }),
    });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as {
      thread_id: string;
      created: boolean;
    };
    expect(body2.created).toBe(false);
    expect(body2.thread_id).toBe(body1.thread_id);
  });

  it("I14: ensure-for-job stores agent_id on the stream", async () => {
    const { app, cookies } = await boot();
    const headers = new Headers({
      host: tenant.host,
      cookie: cookieHeader(cookies),
      "x-csrf-token": cookies.lanyard_csrf,
      "content-type": "application/json",
    });
    const agentRes = await app.request("/api/agents", {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "Legal" }),
    });
    expect(agentRes.status).toBe(201);
    const agent = (await agentRes.json()) as { agent_id: string };

    const res = await ensure(app, cookies, {
      job_id: "cron-agent",
      name: "Agent digest",
      agent_id: agent.agent_id,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      kind: string;
      scheduled_job_id: string;
      agent_id: string | null;
    };
    expect(body).toMatchObject({
      kind: "scheduled_task",
      scheduled_job_id: "cron-agent",
      agent_id: agent.agent_id,
    });
  });
});
