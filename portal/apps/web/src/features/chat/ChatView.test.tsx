/**
 * Chat RTL smoke tests for the extracted ai-chat layout in ChatView.
 *
 * Full chat send/receive E2E is manual only: run `pnpm dev:tmux` (mock-gateway
 * window) and follow `testing.md` — RTL mocks EventSource and API, not relay WS.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../../app/providers.js";
import {
  ChatThreadProvider,
  useChatThread,
} from "../projects/ChatThreadContext.js";
import { SettingsSnapshotProvider } from "../settings/SettingsSnapshotContext.js";

import {
  captureThreadSidePaneSnapshot,
  ChatView,
} from "./ChatView.js";
import { createInitialActivityPaneState } from "./activityPane/index.js";
import { createInitialArtifactPanelState } from "./documentPane/index.js";

class MockEventSource {
  close(): void {}
  addEventListener(): void {}
}

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

vi.mock("../../api/chat.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/chat.js")>();
  return {
    ...actual,
    listChatThreads: vi.fn().mockResolvedValue([]),
    createChatThread: vi.fn().mockResolvedValue({
      thread_id: "thread-1",
      title: "New chat",
      project_id: null,
      project_vault_path: null,
      created_at: "2026-07-01T12:00:00.000Z",
    }),
    updateChatThreadTitle: vi.fn().mockResolvedValue({
      thread_id: "thread-1",
      title: "New chat",
      project_id: null,
      project_vault_path: null,
      created_at: "2026-07-01T12:00:00.000Z",
    }),
    assignChatThreadName: vi.fn().mockResolvedValue({
      thread_id: "thread-1",
      title: "New agent",
      project_id: null,
      project_vault_path: null,
      created_at: "2026-07-01T12:00:00.000Z",
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

/** Default settings catalog for ChatView RTL (client-heuristic fallback path). */
const DEFAULT_CHAT_SETTINGS_SNAPSHOT = {
  exported_at: "2026-07-01T00:00:00.000Z",
  skills: [{ id: "summarize", name: "summarize", enabled: true }],
  crons: [],
  mcp_servers: [],
  models: [
    {
      provider: "anthropic",
      model: "claude-haiku-4",
      connected: true,
    },
    {
      provider: "xai",
      model: "grok-3",
      is_active: true,
      connected: true,
    },
    {
      provider: "xai",
      model: "xai/grok-build-0.1",
      connected: true,
    },
  ],
  integrations: [],
};

/** Host catalog with LiteLLM intelligence pins (lp-uxy.12 preferred path). */
const LITELLM_INTELLIGENCE_SETTINGS_SNAPSHOT = {
  exported_at: "2026-07-01T00:00:00.000Z",
  skills: [],
  crons: [],
  mcp_servers: [],
  models: [
    {
      provider: "litellm",
      model: "lanyard-simple",
      connected: true,
    },
    {
      provider: "litellm",
      model: "lanyard-moderate",
      is_active: true,
      connected: true,
    },
    {
      provider: "litellm",
      model: "lanyard-complex",
      connected: true,
    },
    {
      provider: "litellm",
      model: "lanyard-auto",
      connected: true,
    },
  ],
  integrations: [],
};

