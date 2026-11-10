import { parseThreadParticipants } from "./groupRoom.js";
import type {
  ChatThreadSummary,
  ThreadKind,
  ThreadSystemPromptSource,
  ThreadTitleSource,
} from "./types.js";

const TITLE_SOURCES: readonly ThreadTitleSource[] = [
  "default",
  "llm",
  "user",
  "job",
];

const SYSTEM_PROMPT_SOURCES: readonly ThreadSystemPromptSource[] = [
  "default",
  "llm",
  "user",
];

const THREAD_KINDS: readonly ThreadKind[] = [
  "chat",
  "scheduled_task",
  "group",
];

/**
 * Deterministic migration fallback when BFF has no avatar_seed (pre-lp-fn5.3.1
 * rows). Hash of thread_id only — never title — so rename does not re-skin.
 */
export function avatarSeedFromThreadId(threadId: string): string {
  let hash = 0;
  for (let i = 0; i < threadId.length; i++) {
    hash = (hash * 31 + threadId.charCodeAt(i)) >>> 0;
  }
  return `t${hash.toString(16)}`;
}

export function resolveAvatarSeed(
  thread: Pick<ChatThreadSummary, "thread_id" | "avatar_seed">,
): string {
  const raw = thread.avatar_seed;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return String(raw);
  }
  if (typeof raw === "string" && raw.trim()) {
    return raw.trim();
  }
  return avatarSeedFromThreadId(thread.thread_id);
}

function normalizeTitleSource(value: unknown): ThreadTitleSource {
  if (
    typeof value === "string" &&
    (TITLE_SOURCES as readonly string[]).includes(value)
  ) {
    return value as ThreadTitleSource;
  }
  return "default";
}

function normalizeSystemPromptSource(
  value: unknown,
): ThreadSystemPromptSource {
  if (
    typeof value === "string" &&
    (SYSTEM_PROMPT_SOURCES as readonly string[]).includes(value)
  ) {
    return value as ThreadSystemPromptSource;
  }
  return "default";
}

function normalizeSystemPrompt(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function normalizeThreadKind(value: unknown): ThreadKind {
  if (
    typeof value === "string" &&
    (THREAD_KINDS as readonly string[]).includes(value)
  ) {
    return value as ThreadKind;
  }
  return "chat";
}

function normalizeScheduledJobId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function normalizeAgentId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Normalize a wire thread row so UI can rely on avatar_seed + title_source +
 * job binding fields (lp-fn5.5.1) and system_prompt (lp-lv9.4).
 * Backfills missing seeds via thread_id hash.
 */
export function normalizeChatThreadSummary(
  raw: Partial<ChatThreadSummary> &
    Pick<ChatThreadSummary, "thread_id" | "title" | "created_at">,
): ChatThreadSummary {
  const thread_id = raw.thread_id;
  const seedPresent =
    (typeof raw.avatar_seed === "string" && raw.avatar_seed.trim() !== "") ||
    (typeof raw.avatar_seed === "number" && Number.isFinite(raw.avatar_seed));
  const scheduled_job_id = normalizeScheduledJobId(raw.scheduled_job_id);
  // Infer scheduled_task when a job binding is present but kind was omitted.
  const kind =
    scheduled_job_id && !raw.kind
      ? "scheduled_task"
      : normalizeThreadKind(raw.kind);

  return {
    thread_id,
    title: raw.title,
    project_id: raw.project_id ?? null,
    project_vault_path: raw.project_vault_path ?? null,
    created_at: raw.created_at,
    avatar_seed: seedPresent
      ? (raw.avatar_seed as string | number)
      : avatarSeedFromThreadId(thread_id),
    title_source: normalizeTitleSource(raw.title_source),
    kind,
    agent_id: normalizeAgentId(raw.agent_id),
    scheduled_job_id,
    system_prompt: normalizeSystemPrompt(raw.system_prompt),
    system_prompt_source: normalizeSystemPromptSource(
      raw.system_prompt_source,
    ),
    participants:
      kind === "group" ? parseThreadParticipants(raw.participants) : [],
    orchestrator_persona_id:
      kind === "group"
        ? normalizeAgentId(raw.orchestrator_persona_id)
        : null,
    access: raw.access,
    owner_user_id: raw.owner_user_id,
    grant_id: raw.grant_id,
  };
}
