/**
 * Auth-free story for Playwright layout screenshots and browser QA
 * (lp-5q6.13 / lp-5q6.15 / lp-5q6.16 / lp-5q6.27 / lp-5q6.37).
 *
 * Mounted when Vite is opened with `?story=document-pane`.
 * Optional `?layout=split|drawer` forces desktop split or mobile drawer.
 * Optional `?mode=progress|checkpoint|onlyoffice|flag_off|ds_unavailable|…`
 * demos agent UX, mocked ONLYOFFICE, or preview fallback.
 * Optional `?open=citation` starts closed; click a vault citation chip to open.
 * Uses fixture preview content — no BFF session required.
 */

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import type { VaultFileContent } from "../../../api/types.js";

import { openDocumentPathAction } from "./chatArtifactRouting.js";
import { DocumentPaneHost } from "./DocumentPaneHost.js";
import type {
  DocumentPaneEditControls,
  DocumentPaneOfficeEditorSlot,
} from "./DocumentPaneShell.js";
import {
  mapSaveFailureToEditorError,
  officeEditorError,
} from "./onlyOfficeEditorErrors.js";
import type { DocsApiGlobal, OfficeEditorSessionConfig } from "./onlyOfficeTypes.js";
import type { DocumentPaneLayoutPreference } from "./useDocumentPaneNarrow.js";
import type { ArtifactPanelState } from "./types.js";

const rootStyle: CSSProperties = {
  height: "100dvh",
  width: "100%",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  containerType: "inline-size",
  containerName: "chat",
};

const splitRowStyle: CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "row",
  minHeight: 0,
  minWidth: 0,
  width: "100%",
};

const chatColumnStyle: CSSProperties = {
  flex: 1,
  minWidth: 0,
  height: "100%",
  display: "flex",
  flexDirection: "column",
  padding: "var(--spacing-6, 1.5rem)",
  gap: "var(--spacing-3, 0.75rem)",
};

const composerStyle: CSSProperties = {
  marginTop: "auto",
  border: "1px solid var(--border-primary, rgba(0,0,0,0.1))",
  borderRadius: 12,
  padding: "var(--spacing-3, 0.75rem)",
  flexShrink: 0,
};

const citationChipStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  border: "1px solid var(--border-primary, rgba(0,0,0,0.15))",
  borderRadius: 999,
  padding: "4px 10px",
  fontSize: 13,
  cursor: "pointer",
  background: "var(--bg-secondary, #f4f4f5)",
  color: "var(--fg-primary, #0f172a)",
};

const FIXTURE_CONTENT: VaultFileContent = {
  path: "/Projects/A/README.md",
  mime_type: "text/markdown",
  encoding: "utf-8",
  content:
    "# Document pane preview\n\nThis is the **chat document pane** shell " +
    "(lp-5q6.13 / lp-5q6.15 / lp-5q6.16 / lp-5q6.37). Markdown, text, images, PDF, DOCX, XLSX, and PPTX reuse " +
    "existing `VaultReader` previews.\n\n- Resizable desktop split (min/max widths)\n" +
    "- Mobile full-screen drawer\n- Labeled icon controls with tooltips\n" +
    "- Focus moves into the pane on open\n- Agent progress strip and checkpoint offer\n" +
    "- Citation open + Office preview fallback (browser QA)\n",
};

/** Markdown stand-in when Office feature flag is off (preview fallback). */
const FLAG_OFF_PREVIEW_CONTENT: VaultFileContent = {
  path: "/Projects/A/Proposal.docx",
  mime_type: "text/markdown",
  encoding: "utf-8",
  content:
    "# Proposal.docx — preview fallback\n\n" +
    "ONLYOFFICE feature flag is **off**. The chat pane keeps the existing " +
    "VaultReader / lightweight preview path (lp-5q6.30 / lp-5q6.37).\n\n" +
    "No Document Server iframe is mounted.\n",
};

