/**
 * lp-cxhb.11 I14 — scheduled job bind requires one catalog agent on create.
 */
import { describe, expect, it } from "vitest";

import {
  parseBindScheduledJob,
} from "../src/bind-scheduled-job.js";
import { ChatThreadStore } from "../src/chat-store.js";
import {
  appendJobStreamFireTurn,
  ensureJobStreamChat,
} from "../src/scheduled-task-job-stream.js";

const tenantId = "tenant-bind-job";
const userId = "user-bind-job";

describe("parseBindScheduledJob (lp-cxhb.11 I14)", () => {
  const catalog = new Set(["agent-legal", "agent-ops"]);

  it("requires job_id and name", () => {
    const parsed = parseBindScheduledJob(
      { agent_id: "agent-legal" },
      catalog,
      { agentRequired: true },
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues).toContainEqual({ code: "job_id_required" });
    expect(parsed.issues).toContainEqual({ code: "name_required" });
  });

  it("I14: product bind requires agent_id", () => {
    const parsed = parseBindScheduledJob(
      { job_id: "cron-1", name: "Daily digest" },
      catalog,
      { agentRequired: true },
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues).toContainEqual({ code: "agent_id_required" });
  });

  it("rejects an agent_id that is not in the catalog", () => {
    const parsed = parseBindScheduledJob(
      { job_id: "cron-1", name: "Daily digest", agent_id: "ghost" },
      catalog,
      { agentRequired: true },
    );
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.issues).toContainEqual({
      code: "agent_not_found",
      agent_id: "ghost",
    });
  });

  it("accepts one catalog agent (bind key still job_id)", () => {
    const parsed = parseBindScheduledJob(
      {
        job_id: "  cron-1  ",
        name: "  Daily digest  ",
        agent_id: "agent-legal",
      },
      catalog,
      { agentRequired: true },
    );
    expect(parsed).toEqual({
      ok: true,
      value: {
        job_id: "cron-1",
        name: "Daily digest",
        agent_id: "agent-legal",
      },
    });
  });

  it("legacy inventory create may omit agent_id", () => {
    const parsed = parseBindScheduledJob(
      { job_id: "cron-legacy", name: "Legacy" },
      catalog,
    );
    expect(parsed).toEqual({
      ok: true,
      value: {
        job_id: "cron-legacy",
        name: "Legacy",
        agent_id: null,
      },
    });
  });
});

describe("ChatThreadStore.ensureForJob agent bind (lp-cxhb.11 I14)", () => {
  it("stores required agent_id on the scheduled_task stream", () => {
    const store = new ChatThreadStore();
    const agent = store.createAgent({
      tenant_id: tenantId,
      user_id: userId,
      name: "Legal",
    });
    const outcome = store.ensureForJob({
      tenant_id: tenantId,
      user_id: userId,
      job_id: "cron-daily",
      name: "Daily digest",
      agent_id: agent.agent_id,
    });
    expect(outcome.created).toBe(true);
    expect(outcome.thread.kind).toBe("scheduled_task");
    expect(outcome.thread.scheduled_job_id).toBe("cron-daily");
    expect(outcome.thread.agent_id).toBe(agent.agent_id);
    expect(outcome.thread.kind).not.toBe("group");
  });

  it("rejects unknown agent_id on create", () => {
    const store = new ChatThreadStore();
    expect(() =>
      store.ensureForJob({
        tenant_id: tenantId,
        user_id: userId,
        job_id: "cron-ghost",
        name: "Ghost job",
        agent_id: "missing-agent",
      }),
    ).toThrow(/unknown agent/i);
  });

  it("re-ensure keeps scheduled_job_id and does not change a bound agent", () => {
    const store = new ChatThreadStore();
    const legal = store.createAgent({
      tenant_id: tenantId,
      user_id: userId,
      name: "Legal",
    });
    const ops = store.createAgent({
      tenant_id: tenantId,
      user_id: userId,
      name: "Ops",
    });
    const first = store.ensureForJob({
      tenant_id: tenantId,
      user_id: userId,
      job_id: "cron-sticky",
      name: "Sticky",
      agent_id: legal.agent_id,
    });
    const second = store.ensureForJob({
      tenant_id: tenantId,
      user_id: userId,
      job_id: "cron-sticky",
      name: "Sticky",
      agent_id: ops.agent_id,
    });
    expect(second.created).toBe(false);
    expect(second.thread.thread_id).toBe(first.thread.thread_id);
    expect(second.thread.agent_id).toBe(legal.agent_id);
    expect(store.listForOwner(tenantId, userId).filter((row) => row.kind === "scheduled_task")).toHaveLength(1);
  });
});

describe("job fire does not wake a channel (lp-cxhb.11 I14)", () => {
  it("appends to the job stream only; channel history stays empty", () => {
    const store = new ChatThreadStore();
    const legal = store.createAgent({
      tenant_id: tenantId,
      user_id: userId,
      name: "Legal",
    });
    const ops = store.createAgent({
      tenant_id: tenantId,
      user_id: userId,
      name: "Ops",
    });
    const channel = store.createChannel({
      tenant_id: tenantId,
      user_id: userId,
      name: "Deal room",
      member_agent_ids: [legal.agent_id, ops.agent_id],
    });

    const binding = ensureJobStreamChat(store, {
      tenant_id: tenantId,
      user_id: userId,
      job_id: "cron-legal",
      name: "Legal digest",
      agent_id: legal.agent_id,
    });
    expect(binding.thread_id).not.toBe(channel.thread_id);

    appendJobStreamFireTurn(store, {
      tenant_id: tenantId,
      user_id: userId,
      job_id: "cron-legal",
      job_name: "Legal digest",
      prompt: "Summarize filings",
      result_text: "No new filings",
      run_status: "ok",
    });

    expect(store.get(binding.thread_id)?.kind).toBe("scheduled_task");
    expect(store.get(binding.thread_id)?.agent_id).toBe(legal.agent_id);
    expect(store.listHistory(binding.thread_id).length).toBeGreaterThan(0);
    expect(store.listHistory(channel.thread_id)).toHaveLength(0);
    expect(store.get(channel.thread_id)?.kind).toBe("group");
  });
});