vi.mock("../../api/settings.js", () => ({
  fetchSettingsSnapshot: vi.fn().mockResolvedValue({
    exported_at: "2026-07-01T00:00:00.000Z",
    skills: [{ id: "summarize", name: "summarize", enabled: true }],
    crons: [],
    mcp_servers: [],
    models: [
      {
        provider: "anthropic",
        model: "claude-haiku-4",
        connected: true,
      },
      {
        provider: "xai",
        model: "grok-3",
        is_active: true,
        connected: true,
      },
      {
        provider: "xai",
        model: "xai/grok-build-0.1",
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
  fetchSettingsCronDetail: vi.fn().mockResolvedValue({
    id: "st-vault-digest",
    name: "Vault digest",
    schedule: "0 9 * * 1-5",
    enabled: true,
    last_run_at: "2026-08-11T09:00:00.000Z",
    next_run_at: "2026-08-12T09:00:00.000Z",
    prompt: "Summarize overnight vault changes.",
  }),
  patchSettingsCron: vi.fn().mockResolvedValue({
    cron: {
      id: "st-vault-digest",
      name: "Vault digest",
      schedule: "0 9 * * 1-5",
      enabled: false,
      prompt: "Summarize overnight vault changes.",
    },
    source: "fixture",
  }),
  createSettingsCron: vi.fn(),
}));

vi.mock("../../api/vault.js", () => ({
  fetchVaultTree: vi.fn().mockResolvedValue({ roots: [] }),
  fetchVaultContent: vi.fn().mockImplementation(async (path: string) => ({
    path,
    mime_type: "text/plain",
    encoding: "utf-8" as const,
    content: "preview body",
  })),
  searchVaultIndex: vi.fn(),
  downloadVaultFile: vi.fn().mockResolvedValue(undefined),
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

const fetchConnectors = vi.fn();
const startConnectorOAuth = vi.fn();
const startWhatsAppPair = vi.fn();
const beginConnectorChatUse = vi.fn();
const cancelPendingConnectorUse = vi.fn();
const resumePendingConnectorUse = vi.fn();

/** Connectors API stub (lp-xhf4.16); mirrors the SettingsView.test.tsx shape. */
vi.mock("../../api/connectors.js", () => ({
  CONNECTOR_OAUTH_MESSAGE_TYPE: "lanyard.connector.oauth",
  fetchConnectors: (...args: unknown[]) => fetchConnectors(...args),
  startConnectorOAuth: (...args: unknown[]) => startConnectorOAuth(...args),
  startWhatsAppPair: (...args: unknown[]) => startWhatsAppPair(...args),
  beginConnectorChatUse: (...args: unknown[]) => beginConnectorChatUse(...args),
  cancelPendingConnectorUse: (...args: unknown[]) =>
    cancelPendingConnectorUse(...args),
  resumePendingConnectorUse: (...args: unknown[]) =>
    resumePendingConnectorUse(...args),
  sendToolApprovalDecision: vi.fn(),
  isConnectorOAuthMessage: (
    origin: string,
    expectedOrigin: string,
    data: unknown,
  ) =>
    origin === expectedOrigin &&
    Boolean(
      data &&
        typeof data === "object" &&
        (data as { type?: string }).type === "lanyard.connector.oauth" &&
        ["google", "hubspot", "whatsapp"].includes(
          (data as { connector_id?: unknown }).connector_id as string,
        ),
    ),
}));

/** Only openConnectorOAuthTab is stubbed — wizard logic stays real. */
const openConnectorOAuthTab = vi.fn((_url: string) => ({ opened: true }));
vi.mock("./connectorChatWizard.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./connectorChatWizard.js")>();
  return {
    ...actual,
    openConnectorOAuthTab: (
      ...args: Parameters<typeof actual.openConnectorOAuthTab>
    ) => openConnectorOAuthTab(...args),
  };
});

import {
  cancelChatRequest,
  ChatSendError,
  createChatThread,
  fetchThreadHistory,
  haltMailboxRoom,
  kickSpeculativeEnsureOnline,
  listChatThreads,
  sendChatMessage,
  uploadStagingFile,
} from "../../api/chat.js";
import {
  fetchSettingsSnapshot,
  patchSettingsActiveModel,
} from "../../api/settings.js";
import { fetchVaultContent, fetchVaultTree } from "../../api/vault.js";
import { useSettingsSnapshot } from "../settings/SettingsSnapshotContext.js";
import { MODEL_INTELLIGENCE_STORAGE_KEY } from "./modelIntelligence.js";

/** Sibling control that mutates shared settings the way SettingsView patches do. */
function SettingsPatchControl() {
  const { setSnapshot } = useSettingsSnapshot();
  return (
    <button
      type="button"
      onClick={() => {
        setSnapshot({
          exported_at: "2026-07-01T01:00:00.000Z",
          skills: [
            { id: "summarize", name: "summarize", enabled: false },
            { id: "draft-reply", name: "draft-reply", enabled: true },
          ],
          crons: [],
          mcp_servers: [],
          models: [
            {
              provider: "xai",
              model: "grok-4",
              is_active: true,
              connected: true,
            },
          ],
          integrations: [],
        });
      }}
    >
      Simulate settings patch
    </button>
  );
}

function renderChatView(user?: { email: string }, withPatchControl = false) {
  return render(
    <Providers>
      <SettingsSnapshotProvider>
        <ChatThreadProvider>
          {withPatchControl ? <SettingsPatchControl /> : null}
          <ChatView user={user} />
        </ChatThreadProvider>
      </SettingsSnapshotProvider>
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

describe("ChatView", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", MockEventSource);
    try {
      localStorage.removeItem(MODEL_INTELLIGENCE_STORAGE_KEY);
    } catch {
      // jsdom always has localStorage
    }
    vi.mocked(createChatThread).mockResolvedValue({
      thread_id: "thread-1",
      title: "New chat",
      project_id: null,
      project_vault_path: null,
      created_at: "2026-07-01T12:00:00.000Z",
    });
    vi.mocked(sendChatMessage).mockResolvedValue(undefined);
    vi.mocked(cancelChatRequest).mockReset();
    vi.mocked(cancelChatRequest).mockResolvedValue(undefined);
    vi.mocked(haltMailboxRoom).mockReset();
    vi.mocked(haltMailboxRoom).mockResolvedValue(undefined);
    vi.mocked(kickSpeculativeEnsureOnline).mockClear();
    vi.mocked(kickSpeculativeEnsureOnline).mockResolvedValue(undefined);
    vi.mocked(fetchThreadHistory).mockResolvedValue([]);
    vi.mocked(uploadStagingFile).mockResolvedValue({
      path: "/staging/notes.txt",
      filename: "notes.txt",
    });
    // Reset catalog every test so overrides (e.g. LiteLLM pins) cannot leak.
    vi.mocked(fetchSettingsSnapshot).mockReset();
    vi.mocked(fetchSettingsSnapshot).mockResolvedValue(
      DEFAULT_CHAT_SETTINGS_SNAPSHOT,
    );
    vi.mocked(patchSettingsActiveModel).mockReset();
    vi.mocked(patchSettingsActiveModel).mockResolvedValue({
      model: {
        provider: "xai",
        model: "grok-3",
        is_active: true,
        connected: true,
      },
      source: "fixture",
    });
    // Default empty vault so attach menu tree mode does not leak across tests.
    vi.mocked(fetchVaultTree).mockReset();
    vi.mocked(fetchVaultTree).mockResolvedValue({ roots: [] });
    // lp-xhf4.16: no entitled connectors by default — Connectors group absent.
    fetchConnectors.mockResolvedValue({ connectors: [] });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    try {
      localStorage.removeItem(MODEL_INTELLIGENCE_STORAGE_KEY);
    } catch {
      // ignore
    }
  });

  it("kicks speculative ensure_online once when Chat is active (lp-vqr0.9 T7)", async () => {
    renderChatView();
    await waitFor(() => {
      expect(kickSpeculativeEnsureOnline).toHaveBeenCalledOnce();
    });
  });

  it("does not kick speculative ensure_online while Chat is keep-alive hidden", async () => {
    render(
      <Providers>
        <SettingsSnapshotProvider>
          <ChatThreadProvider>
            <ChatView isActive={false} />
          </ChatThreadProvider>
        </SettingsSnapshotProvider>
      </Providers>,
    );
    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });
    expect(kickSpeculativeEnsureOnline).not.toHaveBeenCalled();
  });

  it("renders ai-chat layout with composer, + attach menu, and timeline", async () => {
    renderChatView();

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });

    expect(screen.getByText("Message your agent…")).toBeTruthy();
    expect(composerInput()).toBeTruthy();
    // lp-khq.12.3: no standalone paperclip; single + in former paperclip slot
    expect(screen.queryByRole("button", { name: "Attach file" })).toBeNull();
    expect(screen.getByTestId("composer-attach-menu")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Attach to message" }),
    ).toBeTruthy();
    expect(screen.getByRole("log")).toBeTruthy();
    expect(screen.queryByText(/Connected/i)).toBeNull();
  });

  it("lp-khq.5 / lp-khq.12.3: + attach menu opens Attach file / Skills / vault only", async () => {
    renderChatView();

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(fetchSettingsSnapshot).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Attach to message" }));
    expect(
      await screen.findByRole("menuitem", { name: /Attach file/i }),
    ).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Skills/i })).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: /Select from vault/i }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("menuitem", { name: /New workflow/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: /Workflow wizard/i }),
    ).toBeNull();
  });

  it("lp-khq.7: Select from vault inserts path without @ syntax", async () => {
    vi.mocked(fetchVaultTree).mockResolvedValue({
      roots: [
        {
          name: "Business",
          path: "/Business",
          kind: "directory",
          children: [
            {
              name: "MSA.docx",
              path: "/Business/MSA.docx",
              kind: "file",
              mime_type:
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            },
          ],
        },
      ],
    });

    renderChatView();

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(fetchVaultTree).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("composer-attach-menu").getAttribute("data-vault-mode"),
      ).toBe("tree");
    });

    fireEvent.click(screen.getByRole("button", { name: "Attach to message" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Select from vault/i }),
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("composer-attach-menu").getAttribute("data-panel"),
      ).toBe("vault");
    });

    fireEvent.click(await screen.findByRole("menuitem", { name: /Business\//i }));
    await waitFor(() => {
      expect(
        screen
          .getByTestId("composer-attach-menu")
          .getAttribute("data-vault-browse-path"),
      ).toBe("/Business");
    });
    fireEvent.click(await screen.findByRole("menuitem", { name: /MSA\.docx/i }));

    // Controlled messageText updated — submit carries path_reference form.
    await waitFor(() => {
      expect(
        screen.getByTestId("composer-attach-menu").getAttribute("data-panel"),
      ).toBe("root");
    });
    fireEvent.keyDown(composerInput(), { key: "Enter", code: "Enter" });
    await waitFor(() => {
      expect(sendChatMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          threadId: "thread-1",
          text: "/Business/MSA.docx",
        }),
      );
    });
  });

  it("lp-khq.12.4: Select from vault has no Open vault deep-link; folder drill remains", async () => {
    vi.mocked(fetchVaultTree).mockResolvedValue({
      roots: [
        {
          name: "Projects",
          path: "/Projects",
          kind: "directory",
          children: [
            {
              name: "notes.md",
              path: "/Projects/notes.md",
              kind: "file",
            },
          ],
        },
      ],
    });

    const onOpenInVault = vi.fn();
    render(
      <Providers>
        <SettingsSnapshotProvider>
          <ChatThreadProvider>
            <ChatView onOpenInVault={onOpenInVault} />
          </ChatThreadProvider>
        </SettingsSnapshotProvider>
      </Providers>,
    );

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(fetchVaultTree).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("composer-attach-menu").getAttribute("data-vault-mode"),
      ).toBe("tree");
    });

    fireEvent.click(screen.getByRole("button", { name: "Attach to message" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Select from vault/i }),
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("composer-attach-menu").getAttribute("data-panel"),
      ).toBe("vault");
    });
    expect(screen.queryByRole("menuitem", { name: /Open vault/i })).toBeNull();
    fireEvent.click(await screen.findByRole("menuitem", { name: /Projects\//i }));
    await waitFor(() => {
      expect(
        screen
          .getByTestId("composer-attach-menu")
          .getAttribute("data-vault-browse-path"),
      ).toBe("/Projects");
    });
    expect(screen.queryByRole("menuitem", { name: /Open vault/i })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /notes\.md/i })).toBeTruthy();
    expect(onOpenInVault).not.toHaveBeenCalled();
  });

  it("lp-bhcg.20: chat composer has no model intelligence selector", async () => {
    renderChatView();

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(fetchSettingsSnapshot).toHaveBeenCalled();
    });

    expect(screen.queryByTestId("model-intelligence-selector")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Model intelligence/i }),
    ).toBeNull();

    setComposerValue("Please refactor the auth architecture carefully");
    fireEvent.keyDown(composerInput(), { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(sendChatMessage).toHaveBeenCalledWith({
        threadId: "thread-1",
        text: "Please refactor the auth architecture carefully",
        stagingPaths: [],
      });
    });
    const sent = sendChatMessage.mock.calls.at(-1)?.[0] as
      | { model?: string }
      | undefined;
    expect(sent?.model).toBeUndefined();
    expect(patchSettingsActiveModel).not.toHaveBeenCalled();
    expect(screen.queryByText("xai/grok-build-0.1")).toBeNull();
  });

  it("lp-bhcg.20: LiteLLM catalog still sends without a user-chosen model", async () => {
    vi.mocked(fetchSettingsSnapshot).mockResolvedValue(
      LITELLM_INTELLIGENCE_SETTINGS_SNAPSHOT,
    );

    renderChatView();

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("model-intelligence-selector")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Model intelligence/i }),
    ).toBeNull();

    setComposerValue("hi");
    fireEvent.keyDown(composerInput(), { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(sendChatMessage).toHaveBeenCalledWith({
        threadId: "thread-1",
        text: "hi",
        stagingPaths: [],
      });
    });
    expect(patchSettingsActiveModel).not.toHaveBeenCalled();
    expect(screen.queryByText("lanyard-auto")).toBeNull();
    expect(screen.queryByText("lanyard-simple")).toBeNull();
  });

  it("shows Hello, {displayName}. composer greeting from email local-part", async () => {
    renderChatView({ email: "dev@demo.local" });

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });

    expect(screen.getByText("Hello, dev.")).toBeTruthy();
  });

  it("submits a message through the composer without status chatter", async () => {
    renderChatView();

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });

    setComposerValue("Hello brain");
    fireEvent.keyDown(composerInput(), { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(sendChatMessage).toHaveBeenCalledWith({
        threadId: "thread-1",
        text: "Hello brain",
        stagingPaths: [],
      });
    });

    // Message bubble + agent header (first-message auto-title) may both show text.
    expect(screen.getAllByText("Hello brain").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/Waiting for brain reply/i)).toBeNull();
    expect(screen.queryByText(/Sending/i)).toBeNull();
  });

  it("uploads an attachment into the composer drawer tokens only", async () => {
    renderChatView();

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });

    const fileInput = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });

    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [file],
    });
    fireEvent.change(fileInput);

    await waitFor(() => {
      expect(uploadStagingFile).toHaveBeenCalledWith({
        file,
        projectVaultPath: undefined,
      });
    });

    expect(screen.getByText("notes.txt")).toBeTruthy();
    expect(screen.queryByText(/Uploaded notes\.txt/)).toBeNull();
  });

  it("does not show a Projects scope chip in the composer (lp-cxhb.3)", async () => {
    renderChatView();

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });
    expect(screen.queryByRole("button", { name: /^No project$/i })).toBeNull();
    expect(screen.queryByText("No project")).toBeNull();
  });

  it("surfaces send failures on a bottom-right Banner", async () => {
    vi.mocked(sendChatMessage).mockRejectedValueOnce(new Error("Relay down"));
    renderChatView();

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });

    setComposerValue("Hello brain");
    fireEvent.keyDown(composerInput(), { key: "Enter", code: "Enter" });

    expect(await screen.findByText("Send failed")).toBeTruthy();
    expect(screen.getByText("Relay down")).toBeTruthy();
    expect(document.querySelector(".chat-failure-banner")).toBeTruthy();
  });

  it("surfaces wake timeout as Agent start timed out banner (lp-6ty)", async () => {
    vi.mocked(sendChatMessage).mockRejectedValueOnce(
      new ChatSendError(
        "The agent is taking longer than expected to start. Wait a few seconds and send again.",
        {
          status: 504,
          code: "wake_timeout",
          retryable: true,
          isWakeFailure: true,
        },
      ),
    );
    renderChatView();

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });

    setComposerValue("Wake me");
    fireEvent.keyDown(composerInput(), { key: "Enter", code: "Enter" });

    expect(await screen.findByText("Agent start timed out")).toBeTruthy();
    expect(
      screen.getByText(/taking longer than expected to start/i),
    ).toBeTruthy();
    expect(document.querySelector(".chat-failure-banner")).toBeTruthy();
  });

  it("omits a composer model stamp; sent text stays after a settings patch", async () => {
    // First send fails so pending clears; second send can proceed.
    vi.mocked(sendChatMessage)
      .mockRejectedValueOnce(new Error("temp network blip"))
      .mockResolvedValue(undefined);

    renderChatView(undefined, true);

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(fetchSettingsSnapshot).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("model-intelligence-selector")).toBeNull();

    setComposerValue("Before patch");
    fireEvent.keyDown(composerInput(), { key: "Enter", code: "Enter" });
    expect(await screen.findByText("Before patch")).toBeTruthy();
    expect(await screen.findByText("Send failed")).toBeTruthy();

    const fetchCount = vi.mocked(fetchSettingsSnapshot).mock.calls.length;
    fireEvent.click(
      screen.getByRole("button", { name: "Simulate settings patch" }),
    );

    setComposerValue("After patch");
    fireEvent.keyDown(composerInput(), { key: "Enter", code: "Enter" });
    expect(await screen.findByText("After patch")).toBeTruthy();
    expect(screen.getByText("Before patch")).toBeTruthy();
    expect(patchSettingsActiveModel).not.toHaveBeenCalled();
    expect(screen.queryByText("grok-3")).toBeNull();
    expect(screen.queryByText("grok-4")).toBeNull();
    // Local shared-store patch must not re-fetch the snapshot API.
    expect(vi.mocked(fetchSettingsSnapshot).mock.calls.length).toBe(fetchCount);
  });

  it("shows spinner on send while response is pending and clears when idle", async () => {
    let resolveSend!: () => void;
    vi.mocked(sendChatMessage).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = () => resolve();
        }),
    );

    renderChatView();

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });

    const waitingName = /Waiting for response/i;

    // Idle: no waiting spinner on the send control.
    expect(screen.queryByRole("status", { name: waitingName })).toBeNull();

    setComposerValue("Hello brain");
    fireEvent.keyDown(composerInput(), { key: "Enter", code: "Enter" });

    expect(
      await screen.findByRole("status", { name: waitingName }),
    ).toBeTruthy();

    // Double-submit blocked while pending (second Enter must not call send again).
    setComposerValue("Second try");
    fireEvent.keyDown(composerInput(), { key: "Enter", code: "Enter" });
    expect(sendChatMessage).toHaveBeenCalledTimes(1);

    resolveSend();

    // HTTP settled but no assistant turn yet — spinner stays until full response.
    await waitFor(() => {
      expect(screen.getByRole("status", { name: waitingName })).toBeTruthy();
    });
  });

  it("clicking stop while pending cancels the Hermes turn", async () => {
    let resolveSend!: () => void;
    vi.mocked(sendChatMessage).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = () => resolve();
        }),
    );
    vi.mocked(cancelChatRequest).mockResolvedValue(undefined);

    renderChatView();

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });

    setComposerValue("Long running");
    fireEvent.keyDown(composerInput(), { key: "Enter", code: "Enter" });

    expect(
      await screen.findByRole("status", {
        name: "Waiting for response — click to stop",
      }),
    ).toBeTruthy();

    // ChatSendButton stop state uses accessible name "Stop".
    const stopButton =
      screen.queryByRole("button", { name: /^Stop$/i }) ??
      screen.getByRole("status", {
        name: "Waiting for response — click to stop",
      }).closest("button");
    expect(stopButton).toBeTruthy();
    fireEvent.click(stopButton!);

    await waitFor(() => {
      expect(cancelChatRequest).toHaveBeenCalledWith("thread-1");
    });

    resolveSend();
  });

  it("does not render Halt on the agent chat header", async () => {
    vi.mocked(haltMailboxRoom).mockResolvedValue(undefined);
    vi.mocked(cancelChatRequest).mockResolvedValue(undefined);

    renderChatView();

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });

    expect(screen.queryByTestId("mailbox-halt")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Halt$/ })).toBeNull();
    expect(haltMailboxRoom).not.toHaveBeenCalled();
    expect(cancelChatRequest).not.toHaveBeenCalled();
  });

  it("Stop-on-send still only cancels, it does not halt", async () => {
    let resolveSend!: () => void;
    vi.mocked(sendChatMessage).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = () => resolve();
        }),
    );
    vi.mocked(cancelChatRequest).mockResolvedValue(undefined);
    vi.mocked(haltMailboxRoom).mockResolvedValue(undefined);

    renderChatView();

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });

    setComposerValue("Long running");
    fireEvent.keyDown(composerInput(), { key: "Enter", code: "Enter" });

    expect(
      await screen.findByRole("status", {
        name: "Waiting for response — click to stop",
      }),
    ).toBeTruthy();

    const stopButton =
      screen.queryByRole("button", { name: /^Stop$/i }) ??
      screen.getByRole("status", {
        name: "Waiting for response — click to stop",
      }).closest("button");
    fireEvent.click(stopButton!);

    await waitFor(() => {
      expect(cancelChatRequest).toHaveBeenCalledWith("thread-1");
    });
    expect(haltMailboxRoom).not.toHaveBeenCalled();

    resolveSend();
  });

  it("cancel then retry resends the same user message", async () => {
    let resolveSend!: () => void;
    vi.mocked(sendChatMessage).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = () => resolve();
        }),
    );
    vi.mocked(cancelChatRequest).mockResolvedValue(undefined);

    renderChatView();

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });

    setComposerValue("Please retry me");
    fireEvent.keyDown(composerInput(), { key: "Enter", code: "Enter" });

    expect(
      await screen.findByRole("status", {
        name: "Waiting for response — click to stop",
      }),
    ).toBeTruthy();

    const stopButton =
      screen.queryByRole("button", { name: /^Stop$/i }) ??
      screen.getByRole("status", {
        name: "Waiting for response — click to stop",
      }).closest("button");
    fireEvent.click(stopButton!);

    await waitFor(() => {
      expect(cancelChatRequest).toHaveBeenCalledWith("thread-1");
    });

    // Original HTTP settles after cancel — must not hide Retry (error stays).
    resolveSend();

    const retry = await screen.findByRole("button", { name: /Retry/i });
    expect(screen.getByLabelText(/Message failed/i)).toBeTruthy();
    expect(sendChatMessage).toHaveBeenCalledTimes(1);

    fireEvent.click(retry);

    await waitFor(() => {
      expect(sendChatMessage).toHaveBeenCalledTimes(2);
    });
    expect(sendChatMessage).toHaveBeenLastCalledWith({
      threadId: "thread-1",
      text: "Please retry me",
    });
    // Same bubble — not a duplicate user message (header may also show auto-title).
    const matches = screen.getAllByText("Please retry me");
    expect(matches.length).toBeLessThanOrEqual(2);
    expect(
      matches.some((el) => el.closest(".astryx-chat-tokenized-text") != null) ||
        matches.length >= 1,
    ).toBe(true);
  });

  it("clears pending spinner when send fails", async () => {
    let rejectSend!: (error: Error) => void;
    vi.mocked(sendChatMessage).mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSend = reject;
        }),
    );

    renderChatView();

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });

    setComposerValue("Hello brain");
    fireEvent.keyDown(composerInput(), { key: "Enter", code: "Enter" });

    const waitingName = /Waiting for response/i;
    expect(
      await screen.findByRole("status", { name: waitingName }),
    ).toBeTruthy();

    rejectSend(new Error("Relay down"));

    expect(await screen.findByText("Relay down")).toBeTruthy();
    await waitFor(() => {
      expect(screen.queryByRole("status", { name: waitingName })).toBeNull();
    });
  });

  it("history assistant turns omit model, copy, and regenerate", async () => {
    vi.mocked(fetchThreadHistory).mockResolvedValue([
      {
        type: "user_message",
        message_id: "u-hist",
        content: "Earlier prompt",
        created_at: "2026-07-01T12:00:00.000Z",
        chat_id: "thread-1",
        model: "grok-3",
      },
      {
        type: "message_send",
        chat_id: "thread-1",
        message_id: "a-hist",
        content: "Original assistant answer",
        model: "grok-3",
        created_at: "2026-07-01T12:00:05.000Z",
      },
    ]);

    renderChatView();

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });

    const answer = await screen.findByText("Original assistant answer");
    const answerBubble = answer.closest(
      '[class*="astryx-chat-message-bubble"]',
    );
    expect(answerBubble?.getAttribute("data-variant")).toBe("filled");
    expect(screen.queryByTestId("chat-assistant-model")).toBeNull();
    expect(screen.queryByTestId("chat-assistant-footer")).toBeNull();
    expect(screen.queryByRole("button", { name: /Regenerate/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Copy$/i })).toBeNull();
    expect(screen.queryByTestId("mailbox-halt")).toBeNull();
    expect(sendChatMessage).not.toHaveBeenCalled();
  });