/** Markdown stand-in after DS unavailable → back to preview. */
const DS_FALLBACK_PREVIEW_CONTENT: VaultFileContent = {
  path: "/Projects/A/Proposal.docx",
  mime_type: "text/markdown",
  encoding: "utf-8",
  content:
    "# Proposal.docx — preview after Document Server unavailable\n\n" +
    "Document Server failed to load. The pane fell back to the existing " +
    "read-only preview (lp-5q6.37).\n",
};

const CLOSED_STATE: ArtifactPanelState = {
  status: "closed",
  ref: null,
  knownRevision: null,
  mode: "preview",
  officeSessionId: null,
  progress: null,
  conflict: null,
  checkpointOffer: null,
  error: null,
  localDirty: false,
  openGeneration: 0,
};

const BASE_STATE: ArtifactPanelState = {
  status: "previewing",
  ref: {
    path: "/Projects/A/README.md",
    title: "README.md",
    source: "deep_link",
  },
  knownRevision: { token: "etag-story-1", kind: "etag" },
  mode: "preview",
  officeSessionId: null,
  progress: null,
  conflict: null,
  checkpointOffer: null,
  error: null,
  localDirty: false,
  openGeneration: 1,
};

/** Fixture Office session for mocked DocsAPI story (no BFF / live DS). */
export const STORY_OFFICE_SESSION: OfficeEditorSessionConfig = {
  sessionId: "story-office-session-1",
  documentKey: "dk-story-proposal-v1",
  mode: "view",
  fileType: "docx",
  path: "/Projects/A/Proposal.docx",
  expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  baseRevision: { token: "etag-story-docx-1", kind: "etag" },
  documentServerUrl: "http://127.0.0.1:8080",
  editorConfig: {
    documentType: "word",
    document: {
      fileType: "docx",
      key: "dk-story-proposal-v1",
      title: "Proposal.docx",
      url: "https://bff.example/office/content",
      permissions: {
        edit: false,
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
      mode: "view",
      callbackUrl: "https://bff.example/office/callback",
      user: { id: "story-user", name: "Story User" },
      lang: "en",
    },
    token: "story.jwt.token",
  },
};

const OFFICE_STATE: ArtifactPanelState = {
  status: "previewing",
  ref: {
    path: "/Projects/A/Proposal.docx",
    title: "Proposal.docx",
    source: "deep_link",
  },
  knownRevision: { token: "etag-story-docx-1", kind: "etag" },
  mode: "preview",
  officeSessionId: "story-office-session-1",
  progress: null,
  conflict: null,
  checkpointOffer: null,
  error: null,
  localDirty: false,
  openGeneration: 1,
};

/**
 * Mock DocsAPI that paints a non-blank editor surface for Playwright screenshots.
 * Does not contact a real Document Server.
 */
export function createStoryDocsApi(): DocsApiGlobal {
  return {
    DocEditor: class StoryDocEditor {
      constructor(placeholderId: string, _config: Record<string, unknown>) {
        const el = document.getElementById(placeholderId);
        if (!el) return;
        el.replaceChildren();
        const frame = document.createElement("div");
        frame.setAttribute("data-testid", "onlyoffice-editor-mock-surface");
        frame.setAttribute("data-story-editor", "1");
        frame.style.cssText = [
          "display:flex",
          "flex-direction:column",
          "height:100%",
          "min-height:280px",
          "width:100%",
          "box-sizing:border-box",
          "padding:16px",
          "background:linear-gradient(180deg,#f8fafc 0%,#e2e8f0 100%)",
          "border:1px solid #cbd5e1",
          "border-radius:8px",
          "color:#0f172a",
          "font-family:system-ui,sans-serif",
        ].join(";");
        frame.innerHTML = [
          '<div style="font-weight:600;font-size:14px;margin-bottom:8px">ONLYOFFICE editor (mock)</div>',
          '<div style="font-size:13px;line-height:1.5;color:#334155">',
          "Proposal.docx — nonblank mount for lab screenshot (lp-5q6.27 / lp-5q6.37).",
          "<br/>Document Server api.js is mocked; BFF mint is not required for this story.",
          "</div>",
          '<div style="margin-top:auto;padding:12px;background:#fff;border-radius:6px;',
          'border:1px solid #e2e8f0;min-height:120px;font-size:13px;color:#1e293b">',
          "Lorem ipsum dolor sit amet — editor surface content.",
          "</div>",
        ].join("");
        el.appendChild(frame);
        const events = (
          _config as {
            events?: { onAppReady?: () => void; onDocumentReady?: () => void };
          }
        ).events;
        queueMicrotask(() => {
          events?.onAppReady?.();
          events?.onDocumentReady?.();
        });
      }
      destroyEditor(): void {
        /* no-op */
      }
    },
  };
}

function layoutPreferenceFromSearch(): DocumentPaneLayoutPreference {
  if (typeof window === "undefined") {
    return "auto";
  }
  const raw = new URLSearchParams(window.location.search).get("layout");
  if (raw === "split" || raw === "drawer") {
    return raw;
  }
  return "auto";
}

function openFromCitationRequested(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const q = new URLSearchParams(window.location.search);
  return q.get("open") === "citation" || q.get("mode") === "citation";
}

type StoryMode =
  | "preview"
  | "progress"
  | "checkpoint"
  | "onlyoffice"
  | "onlyoffice_save_error"
  | "flag_off"
  | "ds_unavailable"
  | "citation"
  /** lp-5q6.38: agent-finished revision ready for human Office edit. */
  | "e2e_chain";

function storyModeFromSearch(): StoryMode {
  if (typeof window === "undefined") {
    return "preview";
  }
  const raw = new URLSearchParams(window.location.search).get("mode");
  if (
    raw === "progress" ||
    raw === "checkpoint" ||
    raw === "onlyoffice" ||
    raw === "onlyoffice_save_error" ||
    raw === "flag_off" ||
    raw === "ds_unavailable" ||
    raw === "citation" ||
    raw === "e2e_chain"
  ) {
    return raw;
  }
  return "preview";
}

function citationTargetPath(mode: StoryMode): string {
  if (
    mode === "onlyoffice" ||
    mode === "flag_off" ||
    mode === "ds_unavailable" ||
    mode === "onlyoffice_save_error" ||
    mode === "e2e_chain"
  ) {
    return mode === "e2e_chain"
      ? "/Projects/Lab/e2e-proof.docx"
      : "/Projects/A/Proposal.docx";
  }
  return "/Projects/A/README.md";
}

/** Story state after agent write checkpoint (lp-5q6.38 product promise). */
const E2E_CHAIN_STATE: ArtifactPanelState = {
  status: "previewing",
  ref: {
    path: "/Projects/Lab/e2e-proof.docx",
    title: "e2e-proof.docx",
    source: "artifact_event",
  },
  knownRevision: {
    token: "sha256:agent-rev-localhost-e2e",
    kind: "content_hash",
    sizeBytes: 4096,
  },
  mode: "preview",
  officeSessionId: null,
  progress: null,
  conflict: null,
  checkpointOffer: null,
  error: null,
  localDirty: false,
  openGeneration: 2,
};

function stateForMode(mode: StoryMode, startClosed: boolean): ArtifactPanelState {
  if (startClosed) {
    return CLOSED_STATE;
  }
  if (mode === "e2e_chain") {
    return E2E_CHAIN_STATE;
  }
  if (
    mode === "onlyoffice" ||
    mode === "onlyoffice_save_error" ||
    mode === "flag_off" ||
    mode === "ds_unavailable"
  ) {
    return {
      ...OFFICE_STATE,
      ref: {
        path: "/Projects/A/Proposal.docx",
        title: "Proposal.docx",
        source: "deep_link",
      },
      // flag_off stays preview; ds_unavailable starts as editor attempt
      mode: "preview",
      officeSessionId:
        mode === "flag_off" ? null : OFFICE_STATE.officeSessionId,
    };
  }
  if (mode === "progress") {
    return {
      ...BASE_STATE,
      status: "progress",
      progress: {
        operationId: "story-op-1",
        percent: 42,
        message: "Drafting section 2",
        phase: "writing",
      },
    };
  }
  if (mode === "checkpoint") {
    return {
      ...BASE_STATE,
      checkpointOffer: {
        ref: {
          path: "/Projects/A/.lanyard/checkpoints/README.md/run-1.md",
          title: "README.md (checkpoint)",
          source: "agent_checkpoint",
        },
        revision: { token: "etag-cp-1", kind: "etag" },
        sourcePath: "/Projects/A/README.md",
        message:
          "Agent wrote a checkpoint. Open it in the pane without leaving your current document.",
      },
    };
  }
  return BASE_STATE;
}

function officeEditorSlotForMode(
  mode: StoryMode,
  preferPreviewFallback: boolean,
): DocumentPaneOfficeEditorSlot | null {
  if (preferPreviewFallback) {
    return null;
  }
  if (
    mode === "flag_off" ||
    mode === "preview" ||
    mode === "progress" ||
    mode === "checkpoint" ||
    mode === "citation" ||
    mode === "e2e_chain"
  ) {
    return null;
  }
  // lp-5q6.28: failed callback path — user-facing save error in pane body.
  if (mode === "onlyoffice_save_error") {
    return {
      active: true,
      session: null,
      error: mapSaveFailureToEditorError({
        code: "invalid_nonce",
        detail: "lab_story_failed_callback",
      }),
      isLoading: false,
    };
  }
  // lp-5q6.37: Document Server unavailable — load_failure error surface.
  if (mode === "ds_unavailable") {
    return {
      active: true,
      session: STORY_OFFICE_SESSION,
      error: null,
      isLoading: false,
      loadDocsApi: async () => {
        throw new Error("Document Server unreachable (story)");
      },
    };
  }
  if (mode !== "onlyoffice") {
    return null;
  }
  const docsApi = createStoryDocsApi();
  return {
    active: true,
    session: STORY_OFFICE_SESSION,
    error: null,
    isLoading: false,
    loadDocsApi: async () => docsApi,
  };
}

type ActionCounts = {
  close: number;
  reload: number;
  openInVault: number;
  download: number;
};

function openStateFromCitation(path: string, generation: number): ArtifactPanelState {
  const action = openDocumentPathAction(path, {
    source: "citation",
    projectVaultPath: "/Projects/A",
    title: path.split("/").filter(Boolean).at(-1) ?? path,
  });
  if (!action || action.type !== "PANEL_OPEN") {
    return {
      ...BASE_STATE,
      openGeneration: generation,
      ref: {
        path,
        title: path.split("/").filter(Boolean).at(-1) ?? path,
        source: "citation",
      },
    };
  }
  const isOffice = path.toLowerCase().endsWith(".docx");
  return {
    status: "previewing",
    ref: {
      ...action.ref,
      source: "citation",
    },
    knownRevision: isOffice
      ? { token: "etag-story-docx-1", kind: "etag" }
      : { token: "etag-story-1", kind: "etag" },
    mode: action.mode ?? "preview",
    officeSessionId: isOffice ? "story-office-session-1" : null,
    progress: null,
    conflict: null,
    checkpointOffer: null,
    error: null,
    localDirty: false,
    openGeneration: generation,
  };
}

function chatBodyCopy(
  mode: StoryMode,
  paneOpen: boolean,
  preferPreviewFallback: boolean,
): string {
  if (!paneOpen) {
    return "Click a citation chip to open the document pane (lp-5q6.14 / lp-5q6.37).";
  }
  if (mode === "onlyoffice" && !preferPreviewFallback) {
    return "Opened Proposal.docx in the flag-gated ONLYOFFICE editor host.";
  }
  if (mode === "onlyoffice_save_error") {
    return "Office save failed — user-facing callback error in the pane (lp-5q6.28).";
  }
  if (mode === "flag_off" || (mode === "onlyoffice" && preferPreviewFallback)) {
    return "Feature flag off — preview fallback for Proposal.docx (no ONLYOFFICE mount).";
  }
  if (mode === "ds_unavailable") {
    return preferPreviewFallback
      ? "Document Server unavailable — user returned to preview fallback."
      : "Document Server unavailable — editor load error; use Back to preview.";
  }
  if (mode === "e2e_chain") {
    return "Agent finished e2e-proof.docx (rev sha256:agent-rev-localhost-e2e). Pane refreshed — ready for human Office edit (lp-5q6.38 localhost mocklab).";
  }
  return "Opened vault document in the document pane for discussion.";
}

export function DocumentPaneStory() {
  const rootRef = useRef<HTMLDivElement>(null);
  const layoutPreference = useMemo(() => layoutPreferenceFromSearch(), []);
  const mode = useMemo(() => storyModeFromSearch(), []);
  const startClosed = useMemo(() => openFromCitationRequested(), []);
  const citationPath = useMemo(() => citationTargetPath(mode), [mode]);

  const [state, setState] = useState<ArtifactPanelState>(() =>
    stateForMode(mode, startClosed),
  );
  // When DS fails, user can fall back to preview without remounting the story.
  const [preferPreviewFallback, setPreferPreviewFallback] = useState(
    () => mode === "flag_off",
  );
  const [actions, setActions] = useState<ActionCounts>({
    close: 0,
    reload: 0,
    openInVault: 0,
    download: 0,
  });

  const paneOpen = state.status !== "closed" && state.ref != null;

  const content = useMemo((): VaultFileContent | null => {
    if (!paneOpen) return null;
    if (preferPreviewFallback && (mode === "ds_unavailable" || mode === "flag_off")) {
      return mode === "ds_unavailable"
        ? DS_FALLBACK_PREVIEW_CONTENT
        : FLAG_OFF_PREVIEW_CONTENT;
    }
    if (
      mode === "onlyoffice" ||
      mode === "onlyoffice_save_error" ||
      (mode === "ds_unavailable" && !preferPreviewFallback)
    ) {
      return null;
    }
    if (mode === "flag_off") {
      return FLAG_OFF_PREVIEW_CONTENT;
    }
    // Citation open of a docx with onlyoffice mode uses office slot; md uses fixture.
    if (state.ref?.path?.toLowerCase().endsWith(".docx")) {
      if (mode === "onlyoffice") return null;
      return FLAG_OFF_PREVIEW_CONTENT;
    }
    return FIXTURE_CONTENT;
  }, [paneOpen, preferPreviewFallback, mode, state.ref?.path]);

  const officeEditor = useMemo(
    () => officeEditorSlotForMode(mode, preferPreviewFallback),
    [mode, preferPreviewFallback],
  );

  // For ds_unavailable: expose Back to preview (exit edit / fallback).
  const editControls = useMemo((): DocumentPaneEditControls | null => {
    if (mode !== "ds_unavailable" || preferPreviewFallback) {
      return null;
    }
    return {
      showEdit: false,
      showExitEdit: true,
      onRequestEdit: () => {},
      onExitEdit: () => {
        setPreferPreviewFallback(true);
      },
    };
  }, [mode, preferPreviewFallback]);

  const handleCitationActivate = useCallback(() => {
    setPreferPreviewFallback(mode === "flag_off");
    setState((prev) =>
      openStateFromCitation(citationPath, prev.openGeneration + 1),
    );
  }, [citationPath, mode]);

  const handleClose = useCallback(() => {
    setActions((a) => ({ ...a, close: a.close + 1 }));
    setState((prev) => ({
      ...CLOSED_STATE,
      openGeneration: prev.openGeneration,
    }));
  }, []);

  const handleReload = useCallback(() => {
    setActions((a) => ({ ...a, reload: a.reload + 1 }));
    setState((prev) =>
      prev.ref
        ? {
            ...prev,
            status: "previewing",
            openGeneration: prev.openGeneration + 1,
            error: null,
            localDirty: false,
          }
        : prev,
    );
  }, []);

  const handleOpenInVault = useCallback((_path: string) => {
    setActions((a) => ({ ...a, openInVault: a.openInVault + 1 }));
  }, []);

  const handleDownload = useCallback((_path: string) => {
    setActions((a) => ({ ...a, download: a.download + 1 }));
  }, []);

  // When DS load fails, OnlyOfficeEditorHost surfaces load_failure via thrown loader.
  // Inject a static error slot if we want deterministic error without waiting —
  // the host already maps loader throw → load_failure.
  const resolvedOfficeEditor = useMemo((): DocumentPaneOfficeEditorSlot | null => {
    if (!officeEditor) return null;
    // Ensure ds_unavailable also has a precomputed error path for flaky loaders:
    // Prefer live load failure so the host error code path is exercised.
    if (mode === "ds_unavailable" && !preferPreviewFallback) {
      return {
        ...officeEditor,
        // Optional pre-seeded error if loader is never invoked:
        error: officeEditorError("load_failure", "story_ds_unavailable"),
        session: null,
        loadDocsApi: undefined,
      };
    }
    return officeEditor;
  }, [officeEditor, mode, preferPreviewFallback]);

  return (
    <div
      ref={rootRef}
      style={rootStyle}
      data-testid="document-pane-story"
      data-layout-preference={layoutPreference}
      data-story-mode={mode}
      data-open-from-citation={startClosed ? "1" : "0"}
      data-pane-open={paneOpen ? "1" : "0"}
      data-preview-fallback={preferPreviewFallback ? "1" : "0"}
      data-action-close={String(actions.close)}
      data-action-reload={String(actions.reload)}
      data-action-open-in-vault={String(actions.openInVault)}
      data-action-download={String(actions.download)}
    >
      <div style={splitRowStyle}>
        <VStack style={chatColumnStyle} data-testid="document-pane-story-chat-column">
          <Heading level={2}>Chat</Heading>
          <Text type="body" color="secondary">
            Desktop: resizable document pane. Narrow viewports: full-screen
            drawer. Composer stays fixed at the bottom of the chat column.
            Modes: preview, progress, checkpoint, onlyoffice, flag_off,
            ds_unavailable, onlyoffice_save_error, e2e_chain. Use open=citation
            to open from a citation chip (lp-5q6.37 / lp-5q6.38).
          </Text>
          <div
            role="log"
            aria-label="Chat messages"
            style={{ flex: 1, minHeight: 120 }}
            data-testid="document-pane-story-messages"
          >
            <Text type="body">
              {chatBodyCopy(mode, paneOpen, preferPreviewFallback)}
            </Text>
            {(startClosed || mode === "citation") && (
              <HStack gap={2} style={{ marginTop: 12, flexWrap: "wrap" }}>
                <button
                  type="button"
                  style={citationChipStyle}
                  data-testid="vault-citation-1"
                  aria-label={`Citation 1: ${citationPath.split("/").filter(Boolean).at(-1) ?? citationPath}`}
                  onClick={handleCitationActivate}
                >
                  {citationPath.split("/").filter(Boolean).at(-1) ?? citationPath}
                </button>
                {!paneOpen ? (
                  <Text type="supporting" color="secondary">
                    Citation closed — activate to open the pane.
                  </Text>
                ) : null}
              </HStack>
            )}
            {mode === "ds_unavailable" && paneOpen && !preferPreviewFallback ? (
              <div style={{ marginTop: 12 }} data-testid="story-back-to-preview">
                <Button
                  label="Back to preview"
                  variant="secondary"
                  size="sm"
                  onClick={() => setPreferPreviewFallback(true)}
                />
              </div>
            ) : null}
          </div>
          <div style={composerStyle} data-testid="document-pane-story-composer">
            <Text type="body" color="secondary">
              Message your agent…
            </Text>
          </div>
        </VStack>
        <DocumentPaneHost
          state={state}
          content={content}
          isLoading={false}
          onClose={handleClose}
          onReload={handleReload}
          onOpenInVault={handleOpenInVault}
          onDownload={handleDownload}
          onOpenCheckpoint={() => {}}
          onDismissCheckpoint={() => {}}
          officeEditor={resolvedOfficeEditor}
          editControls={editControls}
          containerRef={rootRef}
          layoutPreference={layoutPreference}
        />
      </div>
    </div>
  );
}
