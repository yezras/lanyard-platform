import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  createAgent,
  renameAgent,
  threadSummaryFromDurableAgent,
} from "../../api/agents.js";
import { deleteChannel } from "../../api/channels.js";
import {
  assignChatThreadName,
  assignChatThreadSystemPrompt,
  createChatThread,
  deleteChatThread,
  ensureAgentChatForJob,
  listChatThreads,
  updateChatThreadSystemPrompt,
  updateChatThreadTitle,
} from "../../api/chat.js";
import {
  createProject as createProjectApi,
  deleteProject as deleteProjectApi,
  type CreateProjectInput,
} from "../../api/projects.js";
import { fetchSettingsSnapshot } from "../../api/settings.js";
import { normalizeChatThreadSummary } from "../../api/threadMeta.js";
import type { ChatThreadSummary, Project } from "../../api/types.js";
import { useProjects, type ProjectsState } from "../../hooks/useProjects.js";

import { invalidateVaultTree } from "../vault/vaultTreeEvents.js";
import {
  ensureAgentChatsForHostCrons,
  mergeEnsuredJobStreams,
} from "./ensureHostCronStreams.js";
import {
  groupThreadsForSideNav,
  isChannelThread,
  type ThreadProjectGroup,
} from "./threadGroups.js";
import type { ThreadResponseStatus } from "./threadResponseStatus.js";

export type ChatThreadContextValue = {
  threadId: string | null;
  /**
   * Default project for the next "New chat". While a thread is open, the
   * composer project chip should prefer the active thread's project_id
   * (directory binds threads); use selectProject to switch and rebind.
   */
  selectedProjectId: string | null;
  /** Set default project for next new chat only (does not rebind active thread). */
  setSelectedProjectId: (projectId: string | null) => void;
  /**
   * Switch working project: set default + create a new thread bound to that
   * project so chip, thread.project_id, and Hermes cwd stay aligned.
   */
  selectProject: (projectId: string | null) => Promise<void>;
  /**
   * Plus menu → Agent (lp-cxhb.4). Writes a catalog row and opens that
   * person's one persistent 1:1. Never clones an existing agent.
   */
  startNewThread: () => Promise<void>;
  /**
   * After wizard cron create: ensure the durable job stream, merge it into the
   * sidenav list, select it, and bump {@link scheduledTasksFolderExpandRequestId}
   * so the Scheduled Tasks folder expands (lp-lv9.7). Best-effort — returns
   * null if ensure fails (create itself already succeeded).
   *
   * When `instructions` is provided and the stream purpose is still empty /
   * default, seeds `system_prompt` from job instructions with source=`llm`
   * (lp-pxr.3). Does not overwrite user-edited purpose.
   */
  ensureAndSelectJobStream: (input: {
    jobId: string;
    name: string;
    /** Job prompt / instructions to seed as thread purpose when empty. */
    instructions?: string | null;
    /** Durable agent this job runs as (lp-cxhb.11). */
    agentId?: string | null;
  }) => Promise<ChatThreadSummary | null>;
  /**
   * Monotonic id bumped when a newly created job stream should be shown under
   * an expanded Scheduled Tasks folder (lp-lv9.7).
   */
  scheduledTasksFolderExpandRequestId: number;
  selectThread: (threadId: string) => void;
  /**
   * Explicit user rename (sidebar / chat header). Agent 1:1s PATCH the
   * catalog (lp-v62i.22); other threads PATCH title_source=user so LLM
   * auto-name will not overwrite (lp-fn5.3.3).
   */
  renameThread: (threadId: string, title: string) => Promise<void>;
  /**
   * After the first user message, refine the LLM/fixture agent name when
   * title_source is still default|llm (lp-fn5.3.4 / lp-lv9.3). No-ops when
   * title_source is user|job or refine already ran this session.
   */
  renameThreadFromFirstMessage: (text: string) => Promise<void>;
  /**
   * Persist per-thread system / purpose prompt from the header editor (lp-lv9.4).
   * Sets system_prompt_source=user so auto-generate will not overwrite.
   */
  updateThreadSystemPrompt: (
    threadId: string,
    systemPrompt: string,
  ) => Promise<void>;
  /**
   * After 1–2 interactive turns, request LLM/fixture purpose summary (lp-lv9.4).
   * No-ops when source is user|llm, kind is scheduled_task, or already attempted.
   */
  maybeAssignSystemPromptFromTurns: (messages?: string[]) => Promise<void>;
  createProject: (input: CreateProjectInput) => Promise<Project | null>;
  /** Soft-delete (archive) an agent project on the host. */
  deleteProject: (projectId: string) => Promise<boolean>;
  deleteThread: (threadId: string) => Promise<void>;
  threads: ChatThreadSummary[];
  threadGroups: ThreadProjectGroup[];
  refreshThreads: () => Promise<ChatThreadSummary[]>;
  statusMessage: string | null;
  isCreatingThread: boolean;
  isLoadingThreads: boolean;
  isCreatingProject: boolean;
  projects: Project[];
  projectsStatus: ProjectsState["status"];
  /** Session-local response status per thread (sidebar StatusDot). */
  threadResponseStatuses: Readonly<Record<string, ThreadResponseStatus>>;
  setThreadResponseStatus: (
    threadId: string,
    status: ThreadResponseStatus,
  ) => void;
  /**
   * Session-local latest user/assistant text per thread for SideNav subtitle
   * (lp-lv9.3). Truncation happens in AgentSideNavRow — no model call.
   */
  threadActivityPreviews: Readonly<Record<string, string>>;
  setThreadActivityPreview: (threadId: string, preview: string) => void;
};

