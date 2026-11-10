/**
 * lp-v62i.23 — agent scheduled_task.create appears under Scheduled Tasks.
 *
 * Prove: host-tool create persists cron + scheduled_task thread;
 * GET /api/chat/threads includes it. Failed parse/create → no new thread.
 */
import { describe, expect, it } from "vitest";

import { SCHEDULED_TASK_CREATE_TOOL_NAME } from "@lanyard/shared";

import { createApp } from "../src/app.js";
import { ChatThreadStore } from "../src/chat-store.js";
import {
  hopScheduledTaskFromHarnessEvent,
  persistScheduledTaskCreate,
  scheduledTaskCreateFromToolEvent,
} from "../src/scheduled-task-create-hop.js";
import { createInMemoryScheduledJobStore } from "../src/scheduled-task-vault-store.js";
import { SessionStore } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import { cookieHeader, createTestBindings } from "./test-helpers.js";

const tenant: TenantContext = {
  tenant_id: "tenant-st-create",
  tenant_slug: "demo",
  display_name: "Demo",
  host: "demo.withlanyard.com",
  chat_delivery: "harness",
};
const userId = "user-st-create";

function seedBill(store = new ChatThreadStore()) {
  const bill = store.createAgent({
    tenant_id: tenant.tenant_id,
    user_id: userId,
    name: "Bill",
  });
  return { store, bill };
}

function createEvent(partial: Record<string, unknown> = {}) {
  return {
    type: "tool_progress",
    tool_name: SCHEDULED_TASK_CREATE_TOOL_NAME,
    tool_status: "complete",
    tool_call_id: "call-st-1",
    metadata: {
      name: "Ping every minute",
      prompt: "Ping Jack for 10 minutes",
      schedule: "* * * * *",
    },
    ...partial,
  };
}

describe("scheduledTaskCreateFromToolEvent", () => {
  it("reads scheduled_task.create off tool_progress", () => {
    expect(scheduledTaskCreateFromToolEvent(createEvent())).toEqual({
      input: {
        name: "Ping every minute",
        prompt: "Ping Jack for 10 minutes",
        schedule: "* * * * *",
      },
      jobId: undefined,
    });
  });

  it("reads nested metadata.scheduled_task and cron.create alias", () => {
    expect(
      scheduledTaskCreateFromToolEvent({
        type: "tool_progress",
        tool_name: "cron.create",
        metadata: {
          scheduled_task: {
            name: "Vault index refresh",
            prompt: "Refresh the vault index",
            schedule: "0 * * * *",
            enabled: true,
          },
        },
      }),
    ).toEqual({
      input: {
        name: "Vault index refresh",
        prompt: "Refresh the vault index",
        schedule: "0 * * * *",
        enabled: true,
      },
      jobId: undefined,
    });
  });

  it("returns null for failed tool_progress (no ghost)", () => {
    expect(
      scheduledTaskCreateFromToolEvent(
        createEvent({ tool_status: "error", content: "missing sandbox_id" }),
      ),
    ).toBeNull();
    expect(
      scheduledTaskCreateFromToolEvent({
        type: "message_send",
        content: "I will schedule that",
      }),
    ).toBeNull();
  });

  it("returns null for invalid parse (empty name)", () => {
    expect(
      scheduledTaskCreateFromToolEvent(
        createEvent({
          metadata: { name: "  ", prompt: "x", schedule: "* * * * *" },
        }),
      ),
    ).toBeNull();
  });

  it("does not invent * * * * * from job_id + name only", () => {
    expect(
      scheduledTaskCreateFromToolEvent({
        type: "tool_progress",
        tool_name: SCHEDULED_TASK_CREATE_TOOL_NAME,
        tool_status: "complete",
        metadata: { job_id: "st_ghost", name: "Ghost ping" },
      }),
    ).toBeNull();
  });
});

