/**
 * lp-fn5.5.3 — Fire/delivery always appends to the durable job stream chat.
 *
 * Platform `fireScheduledTask` (and production AgentJobRunner deliver-inbound)
 * resolve the E1 job↔thread binding via {@link ChatThreadStore.ensureForJob}
 * and append history to that same `thread_id`. Two fires of one job produce
 * two turns on one stream — never a new thread per run.
 *
 * Deliver field: `portal_thread` means the agent inbound uses
 * `source.chat_id = thread_id` so outbound SSE/history land on the stream.
 * Other deliver values (e.g. `local`) still get portal stream append when
 * the fire path wires these helpers; external channel delivery is orthogonal.
 *
 * @see docs/architecture/portal-job-thread-binding.md
 */

import { randomUUID } from "node:crypto";

import {
  LANYARD_WEB_PLATFORM,
  type MessageEvent,
} from "@lanyard/shared";

import type { ChatThreadStore } from "./chat-store.js";
import type { RelayClient } from "./relay-client.js";

/** Job `deliver` mode: agent run targets the portal job stream chat. */
export const PORTAL_THREAD_DELIVER = "portal_thread" as const;

export type JobStreamBinding = {
  thread_id: string;
  created: boolean;
  title: string;
  scheduled_job_id: string;
};

export type EnsureJobStreamInput = {
  tenant_id: string;
  user_id: string;
  job_id: string;
  /** Job display name → thread title when title_source=job. */
  name: string;
  /** Durable agent this job runs as (lp-cxhb.11). */
  agent_id?: string | null;
};

/**
 * Idempotent resolve of the durable scheduled-task stream for a job.
 * Same (tenant, user, job_id) always returns the same thread_id.
 */
export function ensureJobStreamChat(
  store: ChatThreadStore,
  input: EnsureJobStreamInput,
): JobStreamBinding {
  const outcome = store.ensureForJob({
    tenant_id: input.tenant_id,
    user_id: input.user_id,
    job_id: input.job_id,
    name: input.name,
    agent_id: input.agent_id,
  });
  return {
    thread_id: outcome.thread.thread_id,
    created: outcome.created,
    title: outcome.thread.title,
    scheduled_job_id: outcome.thread.scheduled_job_id ?? input.job_id,
  };
}

export type AppendJobStreamFireTurnInput = {
  tenant_id: string;
  user_id: string;
  job_id: string;
  job_name: string;
  /**
   * User-visible content for this fire turn (typically the job prompt /
   * scheduled-run stamp). Always appended as `user_message`.
   */
  prompt: string;
  /**
   * Optional assistant/result body for this fire. When omitted and
   * `run_status` is not `error`, only the user turn is appended (live path
   * relies on agent outbound tee into history).
   */
  result_text?: string;
  run_status?: "ok" | "error";
  run_error?: string;
  started_at?: string;
  finished_at?: string;
  /**
   * When set, skip ensureForJob and append to this thread (must already be
   * the job stream). Prefer ensure path for callers that only have job_id.
   */
  thread_id?: string;
};

export type AppendJobStreamFireTurnResult = {
  thread_id: string;
  created: boolean;
  user_message_id: string;
  assistant_message_id?: string;
};

/**
 * Ensure the job stream binding and append one fire turn.
 *
 * Always appends a `user_message` for the fire. Optionally appends a
 * `message_send` assistant turn when `result_text` is set or the run failed
 * (offline / mock completion; live agent replies still tee via SSE).
 */
