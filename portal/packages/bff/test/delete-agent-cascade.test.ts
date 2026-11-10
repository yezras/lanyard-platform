/**
 * lp-cxhb.10 — I13: agent delete confirm cascade.
 *
 * Deleting the Agents row deletes the person: the agent leaves every
 * channel, bound scheduled-job streams are unbound, then the catalog row
 * and its 1:1 are removed. Floor-of-two policy choice (documented): a
 * channel that would drop below two members is DELETED outright rather
 * than blocking the agent delete, so no channel-only ghost roster can
 * reference a dead agent id.
 */
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { ChatThreadStore } from "../src/chat-store.js";
import { SessionStore } from "../src/session.js";
import type { TenantContext } from "../src/types.js";
import { cookieHeader, createTestBindings } from "./test-helpers.js";

const tenant: TenantContext = {
  tenant_id: "tenant-agent-delete",
  tenant_slug: "demo",
  display_name: "Demo",
  host: "demo.withlanyard.com",
};
const userId = "user-agent-delete";

function seedAgents(store: ChatThreadStore, names: string[]) {
  return names.map(
    (name) =>
      store.createAgent({
        tenant_id: tenant.tenant_id,
        user_id: userId,
        name,
      }),
  );
}

describe("ChatThreadStore.delete agent cascade (lp-cxhb.10 I13)", () => {
  it("I13: deleted agent leaves a three-member channel; channel keeps two", () => {
    const store = new ChatThreadStore();
    const [legal, ops, fin] = seedAgents(store, ["Legal", "Ops", "Fin"]);
    const channel = store.createChannel({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Deal room",
      member_agent_ids: [legal.agent_id, ops.agent_id],
    });
    store.addChannelMember({
      thread_id: channel.thread_id,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      agent_id: fin.agent_id,
    });

    expect(store.delete(legal.thread_id)).toBe(true);

    const after = store.getChannel(channel.thread_id);
    expect(after?.members.map((row) => row.agent_id)).toEqual([
      ops.agent_id,
      fin.agent_id,
    ]);
    expect(after?.lead_agent_id).toBe(ops.agent_id);
    expect(after?.thread.orchestrator_persona_id).toBe(ops.agent_id);
    expect(
      after?.thread.participants.some(
        (row) => row.kind === "persona" && row.persona_id === legal.agent_id,
      ),
    ).toBe(false);
    expect(store.listAgents(tenant.tenant_id, userId).map((a) => a.name)).toEqual([
      "Ops",
      "Fin",
    ]);
    expect(store.get(legal.thread_id)).toBeUndefined();
  });

  it("I13 floor-two policy: a pair channel is deleted with the agent, not ghosted", () => {
    // Documented choice: blocking the delete would strand the person in the
    // roster; instead the whole channel goes and the survivor keeps their 1:1.
    const store = new ChatThreadStore();
    const [legal, ops] = seedAgents(store, ["Legal", "Ops"]);
    const channel = store.createChannel({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Pair room",
      member_agent_ids: [legal.agent_id, ops.agent_id],
    });

    expect(store.delete(legal.thread_id)).toBe(true);

    expect(store.getChannel(channel.thread_id)).toBeUndefined();
    expect(store.listChannels(tenant.tenant_id, userId)).toEqual([]);
    expect(store.listAgents(tenant.tenant_id, userId).map((a) => a.name)).toEqual([
      "Ops",
    ]);
    expect(store.get(ops.thread_id)?.kind).toBe("chat");
  });

  it("I13: bound job streams are unbound (stream stays, agent_id clears)", () => {
    const store = new ChatThreadStore();
    const [legal] = seedAgents(store, ["Legal"]);
    const bound = store.ensureForJob({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      job_id: "job-daily",
      name: "Daily digest",
      agent_id: legal.agent_id,
    });
    expect(bound.thread.agent_id).toBe(legal.agent_id);

    expect(store.delete(legal.thread_id)).toBe(true);

    const stream = store.findByScheduledJobId(
      tenant.tenant_id,
      userId,
      "job-daily",
    );
    expect(stream?.thread_id).toBe(bound.thread.thread_id);
    expect(stream?.scheduled_job_id).toBe("job-daily");
    expect(stream?.agent_id).toBeNull();
  });

  it("I13: no channel anywhere still references the deleted agent id", () => {
    const store = new ChatThreadStore();
    const [legal, ops, fin] = seedAgents(store, ["Legal", "Ops", "Fin"]);
    const pair = store.createChannel({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Pair",
      member_agent_ids: [legal.agent_id, ops.agent_id],
    });
    const trio = store.createChannel({
      tenant_id: tenant.tenant_id,
      user_id: userId,
      name: "Trio",
      member_agent_ids: [ops.agent_id, fin.agent_id],
    });
    store.addChannelMember({
      thread_id: trio.thread_id,
      tenant_id: tenant.tenant_id,
      user_id: userId,
      agent_id: legal.agent_id,
    });

    store.delete(legal.thread_id);

    for (const channel of store.listChannels(tenant.tenant_id, userId)) {
      for (const member of channel.members) {
        expect(member.agent_id).not.toBe(legal.agent_id);
      }
    }
    expect(store.getChannel(pair.thread_id)).toBeUndefined();
    expect(
      store.getChannel(trio.thread_id)?.members.map((row) => row.agent_id),
    ).toEqual([ops.agent_id, fin.agent_id]);
  });
});