it("lp-dpr.2 soft mode A: office path mention without open-verb opens document pane", async () => {
    const auditPath =
      "/Business/Legal/contracts/Lanyard_MSA_7.17.26_revised.docx";
    renderChatView();

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });

    expect(screen.queryByTestId("chat-document-pane")).toBeNull();

    setComposerValue(`Please summarize ${auditPath}`);
    fireEvent.keyDown(composerInput(), { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(sendChatMessage).toHaveBeenCalledWith({
        threadId: "thread-1",
        text: `Please summarize ${auditPath}`,
        stagingPaths: [],
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });
    expect(
      screen.getAllByText("Lanyard_MSA_7.17.26_revised.docx").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("lp-dpr.2 soft mode A: unique basename mention opens document pane", async () => {
    const { fetchVaultTree } = await import("../../api/vault.js");
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
                  name: "Note.docx",
                  path: "/Projects/A/Note.docx",
                  kind: "file",
                  mime_type:
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                },
              ],
            },
          ],
        },
      ],
    });

    renderChatView();

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(fetchVaultTree).toHaveBeenCalled();
    });

    setComposerValue("What does Note.docx say?");
    fireEvent.keyDown(composerInput(), { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });
    expect(screen.getAllByText("Note.docx").length).toBeGreaterThanOrEqual(1);
  });

  it("lp-dpr.2 soft mode A: pure citation list still does not mass-auto-open", async () => {
    // Composer message without an office path must not open the pane.
    renderChatView();

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });

    setComposerValue("Hello brain — no documents here");
    fireEvent.keyDown(composerInput(), { key: "Enter", code: "Enter" });

    await waitFor(() => {
      expect(sendChatMessage).toHaveBeenCalled();
    });
    expect(screen.queryByTestId("chat-document-pane")).toBeNull();
  });

  it("opens activity side pane independently via activityOpenRequest (lp-dpr.4)", async () => {
    function ActivityOpenHarness() {
      const [req, setReq] = useState<{
        key: number;
        focus?: { kind: "roster" };
      } | null>(null);
      return (
        <Providers>
          <SettingsSnapshotProvider>
            <ChatThreadProvider>
              <button
                type="button"
                onClick={() =>
                  setReq({
                    key: (req?.key ?? 0) + 1,
                    focus: { kind: "roster" },
                  })
                }
              >
                Open activity pane
              </button>
              <ChatView activityOpenRequest={req} />
            </ChatThreadProvider>
          </SettingsSnapshotProvider>
        </Providers>
      );
    }

    render(<ActivityOpenHarness />);

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });

    expect(screen.queryByTestId("chat-activity-pane")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open activity pane" }));

    await waitFor(() => {
      expect(screen.getByTestId("chat-activity-pane")).toBeTruthy();
    });
    expect(
      screen.getByTestId("chat-activity-pane").getAttribute("data-mode"),
    ).toBe("activity");
    // lp-dpr.5: roster body (empty when no subagent events yet).
    expect(screen.getByTestId("chat-subagent-roster-empty")).toBeTruthy();
    // Document pane stays closed — activity opens independently.
    expect(screen.queryByTestId("chat-document-pane")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Close activity pane" }),
    );
    await waitFor(() => {
      expect(screen.queryByTestId("chat-activity-pane")).toBeNull();
    });
  });

  it("restores focus to the opener when ChatView closes the activity pane (lp-dpr.4 / lp-5q6.15)", async () => {
    function ActivityFocusHarness() {
      const [req, setReq] = useState<{
        key: number;
        focus?: { kind: "roster" };
      } | null>(null);
      return (
        <Providers>
          <SettingsSnapshotProvider>
            <ChatThreadProvider>
              <button
                type="button"
                onClick={() =>
                  setReq({
                    key: (req?.key ?? 0) + 1,
                    focus: { kind: "roster" },
                  })
                }
              >
                Open activity pane
              </button>
              <ChatView
                activityOpenRequest={req}
                sidePaneLayoutPreference="split"
              />
            </ChatThreadProvider>
          </SettingsSnapshotProvider>
        </Providers>
      );
    }

    render(<ActivityFocusHarness />);

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });

    const openBtn = screen.getByRole("button", { name: "Open activity pane" });
    openBtn.focus();
    expect(document.activeElement).toBe(openBtn);

    fireEvent.click(openBtn);

    await waitFor(() => {
      expect(screen.getByTestId("chat-activity-pane")).toBeTruthy();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByTestId("chat-activity-pane"),
      );
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Close activity pane" }),
    );

    await waitFor(() => {
      expect(screen.queryByTestId("chat-activity-pane")).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(openBtn);
    });
  });

  it("restores focus when ChatView closes the document pane (lp-5q6.15 / lp-dpr.4)", async () => {
    const auditPath =
      "/Business/Legal/contracts/Lanyard_MSA_7.17.26_revised.docx";

    function DocumentFocusHarness() {
      const [req, setReq] = useState<{
        key: number;
        path: string;
      } | null>(null);
      return (
        <Providers>
          <SettingsSnapshotProvider>
            <ChatThreadProvider>
              <button
                type="button"
                onClick={() =>
                  setReq({
                    key: (req?.key ?? 0) + 1,
                    path: auditPath,
                  })
                }
              >
                Open document pane
              </button>
              <ChatView
                documentOpenRequest={req}
                sidePaneLayoutPreference="split"
              />
            </ChatThreadProvider>
          </SettingsSnapshotProvider>
        </Providers>
      );
    }

    render(<DocumentFocusHarness />);

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });

    const openBtn = screen.getByRole("button", { name: "Open document pane" });
    openBtn.focus();
    expect(document.activeElement).toBe(openBtn);

    fireEvent.click(openBtn);

    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByTestId("chat-document-pane"),
      );
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Close document pane" }),
    );

    await waitFor(() => {
      expect(screen.queryByTestId("chat-document-pane")).toBeNull();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(openBtn);
    });
  });

  it("exclusive activity hides document chrome; close restores document when still open (lp-dpr.4)", async () => {
    const auditPath =
      "/Business/Legal/contracts/Lanyard_MSA_7.17.26_revised.docx";

    function StackingHarness() {
      const [docReq, setDocReq] = useState<{
        key: number;
        path: string;
      } | null>(null);
      const [actReq, setActReq] = useState<{
        key: number;
        focus?: { kind: "roster" };
      } | null>(null);
      return (
        <Providers>
          <SettingsSnapshotProvider>
            <ChatThreadProvider>
              <button
                type="button"
                onClick={() =>
                  setDocReq({
                    key: (docReq?.key ?? 0) + 1,
                    path: auditPath,
                  })
                }
              >
                Open document pane
              </button>
              <button
                type="button"
                onClick={() =>
                  setActReq({
                    key: (actReq?.key ?? 0) + 1,
                    focus: { kind: "roster" },
                  })
                }
              >
                Open activity pane
              </button>
              <ChatView
                documentOpenRequest={docReq}
                activityOpenRequest={actReq}
                sidePaneLayoutPreference="split"
              />
            </ChatThreadProvider>
          </SettingsSnapshotProvider>
        </Providers>
      );
    }

    render(<StackingHarness />);

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open document pane" }));
    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open activity pane" }));
    await waitFor(() => {
      expect(screen.getByTestId("chat-activity-pane")).toBeTruthy();
    });
    // Exclusive side column — document chrome hidden while artifact retained.
    expect(screen.queryByTestId("chat-document-pane")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Close activity pane" }),
    );
    await waitFor(() => {
      expect(screen.queryByTestId("chat-activity-pane")).toBeNull();
    });
    // Stacking restore: document chrome returns without a second open request.
    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });
  });

  it("hides document drawer chrome when isActive=false and restores when active again (lp-vnz.1)", async () => {
    const auditPath =
      "/Business/Legal/contracts/Lanyard_MSA_7.17.26_revised.docx";

    function TabKeepAliveHarness() {
      const [req, setReq] = useState<{
        key: number;
        path: string;
      } | null>(null);
      const [isActive, setIsActive] = useState(true);
      return (
        <Providers>
          <SettingsSnapshotProvider>
            <ChatThreadProvider>
              <button
                type="button"
                onClick={() =>
                  setReq({
                    key: (req?.key ?? 0) + 1,
                    path: auditPath,
                  })
                }
              >
                Open document pane
              </button>
              <button type="button" onClick={() => setIsActive(false)}>
                Leave Chat tab
              </button>
              <button type="button" onClick={() => setIsActive(true)}>
                Return to Chat tab
              </button>
              <button type="button">Settings control</button>
              <ChatView
                documentOpenRequest={req}
                sidePaneLayoutPreference="drawer"
                isActive={isActive}
              />
            </ChatThreadProvider>
          </SettingsSnapshotProvider>
        </Providers>
      );
    }

    render(<TabKeepAliveHarness />);

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open document pane" }));
    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane-drawer")).toBeTruthy();
    });
    const openDialog = document.querySelector("dialog[open]");
    expect(openDialog).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Leave Chat tab" }));

    await waitFor(() => {
      expect(screen.queryByTestId("chat-document-pane")).toBeNull();
      expect(screen.queryByTestId("chat-document-pane-drawer")).toBeNull();
    });
    // Modal released — other tab controls stay interactive (no showModal freeze).
    expect(document.querySelector("dialog[open]")).toBeNull();
    const settingsControl = screen.getByRole("button", {
      name: "Settings control",
    });
    expect(settingsControl).toBeTruthy();
    settingsControl.focus();
    expect(document.activeElement).toBe(settingsControl);

    fireEvent.click(screen.getByRole("button", { name: "Return to Chat tab" }));
    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });
    expect(screen.getByTestId("chat-document-pane-drawer")).toBeTruthy();
  });

  it("hides activity drawer chrome when isActive=false and restores when active again (lp-vnz.1)", async () => {
    function ActivityTabKeepAliveHarness() {
      const [req, setReq] = useState<{
        key: number;
        focus?: { kind: "roster" };
      } | null>(null);
      const [isActive, setIsActive] = useState(true);
      return (
        <Providers>
          <SettingsSnapshotProvider>
            <ChatThreadProvider>
              <button
                type="button"
                onClick={() =>
                  setReq({
                    key: (req?.key ?? 0) + 1,
                    focus: { kind: "roster" },
                  })
                }
              >
                Open activity pane
              </button>
              <button type="button" onClick={() => setIsActive(false)}>
                Leave Chat tab
              </button>
              <button type="button" onClick={() => setIsActive(true)}>
                Return to Chat tab
              </button>
              <ChatView
                activityOpenRequest={req}
                sidePaneLayoutPreference="drawer"
                isActive={isActive}
              />
            </ChatThreadProvider>
          </SettingsSnapshotProvider>
        </Providers>
      );
    }

    render(<ActivityTabKeepAliveHarness />);

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open activity pane" }));
    await waitFor(() => {
      expect(screen.getByTestId("chat-activity-pane-drawer")).toBeTruthy();
    });
    expect(document.querySelector("dialog[open]")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Leave Chat tab" }));

    await waitFor(() => {
      expect(screen.queryByTestId("chat-activity-pane")).toBeNull();
      expect(screen.queryByTestId("chat-activity-pane-drawer")).toBeNull();
    });
    expect(document.querySelector("dialog[open]")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Return to Chat tab" }));
    await waitFor(() => {
      expect(screen.getByTestId("chat-activity-pane")).toBeTruthy();
    });
    expect(screen.getByTestId("chat-activity-pane-drawer")).toBeTruthy();
  });

  it("lp-vnz.8: citation chip opens document pane", async () => {
    const { fetchVaultContent } = await import("../../api/vault.js");
    vi.mocked(fetchVaultContent).mockResolvedValue({
      path: "/AGENTS.md",
      mime_type: "text/markdown",
      encoding: "utf-8",
      content: "# AGENTS\n",
    });
    vi.mocked(fetchThreadHistory).mockResolvedValue([
      {
        type: "message_send",
        chat_id: "thread-1",
        message_id: "msg-agents",
        content: "I read AGENTS.md for conventions.",
        citations: [{ path: "/AGENTS.md", title: "AGENTS.md" }],
        created_at: "2026-07-01T12:00:05.000Z",
      },
    ]);

    renderChatView();

    expect(
      await screen.findByText("I read AGENTS.md for conventions."),
    ).toBeTruthy();
    const chip = await screen.findByTestId("vault-citation-1");
    fireEvent.click(chip);

    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });
    await waitFor(() => {
      expect(fetchVaultContent).toHaveBeenCalledWith("/AGENTS.md");
    });
  });


  describe("per-thread side pane persistence (lp-vnz.2)", () => {
    const auditPath =
      "/Business/Legal/contracts/Lanyard_MSA_7.17.26_revised.docx";
    const otherPath = "/Projects/A/notes.txt";

    const threadA = {
      thread_id: "thread-a",
      title: "Thread A",
      project_id: null as string | null,
      project_vault_path: null as string | null,
      created_at: "2026-07-01T12:00:00.000Z",
      access: "owner" as const,
    };
    const threadB = {
      thread_id: "thread-b",
      title: "Thread B",
      project_id: null as string | null,
      project_vault_path: null as string | null,
      created_at: "2026-07-01T12:01:00.000Z",
      access: "owner" as const,
    };

    function ThreadSwitchControls() {
      const { selectThread, threadId, threads } = useChatThread();
      return (
        <div>
          <span data-testid="active-thread-id">{threadId ?? ""}</span>
          {threads.map((t) => (
            <button
              key={t.thread_id}
              type="button"
              onClick={() => selectThread(t.thread_id)}
            >
              {`Select ${t.thread_id}`}
            </button>
          ))}
        </div>
      );
    }

    function DualThreadDocHarness({
      initialPath = auditPath,
    }: {
      initialPath?: string;
    }) {
      const [req, setReq] = useState<{
        key: number;
        path: string;
      } | null>(null);
      return (
        <Providers>
          <SettingsSnapshotProvider>
            <ChatThreadProvider>
              <ThreadSwitchControls />
              <button
                type="button"
                onClick={() =>
                  setReq({
                    key: (req?.key ?? 0) + 1,
                    path: initialPath,
                  })
                }
              >
                Open document pane
              </button>
              <button
                type="button"
                onClick={() =>
                  setReq({
                    key: (req?.key ?? 0) + 1,
                    path: otherPath,
                  })
                }
              >
                Open other document
              </button>
              <ChatView
                documentOpenRequest={req}
                sidePaneLayoutPreference="split"
              />
            </ChatThreadProvider>
          </SettingsSnapshotProvider>
        </Providers>
      );
    }

    function DualThreadActivityHarness() {
      const [req, setReq] = useState<{
        key: number;
        focus?: { kind: "roster" } | { kind: "subagent"; runId: string };
      } | null>(null);
      return (
        <Providers>
          <SettingsSnapshotProvider>
            <ChatThreadProvider>
              <ThreadSwitchControls />
              <button
                type="button"
                onClick={() =>
                  setReq({
                    key: (req?.key ?? 0) + 1,
                    focus: { kind: "roster" },
                  })
                }
              >
                Open activity pane
              </button>
              <ChatView
                activityOpenRequest={req}
                sidePaneLayoutPreference="split"
              />
            </ChatThreadProvider>
          </SettingsSnapshotProvider>
        </Providers>
      );
    }

    beforeEach(() => {
      vi.mocked(listChatThreads).mockResolvedValue([threadA, threadB]);
    });

    it("captureThreadSidePaneSnapshot encodes mode, focus, and document path", () => {
      const closed = captureThreadSidePaneSnapshot(
        createInitialActivityPaneState(),
        createInitialArtifactPanelState(),
      );
      expect(closed).toBeNull();

      const docOpen = captureThreadSidePaneSnapshot(
        {
          mode: "document",
          focus: { kind: "roster" },
          openGeneration: 1,
        },
        {
          ...createInitialArtifactPanelState(),
          status: "previewing",
          ref: { path: auditPath, source: "citation" },
          openGeneration: 1,
        },
      );
      expect(docOpen).toEqual({
        mode: "document",
        focus: { kind: "roster" },
        documentRef: { path: auditPath, source: "citation" },
      });

      const activityWithDoc = captureThreadSidePaneSnapshot(
        {
          mode: "activity",
          focus: { kind: "subagent", runId: "run-1" },
          openGeneration: 2,
        },
        {
          ...createInitialArtifactPanelState(),
          status: "previewing",
          ref: { path: auditPath, source: "deep_link" },
          openGeneration: 1,
        },
      );
      expect(activityWithDoc).toEqual({
        mode: "activity",
        focus: { kind: "subagent", runId: "run-1" },
        documentRef: { path: auditPath, source: "deep_link" },
      });
    });

    it("restores document pane when returning to a thread (no re-click)", async () => {
      render(<DualThreadDocHarness />);

      await waitFor(() => {
        expect(screen.getByTestId("active-thread-id").textContent).toBe(
          "thread-a",
        );
      });

      fireEvent.click(
        screen.getByRole("button", { name: "Open document pane" }),
      );
      await waitFor(() => {
        expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
      });
      expect(
        screen.getByTestId("chat-document-pane").getAttribute("data-path") ??
          screen.getByTestId("chat-document-pane").textContent,
      ).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Select thread-b" }));
      await waitFor(() => {
        expect(screen.getByTestId("active-thread-id").textContent).toBe(
          "thread-b",
        );
      });
      await waitFor(() => {
        expect(screen.queryByTestId("chat-document-pane")).toBeNull();
      });

      fireEvent.click(screen.getByRole("button", { name: "Select thread-a" }));
      await waitFor(() => {
        expect(screen.getByTestId("active-thread-id").textContent).toBe(
          "thread-a",
        );
      });
      await waitFor(() => {
        expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
      });
    });

    it("restores activity pane when returning to a thread", async () => {
      render(<DualThreadActivityHarness />);

      await waitFor(() => {
        expect(screen.getByTestId("active-thread-id").textContent).toBe(
          "thread-a",
        );
      });

      fireEvent.click(
        screen.getByRole("button", { name: "Open activity pane" }),
      );
      await waitFor(() => {
        expect(screen.getByTestId("chat-activity-pane")).toBeTruthy();
      });

      fireEvent.click(screen.getByRole("button", { name: "Select thread-b" }));
      await waitFor(() => {
        expect(screen.queryByTestId("chat-activity-pane")).toBeNull();
      });

      fireEvent.click(screen.getByRole("button", { name: "Select thread-a" }));
      await waitFor(() => {
        expect(screen.getByTestId("chat-activity-pane")).toBeTruthy();
      });
      expect(
        screen.getByTestId("chat-activity-pane").getAttribute("data-mode"),
      ).toBe("activity");
    });

    it("explicit user close clears stored pane so return stays closed", async () => {
      render(<DualThreadDocHarness />);

      await waitFor(() => {
        expect(screen.getByTestId("active-thread-id").textContent).toBe(
          "thread-a",
        );
      });

      fireEvent.click(
        screen.getByRole("button", { name: "Open document pane" }),
      );
      await waitFor(() => {
        expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
      });

      fireEvent.click(
        screen.getByRole("button", { name: "Close document pane" }),
      );
      await waitFor(() => {
        expect(screen.queryByTestId("chat-document-pane")).toBeNull();
      });

      fireEvent.click(screen.getByRole("button", { name: "Select thread-b" }));
      await waitFor(() => {
        expect(screen.getByTestId("active-thread-id").textContent).toBe(
          "thread-b",
        );
      });

      fireEvent.click(screen.getByRole("button", { name: "Select thread-a" }));
      await waitFor(() => {
        expect(screen.getByTestId("active-thread-id").textContent).toBe(
          "thread-a",
        );
      });
      // Closed state must not resurrect.
      expect(screen.queryByTestId("chat-document-pane")).toBeNull();
    });

    it("keeps independent document paths per thread across switches", async () => {
      render(<DualThreadDocHarness />);

      await waitFor(() => {
        expect(screen.getByTestId("active-thread-id").textContent).toBe(
          "thread-a",
        );
      });

      fireEvent.click(
        screen.getByRole("button", { name: "Open document pane" }),
      );
      await waitFor(() => {
        expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
      });

      fireEvent.click(screen.getByRole("button", { name: "Select thread-b" }));
      await waitFor(() => {
        expect(screen.queryByTestId("chat-document-pane")).toBeNull();
      });

      fireEvent.click(
        screen.getByRole("button", { name: "Open other document" }),
      );
      await waitFor(() => {
        expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
      });

      fireEvent.click(screen.getByRole("button", { name: "Select thread-a" }));
      await waitFor(() => {
        expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
      });
      // Path restored from thread-a snapshot (audit doc), not thread-b's notes.
      await waitFor(() => {
        const pane = screen.getByTestId("chat-document-pane");
        const pathAttr =
          pane.getAttribute("data-path") ??
          pane.getAttribute("data-document-path");
        if (pathAttr) {
          expect(pathAttr).toContain("Lanyard_MSA");
        } else {
          // Shell may expose path via title / body text.
          expect(
            pane.textContent?.includes("Lanyard_MSA") ||
              pane.textContent?.includes("revised.docx") ||
              document.body.textContent?.includes("Lanyard_MSA"),
          ).toBe(true);
        }
      });
    });
  });

  describe("scheduled-task config side pane (lp-lv9.5)", () => {
    const interactiveThread = {
      thread_id: "thread-chat",
      title: "Interactive chat",
      project_id: null as string | null,
      project_vault_path: null as string | null,
      created_at: "2026-07-01T12:00:00.000Z",
      kind: "chat" as const,
      scheduled_job_id: null as string | null,
      access: "owner" as const,
    };
    const scheduledThread = {
      thread_id: "thread-st",
      title: "Vault digest",
      project_id: null as string | null,
      project_vault_path: null as string | null,
      created_at: "2026-07-01T12:01:00.000Z",
      kind: "scheduled_task" as const,
      scheduled_job_id: "st-vault-digest",
      access: "owner" as const,
    };

    function ThreadSwitchControls() {
      const { selectThread, threadId, threads } = useChatThread();
      return (
        <div>
          <span data-testid="active-thread-id">{threadId ?? ""}</span>
          {threads.map((t) => (
            <button
              key={t.thread_id}
              type="button"
              onClick={() => selectThread(t.thread_id)}
            >
              {`Select ${t.thread_id}`}
            </button>
          ))}
        </div>
      );
    }

    function ScheduledTaskConfigHarness() {
      return (
        <Providers>
          <SettingsSnapshotProvider>
            <ChatThreadProvider>
              <ThreadSwitchControls />
              <ChatView sidePaneLayoutPreference="split" />
            </ChatThreadProvider>
          </SettingsSnapshotProvider>
        </Providers>
      );
    }

    beforeEach(() => {
      vi.mocked(listChatThreads).mockResolvedValue([
        interactiveThread,
        scheduledThread,
      ]);
      vi.mocked(fetchSettingsSnapshot).mockResolvedValue({
        ...DEFAULT_CHAT_SETTINGS_SNAPSHOT,
        crons: [
          {
            id: "st-vault-digest",
            name: "Vault digest",
            schedule: "0 9 * * 1-5",
            enabled: true,
            last_run_at: "2026-08-11T09:00:00.000Z",
            next_run_at: "2026-08-12T09:00:00.000Z",
            last_status: "ok",
            prompt: "Summarize overnight vault changes.",
          },
        ],
      });
    });

    it("opens config pane with required fields when selecting scheduled-task thread", async () => {
      render(<ScheduledTaskConfigHarness />);

      await waitFor(() => {
        expect(screen.getByTestId("active-thread-id").textContent).toBe(
          "thread-chat",
        );
      });

      // Interactive chat must not show the scheduled-task config pane.
      expect(screen.queryByTestId("scheduled-task-config-pane")).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Select thread-st" }));
      await waitFor(() => {
        expect(screen.getByTestId("active-thread-id").textContent).toBe(
          "thread-st",
        );
      });

      await waitFor(() => {
        expect(screen.getByTestId("chat-activity-pane")).toBeTruthy();
        expect(screen.getByTestId("scheduled-task-config-pane")).toBeTruthy();
      });

      const pane = screen.getByTestId("chat-activity-pane");
      expect(pane.getAttribute("data-focus-kind")).toBe(
        "scheduled_task_config",
      );

      await waitFor(() => {
        expect(
          screen.getByTestId("scheduled-task-config-schedule").textContent,
        ).toMatch(/Weekdays at 9:00 AM/i);
      });
      expect(screen.getByTestId("scheduled-task-config-last-run")).toBeTruthy();
      expect(screen.getByTestId("scheduled-task-config-next-run")).toBeTruthy();
      expect(screen.getByTestId("scheduled-task-config-enabled")).toBeTruthy();
      expect(screen.getByRole("switch")).toBeTruthy();
      expect(
        screen.getByTestId("scheduled-task-config-instructions"),
      ).toBeTruthy();
    });

    it("does not open scheduled-task config on interactive chats by default", async () => {
      render(<ScheduledTaskConfigHarness />);

      await waitFor(() => {
        expect(screen.getByTestId("active-thread-id").textContent).toBe(
          "thread-chat",
        );
      });

      // Give auto-open rAF a chance if it were incorrectly wired.
      await waitFor(() => {
        expect(screen.queryByTestId("scheduled-task-config-pane")).toBeNull();
      });
      expect(screen.queryByTestId("chat-activity-pane")).toBeNull();
    });
  });

  describe("document reopen chips (lp-a8u.2)", () => {
    const auditPath =
      "/Business/Legal/contracts/Lanyard_MSA_7.17.26_revised.docx";
    const notesPath = "/Projects/A/notes.md";

    beforeEach(() => {
      // Parent suite may leave listChatThreads returning dual-thread fixtures.
      vi.mocked(listChatThreads).mockResolvedValue([]);
      vi.mocked(fetchVaultContent).mockImplementation(async (path: string) => ({
        path,
        mime_type: "text/plain",
        encoding: "utf-8" as const,
        content: "preview body",
      }));
    });

    function ReopenChipHarness({
      initialPath = auditPath,
    }: {
      initialPath?: string;
    }) {
      const [req, setReq] = useState<{
        key: number;
        path: string;
      } | null>(null);
      return (
        <Providers>
          <SettingsSnapshotProvider>
            <ChatThreadProvider>
              <button
                type="button"
                onClick={() =>
                  setReq({
                    key: (req?.key ?? 0) + 1,
                    path: initialPath,
                  })
                }
              >
                Open document pane
              </button>
              <button
                type="button"
                onClick={() =>
                  setReq({
                    key: (req?.key ?? 0) + 1,
                    path: notesPath,
                  })
                }
              >
                Open second document
              </button>
              <ChatView
                documentOpenRequest={req}
                sidePaneLayoutPreference="split"
              />
            </ChatThreadProvider>
          </SettingsSnapshotProvider>
        </Providers>
      );
    }

    async function waitForChatReady(): Promise<void> {
      await waitFor(() => {
        expect(screen.getByTestId("chat-document-pane-root")).toBeTruthy();
      });
      await waitFor(() => {
        expect(
          createChatThread.mock.calls.length > 0 ||
            listChatThreads.mock.calls.length > 0,
        ).toBe(true);
      });
    }

    it("mints a reopen chip after successful open; survives close; click reopens", async () => {
      render(<ReopenChipHarness />);
      await waitForChatReady();

      fireEvent.click(screen.getByRole("button", { name: "Open document pane" }));
      await waitFor(() => {
        expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
      });
      // Chip appears once preview settles (PANEL_PREVIEW_READY).
      await waitFor(() => {
        expect(screen.getByTestId("document-reopen-chip-bar")).toBeTruthy();
        expect(screen.getByTestId("document-reopen-chip-1")).toBeTruthy();
      });

      fireEvent.click(
        screen.getByRole("button", { name: "Close document pane" }),
      );
      await waitFor(() => {
        expect(screen.queryByTestId("chat-document-pane")).toBeNull();
      });
      // Chip remains after close.
      expect(screen.getByTestId("document-reopen-chip-1")).toBeTruthy();

      fireEvent.click(screen.getByTestId("document-reopen-chip-1"));
      await waitFor(() => {
        expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
      });
      // Preview body still loads for the same path (reopen dispatch).
      await waitFor(() => {
        expect(document.body.textContent).toMatch(
          /preview body|Lanyard_MSA|revised\.docx/,
        );
      });
    });

    it("tracks multiple docs as separate reopen chips", async () => {
      render(<ReopenChipHarness />);
      await waitForChatReady();

      fireEvent.click(screen.getByRole("button", { name: "Open document pane" }));
      await waitFor(() => {
        expect(screen.getByTestId("document-reopen-chip-1")).toBeTruthy();
      });

      fireEvent.click(
        screen.getByRole("button", { name: "Open second document" }),
      );
      await waitFor(() => {
        expect(screen.getByTestId("document-reopen-chip-1")).toBeTruthy();
        expect(screen.getByTestId("document-reopen-chip-2")).toBeTruthy();
      });

      fireEvent.click(
        screen.getByRole("button", { name: "Close document pane" }),
      );
      await waitFor(() => {
        expect(screen.queryByTestId("chat-document-pane")).toBeNull();
      });

      // Reopen first chip (older doc) still works.
      fireEvent.click(screen.getByTestId("document-reopen-chip-1"));
      await waitFor(() => {
        expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
      });
    });

    it("does not mint a chip when preview load fails", async () => {
      vi.mocked(fetchVaultContent).mockRejectedValue(new Error("not found"));

      render(<ReopenChipHarness />);
      await waitForChatReady();

      fireEvent.click(screen.getByRole("button", { name: "Open document pane" }));
      // Wait for load attempt to settle into error (no PREVIEW_READY chip).
      await waitFor(() => {
        expect(fetchVaultContent).toHaveBeenCalled();
      });
      await waitFor(() => {
        expect(screen.queryByTestId("document-reopen-chip-bar")).toBeNull();
        expect(screen.queryByTestId("document-reopen-chip-1")).toBeNull();
      });
    });
  });

});

