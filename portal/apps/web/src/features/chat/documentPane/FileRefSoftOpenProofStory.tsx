/**
 * Auth-free story: vault path / file reference soft-opens the document pane
 * (soft mode A, lp-dpr.2 / lp-86d.11).
 *
 * Mounted with `?story=file-ref-soft-open`.
 *
 * Covers:
 * 1. User message path_reference (no open verb) → PANEL_OPEN + body
 * 2. Assistant free-text multi-segment office path → defensive soft-open + body
 * 3. Path pill (document reopen chip) click after close → pane reopens with body
 *
 * No BFF / login / live gateway required for Playwright.
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

import {
  detectChatOpenDocumentIntent,
  openDocumentIntentFromUserMessage,
  panelActionsFromChatEvent,
} from "./chatArtifactRouting.js";
import {
  documentReopenChipFromRef,
  shouldRecordDocumentReopenChip,
  upsertDocumentReopenChip,
  type DocumentReopenChip,
} from "./documentReopenChips.js";
import { DocumentPaneHost } from "./DocumentPaneHost.js";
import { DocumentReopenChipBar } from "./DocumentReopenChipBar.js";
import type { ArtifactPanelState } from "./types.js";

/** Fixture office path used for soft mode A (matches activity-plane / mock vault). */
export const FILE_REF_OFFICE_PATH = "/Business/Contracts/MSA.docx";
export const FILE_REF_OFFICE_BASENAME = "MSA.docx";

export const USER_PATH_REFERENCE_MESSAGE =
  `What does ${FILE_REF_OFFICE_PATH} say about indemnification?`;

export const ASSISTANT_FREE_TEXT_PATH_MESSAGE =
  `I reviewed ${FILE_REF_OFFICE_PATH} and extracted the key terms.`;

export const FILE_REF_FIXTURE_BODY =
  "# MSA.docx — file-ref soft-open preview\n\n" +
  "Fixture body for **lp-86d.11** soft mode A (path reference without open verb).\n\n" +
  "- User path_reference soft-opens the pane\n" +
  "- Assistant free-text office path soft-opens the pane\n" +
  "- Path pill (reopen chip) click reloads body after close\n" +
  "- Soft open loads content (not chrome-only)\n";

const FIXTURE_DOC_CONTENT: VaultFileContent = {
  path: FILE_REF_OFFICE_PATH,
  mime_type: "text/markdown",
  encoding: "utf-8",
  content: FILE_REF_FIXTURE_BODY,
};

const rootStyle: CSSProperties = {
  height: "100dvh",
  width: "100%",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  containerType: "inline-size",
  containerName: "chat",
  background: "var(--color-background-body, #fafafa)",
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
  overflow: "auto",
};

const bubbleStyle: CSSProperties = {
  border: "1px solid var(--color-border, #e5e7eb)",
  borderRadius: 12,
  background: "var(--color-background-surface, #fff)",
  padding: "12px 16px",
  boxSizing: "border-box",
};

const metaStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--color-text-secondary, #64748b)",
  marginBottom: 8,
};

