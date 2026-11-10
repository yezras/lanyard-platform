import { apiFetch } from "./client.js";
import { normalizeChatThreadSummary } from "./threadMeta.js";
import type {
  ChatHistoryEvent,
  ChatThreadSummary,
  McqChoice,
  Project,
  StagingUploadRecord,
  ThreadKind,
  ThreadSystemPromptSource,
  ThreadTitleSource,
} from "./types.js";

export type CreateChatThreadInput = {
  projectId: string | null;
  projects: Project[];
};

export type CreateChatThreadResult = {
  thread_id: string;
  title: string;
  project_id: string | null;
  project_vault_path?: string | null;
  created_at: string;
  avatar_seed?: string | number;
  title_source?: ThreadTitleSource;
  kind?: ThreadKind;
  scheduled_job_id?: string | null;
  system_prompt?: string;
  system_prompt_source?: ThreadSystemPromptSource;
  /** Present when create used job ensure path (lp-fn5.5.1). */
  created?: boolean;
};

export type SendChatMessageInput = {
  threadId: string;
  text: string;
  stagingPaths?: string[];
};

export type SendMcqSelectionInput = {
  threadId: string;
  mcqId: string;
  choice: McqChoice;
  promptMessageId?: string;
};

export type UploadStagingFileInput = {
  file: File;
  projectVaultPath?: string;
};

/** Chat POST wake-failure body (lp-mrh). */
export type WakeFailureResponseBody = {
  error?: string;
  code?: string;
  message?: string;
  retryable?: boolean;
  retry_guidance?: string;
  phase?: string;
  cp_code?: string;
};

const WAKE_FAILURE_CODES = new Set([
  "wake_timeout",
  "daytona_unavailable",
  "vault_mount_failed",
  "wake_failed",
  "daytona_path_gated",
  "instance_revoked",
  "not_found",
  "not_implemented",
  "rate_limited",
  "invalid_argument",
  "forbidden",
  "unavailable",
  "ENSURE_ONLINE_TIMEOUT",
  "ENSURE_ONLINE_WAKE_FAILED",
  "ENSURE_ONLINE_ERROR",
]);

/**
 * Structured chat send failure (lp-mrh wake mapping + generic HTTP errors).
 * `isWakeFailure` is true when the body is an ensure_online / wake error.
 */
export class ChatSendError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly retryable?: boolean;
  readonly retryGuidance?: string;
  readonly phase?: string;
  readonly isWakeFailure: boolean;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string;
      retryable?: boolean;
      retryGuidance?: string;
      phase?: string;
      isWakeFailure?: boolean;
    },
  ) {
    super(message);
    this.name = "ChatSendError";
    this.status = options.status;
    this.code = options.code;
    this.retryable = options.retryable;
    this.retryGuidance = options.retryGuidance;
    this.phase = options.phase;
    this.isWakeFailure = Boolean(options.isWakeFailure);
  }
}

export function isWakeFailureResponseBody(
  body: unknown,
): body is WakeFailureResponseBody {
  if (!body || typeof body !== "object") {
    return false;
  }
  const rec = body as WakeFailureResponseBody;
  if (rec.phase === "ensure_online") {
    return true;
  }
  const code = typeof rec.code === "string" ? rec.code.trim() : "";
  if (code && WAKE_FAILURE_CODES.has(code)) {
    return true;
  }
  const err = typeof rec.error === "string" ? rec.error.trim() : "";
  if (err && WAKE_FAILURE_CODES.has(err)) {
    return true;
  }
  return false;
}

/** Prefer human `message` + `retry_guidance` over raw CP/BFF codes. */
export function formatWakeFailureDescription(body: {
  message?: string;
  error?: string;
  code?: string;
  retry_guidance?: string;
  retryGuidance?: string;
}): string {
  const primary =
    (typeof body.message === "string" && body.message.trim()) ||
    (typeof body.error === "string" && body.error.trim()) ||
    "The agent failed to start. Your message was not delivered.";
  const guidance =
    (typeof body.retry_guidance === "string" && body.retry_guidance.trim()) ||
    (typeof body.retryGuidance === "string" && body.retryGuidance.trim()) ||
    "";
  if (!guidance) {
    return primary;
  }
  if (primary.includes(guidance)) {
    return primary;
  }
  return `${primary} ${guidance}`;
}