describe("persistScheduledTaskCreate", () => {
  it("persists cron and binds kind=scheduled_task stream", async () => {
    const { store, bill } = seedBill();
    const jobs = createInMemoryScheduledJobStore();
    const result = await persistScheduledTaskCreate({
      chat: store,
      jobs,
      tenantId: tenant.tenant_id,
      userId,
      agentId: bill.agent_id,
      fields: {
        input: {
          name: "Ping every minute",
          prompt: "Ping Jack",
          schedule: "* * * * *",
        },
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.persisted).toBe(true);
    const job = await jobs.get(tenant.tenant_id, result.job_id);
    expect(job?.name).toBe("Ping every minute");
    expect(job?.prompt).toBe("Ping Jack");
    const thread = store.get(result.thread_id);
    expect(thread?.kind).toBe("scheduled_task");
    expect(thread?.scheduled_job_id).toBe(result.job_id);
    expect(thread?.title).toBe("Ping every minute");
    expect(thread?.title_source).toBe("job");
  });

  it("failed persist (no store) does not mint a thread", async () => {
    const { store, bill } = seedBill();
    const before = store.listForOwner(tenant.tenant_id, userId).length;
    const result = await persistScheduledTaskCreate({
      chat: store,
      jobs: null,
      tenantId: tenant.tenant_id,
      userId,
      agentId: bill.agent_id,
      fields: {
        input: {
          name: "Ghost",
          prompt: "nope",
          schedule: "* * * * *",
        },
      },
    });
    expect(result.ok).toBe(false);
    expect(store.listForOwner(tenant.tenant_id, userId)).toHaveLength(before);
    expect(
      store
        .listForOwner(tenant.tenant_id, userId)
        .filter((row) => row.kind === "scheduled_task"),
    ).toHaveLength(0);
  });

  it("job_id + jobs: null does not mint a scheduled_task stream", async () => {
    const { store, bill } = seedBill();
    const before = store
      .listForOwner(tenant.tenant_id, userId)
      .filter((row) => row.kind === "scheduled_task").length;
    const result = await persistScheduledTaskCreate({
      chat: store,
      jobs: null,
      tenantId: tenant.tenant_id,
      userId,
      agentId: bill.agent_id,
      fields: {
        jobId: "st_missing_store",
        input: {
          name: "Ghost ping",
          prompt: "Ping Jack",
          schedule: "* * * * *",
        },
      },
    });
    expect(result.ok).toBe(false);
    expect(
      store
        .listForOwner(tenant.tenant_id, userId)
        .filter((row) => row.kind === "scheduled_task"),
    ).toHaveLength(before);
  });

  it("unknown job_id + incomplete args does not write a job row", async () => {
    const { store, bill } = seedBill();
    const jobs = createInMemoryScheduledJobStore();
    const hopped = await hopScheduledTaskFromHarnessEvent({
      chat: store,
      jobs,
      tenantId: tenant.tenant_id,
      userId,
      thread: store.get(bill.thread_id)!,
      event: {
        type: "tool_progress",
        tool_name: SCHEDULED_TASK_CREATE_TOOL_NAME,
        tool_status: "complete",
        metadata: { job_id: "st_unknown", name: "Incomplete" },
      },
      createdIds: new Set<string>(),
    });
    expect(hopped).toBeNull();
    expect(await jobs.list(tenant.tenant_id)).toEqual([]);
    expect(
      store
        .listForOwner(tenant.tenant_id, userId)
        .filter((row) => row.kind === "scheduled_task"),
    ).toHaveLength(0);
  });
});

describe("hopScheduledTaskFromHarnessEvent", () => {
  it("creates once per tool_call_id", async () => {
    const { store, bill } = seedBill();
    const thread = store.get(bill.thread_id)!;
    const jobs = createInMemoryScheduledJobStore();
    const createdIds = new Set<string>();
    const first = await hopScheduledTaskFromHarnessEvent({
      chat: store,
      jobs,
      tenantId: tenant.tenant_id,
      userId,
      thread,
      event: createEvent(),
      createdIds,
    });
    const second = await hopScheduledTaskFromHarnessEvent({
      chat: store,
      jobs,
      tenantId: tenant.tenant_id,
      userId,
      thread,
      event: createEvent(),
      createdIds,
    });
    expect(first?.ok).toBe(true);
    expect(second).toBeNull();
    expect(
      store
        .listForOwner(tenant.tenant_id, userId)
        .filter((row) => row.kind === "scheduled_task"),
    ).toHaveLength(1);
  });
});

describe("GET /api/chat/threads after host-tool create", () => {
  async function boot() {
    const { store, bill } = seedBill();
    const jobs = createInMemoryScheduledJobStore();
    const sessions = new SessionStore();
    const session = await sessions.create({
      userId,
      tenantId: tenant.tenant_id,
      email: "st-create@example.com",
    });
    const app = createApp(
      createTestBindings(
        { [tenant.tenant_slug]: tenant },
        {
          sessions,
          chatThreads: store,
          scheduledJobStore: jobs,
          vaultPlane: "cp_s3",
          authClient: {
            getUserRbac: async () => ({
              user_id: userId,
              tenant_id: tenant.tenant_id,
              hermes_profile: "default",
              allowed_path_prefixes: ["/"],
              role_names: ["admin"],
            }),
            getPrimaryGatewayInstance: async () => ({
              instance_id: "inst-st-create",
            }),
            getActiveSessionShare: async () => null,
            listSessionSharesForGrantee: async () => [],
          } as never,
        },
      ),
    );
    const cookies = {
      lanyard_session: session.sessionId,
      lanyard_csrf: "test-csrf-st-create",
    };
    const headers = {
      host: tenant.host,
      cookie: cookieHeader(cookies),
      "x-csrf-token": cookies.lanyard_csrf,
    };
    return { app, store, jobs, bill, headers };
  }

  it("host-tool create → GET threads includes kind=scheduled_task stream", async () => {
    const { app, store, jobs, bill, headers } = await boot();
    const thread = store.get(bill.thread_id)!;
    const createdIds = new Set<string>();
    const hopped = await hopScheduledTaskFromHarnessEvent({
      chat: store,
      jobs,
      tenantId: tenant.tenant_id,
      userId,
      thread,
      event: createEvent(),
      createdIds,
    });
    expect(hopped?.ok).toBe(true);
    if (!hopped?.ok) return;

    const listed = await jobs.list(tenant.tenant_id);
    expect(listed.map((job) => job.id)).toContain(hopped.job_id);

    const res = await app.request("/api/chat/threads", { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      threads: Array<{
        thread_id: string;
        kind: string;
        scheduled_job_id: string | null;
        title: string;
      }>;
    };
    const stream = body.threads.find(
      (row) => row.kind === "scheduled_task" && row.scheduled_job_id === hopped.job_id,
    );
    expect(stream).toMatchObject({
      thread_id: hopped.thread_id,
      kind: "scheduled_task",
      title: "Ping every minute",
      scheduled_job_id: hopped.job_id,
    });
  });

  it("failed parse/create leaves GET threads without a new scheduled_task", async () => {
    const { app, store, jobs, bill, headers } = await boot();
    const thread = store.get(bill.thread_id)!;
    const createdIds = new Set<string>();
    const hopped = await hopScheduledTaskFromHarnessEvent({
      chat: store,
      jobs,
      tenantId: tenant.tenant_id,
      userId,
      thread,
      event: createEvent({
        tool_status: "error",
        metadata: { name: "Ghost", prompt: "no", schedule: "* * * * *" },
      }),
      createdIds,
    });
    expect(hopped).toBeNull();
    expect(await jobs.list(tenant.tenant_id)).toEqual([]);

    const res = await app.request("/api/chat/threads", { headers });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      threads: Array<{ kind: string }>;
    };
    expect(body.threads.filter((row) => row.kind === "scheduled_task")).toEqual(
      [],
    );
  });
});
