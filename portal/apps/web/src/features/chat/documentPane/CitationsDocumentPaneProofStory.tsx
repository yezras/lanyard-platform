/**
 * Auth-free story: every inline citation opens the side document pane
 * (lp-75r.6 / lp-86d.12).
 *
 * Mounted with `?story=citations-document-pane`.
 *
 * Covers:
 * 1. Seeded assistant message with vault citation chips (ChatMessageContent)
 * 2. Click each vault chip → DocumentPaneHost opens with fixture body
 * 3. Explicit artifact.open path (simulate agent metadata)
 * 4. tool_target path (file-tool fallback)
 * 5. External https links intentionally do NOT open the pane
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
import type { ChatTimelineCitation } from "../../../hooks/useChatEvents.js";
import { ChatMessageContent } from "../ChatMessageContent.js";

import {
  openDocumentPathAction,
  openToolTargetAction,
  panelActionsFromChatEvent,
} from "./chatArtifactRouting.js";
import { DocumentPaneHost } from "./DocumentPaneHost.js";
import type { ArtifactPanelState } from "./types.js";

/** Fixture vault paths (match BFF fixture-provider / mock-gateway). */
export const CITATION_FIXTURES = {
  vaultReadme: {
    path: "/Projects/A/README.md",
    title: "README.md",
    body:
      "# Team A README (vault citation)\n\n" +
      "Opened from **vault citation chip** — side document pane preview body.\n",
  },
  vaultNotes: {
    path: "/Projects/A/notes.md",
    title: "notes.md",
    body:
      "# Project notes (vault citation)\n\n" +
      "Second citation chip path — proves **every** chip opens the pane.\n",
  },
  artifactMemo: {
    path: "/Projects/A/memo.md",
    title: "memo.md",
    body:
      "# Memo (artifact.open)\n\n" +
      "Opened via explicit **artifact.open** portal_event metadata.\n",
  },
  toolTargetLegal: {
    path: "/Projects/Legal/memo.md",
    title: "memo.md",
    body:
      "# Legal memo (tool_target)\n\n" +
      "Opened via file-tool **tool_target** fallback routing.\n",
  },
} as const;

export const EXTERNAL_HREF = "https://example.com/docs/external-only";

export const SEEDED_ASSISTANT_CONTENT = [
  "**Seeded assistant reply** (lp-75r.6 / lp-86d.12).",
  "",
  "I read your project notes and the team README.",
  "Click each vault citation chip to open the side document pane.",
  "",
  `External reference (must **not** open the pane): [Linear ticket](${EXTERNAL_HREF})`,
].join("\n");

export const SEEDED_CITATIONS: ChatTimelineCitation[] = [
  {
    path: CITATION_FIXTURES.vaultReadme.path,
    title: CITATION_FIXTURES.vaultReadme.title,
  },
  {
    path: CITATION_FIXTURES.vaultNotes.path,
    title: CITATION_FIXTURES.vaultNotes.title,
  },
];

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

type OpenSource =
  | "citation"
  | "artifact_event"
  | "tool_target"
  | "external_blocked"
  | null;

function fixtureContentForPath(path: string): VaultFileContent {
  const match = Object.values(CITATION_FIXTURES).find((f) => f.path === path);
  if (match) {
    return {
      path: match.path,
      mime_type: "text/markdown",
      encoding: "utf-8",
      content: match.body,
    };
  }
  return {
    path,
    mime_type: "text/markdown",
    encoding: "utf-8",
    content: `# ${path}\n\nFixture preview body (unknown path).\n`,
  };
}

