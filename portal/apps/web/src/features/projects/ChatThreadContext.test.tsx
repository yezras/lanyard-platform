import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";

import {
  ChatThreadProvider,
  useChatThread,
} from "./ChatThreadContext.js";

vi.mock("../../api/projects.js", () => ({
  fetchProjects: vi.fn().mockResolvedValue([
    {
      project_id: "p1",
      name: "Alpha",
      vault_path: "/Projects/A",
      parent_project_id: null,
    },
  ]),
}));

vi.mock("../../api/chat.js", () => ({
  listChatThreads: vi.fn().mockResolvedValue([
    {
      thread_id: "thread-alpha",
      title: "Alpha chat",
      project_id: "p1",
      project_vault_path: "/Projects/A",
      created_at: "2026-07-01T12:00:00.000Z",
      avatar_seed: "seed-test",
      title_source: "default",
      access: "owner",
    },
    {
      thread_id: "thread-general",
      title: "General chat",
      project_id: null,
      project_vault_path: null,
      created_at: "2026-07-01T11:00:00.000Z",
      avatar_seed: "seed-test",
      title_source: "default",
      access: "owner",
    },
  ]),
  createChatThread: vi.fn().mockImplementation(
    async (input: { projectId: string | null }) => ({
      thread_id: "thread-new",
      title: input.projectId ? "Project chat" : "New chat",
      project_id: input.projectId,
      project_vault_path: input.projectId === "p1" ? "/Projects/A" : null,
      created_at: "2026-07-01T13:00:00.000Z",
      avatar_seed: "seed-new",
      title_source: "default" as const,
    }),
  ),
  ensureAgentChatForJob: vi.fn().mockImplementation(
    async (input: { jobId: string; name: string }) => ({
      thread_id: `stream-${input.jobId}`,
      title: input.name,
      project_id: null,
      project_vault_path: null,
      created_at: "2026-08-01T00:00:00.000Z",
      avatar_seed: "seed-job",
      title_source: "job" as const,
      kind: "scheduled_task" as const,
      scheduled_job_id: input.jobId,
      access: "owner" as const,
      created: true,
    }),
  ),
  assignChatThreadName: vi.fn().mockImplementation(
    async (input: { threadId: string; message?: string }) => {
      const message = (input.message ?? "").trim();
      if (!message) {
        // Eager bootstrap (lp-lv9.3)
        return {
          thread_id: input.threadId,
          title: "New agent",
          project_id: "p1",
          project_vault_path: "/Projects/A",
          created_at: "2026-07-01T13:00:00.000Z",
          avatar_seed: "seed-new",
          title_source: "llm" as const,
          applied: true,
          name_source: "fixture" as const,
          skipped_reason: null,
        };
      }
      return {
        thread_id: input.threadId,
        title: "First message body",
        project_id: "p1",
        project_vault_path: "/Projects/A",
        created_at: "2026-07-01T12:00:00.000Z",
        avatar_seed: "seed-test",
        title_source: "llm" as const,
        applied: true,
        name_source: "fixture" as const,
        skipped_reason: null,
      };
    },
  ),
  assignChatThreadSystemPrompt: vi.fn().mockResolvedValue({
    thread_id: "thread-alpha",
    title: "First message body",
    project_id: "p1",
    project_vault_path: "/Projects/A",
    created_at: "2026-07-01T12:00:00.000Z",
    avatar_seed: "seed-test",
    title_source: "llm" as const,
    system_prompt: "Help with first message body",
    system_prompt_source: "llm" as const,
    applied: true,
    prompt_source: "fixture" as const,
    skipped_reason: null,
  }),
  updateChatThreadTitle: vi.fn().mockImplementation(
    async (input: {
      threadId: string;
      title: string;
      titleSource?: string;
    }) => ({
      thread_id: input.threadId,
      title: input.title,
      project_id: "p1",
      project_vault_path: "/Projects/A",
      created_at: "2026-07-01T12:00:00.000Z",
      avatar_seed: "seed-test",
      title_source: input.titleSource ?? "default",
    }),
  ),
  updateChatThreadSystemPrompt: vi.fn().mockImplementation(
    async (input: {
      threadId: string;
      systemPrompt: string;
      systemPromptSource?: string;
    }) => ({
      thread_id: input.threadId,
      title: "First message body",
      project_id: "p1",
      project_vault_path: "/Projects/A",
      created_at: "2026-07-01T12:00:00.000Z",
      avatar_seed: "seed-test",
      title_source: "default",
      system_prompt: input.systemPrompt,
      system_prompt_source: input.systemPromptSource ?? "user",
    }),
  ),
  deleteChatThread: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../api/channels.js", () => ({
  deleteChannel: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../api/agents.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/agents.js")>();
  return {
    ...actual,
    createAgent: vi.fn().mockResolvedValue({
      agent_id: "agent-new",
      name: "New agent",
      avatar: "seed-new",
      objective: "",
      thread_id: "thread-new",
      created_at: "2026-07-01T13:00:00.000Z",
    }),
    listAgents: vi.fn().mockResolvedValue([]),
    renameAgent: vi.fn().mockImplementation(
      async (input: { agentId: string; name: string }) => ({
        agent_id: input.agentId,
        name: input.name,
        avatar: "seed-bob",
        objective: "",
        thread_id: "thread-bob",
        created_at: "2026-07-01T12:00:00.000Z",
      }),
    ),
  };
});

vi.mock("../../api/settings.js", () => ({
  fetchSettingsSnapshot: vi.fn().mockResolvedValue({
    exported_at: "2026-08-01T00:00:00.000Z",
    skills: [],
    crons: [],
    mcp_servers: [],
    models: [],
    integrations: [],
  }),
}));

import { createAgent, renameAgent } from "../../api/agents.js";
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
import { fetchSettingsSnapshot } from "../../api/settings.js";

function Probe() {
  const {
    threadId,
    threads,
    selectedProjectId,
    selectProject,
    selectThread,
    threadGroups,
    startNewThread,
    ensureAndSelectJobStream,
    scheduledTasksFolderExpandRequestId,
    renameThread,
    renameThreadFromFirstMessage,
    updateThreadSystemPrompt,
    maybeAssignSystemPromptFromTurns,
    deleteThread,
    threadActivityPreviews,
    setThreadActivityPreview,
  } = useChatThread();

  const activeThread =
    threads.find((thread) => thread.thread_id === threadId) ?? null;

  return (
    <div>
      <div data-testid="thread-id">{threadId ?? "none"}</div>
      <div data-testid="selected-project-id">
        {selectedProjectId ?? "none"}
      </div>
      <div data-testid="active-thread-project-id">
        {activeThread ? (activeThread.project_id ?? "none") : "none"}
      </div>
      <div data-testid="active-thread-title">
        {activeThread?.title ?? "none"}
      </div>
      <div data-testid="active-thread-title-source">
        {activeThread?.title_source ?? "none"}
      </div>
      <div data-testid="active-thread-system-prompt">
        {activeThread?.system_prompt ?? "none"}
      </div>
      <div data-testid="active-thread-system-prompt-source">
        {activeThread?.system_prompt_source ?? "none"}
      </div>
      <div data-testid="active-thread-kind">
        {activeThread?.kind ?? "none"}
      </div>
      <div data-testid="active-thread-job-id">
        {activeThread?.scheduled_job_id ?? "none"}
      </div>
      <div data-testid="activity-preview">
        {threadId ? (threadActivityPreviews[threadId] ?? "") : ""}
      </div>
      <div data-testid="scheduled-tasks-folder-expand-request-id">
        {scheduledTasksFolderExpandRequestId}
      </div>
      <div data-testid="group-count">{threadGroups.length}</div>
      <div data-testid="group-names">
        {threadGroups.map((group) => group.name).join(",")}
      </div>
      <div data-testid="scheduled-task-thread-ids">
        {threadGroups
          .find((group) => group.kind === "scheduled_tasks")
          ?.threads.map((thread) => thread.thread_id)
          .join(",") ?? ""}
      </div>
      <div data-testid="group-persona-names">
        {threads
          .filter((thread) => thread.kind === "group")
          .flatMap((thread) => thread.participants ?? [])
          .filter((participant) => participant.kind === "persona")
          .map((participant) =>
            participant.kind === "persona"
              ? (participant.display_name ?? participant.persona_id)
              : "",
          )
          .join(",")}
      </div>
      <button type="button" onClick={() => selectThread("thread-general")}>
        Select general
      </button>
      <button type="button" onClick={() => void startNewThread()}>
        Start new
      </button>
      <button
        type="button"
        onClick={() =>
          void ensureAndSelectJobStream({
            jobId: "job-created-1",
            name: "Weekly digest",
          })
        }
      >
        Ensure and select job stream
      </button>
      <button
        type="button"
        onClick={() =>
          void ensureAndSelectJobStream({
            jobId: "job-seed-1",
            name: "Seeded digest",
            instructions: "Summarize overnight vault changes for the team.",
          })
        }
      >
        Ensure job stream with instructions seed
      </button>
      <button type="button" onClick={() => void selectProject("p1")}>
        Select project p1
      </button>
      <button
        type="button"
        onClick={() =>
          void updateThreadSystemPrompt(
            threadId ?? "thread-alpha",
            "User purpose text",
          )
        }
      >
        Save system prompt
      </button>
      <button
        type="button"
        onClick={() =>
          void maybeAssignSystemPromptFromTurns(["First message body"])
        }
      >
        Assign system prompt
      </button>
      <button type="button" onClick={() => void selectProject(null)}>
        Select no project
      </button>
      <button
        type="button"
        onClick={() => void renameThreadFromFirstMessage("First message body")}
      >
        Rename from message
      </button>
      <button
        type="button"
        onClick={() => void renameThread("thread-alpha", "User renamed")}
      >
        User rename
      </button>
      <button
        type="button"
        onClick={() => void renameThread("thread-bob", "Alice")}
      >
        Rename agent 1:1
      </button>
      <button
        type="button"
        onClick={() => {
          if (threadId) {
            setThreadActivityPreview(threadId, "Latest assistant reply text");
          }
        }}
      >
        Set activity preview
      </button>
      <button
        type="button"
        onClick={() => {
          if (threadId) void deleteThread(threadId);
        }}
      >
        Delete active
      </button>
    </div>
  );
}

function renderProbe() {
  return render(
    <Theme theme={neutralTheme}>
      <ChatThreadProvider>
        <Probe />
      </ChatThreadProvider>
    </Theme>,
  );
}

describe("ChatThreadContext", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("loads threads, groups as Channels / Agents / Scheduled Tasks, and selects a thread", async () => {
    renderProbe();

    await waitFor(() => {
      expect(listChatThreads).toHaveBeenCalled();
      expect(screen.getByTestId("thread-id").textContent).toBe("thread-alpha");
    });

    expect(screen.getByTestId("group-names").textContent).toBe(
      "Channels,Agents,Scheduled Tasks",
    );
    expect(screen.getByTestId("group-count").textContent).toBe("3");
    expect(createChatThread).not.toHaveBeenCalled();
    expect(createAgent).not.toHaveBeenCalled();

    screen.getByRole("button", { name: "Select general" }).click();
    await waitFor(() => {
      expect(screen.getByTestId("thread-id").textContent).toBe(
        "thread-general",
      );
    });
  });

  it("ensures a job-stream row for each host cron on Agents load (lp-lv9.1)", async () => {
    vi.mocked(fetchSettingsSnapshot).mockResolvedValueOnce({
      exported_at: "2026-08-01T00:00:00.000Z",
      skills: [],
      crons: [
        {
          id: "cron-daily",
          name: "Daily digest",
          schedule: "0 9 * * *",
          enabled: true,
        },
        {
          id: "cron-weekly",
          name: "Weekly report",
          schedule: "0 9 * * 1",
          enabled: true,
        },
      ],
      mcp_servers: [],
      models: [],
      integrations: [],
    });

    renderProbe();

    await waitFor(() => {
      expect(fetchSettingsSnapshot).toHaveBeenCalled();
      expect(ensureAgentChatForJob).toHaveBeenCalledTimes(2);
    });

    expect(ensureAgentChatForJob).toHaveBeenCalledWith({
      jobId: "cron-daily",
      name: "Daily digest",
    });
    expect(ensureAgentChatForJob).toHaveBeenCalledWith({
      jobId: "cron-weekly",
      name: "Weekly report",
    });

    await waitFor(() => {
      expect(screen.getByTestId("group-names").textContent).toMatch(
        /,Scheduled Tasks$/,
      );
    });
  });

  it("I3: startNewThread writes catalog and opens that 1:1; second call is a different person", async () => {
    renderProbe();

    await waitFor(() => {
      expect(screen.getByTestId("thread-id").textContent).toBe("thread-alpha");
    });

    screen.getByRole("button", { name: "Start new" }).click();

    await waitFor(() => {
      expect(createAgent).toHaveBeenCalledWith({});
      expect(createChatThread).not.toHaveBeenCalled();
      expect(screen.getByTestId("thread-id").textContent).toBe("thread-new");
    });
    expect(screen.getByTestId("active-thread-kind").textContent).toBe("chat");

    vi.mocked(createAgent).mockResolvedValueOnce({
      agent_id: "agent-new-2",
      name: "New agent",
      avatar: "seed-new-2",
      objective: "",
      thread_id: "thread-new-2",
      created_at: "2026-07-01T14:00:00.000Z",
    });
    screen.getByRole("button", { name: "Start new" }).click();

    await waitFor(() => {
      expect(createAgent).toHaveBeenCalledTimes(2);
      expect(screen.getByTestId("thread-id").textContent).toBe("thread-new-2");
    });
    expect(createChatThread).not.toHaveBeenCalled();
  });

  it("ensureAndSelectJobStream merges stream under Scheduled Tasks and selects it (lp-lv9.7)", async () => {
    renderProbe();

    await waitFor(() => {
      expect(screen.getByTestId("thread-id").textContent).toBe("thread-alpha");
    });
    expect(
      screen.getByTestId("scheduled-tasks-folder-expand-request-id").textContent,
    ).toBe("0");
    vi.mocked(ensureAgentChatForJob).mockClear();

    screen
      .getByRole("button", { name: "Ensure and select job stream" })
      .click();

    await waitFor(() => {
      expect(ensureAgentChatForJob).toHaveBeenCalledWith({
        jobId: "job-created-1",
        name: "Weekly digest",
      });
      expect(screen.getByTestId("thread-id").textContent).toBe(
        "stream-job-created-1",
      );
      expect(screen.getByTestId("active-thread-title").textContent).toBe(
        "Weekly digest",
      );
      expect(screen.getByTestId("active-thread-kind").textContent).toBe(
        "scheduled_task",
      );
      expect(screen.getByTestId("active-thread-job-id").textContent).toBe(
        "job-created-1",
      );
      expect(
        screen.getByTestId("scheduled-task-thread-ids").textContent,
      ).toContain("stream-job-created-1");
      expect(
        screen.getByTestId("scheduled-tasks-folder-expand-request-id")
          .textContent,
      ).toBe("1");
    });
  });

  it("ensureAndSelectJobStream seeds system_prompt from job instructions when empty (lp-pxr.3)", async () => {
    renderProbe();

    await waitFor(() => {
      expect(screen.getByTestId("thread-id").textContent).toBe("thread-alpha");
    });
    vi.mocked(ensureAgentChatForJob).mockClear();
    vi.mocked(updateChatThreadSystemPrompt).mockClear();
    // Fresh stream has empty/default purpose.
    vi.mocked(ensureAgentChatForJob).mockImplementationOnce(
      async (input: { jobId: string; name: string }) => ({
        thread_id: `stream-${input.jobId}`,
        title: input.name,
        project_id: null,
        project_vault_path: null,
        created_at: "2026-08-01T00:00:00.000Z",
        avatar_seed: "seed-job",
        title_source: "job" as const,
        kind: "scheduled_task" as const,
        scheduled_job_id: input.jobId,
        access: "owner" as const,
        system_prompt: "",
        system_prompt_source: "default" as const,
        created: true,
      }),
    );

    screen
      .getByRole("button", { name: "Ensure job stream with instructions seed" })
      .click();

    await waitFor(() => {
      expect(ensureAgentChatForJob).toHaveBeenCalledWith({
        jobId: "job-seed-1",
        name: "Seeded digest",
      });
      expect(updateChatThreadSystemPrompt).toHaveBeenCalledWith({
        threadId: "stream-job-seed-1",
        systemPrompt: "Summarize overnight vault changes for the team.",
        systemPromptSource: "llm",
      });
      expect(screen.getByTestId("thread-id").textContent).toBe(
        "stream-job-seed-1",
      );
      expect(
        screen.getByTestId("active-thread-system-prompt").textContent,
      ).toBe("Summarize overnight vault changes for the team.");
      expect(
        screen.getByTestId("active-thread-system-prompt-source").textContent,
      ).toBe("llm");
    });
  });

  it("ensureAndSelectJobStream does not overwrite existing purpose (lp-pxr.3)", async () => {
    renderProbe();

    await waitFor(() => {
      expect(screen.getByTestId("thread-id").textContent).toBe("thread-alpha");
    });
    vi.mocked(ensureAgentChatForJob).mockClear();
    vi.mocked(updateChatThreadSystemPrompt).mockClear();
    vi.mocked(ensureAgentChatForJob).mockImplementationOnce(
      async (input: { jobId: string; name: string }) => ({
        thread_id: `stream-${input.jobId}`,
        title: input.name,
        project_id: null,
        project_vault_path: null,
        created_at: "2026-08-01T00:00:00.000Z",
        avatar_seed: "seed-job",
        title_source: "job" as const,
        kind: "scheduled_task" as const,
        scheduled_job_id: input.jobId,
        access: "owner" as const,
        system_prompt: "User already set purpose",
        system_prompt_source: "user" as const,
        created: false,
      }),
    );

    screen
      .getByRole("button", { name: "Ensure job stream with instructions seed" })
      .click();

    await waitFor(() => {
      expect(ensureAgentChatForJob).toHaveBeenCalled();
      expect(screen.getByTestId("thread-id").textContent).toBe(
        "stream-job-seed-1",
      );
    });
    expect(updateChatThreadSystemPrompt).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("active-thread-system-prompt").textContent,
    ).toBe("User already set purpose");
    expect(
      screen.getByTestId("active-thread-system-prompt-source").textContent,
    ).toBe("user");
  });

  it("eager assign-name fires on new chat create without waiting for first message (lp-lv9.3)", async () => {
    renderProbe();

    await waitFor(() => {
      expect(screen.getByTestId("thread-id").textContent).toBe("thread-alpha");
    });
    vi.mocked(assignChatThreadName).mockClear();
    vi.mocked(createAgent).mockClear();
    vi.mocked(createChatThread).mockClear();

    screen.getByRole("button", { name: "Start new" }).click();

    await waitFor(() => {
      expect(createAgent).toHaveBeenCalledTimes(1);
      expect(createChatThread).not.toHaveBeenCalled();
      expect(assignChatThreadName).toHaveBeenCalledWith({
        threadId: "thread-new",
        message: "",
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("thread-id").textContent).toBe("thread-new");
      expect(screen.getByTestId("active-thread-title").textContent).toBe(
        "New agent",
      );
      expect(screen.getByTestId("active-thread-title-source").textContent).toBe(
        "llm",
      );
    });
  });

  it("refines LLM name from the first user message once even after bootstrap llm (lp-lv9.3)", async () => {
    renderProbe();

    await waitFor(() => {
      expect(screen.getByTestId("thread-id").textContent).toBe("thread-alpha");
    });

    vi.mocked(assignChatThreadName).mockClear();

    screen.getByRole("button", { name: "Rename from message" }).click();
    screen.getByRole("button", { name: "Rename from message" }).click();

    await waitFor(() => {
      expect(assignChatThreadName).toHaveBeenCalledTimes(1);
      expect(assignChatThreadName).toHaveBeenCalledWith({
        threadId: "thread-alpha",
        message: "First message body",
      });
      expect(screen.getByTestId("active-thread-title").textContent).toBe(
        "First message body",
      );
      expect(screen.getByTestId("active-thread-title-source").textContent).toBe(
        "llm",
      );
      expect(screen.getByTestId("activity-preview").textContent).toBe(
        "First message body",
      );
    });
  });

  it("does not assign LLM name when title_source is user", async () => {
    vi.mocked(listChatThreads).mockResolvedValueOnce([
      {
        thread_id: "thread-alpha",
        title: "My agent",
        project_id: "p1",
        project_vault_path: "/Projects/A",
        created_at: "2026-07-01T12:00:00.000Z",
        avatar_seed: "seed-test",
        title_source: "user",
        access: "owner",
      },
    ]);

    renderProbe();

    await waitFor(() => {
      expect(screen.getByTestId("thread-id").textContent).toBe("thread-alpha");
      expect(screen.getByTestId("active-thread-title-source").textContent).toBe(
        "user",
      );
    });

    screen.getByRole("button", { name: "Rename from message" }).click();

    // Guard marks thread; API must not be called for sticky user titles.
    await new Promise((r) => setTimeout(r, 50));
    expect(assignChatThreadName).not.toHaveBeenCalled();
    expect(screen.getByTestId("active-thread-title").textContent).toBe(
      "My agent",
    );
  });

  it("does not assign LLM name when title_source is job", async () => {
    vi.mocked(listChatThreads).mockResolvedValueOnce([
      {
        thread_id: "thread-job",
        title: "Nightly digest",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-07-01T12:00:00.000Z",
        avatar_seed: "seed-job",
        title_source: "job",
        kind: "scheduled_task",
        scheduled_job_id: "cron-1",
        access: "owner",
      },
    ]);

    renderProbe();

    await waitFor(() => {
      expect(screen.getByTestId("thread-id").textContent).toBe("thread-job");
      expect(screen.getByTestId("active-thread-title-source").textContent).toBe(
        "job",
      );
    });

    screen.getByRole("button", { name: "Rename from message" }).click();

    await new Promise((r) => setTimeout(r, 50));
    expect(assignChatThreadName).not.toHaveBeenCalled();
    expect(screen.getByTestId("active-thread-title").textContent).toBe(
      "Nightly digest",
    );
  });

  it("user rename PATCHes title_source=user and blocks first-message overwrite", async () => {
    renderProbe();

    await waitFor(() => {
      expect(screen.getByTestId("thread-id").textContent).toBe("thread-alpha");
    });

    screen.getByRole("button", { name: "User rename" }).click();

    await waitFor(() => {
      expect(updateChatThreadTitle).toHaveBeenCalledWith({
        threadId: "thread-alpha",
        title: "User renamed",
        titleSource: "user",
      });
      expect(screen.getByTestId("active-thread-title").textContent).toBe(
        "User renamed",
      );
      expect(screen.getByTestId("active-thread-title-source").textContent).toBe(
        "user",
      );
    });

    vi.mocked(assignChatThreadName).mockClear();
    screen.getByRole("button", { name: "Rename from message" }).click();

    await waitFor(() => {
      expect(assignChatThreadName).not.toHaveBeenCalled();
      expect(screen.getByTestId("active-thread-title").textContent).toBe(
        "User renamed",
      );
    });
  });

  it("user rename of agent 1:1 PATCHes catalog name, not thread title only", async () => {
    vi.mocked(listChatThreads).mockResolvedValueOnce([
      {
        thread_id: "thread-bob",
        title: "Bob",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-07-01T12:00:00.000Z",
        avatar_seed: "seed-bob",
        title_source: "user",
        kind: "chat",
        agent_id: "agent-bob",
        access: "owner",
      },
      {
        thread_id: "thread-room",
        title: "teamguys",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-07-01T11:00:00.000Z",
        avatar_seed: "seed-room",
        title_source: "user",
        kind: "group",
        agent_id: null,
        access: "owner",
        participants: [
          { kind: "human", user_id: "user-1", display_name: "Jack" },
          { kind: "persona", persona_id: "agent-bob", display_name: "Bob" },
        ],
      },
    ]);

    renderProbe();

    await waitFor(() => {
      expect(screen.getByTestId("thread-id").textContent).toBe("thread-bob");
      expect(screen.getByTestId("group-persona-names").textContent).toBe("Bob");
    });

    screen.getByRole("button", { name: "Rename agent 1:1" }).click();

    await waitFor(() => {
      expect(renameAgent).toHaveBeenCalledWith({
        agentId: "agent-bob",
        name: "Alice",
      });
      expect(updateChatThreadTitle).not.toHaveBeenCalled();
      expect(screen.getByTestId("active-thread-title").textContent).toBe(
        "Alice",
      );
      expect(screen.getByTestId("group-persona-names").textContent).toBe(
        "Alice",
      );
    });
  });

  it("stores session-local activity preview for SideNav subtitle (lp-lv9.3)", async () => {
    renderProbe();

    await waitFor(() => {
      expect(screen.getByTestId("thread-id").textContent).toBe("thread-alpha");
    });

    screen.getByRole("button", { name: "Set activity preview" }).click();

    await waitFor(() => {
      expect(screen.getByTestId("activity-preview").textContent).toBe(
        "Latest assistant reply text",
      );
    });
  });

  it("saves system prompt with source=user (lp-lv9.4)", async () => {
    renderProbe();

    await waitFor(() => {
      expect(screen.getByTestId("thread-id").textContent).toBe("thread-alpha");
    });

    screen.getByRole("button", { name: "Save system prompt" }).click();

    await waitFor(() => {
      expect(updateChatThreadSystemPrompt).toHaveBeenCalledWith({
        threadId: "thread-alpha",
        systemPrompt: "User purpose text",
        systemPromptSource: "user",
      });
      expect(
        screen.getByTestId("active-thread-system-prompt").textContent,
      ).toBe("User purpose text");
      expect(
        screen.getByTestId("active-thread-system-prompt-source").textContent,
      ).toBe("user");
    });
  });

  it("assigns LLM system prompt once; skips after user edit (lp-lv9.4)", async () => {
    renderProbe();

    await waitFor(() => {
      expect(screen.getByTestId("thread-id").textContent).toBe("thread-alpha");
    });

    screen.getByRole("button", { name: "Assign system prompt" }).click();
    screen.getByRole("button", { name: "Assign system prompt" }).click();

    await waitFor(() => {
      expect(assignChatThreadSystemPrompt).toHaveBeenCalledTimes(1);
      expect(
        screen.getByTestId("active-thread-system-prompt-source").textContent,
      ).toBe("llm");
    });

    vi.mocked(assignChatThreadSystemPrompt).mockClear();
    screen.getByRole("button", { name: "Save system prompt" }).click();
    await waitFor(() => {
      expect(
        screen.getByTestId("active-thread-system-prompt-source").textContent,
      ).toBe("user");
    });

    screen.getByRole("button", { name: "Assign system prompt" }).click();
    await new Promise((r) => setTimeout(r, 50));
    expect(assignChatThreadSystemPrompt).not.toHaveBeenCalled();
  });

  it("deletes the active thread and selects the next remaining thread", async () => {
    renderProbe();

    await waitFor(() => {
      expect(screen.getByTestId("thread-id").textContent).toBe("thread-alpha");
    });

    screen.getByRole("button", { name: "Delete active" }).click();

    await waitFor(() => {
      expect(deleteChatThread).toHaveBeenCalledWith("thread-alpha");
      expect(screen.getByTestId("thread-id").textContent).toBe(
        "thread-general",
      );
    });
  });

  it("I8: deletes a channel via DELETE /api/channels and keeps agent 1:1s", async () => {
    vi.mocked(listChatThreads).mockResolvedValueOnce([
      {
        thread_id: "ch-deal",
        title: "Deal room",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-08-01T12:00:00.000Z",
        avatar_seed: "seed-ch",
        title_source: "user",
        kind: "group",
        access: "owner",
      },
      {
        thread_id: "thread-legal",
        title: "Legal",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-08-01T11:00:00.000Z",
        avatar_seed: "seed-legal",
        title_source: "user",
        kind: "chat",
        access: "owner",
      },
    ]);
    renderProbe();
    await waitFor(() => {
      expect(screen.getByTestId("thread-id").textContent).toBe("ch-deal");
    });
    screen.getByRole("button", { name: "Delete active" }).click();
    await waitFor(() => {
      expect(deleteChannel).toHaveBeenCalledWith("ch-deal");
      expect(deleteChatThread).not.toHaveBeenCalled();
      expect(screen.getByTestId("thread-id").textContent).toBe("thread-legal");
    });
  });

  it("selectProject creates a new thread bound to that project_id", async () => {
    renderProbe();

    await waitFor(() => {
      expect(screen.getByTestId("thread-id").textContent).toBe("thread-alpha");
      expect(screen.getByTestId("active-thread-project-id").textContent).toBe(
        "p1",
      );
    });

    // Same project as active thread → no new create
    screen.getByRole("button", { name: "Select project p1" }).click();
    await waitFor(() => {
      expect(screen.getByTestId("selected-project-id").textContent).toBe("p1");
    });
    expect(createChatThread).not.toHaveBeenCalled();

    // Switch away → new thread with project_id null
    screen.getByRole("button", { name: "Select no project" }).click();

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalledWith({
        projectId: null,
        projects: expect.any(Array),
      });
      expect(screen.getByTestId("thread-id").textContent).toBe("thread-new");
      expect(screen.getByTestId("active-thread-project-id").textContent).toBe(
        "none",
      );
      expect(screen.getByTestId("selected-project-id").textContent).toBe(
        "none",
      );
    });

    // Switch to p1 → new thread bound to p1
    vi.mocked(createChatThread).mockClear();
    screen.getByRole("button", { name: "Select project p1" }).click();

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalledWith({
        projectId: "p1",
        projects: expect.any(Array),
      });
      expect(screen.getByTestId("thread-id").textContent).toBe("thread-new");
      expect(screen.getByTestId("active-thread-project-id").textContent).toBe(
        "p1",
      );
      expect(screen.getByTestId("selected-project-id").textContent).toBe("p1");
    });
  });
});