export function appendJobStreamFireTurn(
  store: ChatThreadStore,
  input: AppendJobStreamFireTurnInput,
): AppendJobStreamFireTurnResult {
  let threadId = input.thread_id?.trim() || "";
  let created = false;
  let title = input.job_name;

  if (threadId) {
    const existing = store.get(threadId);
    if (!existing || existing.tenant_id !== input.tenant_id) {
      throw new Error(
        `job stream thread not found for fire append: ${threadId}`,
      );
    }
    title = existing.title;
  } else {
    const binding = ensureJobStreamChat(store, {
      tenant_id: input.tenant_id,
      user_id: input.user_id,
      job_id: input.job_id,
      name: input.job_name,
    });
    threadId = binding.thread_id;
    created = binding.created;
    title = binding.title;
  }

  const startedAt = input.started_at ?? new Date().toISOString();
  const finishedAt = input.finished_at ?? startedAt;
  const userMessageId = randomUUID();

  store.appendHistory(threadId, {
    type: "user_message",
    message_id: userMessageId,
    content: input.prompt,
    created_at: startedAt,
    chat_id: threadId,
  });

  const shouldAppendAssistant =
    input.result_text !== undefined ||
    input.run_status === "error" ||
    (input.run_error !== undefined && input.run_error.length > 0);

  let assistantMessageId: string | undefined;
  if (shouldAppendAssistant) {
    assistantMessageId = randomUUID();
    const content =
      input.result_text?.trim() ||
      input.run_error?.trim() ||
      "Scheduled task failed";
    store.appendHistory(threadId, {
      type: "message_send",
      chat_id: threadId,
      message_id: assistantMessageId,
      content,
      created_at: finishedAt,
      metadata: {
        portal_event: "scheduled_task.fire",
        scheduled_job_id: input.job_id,
        job_name: title,
        run_status: input.run_status ?? (input.run_error ? "error" : "ok"),
      },
    });
  }

  return {
    thread_id: threadId,
    created,
    user_message_id: userMessageId,
    assistant_message_id: assistantMessageId,
  };
}

/**
 * Build a portal MessageEvent for scheduled-task fire deliver-inbound.
 * `source.chat_id` is the bound job stream thread so agent outbound lands there.
 */
export function buildScheduledTaskFireMessageEvent(input: {
  thread_id: string;
  thread_title: string;
  user_id: string;
  user_name?: string | null;
  prompt: string;
  job_id: string;
  job_name?: string;
}): MessageEvent {
  return {
    text: input.prompt,
    message_type: "text",
    source: {
      platform: LANYARD_WEB_PLATFORM,
      chat_id: input.thread_id,
      chat_type: "dm",
      chat_name: input.thread_title,
      user_id: input.user_id,
      user_name: input.user_name ?? null,
      thread_id: null,
      chat_topic: null,
    },
    metadata: {
      portal_inbound: "scheduled_task.fire",
      scheduled_job_id: input.job_id,
      ...(input.job_name ? { job_name: input.job_name } : {}),
    },
  };
}

export type DeliverScheduledTaskFireDeps = {
  chatThreads: ChatThreadStore;
  relayClient: Pick<RelayClient, "deliverInbound">;
};

export type DeliverScheduledTaskFireInput = {
  tenant_id: string;
  user_id: string;
  user_name?: string | null;
  instance_id: string;
  job_id: string;
  job_name: string;
  prompt: string;
  /**
   * When true (default), append user_message before deliver.
   * Set false if the fire path already appended.
   */
  append_user_turn?: boolean;
  started_at?: string;
};

export type DeliverScheduledTaskFireResult =
  | {
      ok: true;
      thread_id: string;
      created: boolean;
      user_message_id?: string;
    }
  | {
      ok: false;
      thread_id: string;
      created: boolean;
      status: number;
      error: string;
      phase: "ensure" | "deliver";
    };

/**
 * Ensure job stream → optional history user turn → relay deliver-inbound with
 * chat_id = bound thread_id (portal_thread deliver mode).
 *
 * Does not append assistant text; live agent outbound tees into history via
 * the existing chat events path when clients are connected, and callers may
 * call {@link appendJobStreamFireTurn} with result_text for offline/mock.
 */
