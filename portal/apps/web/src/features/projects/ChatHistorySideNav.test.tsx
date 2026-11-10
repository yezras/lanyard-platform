import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";

import { Theme } from "@astryxdesign/core/theme";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";

import { PortalHonestyProvider } from "../honesty/index.js";
import { SettingsSnapshotProvider } from "../settings/SettingsSnapshotContext.js";
import {
  ChatHistorySideNav,
  projectSoftArchiveConfirmMessage,
} from "./ChatHistorySideNav.js";
import { ChatThreadProvider, useChatThread } from "./ChatThreadContext.js";

const deleteChatThread = vi.fn().mockResolvedValue(undefined);
const createChatThread = vi.fn().mockResolvedValue({
  thread_id: "thread-new",
  title: "New chat",
  project_id: null,
  project_vault_path: null,
  created_at: "2026-07-01T13:00:00.000Z",
      avatar_seed: "seed-test",
      title_source: "default",
});
const createAgent = vi.fn().mockResolvedValue({
  agent_id: "agent-new",
  name: "New agent",
  avatar: "seed-new",
  objective: "",
  thread_id: "thread-new",
  created_at: "2026-07-01T13:00:00.000Z",
});
const listAgents = vi.fn().mockResolvedValue([]);
const createChannel = vi.fn();
const getChannel = vi.fn();
const setChannelLead = vi.fn();
const listChannels = vi.fn().mockResolvedValue([]);
const addChannelMember = vi.fn();
const removeChannelMember = vi.fn();
const deleteChannel = vi.fn().mockResolvedValue(undefined);
const listChatThreads = vi.fn().mockResolvedValue([
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
]);
const createProject = vi.fn().mockResolvedValue({
  project_id: "p-new",
  name: "Beta",
  vault_path: "/Projects/beta",
  parent_project_id: null,
});
const fetchProjects = vi.fn().mockResolvedValue([
  {
    project_id: "p1",
    name: "Alpha",
    vault_path: "/Projects/A",
    parent_project_id: null,
  },
]);
const listOrgMembers = vi.fn().mockResolvedValue([
  { user_id: "u2", email: "bob@demo.test" },
]);
const createChatThreadShare = vi.fn().mockResolvedValue({
  grant_id: "g1",
  tenant_id: "t1",
  thread_id: "thread-alpha",
  owner_user_id: "u1",
  grantee_user_id: "u2",
  mode: "read",
  created_at: "2026-07-15T00:00:00.000Z",
  revoked_at: null,
});
const listChatThreadShares = vi.fn().mockResolvedValue([]);
const revokeChatThreadShare = vi.fn();

const deleteProject = vi.fn().mockResolvedValue(undefined);

vi.mock("../../api/projects.js", () => ({
  fetchProjects: (...args: unknown[]) => fetchProjects(...args),
  createProject: (...args: unknown[]) => createProject(...args),
  deleteProject: (...args: unknown[]) => deleteProject(...args),
}));

vi.mock("../../api/agents.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/agents.js")>();
  return {
    ...actual,
    createAgent: (...args: unknown[]) => createAgent(...args),
    listAgents: (...args: unknown[]) => listAgents(...args),
  };
});

vi.mock("../../api/chat.js", () => ({
  listChatThreads: (...args: unknown[]) => listChatThreads(...args),
  createChatThread: (...args: unknown[]) => createChatThread(...args),
  updateChatThreadTitle: vi.fn(),
  assignChatThreadName: vi.fn().mockResolvedValue({
    thread_id: "thread-new",
    title: "New agent",
    project_id: null,
    project_vault_path: null,
    created_at: "2026-07-01T13:00:00.000Z",
    avatar_seed: "seed-test",
    title_source: "llm",
    applied: true,
    name_source: "fixture",
    skipped_reason: null,
  }),
  deleteChatThread: (...args: unknown[]) => deleteChatThread(...args),
  ensureAgentChatForJob: vi.fn().mockResolvedValue({
    thread_id: "stream-unused",
    title: "unused",
    project_id: null,
    project_vault_path: null,
    created_at: "2026-08-01T00:00:00.000Z",
    avatar_seed: "seed",
    title_source: "job",
    kind: "scheduled_task",
    scheduled_job_id: "unused",
    created: false,
  }),
}));

const fetchSettingsSnapshot = vi.fn().mockResolvedValue({
  exported_at: "2026-08-01T00:00:00.000Z",
  skills: [],
  crons: [] as Array<{
    id: string;
    name: string;
    schedule: string;
    enabled: boolean;
    last_status?: string | null;
    state?: string | null;
  }>,
  mcp_servers: [],
  models: [],
  integrations: [],
});