/**
 * Map a non-OK messages POST body into ChatSendError (lp-6ty / lp-mrh).
 * Wake failures prefer human `message` + `retry_guidance` over raw codes.
 */
export function chatSendErrorFromResponse(
  status: number,
  body: unknown,
): ChatSendError {
  const rec =
    body && typeof body === "object"
      ? (body as WakeFailureResponseBody & { error?: string; message?: string })
      : {};
  if (isWakeFailureResponseBody(body)) {
    const description = formatWakeFailureDescription(rec);
    const code =
      (typeof rec.code === "string" && rec.code.trim()) ||
      (typeof rec.error === "string" && rec.error.trim()) ||
      undefined;
    return new ChatSendError(description, {
      status,
      code,
      retryable: rec.retryable,
      retryGuidance:
        typeof rec.retry_guidance === "string"
          ? rec.retry_guidance
          : undefined,
      phase:
        typeof rec.phase === "string" ? rec.phase : "ensure_online",
      isWakeFailure: true,
    });
  }
  const fallback =
    (typeof rec.error === "string" && rec.error.trim()) ||
    (typeof rec.message === "string" && rec.message.trim()) ||
    `Send failed (${status})`;
  return new ChatSendError(fallback, {
    status,
    code: typeof rec.code === "string" ? rec.code : undefined,
    isWakeFailure: false,
  });
}

export async function listChatThreads(): Promise<ChatThreadSummary[]> {
  const res = await apiFetch("/api/chat/threads");
  if (!res.ok) {
    throw new Error(`Failed to list threads (${res.status})`);
  }
  const body = (await res.json()) as {
    threads?: Array<
      Partial<ChatThreadSummary> &
        Pick<ChatThreadSummary, "thread_id" | "title" | "created_at">
    >;
  };
  return (body.threads ?? []).map((thread) =>
    normalizeChatThreadSummary(thread),
  );
}