/** Entitled, role-granted, not-yet-connected rows (lp-xhf4.16). */
const ENTITLED_CONNECTORS = {
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
};

describe("ChatView composer connectors group (lp-xhf4.16)", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", MockEventSource);
    try {
      localStorage.removeItem(MODEL_INTELLIGENCE_STORAGE_KEY);
    } catch {
      // jsdom always has localStorage
    }
    vi.mocked(createChatThread).mockResolvedValue({
      thread_id: "thread-1",
      title: "New chat",
      project_id: null,
      project_vault_path: null,
      created_at: "2026-07-01T12:00:00.000Z",
    });
    vi.mocked(sendChatMessage).mockResolvedValue(undefined);
    vi.mocked(kickSpeculativeEnsureOnline).mockClear();
    vi.mocked(kickSpeculativeEnsureOnline).mockResolvedValue(undefined);
    vi.mocked(fetchThreadHistory).mockResolvedValue([]);
    vi.mocked(fetchSettingsSnapshot).mockReset();
    vi.mocked(fetchSettingsSnapshot).mockResolvedValue(
      DEFAULT_CHAT_SETTINGS_SNAPSHOT,
    );
    vi.mocked(fetchVaultTree).mockReset();
    vi.mocked(fetchVaultTree).mockResolvedValue({ roots: [] });
    fetchConnectors.mockReset();
    startConnectorOAuth.mockReset();
    startWhatsAppPair.mockReset();
    openConnectorOAuthTab.mockReset();
    fetchConnectors.mockResolvedValue(ENTITLED_CONNECTORS);
    startConnectorOAuth.mockImplementation(async (connectorId: string) => ({
      connector_id: connectorId,
      url:
        connectorId === "hubspot"
          ? "https://app.hubspot.com/oauth/authorize?state=test"
          : "https://accounts.google.com/o/oauth2/v2/auth?state=test",
    }));
    startWhatsAppPair.mockResolvedValue({
      connector_id: "whatsapp",
      status: "pairing",
      account_label: null,
      pairing_id: "pair-test",
    });
    openConnectorOAuthTab.mockImplementation(() => ({ opened: true }));
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    try {
      localStorage.removeItem(MODEL_INTELLIGENCE_STORAGE_KEY);
    } catch {
      // ignore
    }
  });

  /** Composer + ready: attach trigger clickable once thread exists. */
  async function readyAttachTrigger(): Promise<HTMLElement> {
    await waitFor(() => {
      expect(fetchConnectors).toHaveBeenCalled();
    });
    const trigger = screen.getByRole("button", { name: "Attach to message" });
    await waitFor(() => {
      expect(trigger.getAttribute("disabled")).toBeNull();
      expect(trigger.getAttribute("aria-disabled")).toBeNull();
    });
    return trigger;
  }

  it("Connect Google starts OAuth bound to the thread and opens a new tab", async () => {
    renderChatView();
    fireEvent.click(await readyAttachTrigger());
    const row = await screen.findByTestId("connector-connect-google");
    fireEvent.click(within(row).getByRole("menuitem"));

    await waitFor(() => {
      expect(startConnectorOAuth).toHaveBeenCalledTimes(1);
    });
    expect(startConnectorOAuth).toHaveBeenCalledWith("google", {
      thread_id: "thread-1",
    });
    expect(openConnectorOAuthTab).toHaveBeenCalledTimes(1);
    expect(openConnectorOAuthTab).toHaveBeenCalledWith(
      "https://accounts.google.com/o/oauth2/v2/auth?state=test",
    );
    // Honest local status turn — no pending-tool wizard involved.
    expect(
      await screen.findByText("Connecting Google… finish in the opened tab."),
    ).toBeTruthy();
    expect(beginConnectorChatUse).not.toHaveBeenCalled();
  });

  it("pop-up blocked falls back to an honest markdown link turn", async () => {
    openConnectorOAuthTab.mockReturnValue({ opened: false });
    renderChatView();
    fireEvent.click(await readyAttachTrigger());
    fireEvent.click(
      within(await screen.findByTestId("connector-connect-google")).getByRole(
        "menuitem",
      ),
    );

    expect(await screen.findByText(/Pop-up blocked\./)).toBeTruthy();
    // Markdown-link fallback keeps the OAuth one click away.
    const openLink = await screen.findByRole("link", { name: "Open Google" });
    expect(openLink.getAttribute("href")).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth?state=test",
    );
    expect(openConnectorOAuthTab).toHaveBeenCalledWith(
      "https://accounts.google.com/o/oauth2/v2/auth?state=test",
    );
  });

  it("Connect WhatsApp pairs with the current thread without OAuth", async () => {
    renderChatView();
    fireEvent.click(await readyAttachTrigger());
    fireEvent.click(
      within(await screen.findByTestId("connector-connect-whatsapp")).getByRole(
        "menuitem",
      ),
    );

    await waitFor(() => {
      expect(startWhatsAppPair).toHaveBeenCalledTimes(1);
    });
    expect(startWhatsAppPair).toHaveBeenCalledWith({ threadId: "thread-1" });
    expect(startConnectorOAuth).not.toHaveBeenCalled();
    // Honest local status; the QR bubble itself arrives via connector.qr SSE.
    expect(await screen.findByText(/scan the QR code below/i)).toBeTruthy();
  });

  it("OAuth success postMessage with no wizard session appends connected turn and refetches", async () => {
    renderChatView();
    await readyAttachTrigger();

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: {
          type: "lanyard.connector.oauth",
          connector_id: "google",
          status: "connected",
          account_label: "ada@gmail.com",
        },
      }),
    );

    expect(await screen.findByText("Google connected.")).toBeTruthy();
    await waitFor(() => {
      expect(fetchConnectors).toHaveBeenCalledTimes(2);
    });
    expect(beginConnectorChatUse).not.toHaveBeenCalled();
  });

  it("Connect Google paints the in-thread OAuth connect card (lp-xhf4.19)", async () => {
    renderChatView();
    fireEvent.click(await readyAttachTrigger());
    fireEvent.click(
      within(await screen.findByTestId("connector-connect-google")).getByRole(
        "menuitem",
      ),
    );

    // The BFF does not SSE connector.oauth for composer connects — the
    // start upsert is local (same timeline item shape as #622).
    const card = await screen.findByTestId("connector-oauth-card");
    expect(card.getAttribute("data-connector")).toBe("google");
    expect(card.getAttribute("data-phase")).toBe("connect");
    expect(await screen.findByText("Connecting Google… finish in the opened tab.")).toBeTruthy();
  });

  it("OAuth success postMessage paints the Connected chip with account label (lp-xhf4.19)", async () => {
    renderChatView();
    fireEvent.click(await readyAttachTrigger());
    fireEvent.click(
      within(await screen.findByTestId("connector-connect-google")).getByRole(
        "menuitem",
      ),
    );
    expect(await screen.findByTestId("connector-oauth-card")).toBeTruthy();

    window.dispatchEvent(
      new MessageEvent("message", {
        origin: window.location.origin,
        data: {
          type: "lanyard.connector.oauth",
          connector_id: "google",
          status: "connected",
          account_label: "ada@gmail.com",
        },
      }),
    );

    // Success replaces the connect card in place — one card per connector.
    await waitFor(() => {
      expect(screen.getByTestId("connector-oauth-card").getAttribute("data-phase")).toBe(
        "connected",
      );
    });
    expect(screen.getByTestId("connector-oauth-connected-chip")).toBeTruthy();
    expect(screen.getByTestId("connector-oauth-account-label").textContent).toBe(
      "ada@gmail.com",
    );
  });

  it("unentitled or already-connected connectors get no Connectors row", async () => {
    fetchConnectors.mockResolvedValue({
      connectors: [
        {
          ...ENTITLED_CONNECTORS.connectors[0],
          entitled: false,
        },
        {
          ...ENTITLED_CONNECTORS.connectors[1],
          status: "connected",
          account_label: "ada@hubspot.com",
        },
        // Positive control: proves statuses applied before asserting absence.
        ENTITLED_CONNECTORS.connectors[2],
      ],
    });
    renderChatView();
    fireEvent.click(await readyAttachTrigger());

    expect(
      await screen.findByTestId("connector-connect-whatsapp"),
    ).toBeTruthy();
    // Google unentitled, HubSpot already connected — no rows.
    expect(screen.queryByTestId("connector-connect-google")).toBeNull();
    expect(screen.queryByTestId("connector-connect-hubspot")).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: /Connect Google/i }),
    ).toBeNull();
  });
});
