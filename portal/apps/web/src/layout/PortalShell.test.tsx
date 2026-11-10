import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../app/providers.js";
import { PortalShell } from "./PortalShell.js";
import { renderWithPortalRouter } from "../test/MemoryPortalRouter.js";

type Listener = (event: Event) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  private listeners = new Map<string, Set<Listener>>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: Listener): void {
    const handlers = this.listeners.get(type) ?? new Set<Listener>();
    handlers.add(handler);
    this.listeners.set(type, handlers);
  }

  close(): void {}

  emit(type: string, data: string): void {
    const event = { data } as MessageEvent;
    for (const handler of this.listeners.get(type) ?? []) {
      handler(event);
    }
  }
}

vi.mock("../api/projects.js", () => ({
  fetchProjects: vi.fn(),
}));

vi.mock("../api/chat.js", () => ({
  listChatThreads: vi.fn(),
  createChatThread: vi.fn(),
  updateChatThreadTitle: vi.fn(),
  assignChatThreadName: vi.fn().mockResolvedValue({
    applied: false,
    name_source: null,
    skipped_reason: null,
  }),
  sendChatMessage: vi.fn(),
  kickSpeculativeEnsureOnline: vi.fn().mockResolvedValue(undefined),
  sendMcqSelection: vi.fn(),
  fetchThreadHistory: vi.fn().mockResolvedValue([]),
  uploadStagingFile: vi.fn(),
}));