export async function createChatThread(
  input: CreateChatThreadInput,
): Promise<CreateChatThreadResult> {
  const { projectId, projects } = input;
  const res = await apiFetch("/api/chat/threads", {
    method: "POST",
    body: JSON.stringify({
      title: projectId
        ? projects.find((project) => project.project_id === projectId)?.name
        : "New chat",
      project_id: projectId ?? undefined,
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to create thread (${res.status})`);
  }
  const raw = (await res.json()) as CreateChatThreadResult;
  const normalized = normalizeChatThreadSummary({
    thread_id: raw.thread_id,
    title: raw.title || "New chat",
    project_id: raw.project_id ?? null,
    project_vault_path: raw.project_vault_path ?? null,
    created_at: raw.created_at || new Date().toISOString(),
    avatar_seed: raw.avatar_seed,
    title_source: raw.title_source,
    kind: raw.kind,
    scheduled_job_id: raw.scheduled_job_id,
    system_prompt: raw.system_prompt,
    system_prompt_source: raw.system_prompt_source,
  });
  return {
    ...raw,
    title: normalized.title,
    project_id: normalized.project_id,
    project_vault_path: normalized.project_vault_path,
    created_at: normalized.created_at,
    avatar_seed: normalized.avatar_seed,
    title_source: normalized.title_source,
    kind: normalized.kind,
    scheduled_job_id: normalized.scheduled_job_id,
    system_prompt: normalized.system_prompt,
    system_prompt_source: normalized.system_prompt_source,
  };
}

/**
 * Idempotent ensure of the durable scheduled-task stream for a job (lp-fn5.5.1).
 * Same job_id for the session owner always returns the same thread_id.
 */
export type EnsureAgentChatForJobResult = ChatThreadSummary & {
  created: boolean;
};

export async function ensureAgentChatForJob(input: {
  jobId: string;
  name: string;
  /** Durable agent this job runs as (lp-cxhb.11). */
  agentId?: string | null;
}): Promise<EnsureAgentChatForJobResult> {
  const agentId = input.agentId?.trim();
  const res = await apiFetch("/api/chat/threads/ensure-for-job", {
    method: "POST",
    body: JSON.stringify({
      job_id: input.jobId,
      name: input.name,
      ...(agentId ? { agent_id: agentId } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to ensure job chat (${res.status})`);
  }
  const raw = (await res.json()) as Partial<ChatThreadSummary> &
    Pick<ChatThreadSummary, "thread_id" | "title" | "created_at"> & {
      created?: boolean;
    };
  const normalized = normalizeChatThreadSummary(raw);
  return {
    ...normalized,
    created: Boolean(raw.created),
  };
}

export async function updateChatThreadTitle(input: {
  threadId: string;
  title: string;
  /** Pass `user` for explicit renames so LLM auto-name will not overwrite. */
  titleSource?: ThreadTitleSource;
}): Promise<ChatThreadSummary> {
  const res = await apiFetch(`/api/chat/threads/${input.threadId}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: input.title,
      ...(input.titleSource ? { title_source: input.titleSource } : {}),
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to update thread title (${res.status})`);
  }
  const raw = (await res.json()) as Partial<ChatThreadSummary> &
    Pick<ChatThreadSummary, "thread_id" | "title" | "created_at">;
  return normalizeChatThreadSummary(raw);
}

/**
 * Update per-thread system / purpose prompt (lp-lv9.4).
 * Header editor save should pass `systemPromptSource: "user"`.
 */
export async function updateChatThreadSystemPrompt(input: {
  threadId: string;
  systemPrompt: string;
  systemPromptSource?: ThreadSystemPromptSource;
}): Promise<ChatThreadSummary> {
  const res = await apiFetch(`/api/chat/threads/${input.threadId}`, {
    method: "PATCH",
    body: JSON.stringify({
      system_prompt: input.systemPrompt,
      system_prompt_source: input.systemPromptSource ?? "user",
    }),
  });
  if (!res.ok) {
    throw new Error(`Failed to update system prompt (${res.status})`);
  }
  const raw = (await res.json()) as Partial<ChatThreadSummary> &
    Pick<ChatThreadSummary, "thread_id" | "title" | "created_at">;
  return normalizeChatThreadSummary(raw);
}

/**
 * Request LLM/fixture agent display name (lp-fn5.3.4).
 * BFF only applies when title_source is default|llm — never overwrites user.
 */
export type AssignChatThreadNameResult = ChatThreadSummary & {
  applied: boolean;
  name_source: "host" | "fixture" | null;
  skipped_reason: "title_source" | null;
};

export async function assignChatThreadName(input: {
  threadId: string;
  /** First user message (context for short name). */
  message?: string;
}): Promise<AssignChatThreadNameResult> {
  const res = await apiFetch(
    `/api/chat/threads/${input.threadId}/assign-name`,
    {
      method: "POST",
      body: JSON.stringify({
        message: input.message ?? "",
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Failed to assign agent name (${res.status})`);
  }
  const raw = (await res.json()) as Partial<ChatThreadSummary> &
    Pick<ChatThreadSummary, "thread_id" | "title" | "created_at"> & {
      applied?: boolean;
      name_source?: "host" | "fixture" | null;
      skipped_reason?: "title_source" | null;
    };
  const summary = normalizeChatThreadSummary(raw);
  return {
    ...summary,
    applied: Boolean(raw.applied),
    name_source: raw.name_source ?? null,
    skipped_reason: raw.skipped_reason ?? null,
  };
}

/**
 * Request LLM/fixture purpose prompt after 1–2 turns (lp-lv9.4).
 * BFF only applies when system_prompt_source is still default — never user.
 */
export type AssignChatThreadSystemPromptResult = ChatThreadSummary & {
  applied: boolean;
  prompt_source: "host" | "fixture" | null;
  skipped_reason: "system_prompt_source" | "kind" | "turn_count" | null;
};

export async function assignChatThreadSystemPrompt(input: {
  threadId: string;
  /** Early user messages for purpose context. */
  messages?: string[];
  message?: string;
}): Promise<AssignChatThreadSystemPromptResult> {
  const res = await apiFetch(
    `/api/chat/threads/${input.threadId}/assign-system-prompt`,
    {
      method: "POST",
      body: JSON.stringify({
        ...(input.messages ? { messages: input.messages } : {}),
        ...(input.message !== undefined ? { message: input.message } : {}),
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Failed to assign system prompt (${res.status})`);
  }
  const raw = (await res.json()) as Partial<ChatThreadSummary> &
    Pick<ChatThreadSummary, "thread_id" | "title" | "created_at"> & {
      applied?: boolean;
      prompt_source?: "host" | "fixture" | null;
      skipped_reason?: "system_prompt_source" | "kind" | "turn_count" | null;
    };
  const summary = normalizeChatThreadSummary(raw);
  return {
    ...summary,
    applied: Boolean(raw.applied),
    prompt_source: raw.prompt_source ?? null,
    skipped_reason: raw.skipped_reason ?? null,
  };
}

export async function deleteChatThread(threadId: string): Promise<void> {
  const res = await apiFetch(`/api/chat/threads/${threadId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(
      body.error ?? body.message ?? `Failed to delete thread (${res.status})`,
    );
  }
}

export type SendChatMessageResult = {
  agentStarting: boolean;
  message?: string;
};

/**
 * Fire-and-forget wake when the user opens /chat (lp-vqr0.9 / T7).
 * Joins BFF singleflight with Send. Errors are the caller's to ignore.
 */
export async function kickSpeculativeEnsureOnline(): Promise<void> {
  const res = await apiFetch("/api/chat/ensure-online", {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    throw new Error(`Speculative ensure_online failed (${res.status})`);
  }
}

export async function sendChatMessage(
  input: SendChatMessageInput,
): Promise<SendChatMessageResult> {
  const { threadId, text, stagingPaths } = input;
  const res = await apiFetch(`/api/chat/threads/${threadId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      text,
      staging_paths: stagingPaths?.length ? stagingPaths : undefined,
    }),
  });
  // 202 agent_starting (lp-vqr0.8) means the wake continues on the BFF.
  // The client waits on SSE agent_ready / error. res.ok is true for 202.
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw chatSendErrorFromResponse(res.status, body);
  }
  if (res.status === 202) {
    const body = (await res.json().catch(() => ({}))) as {
      status?: string;
      message?: string;
    };
    if (body.status === "agent_starting") {
      return {
        agentStarting: true,
        ...(typeof body.message === "string" && body.message.trim()
          ? { message: body.message.trim() }
          : {}),
      };
    }
  }
  return { agentStarting: false };
}

