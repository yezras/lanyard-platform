/**
 * lp-k5c4.6 — adapters / cron / mailbox enqueue with §4.2 classifier.
 *
 * Spine tenants: deliverInbound spies stay 0. Callers do not choose
 * sandbox_need.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

import {
  asTurnId,
  parseMailboxAppendRequest,
  type MessageEvent,
  type TurnRequest,
} from "@lanyard/shared";

import {
  channelAdapterPlatform,
  deliverChannelAdapterInbound,
  type ChannelAdapterDeliverAuthClient,
} from "../src/channel-adapter-deliver.js";
import { ChatThreadStore } from "../src/chat-store.js";
import {
  enqueueCronHarnessTurn,
  spineStartTurnForCron,
} from "../src/inbound-cron-enqueue.js";
import type { SpineStartTurn } from "../src/inbound-queue.js";
import {
  applyMailboxHop,
  enqueueMailboxHopWake,
  mailboxHopWakePayload,
} from "../src/mailbox-hop.js";
import { createInMemoryScheduledTaskJobRegistry } from "../../control-plane/src/scheduled-task-fire.js";
import {
  fireScheduledTaskHarnessTurn,
  HARNESS_SCHEDULED_TASK_CREATE_PROFILE,
} from "../../control-plane/src/scheduled-task-harness-fire.js";
import { createMemoryInboundQueue } from "./inbound-memory-queue.js";

const TENANT = "tenant-spine-callers";
const USER = "user-spine-callers";
const INSTANCE = "inst-spine-callers";
const PRIMARY = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bffSrcRoot = join(__dirname, "../src");

function walkFiles(root: string, acc: string[] = []): string[] {
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    if (statSync(full).isDirectory()) {
      walkFiles(full, acc);
      continue;
    }
    if (/\.ts$/.test(name)) acc.push(full);
  }
  return acc;
}

function sampleEvent(
  adapter: "slack" | "email" | "whatsapp",
  overrides: Partial<MessageEvent> = {},
): MessageEvent {
  return {
    text: "hello from channel",
    message_type: "text",
    source: {
      platform: channelAdapterPlatform(adapter),
      chat_id: adapter === "email" ? "user@example.com" : "C0123CHANNEL",
      chat_type: adapter === "email" ? "dm" : "channel",
      chat_name: adapter === "email" ? "Inbox" : "#general",
      user_id: USER,
      user_name: "channel-user",
      thread_id: `thr-${adapter}`,
      chat_topic: null,
    },
    ...overrides,
  };
}

function fakeAuth(): ChannelAdapterDeliverAuthClient {
  return {
    getInstancePresence: vi.fn(async () => {
      throw new Error("spine path must not probe presence");
    }),
    ensureOnline: vi.fn(async () => {
      throw new Error("spine path must not ensure_online here");
    }),
    getPrimaryGatewayInstance: vi.fn(async () => ({
      instance_id: PRIMARY,
    })),
  };
}

function recordingStartTurn(delayMs = 0) {
  const calls: TurnRequest[] = [];
  let inflight = 0;
  let maxInflight = 0;
  const startTurn: SpineStartTurn = async (request) => {
    inflight += 1;
    maxInflight = Math.max(maxInflight, inflight);
    calls.push(request);
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    inflight -= 1;
    return { ok: true, turn_id: asTurnId(`turn_${calls.length}`) };
  };
  return {
    startTurn,
    calls,
    maxInflight: () => maxInflight,
  };
}

describe("channel adapter spine enqueue (lp-k5c4.6)", () => {
  it("slack and email enqueue; deliverInbound stays 0", async () => {
    const store = createMemoryInboundQueue();
    const harness = recordingStartTurn();
    const deliverInbound = vi.fn(async () => {
      throw new Error("Relay must not receive deliverInbound");
    });
    const deps = {
      ensureOnlineEnabled: true,
      authClient: fakeAuth(),
      relayClient: { deliverInbound },
      spine: {
        enabled: true,
        store,
        startTurn: harness.startTurn,
        owner: "adapter-worker",
        userId: USER,
      },
    };

    const slack = await deliverChannelAdapterInbound(deps, {
      tenantId: TENANT,
      adapter: "slack",
      event: sampleEvent("slack"),
    });
    const email = await deliverChannelAdapterInbound(deps, {
      tenantId: TENANT,
      adapter: "email",
      event: sampleEvent("email", { text: "invoice question" }),
    });

    expect(deliverInbound).not.toHaveBeenCalled();
    expect(slack).toMatchObject({
      ok: true,
      path: "spine",
      source: "slack",
      sandbox_need: "none",
      instanceId: PRIMARY,
    });
    expect(email).toMatchObject({
      ok: true,
      path: "spine",
      source: "email",
      sandbox_need: "none",
      instanceId: PRIMARY,
    });
    expect(store.payloads().map((item) => item.source)).toEqual([
      "slack",
      "email",
    ]);
    expect(harness.calls.map((call) => call.thread_id)).toEqual([
      "thr-slack",
      "thr-email",
    ]);
  });

  it("attachment or vault keywords classify toolbox", async () => {
    const store = createMemoryInboundQueue();
    const harness = recordingStartTurn();
    const deliverInbound = vi.fn(async () => ({ ok: true as const }));
    const result = await deliverChannelAdapterInbound(
      {
        ensureOnlineEnabled: false,
        authClient: fakeAuth(),
        relayClient: { deliverInbound },
        spine: {
          enabled: true,
          store,
          startTurn: harness.startTurn,
          owner: "adapter-worker",
          userId: USER,
        },
      },
      {
        tenantId: TENANT,
        adapter: "slack",
        event: sampleEvent("slack", {
          text: "please parse_document this",
          media_urls: ["https://files.slack.com/nda.pdf"],
          message_type: "document",
        }),
      },
    );
    expect(deliverInbound).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      ok: true,
      path: "spine",
      source: "slack",
      sandbox_need: "toolbox",
    });
  });
});

describe("cron fire spine enqueue (lp-k5c4.6)", () => {
  it("enqueues source=cron and serializes one room", async () => {
    const store = createMemoryInboundQueue();
    const harness = recordingStartTurn(40);
    const deliverInbound = vi.fn(async () => ({ ok: true as const }));
    const turn = (message: string): TurnRequest => ({
      tenant_id: TENANT,
      user_id: USER,
      instance_id: INSTANCE,
      thread_id: "job-stream-digest",
      message,
    });

    const [first, second] = await Promise.all([
      enqueueCronHarnessTurn({
        store,
        startTurn: harness.startTurn,
        owner: "cron-a",
        turn: turn("first fire"),
        sandboxCreateProfile: "tool_only",
      }),
      enqueueCronHarnessTurn({
        store,
        startTurn: harness.startTurn,
        owner: "cron-b",
        turn: turn("second fire"),
        sandboxCreateProfile: "tool_only",
      }),
    ]);

    expect(deliverInbound).not.toHaveBeenCalled();
    expect(first.ok && second.ok).toBe(true);
    expect(harness.maxInflight()).toBe(1);
    expect(store.payloads().every((item) => item.source === "cron")).toBe(
      true,
    );
    expect(
      store.payloads().every((item) => item.sandbox_need === "toolbox"),
    ).toBe(true);
    expect(store.payloads().every((item) => item.thread_id === "job-stream-digest")).toBe(
      true,
    );
  });

  it("fireScheduledTaskHarnessTurn uses enqueue via wrapped startTurn", async () => {
    const store = createMemoryInboundQueue();
    const harness = recordingStartTurn();
    const deliverInbound = vi.fn(async () => ({ ok: true as const }));
    const jobs = createInMemoryScheduledTaskJobRegistry([
      {
        id: "st-digest",
        instance_id: INSTANCE,
        tenant_id: TENANT,
        user_id: USER,
        name: "Daily digest",
        enabled: true,
        prompt: "Summarize overnight vault changes",
        schedule: { kind: "cron", expr: "0 9 * * 1-5" },
        created_at: "2026-08-20T12:00:00.000Z",
        deliver: "portal_thread",
      },
    ]);
    const result = await fireScheduledTaskHarnessTurn(
      {
        orchestrator: {
          ensureOnline: async () => ({
            instance_id: INSTANCE,
            tenant_id: TENANT,
            presence: "online" as const,
            sandbox_id: "sbx-1",
            runtime_kind: "daytona" as const,
            already_online: true,
            wake_joined: false,
            agent_ready: true,
            vault_writable: true,
          }),
          setMidTurn: async () => {},
          signalActivity: async () => ({
            instance_id: INSTANCE,
            tenant_id: TENANT,
            presence: "online" as const,
            last_activity_at: "2026-08-20T12:00:00.000Z",
            mid_turn: false,
          }),
          getPresence: async () => ({
            instance_id: INSTANCE,
            tenant_id: TENANT,
            presence: "online" as const,
            sandbox_id: "sbx-1",
            runtime_kind: "daytona" as const,
            agent_snapshot_id: "snap",
            s3_vault_prefix: `tenants/${TENANT}/vault/`,
            last_activity_at: null,
            revoked_at: null,
            agent_ready: true,
            vault_writable: true,
          }),
        },
        jobs,
        runJob: async () => ({
          status: "error",
          error: "runner must be harness",
        }),
        identity: { tenant_id: TENANT, user_id: USER },
        startTurn: spineStartTurnForCron({
          store,
          startTurn: harness.startTurn,
          owner: "cron-fire",
          sandboxCreateProfile: HARNESS_SCHEDULED_TASK_CREATE_PROFILE,
        }),
        ensureJobStream: async () => ({ thread_id: "job-stream-st-digest" }),
      },
      { instance_id: INSTANCE, job_id: "st-digest" },
    );

    expect(result.run_status).toBe("ok");
    expect(deliverInbound).not.toHaveBeenCalled();
    expect(store.payloads()).toHaveLength(1);
    expect(store.payloads()[0]).toMatchObject({
      source: "cron",
      sandbox_need: "toolbox",
      thread_id: "job-stream-st-digest",
      message: "Summarize overnight vault changes",
    });
    expect(HARNESS_SCHEDULED_TASK_CREATE_PROFILE).toBe("tool_only");
  });

  it("guest_gateway cron classifies none", async () => {
    const store = createMemoryInboundQueue();
    const harness = recordingStartTurn();
    const result = await enqueueCronHarnessTurn({
      store,
      startTurn: harness.startTurn,
      owner: "cron-none",
      turn: {
        tenant_id: TENANT,
        user_id: USER,
        instance_id: INSTANCE,
        thread_id: "job-llm",
        message: "say hello",
      },
      sandboxCreateProfile: "guest_gateway",
    });
    expect(result.ok).toBe(true);
    expect(store.payloads()[0]?.sandbox_need).toBe("none");
    expect(store.payloads()[0]?.source).toBe("cron");
  });
});

describe("mailbox hop spine enqueue (lp-k5c4.6)", () => {
  it("enqueues source=mailbox on the target thread_id", async () => {
    const chat = new ChatThreadStore();
    const bill = chat.createAgent({
      tenant_id: TENANT,
      user_id: USER,
      name: "Bill",
      objective: "Lead the room.",
    });
    const fizz = chat.createAgent({
      tenant_id: TENANT,
      user_id: USER,
      name: "Fizz",
      objective: "Ship it.",
    });
    const hop = applyMailboxHop(
      chat,
      parseMailboxAppendRequest({
        from: bill.agent_id,
        to: fizz.agent_id,
        room: bill.thread_id,
        text: "Fizz, take the NDA",
        nonce: "nonce-mailbox-spine",
        tenant_id: TENANT,
      }),
    );
    expect(hop.ok).toBe(true);
    if (!hop.ok) return;

    const payload = mailboxHopWakePayload({
      store: chat,
      hop,
      text: "Fizz, take the NDA",
    });
    const store = createMemoryInboundQueue();
    const harness = recordingStartTurn();
    const deliverInbound = vi.fn(async () => ({ ok: true as const }));
    const result = await enqueueMailboxHopWake({
      store,
      startTurn: harness.startTurn,
      owner: "mailbox-worker",
      tenantId: TENANT,
      userId: USER,
      instanceId: INSTANCE,
      hop,
      payload,
    });

    expect(deliverInbound).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(payload.thread_id).toBe(fizz.thread_id);
    expect(store.payloads()[0]).toMatchObject({
      source: "mailbox",
      sandbox_need: "none",
      thread_id: fizz.thread_id,
      message: "Fizz, take the NDA",
    });
    expect(store.payloads()[0]?.metadata?.hidden_instruction).toBe(
      "Fizz, take the NDA",
    );
  });

  it("inherits prior toolbox need on the target thread", async () => {
    const chat = new ChatThreadStore();
    const bill = chat.createAgent({
      tenant_id: TENANT,
      user_id: USER,
      name: "Bill",
    });
    const fizz = chat.createAgent({
      tenant_id: TENANT,
      user_id: USER,
      name: "Fizz",
    });
    const hop = applyMailboxHop(
      chat,
      parseMailboxAppendRequest({
        from: bill.agent_id,
        to: fizz.agent_id,
        room: bill.thread_id,
        text: "continue the vault work",
        nonce: "nonce-mailbox-inherit",
        tenant_id: TENANT,
      }),
    );
    if (!hop.ok) throw new Error("expected hop ok");
    const store = createMemoryInboundQueue();
    const harness = recordingStartTurn();
    await enqueueMailboxHopWake({
      store,
      startTurn: harness.startTurn,
      owner: "mailbox-worker",
      tenantId: TENANT,
      userId: USER,
      instanceId: INSTANCE,
      hop,
      payload: mailboxHopWakePayload({
        store: chat,
        hop,
        text: "continue the vault work",
      }),
      priorNeed: "toolbox",
    });
    expect(store.payloads()[0]?.source).toBe("mailbox");
    expect(store.payloads()[0]?.sandbox_need).toBe("toolbox");
    expect(store.payloads()[0]?.thread_id).toBe(hop.target_thread_id);
  });
});

describe("no new deliverInbound call sites (lp-k5c4.6)", () => {
  it("keeps Relay deliverInbound invocations in the legacy hop files", () => {
    const hits: string[] = [];
    for (const file of walkFiles(bffSrcRoot)) {
      const text = readFileSync(file, "utf8");
      if (!text.includes(".deliverInbound(")) continue;
      hits.push(file.slice(bffSrcRoot.length + 1));
    }
    expect(hits.sort()).toEqual(
      [
        "channel-adapter-deliver.ts",
        "chat-delivery-send.ts",
        "scheduled-task-job-stream.ts",
      ].sort(),
    );
  });
});
