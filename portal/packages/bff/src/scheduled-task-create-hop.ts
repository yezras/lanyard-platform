/**
 * Host-tool hop for scheduled_task.create (lp-v62i.23).
 *
 * Same shape as mailbox.send: harness tool_progress is parsed here, then the
 * existing cron create path (vault jobs.json / POST /api/settings/crons) plus
 * ensureForJob so the sidenav lists kind=scheduled_task without a Settings
 * round-trip. Failed parse or persist does not mint a stream.
 */

import {
  SCHEDULED_TASK_CREATE_TOOL_NAME,
  type ScheduledTaskCreateInput,
} from "@lanyard/shared";

import type { ChatThread, ChatThreadStore } from "./chat-store.js";
import { bindScheduledTaskConnectorNeed } from "./scheduled-task-connectors.js";
import { ensureJobStreamChat } from "./scheduled-task-job-stream.js";
import {
  BFF_VAULT_SCHEDULED_JOBS_PATH,
  newScheduledTaskJobId,
  type BffScheduledJob,
  type BffScheduledJobStore,
} from "./scheduled-task-vault-store.js";
import { parseScheduledTaskToolInput } from "./host-tools.js";

export { SCHEDULED_TASK_CREATE_TOOL_NAME };

export const CRON_CREATE_TOOL_NAME = "cron.create" as const;

const HOST_CREATE_TOOL_NAMES = new Set([
  SCHEDULED_TASK_CREATE_TOOL_NAME,
  CRON_CREATE_TOOL_NAME,
  "scheduled_task",
]);

export type ScheduledTaskCreateHopOk = {
  ok: true;
  job_id: string;
  name: string;
  thread_id: string;
  created: boolean;
  persisted: boolean;
};

export type ScheduledTaskCreateHopErr = {
  ok: false;
  error: string;
};

export type ScheduledTaskCreateHopResult =
  | ScheduledTaskCreateHopOk
  | ScheduledTaskCreateHopErr;

export type ScheduledTaskCreateToolFields = {
  input: ScheduledTaskCreateInput;
  jobId?: string;
};

function toolNameOf(event: {
  tool_name?: string;
  tool_label?: string;
  metadata?: Record<string, unknown>;
}): string {
  const direct = (event.tool_name ?? event.tool_label ?? "").trim();
  if (direct) return direct;
  const metaName =
    typeof event.metadata?.tool_name === "string"
      ? event.metadata.tool_name.trim()
      : "";
  return metaName;
}

function isHostCreateToolName(name: string): boolean {
  const n = name.trim();
  if (!n) return false;
  if (HOST_CREATE_TOOL_NAMES.has(n)) return true;
  return n.toLowerCase() === SCHEDULED_TASK_CREATE_TOOL_NAME;
}

function isFailedToolStatus(status: unknown): boolean {
  if (typeof status !== "string") return false;
  const n = status.trim().toLowerCase();
  return n === "error" || n === "failed" || n === "failure";
}

function stripJobId(raw: Record<string, unknown>): {
  rest: Record<string, unknown>;
  jobId?: string;
} {
  const jobIdRaw = raw.job_id ?? raw.id ?? raw.cron_id;
  const jobId =
    typeof jobIdRaw === "string" && jobIdRaw.trim() ? jobIdRaw.trim() : undefined;
  const rest: Record<string, unknown> = { ...raw };
  delete rest.job_id;
  delete rest.id;
  delete rest.cron_id;
  return { rest, jobId };
}

function parseCreateFields(raw: unknown): ScheduledTaskCreateToolFields | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const { rest, jobId } = stripJobId(raw as Record<string, unknown>);
  const picked: Record<string, unknown> = {};
  if ("name" in rest) picked.name = rest.name;
  if ("prompt" in rest) picked.prompt = rest.prompt;
  if ("schedule" in rest) picked.schedule = rest.schedule;
  if ("enabled" in rest) picked.enabled = rest.enabled;
  const parsed = parseScheduledTaskToolInput(picked);
  if (!parsed.ok) {
    return null;
  }
  return { input: parsed.data, jobId };
}

