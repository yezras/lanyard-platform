/**
 * Chat pane ONLYOFFICE integration (lp-5q6.30).
 *
 * Covers: renderer choice from type/capability/flag/mode; preview fallback;
 * view ↔ edit switch; progress strip coexistence; Office open from citation,
 * artifact event, and manual open.
 */
import {
  cleanup,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useEffect, useMemo, useReducer, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MintOfficeSessionSuccess } from "../../../api/office.js";
import { Providers } from "../../../app/providers.js";
import { ChatThreadProvider } from "../../projects/ChatThreadContext.js";
import { SettingsSnapshotProvider } from "../../settings/SettingsSnapshotContext.js";
import { ChatView } from "../ChatView.js";

import {
  artifactPanelReducer,
  createInitialArtifactPanelState,
} from "./artifactPanelReducer.js";
import {
  openDocumentPathAction,
  panelActionsFromChatEvent,
} from "./chatArtifactRouting.js";
import { resolveChatDocumentRenderer } from "./chatDocumentRenderer.js";
import { DocumentPaneShell } from "./DocumentPaneShell.js";
import type { DocsApiGlobal } from "./onlyOfficeTypes.js";
import type { ArtifactPanelState } from "./types.js";
import { useOfficeEditorSession } from "./useOfficeEditorSession.js";

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
  fetchVaultContent: vi.fn().mockImplementation(async (path: string) => {
    if (String(path).endsWith(".docx")) {
      return {
        path,
        mime_type:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        encoding: "base64",
        content: btoa("fake-docx"),
      };
    }
    return {
      path,
      mime_type: "text/markdown",
      encoding: "utf-8",
      content: "# Hello\n",
    };
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

vi.mock("../../../api/context.js", () => ({
  fetchPortalContext: vi.fn().mockResolvedValue({
    brain_rpc_enabled: true,
    ui: { can: { vault_edit: true } },
  }),
}));

import { createChatThread } from "../../../api/chat.js";

class MockEventSource {
  close(): void {}
  addEventListener(): void {}
}

const DOCX = "/Projects/A/Proposal.docx";

const MINT_EDIT: MintOfficeSessionSuccess = {
  session_id: "sess-chat-edit",
  document_key: "dk-chat",
  base_revision: { token: "r1", kind: "etag" },
  mode: "edit",
  file_type: "docx",
  path: DOCX,
  expires_at: "2099-01-01T00:00:00.000Z",
  editor_config: {
    documentType: "word",
    document: {
      fileType: "docx",
      key: "dk-chat",
      title: "Proposal.docx",
      url: "https://bff/content",
      permissions: {
        edit: true,
        review: false,
        comment: false,
        download: true,
        print: true,
        fillForms: false,
        modifyFilter: false,
        modifyContentControl: false,
        copy: true,
        chat: false,
      },
    },
    editorConfig: {
      mode: "edit",
      callbackUrl: "https://bff/callback",
      user: { id: "u1", name: "Ada" },
      lang: "en",
    },
    token: "jwt",
  },
  idempotent_replay: false,
};

function mockDocsApi(): DocsApiGlobal {
  return {
    DocEditor: class {
      constructor(
        _id: string,
        config: {
          events?: {
            onAppReady?: () => void;
            onDocumentReady?: () => void;
          };
        },
      ) {
        queueMicrotask(() => {
          config.events?.onAppReady?.();
          config.events?.onDocumentReady?.();
        });
      }
      destroyEditor(): void {}
    },
  };
}

function OfficePaneHarness(props: {
  openPath: string;
  openSource?: "citation" | "artifact_event" | "deep_link" | "tool_target";
  /** How to open: citation action, artifact event, or manual PANEL_OPEN. */
  openVia: "citation" | "artifact_event" | "manual";
  canVaultEdit?: boolean | null;
  editorEnabled?: boolean;
  mint?: typeof import("../../../api/office.js").mintOfficeSession;
}) {
  const [state, dispatch] = useReducer(
    artifactPanelReducer,
    undefined,
    createInitialArtifactPanelState,
  );

  useEffect(() => {
    if (props.openVia === "citation") {
      const action = openDocumentPathAction(props.openPath, {
        source: "citation",
        projectVaultPath: "/Projects/A",
      });
      if (action) dispatch(action);
      return;
    }
    if (props.openVia === "artifact_event") {
      const actions = panelActionsFromChatEvent(
        {
          type: "message_send",
          chat_id: "thread-1",
          metadata: {
            portal_event: "artifact.open",
            thread_id: "thread-1",
            artifact_id: "op:office-1",
            vault_path: props.openPath,
            title: "Proposal.docx",
            file_type: "docx",
            producer: "agent",
            status: "open",
            preferred_mode: "preview",
            timestamp: "2026-07-24T12:00:00.000Z",
          },
        },
        { thread_id: "thread-1", project_vault_path: "/Projects/A" },
      );
      for (const a of actions) dispatch(a);
      return;
    }
    dispatch({
      type: "PANEL_OPEN",
      ref: {
        path: props.openPath,
        title: "Proposal.docx",
        source: props.openSource ?? "deep_link",
      },
      mode: "preview",
    });
  }, [props.openPath, props.openVia, props.openSource]);

  // Settle opening → ready so non-office preview path can finish.
  useEffect(() => {
    if (state.status === "opening" && state.ref) {
      dispatch({
        type: "PANEL_PREVIEW_READY",
        openGeneration: state.openGeneration,
      });
    }
  }, [state.status, state.openGeneration, state.ref]);

  const decision = useMemo(
    () =>
      resolveChatDocumentRenderer({
        path: state.ref?.path,
        mode: state.mode,
        canVaultEdit: props.canVaultEdit ?? true,
        editorEnabled: props.editorEnabled ?? true,
      }),
    [
      state.ref?.path,
      state.mode,
      props.canVaultEdit,
      props.editorEnabled,
    ],
  );

  const mint =
    props.mint ??
    (vi.fn().mockResolvedValue(MINT_EDIT) as typeof import("../../../api/office.js").mintOfficeSession);

  const office = useOfficeEditorSession({
    state,
    dispatch,
    enabled: decision.officeActive ? props.editorEnabled ?? true : false,
    documentServerUrl: "https://ds.test",
    mint,
  });

  return (
    <DocumentPaneShell
      state={state}
      content={
        state.ref
          ? {
              path: state.ref.path,
              mime_type:
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
              encoding: "base64",
              content: btoa("fake"),
            }
          : null
      }
      isLoading={state.status === "opening"}
      onClose={() => dispatch({ type: "PANEL_CLOSE", reason: "user" })}
      onReload={() => dispatch({ type: "PANEL_RELOAD" })}
      onOpenInVault={() => {}}
      onDownload={() => {}}
      officeEditor={
        office.active
          ? {
              active: true,
              session: office.session,
              error: office.error,
              isLoading: office.isLoading,
              loadDocsApi: async () => mockDocsApi(),
              // Office-only: close dismisses pane (no Back to preview).
              onRequestClose: () =>
                dispatch({ type: "PANEL_CLOSE", reason: "user" }),
            }
          : null
      }
      // Office-only (lp-swt.2): never pass Edit / Back dual-mode controls.
      editControls={
        decision.showEdit || decision.showExitEdit
          ? {
              showEdit: decision.showEdit,
              showExitEdit: decision.showExitEdit,
              onRequestEdit: () => dispatch({ type: "PANEL_REQUEST_EDIT" }),
              onExitEdit: () => dispatch({ type: "PANEL_EXIT_EDIT" }),
            }
          : null
      }
    />
  );
}

function renderWithProviders(node: ReactNode) {
  return render(
    <Providers>
      <SettingsSnapshotProvider>
        <ChatThreadProvider>{node}</ChatThreadProvider>
      </SettingsSnapshotProvider>
    </Providers>,
  );
}

afterEach(() => {
  cleanup();
});

describe("chat document Office renderer (lp-5q6.30 / lp-swt.2)", () => {
  it("opens Office path from citation straight into OnlyOffice (no Edit chrome)", async () => {
    const mint = vi.fn().mockResolvedValue(MINT_EDIT);
    renderWithProviders(
      <OfficePaneHarness openPath={DOCX} openVia="citation" mint={mint} />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });
    const pane = screen.getByTestId("chat-document-pane");
    await waitFor(() => {
      expect(pane.getAttribute("data-renderer")).toBe("onlyoffice");
    });
    expect(pane.getAttribute("data-mode")).toBe("edit");
    expect(screen.queryByTestId("chat-document-pane-edit")).toBeNull();
    expect(screen.queryByTestId("chat-document-pane-exit-edit")).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId("onlyoffice-editor-host")).toBeTruthy();
    });
    expect(mint).toHaveBeenCalled();
    expect(mint.mock.calls[0]?.[0]?.mode).toBe("edit");
  });

  it("opens Office path from artifact.open event into OnlyOffice", async () => {
    renderWithProviders(
      <OfficePaneHarness openPath={DOCX} openVia="artifact_event" />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("chat-document-pane").getAttribute("data-renderer"),
      ).toBe("onlyoffice");
    });
    expect(screen.queryByTestId("chat-document-pane-edit")).toBeNull();
    expect(screen.queryByTestId("chat-document-pane-exit-edit")).toBeNull();
  });

  it("opens Office path from manual open into OnlyOffice without Edit click", async () => {
    const mint = vi.fn().mockResolvedValue(MINT_EDIT);
    renderWithProviders(
      <OfficePaneHarness
        openPath={DOCX}
        openVia="manual"
        openSource="deep_link"
        mint={mint}
      />,
    );
    await waitFor(() => {
      expect(
        screen.getByTestId("chat-document-pane").getAttribute("data-renderer"),
      ).toBe("onlyoffice");
    });
    await waitFor(() => {
      expect(mint).toHaveBeenCalled();
    });
    expect(mint.mock.calls[0]?.[0]?.mode).toBe("edit");
    expect(screen.queryByTestId("chat-document-pane-edit")).toBeNull();
    expect(screen.queryByTestId("chat-document-pane-exit-edit")).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId("onlyoffice-editor-host")).toBeTruthy();
    });
  });

  it("keeps VaultReader when vault_edit is missing (no dead Edit)", async () => {
    renderWithProviders(
      <OfficePaneHarness
        openPath={DOCX}
        openVia="manual"
        canVaultEdit={false}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });
    expect(screen.queryByTestId("chat-document-pane-edit")).toBeNull();
    expect(screen.queryByTestId("chat-document-pane-exit-edit")).toBeNull();
    expect(
      screen.getByTestId("chat-document-pane").getAttribute("data-renderer"),
    ).toBe("preview");
  });

  it("keeps VaultReader when feature flag is off (no dead Edit)", async () => {
    renderWithProviders(
      <OfficePaneHarness
        openPath={DOCX}
        openVia="manual"
        editorEnabled={false}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });
    expect(screen.queryByTestId("chat-document-pane-edit")).toBeNull();
    expect(screen.queryByTestId("chat-document-pane-exit-edit")).toBeNull();
    expect(
      screen.getByTestId("chat-document-pane").getAttribute("data-renderer"),
    ).toBe("preview");
  });

  it("agent progress strip coexists with editor without covering body", async () => {
    const progressState: ArtifactPanelState = {
      ...createInitialArtifactPanelState(),
      status: "editing",
      mode: "edit",
      ref: { path: DOCX, title: "Proposal.docx" },
      openGeneration: 1,
      officeSessionId: "sess-1",
      progress: {
        operationId: "op-1",
        percent: 40,
        message: "Agent drafting section",
        phase: "writing",
      },
    };

    renderWithProviders(
      <DocumentPaneShell
        state={progressState}
        content={null}
        isLoading={false}
        onClose={() => {}}
        onReload={() => {}}
        onOpenInVault={() => {}}
        onDownload={() => {}}
        officeEditor={{
          active: true,
          session: {
            sessionId: "sess-1",
            documentKey: "dk",
            documentServerUrl: "https://ds.test",
            mode: "edit",
            fileType: "docx",
            path: DOCX,
            expiresAt: "2099-01-01T00:00:00.000Z",
            baseRevision: { token: "r1", kind: "etag" },
            editorConfig: MINT_EDIT.editor_config,
          },
          error: null,
          isLoading: false,
          loadDocsApi: async () => mockDocsApi(),
        }}
        // Office-only: no dual-mode edit controls.
        editControls={null}
      />,
    );

    const pane = screen.getByTestId("chat-document-pane");
    expect(pane.getAttribute("data-renderer")).toBe("onlyoffice");
    expect(pane.getAttribute("data-progress-with-editor")).toBe("true");
    expect(screen.queryByTestId("chat-document-pane-edit")).toBeNull();
    expect(screen.queryByTestId("chat-document-pane-exit-edit")).toBeNull();

    const progress = screen.getByTestId("chat-document-pane-progress");
    expect(progress.getAttribute("data-coexist-editor")).toBe("true");
    // Strip is in document flow (relative), not absolute over the editor frame.
    expect(progress.style.position).toBe("relative");

    const body = screen.getByTestId("chat-document-pane-body");
    expect(body.getAttribute("data-renderer")).toBe("onlyoffice");
    await waitFor(() => {
      expect(screen.getByTestId("onlyoffice-editor-host")).toBeTruthy();
    });
  });
});