vi.mock("../../api/settings.js", () => ({
  fetchSettingsSnapshot: (...args: unknown[]) => fetchSettingsSnapshot(...args),
}));

vi.mock("../../api/sessionShares.js", () => ({
  listOrgMembers: (...args: unknown[]) => listOrgMembers(...args),
  createChatThreadShare: (...args: unknown[]) => createChatThreadShare(...args),
  listChatThreadShares: (...args: unknown[]) => listChatThreadShares(...args),
  revokeChatThreadShare: (...args: unknown[]) =>
    revokeChatThreadShare(...args),
}));

vi.mock("../../api/channels.js", () => ({
  createChannel: (...args: unknown[]) => createChannel(...args),
  getChannel: (...args: unknown[]) => getChannel(...args),
  setChannelLead: (...args: unknown[]) => setChannelLead(...args),
  listChannels: () => listChannels(),
  addChannelMember: (...args: unknown[]) => addChannelMember(...args),
  removeChannelMember: (...args: unknown[]) => removeChannelMember(...args),
  deleteChannel: (...args: unknown[]) => deleteChannel(...args),
}));

function renderSideNav(
  props: { embedded?: boolean } = {},
  honesty?: {
    brainRpcEnabled: boolean | null;
    chatDelivery?: "relay" | "harness" | null;
    vaultPlane?: "fs" | "brain_rpc" | "cp_s3" | null;
  },
) {
  return render(
    <Theme theme={neutralTheme}>
      <PortalHonestyProvider
        value={
          honesty
            ? {
                brainRpcEnabled: honesty.brainRpcEnabled,
                chatDelivery: honesty.chatDelivery,
                vaultPlane: honesty.vaultPlane,
                isReady: true,
              }
            : undefined
        }
      >
        <ChatThreadProvider>
          <ChatHistorySideNav {...props} />
        </ChatThreadProvider>
      </PortalHonestyProvider>
    </Theme>,
  );
}