export async function deliverScheduledTaskFireToJobStream(
  deps: DeliverScheduledTaskFireDeps,
  input: DeliverScheduledTaskFireInput,
): Promise<DeliverScheduledTaskFireResult> {
  let binding: JobStreamBinding;
  try {
    binding = ensureJobStreamChat(deps.chatThreads, {
      tenant_id: input.tenant_id,
      user_id: input.user_id,
      job_id: input.job_id,
      name: input.job_name,
    });
  } catch (cause) {
    return {
      ok: false,
      thread_id: "",
      created: false,
      status: 500,
      error: cause instanceof Error ? cause.message : String(cause),
      phase: "ensure",
    };
  }

  let userMessageId: string | undefined;
  if (input.append_user_turn !== false) {
    const turn = appendJobStreamFireTurn(deps.chatThreads, {
      tenant_id: input.tenant_id,
      user_id: input.user_id,
      job_id: input.job_id,
      job_name: input.job_name,
      prompt: input.prompt,
      thread_id: binding.thread_id,
      started_at: input.started_at,
      // Live path: no assistant body here (agent streams later).
    });
    userMessageId = turn.user_message_id;
  }

  const event = buildScheduledTaskFireMessageEvent({
    thread_id: binding.thread_id,
    thread_title: binding.title,
    user_id: input.user_id,
    user_name: input.user_name,
    prompt: input.prompt,
    job_id: input.job_id,
    job_name: input.job_name,
  });

  const delivered = await deps.relayClient.deliverInbound({
    instanceId: input.instance_id,
    tenantId: input.tenant_id,
    event,
  });

  if (!delivered.ok) {
    return {
      ok: false,
      thread_id: binding.thread_id,
      created: binding.created,
      status: delivered.status,
      error: delivered.error,
      phase: "deliver",
    };
  }

  return {
    ok: true,
    thread_id: binding.thread_id,
    created: binding.created,
    user_message_id: userMessageId,
  };
}

/**
 * Whether a job deliver field targets the portal job stream chat.
 * `portal_thread` is explicit; empty/undefined is treated as portal-capable
 * when the fire path has stream hooks wired (append always).
 */
export function isPortalThreadDeliver(deliver: string | undefined | null): boolean {
  if (deliver == null || deliver === "") return false;
  return deliver.trim().toLowerCase() === PORTAL_THREAD_DELIVER;
}

/**
 * Build fire-path hooks for {@link fireScheduledTask} that always bind and
 * append to the owner's job stream (lp-fn5.5.3).
 *
 * Structural types — BFF does not import `@lanyard/control-plane`.
 */
export function createJobStreamFireHooks(deps: {
  chatThreads: ChatThreadStore;
  tenant_id: string;
  user_id: string;
}): {
  ensureJobStream: (input: {
    job: { id: string; name: string };
    instance_id: string;
  }) => Promise<JobStreamBinding>;
  appendJobStreamTurn: (input: {
    thread_id: string;
    job: { id: string; name: string; prompt: string };
    run_status: "ok" | "error";
    run_error?: string;
    started_at: string;
    finished_at: string;
    result_text?: string;
  }) => Promise<void>;
} {
  return {
    async ensureJobStream(input) {
      return ensureJobStreamChat(deps.chatThreads, {
        tenant_id: deps.tenant_id,
        user_id: deps.user_id,
        job_id: input.job.id,
        name: input.job.name,
      });
    },
    async appendJobStreamTurn(input) {
      appendJobStreamFireTurn(deps.chatThreads, {
        tenant_id: deps.tenant_id,
        user_id: deps.user_id,
        job_id: input.job.id,
        job_name: input.job.name,
        // User turn content = job prompt (scheduled fire stamp).
        prompt: input.job.prompt,
        thread_id: input.thread_id,
        result_text: input.result_text,
        run_status: input.run_status,
        run_error: input.run_error,
        started_at: input.started_at,
        finished_at: input.finished_at,
      });
    },
  };
}