const logStyle: CSSProperties = {
  border: "1px dashed var(--color-border, #cbd5e1)",
  borderRadius: 8,
  padding: "8px 12px",
  background: "var(--color-background-surface, #fff)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: 12,
  wordBreak: "break-all",
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

export type FileRefOpenSource =
  | "user_path_reference"
  | "assistant_free_text"
  | "path_pill"
  | null;

function openState(
  path: string,
  source: NonNullable<FileRefOpenSource>,
  generation: number,
): ArtifactPanelState {
  const panelSource =
    source === "user_path_reference"
      ? "deep_link"
      : source === "assistant_free_text"
        ? "artifact_event"
        : "reopen_chip";
  return {
    status: "previewing",
    ref: {
      path,
      title: FILE_REF_OFFICE_BASENAME,
      source: panelSource,
    },
    knownRevision: { token: `etag-file-ref-${generation}`, kind: "etag" },
    mode: "preview",
    officeSessionId: null,
    progress: null,
    conflict: null,
    checkpointOffer: null,
    error: null,
    localDirty: false,
    openGeneration: generation,
  };
}

/**
 * Offline proof harness: soft mode A user/assistant file references open
 * the real chat document pane with a non-empty fixture body.
 */
export function FileRefSoftOpenProofStory() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ArtifactPanelState>(CLOSED_STATE);
  const [lastOpenSource, setLastOpenSource] = useState<FileRefOpenSource>(null);
  const [lastOpenPath, setLastOpenPath] = useState<string | null>(null);
  const [lastIntentKind, setLastIntentKind] = useState<string | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [reopenChips, setReopenChips] = useState<DocumentReopenChip[]>([]);

  const paneOpen = state.status !== "closed" && state.ref != null;

  const content = useMemo((): VaultFileContent | null => {
    if (!paneOpen || !state.ref?.path) return null;
    if (state.ref.path === FILE_REF_OFFICE_PATH) {
      return FIXTURE_DOC_CONTENT;
    }
    return {
      path: state.ref.path,
      mime_type: "text/markdown",
      encoding: "utf-8",
      content: `# ${state.ref.path}\n\nFixture preview body (unknown path).\n`,
    };
  }, [paneOpen, state.ref?.path]);

  const applyOpen = useCallback(
    (path: string, source: NonNullable<FileRefOpenSource>) => {
      setLastOpenPath(path);
      setLastOpenSource(source);
      setOpenCount((n) => n + 1);
      setState((prev) => {
        const next = openState(path, source, prev.openGeneration + 1);
        if (shouldRecordDocumentReopenChip(next.status, next.ref) && next.ref) {
          setReopenChips((chips) =>
            upsertDocumentReopenChip(chips, documentReopenChipFromRef(next.ref!)),
          );
        }
        return next;
      });
    },
    [],
  );

  /** Soft mode A: user path_reference (composer send path, lp-dpr.2). */
  const handleUserSoftOpen = useCallback(() => {
    const intent = detectChatOpenDocumentIntent(USER_PATH_REFERENCE_MESSAGE);
    setLastIntentKind(intent?.kind ?? null);
    const action = openDocumentIntentFromUserMessage(USER_PATH_REFERENCE_MESSAGE, {
      source: "deep_link",
    });
    if (action && action.type === "PANEL_OPEN") {
      applyOpen(action.ref.path, "user_path_reference");
      return;
    }
    // Fail closed: leave pane closed so QA can assert.
    setLastOpenPath(null);
    setLastOpenSource(null);
  }, [applyOpen]);

  /**
   * Soft mode A: assistant free-text multi-segment office path when agent
   * did not emit artifact.* / tool_target (defensive path in panelActionsFromChatEvent).
   */
  const handleAssistantSoftOpen = useCallback(() => {
    const intent = detectChatOpenDocumentIntent(ASSISTANT_FREE_TEXT_PATH_MESSAGE);
    setLastIntentKind(intent?.kind ?? null);
    const actions = panelActionsFromChatEvent({
      type: "message_send",
      chat_id: "proof-thread",
      content: ASSISTANT_FREE_TEXT_PATH_MESSAGE,
      role: "assistant",
    });
    const open = actions.find((a) => a.type === "PANEL_OPEN");
    if (open && open.type === "PANEL_OPEN") {
      applyOpen(open.ref.path, "assistant_free_text");
      return;
    }
    setLastOpenPath(null);
    setLastOpenSource(null);
  }, [applyOpen]);

  /** Path pill (reopen chip) after soft-open — must reload body (lp-a8u.2 / lp-86d.11). */
  const handlePathPillOpen = useCallback(
    (path: string) => {
      applyOpen(path, "path_pill");
    },
    [applyOpen],
  );

  const handleClose = useCallback(() => {
    setState((prev) => ({
      ...CLOSED_STATE,
      openGeneration: prev.openGeneration,
    }));
  }, []);

  return (
    <div
      ref={rootRef}
      style={rootStyle}
      data-testid="file-ref-soft-open-proof-story"
      data-pane-open={paneOpen ? "1" : "0"}
      data-last-open-source={lastOpenSource ?? ""}
      data-last-open-path={lastOpenPath ?? ""}
      data-last-intent-kind={lastIntentKind ?? ""}
      data-open-count={String(openCount)}
      data-reopen-chip-count={String(reopenChips.length)}
      data-bead="lp-86d.11"
      data-office-path={FILE_REF_OFFICE_PATH}
    >
      <div style={splitRowStyle}>
        <VStack style={chatColumnStyle} data-testid="file-ref-proof-chat-column">
          <Heading level={1}>File references soft-open pane (lp-86d.11)</Heading>
          <Text type="body" color="secondary">
            Soft mode A (lp-dpr.2): a vault office path in a user or assistant
            message soft-opens the side document pane with non-empty body.
            Path pills (reopen chips) re-open the same preview after close.
          </Text>

          <div
            style={bubbleStyle}
            data-testid="file-ref-proof-user-bubble"
            data-role="user"
            role="log"
            aria-label="Seeded user message with path reference"
          >
            <div style={metaStyle}>User · soft mode A path_reference</div>
            <Text type="body" data-testid="file-ref-proof-user-text">
              {USER_PATH_REFERENCE_MESSAGE}
            </Text>
          </div>

          <div
            style={bubbleStyle}
            data-testid="file-ref-proof-assistant-bubble"
            data-role="assistant"
            role="log"
            aria-label="Seeded assistant free-text path reference"
          >
            <div style={metaStyle}>Assistant · free-text office path</div>
            <Text type="body" data-testid="file-ref-proof-assistant-text">
              {ASSISTANT_FREE_TEXT_PATH_MESSAGE}
            </Text>
          </div>

          <HStack gap={2} style={{ flexWrap: "wrap" }}>
            <span data-testid="file-ref-proof-user-soft-open-control">
              <Button
                label="Simulate user soft mode A"
                variant="secondary"
                size="sm"
                onClick={handleUserSoftOpen}
              />
            </span>
            <span data-testid="file-ref-proof-assistant-soft-open-control">
              <Button
                label="Simulate assistant free-text path"
                variant="secondary"
                size="sm"
                onClick={handleAssistantSoftOpen}
              />
            </span>
          </HStack>

          <DocumentReopenChipBar
            chips={reopenChips}
            onOpen={handlePathPillOpen}
          />

          <div
            style={logStyle}
            data-testid="file-ref-proof-open-log"
            data-office-path={FILE_REF_OFFICE_PATH}
            data-user-message={USER_PATH_REFERENCE_MESSAGE}
            data-assistant-message={ASSISTANT_FREE_TEXT_PATH_MESSAGE}
          >
            <div>
              last open source:{" "}
              <code data-testid="file-ref-proof-last-source">
                {lastOpenSource ?? "(none)"}
              </code>
            </div>
            <div>
              last open path:{" "}
              <code data-testid="file-ref-proof-last-path">
                {lastOpenPath ?? "(none)"}
              </code>
            </div>
            <div>
              last intent kind:{" "}
              <code data-testid="file-ref-proof-last-intent">
                {lastIntentKind ?? "(none)"}
              </code>
            </div>
            <div>
              open count:{" "}
              <code data-testid="file-ref-proof-open-count">
                {String(openCount)}
              </code>
            </div>
          </div>
        </VStack>

        <DocumentPaneHost
          state={state}
          content={content}
          isLoading={false}
          onClose={handleClose}
          onReload={() => {}}
          onOpenInVault={() => {}}
          onDownload={() => {}}
          onOpenCheckpoint={() => {}}
          onDismissCheckpoint={() => {}}
          officeEditor={null}
          containerRef={rootRef}
          layoutPreference="split"
        />
      </div>
    </div>
  );
}