describe("ChatHistorySideNav", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createAgent.mockResolvedValue({
      agent_id: "agent-new",
      name: "New agent",
      avatar: "seed-new",
      objective: "",
      thread_id: "thread-new",
      created_at: "2026-07-01T13:00:00.000Z",
    });
    listChatThreads.mockResolvedValue([
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
    ]);
    fetchProjects.mockResolvedValue([
      {
        project_id: "p1",
        name: "Alpha",
        vault_path: "/Projects/A",
        parent_project_id: null,
      },
    ]);
  });

  afterEach(() => {
    cleanup();
  });

  it("renders single + create menu with Agent / Channel only (lp-v62i.2.1)", async () => {
    renderSideNav();

    const createBtn = await screen.findByRole("button", { name: "New Agent" });
    expect(createBtn.getAttribute("aria-label")).toBe("New Agent");
    expect(createBtn.getAttribute("title")).toBeNull();
    expect(createBtn.getAttribute("data-tooltip")).toBeNull();
    expect(screen.queryByRole("button", { name: "New chat" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New project" })).toBeNull();
    expect(screen.queryByLabelText("Select project directory")).toBeNull();

    fireEvent.click(createBtn);
    expect(
      await screen.findByRole("menuitem", { name: "Agent" }),
    ).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Channel" })).toBeTruthy();
    expect(
      screen.queryByRole("menuitem", { name: "Scheduled Task" }),
    ).toBeNull();
    expect(screen.queryByText("New scheduled task")).toBeNull();
    expect(screen.queryByTestId("new-scheduled-task-dialog")).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Project" })).toBeNull();
    expect(await screen.findByText("Alpha chat")).toBeTruthy();
  });

  it("I4: Channel menu opens create popup with submit disabled until two members", async () => {
    renderSideNav();
    fireEvent.click(await screen.findByRole("button", { name: "New Agent" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Channel" }));
    expect(await screen.findByText("New channel")).toBeTruthy();
    expect(
      await screen.findByText("No agents yet. Create two members to continue."),
    ).toBeTruthy();
    const create = screen.getByRole("button", { name: "Create channel" });
    expect(
      create.hasAttribute("disabled") ||
        create.getAttribute("aria-disabled") === "true" ||
        (create as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(createChannel).not.toHaveBeenCalled();
  });

  it("I2: sidenav sections are Channels, Agents, Scheduled Tasks with no Projects", async () => {
    renderSideNav();

    await screen.findByText("Alpha chat");
    const channels = screen.getByTestId("channels-folder");
    const agents = screen.getByTestId("agents-folder");
    const scheduled = screen.getByTestId("scheduled-tasks-folder");
    expect(screen.getByTestId("channels-folder-icon")).toBeTruthy();
    expect(screen.getByTestId("agents-folder-icon")).toBeTruthy();
    expect(screen.getByTestId("scheduled-tasks-folder-icon")).toBeTruthy();
    expect(screen.getAllByText("Channels").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Agents").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Scheduled Tasks").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(screen.getByText("No channels yet")).toBeTruthy();
    expect(screen.queryByTestId("general-folder")).toBeNull();
    expect(screen.queryByText("General")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Project actions/i }),
    ).toBeNull();
    expect(screen.queryByTestId("agent-memory-list")).toBeNull();
    expect(screen.queryByText("Memory")).toBeNull();

    const following = Node.DOCUMENT_POSITION_FOLLOWING;
    expect(Boolean(channels.compareDocumentPosition(agents) & following)).toBe(
      true,
    );
    expect(
      Boolean(agents.compareDocumentPosition(scheduled) & following),
    ).toBe(true);
  });

  it("I5: lists kind=group rows under Channels, not Agents", async () => {
    listChatThreads.mockResolvedValue([
      {
        thread_id: "ch-deal",
        title: "Deal room",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-08-01T00:00:00.000Z",
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
        created_at: "2026-08-01T00:00:01.000Z",
        avatar_seed: "seed-legal",
        title_source: "user",
        kind: "chat",
        access: "owner",
      },
    ]);
    renderSideNav();
    expect(await screen.findByText("#Deal room")).toBeTruthy();
    expect(screen.getByText("Legal")).toBeTruthy();
    expect(screen.getByTestId("agent-side-nav-row-ch-deal")).toBeTruthy();
    expect(screen.getByTestId("agent-side-nav-row-thread-legal")).toBeTruthy();
    expect(screen.queryByText("No channels yet")).toBeNull();
  });

  it("I7: Members menu opens editor; remove is disabled at two", async () => {
    listChatThreads.mockResolvedValue([
      {
        thread_id: "ch-deal",
        title: "Deal room",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-08-01T00:00:00.000Z",
        avatar_seed: "seed-ch",
        title_source: "user",
        kind: "group",
        access: "owner",
      },
    ]);
    listAgents.mockResolvedValue([
      {
        agent_id: "agent-legal",
        name: "Legal",
        avatar: "seed-legal",
        objective: "",
        thread_id: "t-legal",
        created_at: "2026-08-01T00:00:00.000Z",
      },
      {
        agent_id: "agent-ops",
        name: "Ops",
        avatar: "seed-ops",
        objective: "",
        thread_id: "t-ops",
        created_at: "2026-08-01T00:00:01.000Z",
      },
    ]);
    getChannel.mockResolvedValue({
      thread_id: "ch-deal",
      name: "Deal room",
      kind: "group",
      lead_agent_id: "agent-legal",
      members: [
        { agent_id: "agent-legal", joined_at: "2026-08-01T00:00:00.000Z" },
        { agent_id: "agent-ops", joined_at: "2026-08-01T00:00:00.001Z" },
      ],
      created_at: "2026-08-01T00:00:02.000Z",
      title: "Deal room",
      avatar_seed: "seed-ch",
      title_source: "user",
      project_id: null,
      project_vault_path: null,
    });
    renderSideNav();
    const label = await screen.findByText("#Deal room");
    const row = label.closest("a") ?? label.parentElement;
    fireEvent.mouseEnter(row!);
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Chat actions for #Deal room",
      }),
    );
    // lp-cxhb.15.2: membership is behind the channel header title click, not
    // the sidenav row menu.
    expect(screen.queryByRole("menuitem", { name: /^Members$/ })).toBeNull();
  });

  it("I8: delete channel confirm says agents stay and calls deleteChannel", async () => {
    listChatThreads.mockResolvedValue([
      {
        thread_id: "ch-deal",
        title: "Deal room",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-08-01T00:00:00.000Z",
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
        created_at: "2026-08-01T00:00:01.000Z",
        avatar_seed: "seed-legal",
        title_source: "user",
        kind: "chat",
        access: "owner",
      },
    ]);
    renderSideNav();
    await openChatDeleteMenu("#Deal room");
    await screen.findByRole("heading", { name: /Delete channel\?/i });
    expect(screen.getByText(/Agents and their 1:1s stay/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    await waitFor(() => {
      expect(deleteChannel).toHaveBeenCalledWith("ch-deal");
    });
    expect(deleteChatThread).not.toHaveBeenCalled();
  });

  it("renders channel rows as #name only — no avatar, no subtitle (lp-cxhb.15.1)", async () => {
    listChatThreads.mockResolvedValue([
      {
        thread_id: "ch-general",
        title: "General",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-08-01T00:00:00.000Z",
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
        created_at: "2026-08-01T00:00:01.000Z",
        avatar_seed: "seed-legal",
        title_source: "user",
        kind: "chat",
        access: "owner",
      },
    ]);
    renderSideNav();

    const channelRow = await screen.findByTestId(
      "agent-side-nav-row-ch-general",
    );
    // Hash + name, single line.
    expect(channelRow.getAttribute("data-channel")).toBe("true");
    expect(channelRow.textContent).toContain("#General");
    expect(screen.getByText("#General")).toBeTruthy();
    // No avatar / agent icon glyph.
    expect(screen.queryByTestId("agent-dither-ch-general")).toBeNull();
    expect(screen.queryByTestId("agent-side-nav-share-icon")).toBeNull();
    // No last-message / date recency subtitle.
    expect(screen.queryByTestId("agent-side-nav-subtitle-ch-general")).toBeNull();

    // Agent rows are unchanged: dither avatar + recency subtitle stay.
    const agentRow = screen.getByTestId("agent-side-nav-row-thread-legal");
    expect(agentRow.getAttribute("data-channel")).toBe("false");
    expect(screen.getByTestId("agent-dither-thread-legal")).toBeTruthy();
    expect(
      screen.getByTestId("agent-side-nav-subtitle-thread-legal"),
    ).toBeTruthy();
  });

  it("does not render a memory section when an agent 1:1 is selected (lp-bhcg.24)", async () => {
    listChatThreads.mockResolvedValue([
      {
        thread_id: "thread-alpha",
        title: "Alpha chat",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-07-01T12:00:00.000Z",
        avatar_seed: "seed-test",
        title_source: "user",
        kind: "chat",
        agent_id: "agent-alpha",
        access: "owner",
      },
      {
        thread_id: "ch-deal",
        title: "Deal room",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-07-01T11:00:00.000Z",
        avatar_seed: "seed-ch",
        title_source: "user",
        kind: "group",
        access: "owner",
      },
      {
        thread_id: "thread-job",
        title: "Daily digest",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-07-02T09:00:00.000Z",
        avatar_seed: "seed-job",
        title_source: "job",
        kind: "scheduled_task",
        scheduled_job_id: "cron-daily",
        agent_id: "agent-alpha",
        access: "owner",
      },
    ]);
    renderSideNav();

    await screen.findByText("Alpha chat");
    expect(screen.getByTestId("channels-folder")).toBeTruthy();
    expect(screen.getByTestId("agents-folder")).toBeTruthy();
    expect(screen.getByTestId("scheduled-tasks-folder")).toBeTruthy();
    expect(screen.queryByTestId("agent-memory-list")).toBeNull();
    expect(screen.queryByTestId("agent-memory-empty")).toBeNull();
    expect(screen.queryByText("Memory")).toBeNull();
    expect(screen.queryByText("No memory files")).toBeNull();
  });

  it("I1: lists durable agent rows under Agents, not project folders", async () => {
    renderSideNav();

    await screen.findByText("Alpha chat");
    expect(screen.getByText("General chat")).toBeTruthy();
    expect(screen.getByTestId("agent-side-nav-row-thread-alpha")).toBeTruthy();
    expect(screen.getByTestId("agent-side-nav-row-thread-general")).toBeTruthy();
    expect(screen.queryByText("No agents yet")).toBeNull();
    expect(screen.getByTestId("agents-folder")).toBeTruthy();
    expect(screen.queryByTestId("general-folder")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Project actions for/i }),
    ).toBeNull();
    expect(screen.queryByRole("link", { name: /^Alpha$/ })).toBeNull();
  });

  it("always lists perpetual Scheduled Tasks folder last with calendar icon (lp-lv9.1)", async () => {
    renderSideNav();

    await screen.findByText("Alpha chat");
    const folder = screen.getByTestId("scheduled-tasks-folder");
    expect(folder).toBeTruthy();
    expect(screen.getByTestId("scheduled-tasks-folder-icon")).toBeTruthy();
    expect(screen.getAllByText("Scheduled Tasks").length).toBeGreaterThanOrEqual(
      1,
    );
    expect(screen.getByText("No scheduled tasks yet")).toBeTruthy();
    expect(
      screen.queryByRole("button", {
        name: "Project actions for Scheduled Tasks",
      }),
    ).toBeNull();

    const agents = screen.getByTestId("agents-folder");
    expect(
      Boolean(
        agents.compareDocumentPosition(folder) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true);
  });

  it("lists job stream chats under Scheduled Tasks without row icons (lp-fn5.5.2)", async () => {
    listChatThreads.mockResolvedValue([
      {
        thread_id: "thread-alpha",
        title: "Alpha chat",
        project_id: "p1",
        project_vault_path: "/Projects/A",
        created_at: "2026-07-01T12:00:00.000Z",
        avatar_seed: "seed-alpha",
        title_source: "default",
        access: "owner",
      },
      {
        thread_id: "thread-job",
        title: "Daily digest",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-07-02T09:00:00.000Z",
        avatar_seed: "seed-job",
        title_source: "job",
        kind: "scheduled_task",
        scheduled_job_id: "cron-daily",
        access: "owner",
      },
    ]);
    renderSideNav();

    await screen.findByText("Daily digest");
    expect(screen.queryByText("No scheduled tasks yet")).toBeNull();

    const jobRow = screen.getByTestId("agent-side-nav-row-thread-job");
    expect(jobRow.getAttribute("data-job-stream")).toBe("true");
    expect(screen.queryByTestId("agent-dither-thread-job")).toBeNull();
    // Interactive agent still has dither.
    expect(screen.getByTestId("agent-dither-thread-alpha")).toBeTruthy();
  });

  it("I3: Agent menu item writes catalog and opens that 1:1", async () => {
    renderSideNav();

    fireEvent.click(await screen.findByRole("button", { name: "New Agent" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Agent" }));

    await waitFor(() => {
      expect(createAgent).toHaveBeenCalledWith({});
    });
    expect(createChatThread).not.toHaveBeenCalled();
  });

  it("shows dither avatars from avatar_seed on owned agent rows (no chat bubble)", async () => {
    listChatThreads.mockResolvedValue([
      {
        thread_id: "thread-alpha",
        title: "Alpha chat",
        project_id: "p1",
        project_vault_path: "/Projects/A",
        created_at: "2026-07-01T12:00:00.000Z",
        avatar_seed: "seed-alpha-unique",
        title_source: "default",
        access: "owner",
      },
    ]);
    renderSideNav();

    await screen.findByText("Alpha chat");
    const dither = await screen.findByTestId("agent-dither-thread-alpha");
    expect(dither.getAttribute("data-avatar-seed")).toBe("seed-alpha-unique");
    expect(screen.getByTestId("agent-side-nav-row-thread-alpha")).toBeTruthy();
    expect(
      screen.getByTestId("agent-side-nav-subtitle-thread-alpha").textContent,
    ).toMatch(/Jul 1/);
    // Owned agents must not use the chat bubble icon as the leading glyph.
    expect(screen.queryByTestId("agent-side-nav-share-icon")).toBeNull();
  });

  it("shows truncated latest activity as subtitle when preview is set (lp-lv9.3)", async () => {
    listChatThreads.mockResolvedValue([
      {
        thread_id: "thread-alpha",
        title: "Named agent",
        project_id: "p1",
        project_vault_path: "/Projects/A",
        created_at: "2026-07-01T12:00:00.000Z",
        avatar_seed: "seed-alpha",
        title_source: "llm",
        access: "owner",
      },
    ]);

    function ActivityPreviewSeeder() {
      const { setThreadActivityPreview, threads } = useChatThread();
      useEffect(() => {
        if (threads.some((t) => t.thread_id === "thread-alpha")) {
          setThreadActivityPreview(
            "thread-alpha",
            "This is a very long last user message that should be truncated for the subtitle line in the agent side nav row",
          );
        }
      }, [setThreadActivityPreview, threads]);
      return null;
    }

    render(
      <Theme theme={neutralTheme}>
        <PortalHonestyProvider>
          <ChatThreadProvider>
            <ActivityPreviewSeeder />
            <ChatHistorySideNav />
          </ChatThreadProvider>
        </PortalHonestyProvider>
      </Theme>,
    );

    await screen.findByText("Named agent");
    await waitFor(() => {
      const sub = screen.getByTestId("agent-side-nav-subtitle-thread-alpha");
      expect(sub.textContent).toMatch(/This is a very long/i);
      expect(sub.textContent?.endsWith("…")).toBe(true);
    });
  });

  it("does not show Directory honesty or project folders in the Agents sidenav", async () => {
    renderSideNav({}, { brainRpcEnabled: false });

    await screen.findByText("Alpha chat");
    expect(
      screen.queryByTestId("honesty-banner-directory-brain-rpc-off"),
    ).toBeNull();
    expect(
      screen.queryByTestId("honesty-banner-directory-empty-host"),
    ).toBeNull();
    expect(screen.queryByText(/No agent projects yet/i)).toBeNull();
    expect(screen.queryByText(/No projects in Directory/i)).toBeNull();
  });

  it("uses icon-only + create menu when the SideNav is collapsed (lp-fn5.2.1)", async () => {
    renderSideNav();

    await screen.findByRole("button", { name: "New Agent" });

    // Astryx SideNav collapse toggle (footer control), not project expand chevrons.
    const collapseToggle = screen.getByRole("button", {
      name: "Collapse sidebar",
    });
    fireEvent.click(collapseToggle);

    await waitFor(() => {
      const createBtn = screen.getByRole("button", { name: "New Agent" });
      expect(createBtn.getAttribute("aria-label")).toBe("New Agent");
      // Still a single create control — no separate New project button.
      expect(screen.queryByRole("button", { name: "New project" })).toBeNull();
    });

    fireEvent.click(screen.getByRole("button", { name: "New Agent" }));
    expect(
      await screen.findByRole("menuitem", { name: "Agent" }),
    ).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Channel" })).toBeTruthy();
    expect(
      screen.queryByRole("menuitem", { name: "Scheduled Task" }),
    ).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Project" })).toBeNull();
  });

  it("selects the Agents folder while an interactive 1:1 is active", async () => {
    renderSideNav();

    await screen.findByText("Alpha chat");
    const agentsFolder = screen.getByTestId("agents-folder");
    expect(agentsFolder).toBeTruthy();
    const selected = agentsFolder.closest(
      "[aria-current='page'], [aria-current='true'], [data-selected='true'], [aria-selected='true']",
    );
    if (selected) {
      expect(selected).toBeTruthy();
    }
  });

  it("renders StatusDot with Idle label by default (session-local neutral)", async () => {
    renderSideNav();
    await screen.findByText("Alpha chat");

    const idleDots = screen.getAllByLabelText("Idle");
    expect(idleDots.length).toBeGreaterThanOrEqual(2);
  });

  it("shows cached generating / success labels when statuses are set", async () => {
    function SeededSideNav() {
      const { setThreadResponseStatus, threads } = useChatThread();
      useEffect(() => {
        if (threads.some((t) => t.thread_id === "thread-alpha")) {
          setThreadResponseStatus("thread-alpha", "generating");
          setThreadResponseStatus("thread-general", "success");
        }
      }, [setThreadResponseStatus, threads]);
      return <ChatHistorySideNav />;
    }

    render(
      <Theme theme={neutralTheme}>
        <ChatThreadProvider>
          <SeededSideNav />
        </ChatThreadProvider>
      </Theme>,
    );

    await screen.findByText("Alpha chat");
    await waitFor(() => {
      expect(screen.getByLabelText("Generating…")).toBeTruthy();
      expect(screen.getByLabelText("Response complete")).toBeTruthy();
    });
  });

  async function openChatDeleteMenu(threadTitle = "Alpha chat") {
    const label = await screen.findByText(threadTitle);
    // StatusDot is default; hover reveals MoreMenu (skeleton ConversationItem pattern).
    const row = label.closest("a") ?? label.parentElement;
    expect(row).toBeTruthy();
    fireEvent.mouseEnter(row!);

    const moreMenu = await screen.findByRole("button", {
      name: `Chat actions for ${threadTitle}`,
    });
    fireEvent.click(moreMenu);

    // Prefer menuitem if present; Astryx may render plain buttons.
    // Project rows also expose Delete — pick the last opened (chat) control.
    const menuDeletes = screen.queryAllByRole("menuitem", { name: /^Delete$/ });
    const buttonDeletes = screen.queryAllByRole("button", { name: /^Delete$/ });
    const deleteControl =
      menuDeletes[menuDeletes.length - 1] ??
      buttonDeletes[buttonDeletes.length - 1];
    expect(deleteControl).toBeTruthy();
    fireEvent.click(deleteControl!);
  }

  it("deletes a chat via hover MoreMenu and confirm dialog (no window.confirm)", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");

    renderSideNav();
    await openChatDeleteMenu("Alpha chat");

    // Astryx Dialog confirmation — not the browser system confirm.
    await screen.findByRole("heading", { name: /Delete agent\?/i });
    expect(screen.getByText(/cannot be undone/i)).toBeTruthy();
    expect(confirmSpy).not.toHaveBeenCalled();

    // Dialog footer Delete (destructive) — not the MoreMenu item.
    const dialogDelete = screen.getByRole("button", { name: /^Delete$/ });
    fireEvent.click(dialogDelete);

    await waitFor(() => {
      expect(deleteChatThread).toHaveBeenCalledWith("thread-alpha");
    });
    expect(confirmSpy).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it("Cancel on delete chat dialog does not call the delete API", async () => {
    const confirmSpy = vi.spyOn(window, "confirm");

    renderSideNav();
    await openChatDeleteMenu("Alpha chat");

    await screen.findByRole("heading", { name: /Delete agent\?/i });
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: /Delete agent\?/i }),
      ).toBeNull();
    });
    expect(deleteChatThread).not.toHaveBeenCalled();
    expect(confirmSpy).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });

  it("I13: agent delete confirm names the cascade and calls the thread delete API", async () => {
    renderSideNav();
    await openChatDeleteMenu("Alpha chat");

    await screen.findByRole("heading", { name: /Delete agent\?/i });
    const subtitle = screen.getByText(/permanently removed/i);
    expect(subtitle.textContent).toMatch(/leave every channel/i);
    expect(subtitle.textContent).toMatch(/fewer than two members/i);
    expect(subtitle.textContent).toMatch(/scheduled tasks are unbound/i);

    fireEvent.click(screen.getByRole("button", { name: /^Delete$/ }));
    await waitFor(() => {
      expect(deleteChatThread).toHaveBeenCalledWith("thread-alpha");
    });
    expect(deleteChannel).not.toHaveBeenCalled();
  });

  it("project soft-archive confirm copy is honest about files staying on disk", () => {
    const msg = projectSoftArchiveConfirmMessage("Alpha");
    expect(msg).toMatch(/Directory/i);
    expect(msg).toMatch(/archiv/i);
    expect(msg).toMatch(/stay on the agent disk/i);
    expect(msg).not.toMatch(/permanently delete files|purge|rmtree/i);
  });

  it("does not offer project folder delete from the Agents sidenav", async () => {
    renderSideNav();
    await screen.findByText("Alpha chat");
    expect(
      screen.queryByRole("button", { name: /Project actions/i }),
    ).toBeNull();
    expect(deleteProject).not.toHaveBeenCalled();
  });

  it("shows Share in MoreMenu for owned threads and opens the share dialog", async () => {
    renderSideNav();
    const alpha = await screen.findByText("Alpha chat");
    const row = alpha.closest("a") ?? alpha.parentElement;
    fireEvent.mouseEnter(row!);

    const moreMenu = await screen.findByRole("button", {
      name: "Chat actions for Alpha chat",
    });
    fireEvent.click(moreMenu);

    await waitFor(() => {
      expect(
        screen.getAllByRole("menuitem", { name: /Share/i }).length,
      ).toBeGreaterThan(0);
      expect(
        screen.getAllByRole("menuitem", { name: /Delete/i }).length,
      ).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getAllByRole("menuitem", { name: /Share/i })[0]!);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Share chat")).toBeTruthy();

    await waitFor(() => {
      expect(listOrgMembers).toHaveBeenCalled();
    });
    const bob = await screen.findByText("bob@demo.test");
    fireEvent.click(bob);
    fireEvent.click(within(dialog).getByRole("button", { name: "Share" }));

    await waitFor(() => {
      expect(createChatThreadShare).toHaveBeenCalledWith({
        threadId: "thread-alpha",
        granteeEmail: "bob@demo.test",
        mode: "read",
      });
    });
  });

  it("does not offer Share/Delete on shared-with-me threads", async () => {
    listChatThreads.mockResolvedValue([
      {
        thread_id: "thread-shared",
        title: "Shared with me",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-07-01T12:00:00.000Z",
      avatar_seed: "seed-test",
      title_source: "default",
        access: "read",
        owner_user_id: "owner-1",
      },
    ]);

    renderSideNav();
    const shared = await screen.findByText("Shared with me");
    const row = shared.closest("a") ?? shared.parentElement;
    fireEvent.mouseEnter(row!);

    expect(
      screen.queryByRole("button", {
        name: "Chat actions for Shared with me",
      }),
    ).toBeNull();
    // Invitee affordance: Read access badge + StatusDot; no owner MoreMenu.
    // Badge may render label text more than once in the DOM tree.
    expect(screen.getAllByText("Read").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByLabelText("Idle").length).toBeGreaterThanOrEqual(1);
  });

  it("does not offer Share/Delete for collaborate access either", async () => {
    listChatThreads.mockResolvedValue([
      {
        thread_id: "thread-collab",
        title: "Collab chat",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-07-01T12:00:00.000Z",
      avatar_seed: "seed-test",
      title_source: "default",
        access: "collaborate",
        owner_user_id: "owner-1",
      },
    ]);

    renderSideNav();
    const collab = await screen.findByText("Collab chat");
    const row = collab.closest("a") ?? collab.parentElement;
    fireEvent.mouseEnter(row!);

    expect(
      screen.queryByRole("button", {
        name: "Chat actions for Collab chat",
      }),
    ).toBeNull();
    // Invitee affordance: Collaborate badge for collab grants.
    expect(screen.getAllByText("Collaborate").length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("has no Projects create path in the + menu", async () => {
    renderSideNav();
    fireEvent.click(await screen.findByRole("button", { name: "New Agent" }));
    expect(await screen.findByRole("menuitem", { name: "Channel" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Project" })).toBeNull();
    expect(screen.queryByText("New project")).toBeNull();
    expect(createProject).not.toHaveBeenCalled();
  });

  it("shows empty-state rows under Channels and Agents when there are no chats", async () => {
    fetchProjects.mockResolvedValue([]);
    listChatThreads.mockResolvedValue([]);
    createChatThread.mockResolvedValue({
      thread_id: "thread-empty",
      title: "New chat",
      project_id: null,
      project_vault_path: null,
      created_at: "2026-07-01T13:00:00.000Z",
      avatar_seed: "seed-test",
      title_source: "default",
    });

    renderSideNav();

    expect(await screen.findByText("No channels yet")).toBeTruthy();
    expect(screen.getByText("No agents yet")).toBeTruthy();
    expect(screen.getByText("No scheduled tasks yet")).toBeTruthy();
    expect(screen.queryByText(/No agent projects yet/i)).toBeNull();
    expect(screen.queryByTestId("honesty-banner-directory-unavailable")).toBeNull();
  });

  it("composites scheduled-task status from cron snapshot (Off / error / live fire) (lp-lv9.2)", async () => {
    listChatThreads.mockResolvedValue([
      {
        thread_id: "thread-off",
        title: "Disabled job",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-08-01T10:00:00.000Z",
        avatar_seed: "seed-off",
        title_source: "job",
        kind: "scheduled_task",
        scheduled_job_id: "cron-off",
        access: "owner",
      },
      {
        thread_id: "thread-fail",
        title: "Failed job",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-08-01T11:00:00.000Z",
        avatar_seed: "seed-fail",
        title_source: "job",
        kind: "scheduled_task",
        scheduled_job_id: "cron-fail",
        access: "owner",
      },
      {
        thread_id: "thread-live",
        title: "Live job",
        project_id: null,
        project_vault_path: null,
        created_at: "2026-08-01T12:00:00.000Z",
        avatar_seed: "seed-live",
        title_source: "job",
        kind: "scheduled_task",
        scheduled_job_id: "cron-live",
        access: "owner",
      },
    ]);
    fetchSettingsSnapshot.mockResolvedValue({
      exported_at: "2026-08-01T00:00:00.000Z",
      skills: [],
      crons: [
        {
          id: "cron-off",
          name: "Disabled job",
          schedule: "0 9 * * *",
          enabled: false,
          last_status: "error",
        },
        {
          id: "cron-fail",
          name: "Failed job",
          schedule: "0 10 * * *",
          enabled: true,
          last_status: "error",
        },
        {
          id: "cron-live",
          name: "Live job",
          schedule: "0 11 * * *",
          enabled: true,
          last_status: "ok",
        },
      ],
      mcp_servers: [],
      models: [],
      integrations: [],
    });

    function CompositeSideNav() {
      const { setThreadResponseStatus, threads } = useChatThread();
      useEffect(() => {
        if (threads.some((t) => t.thread_id === "thread-live")) {
          setThreadResponseStatus("thread-live", "generating");
        }
      }, [setThreadResponseStatus, threads]);
      return <ChatHistorySideNav />;
    }

    render(
      <Theme theme={neutralTheme}>
        <PortalHonestyProvider>
          <SettingsSnapshotProvider>
            <ChatThreadProvider>
              <CompositeSideNav />
            </ChatThreadProvider>
          </SettingsSnapshotProvider>
        </PortalHonestyProvider>
      </Theme>,
    );

    await screen.findByText("Disabled job");

    await waitFor(() => {
      const offRow = screen.getByTestId("agent-side-nav-row-thread-off");
      expect(offRow.getAttribute("data-job-off")).toBe("true");
      expect(offRow.getAttribute("data-status")).toBe("off");
    });

    const failRow = screen.getByTestId("agent-side-nav-row-thread-fail");
    expect(failRow.getAttribute("data-job-off")).toBe("false");
    expect(failRow.getAttribute("data-status")).toBe("error");
    expect(screen.getByLabelText("Response failed")).toBeTruthy();

    await waitFor(() => {
      const liveRow = screen.getByTestId("agent-side-nav-row-thread-live");
      expect(liveRow.getAttribute("data-status")).toBe("generating");
      expect(screen.getByLabelText("Generating…")).toBeTruthy();
    });

    // Off label present; disabled job must not surface Response failed alone as its status.
    expect(screen.getByLabelText("Off")).toBeTruthy();
  });
});