/** Stop an in-flight Hermes turn (portal spinner click ≈ CLI Esc). */
export async function cancelChatRequest(threadId: string): Promise<void> {
  const res = await apiFetch(`/api/chat/threads/${threadId}/cancel`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(
      body.error ?? body.message ?? `Cancel failed (${res.status})`,
    );
  }
}

/** Halt: abort in-flight turns and freeze wakes until Jack speaks. */
export async function haltMailboxRoom(threadId: string): Promise<void> {
  const res = await apiFetch(`/api/chat/threads/${threadId}/mailbox/halt`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(
      body.error ?? body.message ?? `Halt failed (${res.status})`,
    );
  }
}

/**
 * Durable transcript for a thread (user + assistant + tools/citations).
 * Used to hydrate the timeline after a hard reload when the session cache is empty.
 */
export async function fetchThreadHistory(
  threadId: string,
): Promise<ChatHistoryEvent[]> {
  const res = await apiFetch(`/api/chat/threads/${threadId}/history`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    throw new Error(
      body.error ?? body.message ?? `Failed to load history (${res.status})`,
    );
  }
  const body = (await res.json()) as { events?: ChatHistoryEvent[] };
  return body.events ?? [];
}

export async function sendMcqSelection(
  input: SendMcqSelectionInput,
): Promise<void> {
  const { threadId, mcqId, choice, promptMessageId } = input;
  const res = await apiFetch(`/api/chat/threads/${threadId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      mcq_selection: {
        mcq_id: mcqId,
        choice_id: choice.id,
        label: choice.label,
        prompt_message_id: promptMessageId,
      },
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Send failed (${res.status})`);
  }
}

export async function uploadStagingFile(
  input: UploadStagingFileInput,
): Promise<StagingUploadRecord> {
  const form = new FormData();
  form.append("file", input.file);
  if (input.projectVaultPath) {
    form.append("project_vault_path", input.projectVaultPath);
  }
  const res = await apiFetch("/api/staging/upload", {
    method: "POST",
    body: form,
  });
  const body = (await res.json()) as StagingUploadRecord & { error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? `Upload failed (${res.status})`);
  }
  return body;
}