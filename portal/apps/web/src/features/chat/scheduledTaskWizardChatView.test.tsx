/**
 * ChatView live wire for scheduled-task create wizard
 * (lp-fn5.4.1 agent tool path). Product chrome no longer starts this wizard
 * (lp-v62i.2.1). Emits cronjob action=setup via SSE and asserts local MCQ.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../../app/providers.js";
import {
  ChatThreadProvider,
  useChatThread,
} from "../projects/ChatThreadContext.js";
import { SettingsSnapshotProvider } from "../settings/SettingsSnapshotContext.js";

import { ChatView } from "./ChatView.js";

type Listener = (event: Event) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  withCredentials?: boolean;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, Set<Listener>>();

  constructor(url: string, options?: { withCredentials?: boolean }) {
    this.url = url;
    this.withCredentials = options?.withCredentials;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: Listener): void {
    const handlers = this.listeners.get(type) ?? new Set<Listener>();
    handlers.add(handler);
    this.listeners.set(type, handlers);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: string): void {
    const event = { data } as MessageEvent;
    for (const handler of this.listeners.get(type) ?? []) {
      handler(event);
    }
    if (type === "message" && this.onmessage) {
      this.onmessage(event);
    }
  }
}

function latestSource(): MockEventSource {
  const source = MockEventSource.instances.at(-1);
  if (!source) {
    throw new Error("Expected MockEventSource instance");
  }
  return source;
}

vi.mock("../../api/projects.js", () => ({
  fetchProjects: vi.fn().mockResolvedValue([]),
}));

let createChatThreadSeq = 0;

vi.mock("../../api/chat.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/chat.js")>();
  return {
    ...actual,
    listChatThreads: vi.fn().mockResolvedValue([]),
    createChatThread: vi.fn().mockImplementation(async () => {
      createChatThreadSeq += 1;
      const thread_id =
        createChatThreadSeq === 1 ? "thread-wizard-1" : `thread-wizard-${createChatThreadSeq}`;
      return {
        thread_id,
        title: "New chat",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-08-11T12:00:00.000Z",
      };
    }),
    ensureAgentChatForJob: vi.fn().mockImplementation(
      async (input: { jobId: string; name: string }) => ({
        thread_id: `stream-${input.jobId}`,
        title: input.name,
        project_id: null,
        project_vault_path: null,
        created_at: "2026-08-11T12:05:00.000Z",
        avatar_seed: "seed-job",
        title_source: "job" as const,
        kind: "scheduled_task" as const,
        scheduled_job_id: input.jobId,
        access: "owner" as const,
        system_prompt: "",
        system_prompt_source: "default" as const,
        created: true,
      }),
    ),
    updateChatThreadSystemPrompt: vi.fn().mockImplementation(
      async (input: {
        threadId: string;
        systemPrompt: string;
        systemPromptSource?: string;
      }) => ({
        thread_id: input.threadId,
        title: "Weekly digest",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-08-11T12:05:00.000Z",
        avatar_seed: "seed-job",
        title_source: "job" as const,
        kind: "scheduled_task" as const,
        scheduled_job_id: "job-created-1",
        access: "owner" as const,
        system_prompt: input.systemPrompt,
        system_prompt_source: input.systemPromptSource ?? "user",
      }),
    ),
    updateChatThreadTitle: vi.fn().mockResolvedValue({
      thread_id: "thread-wizard-1",
      title: "New chat",
      project_id: null,
      project_vault_path: null,
      created_at: "2026-08-11T12:00:00.000Z",
    }),
    assignChatThreadName: vi.fn().mockResolvedValue({
      thread_id: "thread-wizard-1",
      title: "New agent",
      project_id: null,
      project_vault_path: null,
      created_at: "2026-08-11T12:00:00.000Z",
      avatar_seed: "seed",
      title_source: "llm",
      applied: true,
      name_source: "fixture",
      skipped_reason: null,
    }),
    sendChatMessage: vi.fn().mockResolvedValue(undefined),
    kickSpeculativeEnsureOnline: vi.fn().mockResolvedValue(undefined),
    sendMcqSelection: vi.fn().mockResolvedValue(undefined),
    cancelChatRequest: vi.fn().mockResolvedValue(undefined),
    haltMailboxRoom: vi.fn().mockResolvedValue(undefined),
    fetchThreadHistory: vi.fn().mockResolvedValue([]),
    uploadStagingFile: vi.fn().mockResolvedValue({
      path: "/staging/notes.txt",
      filename: "notes.txt",
    }),
  };
});

vi.mock("../../api/settings.js", () => ({
  fetchSettingsSnapshot: vi.fn().mockResolvedValue({
    exported_at: "2026-08-11T00:00:00.000Z",
    skills: [{ id: "summarize", name: "summarize", enabled: true }],
    crons: [],
    mcp_servers: [],
    models: [
      {
        provider: "xai",
        model: "grok-3",
        is_active: true,
        connected: true,
      },
    ],
    integrations: [],
  }),
  refreshSettingsHealth: vi.fn(),
  patchSettingsActiveModel: vi.fn().mockResolvedValue({
    model: {
      provider: "xai",
      model: "grok-3",
      is_active: true,
      connected: true,
    },
    source: "fixture",
  }),
  createSettingsCron: vi.fn().mockResolvedValue({
    cron: {
      id: "job-created-1",
      name: "Weekly digest",
      schedule: {
        kind: "cron",
        expr: "0 9 * * 1",
        display: "Mondays at 9:00 AM",
        timezone: "America/New_York",
      },
      enabled: true,
    },
    source: "fixture",
  }),
  // Config pane detail fetch after ensure+select (lp-lv9.5 / lp-lv9.7).
  fetchSettingsCronDetail: vi.fn().mockResolvedValue({
    cron: {
      id: "job-created-1",
      name: "Weekly digest",
      schedule: {
        kind: "cron",
        expr: "0 9 * * 1",
        display: "Mondays at 9:00 AM",
        timezone: "America/New_York",
      },
      enabled: true,
      prompt: "Send the weekly digest.",
    },
    source: "fixture",
  }),
  patchSettingsCron: vi.fn(),
}));

vi.mock("../../api/vault.js", () => ({
  fetchVaultTree: vi.fn().mockResolvedValue({ roots: [] }),
  fetchVaultContent: vi.fn(),
  searchVaultIndex: vi.fn(),
  downloadVaultFile: vi.fn(),

  fetchArtifactHead: vi.fn().mockRejectedValue(
    Object.assign(new Error("heads unavailable"), {
      name: "VaultHistoryApiError",
      code: "method_not_found",
      status: 404,
      unavailable: true,
    }),
  ),
  fetchVaultHistory: vi.fn().mockRejectedValue(
    Object.assign(new Error("history unavailable"), {
      name: "VaultHistoryApiError",
      code: "method_not_found",
      status: 404,
      unavailable: true,
    }),
  ),
  VaultHistoryApiError: class VaultHistoryApiError extends Error {
    code: string;
    status: number;
    unavailable: boolean;
    constructor(
      message: string,
      opts: { code: string; status: number; unavailable?: boolean },
    ) {
      super(message);
      this.name = "VaultHistoryApiError";
      this.code = opts.code;
      this.status = opts.status;
      this.unavailable = opts.unavailable === true;
    }
  },
}));

vi.mock("../../api/context.js", () => ({
  fetchPortalContext: vi.fn().mockResolvedValue({
    vault_edit: false,
  }),
}));

import {
  createChatThread,
  ensureAgentChatForJob,
  sendMcqSelection,
  updateChatThreadSystemPrompt,
} from "../../api/chat.js";

function JobStreamProbe() {
  const { threadId, threads } = useChatThread();
  const active =
    threads.find((thread) => thread.thread_id === threadId) ?? null;
  return (
    <div>
      <div data-testid="plus-active-thread">{threadId ?? "none"}</div>
      <div data-testid="plus-active-thread-kind">
        {active?.kind ?? "none"}
      </div>
      <div data-testid="plus-active-thread-job-id">
        {active?.scheduled_job_id ?? "none"}
      </div>
      <div data-testid="plus-active-thread-system-prompt">
        {active?.system_prompt ?? "none"}
      </div>
      <div data-testid="plus-active-thread-system-prompt-source">
        {active?.system_prompt_source ?? "none"}
      </div>
      <div data-testid="plus-scheduled-task-ids">
        {threads
          .filter((thread) => thread.kind === "scheduled_task")
          .map((thread) => thread.thread_id)
          .join(",")}
      </div>
    </div>
  );
}

describe("ChatView scheduled-task wizard wire (lp-fn5.4.1 / lp-fn5.4.2)", () => {
  beforeEach(() => {
    createChatThreadSeq = 0;
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    MockEventSource.instances = [];
  });

  it("opens wizard MCQ steps when agent completes cronjob action=setup", async () => {
    render(
      <Providers>
        <SettingsSnapshotProvider>
          <ChatThreadProvider>
            <ChatView />
          </ChatThreadProvider>
        </SettingsSnapshotProvider>
      </Providers>,
    );

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(MockEventSource.instances.length).toBeGreaterThan(0);
    });

    // Agent tool finished: cronjob action=setup → Portal owns the wizard.
    latestSource().emit(
      "tool_progress",
      JSON.stringify({
        type: "tool_progress",
        chat_id: "thread-wizard-1",
        tool_name: "cronjob",
        tool_status: "completed",
        metadata: {
          result: JSON.stringify({ action: "setup", success: true }),
        },
      }),
    );

    // Intent MCQ from pure machine first step (local, not SSE mcq event).
    const yesBtn = await screen.findByRole("button", {
      name: "Yes, create scheduled task",
    });
    expect(
      screen.getByRole("button", { name: "No, cancel" }),
    ).toBeTruthy();
    // Intro assistant copy is present (markdown may split bold spans).
    expect(document.body.textContent).toMatch(
      /help you create a\s+scheduled task/i,
    );

    fireEvent.click(yesBtn);

    // Next wizard step (instructions template presets).
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Weekly digest" }),
      ).toBeTruthy();
    });
    expect(screen.getByRole("button", { name: "Vault index" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Custom…" })).toBeTruthy();

    // Local MCQ — never forwarded to the agent.
    expect(sendMcqSelection).not.toHaveBeenCalled();
  });

  it("cancels the open wizard on free-text cancel without agent send", async () => {
    const { sendChatMessage } = await import("../../api/chat.js");

    render(
      <Providers>
        <SettingsSnapshotProvider>
          <ChatThreadProvider>
            <ChatView />
          </ChatThreadProvider>
        </SettingsSnapshotProvider>
      </Providers>,
    );

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(MockEventSource.instances.length).toBeGreaterThan(0);
    });

    latestSource().emit(
      "tool_progress",
      JSON.stringify({
        type: "tool_progress",
        chat_id: "thread-wizard-1",
        tool_name: "cronjob",
        tool_status: "completed",
        metadata: {
          result: JSON.stringify({ action: "setup", success: true }),
        },
      }),
    );

    await screen.findByRole("button", { name: "Yes, create scheduled task" });

    const input = screen.getByRole("combobox", { name: "Message input" });
    input.textContent = "cancel";
    fireEvent.input(input, { target: input });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(
        screen.getByText(/Cancelled — no scheduled task created/i),
      ).toBeTruthy();
    });
    expect(sendChatMessage).not.toHaveBeenCalled();
  });

  it("re-emits confirm MCQ when createSettingsCron fails", async () => {
    const { createSettingsCron } = await import("../../api/settings.js");
    vi.mocked(createSettingsCron).mockRejectedValueOnce(
      new Error("API unavailable"),
    );

    render(
      <Providers>
        <SettingsSnapshotProvider>
          <ChatThreadProvider>
            <ChatView />
          </ChatThreadProvider>
        </SettingsSnapshotProvider>
      </Providers>,
    );

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(MockEventSource.instances.length).toBeGreaterThan(0);
    });

    latestSource().emit(
      "tool_progress",
      JSON.stringify({
        type: "tool_progress",
        chat_id: "thread-wizard-1",
        tool_name: "cronjob",
        tool_status: "completed",
        metadata: {
          result: JSON.stringify({ action: "setup", success: true }),
        },
      }),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Yes, create scheduled task" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Weekly digest" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Weekdays (Mon–Fri)" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "9:00 AM" }));

    // Timezone chip (UTC is always present).
    fireEvent.click(await screen.findByRole("button", { name: "Use UTC" }));

    // Skills inventory mock has one skill → optional step.
    fireEvent.click(await screen.findByRole("button", { name: "No skills" }));

    fireEvent.click(
      await screen.findByRole("button", { name: "Create scheduled task" }),
    );

    await waitFor(() => {
      expect(document.body.textContent).toMatch(
        /Create failed:\s*API unavailable/i,
      );
    });
    // Confirm chips re-emitted for retry / edit / cancel.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Create scheduled task" }),
      ).toBeTruthy();
    });
    expect(
      screen.getByRole("button", { name: "Edit schedule" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("action=setup wizard create selects the job stream under Scheduled Tasks (lp-fn5.5 / lp-v62i.2.1)", async () => {
    const { createSettingsCron } = await import("../../api/settings.js");
    const { fetchSettingsSnapshot } = await import("../../api/settings.js");

    render(
      <Providers>
        <SettingsSnapshotProvider>
          <ChatThreadProvider>
            <JobStreamProbe />
            <ChatView />
          </ChatThreadProvider>
        </SettingsSnapshotProvider>
      </Providers>,
    );

    // Initial auto-create on empty list.
    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
      expect(screen.getByTestId("plus-active-thread").textContent).toBe(
        "thread-wizard-1",
      );
    });
    await waitFor(() => {
      expect(MockEventSource.instances.length).toBeGreaterThan(0);
    });

    latestSource().emit(
      "tool_progress",
      JSON.stringify({
        type: "tool_progress",
        chat_id: "thread-wizard-1",
        tool_name: "cronjob",
        tool_status: "completed",
        metadata: {
          result: JSON.stringify({ action: "setup", success: true }),
        },
      }),
    );

    const yesBtn = await screen.findByRole("button", {
      name: "Yes, create scheduled task",
    });
    expect(document.body.textContent).toMatch(
      /help you create a\s+scheduled task/i,
    );

    fireEvent.click(yesBtn);
    fireEvent.click(
      await screen.findByRole("button", { name: "Weekly digest" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Weekdays (Mon–Fri)" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "9:00 AM" }));
    fireEvent.click(await screen.findByRole("button", { name: "Use UTC" }));
    fireEvent.click(await screen.findByRole("button", { name: "No skills" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Create scheduled task" }),
    );

    await waitFor(() => {
      expect(createSettingsCron).toHaveBeenCalled();
    });
    // Inventory refresh after create (debounced snapshot reload).
    await waitFor(() => {
      expect(fetchSettingsSnapshot.mock.calls.length).toBeGreaterThan(1);
    });

    // lp-lv9.7: ensure job stream, select it under Scheduled Tasks (not Tools).
    await waitFor(() => {
      expect(ensureAgentChatForJob).toHaveBeenCalledWith({
        jobId: "job-created-1",
        name: "Weekly digest",
      });
      expect(screen.getByTestId("plus-active-thread").textContent).toBe(
        "stream-job-created-1",
      );
      expect(screen.getByTestId("plus-active-thread-kind").textContent).toBe(
        "scheduled_task",
      );
      expect(screen.getByTestId("plus-active-thread-job-id").textContent).toBe(
        "job-created-1",
      );
      expect(screen.getByTestId("plus-scheduled-task-ids").textContent).toContain(
        "stream-job-created-1",
      );
    });
    // lp-pxr.3: seed thread purpose from wizard job instructions when empty.
    await waitFor(() => {
      expect(updateChatThreadSystemPrompt).toHaveBeenCalledWith({
        threadId: "stream-job-created-1",
        systemPrompt: "Summarize last week's vault changes for the team.",
        systemPromptSource: "llm",
      });
      expect(
        screen.getByTestId("plus-active-thread-system-prompt").textContent,
      ).toBe("Summarize last week's vault changes for the team.");
      expect(
        screen.getByTestId("plus-active-thread-system-prompt-source").textContent,
      ).toBe("llm");
    });
    // Config pane auto-opens for the selected job stream (lp-lv9.5 + lv9.7).
    await waitFor(() => {
      expect(screen.getByTestId("chat-activity-pane")).toBeTruthy();
      expect(screen.getByTestId("scheduled-task-config-pane")).toBeTruthy();
      expect(
        screen.getByTestId("chat-activity-pane").getAttribute("data-focus-kind"),
      ).toBe("scheduled_task_config");
    });
    // lp-pxr.3: no noisy shell chrome on scheduled_task_config.
    const pane = screen.getByTestId("chat-activity-pane");
    expect(pane.textContent).not.toMatch(/Schedule & instructions/i);
    // Title "Scheduled task" should not appear in shell chrome (job name may
    // still appear in body — config pane shows job name, not that phrase).
    expect(screen.queryByTestId("chat-activity-pane-chrome-neutral")).toBeTruthy();
  });
});