describe("ChatView Office open paths (lp-5q6.30 / lp-swt.2)", () => {
  beforeEach(() => {
    vi.stubGlobal("EventSource", MockEventSource);
    vi.mocked(createChatThread).mockResolvedValue({
      thread_id: "thread-1",
      title: "New chat",
      project_id: null,
      project_vault_path: null,
      created_at: "2026-07-01T12:00:00.000Z",
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("manual documentOpenRequest opens Office file into OnlyOffice without Edit chrome", async () => {
    render(
      <Providers>
        <SettingsSnapshotProvider>
          <ChatThreadProvider>
            <ChatView
              canVaultEdit={true}
              onlyOfficeEditorEnabled={true}
              documentOpenRequest={{
                path: DOCX,
                key: 1,
                title: "Proposal.docx",
                source: "deep_link",
              }}
            />
          </ChatThreadProvider>
        </SettingsSnapshotProvider>
      </Providers>,
    );

    await waitFor(() => {
      expect(createChatThread).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByTestId("chat-document-pane")).toBeTruthy();
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("chat-document-pane").getAttribute("data-mode"),
      ).toBe("edit");
    });
    // Office-only: no Edit / Back dual-mode controls.
    expect(screen.queryByTestId("chat-document-pane-edit")).toBeNull();
    expect(screen.queryByTestId("chat-document-pane-exit-edit")).toBeNull();
  });
});