describe("HTTP agent delete cascade (lp-cxhb.10 I13)", () => {
  async function boot() {
    const chatThreads = new ChatThreadStore();
    const sessions = new SessionStore();
    const session = await sessions.create({
      userId,
      tenantId: tenant.tenant_id,
      email: "delete@example.com",
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
        instance_id: "inst-agent-delete",
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
      lanyard_csrf: "test-csrf-agent-delete",
    };
    return { app, cookies };
  }

  function headers(cookies: Record<string, string>): Headers {
    return new Headers({
      host: tenant.host,
      cookie: cookieHeader(cookies),
      "x-csrf-token": cookies.lanyard_csrf,
      "content-type": "application/json",
    });
  }

  it("I13: DELETE /chat/threads/:agentThreadId removes the person from every channel; pair channel is deleted", async () => {
    const { app, cookies } = await boot();

    const created: Array<{ agent_id: string; thread_id: string }> = [];
    for (const name of ["Legal", "Ops"]) {
      const res = await app.request("/api/agents", {
        method: "POST",
        headers: headers(cookies),
        body: JSON.stringify({ name }),
      });
      expect(res.status).toBe(201);
      created.push((await res.json()) as { agent_id: string; thread_id: string });
    }
    const [legal, ops] = created;
    const channelRes = await app.request("/api/channels", {
      method: "POST",
      headers: headers(cookies),
      body: JSON.stringify({
        name: "Pair room",
        member_agent_ids: [legal.agent_id, ops.agent_id],
      }),
    });
    expect(channelRes.status).toBe(201);
    const channel = (await channelRes.json()) as { thread_id: string };

    const deleted = await app.request(`/api/chat/threads/${legal.thread_id}`, {
      method: "DELETE",
      headers: headers(cookies),
    });
    expect(deleted.status).toBe(200);

    const agentsRes = await app.request("/api/agents", {
      headers: new Headers({
        host: tenant.host,
        cookie: cookieHeader(cookies),
      }),
    });
    const agentsBody = (await agentsRes.json()) as {
      agents: Array<{ agent_id: string }>;
    };
    expect(agentsBody.agents.map((row) => row.agent_id)).toEqual([
      ops.agent_id,
    ]);

    const channelsRes = await app.request("/api/channels", {
      headers: new Headers({
        host: tenant.host,
        cookie: cookieHeader(cookies),
      }),
    });
    const channelsBody = (await channelsRes.json()) as { channels: unknown[] };
    expect(channelsBody.channels).toEqual([]);

    const threadsRes = await app.request("/api/chat/threads", {
      headers: new Headers({
        host: tenant.host,
        cookie: cookieHeader(cookies),
      }),
    });
    const threadsBody = (await threadsRes.json()) as {
      threads: Array<{ thread_id: string }>;
    };
    expect(
      threadsBody.threads.some((row) => row.thread_id === legal.thread_id),
    ).toBe(false);
    expect(
      threadsBody.threads.some((row) => row.thread_id === ops.thread_id),
    ).toBe(true);
    expect(
      threadsBody.threads.some((row) => row.thread_id === channel.thread_id),
    ).toBe(false);
  });
});