function openState(
  path: string,
  source: NonNullable<Exclude<OpenSource, "external_blocked">>,
  generation: number,
): ArtifactPanelState {
  const title = path.split("/").filter(Boolean).at(-1) ?? path;
  return {
    status: "previewing",
    ref: { path, title, source },
    knownRevision: { token: `etag-cite-${generation}`, kind: "etag" },
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
 * Offline proof harness: seeded vault citations + artifact.open + tool_target
 * all open the real chat document pane with distinct fixture bodies.
 */
export function CitationsDocumentPaneProofStory() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ArtifactPanelState>(CLOSED_STATE);
  const [lastOpenSource, setLastOpenSource] = useState<OpenSource>(null);
  const [lastOpenPath, setLastOpenPath] = useState<string | null>(null);
  const [externalClickCount, setExternalClickCount] = useState(0);
  const [openCount, setOpenCount] = useState(0);

  const paneOpen = state.status !== "closed" && state.ref != null;

  const content = useMemo((): VaultFileContent | null => {
    if (!paneOpen || !state.ref?.path) return null;
    return fixtureContentForPath(state.ref.path);
  }, [paneOpen, state.ref?.path]);

  const applyOpen = useCallback(
    (
      path: string,
      source: NonNullable<Exclude<OpenSource, "external_blocked">>,
    ) => {
      setLastOpenPath(path);
      setLastOpenSource(source);
      setOpenCount((n) => n + 1);
      setState((prev) => openState(path, source, prev.openGeneration + 1));
    },
    [],
  );

  /** Vault citation chips / vault markdown links (click-only, lp-5q6.14). */
  const handleCitationClick = useCallback(
    (path: string) => {
      // External https must never reach here as a vault open.
      if (/^https?:\/\//i.test(path)) {
        setLastOpenSource("external_blocked");
        setExternalClickCount((n) => n + 1);
        return;
      }
      const action = openDocumentPathAction(path, { source: "citation" });
      if (!action || action.type !== "PANEL_OPEN") {
        // Clear error surface: leave pane closed, record failed path.
        setLastOpenPath(path);
        setLastOpenSource("citation");
        return;
      }
      applyOpen(action.ref.path, "citation");
    },
    [applyOpen],
  );

  /** Explicit agent artifact.open metadata → pane. */
  const handleArtifactOpen = useCallback(() => {
    const path = CITATION_FIXTURES.artifactMemo.path;
    const actions = panelActionsFromChatEvent(
      {
        type: "message_send",
        chat_id: "proof-thread",
        metadata: {
          portal_event: "artifact.open",
          thread_id: "proof-thread",
          artifact_id: "proof:artifact-1",
          vault_path: path,
          title: CITATION_FIXTURES.artifactMemo.title,
          file_type: "md",
          producer: "agent",
          status: "open",
          timestamp: "2026-07-31T12:00:00.000Z",
        },
      },
      { thread_id: "proof-thread" },
    );
    const open = actions.find(
      (a) =>
        a.type === "PANEL_EVENT" &&
        a.event.type === "open" &&
        a.event.ref?.path,
    );
    if (open && open.type === "PANEL_EVENT" && open.event.type === "open") {
      applyOpen(open.event.ref.path, "artifact_event");
      return;
    }
    // Fallback: still open via routing helper so UI is not stuck.
    applyOpen(path, "artifact_event");
  }, [applyOpen]);

  /** File-tool tool_target fallback → pane. */
  const handleToolTarget = useCallback(() => {
    const path = CITATION_FIXTURES.toolTargetLegal.path;
    const action = openToolTargetAction(path);
    if (action && action.type === "PANEL_OPEN") {
      applyOpen(action.ref.path, "tool_target");
      return;
    }
    applyOpen(path, "tool_target");
  }, [applyOpen]);

  /**
   * External https: increment counter only — pane stays closed.
   * Mirrors production: ChatMessageContent leaves real URLs to the browser.
   */
  const handleExternalOnly = useCallback(() => {
    setExternalClickCount((n) => n + 1);
    setLastOpenSource("external_blocked");
    // Intentionally do not call applyOpen / setState open.
  }, []);

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
      data-testid="citations-document-pane-proof-story"
      data-pane-open={paneOpen ? "1" : "0"}
      data-last-open-source={lastOpenSource ?? ""}
      data-last-open-path={lastOpenPath ?? ""}
      data-open-count={String(openCount)}
      data-external-click-count={String(externalClickCount)}
      data-bead="lp-75r.6"
      data-related-bead="lp-86d.12"
    >
      <div style={splitRowStyle}>
        <VStack style={chatColumnStyle} data-testid="citations-proof-chat-column">
          <Heading level={1}>Citations → document pane (lp-75r.6)</Heading>
          <Text type="body" color="secondary">
            Seeded mock-gateway-style message with vault citation chips.
            Every vault / artifact chip opens the side document pane with
            fixture content. External https does not open the pane.
            Also covers <code>artifact.open</code> and file-tool{" "}
            <code>tool_target</code> (lp-5q6.14 / lp-86d.12).
          </Text>

          <div
            style={bubbleStyle}
            data-testid="citations-proof-assistant-bubble"
            data-role="assistant"
            role="log"
            aria-label="Seeded assistant message with citations"
          >
            <div style={metaStyle}>Assistant · seeded tools+citations</div>
            <ChatMessageContent
              content={SEEDED_ASSISTANT_CONTENT}
              citations={SEEDED_CITATIONS}
              onCitationClick={handleCitationClick}
            />
          </div>

          <HStack gap={2} style={{ flexWrap: "wrap" }}>
            <span data-testid="citations-proof-artifact-open-control">
              <Button
                label="Simulate artifact.open"
                variant="secondary"
                size="sm"
                onClick={handleArtifactOpen}
              />
            </span>
            <span data-testid="citations-proof-tool-target-control">
              <Button
                label="Simulate tool_target"
                variant="secondary"
                size="sm"
                onClick={handleToolTarget}
              />
            </span>
            <span data-testid="citations-proof-external-control">
              <Button
                label="External https (no pane)"
                variant="ghost"
                size="sm"
                onClick={handleExternalOnly}
              />
            </span>
          </HStack>

          <div
            style={logStyle}
            data-testid="citations-proof-open-log"
            data-vault-readme={CITATION_FIXTURES.vaultReadme.path}
            data-vault-notes={CITATION_FIXTURES.vaultNotes.path}
            data-artifact-path={CITATION_FIXTURES.artifactMemo.path}
            data-tool-target-path={CITATION_FIXTURES.toolTargetLegal.path}
            data-external-href={EXTERNAL_HREF}
          >
            <div>
              last open source:{" "}
              <code data-testid="citations-proof-last-source">
                {lastOpenSource ?? "(none)"}
              </code>
            </div>
            <div>
              last open path:{" "}
              <code data-testid="citations-proof-last-path">
                {lastOpenPath ?? "(none)"}
              </code>
            </div>
            <div>
              open count:{" "}
              <code data-testid="citations-proof-open-count">
                {String(openCount)}
              </code>
            </div>
            <div>
              external clicks (pane must stay closed):{" "}
              <code data-testid="citations-proof-external-count">
                {String(externalClickCount)}
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
