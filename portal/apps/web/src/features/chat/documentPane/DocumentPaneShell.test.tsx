/**
 * Unit tests for chat document pane shell open/close (lp-5q6.13).
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  useEffect,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../../../app/providers.js";
import { ChatThreadProvider } from "../../projects/ChatThreadContext.js";
import { SettingsSnapshotProvider } from "../../settings/SettingsSnapshotContext.js";
import { ChatView } from "../ChatView.js";

import {
  artifactPanelReducer,
  createInitialArtifactPanelState,
} from "./artifactPanelReducer.js";
import { DocumentPaneShell } from "./DocumentPaneShell.js";
import type { ArtifactPanelAction, ArtifactPanelState } from "./types.js";

vi.mock("../../../api/projects.js", () => ({
  fetchProjects: vi.fn().mockResolvedValue([
    {
      project_id: "p1",
      name: "Alpha",
      vault_path: "/Projects/A",
      parent_project_id: null,
    },
  ]),
}));

vi.mock("../../../api/chat.js", () => ({
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
}));

vi.mock("../../../api/settings.js", () => ({
  fetchSettingsSnapshot: vi.fn().mockResolvedValue({
    exported_at: "2026-07-01T00:00:00.000Z",
    skills: [],
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
}));

vi.mock("../../../api/vault.js", () => ({
  fetchVaultTree: vi.fn().mockResolvedValue({ roots: [] }),
  fetchVaultContent: vi.fn().mockResolvedValue({
    path: "/Projects/A/README.md",
    mime_type: "text/markdown",
    encoding: "utf-8",
    content: "# Hello from vault\n\nPreview body.",
  }),
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

import { createChatThread, fetchThreadHistory } from "../../../api/chat.js";
import {
  downloadVaultFile,
  fetchVaultContent,
} from "../../../api/vault.js";

class MockEventSource {
  close(): void {}
  addEventListener(): void {}
}

const MD_CONTENT = {
  path: "/Projects/A/README.md",
  mime_type: "text/markdown",
  encoding: "utf-8" as const,
  content: "# Hello from vault\n\nPreview body.",
};

function ShellHarness({
  initialOpen = false,
}: {
  initialOpen?: boolean;
}) {
  const [state, dispatch] = useReducer(
    artifactPanelReducer,
    undefined,
    createInitialArtifactPanelState,
  );

  useEffect(() => {
    if (initialOpen) {
      dispatch({
        type: "PANEL_OPEN",
        ref: { path: "/Projects/A/README.md", title: "README.md" },
      });
    }
  }, [initialOpen]);

  useEffect(() => {
    if (state.status === "opening" && state.ref) {
      dispatch({
        type: "PANEL_PREVIEW_READY",
        openGeneration: state.openGeneration,
      });
    }
  }, [state.status, state.openGeneration, state.ref]);

  return (
    <DocumentPaneShell
      state={state}
      content={state.status === "previewing" ? MD_CONTENT : null}
      isLoading={state.status === "opening"}
      onClose={() => dispatch({ type: "PANEL_CLOSE", reason: "user" })}
      onReload={() => dispatch({ type: "PANEL_RELOAD" })}
      onOpenInVault={() => {}}
      onDownload={() => {}}
    />
  );
}

function ControlledShell({
  state,
  dispatch,
}: {
  state: ArtifactPanelState;
  dispatch: Dispatch<ArtifactPanelAction>;
}) {
  return (
    <DocumentPaneShell
      state={state}
      content={
        state.status === "previewing" || state.status === "opening"
          ? MD_CONTENT
          : null
      }
      isLoading={state.status === "opening"}
      onClose={() => dispatch({ type: "PANEL_CLOSE", reason: "user" })}
      onReload={() => dispatch({ type: "PANEL_RELOAD" })}
      onOpenInVault={() => {}}
      onDownload={() => {}}
    />
  );
}

function OpenCloseController() {
  const [state, dispatch] = useReducer(
    artifactPanelReducer,
    undefined,
    createInitialArtifactPanelState,
  );

  return (
    <div>
      <button
        type="button"
        onClick={() =>
          dispatch({
            type: "PANEL_OPEN",
            ref: { path: "/Projects/A/README.md", title: "README.md" },
          })
        }
      >
        Open pane
      </button>
      <button
        type="button"
        onClick={() => dispatch({ type: "PANEL_CLOSE", reason: "user" })}
      >
        Force close
      </button>
      <ControlledShell state={state} dispatch={dispatch} />
    </div>
  );
}

function renderWithProviders(node: ReactNode) {
  return render(<Providers>{node}</Providers>);
}

describe("DocumentPaneShell", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders nothing when closed", () => {
    renderWithProviders(
      <DocumentPaneShell
        state={createInitialArtifactPanelState()}
        content={null}
        isLoading={false}
        onClose={() => {}}
        onReload={() => {}}
        onOpenInVault={() => {}}
        onDownload={() => {}}
      />,
    );
    expect(screen.queryByTestId("chat-document-pane")).toBeNull();
  });

  it("opens with toolbar controls and closes via the close button", async () => {
    renderWithProviders(<OpenCloseController />);

    expect(screen.queryByTestId("chat-document-pane")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Open pane" }));

    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });

    expect(
      screen.getByRole("button", { name: "Close document pane" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Reload document" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Open in Vault" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Download document" }),
    ).toBeTruthy();

    // lp-5q6.15: focus lands on the pane region after open.
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByTestId("chat-document-pane"),
      );
    });
    expect(
      screen.getByTestId("chat-document-pane").getAttribute("data-layout"),
    ).toBe("split");

    fireEvent.click(
      screen.getByRole("button", { name: "Close document pane" }),
    );

    await waitFor(() => {
      expect(screen.queryByTestId("chat-document-pane")).toBeNull();
    });
  });

  it("shows title from artifact ref when open", async () => {
    renderWithProviders(<ShellHarness initialOpen />);

    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });
    // Toolbar title + VaultReader header both show the basename.
    expect(screen.getAllByText("README.md").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("/Projects/A/README.md")).toBeTruthy();
  });

  it("office-only: toolbar has Reload/Vault/Download/Close without Edit/Back chrome (lp-swt.2)", () => {
    const officeState: ArtifactPanelState = {
      ...createInitialArtifactPanelState(),
      status: "editing",
      mode: "edit",
      ref: {
        path: "/Projects/A/Proposal.docx",
        title: "Proposal.docx",
      },
      openGeneration: 1,
      officeSessionId: "sess-1",
    };

    renderWithProviders(
      <DocumentPaneShell
        state={officeState}
        content={null}
        isLoading={false}
        onClose={() => {}}
        onReload={() => {}}
        onOpenInVault={() => {}}
        onDownload={() => {}}
        officeEditor={{
          active: true,
          session: null,
          error: null,
          isLoading: true,
        }}
        editControls={null}
      />,
    );

    expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    expect(screen.getByText("Proposal.docx")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Reload document" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Open in Vault" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Download document" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Close document pane" }),
    ).toBeTruthy();
    expect(screen.queryByTestId("chat-document-pane-edit")).toBeNull();
    expect(screen.queryByTestId("chat-document-pane-exit-edit")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Edit document" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Back to preview" }),
    ).toBeNull();
  });

  it("renders agent progress strip with label and percent (lp-5q6.16)", () => {
    const state: ArtifactPanelState = {
      ...createInitialArtifactPanelState(),
      status: "progress",
      ref: { path: "/Projects/A/README.md", title: "README.md" },
      openGeneration: 1,
      progress: {
        operationId: "op-1",
        percent: 42,
        message: "Drafting section 2",
        phase: "writing",
      },
    };

    renderWithProviders(
      <DocumentPaneShell
        state={state}
        content={MD_CONTENT}
        isLoading={false}
        onClose={() => {}}
        onReload={() => {}}
        onOpenInVault={() => {}}
        onDownload={() => {}}
      />,
    );

    expect(screen.getByTestId("chat-document-pane-progress")).toBeTruthy();
    expect(screen.getByText("Drafting section 2")).toBeTruthy();
    expect(screen.getByText("42%")).toBeTruthy();
    expect(screen.getByTestId("chat-document-pane-progress-bar")).toBeTruthy();
    // Content remains visible under the strip (not forced into empty loading).
    expect(screen.getByText("Hello from vault")).toBeTruthy();
  });

  it("shows body when content is ready even if status is still opening (lp-dpr.1)", () => {
    const state: ArtifactPanelState = {
      ...createInitialArtifactPanelState(),
      status: "opening",
      ref: { path: "/Projects/A/README.md", title: "README.md" },
      openGeneration: 2,
    };

    renderWithProviders(
      <DocumentPaneShell
        state={state}
        content={MD_CONTENT}
        isLoading={false}
        onClose={() => {}}
        onReload={() => {}}
        onOpenInVault={() => {}}
        onDownload={() => {}}
      />,
    );

    expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    expect(screen.getByText("/Projects/A/README.md")).toBeTruthy();
    // Must not force Loading… over already-fetched bytes.
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(screen.getByText("Hello from vault")).toBeTruthy();
    expect(screen.queryByText("Select a file")).toBeNull();
  });

  it("falls back to VaultReader when OnlyOffice mint fails without session (lp-dpr.1)", () => {
    const state: ArtifactPanelState = {
      ...createInitialArtifactPanelState(),
      status: "opening",
      mode: "edit",
      ref: {
        path: "/Business/Legal/contracts/Note.docx",
        title: "Note.docx",
      },
      openGeneration: 1,
    };

    const officeContent = {
      path: "/Business/Legal/contracts/Note.docx",
      mime_type:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      encoding: "base64" as const,
      // Minimal zip header so docx-preview path is not required for this shell test —
      // VaultReader will try to parse; we only assert body renderer choice.
      content: btoa("PK"),
    };

    renderWithProviders(
      <DocumentPaneShell
        state={state}
        content={officeContent}
        isLoading={false}
        onClose={() => {}}
        onReload={() => {}}
        onOpenInVault={() => {}}
        onDownload={() => {}}
        officeEditor={{
          active: true,
          session: null,
          error: {
            code: "config_mint_failed",
            message: "Could not open Office session",
          },
          isLoading: false,
        }}
      />,
    );

    const body = screen.getByTestId("chat-document-pane-body");
    expect(body.getAttribute("data-renderer")).toBe("preview");
    expect(screen.getByTestId("chat-document-pane").getAttribute("data-office-fallback")).toBe(
      "preview",
    );
    // Office host must not claim the body when mint failed hard.
    expect(screen.queryByTestId("onlyoffice-editor-error")).toBeNull();
    expect(screen.queryByTestId("onlyoffice-editor-host")).toBeNull();
  });

  it("shows loading body (not Select a file) while open without content (lp-dpr.1)", () => {
    const state: ArtifactPanelState = {
      ...createInitialArtifactPanelState(),
      status: "opening",
      ref: { path: "/Projects/A/README.md", title: "README.md" },
      openGeneration: 1,
    };

    renderWithProviders(
      <DocumentPaneShell
        state={state}
        content={null}
        isLoading={true}
        onClose={() => {}}
        onReload={() => {}}
        onOpenInVault={() => {}}
        onDownload={() => {}}
      />,
    );

    expect(screen.getByText("/Projects/A/README.md")).toBeTruthy();
    expect(screen.getByText("Loading…")).toBeTruthy();
    expect(screen.queryByText("Select a file")).toBeNull();
  });

  it("renders checkpoint offer and open action (lp-5q6.16)", () => {
    const onOpenCheckpoint = vi.fn();
    const onDismissCheckpoint = vi.fn();
    const state: ArtifactPanelState = {
      ...createInitialArtifactPanelState(),
      status: "previewing",
      ref: { path: "/Projects/A/README.md", title: "README.md" },
      openGeneration: 1,
      checkpointOffer: {
        ref: {
          path: "/Projects/A/.lanyard/checkpoints/README.md/run-1.md",
          title: "README.md (checkpoint)",
          source: "agent_checkpoint",
        },
        revision: { token: "cp-1", kind: "etag" },
        sourcePath: "/Projects/A/README.md",
        message:
          "Agent wrote a checkpoint. Open it in the pane without leaving your current document.",
      },
    };

    renderWithProviders(
      <DocumentPaneShell
        state={state}
        content={MD_CONTENT}
        isLoading={false}
        onClose={() => {}}
        onReload={() => {}}
        onOpenInVault={() => {}}
        onDownload={() => {}}
        onOpenCheckpoint={onOpenCheckpoint}
        onDismissCheckpoint={onDismissCheckpoint}
      />,
    );

    expect(screen.getByTestId("chat-document-pane-checkpoint")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Open agent checkpoint" }),
    );
    expect(onOpenCheckpoint).toHaveBeenCalledTimes(1);
  });

  it("renders conflict open-checkpoint action when alternateRef set", () => {
    const onOpenCheckpoint = vi.fn();
    const state: ArtifactPanelState = {
      ...createInitialArtifactPanelState(),
      status: "conflict",
      ref: { path: "/Projects/A/README.md", title: "README.md" },
      openGeneration: 1,
      localDirty: true,
      conflict: {
        reason: "human_edit_active",
        path: "/Projects/A/README.md",
        alternateRef: {
          path: "/.lanyard/checkpoints/memo.md",
          source: "agent_checkpoint",
        },
        message: "Agent wrote a checkpoint while you have an active edit.",
        offeredActions: ["open_checkpoint", "discard_local"],
      },
    };

    renderWithProviders(
      <DocumentPaneShell
        state={state}
        content={MD_CONTENT}
        isLoading={false}
        onClose={() => {}}
        onReload={() => {}}
        onOpenInVault={() => {}}
        onDownload={() => {}}
        onOpenCheckpoint={onOpenCheckpoint}
        onDiscardLocal={() => {}}
      />,
    );

    expect(screen.getByTestId("chat-document-pane-conflict")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Open agent checkpoint" }),
    );
    expect(onOpenCheckpoint).toHaveBeenCalledTimes(1);
  });

  it("shows conflict/reload banner when dirty edit meets external revision (lp-5q6.24)", () => {
    const onReload = vi.fn();
    const conflictState: ArtifactPanelState = {
      ...createInitialArtifactPanelState(),
      status: "conflict",
      ref: { path: "/Projects/A/README.md", title: "README.md" },
      knownRevision: { token: "etag-1", kind: "etag" },
      mode: "edit",
      officeSessionId: "sess-1",
      localDirty: true,
      openGeneration: 1,
      conflict: {
        reason: "superseded_base",
        path: "/Projects/A/README.md",
        expectedRevision: { token: "etag-1", kind: "etag" },
        actualRevision: { token: "etag-2", kind: "etag" },
        message:
          "Document changed while you were editing. Reload or save a conflict copy.",
        offeredActions: ["reload", "save_as_conflict_copy", "discard_local"],
      },
    };

    renderWithProviders(
      <DocumentPaneShell
        state={conflictState}
        content={MD_CONTENT}
        isLoading={false}
        onClose={() => {}}
        onReload={onReload}
        onOpenInVault={() => {}}
        onDownload={() => {}}
      />,
    );

    const banner = screen.getByTestId("document-pane-conflict-banner");
    expect(banner).toBeTruthy();
    const strip = screen.getByTestId("chat-document-pane-conflict");
    expect(strip.getAttribute("data-conflict-reason")).toBe("superseded_base");
    expect(strip.getAttribute("role")).toBe("alert");
    expect(
      screen.getByText(/Document changed outside the editor/i),
    ).toBeTruthy();
    expect(
      screen.getByText(/Document changed while you were editing/i),
    ).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Discard local and reload" }),
    );
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});

describe("ChatView document pane integration", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", MockEventSource);
    vi.mocked(createChatThread).mockResolvedValue({
      thread_id: "thread-1",
      title: "New chat",
      project_id: null,
      project_vault_path: null,
      created_at: "2026-07-01T12:00:00.000Z",
    });
    vi.mocked(fetchVaultContent).mockResolvedValue(MD_CONTENT);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("opens and closes the right-side pane without leaving chat layout", async () => {
    const onOpenInVault = vi.fn();

    render(
      <Providers>
        <SettingsSnapshotProvider>
          <ChatThreadProvider>
            <ChatView
              documentOpenRequest={{
                path: "/Projects/A/README.md",
                key: 1,
                title: "README.md",
              }}
              onOpenInVault={onOpenInVault}
            />
          </ChatThreadProvider>
        </SettingsSnapshotProvider>
      </Providers>,
    );

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(fetchVaultContent).toHaveBeenCalledWith("/Projects/A/README.md");
    });

    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });

    // Chat column still present
    expect(screen.getByRole("log")).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "Message input" }),
    ).toBeTruthy();

    // Markdown preview from VaultReader
    await waitFor(() => {
      expect(screen.getByText("Hello from vault")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Open in Vault" }));
    expect(onOpenInVault).toHaveBeenCalledWith("/Projects/A/README.md");

    fireEvent.click(
      screen.getByRole("button", { name: "Download document" }),
    );
    await waitFor(() => {
      expect(downloadVaultFile).toHaveBeenCalledWith("/Projects/A/README.md");
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Close document pane" }),
    );

    await waitFor(() => {
      expect(screen.queryByTestId("chat-document-pane")).toBeNull();
    });

    // Composer remains usable after close
    expect(
      screen.getByRole("combobox", { name: "Message input" }),
    ).toBeTruthy();
  });

  it("reloads preview content when reload is clicked", async () => {
    render(
      <Providers>
        <SettingsSnapshotProvider>
          <ChatThreadProvider>
            <ChatView
              documentOpenRequest={{
                path: "/Projects/A/README.md",
                key: 1,
              }}
            />
          </ChatThreadProvider>
        </SettingsSnapshotProvider>
      </Providers>,
    );

    await waitFor(() => {
      expect(fetchVaultContent).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Reload document" }));

    await waitFor(() => {
      expect(fetchVaultContent).toHaveBeenCalledTimes(2);
    });
  });
});

describe("ChatView citation → document pane (lp-5q6.14)", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", MockEventSource);
    vi.mocked(createChatThread).mockResolvedValue({
      thread_id: "thread-1",
      title: "New chat",
      project_id: null,
      project_vault_path: null,
      created_at: "2026-07-01T12:00:00.000Z",
    });
    vi.mocked(fetchVaultContent).mockResolvedValue(MD_CONTENT);
    vi.mocked(fetchThreadHistory).mockResolvedValue([
      {
        type: "user_message",
        message_id: "u1",
        content: "Show me the readme",
        created_at: "2026-07-01T12:00:00.000Z",
        chat_id: "thread-1",
      },
      {
        type: "message_send",
        chat_id: "thread-1",
        message_id: "a1",
        content: "See [README](/Projects/A/README.md) for details.",
        citations: [
          { path: "/Projects/A/README.md", title: "README.md" },
        ],
        created_at: "2026-07-01T12:00:01.000Z",
      },
    ]);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("citation click opens the document pane without vault-tab navigate", async () => {
    const onCitationNavigate = vi.fn();
    const onOpenInVault = vi.fn();

    render(
      <Providers>
        <SettingsSnapshotProvider>
          <ChatThreadProvider>
            <ChatView
              onCitationNavigate={onCitationNavigate}
              onOpenInVault={onOpenInVault}
            />
          </ChatThreadProvider>
        </SettingsSnapshotProvider>
      </Providers>,
    );

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });

    const citation = await screen.findByTestId("vault-citation-1");
    fireEvent.click(citation);

    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });

    await waitFor(() => {
      expect(fetchVaultContent).toHaveBeenCalledWith("/Projects/A/README.md");
    });

    // Stays on chat: primary navigate to vault tab must not fire.
    expect(onCitationNavigate).not.toHaveBeenCalled();

    // Secondary escape hatch still works from the pane toolbar.
    fireEvent.click(screen.getByRole("button", { name: "Open in Vault" }));
    expect(onOpenInVault).toHaveBeenCalledWith("/Projects/A/README.md");

    // Chat column still present
    expect(screen.getByRole("log")).toBeTruthy();
    expect(
      screen.getByRole("combobox", { name: "Message input" }),
    ).toBeTruthy();
  });

  it("lp-ye4.11: currentness strip + history panel show revision/op/actor", () => {
    const state: ArtifactPanelState = {
      ...createInitialArtifactPanelState(),
      status: "previewing",
      ref: { path: "/Projects/Legal/memo.md", title: "memo.md" },
      knownRevision: { token: "sha256:rev-v2", kind: "content_hash" },
      openGeneration: 1,
    };
    const onToggleHistory = vi.fn();
    renderWithProviders(
      <DocumentPaneShell
        state={state}
        content={MD_CONTENT}
        isLoading={false}
        onClose={() => {}}
        onReload={() => {}}
        onOpenInVault={() => {}}
        onDownload={() => {}}
        currentnessChrome={{
          currentness: {
            path: "/Projects/Legal/memo.md",
            revisionToken: "sha256:rev-v2",
            operationId: "op_01HUMANWRITE0001",
            actorLabel: "Ada",
            actorKind: "human",
            headKind: "canonical",
            headKindLabel: "Canonical",
            isCheckpoint: false,
          },
          staleDecision: {
            action: "none",
            currentness: {
              path: "/Projects/Legal/memo.md",
              revisionToken: "sha256:rev-v2",
              operationId: "op_01HUMANWRITE0001",
              actorLabel: "Ada",
              headKind: "canonical",
              headKindLabel: "Canonical",
              isCheckpoint: false,
            },
          },
          historyOpen: true,
          onToggleHistory,
          historyEvents: [
            {
              operation_id: "op_01HUMANWRITE0001",
              kind: "file_replace",
              actor: {
                kind: "human",
                subject_id: "usr_example",
                display_name: "Ada",
              },
              target: { path: "/Projects/Legal/memo.md" },
              result: { status: "committed", reason: "ok" },
            },
          ],
          historyLoading: false,
          historyError: null,
          historyUnavailable: false,
        }}
      />,
    );

    const strip = screen.getByTestId("chat-document-pane-currentness");
    expect(strip.getAttribute("data-operation-id")).toBe("op_01HUMANWRITE0001");
    expect(strip.getAttribute("data-head-kind")).toBe("canonical");
    expect(strip.getAttribute("data-revision-token")).toBe("sha256:rev-v2");
    expect(strip.textContent).toContain("Ada");
    expect(strip.textContent).toContain("Canonical");

    expect(screen.getByTestId("chat-document-pane-history")).toBeTruthy();
    expect(screen.getByTestId("chat-document-pane-history-row").textContent).toContain(
      "file_replace",
    );
  });

  it("lp-ye4.11: stale head shows reload action", () => {
    const state: ArtifactPanelState = {
      ...createInitialArtifactPanelState(),
      status: "previewing",
      ref: { path: "/Projects/Legal/memo.md", title: "memo.md" },
      knownRevision: { token: "sha256:rev-v1", kind: "content_hash" },
      openGeneration: 1,
    };
    const onReload = vi.fn();
    renderWithProviders(
      <DocumentPaneShell
        state={state}
        content={MD_CONTENT}
        isLoading={false}
        onClose={() => {}}
        onReload={onReload}
        onOpenInVault={() => {}}
        onDownload={() => {}}
        currentnessChrome={{
          currentness: {
            path: "/Projects/Legal/memo.md",
            revisionToken: "sha256:rev-v2",
            operationId: "op_new",
            actorLabel: "Bob",
            headKind: "canonical",
            headKindLabel: "Canonical",
            isCheckpoint: false,
          },
          staleDecision: {
            action: "reload",
            currentness: {
              path: "/Projects/Legal/memo.md",
              revisionToken: "sha256:rev-v2",
              operationId: "op_new",
              actorLabel: "Bob",
              headKind: "canonical",
              headKindLabel: "Canonical",
              isCheckpoint: false,
            },
            invalidation: {
              action: "reload",
              autoRefresh: true,
              revisionsMatch: false,
              reason: "external_revision_advance",
            },
          },
          historyOpen: false,
          onToggleHistory: () => {},
          historyEvents: [],
          historyLoading: false,
          historyError: null,
          historyUnavailable: false,
        }}
      />,
    );

    expect(screen.getByTestId("chat-document-pane-stale")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Reload to current head" }),
    );
    expect(onReload).toHaveBeenCalled();
  });
});