const ChatThreadContext = createContext<ChatThreadContextValue | null>(null);

function toSummaryFromCreate(
  result: Awaited<ReturnType<typeof createChatThread>>,
  projectId: string | null,
): ChatThreadSummary {
  return normalizeChatThreadSummary({
    thread_id: result.thread_id,
    title: result.title || "New chat",
    project_id: result.project_id ?? projectId,
    project_vault_path: result.project_vault_path ?? null,
    created_at: result.created_at || new Date().toISOString(),
    avatar_seed: result.avatar_seed,
    title_source: result.title_source,
    access: "owner",
  });
}

export function ChatThreadProvider({ children }: { children: ReactNode }) {
  const projectsState = useProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<ChatThreadSummary[]>([]);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isCreatingThread, setIsCreatingThread] = useState(false);
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [isLoadingThreads, setIsLoadingThreads] = useState(true);
  const [scheduledTasksFolderExpandRequestId, setScheduledTasksFolderExpandRequestId] =
    useState(0);
  const [threadResponseStatuses, setThreadResponseStatuses] = useState<
    Record<string, ThreadResponseStatus>
  >({});
  const [threadActivityPreviews, setThreadActivityPreviews] = useState<
    Record<string, string>
  >({});
  const initialThreadRef = useRef(false);
  /** Explicit user renames — assign-name must never overwrite. */
  const stickyTitleThreadIdsRef = useRef(new Set<string>());
  /** First-message refine already attempted for this thread (session). */
  const firstMessageNameRefinedRef = useRef(new Set<string>());
  const hostCronStreamsEnsuredRef = useRef(false);
  /** Threads that already attempted purpose auto-assign / seed this session. */
  const systemPromptAssignedIdsRef = useRef(new Set<string>());

  const setThreadResponseStatus = useCallback(
    (id: string, status: ThreadResponseStatus) => {
      setThreadResponseStatuses((current) => {
        if (current[id] === status) {
          return current;
        }
        return { ...current, [id]: status };
      });
    },
    [],
  );

  const setThreadActivityPreview = useCallback(
    (id: string, preview: string) => {
      const next = preview.trim().replace(/\s+/g, " ");
      if (!id || !next) {
        return;
      }
      setThreadActivityPreviews((current) => {
        if (current[id] === next) {
          return current;
        }
        return { ...current, [id]: next };
      });
    },
    [],
  );

  /**
   * Apply an assign-name result into the thread list when still overwritable.
   * Bootstrap results only win while title_source is still default (race guard).
   */
  const applyAssignedName = useCallback(
    (
      id: string,
      result: Awaited<ReturnType<typeof assignChatThreadName>>,
      phase: "bootstrap" | "refine",
    ) => {
      if (!result.applied) {
        return;
      }
      setThreads((list) =>
        list.map((thread) => {
          if (thread.thread_id !== id) {
            return thread;
          }
          if (
            thread.title_source === "user" ||
            thread.title_source === "job"
          ) {
            return thread;
          }
          if (phase === "bootstrap" && thread.title_source !== "default") {
            return thread;
          }
          return {
            ...thread,
            title: result.title,
            title_source: result.title_source,
            avatar_seed: result.avatar_seed ?? thread.avatar_seed,
          };
        }),
      );
    },
    [],
  );

  /** Eager LLM/fixture name on interactive create (lp-lv9.3). */
  const fireEagerAssignName = useCallback(
    (id: string) => {
      void (async () => {
        try {
          const result = await assignChatThreadName({
            threadId: id,
            message: "",
          });
          applyAssignedName(id, result, "bootstrap");
        } catch {
          // Leave temporary "New chat" / project title; first message can refine.
        }
      })();
    },
    [applyAssignedName],
  );

  const refreshThreads = useCallback(async () => {
    const list = await listChatThreads();
    setThreads(list);
    return list;
  }, []);

  const createThread = useCallback(
    async (projectId: string | null) => {
      setIsCreatingThread(true);
      try {
        const result = await createChatThread({
          projectId,
          projects: projectsState.projects,
        });
        const summary = toSummaryFromCreate(result, projectId);
        setThreads((current) => [
          summary,
          ...current.filter((thread) => thread.thread_id !== summary.thread_id),
        ]);
        setThreadId(summary.thread_id);
        // Eager name without waiting for first message (interactive chats only).
        fireEagerAssignName(summary.thread_id);
        if (result.project_vault_path) {
          setStatusMessage(
            `Chat bound to working directory ${result.project_vault_path}`,
          );
        } else {
          setStatusMessage(null);
        }
        return summary;
      } catch (error) {
        setStatusMessage(
          error instanceof Error
            ? error.message
            : "Failed to create chat thread",
        );
        return null;
      } finally {
        setIsCreatingThread(false);
      }
    },
    [fireEagerAssignName, projectsState.projects],
  );

  useEffect(() => {
    if (projectsState.status !== "ready" || initialThreadRef.current) {
      return;
    }
    initialThreadRef.current = true;

    void (async () => {
      setIsLoadingThreads(true);
      try {
        const list = await listChatThreads();
        setThreads(list);
        if (list.length > 0) {
          const first = list[0];
          setThreadId(first.thread_id);
          setSelectedProjectId(first.project_id);
        } else {
          await createThread(null);
        }
      } catch {
        await createThread(null);
      } finally {
        setIsLoadingThreads(false);
      }
    })();
  }, [projectsState.status, createThread]);

  /**
   * lp-lv9.1: host cron inventory is SoT for Scheduled Tasks streams.
   * After Agents shell threads load, ensure a job-stream row for every host
   * cron (idempotent). Failures are best-effort and never block the shell.
   */
  useEffect(() => {
    if (isLoadingThreads || hostCronStreamsEnsuredRef.current) {
      return;
    }
    hostCronStreamsEnsuredRef.current = true;

    void (async () => {
      try {
        const snapshot = await fetchSettingsSnapshot();
        const ensured = await ensureAgentChatsForHostCrons(
          snapshot.crons ?? [],
          ensureAgentChatForJob,
        );
        if (ensured.length === 0) {
          return;
        }
        setThreads((current) => mergeEnsuredJobStreams(current, ensured));
      } catch {
        // Snapshot / ensure is best-effort; folder still renders empty.
      }
    })();
  }, [isLoadingThreads]);

  const startNewThread = useCallback(async () => {
    setThreadId(null);
    setIsCreatingThread(true);
    try {
      const agent = await createAgent({});
      const summary = threadSummaryFromDurableAgent(agent);
      setThreads((current) => [
        summary,
        ...current.filter((thread) => thread.thread_id !== summary.thread_id),
      ]);
      setThreadId(summary.thread_id);
      fireEagerAssignName(summary.thread_id);
      setStatusMessage(null);
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Failed to create agent",
      );
    } finally {
      setIsCreatingThread(false);
    }
  }, [fireEagerAssignName]);

  /**
   * Post-wizard create navigation (lp-lv9.7): ensure job stream, upsert into
   * the Agents sidenav, select it, and request Scheduled Tasks folder expand.
   * Failures are best-effort — the cron already exists.
   *
   * lp-pxr.3: when `instructions` is non-empty and the stream purpose is still
   * empty/default, seed system_prompt from job instructions (source=llm so a
   * later user edit can still take ownership).
   */
  const ensureAndSelectJobStream = useCallback(
    async (input: {
      jobId: string;
      name: string;
      instructions?: string | null;
      agentId?: string | null;
    }): Promise<ChatThreadSummary | null> => {
      const jobId = input.jobId.trim();
      const name =
        typeof input.name === "string" && input.name.trim().length > 0
          ? input.name.trim()
          : jobId;
      if (!jobId) {
        return null;
      }
      const agentId =
        input.agentId?.trim() ||
        threads.find((thread) => thread.thread_id === threadId)?.agent_id?.trim() ||
        null;
      try {
        let stream = await ensureAgentChatForJob({
          jobId,
          name,
          ...(agentId ? { agentId } : {}),
        });
        const seed =
          typeof input.instructions === "string"
            ? input.instructions.trim()
            : "";
        const currentPrompt =
          typeof stream.system_prompt === "string"
            ? stream.system_prompt.trim()
            : "";
        const source = stream.system_prompt_source ?? "default";
        // Seed only when purpose is empty and still default (not user/llm).
        if (
          seed &&
          !currentPrompt &&
          (source === "default" || source === undefined)
        ) {
          try {
            const updated = await updateChatThreadSystemPrompt({
              threadId: stream.thread_id,
              systemPrompt: seed,
              systemPromptSource: "llm",
            });
            stream = {
              ...stream,
              ...updated,
              created: stream.created,
            };
            systemPromptAssignedIdsRef.current.add(stream.thread_id);
          } catch {
            // Best-effort seed — stream select still proceeds.
          }
        }
        setThreads((current) => mergeEnsuredJobStreams(current, [stream]));
        setThreadId(stream.thread_id);
        setSelectedProjectId(stream.project_id ?? null);
        setStatusMessage(null);
        setScheduledTasksFolderExpandRequestId((id) => id + 1);
        return stream;
      } catch {
        return null;
      }
    },
    [threadId, threads],
  );

  /**
   * Project picker / explicit project switch: bind a fresh thread to the
   * chosen project so messages run with that project's primary_path (cwd).
   * No-ops when the active thread is already bound to the same project.
   */
  const selectProject = useCallback(
    async (projectId: string | null) => {
      setSelectedProjectId(projectId);
      const active = threads.find((item) => item.thread_id === threadId);
      if (
        active &&
        (active.project_id ?? null) === (projectId ?? null)
      ) {
        return;
      }
      setThreadId(null);
      await createThread(projectId);
      setStatusMessage(null);
    },
    [createThread, threadId, threads],
  );

  const selectThread = useCallback(
    (nextThreadId: string) => {
      const thread = threads.find((item) => item.thread_id === nextThreadId);
      if (!thread) {
        return;
      }
      setThreadId(thread.thread_id);
      setSelectedProjectId(thread.project_id);
      setStatusMessage(null);
    },
    [threads],
  );

  const renameThread = useCallback(
    async (id: string, rawTitle: string) => {
      const title = rawTitle.trim();
      if (!id || !title) {
        return;
      }
      // Snapshot prior from current list (stable for optimistic rollback).
      const prior = threads.find((thread) => thread.thread_id === id);
      if (!prior) {
        return;
      }
      const agentId =
        prior.kind !== "group" &&
        prior.kind !== "scheduled_task" &&
        prior.agent_id?.trim()
          ? prior.agent_id.trim()
          : "";
      const snapshot = threads;
      // User renames win over eager / first-message auto-title.
      stickyTitleThreadIdsRef.current.add(id);
      setThreads((current) =>
        current.map((thread) => {
          if (thread.thread_id === id) {
            return { ...thread, title, title_source: "user" as const };
          }
          if (
            !agentId ||
            thread.kind !== "group" ||
            !thread.participants?.length
          ) {
            return thread;
          }
          return {
            ...thread,
            participants: thread.participants.map((participant) =>
              participant.kind === "persona" &&
              participant.persona_id === agentId
                ? { ...participant, display_name: title }
                : participant,
            ),
          };
        }),
      );
      try {
        if (agentId) {
          const updated = await renameAgent({ agentId, name: title });
          setThreads((current) =>
            current.map((thread) => {
              if (thread.thread_id === updated.thread_id) {
                return {
                  ...thread,
                  title: updated.name,
                  title_source: "user" as const,
                };
              }
              if (
                thread.kind !== "group" ||
                !thread.participants?.length
              ) {
                return thread;
              }
              return {
                ...thread,
                participants: thread.participants.map((participant) =>
                  participant.kind === "persona" &&
                  participant.persona_id === agentId
                    ? { ...participant, display_name: updated.name }
                    : participant,
                ),
              };
            }),
          );
          return;
        }
        const updated = await updateChatThreadTitle({
          threadId: id,
          title,
          titleSource: "user",
        });
        setThreads((current) =>
          current.map((thread) =>
            thread.thread_id === id ? { ...thread, ...updated } : thread,
          ),
        );
      } catch (error) {
        setThreads(snapshot);
        setStatusMessage(
          error instanceof Error ? error.message : "Failed to rename agent",
        );
      }
    },
    [threads],
  );

  const renameThreadFromFirstMessage = useCallback(
    async (text: string) => {
      if (!threadId || stickyTitleThreadIdsRef.current.has(threadId)) {
        return;
      }
      if (firstMessageNameRefinedRef.current.has(threadId)) {
        return;
      }
      const current = threads.find((thread) => thread.thread_id === threadId);
      // Never overwrite explicit user renames or scheduled-job stream titles.
      if (
        current?.title_source === "user" ||
        current?.title_source === "job"
      ) {
        stickyTitleThreadIdsRef.current.add(threadId);
        return;
      }
      // Refine only while still system-owned (default or prior llm bootstrap).
      if (
        current &&
        current.title_source !== "default" &&
        current.title_source !== "llm"
      ) {
        return;
      }
      firstMessageNameRefinedRef.current.add(threadId);
      // Keep latest user text as SideNav subtitle preview (no model call).
      setThreadActivityPreview(threadId, text);
      try {
        const result = await assignChatThreadName({
          threadId,
          message: text,
        });
        applyAssignedName(threadId, result, "refine");
      } catch {
        // Leave bootstrap / temporary title; user can rename later.
      }
    },
    [applyAssignedName, setThreadActivityPreview, threadId, threads],
  );

  const updateThreadSystemPrompt = useCallback(
    async (id: string, systemPrompt: string) => {
      const prior = threads.find((thread) => thread.thread_id === id);
      if (!prior) {
        return;
      }
      systemPromptAssignedIdsRef.current.add(id);
      setThreads((current) =>
        current.map((thread) =>
          thread.thread_id === id
            ? {
                ...thread,
                system_prompt: systemPrompt,
                system_prompt_source: "user" as const,
              }
            : thread,
        ),
      );
      try {
        const updated = await updateChatThreadSystemPrompt({
          threadId: id,
          systemPrompt,
          systemPromptSource: "user",
        });
        setThreads((current) =>
          current.map((thread) =>
            thread.thread_id === id ? { ...thread, ...updated } : thread,
          ),
        );
      } catch (error) {
        setThreads((current) =>
          current.map((thread) =>
            thread.thread_id === id ? prior : thread,
          ),
        );
        setStatusMessage(
          error instanceof Error
            ? error.message
            : "Failed to update system prompt",
        );
      }
    },
    [threads],
  );

  const maybeAssignSystemPromptFromTurns = useCallback(
    async (messages?: string[]) => {
      if (!threadId || systemPromptAssignedIdsRef.current.has(threadId)) {
        return;
      }
      const current = threads.find((thread) => thread.thread_id === threadId);
      // Interactive only; never overwrite user or prior llm purpose.
      if (
        !current ||
        current.kind === "scheduled_task" ||
        current.kind === "group" ||
        current.system_prompt_source === "user" ||
        current.system_prompt_source === "llm"
      ) {
        if (
          current?.system_prompt_source === "user" ||
          current?.system_prompt_source === "llm"
        ) {
          systemPromptAssignedIdsRef.current.add(threadId);
        }
        return;
      }
      systemPromptAssignedIdsRef.current.add(threadId);
      try {
        const result = await assignChatThreadSystemPrompt({
          threadId,
          messages,
          message: messages?.[0],
        });
        if (!result.applied) {
          // Allow retry later when turn_count was the skip reason.
          if (result.skipped_reason === "turn_count") {
            systemPromptAssignedIdsRef.current.delete(threadId);
          }
          return;
        }
        setThreads((list) =>
          list.map((thread) =>
            thread.thread_id === threadId
              ? {
                  ...thread,
                  system_prompt: result.system_prompt,
                  system_prompt_source: result.system_prompt_source,
                }
              : thread,
          ),
        );
      } catch {
        // Soft-fail; purpose can be edited manually later.
        systemPromptAssignedIdsRef.current.delete(threadId);
      }
    },
    [threadId, threads],
  );

  const refreshProjects = projectsState.refresh;

  const createProject = useCallback(
    async (input: CreateProjectInput) => {
      setIsCreatingProject(true);
      try {
        const project = await createProjectApi(input);
        await refreshProjects();
        setSelectedProjectId(project.project_id);
        // Host mkdir'd the vault folder — refresh Vault tree now.
        invalidateVaultTree();
        // Auto-open a thread bound to the new project so cwd/chip match.
        setThreadId(null);
        await createThread(project.project_id);
        setStatusMessage(`Created project ${project.name}`);
        return project;
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : "Failed to create project",
        );
        return null;
      } finally {
        setIsCreatingProject(false);
      }
    },
    [createThread, refreshProjects],
  );

  const deleteProject = useCallback(
    async (projectId: string) => {
      try {
        await deleteProjectApi(projectId);
        if (selectedProjectId === projectId) {
          setSelectedProjectId(null);
        }
        await refreshProjects();
        invalidateVaultTree();
        setStatusMessage("Project deleted");
        return true;
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : "Failed to delete project",
        );
        return false;
      }
    },
    [refreshProjects, selectedProjectId],
  );

  const deleteThread = useCallback(
    async (threadIdToDelete: string) => {
      const target = threads.find(
        (thread) => thread.thread_id === threadIdToDelete,
      );
      try {
        if (target && isChannelThread(target)) {
          await deleteChannel(threadIdToDelete);
        } else {
          await deleteChatThread(threadIdToDelete);
        }
      } catch (error) {
        setStatusMessage(
          error instanceof Error ? error.message : "Failed to delete chat",
        );
        return;
      }

      stickyTitleThreadIdsRef.current.delete(threadIdToDelete);
      firstMessageNameRefinedRef.current.delete(threadIdToDelete);
      systemPromptAssignedIdsRef.current.delete(threadIdToDelete);
      setThreadResponseStatuses((current) => {
        if (!(threadIdToDelete in current)) {
          return current;
        }
        const next = { ...current };
        delete next[threadIdToDelete];
        return next;
      });
      setThreadActivityPreviews((current) => {
        if (!(threadIdToDelete in current)) {
          return current;
        }
        const next = { ...current };
        delete next[threadIdToDelete];
        return next;
      });
      const remaining = threads.filter(
        (thread) => thread.thread_id !== threadIdToDelete,
      );
      setThreads(remaining);

      if (threadId === threadIdToDelete) {
        if (remaining.length > 0) {
          const next = remaining[0];
          setThreadId(next.thread_id);
          setSelectedProjectId(next.project_id);
          setStatusMessage("Chat deleted.");
        } else {
          setThreadId(null);
          await createThread(selectedProjectId);
          setStatusMessage("Chat deleted. Started a new chat.");
        }
      } else {
        setStatusMessage("Chat deleted.");
      }
    },
    [threads, threadId, createThread, selectedProjectId],
  );

  const threadGroups = useMemo(
    () => groupThreadsForSideNav(threads),
    [threads],
  );

  const value = useMemo(
    () => ({
      threadId,
      selectedProjectId,
      setSelectedProjectId,
      selectProject,
      startNewThread,
      ensureAndSelectJobStream,
      scheduledTasksFolderExpandRequestId,
      selectThread,
      renameThread,
      renameThreadFromFirstMessage,
      updateThreadSystemPrompt,
      maybeAssignSystemPromptFromTurns,
      createProject,
      deleteProject,
      deleteThread,
      threads,
      threadGroups,
      refreshThreads,
      statusMessage,
      isCreatingThread,
      isLoadingThreads,
      isCreatingProject,
      projects: projectsState.projects,
      projectsStatus: projectsState.status,
      threadResponseStatuses,
      setThreadResponseStatus,
      threadActivityPreviews,
      setThreadActivityPreview,
    }),
    [
      threadId,
      selectedProjectId,
      selectProject,
      startNewThread,
      ensureAndSelectJobStream,
      scheduledTasksFolderExpandRequestId,
      selectThread,
      renameThread,
      renameThreadFromFirstMessage,
      updateThreadSystemPrompt,
      maybeAssignSystemPromptFromTurns,
      createProject,
      deleteProject,
      deleteThread,
      threads,
      threadGroups,
      refreshThreads,
      statusMessage,
      isCreatingThread,
      isLoadingThreads,
      isCreatingProject,
      projectsState.projects,
      projectsState.status,
      threadResponseStatuses,
      setThreadResponseStatus,
      threadActivityPreviews,
      setThreadActivityPreview,
    ],
  );

  return (
    <ChatThreadContext.Provider value={value}>
      {children}
    </ChatThreadContext.Provider>
  );
}

export function useChatThread(): ChatThreadContextValue {
  const context = useContext(ChatThreadContext);
  if (!context) {
    throw new Error("useChatThread must be used within ChatThreadProvider");
  }
  return context;
}

/** Settings and other surfaces that may render outside a chat shell. */
export function useOptionalChatThread(): ChatThreadContextValue | null {
  return useContext(ChatThreadContext);
}