function rawFromUnknown(value: unknown): unknown {
  if (typeof value === "string" && value.trim()) {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  return value;
}

/**
 * Pull scheduled_task.create args off a harness tool_progress row.
 * Failed / non-create events return null (no stream).
 */
export function scheduledTaskCreateFromToolEvent(event: {
  type?: string;
  tool_name?: string;
  tool_label?: string;
  tool_status?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}): ScheduledTaskCreateToolFields | null {
  if (event.type !== "tool_progress") return null;
  if (isFailedToolStatus(event.tool_status)) return null;
  if (isFailedToolStatus(event.metadata?.tool_status)) return null;

  const name = toolNameOf(event);
  const nested =
    event.metadata?.scheduled_task ??
    event.metadata?.scheduled_task_create ??
    event.metadata?.cron_create;
  const looksLikeCreate =
    isHostCreateToolName(name) ||
    nested != null ||
    (typeof event.metadata?.op === "string" &&
      event.metadata.op === CRON_CREATE_TOOL_NAME);

  if (!looksLikeCreate) return null;

  if (nested) {
    const parsed = parseCreateFields(rawFromUnknown(nested));
    if (parsed) return parsed;
  }
  const parsedMeta = parseCreateFields(event.metadata);
  if (parsedMeta) return parsedMeta;
  if (typeof event.content === "string" && event.content.trim()) {
    return parseCreateFields(rawFromUnknown(event.content));
  }
  return null;
}

function hopIdempotencyKey(event: {
  tool_call_id?: string;
  metadata?: Record<string, unknown>;
  content?: string;
}): string | null {
  const callId =
    (typeof event.tool_call_id === "string" && event.tool_call_id.trim()) ||
    (typeof event.metadata?.tool_call_id === "string" &&
      event.metadata.tool_call_id.trim()) ||
    "";
  if (callId) return `call:${callId}`;
  return null;
}

export async function persistScheduledTaskCreate(input: {
  chat: ChatThreadStore;
  jobs?: BffScheduledJobStore | null;
  tenantId: string;
  userId: string;
  agentId?: string | null;
  fields: ScheduledTaskCreateToolFields;
}): Promise<ScheduledTaskCreateHopResult> {
  const name = input.fields.input.name;
  const existingId = input.fields.jobId?.trim() || "";

  if (!input.jobs) {
    return { ok: false, error: "scheduled task store is not configured" };
  }

  if (existingId) {
    const existingJob = await input.jobs.get(input.tenantId, existingId);
    if (existingJob) {
      try {
        const stream = ensureJobStreamChat(input.chat, {
          tenant_id: input.tenantId,
          user_id: input.userId,
          job_id: existingId,
          name: existingJob.name?.trim() || name,
          agent_id: input.agentId,
        });
        return {
          ok: true,
          job_id: existingId,
          name: stream.title,
          thread_id: stream.thread_id,
          created: stream.created,
          persisted: true,
        };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error ? error.message : "failed to bind job stream",
        };
      }
    }
  }

  const nowIso = new Date().toISOString();
  const jobId = existingId || newScheduledTaskJobId();
  let connectorBind: ReturnType<typeof bindScheduledTaskConnectorNeed>;
  try {
    connectorBind = bindScheduledTaskConnectorNeed({
      prompt: input.fields.input.prompt,
      user_id: input.userId,
    });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "invalid connector bind",
    };
  }

  const job: BffScheduledJob = {
    id: jobId,
    name,
    enabled: input.fields.input.enabled !== false,
    schedule: input.fields.input.schedule,
    prompt: input.fields.input.prompt,
    deliver: "portal_thread",
    path: BFF_VAULT_SCHEDULED_JOBS_PATH,
    tenant_id: input.tenantId,
    user_id: input.userId,
    ...(connectorBind.kind === "user_principal"
      ? {
          owner_user_id: connectorBind.owner_user_id,
          connector_ids: [...connectorBind.connector_ids],
        }
      : {}),
    created_at: nowIso,
    state: "scheduled",
    last_run_at: null,
    last_status: null,
    next_run_at: null,
  };

  let stored: BffScheduledJob;
  try {
    stored = await input.jobs.putJob(input.tenantId, job);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "failed to persist cron",
    };
  }

  try {
    const stream = ensureJobStreamChat(input.chat, {
      tenant_id: input.tenantId,
      user_id: input.userId,
      job_id: stored.id,
      name: stored.name,
      agent_id: input.agentId,
    });
    return {
      ok: true,
      job_id: stored.id,
      name: stored.name,
      thread_id: stream.thread_id,
      created: stream.created,
      persisted: true,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "failed to bind job stream",
    };
  }
}

export async function hopScheduledTaskFromHarnessEvent(input: {
  chat: ChatThreadStore;
  jobs?: BffScheduledJobStore | null;
  tenantId: string;
  userId: string;
  thread: ChatThread;
  event: {
    type?: string;
    content?: string;
    tool_name?: string;
    tool_label?: string;
    tool_status?: string;
    tool_call_id?: string;
    metadata?: Record<string, unknown>;
  };
  createdIds: Set<string>;
}): Promise<ScheduledTaskCreateHopResult | null> {
  const fields = scheduledTaskCreateFromToolEvent(input.event);
  if (!fields) return null;

  const idem =
    hopIdempotencyKey(input.event) ??
    `fields:${fields.input.name}:${fields.input.schedule}:${fields.input.prompt}`;
  if (input.createdIds.has(idem)) {
    return null;
  }

  const before = input.chat
    .listForOwner(input.tenantId, input.userId)
    .filter((row) => row.kind === "scheduled_task")
    .map((row) => row.thread_id);

  const result = await persistScheduledTaskCreate({
    chat: input.chat,
    jobs: input.jobs,
    tenantId: input.tenantId,
    userId: input.userId,
    agentId: input.thread.agent_id,
    fields,
  });

  if (!result.ok) {
    // Roll back any stream minted after a failed persist (should not happen).
    for (const row of input.chat.listForOwner(input.tenantId, input.userId)) {
      if (row.kind !== "scheduled_task") continue;
      if (before.includes(row.thread_id)) continue;
      try {
        input.chat.delete(row.thread_id);
      } catch {
        /* best-effort ghost subtract */
      }
    }
    return result;
  }

  input.createdIds.add(idem);
  return result;
}

export function stampScheduledTaskCreateMetadata(
  event: {
    metadata?: Record<string, unknown>;
  },
  result: ScheduledTaskCreateHopOk,
): Record<string, unknown> {
  return {
    ...(event.metadata ?? {}),
    inventory_mutated: true,
    scheduled_task: {
      id: result.job_id,
      job_id: result.job_id,
      name: result.name,
      thread_id: result.thread_id,
    },
  };
}