vi.mock("../api/vault.js", () => ({
  fetchVaultTree: vi.fn(),
  fetchVaultContent: vi.fn(),
  searchVaultIndex: vi.fn(),
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

vi.mock("../api/settings.js", () => ({
  fetchSettingsSnapshot: vi.fn(),
  refreshSettingsHealth: vi.fn(),
}));

vi.mock("../api/connectors.js", () => ({
  fetchConnectors: vi.fn(),
  fetchConnectorsTeam: vi.fn(),
  putConnectorGrant: vi.fn(),
  clearHubSpotPin: vi.fn(),
  patchConnectorSticky: vi.fn(),
  sendToolApprovalDecision: vi.fn(),
  startConnectorOAuth: vi.fn(),
  isConnectorOAuthMessage: () => false,
}));

vi.mock("../api/auth.js", () => ({
  logout: vi.fn(),
}));

import { logout } from "../api/auth.js";
import { fetchProjects } from "../api/projects.js";
import {
  createChatThread,
  listChatThreads,
  sendChatMessage,
  sendMcqSelection,
  updateChatThreadTitle,
  uploadStagingFile,
} from "../api/chat.js";
import {
  fetchVaultContent,
  fetchVaultTree,
  searchVaultIndex,
} from "../api/vault.js";
import { fetchConnectors, fetchConnectorsTeam } from "../api/connectors.js";
import {
  fetchSettingsSnapshot,
  refreshSettingsHealth,
} from "../api/settings.js";

async function renderShell(onLogout?: () => void) {
  return renderWithPortalRouter(
    <Providers>
      <PortalShell
        user={{
          user_id: "user-1",
          email: "dev@demo.local",
          tenant_id: "tenant-1",
        }}
        onLogout={onLogout}
      />
    </Providers>,
  );
}

function composerInput(): HTMLElement {
  // With typeahead triggers, ChatComposerInput exposes combobox (not textbox).
  return screen.getByRole("combobox", { name: "Message input" });
}

function setComposerValue(value: string): void {
  const input = composerInput();
  input.textContent = value;
  fireEvent.input(input, { target: input });
}

async function openAccountMenu(): Promise<void> {
  const trigger = screen.getByRole("button", { name: "Account menu" });
  fireEvent.focus(trigger);
  fireEvent.mouseEnter(trigger);
  expect(await screen.findByRole("button", { name: "Logout" })).toBeTruthy();
}

describe("PortalShell", () => {
  beforeEach(() => {
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ snapshot: {} }), { status: 200 }),
      ),
    );

    vi.mocked(fetchProjects).mockResolvedValue([
      {
        project_id: "p1",
        name: "Alpha",
        vault_path: "/Projects/A",
        parent_project_id: null,
      },
    ]);
    vi.mocked(listChatThreads).mockResolvedValue([
      {
        thread_id: "thread-1",
        title: "Existing chat",
        project_id: "p1",
        project_vault_path: "/Projects/A",
        created_at: "2026-07-01T12:00:00.000Z",
      avatar_seed: "seed-test",
      title_source: "default",
        access: "owner",
      },
    ]);
    vi.mocked(createChatThread).mockResolvedValue({
      thread_id: "thread-new",
      title: "New chat",
      project_id: null,
      project_vault_path: null,
      created_at: "2026-07-01T13:00:00.000Z",
      avatar_seed: "seed-test",
      title_source: "default",
    });
    vi.mocked(updateChatThreadTitle).mockResolvedValue({
      thread_id: "thread-1",
      title: "Existing chat",
      project_id: "p1",
      project_vault_path: "/Projects/A",
      created_at: "2026-07-01T12:00:00.000Z",
      avatar_seed: "seed-test",
      title_source: "default",
    });
    vi.mocked(sendChatMessage).mockResolvedValue(undefined);
    vi.mocked(sendMcqSelection).mockResolvedValue(undefined);
    vi.mocked(uploadStagingFile).mockResolvedValue({
      path: "/staging/notes.txt",
      filename: "notes.txt",
    });
    vi.mocked(fetchVaultTree).mockResolvedValue({ roots: [] } as never);
    vi.mocked(fetchVaultContent).mockReset();
    vi.mocked(searchVaultIndex).mockResolvedValue({
      hits: [],
      last_indexed_at: null,
    } as never);
    vi.mocked(fetchSettingsSnapshot).mockResolvedValue({
      exported_at: "2026-07-01T08:00:00.000Z",
      skills: [
        {
          id: "post-meeting-triage",
          name: "Post-meeting triage",
          path: "skills/crm/post-meeting-triage",
          enabled: true,
        },
      ],
      crons: [],
      mcp_servers: [],
      models: [],
      integrations: [],
    });
    vi.mocked(refreshSettingsHealth).mockResolvedValue({
      checked_at: "2026-07-01T08:05:00.000Z",
      integrations: [],
    });
    vi.mocked(fetchConnectorsTeam).mockResolvedValue(null);
    vi.mocked(fetchConnectors).mockResolvedValue({
      connectors: [
        {
          connector_id: "google",
          status: "not_connected",
          account_label: null,
          sticky: {},
          entitled: true,
          role_granted: true,
          hubspot_portal_id: null,
        },
        {
          connector_id: "hubspot",
          status: "not_connected",
          account_label: null,
          sticky: {},
          entitled: true,
          role_granted: true,
          hubspot_portal_id: null,
        },
        {
          connector_id: "whatsapp",
          status: "not_connected",
          account_label: null,
          sticky: {},
          entitled: true,
          role_granted: true,
          hubspot_portal_id: null,
        },
      ],
    });
    vi.mocked(logout).mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders migrated tabs and switches between feature views", async () => {
    await renderShell();

    const topNav = screen.getByRole("navigation", { name: "Lanyard Portal" });
    expect(within(topNav).getByRole("button", { name: "Agents" })).toBeTruthy();
    expect(within(topNav).getByRole("button", { name: "Vault" })).toBeTruthy();
    expect(within(topNav).queryByRole("button", { name: "Connectors" })).toBeNull();
    // Chip + HoverCard content both render the email.
    expect(screen.getAllByText("dev@demo.local").length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole("button", { name: "Vault" }));
    expect(await screen.findByLabelText("Search")).toBeTruthy();
    expect(screen.queryByText("Live tree")).toBeNull();

    await openAccountMenu();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const connectors = await screen.findByTestId("connectors-page");
    expect(within(connectors).getByText("Apps")).toBeTruthy();
    expect(within(connectors).getByText("Skills")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Skills" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Overview" })).toBeNull();
    // Tools rail: type selectors only — no Settings / Agent & tools chrome.
    expect(screen.queryByText("Agent & tools")).toBeNull();
    expect(within(topNav).queryByRole("button", { name: "Connectors" })).toBeNull();
  });

  it("re-fetches settings snapshot when navigating to Settings (lp-a8u.7)", async () => {
    await renderShell();

    // Provider auto-loads on shell mount (Chat active).
    await waitFor(() => {
      expect(fetchSettingsSnapshot).toHaveBeenCalled();
    });
    const afterMount = fetchSettingsSnapshot.mock.calls.length;

    await openAccountMenu();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByTestId("connectors-page")).toBeTruthy();

    // Navigating to Settings should refresh snapshot (lp-a8u.7).
    await waitFor(() => {
      expect(fetchSettingsSnapshot.mock.calls.length).toBeGreaterThan(afterMount);
    });
    const afterTools = fetchSettingsSnapshot.mock.calls.length;

    // Manual refresh control is present and accessible.
    expect(
      screen.getByRole("button", { name: "Refresh settings snapshot" }),
    ).toBeTruthy();

    // Leaving and re-entering Settings refreshes again.
    fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    await openAccountMenu();
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    await waitFor(() => {
      expect(fetchSettingsSnapshot.mock.calls.length).toBeGreaterThan(afterTools);
    });
  });

  it("keeps chat timeline messages mounted across Agents → Vault → Agents", async () => {
    await renderShell();

    await waitFor(() => {
      expect(listChatThreads).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(composerInput()).toBeTruthy();
    });

    setComposerValue("Keepalive timeline text");
    fireEvent.keyDown(composerInput(), { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(sendChatMessage).toHaveBeenCalledWith({
        threadId: "thread-1",
        text: "Keepalive timeline text",
        stagingPaths: [],
      });
    });

    const timeline = screen.getByRole("log");
    expect(within(timeline).getByText("Keepalive timeline text")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Vault" }));
    expect(await screen.findByLabelText("Search")).toBeTruthy();
    // Chat stays mounted (CSS-hidden / aria-hidden) so timeline state is preserved.
    // Testing Library skips hidden roles by default — include them explicitly.
    const hiddenTimeline = screen.getByRole("log", { hidden: true });
    expect(
      within(hiddenTimeline).getByText("Keepalive timeline text"),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    expect(
      within(screen.getByRole("log")).getByText("Keepalive timeline text"),
    ).toBeTruthy();
    expect(sendChatMessage).toHaveBeenCalledTimes(1);
  });

  it("logs out from the profile HoverCard and notifies the session", async () => {
    const onLogout = vi.fn();
    await renderShell(onLogout);

    await openAccountMenu();

    fireEvent.click(screen.getByRole("button", { name: "Logout" }));

    await waitFor(() => {
      expect(logout).toHaveBeenCalledTimes(1);
      expect(onLogout).toHaveBeenCalledTimes(1);
    });
  });

  it("switch account ends the session the same way as logout", async () => {
    const onLogout = vi.fn();
    await renderShell(onLogout);

    await openAccountMenu();

    fireEvent.click(screen.getByRole("button", { name: "Switch account" }));

    await waitFor(() => {
      expect(logout).toHaveBeenCalledTimes(1);
      expect(onLogout).toHaveBeenCalledTimes(1);
    });
  });

  it("shows only the user chip in top nav and chat history in side nav", async () => {
    await renderShell();

    expect(screen.getAllByText("dev@demo.local").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "Account menu" })).toBeTruthy();

    // Project selector and New chat must not live in the top navigation bar.
    const topNav = screen.getByRole("navigation", { name: "Lanyard Portal" });
    expect(topNav.querySelector('[aria-label="Select project for new chat"]')).toBeNull();
    expect(topNav.querySelector('[aria-label="Project"]')).toBeNull();

    // Unified + create menu lives in the collapsible chat history side nav (lp-fn5.2.1 / lp-7st.2).
    const createButtons = await screen.findAllByRole("button", {
      name: "New Agent",
    });
    expect(createButtons.length).toBeGreaterThanOrEqual(1);

    await waitFor(() => {
      // Desktop SideNav renders history rows; MobileNav mounts only on
      // mobile viewports (single copy in the a11y tree on desktop).
      expect(screen.getAllByText("Existing chat").length).toBeGreaterThanOrEqual(1);
      expect(screen.queryByText("Alpha")).toBeNull();
    });

    // Top nav must not host a Project selector label control.
    expect(screen.queryByLabelText("Project")).toBeNull();
  });

  it("lp-vnz.8: citation chip opens document pane; Open in Vault deep-links Vault tab", async () => {
    vi.mocked(fetchVaultContent).mockResolvedValue({
      path: "/Projects/A/README.md",
      mime_type: "text/markdown",
      encoding: "utf-8",
      content: "# Team A from citation\n",
    });
    vi.mocked(fetchVaultTree).mockResolvedValue({
      roots: [
        {
          name: "Projects",
          path: "/Projects",
          kind: "directory",
          children: [
            {
              name: "A",
              path: "/Projects/A",
              kind: "directory",
              children: [
                {
                  name: "README.md",
                  path: "/Projects/A/README.md",
                  kind: "file",
                  mime_type: "text/markdown",
                },
              ],
            },
          ],
        },
      ],
    } as never);

    await renderShell();

    await waitFor(() => {
      expect(listChatThreads).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(MockEventSource.instances.length).toBeGreaterThan(0);
    });

    // Prefer the active thread stream (ChatView opens /api/chat/threads/:id/events).
    const source =
      MockEventSource.instances.find((s) =>
        s.url.includes("/api/chat/threads/"),
      ) ?? MockEventSource.instances.at(-1)!;

    await act(async () => {
      source.emit(
        "message_send",
        JSON.stringify({
          type: "message_send",
          chat_id: "thread-1",
          message_id: "msg-cite-1",
          content: "See the project notes for details.",
          citations: [
            { path: "/Projects/A/README.md", title: "README.md" },
          ],
        }),
      );
      await Promise.resolve();
    });

    // Message body may appear more than once (timeline + pane); accept >=1.
    expect(
      (await screen.findAllByText("See the project notes for details.")).length,
    ).toBeGreaterThanOrEqual(1);

    // Footer citation chip (no [1] marker in prose).
    const citation = await screen.findByTestId("vault-citation-1");
    fireEvent.click(citation);

    // Primary path (lp-5q6.14 / lp-vnz.8): stay on Chat and open document pane.
    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });
    await waitFor(() => {
      expect(fetchVaultContent).toHaveBeenCalledWith("/Projects/A/README.md");
    });
    await waitFor(() => {
      expect(screen.getByText("Team A from citation")).toBeTruthy();
    });
    // Chat tab remains selected — do not switch away for the primary open.
    // Astryx TabList uses buttons with data-tab-value + data-selected.
    expect(
      document.querySelector('[data-tab-value="chat"]')?.getAttribute("data-selected"),
    ).toBe("selected");

    // Secondary path: toolbar deep-links the Vault browser for that path.
    fireEvent.click(screen.getByRole("button", { name: "Open in Vault" }));
    await waitFor(() => {
      expect(
        document
          .querySelector('[data-tab-value="vault"]')
          ?.getAttribute("data-selected"),
      ).toBe("selected");
    });
    // Vault search field is visible when the Vault tab is active.
    expect(screen.getByLabelText("Search")).toBeTruthy();
  });
});
